---
id: TASK_LANE_BUDGET_WRAP_UP
status: done
type: BUGFIX
title: >-
  Drop the lane tool-call budget and report lane stops honestly
depends_on: []
created: '2026-10-29T00:00:00.000Z'
updated: "2026-10-30T01:09:07.477Z"
description: >-
  Background CLI lanes hit a fixed 40/60 tool-call budget that cut work before the deliverable
  existed, the completion envelope could not tell a budget stop from a crash, and the resume
  gate discarded almost every stopped lane's context. Removes the count budget (lanes keep
  vendor context handling; only the repeated-call loop stop remains), adds stop reason and
  tool-call count to the completion signal, judges host-stopped lanes by their deliverables,
  raises the resume-gate context limit to 150k, and aligns the lane skill text.
labels:
  - cli-agent-runtime
  - lanes
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

See decisions.md and implementation-plan.md.
