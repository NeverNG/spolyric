// client.mjs
// Folium client entry: one lyric animation mode. No permissions, no main
// process entry, no network; the whole mod is this renderer code and three.

import { SETTINGS } from './src/settings.mjs';
import { mountLumen } from './src/mount.mjs';

export default function activate(folium) {
    folium.registries.visualizers.register({
        id: 'lumen',
        label: { 'zh-CN': '流光琴键', en: 'Lumen Keys' },
        order: 440,
        settings: SETTINGS,
        // The stage paints its own background and its own main line; the host
        // still draws the translation / next-line subtitles at the bottom.
        hostLayers: { background: false, subtitles: true },
        mount: (container, ctx) => mountLumen(folium, container, ctx),
    });
}
