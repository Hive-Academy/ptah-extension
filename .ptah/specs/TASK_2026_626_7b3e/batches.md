# Batches - TASK_2026_626_7b3e

Total tasks: 20 | Batches: 9 | Complete: 9/9

Worktree root (all relative paths below resolve against it):
`D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb`

Plan: `implementation-plan.md` revision 3 (APPROVED, `implementation-plan-review.md` round 3).
Plan section map: C1 `:250-327`, C2 `:329-475`, C3 `:477-631`, C4 `:633-720`, C5 `:722-766`,
C6 `:768-795`, C7 `:797-871`, C8 `:873-961`, C9 `:963-981`, handoff/contracts `:1084-1192`.

## Execution defaults (recorded)

- Ordering taken from the plan handoff (`implementation-plan.md:1084-1150`): Batch 1 (shared contract)
  first. After Batch 1 commits, two file-disjoint tracks may run in parallel:
  - Backend track: Batch 2 -> 3 -> 4 -> 5 (strictly sequential; each depends on the previous).
  - Frontend track: Batch 6 -> 7, and Batch 8 (independent of 6/7, depends only on Batch 1).
- Memory rule (root `CLAUDE.md`): tracks may implement in parallel, but only ONE heavy check
  (jest / typecheck / lint) may run at a time across all executors. Executors must serialise
  their verification runs; the team-leader re-runs each batch's checks before commit.
- Each batch is committed separately by the team-leader; executors never run git.
- Deviation from the plan's file grouping: the `IAgentAdapter.setLiveStatsCallback` member is
  added in Batch 4 (together with its only implementor `SdkAgentAdapter`), not in Batch 1, so no
  commit leaves `@ptah-extension/agent-sdk` failing typecheck (`sdk-agent-adapter.ts:120`
  `implements IAgentAdapter`). Batch 1 still adds `SessionStatsLivePayload` and
  `LiveStatsCallback` to `agent-adapter.types.ts`. Same file, sequential batches, no conflict.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Every MODIFY file exists on disk; every CREATE file is absent — verified (shell existence check
  on all 29 paths; `session-stats-summary.component.html` exists, so Batch 8 may touch it).
- Nx project names are `@ptah-extension/{shared,agent-sdk,cli-agent-runtime,chat-state,chat,chat-ui}`
  — verified from each `project.json`.
- `SdkAgentAdapter` is the only class implementing `IAgentAdapter`; other uses are typed
  references or `as unknown as IAgentAdapter` mocks (`peer-session-messenger.service.spec.ts:47-52`)
  — verified by grep; Batch 4 re-runs agent-sdk typecheck to confirm.
- The `sdk-callbacks.spec.ts` harness adapter mock must gain `setLiveStatsCallback`, otherwise
  `wireSdkCallbacks`' try block aborts the wiring after it (`sdk-callbacks.ts:91-128`) —
  unverified until Batch 5; Task 5.2 checks it.
- Host-source registry baseline needs no change (decisions.md D8) — verified in Task 1.3 by
  running `host-source-registry.contract.spec.ts` unchanged.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Live estimate arrives after the authoritative snapshot and overwrites final figures/context | HIGH | Strictly greater authoritative revision (Task 2.1); settle on every exit (Tasks 3.1, 2.2); parser strips context from non-provisional (Task 1.2); tab-manager context gate (Task 6.2); both arrival orders tested (Task 7.3) |
| Stop releases the owner before stream disposal and strands an estimate | HIGH | `release` settles through watchers (Task 2.1); one settle per shown estimate either order (Task 2.2); interrupt integration test (Task 4.2) |
| Live path triggers result-path side effects (footer, pendingStats, queued send, loadSessions, budget) | HIGH | Not wrapped by `wrapResultStatsForActivity` (Task 4.2); aggregator spies (Task 7.3) |
| Adding a required `IAgentAdapter` member breaks agent-sdk typecheck mid-run | MEDIUM | Member moved to Batch 4 with its implementor (see Execution defaults) |
| Throttle timer leaks after stream end / dispose | MEDIUM | Publisher dispose detaches watchers and clears timer; fake-clock spec (Task 2.2) |
| Throwing watcher breaks `release` / `recordAgent` | MEDIUM | try/catch per watcher; spec case (Task 2.1) |
| Parallel tracks exhaust RAM | MEDIUM | One heavy check at a time across executors (Execution defaults) |
| Header marker is a rendered UI change; typecheck/test is not proof | LOW | Before/after dark+light screenshots required at Mode 3 (Batch 8 note) |

