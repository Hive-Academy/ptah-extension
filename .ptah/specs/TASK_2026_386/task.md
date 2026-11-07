---
id: TASK_2026_386
status: backlog
type: FEATURE
title: >-
  Finish the git review surface: create-PR and merge actions for a task worktree
depends_on: []
created: '2026-09-06T00:00:00.000Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Most of the git-first review surface is on main (git dock, per-turn change sets, ref-vs-ref
  review, CodeMirror spot editor, editor launcher, conflict banner, task worktree view). What
  is left: create-PR and merge actions for a task branch. Confirm the rest against acceptance.
executor: software-architect
estimate: XL
labels:
  - git
  - editor
  - feature
  - ux
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Build the change-set review, the CodeMirror diff and spot editor, the task to worktree binding with merge and PR, and the external-editor launcher. Scope and acceptance criteria are in [./context.md](./context.md).

## Description

Additive half of the TASK_2026_384 decision, for the Electron app. Remaining work:

- Add create-PR and merge actions for a task branch. Today `TaskPrPanelComponent`
  (`libs/frontend/git-ui/src/lib/task/task-pr-panel.component.ts`) shows PR status from
  `git:prStatus` only, and no `git:` RPC creates a PR or merges a branch.
- Walk the acceptance criteria in `context.md` against the shipped pieces below and record
  any gap as a follow-up.

## Current state (2026-11-07)

- Done: git dock in the shell (`239f8013e`) hosting `libs/frontend/git-ui` (review canvas,
  history, stash, branch picker, source control, conflict banner, task worktree view).
- Done: ref-vs-ref review (`git:reviewChanges` with `base`/`head`,
  `libs/shared/src/lib/types/rpc/rpc-git.types.ts:49-52`) and per-turn change sets
  (`git:turnChangeSets`).
- Done: CodeMirror 6 spot editor (`libs/frontend/git-ui/src/lib/spot-editor/`). The diff view uses
  `@pierre/diffs` (`libs/frontend/git-ui/src/lib/renderer/`), not `@codemirror/merge`; Monaco is
  no longer a dependency.
- Done: `IEditorLauncher` port (`libs/backend/platform-core/src/interfaces/editor-launcher.interface.ts:55`)
  with an Electron adapter (`libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts`)
  and `editor:openFile` / `editor:openWorkspace` / `editor:openMerge` / `editor:detectTargets`.
- Not done: create-PR and merge actions.
