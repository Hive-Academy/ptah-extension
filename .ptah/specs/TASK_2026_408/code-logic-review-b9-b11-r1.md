# Code Logic Review — `TASK_2026_408`

## Summary

Re-review round 1 of 2, following `code-logic-review-b9-b11.md`. Worktree: `D:\projects\ptah-extension-task-408`.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED — Batch 9 still needs revision |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 1 |
| Failure modes found | 3, all within the remaining F5 cleanup gap |

The production fixes address F6/F7. The integration revisions address F1–F4. F5 improves normal cleanup but remains incomplete on failure paths. No source or task-state files were changed; only this deliverable was written. No git operations or live-provider checks.

Path notation: `T/` = `libs/backend/auth-providers/src/lib/translation/`; `P/` = `libs/backend/platform-core/src/utils/`; `D/` = `.ptah/specs/TASK_2026_408/`. Line numbers refer to the current worktree.

## Batch 9

Verdict: REJECTED

Score: 6/10

Structured assertions, content-based responders, pinned literal-command behaviour and repository-resolved Zod materially improve the evidence. The remaining process-cleanup failure paths keep this below the sound 7–8 band. This is above the previous 5 because the scenario proof gaps are resolved; the rejection is now concentrated in F5 rather than the scenario behaviours.

## Batch 11

Verdict: APPROVED

Score: 8/10

The upstream release and independent header deadline close the two reproduced production gaps. Timing is committed before disposal, the release does not enter another lane's failure handler, and the 401 retry is outside the timer's ownership scope. The targeted regressions and localhost probes support approval. This is not a 9–10: no live-provider latency test was performed, and first-output timer removal is implemented as a guarded callback rather than immediate cancellation.

## F1–F7 disposition

| Finding | Resolved? | Current evidence and judgment |
| --- | --- | --- |
| F1 — temporary script resolves external Zod | YES | `T/translation-proxy.sdk.integration.spec.ts:102` rejects SDK discovery outside the checkout; `:115` resolves Zod from the SDK; `:118` checks the real node_modules root; `:410` imports the supplied URL; `:578` supplies it. A node_modules junction is handled intentionally. |
| F2 — positional responders | YES | S1 dispatches by user marker/tool and paired result at `T/translation-proxy.sdk.integration.spec.ts:840`; S4 at `:998`; S5 at `:1048`. S2 searches matching user content at `:923`. Unrelated requests in the tool scenarios return undefined and get the generic response at `:324`. |
| F3 — substring assertions do not prove pairing/replay | YES | Skill replay name/args, result ID and expanded skill text at `T/translation-proxy.sdk.integration.spec.ts:881`, `:886`, `:893`; unknown-tool paired output at `:1020`; MCP handler args, tool definitions, replay args and exact image part at `:1083`, `:1088`, `:1091`, `:1103`. |
| F4 — S3 accepts both outcomes | YES | `T/translation-proxy.sdk.integration.spec.ts:970` rejects a local Unknown command result; `:978` requires literal user forwarding; `:984` requires success. |
| F5 — unverified tree kill / fixture leakage | NO — partially fixed | Scenario/suite fixture cleanup at `T/translation-proxy.sdk.integration.spec.ts:763`, `:801` is real; child temp dirs are contained at `:739`; upstream close is bounded at `:365`. However, cleanup exceeds the outer timeout in a permitted failure case (`:496`, `:595`), descendant enumeration errors are swallowed (`:550`), and the new process test has no unconditional cleanup (`:811`). See N1–N3. |
| F6 — error-first response retains upstream | YES | `T/translation-proxy-base.ts:1181` clears deadline and records timing before destroying an unfinished owned response; `:1381` ignores release errors after settlement. Regression at `T/translation-proxy-base.spec.ts:1995`. A localhost 401→error-first probe closed upstream and recorded only retry then invalid-response. |
| F7 — heartbeats indefinitely postpone headers | YES | Separate elapsed header deadline at `T/translation-proxy-base.ts:1017`, armed only for the owning stream at `:1215`; 504 and upstream destroy at `:1025`. Heartbeat regression at `T/translation-proxy-base.spec.ts:2010`; post-output protection at `:2027`. |

