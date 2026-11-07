---
id: TASK_2026_635_5ea5
status: backlog
type: BUGFIX
title: "Memory reliability: no lost observations, no crashes, no main-thread hangs"
depends_on: []
created: "2026-10-12T19:39:36.670Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Epic. Curator failures that lose observations, the sqlite-vec close crash, synchronous SQLite on
  the Electron main thread, the cli-engine memory registration crash, and FTS drift. Children carry
  the work.
estimate: XL
labels:
  - epic
  - memory
  - P1
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic. The memory system must not lose observations, crash the host, or block the Electron main
thread. The children carry the work: curator extraction and provider failures that lose
observations, the sqlite-vec close crash, synchronous SQLite on the Electron main thread, the
memory registration crash in the `cli-engine` container, and `memory_concepts_fts` drift.

## Current state (2026-11-07)

- All nine children are still `backlog`: TASK_2026_391, TASK_2026_622_2d05, TASK_2026_458_39c2,
  TASK_2026_579_f2e2, TASK_2026_311, TASK_2026_567_90d4, TASK_2026_481_7b0f, TASK_2026_447_035a,
  TASK_2026_455_9f2c.
- The CLI app was removed (PR #892), but `libs/backend/cli-engine` still boots the memory stack for
  `worker-host` and `tools/mcp-bench` (`libs/backend/cli-engine/src/lib/container.ts:811`). So
  TASK_2026_458 still applies there. Re-check it first:
  `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.spec.ts:152` already tests a
  memory-contract fallback when Track 1 throws.
- The child evidence files still exist on main, for example
  `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts`,
  `libs/backend/memory-curator/src/lib/memory-search.service.ts` and
  `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`. Line
  numbers in `context.md` date from 2026-10-12.

Full context, plan and discussion live in [./context.md](./context.md).
