// test/playerSource.test.ts
// Which source is chosen: local by request, web by request, and auto falling back lazily with a reason.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { createTokenProvider, createTokenStore } from '../src/spotify/auth.js';
import { SourceUnavailableError, choosePlayer } from '../src/sync/playerSource.js';
import { silentLogger } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';
import { makeTempDir } from './helpers/temp.js';

const tokensFor = (dir: string, accountsBase: string) => {
    const store = createTokenStore(path.join(dir, 'token.json'));
    store.save({ accessToken: 'access', refreshToken: 'refresh', expiresAtMs: Date.now() + 3600_000, scope: 'user-read-playback-state', clientId: 'client' });
    return createTokenProvider({ store, accountsBase, log: silentLogger() });
};

test('--source local never asks Spotify', () => {
    const choice = choosePlayer({ config: normalizeConfig({ source: 'local' }), log: silentLogger(), platform: 'win32' });
    assert.equal(choice.kind, 'local');
    assert.equal(choice.active(), 'local');
    choice.close();
});

test('--source local on a system without SMTC says so', () => {
    assert.throws(
        () => choosePlayer({ config: normalizeConfig({ source: 'local' }), log: silentLogger(), platform: 'linux' }),
        (error: unknown) => error instanceof SourceUnavailableError && /Windows/.test((error as Error).message),
    );
});

test('--source web uses the Web API without asking it first', () => {
    const temp = makeTempDir();
    try {
        const tokens = tokensFor(temp.dir, 'http://127.0.0.1:1');
        const choice = choosePlayer({
            config: normalizeConfig({ source: 'web', spotifyApiBase: 'http://127.0.0.1:1' }),
            tokens,
            log: silentLogger(),
            platform: 'win32',
        });
        assert.equal(choice.kind, 'web');
        assert.equal(choice.active(), 'web');
    } finally {
        temp.cleanup();
    }
});

test('auto does not touch Spotify until the first read, then falls back on a refusal', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({
        status: 403,
        json: { error: { status: 403, message: 'Active premium subscription required for the owner of the app.' } },
    }));
    try {
        const tokens = tokensFor(temp.dir, server.baseUrl);
        const choice = choosePlayer({
            config: normalizeConfig({ source: 'auto', spotifyApiBase: server.baseUrl }),
            tokens,
            log: silentLogger(),
            platform: 'win32',
        });
        try {
            assert.equal(server.requests.length, 0, 'nothing is asked while the choice is still open');
            await choice.player.getNowPlaying();
            // Both Web API endpoints were refused (playback state, then currently-playing).
            assert.equal(server.requests.length, 2);
            assert.equal(choice.active(), 'local', 'the 403 sends it to the machine, not to an error');
        } finally {
            choice.close();
        }
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('auto without a sign-in uses the local session on Windows', () => {
    const choice = choosePlayer({ config: normalizeConfig({ source: 'auto' }), log: silentLogger(), platform: 'win32' });
    assert.equal(choice.kind, 'local');
    choice.close();
});

test('auto without a sign-in and without SMTC explains what is missing', () => {
    assert.throws(
        () => choosePlayer({ config: normalizeConfig({ source: 'auto' }), log: silentLogger(), platform: 'darwin' }),
        (error: unknown) => error instanceof SourceUnavailableError && /Windows/.test((error as Error).message),
    );
});
