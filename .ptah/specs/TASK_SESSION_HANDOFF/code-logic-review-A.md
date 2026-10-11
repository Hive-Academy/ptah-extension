Verdict: REVISE
Score: 4/10

The coordinator state machine itself is careful (single-flight, FIFO order, token-safe close, arm-before-`markTurnEnded` ordering in code, dequeue-time SDK message creation preserving files/images/origin). But three independent defects each make every runtime handover fail, and a fourth silently disables the budget gate on the interrupt path. All pass the suite because the specs construct the instances with mocks at exactly the seams that break.

1. **blocking** — `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:95` (with `session-handover-coordinator.service.ts:318` and `:83-91`)
   Defect: the coordinator queues its own `/compact` via `enqueueOwnedCompact`, but the pump's dequeue path re-admits every shifted input through `admitOrHold`. The operation is always in phase `compacting` (in `HELD_SOURCE_PHASES`) when the compact is queued, so the coordinator holds its own `/compact`.
   Failure scenario: every confirmed handover — the `/compact` never reaches the SDK, no new boundary is persisted, `waitForNewCompactBoundary` returns null, the operation fails, and `restore` unshifts the literal `/compact` input back onto the source queue, so after every failed handover the source session executes an unrequested `/compact` user turn ahead of the restored inputs. Narrow race variant: an input shifted mid-`createUserMessage` at arm time leaves `enqueueOwnedCompact`'s busy check passing; the `/compact` then waits behind the new turn and is spliced into the transfer FIFO by the next `armAtTerminal` (`coordinator:192`), delivering "/compact" to the successor as user input.
   Fix: mark the owned compact on the envelope (e.g. `admission: 'owned-compact'`) and skip `admitOrHold` for it at the dequeue boundary, or deliver the owned compact to the SDK without the message queue. Add a pump spec that drives the real coordinator through `enqueueOwnedCompact`.

2. **blocking** — `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:111`
   Defect: `SessionHistoryReaderService` is injected by class token, but it is registered only under `SDK_TOKENS.SDK_SESSION_HISTORY_READER` (`di/register.ts:180-184`); no class-token registration exists anywhere (verified by repo-wide grep). With `{isOptional: true}` it resolves to null in the real container.
   Failure scenario: `complete()` always hits the `!this.historyReader` guard (`:296-307`) and fails every confirmed handover with "handover unavailable". The coordinator spec passes a mock reader directly, so the suite is green while the feature is dead at runtime.
   Fix: inject `SDK_TOKENS.SDK_SESSION_HISTORY_READER` (matching every existing consumer, e.g. `sdk-agent-adapter.ts:243`), or add `container.registerSingleton(SessionHistoryReaderService)`.

3. **blocking** — `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:418`
   Defect: `SessionBudgetService` is likewise injected by class token but registered only under `SDK_TOKENS.SDK_SESSION_BUDGET` (`di/register.ts:748-752`), so `this.sessionBudget` is null and `isAtBlockingLimit` (`:498-500`) always returns false.
   Failure scenario: the successful-interrupt release path (`session-control.service.ts:124-128` → `onTurnTerminal(sessionId, false)`) never arms at a blocking limit; `armAtTerminal` returns undefined, `markTurnEnded` wakes the pump, and a follow-up queued during the crossing turn starts a new source turn past the budget limit. This directly violates the requirement that both terminal release paths arm before the queue wakes. Even with registration fixed, a class-token registration would create a second budget instance distinct from the adapter's token-resolved singleton — stale state.
   Fix: inject `SDK_TOKENS.SDK_SESSION_BUDGET` in the lifecycle manager so both paths read the same singleton.

4. **major** — `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:78` and `:182-195`
   Defect: `waitForNewCompactBoundary` bounds the wait by 6 disk reads separated by a single `setImmediate` (`:81-83`) — a wall-clock bound of milliseconds.
   Failure scenario: even after finding 1 is fixed, a real `/compact` turn takes seconds (SDK processes the command, then writes the JSONL boundary); the poll loop gives up long before the boundary is durable, so every handover fails and restores. The sibling loop at `:547` is valid only because the compaction callback has already fired there; here the compact turn has not even started.
   Fix: poll on a wall-clock deadline (e.g. 30-60 s, one read every 250-500 ms), and stop early if the operation is cancelled or the source record disappears.

5. **major** — `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:384-388`
   Defect: `restore()` sets `operation.restored = true` before calling `this.runtime?.restoreInputs`, ignores `restoreQueuedInputs`'s boolean (`session-registry.service.ts:560-566`, false when the record is gone), and skips silently when the runtime is null.
   Failure scenario: the user Stops the source session during compaction → the record is removed → `fail()` "restores" the FIFO, `restoreQueuedInputs` finds no record and returns false, and the held user messages vanish with no signal beyond the `failed` phase. Same silent drop whenever the runtime was never attached.
   Fix: mark `restored` only after a successful restore; publish a restore failure (e.g. `error: 'held inputs could not be restored'`) when the runtime is absent or the record is gone; keep `inputs` for a later retry instead of flagging them delivered.

