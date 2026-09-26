# Batches - TASK_2026_408

Total tasks: 19 | Batches: 11 | Complete: 10/11

Worktree: `D:\projects\ptah-extension-task-408`, branch `fix/task-408-codex-proxy-phase-1-2` (base origin/main `ebfc73321`). Never touch `D:\projects\ptah-extension`; never commit to main; never stage `node_modules` (junction, git-ignored).

## Recorded defaults and gate decisions

- Gate 0.1: subagents implement; code-logic review of shipping code routes to a codex CLI lane (cross-side); code-style review may be a subagent.
- Gate 2: APPROVED, reactive-only. No proxy-side pre-send token or window check (TASK_2026_561 owns that). Any such check in a batch is a rejection.
- Open item 1 (accepted): one targeted run of `output-style-activation.resolver.spec.ts` in `@ptah-extension/output-styles` (Batch 8 only). No other unchanged project runs.
- Open item 2 (accepted, owned by Batch 4, Task 4.2): a name-bearing delta uses ONE flush after append-and-optional-start; the current delta is never emitted twice. Regression required (see Task 4.2).
- Batch-size rule (at most 6 files, at most 2 libs per batch) splits the plan's proposed B1, B2 and B3 (8 files each) into two batches each. Order is unchanged: Phase 1 = Batches 1-2, then Phase 2. Every split point is at a file boundary that verifies on its own.
- Auth-providers batches (1-6) run strictly in sequence even where files are disjoint (Batch 5 vs 3-4), because they share one Nx project: a concurrent edit would corrupt the other batch's `test,typecheck` run.
- Batches 7 (`@ptah-extension/shared`) and 8 (`@ptah-extension/agent-sdk`) are disjoint in files and projects from Batches 1-6 and may be dispatched concurrently with Batch 1 or any later batch. Recommended default: start them together with Batch 1. Each is still verified, reviewed and committed on its own.
- Batch 10 (docs and comments) runs after Batch 9 so `ownership.md` records the observed A3 (unknown slash command) and A5 (compaction) outcomes instead of predictions.
- Task-tracking files: the uncommitted `.ptah/specs/TASK_2026_408/{task.md, context.md if changed, implementation-plan.md, implementation-plan-review.md, phase-3-options.md, batches.md}` and `.ptah/specs/TASK_2026_564_87a6/` go in a **separate** `docs(task-specs): ...` commit made in the Batch 1 commit window, immediately before the Batch 1 code commit, so code commits stay pure. Later updates to `batches.md` ride in the same window of each batch as `docs(task-specs)` or with the Batch 10 docs commit.
- Commits: one per batch, commitlint rules from `.commitlintrc.json` (subject at most 72 characters, header at most 100, body lines at most 100, lower-case subject start). Plan-proposed subjects exceed 72 characters, so the subjects below are shortened. Every message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Stage specific files only; never skip hooks.
- Verification per batch: `npx nx run-many -t test,lint,typecheck -p <changed projects>`, output tailed. Never workspace-wide.
- After Batch 10: senior-tester writes `test-report.md` with exact counts per project, split mocked vs live (live = none).

## Plan validation

Status: PASSED WITH RISKS

Checks run against disk (worktree):

- All MODIFY targets exist; all CREATE targets are absent (`responses-error-mapping.ts`, `responses-tool-names.ts`, `responses-tool-output-images.ts`, `translation-proxy.sdk.integration.spec.ts`, `codex-provider-entry.spec.ts`, `ownership.md`).
- Nx project names confirmed from `project.json`: `@ptah-extension/auth-providers`, `@ptah-extension/shared`, `@ptah-extension/agent-sdk`, `@ptah-extension/cli-agent-runtime`, `ptah-cli`, `@ptah-extension/output-styles`; each has `test`, `lint`, `typecheck`.
- `node_modules/@anthropic-ai/claude-agent-sdk/package.json` reports `0.3.278`.
- Line anchors spot-checked and current: stream translator `lineBuffer` `:130`, local `currentEventType` `:186`, `handleEvent` cases `:233-245`, pre-start index `:317`/`:363`, rewind `:435`; proxy base `translateAnthropicToResponses` call `:508`, `requiresResponsesStream` `:657`, `statusCode >= 400` `:1009`, silent `res.end()` `:1145-1146`/`:1156`, `safeJsonParse` fabrication `:1202`.
- `auth-providers` typecheck uses `tsconfig.lib.json` (specs excluded); spec type errors surface only through ts-jest in `test`. Both targets are always run together.

Assumptions:

- A1 overflow message patterns are conservative defaults — unverified (live probe P7 not authorized); Task 1.1 pins the narrow pattern set and the no-generic-"too many tokens" rule with negative cases.
- A3 unknown `/command` behaviour in SDK `-p` mode — unverified; Task 9.1 observes and pins it; Task 10.1 records the observed result.
- A4 CLI tolerates its own >64-char `mcp__` names — unverified; Task 9.1 S5 pins the round trip.
- A5 reactive compaction fires on prompt-too-long under default options — unverified; Task 9.1 S6 asserts `compact_boundary`, or renames to "S6 overflow propagation" and says so in `test-report.md`. Never silently weakened.
- Codex static models declare no per-token rates, so `seedStaticModelPricing` never seeds `maxTokens: 0` for them (`provider-lookup.spec.ts:154` path) — unverified; Task 7.1 checks.
- A `contextLength` of `0` is never consumed as a real window by any Codex static-list consumer — verified in the plan for UI and tier ranking; Task 7.1 re-checks `codex-translation-proxy.ts:80`, `provider-models.service.ts:381-395`, `ptah-cli-registry.ts:245,321,1614`.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| R1 first real-binary spec: extra CLI requests, cold start, CI without the binary | HIGH | Task 9.1: content-scripted mock (`ok` for side queries), isolation env, 120 s timeout, loud failure when the binary is missing, never `skip` |
| Name-bearing delta emitted twice when start-flush and delta-emit branches are copied from `:374`/`:401` (open item 2) | HIGH | Task 4.2: single flush after append-and-optional-start; regression through installed `MessageStream` |
| R6 frame-based SSE dispatch changes when events are emitted; non-conformant upstream stalls until EOF | MEDIUM | Task 2.1: blank-line dispatch, CR/CRLF, byte-at-a-time and split-after-`event:` specs; `[DONE]` spec `:388-418` stays green; EOF goes to `terminateTruncated()` |
| Parity drift between stream, forced-SSE collector and JSON paths | MEDIUM | Task 2.2: one shared `it.each` fixture table across all three paths, all terminal-table rows |
| Overflow classification turns a non-overflow 400 into a compaction loop | MEDIUM | Task 1.1 negative cases; Task 2.2 asserts a non-overflow 400 keeps today's `api_error` body byte-for-byte |
| Upstream body text leaks into client messages or logs (OpenCode rule) | MEDIUM | Tasks 1.1 and 2.2: sentinel `private-upstream-value` never appears in output or warn log |
| Scope creep into TASK_2026_562-owned functions of `responses-request-translator.ts` | MEDIUM | Task 5.1: only `ResponsesFunctionCallOutputItem` (`:67-71`) and `translateToolResultToFunctionCallOutput` (`:391-416`) change; reviewer diffs the file |
| Builder guard literal broken by the disclosure edit | MEDIUM | Task 8.1 keeps `settingSources: includesUserSettingSource(`; Batch 8 runs the targeted output-styles guard spec |
| `staticModels[0]` default-model fallback changes | MEDIUM | Task 7.1 appends new IDs after the existing six; spec asserts `gpt-5.4` first |
| R2 Codex array tool output rests on pinned-client evidence only | LOW | Task 6.1: one-line rollback (drop Codex hook override); placeholder path tested for OpenCode |
| R3 upstream-failed streams labelled `invalid-response` in timing | LOW | Accepted by plan; Task 2.1 notes it; no signature widening |
| R4 `[DONE]`-only stream ends `end_turn` | LOW | Kept (spec-pinned); Task 10.1 documents it as a residual |
| Integration spec lengthens every later `auth-providers` test run | LOW | Only Batch 9 onward; 120 s scenario timeout bounds it |

