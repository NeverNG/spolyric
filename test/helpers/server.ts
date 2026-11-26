// test/helpers/server.ts
// A real HTTP server on the loopback for tests that go through fetch.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Route = (request: http.IncomingMessage, body: string) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | void;

export type TestServer = {
    baseUrl: string;
    requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[];
    close(): Promise<void>;
};

export async function startTestServer(route: Route): Promise<TestServer> {
    const requests: TestServer['requests'] = [];
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            requests.push({ method: request.method ?? 'GET', url: request.url ?? '/', headers: request.headers, body });
            let answer: ReturnType<Route>;
            try {
                answer = route(request, body);
            } catch (error) {
                response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) }));
                return;
            }
            if (!answer) {
                response.writeHead(204).end();
                return;
            }
            const headers = { 'Content-Type': 'application/json', ...answer.headers };
            response.writeHead(answer.status ?? 200, headers).end(answer.text ?? JSON.stringify(answer.json ?? {}));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise<void>(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        }),
    };
}
