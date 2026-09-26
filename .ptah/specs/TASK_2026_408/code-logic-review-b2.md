# Code Logic Review — `TASK_2026_408`

Verdict: REJECTED

Score: 6/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Scope: Batch 2 only, in `D:/projects/ptah-extension-task-408`. Read all four assigned files in full, the task context, relevant plan components and Batch 2 contracts, plus the shared classifier, collector, HTTP/usage helpers and OpenCode error hook. Batch 1 implementations were treated as dependencies. No applicable AGENTS.md, task-description.md or Batch 2 style review was found; the existing style review concerns Batches 7/8. Code and task state were not edited. Locations below are relative to `libs/backend/auth-providers/src/lib/translation/` unless otherwise specified.

The score is in the 5–6 band because ordinary terminals, classification, usage and retries work, but transport failure still bypasses the promised terminal, and one supported delimiter loses the real upstream outcome. This prevents the sound 7–8 band. The failures are bounded; the tested mapping and three-path dispatch are implemented, so the evidence does not support the 3–4 band.

## Verification evidence

- Ran the authorized project test target once: `npx --no-install nx test @ptah-extension/auth-providers`, with daemon and cache disabled. Result: **50 suites, 1,156 tests, 2 snapshots passed**; Nx reported successful completion. Only the output tail was retained in the session.
- `ptah_get_diagnostics` was requested for the two absolute production paths. It returned **Unavailable: none of the requested files are inside the workspace root**. The tool is attached to the other checkout; no clean diagnostic result is claimed.
- Read-only, in-memory TypeScript probes reproduced findings 1 and 2. The HTTP probes used the actual base, stream translator, collector, classifier and helpers, with unrelated request translation, logger and quota dependencies stubbed, and loopback upstreams. These are targeted lifecycle probes, not live-provider or full-SDK integration tests.
- Additional probes: a 1 MiB data frame split into 16 KiB chunks preserved its exact text; error + completed + DONE in one chunk emitted only one error; 401 refresh/retry succeeded on stream, forced-SSE and JSON paths (two upstream requests, two header acquisitions, one refresh each); a forced-SSE overflow sent before upstream EOF returned the mapped 400 JSON error.
- No git operations or external network requests were used. Historical byte identity was not independently checked against HEAD; compatibility conclusions below are based on the current code, contract and regression tests.

## Five logic questions

### 1. How does this fail silently?

No new success-looking failure was reproduced for the mapped failed/incomplete terminals: `responses-stream-translator.ts:560`, `:623` suppress successful final events, and `translation-proxy-base.ts:1258` returns before content construction. The transport gap is different: a socket failure produces an aborted HTTP body without any Anthropic terminal (finding 1, `translation-proxy-base.ts:975`). Existing malformed-frame skipping and DONE-only success remain deliberate compatibility behavior (`responses-stream-translator.ts:274`, `:279`; spec `:393`), not new findings.

### 2. What user action produces unexpected behaviour?

A streaming request interrupted by an upstream disconnect gets a raw aborted response rather than the specified terminal error (`translation-proxy-base.ts:979`, `:1230`). A request through a CR-only SSE gateway can lose a valid final result or overflow classification at clean EOF (`responses-stream-translator.ts:234`, `:247`).

### 3. What input data produces a wrong answer?

A complete terminal frame ending in `\r\r` is misclassified as truncation. For `response.failed` with `context_length_exceeded`, the intended `invalid_request_error` containing `prompt is too long` becomes generic `api_error`, losing the CLI compaction predicate (`responses-stream-translator.ts:234`, `:249`). Complete and incomplete success terminals have the same framing defect.

### 4. What happens when a dependency fails?

HTTP overflow is classified before the legacy generic-error hook (`translation-proxy-base.ts:1067`), and mapped collector failures preserve status/type/message (`:806`). Upstream transport errors first enter the outer failure listener and destroy the downstream socket (`:973`), preventing the later stream handler from delivering its error (`:1204`, `:1230`). The existing post-header timeout branch also destroys the response (`:1142`); a revised lifecycle should cover that sibling path while retaining non-Responses behavior.

### 5. What is missing that the requirements never mentioned?

Ownership of termination across the outer forwarding lifecycle and inner protocol handler needs to be explicit: both currently handle the same failure, in registration order (`translation-proxy-base.ts:979`, `:1226`). A completed SSE delimiter at EOF also needs to be distinguished from a genuinely unfinished frame (`responses-stream-translator.ts:234`, `:247`). Resource limits for very large pending stream frames remain unspecified: buffering at `:228`, `:261` has no explicit cap. The 1 MiB probe passed; unlimited-size safety is not established and is not counted as a separate Batch 2 finding.