Edge cases:

- `task_started` read before the SubagentStart hook records the agent — handled by the owner
  agent-watcher (Task 2.1) and publisher non-synchronous flush (Task 2.2).
- `bindRefused` / owner still under the tab key — publisher stays silent (Task 2.2, Task 3.1).
- `startNew` replacement and `clearAll` notify no watcher — Task 2.1.
- Release notification after publisher dispose emits nothing — Task 2.2.
- Live payload for an unknown session during teardown — dropped silently (Task 7.3).
- Model mismatch / no prior `liveModelStats` / `contextTokens: 0` — snapshot installed, fill
  unchanged (Task 6.2).
- Malformed payload — parser returns `null`, one `console.warn` naming only the session (Tasks 1.2, 7.1).
- Background-subagent spend after a result is not hidden (no status gating) — revision floor only (Tasks 6.1, 7.3).

## Phases and reviews

- Phase BACKEND: Batches 1-5. Review: code-logic + style (new public API: `MESSAGE_TYPES.SESSION_STATS_LIVE`,
  `SessionStatsLivePayload`, `IAgentAdapter.setLiveStatsCallback`, `parseSessionStatsLivePayload`).
- Phase FRONTEND: Batches 6-8. Review: code-logic + style (new public `TabManagerService.installLiveSessionStats`,
  `ChatStore.handleSessionStatsLive`) + visual (rendered header marker).
- Because tracks interleave, each phase review is scoped to the listed commit SHAs of its
  batches, not a contiguous range.

## Batch 1: Shared contract — COMPLETE (commit 9f9a3f04f)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x1 with the batch section as a self-contained prompt
- Execution mode: sequential
- Rationale: one lib, contract consumed by both tracks; the parser rules are precise and coupled to the type.
- Tasks: 3 | Depends on: none
- Phase: BACKEND | Phase review: code-logic + style (at end of Batch 5)

### Task 1.1: Message type, snapshot flag, live payload types — COMPLETE

- Files: MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`,
  `libs/shared/src/lib/types/rpc/rpc-session.types.ts`, `libs/shared/src/lib/types/agent-adapter.types.ts`
- Plan reference: implementation-plan.md:250-327 (C1)
- Pattern to follow: `SESSION_STATS` entry (`message-constants.ts:133`); `ResultStatsPayload` (`agent-adapter.types.ts:46-90`)
- Implementation details: add `SESSION_STATS_LIVE: 'session:stats-live'` right after `SESSION_STATS` with doc
  comment (provisional, throttled, never a completion signal); add `readonly provisional?: boolean` to
  `SessionStatsEntry` with the plan's doc text; add `SessionStatsLivePayload` and `LiveStatsCallback` exactly as
  plan `:263-282`. Do NOT add `setLiveStatsCallback` to `IAgentAdapter` here (Batch 4).
- Acceptance: types compile; `host-source-registry.baseline.ts` untouched.

### Task 1.2: Live payload parser — COMPLETE

- Files: CREATE `libs/shared/src/lib/types/messages/session-stats-live.ts`; MODIFY `libs/shared/src/lib/types/messages/index.ts`
- Depends on: Task 1.1
- Pattern to follow: `parseSessionMcpStatus…` in `libs/shared/src/lib/types/messages/session-mcp-status.ts:103-115` (hand-written, no Zod)
- Implementation details: `parseSessionStatsLivePayload(payload: unknown): SessionStatsLiveWire | null`, wire type
  with `sessionId: string`. Rejects: empty/non-string `sessionId`; non-plain-object `sessionStats`; `provisional`
  other than `true`/absent; missing or non-finite `revision`. `context` kept only if valid (non-empty `model`,
  finite non-negative `contextTokens`) AND `sessionStats.provisional === true`; otherwise dropped (no `context`
  key) while the payload is kept. Export via `export * from './session-stats-live'` in `messages/index.ts`.
- Validation notes: context strip on authoritative payloads is risk-row 1 mitigation; must not be skipped.

### Task 1.3: Parser spec — COMPLETE

- Files: CREATE `libs/shared/src/lib/types/messages/session-stats-live.spec.ts`
- Depends on: Task 1.2
- Acceptance (accept/reject table): `provisional: true` accepted; absent accepted; `false`/`'yes'` rejected;
  missing / `NaN` / `Infinity` revision rejected; bad `context` dropped alone; valid `context` on a
  non-provisional snapshot dropped with payload accepted; empty `sessionId` rejected; non-object payload rejected.

### Batch 1 verification

- Files exist with real implementations; no TODO/stub.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/shared --parallel=1` then `npx nx lint @ptah-extension/shared --parallel=1` (one at a time, output tailed)
- `git diff --name-only` must not list `host-source-registry.baseline.ts`.

