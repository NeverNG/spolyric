// test/search.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { searchSpotifyTrack } from '../src/spotify/search.js';

const track = {
    id: 'local:白樺林|朴樹',
    kind: 'track' as const,
    title: '白樺林',
    artists: ['朴樹'],
    album: '',
    durationMs: 227_000,
    coverUrl: null,
};

test('the Spotify search asks with the original title before the simplified one', async () => {
    let seen = '';
    const id = await searchSpotifyTrack({
        track,
        getToken: async () => 'token',
        fetchImpl: (async (url: string | URL | Request) => {
            seen = decodeURIComponent(String(url));
            return new Response(JSON.stringify({
                tracks: { items: [{ id: 'spotify-id', name: '白樺林', artists: [{ name: '朴樹' }], duration_ms: 227_000 }] },
            }), { status: 200 });
        }) as unknown as typeof fetch,
    });
    assert.equal(id, 'spotify-id');
    assert.ok(seen.includes('白樺林'), 'the original (traditional) title is asked first');
});

test('a search with the original title that finds nothing falls back to simplified', async () => {
    const queries: string[] = [];
    const id = await searchSpotifyTrack({
        track,
        getToken: async () => 'token',
        fetchImpl: (async (url: string | URL | Request) => {
            const query = decodeURIComponent(String(url));
            queries.push(query);
            const items = queries.length === 1
                ? []
                : [{ id: 'spotify-id', name: '白桦林', artists: [{ name: '朴树' }], duration_ms: 227_000 }];
            return new Response(JSON.stringify({ tracks: { items } }), { status: 200 });
        }) as unknown as typeof fetch,
    });
    assert.equal(id, 'spotify-id');
    assert.ok(queries[0]?.includes('白樺林'), 'the original title is tried first');
    assert.ok(queries[1]?.includes('白桦林'), 'the simplified title is the fallback');
});

test('a search hit by another artist is not accepted', async () => {
    const id = await searchSpotifyTrack({
        track,
        getToken: async () => 'token',
        fetchImpl: (async () => new Response(JSON.stringify({
            tracks: { items: [{ id: 'wrong', name: '白桦林', artists: [{ name: 'Someone Else' }], duration_ms: 250_000 }] },
        }), { status: 200 })) as unknown as typeof fetch,
    });
    assert.equal(id, null);
});
