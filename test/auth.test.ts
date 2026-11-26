// test/auth.test.ts
// The sign-in pieces that can be tested without a browser: the consent URL, the stored refresh token, and renewal.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {
    SpotifyAuthError,
    authorizeUrl,
    createTokenProvider,
    createTokenStore,
    runLogin,
    SPOTIFY_SCOPES,
} from '../src/spotify/auth.js';
import { silentLogger } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';
import { makeTempDir } from './helpers/temp.js';

const credentials = (overrides: Partial<{ expiresAtMs: number; accessToken: string; scope: string }> = {}) => ({
    accessToken: overrides.accessToken ?? 'old-access',
    refreshToken: 'refresh',
    expiresAtMs: overrides.expiresAtMs ?? Date.now() + 3600_000,
    scope: overrides.scope ?? 'user-read-playback-state',
    clientId: 'client',
});

test('the consent URL carries PKCE, the redirect and the read-only scopes', () => {
    const url = new URL(authorizeUrl({
        accountsBase: 'https://accounts.spotify.com',
        clientId: 'client-id',
        redirectUri: 'http://127.0.0.1:9888/callback',
        state: 'state',
        challenge: 'challenge',
    }));
    assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:9888/callback');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), 'challenge');
    assert.equal(url.searchParams.get('state'), 'state');
    assert.equal(url.searchParams.get('scope'), SPOTIFY_SCOPES.join(' '));
    assert.deepEqual(SPOTIFY_SCOPES, ['user-read-playback-state', 'user-read-currently-playing']);
});

test('the token store round-trips and forgets', () => {
    const temp = makeTempDir();
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        assert.equal(store.load(), null);
        store.save(credentials());
        assert.equal(store.load()?.refreshToken, 'refresh');
        if (process.platform !== 'win32') {
            const mode = fs.statSync(store.filePath).mode & 0o777;
            assert.equal(mode, 0o600, 'the token file is readable only by its owner');
        }
        store.clear();
        assert.equal(store.load(), null);
    } finally {
        temp.cleanup();
    }
});

test('a fresh token is used without asking Spotify', async () => {
    const temp = makeTempDir();
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials());
        const provider = createTokenProvider({ store, accountsBase: 'http://127.0.0.1:1', log: silentLogger() });
        assert.equal((await provider.ensure()).accessToken, 'old-access');
    } finally {
        temp.cleanup();
    }
});

test('an expiring token is renewed once for concurrent callers, and the new one is kept', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ json: { access_token: 'new-access', expires_in: 3600, scope: 'user-read-playback-state' } }));
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ expiresAtMs: Date.now() - 1000 }));
        const provider = createTokenProvider({ store, accountsBase: server.baseUrl, log: silentLogger() });
        const [first, second] = await Promise.all([provider.ensure(), provider.ensure()]);
        assert.equal(first.accessToken, 'new-access');
        assert.equal(second.accessToken, 'new-access');
        assert.equal(server.requests.length, 1, 'one renewal for two callers');
        const sent = new URLSearchParams(server.requests[0]?.body ?? '');
        assert.equal(sent.get('grant_type'), 'refresh_token');
        assert.equal(sent.get('refresh_token'), 'refresh');
        assert.equal(sent.get('client_id'), 'client');
        assert.equal(createTokenStore(store.filePath).load()?.accessToken, 'new-access');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a 401 makes the next call renew', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ json: { access_token: 'after-401', expires_in: 3600 } }));
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials());
        const provider = createTokenProvider({ store, accountsBase: server.baseUrl, log: silentLogger() });
        assert.equal((await provider.ensure()).accessToken, 'old-access');
        provider.invalidate();
        assert.equal((await provider.ensure()).accessToken, 'after-401');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a revoked sign-in is forgotten, not retried for ever', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ status: 400, json: { error: 'invalid_grant' } }));
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ expiresAtMs: Date.now() - 1000 }));
        const provider = createTokenProvider({ store, accountsBase: server.baseUrl, log: silentLogger() });
        await assert.rejects(provider.ensure(), (error: unknown) => error instanceof SpotifyAuthError && error.code === 'invalid_grant');
        assert.equal(store.load(), null, 'the dead sign-in is removed');
        await assert.rejects(provider.ensure(), (error: unknown) => error instanceof SpotifyAuthError && error.code === 'no-token');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a token endpoint that is down is retryable, not a sign-out', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ status: 503, json: { error: 'service unavailable' } }));
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ expiresAtMs: Date.now() - 1000 }));
        const provider = createTokenProvider({ store, accountsBase: server.baseUrl, log: silentLogger() });
        await assert.rejects(provider.ensure(), (error: unknown) => !(error instanceof SpotifyAuthError));
        assert.notEqual(store.load(), null, 'a 503 does not throw the sign-in away');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a token granted without either playback scope is reported as such', async () => {
    const temp = makeTempDir();
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ scope: 'user-read-private user-read-email' }));
        const provider = createTokenProvider({ store, accountsBase: 'http://127.0.0.1:1', log: silentLogger() });
        await assert.rejects(provider.ensure(), (error: unknown) => error instanceof SpotifyAuthError && error.code === 'scope-missing');
    } finally {
        temp.cleanup();
    }
});

test('a token with no recorded scope is left to the API to judge', async () => {
    const temp = makeTempDir();
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ scope: '' }));
        const provider = createTokenProvider({ store, accountsBase: 'http://127.0.0.1:1', log: silentLogger() });
        assert.equal((await provider.ensure()).accessToken, 'old-access');
    } finally {
        temp.cleanup();
    }
});

test('a sign-in port that is already taken says so, instead of waiting five minutes', async () => {
    const blocker = http.createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
        await assert.rejects(
            runLogin({
                clientId: 'client',
                redirectPort: port,
                accountsBase: 'http://127.0.0.1:1',
                log: silentLogger(),
                openBrowser: () => {},
                timeoutMs: 200,
            }),
            (error: unknown) => error instanceof SpotifyAuthError && error.code === 'listen-failed',
        );
    } finally {
        await new Promise<void>(resolve => blocker.close(() => resolve()));
    }
});

test('a sign-in that never comes back times out and names the redirect address', async () => {
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    await assert.rejects(
        runLogin({
            clientId: 'client',
            redirectPort: port,
            accountsBase: 'http://127.0.0.1:1',
            log: silentLogger(),
            openBrowser: () => {},
            timeoutMs: 60,
        }),
        (error: unknown) => error instanceof SpotifyAuthError
            && error.code === 'timed-out'
            && error.message.includes(`127.0.0.1:${port}/callback`),
    );
});

test('a wrong Client ID is reported as such', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ status: 400, json: { error: 'invalid_client' } }));
    try {
        const store = createTokenStore(path.join(temp.dir, 'token.json'));
        store.save(credentials({ expiresAtMs: Date.now() - 1000 }));
        const provider = createTokenProvider({ store, accountsBase: server.baseUrl, log: silentLogger() });
        await assert.rejects(provider.ensure(), (error: unknown) => error instanceof SpotifyAuthError && error.code === 'invalid_client');
        assert.notEqual(store.load(), null, 'a bad client id does not throw the sign-in away');
    } finally {
        await server.close();
        temp.cleanup();
    }
});
