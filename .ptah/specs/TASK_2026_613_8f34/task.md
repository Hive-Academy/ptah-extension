---
id: TASK_2026_613_8f34
status: backlog
type: FEATURE
title: Ship the token-saving orchestration rules to all users with settings controls
description: >-
  Move the approved token rules (relay at 150k context or 60 calls per agent run, batches of
  about 6 files, orchestrator commits a clean batch, Sonnet for mechanical roles, short check
  output, maxTurns) from the local setup into the shipped ptah-core plugin assets and the
  generated agents, and let users view and change them in Settings.
depends_on: [TASK_2026_597_ab22, TASK_2026_609_c495]
created: 2026-10-04T17:00:00.000Z
updated: 2026-10-04T17:00:00.000Z
---

## Description

TASK_2026_597 measured the cost drivers of orchestration runs (tool M, 2026-10-04: Claude 398.8M
input tokens in one day, 83% from subagents; single developer runs of 64-103 requests at contexts up
to 310k). The user approved five rules for the rest of TASK_2026_597. This task ships them to every
Ptah user and exposes them in Settings. See context.md for the scope and the evidence.
