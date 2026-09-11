---
id: TASK_2026_424_b6bf
status: backlog
type: BUGFIX
title: Cursor adapter waits for the SDK stream to end before completing
description: >-
  CursorCliAdapter returns from its stream loop only when run.stream() ends,
  the same shape that left Codex agents running until the timeout. Verify
  whether the stream ends after a terminal status message, and if not, return
  on it.
---

Follow-up from TASK_2026_421. See `context.md`.
