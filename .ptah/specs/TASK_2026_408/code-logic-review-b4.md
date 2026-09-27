# Code Logic Review â€” `TASK_2026_408`

Verdict: REJECTED
Score: 6/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 3 |

Scope: Batch 4's six named files in `D:\projects\ptah-extension-task-408`, including the authorized UTF-16LE hash change. Production files were read in full, together with their specs and the relevant collector/classifier paths. Diffs were read from this worktree, not the main checkout. References below use paths relative to this worktree; abbreviated translation filenames mean `libs/backend/auth-providers/src/lib/translation/`.

The normal argument-emission and resolver paths work, but three executable counterexamples remain. Findings 1 and 2 are inherited logic exposed by the reviewed state-machine contract; finding 3 is introduced by treating a named done item as an unseen call. The score is above the significant-problems band because ordinary interleaving, delayed names, done-only arguments, and all three resolver paths are exercised successfully. It falls below the sound band because the SDK accepts silent data loss/wrong input in the boundary cases below.

## Verification

- Ran once: `npx --no-install nx test @ptah-extension/auth-providers --outputStyle=static`, with `NX_DAEMON=false`. Nx reported successful test completion; the retained tail reports two passing snapshots and 19.711 seconds. The test/suite totals fell outside the retained tail, so no total is asserted. No test rerun was performed.
- Ran read-only, in-memory TypeScript probes against the actual translator and installed `@anthropic-ai/sdk` MessageStream. Each probe fed translated events into `MessageStream.fromReadableStream(...).finalMessage()`. SDK version is 0.127.0 (`node_modules/@anthropic-ai/sdk/package.json:3`). The three observed final messages are recorded below. These are local synthetic upstream events, not live-provider or pinned CLI execution evidence.
- Scoped `ptah_get_diagnostics` returned unavailable: the requested worktree files are outside its configured workspace root. No diagnostics pass is claimed. No listed Ptah file-content reader was available, so native reads were used.
- No applicable AGENTS.md/CLAUDE.md was found at the worktree root, ancestor paths checked, or the reviewed library hierarchy. `context.md`, component 5/6 of `implementation-plan.md`, Batch 4 of `batches.md`, and `implementation-plan-review.md` were read. `task-description.md` and `code-style-review.md` are absent in this task folder.
- No source or test files were edited; no git mutation or provider request was performed. The authorized Nx test command automatically attempted an Nx Cloud cache upload, which failed with a disabled-organization error. This was an unintended network attempt despite the requested no-network scope; it does not invalidate the local test success.

## Five logic questions

### 1. How does this fail silently?

A complete terminal snapshot replaces the evidence of truncated emitted tool input, allowing `message_stop` with SDK input `{}` (finding 1; `responses-stream-translator.ts:663`). An empty name-bearing delta is discarded before identity adoption, allowing an empty successful message with `stop_reason: tool_use` (finding 2; `responses-stream-translator.ts:432`).

### 2. What user action produces unexpected behaviour?

A tool-using request through a gateway that supplies a late name in an empty delta can lose that call (finding 2; `responses-stream-translator.ts:432`). A repeated named output-item completion creates a second client tool block with the same call ID (finding 3; `responses-stream-translator.ts:476`). These are upstream compatibility/repetition cases, not demonstrated ordinary provider behavior.

### 3. What input data produces a wrong answer?

An emitted delta `{"x":` followed by an incomplete terminal whose snapshot contains `{"x":1}` yields an SDK tool block with `input: {}` and `stop_reason: max_tokens`, rather than `upstream_incomplete` (finding 1; `responses-stream-translator.ts:665`). The snapshot does not repair bytes already emitted.

### 4. What happens when a dependency fails?

`terminateTruncated()` delegates to the error terminal (`responses-stream-translator.ts:276`); `failStream` clears open calls and emits only an error (`:698`). The HTTP handler invokes this on error and incomplete close (`translation-proxy-base.ts:1288`, `:1295`). Open blocks deliberately receive no stop before an error, as required by `implementation-plan.md:188`; this is not reported as a defect. Successful finalization closes open started blocks before `message_delta` (`responses-stream-translator.ts:720`). The incomplete-snapshot inconsistency in finding 1 remains the exception to safe failure classification.

### 5. What is missing that the requirements never mentioned?

The requirements need an explicit rule that terminal validation protects the argument bytes actually delivered, even when a snapshot is authoritative for upstream state (`implementation-plan.md:183`, `responses-stream-translator.ts:663`). They also need closed-call identity retention to prevent re-opening on repeated events (`responses-stream-translator.ts:489`) and identity processing independent of whether a delta carries argument characters (`:432`).

## Failure modes

### 1. Blocking â€” Snapshot validation can bless truncated emitted tool input

