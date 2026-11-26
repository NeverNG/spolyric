// src/config.ts
// Settings in one JSON file under the data directory; environment variables override a run without rewriting it.

import fs from 'node:fs';
import { configFile, ensureDirectory, resolveDataDir, type HostContext } from './paths.js';

export type LyricsConfig = {
    /** Spotify's own time-synced lyrics (spclient `color-lyrics`), the first choice for Spotify tracks. */
    spotify: boolean;
    /** NetEase Cloud Music, whose public lyric endpoint covers many Chinese songs LRCLIB misses. */
    netease: boolean;
    /** QQ Music, Folia's default preferred source. */
    qq: boolean;
    /** KuGou. */
    kugou: boolean;
    /** LRCLIB, a free public lyric database; the fallback and the only source for local files and podcasts. */
    lrclib: boolean;
};

export type SpolyricConfig = {
    /** Where the playing track comes from: the Web API, this machine's media session, or try Web first. */
    source: 'auto' | 'web' | 'local';
    /** Whether Folia's stage bar may control the local player (Windows/SMTC only). */
    control: boolean;
    /** The Spotify developer app Spolyric signs in with. Empty means "not set up yet". */
    clientId: string;
    /** The loopback port the Spotify consent page returns to; it must be registered on that app as a redirect URI. */
    redirectPort: number;
    /** How often Spotify is asked what is playing. */
    pollIntervalMs: number;
    /** How often Folia's clock is corrected while the song plays. */
    clockIntervalMs: number;
    /** How long "nothing playing" must last before the stage is cleared (track changes answer 204 for a moment). */
    emptyGraceMs: number;
    /** A position further than this from what Folia was told is a seek the listener made: the clock is pushed at once. */
    seekThresholdMs: number;
    /** Likewise for the drift a clock correction is worth sending. */
    driftThresholdMs: number;
    /** The lyric source tried first; the rest follow Folia's fallback order. */
    preferredLyricSource: 'qq' | 'netease' | 'kugou' | 'spotify' | 'lrclib';
    /** Shifts every lyric timestamp by this many milliseconds (positive = later). */
    lyricsOffsetMs: number;
    lyrics: LyricsConfig;
    /** Path of Folia's Stage connection file; empty means "look in the known places". */
    connectionFile: string;
    /** A Stage address to use instead of the connection file (`http://127.0.0.1:<port>`). */
    stageBaseUrl: string;
    /** The bearer token that goes with `stageBaseUrl`. */
    stageToken: string;
    spotifyApiBase: string;
    spotifyAccountsBase: string;
    /** Spotify's lyric endpoint (`spclient`); a test or a mirror can point it elsewhere. */
    spotifyLyricsBase: string;
    neteaseBase: string;
    lrclibBase: string;
    verbose: boolean;
};

export const DEFAULT_CONFIG: SpolyricConfig = {
    source: 'auto',
    control: true,
    clientId: '',
    redirectPort: 9888,
    pollIntervalMs: 500,
    clockIntervalMs: 60_000,
    emptyGraceMs: 20_000,
    seekThresholdMs: 1500,
    driftThresholdMs: 5000,
    preferredLyricSource: 'qq',
    lyricsOffsetMs: 0,
    lyrics: { spotify: true, netease: true, qq: true, kugou: true, lrclib: true },
    connectionFile: '',
    stageBaseUrl: '',
    stageToken: '',
    spotifyApiBase: 'https://api.spotify.com',
    spotifyAccountsBase: 'https://accounts.spotify.com',
    spotifyLyricsBase: 'https://spclient.wg.spotify.com',
    neteaseBase: 'https://music.163.com',
    lrclibBase: 'https://lrclib.net',
    verbose: false,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
};

const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value.trim() : fallback);

const boolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const PREFERRED_SOURCES = ['qq', 'netease', 'kugou', 'spotify', 'lrclib'] as const;

const preferredOf = (value: unknown): (typeof PREFERRED_SOURCES)[number] => (
    typeof value === 'string' && (PREFERRED_SOURCES as readonly string[]).includes(value)
        ? value as (typeof PREFERRED_SOURCES)[number]
        : 'qq'
);

