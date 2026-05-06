---
id: browser-testing
name: browser-testing
description: Real browser testing via Playwright — click, drag, type, screenshot, measure. For testing our own canvas and web apps, not external sites.
tags: [browser, playwright, testing, qa, uiux]
---

# Browser Testing via Playwright

Launch a headless Chromium browser, navigate to a target URL, and interact with the page like a real user — clicking buttons, filling forms, dragging elements, checking keyboard navigation, taking screenshots.

## When to use

Use `/browser-test` when you need to:
- Verify a UI change actually works (not just code-review the diff)
- Test drag-and-drop, form validation, modal behavior
- Check responsive layout at different viewport sizes
- Audit accessibility (focus order, aria labels, keyboard nav)
- Take screenshots for issue reports

## Setup (auto-installs on first use)

The skill auto-installs Playwright + Chromium if not present:

```python
import subprocess, sys
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
    subprocess.run(["playwright", "install", "chromium"], check=True)
    from playwright.sync_api import sync_playwright
```

System deps (`libglib2.0-0`, `libnss3`, etc.) must be pre-installed in the container image. If missing, run:
```bash
apt-get update && apt-get install -y libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

## Usage Pattern

```python
from playwright.sync_api import sync_playwright
import os

TARGET = os.getenv("CANVAS_URL", "http://host.docker.internal:3000")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(TARGET, timeout=15000)

    # Interact like a human
    page.click("button:has-text('Create Workspace')")
    page.fill("input[name='name']", "Test Agent")
    page.screenshot(path="/tmp/ux-audit/create-form.png")

    # Drag and drop
    card = page.locator(".workspace-card").first
    card.drag_to(page.locator(".canvas-area"), target_position={"x": 500, "y": 300})

    # Keyboard navigation
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Enter")

    # Responsive check
    page.set_viewport_size({"width": 768, "height": 1024})
    page.screenshot(path="/tmp/ux-audit/tablet.png")

    browser.close()
```

## Screenshot Directory

Save all screenshots to `/tmp/ux-audit/`. Create the dir first:
```python
os.makedirs("/tmp/ux-audit", exist_ok=True)
```

## Key Differences from browser-automation

| | browser-automation | browser-testing |
|---|---|---|
| Backend | Puppeteer (JS) + host CDP | Playwright (Python) + bundled Chromium |
| Target | External sites (social media) | Our own canvas/apps |
| Browser | User's Chrome (shared sessions) | Headless Chromium (isolated) |
| Auth | Relies on host Chrome cookies | No auth needed (canvas is local) |
| Close | `browser.disconnect()` (keep host Chrome) | `browser.close()` (kill headless) |
