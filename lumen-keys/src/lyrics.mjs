// src/lyrics.mjs
// The lyric line, laid out in 3D in front of the keys and revealed character by
// character. Unsung characters stay as dim ghosts, the active one burns, and a
// finished line drifts up and out. Layout is deterministic from the text, the
// song seed and the time, so previews and exports match the player.

import * as THREE from '../vendor/three.module.js';
import { clamp, smoothstep, hash3 } from './util.mjs';

const BASE_FONT = 0.68;
const MAX_WIDTH = 8.6;
const LINE_Y = 3.05;
const LINE_Z = 2.35;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const coreFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uStrength;
varying vec2 vUv;
void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.004) discard;
    vec3 col = uColor * (1.0 + uStrength * 0.38);
    gl_FragColor = vec4(col, a * uOpacity);
}
`;

const haloFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
    float a = texture2D(uMap, vUv).a;
    gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

/*
 * Per-character timing: word timings when the source has them (QRC / YRC /
 * enhanced LRC), otherwise the line duration spread evenly over its characters.
 */
const timingsOf = (line) => {
    const chars = Array.from(String(line.fullText ?? ''));
    const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;
    const lineStart = Math.max(0, Number(line.startTime) || 0);
    const lineEnd = Math.max(lineStart + 0.4, Number(line.endTime) || lineStart + 3);
    const timings = new Array(chars.length);

    if (words) {
        let cursor = 0;
        for (const word of words) {
            const text = Array.from(String(word.text ?? ''));
            if (text.length === 0) continue;
            let startAt = cursor;
            if (chars.slice(cursor, cursor + text.length).join('') !== text.join('')) {
                startAt = chars.indexOf(text[0], cursor);
                if (startAt < 0) continue;
            }
            const start = Number.isFinite(word.startTime) ? Number(word.startTime) : lineStart;
            const end = Math.max(start + 0.02, Number.isFinite(word.endTime) ? Number(word.endTime) : start + 0.2);
            const per = (end - start) / text.length;
            for (let index = 0; index < text.length && startAt + index < chars.length; index += 1) {
                timings[startAt + index] = { start: start + per * index, end: start + per * (index + 1) };
            }
            cursor = startAt + text.length;
        }
    }

    const per = Math.max(0.03, (lineEnd - lineStart) / Math.max(1, chars.length));
    for (let index = 0; index < chars.length; index += 1) {
        if (!timings[index]) {
            timings[index] = { start: lineStart + per * index, end: lineStart + per * (index + 1) };
        }
    }
    return { chars, timings, lineStart };
};

export const createLyrics = ({ glyphs, palette, fontScale = 1, displayScale = 1 }) => {
    const root = new THREE.Group();
    root.position.set(0, LINE_Y, LINE_Z);
    const plane = new THREE.PlaneGeometry(1, 1);
    const records = [];
    const accentScratch = new THREE.Color();
    const textScratch = new THREE.Color();
    let textColor = new THREE.Color(palette.text);
    let active = null;

    const makeMaterials = (color, map) => {
        const core = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: map },
                uColor: { value: new THREE.Color(color) },
                uOpacity: { value: 0 },
                uStrength: { value: 0 },
            },
            vertexShader: vertex,
            fragmentShader: coreFragment,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
        });
        const halo = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: map },
                uColor: { value: new THREE.Color(color) },
                uOpacity: { value: 0 },
            },
            vertexShader: vertex,
            fragmentShader: haloFragment,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        return { core, halo };
    };

    const buildLine = (line, lineIndex) => {
        const { chars, timings } = timingsOf(line);
        const group = new THREE.Group();
        group.position.set(0, 0, 0);
        const entries = [];

        let fontSize = BASE_FONT * clamp(fontScale, 0.4, 2.2) * clamp(displayScale, 0.5, 2);
        const advances = chars.map((char) => (char.trim() ? glyphs.get(char).advance : 0.55));
        let total = advances.reduce((sum, advance) => sum + advance * fontSize + 0.055, 0) - 0.055;
        if (total > MAX_WIDTH) {
            fontSize *= MAX_WIDTH / total;
            total = MAX_WIDTH;
        }
        let cursorX = -total / 2;

        chars.forEach((char, index) => {
            const timing = timings[index] ?? { start: 0, end: 0.3 };
            if (!char.trim()) {
                cursorX += 0.55 * fontSize + 0.055;
                return;
            }
            const glyph = glyphs.get(char);
            const materials = makeMaterials(palette.accent, glyph.texture);
            materials.halo.uniforms.uMap.value = glyph.glow;
            const core = new THREE.Mesh(plane, materials.core);
            const halo = new THREE.Mesh(plane, materials.halo);
            core.scale.set(fontSize, fontSize, 1);
            halo.scale.set(fontSize * 1.18, fontSize * 1.18, 1);
            const jitterX = (hash3(index, lineIndex, 11) - 0.5) * 0.16;
            const jitterY = (hash3(index, lineIndex, 23) - 0.5) * 0.95;
            const jitterZ = (hash3(index, lineIndex, 37) - 0.5) * 1.30;
            const localX = cursorX + fontSize * 0.5 + jitterX;
            core.position.set(localX, jitterY, jitterZ);
            halo.position.set(localX, jitterY, jitterZ - 0.01);
            core.renderOrder = 12;
            halo.renderOrder = 11;
            group.add(halo, core);
            entries.push({
                timing,
                core,
                halo,
                materials,
                baseX: localX,
                baseY: jitterY,
                baseZ: jitterZ,
                width: fontSize * (0.88 + hash3(index, lineIndex, 83) * 0.28),
                phase: hash3(index, lineIndex, 51) * Math.PI * 2,
                seed: hash3(index, lineIndex, 71),
                accent: new THREE.Color(palette.accent),
            });
            cursorX += glyph.advance * fontSize + 0.055;
        });

        const record = {
            line,
            lineIndex,
            group,
            entries,
            fadeStart: -1,
        };
        root.add(group);
        records.push(record);
        return record;
    };

    const disposeRecord = (record) => {
        for (const entry of record.entries) {
            entry.materials.core.dispose();
            entry.materials.halo.dispose();
        }
        record.group.removeFromParent();
        record.group.clear();
    };

    const applyPalette = (next) => {
        textColor = new THREE.Color(next.text);
        for (const record of records) {
            for (const entry of record.entries) {
                entry.accent.set(next.accent);
            }
        }
    };

    return {
        root,
        get active() {
            return active;
        },
        showLine(line, lineIndex, time) {
            if (!line || !String(line.fullText ?? '').trim()) {
                if (active) active.fadeStart = time;
                active = null;
                return;
            }
            if (active && active.lineIndex === lineIndex) return;
            if (active) active.fadeStart = time;
            active = buildLine(line, lineIndex);
            // Anything not fading is an older duplicate (a seek, a re-render).
            for (const record of records) {
                if (record !== active && record.fadeStart < 0) record.fadeStart = time;
            }
        },
        clear(time) {
            if (active) active.fadeStart = time;
            active = null;
        },
        /**
         * Characters whose start time was crossed in (from, to]: the stage turns
         * each one into an orb. The world position already includes the line's
         * camera-facing rotation, so orbs launch from where the glyph is drawn.
         */
        collectStrikes(from, to) {
            if (!active || to <= from) return [];
            root.updateMatrixWorld(true);
            const strikes = [];
            for (const entry of active.entries) {
                const start = entry.timing.start;
                if (start > from && start <= to) {
                    strikes.push({
                        position: active.group.localToWorld(new THREE.Vector3(entry.baseX, entry.baseY, entry.baseZ)),
                        seed: entry.seed,
                    });
                }
            }
            return strikes;
        },
        update(time, dt, camera, energy, chorus) {
            for (const record of records) {
                record.group.quaternion.copy(camera.quaternion);
                const fading = record.fadeStart >= 0;
                let fade = 1;
                if (fading) {
                    const progress = clamp((time - record.fadeStart) / 0.7, 0, 1);
                    fade = 1 - progress;
                    record.group.position.y = progress * 0.6;
                    record.group.position.z = -progress * 0.2;
                } else {
                    record.group.position.y = 0;
                    record.group.position.z = 0;
                }

                for (const entry of record.entries) {
                    const reveal = smoothstep(entry.timing.start - 0.10, entry.timing.start + 0.32, time);
                    const activeNow = time >= entry.timing.start - 0.05 && time <= entry.timing.end + 0.10;
                    const strike = smoothstep(entry.timing.start - 0.05, entry.timing.start + 0.08, time)
                        * Math.exp(-Math.max(0, time - entry.timing.start) * 2.6);
                    const chorusLift = chorus * (0.10 + 0.10 * entry.seed);
                    const opacity = (0.20 + reveal * 0.80) * fade;
                    const strength = clamp(reveal * 0.55 + strike * 0.9 + chorusLift, 0, 1.6);
                    const scale = 0.88 + reveal * 0.12 + strike * 0.10 + chorusLift * 0.10;

                    accentScratch.copy(entry.accent).lerp(textColor, clamp(1 - strength * 0.55, 0, 1));
                    entry.core.material.uniforms.uColor.value.copy(accentScratch);
                    entry.core.material.uniforms.uOpacity.value = opacity;
                    entry.core.material.uniforms.uStrength.value = strength;
                    entry.halo.material.uniforms.uColor.value.copy(accentScratch).lerp(textScratch.set('#ffffff'), 0.35);
                    entry.halo.material.uniforms.uOpacity.value = (0.12 + strength * 0.38 + (activeNow ? 0.05 : 0)) * fade;

                    const bob = Math.sin(time * 0.9 + entry.phase) * 0.018 + energy * 0.006;
                    const width = entry.width * scale;
                    entry.core.position.set(entry.baseX, entry.baseY + bob, entry.baseZ);
                    entry.halo.position.set(entry.baseX, entry.baseY + bob, entry.baseZ - 0.01);
                    entry.core.scale.set(width, width, 1);
                    entry.halo.scale.set(width * 1.18, width * 1.18, 1);
                    entry.core.rotation.z = Math.sin(time * 0.4 + entry.phase) * 0.01;
                    entry.halo.rotation.z = entry.core.rotation.z;
                }
            }

            for (let index = records.length - 1; index >= 0; index -= 1) {
                const record = records[index];
                if (record.fadeStart >= 0 && time - record.fadeStart > 0.8) {
                    disposeRecord(record);
                    records.splice(index, 1);
                }
            }
        },
        dispose() {
            for (const record of records) disposeRecord(record);
            records.length = 0;
            plane.dispose();
        },
    };
};
