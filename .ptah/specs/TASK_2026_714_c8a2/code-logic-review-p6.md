# Code Logic Review — `TASK_2026_714_c8a2` (P6 phase gate: batches 6a–6e)

Range reviewed: `ef4e34932..f660c19bf` (a566781a5 6a, a65ff9595 6c, 8aaaa169c 6d, 027cc1a69 6b,
f660c19bf 6e). Files read in full: every file under
`libs/backend/agent-sdk/src/lib/codex-app-server/` (non-spec), `di/register.ts` (new sections
977-1240 and `wireAgentAdapterAliases`), `di/tokens.ts`, `session-metadata-store.ts` (diff plus
`_saveInternal`, `persistMetadata`, `flush`, `get`, `getForWorkspace`, `saveResumeState`),
`sdk-agent-adapter.ts` diff, `auth-env.port.ts`, `session-runtime.schemas.ts`. Specs were skimmed
for coverage only. Scoped `ptah_get_diagnostics` on codex-chat-adapter.ts and register.ts: 0 errors.
No tests were run by this reviewer.

Severity scale used in this document: blocking / major / minor (moderate items are listed as minor
with a note).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 3              |
| Serious (major)     | 5              |
| Moderate and minor  | 10             |
| Failure modes found | 14             |

Why 4 and not 5-6: the approval release (focus 1) and the 6d metadata invariants (focus 3) hold up,
and there are no stub markers. But the 6e composition is the unit hosts will bind in 8a/8d/8e.
Once bound, it changes Claude behaviour in three ways: routing throws for any id that is not
cached, new Claude starts are admitted to Codex when `nativeCodex` is true, and a timed-out Claude
interrupt blocks follow-ups permanently. Separately, the 6a projection never emits the
`message_start` root that the frontend tree needs. Why not 3: the default path (all host tokens
null) still resolves the exact `SdkAgentAdapter`, so nothing ships broken today.

## Five logic questions

### 1. How does this fail silently?

- The native stream emits `text_delta` / `thinking_delta` / `tool_*` / `message_complete`, but
  never `message_start` (codex-chat-events.ts:76-179). The frontend creates a root message only
  on `message_start` (accumulator-core.service.ts:253-289 pushes `messageEventIds`), and the tree
  is built from `messageEventIds` (execution-tree-builder.service.ts:315). The turn "completes"
  with no visible assistant node. Final-only text (`textFinal`, codex-chat-events.ts:90-98) goes
  only to `callbacks.content` and never into the stream.
- `stream()` is an async generator, but `turn()` sets `session.busy = true` before the generator
  body runs (codex-chat-adapter.ts:307-311). Suppose the iterable is never iterated: `publish`
  fails before its first `next()`, or a caller drops the iterable or calls `return()` before it
  starts. Then the `finally` (codex-chat-adapter.ts:366-372) never runs. The session reports busy
  forever and is never closed. No error surfaces.
- A failed refresh of the identity cache silently deletes a valid binding (register.ts:1039-1043).
  Nothing re-reads it later, so the session becomes unroutable with `unknown-session`.

### 2. What user action produces unexpected behaviour?

- The user clicks Stop on a Claude session, and the SDK interrupt hits its 3 s timeout. Legacy
  returns `false` and says "the session lives on" (session-control.service.ts:122-142,
  143-152). Through `SessionRuntimeRouter.interrupt`, `false` leaves `blockedFollowUps` set
  (session-runtime-router.ts:69-79). A retry also returns `false`, because the record has been
  retired. `canSendFollowUp` stays false until `releaseSession`.
- The user takes more than 60 s to answer a Codex approval prompt. The sink declines it
  automatically (codex-chat-approval-sink.ts:82, 103-106; the adapter passes no timeout at
  codex-chat-adapter.ts:222-260). Legacy routable prompts wait indefinitely by design
  (sdk-permission-handler.ts:84-90, TASK_2026_155 F2).
- On a host with `nativeCodex: true`, the user selects Anthropic or any non-Codex provider and
  starts a chat. `RoutingAgentAdapter.startChatSession` sends it to the native adapter regardless
  of provider (routing-agent-adapter.ts:65-71).
