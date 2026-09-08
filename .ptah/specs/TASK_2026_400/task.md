---
id: TASK_2026_400
status: in_review
type: bugfix
title: >-
  Compaction leaves the tile empty and the context gauge reading the lifetime
  total
description: >-
  Three defects on the manual-compaction path. The reload cleared every
  fan-out tab by tab id but reloaded by session id, so with two tab
  representations of one session the originating tile was emptied and never
  restored. Once targeting was fixed the tile stayed empty anyway, because a
  stale deferred StreamingState outranked the replay during the finalizer's
  unscoped flush. Separately, the context gauge divided the lifetime token
  total by the model window, reading 89.6% on a session compacted to 11,016
  tokens.
---

# TASK_2026_400

Renumbered from TASK_2026_391, which collided with an unrelated curator task
allocated on `main` while this branch was unpushed.

Root-cause analysis in `codex-compaction-ui-analysis.md`. Batch breakdown in
`batches.md`. Per-batch evidence in `batch-1-report.md` through
`batch-5-report.md`.

Open: the `[compaction-diag]` logging in `compaction-lifecycle.service.ts` and
`session-loader.service.ts` is deliberately retained until the fix is
confirmed against the real Electron app.
