// src/cover/server.ts
// Folia's Stage API only accepts an http(s) cover URL (a data URL is refused with INVALID_STAGE_COVER),
// and Folia's own network may not reach an image host. So the covers Spolyric has already downloaded are
// served from a loopback-only HTTP server: 127.0.0.1, an ephemeral port, read-only, alive while it runs.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const KEY = /^[a-f0-9]{40}$/;
const FILE = /^\/cover\/([a-f0-9]{40})\.(jpg|png|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Reads the cached data URL and returns its bytes; null when the entry is gone or broken. */
const readCachedImage = (dir, key) => {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf-8'));
        if (typeof parsed.dataUrl !== 'string')
            return null;
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(parsed.dataUrl);
        if (!match)
            return null;
        const mime = match[1];
        const base64 = match[2];
        if (!mime || !base64)
            return null;
        return { mime, bytes: Buffer.from(base64, 'base64') };
    }
    catch {
        return null;
    }
};
export function createCoverServer({ dir, log }) {
    let server = null;
    let base = null;
    let starting = null;
    const start = () => {
        if (base)
            return Promise.resolve(base);
        if (starting)
            return starting;
        starting = new Promise((resolve, reject) => {
            const listener = http.createServer((request, response) => {
                const match = FILE.exec(request.url ?? '');
                if (!match || request.method !== 'GET') {
                    response.writeHead(404).end();
                    return;
                }
                const key = match[1];
                const extension = match[2];
                if (!key || !extension) {
                    response.writeHead(404).end();
                    return;
                }
                const image = KEY.test(key) ? readCachedImage(dir, key) : null;
                if (!image) {
                    log.debug(`cover request: 404 ${key.slice(0, 8)}`);
                    response.writeHead(404).end();
                    return;
                }
                log.debug(`cover request: 200 ${key.slice(0, 8)} ${image.bytes.length} bytes`);
                response.writeHead(200, {
                    'Content-Type': MIME[extension] ?? image.mime,
                    'Content-Length': image.bytes.length,
                    'Cache-Control': 'public, max-age=86400',
                });
                response.end(image.bytes);
            });
            listener.once('error', error => {
                log.warn('封面服务启动失败', error);
                starting = null;
                reject(error);
            });
            listener.listen(0, '127.0.0.1', () => {
                const address = listener.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                if (!port) {
                    listener.close();
                    starting = null;
                    reject(new Error('no loopback port'));
                    return;
                }
                server = listener;
                server.unref();
                base = `http://127.0.0.1:${port}`;
                log.debug(`cover server: ${base}`);
                resolve(base);
            });
        });
        return starting;
    };
    return {
        start,
        urlFor(key) {
            if (!base)
                throw new Error('the cover server is not listening');
            return `${base}/cover/${key}.jpg`;
        },
        close() {
            try {
                server?.close();
            }
            catch {
                // already closed
            }
            server = null;
            base = null;
            starting = null;
        },
    };
}
//# sourceMappingURL=server.js.map