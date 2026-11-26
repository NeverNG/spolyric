// src/sync/playerSource.ts
// Which Spotify the words come from: the Web API (needs a Premium app owner) or this machine's Spotify
// client through SMTC. `auto` starts on the Web API and switches to the machine the first time the API
// refuses — lazily, so a run with no Folia connection does not touch Spotify at all.

import type { SpolyricConfig } from '../config.js';
import { HttpError } from '../http.js';
import type { Logger } from '../log.js';
import { createLocalPlayer } from '../media/player.js';
import { createMediaSessionReader, type MediaSessionReader } from '../media/session.js';
import { SpotifyAuthError, type TokenProvider } from '../spotify/auth.js';
import { createPlayerClient, type PlayerClient } from '../spotify/player.js';

export type PlayerChoice = {
    /** What the settings asked for; `auto` may end up on either source. */
    kind: 'web' | 'local' | 'auto';
    player: PlayerClient;
    /** One line for the log: what this source is. */
    reason: string;
    /** Which source has answered so far; null before the first call. */
    active(): 'web' | 'local' | null;
    /** Stops the media-session script, if one was started. */
    close(): void;
};

/** Thrown when the requested source cannot work here, with a sentence a listener can act on. */
export class SourceUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SourceUnavailableError';
    }
}

const reasonOf = (error: unknown): string => {
    if (error instanceof HttpError) return `HTTP ${error.status}${error.apiMessage ? `: ${error.apiMessage}` : ''}`;
    if (error instanceof Error) return error.message;
    return String(error);
};

const fallBack = (error: unknown): boolean => error instanceof HttpError || error instanceof SpotifyAuthError;

export function choosePlayer({
    config,
    tokens,
    log,
    platform = process.platform,
    now,
}: {
    config: SpolyricConfig;
    tokens?: TokenProvider;
    log: Logger;
    platform?: NodeJS.Platform;
    now?: () => number;
}): PlayerChoice {
    const webPlayer = tokens
        ? createPlayerClient({
            apiBase: config.spotifyApiBase,
            getToken: options => tokens.ensure(options).then(credentials => credentials.accessToken),
            log,
        })
        : null;

    const local = (): { player: PlayerClient; reader: MediaSessionReader } => {
        if (platform !== 'win32') {
            throw new SourceUnavailableError(
                '本机媒体会话只有 Windows 有；其它系统需要 Spotify Web API（应用 owner 本人要有 Premium）。',
            );
        }
        const reader = createMediaSessionReader({ log, intervalMs: config.pollIntervalMs, now });
        return { player: createLocalPlayer({ reader, log, now }), reader };
    };

    if (config.source === 'local') {
        const made = local();
        return {
            kind: 'local',
            player: made.player,
            reason: '本机 Spotify 的媒体会话（SMTC）',
            active: () => 'local',
            close: () => made.reader.close(),
        };
    }

    if (config.source === 'web') {
        if (!webPlayer) throw new SourceUnavailableError('还没有登录 Spotify，用不了 Web API：spolyric login');
        return {
            kind: 'web',
            player: webPlayer,
            reason: 'Spotify Web API',
            active: () => 'web',
            close: () => {},
        };
    }

    // auto: no sign-in means the machine's own session; otherwise try the API, and let the first refusal
    // switch for good (with the reason in the log).
    if (!webPlayer) {
        const made = local();
        return {
            kind: 'local',
            player: made.player,
            reason: '本机 Spotify 的媒体会话（SMTC，没有登录 Web API）',
            active: () => 'local',
            close: () => made.reader.close(),
        };
    }
    if (platform !== 'win32') {
        // No local session here, so auto is the Web API.
        return { kind: 'web', player: webPlayer, reason: 'Spotify Web API（auto）', active: () => 'web', close: () => {} };
    }

    let switched: { player: PlayerClient; reader: MediaSessionReader } | null = null;
    let used: 'web' | 'local' | null = null;
    const player: PlayerClient = {
        async getNowPlaying() {
            if (!switched) {
                try {
                    const playing = await webPlayer.getNowPlaying();
                    used = 'web';
                    return playing;
                } catch (error) {
                    if (!fallBack(error)) throw error;
                    log.warn(`Spotify Web API 不可用（${reasonOf(error)}），改用本机 Spotify 的媒体会话`);
                    switched = local();
                }
            }
            used = 'local';
            return switched.player.getNowPlaying();
        },
    };
    return {
        kind: 'auto',
        player,
        reason: 'auto（先 Web API，被拒后转本机媒体会话）',
        active: () => used,
        close: () => switched?.reader.close(),
    };
}
