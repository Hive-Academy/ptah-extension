---
id: TASK_2026_384
status: done
type: RESEARCH
title: >-
  Impact study: retire the in-app editor surface and go git-first
depends_on: []
created: '2026-09-06T00:00:00.000Z'
updated: '2026-09-06T00:00:00.000Z'
description: >-
  20-agent research workflow that mapped how deep libs/frontend/editor (explorer, Monaco tabs, xterm terminal, search, quick-open, vim, branch picker, source control, worktrees, diff view) is wired into the webview, the Electron host, the VS Code host, shared contracts, tests and docs. Verdict is a reshape, not a demolition: retire the IDE shell, carve the git surface into its own lib, keep a spot editor and a session-bound terminal, and build the change-set review the market ships. Also audited every timer and watcher that feeds the frontend. Produces TASK_2026_385 (subtractive) and TASK_2026_386 (additive).
executor: researcher-expert
estimate: M
labels:
  - research
  - editor
  - git
  - performance
relates_to:
  - TASK_2026_385
  - TASK_2026_386
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Research complete. Coupling map, purge order, timer audit and open decisions are in [./research-report.md](./research-report.md) and [./context.md](./context.md).