## Failure modes

### 1. Serious — outer transport handler prevents the terminal SSE error

- Trigger: upstream closes its socket after delivering a partial Responses stream while the downstream client is still connected.
- Symptom: client receives message_start and partial content, then an aborted HTTP response; neither `event: error` nor message_stop arrives.
- Evidence: `translation-proxy-base.ts:973` defines failResponse, `:975` destroys a headers-sent response, and `:979` registers it before the inner error handler at `:1226`. The write guard at `:1204` therefore suppresses the terminal generated at `:1230`.
- Current handling: the new terminal code executes too late to deliver anything. The test at `translation-proxy-base.spec.ts:1760` explicitly accepts teardown; its assertions at `:1789` check absence of message_stop and continued health, not receipt of an error terminal.
- Reproduction: loopback upstream wrote a text delta and destroyed its socket 40 ms later. Client result was status 200, error `aborted`, and a body containing only message_start/content_block_start/content_block_delta.
- Recommendation: give the Responses streaming handler ownership of protocol termination before the shared layer destroys an otherwise-open downstream. Preserve downstream-disconnect guards and other protocol lanes. Add a real HTTP assertion for exactly one terminal error and normal downstream completion on upstream abort; also exercise post-header timeout and failure after an already-handled terminal.

### 2. Moderate — a held final CR discards a complete terminal frame

- Trigger: an SSE terminal frame uses bare CR delimiters and ends exactly in `\r\r`, followed by clean upstream EOF.
- Symptom: valid completion becomes a truncation error; a context overflow loses its prompt-too-long mapping.
- Evidence: `responses-stream-translator.ts:234` holds the final CR; `:247` does not flush it before `:249` emits truncation. `translation-proxy-base.ts:1219` invokes that method directly on EOF. The existing test at `responses-stream-translator.spec.ts:752` appends another CR at `:756`, masking this case.
- Current handling: no events are dispatched for the terminal. The collector already resolves a held CR in its onEnd path (`responses-stream-collector.ts:233`), so equivalent inputs diverge across streaming and forced-SSE.
- Reproduction: `event: response.failed\rdata: {"response":{"error":{"code":"context_length_exceeded"}}}\r\r` produced `[]` from processChunk and generic `Upstream Responses stream ended before completion` from terminateTruncated.
- Recommendation: at clean EOF, process a held CR as a complete delimiter before deciding whether truncation remains. Do not synthesize a blank line for a genuinely unfinished frame. Add completed/incomplete/failed tests ending in exactly two CRs, with no extra feed, and preserve split-CRLF/idempotence coverage.

## Blocking issues

None established.

## Serious issues

1. `translation-proxy-base.ts:975` — finding 1. An upstream disconnect prevents delivery of the required terminal despite the client initially remaining writable. Fix termination ownership and strengthen the HTTP regression.

## Moderate and minor issues

2. `responses-stream-translator.ts:247` — finding 2. Clean EOF fails to resolve a held CR, changing the upstream outcome. Fix EOF delimiter handling and replace the extra-CR workaround in the regression fixture.

## Data flow

