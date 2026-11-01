# Code Logic Re-review — `TASK_2026_714_c8a2` (P6 fix round, batch 6f)

Fix range: `78e5eebcc..47e28da09` (f8dfd61cc core `model/list`, 47e28da09 agent-sdk P6 fixes).
P6 context range: `ef4e34932..47e28da09`. First review: code-logic-review-p6.md. Decisions:
decisions.md rows "P6 fix 1..11". Deferred items: batches.md:1232-1248.

Files read in full: `codex-app-server/routing-agent-adapter.ts`, `session-runtime-identity.ts`,
`session-runtime-router.ts`, `session-approval-router.ts`, `codex-chat-adapter.ts`,
`codex-chat-events.ts`, `codex-chat-approval-sink.ts`, `wiring/session-runtime-identity-cache.ts`,
`wiring/codex-runtime-composition.ts`, `wiring/codex-chat-metadata-port.ts`. Also read:
`di/register.ts:980-1112`, `di/tokens.ts` diff, `index.ts` diff, `session-metadata-store.ts`
(diff plus `updateCodexExecution` 875-974, `emitChange` 776-789, `getAll` 1283-1302,
`sessionIndexEntry` / `toSessionRecordInput` 437-476), and core `codex-runtime.ts` (`listModels`
671-708, `serialize` 462-469, `start` 515-563, `bindTurnSignal` 595-609, `onFailure` 746-748),
`codex-protocol-methods.ts` `model/list`, `codex-event-translator.ts:101-122`. Frontend:
`accumulator-core.service.ts:253-463`, `chat-execution-tree/.../message-node.fn.ts`. Pinned
schema: `codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`
(`definitions.v2.Model`, `TurnStartParams.model`, `ThreadStartParams.model`, `ThreadTokenUsage`).
Specs were skimmed for coverage only. No tests were run. The team-leader's verify evidence is in
batches.md:1222-1231.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 9              |
| Failure modes found | 8              |

All three blockers from the first review are fixed in agent-sdk. The fixes follow decisions 1-3.
The B1 fix adds one serious regression: an id that is not in the cache goes to legacy, and that
id can be a tab id that the native adapter is still opening. The model value mapping (open
question 4) is wrong in principle. The score is 6 and not 7: one serious defect sits on a likely
path (close the tab or fail during a native open), and several host-contract gaps hold only by
convention. It is not 5: no blocker remains, and the default Claude path is unchanged.

## Status of first-review findings

