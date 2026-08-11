---
id: TASK_2026_173
status: done
type: FEATURE
title: Editor panel — git-diff correctness, measured performance, and hunk-level stage/revert
description: >-
  Editor-panel evaluation turned remediation, covering 15 findings across
  `libs/frontend/editor`, the `libs/backend/vscode-core` git path, and the
  Electron watcher. Group A is correctness — open diff tabs never refresh after
  a commit, stage or discard; the Staged Changes and Changes rows emit the same
  HEAD-to-worktree comparison onto one colliding tab key; `git:showFile`
  swallows failures into empty content that then renders as "(new file)"; and
  deleted files cannot be diffed at all. Group B is measured performance
  (metrics M1-M4) — the Monaco diff editor is destroyed on every tab switch,
  `updateModels` disposes and recreates both models instead of setting values,
  `hasChangedChildren` is O(directories x changed files) on every git push, and
  the Electron watcher's exclusion list is narrower than the tree builder's.
  Group C is architecture consistency (raw `window` message listeners bypassing
  MESSAGE_HANDLERS, split-pane saves clobbering each other) and Group D is UX
  plus the headline feature, hunk-level stage and revert, which is hard-blocked
  behind the Group A fixes because it writes to the user's git index.
  Decomposed into 10 batches (0-9), all landed. Closed 2026-08-11 with 10 of 10
  DoD items met — the two that were unmet at the 2026-08-11 final verification
  (D2 never exercised end-to-end in Electron, and the NFR-1 cross-project test
  floor) were both discharged; see the close-out appended to
  final-verification.md.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-03T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
