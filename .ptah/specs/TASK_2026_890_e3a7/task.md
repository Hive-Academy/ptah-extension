---
id: TASK_2026_890_e3a7
status: in_review
type: DOCUMENTATION
title: Fill the feature gaps between the Electron app and the docs app
description: >-
  Inventory every user-facing feature of the PtahCode Electron app, compare it with
  apps/ptah-docs, write evidence-backed pages for the missing features the user selects,
  and add starlight-links-validator so CI fails on broken internal links.
depends_on: [TASK_2026_889_d57a]
created: 2026-11-07T14:10:00.000Z
updated: 2026-11-07T14:10:00.000Z
---

## Description

Follow-up of TASK_2026_889_d57a (PR #967, merged). Phase 1: gap inventory on a CLI lane, shown
to the user. Phase 2: the user picks the missing features; file-disjoint CLI lanes write the
pages (max 3 at a time). Phase 3: starlight-links-validator in apps/ptah-docs, fix broken links.
Independent different-family review of every new claim, one fix round, one re-review.

Worktree: `.claude-worktrees/docs-gap-fill`, branch `docs/docs-gap-fill`, base `origin/main`
(bce361218).
