// src/background.mjs
// The full-screen backdrop: a periwinkle void, a soft pool of light behind the
// keys, one tilted glass pane and a light beam from the upper left. It is drawn
// into the scene target before everything else, so the rest of the stage can
// stay transparent.

import * as THREE from '../vendor/three.module.js';
import { rgb } from './palette.mjs';

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uGlow;
uniform vec3 uBeam;
uniform float uTime;
uniform float uEnergy;
uniform float uAspect;
uniform float uChorus;
varying vec2 vUv;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
    vec2 uv = vUv;
    float y = uv.y;

    vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.55, y));
    col = mix(col, uTop, smoothstep(0.45, 1.0, y));

    // The pool of light the keyboard sits in.
    vec2 center = vec2(0.46, 0.44 + sin(uTime * 0.11) * 0.012);
    vec2 p = (uv - center) * vec2(uAspect, 1.0);
    float pool = exp(-dot(p, p) * 3.1);
    col += uGlow * pool * (0.24 + uEnergy * 0.12 + uChorus * 0.12);

    // A wide, very soft beam falling from the upper left.
    vec2 q = uv - vec2(0.10, 1.05);
    float beam = exp(-pow((q.x + q.y * 0.46) * 4.2, 2.0)) * smoothstep(1.15, 0.0, q.y);
    col += uBeam * beam * 0.10;

    // The tilted glass pane: a lighter rounded slab with a bright edge.
    vec2 gp = uv - vec2(0.30, 0.83);
    float angle = -0.42;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    gp = rot * gp;
    float pane = sdRound(gp, vec2(0.175, 0.20), 0.055);
    col += uBeam * smoothstep(0.14, 0.0, abs(pane)) * 0.035;
    col += uBeam * smoothstep(0.0, -0.20, pane) * 0.055;

    // A thin diagonal light streak crossing the pane.
    float streak = exp(-pow((uv.x * 0.8 + uv.y - 1.02) * 26.0, 2.0));
    col += uBeam * streak * 0.05;

    // Vignette: the corners fall away into the void.
    vec2 v = (uv - 0.5) * vec2(uAspect * 0.9, 1.0);
    float vig = smoothstep(1.22, 0.30, length(v));
    col *= mix(0.72, 1.0, vig);

    // Slow grain, so the flat gradients never band.
    float grain = hash21(uv * vec2(920.0, 920.0) + floor(uTime * 24.0));
    col += (grain - 0.5) * 0.018;

    gl_FragColor = vec4(col, 1.0);
}
`;

export const createBackground = () => {
    const uniforms = {
        uTop: { value: new THREE.Color('#33407f') },
        uMid: { value: new THREE.Color('#5568b8') },
        uLow: { value: new THREE.Color('#7d8bd8') },
        uGlow: { value: new THREE.Color('#9fb2ff') },
        uBeam: { value: new THREE.Color('#c6d2ff') },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uAspect: { value: 1 },
        uChorus: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        depthTest: false,
        depthWrite: false,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    let paletteId = 'mist';
    const applyPalette = (palette) => {
        paletteId = palette.id;
        uniforms.uTop.value.set(palette.bgTop);
        uniforms.uMid.value.set(palette.bgMid);
        uniforms.uLow.value.set(palette.bgLow);
        uniforms.uGlow.value.set(palette.glow);
        uniforms.uBeam.value.set(palette.beam);
    };

    return {
        scene,
        camera,
        uniforms,
        paletteId,
        setPalette: applyPalette,
        setSize: (width, height) => {
            uniforms.uAspect.value = Math.max(0.2, width / Math.max(1, height));
        },
        update: (time, energy, chorus) => {
            uniforms.uTime.value = time;
            uniforms.uEnergy.value = energy;
            uniforms.uChorus.value = chorus;
        },
        dispose: () => {
            material.dispose();
            scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
            });
        },
    };
};
