// test/netease.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { fromNetease, pickNeteaseSong } from '../src/lyrics/netease.js';
import { silentLogger } from './helpers/fakes.js';

const track = {
    id: 'local:duanqiao',
    kind: 'track' as const,
    title: '断桥残雪',
    artists: ['许嵩'],
    album: '许嵩单曲集',
    durationMs: 227160,
    coverUrl: null,
};

const songs = [
    { id: 27646693, name: '断桥残雪', duration: 227160, artists: [{ name: '许嵩' }] },
    { id: 1, name: '断桥残雪', duration: 248787, artists: [{ name: 'Evans' }] },
];

test('the matching NetEase song is picked by title, artist and duration', () => {
    assert.equal(pickNeteaseSong(songs, track), 27646693);
});

test('a same-title song by another artist and length is not picked', () => {
    assert.equal(pickNeteaseSong([songs[1]!], track), null);
});

test('a NetEase lyric is fetched from the picked song', async () => {
    const seen: string[] = [];
    const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
        const href = String(url);
        seen.push(href);
        const body = href.includes('/api/search')
            ? { result: { songs } }
            : { lrc: { lyric: '[00:01.00]first\n[00:02.00]second' } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const answer = await fromNetease({
        track,
        base: 'https://music.163.com',
        fetchImpl: fakeFetch as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, '[00:01.00]first\n[00:02.00]second');
    assert.ok(seen.some(url => url.includes('/api/song/lyric?id=27646693')));
});

test('a lyric request that fails leaves no lyric', async () => {
    const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
        if (String(url).includes('/api/search')) {
            return new Response(JSON.stringify({ result: { songs } }), { status: 200 });
        }
        return new Response('nope', { status: 500 });
    };
    const answer = await fromNetease({
        track,
        base: 'https://music.163.com',
        fetchImpl: fakeFetch as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, null);
    assert.equal(answer.definitive, true);
});