| Finding | Decision | Status | Evidence |
| --- | --- | --- | --- |
| B1 / FM1: uncached ids throw | fix 1 | RESOLVED (adds SN1) | routing-agent-adapter.ts:184-189 routes `undefined` identity to legacy; session-runtime-identity.ts:33-34 returns `undefined` for an unknown id; session-runtime-router.ts:68-73 does the same. A native id is never evicted by release (session-runtime-identity-cache.ts:125-129). Only a `deleted` event removes it (:54-59). |
| B2 / FM2: admission ignores provider | fix 2 | RESOLVED in lib | routing-agent-adapter.ts:80-83 checks `nativeCodex` first, so the port is not called on the default path, then requires `servingProviderId === 'openai-codex'`. The port is host-implemented (8a). See M1 for the partial-wiring hazard. |
| B3 / FM3: no `message_start` | fix 3 | RESOLVED | codex-chat-events.ts:78-88 emits one assistant `message_start`, with the turn `messageId`, before the first accepted event. :115-137 streams the unstreamed suffix of final-only text. :227-242 `message_complete`. This matches accumulator-core.service.ts:253-299 (root pushed into `messageEventIds`) and message-node.fn.ts:35 (node needs a start event). Minor: no accumulator-level replay spec (m1). |
| S1 / FM4: busy latch on an unstarted generator | fix 4 | RESOLVED | busy is set inside the generator body (codex-chat-adapter.ts:445-448) and cleared in `finally` (:514-520). `publish` closes the iterator in `finally` (:389-398). An unstarted generator never takes the latch. |
| S2 / FM5: interrupt block cannot clear | fix 5 | PARTIAL | Adapter: the block clears at turn end (:519) and on an idle interrupt (:588-590). Legacy: the router no longer blocks (session-runtime-router.ts:56-60 returns `true` for legacy), so Claude behaviour is as before. Router native path: `canSendFollowUp` delegates to host `NativeSessionControls`, but CodexChatAdapter exposes no blocked/turn-state accessor that a host could read (M2). |
| S3 / FM6: 60 s auto-decline | fix 6 | RESOLVED | No timer in codex-chat-approval-sink.ts:87-141. Settles only on reply, abort (:101), dispose (:210-215), present failure (:136-139) or cancel (:197-208). |
| FM7: router cancel orphans the native request | fix 6 | RESOLVED (minor m2) | session-approval-router.ts:96-98 calls `sink.cancel`, which settles `cancel` (sink:203). Two cancel notifications go out with different reasons (m2). |
| S4: unsupported refusals | fix 7 | PARTIAL | `model/list` was added (codex-runtime.ts:671-708, protocol-methods `model/list`) and is exposed through `listSessionModels` (routing-agent-adapter.ts:178-182; codex-chat-adapter.ts:401-414). Usage goes to `message_delta` / `message_complete` / result stats / compaction preTokens. Gaps: the model value mapping is wrong (M3); `getSupportedModels` / `getDefaultModel` / `getApiModels` on the routing adapter still return legacy data (routing-agent-adapter.ts:67-75), so a host must call `listSessionModels`; usage semantics are doubtful (M7). |
| S5: no `metadataChanged` for native writes | fix 8 | RESOLVED | session-metadata-store.ts:973 emits `created`/`updated` after the queued write and the flush (:969-972). This is ordered after the durable write. |
| FM8: eviction on a failed refresh | fix 9 | RESOLVED | A refresh failure logs and keeps the binding (session-runtime-identity-cache.ts:68-73). `replace(null)` is a no-op (:40). Release keeps native ids (:126). |
| FM9: late lookup binding | fix 9 | DEFERRED, acceptable | Guard at codex-runtime-composition.ts:165-197, hooked at register.ts:1032, 1058-1061. It throws on any later difference in a guarded token. It cannot revoke references already held, so the 8a audit stays (batches.md:1237-1240). See M6. |
| Mod: Windows workspace casing | fix 11 | RESOLVED | `normalizeWorkspaceId` lowercases on win32 (session-metadata-store.ts:319-322), used at :1266-1270. |
| Mod: active resume refuses `undefined` keys | fix 11 | RESOLVED | codex-chat-adapter.ts:185-191. |
| Mod: stream failure closes the session | fix 11 | RESOLVED | The `if (!terminal) close` was removed. `finally` releases the turn state only (:514-520). |
| Minor: error codes collapse | — | RESOLVED | `cancelled`, `identity-mismatch` (:37-47); coded errors pass through (:234, :512, :682). |
| Minor: `updateCodexExecution` drops fields / resets totals | — | RESOLVED | `...existing` plus `??` defaults (session-metadata-store.ts:957-968). |
| Minor: maps never pruned | — | MOSTLY RESOLVED | sink `seen` pruned (:107, :214). Router `blockedFollowUps` and cache `releases` removed. `sequences` keeps native ids for the life of the process (cache :126). Bounded by the session count. |
| Minor: `getHealth` unavailable with zero sessions | — | RESOLVED | codex-chat-adapter.ts:146-151. |

## Five logic questions

### 1. How does this fail silently?

- During a native open, the host's cleanup by tab id goes to the SDK adapter. The native open
  keeps going, persists the row and runs its first turn with nobody listening (SN1).
  chat-stream-broadcaster.service.ts:351-359 calls `endSession(sessionId)` where
  `sessionId === tabId`. routing-agent-adapter.ts:90-92, 184-189 sends that id to legacy, because
  the tab id is never in the identity cache. Only `CodexChatAdapter.endSession` can cancel an
  open, and it does so by tab key (codex-chat-adapter.ts:200-205, 550-552).
- A host binds lookup, ports and native controls but leaves `RUNTIME_ADMISSION_PORT` null.
  `ROUTING_AGENT_ADAPTER` then resolves to null (register.ts:1045), so `AGENT_ADAPTER` is the
  plain SDK adapter (register.ts:1107-1109), while `SESSION_RUNTIME_ROUTER` is live
  (register.ts:1027-1029). Persisted native ids then go to the SDK with no error (M1).
- The write-through re-read fails after a successful durable write (cache :112-114). The event
  refresh for that write was already superseded by `advance` (:111), so the native id stays
  uncached, and a later resume routes to legacy (M4).

### 2. What user action produces unexpected behaviour?

