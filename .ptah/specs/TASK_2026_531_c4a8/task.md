---
id: TASK_2026_531_c4a8
status: backlog
type: BUGFIX
title: >-
  Gate the canvas grid on SURFACE_ACTIVE without regressing the real Gridstack
  drag, which the first attempt broke
description: >-
  TASK_2026_524 batch 2 gated every webview consumer on the SURFACE_ACTIVE
  token. The canvas portion was reverted out of pull request 574 before merge
  because it regressed the ptah-electron-e2e test named real Gridstack drag
  keeps an explicit 2plus1 row through resize and workspace switch. After a
  real two-leg mouse drag the third tile stayed at gs-y 0 instead of moving to
  gs-y 6, so the whole gesture read as a no-op. Reproduced on three separate
  continuous integration runs across two commits, so it is not a flake. Every
  other check passed, including the canvas unit suite, which contains the
  unit-level equivalent of the failing assertion at
  canvas-workspace-grid.component.spec.ts line 648 and still passes. The defect
  therefore lives in real Gridstack event timing rather than in the gesture
  translation logic. The reverted work is recoverable from commit acb791814.
  This task is to land the same activity gating with the drag intact.
---

# Gate the canvas grid on SURFACE_ACTIVE without breaking the drag

See `context.md`.
