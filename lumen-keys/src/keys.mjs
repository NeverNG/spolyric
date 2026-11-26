// src/keys.mjs
// A keyboard standing on end: rows of pastel keys face the camera like a wall
// of piano keys, each on two thin stems, tilted a little so the rows recede
// diagonally. Presses are a per-instance float the shader turns into a sink
// into the wall and a warm glow. One instanced draw call for every key.

import * as THREE from '../vendor/three.module.js';
import { rgb } from './palette.mjs';
import { seededRandom, hash3 } from './util.mjs';

const COLS = 9;
const ROWS = 4;

const vertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aRight;
attribute vec3 aUp;
attribute vec3 aNormal;
attribute vec2 aSize;
attribute vec3 aColor;
attribute float aPress;
attribute float aSeed;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vColor;
varying float vPress;
varying float vSeed;
varying vec3 vWorld;

void main() {
    vec3 p = aCenter
        + aRight * (position.x * aSize.x)
        + aUp * (position.y * aSize.y)
        - aNormal * (aPress * 0.05);
    vLocal = vec2(position.x * aSize.x, position.y * aSize.y);
    vHalf = aSize * 0.5;
    vColor = aColor;
    vPress = aPress;
    vSeed = aSeed;
    vWorld = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uGlow;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vColor;
varying float vPress;
varying float vSeed;
varying vec3 vWorld;

float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    float radius = min(0.055, min(vHalf.x, vHalf.y) * 0.42);
    float d = sdRound(vLocal, vHalf - 0.006, radius);
    float mask = 1.0 - smoothstep(-0.007, 0.007, d);
    if (mask < 0.02) discard;

    float x01 = clamp((vLocal.x + vHalf.x) / (2.0 * vHalf.x), 0.0, 1.0);
    float y01 = clamp((vLocal.y + vHalf.y) / (2.0 * vHalf.y), 0.0, 1.0);
    float edge = smoothstep(0.05, 0.0, -d);

    vec3 col = vColor * mix(0.70, 0.97, y01);
    col *= mix(0.78, 1.0, smoothstep(0.0, 0.16, y01));
    col *= mix(0.92, 1.0, x01);
    col += vec3(0.75, 0.80, 1.0) * edge * 0.22;

    // A soft key-top highlight in the upper left.
    vec2 hl = (vLocal / max(vHalf, vec2(0.001))) - vec2(-0.30, 0.34);
    col += vec3(0.95, 0.97, 1.0) * pow(max(0.0, 1.0 - length(hl * vec2(0.8, 1.4))), 3.0) * 0.14;

    // Press: the key sinks into the wall and lights from inside.
    vec2 centred = vLocal / max(vHalf, vec2(0.001));
    float glow = exp(-dot(centred, centred) * 2.4);
    col += uGlow * vPress * vec3(1.0, 0.84, 0.62) * glow * 0.80;

    col += (hash21(vLocal * 90.0 + vSeed * 17.0) - 0.5) * 0.016;

    float dist = length(vWorld - cameraPosition);
    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fog * 0.55);

    gl_FragColor = vec4(col, mask);
}
`;

const buildBaseGeometry = (instances) => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    geometry.instanceCount = instances;
    return geometry;
};

const addInstancedAttribute = (geometry, name, array, itemSize) => {
    const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
};

/**
 * The standing keyboard plus a few keys floating above the stage.
 */
export const createKeys = ({ palette, seed }) => {
    const group = new THREE.Group();
    group.rotation.y = -0.16;
    group.rotation.z = 0.05;
    group.position.set(0.1, 0, 0);
    group.updateMatrixWorld();

    const random = seededRandom(seed);
    const baseRight = new THREE.Vector3(1, 0, 0);
    const baseNormal = new THREE.Vector3(0, 0.10, 1).normalize();
    const baseUp = new THREE.Vector3().crossVectors(baseNormal, baseRight).normalize();

    const keys = [];
    const gap = 0.92;
    for (let row = 0; row < ROWS; row += 1) {
        const y = 0.10 + row * 0.72;
        const z = 1.55 - row * 0.50;
        const offset = row % 2 === 0 ? -0.16 : 0.30;
        for (let col = 0; col < COLS; col += 1) {
            const x = (col - (COLS - 1) / 2) * gap + offset + (random() - 0.5) * 0.05;
            const width = 0.78 + (random() - 0.5) * 0.04;
            const height = 0.30 + (random() - 0.5) * 0.02;
            const colorIndex = Math.floor(random() * palette.keys.length);
            const color = palette.keys[colorIndex];
            const angle = (random() - 0.5) * 0.03;
            const tilt = (random() - 0.5) * 0.02;
            const keyNormal = baseNormal.clone().applyAxisAngle(baseRight, tilt).normalize();
            const keyRight = baseRight.clone().applyAxisAngle(keyNormal, angle);
            const keyUp = new THREE.Vector3().crossVectors(keyNormal, keyRight).normalize();
            keys.push({
                center: new THREE.Vector3(x, y, z + (random() - 0.5) * 0.03),
                width,
                height,
                color,
                colorIndex,
                normal: keyNormal,
                right: keyRight,
                up: keyUp,
                press: 0,
                float: false,
                seed: random(),
            });
        }
    }

    // Floating keys above the wall, like the ones drifting in the screenshot.
    const floaters = [
        [-4.9, 3.25, 0.4, 0.6],
        [3.6, 3.65, 0.2, 0.2],
        [5.4, 3.05, -0.2, 0.9],
    ];
    for (const [x, y, z, phase] of floaters) {
        keys.push({
            center: new THREE.Vector3(x, y, z),
            width: 1.0,
            height: 0.42,
            color: palette.keys[Math.floor(random() * palette.keys.length)],
            colorIndex: 0,
            normal: baseNormal.clone(),
            right: baseRight.clone(),
            up: baseUp.clone(),
            press: 0,
            float: true,
            phase: phase * Math.PI * 2,
            baseY: y,
            seed: random(),
        });
    }

    const count = keys.length;
    const geometry = buildBaseGeometry(count);
    const center = new Float32Array(count * 3);
    const rights = new Float32Array(count * 3);
    const ups = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const sizes = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const presses = new Float32Array(count);
    const seeds = new Float32Array(count);

    keys.forEach((key, index) => {
        key.index = index;
        center.set([key.center.x, key.center.y, key.center.z], index * 3);
        rights.set([key.right.x, key.right.y, key.right.z], index * 3);
        ups.set([key.up.x, key.up.y, key.up.z], index * 3);
        normals.set([key.normal.x, key.normal.y, key.normal.z], index * 3);
        sizes.set([key.width, key.height], index * 2);
        colors.set(rgb(key.color), index * 3);
        seeds[index] = key.seed;
    });

    addInstancedAttribute(geometry, 'aCenter', center, 3);
    addInstancedAttribute(geometry, 'aRight', rights, 3);
    addInstancedAttribute(geometry, 'aUp', ups, 3);
    addInstancedAttribute(geometry, 'aNormal', normals, 3);
    addInstancedAttribute(geometry, 'aSize', sizes, 2);
    addInstancedAttribute(geometry, 'aColor', colors, 3);
    const pressAttribute = addInstancedAttribute(geometry, 'aPress', presses, 1);
    addInstancedAttribute(geometry, 'aSeed', seeds, 1);

    const uniforms = {
        uTime: { value: 0 },
        uGlow: { value: 1 },
        uFogColor: { value: new THREE.Color(palette.fog) },
        uFogNear: { value: 5.0 },
        uFogFar: { value: 16.0 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);

    // Two stems under each key, hanging down from its lower edge.
    const legGeometry = new THREE.BoxGeometry(1, 1, 1);
    const legMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.shadow) });
    const legMesh = new THREE.InstancedMesh(legGeometry, legMaterial, count * 2);
    legMesh.frustumCulled = false;
    legMesh.renderOrder = 0;
    const matrix = new THREE.Matrix4();
    const legPos = new THREE.Vector3();
    const legScale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    let legCount = 0;
    const writeLegs = () => {
        legCount = 0;
        keys.forEach((key) => {
            if (key.float) return;
            const bottom = key.center.clone().addScaledVector(key.up, -key.height * 0.5).addScaledVector(key.normal, -0.02);
            for (const side of [-1, 1]) {
                legPos.copy(bottom).addScaledVector(key.right, side * key.width * 0.28);
                legPos.y -= 0.13;
                legScale.set(0.020, 0.26, 0.020);
                matrix.compose(legPos, quaternion, legScale);
                legMesh.setMatrixAt(legCount, matrix);
                legCount += 1;
            }
        });
        legMesh.count = legCount;
        legMesh.instanceMatrix.needsUpdate = true;
    };
    writeLegs();
    group.add(legMesh);

    group.updateMatrixWorld(true);
    for (const key of keys) {
        key.world = key.center.clone().applyMatrix4(group.matrixWorld);
        key.normalWorld = key.normal.clone();
        key.kind = 'key';
    }

    const recent = [];
    const hittable = keys.filter((key) => !key.float);
    const pickKey = (salt) => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const index = Math.floor(hash3(salt, attempt, seed) * hittable.length) % hittable.length;
            const candidate = hittable[index];
            if (!recent.includes(candidate.index)) {
                recent.push(candidate.index);
                if (recent.length > 4) recent.shift();
                return candidate;
            }
        }
        return hittable[0];
    };

    const updateColors = (nextPalette) => {
        keys.forEach((key) => {
            if (key.float) return;
            const color = nextPalette.keys[key.colorIndex % nextPalette.keys.length];
            key.color = color;
            colors.set(rgb(color), key.index * 3);
        });
        geometry.getAttribute('aColor').needsUpdate = true;
        uniforms.uFogColor.value.set(nextPalette.fog);
    };

    return {
        group,
        keys,
        mesh,
        updateColors,
        pickKey,
        hit: (key) => {
            if (key) key.press = 1;
        },
        keyAt: (index) => keys[index],
        update: (dt, time, energy) => {
            uniforms.uTime.value = time;
            uniforms.uGlow.value = 0.85 + energy * 0.35;
            let dirty = false;
            for (const key of keys) {
                if (key.press > 0.0005) {
                    key.press *= Math.exp(-dt * 9);
                    presses[key.index] = key.press;
                    dirty = true;
                } else if (key.press !== 0) {
                    key.press = 0;
                    presses[key.index] = 0;
                    dirty = true;
                }
            }
            if (dirty) pressAttribute.needsUpdate = true;
            for (const key of keys) {
                if (!key.float) continue;
                const offset = Math.sin(time * 0.35 + key.phase) * 0.10;
                center[key.index * 3 + 1] = key.baseY + offset;
            }
            geometry.getAttribute('aCenter').needsUpdate = true;
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
            legGeometry.dispose();
            legMaterial.dispose();
            legMesh.dispose();
        },
    };
};
