// src/stage.mjs
// The invisible track: keys are fixed panels in two lanes, the ball falls
// between them and hits a key with a squash, a recoil, a flash and a small
// camera shake. Key groups come from melody onsets, not from lyric characters.

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
import { clamp, smoothstep, lerp } from './util.mjs';

const CAMERA = { fov: 44, z: 10.2, portraitZ: 13.6, above: 2.3, lookAhead: -1.5, lookBack: 0.4 };
const SPEED = 3.6;
const LEAD = 4.2;

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
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, stageWidth / stageHeight, 0.1, 500);

    const background = createBackground();
    background.setPalette(palette);

    const glyphs = createGlyphCache({ family: fontFamily, weight: fontWeight });
    const chart = buildChart(lines, { speed: SPEED });
    const track = createTrack({ palette, glyphs, fontScale: stageSettings.fontScale });
    scene.add(track.group);

    const particles = createParticles();
    scene.add(particles.mesh);

    const ballMaterial = createGlassMaterial({ color: palette.accent, opacity: 1, iridescence: 1 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), ballMaterial);
    ball.renderOrder = 8;
    scene.add(ball);

    const glowTexture = makeGlowTexture();
    const ballGlowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(palette.accent),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
    });
    const ballGlow = new THREE.Sprite(ballGlowMaterial);
    ballGlow.scale.setScalar(2.1);
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
        rings.push({ mesh, material, life: 1, maxLife: 0.7 });
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
    let ballX = 0;
    let previousBallY = 0;
    let lastSpawn = -Infinity;
    let spawnSide = -1;
    let lyricCursor = 0;
    let chorus = 0;
    let dustTimer = 0;
    let squash = 0;
    let shake = 0;
    let bounce = 0;
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
    const ballYAt = (time) => -(time - startTime) * SPEED;

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
        const ballY = ballYAt(time);
        const size = strength > 0.62 ? 3 : strength > 0.32 ? 2 : 1;
        spawnSide = -spawnSide;
        for (let index = 0; index < size; index += 1) {
            const y = ballY - LEAD - index * 1.0;
            const hitTime = time + (LEAD + index * 1.0) / SPEED;
            const char = takeChar(hitTime);
            track.spawn({
                y,
                side: index % 2 === 0 ? spawnSide : -spawnSide,
                char,
                strength,
            });
        }
    };

    const impact = (key, time) => {
        squash = 1;
        bounce = 1;
        shake = 1;
        const x = key.side * 1.35;
        const y = key.y;
        const color = [1.0, 0.88, 0.72];
        for (let index = 0; index < 22; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.6 + Math.random() * 1.8;
            particles.spawn({
                x: x + (Math.random() - 0.5) * 0.2,
                y: y + (Math.random() - 0.5) * 0.2,
                z: 0.45,
                vx: Math.cos(angle) * speed * 0.7,
                vy: Math.sin(angle) * speed * 0.7 + 0.4,
                vz: 0.2 + Math.random() * 0.5,
                life: 0.55 + Math.random() * 0.55,
                size: 0.06 + Math.random() * 0.08,
                color,
                gravity: -3.2,
                drag: 0.9,
            });
        }
        const ring = rings[ringCursor % rings.length];
        ringCursor += 1;
        ring.mesh.visible = true;
        ring.mesh.position.set(x, y, 0.5);
        ring.mesh.scale.setScalar(0.12);
        ring.material.uniforms.uRadius.value = 0.16;
        ring.material.uniforms.uOpacity.value = 0.95;
        ring.material.uniforms.uColor.value.set(palette.accent);
        ring.life = 0;
        ring.maxLife = 0.9;

        flash.position.set(x, y, 0.55);
        flash.scale.setScalar(0.9);
        flashMaterial.opacity = 0.95;
        flashLife = 1;
        void time;
    };

    const updateRings = (dt) => {
        for (const ring of rings) {
            if (!ring.mesh.visible) continue;
            ring.life += dt;
            const p = clamp(ring.life / ring.maxLife, 0, 1);
            ring.mesh.scale.setScalar(0.12 + p * 0.85);
            ring.material.uniforms.uRadius.value = 0.16 + p * 0.55;
            ring.material.uniforms.uOpacity.value = (1 - p) ** 1.2 * 0.9;
            if (p >= 1) ring.mesh.visible = false;
        }
        if (flashLife > 0) {
            flashLife = Math.max(0, flashLife - dt * 2.3);
            flash.scale.setScalar(0.9 + (1 - flashLife) * 2.4);
            flashMaterial.opacity = flashLife * 0.95;
        }
    };

    const updateBall = (time, dt, energy) => {
        const y = ballYAt(time);
        const keys = track.active();
        let next = null;
        let previous = null;
        for (const key of keys) {
            if (key.hit) continue;
            if (key.y < y) {
                if (!next || key.y > next.y) next = key;
            } else if (!previous || key.y < previous.y) {
                previous = key;
            }
        }
        let targetX = 0;
        if (next && previous) {
            const p = smoothstep(previous.y, next.y, y);
            targetX = lerp(previous.side * 1.40, next.side * 1.40, p);
        } else if (next) {
            targetX = next.side * 0.8;
        }
        ballX += (targetX - ballX) * (1 - Math.exp(-dt * 16));
        const pointY = y + bounce * 0.24;
        ball.position.set(ballX, pointY + 0.02, 0.42);
        ball.rotation.y += dt * 1.4;
        ball.rotation.z += dt * shake * 2.0;
        ball.scale.set(1 + squash * 0.62, 1 - squash * 0.52, 1 + squash * 0.62);
        ballGlow.position.copy(ball.position);
        ballGlow.scale.setScalar(2.1 + energy * 0.3);
        ballGlowMaterial.opacity = 0.45 + energy * 0.12;
    };

    const frame = (time, dt, lineIndex, paused) => {
        if (disposed) return;
        const safeDt = paused ? 0 : clamp(dt, 0, 0.05);
        const audioState = reactor.update(safeDt, time);
        const energy = audioState.energy;
        const targetChorus = lineIndex >= 0 && lines[lineIndex]?.isChorus ? 1 : 0;
        chorus += (targetChorus - chorus) * (1 - Math.exp(-(safeDt || 0.016) * 2.2));

        const y = ballYAt(time);
        const sinceSpawn = time - lastSpawn;
        const onset = audioState.onset && sinceSpawn > 0.16;
        const fallback = sinceSpawn > 0.62;
        if (!paused && (onset || fallback)) {
            spawnGroup(time, onset ? Math.max(0.2, audioState.onsetStrength) : 0.35);
            lastSpawn = time;
        }

        for (const key of track.active()) {
            if (!key.hit && previousBallY > key.y && y <= key.y) {
                track.press(key, time);
                impact(key, time);
            }
        }
        previousBallY = y;

        squash *= Math.exp(-safeDt * 7);
        bounce *= Math.exp(-safeDt * 5);
        shake *= Math.exp(-safeDt * 7);

        updateBall(time, safeDt, energy);

        cameraY += (y - cameraY) * (1 - Math.exp(-(safeDt || 0.016) * 6.0));
        const motion = clamp(stageSettings?.cameraMotion ?? 1, 0, 1.5);
        const sway = Math.sin(time * 0.35) * 0.06 * motion;
        camera.position.set(sway + (Math.random() - 0.5) * 0.10 * shake, cameraY + CAMERA.above + (Math.random() - 0.5) * 0.06 * shake, baseZ);
        camera.lookAt(0, cameraY + CAMERA.lookAhead, 0);
        camera.rotation.z = Math.sin(time * 0.5) * 0.004 * motion + (Math.random() - 0.5) * 0.01 * shake;

        track.update(time, cameraY, energy, chorus, safeDt);
        updateRings(safeDt);
        particles.update(safeDt, time);
        spawnDust(safeDt);
        background.update(time, energy, chorus);

        post.render({
            background,
            scene,
            camera,
            bloom: clamp((stageSettings?.glow ?? 1) * (0.85 + energy * 0.4 + chorus * 0.3), 0.15, 2.4),
            time,
            chorus,
        });
    };

    const spawnDust = (dt) => {
        dustTimer += dt;
        while (dustTimer > 0.08) {
            dustTimer -= 0.08;
            particles.spawn({
                x: (Math.random() - 0.5) * 9,
                y: cameraY - 8 + Math.random() * 14,
                z: -1 + Math.random() * 3,
                vy: -0.03 - Math.random() * 0.05,
                life: 4 + Math.random() * 4,
                size: 0.02 + Math.random() * 0.03,
                color: [0.85, 0.9, 1.0],
                alpha: 0.22 + Math.random() * 0.2,
                twinkle: 1,
            });
        }
    };

    const seek = (time) => {
        const y = ballYAt(time);
        previousBallY = y;
        cameraY = y;
        ballX = 0;
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
        const pressed = keys[3] ?? keys[0];
        if (pressed) {
            track.press(pressed, stillTime);
            impact(pressed, stillTime);
        }
        track.update(stillTime, anchor, 0.55, 0.4, 1 / 60);
        ball.position.set(pressed ? pressed.side * 1.40 : 0, (pressed ? pressed.y : anchor) + 0.02, 0.42);
        ballGlow.position.copy(ball.position);
        ballGlow.scale.setScalar(2.1);
        camera.position.set(0, anchor + CAMERA.above, baseZ);
        camera.lookAt(0, anchor + CAMERA.lookAhead, 0);
        camera.rotation.z = 0;
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
