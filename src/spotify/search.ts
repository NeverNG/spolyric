// src/spotify/search.ts
// The local player only knows a title and an artist (SMTC has no Spotify id). The Web API search turns
// those into the track id Spotify's own lyrics endpoint needs.

import { fetchJson } from '../http.js';
import { pickBest } from '../lyrics/match.js';
import { toSimplified } from '../lyrics/zh.js';
import type { NowPlayingTrack } from './types.js';

type SpotifyTrack = {
    id?: unknown;
    name?: unknown;
    duration_ms?: unknown;
    artists?: { name?: unknown }[];
};

type SpotifySearchAnswer = {
    tracks?: { items?: SpotifyTrack[] };
};

export type SpotifySearchOptions = {
    track: NowPlayingTrack;
    getToken(options?: { force?: boolean }): Promise<string>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
};

/**
 * Finds the Spotify track id for a local (SMTC) track. Null when there is no confident match, which is
 * the normal case for tracks Spotify does not carry; the caller then falls back to the public sources.
 */
export async function searchSpotifyTrack({
    track,
    getToken,
    fetchImpl = fetch,
    timeoutMs = 6000,
    signal,
}: SpotifySearchOptions): Promise<string | null> {
    if (!track.title) return null;
    const queryFor = (simplify: boolean): string => {
        const title = simplify ? toSimplified(track.title) : track.title;
        const artist = simplify ? toSimplified(track.artists[0] ?? '') : track.artists[0] ?? '';
        return track.artists.length > 0 ? `track:${title} artist:${artist}` : title;
    };
    // The original title first: for a traditional-Chinese song it is the release whose Spotify
    // lyrics use the original characters. Only when that finds nothing, ask with simplified text.
    const queries = [queryFor(false)];
    const simplified = queryFor(true);
    if (simplified !== queries[0]) queries.push(simplified);
    const token = await getToken();
    for (const query of queries) {
        const answer = await fetchJson<SpotifySearchAnswer>(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`,
            {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                timeoutMs,
                signal,
            },
            fetchImpl,
        );
        const items = answer.body?.tracks?.items ?? [];
        const best = pickBest(items, track, item => ({
            title: typeof item.name === 'string' ? item.name : '',
            artist: (item.artists ?? []).map(artist => (typeof artist.name === 'string' ? artist.name : '')).filter(Boolean).join(' / '),
            durationMs: Math.round(Number(item.duration_ms) || 0),
        }));
        if (best && typeof best.id === 'string') return best.id;
    }
    return null;
}
