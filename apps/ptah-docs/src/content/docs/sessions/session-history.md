---
title: Session History
description: Browse, search, and filter every conversation you've had in Ptah.
---

# Session History

The Session History panel is the long-term memory of your Ptah workspace. Every session ever created — active, closed, or archived — is here, searchable and filterable.

![History panel](/screenshots/sessions-history.png)

## Opening history

- Click the **History** icon in the sidebar
- Keyboard: `Ctrl/Cmd + H`
- Command Palette: **Ptah: Open Session History**

## Anatomy of the list

Each row shows:

- **Title** (auto-generated or your rename)
- **Agent** used for the session
- **Model** (e.g., `claude-opus-4-7`)
- **Last activity** timestamp
- **Message count**
- **Total cost** (if available)
- **Status badge** — active / archived / imported

Click any row to open the session in a new tab. Middle-click opens it in a background tab.

## Searching

The search box supports:

- **Plain text** — matches message content and title
- **Field queries** — `agent:backend-developer`, `model:claude-opus-4-7`, `has:error`
- **Date** — `before:2026-01-01`, `after:2026-03-01`
- **Quoted phrases** — `"payment webhook"`

Combine freely: `agent:frontend-developer "dark mode" after:2026-03-15`

Search runs against a local index. Typical latency is under 50ms on 1,000 sessions.

## Filters

The filter sidebar offers quick toggles:

| Filter     | Options                           |
| ---------- | --------------------------------- |
| Status     | Active, Archived, Imported, All   |
| Agent      | Any built-in or custom agent name |
| Model      | Any model used in this workspace  |
| Date range | Today, Week, Month, Custom        |
| Has errors | On / Off                          |
| Cost range | Slider                            |

Filters stack with the search query.

## Bulk actions

Select multiple sessions (shift-click or ctrl/cmd-click) to:

- Archive / unarchive
- Delete
- Export
- Tag

## Exporting

Select one or more sessions → **Export**. You can export to:

- **Markdown** — human-readable transcript
- **JSON** — full structured data (round-trip safe)
- **Clipboard** — markdown of the current selection only

```json
{
  "id": "sess_01h8z...",
  "title": "Add dark mode toggle",
  "agent": "frontend-developer",
  "model": "claude-opus-4-7",
  "messages": [ ... ],
  "metadata": { ... }
}
```

## Tags

Add free-form tags to any session for custom grouping:

- Right-click → **Add tag…**
- Filter by tag in the sidebar
- Tags are local to the workspace

## Keyboard shortcuts inside history

| Shortcut | Action                              |
| -------- | ----------------------------------- |
| `Enter`  | Open selected session               |
| `Space`  | Preview in side panel               |
| `Delete` | Delete selected (with confirmation) |
| `/`      | Focus search box                    |
| `Esc`    | Clear search / close panel          |

## Performance notes

Ptah loads history in chunks of 50 rows with virtual scrolling. A workspace with 10,000+ sessions still opens instantly. The underlying index lives at:

```
<workspace-root>/.ptah/sessions/index.json
```

If the index gets out of sync (rare, but possible after a force-quit), run **Command Palette → Ptah: Rebuild Session Index**.
