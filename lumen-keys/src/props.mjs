// src/props.mjs
// The other things on the stage besides the keys: a harp with glowing strings,
// a drum, a small bell on a thread, and the bubble machine. The first three are
// things a ball can land on; the machine just keeps blowing glass bubbles.

import * as THREE from '../vendor/three.module.js';
import { createGlassMaterial } from './glass.mjs';

const STRING_COUNT = 6;

const createHarp = (palette) => {
    const group = new THREE.Group();
    group.position.set(-4.05, 1.95, -0.15);
    group.rotation.z = -0.18;
    group.rotation.y = 0.25;

    const frame = new THREE.Mesh(
        new THREE.TorusGeometry(0.82, 0.035, 8, 48, Math.PI * 0.92),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.keys[1]) }),
    );
    frame.rotation.z = Math.PI * 0.04;
    group.add(frame);

    const stringMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(palette.text),
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const points = [];
    const targets = [];
    for (let index = 0; index < STRING_COUNT; index += 1) {
        const offset = (index - (STRING_COUNT - 1) / 2) * 0.17;
        const top = new THREE.Vector3(offset, 0.62 - Math.abs(offset) * 0.25, 0);
        const bottom = new THREE.Vector3(offset * 0.55, -0.62, 0);
        points.push(top, bottom);
        const world = group.position.clone().add(new THREE.Vector3(offset * 0.8, 0.1, 0));
        targets.push({
            world,
            normalWorld: new THREE.Vector3(0, 0, 1),
            kind: 'harp',
            index,
            target: group,
        });
    }
    const strings = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), stringMaterial);
    group.add(strings);

    return {
        group,
        targets,
        strings: stringMaterial,
        flash: 0,
    };
};

const createDrum = (palette) => {
    const group = new THREE.Group();
    group.position.set(2.65, 1.18, 1.70);
    group.rotation.y = -0.32;

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.40, 0.42, 0.30, 40),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.keys[3]) }),
    );
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.41, 0.055, 10, 48),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.keys[3]) }),
    );
    rim.position.z = 0.15;
    group.add(rim);

    const membraneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f3e3cc'), side: THREE.DoubleSide });
    const membrane = new THREE.Mesh(new THREE.CircleGeometry(0.355, 40), membraneMaterial);
    membrane.position.z = 0.16;
    group.add(membrane);

    return {
        group,
        membraneMaterial,
        pulseRing: null,
        targets: [{
            world: group.position.clone().add(new THREE.Vector3(0, 0, 0.22)),
            normalWorld: new THREE.Vector3(0, 0, 1),
            kind: 'drum',
            target: group,
        }],
        membrane: membraneMaterial,
        pulse: 0,
    };
};

const createBell = (palette) => {
    const group = new THREE.Group();
    group.position.set(-3.95, 3.38, 0.15);

    const thread = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 0.30, 0)]),
        new THREE.LineBasicMaterial({ color: new THREE.Color(palette.textDim), transparent: true, opacity: 0.5 }),
    );
    group.add(thread);

    const bell = new THREE.Mesh(
        new THREE.ConeGeometry(0.20, 0.34, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.keys[2]), side: THREE.DoubleSide }),
    );
    bell.position.y = 0.10;
    bell.rotation.x = Math.PI;
    bell.scale.setScalar(0.58);
    group.add(bell);

    const clapper = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accent) }),
    );
    clapper.position.y = -0.08;
    group.add(clapper);

    return {
        group,
        bell,
        targets: [{
            world: group.position.clone().add(new THREE.Vector3(0, -0.05, 0.1)),
            normalWorld: new THREE.Vector3(0, 0, 1),
            kind: 'bell',
            target: group,
        }],
        swing: 0,
    };
};

