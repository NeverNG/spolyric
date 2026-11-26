// test/config.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DEFAULT_CONFIG, applyEnvironment, loadConfig, normalizeConfig, saveConfig } from '../src/config.js';
import { configFile } from '../src/paths.js';
import { makeTempDir } from './helpers/temp.js';

test('a file still holding the old timing defaults is migrated', () => {
    const temp = makeTempDir();
    try {
        fs.mkdirSync(temp.dir, { recursive: true });
        fs.writeFileSync(configFile(temp.dir), JSON.stringify({ pollIntervalMs: 1500, clockIntervalMs: 4000, driftThresholdMs: 900 }));
        const loaded = loadConfig({ dataDir: temp.dir, env: {} });
        assert.equal(loaded.config.pollIntervalMs, 500);
        assert.equal(loaded.config.clockIntervalMs, 60_000);
        assert.equal(loaded.config.driftThresholdMs, 5000);
    } finally {
        temp.cleanup();
    }
});

test('a missing file is the defaults', () => {
    const temp = makeTempDir();
    try {
        const loaded = loadConfig({ dataDir: temp.dir, env: {} });
        assert.deepEqual(loaded.config, applyEnvironment(DEFAULT_CONFIG, {}));
        assert.equal(loaded.filePath, configFile(temp.dir));
    } finally {
        temp.cleanup();
    }
});

test('bad values fall back and out-of-range numbers are clamped', () => {
    const config = normalizeConfig({
        clientId: '  abc  ',
        redirectPort: 1,
        pollIntervalMs: 99_999_999,
        clockIntervalMs: 'nope',
        emptyGraceMs: -5,
        lyrics: { spotify: false, lrclib: 'yes' },
    });
    assert.equal(config.clientId, 'abc');
    assert.equal(config.redirectPort, 1024);
    assert.equal(config.pollIntervalMs, 30_000);
    assert.equal(config.clockIntervalMs, DEFAULT_CONFIG.clockIntervalMs);
    assert.equal(config.emptyGraceMs, 0);
    assert.equal(config.lyrics.spotify, false);
    assert.equal(config.lyrics.lrclib, true);
});

test('the environment overrides the file without rewriting it', () => {
    const config = applyEnvironment(DEFAULT_CONFIG, {
        SPOLYRIC_CLIENT_ID: 'client',
        SPOLYRIC_POLL_MS: '700',
        SPOLYRIC_LYRIC_SOURCES: 'lrclib',
        SPOLYRIC_STAGE_URL: 'http://127.0.0.1:32107/',
        SPOLYRIC_VERBOSE: '1',
    });
    assert.equal(config.clientId, 'client');
    assert.equal(config.pollIntervalMs, 700);
    assert.deepEqual(config.lyrics, { spotify: false, netease: false, qq: false, kugou: false, lrclib: true });
    assert.equal(config.stageBaseUrl, 'http://127.0.0.1:32107');
    assert.equal(config.verbose, true);
});

test('the source mode is one of auto, web, local, and nothing else', () => {
    assert.equal(normalizeConfig({ source: 'LOCAL' }).source, 'local');
    assert.equal(normalizeConfig({ source: ' web ' }).source, 'web');
    assert.equal(normalizeConfig({ source: 'nonsense' }).source, 'auto');
    assert.equal(normalizeConfig({}).source, 'auto');
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_SOURCE: 'Local' }).source, 'local');
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_SOURCE: 'bogus' }).source, 'auto');
});

test('stage control can be turned off, and is on by default', () => {
    assert.equal(normalizeConfig({}).control, true);
    assert.equal(normalizeConfig({ control: false }).control, false);
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_CONTROL: 'off' }).control, false);
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_CONTROL: 'none' }).control, false);
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_CONTROL: 'on' }).control, true);
});

test('the preferred lyric source defaults to QQ, like Folia', () => {
    assert.equal(normalizeConfig({}).preferredLyricSource, 'qq');
    assert.equal(normalizeConfig({ preferredLyricSource: 'kugou' }).preferredLyricSource, 'kugou');
    assert.equal(normalizeConfig({ preferredLyricSource: 'bogus' }).preferredLyricSource, 'qq');
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_PREFER: 'netease' }).preferredLyricSource, 'netease');
});

test('the lyric offset is a signed number of milliseconds', () => {
    assert.equal(normalizeConfig({}).lyricsOffsetMs, 0);
    assert.equal(normalizeConfig({ lyricsOffsetMs: 250 }).lyricsOffsetMs, 250);
    assert.equal(normalizeConfig({ lyricsOffsetMs: -250 }).lyricsOffsetMs, -250);
    assert.equal(normalizeConfig({ lyricsOffsetMs: 'nonsense' }).lyricsOffsetMs, 0);
    assert.equal(applyEnvironment(DEFAULT_CONFIG, { SPOLYRIC_OFFSET_MS: '-300' }).lyricsOffsetMs, -300);
});

test('saving keeps the keys it was not given', () => {
    const temp = makeTempDir();
    try {
        saveConfig(temp.dir, { clientId: 'abc', redirectPort: 9999 });
        const saved = saveConfig(temp.dir, { pollIntervalMs: 2000 });
        assert.equal(saved.clientId, 'abc');
        assert.equal(saved.redirectPort, 9999);
        assert.equal(saved.pollIntervalMs, 2000);
        const onDisk = JSON.parse(fs.readFileSync(configFile(temp.dir), 'utf-8'));
        assert.equal(onDisk.pollIntervalMs, 2000);
    } finally {
        temp.cleanup();
    }
});

test('a broken config file does not stop the command', () => {
    const temp = makeTempDir();
    try {
        fs.writeFileSync(configFile(temp.dir), '{ nope');
        const loaded = loadConfig({ dataDir: temp.dir, env: {} });
        assert.equal(loaded.config.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs);
    } finally {
        temp.cleanup();
    }
});
