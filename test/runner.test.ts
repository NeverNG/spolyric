// test/runner.test.ts
// The whole chain over real sockets: a fake Spotify, a fake Folia stage, and the runner in between.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { stageConnectionFileIn, tokenFile } from '../src/paths.js';
import { createTokenProvider, createTokenStore } from '../src/spotify/auth.js';
import { runSync } from '../src/sync/runner.js';
import { silentLogger } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';
import { makeTempDir } from './helpers/temp.js';

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
};

const spotifyBody = () => ({
    is_playing: true,
    progress_ms: 42_000,
    currently_playing_type: 'track',
    device: { name: 'Desktop' },
    item: {
        id: '4uLU6hMCjMI75M1A2tKUQC',
        type: 'track',
        name: 'Never Gonna Give You Up',
        duration_ms: 213_000,
        artists: [{ name: 'Rick Astley' }],
        album: { name: 'Whenever You Need Somebody', images: [{ url: 'https://i.scdn.co/image/cover', width: 640 }] },
    },
});

test('the runner follows Spotify onto the stage', async () => {
    const temp = makeTempDir();
    let sessionCounter = 0;
    const stageServer = await startTestServer(request => {
        if (request.url === '/stage/health' || request.url === '/stage/status') {
            return { json: { enabled: true, modeEnabled: true, source: 'stage-api', port: 1, activeEntryKind: null } };
        }
        if (request.url === '/stage/lyrics') {
            sessionCounter += 1;
            return {
                json: {
                    enabled: true,
                    modeEnabled: true,
                    source: 'stage-api',
                    activeEntryKind: 'lyrics',
                    lyricsSession: { title: 'x', updatedAt: 1000 + sessionCounter },
                },
            };
        }
        if (request.url === '/stage/state') return { json: { enabled: true, modeEnabled: true, source: 'stage-api', activeEntryKind: null, lyricsSession: null } };
        return { status: 404, json: { error: 'not found' } };
    });
    const spotify = await startTestServer(request => {
        if (request.url?.startsWith('/v1/me/player')) return { json: spotifyBody() };
        return { status: 404, json: { error: 'not found' } };
    });
    try {
        const connectionFile = stageConnectionFileIn(temp.dir);
        fs.mkdirSync(path.dirname(connectionFile), { recursive: true });
        fs.writeFileSync(connectionFile, JSON.stringify({ version: 1, pid: 1, port: 1, baseUrl: stageServer.baseUrl, token: 'stage-token' }));

        const store = createTokenStore(tokenFile(temp.dir));
        store.save({
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresAtMs: Date.now() + 3600_000,
            scope: 'user-read-playback-state',
            clientId: 'client',
        });
        const config = normalizeConfig({
            clientId: 'client',
            pollIntervalMs: 30,
            clockIntervalMs: 1000,
            emptyGraceMs: 1000,
            spotifyApiBase: spotify.baseUrl,
            lyrics: { spotify: false, lrclib: false },
            connectionFile,
        });
        const tokens = createTokenProvider({ store, accountsBase: spotify.baseUrl, log: silentLogger() });
        const controller = new AbortController();
        const running = runSync({ config, dataDir: temp.dir, tokens, log: silentLogger(), signal: controller.signal });

        await waitFor(() => stageServer.requests.some(request => request.url === '/stage/lyrics'));
        controller.abort();
        assert.equal(await running, 'stopped');

        const pushed = stageServer.requests.find(request => request.url === '/stage/lyrics');
        assert.equal(pushed?.headers.authorization, 'Bearer stage-token');
        const body = JSON.parse(pushed?.body ?? '{}');
        assert.equal(body.title, 'Never Gonna Give You Up');
        assert.equal(body.artist, 'Rick Astley');
        assert.equal(body.durationMs, 213_000);
        assert.equal(body.paused, false);
        assert.ok(body.positionMs >= 42_000);
        assert.equal(body.lyricSource, undefined);
        assert.equal(spotify.requests.length > 0, true);
        assert.equal(spotify.requests[0]?.headers.authorization, 'Bearer access');
    } finally {
        await stageServer.close();
        await spotify.close();
        temp.cleanup();
    }
});

