---
id: TASK_2026_386
status: backlog
type: FEATURE
title: >-
  Git-first review surface: change set per turn, CodeMirror diff, worktree per task, PR, open in external editor
depends_on:
  - TASK_2026_385
created: '2026-09-06T00:00:00.000Z'
updated: '2026-09-06T00:00:00.000Z'
description: >-
  Additive half of the TASK_2026_384 decision. Build the review loop that Claude Code desktop, Superset and T3 Code ship. A change-set view per agent turn and per task branch, backed by a new ref-versus-ref diff RPC and the per-message touched-file set the backend already computes. Replace Monaco with CodeMirror 6 plus @codemirror/merge for the diff view and a single-file spot editor. Bind a task to a worktree and expose merge and pull-request actions. Add an IEditorLauncher port with adapters that open a file or the workspace in VS Code, Cursor, Antigravity or Zed, binaries first with deep-link fallback. Merge conflicts show a blocking dock state with per-file open-in, no in-app resolver. The terminal is dropped, not rebuilt.
executor: software-architect
estimate: XL
labels:
  - git
  - editor
  - feature
  - ux
relates_to:
  - TASK_2026_384
  - TASK_2026_385
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Build the change-set review, the CodeMirror diff and spot editor, the task to worktree binding with merge and PR, and the external-editor launcher. Scope and acceptance criteria are in [./context.md](./context.md).
