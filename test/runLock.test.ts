// test/runLock.test.ts
// One Spolyric per data directory: the Folia mod and a hand-started run must not both drive the stage.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { acquireRunLock } from '../src/sync/runLock.js';
import { makeTempDir } from './helpers/temp.js';

test('a second run in the same data directory is refused', () => {
    const temp = makeTempDir();
    try {
        const first = acquireRunLock(temp.dir);
        assert.ok(first);
        // A lock held by another live process is the case a second `spolyric run` meets.
        fs.writeFileSync(path.join(temp.dir, 'run.lock'), JSON.stringify({ pid: process.ppid, startedAt: Date.now() }));
        assert.equal(acquireRunLock(temp.dir), null, 'a live owner blocks a second run');
        fs.rmSync(path.join(temp.dir, 'run.lock'), { force: true });
        const again = acquireRunLock(temp.dir);
        assert.ok(again, 'released means free again');
        again.release();
    } finally {
        temp.cleanup();
    }
});

test('a lock left by a process that is gone is replaced', () => {
    const temp = makeTempDir();
    try {
        fs.mkdirSync(temp.dir, { recursive: true });
        fs.writeFileSync(path.join(temp.dir, 'run.lock'), JSON.stringify({ pid: 999_999, startedAt: 1 }));
        const lock = acquireRunLock(temp.dir);
        assert.ok(lock, 'a stale lock does not block');
        lock.release();
    } finally {
        temp.cleanup();
    }
});

test('a live PID reused by another process does not block a new run', () => {
    const temp = makeTempDir();
    try {
        // Windows reuses PIDs: this lock points at a process that exists (the test runner), but the
        // heartbeat is long gone, so the old owner is really dead.
        const filePath = path.join(temp.dir, 'run.lock');
        fs.writeFileSync(filePath, JSON.stringify({ pid: process.ppid, startedAt: 1 }));
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(filePath, old, old);
        const lock = acquireRunLock(temp.dir);
        assert.ok(lock, 'an old heartbeat is stale even when the PID is alive');
        lock.release();
    } finally {
        temp.cleanup();
    }
});

test('a release never removes a lock that belongs to another process', () => {
    const temp = makeTempDir();
    try {
        const first = acquireRunLock(temp.dir);
        assert.ok(first);
        // Pretend someone else took over the file.
        fs.writeFileSync(path.join(temp.dir, 'run.lock'), JSON.stringify({ pid: process.pid + 1, startedAt: Date.now() }));
        first.release();
        const current = JSON.parse(fs.readFileSync(path.join(temp.dir, 'run.lock'), 'utf8'));
        assert.equal(current.pid, process.pid + 1, 'the other owner\'s lock is left alone');
        fs.rmSync(path.join(temp.dir, 'run.lock'), { force: true });
    } finally {
        temp.cleanup();
    }
});
