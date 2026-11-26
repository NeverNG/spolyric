// test/engine.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncEngine, type SyncEngine } from '../src/sync/engine.js';
import type { CoverResolver, CoverResult } from '../src/cover/resolver.js';
import { ManualClock, createFakeLyrics, createFakePlayer, createFakeStage, playingAt, silentLogger, track } from './helpers/fakes.js';

const LRC = '[00:00.00]first\n[00:01.00]second';

type Harness = {
    clock: ManualClock;
    stage: ReturnType<typeof createFakeStage>;
    player: ReturnType<typeof createFakePlayer>;
    lyrics: ReturnType<typeof createFakeLyrics>;
    engine: SyncEngine;
};

const setup = (overrides: {
    dryRun?: boolean;
    clockIntervalMs?: number;
    emptyGraceMs?: number;
    control?: (action: 'play' | 'pause' | 'seek', positionMs?: number) => Promise<boolean>;
    withStageStatus?: boolean;
    cover?: CoverResolver;
    coverFromSpotify?: (track: import('../src/spotify/types.js').NowPlayingTrack) => Promise<{ bytes: Uint8Array; mime: string } | null>;
} = {}): Harness & { controlCalls: { action: string; positionMs: number }[] } => {
    const clock = new ManualClock();
    const stage = createFakeStage();
    const player = createFakePlayer(playingAt(clock.value, 0));
    const lyrics = createFakeLyrics();
    const controlCalls: { action: string; positionMs: number }[] = [];
    const control = overrides.control ?? ((action, positionMs) => {
        controlCalls.push({ action, positionMs: positionMs ?? 0 });
        return Promise.resolve(true);
    });
    const engine = createSyncEngine({
        player,
        lyrics,
        stage,
        log: silentLogger(),
        now: clock.now,
        clockIntervalMs: overrides.clockIntervalMs ?? 4000,
        emptyGraceMs: overrides.emptyGraceMs ?? 20_000,
        seekThresholdMs: 1500,
        driftThresholdMs: 900,
        dryRun: overrides.dryRun,
        control,
        stagePlayerStatus: overrides.withStageStatus === false ? undefined : () => Promise.resolve(stage.playerStatusValue),
        cover: overrides.cover,
        coverFromSpotify: overrides.coverFromSpotify,
    });
    return { clock, stage, player, lyrics, engine, controlCalls };
};

test('a track goes to the stage with its title, artist, cover and progress', async () => {
    const { engine, stage } = setup();
    await engine.tick();
    assert.equal(stage.sessions.length, 1);
    const session = stage.sessions[0];
    assert.equal(session?.title, 'Never Gonna Give You Up');
    assert.equal(session?.artist, 'Rick Astley');
    assert.equal(session?.album, 'Whenever You Need Somebody');
    assert.equal(session?.durationMs, 213_000);
    assert.equal(session?.coverUrl, 'https://i.scdn.co/image/cover');
    assert.equal(session?.paused, false);
    assert.equal(session?.positionMs, 0);
    assert.equal(session?.lyricSource, undefined);
    assert.equal(engine.isFollowing(), true);
});

test('the words arrive after the track and are sent again with it', async () => {
    const { engine, stage, player, lyrics, clock } = setup();
    let release: () => void = () => {};
    lyrics.gate = new Promise<void>(resolve => {
        release = resolve;
    });
    lyrics.resolveWith = { lrc: LRC, source: 'lrclib' };
    await engine.tick();
    assert.equal(stage.sessions.length, 1, 'the track shows before the words are ready');
    assert.equal(stage.sessions[0]?.lyricSource, undefined);
    release();
    // The lookup settles in a microtask of its own; the next poll (1.5 s later in the runner) sees it.
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(1500);
    player.set(playingAt(clock.value, 1500));
    await engine.tick();
    assert.equal(stage.sessions.length, 2);
    assert.equal(stage.sessions[1]?.lyricSource?.lrcContent, LRC);
    assert.equal(stage.sessions[1]?.lyricSource?.formatHint, 'lrc');
    assert.equal(stage.sessions[1]?.positionMs, 1500);
    assert.equal(engine.snapshot().lyricsSource, 'lrclib');
});

