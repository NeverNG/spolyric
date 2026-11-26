// src/stage.mjs
// A 3D wall: keys are cuboids fixed to the wall by their back face and stick
// out toward the viewer. The ball is a rigid bead with its own vertical spring
// and bounce; hitting a key rocks it on its fixed edge, flashes it and kicks the
// ball back.

import * as THREE from '../vendor/three.module.js';
import { createBackground } from './background.mjs';
import { createParticles } from './particles.mjs';
import { createPost } from './post.mjs';
import { createAudioReactor } from './audio.mjs';
import { createGlyphCache } from './glyphs.mjs';
import { createTrack } from './track.mjs';
import { buildChart } from './chart.mjs';
import { createGlassMaterial } from './glass.mjs';
import { paletteOf } from './palette.mjs';
import { clamp, smoothstep } from './util.mjs';

const CAMERA = { fov: 42, z: 7.6, portraitZ: 10.2, x: 1.15, above: 2.6, lookY: -1.2, lookZ: -1.5 };
const SPEED = 3.6;
const LEAD = 4.2;
const KEY_X = 1.85;
const WALL_Z = -2.0;
const KEY_FRONT = WALL_Z + 0.78;

const makeGlowTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.14)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
};

const makeWallTexture = (palette) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, '#8f9eba');
    gradient.addColorStop(0.55, '#7484a6');
    gradient.addColorStop(1, '#5d6d90');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 1024);
    for (let index = 0; index < 2600; index += 1) {
        const alpha = Math.random() * 0.05;
        context.fillStyle = `rgba(255,255,255,${alpha})`;
        context.fillRect(Math.random() * 512, Math.random() * 1024, 1.5, 1.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

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
    float band = smoothstep(0.07, 0.0, abs(d - uRadius));
    float alpha = band * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
}
`;

export const createStage = ({
    canvas,
    width,
    height,
    dpr = 1,
    settings,
    paletteId = 'mist',
    fontFamily = '"Songti SC","STSong","SimSun",serif',
    fontWeight = 400,
    lines = [],
    seed = 'lumen',
    staticMode = false,
    staticLineIndex = null,
    displayScale = 1,
    audio = null,
    preserveDrawingBuffer = false,
}) => {
    let palette = paletteOf(paletteId);
    let stageSettings = settings;
    let stageWidth = Math.max(1, width);
    let stageHeight = Math.max(1, height);
    let stageDpr = dpr;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        preserveDrawingBuffer,
    });
    renderer.setPixelRatio(stageDpr);
    renderer.setSize(stageWidth, stageHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, stageWidth / stageHeight, 0.1, 500);

    const background = createBackground();
    background.setPalette(palette);

    // The wall the keys hang from.
    const wallTexture = makeWallTexture(palette);
    const wallMaterial = new THREE.MeshStandardMaterial({
        map: wallTexture,
        color: new THREE.Color('#ffffff'),
        roughness: 0.96,
        metalness: 0.02,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 46), wallMaterial);
    wall.position.set(0, 0, WALL_Z - 0.02);
    wall.receiveShadow = true;
    scene.add(wall);

    const ambient = new THREE.HemisphereLight(0xd7e2ff, 0x3a4560, 1.35);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xfff2e2, 1.25);
    keyLight.position.set(5, 8, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 40;
    keyLight.shadow.bias = -0.0008;
    keyLight.target.position.set(0, 0, WALL_Z);
    scene.add(keyLight, keyLight.target);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.8);
    rim.position.set(-6, -3, 4);
    scene.add(rim);

    const glyphs = createGlyphCache({ family: fontFamily, weight: fontWeight });
    const chart = buildChart(lines, { speed: SPEED });
    const track = createTrack({ palette, glyphs, fontScale: stageSettings.fontScale });
    scene.add(track.group);

    const particles = createParticles();
    scene.add(particles.mesh);

    const ballMaterial = createGlassMaterial({ color: palette.accent, opacity: 1, iridescence: 0.7 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.40, 28, 20), ballMaterial);
    ball.renderOrder = 8;
    scene.add(ball);

    const glowTexture = makeGlowTexture();
    const ballGlowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(palette.accent),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.45,
    });
    const ballGlow = new THREE.Sprite(ballGlowMaterial);
    ballGlow.scale.setScalar(1.9);
    ballGlow.renderOrder = 7;
    scene.add(ballGlow);

    const flashMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color('#ffffff'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
    });
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(0.1);
    flash.renderOrder = 10;
    scene.add(flash);

    const rings = [];
    const ringGeometry = new THREE.PlaneGeometry(1, 1);
    for (let index = 0; index < 10; index += 1) {
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
        mesh.renderOrder = 9;
        scene.add(mesh);
        rings.push({ mesh, material, life: 1, maxLife: 0.8 });
    }
    let ringCursor = 0;

    const reactor = createAudioReactor({ audio, enabled: Boolean(stageSettings?.reactive) });

    const bufferWidth = Math.max(1, Math.floor(stageWidth * stageDpr));
    const bufferHeight = Math.max(1, Math.floor(stageHeight * stageDpr));
    const post = createPost({ renderer, width: bufferWidth, height: bufferHeight, quality: stageDpr > 1.5 ? 0.75 : 1 });

    const setPointScale = () => {
        const heightPx = Math.max(1, Math.floor(stageHeight * stageDpr));
        particles.setPointScale((heightPx / (2 * Math.tan((CAMERA.fov * Math.PI) / 360))) * stageDpr * 0.92);
    };
    setPointScale();

    let cameraY = 0;
    let ballY = 0;
    let ballVy = 0;
    let ballX = 0;
    let ballVx = 0;
    let lastSpawn = -Infinity;
    let spawnSide = -1;
    let lyricCursor = 0;
    let chorus = 0;
    let dustTimer = 0;
    let squash = 0;
    let shake = 0;
    let flashLife = 0;
    let disposed = false;

    const layout = () => {
        const portrait = stageWidth / stageHeight < 1.08;
        camera.aspect = stageWidth / stageHeight;
        camera.updateProjectionMatrix();
        return portrait ? CAMERA.portraitZ : CAMERA.z;
    };
    let baseZ = layout();
    background.setSize(stageWidth, stageHeight);

    const startTime = (chart.startTime || 0) - 1.0;
    const targetYAt = (time) => -(time - startTime) * SPEED;

    const resize = (nextWidth, nextHeight, nextDpr = stageDpr) => {
        stageWidth = Math.max(1, nextWidth);
        stageHeight = Math.max(1, nextHeight);
        stageDpr = Math.max(1, Math.min(2, nextDpr));
        renderer.setPixelRatio(stageDpr);
        renderer.setSize(stageWidth, stageHeight, false);
        post.resize(Math.max(1, Math.floor(stageWidth * stageDpr)), Math.max(1, Math.floor(stageHeight * stageDpr)));
        setPointScale();
        background.setSize(stageWidth, stageHeight);
        baseZ = layout();
        if (staticMode) renderStatic();
    };

    const takeChar = (time) => {
        const notes = chart.notes;
        while (lyricCursor < notes.length && notes[lyricCursor].time < time - 1.4) lyricCursor += 1;
        if (lyricCursor >= notes.length) return null;
        if (notes[lyricCursor].time > time + 0.35) return null;
        const char = notes[lyricCursor].char;
        lyricCursor += 1;
        return char;
    };

    const spawnGroup = (time, strength) => {
        const y = targetYAt(time);
        const size = strength > 0.62 ? 3 : strength > 0.32 ? 2 : 1;
        spawnSide = -spawnSide;
        for (let index = 0; index < size; index += 1) {
            const keyY = y - LEAD - index * 1.05;
            const hitTime = time + (LEAD + index * 1.05) / SPEED;
            track.spawn({
                y: keyY,
                side: index % 2 === 0 ? spawnSide : -spawnSide,
                char: takeChar(hitTime),
                strength,
            });
        }
    };

    const impact = (key, time) => {
        squash = 1;
        shake = 1;
        const x = key.side * KEY_X;
        const y = key.y;
        const z = KEY_FRONT + 0.08;
        for (let index = 0; index < 24; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.7 + Math.random() * 2.0;
            particles.spawn({
                x: x + (Math.random() - 0.5) * 0.2,
                y: y + (Math.random() - 0.5) * 0.2,
                z: z + 0.15,
                vx: Math.cos(angle) * speed * 0.7,
                vy: Math.sin(angle) * speed * 0.7 + 0.5,
                vz: 0.3 + Math.random() * 0.7,
                life: 0.5 + Math.random() * 0.55,
                size: 0.05 + Math.random() * 0.08,
                color: [1.0, 0.88, 0.72],
                gravity: -3.4,
                drag: 0.9,
            });
        }
        const ring = rings[ringCursor % rings.length];
        ringCursor += 1;
        ring.mesh.visible = true;
        ring.mesh.position.set(x, y, z);
        ring.mesh.scale.setScalar(0.12);
        ring.material.uniforms.uRadius.value = 0.16;
        ring.material.uniforms.uOpacity.value = 0.95;
        ring.material.uniforms.uColor.value.set(palette.accent);
        ring.life = 0;
        ring.maxLife = 0.8;

        flash.position.set(x, y, z + 0.05);
        flash.scale.setScalar(0.9);
        flashMaterial.opacity = 0.95;
        flashLife = 1;

        ballVy += 11;
        ballVx += -key.side * 3.2;
        void time;
    };

    const updateRings = (dt) => {
        for (const ring of rings) {
            if (!ring.mesh.visible) continue;
            ring.life += dt;
            const p = clamp(ring.life / ring.maxLife, 0, 1);
            ring.mesh.scale.setScalar(0.12 + p * 0.9);
            ring.material.uniforms.uRadius.value = 0.16 + p * 0.55;
            ring.material.uniforms.uOpacity.value = (1 - p) ** 1.2 * 0.9;
            if (p >= 1) ring.mesh.visible = false;
        }
        if (flashLife > 0) {
            flashLife = Math.max(0, flashLife - dt * 2.4);
            flash.scale.setScalar(0.9 + (1 - flashLife) * 2.4);
            flashMaterial.opacity = flashLife * 0.9;
        }
    };

    const updateBall = (time, dt) => {
        const targetY = targetYAt(time);
        // Rigid bead on a soft leash: it bounces off keys, then the song pulls
        // it back onto the timeline.
        ballVy += (targetY - ballY) * 62 * dt;
        ballVy *= Math.exp(-dt * 3.4);
        ballY += ballVy * dt;

        const next = track.active()
            .filter((key) => !key.hit && key.y < ballY)
            .sort((a, b) => b.y - a.y)[0];
        const targetX = next ? next.side * 1.55 : 0;
        ballVx += (targetX - ballX) * 45 * dt;
        ballVx *= Math.exp(-dt * 6);
        ballX += ballVx * dt;

        ball.position.set(ballX, ballY, KEY_FRONT + 0.30);
        ball.rotation.y += dt * 2.0;
        ball.rotation.x += ballVy * dt * 0.08;
        ball.scale.set(1 + squash * 0.6, 1 - squash * 0.5, 1 + squash * 0.6);
        ballGlow.position.copy(ball.position);
        ballGlow.scale.setScalar(1.9 + squash * 0.6);
        ballGlowMaterial.opacity = 0.4 + squash * 0.2;
    };

    const frame = (time, dt, lineIndex, paused) => {
        if (disposed) return;
        const safeDt = paused ? 0 : clamp(dt, 0, 0.05);
        const audioState = reactor.update(safeDt, time);
        const energy = audioState.energy;
        const targetChorus = lineIndex >= 0 && lines[lineIndex]?.isChorus ? 1 : 0;
        chorus += (targetChorus - chorus) * (1 - Math.exp(-(safeDt || 0.016) * 2.2));

        const sinceSpawn = time - lastSpawn;
        const onset = audioState.onset && sinceSpawn > 0.16;
        const fallback = sinceSpawn > 0.62;
        if (!paused && (onset || fallback)) {
            spawnGroup(time, onset ? Math.max(0.2, audioState.onsetStrength) : 0.35);
            lastSpawn = time;
        }

        for (const key of track.active()) {
            if (key.hit) continue;
            if (Math.abs(ballY - key.y) > 0.36) continue;
            if (Math.abs(ballX - key.side * KEY_X) > 0.95) continue;
            if (ballVy > 0) continue;
            track.press(key, time, 1);
            impact(key, time);
        }

        squash *= Math.exp(-safeDt * 7);
        shake *= Math.exp(-safeDt * 7);
        updateBall(time, safeDt);

        cameraY += (ballY - cameraY) * (1 - Math.exp(-(safeDt || 0.016) * 6.0));
        const motion = clamp(stageSettings?.cameraMotion ?? 1, 0, 1.5);
        const sway = Math.sin(time * 0.35) * 0.06 * motion;
        camera.position.set(
            CAMERA.x + sway + (Math.random() - 0.5) * 0.12 * shake,
            cameraY + CAMERA.above + (Math.random() - 0.5) * 0.08 * shake,
            baseZ,
        );
        camera.lookAt(0, cameraY + CAMERA.lookY, CAMERA.lookZ);
        camera.rotation.z = Math.sin(time * 0.5) * 0.004 * motion + (Math.random() - 0.5) * 0.012 * shake;

        wall.position.y = cameraY;
        wallTexture.offset.y = -(cameraY - 0) / 46;
        keyLight.position.set(5, cameraY + 8, 7);
        keyLight.target.position.set(0, cameraY, WALL_Z);
        keyLight.target.updateMatrixWorld();

        track.update(time, cameraY, energy, chorus, safeDt);
        updateRings(safeDt);
        particles.update(safeDt, time);
        spawnDust(safeDt);
        background.update(time, energy, chorus);

        post.render({
            background,
            scene,
            camera,
            bloom: clamp((stageSettings?.glow ?? 1) * (0.8 + energy * 0.35 + chorus * 0.3), 0.15, 2.4),
            time,
            chorus,
        });
    };

    const spawnDust = (dt) => {
        dustTimer += dt;
        while (dustTimer > 0.08) {
            dustTimer -= 0.08;
            particles.spawn({
                x: (Math.random() - 0.5) * 8,
                y: cameraY - 8 + Math.random() * 14,
                z: -1 + Math.random() * 3,
                vy: -0.03 - Math.random() * 0.05,
                life: 4 + Math.random() * 4,
                size: 0.02 + Math.random() * 0.03,
                color: [0.85, 0.9, 1.0],
                alpha: 0.18 + Math.random() * 0.16,
                twinkle: 1,
            });
        }
    };

    const seek = (time) => {
        ballY = targetYAt(time);
        ballVy = 0;
        ballX = 0;
        ballVx = 0;
        cameraY = ballY;
        lastSpawn = time - 0.62;
        lyricCursor = chart.notes.findIndex((note) => note.time > time - 0.5);
        if (lyricCursor < 0) lyricCursor = chart.notes.length;
        track.clear();
        particles.clear();
        for (const ring of rings) ring.mesh.visible = false;
    };

    const renderStatic = () => {
        if (disposed) return;
        const index = Number.isInteger(staticLineIndex) ? staticLineIndex : 0;
        const lineNotes = chart.notes.filter((note) => note.lineIndex === index);
        const anchor = -4;
        track.clear();
        const keys = [];
        for (let slot = 0; slot < 8; slot += 1) {
            keys.push(track.spawn({
                y: anchor - 1.4 - slot * 1.05,
                side: slot % 2 === 0 ? 1 : -1,
                char: lineNotes[slot % Math.max(1, lineNotes.length)]?.char ?? null,
                strength: 0.6,
            }));
        }
        const stillTime = chart.notes[0]?.time ?? 0;
        track.update(stillTime, anchor, 0.55, 0.4, 1 / 60);
        const pressed = keys[2] ?? keys[0];
        if (pressed) {
            track.press(pressed, stillTime, 1.2);
            impact(pressed, stillTime);
        }
        track.update(stillTime, anchor, 0.55, 0.4, 1 / 60);
        ballY = pressed ? pressed.y : anchor;
        ballX = pressed ? pressed.side * 1.55 : 0;
        ball.position.set(ballX, ballY, KEY_FRONT + 0.30);
        ballGlow.position.copy(ball.position);
        ballGlow.scale.setScalar(1.9);
        cameraY = anchor;
        camera.position.set(CAMERA.x, anchor + CAMERA.above, baseZ);
        camera.lookAt(0, anchor + CAMERA.lookY, CAMERA.lookZ);
        camera.rotation.z = 0;
        wall.position.y = anchor;
        keyLight.position.set(5, anchor + 8, 7);
        keyLight.target.position.set(0, anchor, WALL_Z);
        particles.update(1 / 60, stillTime);
        updateRings(1 / 60);
        background.update(stillTime, 0.5, 0.3);
        post.render({
            background,
            scene,
            camera,
            bloom: clamp((stageSettings?.glow ?? 1) * 1.0, 0.15, 2.4),
            time: stillTime,
            chorus: 0.3,
        });
    };

    const setSettings = (next) => {
        const previousPalette = stageSettings.palette;
        stageSettings = next;
        if (next.palette !== previousPalette) {
            palette = paletteOf(next.palette);
            background.setPalette(palette);
            track.setPalette(palette);
            wallMaterial.color.set('#ffffff');
            ballMaterial.uniforms.uColor.value.set(palette.accent);
            ballGlowMaterial.color.set(palette.accent);
        }
        reactor.setEnabled(Boolean(next.reactive));
        track.setFontScale(next.fontScale);
        if (staticMode) renderStatic();
    };

    setSettings(stageSettings);
    if (staticMode) renderStatic();

    return {
        renderer,
        frame,
        resize,
        seek,
        setSettings,
        renderStatic,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            track.dispose();
            glyphs.dispose();
            ball.geometry.dispose();
            ballMaterial.dispose();
            ballGlowMaterial.dispose();
            flashMaterial.dispose();
            glowTexture.dispose();
            wallTexture.dispose();
            wallMaterial.dispose();
            ringGeometry.dispose();
            for (const ring of rings) ring.material.dispose();
            particles.dispose();
            background.dispose();
            post.dispose();
            scene.clear();
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
};
