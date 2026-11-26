// src/paths.ts
// Where Spolyric keeps its own files, and where Folia leaves the Stage API's connection file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HostContext = {
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
    home?: string;
};

const platformOf = (options: HostContext): NodeJS.Platform => options.platform ?? process.platform;
const envOf = (options: HostContext): Record<string, string | undefined> => options.env ?? process.env;

const homeOf = (options: HostContext): string => {
    const env = envOf(options);
    return options.home ?? env.USERPROFILE ?? env.HOME ?? os.homedir();
};

/** The directory Spolyric owns; `SPOLYRIC_HOME` moves it, which is how a test or a portable install keeps its own. */
export function resolveDataDir(options: HostContext = {}): string {
    const env = envOf(options);
    const override = env.SPOLYRIC_HOME?.trim();
    if (override) return path.resolve(override);
    const home = homeOf(options);
    switch (platformOf(options)) {
        case 'win32': {
            const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming');
            return path.join(appData, 'Spolyric');
        }
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'Spolyric');
        default: {
            const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
            return path.join(configHome, 'spolyric');
        }
    }
}

export const configFile = (dataDir: string): string => path.join(dataDir, 'config.json');

/** The Spotify token lives apart from the settings: it is written and removed more often, and never printed. */
export const tokenFile = (dataDir: string): string => path.join(dataDir, 'spotify-token.json');

export const lyricsCacheDir = (dataDir: string): string => path.join(dataDir, 'lyrics-cache');

/** Cover art downloaded for the local source; safe to delete at any time. */
export const coverCacheDir = (dataDir: string): string => path.join(dataDir, 'covers');

/** Folia's own data directory is `<userData>`; the Stage API writes `<userData>/stage/connection.json`. */
export const stageConnectionFileIn = (foliaUserDataDir: string): string => (
    path.join(foliaUserDataDir, 'stage', 'connection.json')
);

const scanFoliaDirectories = (root: string): string[] => {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory() && /^folia/i.test(entry.name))
        .map(entry => path.join(root, entry.name));
};

/**
 * Every place a Folia installation may keep its user data, most likely first. Electron names the
 * directory after the app (`Folia`), but a dev build or a portable copy can be `folia-major` or
 * something else starting with "folia", so the parent is scanned too.
 */
export function foliaUserDataCandidates(options: HostContext = {}): string[] {
    const env = envOf(options);
    const home = homeOf(options);
    const explicit = env.SPOLYRIC_FOLIA_DATA?.trim();
    if (explicit) return [path.resolve(explicit)];

    const candidates: string[] = [];
    const add = (directory: string) => {
        if (!candidates.includes(directory)) candidates.push(directory);
    };

    switch (platformOf(options)) {
        case 'win32': {
            const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming');
            add(path.join(appData, 'Folia'));
            for (const directory of scanFoliaDirectories(appData)) add(directory);
            // A portable build keeps its data beside the executable; nothing to guess there.
            break;
        }
        case 'darwin': {
            const support = path.join(home, 'Library', 'Application Support');
            add(path.join(support, 'Folia'));
            for (const directory of scanFoliaDirectories(support)) add(directory);
            break;
        }
        default: {
            // Folia prefers the runtime dir on Linux for the connection file; `stageConnectionCandidates` adds it.
            const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
            add(path.join(configHome, 'Folia'));
            for (const directory of scanFoliaDirectories(configHome)) add(directory);
            break;
        }
    }
    return candidates;
}

/** The connection files to try, in order: the runtime-dir one first on Linux, then each data directory. */
export function stageConnectionCandidates(options: HostContext = {}): string[] {
    const env = envOf(options);
    const files: string[] = [];
    const add = (file: string) => {
        if (!files.includes(file)) files.push(file);
    };
    if (platformOf(options) === 'linux') {
        const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
        if (runtimeDir && path.isAbsolute(runtimeDir)) add(path.join(runtimeDir, 'folia', 'stage.json'));
    }
    for (const directory of foliaUserDataCandidates(options)) add(stageConnectionFileIn(directory));
    return files;
}

/** The first connection file that exists, or null when the Stage API has never been switched on. */
export function findStageConnectionFile(options: HostContext & { explicit?: string | null } = {}): string | null {
    const explicit = options.explicit?.trim();
    if (explicit) return path.resolve(explicit);
    for (const file of stageConnectionCandidates(options)) {
        try {
            if (fs.statSync(file).isFile()) return file;
        } catch {
            // not there: try the next
        }
    }
    return null;
}

/** Creates the directory with the tightest permissions this system supports, and returns it. */
export function ensureDirectory(directory: string): string {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
}
