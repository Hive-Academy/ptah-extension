---
id: TASK_2026_246
status: backlog
type: REFACTORING
title: >-
  Humanize agent-generation — repair its missing compile gate, then split four
  god files behind an unchanged facade
description: >-
  A nine-project triage scored `libs/backend/agent-generation` the most broken
  unit in the workspace, and it is the only candidate whose verification gate is
  itself broken: its `project.json` declares only `build` and `test`, so
  `npm run typecheck:all` silently skips 18k LOC and `build` is esbuild, which
  strips types without checking them. On top of that it violates a rule stated in
  its own `CLAUDE.md:51` ("never use `node:fs` directly") in seven files, two of
  them synchronously on async paths; carries four god files led by
  `user-layer-mirror.service.ts` (1642 lines, 16 exported interfaces, nine
  Dir/File method pairs, its own concurrency primitive, destructive writes into
  the user layer); has 0.73 spec:src with `wizard/` and `prompt-designer/`
  entirely dark; and holds the one duplication in the repo that has already
  forked observable output — two copies of `convertStreamEventToFlatEvent` that
  emit different `thinking_start` events for the same input. Ten behavior-preserving
  batches, strictly serial, with three behavior-changing steps isolated and gated
  on sign-off.
---

# Humanize agent-generation

Machine-owned metadata carrier. Prose lives in `./context.md`.
