// src/track.mjs
// The keys are fixed panels: perpendicular to the screen, no tilt, floating in
// two lanes. The rail is invisible; only the keys and their lyric labels show.
// The stage spawns key groups on melody onsets and kicks a key when the ball
// hits it.

import * as THREE from '../vendor/three.module.js';
import { hashString } from './util.mjs';

const POOL = 44;
const KEY_X = 1.85;
const BEHIND = 4.5;

const keyVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const keyFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uPress;
uniform float uGlow;
varying vec2 vUv;
float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
void main() {
    vec2 p = (vUv - 0.5) * vec2(2.0, 1.0);
    float d = sdRound(p, vec2(0.94, 0.84), 0.40);
    float mask = 1.0 - smoothstep(-0.03, 0.03, d);
    if (mask < 0.02) discard;
    float y01 = vUv.y;
    vec3 col = uColor * mix(0.74, 0.99, y01);
    col += vec3(0.95, 0.97, 1.0) * smoothstep(0.965, 1.0, y01) * 0.15;
    vec2 c = (vUv - 0.5) * 2.0;
    col += uGlow * uPress * vec3(1.0, 0.86, 0.66) * exp(-dot(c, c) * 2.2) * 0.65;
    gl_FragColor = vec4(col, mask);
}
`;

const charVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const charFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

export const createTrack = ({ palette, glyphs, fontScale = 1 }) => {
    const group = new THREE.Group();
    const plane = new THREE.PlaneGeometry(1, 1);
    const slots = [];
    const active = new Set();
    let spawnCount = 0;

    const makeSlot = () => {
        const slot = { group: new THREE.Group(), label: new THREE.Group(), data: null, press: 0 };
        slot.group.visible = false;
        slot.label.visible = false;

        slot.keyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(palette.keys[0]) },
                uPress: { value: 0 },
                uGlow: { value: 1 },
            },
            vertexShader: keyVertex,
            fragmentShader: keyFragment,
            transparent: true,
            depthWrite: true,
            side: THREE.DoubleSide,
        });
        slot.key = new THREE.Mesh(plane, slot.keyMaterial);
        slot.key.scale.set(1.0, 0.42, 1);
        slot.key.renderOrder = 4;
        slot.group.add(slot.key);

        slot.charMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: null },
                uColor: { value: new THREE.Color(palette.text) },
                uOpacity: { value: 1 },
            },
            vertexShader: charVertex,
            fragmentShader: charFragment,
            transparent: true,
            depthWrite: false,
        });
        slot.char = new THREE.Mesh(plane, slot.charMaterial);
        slot.char.scale.set(0.56, 0.56, 1);
        slot.char.renderOrder = 6;
        slot.label.add(slot.char);

        slot.haloMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: null },
                uColor: { value: new THREE.Color(palette.accent) },
                uOpacity: { value: 0 },
            },
            vertexShader: charVertex,
            fragmentShader: charFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        slot.halo = new THREE.Mesh(plane, slot.haloMaterial);
        slot.halo.scale.set(0.82, 0.82, 1);
        slot.halo.renderOrder = 5;
        slot.label.add(slot.halo);

        group.add(slot.group, slot.label);
        return slot;
    };
    for (let index = 0; index < POOL; index += 1) slots.push(makeSlot());

    const spawn = ({ y, side, char = null, strength = 0.5 }) => {
        let slot = slots.find((candidate) => !candidate.data);
        if (!slot) {
            slot = slots.reduce((best, candidate) => (candidate.data && candidate.data.y > best.data.y ? candidate : best), slots[0]);
            active.delete(slot.data);
        }
        spawnCount += 1;
        slot.group.position.set(side * KEY_X, y, 0);
        slot.group.rotation.set(0, 0, 0);
        slot.keyMaterial.uniforms.uColor.value.set(palette.keys[spawnCount % palette.keys.length]);
        slot.keyMaterial.uniforms.uPress.value = 0;
        slot.keyMaterial.uniforms.uGlow.value = 0.9 + strength * 0.4;
        slot.press = 0;
        slot.label.position.set(side * KEY_X, y + 0.62, 0.14);
        if (char) {
            const glyph = glyphs.get(char);
            slot.char.visible = true;
            slot.halo.visible = true;
            slot.charMaterial.uniforms.uMap.value = glyph.texture;
            slot.haloMaterial.uniforms.uMap.value = glyph.glow;
            const size = 0.56 * clampFont(fontScale);
            slot.char.scale.set(size, size, 1);
            slot.halo.scale.set(size * 1.45, size * 1.45, 1);
        } else {
            slot.char.visible = false;
            slot.halo.visible = false;
        }
        slot.group.visible = true;
        slot.label.visible = Boolean(char);
        const data = {
            y,
            side,
            char,
            strength,
            slot,
            hit: false,
            hitTime: null,
            kick: 0,
            index: spawnCount,
            baseX: side * KEY_X,
        };
        slot.data = data;
        active.add(data);
        return data;
    };

    const release = (slot) => {
        if (slot.data) active.delete(slot.data);
        slot.data = null;
        slot.group.visible = false;
        slot.label.visible = false;
    };

    const update = (now, cameraY, energy, chorus, dt = 1 / 60) => {
        for (const slot of slots) {
            if (!slot.data) continue;
            const data = slot.data;
            if (data.y > cameraY + BEHIND) {
                release(slot);
                continue;
            }
            slot.press *= Math.exp(-dt * 8);
            data.kick *= Math.exp(-dt * 7);
            const flash = data.hit && data.hitTime !== null ? Math.exp(-(now - data.hitTime) * 2.4) : 0;
            slot.keyMaterial.uniforms.uPress.value = Math.max(slot.press, flash * 0.9);
            slot.keyMaterial.uniforms.uGlow.value = 0.9 + energy * 0.3 + chorus * 0.12;
            slot.charMaterial.uniforms.uOpacity.value = data.hit ? 1.0 : 0.5 + flash * 0.5;
            slot.haloMaterial.uniforms.uOpacity.value = 0.05 + flash * 0.55 + chorus * 0.1;
            slot.charMaterial.uniforms.uColor.value.set(palette.text);
            slot.haloMaterial.uniforms.uColor.value.set(palette.accent);
            // The key is kicked outwards and slightly back when hit, then settles.
            slot.group.position.x = data.baseX + data.side * data.kick * 0.24;
            slot.group.position.z = -data.kick * 0.16;
            slot.label.position.x = data.baseX + data.side * data.kick * 0.24;
            slot.label.position.z = 0.14 - data.kick * 0.16;
        }
    };

    const press = (data, now) => {
        if (!data) return;
        data.hit = true;
        data.hitTime = now;
        data.kick = 1;
        if (data.slot) data.slot.press = 1;
    };

    return {
        group,
        spawn,
        press,
        update,
        active: () => [...active],
        clear: () => {
            for (const slot of slots) release(slot);
            active.clear();
        },
        setPalette: () => {},
        setFontScale: (value) => {
            for (const slot of slots) {
                if (!slot.data) continue;
                const size = 0.56 * clampFont(value);
                slot.char.scale.set(size, size, 1);
                slot.halo.scale.set(size * 1.45, size * 1.45, 1);
            }
        },
        dispose: () => {
            plane.dispose();
            for (const slot of slots) {
                slot.keyMaterial.dispose();
                slot.charMaterial.dispose();
                slot.haloMaterial.dispose();
            }
        },
    };
};

const clampFont = (value) => Math.min(1.8, Math.max(0.5, Number(value) || 1));
