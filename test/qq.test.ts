// test/qq.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { fromQq } from '../src/lyrics/qq.js';
import { silentLogger } from './helpers/fakes.js';

const track = {
    id: 'local:duanqiao',
    kind: 'track' as const,
    title: '断桥残雪',
    artists: ['许嵩'],
    album: '许嵩早期单曲集',
    durationMs: 227_160,
    coverUrl: null,
};

const fake = (search: unknown, lyric: unknown) => async (url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    const body = href.includes('/lyric/') ? lyric : search;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('QQ search and lyric become LRC', async () => {
    const answer = await fromQq({
        track,
        fetchImpl: fake(
            { data: { song: { list: [{ songmid: 'MID', songname: '断桥残雪', interval: 227, singer: [{ name: '许嵩' }] }] } } },
            { lyric: '[00:01.00]a\n[00:02.00]b' },
        ) as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, '[00:01.00]a\n[00:02.00]b');
});

test('QQ HTML entities in the lyric are decoded', async () => {
    const answer = await fromQq({
        track,
        fetchImpl: fake(
            { data: { song: { list: [{ songmid: 'MID', songname: '断桥残雪', interval: 227, singer: [{ name: '许嵩' }] }] } } },
            { lyric: '[00&#58;01.00]a\n[00&#58;02.00]b' },
        ) as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, '[00:01.00]a\n[00:02.00]b');
});

test('a same-title QQ song by another singer and length is not used', async () => {
    const answer = await fromQq({
        track,
        fetchImpl: fake(
            { data: { song: { list: [{ songmid: 'MID', songname: '断桥残雪', interval: 120, singer: [{ name: 'Someone' }] }] } } },
            { lyric: '[00:01.00]a\n[00:02.00]b' },
        ) as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, null);
});
