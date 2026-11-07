---
id: TASK_2026_720_6f98
status: backlog
type: FEATURE
title: Close the lane and skill scoring loop with user signals
depends_on: []
created: "2026-10-25T16:29:26.615Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Feed lane reports, escalations, user corrections and AskUserQuestion answers into lane and skill
  scoring, attribute CLI-lane grades to skills, and keep review scores and REVISE.
estimate: L
labels:
  - skills
  - lane-routing
relates_to:
  - TASK_2026_701_9e4b
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Close the scoring loop for lanes and skills with the signals that are not recorded today. Refine
the scope with a PM pass first; removals need user approval.

1. User signals into the scorer. Record per run, and let lane ranking and the skill scorecard use:
   lane `ptah_agent_report` content (only a report count reaches the completion signal today);
   escalations (REVISE at the revise cap, removals sent to the user, same-side review fallbacks);
   user corrections and overrides in chat; AskUserQuestion answers (which option, and whether the
   recommended one was chosen). No code in `libs/backend/lane-outcomes` or
   `libs/backend/lane-routing` records any of these.
2. CLI-lane grades reach the skill scorecard. `findAttributions` takes only
   `executor_kind = 'subagent'`
   (`libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:173`).
3. Keep review scores and REVISE. The spec extractor maps `revise` and `needs_revision` to `fail`
   (`libs/backend/skill-synthesis/src/lib/spec-extractor.ts:105`).
4. Frozen data and leftovers (re-check each, then ask before removal): the
   `skill_session_verdicts` writer and readers
   (`libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.store.ts`,
   `outcome-seam/skill-telemetry-seam.adapter.ts`); vestigial `linked` / `candidateId`
   (`libs/backend/skill-synthesis/src/lib/skill-registry-catalog.service.ts:22,53,68`).

## Current state (2026-11-07)

- Done in PR #954 (`3e0d1bd96`): revise rounds count in the review-rate denominator
  (`libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:213-217`); a read-only
  `agent:getCapabilityMatrix` RPC and an Electron matrix table show lane/model scores, sample
  counts and last picks (`libs/frontend/chat/src/lib/settings/ptah-ai/capability-matrix-setting.component.ts`);
  usage-limit, auth and timeout failures no longer lower a lane's score; Enhance is gated server
  side.
- Done in `2d1c69dd2`: lane outcome rows record native token and cost usage when the lane reports it
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:75-77`).
- Done in TASK_2026_879_9809 (PR #953): past outcomes feed the decision model.
- Done: `ptah_outcome_report` and `ptah_route_decide` ship as MCP tools.
- Left: items 1-4 above.

Full context, plan and discussion live in [./context.md](./context.md).
