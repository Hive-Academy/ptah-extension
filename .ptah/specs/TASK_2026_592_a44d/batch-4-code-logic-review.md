# Code Logic Review — `TASK_2026_592_a44d` Batch 4

Review type: SAME-SIDE (author was an in-process backend-developer, reviewer is in-process). Reason: CLI lanes are busy with another session. A cross-side review of the whole diff follows at the end.

Scope read in full: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (diff plus `abortSession`, `subscribeToSessionEnd`), `chat-session-abort-resume-state.spec.ts`, `session-control.service.ts` (`endSession`, `endRecord`, `retireInterruptedRecord`, `disposeAllSessions`), `sdk-agent-adapter.ts` (`isSessionActive`, `interruptSession`), `session-metadata-store.ts` (`saveResumeState`). I did not run the tests; I relied on the report's before/after numbers and on reading the spec.

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 7/10                           |
| Assessment          | APPROVED (with two moderate notes) |
| Blocking issues     | 0                              |
| Serious issues      | 0                              |
| Moderate issues     | 2                              |
| Failure modes found | 3                              |

## Five logic questions

### 1. How does this fail silently?

The guard skips the write silently when `isSessionActive` is false. That is correct when the registry holds no new state, but there are two paths where the registry holds freshly interrupted subagents that were never persisted and no live record exists (see Moderate 1 and 2). The previous unconditional write persisted them on the next idle abort. Now they are dropped silently.

### 2. What user action produces unexpected behaviour?

- User sends a stop-intent follow-up under autopilot yolo/auto-edit (`chat-session.service.ts:735-750`), the 3 s interrupt times out, the record is retired, and then the user closes the tab. The close sends an idle `chat:abort`, which now skips the write.
- Stop clicked, then tab closed: the first abort writes, the second skips. This is correct.

### 3. What input data produces a wrong answer?

None found for the RPC result. `resumableSubagents` is computed from the registry after the interrupt, exactly as before (`chat-session.service.ts:982-1009`). Only the durable write is conditional.

### 4. What happens when a dependency fails?

- `interruptSession` throwing goes to the catch and returns `success:false`, unchanged. The guard value is already read, so nothing new.
- `saveResumeState` for a missing session logs a warning and returns (`session-metadata-store.ts:594-600`). With the guard, the idle-abort-after-delete race no longer logs it. Benign.

### 5. What is missing that the requirements never mentioned?

A reader of the durable list outside `chat:resume`, and a restore on the `chat:continue` path (the pre-existing gap, see Q4 below).

## Focus 1: guard correctness per abort path

| Path | hadLiveRecord | Write | Verdict |
| ---- | ------------- | ----- | ------- |
| User Stop mid-stream (record live) | true | `endRecord` fires the session-end subscriber (writes, with workspaceRoot), then `abortSession` writes again (same snapshot) | Same as before |
| Tab close, idle session whose record still lives (persistent session) | true | Both writers | Same as before |
| Tab close, idle, record already ended by an earlier abort or end | false | Skipped. The earlier end already persisted via the subscriber or the first abort | Correct, avoids double-write overwrite |
| Tab close after restart, no `chat:resume` | false | Skipped. Fixes the wipe | The point of the batch |
| Dispose / shutdown (`disposeAllSessions`) | n/a | Does not use `abortSession`; subscriber path unchanged (`session-control.service.ts:373`) | Unaffected |
| Ptah CLI sessions | n/a | Return earlier at `chat-session.service.ts:972-974` | Unaffected |
| Other `chat:abort` callers (apps-session, harness-workflow, gateway, `apps/ptah-cli`) | Same logic: they go through `chat-rpc.handlers.ts:279` to `abortSession` | Same as the rows above | OK |