- The user opens the model picker inside a native Codex session. `getSupportedModels`,
  `getDefaultModel` and `getApiModels` route to legacy unconditionally
  (routing-agent-adapter.ts:56-64), so Claude models are listed. Picking one sends a Claude model
  id to Codex `updateNextTurn` (codex-chat-adapter.ts:475-481).

### 3. What input data produces a wrong answer?

- A tab id, or a Claude session id whose metadata row is not cached yet, passed to
  `isSessionActive`, `getSessionToken`, `endSession` and so on. The router throws instead of
  answering (routing-agent-adapter.ts:165-167). Hosts do use tab ids as routing ids
  (surface-submit-turn.service.ts:272-288). `isSessionActive` is a boolean contract and now throws.
- An active-session `resumeSession` config that carries any key besides `prompt` and `tabId` is
  refused, even when that key's value is `undefined` (`Object.keys` at
  codex-chat-adapter.ts:171).
- On Windows the top-level `workspaceId` of a Codex row is the lowercased, forward-slash key
  (session-metadata-store.ts:867-871 uses `execution.workspaceId`). The non-records
  `getForWorkspace` comparison is case-sensitive (session-metadata-store.ts:1168-1173), so
  `d:/x` does not equal `D:/x`.

### 4. What happens when a dependency fails?

- `startTurn` rejects, or the event stream ends without a terminal event: `finally` closes the
  whole session (codex-chat-adapter.ts:363-371). A transient native turn failure tears down the
  context, and the host must resume it.
- `interrupt` throws: `blocked` stays true (codex-chat-adapter.ts:443-448). Once the turn ends,
  `turnId` is undefined, so `interruptCurrentTurn` returns `false` before it can clear the flag
  (line 442). The only exit is endSession or close.
- `store.get` fails during a change-event refresh: the binding is evicted (register.ts:1039-1043).
- `presentation.present` or `register` throws: the sink settles `decline` and `dismiss` runs. The
  router release still fires (codex-chat-approval-sink.ts:133-143, 107-130). OK.
- All error codes collapse to `runtime-failed` in `open()` (codex-chat-adapter.ts:284-297) and
  `stream()` (line 364-365). A cancelled open, an identity mismatch and a real runtime failure
  look the same to the host.

### 5. What is missing that the requirements never mentioned?

- `updateCodexExecution` never calls `emitChange`. Compare `save` at
  session-metadata-store.ts:733-735 with `updateCodexExecution` at 809-884. A new native session
  or a resume therefore sends no `metadataChanged` notification to the sidebar or to other
  listeners.
- The identity lookup has no path from a cache miss back to the store, and the store is the
  durable source. After `releaseSession` (register.ts:1021-1025), a later resume of that native
  session fails with `unknown-session` until the process restarts, even though its row still
  exists.
- Native App Server features that exist were refused as unsupported. See the 6b refusals section.

## Failure modes

### FM1: Routing rejects ids it does not have cached (Claude regression)

- Trigger: lookup and ports tokens are bound by the host (8a/8d/8e), even with
  `nativeCodex: false`.
- Symptom: `SessionRuntimeRoutingError('unknown-session')` thrown from `isSessionActive`,
  `getSessionToken`, `endSession`, `sendMessageToSession` and `interruptCurrentTurn`. It fires
  for tab ids, and for new Claude sessions between SDK id resolution and the asynchronous
  `onMetadataChanged` refresh.
- Evidence: routing-agent-adapter.ts:165-167. The lookup holds persisted rows only and never
  supplies `live` (register.ts:1063-1067). Hosts route by tab id
  (surface-submit-turn.service.ts:279-288).
- Current handling: throws.
- Recommendation: an id with no binding must route to legacy, because the legacy adapter owns
  every id it created, including tab ids. Alternatively, ask the native adapter
  `isSessionActive`/`getSessionToken` first, and treat "unknown to native" as legacy. Keep the
  strict refusal only for persisted `codex-app-server` bindings, where there must be no fallback.

### FM2: Provider-agnostic native admission

