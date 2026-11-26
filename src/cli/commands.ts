// src/cli/commands.ts
// What each command does, in one place: login, run, status, logout, config, help.

import path from 'node:path';
import { currentProxy, HttpError, setHttpProxy } from '../http.js';
import { detectProxy } from '../proxy.js';
import { loadConfig, saveConfig, type SpolyricConfig } from '../config.js';import { readStageConnection } from '../folia/connection.js';
import { createStageClient } from '../folia/stage.js';
import { createLogger, type Logger } from '../log.js';
import { resolveDataDir, stageConnectionCandidates, tokenFile } from '../paths.js';
import { SpotifyAuthError, createTokenProvider, createTokenStore, runLogin, type TokenProvider } from '../spotify/auth.js';
import { createLocalController } from '../media/control.js';
import { runSync } from '../sync/runner.js';
import { acquireRunLock } from '../sync/runLock.js';
import { SourceUnavailableError, choosePlayer } from '../sync/playerSource.js';
import { VERSION } from '../version.js';
import { USAGE, UsageError, parseArgs, type CliOptions } from './args.js';

const applyCli = (config: SpolyricConfig, options: CliOptions): SpolyricConfig => {
    const next: SpolyricConfig = { ...config, lyrics: { ...config.lyrics } };
    if (options.source !== undefined) next.source = options.source;
    if (options.noControl) next.control = false;
    if (options.offsetMs !== undefined) next.lyricsOffsetMs = options.offsetMs;
    if (options.prefer) next.preferredLyricSource = options.prefer;
    if (options.clientId !== undefined) next.clientId = options.clientId.trim();
    if (options.port !== undefined) next.redirectPort = options.port;
    if (options.pollMs !== undefined) next.pollIntervalMs = options.pollMs;
    if (options.clockMs !== undefined) next.clockIntervalMs = options.clockMs;
    if (options.connection !== undefined) next.connectionFile = options.connection.trim();
    if (options.stageUrl !== undefined) next.stageBaseUrl = options.stageUrl.trim().replace(/\/+$/, '');
    if (options.stageToken !== undefined) next.stageToken = options.stageToken.trim();
    if (options.lyrics !== undefined) {
        next.lyrics = {
            spotify: options.lyrics.includes('spotify'),
            netease: options.lyrics.includes('netease'),
            qq: options.lyrics.includes('qq'),
            kugou: options.lyrics.includes('kugou'),
            lrclib: options.lyrics.includes('lrclib'),
        };
    }
    if (options.verbose) next.verbose = true;
    return next;
};

const redirectUriOf = (port: number): string => `http://127.0.0.1:${port}/callback`;

const printLoginGuide = (port: number): void => {
    const uri = redirectUriOf(port);
    console.log([
        '还差一步：Spolyric 需要一个 Spotify「开发者应用」的 Client ID（免费，只需建一次）。',
        '',
        '1. 打开 https://developer.spotify.com/dashboard ，用你的 Spotify 账号登录。',
        '2. 点「Create app」，名字随便（例如 Spolyric），Redirect URI 必须一字不差填：',
        `     ${uri}`,
        '   （Web API 一栏打勾即可，不需要填别的。）',
        '3. 建好后打开这个应用，复制 Client ID。',
        '4. 回到这里运行：',
        `     spolyric login --client-id <你的 Client ID>`,
        '',
        '说明：用你自己的应用，是因为 Folia 内置的那个 Spotify 身份不能调用 Web API（会被 429 限流）；',
        '自己的应用没有这个问题，而且 Spolyric 只申请读取播放状态的权限。',
        '',
        '注意：Spotify 现在要求**这个应用的 owner 本人有 Premium** 才允许它调用 Web API。',
        '免费账号即使登录成功，Web API 也会回 403（Active premium subscription required for the owner of the app）。',
        '这种情况不需要登录，直接用  spolyric run --source local  （Windows，读本机 Spotify 客户端的媒体会话）。',
    ].join('\n'));
};

