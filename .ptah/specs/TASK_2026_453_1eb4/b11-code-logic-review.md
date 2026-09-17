# Code Logic Review — `TASK_2026_453_1eb4` Batch 11

Scope reviewed: `libs/frontend/chat-types/src/lib/chat-types.ts`,
`libs/frontend/chat-state/src/lib/tab-manager.service.ts` (+ new
`tab-manager.history-window.spec.ts`), `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts`
(+ `.spec.ts`), `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`,
`libs/frontend/chat-streaming/src/index.ts`, `libs/frontend/chat-streaming/CLAUDE.md`.
`libs/shared/**` (Batch 9, in flux) excluded per instruction; not read for
correctness judgments, only for the `TabState`/`ExecutionChatMessage` shapes
this batch consumes, which are unchanged by this diff.

Read: `batches.md` Batch 11 section (1414-1463), Stage 2 validation table
(V1-V10, 1157-1240), U1 conclusion; `implementation-plan.md` §"C10 — History
message builder" (1050-1076) and §"C11 — Tab history window state"
(1078-1101); `b11-codex-report.md`.

## Summary

| Metric              | Value                     |
| -------------------- | ------------------------- |
| Overall score       | 8/10                      |
| Assessment          | APPROVED                  |
| Blocking issues     | 0                         |
| Serious issues      | 0                         |
| Moderate issues     | 2                         |
| Failure modes found | 3 (all handled correctly) |

## Five logic questions

### 1. How does this fail silently?

Not found in this batch's scope. `prependHistoryMessages` on an unknown tab
returns before any write (`tab-manager.service.ts:1508`) — a silent no-op, but
that is the specified contract (C11 AC: "unknown tab → no-op") and the caller
(C12, a later batch) is where a real refusal signal belongs; C11 has no
caller yet to mislead. `HistoryMessageBuilder.build` and `accumulate` do not
swallow errors — both propagate (verified: `history-message-builder.service.spec.ts:179-224`
asserts a thrown accumulator/tree-builder error surfaces to the caller, not a
default value).

### 2. What user action produces unexpected behaviour?

None reachable yet — Batch 11 ships no UI trigger and no caller of
`prependHistoryMessages` / `HistoryMessageBuilder` beyond the two facades
(`finalizeSessionHistory`, and the not-yet-built C12 paging service). The one
latent risk: `TabState.olderHistoryCursor` is a plain persisted field
(`chat-types.ts:548`, kept through `projectTabForPersist`'s spread,
verified `tab-persistence.ts:105-118` does not list it in
`NON_PERSISTED_TAB_KEYS`). A tab that had paged history in a previous session
survives a reload with its cursor intact and `sanitizeRestoredTab` does not
reset it (`tab-persistence.ts:169-190`) — confirmed correct per plan P23, but
it means a restored tab can immediately show "load earlier" before any
session-loader interaction, which only becomes an "unexpected behaviour"
question once C13 wires the affordance. Recorded as a note for the C12/C13
reviewers, not a Batch 11 defect.

### 3. What input data produces a wrong answer?

- Duplicate-id handling in `prependHistoryMessages` dedups both against
  current messages and within the older page itself, preserving first
  occurrence order (`tab-manager.service.ts:1510-1520`), and the spec exercises
  a page containing a repeated id (`tab-manager.history-window.spec.ts:82-102`).
  Correct.