Edge cases:

- Frame split after `event: <name>\n` with JSON omitting `type` — Tasks 2.1 (translator) and 1.2 (collector)
- Multiline `data:` joined by `\n`; CRLF line ends; byte-at-a-time feed — Tasks 2.1, 1.2
- Frame pending at EOF is not dispatched; reported by `terminateTruncated()` — Task 2.1
- Standalone `error` event top-level `code`/`message` and nested `error.{code,message}` — Tasks 1.1, 1.2, 2.1, 2.2
- Bare `{"type":"error"}` / `{"type":"response.failed"}` frames still reject (collector spec `:161-167`) — Task 1.2
- `response.failed` snapshot missing `output` still classifies — Task 1.2
- Incomplete + malformed tool args for `max_output_tokens` and `content_filter` gives `upstream_incomplete` on all three paths; no `{}` fabrication — Tasks 1.2, 2.1, 2.2
- Events after finalisation are ignored; `terminateTruncated()` idempotent — Task 2.1
- Upstream socket `error` with `res.destroyed` — Task 2.2
- Tool name collision (two originals to one alias, or alias equals another original) gives 400 before any upstream call — Tasks 3.1, 4.3
- Unknown upstream tool name passes through unchanged — Task 3.1
- Retry path (`retryFn` recursion in `forwardToResponsesApi`) keeps `toOriginalName` — Task 4.3
- Args only in `function_call_arguments.done`; only in `output_item.done`; deltas plus matching done (no duplicate); delayed name at `output_item.done`; name supplied by a delta after buffered pre-name deltas — Task 4.2
- `output_item.done` for a call never seen via `added`/delta but carrying `call_id` + `name` — Task 4.2
- Call that never gets a name: no emission, args kept in `closedToolArgs` — Task 4.2
- Two interleaved tool calls get distinct dense indexes; sequential streams keep today's indexes (`:274-386`) — Task 4.2
- Unresolvable image media type gives placeholder `input_text`; `is_error` with first part an image — Task 5.1
- Text-only tool results stay byte-identical strings on all providers — Tasks 5.1, 5.2, 6.1
- Missing pinned SDK or platform binary fails loudly — Task 9.1

## Batch 1: Phase 1a - error classifier and collector terminal handling — COMPLETE (commit 8cb5697f8)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a second backend-developer sub-agent resumed with the reviewer's findings
- Execution mode: sequential
- Rationale: Task 1.2 imports Task 1.1's classifier and its `AnthropicErrorMapping` type; tightly coupled contract work
- Tasks: 2 | Depends on: none
- Files (4, 1 lib): `responses-error-mapping.ts` (C), `responses-error-mapping.spec.ts` (C), `responses-stream-collector.ts`, `responses-stream-collector.spec.ts`
- Commit: `fix(auth-providers): classify Responses overflow and terminal failures` (preceded by the separate `docs(task-specs): add TASK_2026_408 phase 1-2 plan and batches` commit for tracking files)

### Task 1.1: Upstream error classifier module — COMPLETE

- Files: CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-error-mapping.ts`; CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-error-mapping.spec.ts`
- Plan reference: implementation-plan.md:52-83 (SDK contract, overflow shapes), :113-152 (component 1, terminal table), :493 (test cases)
- Pattern to follow: pure stateless helpers in `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-helpers.ts:22-39`
- Quality requirements: no I/O, no logging, never throws; messages built only from fixed text, codes sanitized by `/^[a-z0-9_]{1,64}$/` (else omitted) and parsed integers; no import from the proxy base
- Validation notes: A1 — only the five listed patterns, statuses 400/413 only, no generic "too many tokens"; numbers extracted only from the two listed regexes; output must satisfy the CLI's `F6e` regex when numbers exist and `QQ` always; sentinel `private-upstream-value` never in output; 401/403/500/non-JSON/non-overflow 400 return `undefined`
- Implementation details: export `AnthropicErrorMapping`, `classifyUpstreamHttpError(status, rawBody)`, `classifyResponsesError(code, message)`, `classifyResponsesTerminal(...)` (precedence rule: for `incomplete`, any tool args failing `isCompleteToolArguments` gives the 502 `upstream_incomplete` mapping with the existing collector text, regardless of reason), `isCompleteToolArguments(args)`, `promptTooLongMessage(actual?, limit?)`; request-describing `ResponseError.code` values give 400 `invalid_request_error`, `rate_limit_exceeded` gives 429, everything else 502

### Task 1.2: Collector terminal handling and schema widening — COMPLETE

