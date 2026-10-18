# Code Logic Review - TASK_2026_692_f748, Phase 2 (Batches 9-13, wiring)

Review family: Claude (Sonnet 5.5) reviewing codex-implemented Batches 9-13. Diff `bb9cb377b^..97338b3fa`.
Phase 1 (idle service, reducer, coordinator) read as context only.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 3 |
| Minor issues | 4 |
| Failure modes found | 8 |

Evidence run (scoped, my own): Jest on `session-query-executor.idle-signals.spec.ts`,
`session-lifecycle-manager.idle.spec.ts`, `compaction-hook-handler.spec.ts`,
`session-stream-pump.service.spec.ts` -> 4 suites, 64 tests passed. `npx nx typecheck agent-sdk` passed.
Router spec and the three smoke specs not re-run (implementer reports them green).

The wiring does reach an idle compaction end to end on the traced path. The one real defect is that
construction of the optional idle service is not fail-open.

## Five logic questions

### 1. How does this fail silently?
- Turn-context is never emitted when the port or query is missing, or when `readAtTurnEnd` rejects
  (`session-query-executor.service.ts:475-494`, early return at 477 and `.catch` at 492). The session
  just never arms. That is the safe direction, but it logs only a generic warn, so "idle compaction
  never fires" is hard to diagnose.
- A coalesced or deduped manual `/compact` returns `{ success: true }` with no stream and no user
  message (`chat-slash-command-router.service.ts:132-141`, `175-184`). By design (D6), but the webview
  tab behaviour is plan assumption A5 and no live evidence exists in Batches 9-13.
- Admission failure in the router is logged at warn and the command is sent anyway (fail-open, lines
  142-150, 186-194). Correct per the plan; the cost is an unreserved send if the coordinator is broken.

### 2. What user action produces unexpected behaviour?
- The user sends a message in the window between the idle send being committed (`phase: 'sending'`)
  and the pump push. `input()` runs in the facade before `sendMessage` yields
  (`session-lifecycle-manager.ts:718-719`). The reducer only clears a `pending` attempt on `input`
  (`idle-session.reducer.ts:130-136`), not an in-flight `sending` one. The pump's second
  `assertAdmissible` passes if the user's message has not been pushed yet (it is still in
  `await createUserMessage`, `session-stream-pump.service.ts:235`). `/compact` is then enqueued ahead
  of the user's message, which runs against a freshly compacted context. See Moderate M1.
- The user changes model mid-session: wired (`session-lifecycle-manager.ts:818-822`). Other
  cache-prefix changes are not signalled (Minor m1).

### 3. What input data produces a wrong answer?
- A session id that changes without a PostCompact rekey (fork, resume under a new id): `bind` calls
  `sessionBound(newId, ...)` (`session-query-executor.service.ts:459-461`). `resolveIdleSignal` finds
  no alias and creates a second group (`idle-compaction.helpers.ts:40-45`), while the first group keeps
  its pending attempt keyed on the old id until the tap releases it. Outcome is a refused send
  (`session-ended`), not a wrong compaction (Minor m2).
- `compact_metadata.pre_tokens` non-finite -> `null` (`:284`), handled. Non-string `session_id` ->
  `''`, no bind, handled (`:244-250`).

### 4. What happens when a dependency fails?
- Idle service constructor throws: it takes down the SessionLifecycleManager and CompactionHookHandler
  resolution. See Serious S1.
- Idle signal producer throws: caught per call by `guardIdle` (`:509-519`) and logged once. OK.
- `sendIdleCompact` rejects: facade returns the pump promise (`session-lifecycle-manager.ts:729-740`),
  service maps `SessionAdmissionRefusedError` -> skipped, `IdleSendVetoedError` -> skipped, anything
  else -> `fire-failed` (`idle-compaction.service.ts:369-396`). Claim release goes through the reducer
  effect. OK.
- `releaseManualReservation` throws: caught in `finally`, warn only (`router:244-259`). OK.

