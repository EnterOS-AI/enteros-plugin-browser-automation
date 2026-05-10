# Known Issues — browser-automation

## KI-001: defaultViewport null required — coords silently wrong without it

**Severity:** ~~High~~ → **RESOLVED** (v1.1.0)

**Symptom:** (Historical — no longer relevant after fix) Agent reports "session expired",
"button not found", or "text typed in wrong place." The page visually renders correctly,
but `window.innerWidth/innerHeight`, `getBoundingClientRect()`, and all click
coordinates are based on puppeteer's 800×600 override, not the real viewport.

**Root cause:** (Historical) When `defaultViewport` is unset or set to puppeteer's default
`{ width: 800, height: 600 }`, Chrome is told to report those dimensions via the CDP
`Emulation.setDeviceMetricsOverride` call. The browser's actual rendered size is unchanged,
but JS in the page context gets wrong dimensions.

**Resolution:** Always use the bundled `lib/connect.js` helper (available at
`skills/browser-automation/lib/connect.js`), which sets `defaultViewport: null`
automatically (line 110). If you must use `puppeteer.connect()` directly, always pass
`defaultViewport: null`.

**History:** Root cause of ~3h debug session on 2026-04-15 during social-media-poster runs.
Fixed in v1.1.0 — `lib/connect.js` enforces the correct setting and the SKILL.md + CLAUDE.md
document it prominently.

---

## KI-002: Shared Chrome profile — no session isolation between agents

**Severity:** Medium (security/isolation) — **KNOWN DESIGN LIMITATION**

**Symptom:** Agent A sees agent B's logged-in session, or agent actions overwrite each
other's cookies/localStorage.

**Root cause:** The CDP proxy connects all agents to the same Chrome profile at
`~/.chrome-molecule/Default`. This is intentional — it allows agents to use the user's
existing logged-in sessions — but it means agents are not isolated.

**Workaround:** Use separate Chrome user data directories per agent when isolation is
needed: `--user-data-dir="$HOME/.chrome-molecule-<agent-id>"`. Note: each profile requires
its own login to sites.

---

## KI-003: CDP proxy FATAL exit if token is absent — no local dev path

**Severity:** ~~Medium~~ → **RESOLVED** (v1.1.0)

**Symptom:** (Historical — no longer relevant after fix) `cdp-proxy.cjs` exited immediately
on startup with no local development option:
```
FATAL: CDP proxy auth token not found.
Set CDP_PROXY_TOKEN env var (>=16 chars) OR write a token to ~/.molecule-cdp-proxy-token
```

**Root cause:** (Historical) The proxy had no unauthenticated mode for local development.
The `install-host-bridge.sh` script auto-generates a token, but developers who just wanted
to test the proxy manually had no option.

**Resolution (v1.1.0):** Added `--dev-mode` flag to `cdp-proxy.cjs`:
```bash
# Development only (no token required — INSECURE on shared networks):
node cdp-proxy.cjs --dev-mode
```
Logs a prominent security warning when active. The canonical install path
(`install-host-bridge.sh`) still generates and uses a proper token — `--dev-mode` is only
for local development convenience.

**History:** Was a deliberate security decision (#293) for production. The `--dev-mode`
flag adds a safe opt-out for local dev without compromising production defaults.

---

## KI-004: browser.close() kills the shared Chrome process

**Severity:** ~~Medium~~ → **RESOLVED** (v1.1.0)

**Symptom:** (Historical — no longer relevant after fix) After an agent run, subsequent
agents could not connect — Chrome was killed. `page.goto()` threw `Target closed`.

**Root cause:** (Historical) `browser.close()` calls `Browser.close()` which terminates
the Chrome process entirely. All other CDP sessions are killed.

**Resolution:** Always call `browser.disconnect()` instead, which releases the CDP
connection without killing Chrome. The SKILL.md and CLAUDE.md now prominently document
this rule. The `lib/connect.js` comment block also includes a prominent warning.

**Note:** If the agent needs to ensure Chrome stays alive for future runs, prefer
`browser.disconnect()`. If Chrome truly needs to be restarted, launch a new Chrome
instance with a separate `--user-data-dir`.

**History:** Resolved in v1.1.0 by clarifying documentation and enforcing the correct
pattern in `lib/connect.js` comments. No code change required since `disconnect()` is
the correct API; the issue was purely a documentation/skill-definition problem.
