---
id: TASK_2026_321
status: backlog
type: BUGFIX
title: >-
  Harness reconcile re-emits an identical thirteen-path blocked warning on the
  second boot pass
description: >-
  Two full six-target reconcile passes run back to back at activation — `reason:
  activation` (`apps/ptah-electron/src/activation/wire-runtime.ts:212-214`, with
  `downloadPending: true`) and then `reason: content-download-complete`
  (`:197-201`) — and both emit the identical `blocked: 13` payload listing every
  path under `.claude/skills/*`, both reporting `found: 106/119`. **The refusal
  behaviour is correct and must not change.** Ptah declining to touch a file it
  cannot prove it wrote is the whole point of that rule, and the second pass is
  a legitimate re-run after content download. This finding is about log volume
  only: whether the second pass needs to re-emit the full thirteen-path payload
  when nothing changed between the two. A second pass with a CHANGED blocked set
  must still report in full. Scoped to
  `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`
  (`:724-765`, with `blockedReason()` at `:775` and the `full`-only guard at
  `:725` both unchanged in behaviour) and
  `harness-reconciler.blocked-logging.spec.ts`, which should be extended to pin
  the identical-set suppression. Split out of TASK_2026_315 batch 4 by user
  decision because a concurrent session owned `libs/backend/harness-sync/**` at
  the time; the full original specification is preserved verbatim in that task's
  `tasks.md` under Task 4.4. Recorded there as F7.
---

# Harness reconcile re-emits an identical blocked payload at boot

Machine-owned metadata carrier. Prose lives in `./context.md`.