## Ownership.md correction

Verdict: APPROVED

Score: 8/10

No new finding in the bounded correction. Reviewed the overflow bullet, Streamed errors bullet and installed-SDK observations section; unrelated B/C text was not re-reviewed.

| Claim/location | Supporting evidence | Assessment |
| --- | --- | --- |
| Overflow remains reactive; CLI owns compaction; two mocked cases require it — `D/ownership.md:21` | `T/translation-proxy.sdk.integration.spec.ts:1118` defines both variants; `:1136` scripts overflow; `:1193` requires auto compact_boundary; `:1208` requires a success result with S6-DONE. `D/integration-observations.md:192` explicitly records removal of the propagation-only fallback. | Supported. The prior “proven while optional” issue is resolved. |
| Error-first is HTTP; post-output error is one SSE terminal — `D/ownership.md:22` | `T/translation-proxy-base.ts:1324`; `T/translation-proxy-base.spec.ts:1933`; `D/integration-observations.md:180`. | Supported by implementation and unit coverage. |
| Installed CLI retries the SSE failure and does not compact — `D/ownership.md:22` | Recorded real-CLI observation at `D/integration-observations.md:196` and original retry-loop observation at `:210`. | Accept as the documented pinned-CLI limitation. Current S6 tests exercise error-first HTTP recovery, not a fresh after-output CLI compaction scenario; the unit test proves wire behaviour only. |
| Real SDK/CLI/proxy, mocked upstream — `D/ownership.md:47` | Real query at `T/translation-proxy.sdk.integration.spec.ts:434`; loopback mock at `:306`; real proxy at `:730`. | Supported; no live-provider proof claimed. |
| S1 Skill invocation/arguments/body and pairing — `D/ownership.md:51` | `T/translation-proxy.sdk.integration.spec.ts:881`, `:886`, `:893`, `:899`; `D/integration-observations.md:44`. | Supported. The skill body may be separate input content; the test correctly distinguishes it from replayed function-call arguments. |
| S2 local expansion — `D/ownership.md:52` | `T/translation-proxy.sdk.integration.spec.ts:930`; fixture at `:210`. | Supported for the fixture command. |
| S3 literal forwarding, no local rejection — `D/ownership.md:53` | `T/translation-proxy.sdk.integration.spec.ts:964`, `:970`, `:978`, `:984`; `D/integration-observations.md:56`. | Supported for the pinned CLI/fixture. The consequence at `D/ownership.md:58` is an inference from forwarding: a typo reaches the model instead of being caught locally. |
| S4 unknown-tool error output — `D/ownership.md:54` | `T/translation-proxy.sdk.integration.spec.ts:1022`, `:1028`, `:1029`. | Supported structurally, paired by call ID. |
| S5 alias/handler/replay/image — `D/ownership.md:55` | `T/translation-proxy.sdk.integration.spec.ts:1083`, `:1088`, `:1091`, `:1103`. | Supported. |
| S6a/S6b auto-compaction and success — `D/ownership.md:56` | `T/translation-proxy.sdk.integration.spec.ts:1197`, `:1198`, `:1209`, `:1210`, `:1212`. | Supported; a generic side-query `ok` cannot satisfy S6-DONE plus summary/retry-role assertions. |

## New findings / remaining F5 failure modes

### N1. Serious — cleanup can outlive Jest's scenario deadline

- File: `T/translation-proxy.sdk.integration.spec.ts:52`, `:53`, `:496`, `:550`, `:595`.
- Trigger: The child hangs until 75 seconds, then Windows CIM process enumeration takes its allowed 20 seconds or times out.
- Symptom: The 90-second Jest timeout expires while the child is still alive and `runChild` remains pending. The scenario's `finally` has not run. Jest can advance to another scenario or suite cleanup while the previous asynchronous work is still cleaning up, defeating scenario isolation and the claimed completion bound.
- Current handling: Tree kill happens only after enumeration. There can also be a 10-second wrapper-close race and a further 10-second survivor poll (`:552`, `:556`); Windows `killProcessTree` calls taskkill without a timeout (`P/process-tree-reaper.ts:57`). The 15 seconds left after the child deadline do not cover these operations.
- Verification: Extracted the actual `runChild` and `killChildTree` functions into an in-memory harness with virtual timers and a process-table query that rejects at its configured 20-second limit. At virtual 90,000 ms the returned promise was still pending; it rejected at 95,000 ms even with immediate successful kill and wrapper exit. No real child or fixture file was created by this probe.
- Fix: Use one explicit wall-clock budget covering child execution, discovery, bounded kill, exit verification and teardown, with enough margin below Jest's timeout. Bound taskkill too. Start guaranteed cleanup before the outer test deadline; do not rely on Jest timeout to cancel asynchronous work. Verify the delayed-enumeration/failed-kill path, not only a prompt successful kill.