- Closing a tab, or a zero-event failed start, while the Codex App Server is still spawning (SN1).
- Opening the model picker on a native tab that is restored but not yet resumed:
  `listSessionModels` throws `unavailable` because the adapter has no open session
  (codex-chat-adapter.ts:404, 665-669) (M8).
- Opening the model picker when `model/list` fails for a non-RPC reason (schema drift,
  pagination guard). The live chat context closes, because `onFailure` runs `close()`
  (codex-runtime.ts:700-705, 746-748) (M5).
- Picking a model whose catalogue `id` differs from its `model` slug sends the `id` as the
  turn model (M3).

### 3. What input data produces a wrong answer?

- A `Model` whose `id !== model`. CodexModelInfo.id = `model.id` (codex-runtime.ts:687), the
  picker value = `model.id` (codex-chat-adapter.ts:407), and `setSessionModel` sends that value
  to `turn/start.model` (codex-chat-adapter.ts:626-631 → codex-runtime.ts:520) (M3).
- Multi-request native turns. Result stats, `message_complete.tokenUsage` and preTokens are
  built from `tokenUsage.last` (codex-event-translator.ts:106-113). Upstream Codex reports `last`
  as the most recent model response, and `inputTokens` includes `cachedInputTokens`. Ptah's
  `tokens` are four disjoint classes (rpc-session.types.ts:376-381). Turn totals are then
  undercounted and cache reads double-counted (M7, MEDIUM confidence).

### 4. What happens when a dependency fails?

- Admission port rejects: `startChatSession` rejects for every provider when `nativeCodex` is
  true (routing-agent-adapter.ts:79-82). This is intended by decision 2 ("not consent to
  switch"), but a Claude user then cannot start a chat while the port is down. Recorded, not
  counted.
- `store.get` fails in the write-through: `updateCodexExecution` rejects after a durable write,
  the open fails and cleans up (codex-chat-adapter.ts:229-235), and the row stays uncached (M4).
- `context.interrupt` throws: the block stays until the turn ends, then clears (:519). OK.
- `presentation.cancelPrompt` / `dismiss` throw inside settle: logged, outcome still resolves
  (sink :109-124). OK.
- `model/list` fails: the context closes (M5).

### 5. What is missing that the requirements never mentioned?

- A native "owns this id" check for ids that are not cached (opening tab keys, active sessions)
  in the routing adapter (SN1).
- A public adapter query for native follow-up gating that a host `NativeSessionControls` can
  read (M2).
- A composition guard that refuses partial native wiring (M1). The guard also needs bindings that
  keep the same identity on every resolve (M6).
- Cache reload on workspace switch for hosts without `ISessionRecordRepository` (M9).

## Failure modes

### FM-R1: Native open cannot be cancelled through routing (SN1)

- Trigger: `endSession(tabId)` / `interruptSession(tabId)` while `CodexChatAdapter.open` is in
  flight (profile, App Server spawn, `thread/start`, metadata save).
- Symptom: the native open completes, publishes the session, calls `resolved` and starts the
  first turn after the host has cleaned up the tab. The broadcaster's failed-start cleanup is a
  no-op for native.
- Evidence: routing-agent-adapter.ts:90-92, 123-127, 184-189; codex-chat-adapter.ts:200-205,
  550-552; chat-stream-broadcaster.service.ts:351-359.
- Current handling: the id is uncached, so it goes to legacy. The SDK ignores an id it does not own.
- Recommendation: for an uncached id, ask the native adapter whether it owns the id (an opening
  key or an active session) before falling back to legacy. Alternatively, send `endSession` /
  `interruptSession` for uncached ids to both adapters (each ignores ids it does not own). Add
  routing specs for "endSession(tabId) during a native open".

### FM-R2: Silent SDK routing on partial native wiring (M1)

- Trigger: the host binds lookup and ports but not `RUNTIME_ADMISSION_PORT` (or not
  `CODEX_CHAT_ADAPTER_PORTS`).
- Symptom: native persisted ids go to `SdkAgentAdapter`, and session controls go native.
- Evidence: register.ts:1027-1029 vs 1045-1055, 1099-1111.
- Recommendation: if `SESSION_RUNTIME_IDENTITY_LOOKUP` is non-null, require every sibling token
  and throw from the factory. Leave null as the default only when all of them are null.

### FM-R3: Model value is the catalogue id, not the model slug (M3)

- Trigger: any `Model` whose `id` differs from `model`.
- Symptom: `turn/start` receives an unknown or different model string. The turn fails or runs
  another model.
- Evidence: schema `v2.Model` has both `id` and `model` as required strings;
  `TurnStartParams.model` reads "Override the model for this turn and subsequent turns"
  (`ThreadStartParams.model` is the same type). codex-runtime.ts:687 keeps only `id`.
- Recommendation: carry `model` (the slug) in CodexModelInfo and use it as the picker `value`
  and the turn/thread `model` param. Keep `id` as the catalogue key only.

### FM-R4: Uncached native row after a failed write-through re-read (M4)

- Trigger: `store.updateCodexExecution` succeeds, then `store.get` (cache :112) rejects or
  returns no `codexExecution`.
- Symptom: `unknown` id, so a later `resumeSession(threadId)` goes to the SDK.
- Evidence: session-runtime-identity-cache.ts:61-67 (event refresh at version N), :111
  (write-through bumps to N+1, superseding it), :112-120.
- Recommendation: on re-read failure, keep the event refresh's result (do not supersede it until
  the re-read succeeds), or retry the read.

