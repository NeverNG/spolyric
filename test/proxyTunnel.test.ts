// test/proxyTunnel.test.ts
// A real CONNECT proxy in front of a real HTTP server: the request has to come out of the tunnel.

import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { fetchJson, setHttpProxy } from '../src/http.js';
import { startTestServer } from './helpers/server.js';

type Proxy = { url: string; connects: string[]; close(): Promise<void> };

const startTunnelProxy = (refuse = false): Promise<Proxy> => new Promise(resolve => {
    const connects: string[] = [];
    const server = http.createServer((_request, response) => response.writeHead(405).end());
    server.on('connect', (request, clientSocket, head) => {
        connects.push(request.url ?? '');
        if (refuse) {
            clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }
        const [host, port] = (request.url ?? '').split(':');
        const upstream = net.connect(Number(port), host, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length > 0) upstream.write(head);
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
        });
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
    });
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({
            url: `http://127.0.0.1:${port}`,
            connects,
            close: () => new Promise<void>(done => {
                server.closeAllConnections?.();
                server.close(() => done());
            }),
        });
    });
});

test('with a proxy, the request goes through a CONNECT tunnel', async () => {
    const target = await startTestServer(() => ({ json: { ok: true, name: 'spolyric' } }));
    const proxy = await startTunnelProxy();
    try {
        setHttpProxy({ url: proxy.url, source: 'test' });
        const answer = await fetchJson<{ ok: boolean; name: string }>(`${target.baseUrl}/v1/me/player`);
        assert.deepEqual(answer.body, { ok: true, name: 'spolyric' });
        assert.equal(target.requests.length, 1);
        assert.equal(proxy.connects.length, 1);
        assert.match(proxy.connects[0] ?? '', /^127\.0\.0\.1:\d+$/);
        // The API's own user agent goes out, not undici's.
        assert.match(target.requests[0]?.headers['user-agent'] ?? '', /^Spolyric\//);
    } finally {
        setHttpProxy(null);
        await proxy.close();
        await target.close();
    }
});

test('an error answer still becomes an HttpError through the tunnel', async () => {
    const target = await startTestServer(() => ({
        status: 403,
        json: { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } },
    }));
    const proxy = await startTunnelProxy();
    try {
        setHttpProxy({ url: proxy.url, source: 'test' });
        await assert.rejects(fetchJson(`${target.baseUrl}/v1/me/player`), (error: unknown) => {
            assert.match(String(error), /Premium required/);
            assert.match(String(error), /PREMIUM_REQUIRED/);
            return true;
        });
    } finally {
        setHttpProxy(null);
        await proxy.close();
        await target.close();
    }
});

test('a proxy that refuses the tunnel is reported, not hidden', async () => {
    const target = await startTestServer(() => ({ json: { ok: true } }));
    const proxy = await startTunnelProxy(true);
    try {
        setHttpProxy({ url: proxy.url, source: 'test' });
        await assert.rejects(fetchJson(`${target.baseUrl}/x`), /refused the tunnel with 403/);
        assert.equal(target.requests.length, 0);
    } finally {
        setHttpProxy(null);
        await proxy.close();
        await target.close();
    }
});