### N2. Serious — the new tree-kill regression leaks its own processes when it fails

- File: `T/translation-proxy.sdk.integration.spec.ts:811`, `:815`, `:825`, `:827`.
- Trigger: `descendantPids` rejects (CIM unavailable/restricted), the descendant never becomes observable, or the 60-second test timeout expires during discovery.
- Symptom: The test fails before reaching `killChildTree`, leaving its deliberately long-lived Node wrapper and descendant running. `afterAll` only removes files and cannot stop them.
- Current handling: The child is spawned before a loop containing awaited OS queries and assertions, with no try/finally around its lifetime. Fifty discovery iterations each allow a 20-second query; the loop does not share the 60-second test budget. A failed survivor assertion after an unsuccessful kill also has no fallback cleanup.
- Fix: Put every spawned process under unconditional finally cleanup immediately after spawning. Use a bounded discovery deadline and preserve the original discovery/assertion failure while attempting verified cleanup. Add an injected discovery-error test that asserts cleanup still executes.

### N3. Moderate — process-table failure is reported as verified descendant exit

- File: `T/translation-proxy.sdk.integration.spec.ts:550`, `:557`, `:605`; supporting dependency `P/process-tree-reaper.ts:63`.
- Trigger: Descendant enumeration fails, and the wrapper is gone while an unrecorded descendant survives (for example the wrapper exits during discovery and taskkill can no longer traverse it).
- Symptom: `killChildTree` returns an empty survivor list, and the timeout diagnostic says “killed and verified exited” without having checked any descendant.
- Current handling: `.catch(() => [])` turns unavailable process evidence into “no descendants.” The existing best-effort `killProcessTree` also absorbs taskkill errors unless an onError callback is supplied; this caller supplies none.
- Verification: In-memory execution of the actual `killChildTree` with discovery rejection, an exited wrapper and a surviving unrecorded descendant returned `[]`; only the wrapper PID was checked. This demonstrates the false verification, not an actual leaked process on the happy-path Windows test.
- Fix: Record enumeration and kill failures explicitly, still attempt cleanup, and return/throw an “unverified cleanup” error instead of claiming success. Only an authoritative disappearance result should count as verified exit. Exercise this dependency-failure branch.

N1–N3 are the remaining parts of F5, not three additional unrelated feature requirements. Normal fixture cleanup and successful tree termination are improvements; these findings concern the paths the cleanup exists to protect.

## Five logic questions

### 1. How does this fail silently?

Descendant discovery failure is converted to an empty list and then to “verified exited” (`T/translation-proxy.sdk.integration.spec.ts:550`, `:605`; N3). The previous whole-body assertion and S3 acceptance holes are closed (`:881`, `:1091`, `:970`).

### 2. What user action produces unexpected behaviour?

A developer running the suite on a Windows host with unavailable/slow CIM can leave test processes alive or have cleanup overlap later tests (`T/translation-proxy.sdk.integration.spec.ts:496`, `:825`; N1/N2). No new user-facing production failure was established in Batch 11.

### 3. What input data produces a wrong answer?

An unavailable process table is treated like a successfully empty table (`T/translation-proxy.sdk.integration.spec.ts:550`). By contrast, S1 and S5 now inspect structured call arguments, result IDs and image content (`:881`, `:1091`, `:1103`), so the previous false-positive inputs no longer satisfy those assertions.

### 4. What happens when a dependency fails?

