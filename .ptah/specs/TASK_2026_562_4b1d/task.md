---
id: TASK_2026_562_4b1d
status: backlog
type: REFACTORING
title: Trim injected prompt text and add the lane brief and resume gate (tokaudit)
depends_on: []
created: '2026-09-26T15:00:00.000Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The open token-audit items that only this task owns: injected-text trimming (Wave 2.6),
  the batch spec format and inlined lane brief (Wave 4.1), and the lane resume gate (Wave 4.2).
estimate: L
labels:
  - token-efficiency
  - orchestration
  - agent-sdk
relates_to:
  - TASK_2026_560_2ae5
  - TASK_2026_561_9e57
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

This task owns three open items of the TASK_2026_557 token audit:

- Wave 2.6: trim injected text (skill_listing, agent_listing_delta, duplicated project guidance,
  lane preambles).
- Wave 4.1: a `batches/batch-N.md` spec format with a small `batches.md` index, and
  `ptah_agent_spawn` inlines a lane brief of at most 8-12k chars. Update the agent Inputs sections
  and templates. Confirm the spec-format change with the user before design.
- Wave 4.2: a resume gate. Spawn a fresh lane instead of resuming when the lane context is over
  60k tokens or the lane was idle for more than 10 minutes.

Waves 2.1 (proxied strict MCP), 2.4 (Responses translator) and 2.5 (usage accounting) are owned by
TASK_2026_634_daec Stage A.1. Do not repeat them here.

## Current state (2026-11-07)

- Done: Wave 2.2 and 2.3 (Codex lane config, effort precedence, PR #634), 4.3 (`ptah_agent_wait`,
  `ptah_run_check`), 4.4 (lane budget guard, PR #647), 4.5 (`disallowedTools`, PR #634).
- Open: no `batches/batch-N.md` format exists in the repo, and no resume gate exists in
  `libs/backend/cli-agent-runtime`.
- Wave 4.6 (Codex SDK "Failed to parse item") is likely obsolete: Codex lanes now run through
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`.
  Re-check before you do any work on it.
- Wave 2.4 is still open for TASK_2026_634_daec:
  `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:136,153` sends
  the system text as a developer item and as `instructions`.

Full context, plan and discussion live in [./context.md](./context.md).
