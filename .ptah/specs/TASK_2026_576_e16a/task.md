---
id: TASK_2026_576_e16a
status: in_progress
type: FEATURE
title: Overhaul the git review experience
description: >-
  Fix the ranked git reliability root causes and build a new review UI (change-set cards, review canvas with hunk accept/reject, commit composer, task/worktree view, conflict banner, history timeline). Replace Monaco in the review surface. VS Code host uses native diff views.
depends_on: []
created: 2026-09-28T23:08:16.000Z
updated: 2026-09-28T23:08:16.000Z
---

## Description

Two tracks. Track 1: git reliability fixes from `research_notes/In app editor alternatives/git-backend-root-causes.md` (root causes 1-8 first, then 9-14). Track 2: a new, polished git review UI for Electron, plus a native-view review path for the VS Code host. Keep system git. No WebContainers, no in-app IDE, no in-app 3-way merge editor.
