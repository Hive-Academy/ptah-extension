---
title: Launching a Browser
description: Start, inspect, and close Chrome/Chromium instances managed by Ptah.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

Ptah manages a single browser instance per workspace. A browser is launched on demand the first time an agent calls a browser tool, and stays alive across tool calls so agents can work across multiple steps without losing page state.

## Checking status

Call `ptah_browser_status` at any time to see whether a browser is currently running:

```json
{
  "running": true,
  "headless": false,
  "url": "https://example.com",
  "channel": "chromium"
}
```

If no browser has been launched yet, `running` is `false` and the other fields are omitted.

## Launching

You do not launch a browser explicitly — the first call to `ptah_browser_navigate` (or any other browser tool that needs a page) will spawn one for you.

Ptah chooses the browser binary in the following order:

1. An explicit **Chrome** or **Chromium** path set in **Settings → Browser → Executable**.
2. A bundled Chromium shipped with Ptah (preferred default).
3. The system Chrome install, if detected.

![Browser settings panel](/screenshots/browser-settings.png)

## Headed vs headless

By default Ptah launches in **headed** mode so you can watch the automation happen. Toggle **Settings → Browser → Run headless** to hide the window. Headless mode is typically 1.5–2× faster and is recommended for long-running jobs.

## Multiple instances

Only one browser instance per workspace is supported. If an agent needs a fresh session, close the current instance first:

```json
{ "tool": "ptah_browser_close" }
```

The next navigation call will spin up a clean browser with a new profile directory.

## Profile and storage

Each workspace gets its own isolated profile directory under the Ptah user data folder. Cookies, local storage, and cached credentials survive between tool calls but are wiped when you close the browser.

<Aside type="tip">
If your automation needs a persistent login, set **Settings → Browser → Persist profile** to keep the profile on disk between sessions.
</Aside>
