// test/zh.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { toSimplified } from '../src/lyrics/zh.js';

test('traditional characters become simplified for matching', () => {
    assert.equal(toSimplified('白樺林'), '白桦林');
    assert.equal(toSimplified('朴樹'), '朴树');
    assert.equal(toSimplified('許嵩'), '许嵩');
    assert.equal(toSimplified('斷橋殘雪'), '断桥残雪');
});

test('simplified and latin text are left alone', () => {
    assert.equal(toSimplified('白桦林'), '白桦林');
    assert.equal(toSimplified('An Appointment With 1998'), 'An Appointment With 1998');
});
