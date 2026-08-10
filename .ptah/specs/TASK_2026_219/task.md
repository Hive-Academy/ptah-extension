---
status: backlog
type: BUGFIX
title: >-
  Pre-write offset guard in applyHunks does not call restoreAfterFailedApply,
  so its "Nothing was changed" message is not always accurate
description: >-
  8C reached the pre-write offset guard under an adversarial concurrent write
  (a TOCTOU window internal to one applyHunks call) and found the guard-2
  branch returns directly without calling restoreAfterFailedApply, reasoning
  that --check is a dry run and nothing needs undoing. That reasoning holds
  for the service's own writes and does not hold for an external write
  landing in that exact window, which the guard provably can now observe.
  Not a corruption risk -- the tool never writes the user's selected hunk
  when this fires -- but the message is inaccurate about the file's actual
  state. Register item 13 from TASK_2026_173 Batch 9. Known one-line fix.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Do not confuse with the separate, CLOSED `--check`
retain/remove question (see context.md) -- that question is settled and must not be re-opened.
