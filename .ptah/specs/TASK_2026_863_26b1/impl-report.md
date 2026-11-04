# Implementation report

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.ts` — admit `awaiting-background` as an idle fire phase while retaining `not-idle` for all other non-idle phases.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts` — remove the now-unused `background-subagent` skip reason.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.spec.ts` — assert the admitted phase and the generating, sleeping, failed, and missing-phase refusals.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts` — exercise a completed parent turn in `awaiting-background` through timer fire and `/compact` send.

## Findings

- The `background-subagent` reason occurred only in the fire gate, its spec, and the reason union. `git log -S"background-subagent" -- libs/backend/agent-sdk` found its initial gate/type commits and a later unrelated background notification commit; no downstream handler depends on that reason. The reducer logs generic `fire-skipped` reasons and clears the attempt (`idle-session.reducer.ts:353-368`).
- The send path checks the live parent record, `turnInFlight`, and queue occupancy before enqueueing (`session-stream-pump.service.ts:240-273,298-315`). It has no phase-based `awaiting-background` refusal. The frontend excludes `awaiting-background` from its busy check (`message-dispatch.service.ts:93-102`). No concrete safety reason for the veto was found.
- Subagent frames with `parent_tool_use_id` exit the parent compaction tap into the subagent monitor before request tracking (`session-query-executor.service.ts:276-291`); the tracker also rejects them (`idle-request-tracker.ts:38-48`, covered by `idle-request-tracker.spec.ts:145-152`). They therefore cannot emit parent `request-started` and cancel its pending timer. A task notification without a main assistant request likewise cannot emit `request-started` through that tracker (`idle-request-tracker.ts:50-62`).
- A real new parent request sets activity and cancels a pending attempt; for an in-flight attempt it preserves the attempt (`idle-session.reducer.ts:128-136`). A new turn ending while the attempt is in flight follows phase-specific handling: enqueued/precompact releases and closes, boundary becomes boundary-ended, postcompacted closes (`idle-session.reducer.ts:138-164`). Existing tests cover pending request cancellation (`idle-compaction.service.spec.ts:510-539`) and boundary/result claim retention (`idle-compaction.service.coalesce.spec.ts:165-185`).

## Decisions

- Removed `background-subagent` from `IdleSkipReason` because the code search found no consumer beyond the gate and its test. Reversible by restoring the reason if a future telemetry contract needs it.

## Tests and verification

- Updated test: `evaluateFireGate > AC 3.9: allows awaiting-background and refuses other non-idle phases`.
- Added test: `IdleCompactionService > sends idle compact when the parent turn ends awaiting a background subagent`.
- Exact command: `npm run verify -- -p @ptah-extension/agent-sdk`.
- Result: **failed before target execution**. Verify summary line: `[verify 2026-11-04T04:34:21.408Z] lock released after 4.3s, exit code 1`. Nx reported `The operating system refused the connection to the Nx Daemon socket (connect EPERM ...)` and `Failed to load 3 default Nx plugin(s)` plus `Failed to load 3 Nx plugin(s)` with `spawn EPERM`. The required `Running target ... for 1 projects` header never appeared because Nx failed during plugin loading; no test, lint, or typecheck pass/fail target lines were produced.
- `ptah_get_diagnostics` was retried after edits and remained unavailable: TypeScript check still running after 45 seconds; four changed files unchecked.
