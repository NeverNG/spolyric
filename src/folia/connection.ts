// src/folia/connection.ts
// Folia writes the Stage API's address and token into a file while the API is on; this reads it.

import fs from 'node:fs';
import { findStageConnectionFile, type HostContext } from '../paths.js';

export type StageConnection = {
    /** The file it came from, or null when the address was given on the command line. */
    filePath: string | null;
    baseUrl: string;
    token: string;
    port: number | null;
    /** Folia's process id, as the file records it; null when unknown. */
    pid: number | null;
};

export type ReadConnectionOptions = HostContext & {
    /** `--connection <path>` or `SPOLYRIC_CONNECTION`. */
    explicitFile?: string | null;
    /** `SPOLYRIC_STAGE_URL`; takes the place of the file's address when both are given. */
    explicitBaseUrl?: string;
    explicitToken?: string;
};

type ConnectionFile = {
    version?: unknown;
    pid?: unknown;
    port?: unknown;
    baseUrl?: unknown;
    token?: unknown;
};

export function readStageConnection(options: ReadConnectionOptions = {}): StageConnection | null {
    const baseUrlOverride = options.explicitBaseUrl?.trim().replace(/\/+$/, '');
    const tokenOverride = options.explicitToken?.trim();

    const filePath = findStageConnectionFile({ ...options, explicit: options.explicitFile ?? null });
    if (!filePath) {
        if (baseUrlOverride && tokenOverride) {
            return { filePath: null, baseUrl: baseUrlOverride, token: tokenOverride, port: portOf(baseUrlOverride), pid: null };
        }
        return null;
    }

    let parsed: ConnectionFile;
    try {
        const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // A file holding `null` (or a string, or an array) is not a connection; throwing here would end the run.
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        parsed = raw as ConnectionFile;
    } catch {
        return null;
    }
    const fileToken = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    const fileBaseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim().replace(/\/+$/, '') : '';
    const filePort = Number(parsed.port);
    const baseUrl = baseUrlOverride || fileBaseUrl || (Number.isInteger(filePort) ? `http://127.0.0.1:${filePort}` : '');
    const token = tokenOverride || fileToken;
    if (!baseUrl || !token) return null;
    return {
        filePath,
        baseUrl,
        token,
        port: Number.isInteger(filePort) && filePort > 0 ? filePort : portOf(baseUrl),
        pid: typeof parsed.pid === 'number' ? parsed.pid : null,
    };
}

const portOf = (baseUrl: string): number | null => {
    try {
        const port = Number(new URL(baseUrl).port);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
        return null;
    }
};

/** Reads the file again only when the old one is gone (Folia writes a new token each time it starts). */
export function connectionChanged(previous: StageConnection, next: StageConnection | null): boolean {
    if (!next) return true;
    return next.baseUrl !== previous.baseUrl || next.token !== previous.token || next.filePath !== previous.filePath;
}
