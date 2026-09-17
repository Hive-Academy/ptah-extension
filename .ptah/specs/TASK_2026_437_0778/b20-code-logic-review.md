# Code Logic Review — `TASK_2026_437_0778` Batch 20 (Phase 4, C15)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 4              |
| Failure modes found | 5              |

Scope reviewed: `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (+ new spec),
`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ its resume-activate
spec and `chat-rpc.handlers.spec.ts`), `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
(+ spec), the two comment-only diffs in `jsonl-reader.service.ts` and
`message-transform-helpers.ts`, `artifact-parity.spec.ts`, `libs/frontend/chat/.../session-loader.service.ts`
(+ both its specs), and the e2e mock rewrite in `compaction-duplicate-session.spec.ts` (read only,
not executed). `task-370-concurrent-session-isolation.spec.ts` was read for `chat:resume` usage —
it does not reference `messages` and needed no change. `TabManagerService.applyResumedHistory`
(chat-state, Batch 19 territory) was read only to confirm the dead-code claim in the batch note.

## Five logic questions

### 1. How does this fail silently?

- `SessionLoadResult.messages` (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:98-101`) is
  typed `messages: []` and its own doc comment says "Actual conversation messages ... come from
  chat:resume RPC call." That source is now gone (`ChatResumeResult.messages` deleted). The CLI's
  `ptah session load <id>` (`apps/ptah-cli/src/cli/commands/session.ts:899-910`) still emits
  `session.history { messages: result?.messages ?? [] }` — always `[]` now, silently, with a
  success exit code and no error. A CLI/TUI caller reading transcript text back from `session load`
  gets an empty array and no signal that the field is permanently empty; nothing marks the field
  deprecated or routes the caller to `events`. See Serious-1 below.
- `apps/ptah-cli/src/cli/commands/session.ts:432-436` — `resume <id>` (no `--task`) calls
  `chat:resume` and discards the whole result, never reading `.events` either. This is pre-existing
  (not introduced here), but it means the CLI has **no** path today that turns the new `events`
  transcript into readable text; the deletion of `.messages` closes the only field a future CLI
  reader could have used without also being taught to interpret `FlatStreamEventUnion`.

### 2. What user action produces unexpected behaviour?

- Opening the same session in a second tile while a first resume is still chunked-replaying
  (`session-loader.service.ts:906-943`) is the intended contended path, and claim supersession is
  correctly scoped per-`tabId` (`replayClaims: Map<tabId, number>` at the field, `claimReplay`/
  `isReplayClaimCurrent`/`releaseReplayClaim` at :867-891). No defect found there.
- Resuming a session with `activate: true` (resume-and-retry) while its history exceeds 250 events:
  the backend starts (or joins) a **live** SDK query as part of the same `chat:resume` call
  (`chat-session.service.ts:947-980`, `autoResumeIfInactive`) before the RPC even returns, and the
  live stream can begin pushing new-turn `message_start`/`text_delta` events to the same `tabId`
  immediately. On the renderer, `switchSession` starts its chunked `replayHistoryEvents` only
  _after_ the RPC resolves (:810-820), and each chunk yields a real macrotask
  (`yieldToMacrotask`, :73-82) with nothing between chunks that defers, queues, or fences off a
  concurrent live event addressed to the same tab. `processStreamEvent` (`streaming-handler.service.ts:176-293`)
  has no `isReplay`-aware queue — it dispatches immediately regardless of whether another caller is
  mid-chunk-loop on the same tab. A live turn's `message_start` can therefore land in
  `StreamingState` between historical chunk N and N+1, i.e. inside the replay window, producing an
  interleaved transcript (a new-turn message physically ahead of older history in insertion order).
  See Serious-2.

### 3. What input data produces a wrong answer rather than an error?

- A transcript of exactly 250 events takes the `chunked = events.length > chunkSize` branch as
  `false` (single pass, no yield) — matches the documented "≤ 250 → synchronous" rule
  (:912-913). 251 events: chunk 1 is 250 events + yield, chunk 2 is 1 event + yield (yield after the
  last chunk too, as documented). No off-by-one found.
- `readSessionHistory` (`session-history-reader.service.ts:161-313`) no longer builds
  `projectHistoryMessages`; `projectHistoryMessages` remains reachable only from
  `readHistoryAsMessages`/`readHistoryForCuration` via the shared `readHistoryMessages` private
  method (:584-639). Verified: the only two production call sites of `projectHistoryMessages` are
  those two public methods, confirmed by AST analysis. No dead branch on this path.

### 4. What happens when a dependency fails?

