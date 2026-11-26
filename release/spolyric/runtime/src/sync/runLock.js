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
 * A stale lock (the process is gone) is replaced.
 */
export function acquireRunLock(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, 'run.lock');
    const held = readLock(filePath);
    if (held && held.pid !== process.pid && isAlive(held.pid))
        return null;
    fs.writeFileSync(filePath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    const release = () => {
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