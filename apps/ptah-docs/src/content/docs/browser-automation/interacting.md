---
title: Clicking and Typing
description: Simulate user interactions on the page.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

## `ptah_browser_click`

Click an element selected by CSS selector, text, or absolute coordinates.

### Arguments

| Name         | Type   | Required    | Description                                                 |
| ------------ | ------ | ----------- | ----------------------------------------------------------- |
| `selector`   | string | conditional | CSS or text selector (e.g. `button.submit`, `text=Sign in`) |
| `x`          | number | conditional | Viewport-relative x coordinate                              |
| `y`          | number | conditional | Viewport-relative y coordinate                              |
| `button`     | enum   | no          | `left` (default), `right`, or `middle`                      |
| `clickCount` | number | no          | Defaults to `1`; use `2` for double-click                   |
| `timeoutMs`  | number | no          | How long to wait for the element to become actionable       |

Either a `selector` or a `(x, y)` pair is required.

### Example

```json
{
  "tool": "ptah_browser_click",
  "arguments": {
    "selector": "text=Accept all cookies"
  }
}
```

Ptah will scroll the element into view, wait for it to become stable and enabled, and then click. If the element is covered by another element or detached during the wait, the call retries until the timeout expires.

## `ptah_browser_type`

Type text into a focused input or a specific selector.

### Arguments

| Name         | Type    | Required | Description                                            |
| ------------ | ------- | -------- | ------------------------------------------------------ |
| `selector`   | string  | no       | If provided, focuses the element before typing         |
| `text`       | string  | yes      | Text to type                                           |
| `delayMs`    | number  | no       | Per-keystroke delay; defaults to `0` for instant input |
| `clearFirst` | boolean | no       | If `true`, selects all existing text and replaces it   |

### Example

```json
{
  "tool": "ptah_browser_type",
  "arguments": {
    "selector": "input[name=email]",
    "text": "user@example.com",
    "clearFirst": true
  }
}
```

### Special keys

Use JavaScript escape sequences for control characters. For more complex key sequences (e.g. `Tab`, `Enter`, `Shift+A`) use `ptah_browser_evaluate` with Playwright's keyboard API:

```javascript
await page.keyboard.press('Enter');
```

<Aside type="tip">
Prefer selectors over coordinates. Coordinate clicks fail silently when the viewport is resized, when the page scrolls, or when a modal appears on top.
</Aside>