/** Reads a file written by an older Spolyric: unknown keys are dropped, bad values fall back, nothing throws. */
export function normalizeConfig(raw: unknown): SpolyricConfig {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const lyrics = source.lyrics && typeof source.lyrics === 'object' ? source.lyrics as Record<string, unknown> : {};
    const mode = text(source.source, DEFAULT_CONFIG.source).toLowerCase();
    return {
        source: mode === 'web' || mode === 'local' ? mode : 'auto',
        control: boolean(source.control, DEFAULT_CONFIG.control),
        clientId: text(source.clientId, DEFAULT_CONFIG.clientId),
        redirectPort: clampInt(source.redirectPort, 1024, 65_535, DEFAULT_CONFIG.redirectPort),
        pollIntervalMs: clampInt(source.pollIntervalMs, 500, 30_000, DEFAULT_CONFIG.pollIntervalMs),
        clockIntervalMs: clampInt(source.clockIntervalMs, 500, 60_000, DEFAULT_CONFIG.clockIntervalMs),
        emptyGraceMs: clampInt(source.emptyGraceMs, 0, 600_000, DEFAULT_CONFIG.emptyGraceMs),
        seekThresholdMs: clampInt(source.seekThresholdMs, 200, 30_000, DEFAULT_CONFIG.seekThresholdMs),
        driftThresholdMs: clampInt(source.driftThresholdMs, 100, 30_000, DEFAULT_CONFIG.driftThresholdMs),
        preferredLyricSource: preferredOf(source.preferredLyricSource),
        lyricsOffsetMs: clampInt(source.lyricsOffsetMs, -30_000, 30_000, 0),
        lyrics: {
            spotify: boolean(lyrics.spotify, DEFAULT_CONFIG.lyrics.spotify),
            netease: boolean(lyrics.netease, DEFAULT_CONFIG.lyrics.netease),
            qq: boolean(lyrics.qq, DEFAULT_CONFIG.lyrics.qq),
            kugou: boolean(lyrics.kugou, DEFAULT_CONFIG.lyrics.kugou),
            lrclib: boolean(lyrics.lrclib, DEFAULT_CONFIG.lyrics.lrclib),
        },
        connectionFile: text(source.connectionFile, DEFAULT_CONFIG.connectionFile),
        stageBaseUrl: text(source.stageBaseUrl, DEFAULT_CONFIG.stageBaseUrl).replace(/\/+$/, ''),
        stageToken: text(source.stageToken, DEFAULT_CONFIG.stageToken),
        spotifyApiBase: text(source.spotifyApiBase, DEFAULT_CONFIG.spotifyApiBase).replace(/\/+$/, ''),
        spotifyAccountsBase: text(source.spotifyAccountsBase, DEFAULT_CONFIG.spotifyAccountsBase).replace(/\/+$/, ''),
        spotifyLyricsBase: text(source.spotifyLyricsBase, DEFAULT_CONFIG.spotifyLyricsBase).replace(/\/+$/, ''),
        neteaseBase: text(source.neteaseBase, DEFAULT_CONFIG.neteaseBase).replace(/\/+$/, ''),
        lrclibBase: text(source.lrclibBase, DEFAULT_CONFIG.lrclibBase).replace(/\/+$/, ''),
        verbose: boolean(source.verbose, DEFAULT_CONFIG.verbose),
    };
}