- Depends on: Task 1.1
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-collector.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-collector.spec.ts`
- Plan reference: implementation-plan.md:201-217 (component 4, collector half), :496-497 (framing and parity rows)
- Pattern to follow: existing `ResponsesStreamError` (`responses-stream-collector.ts:5-14`) and frame dispatch (`:126-173`)
- Quality requirements: existing codes, messages and specs unchanged (including `:161-167` rejections and split spec `:147-152`); all new schema fields optional
- Validation notes: zod strips unknown keys today — add top-level `code`, `message`, nested `error` to `eventSchema` and `error` to `responseSchema`; `response.failed` uses `safeParse` so a snapshot without `output` still classifies; precedence rule runs in `onEnd` before `collectOutputContent`
- Implementation details: add `'upstream_failed'` code and optional readonly `mapping` to `ResponsesStreamError`; `error` dispatch throws with `classifyResponsesError(event.code ?? event.error?.code, event.message ?? event.error?.message)`; `response.incomplete` accepted for every reason at dispatch; replace `responseStopReason` (`:78-81`) with `classifyResponsesTerminal`; specs cover every terminal row, both error payload shapes, and split/multiline/byte-at-a-time/CRLF variants of `response.failed`, `response.incomplete`, `error` with JSON omitting `type`

### Batch 1 verification

- Both new files exist with real implementations; collector changes present
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tail output)
- Reviewer: code-logic review via codex CLI lane (error classification is behavioural and security-relevant)
- Edge cases for Tasks 1.1/1.2 above addressed
- Carried into Batch 2 (Task 2.2, already in scope): the base collector catch (`translation-proxy-base.ts:762-773`) must honour `ResponsesStreamError.mapping`. Until then `upstream_failed` goes out as 502 `api_error` `upstream_failed: <mapped message>` (transient on this branch only). The three-path parity `it.each` table still lives in `translation-proxy-base.spec.ts` (Task 2.2); Batch 1's collector-only table does not satisfy it.

## Batch 2: Phase 1b - stream translator terminals and proxy-base lifecycle — COMPLETE (commit 74e2358f3)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: second backend-developer sub-agent with reviewer findings
- Execution mode: sequential
- Rationale: base changes call new translator methods (`terminateTruncated`) and the classifier; cross-file lifecycle work
- Tasks: 2 | Depends on: Batch 1
- Files (4, 1 lib): `responses-stream-translator.ts`, `responses-stream-translator.spec.ts`, `translation-proxy-base.ts`, `translation-proxy-base.spec.ts`
- Commit: `fix(auth-providers): end Responses streams with one Anthropic terminal`

### Task 2.1: Stream translator frame state, accumulator and terminal events — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-translator.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-translator.spec.ts`
- Plan reference: implementation-plan.md:169-199 (component 3), :495-496
- Pattern to follow: collector framing `responses-stream-collector.ts:126-173`; usage handling `responses-stream-translator.ts:463-478`
- Quality requirements: existing specs green unchanged, including `[DONE]` `:388-418` and index expectations `:274-386`; emission logic for tool calls unchanged in this batch (component 6 is Batch 4)
- Validation notes: R6 (frame dispatch on blank line, pending frame at EOF not dispatched); R3 accepted; precedence rule uses `event.response.output` args first, else `receivedArgs` of active plus `closedToolArgs`; all new handlers respect and set `finalized`; failed/error emit no `content_block_stop`/`message_delta`
- Implementation details: move pending event name and data lines to instance fields next to `lineBuffer`; add `receivedArgs` to `ActiveToolCall` and a `closedToolArgs` record; handle `response.incomplete`, `response.failed`, `error`; `emitFinalEvents` optional `stopReason`; public idempotent `terminateTruncated()`; spec every terminal row plus `MessageStream.fromReadableStream` resolve/reject

### Task 2.2: Proxy-base overflow mapping, truncation terminal, non-stream parity, header comment — COMPLETE

- Depends on: Task 2.1
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.spec.ts`
- Plan reference: implementation-plan.md:154-167 (component 2), :191-193 (component 3 base half), :218-222 (component 4 base half), :387-388 (component 10 header comment), :494, :497
- Pattern to follow: `FakeTranslationProxy` harness `translation-proxy-base.spec.ts:32-101,630-760,1039-1125`; `sendErrorResponse` `translation-proxy-helpers.ts:88-107`
- Quality requirements: non-overflow path byte-identical; 401/429 untouched; warn log carries no body; OpenCode raw-body rule preserved; no pre-send window check (Gate 2)
- Validation notes: overflow classification inserted once in the `statusCode >= 400` handler, affecting every lane; chat/completions lane also gets the mapping; JSON path must not fabricate `{}` on incomplete; `status === 'failed'` does not call `onUsage`; upstream `error` writes `terminateTruncated()` only if `!res.destroyed`
- Implementation details: `forwardToApi` calls `classifyUpstreamHttpError` first; streaming `end` writes `terminateTruncated()` when not finalised; collector catch honours `error.mapping`; `handleResponsesNonStreamingResponse` handles `failed`/`incomplete` via the classifier; header comment (at most 5 lines) naming path A and `.ptah/specs/TASK_2026_408/ownership.md`; shared `it.each` parity table across stream true, stream false + `forceResponsesStream`, and stream false JSON; installed `@anthropic-ai/sdk` `APIError.generate(400, body)` message contains `prompt is too long`

### Batch 2 verification

- Team-leader decision on the one edited pre-existing expectation (`responses-stream-translator.spec.ts:164-171`, was `[]`, now one `error` event and `onUsage` not called): accepted. That case pinned the `default: return []` swallow the plan explicitly replaces (implementation-plan.md:108); its intent (no usage published from a failed terminal) is kept.
- Carried into Batch 4 (Task 4.2): `output_item.done` for a call never seen via `added`/delta with no `arguments` records `undefined` in `closedToolArgs`, so a later `response.incomplete` gives `upstream_incomplete`. Task 4.2 must keep that deliberate, or record only calls that were started or carried args.

- Files contain the required work; `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed)
- Reviewer: code-logic review via codex CLI lane (stream lifecycle, parity across three paths)
- Phase 1 complete after this commit (TASK_2026_561 A8 unblocked)
- Review history: `code-logic-review-b2.md` REJECTED 6/10 (post-header socket abort destroyed downstream before a terminal; CR-only terminal dropped at EOF); fixed in the same four files (`streamingOwnsUpstreamFailure` on the Responses streaming lane, guarded single `finish`, new idempotent `endOfStream()`); `code-logic-review-b2-r1.md` APPROVED 8/10. Final run 50 suites / 1164 tests.

## Batch 3: Phase 2a - tool-name guard module and collector resolver — COMPLETE (commit f02215eec)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: second backend-developer sub-agent
- Execution mode: sequential
- Rationale: collector resolver depends on the guard's reverse-map contract
- Tasks: 2 | Depends on: Batch 2
- Files (4, 1 lib): `responses-tool-names.ts` (C), `responses-tool-names.spec.ts` (C), `responses-stream-collector.ts`, `responses-stream-collector.spec.ts`
- Commit: `fix(auth-providers): add deterministic Responses tool-name guard`

