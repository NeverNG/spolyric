// test/lyricsOrder.test.ts
// Folia's priority is "preferred source first, then the rest in a fixed order"; the resolver must ask in
// that order and stop at the first confident hit.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLyricsCache, createLyricsResolver } from '../src/spotify/lyrics.js';
import { silentLogger } from './helpers/fakes.js';
import { makeTempDir } from './helpers/temp.js';

const track = {
    id: 'local:duanqiao',
    kind: 'track' as const,
    title: '断桥残雪',
    artists: ['许嵩'],
    album: '许嵩早期单曲集',
    durationMs: 227_160,
    coverUrl: null,
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const fake = (urls: string[]) => async (url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    urls.push(href);
    if (href.includes('client_search_cp')) {
        return json({ data: { song: { list: [{ songmid: 'MID', songname: '断桥残雪', interval: 227, singer: [{ name: '许嵩' }] }] } } });
    }
    if (href.includes('fcg_query_lyric_new')) return json({ lyric: '[00:01.00]qq\n[00:02.00]qq2' });
    if (href.includes('music.163.com/api/search')) {
        return json({ result: { songs: [{ id: 1, name: '断桥残雪', duration: 227160, artists: [{ name: '许嵩' }] }] } });
    }
    if (href.includes('/api/song/lyric')) return json({ lrc: { lyric: '[00:01.00]ne\n[00:02.00]ne2' } });
    return new Response('{}', { status: 404 });
};

const resolverFor = (dir: string, preferred: 'qq' | 'netease') => createLyricsResolver({
    cache: createLyricsCache(dir),
    enabled: { spotify: false, netease: true, qq: true, kugou: false, lrclib: true },
    preferred,
    getToken: async () => 'token',
    neteaseBase: 'https://music.163.com',
    lrclibBase: 'https://lrclib.net',
    spotifyLyricsBase: 'https://spclient.wg.spotify.com',
    fetchImpl: fake([]) as unknown as typeof fetch,
    log: silentLogger(),
});

test('preferring QQ asks QQ first', async () => {
    const temp = makeTempDir();
    try {
        const urls: string[] = [];
        const resolver = createLyricsResolver({
            cache: createLyricsCache(temp.dir),
            enabled: { spotify: false, netease: true, qq: true, kugou: false, lrclib: true },
            preferred: 'qq',
            getToken: async () => 'token',
            neteaseBase: 'https://music.163.com',
            lrclibBase: 'https://lrclib.net',
            spotifyLyricsBase: 'https://spclient.wg.spotify.com',
            fetchImpl: fake(urls) as unknown as typeof fetch,
            log: silentLogger(),
        });
        const result = await resolver.get(track);
        assert.equal(result?.source, 'qq');
        assert.ok(urls[0]?.includes('client_search_cp'), 'the first request is QQ');
    } finally {
        temp.cleanup();
    }
});

test('preferring NetEase asks NetEase first', async () => {
    const temp = makeTempDir();
    try {
        const urls: string[] = [];
        const resolver = createLyricsResolver({
            cache: createLyricsCache(temp.dir),
            enabled: { spotify: false, netease: true, qq: true, kugou: false, lrclib: true },
            preferred: 'netease',
            getToken: async () => 'token',
            neteaseBase: 'https://music.163.com',
            lrclibBase: 'https://lrclib.net',
            spotifyLyricsBase: 'https://spclient.wg.spotify.com',
            fetchImpl: fake(urls) as unknown as typeof fetch,
            log: silentLogger(),
        });
        const result = await resolver.get(track);
        assert.equal(result?.source, 'netease');
        assert.ok(urls[0]?.includes('music.163.com/api/search'), 'the first request is NetEase');
    } finally {
        temp.cleanup();
    }
});
