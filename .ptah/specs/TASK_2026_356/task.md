---
id: TASK_2026_356
status: backlog
type: BUGFIX
title: prefilter stage spends tokens but is missing from TOKEN_SPENDING_STAGES and STAGE_COST_RANK
depends_on: []
created: '2026-08-29T01:42:18.449Z'
updated: '2026-08-29T01:42:18.449Z'
description: "Found while implementing TASK_2026_352: the skill-synthesis prefilter stage records real spend (tmp/logs/log.log:1009, $0.077 — the largest single line of the boot's ~$0.19) but is not listed in TOKEN_SPENDING_STAGES, so the drain dispatches prefilter rows past maxTokensPerDay, and STAGE_COST_RANK ranks them cheapest so an over-budget host actively prefers them. Same defect class as the trigger-eval omission TASK_2026_253 fixed. Add prefilter to both tables, pin with a spec that asserts every stage that calls the LLM appears in TOKEN_SPENDING_STAGES."
executor: backend-developer
estimate: XS
labels:
  - skill-synthesis
  - cost
  - log-audit-2026-08-28
relates_to:
  - TASK_2026_352
  - TASK_2026_253
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Found while implementing TASK_2026_352: the skill-synthesis prefilter stage records real spend (tmp/logs/log.log:1009, $0.077 — the largest single line of the boot's ~$0.19) but is not listed in TOKEN_SPENDING_STAGES, so the drain dispatches prefilter rows past maxTokensPerDay, and STAGE_COST_RANK ranks them cheapest so an over-budget host actively prefers them. Same defect class as the trigger-eval omission TASK_2026_253 fixed. Add prefilter to both tables, pin with a spec that asserts every stage that calls the LLM appears in TOKEN_SPENDING_STAGES.

Full context, plan and discussion live in [./context.md](./context.md).
