---
id: TASK_2026_374
status: backlog
type: bugfix
title: >-
  SessionTurnStateRegistry.records is unbounded and leaks one entry per user abort
description: >-
  `ChatStreamBroadcaster`'s loop-exit guard skips both `turnState.clear` calls when
  `endSessionIfTokenMatches` returns false, which is exactly what a user abort
  produces. The `TurnRecord` for that session then stays in
  `SessionTurnStateRegistry.records` for the life of the process. `records` has no
  bound and no eviction, so it grows one entry per abort, and `session:status` keeps
  returning a `turnState` for sessions that ended long ago. MUST be fixed together
  with the revision-floor eviction hazard (TASK_2026_371 review F1) — see the body.
---

# The leak

**Origin.** Filed out of the accepted code-logic review of commit `386fe012b`
(`.ptah/specs/TASK_2026_371/code-logic-review-claude-cli.md`, finding F2). It is
NOT a regression of that commit; the leak predates it.

**Files.**

- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:410-415`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:147-158`
- `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts`

**Chain.** The user presses Stop. `chat:abort` ends the SDK session record. The
broadcast loop sees the abort and reaches its `finally`. `endSessionIfTokenMatches`
finds no record (`session-control.service.ts:151-153` returns `false` when `!rec`),
so `ended` is `false`, so `recordReplaced` is set to `true`, so the guard skips BOTH
`turnState.clear` calls. The record survives.

The task's own evidence confirms this on the real abort path: `context.md` records
log line 475, "record was replaced before stream exit", on a user abort.

**Size.** Small. One leaked `TurnRecord` is a phase string, three short arrays, two
null snapshot slots and a boolean — on the order of a few hundred bytes. Thousands
of aborts in one process reach a megabyte. Not a crash risk, and not a correctness
risk on its own: a leaked record makes `ensure` reuse it, so the counter stays
monotonic.

**Second symptom.** `session:status` (`session-rpc.handlers.ts:1155`) keeps returning
a `turnState` for sessions that ended long ago, because the record is still there.

# Why this is coupled to TASK_2026_371 F1 — read before starting

The leaked record is what PROTECTS an aborted session from the revision-floor
eviction hazard. While the record is present, `ensure` reuses it and never re-seeds
from `revisionFloors`, so an evicted floor cannot restart that session's counter.

**Fixing the leak alone would WIDEN TASK_2026_371 F1.** Whoever picks this up must
verify the eviction hazard is closed first, and must not treat the two as separable.

TASK_2026_371 round 2 closes the residual F1 gap with a terminal-phase heal in
`TabManagerService.acceptsTurnState`: a tab bound to exactly the incoming session
accepts a TERMINAL `turn_state` whose revision is at or below its own watermark, and
realigns the watermark down onto the restarted backend counter. That heal is the
precondition for this task. Confirm it is in place, and confirm it still holds after
the records map is bounded, before closing this one.

# Inconsistency worth naming

`registry.ts:33-35` justifies bounding `revisionFloors` with "a map that only ever
grows is a leak whatever its retention rule". That argument applies with more force
to the larger map beside it. Bounding the small map and leaving the big one unbounded
is the inconsistency this task resolves.
