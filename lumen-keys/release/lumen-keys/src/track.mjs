// src/track.mjs
// Keys are real boxes fixed to the wall by their back face: a cuboid sticks out
// of the wall toward the viewer. When the ball hits one, the box rocks on its
// fixed edge (a damped spring) and flashes. No rail is drawn at all.

import * as THREE from '../vendor/three.module.js';

const POOL = 44;
const KEY_X = 1.85;
const BEHIND = 4.5;
const WALL_Z = -2.0;
const KEY_DEPTH = 0.78;

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
    const boxGeometry = new THREE.BoxGeometry(1.1, 0.42, KEY_DEPTH, 1, 1, 1);
    const slots = [];
    const active = new Set();
    let spawnCount = 0;

    const makeSlot = () => {
        const slot = { pivot: new THREE.Group(), label: new THREE.Group(), data: null, press: 0 };
        slot.pivot.visible = false;
        slot.label.visible = false;

        slot.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(palette.keys[0]),
            roughness: 0.42,
            metalness: 0.06,
            emissive: new THREE.Color(palette.accent),
            emissiveIntensity: 0.06,
        });
        slot.box = new THREE.Mesh(boxGeometry, slot.material);
        slot.box.position.set(0, 0, KEY_DEPTH * 0.5);
        slot.box.castShadow = true;
        slot.box.receiveShadow = true;
        slot.pivot.add(slot.box);

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

        group.add(slot.pivot, slot.label);
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
        slot.pivot.position.set(side * KEY_X, y, WALL_Z);
        slot.pivot.rotation.set(0, 0, 0);
        slot.material.color.set(palette.keys[spawnCount % palette.keys.length]);
        slot.material.emissiveIntensity = 0.06 + strength * 0.08;
        slot.press = 0;
        slot.label.position.set(side * (KEY_X + 0.92), y + 0.10, WALL_Z + KEY_DEPTH + 0.55);
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
        slot.pivot.visible = true;
        slot.label.visible = Boolean(char);
        const data = {
            y,
            side,
            char,
            strength,
            slot,
            hit: false,
            hitTime: null,
            index: spawnCount,
            baseX: side * KEY_X,
            angle: 0,
            angleVel: 0,
            roll: 0,
            rollVel: 0,
        };
        slot.data = data;
        active.add(data);
        return data;
    };

    const release = (slot) => {
        if (slot.data) active.delete(slot.data);
        slot.data = null;
        slot.pivot.visible = false;
        slot.label.visible = false;
    };

    const update = (now, cameraY, energy, chorus, dt = 1 / 60) => {
        // Springy vibration: a stiff spring back to the wall with damping.
        const stiffness = 150;
        const damping = 7.5;
        for (const slot of slots) {
            if (!slot.data) continue;
            const data = slot.data;
            if (data.y > cameraY + BEHIND) {
                release(slot);
                continue;
            }
            data.angleVel += (-stiffness * data.angle - damping * data.angleVel) * dt;
            data.angle += data.angleVel * dt;
            data.rollVel += (-stiffness * 0.7 * data.roll - damping * data.rollVel) * dt;
            data.roll += data.rollVel * dt;
            slot.pivot.rotation.x = data.angle;
            slot.pivot.rotation.z = data.roll;

            slot.press *= Math.exp(-dt * 8);
            const flash = data.hit && data.hitTime !== null ? Math.exp(-(now - data.hitTime) * 3.2) : 0;
            slot.material.emissiveIntensity = 0.04 + flash * 0.35 + energy * 0.05 + chorus * 0.03;
            slot.charMaterial.uniforms.uOpacity.value = data.hit ? 1.0 : 0.5 + flash * 0.5;
            slot.haloMaterial.uniforms.uOpacity.value = 0.05 + flash * 0.6 + chorus * 0.08;
            slot.charMaterial.uniforms.uColor.value.set(palette.text);
            slot.haloMaterial.uniforms.uColor.value.set(palette.accent);
        }
    };

    const press = (data, now, strength = 1) => {
        if (!data) return;
        data.hit = true;
        data.hitTime = now;
        data.angleVel += (5.5 + strength * 3.5);
        data.rollVel += (Math.random() - 0.5) * 4.0;
        if (data.slot) data.slot.press = 1;
    };

    return {
        group,
        wallZ: WALL_Z,
        keyDepth: KEY_DEPTH,
        spawn,
        press,
        update,
        active: () => [...active],
        clear: () => {
            for (const slot of slots) release(slot);
            active.clear();
        },
        setPalette: (next) => {
            for (const slot of slots) {
                if (slot.data) slot.material.emissive.set(next.accent);
            }
        },
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
            boxGeometry.dispose();
            for (const slot of slots) {
                slot.material.dispose();
                slot.charMaterial.dispose();
                slot.haloMaterial.dispose();
            }
        },
    };
};

const clampFont = (value) => Math.min(1.8, Math.max(0.5, Number(value) || 1));
