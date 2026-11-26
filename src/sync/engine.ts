// src/sync/engine.ts
// The one place that decides what Folia is told: which track, where the clock is, and when to let go.
// Every stage request goes through `tick()`, so one tick is one serialized step and a test can drive it by hand.

import type { StageClient, StagePlayerStatus, StageStatus } from '../folia/stage.js';
import { StageApiError } from '../folia/stage.js';
import type { CoverResolver, CoverResult } from '../cover/resolver.js';
import { shiftLrc } from '../lyrics/offset.js';
import type { Logger } from '../log.js';
import { SpotifyAuthError } from '../spotify/auth.js';
import type { LyricsResolver, LyricsResult, LyricsSource } from '../spotify/lyrics.js';
import type { PlayerClient } from '../spotify/player.js';
import type { NowPlaying, NowPlayingTrack } from '../spotify/types.js';

export type SyncEngineOptions = {
    player: PlayerClient;
    lyrics: LyricsResolver;
    stage: StageClient;
    log: Logger;
    now?: () => number;
    clockIntervalMs: number;
    emptyGraceMs: number;
    seekThresholdMs: number;
    driftThresholdMs: number;
    /** Logs what would be pushed instead of talking to Folia. */
    dryRun?: boolean;
    /** Transport commands for the source that is playing (SMTC on Windows). */
    control?: (action: 'play' | 'pause' | 'seek', positionMs?: number) => Promise<boolean>;
    /** Folia's own stage player state, to hear a play/pause/seek on its stage bar. */
    stagePlayerStatus?: () => Promise<StagePlayerStatus | null>;
    /** Cover lookup for sources that do not carry one (the local SMTC source). */
    cover?: CoverResolver;
    /** Shifts every lyric timestamp by this many milliseconds (positive = later). */
    lyricsOffsetMs?: number;
};

export type EngineSnapshot = {
    track: NowPlayingTrack | null;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    sessionUpdatedAt: number | null;
    lyricsSource: LyricsSource | null;
    updatedAtMs: number | null;
};

type PlayingTrack = Extract<NowPlaying, { state: 'track' }>;

type Session = {
    track: NowPlayingTrack;
    sessionUpdatedAt: number | null;
    lyrics: LyricsResult | null;
    /** The position Folia was told, and when it was true. */
    anchorPositionMs: number;
    anchorAtMs: number;
    paused: boolean;
    lastClockAtMs: number;
};

/** A lyrics lookup that may still be running: `settled` is set when it is done, `value` is its answer. */
type PendingLyrics = {
    trackKey: string;
    settled: boolean;
    value: LyricsResult | null;
};

/** A cover lookup that may still be running. */
type PendingCover = {
    trackKey: string;
    settled: boolean;
    value: CoverResult | null;
};

const trackKeyOf = (track: NowPlayingTrack): string => `${track.kind}:${track.id}`;

const positionAt = (session: Session, at: number): number => {
    const raw = session.paused ? session.anchorPositionMs : session.anchorPositionMs + Math.max(0, at - session.anchorAtMs);
    const duration = session.track.durationMs;
    return duration > 0 ? Math.min(raw, duration) : raw;
};

export type SyncEngine = {
    /** One step: ask Spotify, then push what changed. Stage and Spotify failures are logged, never thrown. */
    tick(): Promise<void>;
    snapshot(): EngineSnapshot;
    /** Forgets the session without touching Folia (used when the Stage connection was replaced). */
    forget(): void;
    /** True while a track is on the stage. */
    isFollowing(): boolean;
};