test('a stale connection file for a closed Folia does not make the runner fail', async () => {
    const temp = makeTempDir();
    const spotify = await startTestServer(() => ({ json: spotifyBody() }));
    try {
        const connectionFile = stageConnectionFileIn(temp.dir);
        fs.mkdirSync(path.dirname(connectionFile), { recursive: true });
        // Folia is gone, but its connection file is still there.
        fs.writeFileSync(connectionFile, JSON.stringify({ version: 1, pid: 999_999, port: 1, baseUrl: 'http://127.0.0.1:1', token: 'tok' }));
        const store = createTokenStore(tokenFile(temp.dir));
        store.save({ accessToken: 'a', refreshToken: 'r', expiresAtMs: Date.now() + 3600_000, scope: '', clientId: 'client' });
        const config = normalizeConfig({
            pollIntervalMs: 20,
            clockIntervalMs: 100,
            emptyGraceMs: 100,
            spotifyApiBase: spotify.baseUrl,
            lyrics: { spotify: false, lrclib: false },
            connectionFile,
        });
        const tokens = createTokenProvider({ store, accountsBase: spotify.baseUrl, log: silentLogger() });
        const controller = new AbortController();
        const running = runSync({ config, dataDir: temp.dir, tokens, log: silentLogger(), signal: controller.signal });
        setTimeout(() => controller.abort(), 150);
        assert.equal(await running, 'stopped');
        assert.equal(spotify.requests.length, 0, 'nothing is asked when Folia is not there');
    } finally {
        await spotify.close();
        temp.cleanup();
    }
});

test('--once finishes after one step even when Folia is not set up', async () => {
    const temp = makeTempDir();
    const spotify = await startTestServer(() => ({ json: spotifyBody() }));
    try {
        const store = createTokenStore(tokenFile(temp.dir));
        store.save({ accessToken: 'a', refreshToken: 'r', expiresAtMs: Date.now() + 3600_000, scope: '', clientId: 'client' });
        const config = normalizeConfig({
            pollIntervalMs: 20,
            spotifyApiBase: spotify.baseUrl,
            lyrics: { spotify: false, lrclib: false },
            connectionFile: path.join(temp.dir, 'missing', 'connection.json'),
        });
        const tokens = createTokenProvider({ store, accountsBase: spotify.baseUrl, log: silentLogger() });
        const outcome = await runSync({ config, dataDir: temp.dir, tokens, log: silentLogger(), signal: new AbortController().signal, once: true });
        assert.equal(outcome, 'stopped');
    } finally {
        await spotify.close();
        temp.cleanup();
    }
});

test('a dry run needs no Folia: it still reads Spotify and pushes nothing', async () => {
    const temp = makeTempDir();
    const spotify = await startTestServer(() => ({ json: spotifyBody() }));
    try {
        const store = createTokenStore(tokenFile(temp.dir));
        store.save({ accessToken: 'a', refreshToken: 'r', expiresAtMs: Date.now() + 3600_000, scope: '', clientId: 'client' });
        const config = normalizeConfig({
            pollIntervalMs: 20,
            spotifyApiBase: spotify.baseUrl,
            lyrics: { spotify: false, lrclib: false },
            connectionFile: path.join(temp.dir, 'missing', 'connection.json'),
        });
        const tokens = createTokenProvider({ store, accountsBase: spotify.baseUrl, log: silentLogger() });
        const outcome = await runSync({ config, dataDir: temp.dir, tokens, log: silentLogger(), signal: new AbortController().signal, dryRun: true, once: true });
        assert.equal(outcome, 'stopped');
        assert.equal(spotify.requests.length, 1);
    } finally {
        await spotify.close();
        temp.cleanup();
    }
});

test('without a Stage connection the runner waits instead of failing', async () => {    const temp = makeTempDir();
    const spotify = await startTestServer(() => ({ json: spotifyBody() }));
    try {
        const store = createTokenStore(tokenFile(temp.dir));
        store.save({
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresAtMs: Date.now() + 3600_000,
            scope: '',
            clientId: 'client',
        });
        const config = normalizeConfig({
            pollIntervalMs: 20,
            spotifyApiBase: spotify.baseUrl,
            lyrics: { spotify: false, lrclib: false },
            connectionFile: path.join(temp.dir, 'missing', 'connection.json'),
        });
        const tokens = createTokenProvider({ store, accountsBase: spotify.baseUrl, log: silentLogger() });
        const controller = new AbortController();
        const running = runSync({ config, dataDir: temp.dir, tokens, log: silentLogger(), signal: controller.signal });
        setTimeout(() => controller.abort(), 120);
        assert.equal(await running, 'stopped');
        assert.equal(spotify.requests.length, 0);
    } finally {
        await spotify.close();
        temp.cleanup();
    }
});
