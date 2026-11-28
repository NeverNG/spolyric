// src/sync/runLock.ts
// One Spolyric per data directory: the Folia mod and a hand-started run must not both drive the stage.
import fs from 'node:fs';
import path from 'node:path';
const isAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // EPERM means the process exists but belongs to someone else; anything else is gone.
        return error.code === 'EPERM';
    }
};
/** A live PID is not proof: Windows reuses PIDs, so a stale lock can point at svchost. */
const STALE_MS = 30_000;
/** The holder touches the lock this often; a killed process stops touching it. */
const HEARTBEAT_MS = 5_000;
const isStale = (filePath) => {
    try {
        return Date.now() - fs.statSync(filePath).mtimeMs > STALE_MS;
    }
    catch {
        return true;
    }
};
const readLock = (filePath) => {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const pid = Number(parsed?.pid);
        return Number.isInteger(pid) && pid > 0 ? { pid } : null;
    }
    catch {
        return null;
    }
};
/**
 * Takes `run.lock` in the data directory. Returns null when another live Spolyric already holds it.
 * A stale lock (the process is gone, or its heartbeat stopped) is replaced. The heartbeat matters on
 * Windows: a crashed Spolyric's PID can be reused by an unrelated process, and `process.kill(pid, 0)`
 * would keep the lock forever.
 */
export function acquireRunLock(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, 'run.lock');
    const held = readLock(filePath);
    if (held && held.pid !== process.pid && isAlive(held.pid) && !isStale(filePath))
        return null;
    fs.writeFileSync(filePath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    const heartbeat = setInterval(() => {
        try {
            const current = readLock(filePath);
            if (current?.pid !== process.pid) {
                clearInterval(heartbeat);
                return;
            }
            const now = new Date();
            fs.utimesSync(filePath, now, now);
        }
        catch {
            clearInterval(heartbeat);
        }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    const release = () => {
        clearInterval(heartbeat);
        try {
            const current = readLock(filePath);
            if (current?.pid === process.pid)
                fs.rmSync(filePath, { force: true });
        }
        catch {
            // already gone
        }
    };
    process.once('exit', release);
    return { filePath, release };
}
//# sourceMappingURL=runLock.js.map