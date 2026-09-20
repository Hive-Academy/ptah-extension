# Code Logic Review — `TASK_2026_466_b70b`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 3/10     |
| Assessment          | REJECTED |
| Blocking issues     | 2        |
| Serious issues      | 1        |
| Moderate issues     | 1        |
| Failure modes found | 4        |

## Verdict

**reject** — displacement closes the original straight-line leak, but a late cleanup can delete the replacement record, the 16-bit name nonce does not meet the no-collision requirement, and refused/no-owner binds can still be announced.

## Findings

1. **High — cleanup of the displaced record can delete the replacement record.** `SessionRegistry.remove` deletes `byTabId` solely by `rec.tabId`, without checking that the map still contains that exact record (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306`). Concrete scenario: query A registers tab T and awaits preflight/SDK initialization; query B registers T, displaces A, and becomes the current record; A then throws during initialization and its catch calls `remove(A)` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:362`), which deletes B's `byTabId` entry. The same race exists when `endRecord(A)` has captured A and is awaiting its up-to-five-second interrupt; B registers T during that await, then A's unconditional deregistration calls `remove(A)` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:227`). B remains running but is no longer discoverable by tab, and later binding/cleanup reports `no-record`. Make removal identity-conditional for both indexes (`map.get(key) === rec`) and recompute activity only when this call actually removed the current tab record.

2. **High — the new registry suffix is probabilistic, not unique per live process.** `NONCE_LENGTH` is four hex characters and the implementation discards half of `randomBytes(4)` by slicing the hex string to four characters (`libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:68`, `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:94`). Concrete scenario: two restarts of the same tab draw the same 16-bit value (1 in 65,536 for a pair); both have the same six-character routing head and therefore receive the same full registry name. Across many restarts the birthday risk grows quickly, and no duplicate check catches it. This directly fails the acceptance criterion that two live sessions never share a registry name. Use an allocation identity that is unique within the registry's collision domain, or perform atomic collision detection/retry; merely lengthening a random suffix reduces rather than eliminates the failure.

3. **Medium — `no-record` and `invalid` bind results still produce a success-looking session announcement.** `bindRefusedAsStale` suppresses only `stale-mismatch` and treats every other outcome as permission to continue (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1004`). Both the new-session callback (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:963`) and resume callback (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:867`) then emit and notify. Concrete scenario: a session is ended or an older initialization loses the cleanup race above, its SDK process emits `init` late, `bindRealSessionId` returns `no-record`, and the adapter still tells RPC/webview consumers that the tab resolved to that unregistered session. Only `bound`, `already-bound`, or `rebound` should announce; `no-record`, `invalid`, and `stale-mismatch` should stop.

