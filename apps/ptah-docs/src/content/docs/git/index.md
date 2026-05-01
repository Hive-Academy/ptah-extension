---
title: Git & Version Control
description: Ptah's real-time git integration — branch, diffs, worktrees, and agent-assisted commits.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Git & Version Control

Ptah treats git as a first-class part of your workspace. Every open workspace that contains a `.git/` directory gets:

- A **real-time git watcher** — no polling, no manual refresh.
- Live branch name, commit hash, and dirty-state indicators in the UI.
- Agent-aware context that adapts to the current branch.
- Tooling for worktrees, diffs, and conventional commits.

The integration is read-first. Agents can propose commits, branch switches, and worktree operations, but destructive actions always require your confirmation.

:::caution
Never run destructive git operations without confirmation. Ptah will prompt before any `reset --hard`, force push, branch deletion, or history-rewriting command. Skipping the prompt is never the default, even in automated workflows.
:::

## In this section

<CardGrid>
  <Card title="Git status" icon="information">
    Real-time `.git` watcher surfacing branch, commit, and dirty state.
  </Card>
  <Card title="Worktrees" icon="random">
    Parallel development with `git worktree` — ideal for agent-driven branches.
  </Card>
  <Card title="Diffs" icon="document">
    Side-by-side file change display with syntax highlighting.
  </Card>
  <Card title="Commits" icon="pen">
    Agent-assisted conventional commits with commitlint enforcement.
  </Card>
  <Card title="Branch awareness" icon="setting">
    How agent context adapts when you switch branches.
  </Card>
</CardGrid>

## Quick reference

| Feature           | Where to find it                                         |
| ----------------- | -------------------------------------------------------- |
| Current branch    | Status bar, bottom-left                                  |
| Short commit hash | Status bar, next to branch                               |
| Dirty indicator   | Orange dot next to branch when uncommitted changes exist |
| Diff viewer       | Click any modified file in the file tree                 |
| Worktree panel    | **View → Git Worktrees**                                 |
| Commit composer   | Chat command `/commit` or **Git → Commit changes**       |
