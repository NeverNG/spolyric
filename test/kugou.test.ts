// test/kugou.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { fromKugou } from '../src/lyrics/kugou.js';
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

const lrc = '[00:01.00]a\n[00:02.00]b';

const fake = () => async (url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    let body: unknown = {};
    if (href.includes('song_search_v2')) {
        body = { data: { lists: [{ FileHash: 'HASH', SongName: '断桥残雪', SingerName: '许嵩', Duration: 227 }] } };
    } else if (href.includes('krcs.kugou.com')) {
        body = { candidates: [{ id: 123, accesskey: 'KEY', song: '断桥残雪', singer: '许嵩', duration: 227160 }] };
    } else if (href.includes('lyrics.kugou.com/download')) {
        body = { content: Buffer.from(lrc, 'utf8').toString('base64') };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('Kugou search, candidate and download become LRC', async () => {
    const answer = await fromKugou({
        track,
        fetchImpl: fake() as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, lrc);
});

test('a missing candidate is no lyric', async () => {
    const answer = await fromKugou({
        track,
        fetchImpl: (async () => new Response(JSON.stringify({ data: { lists: [] } }), { status: 200 })) as unknown as typeof fetch,
        timeoutMs: 3000,
        log: silentLogger(),
    });
    assert.equal(answer.lrc, null);
});
