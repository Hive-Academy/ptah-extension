---
title: Git Status
description: Live branch, upstream, stash, and changed-file status in the Git dock.
---

# Git Status

PtahCode watches your `.git/` directory for changes using native filesystem events. When git updates a ref, `HEAD`, or the index, the Git dock shows the change.

![Git status in the Git dock header](/screenshots/git-dock-header.png)

## What's displayed

The Git dock is the toggleable panel on the right edge of the window — click
the vertical **Git** tab to open it. Its header shows the live status:

| Indicator     | Location                        | Meaning                                                                    |
| ------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Branch name   | Git dock header, left           | Current `HEAD` branch, or `(detached)` if HEAD points to a commit directly |
| Ahead/behind  | Git dock header, next to branch | Commits ahead/behind the upstream branch, inline once one is configured    |
| Stash count   | Git dock header, next to branch | Number of stash entries, when there are any                                |
| Changed files | Source control list, below      | Every modified/added/deleted file, with its own status indicator           |

## How the watcher works

PtahCode registers filesystem watchers on these paths when a workspace opens:

- `.git/HEAD` — detects branch switches and detached HEAD.
- `.git/refs/heads/` — detects branch creation, deletion, and updates.
- `.git/index` — detects staging changes and commits.
- `.git/MERGE_HEAD`, `.git/REBASE_HEAD` — detects in-progress merges/rebases.

When any of those change, PtahCode re-reads the relevant git metadata and pushes an update to the UI.

## When git state changes outside PtahCode

Run `git checkout other-branch` in your terminal and the Git dock updates. The branch name changes and the changed-file list is read again.

This works for git operations from other tools too, such as rebases, pushes, pulls, and stashes.

## Troubleshooting

If the Git dock does not match the `git status` output:

1. Make sure the workspace root contains `.git/` directly. Submodules and worktrees have different layouts — see [Worktrees](/git/worktrees/).
2. Check **View → Toggle Developer Tools → Console** for filesystem watcher errors.
3. Restart PtahCode. The watcher starts again on launch.
