// src/folia/stage.ts
// The Stage API as Spolyric uses it: push one lyrics session per track, then move its clock.

import { HttpError, fetchJson, parseJson } from '../http.js';
import type { Logger } from '../log.js';
import type { StageConnection } from './connection.js';

export class StageApiError extends Error {
    readonly path: string;
    readonly status: number;
    readonly code: string | null;
    readonly details: unknown;

    constructor(path: string, status: number, code: string | null, message: string, details: unknown) {
        super(message);
        this.name = 'StageApiError';
        this.path = path;
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export type StageActiveEntryKind = 'lyrics' | 'media';

export type StageStatus = {
    enabled: boolean;
    modeEnabled: boolean;
    source: string | null;
    activeEntryKind: StageActiveEntryKind | null;
    lyricsSession: { updatedAt: number; title?: string; artist?: string } | null;
};

export type StageLyricSource = {
    type: 'local';
    lrcContent: string;
    formatHint?: 'lrc';
};

export type StageLyricsRequest = {
    title: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    coverUrl?: string;
    lyricSource?: StageLyricSource;
    positionMs?: number;
    paused?: boolean;
};

/** What Folia's stage player is doing, as the renderer publishes it (the live stage clock, not the pushed one). */
export type StagePlayerStatus = {
    playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'UNKNOWN';
    positionMs: number;
    durationMs: number;
    sampledAtMs: number;
    canSeek: boolean;
};

export type StageClockRequest = {
    positionMs: number;
    paused?: boolean;
    durationMs?: number;
    sessionUpdatedAt?: number;
};

export type StageClient = {
    readonly baseUrl: string;
    health(): Promise<StageStatus | null>;
    status(): Promise<StageStatus>;
    /** The stage player's own state and clock; null when Folia does not answer it. */
    playerStatus(): Promise<StagePlayerStatus | null>;
    pushLyrics(request: StageLyricsRequest): Promise<{ sessionUpdatedAt: number }>;
    pushClock(request: StageClockRequest): Promise<{ sessionUpdatedAt: number }>;
    clear(): Promise<void>;
};

type ErrorPayload = { error?: unknown; code?: unknown; details?: unknown };

const messageOf = (body: string, status: number): { code: string | null; message: string } => {
    const parsed = (parseJson(body) ?? {}) as ErrorPayload;
    const code = typeof parsed.code === 'string' ? parsed.code : null;
    const said = typeof parsed.error === 'string' ? parsed.error : '';
    return { code, message: said || `Stage API answered ${status}` };
};

export function createStageClient({
    connection,
    fetchImpl = fetch,
    log,
    timeoutMs = 8000,
    signal,
}: {
    connection: StageConnection;
    fetchImpl?: typeof fetch;
    log: Logger;
    timeoutMs?: number;
    signal?: AbortSignal;
}): StageClient {
    const request = async (
        path: string,
        options: { method?: string; body?: unknown; authorized?: boolean } = {},
    ): Promise<unknown> => {
        const url = `${connection.baseUrl}${path}`;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (options.authorized !== false) headers.Authorization = `Bearer ${connection.token}`;
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        try {
            const answer = await fetchJson<unknown>(url, {
                method: options.method ?? 'GET',
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                timeoutMs,
                signal,
            }, fetchImpl);
            return answer.body;
        } catch (error) {
            if (error instanceof HttpError) {
                const { code, message } = messageOf(error.bodyText, error.status);
                if (error.status === 401) {
                    log.warn('The Stage API refused the token; Folia has probably restarted (a new connection file is written then)');
                }
                throw new StageApiError(path, error.status, code, message, (parseJson(error.bodyText) as ErrorPayload | null)?.details ?? null);
            }
            throw error;
        }
    };

    const statusOf = (body: unknown): StageStatus => {
        const answer = (body ?? {}) as Record<string, unknown>;
        const session = answer.lyricsSession && typeof answer.lyricsSession === 'object'
            ? answer.lyricsSession as { updatedAt?: unknown; title?: unknown; artist?: unknown }
            : null;
        const updatedAt = Number(session?.updatedAt);
        const shown: StageStatus['lyricsSession'] = session && Number.isFinite(updatedAt)
            ? {
                updatedAt,
                ...(typeof session.title === 'string' ? { title: session.title } : {}),
                ...(typeof session.artist === 'string' ? { artist: session.artist } : {}),
            }
            : null;
        return {
            enabled: answer.enabled === true,
            modeEnabled: answer.modeEnabled === true,
            source: typeof answer.source === 'string' ? answer.source : null,
            activeEntryKind: answer.activeEntryKind === 'lyrics' || answer.activeEntryKind === 'media' ? answer.activeEntryKind : null,
            lyricsSession: shown,
        };
    };

    return {
        baseUrl: connection.baseUrl,

        async health() {
            // A Stage that is not listening is an answer here, not a failure: the caller decides to wait.
            try {
                return statusOf(await request('/stage/health', { authorized: false }));
            } catch {
                return null;
            }
        },

        async status() {
            return statusOf(await request('/stage/status'));
        },

        async playerStatus(): Promise<StagePlayerStatus | null> {
            let body: unknown;
            try {
                body = await request('/stage/player/status');
            } catch {
                return null;
            }
            if (!body || typeof body !== 'object') return null;
            const record = body as Record<string, unknown>;
            const state = record.playerState;
            const capabilities = record.controlCapabilities && typeof record.controlCapabilities === 'object'
                ? record.controlCapabilities as Record<string, unknown>
                : {};
            const numeric = (value: unknown): number => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : -1;
            };
            return {
                playerState: state === 'PLAYING' || state === 'PAUSED' || state === 'IDLE' ? state : 'UNKNOWN',
                positionMs: Math.max(0, numeric(record.positionMs)),
                durationMs: Math.max(0, numeric(record.durationMs)),
                sampledAtMs: numeric(record.sampledAtMs),
                canSeek: capabilities.seek === true,
            };
        },

        async pushLyrics(request_) {
            const body = await request('/stage/lyrics', { method: 'POST', body: request_ });
            const session = statusOf(body).lyricsSession;
            if (!session) throw new StageApiError('/stage/lyrics', 200, 'NO_SESSION', 'Stage API did not answer a session', null);
            return { sessionUpdatedAt: session.updatedAt };
        },

        async pushClock(request_) {
            const body = await request('/stage/lyrics/clock', { method: 'POST', body: request_ }) as Record<string, unknown> | null;
            const updatedAt = Number(body?.sessionUpdatedAt);
            if (!Number.isFinite(updatedAt)) {
                throw new StageApiError('/stage/lyrics/clock', 200, 'NO_SESSION', 'Stage API did not answer a session', null);
            }
            return { sessionUpdatedAt: updatedAt };
        },

        async clear() {
            await request('/stage/state', { method: 'DELETE' });
        },
    };
}
