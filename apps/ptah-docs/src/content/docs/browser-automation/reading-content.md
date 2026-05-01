---
title: Reading Page Content
description: Extract HTML, text, and evaluated JavaScript results from the page.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

## `ptah_browser_content`

Return the rendered content of the current page. Use this when an agent needs to reason about the DOM or extract text.

### Arguments

| Name       | Type   | Required | Default  | Description                                      |
| ---------- | ------ | -------- | -------- | ------------------------------------------------ |
| `format`   | enum   | no       | `text`   | One of `html`, `text`, `markdown`                |
| `selector` | string | no       | —        | Limit the extraction to matches of this selector |
| `maxChars` | number | no       | `100000` | Truncate output to this many characters          |

### Formats

| Format     | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `html`     | Full rendered HTML including inline scripts and styles                |
| `text`     | Readable plain text extracted via the Readability algorithm           |
| `markdown` | Readable content converted to Markdown, preserving headings and links |

### Example

```json
{
  "tool": "ptah_browser_content",
  "arguments": {
    "format": "markdown",
    "selector": "main"
  }
}
```

<Aside type="tip">
`markdown` is the best format to feed back into an LLM — it preserves structure while staying compact.
</Aside>

## `ptah_browser_evaluate`

Run arbitrary JavaScript in the page's context and return the serialised result.

### Arguments

| Name        | Type   | Required | Description                                                          |
| ----------- | ------ | -------- | -------------------------------------------------------------------- |
| `script`    | string | yes      | JavaScript source; the last expression or `return` value is returned |
| `args`      | any[]  | no       | Optional arguments passed to the function                            |
| `timeoutMs` | number | no       | Defaults to `5000`                                                   |

### Example

```json
{
  "tool": "ptah_browser_evaluate",
  "arguments": {
    "script": "return document.title;"
  }
}
```

You can also pass arguments:

```json
{
  "tool": "ptah_browser_evaluate",
  "arguments": {
    "script": "(selector) => document.querySelectorAll(selector).length",
    "args": ["a[href]"]
  }
}
```

### Constraints

- The script runs in the page, not in Node. Browser globals (`window`, `document`, `fetch`) are available; Node globals (`require`, `process`) are not.
- Return values must be JSON-serialisable. DOM nodes and functions cannot be returned directly.
- Scripts that throw return an error with the original stack trace.
