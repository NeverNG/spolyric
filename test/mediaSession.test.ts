// test/mediaSession.test.ts
// The PowerShell reader prints one JSON line per sample; this is how those lines are understood.

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSessionLine, parseSessionLine } from '../src/media/session.js';

test('a Spotify sample becomes a snapshot', () => {
    const parsed = parseSessionLine(JSON.stringify({
        session: 'current',
        app: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
        title: '懷念青春',
        artist: '劉剛',
        album: '劉剛作品集',
        durationMs: 268000,
        positionMs: 149093,
        playing: true,
        status: 4,
    }));
    assert.equal(parsed.kind, 'snapshot');
    if (parsed.kind !== 'snapshot') return;
    assert.equal(parsed.snapshot.title, '懷念青春');
    assert.equal(parsed.snapshot.artist, '劉剛');
    assert.equal(parsed.snapshot.durationMs, 268000);
    assert.equal(parsed.snapshot.positionMs, 149093);
    assert.equal(parsed.snapshot.isPlaying, true);
});

test('nothing playing is "none", not an error', () => {
    assert.deepEqual(parseSessionLine('{"session":null}'), { kind: 'none' });
    assert.deepEqual(parseSessionLine(''), { kind: 'none' });
});

test('a sample without a title is nothing to show', () => {
    assert.deepEqual(parseSessionLine('{"session":"current","title":""}'), { kind: 'none' });
});

test('the script\'s own complaint is reported as an error, not a track', () => {
    const parsed = parseSessionLine('{"session":null,"error":"Access denied"}');
    assert.deepEqual(parsed, { kind: 'error', message: 'Access denied' });
});

test('a broken line does not throw', () => {
    assert.equal(parseSessionLine('not json').kind, 'error');
    assert.equal(parseSessionLine('null').kind, 'error');
});

test('numbers arrive as numbers or strings, and are read either way', () => {
    const parsed = parseSessionLine(JSON.stringify({ session: 'current', title: 'A', durationMs: '1234', positionMs: 42.6 }));
    assert.equal(parsed.kind, 'snapshot');
    if (parsed.kind !== 'snapshot') return;
    assert.equal(parsed.snapshot.durationMs, 1234);
    assert.equal(parsed.snapshot.positionMs, 43);
});

test('a UTF-8 output line keeps Chinese names', () => {
    const bytes = Buffer.from('{"session":"current","title":"披着羊皮的狼","artist":"刀郎"}', 'utf8');
    assert.equal(decodeSessionLine(bytes), '{"session":"current","title":"披着羊皮的狼","artist":"刀郎"}');
});

test('a GBK output line (an older PowerShell ignoring UTF-8) is still read correctly', () => {
    // 「披着羊皮的狼」 in GBK, as Windows PowerShell 5.1 writes it on a Chinese console code page.
    const gbk = Buffer.from('c5fbd7c5d1f2c6a4b5c4c0c7', 'hex');
    assert.equal(decodeSessionLine(gbk), '披着羊皮的狼');
});

test('bytes that are neither UTF-8 nor GBK do not throw', () => {
    assert.equal(typeof decodeSessionLine(Buffer.from([0xff, 0xfe, 0x00, 0x01])), 'string');
});
