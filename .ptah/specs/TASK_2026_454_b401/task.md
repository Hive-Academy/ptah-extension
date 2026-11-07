---
id: TASK_2026_454_b401
status: backlog
type: REFACTORING
title: Decide the memory-curator to agent-sdk dependency direction and fix the cycle comment
description: >-
  memory-curator imports agent-sdk in three files, but queue-slot-timeout.ts says such an
  import would close a cycle. Decide the direction, then fix the code or the comment.
depends_on: []
created: 2026-09-16T01:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_638_7a8e
labels:
  - P3
---

## Description

Decide which side moves. The concrete cases are `NetworkBackoff`
(`libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:55`), the
`SDK_TOKENS`/`SessionLifecycleManager`/`SdkModelService` import
(`libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.ts:22-26`) and the hook
registry types (`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:36`).

If the rule stands, move the symbols to `memory-contracts` or a local port, as `queue-slot-timeout.ts`
already does for `InternalQueryQueueTimeoutError` (it matches the error name instead of importing the
class). If the imports are deliberate, correct the comment at
`libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts:14-15` and say why the direction
is safe.

## Current state (2026-11-07)

- The CLAUDE.md Cross-Lib rule that this task first cited is gone (PR #562). Only the code comment
  remains.
- memory-curator imports `@ptah-extension/agent-sdk` in the three files above (non-spec).
- agent-sdk imports `@ptah-extension/memory-contracts`, not `memory-curator`
  (`libs/backend/agent-sdk/src/lib/di/register.ts:30`). So the comment "agent-sdk depends on this lib
  through the curator port" is at best indirect.
- Nothing is done yet.
