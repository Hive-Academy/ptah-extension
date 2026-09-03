---
status: in_review
type: bugfix
title: Resumed session drops its terminal turn_state, so the UI spinner never clears
description: >-
  `SessionTurnStateRegistry` counts revisions per SDK query and
  `ChatStreamBroadcaster` deletes the record on every clean loop exit, so a
  resumed query restarts at revision 1. The webview compares revisions per
  SESSION (`TabManagerService.acceptsTurnState`), and its "counter restarted"
  allowance fires only when the session id CHANGED. A `chat:continue` that
  auto-resumes therefore keeps the same session id, and the tab drops both the
  `generating` (1) and the terminal `idle` (2) of the resumed turn. The tab
  keeps `status: 'streaming'` from the optimistic `markStreaming`, so the Stop
  button and the streaming quotes stay on forever while the backend sits idle.
  Measured in `tmp/logs/log.log` on session 50653b50 (lines 3, 171, 191, 378,
  379). The same log carries the control case: after an abort the record is NOT
  cleared (line 475), the counter keeps rising, and the next turn updates the UI
  normally. A second, independent defect from the same session: `monaco-vim`
  is injected as a plain script while Monaco's AMD loader owns `define`, so the
  UMD wrapper takes the anonymous-define branch, never assigns
  `window.MonacoVim`, and every later attach re-injects the script and throws
  `Can only have one anonymous define call per script file`.
---

# Resumed turn never idles the tab

Two defects, both surfaced by one session (`50653b50`, workspace
`D:\projects\property-hub`).

**D1 — turn-state revision.** The backend counter is per query; the frontend
guard is per session. Make the backend counter monotonic per session id so the
guard's assumption is true, rather than loosening the guard.

**D2 — monaco-vim loader.** Vim mode has never attached in this build. The
retry has no bound, which turns one load failure into a repeating console
error.

Narrative and evidence: `context.md`.
