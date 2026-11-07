---
id: TASK_2026_661_6b5f
status: backlog
type: RESEARCH
title: "Skill value metric (Gate 0): compute Use and Lift for authored skills"
depends_on: []
created: "2026-10-14T01:25:24.496Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  When lane outcomes hold 30 days of records with skillsLoaded, compute Use(S) and Lift(S,K) per
  the TASK_2026_659 evaluation report Step 2, and decide go / no-go for a skill-learning rethink.
estimate: S
labels:
  - skills
  - evaluation
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Time-gated research. When the lane-outcome store holds 30 days of records with `skillsLoaded`,
compute Use(S) and Lift(S,K) for each authored skill as defined in "Step 2: the value metric" of
the TASK_2026_659_cec4 `evaluation-report.md` (retired folder; read it with
`git show ff531866f:.ptah/specs/TASK_2026_659_cec4/evaluation-report.md`). Then decide go / no-go
for any skill-learning rethink. No code change.

## Current state (2026-11-07)

- The `skillsLoaded` column exists since `8fc9278e9` (2026-10-15;
  `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:75`). Counted from that commit, the
  30-day window ends on 2026-11-14 at the earliest. The real start is the first local build that
  recorded rows, so check the oldest row date first.
- `skillsLoaded` is filled only for subagent rows, at read time, from skill invocation events
  (`libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.ts:171`,
  `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts:73`). CLI-lane
  and nested-subagent rows store `null`
  (`libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:130,177`). The metric
  therefore covers subagent runs only, unless TASK_2026_720_6f98 adds CLI-lane attribution.
- The skill-synthesis pipeline was purged (PR #788). The metric is about authored skills only.
- TASK_2026_646_136a and TASK_2026_659_cec4 folders were retired from `.ptah/specs`.

Full context, plan and discussion live in [./context.md](./context.md).
