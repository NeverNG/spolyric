// test/proxy.test.ts
// Finding the proxy: the explicit setting wins, then the environment, then the Windows system setting.

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProxy, registryProxyOf } from '../src/proxy.js';

test('SPOLYRIC_PROXY wins and can turn the proxy off', () => {
    assert.deepEqual(
        detectProxy({ platform: 'linux', env: { SPOLYRIC_PROXY: '127.0.0.1:7897', HTTPS_PROXY: 'http://other:1' } }),
        { url: 'http://127.0.0.1:7897', source: 'SPOLYRIC_PROXY' },
    );
    assert.equal(detectProxy({ platform: 'win32', env: { SPOLYRIC_PROXY: 'none' }, windowsProxy: () => 'http://127.0.0.1:7897' }), null);
    assert.equal(detectProxy({ platform: 'win32', env: { SPOLYRIC_PROXY: 'off' }, windowsProxy: () => 'http://127.0.0.1:7897' }), null);
});

test('the usual proxy variables are used when nothing is set explicitly', () => {
    assert.equal(detectProxy({ platform: 'linux', env: { HTTPS_PROXY: 'http://127.0.0.1:7897' } })?.url, 'http://127.0.0.1:7897');
    assert.equal(detectProxy({ platform: 'linux', env: { https_proxy: 'socks5://127.0.0.1:1080' } })?.source, 'environment');
    assert.equal(detectProxy({ platform: 'linux', env: { ALL_PROXY: '127.0.0.1:1080' } })?.url, 'http://127.0.0.1:1080');
});

test('on Windows the system proxy is read, including the per-protocol form', () => {
    assert.deepEqual(
        detectProxy({ platform: 'win32', env: {}, windowsProxy: () => 'http://127.0.0.1:7897' }),
        { url: 'http://127.0.0.1:7897', source: 'Windows 系统代理' },
    );
    // The registry can hold "http=...;https=..." — the https entry is the one to use.
    assert.equal(registryProxyOf('http=127.0.0.1:1;https=127.0.0.1:2'), '127.0.0.1:2');
    assert.equal(registryProxyOf('http=127.0.0.1:1'), '127.0.0.1:1');
    assert.equal(registryProxyOf('127.0.0.1:7897'), '127.0.0.1:7897');
});

test('nothing is assumed on other systems', () => {
    assert.equal(detectProxy({ platform: 'linux', env: {} }), null);
    assert.equal(detectProxy({ platform: 'darwin', env: {} }), null);
});

test('a proxy without a scheme is given http://', () => {
    assert.equal(detectProxy({ platform: 'linux', env: { HTTPS_PROXY: '10.0.0.1:3128' } })?.url, 'http://10.0.0.1:3128');
});
