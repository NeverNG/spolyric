// scripts/copy-assets.mjs
// tsc only emits JavaScript; the PowerShell scripts it starts have to sit beside the compiled files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = ['readSession.ps1', 'controlSession.ps1'];

for (const name of assets) {
    const source = path.join(root, 'src', 'media', name);
    const target = path.join(root, 'dist', 'src', 'media', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    console.log(`copied ${path.relative(root, source)} -> ${path.relative(root, target)}`);
}
