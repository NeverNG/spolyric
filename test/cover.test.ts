// test/cover.test.ts
// Cover lookup: a confident catalogue match becomes a data URL; a miss is null; the cache stops refetching.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoverResolver } from '../src/cover/resolver.js';
import { fakeCoverServer } from './helpers/cover.js';
import { silentLogger } from './helpers/fakes.js';
import { makeTempDir } from './helpers/temp.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const track = {
    id: 'local:X|Y',
    kind: 'track' as const,
    title: 'X',
    artists: ['Y'],
    album: 'Album',
    durationMs: 200_000,
    coverUrl: null,
};

const bytes = async () => ({ status: 200, headers: new Headers(), bytes: JPEG });

test('a Deezer match is downloaded and returned as a data URL', async () => {
    const temp = makeTempDir();
    try {
        let downloads = 0;
        const resolver = createCoverResolver({
            cacheDir: temp.dir,
            server: fakeCoverServer(),
            log: silentLogger(),
            fetchJsonImpl: async () => ({
                body: { data: [{ title: 'X', artist: { name: 'Y' }, duration: 200, album: { cover_big: 'https://img/x.jpg' } }] },
            }),
            fetchBytesImpl: async () => {
                downloads += 1;
                return bytes();
            },
        });
        const cover = await resolver.get(track);
        assert.ok(cover);
        assert.equal(cover.source, 'deezer');
        assert.ok(cover.url.startsWith('http://127.0.0.1:9/cover/'));
        assert.equal(downloads, 1);
    } finally {
        temp.cleanup();
    }
});

test('a second lookup comes from the cache', async () => {
    const temp = makeTempDir();
    try {
        let searches = 0;
        const resolver = createCoverResolver({
            cacheDir: temp.dir,
            server: fakeCoverServer(),
            log: silentLogger(),
            fetchJsonImpl: async url => {
                if (url.includes('deezer')) searches += 1;
                return { body: { data: [{ title: 'X', artist: { name: 'Y' }, duration: 200, album: { cover_big: 'https://img/x.jpg' } }] } };
            },
            fetchBytesImpl: bytes,
        });
        await resolver.get(track);
        const again = await resolver.get(track);
        assert.equal(again?.source, 'cache');
        assert.equal(searches, 1, 'the catalogue is not asked twice');
    } finally {
        temp.cleanup();
    }
});

test('iTunes is tried when Deezer has nothing', async () => {
    const temp = makeTempDir();
    try {
        const resolver = createCoverResolver({
            cacheDir: temp.dir,
            server: fakeCoverServer(),
            log: silentLogger(),
            fetchJsonImpl: async url => (url.includes('deezer')
                ? { body: { data: [] } }
                : { body: { results: [{ trackName: 'X', artistName: 'Y', trackTimeMillis: 200_000, artworkUrl100: 'https://img/x/100x100bb.jpg' }] } }),
            fetchBytesImpl: bytes,
        });
        const cover = await resolver.get(track);
        assert.equal(cover?.source, 'itunes');
    } finally {
        temp.cleanup();
    }
});

test('a romanised artist with an exact title and duration is accepted', async () => {
    const temp = makeTempDir();
    try {
        const resolver = createCoverResolver({
            cacheDir: temp.dir,
            server: fakeCoverServer(),
            log: silentLogger(),
            fetchJsonImpl: async url => (url.includes('deezer')
                ? { body: { data: [] } }
                : { body: { results: [{ trackName: 'X', artistName: 'JJ Lin', trackTimeMillis: 200_000, artworkUrl100: 'https://img/x/100x100bb.jpg' }] } }),
            fetchBytesImpl: bytes,
        });
        assert.equal((await resolver.get(track))?.source, 'itunes');
    } finally {
        temp.cleanup();
    }
});

test('a wrong artist is not accepted', async () => {
    const temp = makeTempDir();
    try {
        const resolver = createCoverResolver({
            cacheDir: temp.dir,
            server: fakeCoverServer(),
            log: silentLogger(),
            fetchJsonImpl: async () => ({
                body: { data: [{ title: 'X', artist: { name: 'Someone Else' }, duration: 120, album: { cover_big: 'https://img/x.jpg' } }] },
            }),
            fetchBytesImpl: bytes,
        });
        assert.equal(await resolver.get(track), null);
    } finally {
        temp.cleanup();
    }
});
