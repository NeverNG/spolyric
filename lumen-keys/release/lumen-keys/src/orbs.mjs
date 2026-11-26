// src/orbs.mjs
// The music balls are glass beads now: a small sphere with the shared glass
// shader, a soft additive glow behind it for bloom, and a particle trail. Each
// bead arcs from a lyric character (or the sky) to a key, a harp string, the
// drum or the bell, then breaks into a ring and sparks.

import * as THREE from '../vendor/three.module.js';
import { clamp, easeInOutCubic, hash3 } from './util.mjs';
import { createGlassMaterial } from './glass.mjs';

const MAX_ORBS = 10;
const MAX_RINGS = 10;

const glowTexture = (() => {
    let texture = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
        gradient.addColorStop(0.3, 'rgba(255,255,255,0.35)');
        gradient.addColorStop(0.7, 'rgba(255,255,255,0.08)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.NoColorSpace;
        return texture;
    };
})();

const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ringFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uRadius;
varying vec2 vUv;
void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float band = smoothstep(0.09, 0.0, abs(d - uRadius));
    float inner = smoothstep(0.55, 0.0, d) * 0.08;
    float alpha = (band * 0.9 + inner) * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
}
`;

export const createOrbs = ({ particles, palette, onHit }) => {
    const root = new THREE.Group();
    const orbs = [];
    const rings = [];
    const sphere = new THREE.SphereGeometry(0.21, 24, 18);
    const glowMap = glowTexture();
    const ringGeometry = new THREE.PlaneGeometry(1, 1);

    for (let index = 0; index < MAX_ORBS; index += 1) {
        const material = createGlassMaterial({
            color: palette.accent,
            opacity: 1,
            iridescence: 0.85,
        });
        const mesh = new THREE.Mesh(sphere, material);
        mesh.visible = false;
        mesh.renderOrder = 15;
        root.add(mesh);

        const glowMaterial = new THREE.SpriteMaterial({
            map: glowMap,
            color: new THREE.Color(palette.accent),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.55,
        });
        const glow = new THREE.Sprite(glowMaterial);
        glow.scale.setScalar(1.10);
        glow.visible = false;
        glow.renderOrder = 14;
        root.add(glow);

        orbs.push({
            mesh,
            material,
            glow,
            glowMaterial,
            active: false,
            t: 0,
            duration: 0.8,
            start: new THREE.Vector3(),
            control: new THREE.Vector3(),
            end: new THREE.Vector3(),
            target: null,
            trailTimer: 0,
            color: new THREE.Color(),
            spin: 0,
        });
    }

    for (let index = 0; index < MAX_RINGS; index += 1) {
        const material = new THREE.ShaderMaterial({
            vertexShader: ringVertex,
            fragmentShader: ringFragment,
            uniforms: {
                uColor: { value: new THREE.Color(palette.accent) },
                uOpacity: { value: 0 },
                uRadius: { value: 0.2 },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(ringGeometry, material);
        mesh.visible = false;
        mesh.renderOrder = 16;
        root.add(mesh);
        rings.push({ mesh, material, life: 0, maxLife: 0.75 });
    }

    let ringCursor = 0;
    const spark = (position, color, count) => {
        for (let index = 0; index < count; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.5 + Math.random() * 1.3;
            particles.spawn({
                x: position.x + (Math.random() - 0.5) * 0.18,
                y: position.y + (Math.random() - 0.5) * 0.18,
                z: position.z + 0.05,
                vx: Math.cos(angle) * speed * 0.55,
                vy: 0.4 + Math.random() * 1.1,
                vz: Math.sin(angle) * speed * 0.35,
                life: 0.45 + Math.random() * 0.5,
                size: 0.05 + Math.random() * 0.06,
                color,
                gravity: -2.0,
                drag: 0.7,
            });
        }
        particles.spawn({
            x: position.x,
            y: position.y,
            z: position.z + 0.05,
            life: 0.3,
            size: 0.30,
            color,
            alpha: 0.55,
        });
    };

    const stampRing = (target, color) => {
        const ring = rings[ringCursor % MAX_RINGS];
        ringCursor += 1;
        const normal = target.normalWorld ?? new THREE.Vector3(0, 0, 1);
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3().crossVectors(normal, right).normalize();
        ring.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
        ring.mesh.position.copy(target.world).addScaledVector(normal, 0.03);
        ring.mesh.scale.setScalar(0.35);
        ring.life = 0;
        ring.maxLife = 0.7;
        ring.material.uniforms.uColor.value.copy(color);
        ring.material.uniforms.uRadius.value = 0.18;
        ring.material.uniforms.uOpacity.value = 0.7;
        ring.mesh.visible = true;
    };

    let launchCount = 0;
    const launch = ({ from, target, color, duration = 0.9, arc = 1 }) => {
        let orb = orbs.find((candidate) => !candidate.active);
        if (!orb) {
            orb = orbs.reduce((best, candidate) => (candidate.t > best.t ? candidate : best), orbs[0]);
            orb.mesh.visible = false;
            orb.glow.visible = false;
        }
        launchCount += 1;
        orb.active = true;
        orb.t = 0;
        orb.duration = Math.max(0.3, duration);
        orb.target = target;
        orb.trailTimer = 0;
        orb.start.copy(from);
        orb.end.copy(target.world).addScaledVector(target.normalWorld ?? new THREE.Vector3(0, 0, 1), 0.10);
        const seed = hash3(launchCount, target.index ?? 0, 97);
        orb.control.copy(from).lerp(orb.end, 0.5);
        orb.control.y += (0.12 + seed * 0.18) * arc;
        orb.control.x += (seed - 0.5) * 0.7;
        orb.color.set(color ?? palette.accent);
        orb.material.uniforms.uColor.value.copy(orb.color);
        orb.glowMaterial.color.copy(orb.color);
        orb.mesh.visible = true;
        orb.glow.visible = true;
        orb.mesh.position.copy(from);
        orb.glow.position.copy(from);
        orb.spin = (seed - 0.5) * 2;
    };

    const update = (dt, time, energy) => {
        for (const orb of orbs) {
            if (!orb.active) continue;
            orb.t = clamp(orb.t + dt / orb.duration, 0, 1);
            const t = easeInOutCubic(orb.t);
            const inv = 1 - t;
            const x = inv * inv * orb.start.x + 2 * inv * t * orb.control.x + t * t * orb.end.x;
            const y = inv * inv * orb.start.y + 2 * inv * t * orb.control.y + t * t * orb.end.y;
            const z = inv * inv * orb.start.z + 2 * inv * t * orb.control.z + t * t * orb.end.z;
            const pulse = 1 + Math.sin(time * 11 + orb.t * 8) * 0.04 + energy * 0.05;
            orb.mesh.position.set(x, y, z);
            orb.mesh.scale.setScalar(pulse);
            orb.mesh.rotation.y += dt * orb.spin;
            orb.material.uniforms.uTime.value = time;
            orb.glow.position.set(x, y, z);
            orb.glow.scale.setScalar(1.10 * pulse);
            orb.glowMaterial.opacity = 0.62 + energy * 0.12;

            orb.trailTimer += dt;
            while (orb.trailTimer > 0.03) {
                orb.trailTimer -= 0.03;
                particles.spawn({
                    x: x + (Math.random() - 0.5) * 0.05,
                    y: y + (Math.random() - 0.5) * 0.05,
                    z: z + (Math.random() - 0.5) * 0.05,
                    life: 0.4 + Math.random() * 0.25,
                    size: 0.055 + Math.random() * 0.03,
                    color: [orb.color.r * 0.8 + 0.2, orb.color.g * 0.8 + 0.2, orb.color.b * 0.8 + 0.2],
                    alpha: 0.35,
                });
            }

            if (orb.t >= 1) {
                orb.active = false;
                orb.mesh.visible = false;
                orb.glow.visible = false;
                if (orb.target) {
                    onHit?.(orb.target, orb.color);
                    stampRing(orb.target, orb.color);
                    spark(orb.end, [orb.color.r, orb.color.g, orb.color.b], 10);
                }
            }
        }

        for (const ring of rings) {
            if (!ring.mesh.visible) continue;
            ring.life += dt;
            const progress = clamp(ring.life / ring.maxLife, 0, 1);
            ring.mesh.scale.setScalar(0.35 + progress * 1.0);
            ring.material.uniforms.uRadius.value = 0.18 + progress * 0.52;
            ring.material.uniforms.uOpacity.value = (1 - progress) ** 1.5 * 0.7;
            if (progress >= 1) ring.mesh.visible = false;
        }
    };

    return {
        root,
        launch,
        burst(target, color) {
            if (!target) return;
            stampRing(target, color);
            spark(target.world, [color.r, color.g, color.b], 14);
        },
        update,
        clear: () => {
            for (const orb of orbs) {
                orb.active = false;
                orb.mesh.visible = false;
                orb.glow.visible = false;
            }
            for (const ring of rings) {
                ring.mesh.visible = false;
                ring.life = ring.maxLife;
            }
        },
        dispose: () => {
            sphere.dispose();
            for (const orb of orbs) {
                orb.material.dispose();
                orb.glowMaterial.dispose();
            }
            for (const ring of rings) ring.material.dispose();
            ringGeometry.dispose();
        },
    };
};
