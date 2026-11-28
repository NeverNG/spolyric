// src/spotify/lyrics.ts
// Time-synced words for the track that is playing: Spotify's own lyrics first, LRCLIB when Spotify has none.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, fetchJson } from '../http.js';
import type { Logger } from '../log.js';
import { ensureDirectory } from '../paths.js';
import { fromNetease } from '../lyrics/netease.js';
import { fromQq } from '../lyrics/qq.js';
import { fromKugou } from '../lyrics/kugou.js';
import { normalizeLrc } from '../lyrics/lrc.js';
import { toSimplified } from '../lyrics/zh.js';
import { searchSpotifyTrack } from './search.js';
import type { NowPlayingTrack } from './types.js';

export { normalizeLrc } from '../lyrics/lrc.js';

export type LyricsSource = 'spotify' | 'netease' | 'qq' | 'kugou' | 'lrclib';

/** The fallback order after the preferred source, as Folia's own registry orders them (the sources we have). */
export const LYRIC_SOURCE_ORDER: readonly LyricsSource[] = ['netease', 'qq', 'kugou', 'spotify', 'lrclib'];

const SOURCE_LABEL: Record<LyricsSource, string> = {
    spotify: 'Spotify',
    netease: 'NetEase',
    qq: 'QQ Music',
    kugou: 'KuGou',
    lrclib: 'LRCLIB',
};

export type LyricsResult = {
    lrc: string;
    source: LyricsSource;
};

export type LyricsResolver = {
    get(track: NowPlayingTrack): Promise<LyricsResult | null>;
    /** What is already on disk for this track, without a request; null when nothing is known yet. */
    peek(track: NowPlayingTrack): LyricsResult | null;
};

type SpotifyLyricLine = {
    startTimeMs?: unknown;
    words?: unknown;
    syllables?: unknown;
    endTimeMs?: unknown;
};

/** `[mm:ss.xx]`, the timestamp shape every LRC reader understands. */
export function lrcTimestamp(milliseconds: number): string {
    const total = Math.max(0, Math.round(milliseconds));
    const minutes = Math.floor(total / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const centiseconds = Math.floor((total % 1000) / 10);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return `[${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}]`;
}

/**
 * Spotify's answer (`color-lyrics`) as LRC. Only line timing is used: word timing would need the
 * enhanced-LRC shape, which the stage reads only when Folia's parser is asked for it, so this stays plain.
 */
export function lrcFromSpotifyAnswer(body: unknown): string | null {
    const lyrics = (body as { lyrics?: { syncType?: unknown; lines?: unknown } } | null)?.lyrics;
    if (!lyrics || typeof lyrics !== 'object') return null;
    if (typeof lyrics.syncType === 'string' && lyrics.syncType.toUpperCase() === 'UNSYNCED') return null;
    const lines = Array.isArray(lyrics.lines) ? lyrics.lines as SpotifyLyricLine[] : [];
    const timed: { at: number; words: string }[] = [];
    for (const line of lines) {
        const words = typeof line.words === 'string' ? line.words.trim() : '';
        const at = Number(line.startTimeMs);
        if (!words || words === '♪' || !Number.isFinite(at) || at < 0) continue;
        timed.push({ at, words });
    }
    if (timed.length === 0) return null;
    timed.sort((left, right) => left.at - right.at);
    return timed.map(line => `${lrcTimestamp(line.at)}${line.words}`).join('\n');
}

/** Keeps only lines that carry a timestamp and some words, so plain text and LRCLIB's blank timed lines are dropped. */

type LrclibAnswer = {
    syncedLyrics?: unknown;
    plainLyrics?: unknown;
    duration?: unknown;
};

const cacheKeyOf = (track: NowPlayingTrack): string => (
    crypto.createHash('sha1').update([
        track.kind,
        track.id,
        track.title.toLowerCase(),
        track.artists.join(',').toLowerCase(),
        String(track.durationMs),
    ].join('|')).digest('hex')
);

type CacheEntry = {
    key: string;
    source: LyricsSource | 'none';
    lrc: string;
    fetchedAtMs: number;
    /**
     * A catalogue lyric cached before Spotify could be asked (or before this version). It is kept,
     * but the next play gives Spotify one chance to supply its original characters first.
     */
    spotifyTried?: boolean;
};

/** A cache entry that carries lyrics from a real source (never the remembered "none"). */
type CachedLyrics = CacheEntry & { source: LyricsSource };

export type LyricsCache = {
    read(key: string): CacheEntry | null;
    write(entry: CacheEntry): void;
};

/** Lyrics on disk: they do not change, and a track replayed later costs nothing. */
export function createLyricsCache(directory: string): LyricsCache {
    return {
        read(key) {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(directory, `${key}.json`), 'utf-8')) as CacheEntry;
                if (parsed && typeof parsed.lrc === 'string' && typeof parsed.fetchedAtMs === 'number') return parsed;
                return null;
            } catch {
                return null;
            }
        },
        write(entry) {
            try {
                ensureDirectory(directory);
                fs.writeFileSync(path.join(directory, `${entry.key}.json`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
            } catch {
                // a cache that cannot be written is only slower, never wrong
            }
        },
    };
}

