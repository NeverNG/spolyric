// src/spotify/search.ts
// The local player only knows a title and an artist (SMTC has no Spotify id). The Web API search turns
// those into the track id Spotify's own lyrics endpoint needs.
import { fetchJson } from '../http.js';
import { pickBest } from '../lyrics/match.js';
import { toSimplified } from '../lyrics/zh.js';
/**
 * Finds the Spotify track id for a local (SMTC) track. Null when there is no confident match, which is
 * the normal case for tracks Spotify does not carry; the caller then falls back to the public sources.
 */
export async function searchSpotifyTrack({ track, getToken, fetchImpl = fetch, timeoutMs = 6000, signal, }) {
    if (!track.title)
        return null;
    const query = track.artists.length > 0
        ? `track:${toSimplified(track.title)} artist:${toSimplified(track.artists[0] ?? '')}`
        : toSimplified(track.title);
    const token = await getToken();
    const answer = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        timeoutMs,
        signal,
    }, fetchImpl);
    const items = answer.body?.tracks?.items ?? [];
    const best = pickBest(items, track, item => ({
        title: typeof item.name === 'string' ? item.name : '',
        artist: (item.artists ?? []).map(artist => (typeof artist.name === 'string' ? artist.name : '')).filter(Boolean).join(' / '),
        durationMs: Math.round(Number(item.duration_ms) || 0),
    }));
    return best && typeof best.id === 'string' ? best.id : null;
}
//# sourceMappingURL=search.js.map