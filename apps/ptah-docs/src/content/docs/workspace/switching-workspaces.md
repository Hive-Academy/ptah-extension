---
title: Switching Workspaces
description: Change the active workspace from the UI or via CLI argument.
---

# Switching Workspaces

You can only have one **active workspace** at a time. Switching replaces the current file tree, analysis snapshot, git state, and per-workspace config with the target workspace's.

## From the UI

Three entry points, all equivalent:

1. **File → Open Folder** — picks a fresh folder.
2. **File → Open Recent** — pick from the last ~10 workspaces.
3. **Status bar → workspace name** — click the active workspace label to open a quick switcher.

![Workspace quick switcher](/screenshots/workspace-switcher.png)

When you switch:

- Unsaved chat drafts in the current workspace are preserved and restored when you come back.
- Running agents in the current workspace are **not** interrupted. They continue in the background and you'll see their completion notifications even after switching.
- The new workspace's file tree, git state, and analysis load immediately. If analysis is stale, a re-scan kicks off in the background.

## From the CLI

Pass a folder path as the first argument to the Ptah binary:

```bash
ptah /path/to/other-project
```

If Ptah is already running, the existing window switches to the new workspace. If Ptah isn't running, it launches with that workspace active.

This is the mechanism editor integrations use to open a project in Ptah with a single shortcut.

## Persistent state per workspace

Each workspace keeps its own:

- Open chats and chat history (`.ptah/chats/`).
- Panel layout (sidebar width, open tabs, etc.).
- Expanded file tree nodes.
- Per-workspace config (`.claude/`, `.ptah/`).

Switching away and back restores all of the above. See [Workspace restoration](/workspace/workspace-restoration/) for what survives a full app restart.

:::note
Agent billing and provider quotas are per-provider, not per-workspace. Switching workspaces does not reset any usage counters.
:::
