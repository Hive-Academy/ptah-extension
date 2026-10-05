# Code Logic Review — `TASK_2026_614_327a` / PR #655 CodeRabbit fixes (codex lane)

Scope: the uncommitted working-tree diff only (13 modified files, plus the new lane report). I checked the diff against the 6 CodeRabbit comments on PR #655 and read the surrounding code at every changed site. I ran the specs myself:

- `nx test vscode-lm-tools` (all of it)
- `nx test agent-sdk`, `nx test vscode-core` and `nx test @ptah-extension/chat-streaming`. The `--testPathPattern` filter was ignored, so these ran in full.

## Summary

| Metric              | Value     |
| ------------------- | --------- |
| Overall score       | 5/10      |
| Assessment          | REJECTED  |
| Blocking issues     | 0         |
| Serious issues      | 1         |
| Moderate issues     | 2         |
| Failure modes found | 4         |

The Major comment (`runOwners` reclaim) is fixed correctly, and its spec pins the fix. The rejection has one cause: the new `session_submit` spec does not type-check. Because of that, the whole `stdio-mcp-server.service.spec.ts` suite fails to run, and every test in it stops running, including all the tests that were there before. The lane report describes this run as "2806 passed". That number is true, but this suite is not part of it, because it never ran.

## Per-comment status

| # | Comment | Status | Evidence |
| - | ------- | ------ | -------- |
| 1 | `tool-output-capper.ts:322` — numLines counts terminal `\n` | FIXED (spec does not pin it) | Code: `tool-output-capper.ts:322-324`. The spec at `tool-output-capper.spec.ts:201-227` mocks the outline as `'first\nsecond\n\n[outline: …'`. `TRAILER_SEPARATOR` is `'\n\n'` (`tool-output-capper.ts:55`), so the slice at `:315-318` yields `'first\nsecond'`, which has no terminal newline. The old code also returns 2, so the test passes before the fix too. |
| 2 | `session-query-executor.service.ts:371` — older run reclaims newer run's id (MAJOR) | FIXED | `bind` keeps a newer owner (`:372-375`). `release` compares run order (`:326-327`). Run order is monotonic per executor (`:433`, `:579`). The spec `session-query-executor.service.spec.ts:1099-1112` fails on the old code: the older run overwrote the owner token, then unregistered NEW. It passes now. |
| 3 | `stream-transformer.ts:347` — async callback rejection unhandled | FIXED | A promise-like result gets `.catch(logCallbackFailure)` (`stream-transformer.ts:353-362`). A synchronous throw is still caught (`:363-364`). The spec `stream-transformer.spec.ts:3335-3352` asserts the warn call. |
| 4 | `subagent-registry.service.ts:856` + sibling `subagent-hook-handler.ts:458-462` — scope held-start discard to parent session | PARTIAL | The registry's already-registered branch is scoped (`subagent-registry.service.ts:853`). The bind path is scoped (`:875`). The store filters by parent and deletes the key when the list empties, so nothing leaks (`subagent-state-store.ts:339-351`). **The sibling CodeRabbit named is untouched**: `subagent-hook-handler.ts:461` still calls `discardHeldUnboundStarts(input.agent_id)` with no session, although `handleSubagentStop` has `parentSessionId` in scope (`:417`). |
| 5 | `stdio-mcp-server.service.ts:234` — duplicate `session_submit` id overwrites entry | FIXED in code; spec BROKEN | The refusal checks both maps before registering (`stdio-mcp-server.service.ts:224-240`). The first call's `inFlightSubmits` entry is never touched, so it still dispatches, settles and gets its reply (`:241-251`). The spec fails to compile with TS2322 at `stdio-mcp-server.service.spec.ts:821`. See the Serious issue below. |
| 6 | `agent-monitor.store.ts:2119` — stamp a later-known parentSessionId | FIXED | `agent-monitor.store.ts:2119-2121` fills in the session only when it is `undefined`, so a known session is never overwritten. The spec `agent-monitor.store.spec.ts:2207-2215` fails on the old code: the session clear missed the entry and the usage was attached on start. It passes now. |

