---
id: TASK_2026_385
status: done
type: REFACTORING
title: >-
  Retire the IDE shell: carve libs/frontend/git-ui, delete explorer, tabs, terminal panel, search, quick-open, vim
depends_on: []
created: '2026-09-06T00:00:00.000Z'
updated: '2026-09-06T00:00:00.000Z'
description: >-
  Subtractive half of the TASK_2026_384 decision. Carve the git surface (GitStatusService, GitBranchesService, WorktreeService, SourceControlService, DiffViewComponent, source-control panel, worktree section, diff tab types) out of libs/frontend/editor into a new libs/frontend/git-ui, then delete the IDE shell in phases that keep the build green: dead code first (vim, quick-open, search, layout RPCs, unrendered worktree panel), then the terminal panel and its node-pty host wiring, then EditorPanelComponent, CodeEditorComponent, file tree, sidebar, EditorService and helpers, EditorRpcHandlers, and every contract, manifest, capability, expected-absent list, e2e spec, showcase scene and doc that names them. On the host, drop the tree refresh job from GitWatcherService and widen its ignore list so build caches stop spamming it. About 22k lines removed.
executor: software-architect
estimate: XL
labels:
  - editor
  - git
  - performance
  - cleanup
relates_to:
  - TASK_2026_384
  - TASK_2026_386
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Carve the git lib, then delete the IDE shell phase by phase with the build green at each step. Scope, phases and acceptance criteria are in [./context.md](./context.md). The coupling map is in `../TASK_2026_384/research-report.md`.
