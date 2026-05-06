# Known Issues — browser-automation

## KI-001: defaultViewport null required — coords silently wrong without it

**Severity:** High (silent data corruption)

**Symptom:** Agent reports "session expired", "button not found", or "text typed in wrong place." The page visually renders correctly, but `window.innerWidth/innerHeight`, `getBoundingClientRect()`, and all click coordinates are based on puppeteer's 800×600 override, not the real viewport.

**Root cause:** When `defaultViewport` is unset or set to puppeteer's default `{ width: 800, height: 600 }`, Chrome is told to report those dimensions via the CDP `Emulation.setDeviceMetricsOverride` call. The browser's actual rendered size is unchanged, but JS in the page context gets wrong dimensions.

**Resolution:** Always use the bundled `lib/connect.js` helper, which sets `defaultViewport: null`. If you must use `puppeteer.connect()` directly, always pass `defaultViewport: null`.

**History:** Root cause of ~3h debug session on 2026-04-15 during social-media-poster runs.

---

## KI-002: Shared Chrome profile — no session isolation between agents

**Severity:** Medium (security/isolation)

**Symptom:** Agent A sees agent B's logged-in session, or agent actions overwrite each other's cookies/localStorage.

**Root cause:** The CDP proxy connects all agents to the same Chrome profile at `~/.chrome-molecule/Default`. This is intentional — it allows agents to use the user's existing logged-in sessions — but it means agents are not isolated.

**Workaround:** Use separate Chrome user data directories per agent when isolation is needed: `--user-data-dir="$HOME/.chrome-molecule-<agent-id>"`. Note: each profile requires its own login to sites.

---

## KI-003: CDP proxy FATAL exit if token is absent

**Severity:** Medium (availability)

**Symptom:** `cdp-proxy.cjs` exits immediately on startup with:
```
FATAL: CDP proxy auth token not found.
Set CDP_PROXY_TOKEN env var (>=16 chars) OR write a token to ~/.molecule-cdp-proxy-token
```

**Root cause:** The proxy has no unauthenticated mode. If neither `CDP_PROXY_TOKEN` nor `~/.molecule-cdp-proxy-token` exists, it refuses to start.

**Resolution:** Run `install-host-bridge.sh` once per host to generate the token and register the service. Alternatively, set `CDP_PROXY_TOKEN` in the service environment.

**History:** Was a deliberate security decision (#293) — there is no "disable auth" flag.

---

## KI-004: browser.close() kills the shared Chrome process

**Severity:** Medium (availability)

**Symptom:** After an agent run, subsequent agents cannot connect — Chrome is gone. `page.goto()` throws `Target closed`.

**Root cause:** `browser.close()` calls `Browser.close()` which terminates the Chrome process entirely. All other CDP sessions are killed.

**Resolution:** Always call `browser.disconnect()` instead, which releases the CDP connection without killing Chrome.

**Note:** If the agent needs to ensure Chrome stays alive for future runs, prefer `browser.disconnect()`. If Chrome truly needs to be restarted, launch a new Chrome instance with a separate `--user-data-dir`.