## Five logic questions

### 1. How does this fail silently?

- The stdio spec suite stops running all of its tests, and the lane reported a green test count (`stdio-mcp-server.service.spec.ts:821`; report line 32). Every regression guard in that file, old and new, is off.
- The capper spec passes on the old code (`tool-output-capper.spec.ts:211`), so it would not catch the bug returning.

### 2. What user action produces unexpected behaviour?

A SubagentStop in session A for an agent with no record still deletes every held start with the same `agentId`, including session B's start (`subagent-hook-handler.ts:461` → `subagent-state-store.ts:341-343`). When B's Task result arrives, the bind returns `no-held-start`. B's subagent is then unreachable for stop, steer and budget stop.

### 3. What input data produces a wrong answer?

No new wrong-answer path was found in the changed code. `outline === '\n'` now counts as 1 line, which is defensible.

### 4. What happens when a dependency fails?

- `runGuardedCallback` now covers async observers. A thenable whose `then` getter throws is caught by the outer `try` (`stream-transformer.ts:353-365`). OK.
- When a run loses ownership of an id, it still sets `this.sessionId` and feeds coordinator events (compacting status, turn end, context usage) to the newer run's session (`session-query-executor.service.ts:246-262`, `:370`). This was already true for the overlap case before this change, and the fix does not make it worse.

### 5. What is missing that the requirements never mentioned?

- The wrapper path checks only `inFlightCalls` (`stdio-mcp-server.service.ts:264`). A wrapper call can reuse the id of a `session_submit` that is still in flight. A peer cancel then aborts the wrapper and returns before it marks the submit (`:387-391`), so the submit's reply is sent even though the peer cancelled. This is the mirror of comment 5.
- No registry-level spec covers the scoped discard in the already-registered branch (`subagent-registry.service.ts:853`). Only the store method is tested.

## Failure modes

### Stdio spec suite does not compile

- Trigger: `nx test vscode-lm-tools`, which CI runs.
- Symptom: `stdio-mcp-server.service.spec.ts` reports "Test suite failed to run" with TS2322: `jest.fn(() => new Promise…)` is typed `Mock<…, []>`, but `jest.Mocked<ISessionSubmitHandler>['dispatch']` needs `[MCPRequest, unknown]`. The project fails with 1 suite failed and 86 passed. I reproduced this.
- Evidence: `stdio-mcp-server.service.spec.ts:819-823`; signature at `session-submit.port.ts:51`.
- Current handling: none. The lane recorded the Nx failure but did not investigate it.
- Recommendation: type the mock, for example `jest.fn<Promise<MCPResponse>, [MCPRequest, unknown]>(() => new Promise((resolve) => { finish = resolve; }))`. Also assert the first call's settled response (`expect((await first).result).toBeDefined()`), so "the first call still gets its reply" is actually pinned.

### Cross-session held-start loss on the stop path

- Trigger: two sessions hold starts for the same `agentId`, and session A's SubagentStop finds no record.
- Symptom: session B's held start is dropped, B's Task result cannot bind, and B's subagent is unreachable.
- Evidence: `subagent-hook-handler.ts:458-462`.
- Current handling: unscoped discard.
- Recommendation: pass `parentSessionId` (`:417`), or the resolved hook session id, to `discardHeldUnboundStarts`. Add a hook-handler spec that asserts the second argument.

### Capper regression spec does not exercise the fix

- Trigger: the terminal-newline fix is reverted.
- Symptom: the spec still passes.
- Evidence: `tool-output-capper.spec.ts:211` together with `tool-output-capper.ts:55,315-318`.
- Recommendation: use a mock outline whose outline part keeps its own newline, for example `'first\nsecond\n\n\n[outline: …]'`, and expect 2.

### Wrapper call reusing an in-flight submit id

- Evidence: `stdio-mcp-server.service.ts:264` and `:387-394`.
- Recommendation: check `inFlightSubmits` in the wrapper path as well.

