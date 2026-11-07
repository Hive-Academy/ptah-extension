---
id: TASK_2026_638_7a8e
status: backlog
type: REFACTORING
title: "Memory code health: hygiene, boundary decision and file-size limits"
depends_on: []
created: "2026-10-12T19:39:39.990Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Epic. Dead code and hidden spec type errors in memory-curator, quarantine test gaps, the
  memory-curator to agent-sdk import decision, and the split of three oversized files.
estimate: L
labels:
  - epic
  - memory
  - P3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic. The children carry the work: delete dead code and fix hidden spec type errors in
memory-curator, close the quarantine test gaps, decide the memory-curator to agent-sdk import
direction, and split the three oversized memory-curator files.

## Current state (2026-11-07)

- All four children are still `backlog`: TASK_2026_642_fb22, TASK_2026_573_e2bf,
  TASK_2026_454_b401, TASK_2026_643_5210.
- The dead copy `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts` still exists
  and has no importer. The live copy is
  `libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt.ts`.
- The oversized files are now 1041, 1051 and 1565 lines (`memory.store.ts`,
  `memory-curator.service.ts`, `triggers/memory-trigger.service.ts`); the `max-lines` rule is 700
  (`eslint.config.mjs:517`).

Full context, plan and discussion live in [./context.md](./context.md).
