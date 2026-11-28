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

test('the Spotify search finds the id for a local track', async () => {
    let seen = '';
    const id = await searchSpotifyTrack({
        track,
        getToken: async () => 'token',
        fetchImpl: (async (url: string | URL | Request) => {
            seen = decodeURIComponent(String(url));
            return new Response(JSON.stringify({
                tracks: { items: [{ id: 'spotify-id', name: '白桦林', artists: [{ name: '朴树' }], duration_ms: 227_000 }] },
            }), { status: 200 });
        }) as unknown as typeof fetch,
    });
    assert.equal(id, 'spotify-id');
    assert.ok(seen.includes('白桦林'), 'the query uses simplified characters');
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