- Trigger: `RuntimeHostCapabilities.nativeCodex === true`.
- Symptom: every new chat goes to `CodexChatAdapter`, including Claude, OpenRouter and other
  providers. There is no fallback, so non-Codex starts fail or run on the wrong runtime.
- Evidence: routing-agent-adapter.ts:65-71. Plan Task 5c.1 (batches.md:836-842) requires the
  active provider to be `openai-codex` AND `nativeCodex` to be true.
- Recommendation: admit to native only when the resolved execution profile for the start config
  is native (`resolveExecutionProfile` runtime `codex-app-server`). Otherwise use legacy.

### FM3: No `message_start` root in the native stream

- Trigger: any native turn.
- Symptom: the assistant message is not rendered in the execution tree, and final-only text
  never reaches the stream.
- Evidence: codex-chat-events.ts:76-179 (no `message_start` or `thinking_start` emitted);
  accumulator-core.service.ts:253-289; execution-tree-builder.service.ts:315.
- Recommendation: emit one `message_start` (`role: 'assistant'`, the turn `messageId`) before the
  first event of each turn, and emit `thinking_start` per reasoning block. Either carry
  final-only text as a `source: 'complete'` text event, or document and test that the host
  `content` callback renders it. Add an accumulator-level test that replays a native turn into
  the frontend tree builder.

### FM4: Busy latch on an unstarted generator

- Trigger: the iterable returned by `turn()` is not iterated: `publish` rejects early, the caller
  drops it, or `return()` is called before the first `next()`.
- Symptom: `busy` stays true, so every later turn throws `busy`. `close` never runs.
- Evidence: codex-chat-adapter.ts:307-311 (flag set eagerly), 313-372 (cleanup is only inside
  the generator), 394-399 and 257 (callers whose publish can fail before iterating).
- Recommendation: set `busy` inside the generator body, or wrap the generator in an
  iterable whose `return()` and `throw()`, plus a `publish` rejection, release the latch.

### FM5: Interrupt block that cannot be cleared

- Trigger: an interrupt that throws, or returns `false`, after which the turn ends naturally.
  On the legacy side this includes the 3 s SDK interrupt timeout.
- Symptom: the session cannot accept follow-ups, both in the adapter (`blocked`) and in the router
  (`blockedFollowUps`), until teardown or `releaseSession`. The documented recovery, "a
  successful interrupt", is unreachable once no turn is active: native returns `false` at
  codex-chat-adapter.ts:442, and the legacy record has been retired.
- Evidence: codex-chat-adapter.ts:440-449, 253-254, 308-309; session-runtime-router.ts:69-89;
  session-control.service.ts:122-152.
- Recommendation: clear the block when the blocked turn reaches a terminal event, or when the
  native thread reports idle (`thread/status/changed` / `turn/completed`). For legacy, mirror
  `SessionControl` semantics, where `false` still means the claim was released.

### FM6: 60 s approval auto-decline

- Trigger: an approval left unanswered for 60 s.
- Symptom: a silent decline, and the native turn proceeds as if the user had denied.
- Evidence: codex-chat-approval-sink.ts:82, 103-106; adapter construction at
  codex-chat-adapter.ts:222-260 passes no timeout; legacy policy at
  sdk-permission-handler.ts:84-90.
- Recommendation: wait indefinitely while the prompt is routable, as legacy does. Use a finite
  timeout only for unroutable surfaces, and supply it from composition.

### FM7: Router `cancelPrompt` orphans a pending native request

- Trigger: the host calls `SessionApprovalRouter.cancelPrompt` for a Codex owner.
- Symptom: the owner is deleted (session-approval-router.ts:84), but the sink's pending request
  stays open until its timeout. A late user reply is rejected (no owner). The timeout later
  sends a second `cancelPrompt` (codex-chat-approval-sink.ts:114-120).
- Recommendation: for Codex owners, route cancellation into the sink, for example with a
  `sink.cancel(correlation, reason)` that settles `decline`. Alternatively, keep the owner until
  the sink settles.

### FM8: Cache eviction with no path back to the store

