// test/stage.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { StageApiError, createStageClient } from '../src/folia/stage.js';
import type { StageConnection } from '../src/folia/connection.js';
import { silentLogger } from './helpers/fakes.js';
import { startTestServer } from './helpers/server.js';

const connectionTo = (baseUrl: string): StageConnection => ({ filePath: null, baseUrl, token: 'secret-token', port: null, pid: null });

test('pushing a session goes out with the token and reads back updatedAt', async () => {
    const server = await startTestServer(request => {
        if (request.url === '/stage/lyrics') {
            return {
                json: {
                    enabled: true,
                    modeEnabled: true,
                    source: 'stage-api',
                    activeEntryKind: 'lyrics',
                    lyricsSession: { title: 'A', updatedAt: 1_700_000_000_123 },
                },
            };
        }
        return { status: 404, json: { error: 'not found' } };
    });
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        const answer = await stage.pushLyrics({
            title: 'A',
            artist: 'B',
            durationMs: 1000,
            positionMs: 10,
            paused: false,
            lyricSource: { type: 'local', lrcContent: '[00:00.00]x', formatHint: 'lrc' },
        });
        assert.equal(answer.sessionUpdatedAt, 1_700_000_000_123);
        const sent = server.requests[0];
        assert.equal(sent?.method, 'POST');
        assert.equal(sent?.headers.authorization, 'Bearer secret-token');
        const body = JSON.parse(sent?.body ?? '{}');
        assert.equal(body.title, 'A');
        assert.equal(body.lyricSource.formatHint, 'lrc');
    } finally {
        await server.close();
    }
});

test('the clock answer says which session it belongs to', async () => {
    const server = await startTestServer(() => ({ json: { sessionUpdatedAt: 42, clock: { positionMs: 1, paused: false, sampledAtMs: 2 } } }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        assert.deepEqual(await stage.pushClock({ positionMs: 1, paused: false, sessionUpdatedAt: 42 }), { sessionUpdatedAt: 42 });
    } finally {
        await server.close();
    }
});

test('status tells which session the stage holds, with its title when Folia gives one', async () => {
    const server = await startTestServer(() => ({
        json: {
            enabled: true,
            modeEnabled: true,
            source: 'stage-api',
            activeEntryKind: 'lyrics',
            lyricsSession: { updatedAt: 77, title: 'A Song', artist: 'An Artist' },
        },
    }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        const status = await stage.status();
        assert.deepEqual(status.lyricsSession, { updatedAt: 77, title: 'A Song', artist: 'An Artist' });
    } finally {
        await server.close();
    }
});

test('a stage error keeps its code', async () => {
    const server = await startTestServer(() => ({ status: 409, json: { error: 'the session changed', code: 'STAGE_LYRICS_SESSION_CHANGED', details: { sessionUpdatedAt: 7 } } }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        await assert.rejects(
            stage.pushClock({ positionMs: 1 }),
            (error: unknown) => {
                assert.ok(error instanceof StageApiError);
                assert.equal(error.code, 'STAGE_LYRICS_SESSION_CHANGED');
                assert.equal(error.status, 409);
                return true;
            },
        );
    } finally {
        await server.close();
    }
});

test('health is asked without the token, and answers null when nothing is listening', async () => {
    const server = await startTestServer(() => ({ json: { enabled: true, modeEnabled: true, source: 'stage-api', port: 1, activeEntryKind: null } }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        const health = await stage.health();
        assert.equal(health?.modeEnabled, true);
        assert.equal(server.requests[0]?.headers.authorization, undefined);
        const dead = createStageClient({ connection: connectionTo('http://127.0.0.1:1'), log: silentLogger() });
        assert.equal(await dead.health(), null);
    } finally {
        await server.close();
    }
});

test('clear deletes the state', async () => {
    const server = await startTestServer(() => ({ json: { activeEntryKind: null, lyricsSession: null } }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        await stage.clear();
        assert.equal(server.requests[0]?.method, 'DELETE');
        assert.equal(server.requests[0]?.url, '/stage/state');
    } finally {
        await server.close();
    }
});

test('a push without a session in the answer is an error, not a silent success', async () => {
    const server = await startTestServer(() => ({ json: { activeEntryKind: 'lyrics' } }));
    try {
        const stage = createStageClient({ connection: connectionTo(server.baseUrl), log: silentLogger() });
        await assert.rejects(stage.pushLyrics({ title: 'A' }), /did not answer a session/);
    } finally {
        await server.close();
    }
});
