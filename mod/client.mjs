// mod/client.mjs
// Spolyric's two transport buttons beside Folia's progress bar. Folia's own previous/next are disabled in
// an external Stage session (the Stage API reports `previous: false, next: false`), so the mod puts two
// buttons of its own on the bar and asks the main entry to send the key to the local Spotify client.

export default function activate(folium) {
    if (folium.env.context !== 'main') return undefined;
    if (!folium.registries || !folium.registries.progressButtons) return undefined;

    const isStage = () => {
        try {
            return folium.playback.getQueue({ limit: 1 }).kind === 'stage';
        } catch {
            return false;
        }
    };

    const send = async action => {
        if (!isStage()) {
            folium.ui.toast('Spolyric：只有在舞台模式（Stage API）下才能控制 Spotify 切歌', { durationMs: 2200 });
            return;
        }
        try {
            await folium.rpc.call('transport', action);
        } catch (error) {
            folium.log.error(`Spolyric 没能切歌（${action}）`, error);
        }
    };

    const mountButton = (action, iconName, label, fallbackText) => container => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;'
            + 'width:22px;height:22px;border-radius:6px;opacity:0.7;transition:opacity 120ms;';
        button.addEventListener('pointerenter', () => { button.style.opacity = '1'; });
        button.addEventListener('pointerleave', () => { button.style.opacity = '0.7'; });
        button.addEventListener('click', () => { void send(action); });
        button.textContent = fallbackText;
        void folium.ui.icon(iconName, { size: 15 }).then(svg => {
            if (!svg) return;
            button.textContent = '';
            button.appendChild(svg);
        }).catch(() => { /* keep the text */ });
        container.appendChild(button);
    };

    folium.registries.progressButtons.register({
        id: 'prev',
        slot: 'progress.leading',
        order: 480,
        mount: mountButton('prev', 'skip-back', '上一首（Spolyric）', '⏮'),
    });
    folium.registries.progressButtons.register({
        id: 'next',
        slot: 'progress.trailing',
        order: 480,
        mount: mountButton('next', 'skip-forward', '下一首（Spolyric）', '⏭'),
    });
}
