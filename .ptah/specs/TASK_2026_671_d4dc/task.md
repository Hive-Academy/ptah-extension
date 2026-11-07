---
id: TASK_2026_671_d4dc
status: backlog
type: REFACTORING
title: Remove dead settings keys
depends_on: []
created: "2026-10-14T17:08:13.860Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  memory.embeddingModel, memory.searchTopK, memory.searchAlpha, gateway.coalesceMs and
  agentOrchestration.codexAutoApprove are declared but change no behaviour. Remove them after user approval.
estimate: S
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

These settings keys are declared in `libs/backend/platform-core/src/file-settings-keys.ts` but no
code uses their values:

| Key | Declared (key, default) | Other references |
|---|---|---|
| `memory.embeddingModel` | `:201`, `:415` | none |
| `memory.searchTopK` | `:204`, `:418` | none |
| `memory.searchAlpha` | `:205`, `:419` | none |
| `gateway.coalesceMs` | `:249`, `:457` | key map only (`libs/backend/messaging-gateway/src/lib/gateway-settings-access.ts:16`); the stream coalescer does not read it |
| `agentOrchestration.codexAutoApprove` | `:109`, `:346` | returned by `agent:getConfig` and migrated (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:516,2157`), typed in `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:336,582`, exported (`libs/backend/agent-sdk/src/lib/types/settings-export.types.ts:85`); no runtime or UI consumer |

Before any code change, confirm each key with `git grep`, list the evidence, and get user approval
(orchestration rule). Check settings export/import and the migration of stored user files, so an
old `~/.ptah/settings.json` that still holds a removed key loads without error.

## Current state (2026-11-07)

- Not started. All five keys are still declared.
- `codexAutoApprove` gained RPC plumbing since 2026-10-14 but still drives no behaviour. Removing it
  touches the shared RPC type and the agent config handler as well.

Full context, plan and discussion live in [./context.md](./context.md).