test('lyrics already on disk ride along with the first push', async () => {
    const { engine, stage, lyrics } = setup();
    lyrics.cached = { lrc: LRC, source: 'spotify' };
    await engine.tick();
    assert.equal(stage.sessions.length, 1);
    assert.equal(stage.sessions[0]?.lyricSource?.lrcContent, LRC);
    assert.equal(lyrics.lookups, 0);
});

test('a pause on Spotify moves Folia\'s clock at once', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    clock.advance(2000);
    player.set(playingAt(clock.value, 2000, { isPlaying: false }));
    await engine.tick();
    assert.equal(stage.clocks.length, 1);
    assert.equal(stage.clocks[0]?.paused, true);
    assert.equal(stage.clocks[0]?.positionMs, 2000);
});

test('a jump in position is a seek and moves the clock at once', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    clock.advance(1000);
    player.set(playingAt(clock.value, 60_000));
    await engine.tick();
    assert.equal(stage.clocks.length, 1);
    assert.equal(stage.clocks[0]?.positionMs, 60_000);
    assert.equal(stage.clocks[0]?.paused, false, 'a drift correction repeats the state Folia should show');
});

test('a track that stays in step costs no clock pushes', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    for (let step = 1; step <= 4; step += 1) {
        clock.advance(2000);
        player.set(playingAt(clock.value, 2000 * step));
        await engine.tick();
    }
    assert.equal(stage.sessions.length, 1);
    assert.equal(stage.clocks.length, 0);
});

test('a drift worth correcting is corrected, and a small one is not', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    // 500 ms behind what the clock says, after the interval: not worth a request.
    clock.advance(5000);
    player.set(playingAt(clock.value, 4500));
    await engine.tick();
    assert.equal(stage.clocks.length, 0);
    // 1400 ms behind: worth one.
    clock.advance(1000);
    player.set(playingAt(clock.value, 4600));
    await engine.tick();
    assert.equal(stage.clocks.length, 1);
    assert.equal(stage.clocks[0]?.positionMs, 4600);
    assert.equal(stage.clocks[0]?.sessionUpdatedAt, 1_700_000_000_001, 'the clock names the session it belongs to');
});

test('another track is a new session', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    clock.advance(1000);
    player.set(playingAt(clock.value, 0, { track: track({ id: '7qiZfU4dY1lWllzX7mPBI3', title: 'Shape of You' }) }));
    await engine.tick();
    assert.equal(stage.sessions.length, 2);
    assert.equal(stage.sessions[1]?.title, 'Shape of You');
});

test('an ad clears the stage at once, without waiting out the grace', async () => {
    const { engine, stage, player } = setup();
    await engine.tick();
    player.set({ state: 'ad', deviceName: 'Phone' });
    await engine.tick();
    assert.equal(stage.clears, 1);
    assert.equal(engine.isFollowing(), false);
});

test('nothing playing clears the stage after the grace, not before', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    player.set({ state: 'idle', deviceName: null });
    await engine.tick();
    assert.equal(stage.clears, 0);
    clock.advance(21_000);
    await engine.tick();
    assert.equal(stage.clears, 1);
});

test('a stage showing another source is left alone', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    stage.activeEntryKind = 'media';
    stage.activeUpdatedAt = null;
    player.set({ state: 'idle', deviceName: null });
    await engine.tick();
    clock.advance(30_000);
    await engine.tick();
    assert.equal(stage.clears, 0);
    assert.equal(engine.isFollowing(), false);
});

