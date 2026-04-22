---
title: Session Import Problems
description: Fixing issues discovering and loading historical Claude sessions.
---

import { Aside } from '@astrojs/starlight/components';

Ptah can pick up existing Claude Code conversations from `~/.claude/projects/` so you don't lose history when you move to the desktop app.

## How discovery works

On launch and on workspace open, Ptah scans `~/.claude/projects/` for folders whose name encodes a workspace path. Each folder contains a `*.jsonl` transcript per session. Matches are grouped under the "Import" section of the chat sidebar.

## Common problems

**Symptom:** "No sessions found" even though `~/.claude/projects/` contains folders.
**Likely cause:** The workspace path in Ptah doesn't match the path Claude Code used.
**Fix:** Open the workspace from the same absolute path (case and trailing slash matter on some systems). If you moved the project, copy or rename the matching folder inside `~/.claude/projects/`.

---

**Symptom:** Sessions appear but show as empty.
**Likely cause:** The `.jsonl` transcript is corrupted or was truncated mid-write.
**Fix:** Open the file in a text editor — each line must be a complete JSON object. Remove broken trailing lines and retry. Ptah will skip lines that don't parse rather than failing the whole session.

---

**Symptom:** Import succeeds but attached files are missing.
**Likely cause:** File references in the transcript use absolute paths that no longer resolve on this machine.
**Fix:** This is expected when importing from another machine. The conversation text is preserved; reattach files manually if you need them.

---

**Symptom:** Windows shows "path too long" errors on import.
**Likely cause:** Deep session folders exceed the 260-character `MAX_PATH` limit.
**Fix:** Enable long paths in Windows (Group Policy → Enable Win32 long paths) **and** restart Ptah. Alternatively, move `~/.claude/projects/` closer to the drive root.

<Aside type="tip">
You can force a rescan at any time from the chat sidebar: **... menu → Rescan imported sessions**.
</Aside>

## Where the files live

| OS      | Path                               |
| ------- | ---------------------------------- |
| Windows | `C:\Users\<you>\.claude\projects\` |
| macOS   | `/Users/<you>/.claude/projects/`   |
| Linux   | `/home/<you>/.claude/projects/`    |

Ptah never modifies files under `~/.claude/projects/` — it only reads them. Safe to back up or move.
