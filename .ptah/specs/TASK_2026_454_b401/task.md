---
id: TASK_2026_454_b401
status: backlog
type: REFACTORING
title: "Decide the memory-curator to agent-sdk dependency direction and fix the cycle comment"
description: "The CLAUDE.md rule this task cited is gone (PR #562). memory-curator still imports agent-sdk (e.g. NetworkBackoff in curator-pass-admission.ts) while queue-slot-timeout.ts says such an import would close a cycle. Decide the direction and fix the code or the comment."
depends_on: []
created: 2026-09-16T01:00:00.000Z
updated: "2026-10-30T03:43:14.678Z"
parent: TASK_2026_638_7a8e
labels:
  - P3
---

## Description

Decide which side moves. `NetworkBackoff` and the knowledge-agent and trigger imports are the
concrete cases. If the rule stands, the symbols belong in `memory-contracts` or a local port, as
`queue-slot-timeout.ts` already does for `InternalQueryQueueTimeoutError` by matching the error name
instead of importing the class. If the imports are deliberate, correct the Cross-Lib Rules sentence and
say why the direction is safe.