test('a stage that lost the session gets it again', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    stage.failClockWith = 'STAGE_LYRICS_SESSION_CHANGED';
    clock.advance(1000);
    player.set(playingAt(clock.value, 1000, { isPlaying: false }));
    await engine.tick();
    assert.equal(stage.sessions.length, 2, 'the session was pushed again');
    assert.equal(stage.sessions[1]?.paused, true);
});

test('a lyrics push that fails is tried again, not lost', async () => {
    const { engine, stage, player, lyrics, clock } = setup();
    let release: () => void = () => {};
    lyrics.gate = new Promise<void>(resolve => {
        release = resolve;
    });
    lyrics.resolveWith = { lrc: LRC, source: 'lrclib' };
    await engine.tick();
    release();
    await Promise.resolve();
    await Promise.resolve();
    const push = stage.pushLyrics.bind(stage);
    let failures = 1;
    stage.pushLyrics = async request => {
        if (failures > 0) {
            failures -= 1;
            throw new Error('Folia is busy');
        }
        return push(request);
    };
    clock.advance(1500);
    player.set(playingAt(clock.value, 1500));
    await engine.tick();
    assert.equal(stage.sessions.length, 1, 'the words were not dropped, only not delivered yet');
    clock.advance(1500);
    player.set(playingAt(clock.value, 3000));
    await engine.tick();
    assert.equal(stage.sessions.length, 2);
    assert.equal(stage.sessions[1]?.lyricSource?.lrcContent, LRC);
});

test('a clear that fails is tried again while the old track is still on the stage', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    const clear = stage.clear.bind(stage);
    let failures = 1;
    stage.clear = async () => {
        if (failures > 0) {
            failures -= 1;
            throw new Error('Folia is busy');
        }
        await clear();
    };
    player.set({ state: 'idle', deviceName: null });
    await engine.tick();
    clock.advance(21_000);
    await engine.tick();
    assert.equal(stage.clears, 0);
    assert.equal(engine.isFollowing(), true, 'the session is kept until the stage is really clear');
    clock.advance(2000);
    await engine.tick();
    assert.equal(stage.clears, 1);
    assert.equal(engine.isFollowing(), false);
});

test('another source on the stage is not fought over when the clock is refused', async () => {
    const { engine, stage, player, clock } = setup();
    await engine.tick();
    // Somebody else pushed their own lyrics session.
    stage.activeEntryKind = 'lyrics';
    stage.activeUpdatedAt = 1;
    stage.activeTitle = 'Another Song';
    stage.failClockWith = 'STAGE_LYRICS_SESSION_CHANGED';
    clock.advance(1000);
    player.set(playingAt(clock.value, 1000, { isPlaying: false }));
    await engine.tick();
    assert.equal(stage.sessions.length, 1, 'no push over another source');
    assert.equal(engine.isFollowing(), false);
    // The next tick must not take the stage back either: that would be the fight.
    clock.advance(1500);
    player.set(playingAt(clock.value, 2500, { isPlaying: false }));
    await engine.tick();
    assert.equal(stage.sessions.length, 1);
    assert.equal(engine.isFollowing(), false);
});

test('a pause pressed on Folia\'s stage bar pauses Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PLAYING', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PLAYING', 3200); await engine.tick();
    assert.deepEqual(controlCalls, []);
    // The listener presses pause.
    clock.advance(1600); player.set(playingAt(clock.value, 4800)); sample('PAUSED', 4800); await engine.tick();
    assert.deepEqual(controlCalls, [{ action: 'pause', positionMs: 0 }], 'a press in time is acted on at once');
    assert.equal(stage.clocks.length, 0, 'the clock is not pushed over the listener\'s pause');
});

