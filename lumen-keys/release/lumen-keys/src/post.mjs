// src/post.mjs
// The stage's post chain: bright pass, two-pass blur at half resolution and one
// composite with bloom, vignette, grain and a touch of chromatic aberration.
// Everything is raw three.js render targets; no examples/jsm addons, so the mod
// needs only three's ESM build.

import * as THREE from '../vendor/three.module.js';

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const brightFragment = /* glsl */ `
uniform sampler2D tScene;
uniform float uThreshold;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(uThreshold, uThreshold + 0.35, l);
    gl_FragColor = vec4(c * k, 1.0);
}
`;

const blurFragment = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
    vec3 sum = vec3(0.0);
    float weightSum = 0.0;
    for (int i = -4; i <= 4; i += 1) {
        float weight = exp(-float(i * i) * 0.11);
        sum += texture2D(tMap, vUv + uDir * float(i)).rgb * weight;
        weightSum += weight;
    }
    gl_FragColor = vec4(sum / weightSum, 1.0);
}
`;

const compositeFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uTime;
uniform float uAspect;
uniform float uChorus;
uniform float uGrain;
uniform float uAberration;
uniform float uVignette;
varying vec2 vUv;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 dir = vUv - 0.5;
    float amount = uAberration * dot(dir, dir);
    vec3 base;
    base.r = texture2D(tScene, vUv + dir * amount).r;
    base.g = texture2D(tScene, vUv).g;
    base.b = texture2D(tScene, vUv - dir * amount).b;

    vec3 bloom = texture2D(tBloom, vUv).rgb;
    vec3 col = base + bloom * uBloom;

    // A gentle lift in the mids keeps the pastel keys from going grey.
    col = col * 1.02 + vec3(0.012, 0.014, 0.030) * (1.0 - col);

    vec2 v = (vUv - 0.5) * vec2(uAspect * 0.92, 1.0);
    col *= mix(1.0 - uVignette, 1.0, smoothstep(1.15, 0.30, length(v)));
    col += vec3(0.02, 0.03, 0.06) * uChorus * smoothstep(0.8, 0.0, length(dir));

    float grain = hash21(vUv * vec2(1920.0, 1080.0) + floor(uTime * 30.0));
    col += (grain - 0.5) * uGrain;

    col = pow(max(col, 0.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
}
`;

const makeQuadScene = (fragmentShader, uniforms) => {
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: quadVertex,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    return { scene, material };
};

export const createPost = ({ renderer, width, height, quality = 1 }) => {
    renderer.autoClear = false;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bloomScale = quality >= 0.9 ? 0.5 : 0.35;

    const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
    });

    const brightTarget = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(width * bloomScale)), Math.max(1, Math.floor(height * bloomScale)), {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
    });

    const blurTargetA = brightTarget.clone();
    const blurTargetB = brightTarget.clone();

    const bright = makeQuadScene(brightFragment, {
        tScene: { value: sceneTarget.texture },
        uThreshold: { value: 0.70 },
    });
    const blur = makeQuadScene(blurFragment, {
        tMap: { value: brightTarget.texture },
        uDir: { value: new THREE.Vector2(1 / 640, 0) },
    });
    const composite = makeQuadScene(compositeFragment, {
        tScene: { value: sceneTarget.texture },
        tBloom: { value: blurTargetB.texture },
        uBloom: { value: 0.85 },
        uTime: { value: 0 },
        uAspect: { value: width / Math.max(1, height) },
        uChorus: { value: 0 },
        uGrain: { value: 0.022 },
        uAberration: { value: 0.008 },
        uVignette: { value: 0.28 },
    });

    let disposed = false;
    let texelX = 1 / Math.max(1, width);
    let texelY = 1 / Math.max(1, height);

    const pass = (material, targetScene, target) => {
        renderer.setRenderTarget(target);
        renderer.render(targetScene, camera);
    };

    return {
        sceneTarget,
        resize: (nextWidth, nextHeight) => {
            const safeWidth = Math.max(1, Math.floor(nextWidth));
            const safeHeight = Math.max(1, Math.floor(nextHeight));
            const bw = Math.max(1, Math.floor(safeWidth * bloomScale));
            const bh = Math.max(1, Math.floor(safeHeight * bloomScale));
            sceneTarget.setSize(safeWidth, safeHeight);
            brightTarget.setSize(bw, bh);
            blurTargetA.setSize(bw, bh);
            blurTargetB.setSize(bw, bh);
            texelX = 1 / safeWidth;
            texelY = 1 / safeHeight;
            composite.material.uniforms.uAspect.value = safeWidth / safeHeight;
        },
        render: ({ background, scene, camera: stageCamera, bloom = 1, time, chorus = 0, grain = 1 }) => {
            if (disposed) return;
            renderer.setRenderTarget(sceneTarget);
            renderer.clear();
            renderer.render(background.scene, background.camera);
            renderer.render(scene, stageCamera);

            pass(bright.material, bright.scene, brightTarget);
            blur.material.uniforms.tMap.value = brightTarget.texture;
            blur.material.uniforms.uDir.value.set((texelX / bloomScale) * 1.4, 0);
            pass(blur.material, blur.scene, blurTargetA);
            blur.material.uniforms.tMap.value = blurTargetA.texture;
            blur.material.uniforms.uDir.value.set(0, (texelY / bloomScale) * 1.4);
            pass(blur.material, blur.scene, blurTargetB);

            composite.material.uniforms.uBloom.value = 0.24 * bloom;
            composite.material.uniforms.uTime.value = time;
            composite.material.uniforms.uChorus.value = chorus;
            composite.material.uniforms.uGrain.value = 0.02 * grain;
            renderer.setRenderTarget(null);
            renderer.render(composite.scene, camera);
        },
        dispose: () => {
            disposed = true;
            sceneTarget.dispose();
            brightTarget.dispose();
            blurTargetA.dispose();
            blurTargetB.dispose();
            bright.material.dispose();
            blur.material.dispose();
            composite.material.dispose();
            bright.scene.traverse((object) => object.geometry?.dispose());
            blur.scene.traverse((object) => object.geometry?.dispose());
            composite.scene.traverse((object) => object.geometry?.dispose());
        },
    };
};