Ordering and race: `isSessionActive` is a synchronous `registry.find` (`sdk-agent-adapter.ts:1061-1063`), read on the line before `interruptSession`, with no `await` in between. `interruptSession` calls `flushPendingUserActivityFor` and `captureStatsLeases` before `endSession`, and both look synchronous, so the record cannot be removed in between by this call. The lookup is the same one `endSession` uses (`session-control.service.ts:160-166`), so "false" means exactly "`endSession` returns `already-ended`". The check is read before the removal. OK.

Concurrent double abort: the second call arrives while the first awaits `query.interrupt()` (up to 5 s, `session-control.service.ts:253`). The record is still registered, so the second call reads true, and both write the same snapshot. Harmless and unchanged.

### Failure mode A: stale registry snapshot never persisted after `retireInterruptedRecord`

- Trigger: `interruptCurrentTurn` times out or throws (`session-control.service.ts:95`, `:113`). `retireInterruptedRecord` runs `markAllInterrupted`, removes the record, and emits NO session-end notification (lines 123-148). Reachable from `chat:continue` with a stop intent (`chat-session.service.ts:740`). Then a tab close sends an idle `chat:abort`.
- Symptom: the subagents that were interrupted by the retire are in the registry but not in the durable list. The pre-batch idle abort persisted them; now it does not. After a restart the "resume interrupted agents" offer is missing for that session.
- Evidence: `session-control.service.ts:123-148`, `chat-session.service.ts:1000`.
- Current handling: skipped.
- Recommendation: Moderate, narrow (needs a turn-interrupt timeout plus subagents running plus close). Either accept and document, or guard on "registry has interrupted records that differ from the durable list" instead of "live record". Not a blocker.

### Failure mode B: no `projectPath` on the record

- Trigger: `endRecord` skips the session-end notification when `rec.config.projectPath` is empty (`session-control.service.ts:289-298`; `disposeAllSessions` likewise at `:338-340`). The only writer left is `abortSession`, and it still writes when the abort itself ended the live record (`hadLiveRecord` true). So the direct abort is fine. The residual gap is only an end that happened by another route (for example a retire, mode A) with no projectPath.
- Evidence: same lines. Severity Minor.

### Failure mode C: guard hides the stale-list clear for a never-live session

- Trigger: durable list exists, session never went live this process, but the user cleared the underlying agents by other means. Nothing else can resolve them without a live record, so the list stays until a `chat:resume`/continue. Acceptable. The spec case "stale list cleared when a live abort" still holds (`spec:319-332`).

## Focus 2: RPC return value and stored format

Return shape: the `return { success: true, ...(resumableSubagents.length > 0 && { resumableSubagents }) }` block is untouched (`chat-session.service.ts:1006-1009`). In the no-live-record case `resumableSubagents` is read from the in-memory registry exactly as before, so the response is identical. Stored format: `saveResumeState` is untouched and the same payload is passed when it is called (`:1001-1003`). The diff is a 4-line guard plus a comment. VERIFIED.

## Focus 3: spec quality

- Uses the real `SubagentRegistryService` and the real `SessionMetadataStore` over `createMockStateStorage` (`spec:97-101`). Only the adapter and `ptahCli` are fakes. Good.
- The fake `interruptSession` models `endRecord` faithfully for the points this batch depends on: no-op without a record, `markAllInterrupted`, then the end callback (`spec:114-119`). It does not model `retireInterruptedRecord` or the empty `workspaceRoot` skip, so failure mode A is untested.
- Fails without the fix: case (b), restart (`spec:236-259`), asserts the durable list is intact, and the unfixed code writes `[]`. The report states 2 of 6 failed before the fix; by reading, the failing ones are (b)-restart and (c)-expired-left-in-place, which matches the report. I have not re-run it.
- Case (c) expired idle (`spec:278-296`) now asserts the stale expired record is left in place. This is a changed behaviour that the test locks in; it is harmless because `restoreResumableBySession` refuses expired records, but the durable store accumulates the junk until the next live write. Minor.
- `jest.mock` of `@ptah-extension/workspace-intelligence` is a large stub list; matches the existing spec pattern. The test reflects real call order (subscriber first, then abort) in the live-abort-at-TTL case.
- `as never` positional constructor args (`spec:126-176`) are brittle to constructor changes; consistent with the neighbouring specs. Minor.

