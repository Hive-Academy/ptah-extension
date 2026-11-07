---
id: TASK_2026_613_8f34
status: backlog
type: FEATURE
title: Ship the token-saving orchestration rules to all users with settings controls
description: >-
  Ship the approved token rules that are still missing (relay per agent run, model per role,
  maxTurns in generated agents) in the ptah-core plugin and the agent templates, with Settings controls.
depends_on: []
created: 2026-10-04T17:00:00.000Z
updated: '2026-11-07T00:00:00.000Z'
---

## Description

TASK_2026_597 measured the cost drivers of orchestration runs (2026-10-04: 83% of Claude input
tokens came from subagents; single developer runs of 64-103 requests at contexts up to 310k). The
user approved rules to cut that cost. The remaining work ships them to every user:

- **Shipped skills:** encode the relay rule (a developer or reviewer stops at about 150k context,
  writes a progress note, and a fresh agent continues), the model-per-role rule (Sonnet for
  verify-and-commit, style review and mechanical batches; Opus for design, logic review and complex
  batches), the orchestrator-commits-a-clean-batch rule and the short-check-output rule in
  `plugins/ptah-core/skills/orchestration/` (`SKILL.md`, `references/team-leader-modes.md`,
  `references/agent-catalog.md`) and `plugins/ptah-core/skills/agent-lanes/`. Keep the
  `.claude/skills` copies in sync, run `npm run manifest:generate`, and commit
  `content-manifest.json`.
- **Generated agents:** a model per role and a `maxTurns` value in the agent templates under
  `libs/backend/agent-generation/templates/agents/`.
- **Settings UI:** controls for the relay limit, the batch size, the model per role and the turn
  limit. Extend the existing orchestration matrix and session-budget controls; do not add a second
  set. The skill text and the settings use the same keys and defaults as the runtime limits.
- Re-decide the 60-tool-call backup trigger: #848 dropped the lane tool-call budget.

## Current state (2026-11-07)

- Done: the batch-size rule (at most 6 files, 2 libraries) is shipped in
  `plugins/ptah-core/skills/orchestration/references/fleet.md:40` and `lane-assignment.md:96`.
  Short check output exists as `ptah_run_check`.
- Open: no 150k relay rule, no model-per-role rule and no `maxTurns` text in
  `plugins/ptah-core/skills/orchestration` or `plugins/ptah-core/skills/agent-lanes`.
- Open: no `maxTurns:` frontmatter in the agent templates. (`maxTurns: 25` in
  `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:431` is an SDK query
  option for generation, not an agent limit.)
- The plugin assets moved from the removed VS Code app to the repo-root `plugins/` folder.
