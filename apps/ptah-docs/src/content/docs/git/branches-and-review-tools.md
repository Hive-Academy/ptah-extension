---
title: Branches and Review Tools
description: Switch and create branches, see the pull request of a branch, handle merge conflicts, open files in an external editor, edit a file, and send draft comments to the agent.
---

# Branches and Review Tools

This page describes the branch picker in the Git dock and the tools of the review view. For the Git dock, diffs, commits, and worktrees, see [Git & Version Control](/git/).

## Branch picker

The branch button in the Git dock header shows the current branch. Click it to open the branch picker.

The picker has these parts:

- **Search branches…** — type to filter the branch names.
- **Recent** — the branches that you used recently.
- **Local** — the local branches, with the commits ahead (↑) and behind (↓) of each one.
- **Remote** — the remote branches.
- **New branch** — the name field and **Create** at the bottom.

Click **Branch details** (the info button next to the branch button) to see more about the current branch.

### Switch to a branch

1. Click the branch button in the Git dock header.
2. Optional: type part of the name in **Search branches…**.
3. Click the branch.

You cannot click the current local branch. When you click a remote branch, PtahCode switches to it as a tracked branch.

### Create a branch

1. Click the branch button in the Git dock header.
2. Type the name in **New branch**.
3. Click **Create**, or push Enter.

PtahCode creates the branch and switches to it. When git refuses, the picker shows **Could not create branch** and the reason.

### When local changes block a switch

When your uncommitted changes would be overwritten, the picker shows **Local changes would be overwritten by switching to** and the branch name. It also lists the **Files that would be overwritten**. Select one of these actions:

| Action                  | What it does                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Stash & switch**  | Stashes your changes, then switches. The picker shows **Changes stashed as** and the stash name. Find the changes in **Stashes**. |
| **Discard & switch…** | Asks **Discard all uncommitted changes? This cannot be undone.** Click **Discard changes** to discard and switch, or **Back** to stop. |
| **Cancel**              | Stays on the current branch                                                      |

## Pull request panel

The **Task** tab of the review view has a **Pull request** panel for the current branch. When a pull request exists, the panel shows:

- The pull request number and title, and a state badge (`draft`, `open`, `merged`, or `closed`).
- The review decision, for example **Review: Approved**, **Changes requested**, or **Review required**.
- The checks: the number **passing**, **failing**, and **pending**, or **No checks**.
- **Open PR**, which opens the pull request in your browser.

The panel reads the pull request again at most every 60 seconds while the **Task** tab shows. The panel uses the GitHub CLI. When it cannot show a pull request, it shows one of these lines:

| Line                                                    | Cause                                              |
| ------------------------------------------------------- | -------------------------------------------------- |
| **GitHub CLI not available — PR status hidden.**        | The GitHub CLI is not installed                    |
| **GitHub CLI is not signed in — PR status hidden.**     | Sign in to the GitHub CLI                          |
| **No GitHub remote — PR status hidden.**                | The repository has no GitHub remote                |
| **No pull request found for this branch.**              | The branch has no pull request                     |
| **GitHub did not answer in time — PR status hidden.**   | GitHub did not reply in time                       |
| **PR status could not be read.**                        | Another error occurred                             |

For the worktrees in the **Task** tab, see [Worktrees](/git/worktrees/).

## Conflict banner

When a merge, rebase, or cherry-pick is in progress, a banner shows above the review tabs. The banner title names the operation, for example **Merge in progress**, and the number of conflicted files. The banner lists the **Conflicted files**.

Each file has a button that opens it:

- **Open in editor** — for a content conflict. It opens the file in your external editor.
- **Open folder** — for a delete/modify, symlink, or submodule conflict. These conflicts have no three-way merge, so PtahCode opens the folder of the file.

When PtahCode finds no external editor, the banner shows **No external editor was found to open these files.**

### Resolve a conflict

1. Resolve each conflict:
   - Open each file and fix it yourself, or
   - Click **Ask agent to resolve**. PtahCode sends a prompt with the operation, the repository, and the conflicted files to the active chat session.
2. When no file has a conflict, click **Continue**.

To stop the operation, click **Abort**, and then confirm in the dialog.

## Open in an external editor

The **Open in** button opens the workspace or a file in an external editor. It shows in the Git dock header, in the **Task** tab, in each file header of the **Changes** tab, and in the spot editor.

- Click the main part of the button to open in the editor that you chose last, for example **Open in** and the editor name.
- Click **Choose where to open** (the arrow) to select another editor from the list.

PtahCode remembers the last editor that you chose. The list shows only the editors that PtahCode finds on your computer. When it finds none, the button shows **No supported editor found on this machine**. A terminal can open a folder but not a file, so the list for a file does not show it.

## Spot editor

The spot editor lets you edit one file in the review view, without an IDE.

1. In the **Changes** tab, click **Edit** in the header of the file.
2. Make your changes. A file with changes shows **Unsaved**.
3. Click **Save**, or push Ctrl+S (Cmd+S on macOS).
4. Click **Back to review** to go back to the diffs.

When the file opens read-only, click **Edit** in the spot editor header to edit it. Some files always stay read-only, for example a file of a read-only worktree.

For a Markdown file, use **Preview** and **Source** to change the view. Preview is disabled for files over 512 KB.

### Unsaved changes and disk changes

- When you leave a file that has unsaved changes, PtahCode asks **Discard unsaved changes?**. Click **Keep editing** to stay.
- When the file changes on disk and you have no edits, the file reloads. When you have edits, click **Reload** to load the version on disk.
- When the file changed on disk before you save, PtahCode asks **This file changed on disk since you opened it.** Click **Overwrite** to save your version, or **Keep editing**.

## Draft comments

You can write draft comments on the lines of a diff and send them to the agent in one message.

1. In the **Changes** tab, click **Comment** in the header of a file.
2. Select the **Side** (**New** or **Old**).
3. Set **From line** and **To line**.
4. Type the **Comment**.
5. Click **Add draft**.

When you have drafts, the **Draft comments** bar shows at the bottom of the review canvas, for example **2 draft comments**.

- Click the count to see the list of drafts. Click ✕ to remove a draft.
- Click **Send to agent** to send all drafts. When the send fails, PtahCode keeps the drafts and shows the error.

## Related

- [Git status](/git/git-status/)
- [Diffs](/git/diffs/)
- [Commits](/git/commits/)
- [Worktrees](/git/worktrees/)
