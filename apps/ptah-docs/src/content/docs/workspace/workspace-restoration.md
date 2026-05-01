---
title: Workspace Restoration
description: How Ptah recovers your previous session when you relaunch the app.
---

# Workspace Restoration

Ptah is designed so that closing the app and reopening it feels like resuming, not starting over. Restoration happens automatically on every launch.

## What gets restored

| Item                           | Scope         | Restored?              |
| ------------------------------ | ------------- | ---------------------- |
| Active workspace               | App-level     | Yes                    |
| Open chats and scroll position | Per workspace | Yes                    |
| Chat drafts                    | Per workspace | Yes                    |
| Expanded file tree nodes       | Per workspace | Yes                    |
| Sidebar and panel layout       | App-level     | Yes                    |
| In-flight agent runs           | Per workspace | No (cancelled on quit) |
| Browser automation sessions    | App-level     | No (closed on quit)    |
| Provider auth tokens           | App-level     | Yes (via secure store) |

## Launch flow

1. Ptah reads the last active workspace path from settings.
2. If a CLI argument was passed, that path overrides the stored one.
3. Ptah validates the folder exists and is readable.
   - On success → workspace opens, chats and layout reload.
   - On failure → welcome screen opens with a **"Last workspace unavailable"** notice.
4. The background analyzer compares the analysis cache timestamp to file mtimes and re-scans only what changed.

## Handling moved or deleted folders

If you've moved a workspace since the last session, Ptah won't guess where it went. You'll see the welcome screen and can re-open the folder from its new location — your chat history under `.ptah/chats/` moves with the folder, so nothing is lost.

If you've deleted the folder, Ptah forgets it from the recent list after the next successful launch.

## Disabling restoration

If you'd rather start from the welcome screen every time, toggle **Settings → General → Restore last workspace on launch** off.

:::tip
Crash recovery uses the same mechanism. If Ptah exits unexpectedly, relaunching resumes exactly where you were — no manual recovery step required.
:::
