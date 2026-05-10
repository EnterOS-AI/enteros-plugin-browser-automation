# Browser Automation Rules

- Chrome CDP is available at `host.docker.internal:9223` (proxy to host Chrome on port 9222)
- Always use `browserWSEndpoint` with URL rewrite (`localhost:9222` → `host.docker.internal:9223`)
- Never use `browserURL` — it resolves to an unreachable localhost address
- **Always use `defaultViewport: null`** — omitting it silently corrupts all coordinates (see KI-001)
- **Never call `browser.close()`** — use `browser.disconnect()` to release the CDP connection without killing the shared Chrome process (see KI-004)
- The Chrome profile is shared (`~/.chrome-molecule/Default`) — all agents see the same logged-in sessions; use `--user-data-dir` per agent for isolation (see KI-002)
- CDP proxy requires `X-CDP-Proxy-Token` header on every request; for local development use `node cdp-proxy.cjs --dev-mode` (logs security warning)
- Set `NODE_PATH=/usr/lib/node_modules` if `require('puppeteer-core')` fails
