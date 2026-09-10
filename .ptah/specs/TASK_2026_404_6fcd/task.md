---
id: TASK_2026_404_6fcd
status: backlog
type: feature
title: Scale the Orchestra Canvas beyond nine tiles
description: >-
  Replace DOM-based retention with derived tile fidelity, redesign the compact
  tile as a glanceable summary, add semantic zoom, persist canvas intent, and
  add a notification center. Includes a separate concurrency track for many
  simultaneously running sessions.
---

Two tracks. Track R makes the renderer bounded so tile count stops being the
limit. Track C bounds simultaneously running agent sessions, which the renderer
work does not address.

Investigation and adversarial review are complete. See `context.md` for intent,
`task-description.md` for scope and acceptance criteria,
`codex-canvas-investigation.md` and `codex-plan-review.md` for the evidence.
