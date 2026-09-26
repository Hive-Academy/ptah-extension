# Code Logic Review — `TASK_2026_408`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 4 |
| Moderate issues | 3 |
| Failure modes found | 7 |

Reviewed Batches 9 and 11 in `D:\projects\ptah-extension-task-408`. All five named TypeScript files were read in full, together with `integration-observations.md`, task context, applicable plan/batch contracts, and supporting helpers/provider code. No git operations or source edits. Batch 10 was excluded. No root or applicable nested AGENTS.md was found; no task-description.md or current code-style-review.md exists in this task folder. Earlier B7/B8 style review does not cover this scope.

Paths below are relative to the worktree. `T/` means `libs/backend/auth-providers/src/lib/translation/`; `C/` means `libs/backend/auth-providers/src/lib/providers/codex/`.

## Batch 9

Verdict: REJECTED

Score: 5/10

The real SDK/CLI scenarios execute and S6 requires compaction and success. However, the test depends on a package outside the repository, several proof assertions are weaker than their claims, and failure cleanup is incomplete. Those are concrete gaps separating this from the sound 7–8 band; the working S6 path and passing actual run separate it from a foundational 3–4.

### 1. Serious — S5 resolves Zod relative to a temporary script, not the pinned installation

- File: `T/translation-proxy.sdk.integration.spec.ts:310`, `:386`, `:399`.
- Trigger: Run the suite on a clean machine where the OS temporary directory has no ancestor installation of `zod`.
- Symptom: S5 fails with module resolution failure before exercising the MCP round trip, despite all repository dependencies being installed.
- Evidence: The child script is written directly into `os.tmpdir()`, then executes bare `import("zod")`. Unlike the SDK import, Zod is not passed as a resolved file URL. ESM resolves this import from the script location; the project option `cwd` does not change module resolution.
- Local verification: Resolving from this script location found `C:\Users\abdal\node_modules\zod\index.cjs`, outside the worktree. The passing local run therefore does not establish clean-install portability or use of the repository's Zod version.
- Fix: Resolve Zod from the repository/pinned SDK dependency context in the parent and pass its absolute import URL to the child, or execute a module situated in an explicitly controlled package context.

### 2. Moderate — S1, S4 and S5 script by request order

- File: `T/translation-proxy.sdk.integration.spec.ts:601`, `:604`, `:734`, `:737`, `:777`, `:780`.
- Trigger: The real CLI sends a housekeeping request before or between scenario requests.
- Symptom: The mock sends the scenario tool call to the wrong request, or asserts scenario output on housekeeping traffic; the test fails for scheduling changes rather than the behaviour under review.
- Current handling: Each responder increments `turn` for every request. These responders never return `undefined` for side queries, so the fallback at `:232` cannot protect them. S4 also assumes request index 1 at `:756` is the tool-result request.
- Documentation conflict: `.ptah/specs/TASK_2026_408/integration-observations.md:10` claims content scripting with only an S6 exception. The implementation-plan integration contract explicitly requires content-based dispatch.
- Fix: Match the scenario user marker and the structured tool-result call ID; answer unrelated requests with `ok`. Capture matching requests instead of positional indexes.

### 3. Moderate — Whole-body substring checks do not prove argument forwarding or replay correctness

- File: `T/translation-proxy.sdk.integration.spec.ts:629`, `:631`, `:637`, `:804`, `:805`.
- Trigger: Skill argument substitution breaks, or the proxy corrupts the replayed function-call name while retaining the declared tool list.
- Symptom: The relevant assertions can remain green despite the claimed behaviour regressing.
- Current handling: S1 searches the entire request for `alpha beta` and `call-skill-1`; these already occur in the original user prompt and replayed tool invocation. It does not require a matching `function_call_output` or substituted skill output. S5 searches the entire body for the alias, which can be satisfied by `tools[]` even if replay is wrong; `input_image` is not checked in the matching call's output or checked for the returned image payload.
- Positive boundary: S5's `mcpCalls` equality at `:819` really does prove handler execution with `{value:'42'}`. S1's final-success assertion at `:649` really checks a success result. These do not repair the narrower gaps above.
- Fix: Parse `input`, match `function_call` and `function_call_output` by call ID, and assert the expanded skill text/arguments, replayed name, and exact image content-part shape in those records.

