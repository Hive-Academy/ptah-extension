# Code Logic Re-review 2 — `TASK_2026_714_c8a2` (P6, batch 6g)

Range: `ecbbc3c64..ce987b8a6` (c107d55d2 codex-runtime + gateway-chat-bridge; ce987b8a6 agent-sdk).
Inputs read: code-logic-rereview-p6.md, code-style-rereview-p6.md (S1-R), decisions.md rows
"P6 fix 12..21", batch-6g-{core,routing,wiring,adapter}-report.md, batches.md section 6g
(:1272-1322). Files read in full or in their changed regions: codex-chat-adapter.ts,
routing-agent-adapter.ts, codex-chat-approval-sink.ts, session-approval-router.ts,
codex-chat-events.ts, session-runtime-router.ts, wiring/* (identity cache, composition guard,
composition error, legacy controls, metadata port), di/register.ts:985-1115, di/tokens.ts diff,
agent-sdk index.ts, codex-app-server-process.ts:274-355, codex-protocol-validator.ts:214-247,
codex-event-translator.ts, codex-runtime.ts:670-708, codex-gateway-adapter.ts:255-280, and the
added spec cases. Review only: no source edited, no git writes, no checks run (verification
evidence is the 6g verify in batches.md:1280-1285). Line numbers below are from the worktree
at ce987b8a6.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 3        |
| Failure modes found | 4        |

Why 7 and not 6: SN1 and all seven targeted moderates are fixed with specs. The 6g changes
that touch ownership, busy and interrupt behaviour hold up under the races I traced. Why not 8:
6g adds two new moderate defects. The open key changed to the tab id, which reopens a
concurrent-resume hole (N1). The whole-turn usage now also feeds compaction `preTokens`, which
must be a single request frame (N2). The M1 guard covers only the case that the decision
names (N3).

## Status of previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| SN1: pending open keyed by tab id | RESOLVED | The open key is `config.tabId ?? resumeId` (codex-chat-adapter.ts:205). `owns()` covers `sessions` and `opening` (:630-632). Routing asks `native.owns(id)` before the identity lookup (routing-agent-adapter.ts:186-187), so `endSession(tabId)`, `interruptSession(tabId)`, `isSessionActive(tabId)` and the other id-keyed calls reach native during an open. |
| SN1: endSession during open | RESOLVED | `endSession` sets `opening.cancelled` (:643-645). `checkOpening` runs after profile (:218), after `runtime.open` (:222) and after save (:227). The catch closes the context and scope (cleanupOpen), and `opening` is deleted in `finally`. Spec "close the tab during a native open" (codex-chat-adapter.spec.ts:594-627) asserts no save, no `resolved`, no `startTurn`, one close, one dispose, and `owns` false afterwards. |
| SN1: interruptSession during open | RESOLVED | `interruptSession` cancels a pending open and returns (:695-700). The same spec covers it (`%s` = interrupt). |
| SN1: cancel during save | RESOLVED (accepted limit, decision 21) | The save is not aborted. `checkOpening` at :227 throws `cancelled` after the save, before `publishSession` (:228), so no turn starts and no `resolved` fires. The context and scope close. Spec "cancel during save" (spec:716-756) asserts that the save completes once, `publish` and `startTurn` are not called, close and dispose run once, and `owns`/`isSessionActive`/`canSendFollowUp` are false for both ids. The saved row stays resumable, as decided. |
| M1: partial wiring falls back to SDK silently | PARTIAL | The guard throws `missing-admission-port` when lookup or ports are bound without admission (codex-runtime-composition.ts:32-41). It runs `beforeResolution` of ROUTING_AGENT_ADAPTER (register.ts:1058-1061). Spec register.codex-runtime.spec.ts:79-95. This matches decision 15 literally. The sibling cases still fall back silently (N3). |
| M2: no follow-up accessor | RESOLVED in lib | `canSendFollowUp(id)` (codex-chat-adapter.ts:636-639) reads busy, blocked and closing. The token doc tells hosts to wrap it (tokens.ts:35-37, batches.md host contract item 6). |
| M3: model value is `Model.id` | RESOLVED | `CodexModelInfo.model` is mapped (codex-runtime.ts:688). The picker uses `value: model.model` and dedups by slug, preferring `isDefault` (codex-chat-adapter.ts:414-425). Spec at codex-runtime.spec ("sends the model slug rather than the catalog key") and adapter spec:629-650. Upstream check in task 4 below. |
| M4: failed re-read leaves the row uncached | RESOLVED | The written proposal is committed after a successful write, under a `disposed`/`writes` guard (session-runtime-identity-cache.ts, in `updateCodexExecution`: `if (written) entries.set(id, written)`). A re-read failure logs a coded warning and keeps that entry. Spec "does not cache a proposal whose persistence fails". |
| M5: `model/list` failure closes the context | RESOLVED | The runtime catch no longer calls `onFailure` (codex-runtime.ts:703-705). The process now rejects locally for a correlated `model/list` `invalidResult` (codex-app-server-process.ts:308-328). Regression 2a below. |
| M6: identity-stable bindings undocumented | RESOLVED | A coded `unstable-binding` error with an actionable message (codex-runtime-composition-error.ts:12). Token JSDoc says "stable instance … registerInstance or a cached factory" (tokens.ts diff). Host contract items 2 and 4 are in batches.md. |
| M7: usage semantics | RESOLVED, with regression N2 | Turn usage is total minus the turn baseline (codex-event-translator.ts:82-95, 136-146). Mapping is `tokenUsage()` (codex-chat-events.ts:8-18) and the gateway (codex-gateway-adapter.ts:265-276). Math in task 3. |
| m2: duplicate cancel notification | RESOLVED | `sink.cancel` settles with no reason (codex-chat-approval-sink.ts:212-216), so the sink emits no `cancelPrompt`. The router emits once with the caller's reason (session-approval-router.ts:90-104). Specs: "presents cancellation exactly once per settle path", "router cancellation settles and dismisses without duplicating". |
| m3: busy cleared at once after consumer `return()` | RESOLVED | When the consumer detaches before a terminal, `finally` hands the iterator to `drainInterruptedTurn` and defers `release` (codex-chat-adapter.ts:547-558). See regression 2b. |
| m4: Stop before the startTurn receipt is dropped | RESOLVED (minor residual) | With `busy` and no `turnId`, `interruptCurrentTurn` sets `pendingInterrupt` and `blocked` (:684-686). After the receipt, the stream applies it (:504-507). Spec "applies Stop requested before the startTurn receipt arrives". Residual: the call still returns `false` for a Stop that will be applied (m-a). |
| M8, M9 | DEFERRED, acceptable | See deferred items. |

## Regression checks (task 2)

### 2a. codex-app-server-process.ts:308 — local rejection is narrow

- `validateCodexFrame` parses the envelope first (codex-protocol-validator.ts:218). It throws
  `invalidResult` only from the response branch, through `validateCodexResult`
  (:240-244, :181). The local branch needs all of: `pending.method === 'model/list'`, a numeric
  correlated `id`, a `CodexProtocolError`, `code === 'invalidResult'` and
  `error.method === 'model/list'` (codex-app-server-process.ts:314-320). Every other validation
  error is rethrown (:326) to `onData`, which calls `fail(...)` (:269-271). Envelope errors,
  unknown methods, bad params, a missing response method and framing errors therefore still
  fail closed.
- Cleanup: `clearTimeout(pending.timer)`, `this.pending.delete(id)` and `pending.reject(error)`
  (:321-323). No timer or entry leaks. A later duplicate response with that id is
  `Unknown response`, which fails closed (:333-334). That is correct for a misbehaving server.
- A process-level request timeout for `model/list` still uses the process path. That is a
  transport failure, so it is correct.
- Minor (m-b): `listModels` now maps every failure, including `CodexRequestRejectedError`, to a
  plain `Error('Codex model listing failed')` (codex-runtime.ts:703-705). The adapter recodes it
  as `runtime-failed` anyway (`safe('listModels')`), so no consumer loses a code today.

### 2b. Busy held until the terminal; released on exhaustion

Traced every exit of `stream()`:

- Terminal seen: `terminal = true` and the loop returns. `finally` takes the `else` branch,
  calls `release()` once and closes the iterator. OK.
- Iterator exhausted (`next.done`): `exhausted = true`, then `runtime-failed: stream`. The
  `else` branch releases. The session stays open. OK.
- `startTurn` rejects: `turnId` is unset, so the `else` branch releases. OK.
- Consumer `return()` mid-turn, or a throw after the receipt (events.next rejects, a
  pending-interrupt failure): `!terminal && !exhausted && turnId && events && projection &&
  !closing`. `drainInterruptedTurn` runs detached, and `.finally(release)` runs exactly once
  (:556-558). Inside the drain: `interruptCurrentTurn`, then read until a projected
  `message_complete` (every terminal status produces one, codex-chat-events.ts terminal case).
  If the stream ends with no terminal, the drain closes the session (:583-584). If the
  interrupt throws, it also closes the session (catch). The iterator is closed in the drain's
  `finally`.
- Double release: none. `release` is called on one branch only. `close()` also clears busy and
  blocked, which is idempotent with `release`.
- Stuck session: a drain waits for a terminal. If the server accepts the interrupt and goes
  silent, the runtime's 30 s interrupt watchdog (codex-runtime.ts:615) calls `onFailure`. The
  events end, and the drain closes the session. `endSession` aborts `session.abort`. The
  listener still attached forwards that to `subscription`, so the drain loop exits
  (`while (!session.abort.signal.aborted)`). No permanent latch.
- Side effect noted, not counted: callbacks still fire during a detached drain
  (`callbacks.result`, `stats`, `error`), because `projection.map` drives them. The UI gets a
  result for a turn whose stream it abandoned. That matches "the turn did end", and the spec
  relies on it (spec "keeps busy after consumer return…").

### 2c. Stop before the turn-start receipt

The pending Stop is applied after the receipt and before the first event (:504-507). If
`startTurn` rejects instead, `release` clears `pendingInterrupt` and `blocked` (:539-546). On
an idle session (`busy` false), Stop leaves `blocked` false, as before. OK. Residual m-a: the
deferred Stop returns `false` (:687). A host that shows "stop failed" on `false` misreports a
Stop that will take effect.

### 2d. Cancel prompt exactly once

| Path | Emitter | Count |
| --- | --- | --- |
| Router `cancelPrompt(address, reason)` for a Codex owner | router `cancelled` (session-approval-router.ts:100-104). The sink settles with no reason (sink:212-216). | 1 |
| Turn abort | sink `settle('decline','turn-ended')`. The owner is released through `dismiss` → `releases`, and the router does not emit. | 1 |
| Sink dispose | sink `settle('decline','disposed')` | 1 |
| User reply | none (the router deletes the owner on `respond`) | 0 |

### 2e. Claude default path (null tokens, `nativeCodex` false)

Unchanged. The defaults are null (register.ts:987-1006). AGENT_ADAPTER resolves ROUTING, which
runs the guard. The guard resolves the five tokens: lookup null, ports null (CODEX_CHAT_ADAPTER
returns null at the `!ports` check before it touches approvals), admission null, capabilities
and adapter null. No throw. ROUTING is null, so the exact `SdkAgentAdapter` is used
(register.ts:1099-1111). `owns()` is reached only inside `RoutingAgentAdapter`, which does not
exist on this path. When routing is active, a Claude id is never in `sessions` or `opening`, so
`owns` is false and the identity resolution is as before (routing-agent-adapter.ts:186-199). The
store change (`'storage-unavailable'` → `'unavailable-storage'`) touches only
`CodexSessionMetadataError`.

## Usage math (task 3)

Translator (codex-event-translator.ts):

- `turn/started` (:82-95) sets `baseline[thread,turn] = totals[thread]` when this context has
  seen a total already.
- `thread/tokenUsage/updated` (:136-146): `baseline = baselines[key] ?? totals[thread] ??
  (total − last)`. The baseline is stored, `totals[thread] = total`, and
  `usage = total − baseline`.
- The terminal (:165-179) attaches the last turn usage and deletes the baseline.

Checks:

- Multi-request turn, steady state: baseline = the total at turn start. Usage = the sum of every
  `last` in the turn (upstream `append_last_usage` does `total += last`). Correct.
- First turn of a resumed thread: the translator belongs to a context (codex-runtime.ts:182), so
  `totals` is empty after a resume. The first update gives baseline = `total − last`, so usage
  = `last`, which is the first request of this turn. Later updates in the turn accumulate.
  Correct whatever absolute value the server's `total` restarts from.
- Turn with no usage event: no `usage` on the terminal. `message_complete` carries no
  `tokenUsage`, and no result stats are emitted (codex-chat-adapter.ts result callback).
  `baselines` is cleared at the terminal, so nothing leaks. `session.usage` keeps the
  previous turn's value (see N2).
- Mapping (`tokenUsage`, codex-chat-events.ts:8-18): input = max(0, inputTokens −
  cachedInputTokens); cacheRead = cachedInputTokens; cacheCreation = cacheWriteInputTokens;
  output = outputTokens. Reasoning is not added. Upstream confirms that reasoning is a subset of
  output (`blended_total = non_cached_input + output`) and that cached input is part of input
  (`non_cached_input = (input − cached).max(0)`). Correct.
- Gateway (codex-gateway-adapter.ts:265-276): the same mapping, without the clamp. That is
  harmless while cached ≤ input.
- Minor (m-c): an update that arrives after its turn's terminal is dropped before `totals` is
  updated (`terminals.has` returns early, :134). The next turn's baseline then misses those
  tokens. They are undercounted, not double-counted.
- Minor (m-d, LOW confidence): upstream `cache_write_input_tokens` has no doc comment, and
  `non_cached_input` does not subtract it. If cache writes are a subset of `input_tokens`, Ptah
  counts them in both `input` and `cacheCreation`. For OpenAI models the field is usually 0.
  Decide this with a spike before cost is ever derived from it.

## Model slug — upstream at the pinned tag (task 4)

The 404 the team-leader reported came from the github.com `blob` URLs. I fetched the raw files at
tag `rust-v0.155.1` (raw.githubusercontent.com/openai/codex/rust-v0.155.1/...):

- `codex-rs/app-server/src/models.rs`: `model_from_preset` sets `id: preset.id.to_string(),` and
  `model: preset.model.to_string(),`. This is the same as the `main` citation in
  batch-6g-core-report.md:23.
- `codex-rs/app-server-protocol/src/protocol/v2/model.rs`: `pub struct Model { pub id: String,
  pub model: String, ... }`, with no doc comments.
- `codex-rs/protocol/src/protocol.rs`: `append_last_usage` is `self.total_token_usage.add_assign(last);
  self.last_token_usage = last.clone();`. `non_cached_input` is `(self.input_tokens -
  self.cached_input()).max(0)`. `TokenUsage` has `cache_write_input_tokens` (`#[serde(default)]`,
  no doc). `tokens_in_context_window()` returns `self.total_tokens`, which upstream applies to
  the last usage for the context-window percentage.

Conclusion: the pinned version ships the same id/model split and the same usage semantics that
decisions 13 and 19 rely on. Decision 13 (`Model.model` for the picker and the turn and thread
`model` param) is confirmed for 0.155.1. The final point, about `tokens_in_context_window`,
supports N2.

## Style S1-R (task 5)

RESOLVED. agent-sdk/src/index.ts:148-163 no longer exports `createCodexChatMetadataPort` or the
`CodexChatAdapter` value. It exports `CodexChatAdapterError`, the types and the new
`CodexRuntimeCompositionError` with its code type. No app imports either removed name. A scan
of the added lines in the full range for `as unknown as`, `as any`, `: any`, `<any>`,
`@ts-ignore`, `@ts-expect-error` and `eslint-disable` found nothing.

## Markers (task 7)

No TODO, FIXME, PLACEHOLDER or STUB in the added lines. The empty bodies are pre-existing and
intentional (`preloadSdk`, and the compact generator that has no assistant turn). Each catch
added in 6g either rethrows or logs a coded, payload-free message and then closes or keeps
state as documented. None logs in place of an action. No mock data stands in for logic.

## Five logic questions

### 1. How does this fail silently?

- Two concurrent resumes of the same thread from two tabs. Both pass the opening check, because
  each is keyed by its own tab id (codex-chat-adapter.ts:205). Both pass `sessions.has(id)`
  (:223), which runs before the save. The later `publishSession` (:228) overwrites the earlier
  session in `sessions`. The first context, its sink and its turn keep running with no map
  entry, so `endSession(threadId)` can no longer reach them (N1).
- A host binds the lookup and the admission port, or the ports and the admission port, but not
  the matching third token. CODEX_CHAT_ADAPTER is null (register.ts:1077-1085), so ROUTING is
  null and AGENT_ADAPTER is the plain SDK adapter. The guard does not throw (N3).

### 2. What user action produces unexpected behaviour?

- The user presses Stop while the turn is starting. The Stop is applied, but the call returns
  `false` (m-a).
- The user closes a tab while a resume is opening. The host uses the tab id, so the cleanup
  works. If the host uses the thread id instead (the chat-session.service audit sites), then
  `endSession(threadId)` is a no-op and `interruptSession(threadId)` throws `unavailable`
  (:695-700, `session()` at :766-770), because the opening is keyed by the tab (N1).

### 3. What input data produces a wrong answer?

- A multi-request turn followed by auto-compaction, or a manual `/compact`. `preTokens` =
  `session.usage.totalTokens` (:432-437). That value is now the whole-turn sum (:524), so a
  5-request turn at a 50k context reports about 250k (N2).
- Cache-write tokens, if the server counts them inside `inputTokens` (m-d, LOW).

### 4. What happens when a dependency fails?

- `model/list` returns a bad payload: the request is rejected, the context stays open, and the
  timer and entry are cleared (2a). OK.
- The interrupt RPC throws during a drain: the session closes, which fails closed (2b). OK.
- The store re-read fails after a write: the written entry is kept and a warning is logged (M4).
  OK.
- The server never sends the terminal after an interrupt: the 30 s watchdog fails the context,
  and the drain closes the session. OK.

### 5. What is missing that the requirements never mentioned?

- A `sessions.has(id)` recheck before publish, and a resume-id alias for the opening (N1).
- A context-occupancy figure for `preTokens` that is separate from the turn total (N2).
- A guard for the remaining partial-wiring combinations (N3).

## Failure modes

### FM-1: Concurrent resume of one thread orphans a context (N1)

- Trigger: two `resumeSession(threadId, { tabId: A | B })` calls overlap in the save window.
  Before 6g, the shared `resumeId` key made the second call fail with `busy`.
- Symptom: two App Server contexts for one thread. One is unreachable: no `endSession`, its
  approvals are still registered, and a turn may still be running.
- Evidence: codex-chat-adapter.ts:205 (the key), :223 (the only `sessions.has` check, before the
  save at :226), :228 (`publishSession` overwrites without a check).
- Current handling: none.
- Recommendation: register the opening under the tab id and the resume id (and check both), or
  recheck `this.sessions.has(id)` right before `publishSession` and throw `busy`. Let
  `endSession`/`interruptSession` cancel an opening found by either key.

### FM-2: Compaction preTokens overstated (N2)

- Trigger: auto-compaction (`compaction started`) or `/compact` after a turn with tool
  continuations.
- Symptom: the frozen pre-compaction header shows a multiple of the real context size, and the
  boundary delta is wrong.
- Evidence: codex-chat-adapter.ts:432-437 and :524-526. live-usage-tracker.ts:102-110 states
  that `preTokens` must be one request frame, and that a cross-turn sum is "a more confidently
  wrong answer than 0". Upstream `tokens_in_context_window` uses the last usage's `total_tokens`.
- Recommendation: carry `last.totalTokens` (or `last` itself) through the translator as a
  separate field, for example `contextTokens` on the usage event, and use that for
  `preTokens`. Keep the turn delta for message, result and stat usage.

### FM-3: Partial native wiring outside the decision-15 case (N3)

- Trigger: lookup and admission bound but ports null, or ports and admission bound but lookup
  null.
- Symptom: native persisted ids are handled by the SDK adapter with no error. This is the
  original M1 symptom.
- Evidence: codex-runtime-composition.ts:32-41 checks only for the admission token.
  register.ts:1077-1085 returns null for either missing token. register.ts:1053 returns null.
- Recommendation: throw when any one of the lookup, the ports and the admission port is non-null
  while another is null. That reuses `missing-admission-port`, or add a
  `partial-native-composition` code.

### FM-4: A deferred Stop is reported as not applied (m-a)

- Evidence: codex-chat-adapter.ts:684-687.
- Recommendation: return `true` when the Stop is queued, or document `false` as "no turn yet"
  for the 8a host.

## Blocking issues

None.

## Serious issues

None. N1 needs two overlapping resumes of one thread. The Ptah UI usually focuses an existing
tab, which makes that unlikely. If 8a allows the same session in two tabs, raise N1 to Serious
(leaked context).

## Moderate and minor issues

- (N1, Moderate, 6g regression) The open key is tab-first. Concurrent resumes overwrite
  `sessions`, and thread-id cleanup misses a pending resume: codex-chat-adapter.ts:205, 223,
  228, 695-700. FM-1.
- (N2, Moderate, 6g regression) `preTokens` comes from the whole-turn usage:
  codex-chat-adapter.ts:432-437, 524-526. FM-2.
- (N3, Moderate, M1 residue) The guard covers only a missing admission port:
  codex-runtime-composition.ts:32-41. FM-3.
- (m-a) A deferred Stop returns `false`: codex-chat-adapter.ts:687.
- (m-b) `listModels` replaces a coded RPC rejection with a plain Error: codex-runtime.ts:703-705.
  No consumer impact today.
- (m-c) A late, post-terminal usage update is dropped from `totals`:
  codex-event-translator.ts:134.
- (m-d, LOW) Cache-write tokens may be double-counted if they are part of `inputTokens`:
  codex-chat-events.ts:8-18.
- (m-e) `canSendFollowUp` returns `false` both for a busy session and for a native session with
  no open context (codex-chat-adapter.ts:636-639). An 8a host must not read `false` as "busy"
  for a restored tab that needs `resumeSession`. Document this in the host contract.

## Deferred items (task 6)

| Item | Verdict | Reason |
| --- | --- | --- |
| M8 models with no open context → 8a | Acceptable | It needs a host-level process without a thread. `listSessionModels` throws a coded `unavailable` error, which is loud. |
| M9 single-workspace preload on VS Code and CLI → 8d/8e | Acceptable | Electron uses `listAll`. This is consistent with Electron-first. |
| Live stats refused | Acceptable | `setLiveStatsCallback` throws `unsupported` (codex-chat-adapter.ts, liveStats). Refusing is better than inventing counters. |
| SN1 save limit (no rollback) | Acceptable | Pinned by the "cancel during save" spec. The row stays resumable, so nothing is lost. |
| Store two workspace-key rules | Acceptable | Unifying them would change behaviour. Reason recorded. |
| Approval identity as a string | Acceptable | Wire type; now aliased to the payload type (session-approval-router.ts:9). |
| m1 accumulator replay spec | Acceptable | A layering constraint. The order is pinned in codex-chat-events.spec. It should become an 8a/frontend spec. |
| register.ts over 700 lines | Acceptable | Lint warning only. |
| `review/start` | Acceptable | Tracked gap, unchanged. |
| 8a audit list (direct SDK-adapter use) | Acceptable, must be done | chat-session.service.ts:1071, 1237, 1330 and chat-stream-broadcaster.service.ts:351-359 bypass `owns()`. Add N1's thread-id cleanup case to that audit. |

## Data flow (native start/resume after 6g)

1. Routing `startChatSession`: capability, then the admission port, then native. OK.
2. `open`: key = tab ?? resume (:205). Gap N1: the resume id is not reserved.
3. profile → check → `runtime.open` → check → `sessions.has` → save → check → publish. Gap N1:
   no `sessions.has` recheck after the save.
4. `resolved(tabId, id)`, then `turn` → `stream`: busy taken inside the generator body. OK.
5. `startTurn` receipt → pending Stop applied → events projected. OK.
6. Usage event → `session.usage` = the turn delta. Gap N2 for `preTokens`.
7. Terminal → `result` + stats + `message_complete` → release. OK.
8. Consumer detaches → drain holds busy until the terminal, or closes the session. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Decision 12 (owns, cancel pending open) | COMPLETE | N1 is a new side effect of the key choice |
| Decision 13 (model slug) | COMPLETE | Confirmed at rust-v0.155.1 |
| Decision 14 (follow-up accessor) | COMPLETE | m-e documentation |
| Decision 15 (missing admission is an error) | COMPLETE as worded | N3 sibling cases |
| Decision 16 (keep written entry) | COMPLETE | — |
| Decision 17 (`model/list` keeps context) | COMPLETE | m-b |
| Decision 18 (stable bindings) | COMPLETE | — |
| Decision 19 (usage) | COMPLETE | N2 side effect, m-c, m-d |
| Decision 20 (S1-R, deferrals) | COMPLETE | — |
| Decision 21 (cancel during save) | COMPLETE | — |

Implicit requirements not addressed: N1 (exclusive resume of one thread), N2 (context
occupancy and turn totals are separate quantities).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| endSession(tabId) during spawn | YES | `opening.cancelled`, checks at three points | — |
| Cancel during save | YES | Check after the save, then close | Row persists (accepted) |
| Two resumes of one thread | NO | Keys differ by tab | N1 |
| endSession(threadId) during resume open | NO | No-op / throws | N1 |
| Consumer return mid-turn | YES | Detached drain, busy held | Callbacks still fire |
| Stream exhausted, no terminal | YES | Release, `runtime-failed` | — |
| Stop before receipt | YES | `pendingInterrupt` | Returns false (m-a) |
| Interrupt RPC throws in drain | YES | Close session | — |
| Invalid `model/list` result | YES | Local reject, timer cleared | — |
| Malformed envelope | YES | Fail closed | — |
| First usage on a resumed thread | YES | total − last baseline | — |
| Turn with no usage | YES | No tokenUsage, no stats | Stale `preTokens` source |
| Compaction after a multi-request turn | NO | Uses the turn sum | N2 |

## Verdict

- Recommendation: APPROVE. The P6 re-review findings are closed. N1-N3 are moderate and should
  be fixed before 8a binds native resume, or added to the 8a batch.
- Confidence: HIGH for the status table and for task 4. MEDIUM for how likely N1 is, which
  depends on the 8a tab policy.
- Top risk: a resume keyed only by the tab lets two contexts own one thread, and one of them
  becomes unreachable.
- What a robust implementation would add: reserve the resume id in `opening` and recheck
  `sessions` before publish; a separate `contextTokens` (from `last.totalTokens`) for
  `preTokens`; an all-or-nothing native composition guard; `true` (or a documented meaning)
  for a queued Stop.
