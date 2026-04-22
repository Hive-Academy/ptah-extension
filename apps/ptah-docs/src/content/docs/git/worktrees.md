---
title: Worktrees
description: Create, list, and remove git worktrees for parallel development.
---

# Worktrees

A **git worktree** lets you check out multiple branches of the same repository into separate folders simultaneously. Ptah has first-class support for worktrees because they pair naturally with agent-driven development: you can have an agent working on a feature branch in one worktree while you review a PR in another, without stashing or switching.

## Why worktrees matter for agent workflows

When an agent runs a long task — say, a multi-file refactor or a test suite run — you can't safely switch branches on the same working tree. Stashing is fragile, and cancelling the agent loses work.

Worktrees sidestep this entirely. Each agent can be pinned to its own worktree, and you keep your main working tree free for reading, reviewing, or starting new tasks.

| Scenario                               | Without worktrees         | With worktrees                       |
| -------------------------------------- | ------------------------- | ------------------------------------ |
| Review a PR while an agent refactors   | Stash, checkout, un-stash | `git worktree add ../review pr-123`  |
| Run agents on two features in parallel | Serial execution only     | Two worktrees, two concurrent agents |
| Hotfix on `main` during feature work   | Stash or commit WIP first | Add a worktree on `main`, fix, push  |

## Creating a worktree

From the UI: **View → Git Worktrees → Add worktree**. Pick a target folder and either an existing branch or a new branch name.

From an agent, using the MCP tool:

```json
{
  "tool": "ptah_git_worktree_add",
  "arguments": {
    "path": "../my-project-feature-x",
    "branch": "feature/x",
    "createBranch": true
  }
}
```

Equivalent shell:

```bash
git worktree add -b feature/x ../my-project-feature-x
```

## Listing worktrees

The **Git Worktrees** panel shows every worktree linked to the current repo, with its path, branch, and HEAD commit. Clicking a worktree opens it as a workspace in a new Ptah window.

Via MCP tool:

```json
{
  "tool": "ptah_git_worktree_list"
}
```

## Removing a worktree

From the UI: right-click a worktree in the panel → **Remove**. Ptah prompts before removing and refuses to remove a worktree with uncommitted changes unless you explicitly override.

Via MCP tool:

```json
{
  "tool": "ptah_git_worktree_remove",
  "arguments": {
    "path": "../my-project-feature-x",
    "force": false
  }
}
```

:::caution
`force: true` will discard uncommitted changes in the worktree. Use it only when you're sure the work is no longer needed.
:::

## Layout convention

A worktree-friendly folder layout that plays nicely with Ptah:

```
~/code/
├── my-project/              # Main worktree (clone root)
├── my-project-feature-x/    # Worktree: feature/x
├── my-project-review-123/   # Worktree: pr-123
└── my-project-hotfix/       # Worktree: hotfix/urgent
```

Ptah detects that all four folders share the same git repo and groups them in the worktree panel, regardless of which one you opened first.
