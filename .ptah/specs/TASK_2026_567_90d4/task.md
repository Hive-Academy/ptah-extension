---
id: TASK_2026_567_90d4
status: backlog
type: BUGFIX
title: Reduce extract-prompt over-suppression of durable content
depends_on: []
created: '2026-09-26T20:53:48.576Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The extract prompt returns zero drafts for durable content in task-heavy sessions (5 real losses
  on a 10-session sample). Tune its DO NOT EXTRACT section and re-measure on a larger sample.
labels:
  - memory-curator
  - P1
relates_to:
  - TASK_2026_391
parent: TASK_2026_635_5ea5
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`EXTRACT_SYSTEM_PROMPT` returned `{"memories": []}` for all 3 windows of session 1359b2b0,
although the content (a root cause, a reusable repair-script pattern, a verification workflow) is
durable by the task rubric. On the 10-session sample the single-use share rose from 98.0% to
99.2% (fail), with 5 real durable losses.

- Tune the DO NOT EXTRACT section so that real lessons inside task-heavy sessions survive.
- Re-measure on a larger sample, with search-based subject reuse on, against a copy of the DB.

## Current state (2026-11-07)

- Not tuned. The prompt is
  `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:1`, with the
  DO NOT EXTRACT section at `:54`.
- The last prompt changes are `87fd6c9fd` (the rewrite that caused this) and `43d46ebf1` (subject
  reuse rules). Neither re-measures the over-suppression.
- Evidence: `test-report.md` (M4-8) of TASK_2026_563, now in git history only:
  `git show ff531866f:.ptah/specs/TASK_2026_563_2939/test-report.md`.

Full context, plan and discussion live in [./context.md](./context.md).