- `HistoryMessageBuilder.build`'s history-page cache-key branch
  (`options.cacheKey.startsWith('history-page-')`, `history-message-builder.service.ts:137`)
  is a string convention, not a typed discriminator. Any future caller that
  reuses the literal `history-page-` prefix for an unrelated cache key would
  silently opt into cache release it should not have. Low risk today since the
  prefix is centrally documented (CLAUDE.md, this batch's own doc addition),
  but it is a string contract with no compile-time enforcement — see Moderate
  issues.

### 4. What happens when a dependency fails?

- `HistoryMessageBuilder.build` wraps the tree build in `try/finally`; a
  throw from `treeBuilder.buildTree` still releases the `history-page-*`
  scratch cache key (`history-message-builder.service.ts:221-225`, pinned by
  `history-message-builder.service.spec.ts:212-224`) and propagates the error
  — no partial message list is minted. Matches the plan's stated failure
  behaviour ("a throwing event propagates... no partial message list is
  returned").
- `accumulate()` has no try/finally of its own; a throw from
  `accumulator.process` mid-loop leaves `state` however far the loop got and
  propagates. The plan places the cleanup obligation on the caller's own
  `finally` (`clearCache(cacheKey)`), and the spec exercises exactly that
  caller pattern (`history-message-builder.service.spec.ts:179-210`). Correct
  as designed, but worth flagging for C12's reviewer: `HistoryPagingService`
  (Batch 12, not yet built) MUST wrap `accumulate` + `build` in one
  `try/finally` that calls `clearCache`, not just `build` — `build`'s own
  `finally` only fires if `build` is reached at all, and `accumulate` alone can
  throw first.

### 5. What is missing that the requirements never mentioned?

- No assertion (spec or otherwise) that `prependHistoryMessages` preserves
  the RELATIVE ORDER of the older page against itself when some but not all
  of its ids collide with current messages. The dedup filter preserves order
  by construction (`older.filter(...)`, a single left-to-right pass), so this
  is correct by inspection, but an explicit spec case ("older page partially
  overlaps current messages, order preserved") would have caught a future
  regression that swaps `filter` for a `Set`-based reconstruction. Minor gap,
  not required by the stated AC.
- The V2 audit is scoped to "no await between read and write" for atomicity
  against `prependHistoryMessages`, and it is correct (verified independently
  below). It does not address a related but distinct question the batch
  description also raises: could a live `setMessages` write, dispatched from a
  microtask/macrotask queued BEFORE `prependHistoryMessages` was called but
  which resolves its own promise AFTER `prependHistoryMessages` reads
  `current.messages`, still land after the prepend and get silently
  overwritten by a later prepend's stale-if-repeated read? This cannot happen
  within Batch 11 itself (there is exactly one call site, and JS's
  single-threaded execution means no interleaving inside one synchronous
  call), but it is the exact race C12's `HistoryPagingService.loadOlder` must
  avoid once it starts awaiting network round-trips between building an older
  page and calling `prependHistoryMessages`. Not a defect here; recorded so
  the Batch 12 reviewer checks it explicitly, since V5 in `batches.md` already
  flags the adjacent "does not mark the tab replaying" risk but not this one.

## Failure modes

### Unknown tab passed to `prependHistoryMessages` / `setOlderHistoryCursor`

- Trigger: caller passes a `tabId` that has been closed or never existed
  (race between a page-load promise resolving and the user closing the tab).
- Symptom: no-op, no error, no signal to the caller.
- Evidence: `tab-manager.service.ts:1507-1508` (`if (!current) return;`);
  `updateTabInternal` at :1056-1105 also no-ops for an unknown tab id in both
  the active-workspace fast path and the background-partition delegate.
- Current handling: matches the plan's stated contract ("unknown tab → no-op").
- Recommendation: none for this batch — the caller (C12) is the layer that
  must translate "still no-op" into a `'superseded'`/`'stale'` result the UI
  can act on; this batch correctly leaves that decision to its consumer
  rather than guessing at one.

### Throwing event during scratch accumulation

- Trigger: a malformed or unexpected event type reaches
  `StreamingAccumulatorCore.process` during `HistoryMessageBuilder.accumulate`.
- Symptom: the exception propagates out of `accumulate`; the scratch
  `StreamingState` built so far is discarded by the caller (no reference is
  retained anywhere in this batch's code).
- Evidence: `history-message-builder.service.spec.ts:179-210` (mocks
  `accumulator.process` to throw and asserts the error surfaces, `result` is
  `undefined`, and `clearCache` still runs from the caller's own `finally`).
- Current handling: correct — propagate, no partial result, cache released by
  the caller.
- Recommendation: none; flagged above (Q4) only so the next batch's own
  wrapping is checked.

### Throwing tree build during `build()`

- Trigger: `ExecutionTreeBuilderService.buildTree` throws (corrupt state,
  cache entry in a bad shape).
- Symptom: exception propagates from `HistoryMessageBuilder.build`; the
  `history-page-*` cache key is still released.
- Evidence: `history-message-builder.service.ts:137-226` `try { ... } finally
  { if (releaseScratchCache) ... }`; pinned by
  `history-message-builder.service.spec.ts:212-224`.
- Current handling: correct.
- Recommendation: none.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **String-prefix cache-release contract** (`history-message-builder.service.ts:137`):
  `options.cacheKey.startsWith('history-page-')` decides whether `build()`
  releases the scratch cache in its own `finally`, versus leaving the
  long-lived `tab-${tabId}` entry alone for the tail path. This is a
  convention enforced by convention only — a future caller minting a cache key
  like `history-page-preview-${tabId}` for an unrelated purpose would silently
  opt into (or a `tab-history-page-${tabId}` typo would silently opt out of)
  cache release. Consider a boolean field on `HistoryMessageBuildOptions`
  (e.g. `releaseCacheAfterBuild`) instead of sniffing the key string, so the
  caller's intent is explicit and type-checked. Not blocking: today there is
  exactly one producer of each prefix (`message-finalization.service.ts:295`
  for `tab-`, and the plan's own documented convention for `history-page-`),
  and the CLAUDE.md addition documents the convention for the next author.
- **No explicit "partial id overlap preserves order" spec** for
  `prependHistoryMessages` — see Q5. Low risk; the implementation is correct
  by construction, but the gap is worth closing before C12/C13 build on top
  of it, since a future change to the dedup strategy would not be caught.

## Data flow

1. `TabManagerService.setOlderHistoryCursor(tabId, cursor)` → one
   `updateTabInternal` write of `{ olderHistoryCursor: cursor }`. OK — routes
   through the same active/background-partition split every other mutator
   uses; no new write path introduced.
2. `TabManagerService.prependHistoryMessages(tabId, older, nextCursor)` →
   reads `current` via `findTabByIdAcrossWorkspaces` (synchronous, no
   intervening `await`) → builds `uniqueOlder` by filtering `older` against a
   `Set` seeded from `current.messages` ids → one `updateTabInternal` write of
   `{ messages: [...uniqueOlder, ...current.messages], olderHistoryCursor:
   nextCursor }`. OK — read-then-write is atomic because nothing yields
   between them (verified: no `await`, no `Promise`, no callback boundary in
   the function body).
3. `MessageFinalizationService.finalizeSessionHistory(tabId, resumableSubagents)`
   → `flushSync()` → deep-copy `streamingState` → delegate to
   `HistoryMessageBuilder.build(stateCopy, { cacheKey: 'tab-${tabId}', ... })`
   → `tabManager.applyFinalizedHistory(tabId, finalMessages)`. OK — facade
   signature, call order and side effects (flush → copy → build → apply)
   unchanged from the pre-Batch-11 code (verified line-by-line diff, see
   below).
4. `HistoryMessageBuilder.build` → `treeBuilder.buildTree` (memoized per
   cacheKey) → optional resumable-subagent interruption pass → one pass
   indexing message boundaries (`indexMessageBoundaries`, O(E)) → one pass
   indexing trees by id (`indexTreesById`, O(M)) → the per-message loop is
   O(M) lookups → post-process pass marks streaming agents interrupted and
   caps each tree → `finally` releases the scratch cache only for
   `history-page-*` keys. OK — O(E + M) preserved; verified against the
   removed code that the loop bodies (user branch, assistant branch,
   post-processing map) are semantically identical, not just structurally
   similar.
5. `HistoryMessageBuilder.accumulate` (new capability, not yet called by any
   production code in this batch — its only caller today is its own spec) →
   for each event, scope `sessionId` if absent → `accumulator.process(state,
   event, context)` with the REAL `SessionManager`, `EventDeduplicationService`,
   `BatchedUpdateService`, `BackgroundAgentStore`, `AgentMonitorStore` (no
   scratch/mock stores) → replace `accumulated` on `result.replacementState`.
   OK for the stated contract (idempotent store writes, no `scheduleUpdate`
   call site is exercised by the accumulator's `agent_start` /
   `background_agent_started` branches per the spec) — but this is the seam
   Batch 12 must drive correctly; see Q5 for the one open question deferred
   to that reviewer.

## Requirements fulfilment

| Requirement                                                                 | Status   | Gap                                                                                      |
| ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| C11: tri-state `olderHistoryCursor` on `TabState`                          | COMPLETE | none                                                                                       |
| C11: `setOlderHistoryCursor`                                                | COMPLETE | none                                                                                       |
| C11: `prependHistoryMessages` — one write, current-state read, dedup by id | COMPLETE | none                                                                                       |
| C11: never writes status/streamingState/stats                              | COMPLETE | verified by spec (`tab-manager.history-window.spec.ts:100-101`) and by reading the write   |
| C11: unknown tab no-op, empty page still records cursor                    | COMPLETE | none                                                                                       |
| C11: `applyResumingSession` resets cursor to `undefined`                   | COMPLETE | `tab-manager.service.ts:2153`                                                              |
| C11: persisted / restored through existing spreads                        | COMPLETE | verified `tab-persistence.ts:105-118`, `:169-190` do not special-case the field            |
| V2: seven `setMessages` sites audited for an intervening `await`           | COMPLETE | independently re-verified all seven sites; none has an `await` between read and write      |
| C10: `HistoryMessageBuilder` with `createPageState`/`accumulate`/`build`   | COMPLETE | none                                                                                       |
| C10: `finalizeSessionHistory` keeps signature/behaviour (facade rule)      | COMPLETE | verified line-by-line diff equivalence, not just report claim                              |
| C10: page cache key `history-page-${tabId}` cleared in `finally`          | COMPLETE | none                                                                                       |
| C10: `message-finalization.session-history.spec.ts` green, unedited       | COMPLETE | file not in the diff; report states it passed, consistent with an unedited oracle spec     |
| C10: no `scheduleUpdate` during page build, idempotent agent registration  | COMPLETE | verified via spec assertions, not just report narrative                                    |

Implicit requirements not addressed: an explicit "partial-overlap preserves
order" spec case for `prependHistoryMessages` (Minor, above); a typed (not
string-prefix) cache-release contract for `HistoryMessageBuildOptions`
(Moderate, above). Neither is a stated AC.

## Edge cases

| Case                                                        | Handled | How                                                                                   | Concern                                                        |
| ------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Live append arrives between older-page request and commit  | YES     | `prependHistoryMessages` reads `current.messages` only at call time                    | none (this batch has no caller yet; C12 must call it correctly) |
| Duplicate ids across current and older page                | YES     | `Set`-based filter, first occurrence kept                                              | none                                                              |
| Duplicate ids within the older page itself                 | YES     | same filter, `seenIds` accumulates across the whole page                               | none                                                              |
| Empty older page                                            | YES     | cursor still written, messages unchanged (spec :104-113)                               | none                                                              |
| Unknown/closed tab                                           | YES     | no-op before any write (spec :115-132)                                                 | none                                                              |
| Resume resets paging state                                   | YES     | `applyResumingSession` writes `olderHistoryCursor: undefined` (spec :134-149)          | none                                                              |
| Persist/restore round trip                                   | YES     | spec :151-160 round-trips through `projectTabForPersist` + `sanitizeRestoredTab`        | none                                                              |
| Page build throws mid-tree-build                             | YES     | `finally` releases scratch cache regardless (spec :212-224)                            | none                                                              |
| Accumulation throws mid-event                                | YES     | propagates; caller's own `finally` releases cache (spec :179-210)                       | caller discipline is Batch 12's obligation, not verifiable here |
| Repeated `agent_start`/`background_agent_started` in a page | YES     | store reducers are idempotent (spec :143-177): one entry per id after two duplicates    | none                                                              |
| No `nx reset`, no scroll/CSS/transcript diff                 | YES     | `git diff` independently confirms empty diff outside the eight listed batch files       | none                                                              |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none inside this batch's own boundary; the one real risk this
  batch creates is a seam for Batch 12 to get wrong — `HistoryPagingService`
  must wrap `accumulate()` AND `build()` in a single `finally` that clears the
  scratch cache (accumulate has no cleanup of its own), and it must not
  reintroduce a stale-read race by holding a `tab.messages` snapshot across an
  `await` before calling `prependHistoryMessages`.
- What a robust implementation would add: a typed discriminator on
  `HistoryMessageBuildOptions` instead of a `cacheKey` string-prefix
  convention for cache-release intent; one additional spec case for
  `prependHistoryMessages` covering a PARTIAL id overlap between the older
  page and current messages, asserting order is preserved.