test('a play pressed on Folia\'s stage bar resumes Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    // Spotify pauses; the engine pushes a paused clock, then the stage shows paused.
    clock.advance(1600); player.set(playingAt(clock.value, 1600, { isPlaying: false })); sample('PLAYING', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600, { isPlaying: false })); sample('PAUSED', 1600); await engine.tick();
    assert.ok(stage.clocks.length >= 1, 'the pause was pushed to the stage');
    assert.equal(stage.clocks.at(-1)?.paused, true);
    // The listener presses play on the stage bar.
    clock.advance(1600); player.set(playingAt(clock.value, 1600, { isPlaying: false })); sample('PLAYING', 3200); await engine.tick();
    assert.deepEqual(controlCalls, [{ action: 'play', positionMs: 0 }]);
});

test('a seek dragged on Folia\'s stage bar seeks Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PLAYING', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PLAYING', 60_000); await engine.tick();
    assert.deepEqual(controlCalls, [{ action: 'seek', positionMs: 60_000 }]);
});

test('one stale PAUSED sample does not pause Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PLAYING', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PAUSED', 60_000); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 4800)); sample('PLAYING', 4800); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 6400)); sample('PLAYING', 6400); await engine.tick();
    assert.deepEqual(controlCalls, []);
});

test('a stage state that merely disagrees with Spotify is healed towards Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    // The stage has been sitting paused while Spotify plays; there is no change to react to.
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PAUSED', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PAUSED', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 4800)); sample('PAUSED', 1600); await engine.tick();
    assert.deepEqual(controlCalls, [], 'a disagreement is not a command');
    assert.equal(stage.clocks.at(-1)?.paused, false, 'Spotify\'s own state is pushed instead');
});

test('a stale stage snapshot is not acted on', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    await engine.tick();
    clock.advance(1600);
    player.set(playingAt(clock.value, 1600));
    stage.playerStatusValue = {
        playerState: 'PAUSED',
        positionMs: 1600,
        durationMs: 213_000,
        sampledAtMs: clock.value - 10_000,
        canSeek: true,
    };
    await engine.tick();
    assert.deepEqual(controlCalls, []);
});

