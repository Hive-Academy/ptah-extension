---
id: TASK_2026_873_f748
status: in_progress
type: FEATURE
title: Build ptah-review automated PR review pipeline
description: >-
  Cron-driven, multi-vendor lane pipeline that reviews each new PR head and auto-posts verified findings to GitHub, like CodeRabbit.
depends_on: []
created: 2026-11-03T17:27:42.687Z
updated: 2026-11-03T17:27:42.687Z
---

## Description

Build ptah-review: an automated pull-request review pipeline in host-neutral libraries. A cron
handler polls GitHub for new or updated PR heads, a staged pipeline of CLI agent lanes reviews the
diff (walkthrough, lens reviewers, verifier, dedup), and verified findings are auto-posted to the PR
as a bot identity. Runs first in Electron on a dedicated Ubuntu reviewer machine; a headless VPS
daemon follows. Recall is evaluated against 108 CodeRabbit findings on 15 past PRs.
