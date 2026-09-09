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
| Review a PR while an agent refactors   | Stash, checkout, un-stash | One branch per worktree              |
| Run agents on two features in parallel | Serial execution only     | Two worktrees, two concurrent agents |
| Hotfix on `main` during feature work   | Stash or commit WIP first | Separate hotfix worktree             |

## Creating a worktree

From the UI: open the **Git** dock, expand **Worktrees**, then choose **Add worktree**. Enter an existing branch and optional target path, or select **Create new branch**. Creation refreshes the list but does not switch your current workspace; click the new row when you want to open it.

From an agent, using the MCP tool:

```json
{
  "tool": "ptah_git_worktree_add",
  "arguments": {
    "branch": "feature/x",
    "createBranch": true
  }
}
```

Omit `path` to use Ptah's default: `<workspace>/.claude-worktrees/<safe-branch-name>`. For example, `feature/x` becomes a bounded name such as `.claude-worktrees/feature-x-<hash>`; the hash keeps similar and long branch names distinct. Relative custom paths must remain inside the workspace; use an absolute path when another location or volume is required.

Equivalent shell:

```bash
git worktree add -b feature/x .claude-worktrees/feature-x
```

## Listing worktrees

The **Git Worktrees** panel shows every worktree linked to the current repo, with its path, branch, and HEAD commit. Creation events only refresh this list. Clicking a worktree row explicitly registers it in the current Ptah window and switches to it. Background agent worktree creation never changes the current workspace or session.

Via MCP tool:

```json
{
  "tool": "ptah_git_worktree_list"
}
```

## Removing a worktree

From the UI: choose **Remove** on a non-main worktree. Ptah prompts before removing and refuses to remove a worktree with uncommitted changes unless you explicitly override. If you had explicitly opened that worktree in the current window, successful removal unregisters it; unopened worktrees do not affect the workspace list.

Via MCP tool:

```json
{
  "tool": "ptah_git_worktree_remove",
  "arguments": {
    "path": "/absolute/path/to/my-project-feature-x",
    "force": false
  }
}
```

:::caution
`force: true` will discard uncommitted changes in the worktree. Use it only when you're sure the work is no longer needed.
:::

## Layout convention

The MCP default keeps worktrees inside the repository:

```
~/code/my-project/
├── .claude-worktrees/
│   ├── feature-x/       # Worktree: feature/x
│   └── hotfix-urgent/   # Worktree: hotfix/urgent
└── ...                  # Main worktree
```

Run agents and development commands with `cwd` set to the selected worktree path. In this nested layout, Node resolves dependencies through ancestor directories, so a worktree normally reuses the main checkout's `node_modules`; Ptah does not create a dependency symlink. Install dependencies inside the worktree only when it has a different dependency graph or no usable ancestor install.

Ptah never auto-links `.env` files, secrets, caches, or build output into a worktree. Copy or configure only the inputs that task needs.

Explicit absolute paths remain supported. Ptah detects linked worktrees and groups them in the panel regardless of which one you opened first.