## Focus 4: pre-existing problem (continue on a restored tab, never resumed, then end)

Confirmed pre-existing and out of scope. After a restart, `chat:continue` on a restored tab that never ran `chat:resume` starts a live record without restoring the durable list. When the record ends, the session-end subscriber (`chat-session.service.ts:224-232`) writes the empty registry snapshot over the durable list. That subscriber is unchanged by this batch and runs before `abortSession`'s own write regardless of the guard, so the wipe happens on `main` today for every end route (abort, dispose, quit). The guard does not make it worse: it only removes writes in the no-live-record case. It does however make this path the sole remaining wipe route for the close behaviour, so a follow-up task (restore the durable list on the continue/auto-resume path) is worth filing. The report already flags it; I concur.

## Moderate and minor issues

1. Moderate: failure mode A, stale snapshot after retire is no longer persisted by a later idle abort (`chat-session.service.ts:1000`, `session-control.service.ts:123-148`). Add a spec for it, or note it as accepted.
2. Moderate: the spec fake does not exercise the retire path or empty-`workspaceRoot` end, so the "live record is the correct proxy for state changed" claim in the comment (`chat-session.service.ts:996-999`) is only proven for the `endRecord` path.
3. Minor: the comment says "nothing changed this call". Strictly it is "this call changed nothing", and earlier unpersisted changes are not covered (see A).
4. Minor: expired durable records now linger (`spec:278-296`).

## Data flow

1. Frontend tab close sends `chat:abort` with `claudeSessionId`: OK.
2. `chat-rpc.handlers.ts:279` calls `abortSession`: OK.
3. Ptah CLI branch returns early: OK.
4. `isSessionActive` read before the interrupt: OK (same lookup as `endSession`).
5. `interruptSession` runs `markAllInterrupted`, deregisters, notifies (writer 1 when a live record existed and projectPath is set): OK.
6. Registry snapshot read: OK, unchanged.
7. `saveResumeState` (writer 2) only when `hadLiveRecord`: OK for the live path. Gap for state changed outside a live-record end (A).
8. Return shape unchanged: OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Pin whether idle abort overwrites a non-empty list | COMPLETE | Proven in case (b) |
| Smallest guard, no contract change | COMPLETE | One guard, return and stored format unchanged |
| Cover both writers | COMPLETE | Subscriber cannot run without a live record |
| Tests with real registry and store | COMPLETE | Retire path not modelled |

Implicit requirements not addressed: durable list restore on the `chat:continue` path (pre-existing); persistence after `retireInterruptedRecord`.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Restart, tab closed unopened | YES | Skipped write | None |
| Double abort | YES | Second skips or rewrites the same list | None |
| Concurrent double abort during interrupt | YES | Both write the same snapshot | None |
| Abort of a deleted session | YES | Skip, or a warning when live | None |
| Retire then close | NO | Interrupted subagents not persisted | Moderate, narrow |
| Empty `workspaceRoot` | PARTIAL | The abort's own write still runs when live | Minor |
| TTL-expired durable record | YES | Left in place, never restored | Minor |

## Verdict

- Recommendation: APPROVE (a cross-side review of the whole diff follows)
- Confidence: MEDIUM-HIGH. I did not execute the tests; the reasoning is from reading the lifecycle code.
- Top risk: a subagent set interrupted by `retireInterruptedRecord` (no session-end notification) is no longer persisted by a later idle abort.
- What a robust implementation would add: a spec for the retire-then-close case (or an explicit note accepting it); a restore of the durable list on the `chat:continue` and auto-resume path so the last remaining wipe route (the session-end subscriber after an unrestored continue) is closed.
