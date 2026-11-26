// test/paths.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { findStageConnectionFile, resolveDataDir, stageConnectionCandidates, stageConnectionFileIn } from '../src/paths.js';
import { makeTempDir } from './helpers/temp.js';

test('the data directory follows the system', () => {
    assert.equal(
        resolveDataDir({ platform: 'win32', home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } }),
        path.join('C:\\Users\\me\\AppData\\Roaming', 'Spolyric'),
    );
    assert.equal(
        resolveDataDir({ platform: 'darwin', home: '/Users/me', env: {} }),
        path.join('/Users/me/Library/Application Support', 'Spolyric'),
    );
    assert.equal(
        resolveDataDir({ platform: 'linux', home: '/home/me', env: { XDG_CONFIG_HOME: '/home/me/.config' } }),
        path.join('/home/me/.config', 'spolyric'),
    );
});

test('SPOLYRIC_HOME moves everything', () => {
    const resolved = resolveDataDir({ platform: 'win32', home: 'C:\\Users\\me', env: { SPOLYRIC_HOME: 'D:\\portable' } });
    assert.equal(resolved, path.resolve('D:\\portable'));
});

test('on Linux the runtime directory is the first place checked for the connection file', () => {
    const files = stageConnectionCandidates({
        platform: 'linux',
        home: '/home/me',
        env: { XDG_RUNTIME_DIR: '/run/user/1000', XDG_CONFIG_HOME: '/home/me/.config' },
    });
    assert.equal(files[0], path.join('/run/user/1000', 'folia', 'stage.json'));
    assert.ok(files.includes(path.join('/home/me/.config', 'Folia', 'stage', 'connection.json')));
});

test('a data directory that starts with "folia" is found on Windows too', () => {
    const temp = makeTempDir();
    try {
        const userData = path.join(temp.dir, 'folia-major');
        const file = stageConnectionFileIn(userData);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ token: 't', baseUrl: 'http://127.0.0.1:1' }));
        const found = findStageConnectionFile({ platform: 'win32', home: temp.dir, env: { APPDATA: temp.dir } });
        assert.equal(found, file);
    } finally {
        temp.cleanup();
    }
});

test('an explicit path is used even when nothing is there', () => {
    const explicit = path.join(makeTempDir().dir, 'nope', 'connection.json');
    assert.equal(findStageConnectionFile({ explicit }), path.resolve(explicit));
});
