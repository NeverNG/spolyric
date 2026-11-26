// src/sync/playerSource.ts
// Which Spotify the words come from: the Web API (needs a Premium app owner) or this machine's Spotify
// client through SMTC. `auto` starts on the Web API and switches to the machine the first time the API
// refuses — lazily, so a run with no Folia connection does not touch Spotify at all.
import { HttpError } from '../http.js';
import { createLocalPlayer } from '../media/player.js';
import { createMediaSessionReader } from '../media/session.js';
import { SpotifyAuthError } from '../spotify/auth.js';
import { createPlayerClient } from '../spotify/player.js';
/** Thrown when the requested source cannot work here, with a sentence a listener can act on. */
export class SourceUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SourceUnavailableError';
    }
}
const reasonOf = (error) => {
    if (error instanceof HttpError)
        return `HTTP ${error.status}${error.apiMessage ? `: ${error.apiMessage}` : ''}`;
    if (error instanceof Error)
        return error.message;
    return String(error);
};
const fallBack = (error) => error instanceof HttpError || error instanceof SpotifyAuthError;
export function choosePlayer({ config, tokens, log, platform = process.platform, now, }) {
    const webPlayer = tokens
        ? createPlayerClient({
            apiBase: config.spotifyApiBase,
            getToken: options => tokens.ensure(options).then(credentials => credentials.accessToken),
            log,
        })
        : null;
    const local = () => {
        if (platform !== 'win32') {
            throw new SourceUnavailableError('本机媒体会话只有 Windows 有；其它系统需要 Spotify Web API（应用 owner 本人要有 Premium）。');
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
        if (!webPlayer)
            throw new SourceUnavailableError('还没有登录 Spotify，用不了 Web API：spolyric login');
        return {
            kind: 'web',
            player: webPlayer,
            reason: 'Spotify Web API',
            active: () => 'web',
            close: () => { },
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
        return { kind: 'web', player: webPlayer, reason: 'Spotify Web API（auto）', active: () => 'web', close: () => { } };
    }
    let switched = null;
    let used = null;
    const player = {
        async getNowPlaying() {
            if (!switched) {
                try {
                    const playing = await webPlayer.getNowPlaying();
                    used = 'web';
                    return playing;
                }
                catch (error) {
                    if (!fallBack(error))
                        throw error;
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
//# sourceMappingURL=playerSource.js.map