- Trigger: `store.get` rejects during a refresh (register.ts:1039-1043), or the host calls
  `releaseSession` and later resumes the same native session.
- Symptom: `unknown-session` for a session whose row is intact.
- Recommendation: on a refresh failure, keep the immutable binding, since identity cannot change
  (session-metadata-store.ts:852-860 forbids it), and schedule a retry. Document that
  `releaseSession` is for deletion only, or re-admit on demand through an asynchronous
  `ensure(id)` before resume.

### FM9: Late lookup binding after early `TOKENS.AGENT_ADAPTER` consumers

- Trigger: a service resolves `TOKENS.AGENT_ADAPTER` before the host registers the (async)
  lookup.
- Symptom: tsyringe's `instanceCachingFactory` re-runs on `null` (`instance == undefined`), so
  later resolutions get `RoutingAgentAdapter`. Earlier consumers keep the raw `SdkAgentAdapter`
  and would send persisted native ids to the SDK. That is wrong-runtime routing with no error.
- Evidence: register.ts `wireAgentAdapterAliases` (useFactory, not cached) and register.ts:1150-1203.
  Several rpc-handlers hold `sdkAdapter` directly (chat-session.service.ts:1071, 1237, 1330).
- Recommendation: make "lookup registered before any adapter resolution" an asserted invariant.
  For example, throw if `ROUTING_AGENT_ADAPTER` was ever resolved as null and the lookup is later
  non-null. Audit direct `SDK_AGENT_ADAPTER` consumers in 8a.

## Blocking issues

### B1: RoutingAgentAdapter throws for tab ids and uncached Claude sessions

- File: libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:165-167
- Scenario: any host that binds the lookup and ports. See FM1.
- Impact: Claude chat breaks (stop, send, liveness checks) once native composition is wired, even
  with the capability off. This breaks focus point 6.
- Fix: route an unknown id to legacy, keep the strict refusal only for persisted native
  identities, and add specs for tab-id and pre-metadata Claude ids through the routing adapter.

### B2: New-session admission ignores the provider

- File: routing-agent-adapter.ts:65-71
- Scenario: `nativeCodex: true`. See FM2.
- Impact: non-Codex providers are admitted to the Codex App Server, with no fallback.
- Fix: gate on the resolved execution profile, `openai-codex` plus native, as in plan 5c.1.

### B3: The native projection omits the `message_start` root

- File: codex-chat-events.ts:76-179
- Scenario: every native turn. See FM3.
- Impact: the user sees an empty or missing assistant reply while the turn reports completion.
  Confidence: MEDIUM. It is blocking unless 8x host ports are contractually required to inject
  the root, and no port documentation says so (codex-chat-adapter.ts:76-81).
- Fix: as in FM3.

## Serious issues

### S1: Async generator busy latch

- File: codex-chat-adapter.ts:307-311, 366-372. See FM4.

### S2: Unrecoverable interrupt block, including a legacy Claude regression

- Files: codex-chat-adapter.ts:440-449; session-runtime-router.ts:69-89. See FM5. Focus 2: yes,
  a session can get stuck.

### S3: 60 s approval timeout departs from legacy behaviour

- File: codex-chat-approval-sink.ts:82, 103-106. See FM6.

### S4: Unsupported refusals where a native App Server feature exists

- File: codex-chat-adapter.ts:138-146, 499-504, 456; routing-agent-adapter.ts:56-64.
- Scenario: model listing, live stats, compaction pre-tokens, `/review`.
- Impact: this contradicts the project rule to use native features where they exist. Model
  queries for native sessions return Claude data (see Q2).
- Evidence: the pinned protocol manifest (codex-runtime/src/lib/protocol/
  codex-app-server-protocol.manifest.json) lists `model/list`, `review/start`, `thread/fork`,
  `thread/rollback` and `thread/name/set`. `thread/tokenUsage/updated` is already validated by
  core (codex-protocol-methods.ts:292).
- Fix: add `model/list` to core and implement getSupportedModels, getDefaultModel and
  getApiModels from it. Route model queries by session runtime, or expose a per-session model
  source. Feed `thread/tokenUsage/updated` into live stats and compaction `preTokens`. Map
  `/review` to `review/start`. Correct refusals: worktree callbacks; the SDK-only permission
  aliases; `verifyInstallation` is defensible as "established at gated open".