## Batch 2: Owner provisional state + live publisher (agent-sdk) — COMPLETE (commit 46ba9ed65)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: none parallel — same sub-agent re-run; the revision invariant needs one mind
- Execution mode: sequential
- Rationale: the owner's revision/watcher/release semantics and the publisher's throttle/settle lifecycle are tightly coupled.
- Tasks: 2 | Depends on: Batch 1
- Phase: BACKEND | Phase review: code-logic + style (at end of Batch 5)

### Task 2.1: SessionStatsOwnerService provisional run, live snapshot, watchers, release settle — COMPLETE

- Files: MODIFY `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`,
  `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts`
- Plan reference: implementation-plan.md:329-475 (C2), contracts `:1158-1175`
- Pattern to follow: existing `replaceRun` / `markRunIncomplete` / `release(lease)` (`:580-596`), revision touch (`:647-650`), `rebind` (`:446-453`)
- Acceptance: `snapshot()` never contains an estimate; live snapshot carries `provisional: true` only while an
  estimate exists; any authoritative snapshot after a live estimate has a strictly greater revision; `recordAgent`
  notifies watchers after its mutation (return value unchanged) and never flushes synchronously; `release` keeps
  signature, boolean result and lease rule, settles (clears provisional, advances revision, passes the
  authoritative snapshot to watchers) only on the generation/epoch it actually deletes, and notifies nobody on its
  `false` branches, on `startNew` replacement or on `clearAll`; a throwing watcher never breaks `release` or
  `recordAgent`; watchers follow `rebind`. Spec cases include "startNew over an existing key calls no watcher".

### Task 2.2: LiveSessionStatsPublisher — COMPLETE

- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts`
- Depends on: Task 2.1
- Plan reference: implementation-plan.md:477-631 (C3)
- Acceptance: throttled publish with injected clock; silent until `setSessionKey` finds a current owner state;
  `context` attached only to provisional snapshots; a shared authoritative emitter (result settle, release
  settle, dispose) omits context and clears the shown-estimate flag, so exactly one authoritative payload per
  shown estimate whichever of release/dispose runs first; dispose clears the timer and detaches watchers;
  "release notification after dispose emits nothing"; callback absent -> inert. Spec uses a fake clock.

### Batch 2 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; `npx nx lint @ptah-extension/agent-sdk --parallel=1` (sequentially)
- Result (team-leader run): jest 2 suites / 122 tests passed; typecheck passed; lint 0 errors (52 pre-existing
  warnings, none in Batch 2 files). Report: `batch-2-report.md`.

### Batch 2 accepted deviations (judged against implementation-plan.md rev 3)

1. Flush skips a snapshot with the same revision and kind as the last emitted one
   (`live-session-stats-publisher.ts:410-416`). ACCEPTED: the skip lives only in `flush()`;
   `emitAuthoritative` (`:271-279`) never consults it, so the settle payload is never suppressed. Settle
   revision is strictly higher: `onResult`/`settle`/`dispose` call `clearProvisional`, which touches when the
   run holds an estimate (`session-stats-owner.service.ts:635-645`); release clears and touches before
   `publish` (`:703-712`). `recordAgent` touches before notifying (`:589-591`), so the agent-count flush
   always carries a new revision and is not skipped. It also enforces plan C3 "no third payload" (`:622`).
2. `settle()`/`dispose()` re-clear the estimate before `publishLive(null)`. ACCEPTED: idempotent (no touch
   when already cleared); matches plan `:563-565`.
3. A concurrent run of the same owner still holding an estimate makes the settle payload that run's
   provisional build (no `context`). ACCEPTED: direct consequence of the plan's `publishLive(null)` rule
   (`:547-549`); the other stream settles its own estimate. Flag for the BACKEND phase code-logic review.
4. Frames seen before `setSessionKey` are kept and flushed on bind. ACCEPTED: nothing is published before
   bind (plan `:596`).
5. `setSessionKey(sessionId: SessionId)`. ACCEPTED: Batch 3 passes `realSessionId as SessionId` (existing
   `stream-transformer.ts:575` pattern).
6. Options object with `Pick<...>` dependency types. ACCEPTED: style-only.

## Batch 3: StreamTransformer wiring (agent-sdk) — COMPLETE (commit f24f363aa)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: same sub-agent re-run
- Execution mode: sequential
- Rationale: one large hot-path file; the try/finally settle around the result branch needs care.
- Tasks: 1 | Depends on: Batch 2
- Phase: BACKEND | Phase review: code-logic + style (at end of Batch 5)

### Task 3.1: Accumulate, flush on task_started, settle at result and dispose — COMPLETE

- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`;
  CREATE `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`
- Plan reference: implementation-plan.md:633-720 (C4); decisions D6, D7
- Pattern to follow: existing result branch and stream disposal seam (`stream-transformer.ts:1030-1043`); sibling spec `stream-transformer.plan-limits.spec.ts`
- Acceptance: optional `onLiveStats` in the transform config; accumulate from `assistant` frames deduped per
  `message.id` (not `stream_event`); `task_started` triggers a (non-synchronous) flush; `setSessionKey` after
  `onSessionIdResolved`; `onResultStats` called on exactly the same branches as today; settle delivered on every
  result exit and at stream end after a shown estimate; release-before-dispose integration case; no behaviour
  change when `onLiveStats` is absent.

### Batch 3 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts libs/backend/agent-sdk/src/lib/helpers/stream-transformer.plan-limits.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; `npx nx lint @ptah-extension/agent-sdk --parallel=1`
- Result (team-leader run, serial): jest 4 suites / 157 tests passed (the three live-stats, stream-transformer
  and plan-limits specs plus live-session-stats-publisher.spec.ts), which settles the report's three unrun
  expectations (`agent-a1` counted once, `rejected-invalid` returns a snapshot, fake-timer `unref()`);
  typecheck passed; lint 0 errors, 52 warnings (unchanged from the Batch 2 baseline). Report: `batch-3-report.md`.
- `git diff -w` check: `onResultStats` call site and its conditions unchanged (only the try/finally wrap and two
  prettier re-wraps); `onResult()` directly after `onTurnEnd?.()` with no await before it; `settle()` in the
  branch `finally`; `dispose()` in the stream `finally` after `activityWatchdog?.stop()` and before
  `onStreamEnd`; the publisher constructor has no side effects and is inert without `onLiveStats`.

## Batch 4: Adapter port + callback registry (shared + agent-sdk) — COMPLETE (commit c28c150e7)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: same sub-agent re-run
- Execution mode: sequential
- Rationale: port member and its single implementor must land in one commit to keep typecheck green.
- Tasks: 2 | Depends on: Batch 3
- Phase: BACKEND | Phase review: code-logic + style (at end of Batch 5)

### Task 4.1: `IAgentAdapter.setLiveStatsCallback` + registry — COMPLETE

- Files: MODIFY `libs/shared/src/lib/types/agent-adapter.types.ts` (add `setLiveStatsCallback(cb: LiveStatsCallback): void`
  next to `setResultStatsCallback`, `:334`), `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts`
- Plan reference: implementation-plan.md:722-766 (C5), C1 `:282-283`
- Acceptance: registry `liveStats` field, `setLiveStats`, `getLiveStats`, cleared in `clear()`; spec covers set/get/clear.