- Trigger: start call `c` / `Read`; receive argument delta `{"x":`; receive `response.incomplete` with reason `max_output_tokens` and a snapshot call whose arguments are `{"x":1}`. The same gap exists when a started call received no arguments but the snapshot supplies valid arguments.
- Symptom: the read-only probe produced a final SDK message containing `{type:'tool_use', id:'c', name:'Read', input:{}}`, `stop_reason:'max_tokens'`, and no error. This is a successful-looking result with fabricated/missing tool input.
- Evidence: `responses-stream-translator.ts:631` classifies `finalToolArgs`; `:665` returns snapshot arguments exclusively; `:720` closes and finalizes the actual emitted content without repairing or validating it. `responses-stream-translator.spec.ts:586` explicitly tests snapshot precedence, but only checks the stop reason for an unnamed call, so it misses the client-input consequence.
- Current handling: snapshot validity suppresses the incomplete-input failure even when the SDK received different, invalid bytes. This branch predates Batch 4 and follows `implementation-plan.md:183`; it is an inherited design gap, not a newly introduced regression.
- Recommendation: for started calls, validate received/emitted argument state as well as the terminal snapshot before allowing an incomplete stop. Preserve the delta-authoritative policy and emit `upstream_incomplete` when delivered input is incomplete; do not replace an already emitted prefix with a differing snapshot. Add an installed-MessageStream regression with a named open call and both truncated and empty emitted input.

### 2. Blocking â€” Empty name-bearing delta loses the buffered call

- Trigger: nameless `output_item.added` with `call_id:'c'`; argument delta `{"x":1}`; argument delta `{delta:'', name:'Read', call_id:'c'}`; `output_item.done` carrying the call ID and arguments but no name; then completion.
- Symptom: the read-only SDK probe returned `content: []`, `stop_reason:'tool_use'`, and no error. All argument bytes and the supplied identity are available upstream, but no tool call reaches the caller.
- Evidence: `responses-stream-translator.ts:432` returns on the empty delta before `adoptIdentity` at `:438`; the nameless done path emits nothing and deletes active state at `:489`; successful finalization uses `hadToolCalls` at `:734`.
- Current handling: identity is coupled to a non-empty argument fragment. This early return is inherited, but violates Batch 4's general name-bearing-delta handling for this empty-fragment boundary. If a later done item repeats the name, that later event repairs the case; the defect requires that it does not.
- Recommendation: adopt supplied identity and advance/flush the call even for an empty string delta; only argument appending should depend on fragment length. Add the empty-name-bearing-delta variant beside the non-empty regression at `responses-stream-translator.spec.ts:967` and assert the final SDK input, not just event counts.

### 3. Moderate â€” Repeated done event reopens an already closed call

- Trigger: receive the same named `response.output_item.done` twice for output index 0, call ID `c`, name `Read`, arguments `{"x":1}`, before the response terminal.
- Symptom: the probe emitted start/delta/stop at index 0 and again at index 1. MessageStream returned two identical `tool_use` blocks with ID `c`. A downstream consumer now sees duplicate calls; duplicate execution itself was not tested.
- Evidence: `responses-stream-translator.ts:476` creates a call whenever the active map has no entry and the item has a name; `:489` removes completed calls. `closedToolArgs` at `:491` is never consulted to prevent reopening. `trackToolCall` at `:517` has the same absence-only creation rule.
- Current handling: closed and genuinely unseen output indexes are indistinguishable. This is a Batch 4 regression in the newly supported unseen-done path. The trigger is a repeated/nonconforming upstream event, so severity is moderate rather than a claim that normal Responses ordering fails.
- Recommendation: retain an explicit closed-output-index set/state independent of whether arguments qualify for `closedToolArgs`. Ignore identical late/repeated events or reject conflicting ones; never emit a second tool block for the same closed call. Cover repeated done and late argument-done/delta events with MessageStream and exact start/stop/argument-count assertions.

## Blocking issues

Findings 1 and 2 above: silent wrong tool input at `responses-stream-translator.ts:665`, and silent tool-call loss at `responses-stream-translator.ts:432`. The trigger, impact, and concrete fix are included with each numbered finding.

## Serious issues

None established.

## Moderate and minor issues

Finding 3: repeated completion reopens a closed call (`responses-stream-translator.ts:476`). No independent style or naming findings are included.

## Data flow

