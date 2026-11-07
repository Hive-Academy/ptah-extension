---
id: TASK_2026_566_9a50
status: backlog
type: FEATURE
title: Decide tier-2 merge candidates when tier 1 is empty (D4 option A vs B)
depends_on: []
created: '2026-09-26T20:53:48.208Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Shipped D4=B fails the M3 8(b) merge gate (8 to 7 of 23); option A gives 20 of 23 for up to one
  extra resolve call per pass. Needs an owner decision and a production cost check.
labels:
  - memory-curator
  - P2
relates_to:
  - TASK_2026_577_cbfb
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Decision D4 of TASK_2026_563 shipped option B: the tier-2 `searchRich` lookup runs only when
tier 1 (exact subject matches) is not empty. On the fixed 23-draft replay, B merges 7 of 23
(before: 8), and option A merges 20 of 23.

- The owner chooses A or B.
- Before a switch to A, measure the real per-pass increase in resolve calls and check merge
  precision on the A merges.
- Option A removes the `tier1-empty` early return in `MergeCandidateCollector.collect`.

## Current state (2026-11-07)

- No decision yet. Option B is still in place:
  `libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector.ts:187` returns tier 1
  only when tier 1 is empty.
- Evidence for the numbers: `test-report.md` (M3-8(b)) of TASK_2026_563, now in git history only:
  `git show ff531866f:.ptah/specs/TASK_2026_563_2939/test-report.md`.

Full context, plan and discussion live in [./context.md](./context.md).
