// src/media/player.ts
// The local Spotify client as a playback source. SMTC reports the position in coarse steps (Spotify
// updates it every second or three), so a small phase-locked clock smooths it: advance with the wall
// clock, pull towards each sample slowly, jump only on a real seek.

import type { Logger } from '../log.js';
import type { PlayerClient } from '../spotify/player.js';
import type { NowPlaying, NowPlayingTrack } from '../spotify/types.js';
import type { MediaSessionReader, MediaSessionSnapshot } from './session.js';

export type LocalPlayer = PlayerClient & {
    /** The raw SMTC sample, for `status`; null when nothing is playing. */
    peek(): MediaSessionSnapshot | null;
};

/** A difference this large is the listener seeking (or the app jumping), not sample noise. */
const SEEK_JUMP_MS = 2500;
/** How much of each sample's error to take: slow enough not to step, fast enough to stay under ~200 ms. */
const CONVERGE = 0.25;

export function createLocalPlayer({
    reader,
    log,
    now = Date.now,
    appPattern = /spotify/i,
}: {
    reader: MediaSessionReader;
    log: Logger;
    now?: () => number;
    /** Only the Spotify client's session counts; another player's SMTC session is not ours to show. */
    appPattern?: RegExp;
}): LocalPlayer {
    let state: { key: string; clockMs: number; atMs: number; playing: boolean; durationMs: number; rawPositionMs: number } | null = null;

    return {
        peek: () => reader.read(),

        async getNowPlaying(): Promise<NowPlaying> {
            const snapshot = reader.read();
            const at = now();
            if (!snapshot || !snapshot.title || !appPattern.test(snapshot.app)) {
                state = null;
                return { state: 'idle', deviceName: null };
            }

            const key = `${snapshot.title}|${snapshot.artist}|${snapshot.durationMs}`;
            if (!state || state.key !== key) {
                state = {
                    key,
                    clockMs: snapshot.positionMs,
                    atMs: at,
                    playing: snapshot.isPlaying,
                    durationMs: snapshot.durationMs,
                    rawPositionMs: snapshot.positionMs,
                };
                log.debug('local session: new track', { title: snapshot.title, artist: snapshot.artist });
            } else {
                const elapsed = state.playing ? Math.max(0, at - state.atMs) : 0;
                let clock = state.clockMs + elapsed;
                // Only a changed sample carries new information; an unchanged one must not drag the clock back.
                if (snapshot.positionMs !== state.rawPositionMs) {
                    const error = snapshot.positionMs - clock;
                    if (Math.abs(error) > SEEK_JUMP_MS) {
                        clock = snapshot.positionMs;
                    } else {
                        clock += error * CONVERGE;
                    }
                    state.rawPositionMs = snapshot.positionMs;
                }
                state.clockMs = clock;
                state.atMs = at;
                state.playing = snapshot.isPlaying;
                if (snapshot.durationMs > 0) state.durationMs = snapshot.durationMs;
            }

            const durationMs = state.durationMs;
            const raw = Math.max(0, state.clockMs);
            const positionMs = durationMs > 0 ? Math.min(raw, durationMs) : raw;
            const track: NowPlayingTrack = {
                id: `local:${snapshot.title}|${snapshot.artist}`,
                kind: 'track',
                title: snapshot.title,
                artists: snapshot.artist ? [snapshot.artist] : [],
                album: snapshot.album,
                durationMs,
                coverUrl: null,
            };
            return {
                state: 'track',
                track,
                isPlaying: snapshot.isPlaying,
                positionMs,
                sampledAtMs: at,
                deviceName: '本机 Spotify',
            };
        },
    };
}
