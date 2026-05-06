# Browser Automation Plugin — CLAUDE.md

## What This Plugin Does

Connects Claude Code agents to the user's **host Chrome browser** via a local CDP (Chrome DevTools Protocol) proxy, enabling web automation: form filling, scraping, posting, and screenshots. Uses `puppeteer-core` — no bundled Chromium.

**Stack:** puppeteer-core + CDP proxy (Node.js) + Chrome on host.

---

## Architecture

```
workspace container
  └── lib/connect.js   (bundled helper)
        └── CDP proxy (host:9223)  ← X-CDP-Proxy-Token auth
              └── Chrome on host (localhost:9222)
```

### Two Pieces Must Both Run

1. **Chrome** on the host machine, launched with `--remote-debugging-port=9222`.
2. **CDP proxy** (`cdp-proxy.cjs`) running on the host, bridging the container to Chrome. The `install-host-bridge.sh` script registers this as a launchd (macOS) or systemd (Linux) service so it survives reboots.

---

## Key Rules

### ALWAYS Use the Bundled Helper

**Never** call `puppeteer.connect()` or `puppeteer.launch()` directly.

```javascript
const { connect } = require('/configs/plugins/browser-automation/skills/browser-automation/lib/connect');
const browser = await connect();
const page = (await browser.pages())[0];
// ... do work ...
await browser.disconnect();  // NEVER browser.close()
```

### `defaultViewport: null` Is Non-Negotiable

`lib/connect.js` sets `defaultViewport: null`. Without it, puppeteer overrides `window.innerWidth/innerHeight` to 800×600 — but the browser still renders at the user's real size. Every coordinate (`getBoundingClientRect`, click offsets) becomes wrong. Symptoms: agent reports "session expired", "button not found", "text typed in wrong place."

### `browser.disconnect()`, Not `browser.close()`

`browser.close()` kills the shared Chrome process. Always use `browser.disconnect()` to release the CDP session without terminating Chrome.

### CDP Proxy Is Auth-Protected

Every CDP request (HTTP and WebSocket) requires `X-CDP-Proxy-Token: <token>` header. The token is generated at host-bridge install time and written to `~/.molecule-cdp-proxy-token`. The `lib/connect.js` helper reads it automatically when the token file is bind-mounted into the container.

### Shared Chrome Profile

All agents using the same Chrome profile (`~/.chrome-molecule/Default`) see the same logged-in sessions. Do not assume session isolation between agents on the same host.

### Available Accounts in Shared Profile

The Chrome profile includes active sessions for: YouTube, Instagram, Facebook, X/Twitter, LinkedIn, TikTok, Gmail, InvoiceSimple, Google Search Console, Manta, TrustedPros, Foursquare, Pinterest, Medium.

---

## Common Patterns

```javascript
// List open tabs
// curl -H "X-CDP-Proxy-Token: $(cat ~/.molecule-cdp-proxy-token)" http://127.0.0.1:9223/json

// Navigate and wait
await page.goto(url, { waitUntil: 'networkidle2' });

// Take screenshot
await page.screenshot({ path: '/tmp/screenshot.png' });

// Evaluate JS in page context
const title = await page.evaluate(() => document.title);
```

---

## Dev Note

If `require('puppeteer-core')` fails, set `NODE_PATH=/usr/lib/node_modules`.
