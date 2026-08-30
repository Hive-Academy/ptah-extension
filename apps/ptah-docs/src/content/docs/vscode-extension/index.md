---
title: VS Code Extension
description: Run Ptah inside VS Code — the same engine, in the editor you already use.
---

Ptah ships as a VS Code extension as well as a desktop app. Both are built from
one core, so the agents, providers, memory, and skills behave the same in either
one.

Use the extension when you want Ptah beside your code. Use the
[desktop app](/getting-started/installation/) when you want the full canvas and
the Thoth tabs.

## Install

Search the VS Code Marketplace for **Ptah - The Coding Orchestra**, or install
from the command line:

```bash
code --install-extension ptah-extensions.ptah-coding-orchestra
```

**Requirements:** VS Code 1.100 or newer.

## First launch

Click the **Ptah** icon in the activity bar. The sidebar view is titled
**Ptah Code**.

There is no license gate. The extension activates and every local capability is
available immediately. Signing in is optional and only connects a
[Ptah Builders](/reference/tier-comparison/) membership.

Your first stop is the same as on the desktop:

1. Configure a provider in **Settings → Providers**. See [Providers](/providers/).
2. Run **Ptah: Setup Ptah Agents** to generate an agent roster. See [Setup Wizard](/setup/setup-wizard/).

## Commands

Every command is under the **Ptah** category in the Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command                                    | What it does                                                     |
| ------------------------------------------ | ---------------------------------------------------------------- |
| **Ptah: Toggle Ptah Chat**                 | Show or hide the sidebar chat.                                   |
| **Ptah: Open Full Ptah Panel**             | Open Ptah in a full editor tab instead of the sidebar.           |
| **Ptah: Open Orchestra Canvas**            | Open the [multi-tile canvas](/canvas/).                          |
| **Ptah: Setup Ptah Agents**                | Run the [setup wizard](/setup/setup-wizard/) in its own panel.   |
| **Ptah: Open Session Analytics Dashboard** | Token and cost analytics. See [Analytics](/sessions/analytics/). |
| **Ptah: Enter License Key**                | Attach a Builders license key.                                   |
| **Ptah: Check License Status**             | Show the current membership state.                               |
| **Ptah: Remove License Key**               | Clear the stored key.                                            |
| **Ptah: Export Settings**                  | Write a portable settings bundle.                                |
| **Ptah: Import Settings**                  | Load a settings bundle.                                          |
| **Ptah: Capture CPU Profile**              | Capture a profile for a performance bug report.                  |

No default keyboard shortcuts are bound. Assign your own in
**Keyboard Shortcuts** if you use a command often.

## Sidebar or full panel

The sidebar view is narrow and always visible. It suits a running conversation
beside your code.

**Open Full Ptah Panel** puts Ptah in an editor tab with the full width of the
window. Use it for the canvas, the setup wizard, and anything with a side panel.

## What is shared with the desktop app

Both surfaces read the same files, so your configuration follows you.

| Shared                                                            |
| ----------------------------------------------------------------- |
| `~/.ptah/settings.json` — providers, memory, skills, and the rest |
| `~/.ptah/ptah.db` — memory, skills, cron jobs, gateway bindings   |
| `~/.ptah/user/` — the harness user layer                          |
| `<workspace>/.claude/agents/` — your agent roster                 |
| `<workspace>/.ptah/specs/` — task specifications                  |

Provider credentials are stored in the operating system's secure credential
store, not in a settings file, on both surfaces.

## What is desktop-only

The extension does not carry these surfaces:

- The **Thoth** tabs — Memory, Skills, Schedules, and Gateway. The subsystems
  still run; only their management UI is desktop-only. You can drive all four
  from the [Ptah CLI](/cli/commands/#thoth-subsystems).
- The **Tasks** board. Use `ptah spec` from the CLI, or the desktop app.

Everything else — chat, agents, orchestration, the canvas, providers, plugins,
skills, browser automation, MCP, and the setup wizard — is present in both.

## Settings

Ptah's own settings live in `~/.ptah/settings.json`, not in VS Code's
`settings.json`. This is deliberate. The file is user-scoped and outside your
project tree, so a provider key can never be committed by accident, and one
configuration serves the extension, the desktop app, and the CLI at once.

See [Why not package.json?](/settings/why-not-package-json/) for the reasoning,
and [Global Settings](/settings/global-settings/) for the keys.

## Troubleshooting

**The sidebar is blank.** The extension activates lazily. Open the Ptah view or
run any Ptah command to trigger activation.

**A CLI agent is not detected.** VS Code launched from a desktop icon may not
inherit your shell `PATH`. Ptah repairs this for nvm and npm-global installs on
macOS and Linux. If a CLI is still missing, see
[CLI agent not detected](/troubleshooting/cli-agent-not-detected/).

**Performance problems.** Run **Ptah: Capture CPU Profile** and attach the
result to your issue. See [Filing bugs](/troubleshooting/reporting-bugs/).

## Next steps

- [Chat guide](/chat/)
- [Orchestra Canvas](/canvas/)
- [Ptah CLI](/cli/) — for the surfaces the extension does not carry