### Task 3.1: Tool-name guard module — COMPLETE

- Files: CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-names.ts`; CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-names.spec.ts`
- Plan reference: implementation-plan.md:229-252 (component 5), :498, :502
- Pattern to follow: pure translator style `responses-request-translator.ts:17-19`; types read-only from `:58-117`
- Quality requirements: pure, no mutation, O(n), hashes only invalid names
- Validation notes: alias `${sanitized.slice(0,53)}_${sha256(original).hex.slice(0,10)}` via `node:crypto`; rewrite `tools[].name` and every `input[]` `function_call`; collision throws `ResponsesToolNameCollisionError`; unknown upstream name passes through
- Implementation details: export `guardResponsesToolNames(request)` returning `{ request, toOriginalName }` and the collision error; spec: 70-char `mcp__server.with.dots__tool`, determinism, valid names deep-equal, history rewrite, reverse lookup, collision, replay pairing (call ids, alias equality, order)

### Task 3.2: Collector tool-name resolver — COMPLETE

- Depends on: Task 3.1
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-collector.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-collector.spec.ts`
- Plan reference: implementation-plan.md:244
- Pattern to follow: `collectFunctionCall` `responses-stream-collector.ts:63`
- Quality requirements: trailing optional parameter defaulting to identity; existing call sites compile unchanged
- Validation notes: aliased names never reach the SDK
- Implementation details: `collectResponsesStream(..., resolveToolName = (n) => n)` applied in `collectFunctionCall`; spec an aliased name resolved to its original

### Batch 3 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed)
- Reviewer: code-logic review via codex CLI lane (collision and reverse-map correctness)
- Review: `code-logic-review-b3.md` APPROVED 8/10; one minor coverage suggestion (exact 65-char boundary, emoji / UTF-16 slicing, lone-surrogate collision pair) carried into Batch 4 as Task 4.4. Final run 51 suites / 1183 tests.

## Batch 4: Phase 2b - stream tool-call state and guard plumbing — COMPLETE (commit 118380beb)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: second backend-developer sub-agent
- Execution mode: sequential
- Rationale: component 5 resolver and component 6 rewrite share the translator constructor and emission paths; the base then threads the resolver into all three handlers
- Tasks: 4 | Depends on: Batch 3
- Files (6, 1 lib): `responses-stream-translator.ts`, `responses-stream-translator.spec.ts`, `translation-proxy-base.ts`, `translation-proxy-base.spec.ts`, `responses-tool-names.spec.ts` (Task 4.4), `responses-tool-names.ts` (orchestrator-approved one-line fix found by Task 4.4, see below)
- Commit: `fix(auth-providers): fix streamed tool-call args and block indexes`

### Task 4.1: Translator resolver parameter — COMPLETE

- File: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-translator.ts` (+ spec)
- Plan reference: implementation-plan.md:243
- Pattern to follow: existing constructor signature
- Quality requirements: trailing optional `resolveToolName = (n) => n`, applied at every point a name enters (today `:312`, `:359`, `:371`) and in the new done paths
- Validation notes: aliased names never reach the SDK
- Implementation details: constructor parameter plus spec with an alias resolver

### Task 4.2: Block-index allocator and received/emitted argument state — COMPLETE

- Depends on: Task 4.1
- File: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-translator.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-stream-translator.spec.ts`
- Plan reference: implementation-plan.md:254-287 (component 6), :499, :501; implementation-plan-review.md:13 (open item 2)
- Pattern to follow: `MessageStream` accumulator usage `responses-stream-translator.spec.ts:29,97-104`
- Quality requirements: index allocated only on `content_block_start`; remove rewind `:435` and pre-start assignment `:356-367`; sequential streams keep today's indexes (`:274-386`); emitted text always a prefix of `receivedArgs`; emission only after that call's start; each character emitted exactly once
- Validation notes (open item 2, mandatory): a delta handler does append to `receivedArgs`, then starts the block if this delta supplies the name, then performs ONE flush of `receivedArgs.slice(emittedLength)`. It must not keep today's two independent branches (start at `:374`, emit at `:401`) that would emit the current delta twice. Distinguish already-started from started-this-event. Required regression: buffered pre-name argument deltas, then a delta that supplies the name plus the final fragment; the installed `MessageStream` final `tool_use.input` equals one complete parsed object and the concatenated `input_json_delta` text equals the full args exactly once
- Implementation details: `nextBlockIndex` plus open-text-block index; `emittedLength` per call; done payloads fill `receivedArgs` only when empty, otherwise ignored; start from `added`/delta/done flushes once; unseen call at `output_item.done` with `call_id` + `name` does start, flush, stop; nameless call emits nothing and is kept in `closedToolArgs`; `MessageStream` cases (a) deltas only, (b) done only, (c) deltas plus matching done, (d) delayed name at `output_item.done`, (e) name-bearing delta after buffered deltas; two interleaved calls get distinct indexes and intact inputs

### Task 4.3: Proxy-base guard call and resolver plumbing — COMPLETE

- Depends on: Tasks 3.2, 4.2
- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.spec.ts`
- Plan reference: implementation-plan.md:240-245, :498
- Pattern to follow: `handleMessages` Responses branch `translation-proxy-base.ts:507-510`; `forwardToResponsesApi` `:702-795`
- Quality requirements: collision gives 400 `invalid_request_error` "Tool name collision after Responses name normalization: <alias>" before any upstream call; `retryFn` recursion carries `toOriginalName`
- Validation notes: the JSON path applies the resolver at the name read (`:1201`); valid names produce byte-identical upstream requests
- Implementation details: call `guardResponsesToolNames` right after `translateAnthropicToResponses`; pass `toOriginalName` to the translator constructor, `collectResponsesStream` and `handleResponsesNonStreamingResponse`; HTTP spec: 70-char MCP-style name round-trips on stream true and stream false, and in replayed history

### Task 4.4: Tool-name guard boundary and Unicode regression cases (carried from code-logic-review-b3.md) — COMPLETE