async function loginCommand({
    config,
    dataDir,
    options,
    log,
}: {
    config: SpolyricConfig;
    dataDir: string;
    options: CliOptions;
    log: Logger;
}): Promise<number> {
    const clientId = config.clientId.trim();
    if (!clientId) {
        printLoginGuide(config.redirectPort);
        return 2;
    }
    saveConfig(dataDir, { clientId, redirectPort: config.redirectPort });
    log.info(`使用 Spotify Client ID ${clientId.slice(0, 6)}…，回调地址 ${redirectUriOf(config.redirectPort)}`);
    try {
        const credentials = await runLogin({
            clientId,
            redirectPort: config.redirectPort,
            accountsBase: config.spotifyAccountsBase,
            log,
            openBrowser: options.noOpen ? () => {} : undefined,
        });
        createTokenStore(tokenFile(dataDir)).save(credentials);
        console.log([
            '',
            '已登录 Spotify。',
            '接下来：',
            '  1. 在 Folia 里打开 设置 → 连接与集成 →「舞台模式」，来源选 Stage API；',
            '  2. 运行  spolyric run  （想让它开机就在，见 README 的「开机自启」）。',
            '',
            '如果日志出现 "Active premium subscription required for the owner of the app"，',
            '说明这个应用没有 Web API 权限（owner 需要 Premium），改用：spolyric run --source local',
        ].join('\n'));
        return 0;
    } catch (error) {
        if (error instanceof SpotifyAuthError) {
            log.error(`登录没有完成：${error.message}`);
            if (error.code === 'invalid_client' || error.code === 'listen-failed' || error.code === 'timed-out') {
                printLoginGuide(config.redirectPort);
                if (error.code === 'listen-failed') {
                    log.error(`端口 ${config.redirectPort} 被别的程序占着。换一个端口（例如 --port 9899），并把 Spotify 应用里的 Redirect URI 一起改成 http://127.0.0.1:9899/callback`);
                }
                if (error.code === 'timed-out') {
                    log.error('最常见的原因是 Spotify 应用里的 Redirect URI 和上面那行不完全一样（端口、路径、http/https 都要一致）。改好后重新运行 login。');
                }
            }
            return 1;
        }
        // A token-endpoint 5xx or a network drop after the browser said "ok": worth a retry, not a stack trace.
        log.error(`登录没有完成：${error instanceof Error ? error.message : String(error)}。稍后重试 spolyric login 即可。`);
        log.debug('the sign-in failed', error);
        return 1;
    }
}