## Blocking issues

None.

## Serious issues

### New `session_submit` spec breaks the whole stdio-mcp-server spec suite

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts:821`
- Scenario: any test run of `vscode-lm-tools`, locally or in CI.
- Impact: the project's test target fails, and every existing stdio-server test (dispatch, cancel, settle) silently stops guarding. The fix for comment 5 is not verified by any spec that runs.
- Fix: type the `jest.fn` generics as shown above, then rerun `nx test vscode-lm-tools` and confirm the suite runs.

## Moderate and minor issues

- Moderate: `subagent-hook-handler.ts:461` is the unscoped sibling CodeRabbit explicitly named, so comment 4 is only PARTIAL.
- Moderate: `tool-output-capper.spec.ts:211` is a vacuous regression test.
- Minor: `stdio-mcp-server.service.ts:264` does not check `inFlightSubmits` (the mirror duplicate-id gap).
- Minor: the Major spec (`session-query-executor.service.spec.ts:1099-1112`) does not assert that NEW is unregistered when the newer run is later aborted, so the hand-back is not pinned. The legitimate rekey release is still covered by the existing `release(REAL)` spec just above it.
- Minor: git warns that `stream-transformer.ts` has CRLF line endings in the working copy. The lane may have rewritten the file with CRLF, and `format:check` may flag it.

## Data flow (Major fix)

1. `executeQuery` creates a tap with `++nextRunOrder` (`:579`). OK: monotonic per executor instance.
2. `handle` sees a new `session_id` and calls `bind` (`:246`). OK.
3. `bind` claims the id only if it has no owner or the owner is older or equal (`:372-375`). OK: an older run cannot reclaim the id. A legitimate rebind (no owner, or the same run) still claims it.
4. `release` collects the tracked ids, the subagent ids and the `currentId` rekey targets (`:318-322`), and skips any id whose owner is a different run (`:326-327`). OK: the older run leaves NEW alone. An id that nobody bound (a rekey that happened after the stream ended) is still released (FM-5 is kept).
5. The owner releases and deletes the `runOwners` entry (`:328`). OK: no leak while `release` is reached. A run whose release never fires keeps its entries, which is pre-existing.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| C1 numLines terminal newline | COMPLETE (code) | The spec does not pin it. |
| C2 run-order ownership (Major) | COMPLETE | — |
| C3 async callback rejection | COMPLETE | — |
| C4 parent-scoped held-start discard | PARTIAL | `subagent-hook-handler.ts:461` is not scoped. |
| C5 duplicate `session_submit` id refusal | PARTIAL | The code is correct, but its spec does not compile and takes the whole suite down with it. |
| C6 late parentSessionId stamp | COMPLETE | — |

Implicit requirements not addressed: the mirror duplicate-id check on the wrapper path.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Newer run binds NEW, then the older run rekeys to NEW | YES | `owner <= runOrder` guard | — |
| Older run alone rekeys and releases | YES | No owner or same owner | — |
| Newer run released first, then the older run binds the id | YES | Entry deleted, so the older run claims it | Acceptable. |
| Held start whose `parentSessionId` is undefined | YES | Falls back to delete-all (`subagent-state-store.ts:341-343`) | Same as the old behaviour. |
| Duplicate submit id while the first is in flight | YES | Refused, and the first call is untouched | Spec broken. |
| Wrapper call reusing a submit id | NO | — | A cancel goes to the wrapper only. |

## Verdict

- Recommendation: REJECT
- Confidence: HIGH (the compile failure was reproduced locally)
- Top risk: the new `session_submit` spec does not compile, so the whole stdio-mcp-server suite stops running and CI goes red, while the lane reported its tests as passing.
- What a robust fix would add:
  - Correctly typed `dispatch` mock, plus an assertion on the first call's reply.
  - Parent-scoped discard at `subagent-hook-handler.ts:461`.
  - A capper spec whose outline keeps a terminal newline.
  - An `inFlightSubmits` check on the wrapper path.

## Re-review (revise round 1)

Scope: `git diff` of the uncommitted working tree for the five claimed fixes, and every `discardHeldUnboundStarts` call site (`grep` over `libs`/`apps`, non-spec). Suites were not re-run, as instructed.

| # | Claim | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Typed `dispatch` mock (TS2322) | FIXED | `stdio-mcp-server.service.spec.ts:819-828`: `(_request: MCPRequest, _args: unknown) => Promise<MCPResponse>`, `cancel` supplied, types imported at `:42-43`. The test now also awaits `first` after `finish(...)` (`:838-839`). |
| 2 | Logging in the `.catch` handler | FIXED | `stream-transformer.ts:361-369`: the rejection handler calls `logger.warn(failureMessage, { ...context, error })`, so async failures are still logged. The sync path keeps `logCallbackFailure` (`:346-352`, `:371-372`). |
| 3 | LF line endings | FIXED | `grep -c $'\r'` returns 0, and the diff for the file covers only the changed hunk. |
| 4 | Held-start discard scoped to the parent session | NOT FIXED (regression) | See B1. The store and registry changes are correct (`subagent-state-store.ts:339-351`, `subagent-registry.service.ts:853`, `:875`, `:894-895`). The hook call site passes the wrong id. |
| 5 | Capper fixture fails on old code | FIXED | `tool-output-capper.spec.ts:213` mocks `'first\nsecond\n\n\n[outline: …]'`. With `TRAILER_SEPARATOR = '\n\n'` (`tool-output-capper.ts:55`), `outline = 'first\nsecond\n'`. The old `split('\n').length` gives 3 and the new code (`:322-324`) gives 2, so the test pins the fix. |

### Call-site check for fix 4

- `subagent-registry.service.ts:853`: `existing.parentSessionId` is the session of the bound record. Correct.
- `subagent-registry.service.ts:875`: `start.parentSessionId` comes from the single held start being bound. Correct.
- `subagent-hook-handler.ts:461-464`: **wrong id.** This passes the raw closure `parentSessionId` (the `handleSubagentStop` parameter, `:416`). The start was held under `resolveHookSessionId(input.session_id, parentSessionId)`, which prefers the payload (`:249-252`, `:279`, `:336-339`). Lines `:243-248` of the same file say the closure is `''` for a new session and `undefined` for a one-shot internal query.

### B1 (Blocking, new): stop-before-result discard misses the held start

- File: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:461-464`
- Scenario:
  - **Closure `''` (a new session, the common first-turn case):** `subagent-state-store.ts:345-347` keeps every start whose `parentSessionId !== ''`, so nothing is discarded. The held start survives its own SubagentStop. The later Task result then binds it at `subagent-registry.service.ts:874-880`, producing a running record for an agent that has already finished. That is the zombie the comment at `:459-460` exists to prevent. The pre-revise unscoped call did not have this failure, so this is a regression.
  - **Closure is a tab id while the payload carries the real session id** (the tab-to-real migration at `subagent-registry.service.ts:719-720` shows this happens): same miss.
  - **Closure `undefined`:** falls back to delete-all (`subagent-state-store.ts:341-343`), so the cross-session drop that fix 4 targeted still happens for one-shot queries.
