// test/helpers/cover.ts
// A cover server for tests: no socket, just the URL shape the resolver expects.
import type { CoverServer } from '../../src/cover/server.js';

export const fakeCoverServer = (base = 'http://127.0.0.1:9'): CoverServer & { started: number } => {
    const server = {
        started: 0,
        async start() {
            server.started += 1;
            return base;
        },
        urlFor(key: string) {
            return `${base}/cover/${key}.jpg`;
        },
        close() {
            // nothing to close
        },
    };
    return server;
};
