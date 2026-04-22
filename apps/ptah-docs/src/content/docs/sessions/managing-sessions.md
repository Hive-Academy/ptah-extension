---
title: Managing Sessions
description: Create, switch, rename, and delete sessions in Ptah.
---

# Managing Sessions

Sessions are the unit of work in Ptah. You'll typically have one per task and switch between them throughout the day, the same way you switch between editor tabs.

![Session tabs](/screenshots/sessions-tabs.png)

## Creating a session

- **New session button** — top of the Chat panel, creates an empty session in the current workspace.
- **Keyboard** — `Ctrl/Cmd + N` inside the Chat panel.
- **From a template** — right-click the new-session button and pick a starter template (e.g., "Bug triage", "Code review"). See [Templates](/templates/).

New sessions inherit the workspace's default agent and model. You can change both from the header before your first message.

## Switching sessions

Ptah uses a **tab bar** at the top of the Chat panel. Click any tab to switch.

:::tip[Cached node trees]
Switching is instant because Ptah caches the rendered message tree per session. You can jump between five long-running chats with no re-render lag.
:::

### Keyboard navigation

| Shortcut                 | Action                                           |
| ------------------------ | ------------------------------------------------ |
| `Ctrl/Cmd + Tab`         | Next session                                     |
| `Ctrl/Cmd + Shift + Tab` | Previous session                                 |
| `Ctrl/Cmd + 1..9`        | Jump to the Nth tab                              |
| `Ctrl/Cmd + W`           | Close current tab (session is preserved on disk) |

Closing a tab doesn't delete the session — it just removes it from the active tab bar. You can reopen it from the [Session history](/sessions/session-history/) panel.

## Renaming sessions

By default Ptah auto-generates a session title from your first message. To rename:

- Double-click the tab label, or
- Right-click → **Rename**, or
- Open the session header and edit the title field inline.

Titles are free-form strings up to 100 characters.

## Pinning

Right-click a tab → **Pin**. Pinned tabs:

- Stay at the left of the tab bar
- Survive app restarts
- Can be unpinned the same way

Useful for a "scratchpad" chat you always want one click away.

## Deleting a session

Right-click → **Delete** or open **Session history** and use the bulk action menu.

:::caution[Permanent delete]
Delete is permanent and removes the JSON transcript from disk. Ptah does **not** keep a trash bin. Export first if you want a backup — see [Session history](/sessions/session-history/#exporting).
:::

## Duplicating a session

Right-click → **Duplicate** creates a copy with all messages up to the selected point. Great for exploring a "what if I try a different approach from here" branch without contaminating your main thread.

## Archiving

Right-click → **Archive** hides the session from the tab bar and default history view but keeps the file on disk. Toggle **Show archived** in the history filter to see it again. Archive is reversible; delete is not.

## Session storage layout

```
<workspace-root>/.ptah/sessions/
  active/
    sess_01h8z...json      # current + recently-open sessions
  archive/
    sess_01h8k...json      # archived sessions
  index.json               # lightweight title/date index for fast search
```

Ptah watches this folder. If you drop in a session file from another machine, it appears immediately in the history view.