6. **moderate** — `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:633-644`
   Defect: `withAgentHandoff` builds `seed = (prefix + document.seed).slice(0, 8_200)`, so the bounded agent supplement (`agentHandoffChars: 2_000`) can evict up to ~2 KB of the durable seed tail.
   Failure scenario: a long session with an agent handoff near the 2 000-char cap silently truncates durable handoff facts in favour of supplemental text — the plan states the supplement is "not a bypass of the durable document".
   Fix: reserve the durable seed first and cap the supplement to the remainder (`seedChars - preamble - document.seed.length`, floor 0), dropping the supplement when no room remains.

7. **moderate** — `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:349-356`
   Defect: when `closeIfTokenMatches` returns false, the error is recorded but the operation still transitions to `closed`.
   Failure scenario: a stale-token close publishes phase `closed` while the source session is still open with its queue drained; batch C's UI, keyed on phase, treats the handover as complete and the source becomes an orphaned live tab.
   Fix: transition to `failed` (with the token-mismatch error, no restore since the inputs are already at the successor) instead of `closed` when `closed` is false.

8. **moderate** — `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:15` and `:113-114`
   Defect: `SESSION_SUCCESSOR_HOST = Symbol.for('ChildChatSessionHost')` duplicates `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST` (`cli-agent-runtime/src/lib/di/tokens.ts:23`) with no compile-time link, and the host is captured once at construction with no re-resolution.
   Failure scenario: if the coordinator singleton resolves before the batch-B host registration runs, or from a different container instance, `successorHost` is permanently null and every `begin` returns `unavailable` with no diagnostic; renaming either symbol declaration silently breaks the bind on the other side.
   Fix: resolve the host lazily per `begin` (try/catch resolve) or export the token from one shared module both libs import; add a smoke spec asserting the binding resolves in the assembled container.

9. **minor** — `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:308-311`
   Defect: `runtime.sourceSnapshot` runs outside the try block of `complete()`; a throw rejects the `void this.complete(...)` promise (`:239`, `:293`) with no handler and strands the operation in `compacting` — held forever, and `request` keeps returning the existing snapshot so no new handover can start.
   Fix: move the snapshot call inside the try, or wrap `complete` so any rejection fails the operation.

10. **minor** — `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1741-1747` vs `session-lifecycle-manager.ts:498-500`
    Defect: the two terminal paths use different blocking predicates — the result path requires `ok === false && stage === 'limit' && blocked`, the interrupt path only `ok === false`.
    Failure scenario: equivalent today only because `canSend` refuses solely on `figure.blocked` (`session-budget.service.ts:434`, `:460`); if `canSend` ever refuses for another reason, the interrupt path arms spurious budget handovers.
    Fix: extract one shared predicate and use it in both paths.

11. **minor** — `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:585-592`
    Defect: mid-turn steer during a handover is now refused by the `mayInterrupt` gate (`session-control.service.ts:86-92`) and the spawner returns `interrupt-failed`; the requirement that steer text be held on the FIFO is not implemented for the in-turn case (the parent retains the text, so nothing is silently lost).
    Failure scenario: an agent steers a child whose handover is in `waiting-for-turn-end`; it gets a refusal instead of `SESSION_HANDOVER_HELD`, and must re-send after the handover completes.
    Fix: land the planned FIFO hold for steer text in batch D and confirm batch B holds the composer stop-intent; until then this is the expected interim state, not data loss.

## Five logic questions

1. Silent failure: findings 2 and 5 — every handover fails "handover unavailable" with the real cause (missing DI registration) invisible, and restore drops held input without any published error.
2. User action: Stop during compaction (finding 5); interrupt at the budget limit starts a forbidden source turn (finding 3).
3. Wrong answer, not error: the `/compact` restore (finding 1) runs an unrequested compaction of the source; the successor can receive "/compact" as a user message.
4. Dependency failure: the compact-boundary wait treats a slow dependency (SDK compaction) as absence after ~milliseconds (finding 4); a throwing `sourceSnapshot` strands the operation (finding 9).
5. Requirements never mentioned: nothing validates that the batch-B host and batch-D steer holds actually compose with these contracts; no test drives the real pump and coordinator together (finding 1's fix must add one).

Scope examined: the full coordinator, pump, registry, control, query-executor, lifecycle-manager and adapter diffs; the new shared types and host port; the builder and history-reader changes; DI registration; the coordinator/adapter specs; `canSend`, `markActive`/`markTurnStarted`/`markTurnEnded`, and the spawner steer path for interaction effects. Batch B (rpc-handlers) was excluded per instructions. Remaining uncertainty: exact tsyringe `isOptional` behavior was inferred from repo convention (no class-token registration exists and all sibling consumers use `SDK_TOKENS`); if some bootstrap registers class tokens, findings 2-3 downgrade, but the duplicated-instance risk in finding 3's fix note remains.