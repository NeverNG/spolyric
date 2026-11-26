// src/proxy.ts
// Node's fetch ignores the system proxy, so a machine that reaches Spotify only through Clash/V2Ray
// gets a bare 403. This finds the proxy and tunnels HTTPS through it with CONNECT.

import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export type ProxySetting = {
    /** `http://host:port`, ready for the tunnel. */
    url: string;
    /** Where it was found, for the log: `SPOLYRIC_PROXY`, `HTTPS_PROXY`, `system`. */
    source: string;
};

const withScheme = (value: string): string => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);

/** A Windows `ProxyServer` value may be `host:port` or `http=host:port;https=host:port`. */
export const registryProxyOf = (value: string): string => {
    const byProtocol = value.split(';').map(part => part.trim()).filter(Boolean);
    if (byProtocol.length > 0 && byProtocol[0]?.includes('=')) {
        const entries = new Map(byProtocol.map(part => {
            const [name, ...rest] = part.split('=');
            return [name?.trim().toLowerCase() ?? '', rest.join('=').trim()];
        }));
        return entries.get('https') ?? entries.get('http') ?? '';
    }
    return byProtocol[0] ?? '';
};

const readWindowsSystemProxy = (): string | null => {
    try {
        const settings = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        const enabled = execFileSync('reg', ['query', settings, '/v', 'ProxyEnable'], { encoding: 'utf8', timeout: 3000 });
        if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) return null;
        const server = execFileSync('reg', ['query', settings, '/v', 'ProxyServer'], { encoding: 'utf8', timeout: 3000 });
        const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(server);
        const raw = match?.[1]?.trim();
        if (!raw) return null;
        const first = registryProxyOf(raw);
        return first ? withScheme(first) : null;
    } catch {
        return null;
    }
};

/**
 * The proxy to use: `SPOLYRIC_PROXY` (or `none` to force a direct connection) wins, then the usual
 * proxy environment variables, then the Windows system setting. Elsewhere nothing is assumed.
 */
export function detectProxy({
    env = process.env,
    platform = process.platform,
    windowsProxy = readWindowsSystemProxy,
}: {
    env?: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
    windowsProxy?: () => string | null;
} = {}): ProxySetting | null {
    const explicit = env.SPOLYRIC_PROXY?.trim();
    if (explicit) {
        if (explicit.toLowerCase() === 'none' || explicit.toLowerCase() === 'off') return null;
        return { url: withScheme(explicit), source: 'SPOLYRIC_PROXY' };
    }
    const fromEnv = env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
    if (fromEnv?.trim()) return { url: withScheme(fromEnv.trim()), source: 'environment' };
    if (platform === 'win32') {
        const system = windowsProxy();
        if (system) return { url: system, source: 'Windows 系统代理' };
    }
    return null;
}

const proxyAuthHeader = (proxy: URL): Record<string, string> => {
    if (!proxy.username) return {};
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    return { 'Proxy-Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
};

/** Opens a CONNECT tunnel and hands back the raw socket. The caller wraps it in TLS for an https target. */
const openTunnel = (proxy: URL, targetHost: string, targetPort: number, callback: (error: Error | null, socket: net.Socket | null) => void): void => {
    const request = http.request({
        host: proxy.hostname,
        port: Number(proxy.port) || 80,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        headers: { Host: `${targetHost}:${targetPort}`, ...proxyAuthHeader(proxy) },
        timeout: 15_000,
    });
    request.once('connect', (response, socket) => {
        if (response.statusCode !== 200) {
            socket.destroy();
            callback(new Error(`the proxy refused the tunnel with ${response.statusCode}`), null);
            return;
        }
        callback(null, socket);
    });
    request.once('timeout', () => {
        request.destroy(new Error('the proxy did not answer in time'));
    });
    request.once('error', error => callback(error, null));
    request.end();
};

/** An agent for https targets: CONNECT through the proxy, then TLS with the target's own name. */
export function createHttpsProxyAgent(proxy: URL, options: { rejectUnauthorized?: boolean } = {}): https.Agent {
    const agent = new https.Agent({ keepAlive: true });
    agent.createConnection = ((createOptions: { host?: string; port?: number; servername?: string }, callback: (error: Error | null, socket: net.Socket | null) => void) => {
        const host = String(createOptions.host ?? '');
        const port = Number(createOptions.port) || 443;
        openTunnel(proxy, host, port, (error, socket) => {
            if (error || !socket) {
                callback(error ?? new Error('the proxy gave no socket'), null);
                return;
            }
            const tlsSocket = tls.connect({
                socket,
                servername: createOptions.servername ?? host,
                ALPNProtocols: ['http/1.1'],
                rejectUnauthorized: options.rejectUnauthorized !== false,
            }, () => callback(null, tlsSocket));
            tlsSocket.once('error', tlsError => callback(tlsError, null));
        });
    }) as unknown as typeof agent.createConnection;
    return agent;
}

/** The same for plain http targets (used by tests and by a proxy that is the only way out). */
export function createHttpProxyAgent(proxy: URL): http.Agent {
    const agent = new http.Agent({ keepAlive: true });
    agent.createConnection = ((createOptions: { host?: string; port?: number }, callback: (error: Error | null, socket: net.Socket | null) => void) => {
        openTunnel(proxy, String(createOptions.host ?? ''), Number(createOptions.port) || 80, callback);
    }) as unknown as typeof agent.createConnection;
    return agent;
}
