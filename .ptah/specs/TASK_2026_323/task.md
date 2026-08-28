---
id: TASK_2026_323
status: done
type: BUGFIX
title: >-
  App hangs with 3 sessions open and CLI agents running: add event-loop
  profiling and remove the main-thread blockers
priority: critical
description: >-
  Electron and VS Code become unusable with 3 chat sessions open when one
  session runs several CLI agents. Investigation found no event-loop or RPC
  timing instrumentation in any runtime, plus a ranked set of synchronous
  main-thread blockers in the backend and quadratic per-chunk work in the
  renderer. Phase 1 adds the instrumentation needed to prove which blocker
  fires. Phase 2 fixes the confirmed backend blockers. Phase 3 fixes the
  renderer hot path.
---

See `context.md` for the full ranked findings and the phased plan.
