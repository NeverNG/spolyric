// src/lyrics/netease.ts
// NetEase Cloud Music as a lyric source. Folia's built-in sources cover Chinese songs far better than
// LRCLIB, so Spolyric asks the same public endpoints: search a song by title and artist, then fetch its
// LRC. No account is needed; the requests carry the referer the endpoints expect.

import { HttpError, fetchJson } from '../http.js';
import type { Logger } from '../log.js';
import type { NowPlayingTrack } from '../spotify/types.js';
import { normalizeLrc } from './lrc.js';
import { pickBest, scoreCandidate } from './match.js';

export type NeteaseLyrics = { lrc: string | null; definitive: boolean };

type NeteaseSong = {
    id?: unknown;
    name?: unknown;
    duration?: unknown;
    artists?: { name?: unknown }[];
    album?: { name?: unknown };
};

const HEADERS = {
    // The endpoints answer differently (or not at all) without the site's own referer.
    Referer: 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Accept: 'application/json',
};

/** The best search hit for this track, or null when nothing is close enough. */
const toCandidate = (song: NeteaseSong) => ({
    title: typeof song.name === 'string' ? song.name : '',
    artist: (song.artists ?? []).map(artist => (typeof artist.name === 'string' ? artist.name : '')).filter(Boolean).join(' / '),
    durationMs: Math.round(Number(song.duration) || 0),
});

export function pickNeteaseSong(candidates: NeteaseSong[], track: NowPlayingTrack): number | null {
    const best = pickBest(candidates, track, toCandidate);
    if (!best) return null;
    const id = Number(best.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function fromNetease({
    track,
    base,
    fetchImpl,
    timeoutMs,
    log,
    signal,
}: {
    track: NowPlayingTrack;
    base: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    log: Logger;
    signal?: AbortSignal;
}): Promise<NeteaseLyrics> {
    if (!track.title || track.artists.length === 0) return { lrc: null, definitive: true };
    const search = new URLSearchParams({
        s: `${track.title} ${track.artists[0]}`,
        type: '1',
        limit: '10',
    });
    let candidates: NeteaseSong[];
    try {
        const answer = await fetchJson<{ result?: { songs?: NeteaseSong[] } }>(
            `${base}/api/search/get?${search.toString()}`,
            { headers: HEADERS, timeoutMs, signal },
            fetchImpl,
        );
        candidates = answer.body?.result?.songs ?? [];
    } catch (error) {
        if (error instanceof HttpError && error.status === 404) return { lrc: null, definitive: true };
        throw error;
    }
    if (candidates.length === 0) return { lrc: null, definitive: true };

    // Try the best hits in order: a matching song may still have no lyric, and the next one might.
    const ranked = candidates
        .map(song => ({ song, score: scoreCandidate(toCandidate(song), track) }))
        .sort((left, right) => right.score - left.score)
        .filter(entry => entry.score >= 4)
        .slice(0, 3);
    if (ranked.length === 0) return { lrc: null, definitive: true };

    for (const { song } of ranked) {
        const id = Number(song.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        try {
            const answer = await fetchJson<{ lrc?: { lyric?: unknown } }>(
                `${base}/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`,
                { headers: HEADERS, timeoutMs, signal },
                fetchImpl,
            );
            const lrc = normalizeLrc(answer.body?.lrc?.lyric);
            if (lrc) {
                log.debug('netease: lyric found', { title: track.title, id });
                return { lrc, definitive: true };
            }
        } catch (error) {
            log.debug('netease lyric request failed', error);
        }
    }
    return { lrc: null, definitive: true };
}
