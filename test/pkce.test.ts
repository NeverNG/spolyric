// test/pkce.test.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { base64Url, createPkcePair, randomState } from '../src/spotify/pkce.js';

const fixedRandom = (size: number) => Buffer.alloc(size, 7);

test('the verifier is 43 to 128 base64url characters', () => {
    const pair = createPkcePair();
    assert.match(pair.verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.match(pair.challenge, /^[A-Za-z0-9_-]{43}$/);
});

test('the challenge is the S256 hash of the verifier', () => {
    const pair = createPkcePair(fixedRandom);
    const expected = base64Url(crypto.createHash('sha256').update(pair.verifier).digest());
    assert.equal(pair.challenge, expected);
});

test('the same random bytes give the same pair', () => {
    assert.deepEqual(createPkcePair(fixedRandom), createPkcePair(fixedRandom));
});

test('a base64url string has no padding and no + or /', () => {
    const encoded = base64Url(Buffer.from([0xfb, 0xff, 0xfe]));
    assert.doesNotMatch(encoded, /[+/=]/);
});

test('the state is 16 random bytes, url-safe', () => {
    const state = randomState(fixedRandom);
    assert.match(state, /^[A-Za-z0-9_-]{22}$/);
});
