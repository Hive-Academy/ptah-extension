---
title: Browser Automation
description: Drive a real Chrome/Chromium browser from Ptah — navigate, click, type, screenshot, record, and monitor network traffic.
---

import { Aside } from '@astrojs/starlight/components';

Ptah's browser automation suite lets agents drive a real Chrome or Chromium instance on your machine. It is built on top of Playwright and exposed through a dedicated set of MCP tools, so any agent — local or remote — can use it through the same uniform interface.

<Aside type="caution" title="Pro tier only">
Browser Automation is a **Pro-tier** feature. Free-tier users can see the tools in the catalog but cannot launch a browser. Upgrade from **Settings → License** to unlock the full suite.
</Aside>

## What you can do

- Launch a headed or headless Chromium instance under Ptah's control
- Navigate to URLs and wait for load states deterministically
- Click, type, scroll, and evaluate arbitrary JavaScript in the page
- Capture full-page or viewport screenshots in PNG, JPEG, or WebP
- Monitor every HTTP request and response the page makes
- Record an animated GIF of a session for bug reports or demos

## Tool catalog

| Tool                        | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `ptah_browser_status`       | Report whether a browser instance is currently running |
| `ptah_browser_navigate`     | Open a URL and wait for the page to settle             |
| `ptah_browser_click`        | Click a selector or coordinate                         |
| `ptah_browser_type`         | Type text into an input                                |
| `ptah_browser_content`      | Return the rendered HTML or a readable text extract    |
| `ptah_browser_evaluate`     | Run JavaScript in the page context                     |
| `ptah_browser_screenshot`   | Capture the current viewport or full page              |
| `ptah_browser_network`      | List captured HTTP requests and responses              |
| `ptah_browser_record_start` | Begin recording an animated GIF                        |
| `ptah_browser_record_stop`  | Stop recording and save the GIF                        |
| `ptah_browser_close`        | Shut the browser down cleanly                          |

## Typical workflow

1. Agent calls `ptah_browser_navigate` with a target URL.
2. Agent inspects the DOM with `ptah_browser_content` or a targeted `ptah_browser_evaluate`.
3. Agent interacts with `ptah_browser_click` and `ptah_browser_type`.
4. Agent captures a `ptah_browser_screenshot` or reviews network traffic via `ptah_browser_network`.
5. Agent closes the browser with `ptah_browser_close` when the task is done.

See the dedicated pages in this section for full details of each operation.
