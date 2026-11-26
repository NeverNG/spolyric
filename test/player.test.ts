// test/player.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerClient, trackFromItem } from '../src/spotify/player.js';
import { silentLogger, track } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';

test('a track row becomes a track', () => {
    const parsed = trackFromItem({
        id: '4uLU6hMCjMI75M1A2tKUQC',
        type: 'track',
        name: 'Never Gonna Give You Up',
        duration_ms: 213_000,
        artists: [{ name: 'Rick Astley' }],
        album: { name: 'Whenever You Need Somebody', images: [{ url: 'small', width: 64 }, { url: 'big', width: 640 }] },
    });
    assert.deepEqual(parsed, track({ coverUrl: 'big' }));
});

test('an episode takes its show as the artist', () => {
    const parsed = trackFromItem({
        id: 'episode1',
        type: 'episode',
        name: 'An Episode',
        duration_ms: 1_900_000,
        show: { name: 'A Show', images: [{ url: 'show-cover', width: 300 }] },
    });
    assert.equal(parsed?.kind, 'episode');
    assert.deepEqual(parsed?.artists, ['A Show']);
    assert.equal(parsed?.album, 'A Show');
    assert.equal(parsed?.coverUrl, 'show-cover');
});

test('a track with no id (a local file) still has a name to show', () => {
    const parsed = trackFromItem({ name: 'My Local File', duration_ms: 1000, is_local: true, artists: [{ name: 'Me' }] });
    assert.equal(parsed?.id, 'local:My Local File');
});

test('an item with no name is nothing to show', () => {
    assert.equal(trackFromItem({ id: 'x' }), null);
    assert.equal(trackFromItem(null), null);
});

test('the player client reads the track, its cover and its position', async () => {
    const server = await startTestServer(() => ({
        json: {
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
                album: { name: 'Whenever You Need Somebody', images: [{ url: 'cover', width: 640 }] },
            },
        },
    }));
    try {
        const player = createPlayerClient({
            apiBase: server.baseUrl,
            getToken: async () => 'token',
            log: silentLogger(),
        });
        const playing = await player.getNowPlaying();
        assert.equal(playing.state, 'track');
        if (playing.state !== 'track') return;
        assert.equal(playing.track.title, 'Never Gonna Give You Up');
        assert.equal(playing.deviceName, 'Desktop');
        assert.ok(playing.positionMs >= 42_000, 'the position is not behind what Spotify said');
        assert.ok(playing.positionMs < 42_100, 'the position is not far ahead either');
        assert.equal(server.requests[0]?.url, '/v1/me/player');
        assert.equal(server.requests[0]?.headers.authorization, 'Bearer token');
    } finally {
        await server.close();
    }
});

test('an empty answer means nothing is playing', async () => {
    const server = await startTestServer(() => ({ status: 204 }));
    try {
        const player = createPlayerClient({ apiBase: server.baseUrl, getToken: async () => 'token', log: silentLogger() });
        assert.deepEqual(await player.getNowPlaying(), { state: 'idle', deviceName: null });
    } finally {
        await server.close();
    }
});

test('an ad is told apart from a track', async () => {
    const server = await startTestServer(() => ({ json: { is_playing: true, currently_playing_type: 'ad', device: { name: 'Phone' } } }));
    try {
        const player = createPlayerClient({ apiBase: server.baseUrl, getToken: async () => 'token', log: silentLogger() });
        assert.deepEqual(await player.getNowPlaying(), { state: 'ad', deviceName: 'Phone' });
    } finally {
        await server.close();
    }
});

test('a refused playback state falls back to the narrower endpoint', async () => {
    const server = await startTestServer(request => {
        if (request.url === '/v1/me/player') {
            return { status: 403, json: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } } };
        }
        if (request.url === '/v1/me/player/currently-playing') {
            return {
                json: {
                    is_playing: true,
                    progress_ms: 5000,
                    currently_playing_type: 'track',
                    item: {
                        id: '4uLU6hMCjMI75M1A2tKUQC',
                        type: 'track',
                        name: 'Never Gonna Give You Up',
                        duration_ms: 213_000,
                        artists: [{ name: 'Rick Astley' }],
                        album: { name: 'Whenever', images: [{ url: 'cover', width: 640 }] },
                    },
                },
            };
        }
        return { status: 404, json: { error: 'not found' } };
    });
    try {
        const player = createPlayerClient({ apiBase: server.baseUrl, getToken: async () => 'token', log: silentLogger() });
        const playing = await player.getNowPlaying();
        assert.equal(playing.state, 'track');
        if (playing.state === 'track') {
            assert.equal(playing.track.title, 'Never Gonna Give You Up');
            assert.equal(playing.deviceName, null, 'the narrow endpoint has no device');
        }
        assert.deepEqual(server.requests.map(request => request.url), ['/v1/me/player', '/v1/me/player/currently-playing']);
    } finally {
        await server.close();
    }
});

test('when both endpoints refuse, the reason is in the error', async () => {
    const server = await startTestServer(() => ({
        status: 403,
        json: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } },
    }));
    try {
        const player = createPlayerClient({ apiBase: server.baseUrl, getToken: async () => 'token', log: silentLogger() });
        await assert.rejects(player.getNowPlaying(), (error: unknown) => {
            assert.match(String(error), /Premium required/);
            assert.match(String(error), /PREMIUM_REQUIRED/);
            return true;
        });
    } finally {
        await server.close();
    }
});

test('a 401 renews the token once and asks again with the new one', async () => {
    let calls = 0;
    const server = await startTestServer(() => {
        calls += 1;
        if (calls === 1) return { status: 401, json: { error: { status: 401, message: 'token expired' } } };
        return { json: { is_playing: true, progress_ms: 1000, currently_playing_type: 'track', item: { id: 'x'.repeat(22), name: 'A', type: 'track', duration_ms: 1000 } } };
    });
    try {
        const asked: boolean[] = [];
        const player = createPlayerClient({
            apiBase: server.baseUrl,
            getToken: async options => {
                const forced = options?.force === true;
                asked.push(forced);
                return forced ? 'renewed-token' : 'first-token';
            },
            log: silentLogger(),
        });
        const playing = await player.getNowPlaying();
        assert.equal(playing.state, 'track');
        assert.deepEqual(asked, [false, true]);
        assert.equal(server.requests[1]?.headers.authorization, 'Bearer renewed-token');
    } finally {
        await server.close();
    }
});
