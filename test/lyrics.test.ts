// test/lyrics.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { lrcFromSpotifyAnswer, lrcTimestamp, normalizeLrc } from '../src/spotify/lyrics.js';

test('a timestamp is mm:ss.xx', () => {
    assert.equal(lrcTimestamp(0), '[00:00.00]');
    assert.equal(lrcTimestamp(1234), '[00:01.23]');
    assert.equal(lrcTimestamp(65_430), '[01:05.43]');
    assert.equal(lrcTimestamp(3_600_000), '[60:00.00]');
});

test('Spotify line lyrics become LRC in time order', () => {
    const lrc = lrcFromSpotifyAnswer({
        lyrics: {
            syncType: 'LINE_SYNCED',
            lines: [
                { startTimeMs: '5000', words: 'second' },
                { startTimeMs: '1000', words: 'first' },
                { startTimeMs: '0', words: '♪' },
                { startTimeMs: '3000', words: '   ' },
            ],
        },
    });
    assert.equal(lrc, '[00:01.00]first\n[00:05.00]second');
});

test('an unsynced lyric answer is no lyrics at all', () => {
    assert.equal(lrcFromSpotifyAnswer({ lyrics: { syncType: 'UNSYNCED', lines: [{ startTimeMs: '0', words: 'hello' }] } }), null);
});

test('an empty or malformed answer is no lyrics', () => {
    assert.equal(lrcFromSpotifyAnswer(null), null);
    assert.equal(lrcFromSpotifyAnswer({}), null);
    assert.equal(lrcFromSpotifyAnswer({ lyrics: { lines: [] } }), null);
    assert.equal(lrcFromSpotifyAnswer({ lyrics: { lines: [{ startTimeMs: 'oops', words: 'x' }] } }), null);
});

test('only a text with timestamps counts as LRC', () => {
    assert.equal(normalizeLrc('just words\nno times'), null);
    assert.equal(normalizeLrc('[00:01.00]one'), null);
    assert.equal(normalizeLrc('[00:01.00]one\n[00:02.50]two\r\n'), '[00:01.00]one\n[00:02.50]two');
    assert.equal(normalizeLrc(42), null);
});

test('LRCLIB-style blank timed lines are dropped, not shown as empty lyric lines', () => {
    const text = '[00:26.13] 我小心翼翼的接近\n[00:28.13] \n[00:52.74] 怕你在夢中驚醒\n[00:54.74]  \n';
    assert.equal(normalizeLrc(text), '[00:26.13] 我小心翼翼的接近\n[00:52.74] 怕你在夢中驚醒');
});

test('several timestamps on one line count when words follow them', () => {
    assert.equal(normalizeLrc('[00:01.00][00:05.00]same words\n[00:09.00]next'), '[00:01.00][00:05.00]same words\n[00:09.00]next');
});
