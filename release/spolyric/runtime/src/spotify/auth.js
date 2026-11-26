// src/spotify/auth.ts
// Signing in as the listener: Spotify's consent page in the browser, a loopback redirect, PKCE, a refresh token kept on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { HttpError, fetchJson, parseJson } from '../http.js';
import { ensureDirectory } from '../paths.js';
import { createPkcePair, randomState } from './pkce.js';
/** What Spolyric reads: what is playing and where the listener is. It never changes playback, so it asks for no more. */
export const SPOTIFY_SCOPES = [
    'user-read-playback-state',
    'user-read-currently-playing',
];
const RENEW_AHEAD_MS = 60_000;
/** Stops a token that Spotify keeps refusing from renewing on every poll. */
const FORCED_RENEW_INTERVAL_MS = 15_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
export class SpotifyAuthError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'SpotifyAuthError';
        this.code = code;
    }
}
const credentialsFrom = (body, clientId, keptRefreshToken) => {
    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : keptRefreshToken ?? '';
    if (!accessToken || !refreshToken) {
        throw new SpotifyAuthError('refused', 'Spotify did not hand out a token');
    }
    const expiresIn = Number(body.expires_in);
    return {
        accessToken,
        refreshToken,
        expiresAtMs: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
        scope: typeof body.scope === 'string' ? body.scope : '',
        clientId,
    };
};
/** The token endpoint; `invalid_grant` is the one refusal that means the stored sign-in is gone for good. */
async function tokenRequest({ accountsBase, form, fetchImpl, }) {
    try {
        const answer = await fetchJson(`${accountsBase}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
            timeoutMs: 30_000,
        }, fetchImpl);
        return answer.body ?? {};
    }
    catch (error) {
        if (error instanceof HttpError) {
            const body = (parseJson(error.bodyText) ?? {});
            const said = typeof body.error === 'string' ? body.error : '';
            if (said === 'invalid_grant')
                throw new SpotifyAuthError('invalid_grant', 'Spotify no longer accepts this sign-in');
            if (said === 'invalid_client')
                throw new SpotifyAuthError('invalid_client', 'Spotify does not know this Client ID');
            // Only the two refusals above mean the sign-in itself is dead. Everything else — 5xx, 429, a
            // gateway answer with no body, even `invalid_request` — may go away on its own, so it stays a
            // retryable error: the runner logs it and tries again instead of signing the listener out.
            if (error.status >= 500 || error.status === 429 || error.status === 408 || !said)
                throw error;
        }
        throw error;
    }
}
export const authorizeUrl = ({ accountsBase, clientId, redirectUri, state, challenge, scopes = SPOTIFY_SCOPES, }) => {
    const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        // Ask for the consent screen every time: a cached grant can come back without the scopes this
        // tool needs, and then the Web API answers 403 for every request.
        show_dialog: 'true',
    });
    return `${accountsBase}/authorize?${query.toString()}`;
};
const isCredentials = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return typeof candidate.accessToken === 'string'
        && typeof candidate.refreshToken === 'string'
        && typeof candidate.expiresAtMs === 'number'
        && typeof candidate.clientId === 'string';
};
/** The refresh token on disk, readable only by this user where the system supports it. */
export function createTokenStore(filePath) {
    return {
        filePath,
        load() {
            try {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                return isCredentials(parsed) ? parsed : null;
            }
            catch {
                return null;
            }
        },
        save(credentials) {
            ensureDirectory(path.dirname(filePath));
            fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
            // `mode` is only honoured when the file is created; tighten a file that was already there.
            try {
                fs.chmodSync(filePath, 0o600);
            }
            catch {
                // Windows has no POSIX modes; the user profile's ACL is what protects the file there.
            }
        },
        clear() {
            try {
                fs.rmSync(filePath, { force: true });
            }
            catch {
                // already gone
            }
        },
    };
}
export function createTokenProvider({ store, accountsBase, fetchImpl = fetch, now = Date.now, log, }) {
    let held = store.load();
    let renewing = null;
    let stale = false;
    let lastForcedRenewAt = 0;
    /**
     * A token granted without either playback scope cannot answer what is playing, whatever the API says;
     * catching it here turns a puzzling 403 into an instruction to sign in again.
     */
    const verified = (credentials) => {
        const scopes = credentials.scope.split(/\s+/).filter(Boolean);
        if (scopes.length > 0 && !scopes.includes('user-read-playback-state') && !scopes.includes('user-read-currently-playing')) {
            throw new SpotifyAuthError('scope-missing', '这份 Spotify 授权没有读取播放状态的权限');
        }
        return credentials;
    };
    const renew = async () => {
        const current = held;
        if (!current)
            throw new SpotifyAuthError('no-token', 'No Spotify sign-in is stored');
        const body = await tokenRequest({
            accountsBase,
            fetchImpl,
            form: {
                grant_type: 'refresh_token',
                refresh_token: current.refreshToken,
                client_id: current.clientId,
            },
        });
        const next = credentialsFrom(body, current.clientId, current.refreshToken);
        held = next;
        store.save(next);
        stale = false;
        log.debug('Spotify token renewed', { expiresAt: new Date(next.expiresAtMs).toISOString() });
        return next;
    };
    return {
        stored: () => held,
        invalidate() {
            stale = true;
        },
        async ensure(options = {}) {
            if (!held)
                throw new SpotifyAuthError('no-token', 'No Spotify sign-in is stored');
            // A refresh already in flight serves every caller, including a forced one.
            if (renewing)
                return verified(await renewing);
            const now_ = now();
            if (!options.force && !stale && held.expiresAtMs - now_ > RENEW_AHEAD_MS)
                return verified(held);
            // A 401 on every request must not turn into a renewal on every request: one a while is enough,
            // and the answer is reused until then.
            if (options.force && now_ - lastForcedRenewAt < FORCED_RENEW_INTERVAL_MS && held.expiresAtMs > now_)
                return verified(held);
            if (options.force)
                lastForcedRenewAt = now_;
            renewing = renew()
                .catch(error => {
                if (error instanceof SpotifyAuthError && error.code === 'invalid_grant') {
                    held = null;
                    store.clear();
                }
                throw error;
            })
                .finally(() => {
                renewing = null;
            });
            return verified(await renewing);
        },
    };
}
/** Opens the consent page in the browser the way this system does it; a failure is reported and the URL logged. */
export function openInBrowser(url, log) {
    // On Windows the URL must reach the browser quoted, and `cmd` re-parses whatever Node hands it:
    // `windowsVerbatimArguments` keeps the quotes, so the query string's `&` is not read as a command break.
    const [command, args] = process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', `"${url}"`]]
        : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];
    try {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            windowsVerbatimArguments: process.platform === 'win32',
        });
        child.on('error', error => log.warn('Could not open the browser; open the address below by hand', error));
        child.unref();
    }
    catch (error) {
        log.warn('Could not open the browser; open the address below by hand', error);
    }
}
const page = (text) => (`<!doctype html><meta charset="utf-8"><title>Spolyric</title>`
    + '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#121212;color:#eee;'
    + 'font:16px system-ui,sans-serif;text-align:center;padding:24px">' + text + '</body>');
/** One sign-in attempt: starts the loopback listener, opens the consent page, waits for the code, exchanges it. */
export async function runLogin({ clientId, redirectPort, accountsBase, fetchImpl = fetch, openBrowser, log, timeoutMs = LOGIN_TIMEOUT_MS, }) {
    if (!clientId)
        throw new SpotifyAuthError('invalid_client', 'No Spotify Client ID is set');
    const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;
    const { verifier, challenge } = createPkcePair();
    const state = randomState();
    const url = authorizeUrl({ accountsBase, clientId, redirectUri, state, challenge });
    const server = http.createServer();
    let finish = () => { };
    const answer = new Promise((resolve, reject) => {
        finish = outcome => {
            if ('credentials' in outcome)
                resolve(outcome.credentials);
            else
                reject(outcome.error);
        };
    });
    server.on('request', (request, response) => {
        const address = (() => {
            try {
                return new URL(request.url ?? '/', redirectUri);
            }
            catch {
                return null;
            }
        })();
        if (!address || request.method !== 'GET' || address.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }
        if (address.searchParams.get('state') !== state) {
            response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('登录状态不匹配，请回到 Spolyric 重新登录。'));
            return;
        }
        const error = address.searchParams.get('error');
        if (error) {
            finish({ error: new SpotifyAuthError(error === 'access_denied' ? 'refused' : 'refused', `Spotify said ${error}`) });
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('未授权。请回到 Spolyric 重试。'));
            return;
        }
        const code = address.searchParams.get('code');
        if (!code) {
            finish({ error: new SpotifyAuthError('refused', 'Spotify sent no code back') });
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('登录未完成。请回到 Spolyric 重试。'));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('已登录 Spotify，可以关掉这个标签页了。'));
        void tokenRequest({
            accountsBase,
            fetchImpl,
            form: {
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: verifier,
            },
        }).then(body => finish({ credentials: credentialsFrom(body, clientId, null) }), error => finish({ error: error instanceof Error ? error : new Error(String(error)) }));
    });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(redirectPort, '127.0.0.1', () => resolve());
        }).catch((error) => {
            const code = error?.code;
            if (code === 'EADDRINUSE' || code === 'EACCES') {
                throw new SpotifyAuthError('listen-failed', `端口 ${redirectPort} 被占用了，没法等 Spotify 回调`);
            }
            throw error;
        });
        log.info(`Waiting for the browser on 127.0.0.1:${redirectPort}`);
        const timeout = new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new SpotifyAuthError('timed-out', `等了 ${Math.round(timeoutMs / 60000)} 分钟也没等到 Spotify 回调（回调地址 ${redirectUri}）`)), timeoutMs);
            timer.unref?.();
        });
        if (openBrowser)
            openBrowser(url);
        log.info(`如果浏览器没有自动打开，请手动访问这个地址：\n${url}`);
        if (!openBrowser)
            openInBrowser(url, log);
        const credentials = await Promise.race([answer, timeout]);
        log.info('Signed in to Spotify');
        return credentials;
    }
    finally {
        server.close();
        server.closeAllConnections?.();
    }
}
//# sourceMappingURL=auth.js.map