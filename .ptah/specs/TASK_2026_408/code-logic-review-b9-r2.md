# Code Logic Review — TASK_2026_408

## Summary

Batch 9, re-review round 2 of 2.

Verdict: REJECTED

Score: 7/10

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The three original findings are resolved. One uncommon dependency-hang path still violates bounded cleanup. The score reflects sound scenario assertions and successful real SDK execution, with a remaining lifecycle defect; it is not in the 5–6 band of the previous, ordinary failure-path defects. Batch 11 and the ownership correction are outside this review.

Locations below use `S` for `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts` and `R` for `libs/backend/platform-core/src/utils/process-tree-reaper.ts`.

## Previous findings

| Finding | Resolved | Evidence and assessment |
| --- | --- | --- |
| N1 — cleanup exceeds Jest deadline | YES, for the original awaited cleanup path | `S:54–72` sets 55 seconds execution plus 22 seconds cleanup and executes a load-time assertion against the 80-second allowance. Discovery has an actual 10-second subprocess timeout (`S:518–523`); kill wait, wrapper wait and survivor polling are bounded (`S:590–601`). The tree-test discovery loop can overshoot 20 seconds by one 10-second query, but still fits its 75-second limit including cleanup (`S:885–909`). N4 below concerns the underlying kill subprocess, not the original oversized await budget. |
| N2 — tree-kill test lacks unconditional cleanup | YES | The body and assertions are inside try/finally (`S:883–908`). Finally retries the wrapper tree and directly kills recorded live descendants. The current helper absorbs kill errors (`R:63–65`), and the direct kill is caught (`S:902–906`), so these cleanup operations do not replace the original assertion/discovery failure. |
| N3 — discovery errors falsely verify exit | YES | Discovery failure is retained, tree kill still runs, and cleanup rejects with explicit unverified-descendant evidence (`S:583–606`). Reported kill errors and survivors also reject (`S:613–621`). The outer timeout includes that diagnostic (`S:659–675`), and the tree test requires successful verification (`S:891`). In-memory probes confirmed both discovery and reported kill errors reject while still attempting tree termination. |

## NEW findings / failure modes

### N4 — Moderate: the kill wait expires without disposing the kill subprocess

- Trigger: Windows `taskkill` stalls beyond the four-second wait.
- Evidence: `S:590–595` races `killProcessTree` against a delay but neither cancels the operation nor records expiry. The Windows helper launches `taskkill` through `execFile` without a timeout or exposed cancellation handle (`R:55–60`). The finally path repeats the same uncancelled race (`S:896–899`).
- Symptom: the original wrapper/descendant checks can finish while the separate `taskkill` subprocess remains alive. That subprocess and its pipes can keep the Jest process alive beyond the claimed cleanup budget. If the original processes have independently exited, `killChildTree` can even resolve successfully while its kill operation is still pending.
- Current handling: survivor verification checks only the wrapper and its discovered descendants (`S:598`); `taskkill` is a child of the Jest process, not of that wrapper. The delayed helper is outside that verification set. Later callback errors may arrive after cleanup has returned.
- Evidence from fault injection: the actual extracted/transpiled `killChildTree`, with a never-settling kill dependency, successful discovery and no surviving target PIDs, returned `resolved` while that dependency remained pending. This establishes the control-flow gap; it does not claim the normal Windows run reproduced a hung `taskkill`.
- Impact: an uncommon OS-command hang can leave a referenced process outside the bounded cleanup contract. The ordinary target-process failure paths now fail loudly, so this is Moderate rather than the previous Serious findings.
- Recommendation: bound the underlying `execFile` operation itself, with termination and observed completion, and report expiry. A narrowly scoped optional timeout/cancellation contract on the existing helper would let both call sites retain their caller budgets. Add a fault-injection assertion that expiry disposes the kill operation as well as rejecting cleanup.

## Five logic questions

