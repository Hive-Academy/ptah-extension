---
title: Logs & Diagnostics
description: Finding logs, opening DevTools, and enabling verbose logging.
---

import { Aside } from '@astrojs/starlight/components';

Ptah writes structured logs to the Electron user-data folder. Logs rotate daily and are kept for 14 days.

## Log file locations

| OS      | Path                                        |
| ------- | ------------------------------------------- |
| Windows | `C:\Users\<you>\AppData\Roaming\Ptah\logs\` |
| macOS   | `/Users/<you>/Library/Logs/Ptah/`           |
| Linux   | `/home/<you>/.config/Ptah/logs/`            |

The current day's log is named `ptah-YYYY-MM-DD.log`. Older files are gzipped as `ptah-YYYY-MM-DD.log.gz`.

## Opening the logs folder

**Help → Open logs folder** reveals the folder in Explorer / Finder / your file manager without having to remember the path.

## Log levels

The default level is `info`. Raise it for more detail:

- **Settings → Advanced → Log level**, or
- Launch with the `PTAH_LOG=debug` environment variable:

```bash
# Windows (PowerShell)
$env:PTAH_LOG = "debug"; & "C:\Users\$env:USERNAME\AppData\Local\Programs\Ptah\Ptah.exe"

# macOS
PTAH_LOG=debug /Applications/Ptah.app/Contents/MacOS/Ptah

# Linux
PTAH_LOG=debug ./Ptah-*.AppImage
```

Valid levels: `error`, `warn`, `info`, `debug`, `trace`. `trace` is extremely verbose — use only when debugging.

## DevTools

Ptah is an Electron app, and you can open Chromium DevTools for the webview:

- **Help → Toggle DevTools**, or
- `Ctrl+Shift+I` (Windows / Linux) / `Cmd+Option+I` (macOS)

The **Console** tab shows renderer-side errors, the **Network** tab shows IPC-style channels, and the **Sources** tab lets you breakpoint if you're contributing to Ptah itself.

## Main-process logs

Electron's main process logs to the same file as the renderer. Entries are tagged `[main]` or `[renderer]` so you can filter:

```bash
grep "\[main\]" ptah-2026-04-21.log
```

## Redacting before sharing

Logs are scrubbed of API keys and OAuth tokens before writing, but filesystem paths, workspace names, and file contents can leak. Skim a log before attaching it to a bug report.

<Aside type="tip">
**Help → Copy diagnostics** produces a compact, pre-redacted block suitable for pasting into a GitHub issue without sharing the full log.
</Aside>
