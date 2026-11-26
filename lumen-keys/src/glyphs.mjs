// src/glyphs.mjs
// Canvas-drawn lyric glyphs. A character is rasterised once into a small canvas
// and uploaded as one texture; the halo layer re-samples that texture with a
// few offsets in its own shader, so no second blur canvas or per-frame blur
// pass is needed. Textures are cached and evicted least-recently-used.

import * as THREE from '../vendor/three.module.js';

const CACHE_LIMIT = 64;
const CANVAS_SIZE = 192;
const FONT_SIZE = 150;

/**
 * @param {{ family: string, weight?: number|string }} font
 */
export const createGlyphCache = ({ family, weight = 400 }) => {
    const font = `${weight} ${FONT_SIZE}px ${family}`;
    const measureCanvas = document.createElement('canvas');
    const measure = measureCanvas.getContext('2d');
    measure.font = font;

    const cache = new Map();
    let disposed = false;

    const advanceOf = (char) => {
        const width = measure.measureText(char).width || FONT_SIZE * 0.5;
        return width / FONT_SIZE;
    };

    const drawGlyph = (context, char) => {
        context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        context.font = font;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#ffffff';
        // Centre the ink, not the em box: a scaled halo around the glyph centre
        // then glows evenly instead of sliding upwards.
        const metrics = context.measureText(char);
        const ascent = metrics.actualBoundingBoxAscent ?? FONT_SIZE * 0.82;
        const descent = metrics.actualBoundingBoxDescent ?? FONT_SIZE * 0.18;
        context.fillText(char, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + (ascent - descent) / 2);
    };

    const toTexture = (canvas) => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        return texture;
    };

    const paint = (char) => {
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        const context = canvas.getContext('2d');
        drawGlyph(context, char);
        const texture = toTexture(canvas);

        // A baked halo: shadowBlur draws the soft aura once, so the halo layer
        // is one texture fetch instead of a ring of offset taps that would
        // print visible copies of the glyph.
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = CANVAS_SIZE;
        glowCanvas.height = CANVAS_SIZE;
        const glowContext = glowCanvas.getContext('2d');
        glowContext.font = font;
        glowContext.textAlign = 'center';
        glowContext.textBaseline = 'middle';
        glowContext.fillStyle = 'rgba(255,255,255,0.9)';
        glowContext.filter = 'blur(14px)';
        const metrics = glowContext.measureText(char);
        const ascent = metrics.actualBoundingBoxAscent ?? FONT_SIZE * 0.82;
        const descent = metrics.actualBoundingBoxDescent ?? FONT_SIZE * 0.18;
        const baseline = CANVAS_SIZE / 2 + (ascent - descent) / 2;
        glowContext.fillText(char, CANVAS_SIZE / 2, baseline);
        glowContext.fillText(char, CANVAS_SIZE / 2, baseline);
        const glow = toTexture(glowCanvas);
        return { texture, glow };
    };

    return {
        /** @returns {{ texture: THREE.Texture, advance: number }} */
        get(char) {
            const hit = cache.get(char);
            if (hit) {
                cache.delete(char);
                cache.set(char, hit);
                return hit;
            }
            const entry = { ...paint(char), advance: advanceOf(char) };
            cache.set(char, entry);
            while (cache.size > CACHE_LIMIT) {
                const oldest = cache.keys().next().value;
                cache.get(oldest).texture.dispose();
                cache.get(oldest).glow.dispose();
                cache.delete(oldest);
            }
            return entry;
        },
        get size() {
            return cache.size;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const entry of cache.values()) {
                entry.texture.dispose();
                entry.glow.dispose();
            }
            cache.clear();
        },
    };
};
