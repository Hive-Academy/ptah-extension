---
status: backlog
type: devops
title: >-
  cross-env 7 -> 10
description: >-
  `cross-env` is declared at 7.0.3, which is the version installed today. The
  latest is 10.1.0. TASK_2026_498_5513 left it alone on purpose, so the bump is
  verified on its own rather than smuggled inside a migration that moves
  everything else.
---

# cross-env 7 -> 10

Follow-up 3 of TASK_2026_499_a31f.

## Why it was held back

Nothing is wrong with 7.0.3. It was excluded from the migration so that any
breakage it causes is attributable.

## Scope

1. Lift `cross-env` to `^10.1.0`.
2. Read the changelog for the Node floor and for argument-parsing changes.
3. Run every npm script that uses `cross-env` and confirm the environment
   variable reaches the child process on Windows.

Windows is the case that matters. `cross-env` exists only for that platform.