1. **OK:** request-local protocol selection and Responses forwarding preserve caller stream mode and forced upstream streaming (`translation-proxy-base.ts:545`, `:750`, `:1104`).
2. **OK:** first 401 retains refresh and recursive retry (`:994`, `:1003`, `:834`); all three Responses modes passed the focused retry probe. 429 remains ahead of generic HTTP classification (`:1027`).
3. **OK:** HTTP overflow classification synthesizes its response and logs no body, before the legacy provider hook (`:1067`, `:1070`, `:1081`).
4. **GAP 2:** stream frame state persists and dispatches on blank lines, but the held final CR never reaches dispatch at EOF (`responses-stream-translator.ts:228`, `:253`, `:247`).
5. **OK:** incomplete tool arguments are checked before usage/success emission; snapshot arguments take precedence, with open/closed accumulator fallback (`:554`, `:588`). Failed/error paths synthesize an error and finalize (`:565`, `:576`, `:623`).
6. **OK:** finalized guards prevent later output, including DONE and truncation (`:225`, `:298`, `:642`, `:248`).
7. **GAP 1:** clean LF-framed EOF writes truncation, but transport failure destroys downstream before its terminal write (`translation-proxy-base.ts:1216`, `:975`, `:1230`).
8. **OK:** collector mapping is honored; JSON failed/incomplete classification precedes content and rejects truncated args before safeJsonParse (`:806`, `:1257`, `:1291`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Shared HTTP overflow mapping and fixed warning | COMPLETE | Current implementation and HTTP tests at base spec :1371; historical byte identity not independently diffed |
| Persistent SSE event/data state; LF/CRLF/CR | PARTIAL | CR at EOF, finding 2 |
| Incomplete/failed/error terminal mapping and usage | COMPLETE | Translator :554, :565, :576; spec :478; base parity :1703 |
| Exactly one terminal end to end | PARTIAL | Upstream transport failure, finding 1 |
| Idempotent terminateTruncated and no post-finalization events | COMPLETE | Translator :248, :298, :642; spec :672, :685 |
| Collector mapping and JSON classification before content | COMPLETE | Base :806, :1257 |
| No fabricated incomplete tool input | COMPLETE | Base :133, :1258; parity spec :1595, :1598, :1709 |
| One shared three-path parity table | COMPLETE | Spec :1625, :1650, :1657, :1703 select genuinely distinct paths |
| Preserve tool emission/index behavior for Batch 4 | COMPLETE within reviewed scope | Accumulator added at translator :446 and :518; emission remains at :480; historical byte comparison not performed |
| No upstream text in new mapped errors/logs | COMPLETE | Base :1070; translator :569, :579; classifier produces fixed messages; OpenCode override remains at providers/opencode/opencode-translation-proxy.ts:82 |
| No pre-send token/window gate | COMPLETE | Base forwarding at :545, :754 proceeds without such a gate |

Implicit requirements not addressed: explicit ownership of terminal delivery between transport and protocol layers, as described in finding 1.

Executor deviations:

1. **Accepted:** changing the old swallowed-terminal expectation is required by the new behavior; the fixture at `responses-stream-translator.spec.ts:166` still verifies no successful usage for those failing payloads.
2. **Accepted:** standalone error events have no equivalent successful-HTTP JSON snapshot in this contract. Two SSE-only rows at `translation-proxy-base.spec.ts:1605` are appropriate; failed snapshots still run through all three paths at `:1600` and `:1625`.
3. **Accepted:** terminateTruncated calling onTranslationError through failStream centralizes timing and is idempotent (`responses-stream-translator.ts:248`, `:624`; spec `:696`). This does not resolve finding 1.
4. **Accepted:** JSON classified failures call onTranslationError before returning (`translation-proxy-base.ts:1259`), matching invalid-response timing across the table (`translation-proxy-base.spec.ts:1711`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty stream / pending LF frame | YES | Base :1219 emits truncation; spec :1719 | None demonstrated |
| Complete bare-CR terminal at EOF | NO | Translator :234 retains final delimiter | Finding 2 |
| Event/data split, multiline, byte feed, split CRLF | YES | Translator spec :721, :729, :738, :745 | No framing defect reproduced for these |
| Repeated terminal, terminal then DONE, repeated truncation | YES | Translator :298, :642, :248 | Same-chunk probe also passed |
| Invalid incomplete tool args, absent snapshot output | YES | Translator :556, :596; spec :529, :549, :574 | Batch 4 emission/index work remains separately owned |
| Invalid incomplete usage | YES | Translator :606 rejects; spec :606 | Error, not successful usage |
| Upstream socket abort with connected client | NO | Base :975 destroys response first | Finding 1 |
| Already-destroyed downstream | YES for new event writes | Base :1204 | Does not prove an error was delivered before destruction |
| 401 followed by successful retry | YES | Base :1003 / :834 | Verified on all three Responses paths |
| Concurrent requests | YES within examined state | Per-request translator :1193; spec :1292 | No shared translator state |
| 1 MiB data frame | YES in focused probe | Translator :228 reconstructs line | No unlimited-size guarantee or stress benchmark |

## Verdict

- Recommendation: REJECT
- Confidence: HIGH for the two reproduced defects; diagnostics unavailable and no live-provider/CLI integration performed.
- Top risk: the new terminal error handler cannot deliver its error on an upstream socket failure because the shared forwarding handler destroys the client first (`translation-proxy-base.ts:975`).
- What a robust implementation would add: coordinated Responses transport termination, clean-EOF processing of held CR, and regressions asserting actual client-visible terminals rather than accepting socket teardown or appending an extra delimiter.
