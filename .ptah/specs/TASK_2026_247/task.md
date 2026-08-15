---
id: TASK_2026_247
status: in_review
type: bugfix
title: >-
  A config change denies every pending permission in every session, and the
  agent cannot tell that abort from a real user deny
description: >-
  `ConfigWatcher` fires on `authMethod`, `anthropicProviderId` and any
  `ptah.auth.*` secret write. The handler calls `disposeAllSessions()`, which
  calls `cleanupPendingPermissions()` with NO session id — the branch that walks
  the entire `pendingRequests` map and resolves every in-flight request across
  every window, tab and background subagent as `deny`. No user action is
  involved. Two independent defects: the cleanup is global where the triggering
  event is not, and the `reason: 'Session aborted'` Ptah sets never reaches the
  model, which receives Claude Code's generic "the user doesn't want to take
  this action" and correctly stops as if the user had decided. Measured cost on
  2026-08-15: two subagents dead for ~2.5 hours, mid-batch, with a file left
  non-compiling.
---

# A config change denies every pending permission, everywhere

Machine-owned metadata carrier. Prose lives in `./context.md`.
