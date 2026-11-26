// src/sync/runner.ts
// The long-running part: keep a Stage connection (Folia restarts write a new token), tick the engine, and back off.
import { readStageConnection } from '../folia/connection.js';
import { createStageClient } from '../folia/stage.js';
import { sleep } from '../http.js';
import { coverCacheDir, lyricsCacheDir } from '../paths.js';
import { createCoverResolver } from '../cover/resolver.js';
import { createCoverServer } from '../cover/server.js';
import { createLocalController } from '../media/control.js';
import { coverExePath, readSpotifyCover } from '../media/cover.js';
import { SpotifyAuthError } from '../spotify/auth.js';
import { createLyricsCache, createLyricsResolver } from '../spotify/lyrics.js';
import { createSyncEngine } from './engine.js';
import { choosePlayer } from './playerSource.js';
const STAGE_HINT = '还没有读到 Folia 的 Stage 连接文件。在 Folia 里打开 设置 → 连接与集成 →「舞台模式」，来源选 Stage API，然后让 Spolyric 保持运行。';
/** Runs until the signal aborts. Returns why it ended. */
export async function runSync({ config, dataDir, tokens, log, signal, dryRun = false, once = false, onTick }) {
    const getToken = async (options) => {
        if (!tokens)
            throw new SpotifyAuthError('no-token', 'No Spotify sign-in is stored');
        return (await tokens.ensure(options)).accessToken;
    };
    const choice = choosePlayer({ config, tokens, log });
    log.info(`播放状态来源：${choice.reason}`);
    const player = choice.player;
    const cover = createCoverResolver({
        cacheDir: coverCacheDir(dataDir),
        log,
        server: createCoverServer({ dir: coverCacheDir(dataDir), log }),
    });
    const lyrics = createLyricsResolver({
        cache: createLyricsCache(lyricsCacheDir(dataDir)),
        // Without a Spotify sign-in there is no lyric endpoint to ask; LRCLIB carries it.
        enabled: {
            spotify: config.lyrics.spotify && Boolean(tokens),
            netease: config.lyrics.netease,
            qq: config.lyrics.qq,
            kugou: config.lyrics.kugou,
            lrclib: config.lyrics.lrclib,
        },
        preferred: config.preferredLyricSource,
        getToken,
        neteaseBase: config.neteaseBase,
        lrclibBase: config.lrclibBase,
        spotifyLyricsBase: config.spotifyLyricsBase,
        log,
        signal,
    });
    let connection = null;
    let stage = null;
    let engine = null;
    let hinted = false;
    let modeChecked = false;
    // Transport commands only make sense for the machine's own Spotify client (SMTC). For the Web API
    // source the stage bar is left as it is: controlling another device is a different (Premium) feature.
    const controller = config.control ? createLocalController({ log }) : null;
    const canControl = () => Boolean(controller?.available) && choice.active() === 'local';
    // PowerShell's start-up is the largest part of the first press; do it while the music plays.
    if (config.control && (config.source === 'local' || choice.active() === 'local'))
        controller?.warm();
    // Read through functions: the client and the engine are built inside `connect`, where the flow analysis
    // here cannot see the assignment.
    const currentEngine = () => engine;
    const currentStage = () => stage;
    const buildEngine = (client) => {
        engine?.forget();
        return createSyncEngine({
            player,
            lyrics,
            stage: client,
            log,
            clockIntervalMs: config.clockIntervalMs,
            emptyGraceMs: config.emptyGraceMs,
            seekThresholdMs: config.seekThresholdMs,
            driftThresholdMs: config.driftThresholdMs,
            lyricsOffsetMs: config.lyricsOffsetMs,
            cover,
            coverFromSpotify: () => readSpotifyCover(coverExePath(), log),
            dryRun,
            control: controller?.available
                ? (action, positionMs) => (canControl() ? controller.control(action, positionMs) : Promise.resolve(false))
                : undefined,
            stagePlayerStatus: controller?.available
                ? () => (canControl() ? client.playerStatus() : Promise.resolve(null))
                : undefined,
        });
    };
    /** Reads the connection file again; a new address or token (Folia restart) builds a new client and session. */
    const connect = () => {
        const next = readStageConnection({
            explicitFile: config.connectionFile || null,
            explicitBaseUrl: config.stageBaseUrl || undefined,
            explicitToken: config.stageToken || undefined,
        });
        if (!next) {
            stage = null;
            engine = null;
            connection = null;
            return false;
        }
        const changed = !connection || !stage || next.baseUrl !== connection.baseUrl || next.token !== connection.token;
        if (changed) {
            stage = createStageClient({ connection: next, log, signal });
            modeChecked = false;
            engine = buildEngine(stage);
            log.info(`Folia stage: ${next.baseUrl}${next.filePath ? ` (${next.filePath})` : ''}`);
        }
        connection = next;
        return true;
    };
    /** A dry run never talks to Folia, so it can run without one; this stand-in is never called. */
    const dryRunStage = {
        baseUrl: 'dry-run',
        health: async () => null,
        status: async () => ({ enabled: false, modeEnabled: false, source: null, activeEntryKind: null, lyricsSession: null }),
        playerStatus: async () => null,
        pushLyrics: async () => {
            throw new Error('a dry run does not push');
        },
        pushClock: async () => {
            throw new Error('a dry run does not push');
        },
        clear: async () => {
            throw new Error('a dry run does not clear');
        },
    };
    const sayModeProblems = (health) => {
        modeChecked = true;
        if (!health.modeEnabled) {
            log.warn('Folia 的舞台模式没开：歌词推送进去也不会显示。设置 → 连接与集成 →「舞台模式」打开，来源选 Stage API。');
        }
        else if (health.source && health.source !== 'stage-api') {
            log.warn(`Folia 舞台来源现在是「${health.source}」，换成「Stage API」，否则 Folia 不会接受外部推送。`);
        }
        else {
            log.info('Folia 舞台就绪（舞台模式 · Stage API）');
        }
    };
    // Folia closed or crashed: its connection file stays behind, so ask now and then before pushing into a dead port.
    let lastProbeAt = 0;
    let downWarnedAt = 0;
    const PROBE_INTERVAL_MS = 5000;
    const DOWN_WARN_INTERVAL_MS = 30_000;
    /** One turn of the loop; `null` means "keep going". */
    const step = async () => {
        // A dry run has nowhere to push, so it works without Folia and never probes one.
        const dryRunEngine = dryRun ? (engine ??= buildEngine(dryRunStage)) : null;
        if (!dryRun && !connect()) {
            if (!hinted) {
                log.warn(STAGE_HINT);
                hinted = true;
            }
            return null;
        }
        hinted = false;
        const at = Date.now();
        let reachable = true;
        if (!dryRun && (!modeChecked || at - lastProbeAt >= PROBE_INTERVAL_MS)) {
            lastProbeAt = at;
            const health = await currentStage()?.health().catch(() => null) ?? null;
            if (!health) {
                reachable = false;
                modeChecked = false;
                if (at - downWarnedAt >= DOWN_WARN_INTERVAL_MS) {
                    log.warn('Folia 没有答话（可能关掉了）；等它回来，期间不推送。');
                    downWarnedAt = at;
                }
            }
            else if (!modeChecked) {
                sayModeProblems(health);
            }
        }
        if (!reachable)
            return null;
        try {
            const active = dryRunEngine ?? currentEngine();
            await active?.tick();
            if (active)
                onTick?.(active);
        }
        catch (error) {
            if (error instanceof SpotifyAuthError) {
                log.error(error.code === 'invalid_grant'
                    ? 'Spotify 不再认可这份登录（授权可能已过期或撤回）。先 spolyric logout，再 spolyric login'
                    : error.code === 'scope-missing'
                        ? '这份 Spotify 授权里没有读取播放状态的权限。先 spolyric logout，再 spolyric login（会重新弹授权页）'
                        : `Spotify 未登录：${error.message}。运行 spolyric login 登录。`);
                return 'signed-out';
            }
            log.warn('这一步失败了，继续', error);
        }
        return null;
    };
    try {
        while (!signal.aborted) {
            const outcome = await step();
            if (outcome)
                return outcome;
            if (once)
                return 'stopped';
            try {
                await sleep(config.pollIntervalMs, signal);
            }
            catch {
                break;
            }
        }
        return 'stopped';
    }
    finally {
        // The media session script runs until it is told to stop.
        choice.close();
        cover.close();
        controller?.close();
    }
}
//# sourceMappingURL=runner.js.map