Production pre-header timeout returns 504 and destroys upstream (`T/translation-proxy-base.ts:1017`); error-first completion records its final timing before upstream disposal (`:1181`). Process-discovery failure still delays kill, can bypass the regression test's cleanup, and can produce false verification (`T/translation-proxy.sdk.integration.spec.ts:550`, `:825`).

### 5. What is missing that the requirements never mentioned?

The cleanup mechanism needs its own failure budget and unconditional resource ownership (`T/translation-proxy.sdk.integration.spec.ts:544`, `:811`). The production header timer does not literally clear on first output: it remains until completion/cancel/close or its guarded expiry (`T/translation-proxy-base.ts:1020`, `:1182`, `:1266`, `:1273`). That is bounded and did not produce an incorrect response in review; it should not be described as immediate first-output cancellation.

## Failure modes

N1–N3 above contain the supported triggers, symptoms, evidence, current handling and recommendations. No additional production failure mode was found in this revision.

## Blocking issues

None established.

## Serious issues

N1 and N2, both Batch 9 test-harness lifecycle defects.

## Moderate and minor issues

N3, Batch 9 cleanup verification. The retained header timer is a bounded implementation detail, not a separate defect or a reason to reject Batch 11.

## Data flow and lifecycle audit

1. **OK:** 401 handling returns before an owning handler is created (`T/translation-proxy-base.ts:1076`, `:1107`). The retry gets its own attempt-local timer and response. Disposal references that attempt's `proxyRes`, not another attempt.
2. **OK:** only Responses streaming opts into ownership (`T/translation-proxy-base.ts:801`, `:1210`). Messages passthrough, Chat streaming and JSON paths do not acquire the new deadline or terminal disposal rule.
3. **OK:** header deadline runs independently of socket activity (`T/translation-proxy-base.ts:1017`), so ignored reasoning/created events and pings cannot prolong pre-header waiting indefinitely.
4. **OK:** after visible output, the deadline callback sees headersSent and returns (`T/translation-proxy-base.ts:1020`). Completion, non-owning failure, cancellation, socket timeout and request close clear it (`:1055`, `:1182`, `:1231`, `:1266`, `:1273`). Request errors lead to request close; no persistent timer leak was established. Deadline and idle-timeout callbacks cannot concurrently write responses in one JavaScript event-loop turn; teardown/guards prevent a second terminal in the exercised paths.
5. **OK:** error-first handler completion records invalid-response, then destroys unfinished upstream (`T/translation-proxy-base.ts:1183`, `:1187`). The shared failResponse returns while the handler owns failure (`:1054`), the settled handler ignores release errors (`:1381`), and close is idempotent (`:1357`). No error was observed on the successful release probe.
6. **OK:** local end remains distinguished from remote cancellation (`T/translation-proxy-base.ts:1265`). Real pre-end client cancellation still destroys upstream; existing lane cancellation coverage remains in the scoped test suite (`T/translation-proxy-base.spec.ts:1252`). Empty/reasoning-only successful terminal behaviour is unchanged from the prior full review.
7. **GAP:** test child execution deadline enters discovery, kill and verification without a compatible outer budget (`T/translation-proxy.sdk.integration.spec.ts:595`; N1). Test-created processes lack unconditional cleanup on discovery/assertion failures (`:811`; N2).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Deterministic installed dependency resolution | COMPLETE | SDK root and absolute Zod URL, `T/translation-proxy.sdk.integration.spec.ts:102`, `:115`, `:410` |
| Content-driven scenario scripts | COMPLETE | F2 resolution table |
| Paired structural assertions / fixed S3 contract | COMPLETE | F3/F4 resolution table |
| Bounded, verified failure cleanup | PARTIAL | N1–N3 |
| Dispose error-first upstream promptly | COMPLETE | `T/translation-proxy-base.ts:1187`; regression `T/translation-proxy-base.spec.ts:1995` |
| Bound heartbeat-only pre-header wait | COMPLETE | `T/translation-proxy-base.ts:1017`; regression `T/translation-proxy-base.spec.ts:2010` |
| Do not timeout a stream after output | COMPLETE for reviewed paths | `T/translation-proxy-base.ts:1020`; regression `T/translation-proxy-base.spec.ts:2027` |
| No 401 cross-attempt disposal/routing race introduced | COMPLETE for reviewed paths | `T/translation-proxy-base.ts:1076`, `:1187`; localhost 401→error-first probe |
| Boundary-safe killProcessTree import | COMPLETE | `T/translation-proxy.sdk.integration.spec.ts:45`; platform-core barrel export at `libs/backend/platform-core/src/index.ts:237`; scope:shared/type:util tags; scoped lint passed |
| Ownership correction matches current scenario proof | COMPLETE | Claim-by-claim section above |

