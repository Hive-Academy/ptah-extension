---
title: Screenshots
description: Capture viewport or full-page screenshots in PNG, JPEG, or WebP.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

## `ptah_browser_screenshot`

Capture an image of the current page. Screenshots are saved to the workspace's `.ptah/screenshots/` folder by default and the saved path is returned along with inline image data.

### Arguments

| Name             | Type    | Required | Default | Description                                                      |
| ---------------- | ------- | -------- | ------- | ---------------------------------------------------------------- |
| `fullPage`       | boolean | no       | `false` | If `true`, capture the entire scrollable page                    |
| `selector`       | string  | no       | —       | Clip the screenshot to this element                              |
| `format`         | enum    | no       | `png`   | One of `png`, `jpeg`, `webp`                                     |
| `quality`        | number  | no       | `90`    | Compression quality for `jpeg` and `webp` (1–100)                |
| `omitBackground` | boolean | no       | `false` | Transparent background (PNG/WebP only)                           |
| `path`           | string  | no       | —       | Custom output path; relative paths resolve against the workspace |

### Example — full page PNG

```json
{
  "tool": "ptah_browser_screenshot",
  "arguments": {
    "fullPage": true,
    "format": "png"
  }
}
```

### Example — element-only JPEG

```json
{
  "tool": "ptah_browser_screenshot",
  "arguments": {
    "selector": "#pricing-table",
    "format": "jpeg",
    "quality": 80
  }
}
```

## Format selection

| Format | When to use                                                                  |
| ------ | ---------------------------------------------------------------------------- |
| `png`  | Default. Lossless, supports transparency. Best for UI screenshots and diffs. |
| `jpeg` | Smallest file for photographic content. No transparency.                     |
| `webp` | Best compression/quality balance; supports transparency.                     |

<Aside type="tip">
For visual regression comparisons, always pin the viewport size under **Settings → Browser → Viewport** to avoid flaky diffs caused by window resizing.
</Aside>

## Full-page caveats

Full-page screenshots work by scrolling the document and stitching frames. Pages that lazy-load content on scroll (infinite feeds, virtualised lists) may produce partially blank regions. In those cases, scroll and capture in segments, or call `ptah_browser_evaluate` to trigger eager loading before the capture.