- Impact: the agent monitor shows a running subagent that has finished. Nothing errors or logs, because `count` is 0 and the debug log at `subagent-registry.service.ts:896` is skipped.
- Test gap: the new spec `subagent-hook-handler.spec.ts:627-648` asserts this bug. `stopInput` sets `session_id: 'payload-parent-sess'` (`:618`), yet the spec expects the discard with the closure id `'parent-a'`. The start for that payload would have been held under `'payload-parent-sess'`. The state-store spec only proves the store filter, not the hook wiring.
- Fix: pass `resolveHookSessionId(input.session_id, parentSessionId) ?? undefined`, the same resolution the start hook and line 429 use. Change the spec to expect `'payload-parent-sess'`, and add a case with an empty payload `session_id` that expects the closure id.

### Other new issues

- No other new Blocking or Serious issues.
- Minor: `stream-transformer.ts:362-368` repeats the body of `logCallbackFailure` (`:346-352`) inline. The repeat is behaviour-neutral and appears to exist only to satisfy the degradation audit.
- Style (for the style reviewer): `:350` likely exceeds Prettier's line width.

### Verdict (revise round 1)

- Recommendation: REJECT. Fixes 1, 2, 3 and 5 are FIXED. Fix 4 is NOT FIXED and adds a Blocking regression (B1).
- Confidence: HIGH. The id mismatch is visible in the source at `:249-252` vs `:461-464`, and the new spec's own fixture shows it.
- Required for approval: B1 fix plus corrected spec. Nothing else is outstanding from this round.

