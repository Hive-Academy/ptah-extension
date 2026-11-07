---
id: TASK_2026_520_9c2e
status: backlog
type: BUGFIX
title: >-
  Stop workstation paths reaching .ptah/specs, and add a guard that keeps them out
description: >-
  822 tracked files under .ptah/specs contain an absolute workstation path or the account
  name, and nothing stops new ones. Clean them and add a commit-time guard.
updated: 2026-11-07T00:00:00.000Z
---

# Stop workstation paths reaching .ptah/specs, and add a guard that keeps them out

## Description

CodeRabbit flagged absolute workstation paths in task files on pull request 546 as an information
disclosure (CWE-200). Only the eight folders of that pull request were cleaned. Agent lanes keep
adding new ones, because they write the absolute paths they were given.

1. Add a commit-time guard (lint-staged in `.lintstagedrc.mjs`, or a lint rule) that rejects an
   absolute workstation path or the account name under `.ptah/specs/`. A CI check is optional on top.
2. Clean the existing files. Replace each path with a repo-relative path or a placeholder. Change
   only the path, not the prose or the frontmatter.

The acceptance criteria in `context.md` still apply (case-insensitive match, the `file:///` link
form, the scoped `TASK_2026_497_debb` fixture exemption with a negative test), except that the file
count is now 822, not 325.

## Current state (2026-11-07)

- Not done. On this branch, `git grep -l -i -E` with the `context.md` scan pattern over
  `.ptah/specs` finds 822 tracked files (325 on 2026-09-21).
- No guard: `.lintstagedrc.mjs` runs only `nx format:write` and ESLint. No path check is in `.husky/`
  or `.github/workflows/ci.yml`.
- Out of scope but related: 124 tracked files under `apps`, `libs` and `scripts` match the same
  pattern (for example `scripts/drain-observation-queue.ts:480`).
