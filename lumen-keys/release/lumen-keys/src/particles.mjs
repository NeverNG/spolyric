// src/particles.mjs
// One pool of additive point sprites for trails, hit sparks and floating dust.
// Positions and colours are written on the CPU each frame; the shader only does
// perspective sizing and a soft round falloff, so the whole effect is a single
// draw call.

import * as THREE from '../vendor/three.module.js';

const vertex = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uPointScale;
varying vec4 vColor;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uPointScale / max(0.8, -mv.z), 1.0, 140.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
}
`;

const fragment = /* glsl */ `
varying vec4 vColor;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float glow = smoothstep(0.5, 0.02, d);
    glow = pow(glow, 1.7);
    float core = smoothstep(0.16, 0.0, d);
    float alpha = (glow * 0.85 + core * 0.55) * vColor.a;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

const MAX = 720;

export const createParticles = () => {
    const positions = new Float32Array(MAX * 3);
    const sizes = new Float32Array(MAX);
    const colors = new Float32Array(MAX * 4);
    const slots = Array.from({ length: MAX }, () => ({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        size: 0.1,
        gravity: 0,
        drag: 0,
        r: 1, g: 1, b: 1,
        fade: 1,
        twinkle: 0,
        phase: 0,
    }));
    let cursor = 0;

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    const sizeAttribute = new THREE.BufferAttribute(sizes, 1);
    sizeAttribute.setUsage(THREE.DynamicDrawUsage);
    const colorAttribute = new THREE.BufferAttribute(colors, 4);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aSize', sizeAttribute);
    geometry.setAttribute('aColor', colorAttribute);

    const material = new THREE.ShaderMaterial({
        uniforms: { uPointScale: { value: 900 } },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    const spawn = ({
        x, y, z,
        vx = 0, vy = 0, vz = 0,
        life = 1,
        size = 0.12,
        color = [1, 1, 1],
        alpha = 1,
        gravity = 0,
        drag = 0,
        twinkle = 0,
    }) => {
        let slot = null;
        for (let index = 0; index < MAX; index += 1) {
            const candidate = slots[(cursor + index) % MAX];
            if (!candidate.active) {
                slot = candidate;
                cursor = (cursor + index + 1) % MAX;
                break;
            }
        }
        if (!slot) {
            slot = slots[cursor];
            cursor = (cursor + 1) % MAX;
        }
        slot.active = true;
        slot.life = 0;
        slot.maxLife = Math.max(0.01, life);
        slot.x = x; slot.y = y; slot.z = z;
        slot.vx = vx; slot.vy = vy; slot.vz = vz;
        slot.size = size;
        slot.gravity = gravity;
        slot.drag = drag;
        slot.r = color[0]; slot.g = color[1]; slot.b = color[2];
        slot.fade = alpha;
        slot.twinkle = twinkle;
        slot.phase = Math.random() * Math.PI * 2;
        return slot;
    };

    const update = (dt, time) => {
        for (let index = 0; index < MAX; index += 1) {
            const slot = slots[index];
            if (!slot.active) {
                colors[index * 4 + 3] = 0;
                sizes[index] = 0;
                continue;
            }
            slot.life += dt;
            if (slot.life >= slot.maxLife) {
                slot.active = false;
                colors[index * 4 + 3] = 0;
                sizes[index] = 0;
                continue;
            }
            const damping = Math.exp(-slot.drag * dt);
            slot.vx *= damping;
            slot.vy = slot.vy * damping + slot.gravity * dt;
            slot.vz *= damping;
            slot.x += slot.vx * dt;
            slot.y += slot.vy * dt;
            slot.z += slot.vz * dt;
            const lifeRatio = 1 - slot.life / slot.maxLife;
            const twinkle = slot.twinkle > 0 ? 0.72 + 0.28 * Math.sin(time * 9 + slot.phase) : 1;
            positions[index * 3] = slot.x;
            positions[index * 3 + 1] = slot.y;
            positions[index * 3 + 2] = slot.z;
            sizes[index] = slot.size * (0.7 + lifeRatio * 0.3);
            colors[index * 4] = slot.r;
            colors[index * 4 + 1] = slot.g;
            colors[index * 4 + 2] = slot.b;
            colors[index * 4 + 3] = Math.pow(lifeRatio, 0.8) * slot.fade * twinkle;
        }
        positionAttribute.needsUpdate = true;
        sizeAttribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
    };

    return {
        mesh,
        spawn,
        update,
        setPointScale: (value) => {
            material.uniforms.uPointScale.value = value;
        },
        clear: () => {
            for (const slot of slots) slot.active = false;
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
};
