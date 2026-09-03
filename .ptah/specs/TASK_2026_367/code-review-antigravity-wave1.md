# TASK_2026_367 — Antigravity wave 1 code review

Reviewed commits:

- `1d5933d9e` — B1, C1 stderr classifier + C2 spawn log
- `298b59d27` — B2, C6a preflight coalescing + external-pass credit
- `ec431d4cc` — B6, C5a-now abort guard + C5b Logger serialization

The review used each commit's exact tree (`git show <sha>:<path>`) because the shared working tree contains later, uncommitted work, including changes to B1 files. Line references below are the reviewed commit's line numbers.

## Verdicts

| Commit           | Verdict                | Summary                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1d5933d9e` (B1) | **APPROVE WITH FIXES** | The shared classifier, four adapter substitutions, SDK callback wiring, message format, and resolved spawn-model log conform to the plan. The registry violates the classifier's ANSI-stripped input contract, so a colored error can be silently demoted to DEBUG. |
| `298b59d27` (B2) | **APPROVE WITH FIXES** | Normal coalescing, force semantics, root normalization, health credit, and disposal are correct. A synchronous failure before the first `await` can run the cleanup before the map insertion and permanently cache a rejected promise.                              |
| `ec431d4cc` (B6) | **REJECT**             | Logger serialization and `EndSessionOutcome` are correct, but the frontend abort guard is scoped to a session rather than a turn. Normal later turns reuse the same session ID, so a legitimate later Stop can skip the RPC and leave the backend running.          |

## Findings

| ID  | Severity   | Commit | Evidence                                                                                                                                                                                                                                                       | What is wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Required fix                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **HIGH**   | B6     | `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:47-59,173-202`; `libs/frontend/chat/src/lib/services/message-sender.service.ts:306-312,617-652`; `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts:351-399` | `_lastAbortedSessionId` is cleared only when `currentSessionId()` changes. A normal follow-up message calls `chat:continue` with the existing session ID and starts another streaming turn without changing that ID. Stopping that later turn hits the stale marker, skips `chat:abort`, finalizes/idles only the UI, and may leave the backend turn running. The same marker also remains after a thrown or unsuccessful abort RPC, even though the request may not have reached the backend. The added spec changes `sess-1` to `sess-2`, so it passes while the common same-session next-turn path is broken.                                                                                                       | Scope the marker to a turn identity (for example session ID plus streaming message/turn ID), or explicitly clear it when a new turn starts even if the session ID is unchanged. Clear it after a thrown/unsuccessful abort so retry remains possible. Add regressions for `sess-1/msg-1` abort → new `sess-1/msg-2` turn → second RPC, and for retry after transport/negative-result failure.                                            |
| F2  | **MEDIUM** | B1     | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.ts:8-12`; `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:682-692`; pinned SDK `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:60`              | The classifier documents an already ANSI-stripped line, and all four adapters strip/trim before calling it. The SDK `stderr` callback receives the raw `Buffer.toString()` chunk, but the registry passes that raw chunk directly. For `\x1b[31mError\x1b[0m: ENOENT`, the escape terminator `m` is a word character immediately before `Error`, so the leading `\b` does not match; the real error is logged at DEBUG.                                                                                                                                                                                                                                                                                                | Strip ANSI (and trim for classification) in `handleChildStderr` before calling `classifyCliStderr`, while retaining the original data in the existing log message if byte-for-byte log text is desired. Add an ANSI-colored error callback test.                                                                                                                                                                                         |
| F3  | **MEDIUM** | B2     | `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:164-203`                                                                                                                                                                             | The async IIFE begins executing before `inFlight.set`. If `resolveTimeout()` synchronously throws (its injected `readTimeoutMs` callback is not guarded), the IIFE's `finally` deletes an entry that has not been inserted yet; line 203 then stores the already-rejected promise. Every later caller for that root joins the permanently rejected promise. This also violates the service's documented “every path returns health or null” contract. Timeout, reconcile rejection, and abort after the first `await` do clean up correctly. All three current host readers catch their own errors, which lowers present-day likelihood, but `HarnessPreflightDeps` does not state or enforce a never-throws contract. | Create/store the shared promise before attaching cleanup, preferably by moving one pass into an async method and using `const pass = this.runPass(...); const shared = pass.finally(() => conditionalDelete); inFlight.set(root, shared)`. Guard timeout configuration failures and degrade to `null` or the default. Add a test with a throwing `readTimeoutMs`, then recover it and prove a forced second call starts a new reconcile. |
| F4  | **LOW**    | B1     | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts:39-46`                                                                                                                                                             | The claimed abort word-boundary assertion uses `process terminated`; that string does not contain `abort`, so the test would also pass if `abort` were matched without word boundaries. The implementation's regex is correct, but this assertion does not pin it.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Replace or supplement it with a string that contains `abort` as a non-word, such as `abortive`, and expect `info`.                                                                                                                                                                                                                                                                                                                       |
| F5  | **LOW**    | B2     | `libs/backend/harness-sync/CLAUDE.md:789-804`; plan §8 lines 790-794                                                                                                                                                                                           | B2 changed `CLAUDE.md`, although the plan's exhaustive file list names only the service and new spec. The documentation is accurate, but the batch report's “no deviations” claim is not accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Either record the documentation change as an approved plan deviation or remove it from this commit if exact file scope is required.                                                                                                                                                                                                                                                                                                      |

## Plan conformance and assertion coverage

### B1 — C1 shared stderr classifier and C2 spawn log

- [x] Pure leaf module, private regex, `CliStderrSeverity = 'error' | 'info'`, and the planned function signature (`cli-stderr-severity.ts:1-12`).
- [x] All four adapters use the shared classifier after their existing ANSI stripping/trimming. Their `output.emit` and `segment.emit` content is unchanged (`antigravity-cli.adapter.ts:518-534`, `opencode-cli.adapter.ts:484-488`, `pi-cli.adapter.ts:414-425`, `copilot-sdk.adapter.ts:363-374`).
- [x] The registry wires the named callback into the same SDK `options.stderr` slot and preserves the exact message template (`ptah-cli-registry.ts:682-692,739`).
- [x] Registry severity maps classifier `error` to WARN and `info` to DEBUG; no callback branch calls `logger.error`.
- [ ] Registry input normalization is incomplete: raw SDK stderr is not ANSI-stripped before entering a function whose contract requires that preprocessing (F2).
- [x] Unrecognized-model notice → `info`.
- [x] Connector notice → `info`.
- [x] `Error: ENOENT` → `error`.
- [~] The plan's literal `terminated` assertion exists, but it is non-discriminating for the `abort` word boundary (F4). Other keywords receive some real boundary coverage via `refusedness`.
- [x] Registry spec asserts benign → DEBUG, match → WARN, never ERROR.
- [x] Spawn test uses opus mapping, requires `glm-5.2:cloud` and `tier: opus`, and excludes the sonnet mapping.
- [x] The wrong local recomputation was deleted. `resolveEffectiveTiers` is not dead: it remains called at `ptah-cli-registry.ts:409,615,1218` and is defined at line 1367.
- [x] No unplanned production behavior or boundary change was found.

Test robustness: the registry callback test captures the actual SDK options and invokes the installed callback, so it is not tautological. It does not exercise ANSI input or require the full preserved message prefix. The classifier's `terminated` case is the weak assertion described in F4.

### B2 — C6a preflight coalescing and completed-pass credit

- [x] Same normalized root joins one in-flight promise; both callers receive the same object; reconcile is called once.
- [x] Different roots run independently.
- [x] `force: true` bypasses the throttle but joins an existing in-flight pass.
- [x] A post-settlement forced call starts another pass, proving normal successful cleanup.
- [x] The timeout budget remains 1500 ms.
- [x] Timeout, asynchronous reconcile rejection, and abort flow through the IIFE's `finally`; the older service specs still exercise those outcomes.
- [ ] Cleanup is not correct for a synchronous failure before the first `await`, and no spec exercises that ordering (F3).
- [x] No two ordinary callers can both miss the map: root resolution is synchronous, and the first `ensure()` inserts the promise before it reaches its outer `await`/returns control.
- [x] The in-flight lookup occurs before throttling. This differs from the prose ordering at plan line 803 but is necessary to satisfy the plan's observable requirement that a concurrent caller join rather than return `null` from the pre-pass throttle stamp.
- [x] External health credit uses the normalized key. `HarnessReconcilerService.reconcile` normalizes its input before `runReconcile` (`harness-reconciler.service.ts:166-172`), and emitted health carries that normalized `workspaceRoot`.
- [x] The health-event spec proves the next same-root `ensure` is throttled without reconcile.
- [x] `dispose()` is idempotent: it invokes the callback once and then clears the field (`harness-preflight.service.ts:124-128`). Its spec proves listener removal. Current DI creates preflight and reconciler as same-lifetime values; no current shorter-lived production owner was found.
- [~] Accurate documentation was added outside the plan's declared file set (F5).

Test robustness: the deferred reconcile promises genuinely exercise overlapping calls and are not tautological. The cleanup test proves only successful settlement. Existing timeout/rejection tests prove returned behavior but do not follow with a forced call to prove the new map was cleared, and neither suite covers a synchronous pre-await exception.

### B6 — C5a-now abort guard and C5b Logger

- [x] `EndSessionOutcome` is exactly `'ended' | 'already-ended'`; the missing-record return is `already-ended`, and the completed teardown return is `ended` (`session-control.service.ts:37,120-130`). Throwing teardown paths reject rather than return an out-of-union value.
- [x] Missing record logs the planned INFO text, performs no teardown, and does not WARN; the spec covers all three.
- [x] The one-line `SessionLifecycleManager` adjustment was not listed in the plan, but it is necessary to preserve that facade's existing `Promise<void>` signature after the collaborator's return type widened (`session-lifecycle-manager.ts:431-435`). This is a justified compatibility edit.
- [x] First abort records the marker immediately before the RPC; repeat abort for the same session skips RPC and uses the local idle helper.
- [x] Changing `currentSessionId()` clears the marker and the spec proves a second RPC for the new ID.
- [ ] Starting a new turn on the same session does not clear the marker, and the test never models this normal continuation path (F1).
- [x] Angular 21 permits signal writes in effects by default; `allowSignalWrites` is deprecated and has no effect. The read is tracked and the marker write is untracked, so there is no Angular signal-write rule violation.
- [x] The duplicate-abort local path and both RPC failure branches call the same `idleAbortedTabLocally` helper. That helper conditionally finalizes an active streaming message and then marks the captured tab idle (`conversation.service.ts:178,214,230,270-287`).
- [x] `formatLogArg` preserves primitive conversion and the prior JSON serialization/fallback for non-Error objects, while serializing Error `name`, `message`, and `stack` (`logger.ts:19-35,221-228`).
- [x] The dead `serializeArgs` method was removed.
- [x] The Error spec checks message, name/stack evidence, and absence of `: {}`; plain-object behavior is covered; the added circular-object case covers the existing fallback.
- [x] No other standard Logger argument path directly calls `JSON.stringify`. Remaining calls at `logger.ts:282,305` format structured context metadata/extras rather than `warn/info/debug/error` argument arrays.

Test robustness: Logger and SessionControl tests hit the real formatter/control code and are not tautological. The abort test proves the narrow plan scenario, but can pass while a later live turn is unabortable because it changes the session ID before the third abort rather than changing only the turn identity.

## Repository-rule review

- No new frontend/backend or concrete-adapter dependency leak was found.
- Cross-library imports use public barrels; new classifier imports are same-library relative imports.
- Angular code remains signal-based and uses `inject()`; no `BehaviorSubject`, NgModule, Zone dependency, or unsafe HTML path was added.
- No new unsafe catch-variable dereference, `@ts-ignore`, validation duplication, or naming violation was found.
- New/modified focused files remain below the 700-line soft ceiling. `ptah-cli-registry.ts` is 1,427 lines at B1, but that is pre-existing; B1 removes duplicated logic into a named leaf and does not create the size issue.
- `git diff --check` is clean for all three commits.

## Verification performed

- Read the full three commit diffs, the specified surrounding code, implementation-plan sections 1, 2, 5 C5a-now, 6, and 8, all three batch reports, and root repository rules.
- Targeted current-tree specs passed:
  - B1 classifier: 1 suite, 5 tests.
  - B2 preflight service + coalescing: 2 suites, 21 tests.
  - B6 Logger: 1 suite, 3 tests.
  - B6 SessionControl: 1 suite, 10 tests.
  - B6 ConversationService: 1 suite, 13 tests.
- The current tree's reviewed B2/B6 files match their commits. B1's registry and registry spec have later uncommitted edits, so the exact B1 registry test was verified statically from the commit rather than represented as a commit-isolated rerun.
- The historic full-suite totals and baseline lint-warning counts in the batch reports were not independently reproduced in this dirty shared tree. One full `nx run-many` harness test attempt exceeded the review command timeout without output; the exact affected suites then passed directly as reported above.

## Unverified items

- No unverified defect candidate is included in the findings table.
- The batch reports' historical full-suite counts and “baseline warning” counts remain execution claims rather than independently reproduced evidence; this does not change the code findings or verdicts.

## Concrete fix order

1. **F1 / HIGH:** Make abort deduplication turn-scoped, clear it on a new same-session turn and on failed/throwing RPCs, and add same-session-next-turn plus failure-retry regressions. Do not build later abort behavior on B6 until this is fixed.
2. **F2 / MEDIUM:** ANSI-strip/trim the registry's raw SDK stderr for classification and add a colored-error callback regression.
3. **F3 / MEDIUM:** Reorder/refactor preflight promise creation so cleanup cannot precede insertion; catch timeout-reader failures and prove recovery with a forced second call.
4. **F4 / LOW:** Replace the non-discriminating `terminated`/`abort` boundary assertion with a string that actually contains `abort` inside a larger word.
5. **F5 / LOW:** Reconcile the extra B2 `CLAUDE.md` edit with the plan and batch report, or remove it from the commit.

REVIEW DONE — <1 high, 2 medium, 2 low>
