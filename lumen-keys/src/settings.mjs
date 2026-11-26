// src/settings.mjs
// The schema the host renders under the lyric-style picker. Values are merged
// with the defaults by the host and persist with the rest of the visual config.

export const SETTINGS = [
    {
        key: 'palette',
        type: 'select',
        label: { 'zh-CN': '配色', en: 'Palette' },
        options: [
            { value: 'mist', label: { 'zh-CN': '雾蓝', en: 'Mist' } },
            { value: 'dusk', label: { 'zh-CN': '暮紫', en: 'Dusk' } },
            { value: 'mint', label: { 'zh-CN': '海盐', en: 'Mint' } },
        ],
        defaultValue: 'mist',
    },
    {
        key: 'glow',
        type: 'number',
        label: { 'zh-CN': '辉光', en: 'Glow' },
        description: { 'zh-CN': '灯光、小球和琴键的发光强度', en: 'Bloom on the keys, orbs and lights' },
        min: 0.2,
        max: 1.8,
        step: 0.05,
        defaultValue: 1,
    },
    {
        key: 'density',
        type: 'number',
        label: { 'zh-CN': '小球密度', en: 'Orb density' },
        description: { 'zh-CN': '每个字发出的小球数量与节拍小球频率', en: 'Orbs per character, and how often beats send one' },
        min: 0.4,
        max: 2,
        step: 0.05,
        defaultValue: 1,
    },
    {
        key: 'fontScale',
        type: 'number',
        label: { 'zh-CN': '歌词字号', en: 'Lyric size' },
        min: 0.65,
        max: 1.5,
        step: 0.05,
        defaultValue: 1,
    },
    {
        key: 'cameraMotion',
        type: 'number',
        label: { 'zh-CN': '镜头漂移', en: 'Camera drift' },
        description: { 'zh-CN': '镜头的缓慢移动幅度；设为 0 固定机位', en: 'How far the camera drifts; 0 pins it' },
        min: 0,
        max: 1.5,
        step: 0.05,
        defaultValue: 1,
    },
    {
        key: 'bubble',
        type: 'boolean',
        label: { 'zh-CN': '虹彩泡泡', en: 'Iridescent bubble' },
        defaultValue: true,
    },
    {
        key: 'reactive',
        type: 'boolean',
        label: { 'zh-CN': '跟随音乐能量', en: 'Follow the music' },
        description: { 'zh-CN': '用 Folia 正在播放的音频控制呼吸和节拍小球', en: 'Use the audio Folia is playing for breathing and beat orbs' },
        defaultValue: true,
    },
];

export const DEFAULT_SETTINGS = Object.fromEntries(SETTINGS.map((entry) => [entry.key, entry.defaultValue]));