### Task 4.2: SdkAgentAdapter threads the callback — COMPLETE

- Files: MODIFY `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- Depends on: Task 4.1
- Pattern to follow: `setResultStatsCallback` (`sdk-agent-adapter.ts:1431-1433`); Stop test "releases the owner when init binds the canonical id while the interrupt awaits" (spec `:1974-1996`)
- Acceptance: `setLiveStatsCallback` implemented; `onLiveStats: this.callbacks.getLiveStats()` passed at all four
  `streamTransformer.transform` call sites (`:901`, `:1058`, `:1205`, `:1556`); NOT wrapped by
  `wrapResultStatsForActivity` — invoking it never calls the budget `observe`; new `interruptSession` integration
  case with the real owner proves an open estimate settles on Stop; no Stop-specific production code.

### Batch 4 verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-callback-registry.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/shared --parallel=1`; `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`; `npx nx lint @ptah-extension/agent-sdk --parallel=1` (sequentially)

### Batch 4 verification record (team-leader)

- On disk: `onLiveStats: this.callbacks.getLiveStats()` passed raw at all four transform sites
  (`sdk-agent-adapter.ts:916`, `:1075`, `:1222`, `:1583`). It is never routed through
  `wrapResultStatsForActivity`. The registry has `liveStats`, `setLiveStats`, `getLiveStats` and clears it in `clear()`.
  The port member sits next to `setResultStatsCallback`.
- Re-run serially:
  - jest (2 suites): 120/120 passed.
  - typecheck shared: OK.
  - typecheck agent-sdk: OK.
  - lint agent-sdk: 0 errors, 52 warnings (baseline).
  - lint shared: 0 errors, 5 warnings.
- Carried to Batch 5: the `sdk-callbacks.spec.ts` adapter mocks lack `setLiveStatsCallback`, so Task 5.2 must add it.

## Batch 5: Host broadcast wiring (cli-agent-runtime) — COMPLETE

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x1
- Execution mode: sequential
- Rationale: two files, one lib; small and self-contained once the port member exists.
- Tasks: 2 | Depends on: Batch 4
- Phase: BACKEND (last batch) | Phase review: code-logic + style due after this commit

### Task 5.1: `wireLiveStatsCallback` — COMPLETE

- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`
- Plan reference: implementation-plan.md:768-795 (C6)
- Acceptance: called from `wireSdkCallbacks` right after `wireResultStatsCallback` (`:97`); broadcasts
  `MESSAGE_TYPES.SESSION_STATS_LIVE` fire-and-forget with `.catch` logging at `debug` (session id + error name
  only); no `retryWithBackoff`; no per-publish info log; summary log line (`:118-122`) mentions live stats.

### Task 5.2: Spec — COMPLETE

- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`
- Depends on: Task 5.1
- Acceptance: harness adapter mock gains `setLiveStatsCallback` (all existing cases stay green); captured callback
  broadcasts `'session:stats-live'` once with the payload unchanged; a rejecting broadcast is not retried and does not throw.

### Batch 5 verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`; `npx nx lint @ptah-extension/cli-agent-runtime --parallel=1`

### Batch 5 verification record (team-leader)

- On disk: `wireLiveStatsCallback` (`sdk-callbacks.ts:162`) is called at `:99`, directly after
  `wireResultStatsCallback`. It broadcasts `MESSAGE_TYPES.SESSION_STATS_LIVE` with the payload unchanged. The
  `.catch` logs at `debug` only, with the session id and `errorName`. It has no `retryWithBackoff` and no
  per-publish `info`. The summary log line mentions live stats. A synchronous throw is caught by
  `LiveSessionStatsPublisher.emit` (try/catch plus thenable handling).
- All five adapter mocks in the spec gain `setLiveStatsCallback`. The two new cases cover exactly-once delivery
  with the same payload, and a rejection that is neither retried nor thrown.
- Host forwarding: the only call site is `register-rpc-surface.ts:244`, which serves all three hosts. The
  VS Code, Electron and CLI `broadcastMessage` paths are async and have no type allowlist.