1. **OK:** Responses request translation immediately enters the guard; a collision sends 400 before endpoint/auth calls (`translation-proxy-base.ts:553`, `:562`).
2. **OK:** guard rewrites definitions and historical function-call names; aliases hash UTF-16 code units and reverse lookup stays request-local (`responses-tool-names.ts:39`, `:73`, `:77`, `:93`).
3. **OK:** streaming, collector, JSON, and retry closures retain the resolver (`translation-proxy-base.ts:803`, `:821`, `:855`, `:862`; JSON emission at `:1358`). Collector restoration happens at `responses-stream-collector.ts:98`.
4. **GAP:** non-empty deltas append before identity adoption and one flush; empty deltas bypass identity adoption (finding 2; `responses-stream-translator.ts:432`).
5. **OK:** a started call receives a dense allocated index and one suffix flush; done payloads do not overwrite non-empty received arguments (`responses-stream-translator.ts:548`, `:564`, `:578`).
6. **GAP:** done closes and removes active state, but repeated named done can restart it (finding 3; `responses-stream-translator.ts:476`, `:489`).
7. **GAP:** incomplete classification can validate different bytes from those delivered (finding 1; `responses-stream-translator.ts:665`).
8. **OK:** ordinary successful finalization stops open blocks; error finalization suppresses success terminals per the plan (`responses-stream-translator.ts:698`, `:720`). No pre-send token/window check was added in the reviewed forwarding path (`translation-proxy-base.ts:549`, `:775`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Dense indexes allocated only at block start, sequential and interleaved | COMPLETE | Text allocation `responses-stream-translator.ts:374`; tool allocation `:564`; interleaving SDK tests `responses-stream-translator.spec.ts:1044` |
| Exactly-once arguments, late names, unseen done | PARTIAL | Normal cases tested at `responses-stream-translator.spec.ts:928`; findings 2 and 3 remain |
| Record only started/argument-carrying closed calls; retain empty started input | COMPLETE | `responses-stream-translator.ts:605`; terminal snapshot can bypass this evidence, finding 1 |
| Guard collision rejected before upstream | COMPLETE | `translation-proxy-base.ts:553`; HTTP assertion `translation-proxy-base.spec.ts:2449` |
| Restore names on stream, collector, JSON and retry | COMPLETE | Resolver flow above; three-path HTTP and retry cases `translation-proxy-base.spec.ts:2416`, `:2465` |
| Valid names preserve upstream bytes | COMPLETE | Guard keeps names; raw-body comparisons `translation-proxy-base.spec.ts:2437` |
| Unicode and 64/65-character boundaries | COMPLETE | Table and lone-surrogate cases `responses-tool-names.spec.ts:90`, `:129` |
| Installed MessageStream oracle | COMPLETE | Actual import `responses-stream-translator.spec.ts:29`, helper `:468`, final parsed input checks `:922`; missing failing cases enumerated above |
| No proxy-side pre-send token/window check | COMPLETE | Reviewed guard/forwarding diff `translation-proxy-base.ts:549`, `:775` |

Implicit requirements not addressed: terminal validation of delivered tool input, independent identity updates, and completed-call idempotence (findings 1â€“3).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Delayed name with non-empty final delta | YES | One suffix flush, `responses-stream-translator.ts:437`, `:578` | SDK coverage exists |
| Name on empty delta | NO | Early return, `responses-stream-translator.ts:432` | Finding 2 |
| Matching or differing done args after deltas | YES | `receivedArgs` wins, `responses-stream-translator.ts:548` | Terminal snapshot has a different rule, finding 1 |
| First observation is named output-item done | YES | Start/flush/stop, `responses-stream-translator.ts:476` | Repeated completion reopens it |
| Parallel calls and delayed start order | YES | Start-only allocator, `responses-stream-translator.ts:564` | No normal-order index reuse found |
| Never-named closed call | YES, per contract | No client block; retained argument evidence, `responses-stream-translator.ts:491` | Successful omission is explicitly prescribed by plan `:277` |
| Open tool at truncation/failure | YES, per error contract | One error and finalized state, `responses-stream-translator.ts:698` | No block stop is intentional; no live CLI probe performed |
| Started empty/truncated call with valid incomplete snapshot | NO | Snapshot replaces accumulator, `responses-stream-translator.ts:665` | Finding 1 |
| Repeated completion | NO | Absence in active map means new call, `responses-stream-translator.ts:476` | Finding 3 |
| Distinct lone-surrogate names | YES | Lossless hash input, `responses-tool-names.ts:43` | Authorized change; no name-map defect found |

## Verdict

- Recommendation: REJECT
- Confidence: HIGH for the reproduced outputs; MEDIUM for their frequency across real providers/gateways.
- Top risk: a terminal can appear successful while the client receives missing or fabricated tool input (`responses-stream-translator.ts:665`, `:432`).
- What a robust implementation would add: delivered-argument validation at incomplete termination, identity processing for empty deltas, explicit closed-call state, and installed-MessageStream regressions for all three counterexamples. Preserve the verified guard plumbing and the Batch 2 error-terminal contract.
