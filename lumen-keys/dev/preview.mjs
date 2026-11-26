// dev/preview.mjs
// A browser harness for the stage without Folia. It feeds the same mount code a
// fake Folium context: three handwritten lyric lines with per-character
// timings, a fake analyser and a manual clock. Open with ?line=N for a still,
// or ?t=12.4 to run the animation up to that second before the screenshot.

import { mountLumen } from '../src/mount.mjs';
import { createFakeAudio } from '../src/audio.mjs';

const params = new URLSearchParams(location.search);
const errorBox = document.getElementById('error');
const showError = (error) => {
    console.error(error);
    errorBox.style.display = 'block';
    errorBox.textContent = `${error?.stack ?? error}`;
};
window.addEventListener('error', (event) => showError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => showError(event.reason));

const makeWords = (text, start, step) => Array.from(text).map((char, index) => ({
    text: char,
    startTime: start + index * step,
    endTime: start + (index + 1) * step,
}));

const LINE_SPECS = [
    { text: '心事我了', start: 2.0, step: 0.30, chorus: false },
    { text: '提笔写下的心事走过纸宣', start: 7.0, step: 0.22, chorus: true },
    { text: '透窗的月色落在琴弦上', start: 13.0, step: 0.24, chorus: false },
];

const lines = LINE_SPECS.map((spec) => ({
    fullText: spec.text,
    words: makeWords(spec.text, spec.start, spec.step),
    startTime: spec.start,
    endTime: spec.start + spec.text.length * spec.step + 1.4,
    translation: null,
    isChorus: spec.chorus,
    renderHints: {},
}));

const lineIndexAt = (time) => {
    let index = -1;
    lines.forEach((line, position) => {
        if (time >= line.startTime) index = position;
    });
    if (index >= 0 && time > lines[index].endTime + 1.6) return -1;
    return index;
};

window.__LUMEN_PREVIEW_PRESERVE__ = true;
const fakeAudio = createFakeAudio();
const frameCallbacks = [];
let time = 0;
// A still by default (deterministic screenshots); ?t= runs the clock instead.
let staticMode = !params.has('t');
let staticLineIndex = Number.parseInt(params.get('line') ?? '', 10);
if (!Number.isInteger(staticLineIndex)) staticLineIndex = 1;

const values = {
    palette: params.get('palette') ?? 'mist',
    glow: Number(params.get('glow') ?? 1),
    density: Number(params.get('density') ?? 1),
    fontScale: Number(params.get('font') ?? 1),
    cameraMotion: Number(params.get('motion') ?? 1),
    bubble: params.get('bubble') !== '0',
    reactive: true,
};

const ctx = {
    lines,
    song: { title: '流光测试', artist: 'preview' },
    seed: 'lumen-preview',
    staticMode,
    staticLineIndex: staticMode ? staticLineIndex : null,
    lyricTime: { get: () => time },
    getLineIndex: () => lineIndexAt(time),
    isPaused: () => false,
    getTheme: () => ({ fontStyle: 'serif', isDaylight: false }),
    getSettings: () => values,
    getDisplay: () => ({ lyricsFontScale: 1 }),
    audio: fakeAudio,
    onFrame: (callback) => {
        frameCallbacks.push(callback);
        return () => {};
    },
    onResize: (callback) => {
        callback({ width: window.innerWidth, height: window.innerHeight });
        const onResize = () => callback({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    },
    onChange: () => () => {},
    onLyricTime: () => () => {},
    onDispose: () => {},
};

const folium = {
    theme: {
        resolveFontStack: () => '"Songti SC","STSong","SimSun","Noto Serif SC",serif',
        resolveFontWeight: () => 400,
    },
    registries: { visualizers: { register: () => ({ unregister() {} }) } },
};

const stageHost = document.getElementById('stage');
try {
    mountLumen(folium, stageHost, ctx);
} catch (error) {
    showError(error);
}

const step = 1 / 60;
const target = Number(params.get('t'));
const run = () => {
    if (Number.isFinite(target) && target > 0) {
        // Warm up only the last few seconds (the lyric clock is what matters),
        // synchronously, then mirror the canvas into an <img>: headless Chrome
        // does not always composite a WebGL canvas drawn outside a frame.
        const warmSeconds = Math.min(3.2, target);
        const warmStart = Math.max(0, target - warmSeconds);
        const frames = Math.ceil(warmSeconds / step);
        for (let index = 0; index <= frames; index += 1) {
            time = warmStart + index * step;
            fakeAudio.tick(time);
            const stamp = index * step * 1000;
            frameCallbacks.forEach((frame) => frame(stamp));
        }
        time = target;
        // Headless Chrome does not always composite a WebGL canvas drawn outside
        // an animation frame; mirror the last frame into an <img> so the
        // screenshot always has the pixels the stage just drew.
        const previewCanvas = document.querySelector('#stage canvas');
        if (previewCanvas) {
            const url = previewCanvas.toDataURL();
            let snapshot = document.getElementById('snapshot');
            if (!snapshot) {
                snapshot = document.createElement('img');
                snapshot.id = 'snapshot';
                snapshot.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:5;';
                document.body.appendChild(snapshot);
            }
            snapshot.src = url;
        }
        return;
    }
    let last = performance.now();
    const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        time += dt;
        fakeAudio.tick(time);
        frameCallbacks.forEach((frame) => frame(now));
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
};
if (!staticMode) run();
