---
title: Troubleshooting
description: Diagnose and resolve common Ptah issues.
---

import { Aside } from '@astrojs/starlight/components';

Most problems fall into one of a handful of categories. This section walks through each in **Symptom → Likely cause → Fix** form so you can scan to the row that matches what you're seeing.

## Gather diagnostics first

Before digging into a specific category, collect the basics. The **Help → Copy diagnostics** command puts the following on your clipboard:

- Ptah version and build number
- OS and CPU architecture
- Active license tier
- Configured providers (keys redacted)
- Last 50 log lines

Attach this block to any bug report. See **Logs & diagnostics** for how to grab full logs.

## What's in this section

| Page                        | Covers                                                          |
| --------------------------- | --------------------------------------------------------------- |
| Installation issues         | Install, update, and code-signing failures                      |
| License issues              | Activation, offline grace period, revalidation                  |
| Provider errors             | Key rejection, quota, rate limits                               |
| CLI agent not detected      | Copilot / Gemini / Codex CLI discovery, Windows `.cmd` wrappers |
| MCP port conflicts          | Default port `51820` in use, fallback behavior                  |
| Workspace analysis failures | Permissions, symlinks, very large repos                         |
| Session import problems     | `~/.claude/projects/` discovery                                 |
| Logs & diagnostics          | Finding logs, opening DevTools, enabling verbose mode           |
| Reporting bugs              | What to include in a GitHub issue                               |

<Aside type="tip">
If none of the pages here match your issue, open an issue on [GitHub](https://github.com/ptah-extensions/ptah-extension/issues) with your diagnostics block attached.
</Aside>