### 5. What is missing that the requirements never mentioned?
- Fail-open construction (S1).
- A log line saying idle compaction is wired and enabled per session (observability for A1/A5 live QA).
- Disposal ownership: the facade disposes a container-owned singleton (Minor m3).

## Failure modes

### FM-1 Idle service construction failure breaks chat (see S1)
- Trigger: any throw inside `new IdleCompactionService(...)` in the factory, for example a host whose
  `IWorkspaceProvider` lacks `onDidChangeConfiguration` (the test mock case).
- Symptom: `SessionLifecycleManager` cannot be resolved; tsyringe rethrows the construction error. The
  activation spec saw `logger.error` and an unrelated activation path fail.
- Evidence: `register.ts:502-546`, `idle-compaction.service.ts:116-131`, `session-lifecycle-manager.ts:420-421`
  (`isOptional` only covers an unregistered token, tsyringe `dependency-container.js:105`),
  `compaction-hook-handler.ts:163-164`.
- Current handling: none (only the missing-port path is degraded, lines 503-512).
- Recommendation: fail open (see S1).

### FM-2 PreCompact before `fire-sent` (F7)
- See section (b) below. Impossible in production ordering, documented by `session-lifecycle-manager.idle.spec.ts:162-242`.

### FM-3 User input races the idle push
- See M1.

### FM-4 Second `system init` after compaction
- Handled: `bind` runs only when `id !== this.sessionId` (`:248`), and the tracker ignores non-request
  frames. Covered by `idle-signals.spec.ts:130`. No finding.

### FM-5 User echo frames counted as input
- Handled: input comes only from the facade, never from tap frames. Echo frames update
  `lastNonRequestFrameAt` only (`idle-request-tracker.ts:46-49`). No finding.

### FM-6 Turn ordering: turn-end then context
- `turnEnded` is emitted before the async read (`:468-474`) and `turnContext` after (`:482-486`) with
  the rekey-aware current id. Input or request-start between them sets `activitySinceTurnEnd`, and
  `noArmReason` rejects it (`reducer:64`). OK.

### FM-7 Rekey ordering at PostCompact
- Handler order: coordinator `onPostCompact` (now also with the fallback id), then `rekeySessionState`
  (idle `rekey`), then `emitCompactionComplete` -> idle `post-compact` under the payload id
  (`compaction-hook-handler.ts:533-557`). The coordinator record and its claim move first; the idle
  alias follows. OK. F5 is satisfied for the hook path.

### FM-8 Reservation window after relaunch
- `admitManualCompact` reserves; `finally` releases after `executeSlashCommand` resolves
  (`router:243-260`). The old record is unregistered by the old tap's release (guarded by `runOwners`,
  `:296`), so the later release returns false harmlessly. OK.

## Blocking issues

None.

## Serious issues

### S1 Idle service construction is not fail-open (answers question (a))
- File: `libs/backend/agent-sdk/src/lib/di/register.ts:502-546`; constructor `idle-compaction.service.ts:87-131`
- Scenario: the factory resolves five required collaborators and subscribes to
  `workspace.onDidChangeConfiguration` inside the constructor. A throw anywhere (non-conformant
  workspace port, a required collaborator failing to resolve, a future host) propagates through
  `SessionLifecycleManager` (resolved by every chat start) and `CompactionHookHandler` (resolved when
  building query options). tsyringe `isOptional` only covers an unregistered token, not a throwing
  factory. A throw after `callbacks.register` or `events.onCompactionComplete` has already run also
  leaves those subscriptions installed on a half-built object, and `instanceCachingFactory` retries
  the factory on each resolve, so each retry adds more.
- Impact: today's three hosts implement the port (CLI `cli-workspace-provider.ts:36`, interface
  `workspace-provider.interface.ts:57`), so production risk is low but not zero. The blast radius is
  all chat, for an optional, off-by-default-style enhancement. The plan itself calls the collaborator
  set optional and "degraded". The test failure is the same defect observed.