## Re-review (revise round 2)

Scope: `git diff` of `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (+16/-4) and `subagent-hook-handler.spec.ts` (+89). Context read: the hold site `bindStartByAgentId` (`:323-350`), its call site (`:278-279`), and the store method `subagent-state-store.ts:339-351`. I did not run the specs; this verdict comes from reading the code.

### B1 (round 1): FIXED

- **One resolver for every call site.** A new private method `resolveParentSessionId` (`:571-576`) wraps `resolveHookSessionId`. Four call sites now use it:
  - the start hook's resolved id (`:249`), which is the only id passed to `bindStartByAgentId` (`:279`) and so to `holdUnboundStart` (`:336-340`);
  - the stop hook's identity record (`:429`);
  - the stop hook's discard (`:461-465`);
  - the stop fan-out (`:508`).
  
  The handler has no other `holdUnboundStart` or `discardHeldUnboundStarts` call. Hold and discard now resolve the id the same way: payload first, then closure, with `''` treated as absent.
- **No held start is left behind.**
  - A start is held only when the id resolves (`:278`). A start with no id goes to the WARN branch (`:280`) and is never held.
  - On stop, the payload id normally matches the id used for the hold, so the filter at `subagent-state-store.ts:344-350` drops it.
  - If the stop resolves to `null`, `?? undefined` sends the store to its "drop all for this agent" branch (`:341-343`). That is broader than needed, but it cannot leave a start behind.
- **A held start of another parent session is kept.** When the id resolves, the store keeps only starts whose `parentSessionId` differs (`:344-346`).
- **The specs would fail on the round-1 code.**
  - `:627-662` uses closure `'parent-a'` and payload `'payload-parent-sess'`, and expects `discardHeldUnboundStarts('shared-agent', 'payload-parent-sess')`. Round 1 passed `'parent-a'` (or no second argument at HEAD), so this assertion fails on that code.
  - `:664-714` runs with closure `''` and with closure `undefined`. It drives the real start hook, asserts the start was held under `'payload-parent-sess'` (`:702`), and asserts the discard uses that same id (`:706-709`). Under round 1 the closure-derived argument was `''` or `undefined`, so both cases fail.

### New issues

- No new Blocking or Serious issues.
- Minor: the "parent-b kept" assertion (`:660`) depends on the spec's mock filter (`:633-638`), not on the real store. The store filter is covered only by the state-store spec, so the two halves are tested separately and never together.
- Minor: `:711` and `:713` are the same assertion repeated. The comment says "a later Task result has no held start to bind", but nothing calls the binder.
- Minor: round 1 asked for a discard case where the payload `session_id` is `''` and the closure is a real id (closure fallback). No such case was added. The resolver's fallback is shared with the start path, which has a spec (`:425`), so the risk is low.
- Moderate (existing edge, not a regression): when neither the stop payload nor the closure carries an id, the discard drops held starts for this `agentId` in every parent session (`subagent-state-store.ts:341-343`). In practice agent ids are unique per subagent, so this matters only if two sessions share an agent id, as in the shared-agent spec.

### Verdict (revise round 2)

- Recommendation: APPROVED. B1 is fixed, and fixes 1-5 are all FIXED.
- Confidence: HIGH. Both the hold and the discard get their id from `resolveParentSessionId`, and the new specs pin the payload-resolved id.
