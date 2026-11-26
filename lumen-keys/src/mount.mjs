// src/mount.mjs
// The bridge between Folia's visualizer context and the stage. Folia owns the
// clock, the frame loop and the settings; the stage only draws. Everything the
// host hands over (theme font, lyric size, audio analyser) is read once here.

import { createStage } from './stage.mjs';
import { DEFAULT_SETTINGS } from './settings.mjs';
import { clamp } from './util.mjs';

const FALLBACK_FONT = '"Songti SC","STSong","SimSun","Noto Serif SC",serif';

const readSettings = (ctx) => {
    let values = {};
    try {
        values = ctx.getSettings?.() ?? {};
    } catch {
        values = {};
    }
    return { ...DEFAULT_SETTINGS, ...values };
};

const resolveFont = (folium, ctx) => {
    try {
        const stack = folium.theme.resolveFontStack(ctx.getTheme());
        if (typeof stack === 'string' && stack.trim()) return stack;
    } catch {
        // Fall through to the built-in serif stack.
    }
    return FALLBACK_FONT;
};

export const mountLumen = (folium, container, ctx) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#33407f;';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;';
    host.appendChild(canvas);
    container.appendChild(host);

    const rect = host.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 1.5);
    const settings = readSettings(ctx);
    const fontFamily = resolveFont(folium, ctx);
    let displayScale = 1;
    try {
        displayScale = Number(ctx.getDisplay?.().lyricsFontScale) || 1;
    } catch {
        displayScale = 1;
    }

    let stage = null;
    const fail = (error) => {
        console.error('[lumen-keys] stage failed', error);
        host.replaceChildren();
        host.style.background = '#2b3573';
        const note = document.createElement('div');
        note.textContent = '流光琴键：无法创建 WebGL 画面';
        note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
            + 'color:rgba(255,255,255,0.72);font:14px/1.5 system-ui,sans-serif;text-align:center;padding:24px;';
        host.appendChild(note);
    };

    try {
        stage = createStage({
            canvas,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
            dpr,
            settings,
            paletteId: settings.palette,
            fontFamily,
            fontWeight: 400,
            lines: ctx.lines ?? [],
            seed: ctx.seed ?? ctx.song?.title ?? 'lumen',
            staticMode: Boolean(ctx.staticMode),
            staticLineIndex: ctx.staticLineIndex ?? null,
            displayScale,
            audio: ctx.audio ?? null,
            preserveDrawingBuffer: Boolean(window.__LUMEN_PREVIEW_PRESERVE__),
        });
    } catch (error) {
        fail(error);
        return () => host.remove();
    }

    let lastTimestamp = 0;
    let lastLyricTime = null;

    const frameListener = ctx.onFrame((timestamp) => {
        if (ctx.staticMode) return;
        const dt = lastTimestamp > 0 ? (timestamp - lastTimestamp) / 1000 : 1 / 60;
        lastTimestamp = timestamp;
        let time = 0;
        try {
            time = ctx.lyricTime.get();
        } catch {
            time = 0;
        }
        const paused = Boolean(ctx.isPaused?.());
        if (lastLyricTime !== null && !paused && Math.abs(time - lastLyricTime) > 0.8) {
            stage.seek(time);
        }
        lastLyricTime = time;
        let lineIndex = -1;
        try {
            lineIndex = ctx.getLineIndex();
        } catch {
            lineIndex = -1;
        }
        stage.frame(time, dt, lineIndex, paused);
    });

    const resize = (size) => {
        const nextWidth = Math.max(1, size?.width ?? host.clientWidth);
        const nextHeight = Math.max(1, size?.height ?? host.clientHeight);
        stage.resize(nextWidth, nextHeight, clamp(window.devicePixelRatio || 1, 1, 1.5));
    };
    const resizeListener = ctx.onResize(resize);

    const changeListener = ctx.onChange(() => {
        const next = readSettings(ctx);
        stage.setSettings(next);
        if (ctx.staticMode) stage.renderStatic();
    });

    if (ctx.staticMode) {
        stage.renderStatic();
    }

    return () => {
        try {
            frameListener?.();
            resizeListener?.();
            changeListener?.();
        } catch {
            // The host already tears listeners down; this is only belt and braces.
        }
        stage?.dispose();
        host.remove();
    };
};
