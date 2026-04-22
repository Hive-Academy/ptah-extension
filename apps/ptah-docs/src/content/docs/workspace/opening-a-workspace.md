---
title: Opening a Workspace
description: Open a project folder, switch between workspaces, and launch Ptah from the command line.
---

# Opening a Workspace

Ptah can open any local folder as a workspace. There are three ways to do it.

## 1. From the UI

Use **File → Open Folder…** (or the welcome screen's **Open Folder** button) and pick the project root. Ptah will:

1. Record the folder as the active workspace.
2. Add it to the **Recent Workspaces** list.
3. Kick off the initial project analysis.

![Open Folder dialog](/screenshots/open-folder-dialog.png)

## 2. Recent workspaces

The welcome screen and the **File → Open Recent** menu list the last workspaces you used, most recent first. Selecting one re-opens it instantly — Ptah caches the previous analysis and only re-runs scans when files have changed.

![Recent workspaces list](/screenshots/recent-workspaces.png)

## 3. From the command line

Launching Ptah with a folder path opens that folder directly, bypassing the welcome screen. This is useful for shell aliases, editor integrations, and scripted workflows.

```bash
# macOS / Linux
ptah ~/code/my-project

# Windows (PowerShell)
ptah C:\code\my-project
```

If the path is invalid, Ptah falls back to the last active workspace (or the welcome screen if there is none).

:::note
The CLI argument takes priority over the persisted active workspace. If you pass a folder on launch, that folder wins for the session.
:::

## Persistence across restarts

The active workspace is stored in Ptah's app-level settings. When you relaunch:

- If you passed a folder via CLI → that folder opens.
- Otherwise → the last active workspace reopens automatically.
- If that folder no longer exists on disk → Ptah shows the welcome screen and logs a warning.

See [Workspace restoration](/workspace/workspace-restoration/) for what else is restored with the workspace (open chats, expanded tree nodes, panel layout).

## Supported folders

Any directory works. Ptah does **not** require a `package.json`, `.git`, or any specific marker file. Detection runs best-effort — the more standard your project layout, the more accurate the auto-detected stack.

:::caution
Avoid opening very large folders (e.g. your entire home directory or `node_modules`). The initial analysis walks the tree and can be slow. Open the project root, not its parent.
:::