- `MessageChannel` unavailable: `yieldToMacrotask()` (`session-loader.service.ts:73-82`)
  constructs `new MessageChannel()` with **no fallback**. If `chunked` is true and the host lacks
  `MessageChannel` (any test harness without a polyfill, or a future host), the constructor throws
  synchronously inside the `for` loop of `replayHistoryEvents`, which is _inside_ the `try` at
  `switchSession:810-835`. That exception is caught, `applyResumeFailure` + `setStatus('loaded')`
  run, and the call rethrows — so this failure mode does resolve to a _visible_, non-silent error;
  it is not a data-loss bug, but it does mean a chunked resume simply cannot complete on such a
  host, by design (module doc: "a test host without it must install one"). Compare to Moderate-3:
  `MessageRouterService` (`libs/frontend/core/src/lib/services/message-router.service.ts:69-93`)
  makes the same host-capability decision the other way (`drainChannel: MessageChannel | null`,
  "each message drains in the task it arrived in" when absent) — an inconsistency worth a single
  documented decision, not two silently-diverging ones.
- `claudeRpcService.call('chat:resume', …)` never rejects — every path (success, backend error,
  and the `RESUME_TIMEOUT_MS` 120s timeout) resolves to an `RpcResult` with `success` set
  (`claude-rpc.service.ts:129-183`, `rpc-call.util.ts`). The `else` branch at
  `session-loader.service.ts:840-849` correctly turns `!success` or an empty `events` array into
  `applyResumeFailure` + `setStatus('loaded')` before throwing, so a timed-out or failed resume
  does not leave the tab looking `resuming` forever. Confirmed this is not the gap it might appear
  to be from the design note about "failure path" alone.

### 5. What is missing that the requirements never mentioned?

- INV-9 says the events path must fully replace the fallback for every session type. Confirmed:
  `readSessionHistory` (the `chat:resume` path) never special-cases CLI-agent, compacted, or
  imported sessions differently from a normal session — it always reads main + agent JSONL via
  `jsonlReader` and replays through `SessionReplayService`, independent of the deleted `messages`
  field. `jsonlReader.loadAgentSessions` and `hydrateMissingPricing` run unconditionally. No
  evidence found of a session type whose history reached the renderer _only_ via `.messages` before
  this change (searched `readSessionHistory`'s pre-change call sites via git blame context in the
  two comment diffs — both describe `messages` as a duplicate projection of the same parse, not an
  exclusive source for any session type).
- The plan's cancellation contract does not mention a live-event race during replay at all (R-P9
  only covers the _failure_ branch, not concurrent live/replay interleaving). See Serious-2.
- No test pins the `tab.claudeSessionId !== sessionId` rebind branch inside the _mid-chunk_ loop
  (`session-loader.service.ts:936-940`) specifically — the existing "cancels a stale replay when a
  newer resume claims the same tab" and "stops a replay whose tab closes between chunks" specs
  (`session-loader.service.spec.ts:2325`, `:2357`) cover claim-supersession and tab-close, but not a
  same-claim tab rebound to a different session mid-loop. Moderate-4.

## Failure modes

### Live-turn events interleaving with chunked historical replay

- Trigger: `chat:resume` called with `activate: true` on a session whose history exceeds 250
  events (or any timing where the backend's live query starts emitting before/while the renderer is
  still chunk-replaying).
- Symptom: a live message (new turn) can be inserted into `StreamingState` for the tab in between
  historical replay chunks, so the rendered transcript order does not match "history, then live" —
  a new response can appear to precede or interleave with the tail of the resumed history.
- Evidence: `session-loader.service.ts:732-750` (activate branch) and `:810-820` (replay starts
  only after RPC resolves, no live-event fence); `streaming-handler.service.ts:176-293`
  (`processStreamEvent` has no replay-aware queue/gate).
- Current handling: none observed. `isReplay: true` only affects whether the accumulator treats an
  event as historical for its own bookkeeping (`streaming-handler.service.ts:190`, `:324`,
  `:372`); it does not defer or block a concurrently-arriving live event for the same tab.
- Recommendation: gate live dispatch to a tab whose `sessionManager`/tab status is still `resuming`
  behind a queue that flushes after `finalizeSessionHistory`, or defer starting the live query
  until chunked replay for the same tab completes.

### CLI transcript field permanently empty with a stale doc promise

- Trigger: `ptah session load <id>` (any workspace, any session).
- Symptom: `session.history` notification always carries `messages: []`; no error, no deprecation
  signal.
