---
title: Recording
description: Record an animated GIF of browser interactions for bug reports or demos.
---

import { Aside } from '@astrojs/starlight/components';

<Aside type="caution" title="Pro tier only">
Browser Automation requires an active Pro license.
</Aside>

Ptah can record the browser viewport as an animated GIF. This is designed for lightweight demo clips and bug reports — not long-form screen capture.

## `ptah_browser_record_start`

Begin recording. The call returns immediately; frames are captured in the background until `ptah_browser_record_stop` is called.

### Arguments

| Name            | Type   | Required | Default | Description                                                            |
| --------------- | ------ | -------- | ------- | ---------------------------------------------------------------------- |
| `fps`           | number | no       | `10`    | Frames per second (max 30)                                             |
| `scale`         | number | no       | `1`     | Multiplier applied to viewport dimensions; use `0.5` for smaller files |
| `maxDurationMs` | number | no       | `60000` | Safety cap; recording auto-stops after this duration                   |

### Example

```json
{
  "tool": "ptah_browser_record_start",
  "arguments": {
    "fps": 12,
    "scale": 0.75
  }
}
```

## `ptah_browser_record_stop`

Stop recording and encode the captured frames into an animated GIF.

### Arguments

| Name   | Type    | Required | Default                            | Description                         |
| ------ | ------- | -------- | ---------------------------------- | ----------------------------------- |
| `path` | string  | no       | `.ptah/recordings/{timestamp}.gif` | Custom output path                  |
| `loop` | boolean | no       | `true`                             | Whether the GIF should loop forever |

### Return value

```json
{
  "path": "D:/projects/my-app/.ptah/recordings/2026-04-21T10-15-02.gif",
  "frames": 142,
  "durationMs": 14_200,
  "sizeBytes": 2_198_321
}
```

## Tips for good recordings

- Keep clips short — 10–20 seconds produces a GIF under 2 MB at default settings.
- Lower `fps` to 8 or use `scale: 0.5` for file size-sensitive contexts like GitHub issues.
- Run headed for smoother frames; headless capture can stutter on lightly-loaded CPUs.
- Record a fresh session: close the browser, navigate fresh, and start recording before the first interaction.

<Aside type="caution">
GIFs are inefficient for long or high-detail captures. For anything over a minute, use a dedicated screen recorder instead.
</Aside>
