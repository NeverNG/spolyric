// src/http.ts
// One way to talk HTTP: a timeout, a parsed body, an error that keeps the API's own words, and a proxy
// tunnel for the machines where the API is only reachable through one.
import http from 'node:http';
import https from 'node:https';
import { createHttpProxyAgent, createHttpsProxyAgent } from './proxy.js';
export const USER_AGENT = 'Spolyric/0.1 (Folia stage companion)';
const describeAnswer = (bodyText) => {
    const parsed = parseJson(bodyText);
    const error = parsed?.error;
    if (typeof error === 'string') {
        return { message: error, reason: typeof parsed?.error_description === 'string' ? parsed.error_description : '' };
    }
    if (error && typeof error === 'object') {
        const detail = error;
        return {
            message: typeof detail.message === 'string' ? detail.message : '',
            reason: typeof detail.reason === 'string' ? detail.reason : typeof detail.code === 'string' ? detail.code : '',
        };
    }
    return { message: '', reason: '' };
};
export class HttpError extends Error {
    url;
    status;
    bodyText;
    /** Spotify's `error.message`; empty when the answer is not the API's JSON error shape. */
    apiMessage;
    /** Spotify's `error.reason` (or `error.code`), e.g. PREMIUM_REQUIRED; empty when absent. */
    apiReason;
    constructor(url, status, bodyText) {
        const said = describeAnswer(bodyText);
        const detail = said.message
            ? `: ${said.message}${said.reason ? ` (${said.reason})` : ''}`
            : said.reason ? ` (${said.reason})` : '';
        super(`${new URL(url).host} answered ${status}${detail}`);
        this.name = 'HttpError';
        this.url = url;
        this.status = status;
        this.bodyText = bodyText;
        this.apiMessage = said.message;
        this.apiReason = said.reason;
    }
    /** The error code an API put in its answer, when the answer is JSON with `error.code` or `error`. */
    codeOf() {
        const parsed = parseJson(this.bodyText);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            const error = parsed.error;
            if (typeof error === 'string')
                return error;
            if (error && typeof error === 'object' && 'code' in error) {
                const code = error.code;
                if (typeof code === 'string')
                    return code;
            }
        }
        return this.apiReason || null;
    }
}
export const parseJson = (text) => {
    if (!text.trim())
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
};
const DEFAULT_TIMEOUT_MS = 15_000;
// The proxy every request goes through, when one was found. Null means a direct connection.
let proxySetting = null;
let proxyAgents = null;
/** Sets (or clears) the proxy used by every request from now on. */
export function setHttpProxy(setting) {
    proxyAgents?.http.destroy();
    proxyAgents?.https.destroy();
    proxySetting = setting;
    proxyAgents = setting
        ? { http: createHttpProxyAgent(new URL(setting.url)), https: createHttpsProxyAgent(new URL(setting.url)) }
        : null;
}
export const currentProxy = () => proxySetting;
const headersOf = (raw) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(raw)) {
        if (Array.isArray(value))
            headers.set(name, value.join(', '));
        else if (typeof value === 'string')
            headers.set(name, value);
    }
    return headers;
};
const timeoutSignal = (timeoutMs, signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([timeout, signal]) : timeout;
};
/** The proxy path: CONNECT through the proxy, then the plain HTTP request over that tunnel. */
const requestRawThroughProxy = (url, options, timeoutMs) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const agents = proxyAgents;
    if (!agents) {
        reject(new Error('no proxy is configured'));
        return;
    }
    const request = (secure ? https : http).request({
        host: target.hostname,
        port: Number(target.port) || (secure ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        agent: secure ? agents.https : agents.http,
        headers: { 'user-agent': USER_AGENT, ...options.headers },
        timeout: timeoutMs,
        signal: timeoutSignal(timeoutMs, options.signal),
    }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
            const bytes = Buffer.concat(chunks);
            const status = response.statusCode ?? 0;
            const headers = headersOf(response.headers);
            if (status < 200 || status >= 300) {
                reject(new HttpError(url, status, bytes.toString('utf-8')));
                return;
            }
            resolve({ status, headers, bytes });
        });
    });
    request.once('error', reject);
    if (options.body !== undefined)
        request.write(options.body);
    request.end();
});
/** The same transport as `fetchJson`, for a body that is not text (an image). */
export async function fetchBytes(url, options = {}, fetchImpl = fetch) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (proxyAgents && fetchImpl === fetch)
        return requestRawThroughProxy(url, options, timeoutMs);
    const response = await fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: { 'user-agent': USER_AGENT, ...options.headers },
        body: options.body,
        signal: timeoutSignal(timeoutMs, options.signal),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok)
        throw new HttpError(url, response.status, bytes.toString('utf-8').slice(0, 500));
    return { status: response.status, headers: response.headers, bytes };
}
/**
 * Fetches a URL and reads its body as JSON. Throws `HttpError` for a status that is not 2xx, and the
 * transport error itself for a network failure, so a caller can tell "the server refused" from "nothing answered".
 * With a proxy configured, the request goes through it; `fetchImpl` (tests, stand-ins) always means a direct fetch.
 */
export async function fetchJson(url, options = {}, fetchImpl = fetch) {
    const raw = await fetchBytes(url, options, fetchImpl);
    const text = raw.bytes.toString('utf-8');
    return { status: raw.status, headers: raw.headers, body: parseJson(text), text };
}
export const isAbortError = (error) => (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
    }
    const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
});
//# sourceMappingURL=http.js.map