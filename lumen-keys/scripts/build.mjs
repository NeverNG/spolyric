// scripts/build.mjs
// Copies the files a mod actually needs into release/lumen-keys. The zipped
// folder is what gets dropped into Folia's mod panel; nothing here needs a
// bundler because the client is plain ESM and three is vendored.

import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'release', 'lumen-keys');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of ['mod.json', 'client.mjs', 'README.md', 'LICENSE.txt', 'preview.jpg']) {
    await cp(join(root, entry), join(out, entry));
}
for (const directory of ['src', 'vendor']) {
    await cp(join(root, directory), join(out, directory), { recursive: true });
}

const walk = async (directory) => {
    let bytes = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) bytes += await walk(full);
        else bytes += (await stat(full)).size;
    }
    return bytes;
};

console.log(`built ${out}`);
console.log(`size ${((await walk(out)) / 1024 / 1024).toFixed(2)} MB`);