### 4. Moderate — S3 does not pin the documented observed branch

- File: `T/translation-proxy.sdk.integration.spec.ts:708`, `:709`, `:716`; `.ptah/specs/TASK_2026_408/integration-observations.md:55`.
- Trigger: The pinned CLI changes from literal forwarding to local rejection.
- Symptom: The test still passes while the observations continue to claim literal forwarding is specifically pinned and the alternative branch is excluded.
- Current handling: The assertion chooses its expected result from the result it just observed. Both outcomes pass.
- Fix: Assert no local rejection and require literal forwarding, as recorded for this pinned version; revise that contract explicitly when upgrading the SDK.

### 5. Serious — The timeout is not a verified process-tree cleanup, and fixtures are never removed

- File: `T/translation-proxy.sdk.integration.spec.ts:403`, `:406`, `:432`, `:526`, `:563`.
- Trigger: A scenario hangs or the suite is repeatedly run.
- Symptom: The 75-second callback rejects without establishing that the real CLI descendant exited. The temporary script is left on timeout because `settled` makes the close handler return before `unlinkSync`; every run also leaves the entire project/home/session fixture tree behind.
- Current handling: `child.kill('SIGTERM')` targets the Node wrapper only; there is no query abort/close handoff, process-tree termination, or wait for descendant cleanup. Teardown only stops the proxy and upstream. `MockUpstream.close` at `:267` has no forced-connection deadline if an active connection survives.
- Fix: Keep an explicit abort/close path for the active query, guarantee and await platform-appropriate descendant shutdown with a bounded fallback, clean script and fixture tree in unconditional finalization, and bound upstream teardown. Verify timeout cleanup rather than describing a wrapper signal as a CLI hard kill.

## Batch 11

Verdict: REJECTED

Score: 6/10

The mapping/deferral logic works for the tested terminal paths and real compaction scenarios. Two lifecycle gaps prevent approval. This is stronger than the 5 band because ordinary error/success routing, timing, and cancellation work, but it cannot reach 7 while already-answered upstream work can survive and pre-header waiting has no progress bound.

### 6. Serious — An error-first HTTP answer leaves the upstream connection running

- File: `T/translation-proxy-base.ts:1323`, `:1311`, `:1224`.
- Trigger: Upstream emits a complete error-first event but does not close its HTTP response, optionally continuing heartbeat frames.
- Symptom: The SDK receives its HTTP error and can retry/compact, while the old upstream connection and listeners remain active. Repeated failures can accumulate connections and upstream work that timing already considers finished.
- Current handling: `writeEvents` ends the downstream with JSON; `finish([])` settles the handler and records invalid-response. Neither stops `proxyRes` nor the upstream request. The new `res.writableEnded` guard deliberately prevents the downstream close callback from cancelling it. Heartbeats also prevent the socket idle timeout from cleaning it up.
- Local reproduction: Actual base/translator code, loopback HTTP, 50 ms upstream idle timeout, error-first overflow followed by 10 ms heartbeats. At 250 ms the client had ended with HTTP 400 and one `invalid-response` timing record, but the upstream connection had not closed.
- Fix: On terminal HTTP completion, explicitly release/destroy the upstream response/request through an idempotent finalization path, after securing the intended terminal/timing outcome. Add a regression where upstream deliberately remains open and assert it closes promptly with no second response or timing record.

### 7. Serious — Non-output traffic can keep the SDK waiting for headers indefinitely

