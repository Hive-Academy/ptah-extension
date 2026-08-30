---
id: TASK_2026_357
status: done
type: FEATURE
title: >-
  Checkpointed fleet workflow: artifact-based resume for multi-agent
  orchestration
depends_on: []
created: '2026-08-29T04:30:45.079Z'
updated: '2026-08-29T04:42:25.468Z'
description: >-
  The log-audit fleet showed that Workflow resume replays the longest unchanged
  PREFIX of agent() calls; parallel() starts calls in non-deterministic order,
  so a resume after a host crash re-ran finished batch-1 implementers and never
  reached batch 2 (three generations re-spawned, statuses flipped back to
  in_progress). Fix on our side with artifact checkpoints that make any run
  idempotent regardless of journal state. Deliverables: (1)
  .claude/workflows/fleet-fix.js — a parameterized workflow script (args = task
  ids) whose stages check disk artifacts before spawning: context.md exists ->
  skip plan; task.md status in_review/done -> skip implement;
  .ptah/specs/TASK_ID/judge-round-N.json exists -> skip that judge round; every
  stage writes its result artifact before returning; stable labels on every
  agent() call. (2) A skill (fleet-orchestration) encoding the operating rules
  learned: disjoint-lib batching, commit only when no implementer is editing
  (lint-staged stash/restore overwrites concurrent edits), commitlint
  constraints (subject <=72, body lines <=100, scope enum), judge-loop protocol
  and verdict artifact schema. (3) A note in the skill on the harness-side
  limitation (prefix cache) so nobody relies on journal resume again.
  Implementation lanes for this task are codex and ollama-cloud CLI agents by
  explicit request.
executor: team-leader
estimate: M
labels:
  - orchestration
  - workflow
  - tooling
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The log-audit fleet showed that Workflow resume replays the longest unchanged PREFIX of agent() calls; parallel() starts calls in non-deterministic order, so a resume after a host crash re-ran finished batch-1 implementers and never reached batch 2 (three generations re-spawned, statuses flipped back to in_progress). Fix on our side with artifact checkpoints that make any run idempotent regardless of journal state. Deliverables: (1) .claude/workflows/fleet-fix.js — a parameterized workflow script (args = task ids) whose stages check disk artifacts before spawning: context.md exists -> skip plan; task.md status in_review/done -> skip implement; .ptah/specs/TASK_ID/judge-round-N.json exists -> skip that judge round; every stage writes its result artifact before returning; stable labels on every agent() call. (2) A skill (fleet-orchestration) encoding the operating rules learned: disjoint-lib batching, commit only when no implementer is editing (lint-staged stash/restore overwrites concurrent edits), commitlint constraints (subject <=72, body lines <=100, scope enum), judge-loop protocol and verdict artifact schema. (3) A note in the skill on the harness-side limitation (prefix cache) so nobody relies on journal resume again. Implementation lanes for this task are codex and ollama-cloud CLI agents by explicit request.

Full context, plan and discussion live in [./context.md](./context.md).
