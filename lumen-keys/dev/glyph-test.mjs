// dev/glyph-test.mjs
// Isolates the glyph rasteriser: draws the cache's canvas and a direct
// fillText next to each other, so a missing font or an empty texture is
// obvious in a screenshot.

import { createGlyphCache } from '../src/glyphs.mjs';

const out = document.getElementById('out');
const family = '"Songti SC","STSong","SimSun","Noto Serif SC",serif';

const direct = document.createElement('canvas');
direct.width = 400;
direct.height = 200;
const context = direct.getContext('2d');
context.fillStyle = '#222';
context.fillRect(0, 0, 400, 200);
context.fillStyle = '#fff';
context.font = `400 120px ${family}`;
context.textAlign = 'center';
context.textBaseline = 'middle';
context.fillText('心事我了', 200, 100);
out.appendChild(direct);

const cache = createGlyphCache({ family });
for (const char of ['心', '事', '我', '了']) {
    const entry = cache.get(char);
    const source = entry.texture.image;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(source, 0, 0);
    out.appendChild(canvas);
    const data = ctx.getImageData(0, 0, 256, 256).data;
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        const px = (i / 4) % 256;
        const py = Math.floor((i / 4) / 256);
        sx += px * a; sy += py * a; sw += a;
    }
    const label = document.createElement('div');
    label.textContent = `${char} advance=${entry.advance.toFixed(3)} centroid=${(sx / sw).toFixed(1)},${(sy / sw).toFixed(1)}`;
    out.appendChild(label);
}

const info = document.createElement('div');
info.textContent = `fonts: ${document.fonts.status}; families: ${document.fonts.size}`;
out.appendChild(info);
