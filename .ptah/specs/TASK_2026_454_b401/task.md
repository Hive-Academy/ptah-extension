---
id: TASK_2026_454_b401
status: backlog
type: REFACTORING
title: >-
  Resolve the memory-curator to agent-sdk import rule contradiction
description: >-
  Found by TASK_2026_443_40ec Task 10.2. Three non-spec files in
  libs/backend/memory-curator/src import @ptah-extension/agent-sdk
  (curator-pass-admission.ts, knowledge-agent.service.ts,
  memory-trigger.service.ts), which the Nx boundary lint permits but the
  memory-curator CLAUDE.md Cross-Lib Rules sentence forbids. The imports predate
  TASK_2026_443 and exist unchanged on main. Either the code moves behind a port
  or the rule sentence changes; the two must not disagree.
depends_on: []
created: 2026-09-16T01:00:00.000Z
updated: 2026-09-16T01:00:00.000Z
---

## Description

Decide which side moves. `NetworkBackoff` and the knowledge-agent and trigger imports are the
concrete cases. If the rule stands, the symbols belong in `memory-contracts` or a local port, as
`queue-slot-timeout.ts` already does for `InternalQueryQueueTimeoutError` by matching the error name
instead of importing the class. If the imports are deliberate, correct the Cross-Lib Rules sentence and
say why the direction is safe.
