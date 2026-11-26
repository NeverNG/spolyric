// test/connection.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readStageConnection } from '../src/folia/connection.js';
import { stageConnectionFileIn } from '../src/paths.js';
import { makeTempDir } from './helpers/temp.js';

const writeConnection = (userData: string, body: unknown): string => {
    const file = stageConnectionFileIn(userData);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
};

test('a connection file gives the address and the token', () => {
    const temp = makeTempDir();
    try {
        writeConnection(temp.dir, { version: 1, pid: 1234, port: 32107, baseUrl: 'http://127.0.0.1:32107', token: 'tok' });
        const connection = readStageConnection({
            platform: 'win32',
            home: temp.dir,
            env: { SPOLYRIC_FOLIA_DATA: temp.dir },
        });
        assert.ok(connection);
        assert.equal(connection.baseUrl, 'http://127.0.0.1:32107');
        assert.equal(connection.token, 'tok');
        assert.equal(connection.pid, 1234);
    } finally {
        temp.cleanup();
    }
});

test('an address given on the command line wins over the file', () => {
    const temp = makeTempDir();
    try {
        writeConnection(temp.dir, { port: 32107, baseUrl: 'http://127.0.0.1:32107', token: 'tok' });
        const connection = readStageConnection({
            env: { SPOLYRIC_FOLIA_DATA: temp.dir },
            explicitBaseUrl: 'http://127.0.0.1:40000/',
            explicitToken: 'other',
        });
        assert.equal(connection?.baseUrl, 'http://127.0.0.1:40000');
        assert.equal(connection?.token, 'other');
    } finally {
        temp.cleanup();
    }
});

test('an address given with no file still works', () => {
    const connection = readStageConnection({
        platform: 'win32',
        home: 'C:\\nobody',
        env: { SPOLYRIC_FOLIA_DATA: 'C:\\nobody\\Folia' },
        explicitBaseUrl: 'http://127.0.0.1:32107',
        explicitToken: 'token',
    });
    assert.equal(connection?.baseUrl, 'http://127.0.0.1:32107');
    assert.equal(connection?.filePath, null);
});

test('a broken or tokenless file is no connection', () => {
    const temp = makeTempDir();
    try {
        writeConnection(temp.dir, { port: 1, baseUrl: 'http://127.0.0.1:1' });
        assert.equal(readStageConnection({ env: { SPOLYRIC_FOLIA_DATA: temp.dir } }), null);
        fs.writeFileSync(stageConnectionFileIn(temp.dir), 'not json');
        assert.equal(readStageConnection({ env: { SPOLYRIC_FOLIA_DATA: temp.dir } }), null);
        // JSON that parses but is not an object must not throw either.
        fs.writeFileSync(stageConnectionFileIn(temp.dir), 'null');
        assert.equal(readStageConnection({ env: { SPOLYRIC_FOLIA_DATA: temp.dir } }), null);
        fs.writeFileSync(stageConnectionFileIn(temp.dir), '[]');
        assert.equal(readStageConnection({ env: { SPOLYRIC_FOLIA_DATA: temp.dir } }), null);
    } finally {
        temp.cleanup();
    }
});

test('nothing at all is null, not a throw', () => {
    assert.equal(readStageConnection({ platform: 'win32', home: 'C:\\nobody', env: { SPOLYRIC_FOLIA_DATA: 'C:\\nobody\\Folia' } }), null);
});