Implicit requirements still not addressed: a single cleanup deadline below Jest's limit; unconditional process cleanup when the cleanup test itself fails; honest handling of unavailable process-liveness evidence.

## Edge cases

| Case | Handled | Evidence | Remaining concern |
| --- | --- | --- | --- |
| Error-first overflow followed by indefinite pings | YES | `T/translation-proxy-base.spec.ts:1995`; ownership disposal at `T/translation-proxy-base.ts:1187` | None established in revised path |
| Created event plus pings, no output | YES | `T/translation-proxy-base.spec.ts:2010`; localhost probe returned 504, upstream closed, one timeout record | Ten-minute production policy not live-provider tested |
| Output then pings beyond header deadline | YES | `T/translation-proxy-base.spec.ts:2027`; localhost probe returned 200, one message_stop, one success record | Timer is guarded rather than immediately removed |
| 401 retry then error-first overflow | YES | Localhost probe returned 400, upstream closed, records retry/invalid-response, no release error log | Not a live auth-refresh test |
| Failed CIM discovery | NO | `T/translation-proxy.sdk.integration.spec.ts:550`, `:825` | N2/N3 |
| CIM query consumes its 20-second budget after child deadline | NO | `T/translation-proxy.sdk.integration.spec.ts:496`, `:595`; virtual-clock probe | N1 |
| Normal scenario fixture removal | YES | `T/translation-proxy.sdk.integration.spec.ts:763`, `:801` | Cannot substitute for process cleanup |

## Verification

- Scoped Ptah diagnostics: unavailable because the worktree is outside the tool's configured workspace root. No diagnostics were invented from that response.
- `npx --no-install nx run-many -t lint,typecheck -p @ptah-extension/auth-providers`: both targets passed, cache 0/2, 32.5 seconds. This also verifies the new platform-core import against Nx boundaries.
- `npx --no-install nx test @ptah-extension/auth-providers --runInBand`: **53/53 suites, 1315/1315 tests, 2/2 snapshots passed**, 217.689 seconds (Nx wall time 3m 41s), cache disabled. This was the only test-suite/integration execution in this review. Nx Cloud was disabled. The passing tree-kill case establishes happy-path termination on this Windows host, not the discovery-error and outer-timeout paths in N1–N3.
- Additional in-memory probes used actual extracted/transpiled source with controlled dependencies; no files were created. Production localhost probes confirmed the heartbeat deadline, post-output success and 401→error-first release. A cold-start 50 ms probe timed out before reaching its intended error-first case and was treated as inconclusive, not as a production defect. The retry probe exercised that release successfully after loading.
- Process failure probes injected discovery failure and elapsed time; they did not create, kill or leave any real process. They demonstrate the N1/N3 control-flow flaws independently of the happy-path tree test.
- Full-file context from the initial review was retained; revised integration file, forwarding/handler lifecycle and new tests were inspected, with supporting process-tree helper, context/plan and documentation. No applicable AGENTS.md was found. No unrelated Batch 10 source comment or B/C ownership audit was repeated.

## Verdict

- Recommendation: REVISE Batch 9; APPROVE Batch 11 and the bounded ownership.md correction.
- Confidence: HIGH for F1–F4/F6/F7 resolution and N1–N3's source-level failure paths.
- Top risk: a cleanup failure or slow Windows process query lets deliberately long-lived test processes outlive their test (`T/translation-proxy.sdk.integration.spec.ts:496`, `:811`).
- What a robust implementation would add: one bounded end-to-end cleanup budget, finally-owned test processes, and explicit unverified-cleanup reporting when process enumeration or termination fails.
