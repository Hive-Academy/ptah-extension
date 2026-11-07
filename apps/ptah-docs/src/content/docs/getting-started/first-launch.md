---
title: First launch
description: Open your first workspace and see what Ptah does on the first run.
---

Ptah is free and open source. The first launch asks for no account, no sign-up, and no license key.

## Get ready

On the first start, Ptah opens the **Get ready** step of Setup. It shows **Check Claude Code and Codex**. Ptah works with Claude Code or Codex as its main connection.

1. Pick the one you use as your main connection.
2. Make sure that it is installed and signed in. Ptah shows the status of each one, for example **Needs install** or **Needs sign-in**.
3. Click **Continue**. To do this step later, click **Continue anyway**.

You can open this step again from **Setup**. For other providers, see [Connect a provider](/getting-started/signing-in/).

## Open a workspace

Ptah keeps agents, chat sessions, and project analysis for each folder that you open.

When no folder is open, Ptah shows the heading **Open a workspace** and an **Open Folder** button. Below it, Ptah shows your recent workspaces and an activity grid. The tab bar stays hidden until a folder is open.

1. Click **Open Folder**, or select **File → Open Folder...**.
2. Select the root folder of a project.
3. Ptah opens the workspace and shows the tab bar.

To open a recent workspace, click it in the recent workspaces list. To switch between open workspaces, click the **Workspaces** tab on the left edge of the window.

## The tab bar

| Tab       | What it opens                                    |
| --------- | ------------------------------------------------ |
| Chat      | The Orchestra Canvas with your chat sessions     |
| Voice     | Voice control                                    |
| Apps      | MCP apps                                         |
| Tasks     | The tasks board                                  |
| Reviews   | Review runs                                      |
| Analytics | Usage and cost analytics                         |
| Setup     | Project setup: analysis, new project, AI team    |

The buttons on the right of the title bar open **Thoth**, **Marketplace**, and **Settings**.

To start a chat, open the **Chat** tab and click **New Session**.

## Set up your project

Ptah does not start the project setup for you. Click **Setup** and pick a path. See [Project setup](/setup/). You can chat without it.

## CLI agent detection

Ptah looks for installed agent CLIs and registers the ones that it finds. The CLI types are Codex, Copilot, Cursor, Antigravity, OpenCode, Pi, Grok, and Claude. Detected CLIs appear in **Settings → Providers → CLI agents**. A missing CLI is not an error. See [CLI agents](/agents/cli-agents/).

## Import of existing sessions

When you open a workspace, Ptah reads your Claude Code session history in `~/.claude/projects/`. It imports up to 50 recent sessions for that workspace. There is no prompt. The session list is short at first and fills while the import runs. The import reads local files only and uploads nothing.

## Optional: Ptah Builders membership

Ptah Builders is an optional paid membership. It does not unlock local features. If you have a membership key, attach it in **Settings → Advanced**. See [Connect a provider](/getting-started/signing-in/#membership-key).

## Next step

Continue to [Connect a provider](/getting-started/signing-in/).
