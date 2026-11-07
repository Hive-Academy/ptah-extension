---
status: backlog
type: devops
title: >-
  cross-env 7 -> 10
description: >-
  Bump cross-env from ^7.0.3 to ^10.1.0 on its own, so any breakage is attributable. Only
  one npm script uses it.
updated: 2026-11-07T00:00:00.000Z
---

# cross-env 7 -> 10

## Description

Follow-up 3 of TASK_2026_499_a31f. TASK_2026_498_5513 left `cross-env` alone on purpose, so the bump
is verified on its own rather than inside a migration that moves everything else.

## Current state (2026-11-07)

- Not done. `package.json:183` has `"cross-env": "^7.0.3"`.
- Only one npm script uses it: `"landing": "cross-env PORT=4200 nx serve ptah-landing-page"`
  (`package.json:9`). No `project.json` target uses it.
- `scripts/test-native.mjs:25` mentions `cross-env` only in a comment.
- Check whether `cross-env` is still worth keeping for one script, or whether the dependency can go.

## Why it was held back

Nothing is wrong with 7.0.3. It was excluded from the migration so that any
breakage it causes is attributable.

## Scope

1. Lift `cross-env` to `^10.1.0`.
2. Read the changelog for the Node floor and for argument-parsing changes.
3. Confirm that `PORT` reaches the child process on Windows for the `landing`
   script. That script runs a `serve` target, so run it only when the user asks.

Windows is the case that matters. `cross-env` exists only for that platform.
