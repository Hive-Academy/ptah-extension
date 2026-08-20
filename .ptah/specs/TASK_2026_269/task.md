---
id: TASK_2026_269
status: backlog
type: FEATURE
title: >-
  Keep registry.md derived by construction — regenerate from the task-index
  watcher, not from an RPC nobody remembers to call
description: >-
  `registry.md` is documented as a derived view but nothing derives it. It is
  written only when someone explicitly calls `tasks:generateRegistry`;
  `TaskWriterService.create` and `updateStatus` never touch it, and the file has
  no reference to the registry at all. It drifted 8 days and 71 tasks out of
  date (42 rows against 113 folders, newest id ~196) and a session that
  hand-allocated "highest + 1" from it overwrote a live carrier — TASK_2026_194's
  failure mode, recurring after 194 was closed. Wiring the create path is the
  obvious fix and is not sufficient on its own: agents create carriers by
  writing `task.md` directly and never reach the RPC, which is exactly how the
  colliding carriers were made. `TaskIndexService` already watches
  `.ptah/specs/` with a 300ms debounce and already suppresses its own writes
  into that directory path-wise (the specs `README.md`), so the trigger that
  covers both machine and hand-written carriers already exists. The hazard is
  that `registry.md` lives inside the watched directory, so regeneration must
  join that suppression or it re-triggers itself forever.
---

# Keep registry.md derived by construction

Machine-owned metadata carrier. Prose lives in `./context.md`.
