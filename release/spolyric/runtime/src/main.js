#!/usr/bin/env node
// src/main.ts
// The entry point: hand the arguments to the commands and set the exit code.
import { main } from './cli/commands.js';
main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
}, error => {
    console.error('[Spolyric] 未能完成:', error);
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map