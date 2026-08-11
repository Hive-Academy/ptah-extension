---
id: TASK_2026_224
status: done
type: BUGFIX
title: >-
  pre-commit lint-staged --no-stash sweeps unstaged edits into commits
description: >-
  Unstaged edits were landing in commits, and staged paths were left behind after
  explicit-pathspec commits, three times during TASK_2026_200. Two independent
  mechanisms, and the first hypothesis was wrong. Actual cause: `git commit --
  <paths>` means `--only`, committing the WORKING TREE content of those paths and
  bypassing the index, while leaving every other staged path staged. Proven by
  probe — a marker appended after staging still reached the commit. Secondary,
  real but not the cause: lint-staged 16 treats `--no-stash` as implying
  `--no-hide-partially-staged`, so tasks see the full working tree and the
  post-task `git add` stages whatever is on disk. Ruled out: formatter conflict
  (`nx format:check` and `prettier --check` agree; files were already clean) and
  CRLF churn (`.gitattributes` already normalises).
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
