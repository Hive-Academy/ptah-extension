---
title: Navigation
description: Navigate the browser to a URL and wait for predictable load states.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

## `ptah_browser_navigate`

Navigate the browser to a URL and block until the page has reached a requested load state.

### Arguments

| Name        | Type   | Required | Default | Description                                                |
| ----------- | ------ | -------- | ------- | ---------------------------------------------------------- |
| `url`       | string | yes      | —       | Absolute URL including protocol                            |
| `waitUntil` | enum   | no       | `load`  | One of `load`, `domcontentloaded`, `networkidle`, `commit` |
| `timeoutMs` | number | no       | `30000` | Maximum time to wait for the navigation to settle          |

### Example

```json
{
  "tool": "ptah_browser_navigate",
  "arguments": {
    "url": "https://docs.ptah.live",
    "waitUntil": "networkidle",
    "timeoutMs": 15000
  }
}
```

### Wait-for-load semantics

| `waitUntil`        | Use when                                                       |
| ------------------ | -------------------------------------------------------------- |
| `commit`           | You only need the navigation to start; fastest option          |
| `domcontentloaded` | DOM is ready but subresources may still be loading             |
| `load`             | Default; the `load` event has fired and most assets are loaded |
| `networkidle`      | Page has had no network activity for 500 ms; safest for SPAs   |

<Aside type="tip">
For single-page apps that continuously poll an API, `networkidle` may never resolve. Prefer `domcontentloaded` plus an explicit `ptah_browser_evaluate` check for a ready signal.
</Aside>

### Errors

| Condition             | Behavior                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| Invalid URL           | Returns an error without launching the browser                            |
| Timeout exceeded      | Returns a `NavigationTimeout` error; browser remains on the previous page |
| DNS / network failure | Returns the underlying Chromium error code (e.g. `ERR_NAME_NOT_RESOLVED`) |

## Reloading

There is no dedicated reload tool — call `ptah_browser_navigate` with the current URL to force a reload, or use `ptah_browser_evaluate` with `location.reload()`.