- Re-run serially (temporary node_modules junction, removed afterwards):
  - jest: 17/17 passed.
  - typecheck cli-agent-runtime: OK.
  - lint cli-agent-runtime: 0 errors, 45 warnings (baseline; none in the changed files).

## Batch 6: Snapshot validator + admitted live install (chat-state) — COMPLETE (commit 74fa44175)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: same sub-agent re-run
- Execution mode: sequential (may run in parallel with the backend track and with Batch 8)
- Rationale: admission and context gate are coupled in one method; one lib.
- Tasks: 2 | Depends on: Batch 1
- Phase: FRONTEND | Phase review: code-logic + style + visual (after Batch 7 and Batch 8 both commit)

### Task 6.1: `isValidSessionStatsSnapshot` accepts `provisional` — COMPLETE

- Files: MODIFY `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts`; CREATE `libs/frontend/chat-state/src/lib/session-stats-snapshot.spec.ts`
- Plan reference: implementation-plan.md:797-871 (C7)
- Acceptance: `provisional` accepted only as `undefined` or boolean; spec: `true` accepted, `'yes'` rejected, floor
  admits live r, then after authoritative r+1 rejects a later live r-1.

### Task 6.2: `TabManagerService.installLiveSessionStats` — COMPLETE

- Files: MODIFY `libs/frontend/chat-state/src/lib/tab-manager.service.ts`, `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`,
  `libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`
- Depends on: Task 6.1
- Pattern to follow: `installSessionStats` (`:2252-2262`), `acceptSessionStats` (`:2348-2372`), `postCompactionContextStats` (`:2159-2196`)
- Acceptance: returns `false` and writes nothing when not admitted; one `updateTabInternal` with snapshot +
  `budgetPatch(snapshot, undefined)` + (only if `snapshot.provisional === true`, a matching `normalizeModelKey`
  model and a non-null `postCompactionContextStats`) `liveModelStats`; `installSessionStats` unchanged;
  `surface-session-stats.registry.ts` NOT modified. Spec cases per plan `:845-861` incl. out-of-order r10/r8 with
  context, equal-revision authoritative with stray context leaves fill at 40 000, budget preserved; registry spec
  case `record(r10, live L)` then `record(r8, live null)` keeps r10 and L.

### Batch 6 verification

- `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/session-stats-snapshot.spec.ts libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/chat-state --parallel=1`; `npx nx lint @ptah-extension/chat-state --parallel=1`

## Batch 7: Routing and aggregation (chat) — COMPLETE (commit 820e89eda)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: same sub-agent re-run
- Execution mode: sequential
- Rationale: handler -> store facade -> aggregator is one call chain; the "must NOT call" spies span the chain.
- Tasks: 3 | Depends on: Batch 6
- Phase: FRONTEND | Phase review: code-logic + style + visual (after Batch 7 and Batch 8 both commit)

### Task 7.1: ChatMessageHandler route — COMPLETE

- Files: MODIFY `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`, `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`
- Plan reference: implementation-plan.md:873-961 (C8)
- Acceptance: `SESSION_STATS_LIVE` in `handledMessageTypes` (`:138-162`) and `handleMessage` (`:164-236`);
  `handleSessionStatsLive` parses with `parseSessionStatsLivePayload`, warns once (session only) and drops on
  `null`; header comment list updated; `SESSION_STATS` handling unchanged.

### Task 7.2: ChatStore facade — COMPLETE

- Files: MODIFY `libs/frontend/chat/src/lib/services/chat.store.ts`
- Pattern to follow: facade `chat.store.ts:532-534`
- Acceptance: `handleSessionStatsLive` delegates to the aggregator only.

### Task 7.3: `SessionStatsAggregatorService.handleLiveSessionStats` — COMPLETE

