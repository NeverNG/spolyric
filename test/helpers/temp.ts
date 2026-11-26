// test/helpers/temp.ts
// A temporary data directory per test, removed afterwards.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TempDir = { dir: string; cleanup(): void };

export const makeTempDir = (prefix = 'spolyric-test-'): TempDir => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return {
        dir,
        cleanup() {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // best effort
            }
        },
    };
};
