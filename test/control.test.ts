// test/control.test.ts
// The one-shot transport controller: what it reads back, and what it does on a system without SMTC.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalController, parseControlAnswer } from '../src/media/control.js';
import { silentLogger } from './helpers/fakes.js';

test('a successful answer is read', () => {
    assert.deepEqual(parseControlAnswer('{"ok":true,"status":"Paused"}'), { ok: true, status: 'Paused' });
});

test('a refusal keeps its reason', () => {
    assert.deepEqual(parseControlAnswer('{"ok":false,"reason":"no-spotify-session"}'), { ok: false, reason: 'no-spotify-session' });
});

test('the answer is the last JSON line, after any noise', () => {
    assert.deepEqual(parseControlAnswer('some warning\n{"ok":true,"status":"Playing"}\n'), { ok: true, status: 'Playing' });
});

test('nothing usable is null', () => {
    assert.equal(parseControlAnswer(''), null);
    assert.equal(parseControlAnswer('not json'), null);
    assert.equal(parseControlAnswer('{"ok":"yes"}'), null, 'a non-boolean ok is not success');
});

test('a system without SMTC has no controller and answers false', async () => {
    const controller = createLocalController({ platform: 'linux', log: silentLogger() });
    assert.equal(controller.available, false);
    assert.equal(await controller.control('pause'), false);
});

test('a missing script is not "available"', () => {
    const controller = createLocalController({ platform: 'win32', log: silentLogger(), scriptPath: 'C:\\nope\\controlSession.ps1' });
    assert.equal(controller.available, false);
});
