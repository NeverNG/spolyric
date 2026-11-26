// src/media/cover.ts
// Spotify's own album art, through the Windows media session (SMTC). `cover.exe` is the small .NET
// helper in this directory (source: coverSession.cs); it writes the thumbnail to stdout because
// PowerShell 5.1's WinRT projection cannot read the thumbnail stream.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../log.js';

export type RawCover = {
    bytes: Buffer;
    mime: string;
};

export const coverExePath = (): string => fileURLToPath(new URL('./cover.exe', import.meta.url));

const mimeOf = (bytes: Buffer): string | null => {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (bytes.length > 6 && bytes.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
    return null;
};

const read = (exe: string, timeoutMs: number): Promise<Buffer | null> => new Promise(resolve => {
    const child = spawn(exe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (bytes: Buffer | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(bytes);
    };
    const timer = setTimeout(() => {
        child.kill();
        finish(null);
    }, timeoutMs);
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.once('error', () => finish(null));
    child.once('exit', code => finish(code === 0 ? Buffer.concat(chunks) : null));
});

/**
 * Reads the current Spotify session's thumbnail. Returns null when Spotify has no thumbnail, the helper
 * is missing (not Windows), or it does not answer in time; the caller falls back to the catalogues.
 */
export async function readSpotifyCover(exePath: string, log: Logger, timeoutMs = 3000): Promise<RawCover | null> {
    if (!existsSync(exePath)) return null;
    const bytes = await read(exePath, timeoutMs);
    if (!bytes) return null;
    const mime = mimeOf(bytes);
    if (!mime || bytes.length < 1000) {
        log.debug('the Spotify thumbnail was empty or not an image', { bytes: bytes.length });
        return null;
    }
    return { bytes, mime };
}
