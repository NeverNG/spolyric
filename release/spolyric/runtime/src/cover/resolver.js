// src/cover/resolver.ts
// Cover art for the local source. SMTC does not expose the thumbnail through PowerShell 5.1's WinRT
// projection, so the cover is looked up by title/artist/duration on public catalogues and cached. Folia
// only accepts an http(s) cover URL, so the bytes are served from a loopback-only HTTP server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchBytes, fetchJson } from '../http.js';
import { toSimplified } from '../lyrics/zh.js';
const MAX_IMAGE_BYTES = 1_500_000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const normalize = (value) => toSimplified(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\bfeat\.?.*$/i, '')
    .replace(/[\s\-_/\\'".,!?:;·・&+]/g, '');
const scoreOf = (candidate, track) => {
    const wantTitle = normalize(track.title);
    const gotTitle = normalize(candidate.title);
    const titleScore = gotTitle === wantTitle ? 4 : gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle) ? 2 : 0;
    const artists = track.artists.map(normalize).filter(Boolean);
    const gotArtist = normalize(candidate.artist);
    const artistScore = artists.some(artist => artist === gotArtist || gotArtist.includes(artist) || artist.includes(gotArtist)) ? 2 : 0;
    const diff = Math.abs(candidate.durationMs - track.durationMs);
    const durationScore = track.durationMs <= 0 ? 0 : diff <= 3000 ? 2 : diff <= 8000 ? 1 : 0;
    // Catalogues often romanise artists ("JJ Lin" for 林俊傑); an exact title and an exact duration are
    // strong enough on their own, but a title match with neither the artist nor the duration is not.
    const matchedTitleAndDuration = titleScore === 4 && durationScore === 2;
    if (artists.length > 0 && artistScore === 0 && !matchedTitleAndDuration)
        return 0;
    return titleScore + artistScore + durationScore;
};
/** The bytes say what the image is; a CDN's Content-Type is not always right. */
const imageTypeOf = (bytes) => {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
        return 'image/webp';
    return null;
};
const cacheKey = (track) => crypto
    .createHash('sha1')
    .update(`${track.title}|${track.artists.join(',')}|${track.album}|${track.durationMs}`)
    .digest('hex');
export function createCoverResolver({ cacheDir, log, server, fetchJsonImpl = fetchJson, fetchBytesImpl = fetchBytes, now = Date.now, }) {
    // `cacheDir` is the covers folder itself; the loopback server reads the same files.
    const dir = cacheDir;
    const cacheFile = (key) => path.join(dir, `${key}.json`);
    const readCache = (key) => {
        try {
            const parsed = JSON.parse(fs.readFileSync(cacheFile(key), 'utf-8'));
            if (typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/'))
                return false;
            return typeof parsed.fetchedAt === 'number' && now() - parsed.fetchedAt <= CACHE_TTL_MS;
        }
        catch {
            return false;
        }
    };
    const writeCache = (key, image, source) => {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(cacheFile(key), JSON.stringify({
                dataUrl: `data:${image.mime};base64,${image.bytes.toString('base64')}`,
                source,
                fetchedAt: now(),
            }));
        }
        catch (error) {
            log.debug('could not write the cover cache', error);
        }
    };
    /** Starts the loopback server (once) and returns the URL Folia can fetch. */
    const publish = async (key, image, source) => {
        writeCache(key, image, source);
        await server.start();
        return { url: server.urlFor(key), source };
    };
    const download = async (url) => {
        try {
            const answer = await fetchBytesImpl(url, { timeoutMs: 8000 });
            if (answer.bytes.length > MAX_IMAGE_BYTES)
                return null;
            const mime = imageTypeOf(answer.bytes);
            if (!mime)
                return null;
            return { bytes: answer.bytes, mime };
        }
        catch (error) {
            log.debug('cover download failed', error);
            return null;
        }
    };
    const pick = (candidates, track, source) => {
        const ranked = candidates
            .map(candidate => ({ candidate, score: scoreOf(candidate, track) }))
            .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        log.debug('cover candidates', {
            source,
            count: candidates.length,
            best: best ? { score: best.score, title: best.candidate.title, artist: best.candidate.artist, durationMs: best.candidate.durationMs } : null,
            wantMs: track.durationMs,
        });
        return best && best.score >= 4 ? best.candidate : null;
    };
    const fromDeezer = async (track) => {
        const query = [toSimplified(track.title), toSimplified(track.artists[0] ?? '')].filter(Boolean).join(' ');
        if (!query)
            return null;
        const answer = await fetchJsonImpl(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`, { timeoutMs: 6000 }).catch(error => {
            log.debug('deezer search failed', error);
            return { body: null };
        });
        const candidates = (answer.body?.data ?? [])
            .filter(item => item.title && item.album && (item.album.cover_big || item.album.cover_xl || item.album.cover_medium))
            .map(item => ({
            title: item.title,
            artist: item.artist?.name ?? '',
            durationMs: Math.round((item.duration ?? 0) * 1000),
            imageUrl: (item.album?.cover_big ?? item.album?.cover_xl ?? item.album?.cover_medium),
            source: 'deezer',
        }));
        const best = pick(candidates, track, 'deezer');
        if (!best)
            return null;
        const image = await download(best.imageUrl);
        if (!image)
            return null;
        log.info(`cover: deezer (${best.title})`);
        return publish(cacheKey(track), image, 'deezer');
    };
    const fromItunes = async (track) => {
        const term = [toSimplified(track.title), toSimplified(track.artists[0] ?? '')].filter(Boolean).join(' ');
        if (!term)
            return null;
        const answer = await fetchJsonImpl(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8`, { timeoutMs: 6000 }).catch(error => {
            log.debug('itunes search failed', error);
            return { body: null };
        });
        const candidates = (answer.body?.results ?? [])
            .filter(item => item.trackName && item.artworkUrl100)
            .map(item => ({
            title: item.trackName,
            artist: item.artistName ?? '',
            durationMs: Math.round(item.trackTimeMillis ?? 0),
            imageUrl: item.artworkUrl100.replace(/100x100bb/, '600x600bb'),
            source: 'itunes',
        }));
        const best = pick(candidates, track, 'itunes');
        if (!best)
            return null;
        const image = await download(best.imageUrl);
        if (!image)
            return null;
        log.info(`cover: itunes (${best.title})`);
        return publish(cacheKey(track), image, 'itunes');
    };
    // QQ Music has the Chinese catalogue (and Folia's default lyric source). Its search result carries
    // the album mid, whose photo host serves the same album art at any size.
    const fromQq = async (track) => {
        const term = [toSimplified(track.title), toSimplified(track.artists[0] ?? '')].filter(Boolean).join(' ');
        if (!term)
            return null;
        const answer = await fetchJsonImpl(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(term)}&format=json&n=8&p=1`, {
            timeoutMs: 6000,
            headers: {
                Referer: 'https://y.qq.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            },
        }).catch(error => {
            log.debug('qq cover search failed', error);
            return { body: null };
        });
        const candidates = (answer.body?.data?.song?.list ?? [])
            .filter(song => typeof song.albummid === 'string' && song.albummid)
            .map(song => ({
            title: typeof song.songname === 'string' ? song.songname : '',
            artist: (song.singer ?? []).map(singer => (typeof singer.name === 'string' ? singer.name : '')).filter(Boolean).join(' / '),
            durationMs: Math.round((Number(song.interval) || 0) * 1000),
            imageUrl: `https://y.qq.com/music/photo_new/T002R500x500M000${String(song.albummid)}.jpg`,
            source: 'qq',
        }));
        const best = pick(candidates, track, 'qq');
        if (!best)
            return null;
        const image = await download(best.imageUrl);
        if (!image)
            return null;
        log.info(`cover: qq (${best.title})`);
        return publish(cacheKey(track), image, 'qq');
    };
    const inflight = new Map();
    return {
        async get(track) {
            const key = cacheKey(track);
            if (readCache(key)) {
                await server.start();
                return { url: server.urlFor(key), source: 'cache' };
            }
            const running = inflight.get(key);
            if (running)
                return running;
            const lookup = new Promise(resolve => {
                let pending = 3;
                let settled = false;
                const finish = (cover) => {
                    pending -= 1;
                    if (cover && !settled) {
                        settled = true;
                        resolve(cover);
                    }
                    else if (pending === 0 && !settled) {
                        settled = true;
                        resolve(null);
                    }
                };
                // Both catalogues are asked at once: whichever finds the cover first wins, and a slow or
                // blocked one (Deezer is not reachable everywhere) does not delay the other.
                fromDeezer(track).then(finish, () => finish(null));
                fromItunes(track).then(finish, () => finish(null));
                fromQq(track).then(finish, () => finish(null));
            })
                .then(cover => {
                if (!cover) {
                    log.debug('no cover found', { title: track.title, artist: track.artists.join(', ') });
                }
                return cover;
            })
                .catch(error => {
                log.debug('cover lookup failed', error);
                return null;
            })
                .finally(() => inflight.delete(key));
            inflight.set(key, lookup);
            return lookup;
        },
        close() {
            server.close();
        },
    };
}
//# sourceMappingURL=resolver.js.map