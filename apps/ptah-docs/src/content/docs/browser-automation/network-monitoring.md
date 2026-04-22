---
title: Network Monitoring
description: Inspect every HTTP request and response the page makes.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

## `ptah_browser_network`

Return a structured log of HTTP requests and responses observed since the browser was launched (or since the last reset).

### Arguments

| Name            | Type             | Required | Default | Description                                                  |
| --------------- | ---------------- | -------- | ------- | ------------------------------------------------------------ |
| `filter`        | string           | no       | —       | Substring or regex matched against the request URL           |
| `methods`       | string[]         | no       | all     | Restrict to specific HTTP methods (e.g. `["POST", "PUT"]`)   |
| `statusRange`   | [number, number] | no       | —       | Only include responses with a status in this range           |
| `includeBodies` | boolean          | no       | `false` | Include request and response bodies when they are text/JSON  |
| `since`         | number           | no       | —       | Unix timestamp in milliseconds; only entries after this time |
| `reset`         | boolean          | no       | `false` | Clear the log after returning results                        |

### Example — failed API calls

```json
{
  "tool": "ptah_browser_network",
  "arguments": {
    "statusRange": [400, 599],
    "methods": ["GET", "POST"],
    "includeBodies": true
  }
}
```

### Response shape

```json
{
  "entries": [
    {
      "id": "req_42",
      "url": "https://api.example.com/v1/users",
      "method": "POST",
      "status": 401,
      "requestHeaders": { "content-type": "application/json" },
      "responseHeaders": { "content-type": "application/json" },
      "requestBody": "{\"email\":\"...\"}",
      "responseBody": "{\"error\":\"unauthorized\"}",
      "timings": { "startedAt": 1_700_000_000_123, "durationMs": 212 }
    }
  ],
  "dropped": 0
}
```

### Limits

- The log keeps the last 500 entries per browser session. Older entries are dropped and counted in `dropped`.
- Bodies larger than 1 MB are truncated. The `truncated: true` flag is set on the entry.
- Binary responses (images, fonts) never include bodies, even when `includeBodies` is `true`.

<Aside type="tip">
Combine `ptah_browser_navigate` with `reset: true` on `ptah_browser_network` to get a clean capture of a single page load.
</Aside>