const HIT_TTL_MS = 30 * 24 * 3600_000;
const MISS_TTL_MS = 6 * 3600_000;

const spotifyIdOf = (track: NowPlayingTrack): string | null => (
    track.kind === 'track' && /^[0-9A-Za-z]{22}$/.test(track.id) ? track.id : null
);

async function fromSpotify({
    trackId,
    getToken,
    fetchImpl,
    timeoutMs,
    base,
    signal,
}: {
    trackId: string;
    getToken(options?: { force?: boolean }): Promise<string>;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    base: string;
    signal?: AbortSignal;
}): Promise<SpotifyLyricsAnswer> {
    const token = await getToken();
    const query = new URLSearchParams({ format: 'json', vocalRemoval: 'false', market: 'from_token' });
    try {
        const answer = await fetchJson<unknown>(`${base}/color-lyrics/v2/track/${trackId}?${query.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                // The endpoint answers 400 without it: it is the web player's own request shape.
                'app-platform': 'WebPlayer',
                Accept: 'application/json',
            },
            timeoutMs,
            signal,
        }, fetchImpl);
        const lrc = lrcFromSpotifyAnswer(answer.body);
        // An answer without timed lines is Spotify saying it has none (or only unsynced ones).
        return { lrc, definitive: true };
    } catch (error) {
        if (error instanceof HttpError && error.status === 404) return { lrc: null, definitive: true };
        throw error;
    }
}

/** A source's answer: the words, and whether "none" is a fact or only this attempt's luck. */
type SpotifyLyricsAnswer = { lrc: string | null; definitive: boolean };

async function fromLrclib({
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
}): Promise<SpotifyLyricsAnswer> {
    const headers = { 'User-Agent': 'Spolyric/0.1 (Folia stage companion)', Accept: 'application/json' };
    const durationSeconds = track.durationMs > 0 ? String(Math.round(track.durationMs / 1000)) : '';
    const get = new URLSearchParams({ track_name: toSimplified(track.title), artist_name: toSimplified(track.artists[0] ?? '') });
    if (track.album) get.set('album_name', toSimplified(track.album));
    if (durationSeconds) get.set('duration', durationSeconds);
    try {
        const answer = await fetchJson<LrclibAnswer>(`${base}/api/get?${get.toString()}`, { headers, timeoutMs, signal }, fetchImpl);
        const lrc = normalizeLrc(answer.body?.syncedLyrics);
        if (lrc) return { lrc, definitive: true };
    } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
    }
    // No exact match: search, and take the timed candidate nearest the same length.
    const search = new URLSearchParams({ track_name: toSimplified(track.title), artist_name: toSimplified(track.artists[0] ?? '') });
    let candidates: LrclibAnswer[];
    try {
        const answer = await fetchJson<LrclibAnswer[]>(`${base}/api/search?${search.toString()}`, { headers, timeoutMs, signal }, fetchImpl);
        candidates = Array.isArray(answer.body) ? answer.body : [];
    } catch (error) {
        // A 404 on the search is the library saying it has nothing, not the library being down.
        if (error instanceof HttpError && error.status === 404) return { lrc: null, definitive: true };
        throw error;
    }
    const scored = candidates
        .map(candidate => ({ lrc: normalizeLrc(candidate.syncedLyrics), duration: Number(candidate.duration) || 0 }))
        .filter((candidate): candidate is { lrc: string; duration: number } => Boolean(candidate.lrc));
    if (scored.length === 0) return { lrc: null, definitive: true };
    const wanted = track.durationMs / 1000;
    scored.sort((left, right) => Math.abs(left.duration - wanted) - Math.abs(right.duration - wanted));
    return { lrc: scored[0]?.lrc ?? null, definitive: true };
}

export function createLyricsResolver({
    cache,
    enabled,
    preferred = 'qq',
    getToken,
    lrclibBase,
    neteaseBase,
    spotifyLyricsBase,
    fetchImpl = fetch,
    log,
    timeoutMs = 8000,
    signal,
}: {
    cache: LyricsCache;
    enabled: { spotify: boolean; netease: boolean; qq: boolean; kugou: boolean; lrclib: boolean };
    /** The source tried first; the rest follow in Folia's fallback order. */
    preferred?: LyricsSource;
    getToken(options?: { force?: boolean }): Promise<string>;
    lrclibBase: string;
    neteaseBase: string;
    spotifyLyricsBase: string;
    fetchImpl?: typeof fetch;
    log: Logger;
    timeoutMs?: number;
    /** Aborted when the runner stops: a lyric request in flight ends with it. */
    signal?: AbortSignal;
}): LyricsResolver {
    const freshEntry = (track: NowPlayingTrack): CachedLyrics | null => {
        const cached = cache.read(cacheKeyOf(track));
        if (!cached || cached.source === 'none') return null;
        if (Date.now() - cached.fetchedAtMs >= HIT_TTL_MS) return null;
        return cached as CachedLyrics;
    };

    /**
     * A fallback cached before Spotify could be asked (no sign-in yet, or an older cache): the words
     * on disk are the catalogue's, often simplified. Let Spotify supply its own original text first.
     */
    const spotifyUpgradeWanted = (cached: CacheEntry): boolean => (
        enabled.spotify
        && preferred === 'spotify'
        && cached.source !== 'spotify'
        && !cached.spotifyTried
    );

    return {
        peek: (track) => {
            const cached = freshEntry(track);
            if (!cached || spotifyUpgradeWanted(cached)) return null;
            return { lrc: cached.lrc, source: cached.source };
        },

        async get(track) {
            const key = cacheKeyOf(track);
            const stored = freshEntry(track);
            const upgrading = Boolean(stored && spotifyUpgradeWanted(stored));
            if (stored && !upgrading) {
                log.debug(`lyrics: cached from ${stored.source}`, { title: track.title });
                return { lrc: stored.lrc, source: stored.source };
            }
            const known = cache.read(key);
            if (known && known.source === 'none' && Date.now() - known.fetchedAtMs < MISS_TTL_MS) {
                log.debug('lyrics: still none', { title: track.title });
                return null;
            }

            let spotifyId = spotifyIdOf(track);
            // Whether Spotify was actually asked this run: only then is the fallback marked, so a
            // failed request is retried on the next play instead of being remembered.
            let spotifyAsked = false;
            // Only when every source that could be asked has said "no lyrics" is that remembered;
            // one source being down must not hide a lyric the other one has.
            let asked = 0;
            let answeredNone = 0;
            const order: LyricsSource[] = [preferred, ...LYRIC_SOURCE_ORDER.filter(source => source !== preferred)];
            for (const source of order) {
                if (!enabled[source]) continue;
                if (source === 'spotify') {
                    if (!spotifyId) {
                        try {
                            spotifyId = await searchSpotifyTrack({ track, getToken, fetchImpl, timeoutMs, signal });
                        } catch (error) {
                            log.debug('Spotify search failed; no Spotify lyrics for this track', error);
                        }
                    }
                    if (!spotifyId) continue;
                    asked += 1;
                    try {
                        const answer = await fromSpotify({
                            trackId: spotifyId,
                            getToken,
                            fetchImpl,
                            timeoutMs,
                            base: spotifyLyricsBase,
                            signal,
                        });
                        if (answer.definitive) answeredNone += 1;
                        if (answer.lrc || answer.definitive) spotifyAsked = true;
                        if (answer.lrc) {
                            cache.write({ key, source, lrc: answer.lrc, fetchedAtMs: Date.now(), spotifyTried: true });
                            log.info(`lyrics: ${SOURCE_LABEL[source]}`, { title: track.title, lines: answer.lrc.split('\n').length });
                            return { lrc: answer.lrc, source };
                        }
                    } catch (error) {
                        log.debug('Spotify lyrics failed; falling back', error);
                    }
                    continue;
                }
                if (!track.title || track.artists.length === 0) continue;
                asked += 1;
                try {
                    const answer = source === 'netease'
                        ? await fromNetease({ track, base: neteaseBase, fetchImpl, timeoutMs, log, signal })
                        : source === 'qq'
                            ? await fromQq({ track, fetchImpl, timeoutMs, log, signal })
                            : source === 'kugou'
                                ? await fromKugou({ track, fetchImpl, timeoutMs, log, signal })
                                : await fromLrclib({ track, base: lrclibBase, fetchImpl, timeoutMs, log, signal });
                    if (answer.definitive) answeredNone += 1;
                    if (answer.lrc) {
                        cache.write({
                            key,
                            source,
                            lrc: answer.lrc,
                            fetchedAtMs: Date.now(),
                            ...(spotifyAsked ? { spotifyTried: true } : {}),
                        });
                        log.info(`lyrics: ${SOURCE_LABEL[source]}`, { title: track.title, lines: answer.lrc.split('\n').length });
                        return { lrc: answer.lrc, source };
                    }
                } catch (error) {
                    log.debug(`${source} lyrics failed`, error);
                }
            }

            // Spotify had nothing better (or could not be asked): the fallback already on disk is
            // still the best answer, so keep it instead of dropping lyrics the stage was showing.
            if (upgrading && stored) {
                if (spotifyAsked) cache.write({ ...stored, spotifyTried: true });
                log.info('lyrics: keeping the cached words; Spotify had nothing better', {
                    title: track.title,
                    source: stored.source,
                });
                return { lrc: stored.lrc, source: stored.source };
            }

            // Nothing was asked, so nothing is remembered: turning a source on later still finds the words.
            if (asked === 0) return null;
            if (answeredNone < asked) {
                // A network failure, a 429, a 5xx, a source that could not be asked: the words may still be
                // there next time, so say nothing for good.
                log.info('lyrics: no complete answer from the sources just now; will try again next time', { title: track.title });
                return null;
            }
            cache.write({
                key,
                source: 'none',
                lrc: '',
                fetchedAtMs: Date.now(),
                ...(spotifyAsked ? { spotifyTried: true } : {}),
            });
            log.info('lyrics: none found; the stage shows the track alone', { title: track.title });
            return null;
        },
    };
}