- File: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-names.spec.ts` (test-only; `responses-tool-names.ts` must not change unless a new case exposes a real defect, which must then be reported, not silently fixed)
- Plan reference: implementation-plan.md:229-252; code-logic-review-b3.md minor finding 1
- Pattern to follow: existing table-driven cases in the same spec (`:78`, `:85`)
- Quality requirements: table-driven; each row asserts the exact alias length, the sanitized prefix length, validity against `^[a-zA-Z0-9_-]{1,64}$`, and the reverse lookup
- Validation notes: rows for exactly 64 valid characters (kept), exactly 65 valid characters (aliased to 64), emoji / UTF-16 surrogate-pair input (each code unit replaced, prefix sliced by code units), and an actual lone-surrogate pair of distinct originals that sanitize identically (distinct aliases via hash, reverse lookup returns each original)
- Implementation details: add cases only; no production change

### Batch 4 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed)
- Open item 2 regression present and passing
- Reviewer: code-logic review via codex CLI lane (exactly-once emission and index allocation are correctness-critical for the pinned CLI)
- Scope addition (orchestrator-approved, reported by the executor rather than silently fixed): Task 4.4 exposed that `aliasFor` hashed UTF-8, so distinct lone-surrogate originals (`'x\uD83D'` vs `'x\uDE00'`) produced one alias (fail-safe 400). Fixed by hashing `'utf16le'` (`responses-tool-names.ts:41-43`, only change in that file). Aliases are recomputed per request from the SDK's original names and never persisted, so the value change needs no migration. Rides in the Batch 4 commit and is named in its body.
- closedToolArgs decision (carried from Batch 2): recorded only when the call started or carried arguments (`responses-stream-translator.ts:600-612`); an unseen, nameless, argless done is not recorded; a started call with no args records `''` (gives `upstream_incomplete`). Pinned by tests.
- Review history: `code-logic-review-b4.md` REJECTED 6/10 (snapshot precedence could bless truncated emitted input; empty name-bearing delta lost the buffered call; repeated done reopened a closed call); fixed in the translator and its spec only (`closedEmittedArgs` checked by `finalToolArgs`, early return only when empty and nameless, `isClosedCall` guard on all four entry points); `code-logic-review-b4-r1.md` APPROVED 8/10. Final run 51 suites / 1236 tests.

## Batch 5: Phase 2c - tool-result image translation and downgrade post-pass — COMPLETE (commit 296f06942)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lanes x 2 (the two tasks are file-disjoint and self-contained)
- Execution mode: sequential (default; file-disjoint, but the post-pass consumes the widened output type from Task 5.1)
- Rationale: small pure changes; Task 5.2 depends on Task 5.1's type
- Tasks: 2 | Depends on: Batch 4 (project serialisation only; files disjoint)
- Files (4, 1 lib): `responses-request-translator.ts`, `responses-request-translator.spec.ts`, `responses-tool-output-images.ts` (C), `responses-tool-output-images.spec.ts` (C)
- Commit: `fix(auth-providers): translate tool-result images for Responses`

### Task 5.1: Request translator image parts (two permitted locations only) — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-request-translator.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-request-translator.spec.ts`
- Plan reference: implementation-plan.md:289-314, :500
- Pattern to follow: `flattenToResponsesContentParts` `responses-request-translator.ts:434-446`
- Quality requirements: only `ResponsesFunctionCallOutputItem` (`:67-71`) and `translateToolResultToFunctionCallOutput` (`:391-416`) change (TASK_2026_562 boundary); text-only snapshot `:162` unchanged
- Validation notes: text-only stays a string; unresolvable media gives `input_text` `[image omitted: unsupported media type]`; `is_error` prefixes the first text part or inserts an `Error:` part before a leading image
- Implementation details: widen `output` to `string | Array<ResponsesInputTextPart | ResponsesInputImagePart>`; build the array in block order via `resolveImageMediaType`

### Task 5.2: Downgrade post-pass module — COMPLETE

- Depends on: Task 5.1
- Files: CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-output-images.ts`; CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-output-images.spec.ts`
- Plan reference: implementation-plan.md:315-320, :328
- Pattern to follow: Task 3.1's pure post-pass shape
- Quality requirements: pure; input not mutated; strings pass through deep-equal
- Validation notes: each `input_image` becomes `[image omitted: this provider does not accept images in tool results]`; parts joined with `\n`
- Implementation details: export `downgradeToolOutputImages(request)`

### Batch 5 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed)
- Reviewer diffs `responses-request-translator.ts` to confirm only the two locations changed
- Reviewer: code-logic review via codex CLI lane
- On-disk hunks in `responses-request-translator.ts`: `@@ -66` / `@@ -70` (interface doc + `output` type) and `@@ -389,0` / `@@ -393,0` (doc comment and body of `translateToolResultToFunctionCallOutput`; the `-389` hunk header names the preceding function only because git labels hunks by the nearest earlier declaration). Existing `ResponsesInputTextPart` / `ResponsesInputImagePart` (`:41-50`) reused; no new types.
- TASK_2026_562 boundary CONFIRMED: the codex lane cannot run git, so the orchestrator ran `git diff -U1` on `responses-request-translator.ts` — 4 hunks, all inside the `ResponsesFunctionCallOutputItem` interface (doc + `output` type) and `translateToolResultToFunctionCallOutput` (doc comment + body). Matches the team-leader's `-U0` check above.
- Review: `code-logic-review-b5.md` APPROVED 8/10; 0 blocking/serious/moderate. `image_url` string shape checked against installed OpenAI declarations and pinned Codex strings; the omitted `detail` field is recorded as an evidence limit, not a defect. One minor coverage finding carried into Batch 6 as Task 6.2. Final run 52 suites / 1250 tests.

## Formatting follow-up (decided in Batch 5 verification) — COMPLETE (commit 2c77b33c9, after Batch 6 commit 3613f2ebf)

