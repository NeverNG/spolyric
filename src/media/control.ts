// src/media/control.ts
// Transport commands for the local Spotify client, through the same SMTC session the reader uses.
// One long-lived PowerShell process answers requests over stdin: a button press costs a line instead of a
// PowerShell start-up, which is most of the delay a listener feels. A command that times out kills the
// process, and the next command starts a fresh one.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../log.js';

export type ControlAction = 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek';

export type LocalController = {
    readonly available: boolean;
    /** Resolves to whether Spotify accepted the command. */
    control(action: ControlAction, positionMs?: number): Promise<boolean>;
    /** Starts the long-lived command process ahead of the first press. */
    warm(): void;
    /** Stops the long-lived command process, if one is running. */
    close(): void;
};

export type ControlAnswer = { ok: boolean; status?: string; reason?: string };

/** The command script's one JSON line. */
export function parseControlAnswer(text: string): ControlAnswer | null {
    const line = text.split('\n').map(part => part.trim()).filter(Boolean).reverse().find(part => part.startsWith('{'));
    if (!line) return null;
    try {
        const parsed = JSON.parse(line) as { ok?: unknown; status?: unknown; reason?: unknown };
        // Only a real boolean counts; anything else is a broken answer, not a success.
        if (typeof parsed.ok !== 'boolean') return null;
        return {
            ok: parsed.ok,
            ...(typeof parsed.status === 'string' ? { status: parsed.status } : {}),
            ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
        };
    } catch {
        return null;
    }
}

const scriptCandidates = (): string[] => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return [
        path.join(here, 'controlSession.ps1'),
        path.join(here, '..', '..', '..', 'src', 'media', 'controlSession.ps1'),
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

type Pending = {
    resolve: (ok: boolean) => void;
    timer: NodeJS.Timeout;
};

export function createLocalController({
    platform = process.platform,
    log,
    scriptPath,
    spawnImpl = spawn,
    timeoutMs = 5_000,
}: {
    platform?: NodeJS.Platform;
    log: Logger;
    scriptPath?: string;
    spawnImpl?: typeof spawn;
    timeoutMs?: number;
}): LocalController {
    const available = platform === 'win32';
    const script = available ? findScript(scriptPath) : null;

    let child: ReturnType<typeof spawn> | null = null;
    let buffer = '';
    let pending: Pending[] = [];
    let closed = false;
    let queue: Promise<boolean> = Promise.resolve(false);
    let starting: Promise<boolean> | null = null;

    const settleAll = (ok: boolean) => {
        const waiting = pending;
        pending = [];
        for (const entry of waiting) {
            clearTimeout(entry.timer);
            entry.resolve(ok);
        }
    };

    const stop = () => {
        const running = child;
        child = null;
        starting = null;
        buffer = '';
        if (running) {
            try {
                running.kill();
            } catch {
                // already gone
            }
        }
        settleAll(false);
    };

    const start = (): Promise<boolean> => {
        if (child) return Promise.resolve(true);
        if (closed || !available || !script) return Promise.resolve(false);
        if (starting) return starting;
        starting = new Promise<boolean>(resolve => {
            let settled = false;
            const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                resolve(ok);
            };
            let spawned: ReturnType<typeof spawn>;
            try {
                spawned = spawnImpl('powershell.exe', [
                    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                    '-File', script,
                    '-Serve',
                ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            } catch (error) {
                log.warn('启动播放控制脚本失败', error);
                starting = null;
                finish(false);
                return;
            }
            child = spawned;
            spawned.stdout?.setEncoding('utf8');
            spawned.stdout?.on('data', (chunk: string) => {
                buffer += chunk;
                let newline = buffer.indexOf('\n');
                while (newline >= 0) {
                    const line = buffer.slice(0, newline).replace(/\r$/, '');
                    buffer = buffer.slice(newline + 1);
                    newline = buffer.indexOf('\n');
                    if (!line.trim()) continue;
                    const answer = parseControlAnswer(line);
                    const entry = pending.shift();
                    if (!entry) continue;
                    clearTimeout(entry.timer);
                    if (!answer) {
                        log.debug('playback control: the answer was not JSON', line.slice(0, 120));
                        entry.resolve(false);
                        continue;
                    }
                    if (!answer.ok) log.debug('playback control was refused', answer.reason ?? answer.status ?? 'no reason');
                    entry.resolve(answer.ok);
                }
            });
            spawned.stderr?.setEncoding('utf8');
            spawned.stderr?.on('data', (chunk: string) => log.debug('playback control stderr', chunk.trim()));
            spawned.once('error', error => {
                log.warn('播放控制脚本出错', error);
                if (child === spawned) stop();
                finish(false);
            });
            spawned.once('exit', code => {
                if (child === spawned) {
                    child = null;
                    starting = null;
                    log.debug(`playback control process exited (${code})`);
                    settleAll(false);
                }
            });
            // The script prints nothing at start-up; send a harmless first request later. A successful
            // spawn is assumed once the process object exists, and a dead one shows up on the first send.
            finish(true);
        });
        return starting;
    };

    const send = (action: ControlAction, positionMs: number): Promise<boolean> => new Promise<boolean>(resolve => {
        if (!child?.stdin?.writable) {
            resolve(false);
            return;
        }
        const timer = setTimeout(() => {
            log.warn('播放控制脚本超时');
            stop();
            resolve(false);
        }, timeoutMs);
        timer.unref?.();
        pending.push({ resolve, timer });
        try {
            child.stdin.write(`${JSON.stringify({ action, seekMs: Math.max(0, Math.round(positionMs)) })}\n`);
        } catch (error) {
            log.debug('could not write to the playback control process', error);
            stop();
            resolve(false);
        }
    });

    const run = async (action: ControlAction, positionMs: number): Promise<boolean> => {
        if (!await start()) return false;
        return send(action, positionMs);
    };

    return {
        available: available && Boolean(script),
        control(action, positionMs = 0) {
            if (!available || !script) return Promise.resolve(false);
            const next = queue.then(() => run(action, positionMs), () => run(action, positionMs));
            queue = next.catch(() => false);
            return next;
        },
        warm() {
            if (!available || !script) return;
            void start().catch(() => false);
        },
        close() {
            closed = true;
            stop();
        },
    };
}