const createBubbleMachine = (palette) => {
    const group = new THREE.Group();
    group.position.set(3.80, 0.22, 2.05);
    group.rotation.y = -0.35;

    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.30, 0.28),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.shadow) }),
    );
    group.add(body);
    const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.055, 0.18, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.textDim) }),
    );
    nozzle.position.set(0.20, 0.16, 0.02);
    nozzle.rotation.z = -0.7;
    group.add(nozzle);

    const bubbleGroup = new THREE.Group();
    const bubbles = [];
    for (let index = 0; index < 16; index += 1) {
        const material = createGlassMaterial({
            color: palette.bubble[index % palette.bubble.length],
            opacity: 0.9,
            iridescence: 1,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), material);
        mesh.visible = false;
        mesh.renderOrder = 9;
        bubbleGroup.add(mesh);
        bubbles.push({
            mesh,
            material,
            active: false,
            life: 0,
            maxLife: 1,
            x: 0, y: 0, z: 0,
            vy: 0,
            phase: 0,
            scale: 1,
        });
    }

    return {
        group,
        bubbleGroup,
        bubbles,
        timer: 0,
        spawn(world) {
            const bubble = bubbles.find((candidate) => !candidate.active);
            if (!bubble) return;
            bubble.active = true;
            bubble.life = 0;
            bubble.maxLife = 3.4 + Math.random() * 2.6;
            bubble.x = world.x + (Math.random() - 0.5) * 0.10;
            bubble.y = world.y;
            bubble.z = world.z + (Math.random() - 0.5) * 0.10;
            bubble.vy = 0.30 + Math.random() * 0.25;
            bubble.phase = Math.random() * Math.PI * 2;
            bubble.scale = 0.6 + Math.random() * 0.8;
            bubble.mesh.visible = true;
            bubble.mesh.scale.setScalar(0.01);
        },
        update(dt, time) {
            for (const bubble of bubbles) {
                if (!bubble.active) continue;
                bubble.life += dt;
                if (bubble.life >= bubble.maxLife) {
                    bubble.active = false;
                    bubble.mesh.visible = false;
                    continue;
                }
                bubble.y += bubble.vy * dt;
                const wobble = Math.sin(time * 1.7 + bubble.phase) * 0.12;
                bubble.mesh.position.set(bubble.x + wobble, bubble.y, bubble.z + Math.cos(time * 1.3 + bubble.phase) * 0.06);
                const grow = Math.min(1, bubble.life * 2.4);
                const fade = Math.min(1, (bubble.maxLife - bubble.life) * 1.4);
                bubble.mesh.scale.setScalar(bubble.scale * grow);
                bubble.material.uniforms.uOpacity.value = 0.85 * fade;
                bubble.material.uniforms.uTime.value = time;
            }
        },
    };
};

export const createProps = ({ palette }) => {
    const group = new THREE.Group();
    const harp = createHarp(palette);
    const drum = createDrum(palette);
    const bell = createBell(palette);
    const machine = createBubbleMachine(palette);
    group.add(harp.group, drum.group, bell.group, machine.group, machine.bubbleGroup);

    const targets = [...harp.targets, ...drum.targets, ...bell.targets];

    const hit = (target) => {
        if (!target) return;
        if (target.kind === 'drum') drum.pulse = 1;
        else if (target.kind === 'bell') bell.swing = 1;
        else if (target.kind === 'harp') harp.flash = 1;
    };

    const update = (dt, time, energy) => {
        drum.pulse *= Math.exp(-dt * 6);
        drum.membraneMaterial.color.setRGB(0.95 + drum.pulse * 0.05, 0.88 + drum.pulse * 0.1, 0.78 + drum.pulse * 0.06);
        drum.group.scale.setScalar(1 + drum.pulse * 0.07);

        bell.swing *= Math.exp(-dt * 2.6);
        bell.group.rotation.z = Math.sin(time * 11) * 0.20 * bell.swing;

        harp.flash *= Math.exp(-dt * 3.4);
        harp.strings.opacity = 0.32 + harp.flash * 0.6;

        machine.timer += dt;
        if (machine.timer > 0.34) {
            machine.timer = 0;
            machine.spawn({ x: 3.80 + 0.22, y: 0.22 + 0.20, z: 2.05 + 0.05 });
        }
        machine.update(dt, time);

        void energy;
    };

    return {
        group,
        targets,
        hit,
        update,
        setPalette: (next) => {
            void next;
        },
        dispose: () => {
            group.traverse((object) => {
                object.geometry?.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material.dispose());
                } else {
                    object.material?.dispose();
                }
            });
        },
    };
};