### S5: Missing `metadataChanged` emission for native writes

- File: session-metadata-store.ts:809-884
- Impact: the sidebar and other listeners never learn that a native session was created or
  resumed. The identity cache is correct only through write-through in this process.
- Fix: call `emitChange('created' | 'updated', sessionId, execution.workspaceId)` after the
  queued write resolves. The sequence guard in the lookup already tolerates the re-read.

## Moderate and minor issues

- (moderate) Cache eviction on refresh failure, and releaseSession with no store re-read:
  register.ts:1021-1025, 1039-1043. See FM8.
- (moderate) Router `cancelPrompt` orphans the native request: session-approval-router.ts:80-90.
  See FM7.
- (moderate) Composition order hazard with early `AGENT_ADAPTER` consumers:
  register.ts `wireAgentAdapterAliases`. See FM9.
- (moderate) A Codex row's top-level `workspaceId` and stored `workspace_path` become the
  lowercased, forward-slash key on Windows (session-metadata-store.ts:867-871). Non-records
  listing is case-sensitive (1168-1173).
- (moderate) Active `resumeSession` refuses `undefined`-valued keys: codex-chat-adapter.ts:171.
- (moderate) Any stream failure, including a transient `startTurn` rejection, closes the whole
  session: codex-chat-adapter.ts:363-371.
- (minor) Error codes collapse to `runtime-failed`: codex-chat-adapter.ts:284-297, 364-365.
- (minor) `updateCodexExecution` rebuilds the detail and drops `workingDirectory` and
  `resumableSdkSubagents` written by `saveResumeState`. It also resets totals on every resume:
  session-metadata-store.ts:866-879.
- (minor) The `sequences`, `releases`, `blockedFollowUps` and sink `seen` maps are never pruned:
  register.ts:996-1004; session-runtime-router.ts:36; codex-chat-approval-sink.ts:74. Each grows
  by one entry per session or request.
- (minor) `getHealth` reports `unavailable` when no sessions exist (codex-chat-adapter.ts:128-137).
  It is not reached through routing.

## Focus point verdicts

1. Approval release: CONFIRMED. `settle` is the only exit, and it always calls
   `presentation.dismiss`, which runs the stored release, on reply (195), edit (172), timeout
   (103-106), abort (102, 134), dispose (199-204) and present failure (141-143). Early
   `decline` returns never register. `open()` failure disposes the sink (codex-chat-adapter.ts:286).
   The gap is cancellation through the router (FM7), not release.
2. 6c stuck session: YES (S2 / FM5).
3. 6d: confirmed. `updateCodexExecution` neither reads nor writes `accountBinding`: it reads the
   raw detail and builds the row without it (session-metadata-store.ts:814-879). A save that adds
   a binding to a Codex row is rejected (912). A save that injects or changes `codexExecution` is
   rejected (902). `flush` keeps `preservedIndexEntry` (1039). The `normalizedHome` refine
   (session-runtime.schemas.ts:6-29) matches the fixed points of `normalizeCodexHomeKey` for
   posix, drive and UNC roots, trailing separators and dot segments. No counter-example was found.
4. 6e cache: synchronous lookup OK. The preload and event race is handled by `sequences.has`
   (register.ts:1055-1058). Write-through bumps the sequence after the store resolves, so it
   supersedes any in-flight re-read (1086-1089). Release during a write is guarded by
   `releaseVersion`. `dispose` unsubscribes. Defects: FM8 and FM9. Null tokens give the exact
   `SdkAgentAdapter` (register.ts `wireAgentAdapterAliases`; spec register.codex-runtime.spec.ts:50).
5. 6b refusals: partially wrong (S4).
6. Claude unchanged on the default path: YES with null tokens. NO once tokens are bound (B1, B2,
   S2).
7. No TODO, PLACEHOLDER or STUB markers in codex-app-server/ (grep, case-insensitive). No empty
   bodies other than `preloadSdk` (justified, line 116-118). No mock data or logging in place of
   logic.

