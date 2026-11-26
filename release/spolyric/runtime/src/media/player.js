// src/media/player.ts
// The local Spotify client as a playback source. SMTC reports the position in coarse steps (Spotify
// updates it every second or three), so a small phase-locked clock smooths it: advance with the wall
// clock, pull towards each sample slowly, jump only on a real seek.
/** A difference this large is the listener seeking (or the app jumping), not sample noise. */
const SEEK_JUMP_MS = 2500;
/** How much of each sample's error to take: slow enough not to step, fast enough to stay under ~200 ms. */
const CONVERGE = 0.25;
export function createLocalPlayer({ reader, log, now = Date.now, appPattern = /spotify/i, }) {
    let state = null;
    return {
        peek: () => reader.read(),
        async getNowPlaying() {
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
            }
            else {
                const elapsed = state.playing ? Math.max(0, at - state.atMs) : 0;
                let clock = state.clockMs + elapsed;
                // Only a changed sample carries new information; an unchanged one must not drag the clock back.
                if (snapshot.positionMs !== state.rawPositionMs) {
                    const error = snapshot.positionMs - clock;
                    if (Math.abs(error) > SEEK_JUMP_MS) {
                        clock = snapshot.positionMs;
                    }
                    else {
                        clock += error * CONVERGE;
                    }
                    state.rawPositionMs = snapshot.positionMs;
                }
                state.clockMs = clock;
                state.atMs = at;
                state.playing = snapshot.isPlaying;
                if (snapshot.durationMs > 0)
                    state.durationMs = snapshot.durationMs;
            }
            const durationMs = state.durationMs;
            const raw = Math.max(0, state.clockMs);
            const positionMs = durationMs > 0 ? Math.min(raw, durationMs) : raw;
            // Spotify's free tier reports its ad as a ~30 s "track" by the artist "Spotify". Pushing it
            // would replace the lyrics with an ad title and a blank cover until the song comes back.
            if (/無廣告|无广告|advertisement/i.test(snapshot.title)
                || (snapshot.artist.trim().toLowerCase() === 'spotify' && durationMs > 0 && durationMs <= 60_000)) {
                log.debug('local session: ad', { title: snapshot.title });
                return { state: 'ad', deviceName: '本机 Spotify' };
            }
            const track = {
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
//# sourceMappingURL=player.js.map