---
title: Diffs
description: Review, stage, and reject file changes in the review view.
---

# Diffs

The **Changes** tab of the review view shows the diff of each changed file.

![Side-by-side diff view](/screenshots/diff-side-by-side.png)

## Diff layout

Use the **Diff layout** control to select a layout:

- **Split**: the old version on the left and the new version on the right.
- **Unified**: one pane with removed and added lines.

## Find a file

Type in **Filter changed files** to filter the file list. Mark a file as **Viewed** when you finish its review.

## Work hunk by hunk

Each hunk has a toolbar with "Hunk i of n" and these controls:

| Control                     | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| **Previous hunk** / **Next hunk** | Move to another hunk.                        |
| **Accept**                  | Stages the hunk.                                   |
| **Reject**                  | Reverts the hunk. PtahCode asks you to confirm.    |
| **Unstage**                 | Removes a staged hunk from the index.              |

For a branch comparison or a historical commit, Accept and Reject are not available.

## File and repository actions

- **Stage** and **Unstage** a whole file.
- **Discard changes** for one file, or **Discard all changes**.
- **Stage all files** and **Unstage all files**.

## Compare other refs

Use **Choose a comparison** to compare a **Review base** with a **Review head**, for example a branch with `main`.
