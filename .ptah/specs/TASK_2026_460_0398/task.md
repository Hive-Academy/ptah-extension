---
id: TASK_2026_460_0398
status: backlog
type: BUGFIX
title: Stop createChild from resetting createdAt, cost and tokens on an existing record
depends_on: []
created: '2026-09-16T04:00:00.000Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  SessionMetadataStore.createChild always writes a fresh record, and the merge in
  _saveInternal does not keep createdAt, totalCost or totalTokens. When create() ran
  first, those fields reset to now and zero.
executor: backend-developer
estimate: S
labels:
  - persistence
  - reliability
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

`createChild` can silently reset a session's `createdAt`, cost and token totals. Make it keep an
existing record's `createdAt`, `totalCost`, `totalTokens` and other accumulating fields, or reuse the
existing-record branch of `create` and then set the child marker. Bump `lastActiveAt` to now. Pin both
call orders (`create` then `createChild`, and the reverse) with a spec.

## Current state (2026-11-07)

- Not fixed. `createChild` builds a fresh record with `createdAt: now`, `totalCost: 0` and zero
  tokens (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:2504-2529`).
- The `_saveInternal` merge (`session-metadata-store.ts:1492` onward) now keeps more fields
  (account binding, provider id, Codex counters, `resumableSdkSubagents`), but not `createdAt`,
  `totalCost` or `totalTokens`.
- `create` still keeps an existing record and bumps only `lastActiveAt` (`:2400-2412`).
- The Ptah CLI writer is `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:273`.
  Other `createChild` callers: `libs/backend/agent-sdk/src/lib/session-importer.service.ts:623,733`
  and `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1971`.

Full history in [./context.md](./context.md). Its line numbers are out of date.