- File: `T/translation-proxy-base.ts:1015`, `:1282`, `:1190`; `T/responses-stream-translator.ts:406`.
- Trigger: Upstream repeatedly sends `response.created`, in-progress/reasoning events, or SSE comments without visible output or a terminal event.
- Symptom: No downstream headers or body arrive, no proxy error is produced, and no terminal timing record is emitted while upstream traffic continues. The eventual limit is an external client's timeout/cancellation, not the proxy's claimed timeout protection.
- Current handling: Node's request `timeout` is socket inactivity, not elapsed time or time to client-visible progress. Every upstream byte keeps it alive; the translator ignores these events and header deferral suppresses downstream output. The existing pre-header timeout test at `T/translation-proxy-base.spec.ts:1970` sends one comment and then goes silent, so it does not exercise this case.
- Local reproduction: Actual base/translator code, loopback HTTP, 50 ms idle timeout, `response.created` then comments every 10 ms. After 250 ms: no headers, no completion, no timing record; connection still open.
- Fix: Define a bounded pre-header/client-progress deadline independent of upstream heartbeats, clear it on output or completion/cancellation, and emit one HTTP 504 on expiry. Allow a deliberate budget for legitimate reasoning latency. Sending SSE keepalives downstream would commit HTTP 200 and defeat error-first compaction, so it is not an equivalent fix.

## Five logic questions

### 1. How does this fail silently?

The integration proof can remain green with broken argument substitution or replay because unrelated fields satisfy the substring assertions (finding 3, `T/translation-proxy.sdk.integration.spec.ts:629`, `:804`). An error-first request appears fully finished to the client and timing while upstream work remains (finding 6, `T/translation-proxy-base.ts:1323`).

### 2. What user action produces unexpected behaviour?

A user awaiting a long reasoning turn can receive no headers while non-output traffic indefinitely resets the idle timeout (finding 7, `T/translation-proxy-base.ts:1015`, `:1282`). Running the integration suite on a clean host can fail only S5 due to external Zod resolution (finding 1, `T/translation-proxy.sdk.integration.spec.ts:310`).

### 3. What input data produces a wrong answer?

An unknown-command outcome changing to local rejection is still accepted as the documented literal-forwarding contract (finding 4, `T/translation-proxy.sdk.integration.spec.ts:709`). For production deferral, malformed usage correctly becomes an error before headers (`T/responses-stream-translator.ts:757`; `T/translation-proxy-base.spec.ts:744`). No additional new wrong-content defect was established in the Batch 11 changes.

### 4. What happens when a dependency fails?

Silent upstream sockets return HTTP 504 before output; EOF/socket failure before output maps to 502; errors after output remain SSE errors (`T/translation-proxy-base.ts:1190`, `:1334`, `:1342`). A failed-but-open upstream is not released (finding 6). Missing SDK/version drift throws (`T/translation-proxy.sdk.integration.spec.ts:75`, `:86`); missing binary produces a failing scenario rather than a skip, but the wrapper timeout does not guarantee descendant cleanup (finding 5).

### 5. What is missing that the requirements never mentioned?

A policy for time to first client-visible output and terminal-driven upstream disposal is needed (`T/translation-proxy-base.ts:1282`, `:1323`). Test isolation also needs module-resolution and fixture/process cleanup, not just environment allowlisting (`T/translation-proxy.sdk.integration.spec.ts:310`, `:563`). These are lifecycle requirements, not proxy-side token/window or compaction policy changes.

## Failure modes

Findings 1–7 above are the seven supported failure modes; each records trigger, symptom, evidence, current handling and recommendation. No additional speculative finding is included.

## Blocking issues

None established.

## Serious issues

Findings 1 and 5 in Batch 9; findings 6 and 7 in Batch 11.

## Moderate and minor issues

Findings 2–4 in Batch 9. No separate style/naming findings.

## Data flow

