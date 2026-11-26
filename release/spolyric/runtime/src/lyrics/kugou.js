// src/lyrics/kugou.ts
// KuGou as a lyric source. Search a song, trade its file hash for a lyric candidate, then download the
// LRC (base64 in a JSON field). Public endpoints; no account.
import { HttpError, fetchJson } from '../http.js';
import { normalizeLrc } from './lrc.js';
import { pickBest } from './match.js';
import { toSimplified } from './zh.js';
const HEADERS = {
    Referer: 'https://www.kugou.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Accept: 'application/json',
};
/** The download answers base64 with a UTF-8 BOM inside it. */
const decodeLyric = (content) => {
    if (typeof content !== 'string' || !content)
        return '';
    try {
        return Buffer.from(content, 'base64').toString('utf-8').replace(/^\uFEFF/, '');
    }
    catch {
        return '';
    }
};
export async function fromKugou({ track, fetchImpl, timeoutMs, log, signal, }) {
    if (!track.title || track.artists.length === 0)
        return { lrc: null, definitive: true };
    const search = new URLSearchParams({
        keyword: `${toSimplified(track.title)} ${toSimplified(track.artists[0] ?? '')}`,
        page: '1',
        pagesize: '10',
        platform: 'WebFilter',
        userid: '-1',
        clientver: '2000',
        iscorrection: '1',
        privilege_filter: '0',
    });
    let songs;
    try {
        const answer = await fetchJson(`https://songsearch.kugou.com/song_search_v2?${search.toString()}`, { headers: HEADERS, timeoutMs, signal }, fetchImpl);
        songs = answer.body?.data?.lists ?? [];
    }
    catch (error) {
        if (error instanceof HttpError && error.status === 404)
            return { lrc: null, definitive: true };
        throw error;
    }
    if (songs.length === 0)
        return { lrc: null, definitive: true };
    const best = pickBest(songs, track, song => ({
        title: typeof song.SongName === 'string' ? song.SongName : '',
        artist: typeof song.SingerName === 'string' ? song.SingerName : '',
        durationMs: Math.round((Number(song.Duration) || 0) * 1000),
    }));
    const hash = best && typeof best.FileHash === 'string' ? best.FileHash : '';
    if (!hash)
        return { lrc: null, definitive: true };
    try {
        const candidateAnswer = await fetchJson(`https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=${Math.round(track.durationMs / 1000)}&hash=${encodeURIComponent(hash)}`, { headers: HEADERS, timeoutMs, signal }, fetchImpl);
        const candidates = (candidateAnswer.body?.candidates ?? []).filter(candidate => ((typeof candidate.id === 'string' || typeof candidate.id === 'number')
            && typeof candidate.accesskey === 'string'));
        if (candidates.length === 0)
            return { lrc: null, definitive: true };
        const chosen = pickBest(candidates, track, candidate => ({
            title: typeof candidate.song === 'string' ? candidate.song : track.title,
            artist: typeof candidate.singer === 'string' ? candidate.singer : '',
            durationMs: Math.round(Number(candidate.duration) || track.durationMs),
        })) ?? candidates[0];
        const id = String(chosen.id);
        const accesskey = String(chosen.accesskey);
        const download = await fetchJson(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(id)}&accesskey=${encodeURIComponent(accesskey)}&fmt=lrc&charset=utf8`, { headers: HEADERS, timeoutMs, signal }, fetchImpl);
        const lrc = normalizeLrc(decodeLyric(download.body?.content));
        if (lrc) {
            log.debug('kugou: lyric found', { title: track.title, hash });
            return { lrc, definitive: true };
        }
    }
    catch (error) {
        log.debug('kugou lyric request failed', error);
    }
    return { lrc: null, definitive: true };
}
//# sourceMappingURL=kugou.js.map