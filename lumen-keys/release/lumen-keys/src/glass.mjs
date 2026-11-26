// src/glass.mjs
// The shared glass shader: used for the music balls, the bubbles the machine
// blows and the bubble props. No environment map and no real refraction; a
// Fresnel rim, a thin-film rainbow and a hard specular are enough to read as
// glass against the periwinkle void, and it stays cheap.

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
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uIridescence;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normal, viewDir));
    float fresnel = pow(1.0 - facing, 2.1);

    vec3 ramp = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.32, 0.66) + fresnel * 1.5 + vWorld.y * 0.22 + uTime * 0.05));
    ramp = mix(vec3(0.92, 0.95, 1.0), ramp, uIridescence);

    vec3 lightDir = normalize(vec3(-0.35, 0.75, 0.55));
    vec3 halfway = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfway), 0.0), 42.0);
    float highlight = pow(max(dot(normal, normalize(vec3(-0.55, 0.72, 0.42))), 0.0), 18.0);

    float alpha = (0.14 + fresnel * 0.72 + specular * 0.55 + highlight * 0.35) * uOpacity;
    vec3 color = uColor * (0.26 + fresnel * 0.60) + ramp * fresnel * 0.55 + vec3(1.0, 0.99, 0.96) * specular * 1.25 + vec3(1.0) * highlight * 0.55;
    gl_FragColor = vec4(color, alpha);
}
`;

export const createGlassMaterial = ({ color, opacity = 1, iridescence = 1 }) => new THREE.ShaderMaterial({
    uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uOpacity: { value: opacity },
        uIridescence: { value: iridescence },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
});