/** The overrides a run can carry: `SPOLYRIC_*` wins over the file. */
export function applyEnvironment(config: SpolyricConfig, env: Record<string, string | undefined>): SpolyricConfig {
    const next: SpolyricConfig = { ...config, lyrics: { ...config.lyrics } };
    const set = (key: keyof SpolyricConfig, value: string | undefined) => {
        if (value === undefined || !value.trim()) return;
        (next as Record<string, unknown>)[key] = value.trim();
    };
    set('clientId', env.SPOLYRIC_CLIENT_ID);
    set('connectionFile', env.SPOLYRIC_CONNECTION);
    set('stageBaseUrl', env.SPOLYRIC_STAGE_URL);
    set('stageToken', env.SPOLYRIC_STAGE_TOKEN);
    set('spotifyApiBase', env.SPOLYRIC_SPOTIFY_API_BASE);
    set('spotifyAccountsBase', env.SPOLYRIC_SPOTIFY_ACCOUNTS_BASE);
    set('spotifyLyricsBase', env.SPOLYRIC_SPOTIFY_LYRICS_BASE);
    set('neteaseBase', env.SPOLYRIC_NETEASE_BASE);
    set('lrclibBase', env.SPOLYRIC_LRCLIB_BASE);

    const port = env.SPOLYRIC_REDIRECT_PORT?.trim();
    if (port) next.redirectPort = clampInt(port, 1024, 65_535, next.redirectPort);
    const mode = env.SPOLYRIC_SOURCE?.trim().toLowerCase();
    if (mode === 'auto' || mode === 'web' || mode === 'local') next.source = mode;
    const control = env.SPOLYRIC_CONTROL?.trim().toLowerCase();
    if (control === 'off' || control === 'none' || control === '0' || control === 'false') next.control = false;
    const poll = env.SPOLYRIC_POLL_MS?.trim();
    if (poll) next.pollIntervalMs = clampInt(poll, 500, 30_000, next.pollIntervalMs);
    const clock = env.SPOLYRIC_CLOCK_MS?.trim();
    if (clock) next.clockIntervalMs = clampInt(clock, 500, 60_000, next.clockIntervalMs);
    const grace = env.SPOLYRIC_EMPTY_GRACE_MS?.trim();
    if (grace) next.emptyGraceMs = clampInt(grace, 0, 600_000, next.emptyGraceMs);
    const prefer = env.SPOLYRIC_PREFER?.trim().toLowerCase();
    if (prefer && PREFERRED_SOURCES.includes(prefer as never)) next.preferredLyricSource = prefer as typeof next.preferredLyricSource;
    const offset = env.SPOLYRIC_OFFSET_MS?.trim();
    if (offset) next.lyricsOffsetMs = clampInt(offset, -30_000, 30_000, next.lyricsOffsetMs);

    const sources = env.SPOLYRIC_LYRIC_SOURCES?.trim();
    if (sources) {
        const wanted = new Set(sources.split(',').map(part => part.trim().toLowerCase()).filter(Boolean));
        next.lyrics = {
            spotify: wanted.has('spotify'),
            netease: wanted.has('netease'),
            qq: wanted.has('qq'),
            kugou: wanted.has('kugou'),
            lrclib: wanted.has('lrclib'),
        };
    }
    if (env.SPOLYRIC_VERBOSE === '1' || env.SPOLYRIC_VERBOSE === 'true') next.verbose = true;
    next.stageBaseUrl = next.stageBaseUrl.replace(/\/+$/, '');
    next.spotifyApiBase = next.spotifyApiBase.replace(/\/+$/, '');
    next.spotifyAccountsBase = next.spotifyAccountsBase.replace(/\/+$/, '');
    next.spotifyLyricsBase = next.spotifyLyricsBase.replace(/\/+$/, '');
    next.neteaseBase = next.neteaseBase.replace(/\/+$/, '');
    next.lrclibBase = next.lrclibBase.replace(/\/+$/, '');
    return next;
}

export type LoadedConfig = {
    config: SpolyricConfig;
    dataDir: string;
    filePath: string;
};

/** Loads the settings from disk (a missing or broken file is simply the defaults) and lets the environment override them. */
export function loadConfig({
    dataDir,
    ...host
}: HostContext & { dataDir?: string } = {}): LoadedConfig {
    const directory = dataDir ?? resolveDataDir(host);
    const filePath = configFile(directory);
    let raw: unknown = null;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        raw = null;
    }
    const config = applyEnvironment(normalizeConfig(raw), host.env ?? process.env);
    // Builds before the stage-press fix wrote a clock every 4 s and corrected a 0.9 s drift; that
    // periodic push could overwrite a pause pressed on Folia's bar before the engine saw it. A file
    // still holding exactly those old defaults was never customized, so it moves to the new ones.
    if (config.pollIntervalMs === 1500 && config.clockIntervalMs === 4000 && config.driftThresholdMs === 900) {
        config.pollIntervalMs = DEFAULT_CONFIG.pollIntervalMs;
        config.clockIntervalMs = DEFAULT_CONFIG.clockIntervalMs;
        config.driftThresholdMs = DEFAULT_CONFIG.driftThresholdMs;
    }
    return { config, dataDir: directory, filePath };
}

/** Writes the settings, keeping whatever was there for keys the caller did not name. */
export function saveConfig(dataDir: string, patch: Partial<SpolyricConfig>): SpolyricConfig {
    ensureDirectory(dataDir);
    const filePath = configFile(dataDir);
    let current: SpolyricConfig = DEFAULT_CONFIG;
    try {
        current = normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {
        current = DEFAULT_CONFIG;
    }
    const next = normalizeConfig({
        ...current,
        ...patch,
        lyrics: { ...current.lyrics, ...(patch.lyrics ?? {}) },
    });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 4)}\n`, { mode: 0o600 });
    return next;
}
