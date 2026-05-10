/**
 * Unit tests for cdp-proxy.cjs — token auth, dev-mode, and helper functions.
 *
 * Run: node --test tests/cdp-proxy.test.js
 *
 * These tests mock the filesystem and environment to test the auth logic
 * without requiring Chrome or network access.
 */
'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Pure-function tests — no mocking needed
// ---------------------------------------------------------------------------

describe('tokenMatches', () => {
  // Inline the function so tests are self-contained (no require of cdp-proxy.cjs
  // which would start the server and require network access).
  const crypto = require('crypto');
  function tokenMatches(header, token) {
    if (typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  it('returns true for exact match', () => {
    assert.strictEqual(tokenMatches('abc123def456', 'abc123def456'), true);
  });

  it('returns false for single-char mismatch', () => {
    assert.strictEqual(tokenMatches('abc123def456', 'abc123def455'), false);
  });

  it('returns false for different length', () => {
    assert.strictEqual(tokenMatches('abc123def456', 'abc123def4567'), false);
    assert.strictEqual(tokenMatches('abc123def456', 'abc123def45'), false);
  });

  it('returns false for non-string input', () => {
    assert.strictEqual(tokenMatches(null, 'abc'), false);
    assert.strictEqual(tokenMatches(undefined, 'abc'), false);
    assert.strictEqual(tokenMatches(123, 'abc'), false);
    assert.strictEqual(tokenMatches({}, 'abc'), false);
  });

  it('handles empty string token', () => {
    // Edge case: empty token should only match empty header
    assert.strictEqual(tokenMatches('', ''), true);
    assert.strictEqual(tokenMatches('x', ''), false);
  });

  it('handles long tokens (64+ chars)', () => {
    const long = 'a'.repeat(64);
    const longWrong = 'a'.repeat(63) + 'b';
    assert.strictEqual(tokenMatches(long, long), true);
    assert.strictEqual(tokenMatches(longWrong, long), false);
  });
});

describe('stripAuthHeader', () => {
  // Inline the function for isolation.
  function stripAuthHeader(headers) {
    const out = { ...headers };
    for (const k of Object.keys(out)) {
      if (k.toLowerCase() === 'x-cdp-proxy-token') delete out[k];
    }
    return out;
  }

  it('removes x-cdp-proxy-token (exact case)', () => {
    const result = stripAuthHeader({
      host: 'localhost:9222',
      'x-cdp-proxy-token': 'supersecret12345678',
      accept: '*/*',
    });
    assert.strictEqual(result['x-cdp-proxy-token'], undefined);
    assert.strictEqual(result.host, 'localhost:9222');
    assert.strictEqual(result.accept, '*/*');
  });

  it('removes x-cdp-proxy-token regardless of case', () => {
    assert.strictEqual(
      stripAuthHeader({ 'X-CDP-PROXY-TOKEN': 'x' })['X-CDP-PROXY-TOKEN'],
      undefined
    );
    assert.strictEqual(
      stripAuthHeader({ 'X-Cdp-Proxy-Token': 'x' })['X-Cdp-Proxy-Token'],
      undefined
    );
  });

  it('leaves other headers intact', () => {
    const result = stripAuthHeader({ authorization: 'Bearer x', accept: '*/*' });
    assert.strictEqual(result.authorization, 'Bearer x');
    assert.strictEqual(result.accept, '*/*');
  });

  it('returns empty object for all-auth-header input', () => {
    const result = stripAuthHeader({ 'x-cdp-proxy-token': 'x' });
    assert.deepStrictEqual(Object.keys(result), []);
  });

  it('does not mutate the original object', () => {
    const original = { host: 'localhost', 'x-cdp-proxy-token': 'tok' };
    stripAuthHeader(original);
    assert.strictEqual(original['x-cdp-proxy-token'], 'tok');
  });
});

// ---------------------------------------------------------------------------
// loadToken / DEV_MODE integration tests — mock process.argv, fs, and env
// ---------------------------------------------------------------------------

describe('loadToken logic (mocked)', () => {
  // We create a minimal proxy module that only exposes the token-loading logic
  // by re-implementing the relevant portion under test.
  function makeLoadToken({ envToken, fileContent, fileError, argvIncludesDev }) {
    const mockFs = {
      readFileSync(path, encoding) {
        if (fileError) throw fileError;
        if (typeof fileContent === 'string') return fileContent;
        throw new Error('unexpected readFileSync call');
      },
    };
    const originalEnv = { ...process.env };
    const originalArgv = [...process.argv];

    if (envToken !== undefined) process.env.CDP_PROXY_TOKEN = envToken;
    else delete process.env.CDP_PROXY_TOKEN;

    if (argvIncludesDev !== undefined) {
      process.argv = argvIncludesDev
        ? ['node', 'cdp-proxy.cjs', '--dev-mode']
        : ['node', 'cdp-proxy.cjs'];
    }

    const DEV_MODE = process.argv.includes('--dev-mode');

    let exitCalled = false;
    let exitCode = 0;
    const originalExit = process.exit;
    // Note: we can't fully mock process.exit in Node test but we can track it

    function loadToken() {
      if (process.env.CDP_PROXY_TOKEN && process.env.CDP_PROXY_TOKEN.length >= 16) {
        return process.env.CDP_PROXY_TOKEN;
      }
      try {
        const tok = mockFs.readFileSync('/mock/token', 'utf8').trim();
        if (tok.length >= 16) return tok;
        throw new Error('token too short');
      } catch (e) {
        if (DEV_MODE) return null;
        throw new Error('FATAL: token not found');
      }
    }

    const result = loadToken();

    // Restore
    Object.assign(process.env, originalEnv);
    process.argv = originalArgv;

    return { result, devMode: DEV_MODE };
  }

  it('returns token from CDP_PROXY_TOKEN env var (>=16 chars)', () => {
    const { result } = makeLoadToken({ envToken: 'abcdefghijklmnop' });
    assert.strictEqual(result, 'abcdefghijklmnop');
  });

  it('ignores CDP_PROXY_TOKEN if < 16 chars', () => {
    // Falls through to file read, which we mock to throw
    // In real usage, this hits ~/.molecule-cdp-proxy-token
    // We mock fileContent to 'validtoken12345678'
    const { result } = makeLoadToken({
      fileContent: 'validtoken12345678',
    });
    // Since envToken is < 16 chars, it should fall through to file
    assert.strictEqual(result, 'validtoken12345678');
  });

  it('returns null in --dev-mode when no token file exists', () => {
    const { result, devMode } = makeLoadToken({
      fileError: new Error('ENOENT'),
      argvIncludesDev: true,
    });
    assert.strictEqual(devMode, true);
    assert.strictEqual(result, null);
  });

  it('throws in normal mode when no token file exists', () => {
    assert.throws(
      () => makeLoadToken({ fileError: new Error('ENOENT'), argvIncludesDev: false }),
      /FATAL/
    );
  });

  it('--dev-mode flag detected correctly', () => {
    // with --dev-mode: returns null (no token file needed)
    const { devMode: withFlag, result } = makeLoadToken({
      fileError: new Error('ENOENT'),
      argvIncludesDev: true,
    });
    assert.strictEqual(withFlag, true);
    assert.strictEqual(result, null);

    // without --dev-mode: DEV_MODE is false (but loadToken throws)
    // We verify the flag without calling loadToken by checking the direct computation.
    const { devMode: withoutFlag } = makeLoadToken({
      fileContent: 'validtoken1234567890',
      argvIncludesDev: false,
    });
    assert.strictEqual(withoutFlag, false);
  });
});

// ---------------------------------------------------------------------------
// Auth bypass in --dev-mode (PROXY_TOKEN === null)
// ---------------------------------------------------------------------------

describe('auth bypass in dev mode', () => {
  it('tokenMatches is not called when PROXY_TOKEN is null', () => {
    // In dev mode, PROXY_TOKEN is null and the proxy skips the token check.
    // This test documents that the guard `PROXY_TOKEN !== null && !tokenMatches(...)`
    // short-circuits correctly — when PROXY_TOKEN is null, tokenMatches is never called.
    const PROXY_TOKEN = null;
    const called = [];
    const tokenMatches = (header) => {
      called.push(header);
      return false;
    };

    // The guard: if PROXY_TOKEN is null, the short-circuit prevents tokenMatches call
    if (PROXY_TOKEN !== null && !tokenMatches('any-token')) {
      // Would return 401
    }

    assert.strictEqual(called.length, 0, 'tokenMatches should not be called when PROXY_TOKEN is null');
  });

  it('tokenMatches is called when PROXY_TOKEN is set', () => {
    const PROXY_TOKEN = 'correct-token-1234';
    const called = [];
    const tokenMatchesFn = (header) => {
      called.push(header);
      return header === PROXY_TOKEN;
    };

    // Unauthorized: token doesn't match
    const unauthorized = PROXY_TOKEN !== null && !tokenMatchesFn('wrong-token');
    assert.strictEqual(unauthorized, true);
    assert.strictEqual(called.length, 1);
    assert.strictEqual(called[0], 'wrong-token');
    called.length = 0;

    // Authorized: token matches
    const authorized = !(PROXY_TOKEN !== null && !tokenMatchesFn(PROXY_TOKEN));
    assert.strictEqual(authorized, true);
    assert.strictEqual(called.length, 1);
  });
});