1. **OK:** validated request selects its lane; Responses name mapping survives recursive 401 retry (`T/translation-proxy-base.ts:550`, `:873`, `:1047`; regression `T/translation-proxy-base.spec.ts:2562`). The 401 branch executes before a streaming handler can commit headers.
2. **GAP:** upstream starts with socket-idle timeout only (`T/translation-proxy-base.ts:1015`); ignored traffic defeats a bound on deferred headers (finding 7).
3. **OK:** content-block allocation or successful terminal marks client output (`T/responses-stream-translator.ts:565`, `:793`). Empty-text and reasoning-only streams ending successfully therefore get message_start, message_delta and message_stop. A localhost empty-success probe returned HTTP 200 and one success timing record.
4. **OK:** before output, terminal mappings produce HTTP JSON; after output, the existing event serialization remains SSE (`T/translation-proxy-base.ts:1279`; `T/responses-stream-translator.ts:774`). The serializer still emits only type/message in the SSE error; the new HTTP status is not inserted into event JSON. Historical byte identity was assessed from these serializers and existing assertions, not a git comparison.
5. **GAP:** error-first HTTP termination settles before upstream EOF without releasing upstream (finding 6).
6. **OK within checked cases:** finishTiming is once-only (`T/translation-proxy-base.ts:960`), and genuine client disconnects before local end destroy upstream (`:1224`). Localhost probes verified one cancelled timing record and upstream closure for Messages passthrough, Chat Completions and Responses, each with stream true and false. `writableEnded` identifies a local end, not remote acknowledgement; this change does not establish delivery confirmation after end. The demonstrated regression is retained upstream work, not suppressed pre-end client cancellation.
7. **OK with limitation:** native pipe resolves at upstream end (`T/translation-proxy-base.ts:711`); Chat stream uses the shared end listener (`:1182`, `:1535`); JSON handlers resolve after local end (`:1443`, `:1622`). Normal own-end close therefore need not be called cancellation. Responses terminal finalization is idempotent (`T/responses-stream-translator.ts:377`, `:794`).

## Requirements fulfilment

| Requirement | Status | Gap/evidence |
| --- | --- | --- |
| Error-first failed/error/incomplete/invalid usage becomes HTTP error | COMPLETE | Mapping and write gate; `T/translation-proxy-base.ts:1282`; parity table `T/translation-proxy-base.spec.ts:1638` |
| Single terminal after headers; timing once | COMPLETE for exercised paths | Guards at `T/responses-stream-translator.ts:377` and `T/translation-proxy-base.ts:960`; no second-response failure reproduced |
| Deferred-header timeout remains bounded under non-output traffic | PARTIAL | Silence handled; regular traffic defeats idle timeout, finding 7 |
| Empty/reasoning-only successful streams answered | COMPLETE | `T/responses-stream-translator.ts:796`; successful empty-response probe |
| No cancellation regression across lanes | PARTIAL | Pre-end cancellation works on all six probed combinations; terminal upstream disposal missing, finding 6 |
| Real SDK/CLI and loud dependency failures | PARTIAL | Real query at `T/translation-proxy.sdk.integration.spec.ts:334`; external Zod dependency, finding 1 |
| Content-scripted mocks and no vacuous proof | PARTIAL | Findings 2–4 |
| S6a/S6b require automatic compaction and successful completion | COMPLETE for scripted cases | `T/translation-proxy.sdk.integration.spec.ts:907`, `:922`, `:926`; one local suite run passed |
| Bounded isolated integration harness | PARTIAL | Environment allowlist at `T/translation-proxy.sdk.integration.spec.ts:492`; cleanup gap, finding 5 |
| Mocked versus real clearly identified | PARTIAL | Spec header identifies boundary; observations overclaim content scripting and S3 pinning |

Implicit requirements not addressed: independent module resolution, terminal resource ownership, process-tree/fixture cleanup, and a client-visible-progress deadline.