### FM-R5: Model listing closes the live context (M5)

- Trigger: `model/list` response fails strict validation, the cursor repeats, or the 100-page
  guard trips.
- Symptom: the chat context closes, and the active turn and approvals are lost.
- Evidence: codex-runtime.ts:697-705 (client-side guards throw inside the `try`), 746-748.
- Recommendation: close the context only for transport or process failure. A catalogue read or a
  client-side pagination guard should reject the query and leave the context alone.

### FM-R6: Duplicate cancel notification with a wrong reason (m2)

- Trigger: `SessionApprovalRouter.cancelPrompt(address, 'timeout' | 'superseded' | 'disposed')`
  for a Codex owner.
- Symptom: `presentation.cancelPrompt` is called twice, first with `turn-ended` (sink :111-115,
  203), then with the caller's reason (router :99-103).
- Recommendation: give `sink.cancel` the reason, and let only one side emit.

### FM-R7: Native session with no open context cannot list models (M8)

- Evidence: codex-chat-adapter.ts:404, 665-669; routing-agent-adapter.ts:178-182.
- Recommendation: document that 8a must use a profile-level catalogue before resume, or open a
  catalogue context.

### FM-R8: Usage semantics (M7)

- Evidence: codex-event-translator.ts:106 claims "`last` is turn usage". codex-chat-adapter.ts:472-486
  and codex-chat-events.ts:184-198 map it 1:1 into Ptah's disjoint token classes.
- Recommendation: verify with a spike turn that runs a tool call. Use `total` deltas per turn,
  and subtract `cachedInputTokens` from `inputTokens` for Ptah's `input`.

## Blocking issues

None.

## Serious issues

### SN1: Tab-id cleanup and cancel during a native open goes to legacy

- File: libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:90-92, 123-127, 184-189
- Scenario: the user closes the tab, or the broadcaster's zero-event cleanup runs, while the
  native open is in flight. See FM-R1.
- Impact: an orphaned native session (App Server process, persisted row, first turn) that the
  user believes is gone. It is a regression of fix 1. Before the fix this path threw; now it
  silently does nothing.
- Fix: as in FM-R1.

## Moderate and minor issues

- (M1) Partial native wiring silently selects the SDK adapter: register.ts:1045, 1107-1109. FM-R2.
- (M2) The router's native follow-up gate has no source in this lib: session-runtime-router.ts:56-60
  delegates to host `NativeSessionControls`, but CodexChatAdapter keeps `blocked` / `turnId`
  private (codex-chat-adapter.ts:98-110, 585-598). 8a must add an accessor or implement the
  controls inside the adapter. Otherwise fix 5 holds in the adapter only.
- (M3) Model value is `Model.id`, not `Model.model`: codex-runtime.ts:687; codex-chat-adapter.ts:407. FM-R3.
- (M4) Write-through re-read failure leaves a native row uncached: session-runtime-identity-cache.ts:111-120. FM-R4.
- (M5) `listModels` failure closes the context: codex-runtime.ts:697-705. FM-R5.
- (M6) The guard compares resolved values by identity (codex-runtime-composition.ts:177-194). A
  host that binds a guarded token with a plain `useFactory` returning a new object on each call
  (the same style as the defaults at register.ts:994-1005) throws on the second `AGENT_ADAPTER`
  resolution. It fails loudly, but the token docs (tokens.ts) do not state the identity-stable
  requirement.
