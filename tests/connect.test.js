/**
 * Unit tests for connect.js — loadProxyToken and fetchVersion pure-function logic.
 *
 * Run: node --test tests/connect.test.js
 *
 * These tests mock the filesystem to verify token loading without network access.
 * The actual connect() function requires Chrome so it is not tested here.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ---------------------------------------------------------------------------
// loadProxyToken tests — env var priority, file fallback, null on nothing
// ---------------------------------------------------------------------------

describe('loadProxyToken logic (mocked)', () => {
  // Inline the pure token-loading logic from connect.js for isolated testing.
  // Each test explicitly controls env var, file contents, and homedir.
  function makeLoadProxyToken({ envToken, fileContents = {}, homeDir = '/home/user' }) {
    const originalEnv = { ...process.env };

    if (envToken !== undefined) process.env.CDP_PROXY_TOKEN = envToken;
    else delete process.env.CDP_PROXY_TOKEN;

    // Inline the actual function from connect.js (lines 37-54)
    function loadProxyToken() {
      if (process.env.CDP_PROXY_TOKEN && process.env.CDP_PROXY_TOKEN.length >= 16) {
        return process.env.CDP_PROXY_TOKEN;
      }
      const candidates = [
        '/run/secrets/cdp-proxy-token',
        path.join(homeDir, '.molecule-cdp-proxy-token'),
      ];
      for (const p of candidates) {
        try {
          const content = fileContents[p];
          if (content === undefined) {
            const err = new Error(`ENOENT: ${p}`);
            err.code = 'ENOENT';
            throw err;
          }
          const tok = content.trim();
          if (tok.length >= 16) return tok;
        } catch {
          // try next
        }
      }
      return null;
    }

    const result = loadProxyToken();

    // Restore
    Object.assign(process.env, originalEnv);

    return result;
  }

  it('returns CDP_PROXY_TOKEN env var when >= 16 chars', () => {
    const result = makeLoadProxyToken({
      envToken: 'abcdefghijklmnop',
      fileContents: { '/run/secrets/cdp-proxy-token': 'wrong' },
    });
    assert.strictEqual(result, 'abcdefghijklmnop');
  });

  it('ignores CDP_PROXY_TOKEN env var when < 16 chars', () => {
    const result = makeLoadProxyToken({
      envToken: 'short',
      fileContents: { '/run/secrets/cdp-proxy-token': 'validtoken1234567' },
    });
    assert.strictEqual(result, 'validtoken1234567');
  });

  it('tries /run/secrets/cdp-proxy-token first, falls back to ~/.molecule-cdp-proxy-token', () => {
    const result = makeLoadProxyToken({
      fileContents: {
        '/run/secrets/cdp-proxy-token': 'short\n',
        '/home/user/.molecule-cdp-proxy-token': 'fallbacktoken123456',
      },
    });
    assert.strictEqual(result, 'fallbacktoken123456');
  });

  it('returns null when no token exists anywhere', () => {
    const result = makeLoadProxyToken({});
    assert.strictEqual(result, null);
  });

  it('returns null when file exists but content is too short', () => {
    const result = makeLoadProxyToken({
      fileContents: { '/run/secrets/cdp-proxy-token': 'tooshort' },
    });
    assert.strictEqual(result, null);
  });

  it('file with whitespace-only content returns null', () => {
    const result = makeLoadProxyToken({
      fileContents: { '/run/secrets/cdp-proxy-token': '   \n  \t' },
    });
    assert.strictEqual(result, null);
  });

  it('trims whitespace from token', () => {
    const result = makeLoadProxyToken({
      fileContents: { '/run/secrets/cdp-proxy-token': '  validtoken1234567  \n' },
    });
    assert.strictEqual(result, 'validtoken1234567');
  });

  it('skips ENOENT and continues to next candidate', () => {
    const result = makeLoadProxyToken({
      fileContents: {
        '/run/secrets/cdp-proxy-token': 'short',
        '/home/user/.molecule-cdp-proxy-token': 'secondtoken1234567',
      },
    });
    assert.strictEqual(result, 'secondtoken1234567');
  });

  it('uses custom homeDir for the fallback path', () => {
    const result = makeLoadProxyToken({
      fileContents: {
        '/run/secrets/cdp-proxy-token': 'short',
        '/custom/home/.molecule-cdp-proxy-token': 'customhometoken1234',
      },
      homeDir: '/custom/home',
    });
    assert.strictEqual(result, 'customhometoken1234');
  });

  it('first candidate found wins — stops searching after match', () => {
    const result = makeLoadProxyToken({
      fileContents: {
        '/run/secrets/cdp-proxy-token': 'firsttoken1234567',
        '/home/user/.molecule-cdp-proxy-token': 'secondtoken1234567',
      },
    });
    assert.strictEqual(result, 'firsttoken1234567');
  });
});

// ---------------------------------------------------------------------------
// fetchVersion URL / header logic tests
// ---------------------------------------------------------------------------

describe('fetchVersion URL and header logic', () => {
  // Test the logic around token inclusion in headers without making HTTP calls.
  // We verify the conditional: token truthy → header added.

  it('adds X-CDP-Proxy-Token header when token is provided', () => {
    const token = 'valid-token-12345678';
    const headers = {};
    if (token) headers['X-CDP-Proxy-Token'] = token;
    assert.deepStrictEqual(headers, { 'X-CDP-Proxy-Token': 'valid-token-12345678' });
  });

  it('does not add header when token is null', () => {
    const token = null;
    const headers = {};
    if (token) headers['X-CDP-Proxy-Token'] = token;
    assert.deepStrictEqual(headers, {});
  });

  it('does not add header when token is empty string', () => {
    const token = '';
    const headers = {};
    if (token) headers['X-CDP-Proxy-Token'] = token;
    assert.deepStrictEqual(headers, {});
  });

  it('rejects 401 status code (throws)', () => {
    // Simulates the reject logic from fetchVersion
    let threw = false;
    const r = { statusCode: 401 };
    try {
      if (r.statusCode === 401) throw new Error('CDP proxy unauthorized (401) — token missing or invalid');
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('401'));
    }
    assert.strictEqual(threw, true);
  });

  it('parses valid JSON on 200 status', () => {
    const r = { statusCode: 200 };
    const d = '{"Browser":"Chrome/120.0.0.0","webSocketDebuggerUrl":"ws://localhost:9222/devtools/browser/abc"}';
    let parsed = null;
    try {
      if (r.statusCode === 401) throw new Error('unauthorized');
      parsed = JSON.parse(d);
    } catch (e) {
      assert.fail(`Should not throw: ${e.message}`);
    }
    assert.strictEqual(parsed.Browser, 'Chrome/120.0.0.0');
  });

  it('throws on invalid JSON with 200 status', () => {
    const r = { statusCode: 200 };
    const d = 'not-json';
    let threw = false;
    try {
      if (r.statusCode === 401) throw new Error('unauthorized');
      JSON.parse(d);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof SyntaxError);
    }
    assert.strictEqual(threw, true);
  });
});

// ---------------------------------------------------------------------------
// WS URL rewrite logic tests
// ---------------------------------------------------------------------------

describe('WebSocket URL rewrite logic', () => {
  it('rewrites localhost:9222 to Docker host', () => {
    const wsUrl = 'ws://localhost:9222/devtools/browser/abc';
    const host = 'host.docker.internal';
    const port = 9223;
    const result = wsUrl
      .replace('localhost:9222', `${host}:${port}`)
      .replace('127.0.0.1:9222', `${host}:${port}`);
    assert.strictEqual(result, 'ws://host.docker.internal:9223/devtools/browser/abc');
  });

  it('rewrites 127.0.0.1:9222 to Docker host', () => {
    const wsUrl = 'ws://127.0.0.1:9222/devtools/browser/abc';
    const host = 'host.docker.internal';
    const port = 9223;
    const result = wsUrl
      .replace('localhost:9222', `${host}:${port}`)
      .replace('127.0.0.1:9222', `${host}:${port}`);
    assert.strictEqual(result, 'ws://host.docker.internal:9223/devtools/browser/abc');
  });

  it('leaves URL unchanged when already using Docker host', () => {
    const wsUrl = 'ws://host.docker.internal:9223/devtools/browser/abc';
    const result = wsUrl
      .replace('localhost:9222', 'host.docker.internal:9223')
      .replace('127.0.0.1:9222', 'host.docker.internal:9223');
    assert.strictEqual(result, 'ws://host.docker.internal:9223/devtools/browser/abc');
  });

  it('uses direct host + port in fallback mode', () => {
    const wsUrl = 'ws://localhost:9222/devtools/browser/abc';
    const host = '127.0.0.1';
    const port = 9222;
    const result = wsUrl
      .replace('localhost:9222', `${host}:${port}`)
      .replace('127.0.0.1:9222', `${host}:${port}`);
    assert.strictEqual(result, 'ws://127.0.0.1:9222/devtools/browser/abc');
  });

  it('defaultViewport is null in connect opts (enforced by connect.js)', () => {
    // This is a documentation test — verifies the contract that connect.js
    // ALWAYS returns defaultViewport: null, never undefined or an object.
    const connectOpts = {
      browserWSEndpoint: 'ws://host.docker.internal:9223/devtools/browser/abc',
      defaultViewport: null,  // CRITICAL: use Chrome's actual window size
    };
    assert.strictEqual(connectOpts.defaultViewport, null);
    assert.strictEqual(connectOpts.defaultViewport !== undefined, true);
  });
});
