---
title: Git Status
description: Real-time branch, commit, and dirty-state tracking without polling.
---

# Git Status

Ptah watches your `.git/` directory for changes using native filesystem events. The moment git updates a ref, HEAD, or the index, Ptah's UI reflects it — usually within a few milliseconds. There is no polling interval to configure, and no refresh button to click.

![Git status in status bar](/screenshots/git-status-bar.png)

## What's displayed

| Indicator         | Location                   | Meaning                                                                    |
| ----------------- | -------------------------- | -------------------------------------------------------------------------- |
| Branch name       | Status bar, bottom-left    | Current `HEAD` branch, or `(detached)` if HEAD points to a commit directly |
| Short commit hash | Status bar, next to branch | First 7 chars of the current `HEAD` commit                                 |
| Dirty dot         | Orange dot next to branch  | Index or working tree has uncommitted changes                              |
| Ahead/behind      | Tooltip on hover           | Commits ahead/behind the upstream branch, if one is configured             |

## How the watcher works

Ptah registers filesystem watchers on these paths when a workspace opens:

- `.git/HEAD` — detects branch switches and detached HEAD.
- `.git/refs/heads/` — detects branch creation, deletion, and updates.
- `.git/index` — detects staging changes and commits.
- `.git/MERGE_HEAD`, `.git/REBASE_HEAD` — detects in-progress merges/rebases.

When any of those change, Ptah re-reads the relevant git metadata and pushes an update to the UI. No `git` subprocess runs until you actually need one (e.g. viewing a diff or composing a commit).

:::note
Because Ptah uses native fs events, performance doesn't degrade on large repos. A monorepo with 100k+ files and a tiny repo with 10 files have the same zero-polling cost.
:::

## When git state changes outside Ptah

Run `git checkout other-branch` in your terminal and Ptah's UI updates instantly — the branch name in the status bar changes, the dirty state recomputes, and any agent spawned after the switch sees the new branch.

This works for all external git operations: CLI checkouts, rebases from another GUI, pushes/pulls, stashes — Ptah picks them up automatically.

## Troubleshooting

If the status bar doesn't match `git status` output:

1. Make sure the workspace root contains `.git/` directly. Submodules and worktrees have different layouts — see [Worktrees](/git/worktrees/).
2. Check **View → Toggle Developer Tools → Console** for filesystem watcher errors.
3. Restart Ptah. The watcher re-initializes on launch.
