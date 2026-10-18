---
id: TASK_2026_692_f748
status: in_review
type: FEATURE
title: Idle compaction for Agent SDK sessions
description: >-
  Multi-session, RxJS-based idle compaction handler in agent-sdk that compacts large idle
  sessions before the 1-hour prompt cache expires, to save usage.
depends_on: []
created: 2026-10-17T19:00:00.000Z
updated: 2026-10-17T19:00:00.000Z
---

## Description

The Claude Code CLI 2.1.299+ compacts large conversations while idle, just before the 1-hour
prompt cache expires. The bundled CLI gates this to interactive and allowlisted entrypoints, so
`sdk-ts` sessions never get it. Build an equivalent, multi-session aware, RxJS-based handler in
`libs/backend/agent-sdk`.