- Fix: wrap the factory body in try/catch. On failure, log one warn with a fixed message, dispose any
  partially built instance, and return a no-op signals object (or `undefined`, which both consumers
  treat as "no idle service": the manager parameter defaults to `null`, the hook handler's is `?:`).
  Cache the failure so it does not retry per resolve. Keep the non-throwing tolerance for a missing
  workspace port. Add a spec where `onDidChangeConfiguration` throws and the manager still resolves.
- Decision on the test mock edits (Batches 10, 11, 13 added `onDidChangeConfiguration` to host mocks):
  acceptable as a mock completion, but they should not be the only guard. Reversible.

## Moderate issues

### M1 Idle `/compact` can overtake a just-typed user message
- File: `session-lifecycle-manager.ts:715-719`, `idle-session.reducer.ts:130-136`, `session-stream-pump.service.ts:235-249`
- Scenario: `input` marks activity, but an in-flight `sending` attempt survives; `beforeEnqueue` does not
  re-check activity (recorded Phase 1 as Minor F9, now live). The window is one `await
  createUserMessage` tick, so rare.
- Impact: the user's message executes after a compaction they did not ask for. No data loss.
- Fix: in `beforeEnqueue` veto when `state().activitySinceTurnEnd` is true, or have `input` cancel a
  `sending` attempt. One condition in `idle-compaction.service.ts:336-346`.

### M2 Coalesced manual `/compact` ends without a stream (plan A5, unverified)
- File: `chat-slash-command-router.service.ts:132-141`, `175-184`
- Scenario: user `/compact` while an idle claim is held returns success with no stream. Whether the
  tab settles on the idle turn's own `result` is an open assumption with no evidence in these batches.
- Fix: confirm in the tester's live run; if the tab spins, emit the same CHAT_COMPLETE the native
  `clear` branch emits (lines 98-107).

### M3 A hung or never-ending coalesce depends on Phase 1 timers
- File: same lines. A held claim coalesces every manual `/compact` until released. Release paths are
  PostCompact, turn-end failure and deadlines in the reducer (reviewed approved in Phase 1). Residual
  uncertainty, not a defect: the router has no independent expiry (later item L4).

## Minor issues

- m1 `promptPrefixChanged` is only wired from `setSessionModel` (`session-lifecycle-manager.ts:818-822`).
  Other prefix-changing mutations (effort, thinking, tool-profile, system prompt changes through
  `session-control`) were not audited. Also it fires before the model change succeeds (conservative).
- m2 `bind` of an unaliased id creates a second idle group (see question 3).
- m3 `SessionLifecycleManager.dispose()` disposes a container-owned singleton
  (`session-lifecycle-manager.ts:481`); a recreated manager in the same container gets a disposed service
  (all signals dropped silently, `idle-compaction.service.ts:404`). Single instance per process today.
- m4 `session-query-executor.service.ts` is 1081 raw lines (was 1024 before Batch 9). See (c).

## (b) F7 / later item L3: confirmed impossible in practice, with a caveat

The claim is taken in `beforeEnqueue` and the push happens in the same synchronous run
(`session-stream-pump.service.ts:245-249`) with no `await` after it. `sendMessage` then resolves, and
`fire-sent` is enqueued from a promise reaction (`idle-compaction.service.ts:359-368`) inside the
microtask queue. PreCompact reaches Ptah as a control request from the CLI subprocess after the
message is written to stdin and the CLI processes it; that arrives as pipe I/O, a macrotask, which
cannot run before the microtask queue drains. P1 timing (PreCompact 9 ms after the `result`, 21 s
compaction) is consistent. The facade spec forces the inverse order and records the outcome as a
`claim-timeout` warn (`session-lifecycle-manager.idle.spec.ts:162-242`), not a hang. Keep L3 as a
later item. Caveat: the guarantee rests on "no macrotask yield between push and `fire-sent`"; do not
add an `await` of I/O in `sendIdleCompact` or the sender closure without revisiting it. A one-line
comment at `idle-compaction.service.ts:359` would protect it.

## (c) 700-line max-lines

`eslint.config.mjs:558` sets `max-lines` to `warn` at 700 (blank lines and comments skipped), so it is
a warning, not a gate. The file was already past it before this phase (1024 raw lines). Batch 9 added
57 raw lines. Not a regression of a passing check. Recommend (non-blocking) extracting
`CompactionSessionTap` (about 200 lines, own constructor, no executor state except `runOwners`) into
its own file in a follow-up, instead of adding to the executor. The lifecycle manager (814+) is in the
same state, which the plan acknowledged.

## Data flow (session to idle compaction)

1. First main frame with `session_id` -> `bind` -> `sessionBound(id, runToken, codexProxy)`. OK (only on id change).
2. Each main frame -> tracker -> `requestStarted` on a new request key; `rate_limit_event` -> `rateLimit`. OK.
3. `result` -> `turnEnded(id, turnId, snapshot)`, then async read -> `turnContext(currentId, turnId, tokens|null)`. OK; no emission when the port is absent or the read rejects (arms nothing).
4. Arm -> timer (unref'd scheduler, `register.ts:541`) -> `attempt-due` -> `fire` gate -> `sendIdleCompact`. OK.
5. Facade -> pump `require-idle` -> `assertAdmissible`, `beforeEnqueue` (claim, veto), `markActive`, push, with no await between. OK.
6. PreCompact via `CompactionCallbackRegistry.notifyAll` -> `pre-compact`; PostCompact -> coordinator rebind, idle rekey, `post-compact`; `compact_boundary` from the tap -> `compactBoundary`. OK for both orders (P1 order PostCompact first).
7. `result` of the compaction turn -> `turnEnded` on a closed period -> no re-arm. OK.
8. Manual `/compact`: fast `requestManualCompact` -> provider resolve -> `admitManualCompact` -> `executeSlashCommand` (no await between) -> `finally` release. OK; fail-open on coordinator throw.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Session tap producers (8a) | COMPLETE | None found |
| Pump `beforeEnqueue` veto (8b) | COMPLETE | None |
| Facade wiring, input, model change, dispose (8c) | COMPLETE | Prefix changes other than model not signalled (m1) |
| Hook handler rekey target and fallback id (8d) | COMPLETE | None |
| DI registration, lazy sender, unref scheduler, degraded path (9) | PARTIAL | Constructor failure not fail-open (S1) |
| Manual admission (11) | COMPLETE | A5 unverified live (M2) |
| Smoke on the three hosts | COMPLETE | Mock edits only; no fail-open spec |

Implicit requirements not addressed: fail-open construction; a live check that a coalesced manual
`/compact` settles the tab.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Second `init` after compaction | YES | `bind` only on id change | None |
| User echo frames | YES | Not input | None |
| Subagent frames | YES | Filtered before tracker | None |
| Port missing / read rejects | YES | No arm | Silent |
| Rekey at PostCompact, payload id absent | YES | Fallback id to coordinator | Idle rekey needs both ids (unchanged) |
| Manual `/compact` during router awaits | YES | Authoritative admit, no await to send | None |
| Admission throws | YES | Warn, send | None |
| Idle service construct throws | NO | Propagates | S1 |
| User input in the send window | PARTIAL | Pump `busy` check only | M1 |
| Host without workspace port | YES | Degraded | Non-conformant port not covered |

## Verdict

- Recommendation: REVISE (small fix)
- Confidence: HIGH on the traced path and F7, MEDIUM on A5 (no live evidence)
- Top risk: a construction failure of an optional idle service can take down session lifecycle resolution.
- What a robust implementation would add: try/catch fail-open factory with a spec; an activity re-check in
  `beforeEnqueue`; a live QA check of the coalesce path; extraction of `CompactionSessionTap`; a comment
  guarding the no-macrotask assumption at the send site.