test('without a stage status the engine never sends commands', async () => {
    const { engine, stage, player, clock, controlCalls } = setup({ withStageStatus: false });
    await engine.tick();
    clock.advance(1600);
    player.set(playingAt(clock.value, 1600));
    stage.playerStatusValue = { playerState: 'PAUSED', positionMs: 1600, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    await engine.tick();
    assert.deepEqual(controlCalls, []);
});

test('a dry run does not send commands', async () => {
    const { engine, stage, clock, controlCalls } = setup({ dryRun: true });
    await engine.tick();
    clock.advance(1600);
    stage.playerStatusValue = { playerState: 'PAUSED', positionMs: 0, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    await engine.tick();
    assert.deepEqual(controlCalls, []);
});

test('a cover found for a track without one is pushed onto the stage', async () => {
    let resolveCover: (value: CoverResult | null) => void = () => {};
    const coverPromise = new Promise<CoverResult | null>(resolve => {
        resolveCover = resolve;
    });
    const { engine, stage, player, clock } = setup({
        cover: {
            get: () => coverPromise,
            store: () => Promise.resolve(null),
            close: () => {},
        },
    });
    const localTrack = track({ id: 'local:one', coverUrl: null });
    player.set(playingAt(clock.value, 0, { track: localTrack }));
    await engine.tick();
    assert.equal(stage.sessions[0]?.coverUrl ?? null, null, 'the first push has no cover yet');
    resolveCover({ url: 'http://127.0.0.1:9/cover/abc.jpg', source: 'deezer' });
    await new Promise(resolve => setTimeout(resolve, 0));
    clock.advance(1600);
    player.set(playingAt(clock.value, 1600, { track: localTrack }));
    await engine.tick();
    assert.equal(stage.sessions.at(-1)?.coverUrl, 'http://127.0.0.1:9/cover/abc.jpg');
});

test('the Spotify thumbnail is stored before any catalogue is asked', async () => {
    let catalogAsked = 0;
    let stored: Uint8Array | null = null;
    const cover = {
        get: () => {
            catalogAsked += 1;
            return Promise.resolve(null);
        },
        store: (_track: unknown, bytes: Uint8Array) => {
            stored = bytes;
            return Promise.resolve({ url: 'http://127.0.0.1:9/cover/spotify.jpg', source: 'spotify' as const });
        },
        close: () => {},
    };
    const { engine, stage, player, clock } = setup({
        cover,
        coverFromSpotify: () => Promise.resolve({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' }),
    });
    const localTrack = track({ id: 'local:thumb', coverUrl: null });
    player.set(playingAt(clock.value, 0, { track: localTrack }));
    await engine.tick();
    await new Promise(resolve => setTimeout(resolve, 0));
    clock.advance(1600);
    player.set(playingAt(clock.value, 1600, { track: localTrack }));
    await engine.tick();
    assert.deepEqual(stored, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(catalogAsked, 0, 'the exact thumbnail means no catalogue lookup');
    assert.equal(stage.sessions.at(-1)?.coverUrl, 'http://127.0.0.1:9/cover/spotify.jpg');
});

test('a track that already has a cover is not looked up', async () => {
    let asked = 0;
    const { engine, stage } = setup({
        cover: {
            get: () => {
                asked += 1;
                return Promise.resolve(null);
            },
            store: () => Promise.resolve(null),
            close: () => {},
        },
    });
    await engine.tick();
    assert.equal(asked, 0);
    assert.equal(stage.sessions.length, 1);
});

test('a drift correction never resumes a stage the listener paused', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PLAYING', 1600); await engine.tick();
    // The listener pauses on the stage bar; the command is accepted.
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PAUSED', 3200); await engine.tick();
    assert.deepEqual(controlCalls, [{ action: 'pause', positionMs: 0 }]);
    // Spotify has not reported the pause yet; a later drift correction must still say "paused".
    clock.advance(4200); player.set(playingAt(clock.value, 7400)); sample('PAUSED', 3200); await engine.tick();
    assert.equal(stage.clocks.at(-1)?.paused, true, 'the clock carries the state Folia should keep');
});

test('the stage pausing at the end of a track does not pause Spotify', async () => {
    const { engine, stage, player, clock, controlCalls } = setup();
    const sample = (state: 'PLAYING' | 'PAUSED', positionMs: number) => {
        stage.playerStatusValue = { playerState: state, positionMs, durationMs: 213_000, sampledAtMs: clock.value, canSeek: true };
    };
    await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 1600)); sample('PLAYING', 1600); await engine.tick();
    clock.advance(1600); player.set(playingAt(clock.value, 3200)); sample('PLAYING', 3200); await engine.tick();
    // Folia clamps at the pushed duration and pauses by itself; Spotify is still playing.
    clock.advance(1600); player.set(playingAt(clock.value, 4800)); sample('PAUSED', 213_000); await engine.tick();
    assert.deepEqual(controlCalls, [], 'the end of a track is not a pause press');
});

test('a stage that is down is logged, not thrown', async () => {
    const { engine, stage } = setup();
    stage.pushLyrics = async () => {
        throw new Error('Folia is not listening');
    };
    await engine.tick();
    assert.equal(stage.sessions.length, 0);
    assert.equal(engine.isFollowing(), false);
});

test('Spotify being unreachable is logged, not thrown', async () => {
    const { engine, player } = setup();
    player.failing = new Error('no route to host');
    await engine.tick();
    assert.equal(engine.isFollowing(), false);
});

test('a dry run touches nothing', async () => {
    const { engine, stage, player, clock } = setup({ dryRun: true });
    await engine.tick();
    clock.advance(2000);
    player.set(playingAt(clock.value, 2000, { isPlaying: false }));
    await engine.tick();
    player.set({ state: 'idle', deviceName: null });
    clock.advance(30_000);
    await engine.tick();
    assert.equal(stage.calls.length, 0);
});
