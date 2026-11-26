// src/config.ts
// Settings in one JSON file under the data directory; environment variables override a run without rewriting it.
import fs from 'node:fs';
import { configFile, ensureDirectory, resolveDataDir } from './paths.js';
export const DEFAULT_CONFIG = {
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
const clampInt = (value, min, max, fallback) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
};
const text = (value, fallback) => (typeof value === 'string' ? value.trim() : fallback);
const boolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const PREFERRED_SOURCES = ['qq', 'netease', 'kugou', 'spotify', 'lrclib'];
const preferredOf = (value) => (typeof value === 'string' && PREFERRED_SOURCES.includes(value)
    ? value
    : 'qq');
/** Reads a file written by an older Spolyric: unknown keys are dropped, bad values fall back, nothing throws. */
export function normalizeConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const lyrics = source.lyrics && typeof source.lyrics === 'object' ? source.lyrics : {};
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
export function applyEnvironment(config, env) {
    const next = { ...config, lyrics: { ...config.lyrics } };
    const set = (key, value) => {
        if (value === undefined || !value.trim())
            return;
        next[key] = value.trim();
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
    if (port)
        next.redirectPort = clampInt(port, 1024, 65_535, next.redirectPort);
    const mode = env.SPOLYRIC_SOURCE?.trim().toLowerCase();
    if (mode === 'auto' || mode === 'web' || mode === 'local')
        next.source = mode;
    const control = env.SPOLYRIC_CONTROL?.trim().toLowerCase();
    if (control === 'off' || control === 'none' || control === '0' || control === 'false')
        next.control = false;
    const poll = env.SPOLYRIC_POLL_MS?.trim();
    if (poll)
        next.pollIntervalMs = clampInt(poll, 500, 30_000, next.pollIntervalMs);
    const clock = env.SPOLYRIC_CLOCK_MS?.trim();
    if (clock)
        next.clockIntervalMs = clampInt(clock, 500, 60_000, next.clockIntervalMs);
    const grace = env.SPOLYRIC_EMPTY_GRACE_MS?.trim();
    if (grace)
        next.emptyGraceMs = clampInt(grace, 0, 600_000, next.emptyGraceMs);
    const prefer = env.SPOLYRIC_PREFER?.trim().toLowerCase();
    if (prefer && PREFERRED_SOURCES.includes(prefer))
        next.preferredLyricSource = prefer;
    const offset = env.SPOLYRIC_OFFSET_MS?.trim();
    if (offset)
        next.lyricsOffsetMs = clampInt(offset, -30_000, 30_000, next.lyricsOffsetMs);
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
    if (env.SPOLYRIC_VERBOSE === '1' || env.SPOLYRIC_VERBOSE === 'true')
        next.verbose = true;
    next.stageBaseUrl = next.stageBaseUrl.replace(/\/+$/, '');
    next.spotifyApiBase = next.spotifyApiBase.replace(/\/+$/, '');
    next.spotifyAccountsBase = next.spotifyAccountsBase.replace(/\/+$/, '');
    next.spotifyLyricsBase = next.spotifyLyricsBase.replace(/\/+$/, '');
    next.neteaseBase = next.neteaseBase.replace(/\/+$/, '');
    next.lrclibBase = next.lrclibBase.replace(/\/+$/, '');
    return next;
}
/** Loads the settings from disk (a missing or broken file is simply the defaults) and lets the environment override them. */
export function loadConfig({ dataDir, ...host } = {}) {
    const directory = dataDir ?? resolveDataDir(host);
    const filePath = configFile(directory);
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
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
export function saveConfig(dataDir, patch) {
    ensureDirectory(dataDir);
    const filePath = configFile(dataDir);
    let current = DEFAULT_CONFIG;
    try {
        current = normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    }
    catch {
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
//# sourceMappingURL=config.js.map