- Files: MODIFY `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`
- Depends on: Tasks 7.1, 7.2
- Acceptance: tab resolution as `handleSessionStats` (`:126-141`, cross-workspace included); `snapshotFor`
  validation; no tabs -> `surfaceStats.record(sessionId, { live: null, snapshot })` only when the router knows the
  session; tabs -> `tabManager.installLiveSessionStats(tab.id, snapshot, event.context)`. Never calls
  `streamingHandler.handleSessionStats`, `loadSessions`, `sendQueuedMessage`, `clearCompactionState`,
  `handoverClient.record`, `setLiveModelStats` (spied for provisional and authoritative payloads, streaming and
  finalized-with-queue tabs). Spec cases per plan `:921-956`: out-of-order r10/r8, settle r5->r6, later
  `session:stats` replaces live, both arrival orders at r6 (fill 60 000), stray context after `session:stats`
  keeps 60 000, open-tab Stop marker clears.

### Batch 7 verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/chat --parallel=1`; `npx nx lint @ptah-extension/chat --parallel=1`

### Batch 7 verification record (team-leader)

- Jest (2 suites): 105/105 passed. The worktree has no `node_modules`, so `jest.preset.js`'s `<root>/node_modules/marked`
  mapper fails for any suite that reaches `@ptah-extension/chat-ui` (pre-existing `CostBadgeComponent` import); a
  temporary gitignored junction to the main checkout's `node_modules` was used for the run and removed afterwards.
- `nx typecheck @ptah-extension/chat`: passed (lib tsconfig). `nx lint @ptah-extension/chat`: 0 errors, 35 warnings.
- Spec-tsconfig errors at aggregator spec :149/:176/:291/:501 (TurnModelUsage / TabId literals) sit in base lines
  untouched by this batch (the spec diff is pure additions: header, imports, a new describe from :1114); they
  pre-exist on 69a2b835e, are outside the typecheck target and do not fail jest.
- Addition beyond plan, accepted: `handleLiveSessionStats` uses `SessionId.safeParse` and drops a non-UUID live
  session id with one warning instead of throwing via `SessionId.from`. A throttled advisory event must not throw
  out of `handleMessage`; the authoritative `session:stats` path keeps its throwing `SessionId.from`. Also accepted:
  `tabsForSession` extraction shared by both handlers, and `snapshotFor` handler label (existing warning strings
  byte-identical).

## Batch 8: Header estimate marker (chat-ui) — COMPLETE (commit 6ea2de360)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: CLI lane x1
- Execution mode: sequential (may run in parallel with Batches 2-7 after Batch 1 commits)
- Rationale: one component, depends only on the shared `provisional` field.
- Tasks: 1 | Depends on: Batch 1
- Phase: FRONTEND | Phase review: code-logic + style + visual (after Batch 7 and Batch 8 both commit)

### Task 8.1: `~` marker and tooltip line — COMPLETE

- Files: MODIFY `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`,
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html` (only if the chips live there),
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts`
- Plan reference: implementation-plan.md:963-981 (C9)
- Acceptance: `isEstimate = computed(() => snapshot()?.provisional === true)`; cost and tokens chips show a leading
  `~` and `costTooltip`/`tokenTooltip` (`:279-305`) gain "Live estimate while the turn runs; final figures replace
  it when it ends." only when true; nothing changes when false; OnPush kept; no animation; spec covers both states.
- Validation notes: rendered UI change — Mode 3 requires before/after screenshots (dark + light) of the session
  header, "before" from the base commit `69a2b835e`.

