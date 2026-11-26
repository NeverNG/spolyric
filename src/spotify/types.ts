// src/spotify/types.ts
// What Spolyric needs to know about one moment of Spotify playback, and nothing else.

export type NowPlayingTrack = {
    /** Spotify's track id; for a file in the listener's own library there is none, and the name stands in. */
    id: string;
    kind: 'track' | 'episode';
    title: string;
    /** Track artists; for a podcast episode, the show it belongs to. */
    artists: string[];
    album: string;
    durationMs: number;
    coverUrl: string | null;
};

export type NowPlaying =
    | { state: 'idle'; deviceName: string | null }
    | {
        state: 'ad';
        deviceName: string | null;
        /**
         * The ad's own length and position, when the source reports them. Folia's stage runs its
         * clock over the ad instead of over the song, so the progress bar counts the ad down and
         * the visualizers take the reset as a new, lyric-less song.
         */
        durationMs?: number;
        positionMs?: number;
    }
    | {
        state: 'track';
        track: NowPlayingTrack;
        isPlaying: boolean;
        /** Where the listener is, at `sampledAtMs`. */
        positionMs: number;
        sampledAtMs: number;
        deviceName: string | null;
    };

export type SpotifyCredentials = {
    accessToken: string;
    refreshToken: string;
    /** Milliseconds since the epoch; a token is renewed a minute before this. */
    expiresAtMs: number;
    scope: string;
    clientId: string;
};