1. **How does this fail silently?** A kill-wait expiry is indistinguishable from completed termination when target PIDs are already absent (`S:590–595`, `S:598–621`); see N4. Discovery and immediate reported termination errors no longer disappear.
2. **What user action produces unexpected behaviour?** Running the suite while Windows termination tooling stalls can leave Jest alive after the scenario failure (`R:55–60`). The normal real wrapper/grandchild case passed (`S:871–909`).
3. **What input data produces a wrong answer?** No new scenario-data defect was established. Structural assertions still pair Skill and unknown-tool results with call IDs (`S:960–973`, `S:1101–1108`), enforce literal unknown-command forwarding (`S:1043–1063`), and check MCP alias replay and exact image content (`S:1162–1182`).
4. **What happens when a dependency fails?** Enumeration failure and reported kill failure reject with explicit evidence (`S:604–621`); the outer timeout preserves that evidence (`S:659–675`). A non-settling kill subprocess remains incompletely handled (N4).
5. **What is missing that the requirements never mentioned?** Termination machinery has its own process lifecycle. A deadline on awaiting it is insufficient to dispose it (`S:590`, `R:57`).

## Blocking issues

None established.

## Serious issues

None remaining in the reviewed revision.

## Moderate and minor issues

N4 above. No additional finding is asserted.

## Data flow

1. **OK:** pinned SDK/Zod resolution and isolated fixture setup (`S:82–145`, `S:779–801`).
2. **OK:** real SDK child launches and receives the scenario configuration (`S:626–650`, `S:714`).
3. **OK:** hard deadline enters bounded discovery and target-process verification, retaining cleanup diagnostics (`S:656–675`, `S:583–621`).
4. **GAP:** the kill dependency's own process is not cancelled by its wait deadline (N4).
5. **OK:** the dedicated tree test owns cleanup across discovery and assertion failures (`S:883–908`).
6. **OK:** scenario teardown closes the proxy/upstream and removes fixtures (`S:823`); the run root has afterAll cleanup (`S:860–863`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Executed budget assertion and compatible caller deadlines | COMPLETE | `S:54–72`, `S:518–523`, `S:590–601` |
| Unconditional tree-test cleanup without masking primary failure | COMPLETE for current helper contract | `S:893–908`, `R:63–65` |
| Honest discovery/kill failure reporting | COMPLETE for settled operations | `S:604–621`, `S:659–675` |
| Fully bounded termination machinery | PARTIAL | N4 |
| Real SDK scenario assertions remain non-vacuous | COMPLETE within mocked-upstream scope | `S:960–979`, `S:1043–1063`, `S:1101–1108`, `S:1162–1182`, `S:1276–1292` |

Implicit requirement not addressed: disposal of the subprocess used to perform termination.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Process discovery fails | YES | Still attempts kill, then rejects as unverified; `S:583–606` |
| Kill helper reports an error | YES | Diagnostic included in rejection; `S:613–621` |
| Recorded target survives | YES | Poll bounded, remaining PID reported; `S:598–618` |
| Tree-test assertion fails | YES | Finally attempts wrapper and descendant cleanup; `S:893–908` |
| Kill subprocess never completes | NO | Caller race does not terminate subprocess; N4 |
| Overflow recovery passes without compaction | Prevented | Both parameterized variants require auto compact boundary and successful result; `S:1276–1292` |

## Verification and limits

- Read the current integration spec in full, the supporting process-tree helper, the previous review and revised budget note. No production source was changed.
- Ran the permitted integration command once, using `npx --no-install jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`: **1 suite, 9/9 tests passed, 100.112 seconds**. Jest printed a configuration-module warning but completed successfully. No other suite run was performed.
- In-memory fault injection used the actual extracted/transpiled cleanup function. Discovery failure and reported kill error rejected; a never-settling kill operation remained pending after cleanup resolved. The probe created no child processes or files. Its synthetic clock establishes branches, not measured wall-clock durations.
- Scoped Ptah diagnostics were unavailable: the requested worktree is outside the diagnostics tool's configured workspace root. The developer's reported lint/typecheck results were not independently rerun this round.
- The integration uses the installed real SDK/CLI and real proxy with a localhost mocked upstream. It does not establish live-provider behavior or reproduce an actual OS termination-tool hang.

## Verdict

- Recommendation: REJECT Batch 9 pending N4.
- Confidence: HIGH in the source-level lifecycle gap; the trigger is an uncommon dependency hang.
- Top risk: a raced termination operation outlives both its caller and the target-process verification.
- Robust implementation addition: cancellation/timeout of the underlying termination subprocess with completion observed and a fault-injection regression.