## Data flow (native start)

1. `RoutingAgentAdapter.startChatSession`: GAP B2, no provider check.
2. `CodexChatAdapter.open` → `ports.profile` → generation and cancel checks: OK.
3. `createScope` forwarding sink, which declines before binding → `resolveGatedCodexRuntime` →
   `runtime.open`: OK.
4. Sink built, with `register` on present and release on dismiss: OK.
5. `metadata.save` → lookup `updateCodexExecution` → store queue → schema, immutability and
   foreign-workspace checks → persist → flush: OK, but no `emitChange` (S5). Write-through after
   resolve: OK.
6. Session set → `resolved(tabId, id)` → `turn()`: GAP S1, busy is set eagerly.
7. `stream`: subscribe, `startTurn`, project: GAP B3, no `message_start`. A non-terminal end
   closes the session (moderate).
8. Later operations by id → `RoutingAgentAdapter.adapter`: GAP B1 for uncached and tab ids.

## Requirements fulfilment

| Requirement                                         | Status   | Gap                         |
| --------------------------------------------------- | -------- | --------------------------- |
| Approval ownership released on every settle         | COMPLETE | Router cancel orphan (FM7)  |
| Failed interrupt blocks until success or release    | PARTIAL  | Success path unreachable    |
| Codex rows never carry accountBinding               | COMPLETE | -                           |
| Sole native metadata writer, immutable binding      | COMPLETE | No change event (S5)        |
| Identity cache: preload, write-through, seq, dispose | PARTIAL  | Eviction without recovery   |
| Null host tokens: no native routing, exact SDK       | COMPLETE | Ordering hazard (FM9)       |
| Native admission only for Codex provider            | MISSING  | B2                          |
| Use native App Server features where they exist     | PARTIAL  | S4                          |
| Claude behaviour unchanged                          | PARTIAL  | Default only; B1, S2 when bound |

Implicit requirements not addressed: a frontend-renderable stream shape (B3); parity with the
legacy approval wait (S3); sidebar notification for native rows (S5).

## Edge cases

| Case                                 | Handled | How                         | Concern                    |
| ------------------------------------ | ------- | --------------------------- | -------------------------- |
| Approval before thread bound         | YES     | Forwarding sink declines    | -                          |
| Duplicate approval address           | YES     | register throws, decline    | Key lacks processGeneration |
| Reset or dispose during open          | YES     | generation/cancel checks    | Error code lost (minor)    |
| Iterable never consumed              | NO      | -                           | S1                         |
| Interrupt fails, then turn ends       | NO      | -                           | S2                         |
| Preload vs concurrent change event   | YES     | sequences.has guard         | -                          |
| Refresh read failure                 | NO      | Evicts binding              | FM8                        |
| Tab-id routing                       | NO      | Throws                      | B1                         |
| Windows workspace case               | PARTIAL | Records path normalized     | Memento path case-sensitive |

## Decisions

- Severity of B3: rated blocking rather than major. Options were blocking, or major on the
  assumption that the host injects the root. Evidence: no port contract requires injection
  (codex-chat-adapter.ts:76-81), and the frontend requires `message_start`. Reversible if 8x adds
  and tests a host-side root.
- B1, B2 and S2 are rated against the 6e composition, even though host wiring lands in 8a/8d/8e.
  The defects sit in the routing classes this phase delivers, and binding the tokens is their
  only intended use.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for B1, B2, S1, S2, S3 and S5; MEDIUM for B3 and S4 (the S4 core scope is a
  product call).
- Top risk: once the host binds the native tokens, Claude sessions start throwing
  `unknown-session` on tab-id and early-lifecycle operations, and non-Codex starts are admitted
  to Codex.
- What a robust implementation would add: an unknown id defaults to legacy, with strictness
  only for native bindings; profile-based admission; a `message_start` / `thinking_start`
  framing test through the frontend accumulator; a lazy busy latch; a terminal-clears-block
  rule; an infinite wait for routable approvals; `emitChange` in `updateCodexExecution`; core
  `model/list` and token-usage wiring.