- Finding: `npx nx format:check` fails on 10 files this task committed or edits (`responses-error-mapping.ts` + spec, `responses-stream-collector.ts` + spec, `responses-stream-translator.ts` + spec, `responses-tool-names.ts` + spec, `translation-proxy-base.ts` + spec). `translation-proxy-helpers.ts` also fails but is unchanged since `ebfc73321`, so it is pre-existing on main and out of scope.
- Hook: `.husky/pre-commit` runs lint-staged, and `.lintstagedrc.mjs` runs `npx nx format:write --files=<staged>`. None of these paths is in `.prettierignore`, yet the committed content is unformatted, so the hook's format step is not taking effect for these commits. Root cause not established; it is a repository tooling issue outside this task and is recorded for `future-enhancements`, not fixed here.
- EOL hypothesis checked in Batch 6 verification and REJECTED: `core.autocrlf=true`, but `git ls-files --eol` shows `i/lf w/lf attr/text=auto eol=lf` for the failing files, and `npx prettier --check --end-of-line auto` still fails on all six probed files. Piping the untouched main file `translation-proxy-helpers.ts` through prettier 3.9.8 (repo pins `^3.8.1`) gives real layout changes (zod method chains broken onto separate lines). These are genuine formatting differences that main already carries, so the style commit is kept.
- Scope (orchestrator decision after Batch 6, supersedes the wider 12-file scope first recorded here): format ONLY files this task CREATED that fail `prettier --check`. The failures in pre-existing files (`translation-proxy-base.ts`, the stream translator, the collector, the Codex proxy and their specs) are prettier-version drift that main already carries; reformatting them would rewrite many lines this task did not write and make the TASK_2026_561 / TASK_2026_562 rebases harder. Of the files added since `ebfc73321`, four fail: `responses-error-mapping.ts`, `responses-error-mapping.spec.ts`, `responses-tool-names.ts`, `responses-tool-names.spec.ts` (all under `libs/backend/auth-providers/src/lib/translation/`). Passing, so untouched: `responses-tool-output-images.ts` + spec, `codex-provider-entry.spec.ts`. The drift in pre-existing files is left for `future-enhancements`.
- Decision: no prettier writes folded into feature batches (they would bury behavioural diffs under reformatting and exceed the 6-file cap). One format-only step runs after Batch 6 and before Batch 9, when no other auth-providers work is in flight: a backend-developer runs `npx nx format:write --files=<the 4 files above>`, then `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers --parallel=2`; code-style-reviewer confirms the diff is formatting only; commit `style(auth-providers): apply prettier to new TASK_2026_408 translation modules`.
- As executed: the orchestrator ran `npx prettier --write` (3.9.8, repo `.prettierrc`) on exactly the four files, so no code was authored. `git status` showed only those four plus `batches.md`. The diff is 622+ / 187-, and it is line-wrapping to the default 80-column house style: 100 of 130 auth-providers `.ts` files already pass `prettier --check`, while the new modules used ~100-column lines. `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers --parallel=2 --skip-nx-cache` passed: 52/52 suites, 1271/1271 tests (same as Batch 6), lint 0 errors / 4 warnings.
- Reviewer gate: the orchestrator waived the separate code-style-reviewer because deterministic formatter output plus an unchanged test count and typecheck show no semantic change; the final QA pass covers it. In its place the team-leader ran a mechanical token check:
  - With all whitespace stripped and trailing commas removed, `responses-tool-names.ts` and `responses-tool-names.spec.ts` are identical to HEAD.
  - `responses-error-mapping.ts` differs only by a dropped leading `|` in a multi-line type union, one pair of grouping parentheses, and two `;` member separators in type literals.
  - `responses-error-mapping.spec.ts` differs only by one pair of grouping parentheses and one string literal with no apostrophe (`maximum context length is 1000 tokens, …`) moved from `"` to `'`.
  - All of these are semantics-neutral. `prettier --check` now passes on all four.

## Batch 6: Phase 2d - image capability hook and provider HTTP specs — COMPLETE (commit 3613f2ebf)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: second backend-developer sub-agent
- Execution mode: sequential
- Rationale: base hook, Codex override and the two provider HTTP specs are one wiring change
- Tasks: 2 | Depends on: Batch 5
- Files (6, 1 lib): `translation-proxy-base.ts`, `providers/codex/codex-translation-proxy.ts`, `providers/codex/codex-stream-parity.spec.ts`, `providers/opencode/opencode-translation-proxy.spec.ts`, `responses-request-translator.spec.ts` and `responses-tool-output-images.spec.ts` (test-only, Task 6.2)
- Commit: `fix(auth-providers): keep tool-result images for Codex only`