`maxRetries: 0` at `C/codex-stream-parity.spec.ts:167` appropriately isolates one proxy attempt for the timing assertion. It does not disable production retries. It does mean this case cannot prove default SDK retry/recovery after an error-first 502. S6 uses real CLI defaults and covers HTTP 400 compaction, not 502 recovery (`T/translation-proxy.sdk.integration.spec.ts:573`). No production retry defect was established; do not interpret the parity test as end-to-end retry evidence.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| One pre-output comment, then silence | YES | Shared 504 path, `T/translation-proxy-base.ts:1190`; locally reproduced | None in probe |
| Continuous non-output traffic | NO | Only idle timeout | Finding 7 |
| Error-first terminal with upstream left open | NO | Downstream completes, upstream survives | Finding 6 |
| Empty successful terminal | YES | Successful terminal sets output flag, `T/responses-stream-translator.ts:796` | Reasoning content itself is intentionally ignored |
| Error and output in the same raw chunk | YES | Output flag remains true and events retain order, `T/responses-stream-translator.ts:296`, `:566` | Must stay SSE once visible output precedes error |
| Repeated terminal/error/EOF | YES | Finalized and settled guards, `T/responses-stream-translator.ts:377`; `T/translation-proxy-base.ts:1312` | Does not release a still-open upstream |
| Client closes before local end | YES | Six localhost lane/mode probes, `T/translation-proxy-base.ts:1224` | No delivery-ack guarantee after local end |
| Missing SDK / changed pinned version | YES | Throws, `T/translation-proxy.sdk.integration.spec.ts:75`, `:86` | Zod resolution is a separate hole |
| Hung child or repeated suite runs | NO | Wrapper signal and server-only teardown | Finding 5 |
| Tool history replay asserted independently of definitions | NO | Whole-body alias lookup | Finding 3 |

## Verification and limits

- `npx --no-install nx test @ptah-extension/auth-providers --runInBand`: **53 suites, 1310 tests, 2 snapshots passed**, 101.798 seconds. Cache disabled. This was the only SDK integration execution in this review; no retry run.
- `npx --no-install nx run-many -t typecheck -p @ptah-extension/auth-providers`: target succeeded. Nx subsequently printed an ancillary Cloud organization-disabled 401 warning. No source change was made to address that infrastructure warning.
- Scoped `ptah_get_diagnostics` returned **unavailable** because the requested worktree files are outside its configured workspace root; it supplied no diagnostic evidence.
- In-memory TypeScript-transpilation probes ran the actual base, translator and helper code against localhost HTTP, stubbing only unrelated logger/shared-image/quota dependencies. They confirmed findings 6–7, empty success, pre-header silent timeout, and all six lane/mode pre-end cancellation cases. No probe files were created.
- Zod resolution was checked read-only from the actual temporary script location and found the user-profile installation described in finding 1.
- No live provider checks. S6's fake overflow, small seed history and mock summary prove this scripted reactive path, not live-provider limits or large-session quality. Its role booleans plus auto-boundary and final S6-DONE prevent an `ok` side-query response alone from passing (`T/translation-proxy.sdk.integration.spec.ts:850`, `:862`, `:868`, `:907`). They do not explicitly timestamp the boundary against upstream role (i)/(iii), nor count every matching retry; the observations' “exactly once” language is stronger than those boolean assertions.

## Verdict

- Recommendation: REJECT both batches pending revision.
- Confidence: HIGH for the reproduced production lifecycle gaps and static assertion/module-resolution findings; MEDIUM for descendant behaviour on timeout, which was not deliberately triggered in the one permitted SDK run.
- Top risk: an answered error can retain upstream work while retry/compaction starts another attempt (`T/translation-proxy-base.ts:1323`, `:1224`).
- What a robust implementation would add: explicit upstream disposal on terminal completion, a bounded pre-header progress policy, content-addressed mocks, structured call/result assertions, a fixed observed S3 contract, deterministic dependency resolution, and verified bounded cleanup of child processes and temporary fixtures.
