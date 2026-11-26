// src/folia/connection.ts
// Folia writes the Stage API's address and token into a file while the API is on; this reads it.
import fs from 'node:fs';
import { findStageConnectionFile } from '../paths.js';
export function readStageConnection(options = {}) {
    const baseUrlOverride = options.explicitBaseUrl?.trim().replace(/\/+$/, '');
    const tokenOverride = options.explicitToken?.trim();
    const filePath = findStageConnectionFile({ ...options, explicit: options.explicitFile ?? null });
    if (!filePath) {
        if (baseUrlOverride && tokenOverride) {
            return { filePath: null, baseUrl: baseUrlOverride, token: tokenOverride, port: portOf(baseUrlOverride), pid: null };
        }
        return null;
    }
    let parsed;
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // A file holding `null` (or a string, or an array) is not a connection; throwing here would end the run.
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return null;
        parsed = raw;
    }
    catch {
        return null;
    }
    const fileToken = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    const fileBaseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim().replace(/\/+$/, '') : '';
    const filePort = Number(parsed.port);
    const baseUrl = baseUrlOverride || fileBaseUrl || (Number.isInteger(filePort) ? `http://127.0.0.1:${filePort}` : '');
    const token = tokenOverride || fileToken;
    if (!baseUrl || !token)
        return null;
    return {
        filePath,
        baseUrl,
        token,
        port: Number.isInteger(filePort) && filePort > 0 ? filePort : portOf(baseUrl),
        pid: typeof parsed.pid === 'number' ? parsed.pid : null,
    };
}
const portOf = (baseUrl) => {
    try {
        const port = Number(new URL(baseUrl).port);
        return Number.isInteger(port) && port > 0 ? port : null;
    }
    catch {
        return null;
    }
};
/** Reads the file again only when the old one is gone (Folia writes a new token each time it starts). */
export function connectionChanged(previous, next) {
    if (!next)
        return true;
    return next.baseUrl !== previous.baseUrl || next.token !== previous.token || next.filePath !== previous.filePath;
}
//# sourceMappingURL=connection.js.map