### Task 6.1: Capability hook, post-pass call, Codex opt-in — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\codex\codex-stream-parity.spec.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\opencode\opencode-translation-proxy.spec.ts`
- Plan reference: implementation-plan.md:321-332
- Pattern to follow: `requiresResponsesStream` hook `translation-proxy-base.ts:712` (moved from plan's `:657`); Codex override `codex-translation-proxy.ts:135`; guard call site `translation-proxy-base.ts:553`
- Quality requirements: default `false`; only Codex overrides `true` with a comment citing pinned-client evidence
- Validation notes: R2 rollback is one line; OpenCode GPT/responses upstream body has a string `output` with the placeholder and no `input_image`; Codex upstream body has an array with `input_image`
- Implementation details: `protected supportsResponsesToolOutputImages(): boolean`; after `guardResponsesToolNames`, downgrade unless supported; separate HTTP specs for Codex and OpenCode

### Task 6.2: Tool-result image edge-case regression fixtures (carried from code-logic-review-b5.md) — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-request-translator.spec.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\responses-tool-output-images.spec.ts` (test-only; no production file changes; a case that exposes a real defect is reported, not silently fixed)
- Plan reference: implementation-plan.md:289-320; code-logic-review-b5.md minor finding 1
- Pattern to follow: the existing `tool_result images` block (`responses-request-translator.spec.ts:353`) and `responses-tool-output-images.spec.ts:43`
- Quality requirements: compact table-driven fixtures pinning today's behaviour exactly
- Validation notes: rows for missing tool-result content, empty-array content, empty `is_error` output, unknown nested block types with and without an image present; downgrade of an array holding only placeholder/unsupported parts, of an empty array, and of a text-only array
- Implementation details: add cases only

### Batch 6 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed)
- Reviewer: code-logic review via codex CLI lane (provider capability gating)
- Review: `code-logic-review-b6.md` APPROVED 8/10; 0 blocking/serious/moderate; one minor coverage note: Codex retry and text-only checks compare parsed bodies rather than raw bytes and check one text result inside a mixed-image request; OpenCode's full text-only byte comparison covers Zen only and its retry byte comparison covers Go only. Current source preserves field order and untouched strings, so there is no defect. Deferred to the senior-tester QA pass after Batch 10 (test-only; compare raw Codex bodies directly and run the full text-only HTTP byte-parity case across Codex, OpenCode Zen and OpenCode Go), because every remaining batch is file-disjoint from those specs. The lane traced all seven subclasses plus LM Studio: only Codex opts into arrays, OpenCode Responses gets placeholders, and the retry keeps the chosen request. Final run 52 suites / 1271 tests.

## Batch 7: Codex static model list demotion — COMPLETE (commit 389566769)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1 (self-contained)
- Execution mode: sequential
- Rationale: one data file plus its spec; may run concurrently with any of Batches 1-6
- Tasks: 1 | Depends on: none
- Files (2, 1 lib): `codex-provider-entry.ts`, `codex-provider-entry.spec.ts` (C)
- Commit: `fix(shared): demote Codex static model windows to catalog-only`

### Task 7.1: IDs-only fallback list — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\shared\src\lib\providers\entries\codex-provider-entry.ts`; CREATE `D:\projects\ptah-extension-task-408\libs\shared\src\lib\providers\entries\codex-provider-entry.spec.ts`
- Plan reference: implementation-plan.md:339-351, :503
- Pattern to follow: `D:\projects\ptah-extension-task-408\libs\shared\src\lib\providers\entries\opencode-provider-entry.spec.ts:350-380` (`contextLength` 0 assertions)
- Quality requirements: `gpt-5.4` stays first; `gpt-6-astra`, `gpt-5.6-sol` appended; every `contextLength` 0; `CODEX_DEFAULT_TIERS` unchanged; false sync comment at `:17` replaced
- Validation notes: confirm Codex models declare no per-token rates (so `seedStaticModelPricing` never seeds `maxTokens: 0`, `provider-lookup.spec.ts:154`); grep-confirm no consumer treats `contextLength` as a live window (`codex-translation-proxy.ts:80`, `provider-models.service.ts:381-395`, `ptah-cli-registry.ts:245,321,1614`); native adapter `SUPPORTED_MODELS` untouched
- Implementation details: edit literals and comment; spec asserts first ID, new IDs, all-zero windows, tiers subset of IDs

### Batch 7 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/shared` passes (tailed); `provider-registry.spec.ts` and `provider-lookup.spec.ts` green
- Reviewer: code-style review sub-agent (data and comment change, low behavioural surface)

## Batch 8: Disclosure of dropped user-tier settings — COMPLETE (commit b0632f949)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1
- Execution mode: sequential
- Rationale: one builder edit plus spec; may run concurrently with any of Batches 1-6
- Tasks: 1 | Depends on: none
- Files (2, 1 lib): `sdk-query-options-builder.ts`, `sdk-query-options-builder.spec.ts`
- Commit: `fix(agent-sdk): disclose dropped user-tier settings on proxy sessions`

### Task 8.1: Info log and entry-point comment — COMPLETE

- Files: MODIFY `D:\projects\ptah-extension-task-408\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.spec.ts`
- Plan reference: implementation-plan.md:353-366, :387-389, :504
- Pattern to follow: existing `Building SDK query options` log `sdk-query-options-builder.ts:1110-1128`
- Quality requirements: `settingSources` behaviour unchanged; literal `settingSources: includesUserSettingSource(` preserved; no localhost regex added; comment at most 5 lines naming path A and `ownership.md`
- Validation notes: guard spec `libs/backend/output-styles/src/lib/output-style-activation.resolver.spec.ts:181-200` reads this source (open item 1)
- Implementation details: when `!includesUserSettingSource(effectiveAuthEnv.ANTHROPIC_BASE_URL)`, log the plan's info line once; spec: localhost gives one line and `['project','local']`; direct or absent gives no line and includes `'user'`

### Batch 8 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk` passes (tailed)
- Targeted guard (open item 1, the only unchanged-project run): `npx nx test @ptah-extension/output-styles --testPathPattern=output-style-activation.resolver` passes
- Reviewer: code-logic review via codex CLI lane (shipping code; confirms settingSources unchanged)

## Batch 9: Integration test through the installed SDK — IN_PROGRESS (revise round 2 of 2)

- Recommended executor: senior-tester (sub-agent; plan names it owner of the first real-binary run)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: first real-CLI-binary spec in the repo; needs judgment on observed A3/A5 behaviour mid-flight
- Tasks: 1 | Depends on: Batches 1-6 (Batch 8 not required: the spec sets `settingSources` directly)
- Files (1, 1 lib): `translation-proxy.sdk.integration.spec.ts` (C)
- Commit: `test(auth-providers): prove skill, command and overflow flows via SDK`

### Task 9.1: S1-S6 through real SDK, real CLI, real CodexTranslationProxy, mocked upstream — IN_PROGRESS

- File: CREATE `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\translation\translation-proxy.sdk.integration.spec.ts`
- Plan reference: implementation-plan.md:395-453, :505, :577 (R1)
- Pattern to follow: child-process ESM SDK probe and `findPinnedSdk` in `D:\projects\ptah-extension-task-408\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry-auto-compact-argv.spec.ts:82-148`
- Quality requirements: all upstream traffic MOCKED; no live provider call; pinned version `0.3.278` asserted; missing SDK or binary fails loudly, never skipped; scenario timeout 120 s; fixture writer stays inside the spec
- Validation notes: R1 content-scripted mock (markers, never order; `ok` for side queries); A3 pin the observed unknown-command behaviour; A4 pin the long-name round trip; A5 assert `compact_boundary` (`trigger: 'auto'`) between (i) and (iii) plus success with `S6-DONE`, or rename to "S6 overflow propagation" asserting `Prompt is too long` with no stall and report it; include the `response.failed` split-chunk variant of S6
- Implementation details: mock `http.createServer` recording bodies; `new CodexTranslationProxy(createMockLogger(), fakeCodexAuth)`; temp project `.claude/skills/fixture-skill/SKILL.md` and `.claude/commands/fixture-cmd.md`; isolated `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR`; child prints SDK messages as JSON lines; executor reports the observed A3 and A5 outcomes verbatim for Batch 10

### Batch 9 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers` passes (tailed); report states which S6 variant passed
- Reviewer: code-logic review via codex CLI lane (proof claims must match assertions)
- Files as delivered: `translation-proxy.sdk.integration.spec.ts` (C) plus `.ptah/specs/TASK_2026_408/integration-observations.md` (C, observed A3/A5 outcomes). Neither is staged in any commit yet.
- Review history: `code-logic-review-b9-b11.md` REJECTED Batch 9; `code-logic-review-b9-b11-r1.md` REJECTED Batch 9 again (child-process cleanup on Windows: with unavailable or slow CIM the returned promise stays pending past the scenario budget, and cleanup can overlap later tests, N1/N2 at spec `:496`, `:825`). No production defect was attributed to Batch 9. Last permitted revise round in progress.
- Observed outcome that produced Batch 11: a streamed `response.failed` overflow after 200 SSE headers made the pinned CLI retry (`api_retry` loop) instead of compacting. S6a (HTTP 400) and S6b (streamed failure, now answered error-first as HTTP) both require an auto `compact_boundary` and a success result with `S6-DONE`; the propagation-only fallback was removed (`integration-observations.md:192`).
- Environment note: 17 `agent-role-resolver` failures in `@ptah-extension/cli-agent-runtime` under the normal TEMP come from a stray `C:\Users\abdal\AppData\Local\Temp\.claude` folder (created 17:09:54, empty `commands/` and `skills/`). It was not created by this task's spec, and the suite passes with an isolated TEMP. Recorded as an environment issue, not a regression; `test-report.md` must note it.

## Batch 10: Ownership doc and entry-point comments — COMPLETE (commit 54038450c)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: technical-content-writer (sub-agent)
- Execution mode: sequential
- Rationale: facts must match Batch 9's observed outcomes; comment-only code edits in two projects
- Tasks: 1 | Depends on: Batches 7, 8, 9
- Files (3, 2 projects + doc): `.ptah/specs/TASK_2026_408/ownership.md` (C), `codex-cli.adapter.ts` (comment), `anthropic-proxy.service.ts` (comment)
- Commit: `docs: document translation proxy vs native Codex vs CLI proxy ownership`

### Task 10.1: ownership.md plus two header comments — COMPLETE

- Files: CREATE `D:\projects\ptah-extension-task-408\.ptah\specs\TASK_2026_408\ownership.md`; MODIFY `D:\projects\ptah-extension-task-408\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts` (header `:1-6`, comment only); MODIFY `D:\projects\ptah-extension-task-408\apps\ptah-cli\src\services\proxy\anthropic-proxy.service.ts` (header `:1-42`, comment only; TASK_2026_564_87a6 owns fixes)
- Plan reference: implementation-plan.md:368-393
- Pattern to follow: task-id comment precedent `sdk-query-options-builder.ts:243`
- Quality requirements: comments at most 5 lines each; every fact cited; no behavioural change in either code file
- Validation notes: record A3 and A5 as observed in Batch 9; R4 `[DONE]` residual; path B limits; path C list owned by TASK_2026_564_87a6
- Implementation details: one table row plus limits for paths A, B, C

### Batch 10 verification

- `git diff` of both code files shows comment lines only
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime ptah-cli` passes (tailed); this includes the `ptah-cli-registry` spec that reads `staticModels[0]` and count after Batch 7
- Reviewer: code-style review sub-agent (docs and comments; facts checked against citations)
- As executed:
  - Both code diffs are comment-only, +5 lines each (verified with `git diff`).
  - Verification: `cli-agent-runtime` and `ptah-cli` lint/typecheck pass. `cli-agent-runtime` tests: 68/68 suites, 1207 passed + 1 skipped, with an isolated TEMP (see the Batch 9 environment note). The `ptah-cli` test target was not run: its change is comment-only and its typecheck passes.
  - Review route: the code-logic lane was used in place of code-style, because the doc makes behavioural claims.
- Review history:
  - `code-logic-review-b10.md` REJECTED 6/10: four moderate wording findings, fixed.
  - `code-logic-review-b10-r1.md` REJECTED 7/10: three resolved; one left, the doc claimed S6a proof while S6a did not require compaction.
  - The orchestrator made one bounded correction in `ownership.md`: the overflow bullet, a new "Streamed errors" bullet, and the filled Batch 9 section. That correction was independently APPROVED 8/10 in `code-logic-review-b9-b11-r1.md` ("Ownership.md correction").
- Ordering deviation (orchestrator instruction): committed before Batch 9, whose dependency this batch records. `ownership.md` cites the current uncommitted integration spec and `integration-observations.md` by line. When Batch 9 lands, the team-leader re-checks those citations and any S1-S6 claim against the final spec. Any drift gets a `docs:` follow-up, not a silent edit.

## Batch 11: Error-first Responses stream failures as HTTP errors — COMPLETE (commit f4a1222fb)

- Origin: added during execution, not in the Mode 1 decomposition. Batch 9's real-SDK run showed a streamed `response.failed` overflow after 200 headers produced a CLI `api_retry` loop instead of compaction, so the Phase 1 overflow contract was not met on the streaming path. Within this task's scope: reactive only, and no pre-send token or window check (Gate 2).
- Executor: backend-developer (sub-agent). Execution mode: sequential. Tasks: 1. Depends on: Batches 1-6.
- Files (4, 1 lib), under `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\`: `translation\translation-proxy-base.ts`, `translation\translation-proxy-base.spec.ts`, `translation\responses-stream-translator.ts`, `providers\codex\codex-stream-parity.spec.ts`

### Task 11.1: Defer stream headers; answer error-first terminals as HTTP; header deadline — COMPLETE

- Behaviour:
  - The 200 SSE headers and `message_start` wait for the first client-visible output (`hasClientOutput()`).
  - An error terminal that comes first is sent through `sendErrorResponse`, using `getTerminalError()` with the mapped status, type and message; a 400 prompt-too-long compacts.
  - After output has gone out, a later error is the single SSE `error` terminal.
- Lifecycle:
  - The cancel path returns early when `res.writableEnded` (it no longer overwrites a completed terminal's timing).
  - F6: after an error-first answer, the upstream is destroyed if not complete.
  - F7: a header deadline on `getUpstreamTimeoutMs()` answers 504 when no client-visible output arrives, since upstream heartbeats keep the socket-idle timeout alive.
- Stream translator: `hasClientOutput`, `getTerminalError`, `failStream` carrying the full mapping, and a TS4111 fix that had broken the `ptah-cli` typecheck.
- `codex-stream-parity.spec.ts`: `maxRetries: 0`.
- Team-leader diff check: the header deadline is a time bound on upstream silence, not a token or window check; Gate 2 holds.

### Batch 11 verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers`: 53/53 suites, 1315/1315 tests (including the uncommitted integration spec in the working tree), lint 0 errors, typecheck ok. `npx nx run-many -t typecheck -p ptah-cli` passes.
- Review history: `code-logic-review-b9-b11.md` REJECTED Batch 11 6/10 (F6 upstream not released after error-first; F7 no header deadline) → fixed → `code-logic-review-b9-b11-r1.md` Batch 11 APPROVED 8/10.
- Residual (recorded in `ownership.md`): an SSE error after output was already sent is retried by the pinned CLI, not compacted. The unit test proves the wire behaviour only.

## After all batches (Batch 9 last)

- senior-tester QA also covers the coverage item deferred from `code-logic-review-b6.md`: compare raw Codex upstream bodies directly, and run the full text-only HTTP byte-parity case across Codex, OpenCode Zen and OpenCode Go. It also records the stray-TEMP `.claude` environment issue (Batch 9 note), with the isolated-TEMP counts.

- senior-tester writes `D:\projects\ptah-extension-task-408\.ptah\specs\TASK_2026_408\test-report.md` with exact pass counts per project (`auth-providers`, `shared`, `agent-sdk`, `cli-agent-runtime`, `ptah-cli`, targeted `output-styles`), Batch 9 labelled "real SDK + real CLI binary + real proxy, MOCKED upstream", live checks = none, and the S6 variant that passed.
- Parity check N/A (no surface replaced); visual evidence N/A (no UI); write-path trace N/A (no persisted-settings writes; Batch 8 is logging only).