4. **Medium — the ownership capability is written to logs.** Displacement logs `previous.token` verbatim (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:552`). The token is the proof accepted for a rebind at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:254`, and the public lifecycle method accepts any supplied string (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:365`). Concrete scenario: an in-process caller or diagnostic integration that can read application logs obtains the current registration token and can pass it to move that record from its real session id to an arbitrary nonblank id. The UUID is not realistically guessable, and I found no persistence or RPC serialization of the token, but logging defeats the intended opacity. Remove the token from log output (or log only a non-reusable fingerprint).

## Five logic questions

### 1. How does this fail silently?

A displaced record's later `remove(rec)` can erase the replacement's `byTabId` entry because removal is key-based rather than identity-based (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306`). The replacement process continues running while registry lookups say it does not exist. Separately, `no-record` is converted into a normal downstream announcement (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1014`).

### 2. What user action produces unexpected behaviour?

Restarting or re-querying the same tab while the previous query is still initializing or being interrupted can let the previous cleanup delete the new record (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:362`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:247`). The new chat then runs without a registry binding.

### 3. What input data produces a wrong answer?

Two same-tab starts that receive the same four-hex-character random suffix produce the same registry name (`libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:89`). A late SDK `init` for a tab with no registered record also produces a false resolved-session notification (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1009`).

### 4. What happens when a dependency fails?

If preflight, module loading, option construction, or query invocation fails after another registration has displaced the failing record, the catch removes the newer record (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:236`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:362`). Abort itself is caught and logged during displacement, but a throwing abort leaves the old process potentially alive after both indexes have already been removed (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:548`).

### 5. What is missing that the requirements never mentioned?

The registry needs a general ownership rule for every deletion and secondary-index update, not only for rebind. It also needs an allocation/collision protocol for names; entropy alone is not an uniqueness guarantee. These gaps are visible at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306` and `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:94`.

## Failure modes

### Late cleanup removes the new owner

- Trigger: Registration A is displaced by B while A is awaiting initialization or interrupt, then A reaches cleanup.
- Symptom: B's query remains live, but `find(tabId)` returns nothing and future binds/teardowns target no record.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:362`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:227`.
- Current handling: Cleanup unconditionally deletes entries by A's keys.
- Recommendation: Delete only when each key still maps to A.

### Same-tab name collision

- Trigger: Two live processes for the same routing id draw the same 16-bit nonce.
- Symptom: Both register the same name, leaving peers unable to select the intended process.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:68`; `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:94`.
- Current handling: No collision detection or retry.
- Recommendation: Allocate through an authoritative uniqueness domain or detect-and-retry atomically.

### Refused/no-owner bind is announced

- Trigger: A late init arrives after the tab record has been removed.
- Symptom: RPC/webview consumers are told the tab resolved to an id the registry does not contain.
- Evidence: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1009`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:975`.
- Current handling: Only `stale-mismatch` stops announcement.
- Recommendation: Announce only successful outcomes.

### Ownership token leaks into diagnostics

- Trigger: Any displacement of an existing tab record.
- Symptom: The capability that authorizes rebind is recoverable from logs.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:552`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:254`.
- Current handling: Full token is included at warn level.
- Recommendation: Never log the token; use a non-reusable fingerprint if correlation is needed.

## Blocking issues

### Old cleanup can deregister the replacement

- File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306`
- Scenario: A is captured, B displaces it under the same tab, then A's async cleanup runs.
- Impact: The live replacement becomes unreachable and can later be announced without a binding.
- Fix: Make `remove` compare record identity before deleting either index and before recomputing last-active state.

### Registry-name uniqueness is not guaranteed

- File: `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:94`
- Scenario: Same-tab processes draw the same four-hex suffix.
- Impact: The incident's ambiguous peer routing can recur.
- Fix: Use collision-aware allocation with an authoritative live-name check or another actually unique process registration identity.

## Serious issues

### Non-successful bind outcomes still announce

- File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1014`
- Scenario: A late init arrives when no record owns the tab.
- Impact: Consumers accept a session identity the registry refused to establish.
- Fix: Allow notification only for `bound`, `already-bound`, and `rebound`.

## Moderate and minor issues

- Moderate: the rebind capability is logged verbatim at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:552`.

## Data flow

1. `SdkAgentAdapter` starts or resumes and calls `executeQuery` — OK (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:705`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:847`).
2. `SessionQueryExecutor` registers by tab id — GAP: this aborts/removes the previous record, but does not prevent its later cleanup (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:118`).
3. Query options generate `--name` — GAP: the suffix has only 16 random bits and no collision protocol (`libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:94`).
4. SDK emits init; the callback supplies the captured owner token — OK for distinguishing current versus displaced records (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1009`).
5. Registry binds/rebinds/refuses — OK for `stale-mismatch`; GAP for key ownership during later removals (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:229`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:306`).
6. Adapter announces — GAP: `no-record` and `invalid` are treated as success (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1014`).

## Requirements fulfilment

| Requirement                                     | Status   | Gap                                                                                                       |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Displacement aborts the old query               | PARTIAL  | Controller is fired, but abort failure is only logged and late old cleanup can remove the new record.     |
| Both registry indexes drop the displaced record | PARTIAL  | Immediate displacement clears both, but later key-only removal can corrupt replacement ownership.         |
| Name is unique per live process                 | MISSING  | Four random hex characters are collision-prone and unchecked.                                             |
| Owner token permits only the owner to rebind    | PARTIAL  | UUID generation is strong and stale tokens fail, but the live capability is logged.                       |
| Refused bind never announces                    | PARTIAL  | `stale-mismatch` is suppressed; `no-record` and `invalid` are not.                                        |
| Legitimate bind announces                       | COMPLETE | Both new and resume callbacks announce after `bound`/`rebound`; existing same-id init remains idempotent. |
| No platform-adapter import                      | COMPLETE | Search found no production adapter import in the changed library.                                         |

Implicit requirements not addressed: identity-safe deletion after asynchronous work; deterministic handling of name collisions; capability-token redaction.

## Edge cases

| Case                             | Handled | How                                                                                    | Concern                                                               |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Empty real session id            | YES     | New-session callback rejects it before metadata/bind; registry also returns `invalid`. | Resume callback lacks the same precheck and would announce `invalid`. |
| Repeated same-id init            | YES     | Returns `already-bound`.                                                               | It announces again if the SDK emits init twice.                       |
| Concurrent same-tab registration | NO      | Second registration displaces first.                                                   | First's later cleanup can delete second.                              |
| Displaced token attempts rebind  | YES     | Token mismatch returns `stale-mismatch`.                                               | Current token is logged.                                              |
| Abort throws                     | PARTIAL | Exception is narrowed and logged.                                                      | Old process may survive after registry entries are gone.              |
| Same random name nonce           | NO      | No detection.                                                                          | Violates the no-shared-name criterion.                                |

## Claims I verified

- The direct displacement path deletes the old tab and real-session indexes before setting the replacement, and calls the old controller's `abort()` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:543`).
- A stale token cannot rebind a replacement record because equality is checked against the current record (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:254`).
- The token is a `randomUUID`, is not serialized or persisted by the reviewed change, and is not sent over RPC in the searched call graph (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:181`). It is, however, logged.
- Both changed announce paths consult the bind outcome; only `stale-mismatch` currently stops them (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:869`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:965`).
- The package barrel newly exports `buildUniqueSuffix` (`libs/backend/agent-sdk/src/index.ts:207`). This is broader public surface than the current internal caller needs, but I found no behavioural break from the export itself.
- No changed production file imports a concrete platform adapter. Changed catches use `unknown`/runtime narrowing, and no `@ts-ignore` was introduced.
- The required uncached target command completed successfully: `npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache` (exit code 0). `git diff --check` also completed successfully.

## Claims I could not verify

- I could not verify that aborting the SDK query terminates the old operating-system process; the reviewed unit test proves only `AbortSignal.aborted` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry-restart-identity.spec.ts:36`).
- I could not verify a live `forkSession` resume against the installed SDK; the owner-token rebind is covered only at the registry level (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry-restart-identity.spec.ts:102`).
- I could not verify uniqueness because the implementation cannot guarantee it; the two-build test itself has a 1-in-65,536 chance of failing when both random suffixes match (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts:385`).

## Verdict

- Recommendation: REJECT
- Confidence: HIGH
- Top risk: a displaced query's delayed cleanup can erase the new session's registry ownership, recreating a stale/unresolvable tab through a different interleaving.
- What a robust implementation would add: identity-checked removal from both maps; success-only announcement; non-logged capability tokens; collision-aware registry-name allocation; regression tests that hold A's initialization/interrupt open while B registers, then release A and assert B remains in both indexes.
