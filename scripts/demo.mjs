#!/usr/bin/env node
// scripts/demo.mjs
// 不登录 Spotify 也能看到效果：起一个假的 Spotify + 假的歌词库，让 Spolyric 照常往 Folia 舞台推送。
// 用法：npm run build && node scripts/demo.mjs [--connection <Folia 的 connection.json>] [--verbose]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'dist', 'src', 'main.js');
if (!fs.existsSync(cli)) {
    console.error('先构建：npm run build');
    process.exit(2);
}

const TRACK_SECONDS = 90;
const TRACKS = [
    { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Demo One — Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody' },
    { id: '7qiZfU4dY1lWllzX7mPBI3', title: 'Demo Two — Shape of You', artist: 'Ed Sheeran', album: '÷' },
    { id: '0VjIjW4GlUZAMYd2vXMi3b', title: 'Demo Three — Blinding Lights', artist: 'The Weeknd', album: 'After Hours' },
];

const listen = handler => new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
});

const started = Date.now();
const current = () => {
    const elapsed = Date.now() - started;
    const index = Math.floor(elapsed / (TRACK_SECONDS * 1000)) % TRACKS.length;
    return { track: TRACKS[index], position: elapsed % (TRACK_SECONDS * 1000) };
};

const lrcFor = (title) => {
    const lines = [];
    for (let at = 0; at < TRACK_SECONDS; at += 4) {
        const minutes = Math.floor(at / 60);
        const seconds = String(at % 60).padStart(2, '0');
        lines.push(`[${String(minutes).padStart(2, '0')}:${seconds}.00]${title.split(' — ').pop()} · 第 ${at / 4 + 1} 句 demo 歌词`);
    }
    return lines.join('\n');
};

const spotify = await listen((request, response) => {
    const { track, position } = current();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
        is_playing: true,
        progress_ms: position,
        currently_playing_type: 'track',
        device: { name: 'Spolyric demo' },
        item: {
            id: track.id,
            type: 'track',
            name: track.title,
            duration_ms: TRACK_SECONDS * 1000,
            artists: [{ name: track.artist }],
            album: { name: track.album, images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273demo', width: 640 }] },
        },
    }));
});

const lyrics = await listen((request, response) => {
    if ((request.url ?? '').startsWith('/api/get')) {
        const { track } = current();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ syncedLyrics: lrcFor(track.title), duration: TRACK_SECONDS }));
        return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 404, name: 'TrackNotFound' }));
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spolyric-demo-'));
const base = `http://127.0.0.1:${spotify.address().port}`;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    pollIntervalMs: 500,
    clockIntervalMs: 3000,
    spotifyApiBase: base,
    lrclibBase: `http://127.0.0.1:${lyrics.address().port}`,
    lyrics: { spotify: false, lrclib: true },
}, null, 4));
fs.writeFileSync(path.join(home, 'spotify-token.json'), JSON.stringify({
    accessToken: 'demo', refreshToken: 'demo', expiresAtMs: Date.now() + 86_400_000, scope: '', clientId: 'demo',
}));

const extra = process.argv.slice(2);
console.log([
    '',
    'Spolyric 演示（不连真的 Spotify，也不会有人登录）',
    '',
    '请确认 Folia 里：设置 → 连接与集成 → 打开「舞台模式」→ 来源选 Stage API。',
    '然后看着 Folia 的舞台：每 90 秒换一首 demo 歌，歌词每 4 秒一句。',
    '按 Ctrl+C 结束。',
    '',
].join('\n'));

const child = spawn(process.execPath, [cli, 'run', ...extra], {
    stdio: 'inherit',
    env: { ...process.env, SPOLYRIC_HOME: home },
});

const cleanup = () => {
    try { child.kill(); } catch { /* already gone */ }
    spotify.close();
    lyrics.close();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.once('SIGINT', () => { cleanup(); process.exit(0); });
process.once('SIGTERM', () => { cleanup(); process.exit(0); });
child.once('exit', code => { cleanup(); process.exit(code ?? 0); });