async function runCommand({
    config,
    dataDir,
    options,
    log,
}: {
    config: SpolyricConfig;
    dataDir: string;
    options: CliOptions;
    log: Logger;
}): Promise<number> {
    const store = createTokenStore(tokenFile(dataDir));
    const stored = store.load();
    const source = config.source;

    if (source === 'web' && !stored) {
        log.error('Web API 需要登录：spolyric login --client-id <Client ID>（应用 owner 本人要有 Spotify Premium）');
        return 2;
    }
    if (source === 'local' && process.platform !== 'win32') {
        log.error('本机媒体会话只有 Windows 有；其它系统只能用 Web API（应用 owner 要有 Premium）。');
        return 2;
    }
    if (stored && config.clientId && stored.clientId !== config.clientId && source !== 'local') {
        log.error('存着的登录属于另一个 Spotify 应用，请重新登录：spolyric login --client-id <Client ID>');
        return 2;
    }

    // The local session needs no Spotify sign-in at all; `auto` keeps a sign-in only if it still works.
    let tokens: TokenProvider | undefined;
    if (source !== 'local' && stored) {
        const provider = createTokenProvider({ store, accountsBase: config.spotifyAccountsBase, log });
        try {
            await provider.ensure();
            tokens = provider;
        } catch (error) {
            if (error instanceof SpotifyAuthError && source === 'web') {
                log.error(error.code === 'invalid_grant'
                    ? 'Spotify 不再认可这份登录，请重新登录：spolyric logout && spolyric login'
                    : error.code === 'scope-missing'
                        ? '授权里缺读取播放状态的权限，请重新登录：spolyric logout，然后 spolyric login'
                        : `Spotify 登录不可用：${error.message}`);
                return 2;
            }
            if (error instanceof SpotifyAuthError) {
                log.warn(`Spotify 登录不可用（${error.message}），改用本机媒体会话`);
            } else {
                // The token endpoint may simply be unreachable right now; the stored token is tried at run time.
                log.warn('现在连不上 Spotify 的令牌接口，先用存着的 token 跑，之后会自动重试', error);
                tokens = provider;
            }
        }
    }

    const controller = new AbortController();
    const onSignal = () => {
        log.info('正在退出');
        controller.abort();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    log.info(`Spolyric ${VERSION} 开始跟随 Spotify；每 ${config.pollIntervalMs} ms 问一次${options.dryRun ? '（dry-run，不推送）' : ''}`);
    if (!options.dryRun) {
        log.info('Folia 那边需要：舞台模式打开、来源选 Stage API。没有读到连接文件时会一直等。');
    }
    const lock = acquireRunLock(dataDir);
    if (!lock) {
        log.error('同一份数据目录已经有 Spolyric 在运行（例如 Folia 模组已经拉起了一个），这份就不再重复启动。');
        return 0;
    }
    try {
        const outcome = await runSync({
            config,
            dataDir,
            tokens,
            log,
            signal: controller.signal,
            dryRun: options.dryRun,
            once: options.once,
        });
        return outcome === 'stopped' ? 0 : 1;
    } catch (error) {
        if (error instanceof SourceUnavailableError) {
            log.error(error.message);
            return 2;
        }
        throw error;
    } finally {
        lock.release();
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
    }
}

const spotifyProblemHint = (error: unknown): string | null => {
    if (!(error instanceof HttpError)) return null;
    if (error.status === 401) return '401：token 失效，重新登录（必要时先 spolyric logout）';
    if (error.status === 429) return '429：请求太频繁，把 --poll 调大，或换一个 Client ID';
    if (error.status !== 403) return null;
    const via = currentProxy();
    const proxyNote = via ? `（当前走代理 ${via.url}，来源：${via.source}）` : '（当前直连，没有用代理）';
    if (error.apiReason === 'PREMIUM_REQUIRED' || /premium/i.test(error.apiMessage)) {
        return `403 PREMIUM_REQUIRED：Spotify 把「读取播放状态」也挡住了这个账号。先 spolyric logout 再 login 试一次；仍不行就说明该账号/地区不能走 Web API 读取，需要本机媒体会话方案。${proxyNote}`;
    }
    return `403：${error.apiMessage || 'Spotify 没有说明原因（常见于网络/代理把它挡在边缘）'}。常见原因：代理没生效或被防火墙拦截、授权缺 scope（logout 后重新 login）、应用还在 Development Mode 但没有把你的账号加到 User Management。${proxyNote}`;
};

const formatTime = (milliseconds: number): string => {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

async function keyCommand({
    options,
    log,
}: {
    options: CliOptions;
    log: Logger;
}): Promise<number> {
    const action = options.keyAction;
    if (!action) {
        log.error('用法：spolyric key <play-pause|play|pause|next|prev>');
        return 2;
    }
    const controller = createLocalController({ log });
    if (!controller.available) {
        log.error('本机没有可用的媒体会话控制（只有 Windows + Spotify 桌面端支持）。');
        return 2;
    }
    const mapped = action === 'play-pause' ? 'toggle' : action;
    const ok = await controller.control(mapped);
    controller.close();
    if (!ok) {
        log.error(`Spotify 没有接受 ${action}（没在播放，或会话刚切换）。`);
        return 1;
    }
    log.info(`已发送：${action}`);
    return 0;
}

async function statusCommand({
    config,
    dataDir,
    options,
    log,
}: {
    config: SpolyricConfig;
    dataDir: string;
    options: CliOptions;
    log: Logger;
}): Promise<number> {
    const store = createTokenStore(tokenFile(dataDir));
    const stored = store.load();
    const connection = readStageConnection({
        explicitFile: config.connectionFile || null,
        explicitBaseUrl: config.stageBaseUrl || undefined,
        explicitToken: config.stageToken || undefined,
    });

    let stageState: { enabled: boolean; modeEnabled: boolean; source: string | null } | null = null;
    if (connection) {
        const stage = createStageClient({ connection, log });
        stageState = await stage.health().catch(() => null);
    }

    let nowPlaying: string | null = null;
    let spotifyHint: string | null = null;
    let sourceLabel = '未选择';
    let tokens: TokenProvider | undefined;
    if (stored && config.source !== 'local') {
        tokens = createTokenProvider({ store, accountsBase: config.spotifyAccountsBase, log });
    }
    try {
        const choice = choosePlayer({ config, tokens, log });
        try {
            const playing = await choice.player.getNowPlaying();
            const used = choice.active();
            sourceLabel = used === 'local' ? '本机媒体会话（SMTC）' : used === 'web' ? 'Spotify Web API' : 'auto（等第一次读取）';
            nowPlaying = playing.state === 'track'
                ? `${playing.track.title} — ${playing.track.artists.join(', ')} [${formatTime(playing.positionMs)} / ${formatTime(playing.track.durationMs)}] ${playing.isPlaying ? '播放中' : '已暂停'}${playing.deviceName ? ` @ ${playing.deviceName}` : ''}`
                : playing.state === 'ad' ? '（Spotify 正在放广告）' : '（没有在播放）';
        } catch (error) {
            nowPlaying = `读取失败：${error instanceof Error ? error.message : String(error)}`;
            spotifyHint = error instanceof SpotifyAuthError
                ? (error.code === 'scope-missing' ? '授权缺读取播放状态的权限：spolyric logout 后重新 login' : error.message)
                : spotifyProblemHint(error);
        } finally {
            choice.close();
        }
    } catch (error) {
        nowPlaying = `读取失败：${error instanceof Error ? error.message : String(error)}`;
        if (!(error instanceof SourceUnavailableError)) spotifyHint = spotifyProblemHint(error);
    }

    if (options.json) {
        console.log(JSON.stringify({
            dataDir,
            configFile: path.join(dataDir, 'config.json'),
            proxy: currentProxy(),
            source: { requested: config.source, used: sourceLabel },
            signedIn: Boolean(stored),
            tokenExpiresAt: stored ? new Date(stored.expiresAtMs).toISOString() : null,
            stage: connection ? { baseUrl: connection.baseUrl, filePath: connection.filePath, ...stageState } : null,
            nowPlaying,
            problem: spotifyHint,
        }, null, 2));
        return 0;
    }

    const searchedPaths = config.connectionFile
        ? [config.connectionFile, ...stageConnectionCandidates()]
        : stageConnectionCandidates();
    const lines = [
        `数据目录   ${dataDir}`,
        `代理       ${currentProxy() ? `${currentProxy()?.url}（${currentProxy()?.source}）` : '直连'}`,
        `来源       ${sourceLabel}${config.source === 'auto' ? '（auto）' : `（${config.source}）`}`,
        `Spotify    ${stored ? `已登录（token 到 ${new Date(stored.expiresAtMs).toLocaleString()}）` : '未登录（本机媒体会话不需要登录）'}`,
        connection
            ? `Folia      ${connection.baseUrl}${connection.filePath ? `  ← ${connection.filePath}` : ''}`
            : `Folia      没有找到 Stage 连接文件（Folia 里打开舞台模式 + Stage API）\n           找过：${searchedPaths.join('\n                  ')}`,
        stageState
            ? `舞台       ${stageState.modeEnabled ? '舞台模式开' : '舞台模式关'} · 来源 ${stageState.source ?? '—'}`
            : connection ? '舞台       连上了但没答话（Folia 可能刚关掉）' : null,
        `现在播放   ${nowPlaying ?? '（先登录 Spotify，或用 --source local）'}`,
        spotifyHint ? `建议       ${spotifyHint}` : null,
    ].filter((line): line is string => Boolean(line));
    console.log(lines.join('\n'));
    return 0;
}

async function configCommand({ config, dataDir, options }: { config: SpolyricConfig; dataDir: string; options: CliOptions }): Promise<number> {
    const shown = { ...config, stageToken: config.stageToken ? '（已设置）' : '' };
    if (options.json) {
        console.log(JSON.stringify({ dataDir, config: shown }, null, 2));
        return 0;
    }
    console.log(`数据目录   ${dataDir}`);
    console.log(`设置文件   ${path.join(dataDir, 'config.json')}`);
    console.log(JSON.stringify(shown, null, 4));
    return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
    let options: CliOptions;
    try {
        options = parseArgs(argv);
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(error.message);
            return 2;
        }
        throw error;
    }
    if (options.command === 'help') {
        console.log(USAGE);
        return 0;
    }
    if (options.command === 'version') {
        console.log(VERSION);
        return 0;
    }

    const loaded = loadConfig({ dataDir: resolveDataDir({}), env: process.env });
    const config = applyCli(loaded.config, options);
    const proxy = detectProxy();
    setHttpProxy(proxy);
    const log = createLogger({ verbose: config.verbose });
    log.debug(proxy ? `proxy: ${proxy.url} (${proxy.source})` : 'proxy: none, direct connection');

    switch (options.command) {
        case 'login':
            return loginCommand({ config, dataDir: loaded.dataDir, options, log });
        case 'run':
            return runCommand({ config, dataDir: loaded.dataDir, options, log });
        case 'status':
            return statusCommand({ config, dataDir: loaded.dataDir, options, log });
        case 'key':
            return keyCommand({ options, log });
        case 'logout':
            createTokenStore(tokenFile(loaded.dataDir)).clear();
            console.log('已忘掉本机存着的 Spotify 登录。');
            return 0;
        case 'config':
            return configCommand({ config, dataDir: loaded.dataDir, options });
        default:
            console.log(USAGE);
            return 0;
    }
}
