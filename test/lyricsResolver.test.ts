// test/lyricsResolver.test.ts
// The order of the lyric sources, the disk cache, and what a failure is allowed to remember.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLyricsCache, createLyricsResolver } from '../src/spotify/lyrics.js';
import { silentLogger, track } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';
import { makeTempDir } from './helpers/temp.js';

const spotifyLyrics = (body: string) => JSON.stringify({
    lyrics: {
        syncType: 'LINE_SYNCED',
        lines: body.split('\n').map((words, index) => ({ startTimeMs: String(index * 1000), words })),
    },
});

const resolverFor = (dir: string, base: string, enabled = { spotify: true, netease: false, qq: false, kugou: false, lrclib: true }) => createLyricsResolver({
    cache: createLyricsCache(dir),
    enabled,
    getToken: async () => 'token',
    neteaseBase: base,
    lrclibBase: base,
    spotifyLyricsBase: base,
    log: silentLogger(),
});

test('Spotify lyrics are used first and then come from the cache', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(request => {
        if (request.url?.startsWith('/color-lyrics/v2/track/')) return { text: spotifyLyrics('one\ntwo') };
        return { status: 404, json: { code: 404 } };
    });
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        const first = await resolver.get(track());
        assert.equal(first?.source, 'spotify');
        assert.equal(first?.lrc, '[00:00.00]one\n[00:01.00]two');
        const requests = server.requests.length;
        const second = await resolver.get(track());
        assert.equal(second?.source, 'spotify');
        assert.equal(server.requests.length, requests, 'the cache answered the second time');
        assert.ok(resolver.peek(track()), 'peek finds it without a request');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('Spotify having no lyrics falls through to LRCLIB', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(request => {
        if (request.url?.startsWith('/color-lyrics/v2/track/')) return { status: 404, json: { code: 404 } };
        if (request.url?.startsWith('/api/get')) return { json: { syncedLyrics: '[00:00.10]from lrclib\n[00:02.00]second' } };
        return { status: 404, json: { code: 404 } };
    });
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        const answer = await resolver.get(track());
        assert.equal(answer?.source, 'lrclib');
        assert.match(answer?.lrc ?? '', /from lrclib/);
        // The Spotify request carried the web player's header and the account token.
        const asked = server.requests.find(request => request.url?.startsWith('/color-lyrics'));
        assert.equal(asked?.headers.authorization, 'Bearer token');
        assert.equal(asked?.headers['app-platform'], 'WebPlayer');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a local file has no Spotify id, so only LRCLIB is asked', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(request => {
        if (request.url?.startsWith('/api/get')) return { json: { syncedLyrics: '[00:00.00]a\n[00:01.00]b' } };
        return { status: 404, json: { code: 404 } };
    });
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        const answer = await resolver.get(track({ id: 'local:My File', kind: 'track' }));
        assert.equal(answer?.source, 'lrclib');
        assert.equal(server.requests.some(request => request.url?.startsWith('/color-lyrics')), false);
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('a source being down is not remembered as "no lyrics"', async () => {
    const temp = makeTempDir();
    let failing = true;
    const server = await startTestServer(() => (failing ? { status: 503, json: { error: 'down' } } : { json: { syncedLyrics: '[00:00.00]a\n[00:01.00]b' } }));
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        assert.equal(await resolver.get(track()), null);
        failing = false;
        const second = await resolver.get(track());
        assert.equal(second?.source, 'lrclib', 'the next attempt asks again and succeeds');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('one source saying "none" while the other is down does not remember "none"', async () => {
    const temp = makeTempDir();
    let lrclibDown = true;
    const server = await startTestServer(request => {
        if (request.url?.startsWith('/color-lyrics')) return { status: 404, json: { code: 404 } };
        if (request.url?.startsWith('/api/get')) {
            return lrclibDown
                ? { status: 503, json: { error: 'down' } }
                : { json: { syncedLyrics: '[00:00.00]a\n[00:01.00]b' } };
        }
        return { status: 404, json: { code: 404 } };
    });
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        assert.equal(await resolver.get(track()), null);
        lrclibDown = false;
        const second = await resolver.get(track());
        assert.equal(second?.source, 'lrclib', 'Spotify saying "none" must not hide LRCLIB being down');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('both sources saying "none" is remembered', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ status: 404, json: { code: 404 } }));
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl);
        assert.equal(await resolver.get(track()), null);
        const requests = server.requests.length;
        assert.equal(await resolver.get(track()), null);
        assert.equal(server.requests.length, requests, 'the "none" answer is cached for a while');
    } finally {
        await server.close();
        temp.cleanup();
    }
});

test('disabled sources are not asked and nothing is remembered', async () => {
    const temp = makeTempDir();
    const server = await startTestServer(() => ({ json: { syncedLyrics: '[00:00.00]a\n[00:01.00]b' } }));
    try {
        const resolver = resolverFor(temp.dir, server.baseUrl, { spotify: false, netease: false, qq: false, kugou: false, lrclib: false });
        assert.equal(await resolver.get(track()), null);
        assert.equal(server.requests.length, 0);
        const enabledLater = resolverFor(temp.dir, server.baseUrl);
        assert.equal((await enabledLater.get(track()))?.source, 'lrclib');
    } finally {
        await server.close();
        temp.cleanup();
    }
});