- (M7) Usage semantics (`last`, cached included in input): MEDIUM confidence. FM-R8.
- (M8) `listSessionModels` needs an open native session: codex-chat-adapter.ts:404. FM-R7.
- (M9) On hosts without `ISessionRecordRepository`, `getAll` is per workspace
  (session-metadata-store.ts:1290-1301). The cache preloads once (cache :86-92), so native rows of
  a workspace activated later are uncached and route to legacy. Electron uses the records
  repository (`listAll` across projects, :1284-1288), so this affects VS Code and CLI only.
- (m1) No accumulator-level replay spec for the native event order. The order is pinned only in
  codex-chat-events.spec.ts (decision 3 asks for "a spec of the event order the accumulator
  expects"). The mapping checks out by reading accumulator-core.service.ts:253-463 and
  message-node.fn.ts:35-99.
- (m2) Double cancel notification: session-approval-router.ts:96-103; codex-chat-approval-sink.ts:197-208. FM-R6.
- (m3) Consumer `return()` mid-turn: the subscription abort interrupts the server turn through
  `bindTurnSignal` (codex-runtime.ts:595-609), but `busy` clears at once (adapter :517). A
  follow-up sent before the interrupted turn's terminal fails with `runtime-failed` ("Codex turn
  is already active", codex-runtime.ts:516). It is transient and does not close the context.
- (m4) Stop pressed between `busy = true` and the `startTurn` receipt returns `false` and clears
  `blocked` (adapter :587-591). The Stop is dropped, and the turn runs.

## Requirement checks from the brief

- Busy / interrupt / approval-cancel races: the generator body holds the latch synchronously, so a
  second concurrent generator throws `busy` (adapter :445). Interrupt and turn-end ordering:
  `blocked` is set before the await and cleared by turn end. A late interrupt rejection does not
  set it again (:592-597). Approval cancel versus reply: the router deletes the owner first, and
  `settle` is idempotent through `pending.delete` (sink :106). No race found besides m3 and m4.
- Identity cache leaks: `entries` is bounded by persisted rows. `writes` is cleared in `finally`.
  `refreshing` is cleared on settle. `sequences` keeps native ids (bounded). `dispose` clears all
  and unsubscribes (cache :77-85). No leak that grows with the session.
- Wrong-runtime routing: an uncached id goes to legacy by design (fix 1). The native-never-falls-back
  guarantee holds for preloaded and successfully written rows. It breaks under SN1, M1, M4 and M9.
- Admission gating: correct in lib (routing-agent-adapter.ts:80-83). The correctness of
  `servingProviderId` depends on the host.
- Stream order: `message_start` → (`text_delta` | `thinking_delta` | `tool_start` | `tool_result` |
  `message_delta`)* → `message_complete`, all with one `messageId`. That is what the accumulator
  and tree builder need. Text and thinking share one `blockIndex` counter (events :247-255). The
  builder keys blocks by kind, so this is harmless.
- Change events after the durable write: yes (store :969-973). The cache sequence logic handles
  the synchronous emit before the write-through re-read (cache :61, :111).

## Claude default path (null tokens, nativeCodex false)

Unchanged. All host tokens default to null (register.ts:987-1006). `ROUTING_AGENT_ADAPTER` is null,
so `AGENT_ADAPTER` is the exact `SdkAgentAdapter` (register.ts:1099-1111). The guard snapshot of
four nulls plus the registered capabilities instance stays stable (codex-runtime-composition.ts:185-196).
`SESSION_RUNTIME_ROUTER` is null. The store's new `emitChange` after `updateCodexExecution` fires
only for native writes. `normalizeWorkspaceId` lowercasing applies to win32 listing comparison
only (store :319-322, 1266-1270). This changes Claude listing on Windows from case-sensitive to
case-insensitive. That is the intended fix 11, and it cannot drop a row that matched before.

## Open question 4: which value goes in the `model` param

The pinned schema defines `v2.Model` with both `id` and `model` as required strings.
`TurnStartParams.model` and `ThreadStartParams.model` are `string | null`, described as "Override
the model for this turn and subsequent turns". The schema alone does not name the source field. In
the upstream App Server, `Model` is built from a model preset: `id` is the preset/catalogue
identifier and `model` is the model slug that the config and turn overrides consume. Earlier
presets used distinct ids for one slug (effort variants). The value for `turn/start.model` and
`thread/start.model` must be `Model.model`. The current mapping (codex-runtime.ts:687 →
codex-chat-adapter.ts:407 → :630 → codex-runtime.ts:520) sends `Model.id`. It works only while
the two coincide (batches.md:1246-1248 acknowledges they coincide for the bundled presets).
Verdict: incorrect, latent. Fix before 8a binds the picker (M3).

## Deferred items

| Item | Verdict | Reason |
| --- | --- | --- |
| Live stats refused | Correct deferral | `SessionStatsLivePayload.sessionStats` requires `SessionStatsEntry` with disjoint `cacheCreation` and session totals (agent-adapter.types.ts:98-105; rpc-session.types.ts:359-381). Native usage does not report them, so a refusal is better than invented numbers. The routing adapter only forwards the setter to legacy (routing-agent-adapter.ts:162-166), so nothing throws on the default or native path. |
| `review/start` tracked gap | Correct deferral | No Ptah UI on this path. `/review` refuses explicitly (`slashCommand` unsupported, adapter :605). It is tracked at batches.md:1236, 1269-1270. |
| FM9 guard limit + 8a audit | Acceptable | The guard turns late binding into a loud error on the next resolution of any guarded token. It cannot fix references captured earlier (chat-session.service.ts:1071; chat-stream-broadcaster.service.ts:359 holds `sdkAdapter` directly). The 8a audit is required, and it must also cover SN1, because the broadcaster's tab-id cleanup is one of those direct consumers. |

## Markers

`grep -niE "TODO|PLACEHOLDER|STUB|FIXME|XXX"` over codex-app-server/ and wiring/ (non-spec): no
hits. Empty bodies: `preloadSdk` (adapter :134-136, justified comment) and the `/compact` empty
generator (adapter :609-611, no assistant result by design). No mock data or logging in place of
logic. Logging calls sit next to real handling.

## Data flow (native start, after fixes)

1. `RoutingAgentAdapter.startChatSession`: capability, then admission port. OK.
2. `CodexChatAdapter.open`, keyed by tabId: GAP SN1, this key is unreachable through routing for
   cancel.
3. `prepareProfile` → `createScope` (decline until sink bound) → `openContext`: OK.
4. `buildSink` → `persistMetadata` → cache `updateCodexExecution` → store queue, normalize,
   validate, persist, flush, `emitChange` → cache re-read and replace: OK. GAP M4 on re-read failure.
5. `publishSession` → `resolved(tabId, id)` → `turn()` (no latch until iterated): OK.
6. `stream`: busy, `startTurn` (signal bound to interrupt), project with `message_start` first,
   `message_complete` on terminal; `finally` releases busy, turnId and blocked: OK (m3, m4).
7. Later operations by thread id: cached as native, so they go native. OK.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Tab id before resolution | PARTIAL | Goes to legacy | Native opening is missed (SN1) |
| Unconsumed turn iterable | YES | Latch inside generator | — |
| publish rejects before `next()` | YES | `iterator.return()` in finally | — |
| Interrupt fails, then turn ends | YES | `finally` clears `blocked` | Host gate (M2) |
| Approval unanswered for a long time | YES | No timer | — |
| Router cancel of a Codex prompt | YES | `sink.cancel` | Duplicate notice (m2) |
| Refresh `get` rejects | YES | Binding kept | — |
| Re-read after write rejects | NO | Superseded refresh | M4 |
| Release of a native id | YES | Ignored for native | — |
| Model id differs from slug | NO | Sends id | M3 |
| `model/list` schema drift | NO | Context closed | M5 |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for SN1, M1, M3 and M4; MEDIUM for M7.
- Top risk: a tab-id cleanup during a native open is routed to the SDK, which leaves an orphaned
  native session running after the user closed it.
- What a robust implementation would add:
  1. A native ownership check, or a fan-out, for uncached ids on `endSession` /
     `interruptSession` / `isSessionActive`, with specs.
  2. `CodexModelInfo.model` (slug) as the picker value and the turn/thread model param.
  3. A composition factory that throws on partial native wiring.
  4. A write-through that does not supersede the event refresh until its own re-read succeeds.
  5. `listModels` failures that reject without closing the context.
  6. An adapter accessor (or adapter-owned `NativeSessionControls`) for follow-up gating.
  7. A spike-verified usage mapping (`total` deltas, non-cached input).
