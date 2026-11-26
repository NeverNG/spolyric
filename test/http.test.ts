// test/http.test.ts
// The error carries enough of Spotify's answer to say why, not just the status code.

import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError, parseJson } from '../src/http.js';

test('a Spotify error keeps the message and the reason in the error text', () => {
    const error = new HttpError('https://api.spotify.com/v1/me/player', 403, JSON.stringify({
        error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' },
    }));
    assert.equal(error.status, 403);
    assert.equal(error.apiMessage, 'Player command failed: Premium required');
    assert.equal(error.apiReason, 'PREMIUM_REQUIRED');
    assert.match(error.message, /api\.spotify\.com answered 403/);
    assert.match(error.message, /Premium required/);
    assert.match(error.message, /PREMIUM_REQUIRED/);
    assert.equal(error.codeOf(), 'PREMIUM_REQUIRED');
});

test('an OAuth-style answer (error string plus description) is read too', () => {
    const error = new HttpError('https://accounts.spotify.com/api/token', 400, JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Refresh token revoked',
    }));
    assert.equal(error.apiMessage, 'invalid_grant');
    assert.equal(error.apiReason, 'Refresh token revoked');
    assert.match(error.message, /invalid_grant/);
    assert.equal(error.codeOf(), 'invalid_grant');
});

test('an answer that is not JSON still has a readable message', () => {
    const error = new HttpError('https://api.spotify.com/v1/me/player', 502, '<html>bad gateway</html>');
    assert.equal(error.apiMessage, '');
    assert.equal(error.apiReason, '');
    assert.match(error.message, /answered 502/);
    assert.equal(error.codeOf(), null);
});

test('parseJson is only JSON or nothing', () => {
    assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
    assert.equal(parseJson(''), null);
    assert.equal(parseJson('nope'), null);
});
