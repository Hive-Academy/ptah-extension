---
status: backlog
type: devops
title: >-
  Migrate the remaining projects off the @nx/jest:jest executor
description: >-
  `@nx/jest:jest` is deprecated and Nx 24 removes it. The 16 NestJS projects
  already moved to `nx:run-commands` during TASK_2026_499_a31f. Every other
  project still declares the executor and needs
  `nx g @nx/jest:convert-to-inferred`.
---

# Off the @nx/jest:jest executor

Follow-up 4 of TASK_2026_499_a31f.

## Why now rather than at Nx 24

Nx 24 removes the executor. A workspace that reaches Nx 24 with the executor
still declared loses its test target, and a missing target is the failure mode
this repository has already been bitten by: a suite that reports
`No tests found` and exits 0 reads as a pass.

## Scope

1. List every project whose `project.json` still declares `@nx/jest:jest`.
2. Run `nx g @nx/jest:convert-to-inferred` per project or in batches.
3. Run `npx nx reset` after the `project.json` files change. Never run it while
   another executor is working in the same worktree.
4. Verify with `npx nx run-many -t test -p ...` and read the
   `Running target test for N projects` header. Confirm N is the number asked
   for, and confirm each project reports a real test count.

Never use `nx test projA projB`. It runs the target for the first project only
and hands the remaining names to Jest as path filters.