export function createSyncEngine({
    player,
    lyrics,
    stage,
    log,
    now = Date.now,
    clockIntervalMs,
    emptyGraceMs,
    seekThresholdMs,
    driftThresholdMs,
    dryRun = false,
    control,
    stagePlayerStatus,
    cover,
    lyricsOffsetMs = 0,
}: SyncEngineOptions): SyncEngine {
    let session: Session | null = null;
    let emptySince: number | null = null;
    let pendingLyrics: PendingLyrics | null = null;
    let pendingCover: PendingCover | null = null;
    /** A Folia seek at least this far from what we pushed is the listener dragging the stage bar. */
    const STAGE_SEEK_MS = 2500;
    /** Folia publishes its player snapshot about once a second; asking more often gains nothing. */
    const TRANSPORT_POLL_MS = 300;
    /** After we tell Folia where the clock is, or a control command, give the source time to move. */
    const TRANSPORT_IGNORE_MS = 700;
    const STAGE_STATUS_MAX_AGE_MS = 4000;
    let lastTransportAt = 0;
    let ignoreTransportUntil = 0;
    let suppressPushUntil = 0;
    let lastSent: { key: string; at: number } | null = null;
    /** The last stage state seen, so a change can be told from a snapshot that is merely stale. */
    let lastStageState: 'PLAYING' | 'PAUSED' | null = null;
    /** A state change on the stage, waiting one poll to prove it is not a one-off snapshot. */
    let pendingPress: { state: 'PLAYING' | 'PAUSED'; at: number } | null = null;
    /** A stage state that disagrees with Spotify without an observed change: heal it after a moment. */
    let steadyMismatchSince: number | null = null;
    /** A play/pause we just sent: Spotify reports the old state for a moment, and that is not a change. */
    let pendingControl: { paused: boolean; until: number } | null = null;
    const PRESS_CONFIRM_MS = 400;
    const STEADY_MISMATCH_MS = 2500;
    /**
     * A track the stage was taken away for: Folia refused our clock because another source owns the stage.
     * Without this, the next tick would push the same track again and start a fight.
     */
    let yielded: { trackKey: string; until: number } | null = null;
    /** How long to leave the stage alone before trying that track again (the listener may switch back). */
    const YIELD_RETRY_MS = 60_000;
    // A failure that repeats every tick is logged once in a while, not once a tick.
    let spotifyWarnedAt = 0;
    let stageWarnedAt = 0;
    const WARN_INTERVAL_MS = 30_000;
    const warnOnceInAWhile = (which: 'spotify' | 'stage', message: string, detail?: unknown): void => {
        const at = now();
        if (which === 'spotify') {
            if (at - spotifyWarnedAt < WARN_INTERVAL_MS) return;
            spotifyWarnedAt = at;
        } else {
            if (at - stageWarnedAt < WARN_INTERVAL_MS) return;
            stageWarnedAt = at;
        }
        log.warn(message, detail);
    };

    let lastSnapshot: EngineSnapshot = {
        track: null,
        isPlaying: false,
        positionMs: 0,
        durationMs: 0,
        sessionUpdatedAt: null,
        lyricsSource: null,
        updatedAtMs: null,
    };

    const payloadOf = (track: NowPlayingTrack, positionMs: number, paused: boolean, lrc: string | null) => {
        const payload: Parameters<StageClient['pushLyrics']>[0] = {
            title: track.title,
            positionMs: Math.max(0, Math.round(positionMs)),
            paused,
        };
        if (track.artists.length > 0) payload.artist = track.artists.join(', ');
        if (track.album) payload.album = track.album;
        if (track.durationMs > 0) payload.durationMs = track.durationMs;
        if (track.coverUrl) payload.coverUrl = track.coverUrl;
        if (lrc) payload.lyricSource = { type: 'local', lrcContent: shiftLrc(lrc, lyricsOffsetMs), formatHint: 'lrc' };
        return payload;
    };

    const pushSession = async (track: NowPlayingTrack, positionMs: number, paused: boolean, lrc: string | null): Promise<number | null> => {
        const payload = payloadOf(track, positionMs, paused, lrc);
        if (dryRun) {
            log.info('[dry-run] would put the track on the stage', {
                title: payload.title,
                positionMs: payload.positionMs,
                paused: payload.paused,
                lyrics: Boolean(lrc),
            });
            return null;
        }
        const sessionUpdatedAt = (await stage.pushLyrics(payload)).sessionUpdatedAt;
        // Folia's own snapshot will show this position; do not read it back as a listener action.
        ignoreTransportUntil = now() + TRANSPORT_IGNORE_MS;
        return sessionUpdatedAt;
    };

    /** Starts the lookup in the background; a later tick takes the answer when it is there. */
    const startLyricsLookup = (track: NowPlayingTrack): PendingLyrics => {
        const entry: PendingLyrics = { trackKey: trackKeyOf(track), settled: false, value: null };
        lyrics.get(track).then(
            value => {
                entry.settled = true;
                entry.value = value;
            },
            error => {
                entry.settled = true;
                entry.value = null;
                log.debug('the lyrics lookup failed', error);
            },
        );
        return entry;
    };

    /** Starts the cover lookup in the background; a later tick takes the answer when it is there. */
    const startCoverLookup = (track: NowPlayingTrack): PendingCover => {
        const entry: PendingCover = { trackKey: trackKeyOf(track), settled: false, value: null };
        if (!cover) {
            entry.settled = true;
            return entry;
        }
        cover.get(track).then(
            value => {
                entry.settled = true;
                entry.value = value;
            },
            error => {
                entry.settled = true;
                entry.value = null;
                log.debug('the cover lookup failed', error);
            },
        );
        return entry;
    };

    /** A new track: show it at once (cover and timeline), the words follow in a tick or two. */
    const begin = async (playing: PlayingTrack): Promise<void> => {
        const track = playing.track;
        const cached = lyrics.peek(track);
        const sessionUpdatedAt = await pushSession(track, playing.positionMs, !playing.isPlaying, cached?.lrc ?? null);
        session = {
            track,
            sessionUpdatedAt,
            lyrics: cached,
            anchorPositionMs: playing.positionMs,
            anchorAtMs: playing.sampledAtMs,
            paused: !playing.isPlaying,
            lastClockAtMs: now(),
        };
        pendingLyrics = cached ? null : startLyricsLookup(track);
        pendingCover = track.coverUrl ? null : startCoverLookup(track);
        log.info(`following ${track.title}${track.artists.length > 0 ? ` — ${track.artists.join(', ')}` : ''}`, {
            device: playing.deviceName,
            playing: playing.isPlaying,
            lyrics: cached ? cached.source : 'looking',
        });
    };

    /**
     * The words are ready: send the session again, at the position it has now. Nothing is dropped if the
     * push fails: the answer stays in `pendingLyrics` and the next tick tries the same words again.
     */
    const attachLyrics = async (playing: PlayingTrack, at: number): Promise<boolean> => {
        const current = session;
        const pending = pendingLyrics;
        if (!current || !pending || current.lyrics || !pending.settled) return false;
        if (pending.trackKey !== trackKeyOf(current.track)) {
            pendingLyrics = null;
            return false;
        }
        const result = pending.value;
        if (!result) {
            pendingLyrics = null;
            return false;
        }
        const sessionUpdatedAt = await pushSession(current.track, playing.positionMs, current.paused, result.lrc);
        // `forget()` (a replaced connection) may have run while the push was in flight.
        if (session !== current) return false;
        pendingLyrics = null;
        current.lyrics = result;
        current.sessionUpdatedAt = sessionUpdatedAt;
        current.anchorPositionMs = playing.positionMs;
        current.anchorAtMs = playing.sampledAtMs;
        current.lastClockAtMs = at;
        log.info(`lyrics on the stage: ${result.source}`, {
            title: current.track.title,
            lines: result.lrc.split('\n').length,
        });
        return true;
    };

    /**
     * The cover is ready: send the session again with it. The words (and the position) go along, so this
     * is also the moment the stage stops showing a blank square without waiting for the next clock tick.
     */
    const attachCover = async (playing: PlayingTrack, at: number): Promise<boolean> => {
        const current = session;
        const pending = pendingCover;
        if (!current || !pending || current.track.coverUrl || !pending.settled) return false;
        pendingCover = null;
        if (pending.trackKey !== trackKeyOf(current.track)) return false;
        const result = pending.value;
        if (!result) return false;
        current.track.coverUrl = result.url;
        const sessionUpdatedAt = await pushSession(current.track, playing.positionMs, current.paused, current.lyrics?.lrc ?? null);
        // `forget()` (a replaced connection) may have run while the push was in flight.
        if (session !== current) return false;
        current.sessionUpdatedAt = sessionUpdatedAt;
        current.anchorPositionMs = playing.positionMs;
        current.anchorAtMs = playing.sampledAtMs;
        current.paused = !playing.isPlaying;
        current.lastClockAtMs = at;
        log.info(`cover on the stage: ${result.source}`, { title: current.track.title });
        return true;
    };

    /**
     * Whether the stage is showing the session this engine pushed. The session id is the only reliable mark:
     * another source's lyrics sessions also carry a title, and an older Folia leaves the title out.
     */
    const stageShowsOurs = (status: StageStatus, current: Session): boolean => (
        status.activeEntryKind === 'lyrics'
        && current.sessionUpdatedAt !== null
        && status.lyricsSession?.updatedAt === current.sessionUpdatedAt
    );

    const reassert = async (current: Session, positionMs: number, paused: boolean, sampledAtMs: number, at: number): Promise<void> => {
        // Another source may have taken the stage (the listener switched source, another tool pushed).
        // Pushing over it every clock interval would be a fight; let go of this track for a while.
        if (!dryRun) {
            const status = await stage.status().catch(() => null);
            if (status && !stageShowsOurs(status, current)) {
                log.info('another source took the stage; Spolyric lets go of it for a while');
                session = null;
                yielded = { trackKey: trackKeyOf(current.track), until: at + YIELD_RETRY_MS };
                return;
            }
        }
        const sessionUpdatedAt = await pushSession(current.track, positionMs, paused, current.lyrics?.lrc ?? null);
        current.sessionUpdatedAt = sessionUpdatedAt;
        current.anchorPositionMs = positionMs;
        current.anchorAtMs = sampledAtMs;
        current.paused = paused;
        current.lastClockAtMs = at;
    };

    /**
     * `sampledAtMs` is when the position was true (Spotify's answer time), `at` is when this tick looked:
     * the anchor must be the former, or a slow answer looks like a seek on the next tick.
     */
    const pushClock = async (current: Session, positionMs: number, paused: boolean, sampledAtMs: number, at: number): Promise<void> => {
        log.debug('clock push', { paused, positionMs: Math.round(positionMs) });
        const payload: Parameters<StageClient['pushClock']>[0] = {
            positionMs: Math.max(0, Math.round(positionMs)),
            // Always the state Folia should show. A clock that left it out would fall back to the state of
            // the last pushed session, which is older than a pause pressed on the stage bar: the bar would
            // revert by itself on the next drift correction.
            paused,
        };
        if (current.track.durationMs > 0) payload.durationMs = current.track.durationMs;
        if (current.sessionUpdatedAt !== null) payload.sessionUpdatedAt = current.sessionUpdatedAt;
        if (dryRun) {
            log.info('[dry-run] would move the clock', { positionMs: payload.positionMs, paused });
        } else {
            try {
                await stage.pushClock(payload);
            } catch (error) {
                // The stage moved on (another source pushed, Folia restarted, or the session lost its clock):
                // put this session back once, unless the stage now shows something else.
                if (error instanceof StageApiError && (error.code === 'STAGE_LYRICS_SESSION_CHANGED'
                    || error.code === 'STAGE_LYRICS_SESSION_INACTIVE' || error.code === 'STAGE_LYRICS_SESSION_UNCLOCKED')) {
                    log.warn('the stage no longer holds this session; putting it back', { code: error.code });
                    await reassert(current, positionMs, paused, sampledAtMs, at);
                    return;
                }
                throw error;
            }
        }
        current.anchorPositionMs = positionMs;
        current.anchorAtMs = sampledAtMs;
        current.paused = paused;
        current.lastClockAtMs = at;        if (!dryRun) ignoreTransportUntil = now() + TRANSPORT_IGNORE_MS;
    };

    const sendControl = async (action: 'play' | 'pause' | 'seek', positionMs: number, at: number): Promise<boolean> => {
        if (!control) return false;
        // The client takes a moment to change state; do not send the same intent again while it does.
        const key = action === 'seek' ? `seek:${Math.round(positionMs / 1000)}` : action;
        if (lastSent && lastSent.key === key && at - lastSent.at < 3000) return true;
        lastSent = { key, at };
        const ok = await control(action, positionMs).catch(() => false);
        ignoreTransportUntil = at + TRANSPORT_IGNORE_MS;
        suppressPushUntil = at + TRANSPORT_IGNORE_MS;
        if (!ok) {
            log.warn('Spotify 没有接受这个控制命令', { action });
            lastSent = null;
            return false;
        }
        // Remember the intent straight away: the client needs a moment to answer, and until it does the
        // stage must not look like it disagrees with what we told Folia.
        if (session && action !== 'seek') {
            session.anchorPositionMs = positionAt(session, at);
            session.anchorAtMs = at;
            session.paused = action === 'pause';
            pendingControl = { paused: action === 'pause', until: at + 5000 };
        }
        if (action === 'pause') log.info('Folia 的暂停键 → Spotify 已暂停');
        else if (action === 'play') log.info('Folia 的播放键 → Spotify 已继续');
        else log.info(`Folia 的进度 → Spotify 跳到 ${Math.round(positionMs / 1000)}s`);
        return true;
    };

    /**
     * Folia's stage bar is read-only towards the source by design: pressing pause there only freezes the
     * stage clock, and the next clock push would put it back. This turns a change of the stage's own state
     * into a real command for the player (play / pause / seek), so the stage's own buttons work as in
     * Lyricify. A state that merely disagrees without a change is healed back towards Spotify instead.
     */
    const reconcileTransport = async (playing: PlayingTrack, at: number): Promise<'command' | 'push-state' | null> => {
        if (dryRun || !control || !stagePlayerStatus || !session) return null;
        if (at - lastTransportAt < TRANSPORT_POLL_MS) return null;
        lastTransportAt = at;
        if (at < ignoreTransportUntil) return null;
        const status = await stagePlayerStatus().catch(() => null);
        if (!status || status.playerState === 'IDLE' || status.playerState === 'UNKNOWN') return null;
        const age = at - status.sampledAtMs;
        if (!Number.isFinite(age) || age < -2000 || age > STAGE_STATUS_MAX_AGE_MS) return null;

        const current = session;
        const state: 'PLAYING' | 'PAUSED' = status.playerState === 'PAUSED' ? 'PAUSED' : 'PLAYING';
        const spotifyState: 'PLAYING' | 'PAUSED' = playing.isPlaying ? 'PLAYING' : 'PAUSED';
        const expected = current.paused
            ? current.anchorPositionMs
            : current.anchorPositionMs + Math.max(0, status.sampledAtMs - current.anchorAtMs);
        log.debug('stage bar', {
            stage: state,
            told: current.paused ? 'PAUSED' : 'PLAYING',
            spotify: spotifyState,
            positionMs: Math.round(status.positionMs),
            expectedMs: Math.round(expected),
        });

        const previous = lastStageState;
        lastStageState = state;

        // A change on the stage is a press when its clock is where the session says it should be; a
        // stale snapshot around a track change is somewhere else entirely and waits one poll.
        if (previous !== null && previous !== state) {
            log.debug('stage transition', { previous, state, spotify: spotifyState, closeToExpected: Math.abs(status.positionMs - expected) <= STAGE_SEEK_MS });
            const closeToExpected = Math.abs(status.positionMs - expected) <= STAGE_SEEK_MS;
            if (closeToExpected) {
                pendingPress = null;
                if (state !== spotifyState) {
                    return (await sendControl(state === 'PAUSED' ? 'pause' : 'play', 0, at)) ? 'command' : null;
                }
                // The stage now says what Spotify says: whatever we sent before is no longer pending.
                pendingControl = null;
                return 'push-state';
            }
            pendingPress = { state, at };
            // Until this is confirmed, a clock push could overwrite the press with the state we last
            // pushed; leave the stage alone for a moment.
            suppressPushUntil = Math.max(suppressPushUntil, at + 1200);
            return null;
        }
        if (pendingPress) {
            if (pendingPress.state !== state) {
                pendingPress = null;
            } else if (at - pendingPress.at < PRESS_CONFIRM_MS) {
                return null;
            } else {
                pendingPress = null;
                if (state !== spotifyState) {
                    return (await sendControl(state === 'PAUSED' ? 'pause' : 'play', 0, at)) ? 'command' : null;
                }
                return 'push-state';
            }
        }

        // No change seen, but the stage and Spotify disagree (an old session, a missed command): heal.
        // While a command we just sent is still landing, that gap is expected and must not be healed.
        if (state !== spotifyState) {
            if (pendingControl) return null;
            if (steadyMismatchSince === null) {
                steadyMismatchSince = at;
                return null;
            }
            if (at - steadyMismatchSince < STEADY_MISMATCH_MS) return null;
            steadyMismatchSince = null;
            return 'push-state';
        }
        steadyMismatchSince = null;

        // The listener dragged the progress bar.
        if (status.canSeek) {
            const drift = status.positionMs - expected;
            if (Math.abs(drift) > STAGE_SEEK_MS) {
                return (await sendControl('seek', Math.max(0, status.positionMs), at)) ? 'command' : null;
            }
        }
        return null;
    };

    /**
     * Clears the stage only when it still shows this session; another source's push is left alone.
     * Returns whether the stage is now clear of us: a failed request keeps the session, so the next tick retries.
     */
    const clearIfOurs = async (): Promise<boolean> => {
        const current = session;
        if (!current) return true;
        if (dryRun) {
            log.info('[dry-run] would clear the stage');
            session = null;
            return true;
        }
        try {
            const status = await stage.status();
            if (!stageShowsOurs(status, current)) {
                log.info('the stage is showing something else now; leaving it alone');
                session = null;
                return true;
            }
            await stage.clear();
        } catch (error) {
            warnOnceInAWhile('stage', 'could not clear the stage; trying again', error);
            return false;
        }
        log.info('nothing is playing; the stage is cleared');
        session = null;
        return true;
    };

    const handleEmpty = async (at: number, immediate: boolean): Promise<void> => {
        if (!session) return;
        if (emptySince === null) emptySince = at;
        if (!immediate && at - emptySince < emptyGraceMs) return;
        if (await clearIfOurs()) emptySince = null;
    };

    const handleTrack = async (playing: PlayingTrack, at: number): Promise<void> => {
        emptySince = null;
        const key = trackKeyOf(playing.track);
        if (yielded) {
            if (yielded.trackKey === key && at < yielded.until) return;
            yielded = null;
        }
        if (!session || session.track.id !== playing.track.id || session.track.kind !== playing.track.kind) {
            await begin(playing);
            return;
        }
        const current = session;
        // Hear the stage bar first: a change there becomes a command for the player, and the clock must
        // not be pushed back over it in the same tick. Without a change, a disagreement is healed by
        // pushing Spotify's own state to the stage.
        const stageAction = await reconcileTransport(playing, at);
        if (stageAction === 'command') return;
        if (stageAction === 'push-state') {
            await pushClock(current, playing.positionMs, !playing.isPlaying, playing.sampledAtMs, at);
            return;
        }
        if (at < suppressPushUntil) return;

        try {
            if (await attachCover(playing, at)) return;
        } catch (error) {
            warnOnceInAWhile('stage', 'could not put the cover on the stage; trying again', error);
        }

        // Where the session's own clock says Spotify is at the moment the answer was sampled.
        const expectedAtSample = current.paused
            ? current.anchorPositionMs
            : current.anchorPositionMs + Math.max(0, playing.sampledAtMs - current.anchorAtMs);
        const drift = playing.positionMs - expectedAtSample;
        const spotifyPaused = !playing.isPlaying;
        // A command we just sent is not reflected by Spotify for a moment; do not read that gap as the
        // listener changing playback in Spotify, or the next clock would undo the press.
        if (pendingControl) {
            if (spotifyPaused === pendingControl.paused || at >= pendingControl.until) pendingControl = null;
        }
        const turned = pendingControl ? false : spotifyPaused !== current.paused;
        const seeked = Math.abs(drift) > seekThresholdMs;

        if (!current.lyrics && pendingLyrics?.settled) {
            try {
                // The re-push carries the position Spotify reports, so it also settles the clock: nothing
                // more is needed from this tick.
                if (await attachLyrics(playing, at)) return;
            } catch (error) {
                warnOnceInAWhile('stage', 'could not put the lyrics on the stage; trying again', error);
            }
        }

        const due = at - current.lastClockAtMs >= clockIntervalMs;
        const driftWorth = Math.abs(drift) > driftThresholdMs;
        if (!turned && !seeked && !(due && driftWorth)) return;
        // The stage says something we have not acted on yet (a press waiting for its command): do not
        // push our older state over it.
        if (!turned && !seeked && lastStageState !== null
            && (lastStageState === 'PAUSED') !== current.paused) return;
        // A drift push is not urgent: read the stage once more just before touching it, because a press
        // may have happened after the last poll. If it disagrees, this tick leaves it to reconcile.
        if (!turned && !seeked && stagePlayerStatus) {
            const live = await stagePlayerStatus().catch(() => null);
            if (live && (live.playerState === 'PAUSED' || live.playerState === 'PLAYING')
                && (live.playerState === 'PAUSED') !== current.paused) return;
        }
        try {
            await pushClock(current, playing.positionMs, turned ? !playing.isPlaying : current.paused, playing.sampledAtMs, at);
            if (seeked) log.info('the position was moved; the clock follows', { driftMs: Math.round(drift) });
            else if (turned) log.info(`playback ${playing.isPlaying ? 'resumed' : 'paused'} on Spotify`);
        } catch (error) {
            warnOnceInAWhile('stage', 'could not move the clock', error);
        }
    };

    const remember = (playing: PlayingTrack | null, at: number) => {
        lastSnapshot = {
            track: playing?.track ?? null,
            isPlaying: playing?.isPlaying ?? false,
            positionMs: playing ? playing.positionMs : (session ? positionAt(session, at) : 0),
            durationMs: playing?.track.durationMs ?? 0,
            sessionUpdatedAt: session?.sessionUpdatedAt ?? null,
            lyricsSource: session?.lyrics?.source ?? null,
            updatedAtMs: at,
        };
    };

    return {
        async tick() {
            const at = now();
            let playing: NowPlaying;
            try {
                playing = await player.getNowPlaying();
            } catch (error) {
                // A sign-in Spotify no longer accepts is not retried here: the runner stops and says so.
                if (error instanceof SpotifyAuthError) throw error;
                warnOnceInAWhile('spotify', 'could not ask Spotify what is playing', error);
                return;
            }
            try {
                if (playing.state === 'track') {
                    await handleTrack(playing, at);
                    remember(playing, at);
                } else {
                    await handleEmpty(at, playing.state === 'ad');
                    remember(null, at);
                }
            } catch (error) {
                warnOnceInAWhile('stage', 'could not put the change on the stage', error);
                remember(playing.state === 'track' ? playing : null, at);
            }
        },
        snapshot: () => lastSnapshot,
        forget() {
            session = null;
            pendingLyrics = null;
            pendingCover = null;
            emptySince = null;
            yielded = null;
        },
        isFollowing: () => session !== null,
    };
}
