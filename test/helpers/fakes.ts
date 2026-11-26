// test/helpers/fakes.ts
// Stand-ins for the three things the engine talks to, plus a manual clock.

import { StageApiError, type StageClient, type StageClockRequest, type StageLyricsRequest, type StagePlayerStatus, type StageStatus } from '../../src/folia/stage.js';
import type { Logger } from '../../src/log.js';
import type { LyricsResolver, LyricsResult } from '../../src/spotify/lyrics.js';
import type { PlayerClient } from '../../src/spotify/player.js';
import type { NowPlaying, NowPlayingTrack } from '../../src/spotify/types.js';

export const silentLogger = (): Logger => ({
    verbose: false,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
});

export class ManualClock {
    value = 1_000_000;

    now = (): number => this.value;

    advance(milliseconds: number): void {
        this.value += milliseconds;
    }
}

export type RecordedCall =
    | { kind: 'session'; request: StageLyricsRequest; sessionUpdatedAt: number }
    | { kind: 'clock'; request: StageClockRequest }
    | { kind: 'clear' }
    | { kind: 'status' };

export type FakeStage = StageClient & {
    calls: RecordedCall[];
    sessions: StageLyricsRequest[];
    clocks: StageClockRequest[];
    clears: number;
    /** The session id the fake reports to `status()`, so "is it ours" can be tested. */
    activeUpdatedAt: number | null;
    /** The title the fake reports on its session; null leaves it out, as an older Folia would. */
    activeTitle: string | null;
    activeEntryKind: 'lyrics' | 'media' | null;
    /** What `/stage/player/status` answers; null makes the call fail. */
    playerStatusValue: StagePlayerStatus | null;
    failClockWith?: string;
    statusThrows?: boolean;
};

export function createFakeStage(): FakeStage {
    let sessionCounter = 0;
    const stage: FakeStage = {
        baseUrl: 'http://127.0.0.1:32107',
        calls: [],
        sessions: [],
        clocks: [],
        clears: 0,
        activeUpdatedAt: null,
        activeTitle: null,
        activeEntryKind: null,
        playerStatusValue: null,
        async health(): Promise<StageStatus> {
            return { enabled: true, modeEnabled: true, source: 'stage-api', activeEntryKind: stage.activeEntryKind, lyricsSession: stage.activeUpdatedAt === null ? null : { updatedAt: stage.activeUpdatedAt } };
        },
        async status(): Promise<StageStatus> {
            stage.calls.push({ kind: 'status' });
            if (stage.statusThrows) throw new Error('status failed');
            return {
                enabled: true,
                modeEnabled: true,
                source: 'stage-api',
                activeEntryKind: stage.activeEntryKind,
                lyricsSession: stage.activeUpdatedAt === null
                    ? null
                    : {
                        updatedAt: stage.activeUpdatedAt,
                        ...(stage.activeTitle === null ? {} : { title: stage.activeTitle }),
                    },
            };
        },
        async playerStatus() {
            return stage.playerStatusValue;
        },
        async pushLyrics(request) {
            sessionCounter += 1;
            const sessionUpdatedAt = 1_700_000_000_000 + sessionCounter;
            stage.calls.push({ kind: 'session', request, sessionUpdatedAt });
            stage.sessions.push(request);
            stage.activeUpdatedAt = sessionUpdatedAt;
            stage.activeEntryKind = 'lyrics';
            return { sessionUpdatedAt };
        },
        async pushClock(request) {
            if (stage.failClockWith) {
                const code = stage.failClockWith;
                stage.failClockWith = undefined;
                throw new StageApiError('/stage/lyrics/clock', 409, code, 'the stage refused the clock', null);
            }
            stage.calls.push({ kind: 'clock', request });
            stage.clocks.push(request);
            return { sessionUpdatedAt: stage.activeUpdatedAt ?? 1 };
        },
        async clear() {
            stage.clears += 1;
            stage.activeUpdatedAt = null;
            stage.activeEntryKind = null;
            stage.calls.push({ kind: 'clear' });
        },
    };
    return stage;
}

export type FakePlayer = PlayerClient & {
    snapshot: NowPlaying;
    set(snapshot: NowPlaying): void;
    failing?: Error;
};

export function createFakePlayer(initial: NowPlaying): FakePlayer {
    const player: FakePlayer = {
        snapshot: initial,
        set(snapshot) {
            player.snapshot = snapshot;
        },
        async getNowPlaying() {
            if (player.failing) throw player.failing;
            return player.snapshot;
        },
    };
    return player;
}

export type FakeLyrics = LyricsResolver & {
    cached: LyricsResult | null;
    resolveWith: LyricsResult | null;
    lookups: number;
    /** When set, `get` waits for this promise before answering. */
    gate?: Promise<void>;
};

export function createFakeLyrics(): FakeLyrics {
    const fake: FakeLyrics = {
        cached: null,
        resolveWith: null,
        lookups: 0,
        peek: () => fake.cached,
        async get() {
            fake.lookups += 1;
            if (fake.gate) await fake.gate;
            return fake.resolveWith;
        },
    };
    return fake;
}

export const track = (overrides: Partial<NowPlayingTrack> = {}): NowPlayingTrack => ({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    kind: 'track',
    title: 'Never Gonna Give You Up',
    artists: ['Rick Astley'],
    album: 'Whenever You Need Somebody',
    durationMs: 213_000,
    coverUrl: 'https://i.scdn.co/image/cover',
    ...overrides,
});

export const playingAt = (at: number, positionMs: number, overrides: Partial<{ isPlaying: boolean; track: NowPlayingTrack }> = {}): NowPlaying => ({
    state: 'track',
    track: overrides.track ?? track(),
    isPlaying: overrides.isPlaying ?? true,
    positionMs,
    sampledAtMs: at,
    deviceName: 'Desktop',
});