### Batch 8 verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts --coverage=false --maxWorkers=2`
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`; `npx nx lint @ptah-extension/chat-ui --parallel=1`

## Batch 9: FRONTEND phase fix round (chat-state, chat, chat-ui) — COMPLETE (commit b44707139)

- Recommended executor: frontend-developer (sub-agent)
- Execution mode: sequential
- Tasks: 4 | Depends on: Batches 6-8
- Phase: FRONTEND | Phase review: the single re-review, scoped to this fix commit (code-logic + style)
- Inputs: `code-logic-review-frontend.md` (NEEDS_FIXES 7/10), `code-style-review-frontend.md` (NEEDS_FIXES 7/10);
  orchestrator ruling: fix logic #1 and style #1, #2, #4, #7; defer style #3, #5, #6. Report: `frontend-fix-report.md`.

### Task 9.1: Fan session stats out to every bound tab across workspaces (logic #1) — COMPLETE

- `TabManagerService.findBackgroundTabsBySessionId` (`tab-manager.service.ts:617`); aggregator `tabsForSession`
  unions active + background tabs, deduplicated by id (`session-stats-aggregator.service.ts:255-265`). Each tab
  runs its own `acceptSessionStats` admission through `installSessionStats`. Applies to both the live and the
  authoritative path.

### Task 9.2: Extract context-fill helpers to `live-context-stats.ts` (style #1) — COMPLETE

- `contextFillStats` (moved unchanged from private `postCompactionContextStats`) and `liveContextStats`, with spec.

### Task 9.3: Single install path + shared context type (style #2, #4) — COMPLETE

- `installLiveSessionStats` removed (no remaining references in `libs/` or `apps/`). `installSessionStats(tabId,
  snapshot, budget?, context?)` returns `boolean`; with three arguments it writes exactly the prior patch
  (`sessionStats` + `budgetPatch`), because the context patch requires `provisional === true && context`.
  Context typed `SessionStatsLiveContext`.

### Task 9.4: sr-only text `estimated ` (style #7) — COMPLETE

### Batch 9 verification record (team-leader)

- Jest (serial, `--maxWorkers=2`): chat-state `tab-manager.service.spec.ts` + `live-context-stats.spec.ts` 60/60;
  chat `session-stats-aggregator.service.spec.ts` 60/60; chat-ui `session-stats-summary.component.spec.ts` 37/37.
- `nx typecheck` chat-state, chat, chat-ui: pass. `nx lint` chat-state, chat, chat-ui: 0 errors (warnings only).
- Recorded, not fixed: branded `TabId` type errors in `session-stats-aggregator.service.spec.ts:290,324,325`
  (`makeTab({ id: 'bg-tab' })`). Visible only to the spec tsconfig (project has 252 such spec-only errors);
  Jest passes; lib typecheck excludes specs. Cheap fix later: `id: 'bg-tab' as TabId`. (Fixed; see FRONTEND phase
  review below.)
- A temporary `node_modules` junction was used for the checks and removed afterwards.

### FRONTEND phase review — CLOSED

- Fix-commit re-review: `frontend-fix-rereview.md` (codex), NEEDS_FIXES at 7/10.
  - All prior logic and style findings are resolved.
  - The only new finding was the Minor branded `TabId` errors in the new spec fixtures.
- Bounded correction, committed as a `test(chat)` commit:
  - `type TabId` is imported from `@ptah-extension/shared`.
  - `as TabId` is applied at the three `makeTab` ids (`session-stats-aggregator.service.spec.ts:292`, `:326`, `:327`).
- Team-leader verification:
  - `tsc --noEmit -p libs/frontend/chat/tsconfig.spec.json` reports no errors in the new tests. Errors remain at
    `:150`, `:177` and `:519`, and they all predate the branch: they come from `4b14db5f8` and an earlier commit,
    which are ancestors of merge-base `69a2b835e`.
  - Jest on the spec passes 60/60.
  - ESLint on the file is clean.
- Phase FRONTEND (Batches 6-9) is accepted. Visual review of the rendered header marker is still due at completion
  (Mode 3).

### Deferred to later work (orchestrator ruling; none can break a lane config or lose data)

- Style #3: the estimate-marker markup is repeated in `session-stats-summary.component.html`; extract once.
- Style #5: `snapshotFor` takes a handler-name parameter only for logging; simplify.
- Style #6: double warning and a raw session id in a log line in the aggregator.
- Not checked: whether `StreamingHandlerService.handleSessionStats` (chat-streaming) fans out to several
  background tabs (outside this task's file scope).

## Common verification rules (every batch)

- Every listed artifact exists with real code; reject TODO / PLACEHOLDER / STUB markers, empty bodies, mock data standing in for logic.
- Only the batch's scoped commands above; never `run-many`, never build/serve/e2e/package; one heavy check at a time; output tailed.
- No per-batch review; the phase review covers the batch's commit.
- Explicitly untouched (plan `:1124-1128`): `host-source-registry.baseline.ts`, `apps/ptah-tui/**`, host transports,
  `subagent-hook-handler.ts`, `surface-session-stats.registry.ts`, `libs/frontend/chat-streaming/**`.
