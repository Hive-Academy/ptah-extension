---
status: in_progress
type: refactor
title: Consolidate the process-tree reaper into platform-core
description: >-
  TASK_2026_484 left six local copies of killProcessTree, plus an older copy in
  vscode-core. Every affected library already depends on platform-core, so one
  implementation there replaces all of them.
---

# Consolidate the process-tree reaper into platform-core

Move the canonical reaper to `platform-core`, then delete every local copy.
The copies exist because `killProcessTree` was never exported from a library
all the callers may depend on.

See `context.md`.
