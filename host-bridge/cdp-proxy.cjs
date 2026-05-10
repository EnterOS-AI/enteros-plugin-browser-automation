#!/usr/bin/env node
/**
 * CDP proxy — bridges a Docker container to the user's Chrome running on the host.
 *
 * Why: Chrome on macOS rejects DevTools Protocol connections whose Host header
 * is anything other than `localhost`. A container hitting `host.docker.internal:9222`
 * fails the check. This proxy listens on BIND_ADDR:PROXY_PORT, rewrites the Host
 * header, and forwards both HTTP (tab listing, screenshots) and WebSocket upgrades.
 *
 * SECURITY (#293):
 *   CDP offers full control of Chrome: execute arbitrary JS in any tab, read
 *   cookies/localStorage/session tokens, screenshot, navigate — effectively
 *   account takeover for any site the user is logged into. The proxy must not
 *   be reachable without authentication.
 *
 *   We bind to 0.0.0.0 by default because Docker Desktop on macOS routes
 *   `host.docker.internal` through the VM network, not loopback — binding to
 *   127.0.0.1 would break the primary use case. Instead of restricting the
 *   binding, we require a bearer token on every request.
 *
 *   The token is read from CDP_PROXY_TOKEN (env var) OR ~/.molecule-cdp-proxy-token
 *   (a chmod 600 file written by install-host-bridge.sh at install time).
 *   If neither is set, the proxy REFUSES TO START — there is no un-authed mode.
 *   EXCEPTION: --dev-mode skips the token requirement for local development only.
 *
 *   Clients (the bundled `lib/connect.js` helper) send
 *   `X-CDP-Proxy-Token: <token>` on every HTTP request and WebSocket upgrade.
 *
 * Usage:
 *   # Launch your Chrome with the debug port once (once per reboot):
 *   open -na "Google Chrome" --args \
 *     --user-data-dir="$HOME/.chrome-molecule" \
 *     --profile-directory=Default \
 *     --remote-debugging-port=9222
 *
 *   # Then start the proxy (normally via install-host-bridge.sh into launchd/systemd):
 *   CDP_PROXY_TOKEN=$(cat ~/.molecule-cdp-proxy-token) node cdp-proxy.cjs
 *
 *   # Development only (INSECURE on shared networks — do NOT use in production):
 *   node cdp-proxy.cjs --dev-mode
 *
 * Env overrides:
 *   CHROME_PORT      (default 9222)
 *   PROXY_PORT       (default 9223)
 *   BIND_ADDR        (default 0.0.0.0 — safe because token auth is required)
 *   CDP_PROXY_TOKEN  (required — falls back to ~/.molecule-cdp-proxy-token)
 *
 * CLI flags:
 *   --dev-mode   Skip token requirement for local development. Logs a prominent
 *                security warning. DO NOT use on a shared network or production host.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const os = require('os');

const CHROME_PORT = parseInt(process.env.CHROME_PORT || '9222', 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '9223', 10);
const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';
const TOKEN_FILE = path.join(os.homedir(), '.molecule-cdp-proxy-token');

// CLI flags — --dev-mode skips token requirement for local development only.
const DEV_MODE = process.argv.includes('--dev-mode');
if (DEV_MODE) {
  console.warn('============================================');
  console.warn(' WARNING: cdp-proxy running in --dev-mode   ');
  console.warn(' Token authentication is DISABLED.           ');
  console.warn(' Do NOT use on a shared network or production ');
  console.warn(' host — anyone with network access can control');
  console.warn(' your Chrome session.                         ');
  console.warn('============================================');
}

// Resolve the auth token. Priority: env var > token file. Fail loudly if
// neither is present — there is NO unauth mode (#293) unless --dev-mode is set.
function loadToken() {
  if (process.env.CDP_PROXY_TOKEN && process.env.CDP_PROXY_TOKEN.length >= 16) {
    return process.env.CDP_PROXY_TOKEN;
  }
  try {
    const tok = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (tok.length >= 16) return tok;
    throw new Error(`token file ${TOKEN_FILE} is too short (<16 chars)`);
  } catch (e) {
    if (DEV_MODE) {
      // --dev-mode: allow startup without a token for local development convenience
      return null;
    }
    console.error('FATAL: CDP proxy auth token not found.');
    console.error('Set CDP_PROXY_TOKEN env var (>=16 chars) OR write a token to');
    console.error(`  ${TOKEN_FILE} (chmod 600)`);
    console.error('See plugins/browser-automation/host-bridge/install-host-bridge.sh');
    console.error('for the canonical installer that generates + provisions the token.');
    console.error('Or for local development only:');
    console.error('  node cdp-proxy.cjs --dev-mode');
    console.error('Original error:', e.message);
    process.exit(1);
  }
}
const PROXY_TOKEN = loadToken();

// Constant-time compare to resist timing attacks. Node's crypto.timingSafeEqual
// requires equal-length Buffers, so short-circuit mismatched lengths upfront.
const crypto = require('crypto');
function tokenMatches(header) {
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(PROXY_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const proxy = http.createServer((req, res) => {
  if (PROXY_TOKEN !== null && !tokenMatches(req.headers['x-cdp-proxy-token'])) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('unauthorized: missing or invalid X-CDP-Proxy-Token');
    return;
  }
  const options = {
    hostname: '127.0.0.1',
    port: CHROME_PORT,
    path: req.url,
    method: req.method,
    // Strip the auth token before forwarding — Chrome CDP doesn't need it
    // and leaking it into any upstream logs would weaken the defense.
    headers: stripAuthHeader({ ...req.headers, host: `localhost:${CHROME_PORT}` }),
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  req.pipe(proxyReq);
  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end(`proxy error: ${e.code || e.message}`);
  });
});

proxy.on('upgrade', (req, socket, head) => {
  // WebSocket upgrade requests go through the same auth check. If the client
  // didn't send the token header on the HTTP upgrade request, reject before
  // we touch the backing Chrome connection at all (unless --dev-mode is active).
  if (PROXY_TOKEN !== null && !tokenMatches(req.headers['x-cdp-proxy-token'])) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const conn = net.connect(CHROME_PORT, '127.0.0.1', () => {
    const sanitized = stripAuthHeader(req.headers);
    const upgradeReq =
      `${req.method} ${req.url} HTTP/1.1\r\n` +
      `Host: localhost:${CHROME_PORT}\r\n` +
      Object.entries(sanitized)
        .filter(([k]) => k.toLowerCase() !== 'host')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n') +
      '\r\n\r\n';
    conn.write(upgradeReq);
    if (head.length) conn.write(head);
    socket.pipe(conn);
    conn.pipe(socket);
  });
  conn.on('error', () => socket.destroy());
  socket.on('error', () => conn.destroy());
});

// stripAuthHeader removes the X-CDP-Proxy-Token before forwarding — defense
// in depth so the token can't leak into Chrome's request log or any future
// pass-through sink.
function stripAuthHeader(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === 'x-cdp-proxy-token') delete out[k];
  }
  return out;
}

proxy.listen(PROXY_PORT, BIND_ADDR, () => {
  console.log(`cdp-proxy listening on ${BIND_ADDR}:${PROXY_PORT} → 127.0.0.1:${CHROME_PORT}`);
  if (PROXY_TOKEN !== null) {
    console.log(`auth required: send X-CDP-Proxy-Token header on every request`);
  } else {
    console.log(`WARNING: auth DISABLED (--dev-mode) — not for production use`);
  }
});

process.on('SIGTERM', () => proxy.close(() => process.exit(0)));
process.on('SIGINT', () => proxy.close(() => process.exit(0)));
