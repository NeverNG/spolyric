// test/localPlayer.test.ts
// The local (SMTC) source: mapping, the smoothing clock, seeks, pauses, and other apps' sessions.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalPlayer } from '../src/media/player.js';
import type { MediaSessionReader, MediaSessionSnapshot } from '../src/media/session.js';
import { ManualClock, silentLogger } from './helpers/fakes.js';

const snapshot = (overrides: Partial<MediaSessionSnapshot> = {}): MediaSessionSnapshot => ({
    app: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
    title: '懷念青春',
    artist: '劉剛',
    album: '劉剛作品集',
    durationMs: 268_000,
    positionMs: 1000,
    isPlaying: true,
    sampledAtMs: 0,
    ...overrides,
});

const readerWith = (initial: MediaSessionSnapshot | null) => {
    let current = initial;
    const reader: MediaSessionReader & { set(next: MediaSessionSnapshot | null): void } = {
        available: true,
        read: () => current,
        close: () => {},
        set(next) {
            current = next;
        },
    };
    return reader;
};

test('a Spotify session becomes a track with a local id', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot());
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    const playing = await player.getNowPlaying();
    assert.equal(playing.state, 'track');
    if (playing.state !== 'track') return;
    assert.equal(playing.track.title, '懷念青春');
    assert.deepEqual(playing.track.artists, ['劉剛']);
    assert.equal(playing.track.durationMs, 268_000);
    assert.equal(playing.track.id, 'local:懷念青春|劉剛');
    assert.equal(playing.isPlaying, true);
    assert.equal(playing.deviceName, '本机 Spotify');
});

test('a Spotify ad is not turned into a track, but keeps its own clock', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ title: '無廣告收聽音樂。', artist: 'Spotify', album: '', durationMs: 29_914, positionMs: 1000 }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    const playing = await player.getNowPlaying();
    assert.equal(playing.state, 'ad');
    if (playing.state !== 'ad') return;
    assert.equal(playing.durationMs, 29_914);
    assert.equal(playing.positionMs, 1000);
});

test('another app in SMTC is not shown', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ app: 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic' }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    assert.deepEqual(await player.getNowPlaying(), { state: 'idle', deviceName: null });
});

test('between samples the position keeps moving with the wall clock', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ positionMs: 10_000 }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    const first = await player.getNowPlaying();
    assert.equal(first.state, 'track');
    if (first.state !== 'track') return;
    assert.equal(Math.round(first.positionMs), 10_000);

    clock.advance(700);
    const second = await player.getNowPlaying();
    if (second.state !== 'track') return;
    assert.ok(second.positionMs > 10_600, `expected to advance, got ${second.positionMs}`);
    assert.ok(second.positionMs < 10_800, `expected no jump, got ${second.positionMs}`);
});

test('a seek jumps the clock at once', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ positionMs: 10_000 }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    await player.getNowPlaying();
    clock.advance(1000);
    reader.set(snapshot({ positionMs: 60_000 }));
    const jumped = await player.getNowPlaying();
    if (jumped.state !== 'track') return;
    assert.ok(Math.abs(jumped.positionMs - 60_000) < 50, `expected a seek to 60s, got ${jumped.positionMs}`);
});

test('a pause holds the position and does not keep counting', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ positionMs: 20_000, isPlaying: false }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    await player.getNowPlaying();
    clock.advance(3000);
    const paused = await player.getNowPlaying();
    if (paused.state !== 'track') return;
    assert.equal(paused.isPlaying, false);
    assert.ok(Math.abs(paused.positionMs - 20_000) < 100, `expected to stay at 20s, got ${paused.positionMs}`);
});

test('a new track starts its own clock', async () => {
    const clock = new ManualClock();
    const reader = readerWith(snapshot({ positionMs: 30_000 }));
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    await player.getNowPlaying();
    clock.advance(2000);
    reader.set(snapshot({ title: 'Another Song', artist: 'Someone', positionMs: 500, durationMs: 200_000 }));
    const next = await player.getNowPlaying();
    if (next.state !== 'track') return;
    assert.equal(next.track.title, 'Another Song');
    assert.ok(Math.abs(next.positionMs - 500) < 100);
});

test('nothing in the session means idle', async () => {
    const clock = new ManualClock();
    const reader = readerWith(null);
    const player = createLocalPlayer({ reader, log: silentLogger(), now: clock.now });
    assert.deepEqual(await player.getNowPlaying(), { state: 'idle', deviceName: null });
});
