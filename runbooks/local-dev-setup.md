# Local Dev Setup — browser-automation

This runbook walks through setting up the CDP proxy and Chrome host so agents running inside Docker (or directly on the host) can automate the user's browser.

**Tested on:** macOS (Chrome + launchd), Linux/WSL (Chrome + systemd). Windows is not supported.

---

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18 (for `cdp-proxy.cjs`)
- Google Chrome installed on the host
- Docker Desktop (macOS/Linux) or Docker Engine on Linux
- `git` and the Molecule monorepo checked out locally

---

## Step 1: Clone the plugin repo

```bash
git clone git@github.com:Molecule-AI/molecule-ai-plugin-browser-automation.git
cd molecule-ai-plugin-browser-automation
```

---

## Step 2: Install the CDP proxy as a persistent host service

The CDP proxy must be running on your host machine before any agent can connect.

```bash
# From this repo's root:
bash host-bridge/install-host-bridge.sh
```

This:
1. Generates an auth token in `~/.molecule-cdp-proxy-token` (chmod 600)
2. Registers a launchd agent (macOS) or systemd user unit (Linux) under `com.molecule.browser-automation.cdp-proxy`
3. Starts the proxy immediately and on every reboot

**Logs:**
- macOS: `~/Library/Logs/com.molecule.browser-automation.cdp-proxy.log` (also `~/.molecule-cdp-proxy.log`)
- Linux: `journalctl --user -u com.molecule.browser-automation.cdp-proxy.service -f`

**Uninstall:**
```bash
bash host-bridge/install-host-bridge.sh uninstall
```

---

## Step 3: Launch Chrome with the debug port

Do this once per host reboot (the CDP proxy stays alive across runs; Chrome needs to be started once).

```bash
# macOS
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-molecule" \
  --profile-directory=Default

# Linux (standard Chrome)
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-molecule" \
  --profile-directory=Default
```

> **Note:** Use a dedicated profile directory (`~/.chrome-molecule`) to avoid interfering with your normal Chrome sessions.

To use existing logged-in sessions: close Chrome, copy your existing profile to `~/.chrome-molecule`, then restart Chrome with the debug flags above.

---

## Step 4: Verify Chrome + proxy are reachable

```bash
# Check Chrome debug port
curl http://127.0.0.1:9222/json/version

# Check CDP proxy (requires auth token)
curl -H "X-CDP-Proxy-Token: $(cat ~/.molecule-cdp-proxy-token)" \
     http://127.0.0.1:9223/json/version
```

Expected: both return JSON with `"Browser": "Chrome/..."`.

If the proxy returns `401 unauthorized`: the token is missing or wrong. Re-run `install-host-bridge.sh`.

If Chrome returns empty: Chrome debug port isn't open — re-run Step 3.

---

## Step 5: Mount the token into your Docker workspace

The `lib/connect.js` helper reads the CDP proxy token from `/run/secrets/cdp-proxy-token`. Bind-mount the token file when starting your workspace:

```bash
docker run -v "$HOME/.molecule-cdp-proxy-token:/run/secrets/cdp-proxy-token:ro" \
       ...
```

In org templates using `workspaceTemplate`, add to the workspace volume mounts:

```yaml
workspaceTemplate:
  volumes:
    - ~/.molecule-cdp-proxy-token:/run/secrets/cdp-proxy-token:ro
```

---

## Step 6: Test end-to-end from inside a workspace

```bash
# Inside a workspace with the plugin installed:
node -e "
const { connect } = require('/configs/plugins/browser-automation/skills/browser-automation/lib/connect');
(async () => {
  const browser = await connect();
  const pages = await browser.pages();
  console.log('Open tabs:', pages.length);
  if (pages.length > 0) {
    console.log('URL of first tab:', pages[0].url());
  }
  await browser.disconnect();
  console.log('OK');
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected output: `Open tabs: N` (N ≥ 0), then `OK`.

---

## Troubleshooting

### `Error: Failed to connect to Chrome`

1. Is Chrome running with `--remote-debugging-port=9222`? → `curl localhost:9222/json/version`
2. Is the CDP proxy running? → `curl -H "X-CDP-Proxy-Token: ..." localhost:9223/json/version`
3. Is the token file mounted in the container at `/run/secrets/cdp-proxy-token`?
4. Is Docker Desktop networking set to allow `host.docker.internal`? (default on Docker Desktop)

### `page.goto()` hangs forever

Try `{ waitUntil: 'domcontentloaded' }` or `{ waitUntil: 'networkidle0', timeout: 30000 }` — some sites never reach `networkidle2`.

### `require('puppeteer-core')` fails in workspace

Set `NODE_PATH=/usr/lib/node_modules` or use the full path:
```javascript
const puppeteer = require('/usr/lib/node_modules/puppeteer-core');
```

### Chrome is reused across agents (wanted isolation)

Each Chrome profile is isolated. Launch Chrome with a unique `--user-data-dir` per agent:
```bash
google-chrome --remote-debugging-port=9223 \
  --user-data-dir="$HOME/.chrome-molecule-agent-a"
```
Note: each new profile requires re-logging into sites.

---

## CI / Validation

Run the local plugin validator (requires Python + PyYAML):

```bash
pip install pyyaml
python .molecule-ci/scripts/validate-plugin.py
```

This checks `plugin.yaml` structure and verifies at least one content file (SKILL.md, hooks/, skills/, or rules/) exists.
