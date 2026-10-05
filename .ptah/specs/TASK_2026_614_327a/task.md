---
id: TASK_2026_614_327a
status: in_progress
type: BUGFIX
title: Finish the TASK_2026_597 token-burn work and close its review follow-ups
description: >-
  Continuation of TASK_2026_597_ab22 after PR #647 (S4 Wave D). Runs the stages that are still
  deferred (S3 rest, S1b, S2), the QA session with live proof, and every named later task from the
  PR 1, PR 2, PR 3, S4-a and S4-b reviews, under the decision 8 token rules (R1-R5).
depends_on: [TASK_2026_597_ab22]
created: 2026-10-05T12:00:00.000Z
updated: 2026-10-05T12:00:00.000Z
---

## Description

TASK_2026_597_ab22 shipped in five PRs (#634, #637, #639, #642, #647). This task holds all the work
that is left: the deferred build stages, the QA session, and the review follow-ups. The full list,
the order and the rules are in `context.md`. Batch bodies for the deferred stages stay in
`../TASK_2026_597_ab22/batches.md`; read only the sections that `context.md` names.
