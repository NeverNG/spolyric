// dev/serve.mjs
// A tiny static server for the preview page. Chrome refuses ES modules over
// file://, so the harness needs an origin; this only listens on loopback.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.LUMEN_PORT ?? 8787);
const types = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
};

http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(url.pathname);
        const relative = normalize(pathname === '/' ? '/dev/preview.html' : pathname).replace(/^([/\\])+/, '');
        const file = join(root, relative);
        if (!file.startsWith(root)) {
            response.writeHead(403).end('forbidden');
            return;
        }
        const body = await readFile(file);
        response.writeHead(200, {
            'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        response.end(body);
    } catch {
        response.writeHead(404).end('not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`preview: http://127.0.0.1:${port}/dev/preview.html`);
});
