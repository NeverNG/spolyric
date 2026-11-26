// src/folia/stage.ts
// The Stage API as Spolyric uses it: push one lyrics session per track, then move its clock.
import { HttpError, fetchJson, parseJson } from '../http.js';
export class StageApiError extends Error {
    path;
    status;
    code;
    details;
    constructor(path, status, code, message, details) {
        super(message);
        this.name = 'StageApiError';
        this.path = path;
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
const messageOf = (body, status) => {
    const parsed = (parseJson(body) ?? {});
    const code = typeof parsed.code === 'string' ? parsed.code : null;
    const said = typeof parsed.error === 'string' ? parsed.error : '';
    return { code, message: said || `Stage API answered ${status}` };
};
export function createStageClient({ connection, fetchImpl = fetch, log, timeoutMs = 8000, signal, }) {
    const request = async (path, options = {}) => {
        const url = `${connection.baseUrl}${path}`;
        const headers = { Accept: 'application/json' };
        if (options.authorized !== false)
            headers.Authorization = `Bearer ${connection.token}`;
        if (options.body !== undefined)
            headers['Content-Type'] = 'application/json';
        try {
            const answer = await fetchJson(url, {
                method: options.method ?? 'GET',
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                timeoutMs,
                signal,
            }, fetchImpl);
            return answer.body;
        }
        catch (error) {
            if (error instanceof HttpError) {
                const { code, message } = messageOf(error.bodyText, error.status);
                if (error.status === 401) {
                    log.warn('The Stage API refused the token; Folia has probably restarted (a new connection file is written then)');
                }
                throw new StageApiError(path, error.status, code, message, parseJson(error.bodyText)?.details ?? null);
            }
            throw error;
        }
    };
    const statusOf = (body) => {
        const answer = (body ?? {});
        const session = answer.lyricsSession && typeof answer.lyricsSession === 'object'
            ? answer.lyricsSession
            : null;
        const updatedAt = Number(session?.updatedAt);
        const shown = session && Number.isFinite(updatedAt)
            ? {
                updatedAt,
                ...(typeof session.title === 'string' ? { title: session.title } : {}),
                ...(typeof session.artist === 'string' ? { artist: session.artist } : {}),
            }
            : null;
        return {
            enabled: answer.enabled === true,
            modeEnabled: answer.modeEnabled === true,
            source: typeof answer.source === 'string' ? answer.source : null,
            activeEntryKind: answer.activeEntryKind === 'lyrics' || answer.activeEntryKind === 'media' ? answer.activeEntryKind : null,
            lyricsSession: shown,
        };
    };
    return {
        baseUrl: connection.baseUrl,
        async health() {
            // A Stage that is not listening is an answer here, not a failure: the caller decides to wait.
            try {
                return statusOf(await request('/stage/health', { authorized: false }));
            }
            catch {
                return null;
            }
        },
        async status() {
            return statusOf(await request('/stage/status'));
        },
        async playerStatus() {
            let body;
            try {
                body = await request('/stage/player/status');
            }
            catch {
                return null;
            }
            if (!body || typeof body !== 'object')
                return null;
            const record = body;
            const state = record.playerState;
            const capabilities = record.controlCapabilities && typeof record.controlCapabilities === 'object'
                ? record.controlCapabilities
                : {};
            const numeric = (value) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : -1;
            };
            return {
                playerState: state === 'PLAYING' || state === 'PAUSED' || state === 'IDLE' ? state : 'UNKNOWN',
                positionMs: Math.max(0, numeric(record.positionMs)),
                durationMs: Math.max(0, numeric(record.durationMs)),
                sampledAtMs: numeric(record.sampledAtMs),
                canSeek: capabilities.seek === true,
            };
        },
        async pushLyrics(request_) {
            const body = await request('/stage/lyrics', { method: 'POST', body: request_ });
            const session = statusOf(body).lyricsSession;
            if (!session)
                throw new StageApiError('/stage/lyrics', 200, 'NO_SESSION', 'Stage API did not answer a session', null);
            return { sessionUpdatedAt: session.updatedAt };
        },
        async pushClock(request_) {
            const body = await request('/stage/lyrics/clock', { method: 'POST', body: request_ });
            const updatedAt = Number(body?.sessionUpdatedAt);
            if (!Number.isFinite(updatedAt)) {
                throw new StageApiError('/stage/lyrics/clock', 200, 'NO_SESSION', 'Stage API did not answer a session', null);
            }
            return { sessionUpdatedAt: updatedAt };
        },
        async clear() {
            await request('/stage/state', { method: 'DELETE' });
        },
    };
}
//# sourceMappingURL=stage.js.map