- Evidence: `libs/shared/src/lib/types/rpc/rpc-session.types.ts:98-101` (doc: "come from chat:resume
  RPC call"); `apps/ptah-cli/src/cli/commands/session.ts:899-910`.
- Current handling: none — the field's own contract comment is now false.
- Recommendation: either update `SessionLoadResult`'s comment to say the messages projection is
  retired (and CLI/TUI must consume `events` going forward, listing what would be needed to do
  that), or route the CLI through `readHistoryAsMessages` for a real text projection.

### `yieldToMacrotask` has no `MessageChannel` fallback

- Trigger: any host/test environment without a global `MessageChannel` attempting a >250-event
  resume.
- Symptom: `replayHistoryEvents` throws inside the chunk loop; the outer `try` converts it into
  `applyResumeFailure` (visible error), not silent — but the resume is unconditionally impossible
  on such a host, unlike the sibling `MessageRouterService`, which degrades gracefully.
- Evidence: `session-loader.service.ts:66-82` vs `message-router.service.ts:69-93`.
- Current handling: documented as deliberate ("a test host without it must install one").
- Recommendation: either add the same synchronous-fallback pattern for parity, or record in
  `libs/frontend/chat/CLAUDE.md` why this seam intentionally diverges from `MessageRouterService`'s
  choice, so the next reader does not treat it as an oversight.

### Rebind-mid-replay branch has no dedicated regression test

- Trigger: tab rebound to a different session between two replay chunks while the replay claim is
  still the current one for that tabId (a narrower window than the "closed tab" or "superseded
  claim" cases already covered).
- Symptom: none expected in current code (the `tab.claudeSessionId !== sessionId` check at
  `session-loader.service.ts:936-940` returns `'superseded'` correctly) — but the branch is
  unverified by a spec, so a future refactor could silently break it without a red test.
- Evidence: `session-loader.service.ts:936-940`; spec file has no matching `it(...)` title (checked
  via grep for "rebound"/"rebind" in `session-loader.service.spec.ts`, only two hits, neither is
  this branch).
- Current handling: implicit, covered only by inference from adjacent tests.
- Recommendation: add one spec that rebinds the tab to a different session between chunk 1 and
  chunk 2 and asserts `'superseded'` plus that the new owner's queue is untouched.

### Global `SessionManager.setStatus`/`setSessionId` shared across concurrent resumes of different tabs

- Trigger: two different tabs (e.g. two canvas tiles) resuming two _different_ sessions
  concurrently.
- Symptom: `this.sessionManager.setStatus('resuming')` / `setSessionId(sessionId)`
  (`session-loader.service.ts:729-730`) write into a single global signal
  (`session-manager.service.ts:56-57`, `_sessionId`/`_status`), not a per-tab value. The per-tab
  UI state (`tabManager.applyResumingSession`/`applyResumeFailure`) is correctly tab-scoped, but
  whatever UI chrome reads the global `sessionManager.status()`/`sessionId()` signal can flicker or
  show the wrong session's status while two resumes race.
- Evidence: `session-manager.service.ts:56-60`, `:80`, `:98`; every call site in
  `session-loader.service.ts` that calls `setStatus`/`setSessionId` inside `switchSession`.
- Current handling: pre-existing architecture, not introduced or touched by this batch — flagged
  as scope the C15 change did not (and was not asked to) fix, since replay chunking does not change
  who calls these setters or how often.
- Recommendation: out of scope for this batch; worth a follow-up ticket if multi-tile concurrent
  resume becomes a supported flow (it already appears to be, per the canvas fan-out logic in
  `streaming-handler.service.ts:275-291`).

## Blocking issues

None found.

## Serious issues

### S1 — `ChatResumeResult.messages` deletion orphans the CLI's only documented transcript source

- File: `libs/shared/src/lib/types/rpc/rpc-session.types.ts:98-101`;
  `apps/ptah-cli/src/cli/commands/session.ts:899-910`.
- Scenario: any `ptah session load <id>` call, present and future.
- Impact: a CLI/TUI integrator (per the module's own instruction file, `ptah-cli` is a first-class
  headless surface) reading the documented contract is told messages "come from chat:resume,"
  follows that lead, and finds nothing — the field is permanently `[]` with no replacement wired in
  for headless consumers. This is exactly the "versioned/consumer compatibility" risk A5/D11 were
  meant to close, but A5/D11 only checked whether anyone _currently_ reads `.messages` — not whether
  the surviving code's own comments still promise it.
- Fix: update the `SessionLoadResult.messages` doc to state the field is now always empty and
  point future CLI transcript readers at `chat:resume`'s `events`; or, if CLI transcript display is
  in scope, wire a text projection for it (`readHistoryAsMessages` already exists for this exact
  shape).

### S2 — No fence between chunked replay and a concurrently activated live session

- File: `session-loader.service.ts:732-750, 810-835, 906-943`;
  `chat-session.service.ts:947-980`; `streaming-handler.service.ts:176-293`.
- Scenario: `chat:resume` with `activate: true` on a long (>250-event) session.
- Impact: a live turn's events can be dispatched to the tab in the macrotask gap between two
  replay chunks, producing an out-of-order or interleaved transcript for the user — the exact
  correctness property C15/INV-9 exists to protect ("replays only what is needed," implicitly in
  order).
- Fix: queue live events for a tab whose replay claim is still active and flush them after
  `finalizeSessionHistory`, or block the live query start until replay for that tab settles.

## Moderate and minor issues

- M1: `yieldToMacrotask` has no `MessageChannel` fallback, unlike the sibling
  `MessageRouterService` drain channel — `session-loader.service.ts:66-82` vs
  `message-router.service.ts:69-93`. Document the divergence or align it.
- M2: rebind-mid-replay branch (`session-loader.service.ts:936-940`) has no dedicated spec.
- M3: `SessionManager`'s global status/sessionId signals are written by every concurrent
  `switchSession`, independent of tabId — pre-existing, not this batch's regression, but worth a
  follow-up ticket given multi-tile fan-out exists.
- M4: `TabManagerService.applyResumedHistory` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2138`)
  is now dead in production — its only callers left are its own specs
  (`tab-manager.intent-mutators.spec.ts:949-952`, `session-identity.spec.ts:141`). Confirmed via
  repo-wide grep: no production call site remains after the `session-loader.service.ts` fallback
  branch was deleted. Not this batch's file to fix (chat-state is Batch 19 territory per the
  routing note), but it should be recorded as a Batch 19/21 follow-up so it is not left permanently
  orphaned.
- Minor: `session-loader.service.ts` is 1,467 lines, well past the 700-line soft ceiling
  (`eslint.config.mjs` `max-lines`). Confirmed by direct line count. Not a new violation introduced
  by this batch's diff alone (190 lines changed of 1,467), but the batch grew an already-oversized
  file; a facade-rule split (e.g. extracting the claim/replay mechanism —
  `claimReplay`/`isReplayClaimCurrent`/`releaseReplayClaim`/`replayHistoryEvents` — into a named
  collaborator) would have been in scope for "touched this file, consider the split."
- Minor: the e2e mock rewrite in `compaction-duplicate-session.spec.ts:82-132` was not run (batch
  instructions explicitly say do not run e2e/nx). The rewritten mock — 5 events, 2 `message_start`
  and 2 `text_delta` but only 1 `message_complete` (the user "restored-user" message never gets a
  `message_complete`) — is plausible but unverified against the real finalization/accumulator
  behaviour. Flag for an actual e2e run before merge; if the test's `expect` on `RESTORED_TRANSCRIPT`
  depends on a `message_complete` for the assistant only, it should pass, but this needs a real run,
  not inference.

## Data flow

1. `chat:resume` RPC arrives at `ChatSessionService.resumeSession` — OK, validates workspace/session,
   calls `historyReader.readSessionHistory(sessionId, resolvedWorkspacePath, { checkCompactionBoundary: true })`.
2. `readSessionHistory` reads main JSONL + agent sessions, replays to `FlatStreamEventUnion[]` via
   `SessionReplayService`, computes `stats`, seeds live-usage baseline — OK, no `messages`
   projection built on this path (verified: `projectHistoryMessages` not called from
   `readSessionHistory`).
3. `ChatResumeResult` is built without a `messages` field — OK, confirmed by type, service code, and
   two pinning specs (`rpc-chat.types.spec.ts`, `chat-session-resume-activate.spec.ts`).
4. Renderer `switchSession` awaits the RPC, checks `isReplayClaimCurrent` once — OK for the
   post-RPC race, but nothing fences a same-tab live event that could already be in flight from the
   `activate: true` branch of the SAME call (gap, S2).
5. `replayHistoryEvents` chunks at 250, dispatches synchronously per event within a chunk, yields a
   real macrotask after every chunk including the last — OK per the documented contract; verified
   against the equivalence-oracle spec (2,000 events / 8 yields).
6. On success, `finalizeSessionHistory` runs in its own macrotask after the last yield — OK, this is
   what makes CLI-session restoration and stats application deterministic relative to the last
   historical chunk.
7. On chunk-loop failure, `clearPendingUpdates` + `applyResumeFailure` + `setStatus('loaded')` run
   before rethrow — OK, no half-rendered "loaded" tab.
8. On RPC-level failure or empty events, the `else` branch performs the equivalent failure sequence
   — OK, verified `claudeRpcService.call` never rejects, so this branch is reachable and sufficient.
9. `finally` releases the replay claim only if still current — OK, cannot delete a newer call's
   claim.

## Requirements fulfilment

| Requirement                                                                                          | Status   | Gap                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| Delete `ChatResumeResult.messages` end to end (Task 20.1)                                            | COMPLETE | Type, backend forwarding, and pinning specs all updated; CLI's `SessionLoadResult` doc comment left stale (S1) |
| `projectHistoryMessages` retained only for `readHistoryAsMessages`/`readHistoryForCuration` (A5)     | COMPLETE | Verified no other production caller                                                                            |
| Chunked replay, 250/chunk, yield after every chunk incl. last (Task 20.2)                            | COMPLETE | Matches spec and equivalence oracle                                                                            |
| Tab stays `resuming` until finalize (INV-9)                                                          | COMPLETE | Verified across success/failure/superseded paths                                                               |
| Cancellation: per-tab claim, superseded stops without touching newer owner's queue                   | COMPLETE | Claim scoping and `finally` guard verified                                                                     |
| Failure path: chunk throw → `clearPendingUpdates`/`applyResumeFailure`/`setStatus('loaded')`/rethrow | COMPLETE | Verified in code and spec                                                                                      |
| CLI sessions applied before stats and replay                                                         | COMPLETE | `applyCliSessions` called before `applyResumeStats`/replay at `session-loader.service.ts:795`                  |
| Live/replay ordering guarantee (implicit in INV-9, not explicit in the plan)                         | PARTIAL  | No fence between a same-call `activate: true` live start and chunked replay (S2)                               |

Implicit requirements not addressed: a stale-doc sweep for the field that was deleted (S1); a
concurrency fence between "resume with activation" and "chunked history replay" for the same tab
(S2).

## Edge cases

| Case                                               | Handled    | How                                                                             | Concern                                                                                         |
| -------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Exactly 250 events                                 | YES        | `chunked = length > chunkSize` false, single pass                               | none                                                                                            |
| 2,000 events (8 yields)                            | YES        | Equivalence-oracle spec, counted `MessageChannel` posts                         | none                                                                                            |
| Newer call claims same tab mid-replay              | YES        | `isReplayClaimCurrent` check after every yield                                  | none                                                                                            |
| Tab closed mid-replay                              | YES        | `findTabByIdAcrossWorkspaces` returns undefined → `superseded`, pending cleared | none                                                                                            |
| Tab rebound to a different session mid-replay      | YES (code) | `claudeSessionId !== sessionId` check                                           | not spec-pinned (M2)                                                                            |
| Chunk throws                                       | YES        | `clearPendingUpdates`/`applyResumeFailure`/`setStatus('loaded')`/rethrow        | none                                                                                            |
| `chat:resume` RPC times out (120s)                 | YES        | Resolves `success:false`, hits the `else` failure branch                        | none                                                                                            |
| `activate: true` + long history (live/replay race) | NO         | No fence found                                                                  | S2                                                                                              |
| Host without `MessageChannel` + >250 events        | PARTIAL    | Throws, caught, surfaces as a visible failure                                   | not silent, but total feature loss on that host; no fallback like `MessageRouterService`'s (M1) |
| CLI reads transcript via `session:load`            | NO         | Field is permanently `[]`, doc still says otherwise                             | S1                                                                                              |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: a live-activated resume on a long session can interleave a new turn's events into the
  still-replaying historical transcript for the same tab (S2) — this is a correctness break in
  exactly the area C15/INV-9 was meant to protect, and the plan's risk table (R-P9) does not cover
  it because it is about a race, not a failure.
- What a robust implementation would add: (1) a queue/fence so live events addressed to a
  currently-replaying tab wait for `finalizeSessionHistory`; (2) a corrected `SessionLoadResult`
  contract comment (or a real CLI transcript projection) now that its stated source is gone; (3) a
  spec pinning the mid-chunk rebind branch; (4) either a `MessageChannel` fallback for
  `yieldToMacrotask` or a recorded reason the sibling router's fallback does not apply here; (5) an
  actual (not just read) run of the rewritten `compaction-duplicate-session.spec.ts` e2e before this
  merges, since its mock event shape was inferred, not executed.
