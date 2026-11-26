// src/palette.mjs
// The stage's own colours. The screenshots' look is a deep periwinkle void with
// pastel keycaps; the theme is only allowed to tint the lyrics, so a user's
// bright or dark theme never breaks the scene.

export const PALETTES = {
    mist: {
        id: 'mist',
        label: { 'zh-CN': '雾蓝', en: 'Mist' },
        bgTop: '#38445f',
        bgMid: '#5c6d90',
        bgLow: '#8e9bb9',
        glow: '#b7c7ec',
        beam: '#dbe4ff',
        fog: '#495a78',
        shadow: '#1b2438',
        keys: ['#f0b9c6', '#f5c9b8', '#f2dcc8', '#e8b6c9', '#d6c2e4', '#f7e4cf'],
        text: '#f4edff',
        textDim: '#c9c8f2',
        accent: '#ffd9b8',
        bubble: ['#ffc9e6', '#bdf2ff', '#d9ccff'],
    },
    dusk: {
        id: 'dusk',
        label: { 'zh-CN': '暮紫', en: 'Dusk' },
        bgTop: '#2b2350',
        bgMid: '#4c3a7d',
        bgLow: '#7a5fa8',
        glow: '#e7a8ff',
        beam: '#ffd0ef',
        fog: '#473062',
        shadow: '#1c1236',
        keys: ['#f3d9c8', '#e8c2dd', '#cdb6ef', '#f7e4c0', '#b9b0e6', '#f0cfd6'],
        text: '#fff4fb',
        textDim: '#d3bde6',
        accent: '#ffc98f',
        bubble: ['#ffbcd8', '#c7b6ff', '#ffe9b8'],
    },
    mint: {
        id: 'mint',
        label: { 'zh-CN': '海盐', en: 'Mint' },
        bgTop: '#1f3d58',
        bgMid: '#2f6178',
        bgLow: '#5b9aa8',
        glow: '#9ff0e4',
        beam: '#d3fff6',
        fog: '#2e5867',
        shadow: '#132c3c',
        keys: ['#d9f2e3', '#bfe7e2', '#f4eccd', '#f2c9b8', '#b5d9f0', '#e3e6f8'],
        text: '#f2fffd',
        textDim: '#b8dedc',
        accent: '#ffe0a8',
        bubble: ['#b8ffe9', '#c8e2ff', '#fff2c2'],
    },
};

export const paletteOf = (id) => PALETTES[id] ?? PALETTES.mist;

/** #rrggbb -> [r, g, b] in 0..1, the form shader uniforms want. */
export const rgb = (hex) => {
    const value = String(hex ?? '').replace('#', '');
    const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
    const number = Number.parseInt(full, 16);
    if (!Number.isFinite(number)) return [1, 1, 1];
    return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
};
