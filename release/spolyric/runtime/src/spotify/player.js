// src/spotify/player.ts
// One question, asked of Spotify: what is playing right now, and where is it? The Web API allows this for free accounts too.
import { HttpError, fetchJson } from '../http.js';
const nameOf = (value) => (typeof value === 'string' ? value : '');
const coverOf = (images) => {
    if (!Array.isArray(images))
        return null;
    let best = null;
    for (const image of images) {
        const url = nameOf(image.url);
        if (!url)
            continue;
        const width = Number(image.width);
        const size = Number.isFinite(width) ? width : 0;
        if (!best || size > best.width)
            best = { url, width: size };
    }
    return best?.url ?? null;
};
const artistsOf = (item) => {
    if (Array.isArray(item.artists)) {
        return item.artists.map(artist => nameOf(artist?.name)).filter(Boolean);
    }
    const show = nameOf(item.show?.name);
    return show ? [show] : [];
};
export function trackFromItem(item) {
    if (!item)
        return null;
    const title = nameOf(item.name);
    if (!title)
        return null;
    const kind = item.type === 'episode' ? 'episode' : 'track';
    const album = nameOf(item.album?.name) || nameOf(item.show?.name);
    const duration = Number(item.duration_ms);
    const id = nameOf(item.id);
    return {
        // A local file has an id only in the account it lives in; the name keeps two of them apart.
        id: id || `local:${title}`,
        kind,
        title,
        artists: artistsOf(item),
        album,
        durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
        coverUrl: coverOf(item.album?.images) ?? coverOf(item.show?.images) ?? coverOf(item.images),
    };
}
export function createPlayerClient({ apiBase, getToken, fetchImpl = fetch, now = Date.now, log, timeoutMs = 10_000, signal, }) {
    return {
        async getNowPlaying() {
            // The round trip is measured from the moment the request goes out, after any token work: a
            // renewal must not be counted as time the track played.
            const ask = async (forceToken, path) => {
                const token = await getToken({ force: forceToken });
                const sentAt = now();
                const response = await fetchJson(`${apiBase}${path}`, {
                    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                    timeoutMs,
                    signal,
                }, fetchImpl);
                return { answer: response.body, sentAt };
            };
            const askWithRenewal = async (path) => {
                try {
                    return await ask(false, path);
                }
                catch (error) {
                    if (!(error instanceof HttpError) || error.status !== 401)
                        throw error;
                    log.debug('Spotify answered 401; renewing the token and asking once more');
                    return ask(true, path);
                }
            };
            let answer;
            let sentAt;
            try {
                ({ answer, sentAt } = await askWithRenewal('/v1/me/player'));
            }
            catch (error) {
                // Some apps/accounts are refused the full playback state (403: scope, plan, or app quota)
                // while the narrower "currently playing" endpoint still answers. Try it before giving up.
                if (!(error instanceof HttpError) || error.status !== 403)
                    throw error;
                log.warn('Spotify refused GET /v1/me/player; trying GET /v1/me/player/currently-playing', {
                    reason: error.apiReason || error.apiMessage || `HTTP ${error.status}`,
                });
                ({ answer, sentAt } = await askWithRenewal('/v1/me/player/currently-playing'));
            }
            const receivedAt = now();
            if (!answer)
                return { state: 'idle', deviceName: null };
            const deviceName = nameOf(answer.device?.name) || null;
            const playing = answer.is_playing === true;
            const kind = nameOf(answer.currently_playing_type);
            if (kind === 'ad') {
                // An ad is not a track: give the stage its own clock (the ad's length, from its start) so
                // Folia counts the ad down and its visualizers treat the reset as a new, lyric-less song.
                const adDuration = Number(answer.item?.duration_ms);
                const adPosition = Number(answer.progress_ms);
                return {
                    state: 'ad',
                    deviceName,
                    ...(Number.isFinite(adDuration) && adDuration > 0 ? { durationMs: Math.round(adDuration) } : {}),
                    ...(Number.isFinite(adPosition) && adPosition >= 0 ? { positionMs: adPosition } : {}),
                };
            }
            const track = trackFromItem(answer.item);
            if (!track)
                return { state: 'idle', deviceName };
            const reported = Number(answer.progress_ms);
            const progress = Number.isFinite(reported) && reported >= 0 ? reported : 0;
            // `progress_ms` was true when Spotify wrote the answer; half the round trip is the best guess at now.
            const roundTrip = Math.max(0, receivedAt - sentAt);
            const positionMs = playing ? progress + roundTrip / 2 : progress;
            return {
                state: 'track',
                track,
                isPlaying: playing,
                positionMs,
                sampledAtMs: receivedAt,
                deviceName,
            };
        },
    };
}
//# sourceMappingURL=player.js.map