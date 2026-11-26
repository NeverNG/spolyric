// src/bubble.mjs
// The iridescent soap bubble that floats above the keys. A fake thin-film
// shader: a Fresnel rim, a rainbow ramp driven by the view angle and a hard
// specular highlight. Additive, so it sits in the light instead of blocking it.

import * as THREE from '../vendor/three.module.js';

const vertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uTint;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float facing = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - facing, 2.4);

    vec3 ramp = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.32, 0.66) + fresnel * 1.6 + vWorld.y * 0.22 + uTime * 0.05));
    ramp = mix(ramp, uTint, 0.10);

    vec3 lightDir = normalize(vec3(-0.45, 0.75, 0.45));
    vec3 halfway = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfway), 0.0), 64.0);

    float alpha = fresnel * 0.38 + specular * 0.22 + 0.02;
    vec3 color = ramp * fresnel * 0.72 + vec3(1.0, 0.98, 0.94) * specular * 0.40;
    gl_FragColor = vec4(color, alpha);
}
`;

export const createBubble = ({ palette }) => {
    const group = new THREE.Group();
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uTint: { value: new THREE.Color(palette.bubble[1]) },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.30, 48, 32), material);
    mesh.renderOrder = 8;
    group.add(mesh);

    // A small hot highlight, the way a real bubble catches the window.
    const highlightCanvas = document.createElement('canvas');
    highlightCanvas.width = 64;
    highlightCanvas.height = 64;
    const context = highlightCanvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(highlightCanvas);
    texture.colorSpace = THREE.NoColorSpace;
    const highlight = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
    }));
    highlight.scale.setScalar(0.34);
    highlight.position.set(-0.30, 0.34, 0.30);
    group.add(highlight);

    return {
        group,
        setPalette: (next) => {
            material.uniforms.uTint.value.set(next.bubble[1]);
        },
        update: (time, energy) => {
            material.uniforms.uTime.value = time;
            const drift = Math.sin(time * 0.43) * 0.10;
            group.position.set(2.32 + drift, 1.62 + Math.sin(time * 0.61 + 1.4) * 0.11 + energy * 0.05, 1.05);
            group.rotation.y = time * 0.12;
            group.rotation.x = Math.sin(time * 0.27) * 0.15;
            const scale = 1 + Math.sin(time * 0.8) * 0.03 + energy * 0.03;
            group.scale.setScalar(scale);
        },
        dispose: () => {
            mesh.geometry.dispose();
            material.dispose();
            highlight.material.dispose();
            texture.dispose();
        },
    };
};
