# browser-automation

Browser automation and testing. Two distinct capabilities:

1. **Puppeteer-core / CDP** — control a real Chrome browser via Chrome DevTools Protocol. For automating external websites, scraping, and cross-browser testing.
2. **Playwright** — testing our own applications with reliable selectors and auto-waiting.

## Requirements

Both capabilities require the **CDP proxy** to be running on the host:

```bash
# Install and start the CDP proxy (once per host)
bash host-bridge/install-host-bridge.sh
```

The proxy requires `CDP_PROXY_TOKEN` (>=16 chars) or a token file at `~/.molecule-cdp-proxy-token`.
For local development without a token: `node host-bridge/cdp-proxy.cjs --dev-mode` (logs a security warning).

## Puppeteer (external sites)

Connect via `puppeteer.connect()` using the bundled `lib/connect.js` helper. Always pass `defaultViewport: null` to avoid coordinate corruption (see known-issue KI-001).

```javascript
const { connect } = require('./lib/connect.js');
const browser = await connect();
const page = await browser.newPage();
// ...
await browser.disconnect();  // NOT browser.close() — see KI-004
```

## Playwright (internal app testing)

For testing Molecule AI's own applications. Use Playwright's built-in selectors and auto-wait for reliable tests.

## Install

### In org template (org.yaml)

```yaml
plugins:
  - browser-automation
```

### From URL (community install)

```
github://Molecule-AI/molecule-ai-plugin-browser-automation
```

## Runtime

- `claude_code` — primary

## Skills

- `browser-automation` — Puppeteer/CDP skill
- `browser-testing` — Playwright skill

## Known issues

See [known-issues.md](known-issues.md).

- **KI-002:** The Chrome profile is shared across agents — use separate `--user-data-dir` for isolation
- **KI-003:** For local dev without a token, use `--dev-mode` (logs security warning)

## License

Business Source License 1.1 — © Molecule AI.
