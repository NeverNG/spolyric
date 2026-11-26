// src/media/cover.ts
// Spotify's own album art, through the Windows media session (SMTC). `cover.exe` is the small .NET
// helper in this directory (source: coverSession.cs); SMTC's thumbnail is not reachable from
// PowerShell 5.1's WinRT projection, so a helper process reads it and writes one image file.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const coverExePath = () => fileURLToPath(new URL('./cover.exe', import.meta.url));
const mimeOf = (bytes) => {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
        return 'image/webp';
    if (bytes.length > 6 && bytes.toString('ascii', 0, 3) === 'GIF')
        return 'image/gif';
    return null;
};
const run = (exe, output, timeoutMs) => new Promise(resolve => {
    const child = spawn(exe, [output], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
        child.kill();
        resolve(false);
    }, timeoutMs);
    child.once('error', () => {
        clearTimeout(timer);
        resolve(false);
    });
    child.once('exit', code => {
        clearTimeout(timer);
        resolve(code === 0);
    });
});
/**
 * Reads the current Spotify session's thumbnail. Returns null when Spotify has no thumbnail, the helper
 * is missing (not Windows), or it does not answer in time; the caller falls back to the catalogues.
 */
export async function readSpotifyCover(exePath, outputDir, log, timeoutMs = 3000) {
    if (!existsSync(exePath))
        return null;
    const output = `${outputDir}\\cover-${process.pid}-${Date.now()}.img`;
    const ok = await run(exePath, output, timeoutMs);
    if (!ok)
        return null;
    try {
        const bytes = await readFile(output);
        const mime = mimeOf(bytes);
        if (!mime || bytes.length < 1000)
            return null;
        return { bytes, mime };
    }
    catch (error) {
        log.debug('could not read the Spotify thumbnail', error);
        return null;
    }
    finally {
        await unlink(output).catch(() => undefined);
    }
}
//# sourceMappingURL=cover.js.map