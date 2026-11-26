// src/lyrics/qq.ts
// QQ Music as a lyric source: the same catalogue Folia searches by default. Public endpoints, no account:
// search a song, then ask for its LRC. The referer is required by both.
import { HttpError, fetchJson } from '../http.js';
import { normalizeLrc } from './lrc.js';
import { pickBest } from './match.js';
import { toSimplified } from './zh.js';
const HEADERS = {
    Referer: 'https://y.qq.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Accept: 'application/json',
};
/** QQ sometimes returns HTML entities in the lyric text (&#58; for a colon). */
const decodeEntities = (text) => text
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
export async function fromQq({ track, fetchImpl, timeoutMs, log, signal, }) {
    if (!track.title || track.artists.length === 0)
        return { lrc: null, definitive: true };
    const query = new URLSearchParams({
        w: `${toSimplified(track.title)} ${toSimplified(track.artists[0] ?? '')}`,
        format: 'json',
        n: '10',
        p: '1',
    });
    let songs;
    try {
        const answer = await fetchJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${query.toString()}`, { headers: HEADERS, timeoutMs, signal }, fetchImpl);
        songs = answer.body?.data?.song?.list ?? [];
    }
    catch (error) {
        if (error instanceof HttpError && error.status === 404)
            return { lrc: null, definitive: true };
        throw error;
    }
    if (songs.length === 0)
        return { lrc: null, definitive: true };
    const best = pickBest(songs, track, song => ({
        title: typeof song.songname === 'string' ? song.songname : '',
        artist: (song.singer ?? []).map(singer => (typeof singer.name === 'string' ? singer.name : '')).filter(Boolean).join(' / '),
        durationMs: Math.round((Number(song.interval) || 0) * 1000),
    }));
    const mid = best && typeof best.songmid === 'string' ? best.songmid : '';
    if (!mid)
        return { lrc: null, definitive: true };
    try {
        const answer = await fetchJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1`, { headers: HEADERS, timeoutMs, signal }, fetchImpl);
        const raw = typeof answer.body?.lyric === 'string' ? decodeEntities(answer.body.lyric) : '';
        const lrc = normalizeLrc(raw);
        if (lrc) {
            log.debug('qq: lyric found', { title: track.title, mid });
            return { lrc, definitive: true };
        }
    }
    catch (error) {
        log.debug('qq lyric request failed', error);
    }
    return { lrc: null, definitive: true };
}
//# sourceMappingURL=qq.js.map