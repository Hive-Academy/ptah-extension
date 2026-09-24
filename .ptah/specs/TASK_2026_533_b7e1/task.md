---
status: in_progress
type: bugfix
title: Session stats panel chips disagree with the per-model table
description: >-
  In one session stats panel the COST chip shows "cost unavailable" while the
  per-model table sums to $38.18, the TOKENS chip shows 14.8M while the table
  shows about 412k, and the AGENTS chip shows 9 while the footer strip shows 5.
labels:
  - pricing
  - chat-streaming
relatesTo:
  - TASK_2026_474_5c9f
  - TASK_2026_475_e4b7
  - TASK_2026_418_a91c
  - TASK_2026_513_a7c2
---

# Session stats panel chips disagree with the per-model table

The header chips and the per-model breakdown in the same panel read different
sources. Root cause, evidence and reproduction are in `root-cause-report.md`.

## Acceptance criteria

1. The COST chip never shows "cost unavailable" when the per-model table has a real cost.
2. The COST chip never shows `$0.00` for an unknown cost.
3. The TOKENS chip and the table count the same token classes, or the panel labels the difference.
4. The AGENTS chip and the footer strip count the same agent identities.
5. A failing spec reproduces each defect before the fix.
6. `test`, `typecheck` and `lint` pass for every touched project.
