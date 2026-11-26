// src/media/session.ts
// Windows' media session (SMTC) as a live feed: one PowerShell process prints a JSON line per sample,
// and this reads the last one. Spotify's free accounts cannot use the Web API, but the local client
// always reports to SMTC.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import type { Logger } from '../log.js';

export type MediaSessionSnapshot = {
    /** The app that owns the session, e.g. `SpotifyAB.SpotifyMusic_...!Spotify`. */
    app: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    positionMs: number;
    isPlaying: boolean;
    /** The script's sample time, on this process's clock. */
    sampledAtMs: number;
};

export type MediaSessionReader = {
    /** False on a system without SMTC (everything but Windows), or when the script was not found. */
    readonly available: boolean;
    /** The newest sample, starting the script if it is not running; null when nothing is playing. */
    read(): MediaSessionSnapshot | null;
    close(): void;
};

export type ParsedSessionLine =
    | { kind: 'none' }
    | { kind: 'snapshot'; snapshot: Omit<MediaSessionSnapshot, 'sampledAtMs'> }
    | { kind: 'error'; message: string };

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const number = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
let gbkDecoder: TextDecoder | null = null;

/**
 * One output line as text. The script asks for UTF-8, but an older PowerShell or a system where that
 * setting is ignored can still write the console code page; GBK is the common one on Chinese Windows,
 * and decoding it here is the difference between 「披着羊皮的狼」 and 「鎶潃缇婄毊鐨勭嫾」.
 */
export function decodeSessionLine(bytes: Uint8Array): string {
    try {
        return utf8Decoder.decode(bytes);
    } catch {
        // not UTF-8
    }
    try {
        gbkDecoder ??= new TextDecoder('gbk');
        return gbkDecoder.decode(bytes);
    } catch {
        return Buffer.from(bytes).toString('utf-8');
    }
}

/** One stdout line of `readSession.ps1`. */
export function parseSessionLine(line: string): ParsedSessionLine {
    const trimmed = line.trim();
    if (!trimmed) return { kind: 'none' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return { kind: 'error', message: 'the media session script printed something that is not JSON' };
    }
    if (!parsed || typeof parsed !== 'object') return { kind: 'error', message: 'the media session script printed an empty record' };
    const record = parsed as Record<string, unknown>;
    if (record.session !== 'current') {
        return typeof record.error === 'string'
            ? { kind: 'error', message: record.error }
            : { kind: 'none' };
    }
    const title = textOf(record.title);
    if (!title) return { kind: 'none' };
    return {
        kind: 'snapshot',
        snapshot: {
            app: textOf(record.app),
            title,
            artist: textOf(record.artist),
            album: textOf(record.album),
            durationMs: Math.max(0, Math.round(number(record.durationMs))),
            positionMs: Math.max(0, Math.round(number(record.positionMs))),
            isPlaying: record.playing === true,
        },
    };
}

const scriptCandidates = (): string[] => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return [
        // The build copies the script beside the compiled file.
        path.join(here, 'readSession.ps1'),
        // Running from the repository without a copy.
        path.join(here, '..', '..', '..', 'src', 'media', 'readSession.ps1'),
    ];
};

const findScript = (explicit?: string): string | null => {
    if (explicit) return fs.existsSync(explicit) ? explicit : null;
    for (const candidate of scriptCandidates()) {
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
            // try the next
        }
    }
    return null;
};

export function createMediaSessionReader({
    platform = process.platform,
    log,
    intervalMs = 1500,
    now = Date.now,
    scriptPath,
    spawnImpl = spawn,
}: {
    platform?: NodeJS.Platform;
    log: Logger;
    intervalMs?: number;
    now?: () => number;
    scriptPath?: string;
    spawnImpl?: typeof spawn;
}): MediaSessionReader {
    const available = platform === 'win32';
    const script = available ? findScript(scriptPath) : null;
    let child: ReturnType<typeof spawn> | null = null;
    let closed = false;
    let restartTimer: NodeJS.Timeout | null = null;
    let buffer = Buffer.alloc(0);
    let latest: MediaSessionSnapshot | null = null;
    let latestAt = 0;
    let warnedNotFound = false;

    /** A sample older than a few rounds means the script stopped answering; treat the session as gone. */
    const fresh = (): MediaSessionSnapshot | null => {
        if (!latest) return null;
        if (now() - latestAt > Math.max(4000, intervalMs * 4)) return null;
        return latest;
    };

    const start = () => {
        if (closed || child || !available) return;
        if (!script) {
            if (!warnedNotFound) {
                log.warn('找不到 readSession.ps1，读不了本机媒体会话');
                warnedNotFound = true;
            }
            return;
        }
        try {
            child = spawnImpl('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', script,
                '-IntervalMs', String(Math.max(250, Math.round(intervalMs))),
            ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (error) {
            log.warn('启动媒体会话脚本失败', error);
            return;
        }
        const spawned = child;
        spawned.stdout?.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            let newline = buffer.indexOf(0x0a);
            while (newline >= 0) {
                const line = decodeSessionLine(buffer.subarray(0, newline));
                buffer = buffer.subarray(newline + 1);
                const parsed = parseSessionLine(line);
                if (parsed.kind === 'snapshot') {
                    latest = { ...parsed.snapshot, sampledAtMs: now() };
                    latestAt = now();
                } else if (parsed.kind === 'none') {
                    latest = null;
                    latestAt = now();
                } else {
                    log.debug('media session script said an error', parsed.message);
                    latest = null;
                }
                newline = buffer.indexOf(0x0a);
            }
        });
        spawned.stderr?.setEncoding('utf8');
        spawned.stderr?.on('data', (chunk: string) => {
            const message = String(chunk).trim();
            if (message) log.debug('media session script stderr', message);
        });
        spawned.once('error', error => log.warn('媒体会话脚本出错', error));
        spawned.once('exit', code => {
            if (child === spawned) child = null;
            if (closed) return;
            if (code !== 0 && code !== null) log.warn(`媒体会话脚本退出了（code ${code}），5 秒后重试`);
            latest = null;
            restartTimer?.unref();
            restartTimer = setTimeout(() => {
                restartTimer = null;
                start();
            }, 5000);
            restartTimer.unref?.();
        });
    };

    return {
        available,
        read() {
            start();
            return fresh();
        },
        close() {
            closed = true;
            if (restartTimer) {
                clearTimeout(restartTimer);
                restartTimer = null;
            }
            try {
                child?.kill();
            } catch {
                // already gone
            }
            child = null;
            latest = null;
        },
    };
}
