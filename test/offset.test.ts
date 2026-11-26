// test/offset.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftLrc } from '../src/lyrics/offset.js';

test('an offset moves every timestamp and keeps the LRC shape', () => {
    const lrc = '[00:01.00]first\n[01:02.345]second';
    assert.equal(shiftLrc(lrc, 500), '[00:01.50]first\n[01:02.85]second');
    assert.equal(shiftLrc(lrc, -500), '[00:00.50]first\n[01:01.85]second');
});

test('a negative offset never goes below zero', () => {
    assert.equal(shiftLrc('[00:00.10]start', -500), '[00:00.00]start');
});

test('no offset leaves the text alone', () => {
    const lrc = '[00:01.00]first';
    assert.equal(shiftLrc(lrc, 0), lrc);
});
