# Code Style Review — `TASK_2026_437_0778` Batch 20 (Phase 4)

Scope: Task 20.1 (delete `ChatResumeResult.messages` end to end) + Task 20.2 (chunked
replay in `SessionLoaderService`). Batch 19 (chat-streaming/chat-state) and Batch 21
(chat-routing/core message-router) files are read only for cross-batch duplication
comparison, not reviewed for their own quality.

## Summary

| Metric          | Value                          |
| --------------- | ------------------------------ |
| Overall score   | 6/10                           |
| Assessment      | NEEDS_REVISION                 |
| Blocking issues | 0                              |
| Serious issues  | 3                              |
| Minor issues    | 3                              |
| Files reviewed  | 12 (+ 2 read-only cross-batch) |

## Five style questions

### 1. What breaks in six months?

The next reader who touches `session-history-reader.service.ts:16-18` will believe
`readHistoryAsMessages` is load-bearing public API ("CRITICAL: Public API must remain
unchanged") and route around it instead of deleting it, even though this batch made it
dead (`grep` across the whole repo turns up zero non-spec, non-doc-comment callers). The
batch's own plan (`batches.md:1385`) anticipated exactly this — "legacy projection only if
unreferenced" — and the check was never acted on. Six months out this is a second
`ChatResumeResult.messages`: a text-only projection nobody calls, kept alive by a comment
that says it's sacred.

### 2. What would a new team member misread?

`SessionLoaderService.replayHistoryEvents` (`session-loader.service.ts:905-942`) reads as
a small, self-contained chunking loop, but its four collaborators — `claimReplay`,
`isReplayClaimCurrent`, `releaseReplayClaim`, the `replayClaims` map, `replayClaimCounter`,
`yieldToMacrotask`, `REPLAY_CHUNK_SIZE`, `HistoryReplayOutcome` — are declared 150-250
lines away, spread across the class alongside four unrelated concerns (session-list
pagination/caching, CLI-output demand loading, resumable-subagent tracking). A newcomer
has to hold all of `switchSession` (`:625-859`, 234 lines) in their head to see why a
"superseded" outcome from a chunk loop is safe to silently swallow.

### 3. What does this cost to maintain?

`SessionLoaderService` grows from 1,337 to 1,467 lines (`session-loader.service.ts`),
already flagged by the project's own `max-lines` lint rule (`eslint` run: "File has too
many lines (1045). Maximum allowed is 700"). Every future change to replay semantics now
has to be re-verified against the file's other four concerns rather than against an
isolated, independently testable unit.

### 4. Where is this inconsistent with the rest of the repository?

Two independent files invent the same "one MessageChannel task = one macrotask yield"
primitive in the same task (`session-loader.service.ts:64-81` `yieldToMacrotask`, and
`message-router.service.ts`'s `drainChannel`/`scheduleDrain`, Batch 21), each carrying its
own near-duplicate paragraph of platform reasoning ("every shipping host has one; rAF
never fires hidden; setTimeout clamps/throttles"). `libs/backend/agent-sdk/CLAUDE.md`
documents a comparable repo pattern once and points every consumer at it (e.g. the
`ClaudeCliDetector` single-flight probe, the three read-cache rule); this pair does the
opposite — the same fact duplicated at the point of use, in parallel batches that could
not see each other.

### 5. What would you have done differently?

Delete `readHistoryAsMessages` (and shrink the file-header contract, `:16-18`) now that
the plan's own condition for keeping it is unmet. Extract the replay-claim + chunking
concern into a named collaborator (e.g. `SessionHistoryReplayer`, injected the way
`ExecutionTreeBuilderService` and `AgentMonitorStore` already are) under the facade rule
this repo names explicitly. Move the `MessageChannel`-yield primitive into
`libs/frontend/core` once, and have both consumers import it.

## Blocking issues

None.

## Serious issues

### Dead public method left in `SessionHistoryReaderService`, contradicting the plan's own condition

- File: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:16-18`, `:532-546`
- Problem: `batches.md:1385` scoped this file's touch to "legacy projection only if
  unreferenced." `readHistoryAsMessages` is unreferenced by any production caller —
  confirmed by a repo-wide grep that returns only its own file, its own spec, and mock
  wiring in `chat-session-resume-activate.spec.ts` / `chat-continue-slash-before-resume.spec.ts`
  (both mock it only to assert it is _not_ called). The file's own header still lists it
  under "CRITICAL: Public API must remain unchanged" (`:16-18`), which is now false —
  nothing outside this file and its tests depends on it.
- Impact: the next person who wants to remove it has to re-derive the same "is this
  referenced" answer this batch already computed, working against a comment that actively
  tells them not to touch it. `projectHistoryMessages`/`readHistoryMessages` stay (correctly
  — `readHistoryForCuration` still uses them via `sdk-transcript-reader.adapter.ts:31`), but
  the `readHistoryAsMessages` wrapper (`:532-546`) and its two doc-comment cross-references
  (`:549`, `:554`) are pure residue of the deleted `ChatResumeResult.messages` path.
- Recommendation: delete `readHistoryAsMessages`, update the file-header "Public API" list
  and the two `{@link readHistoryAsMessages}` references in `readHistoryForCuration`'s doc
  comment accordingly, and drop the now-unneeded mock wiring in the two RPC specs.

### Replay-claim + chunking concern belongs in a named collaborator, not inline in `SessionLoaderService`

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:64-81`
  (`yieldToMacrotask`), `:141-153` (`REPLAY_CHUNK_SIZE`, `replayClaims`,
  `replayClaimCounter`), `:866-942` (`claimReplay`, `isReplayClaimCurrent`,
  `releaseReplayClaim`, `replayHistoryEvents`)
- Problem: this is the shape the root `CLAUDE.md` facade rule was written for
  ("worked example: `SkillSynthesisService` / `StageHandlersService`") — a self-contained,
  independently nameable, independently testable concern (chunked replay + tab-claim
  supersession) bolted onto a class that already carries four other concerns and was
  already over the file-size ceiling before this batch (1,337 → 1,467 lines; `max-lines`
  lint warns at 1045 reported lines). `chat/CLAUDE.md:26-27` already documents the pattern
  this class should follow: "Add new chat-store slices as child services in
  `services/chat-store/` and expose them through the facade."
- Tradeoff: leaving it inline means the next change to replay semantics (a fifth chunk
  size, a different supersession rule) has to be re-verified against session-list caching,
  CLI-output demand loading and resumable-subagent tracking in the same file, instead of
  against an isolated unit with its own constructor and its own spec file.
- Recommendation: extract a `SessionHistoryReplayer` (or similar; passes the nameability
  test — not `helpers`/`utils`) into `services/chat-store/`, taking `StreamingHandlerService`,
  `TabManagerService` and `SessionManager` as collaborators, injected into
  `SessionLoaderService` the same way `ExecutionTreeBuilderService` already is. The unit is
  comfortably over the ~150-line floor the guardrail requires (it is already ~110 lines
  before its doc comments, plus the type and constant).

### `MessageChannel`-based macrotask yield duplicated across two batches with no shared helper

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:64-81`
  vs. `libs/frontend/core/src/lib/services/message-router.service.ts` (drain scheduling via
  `this.drainChannel`, added by Batch 21)
- Problem: both files independently reach for the same technique — a `MessageChannel`
  port-pair posted to force a real macrotask boundary in a hidden Electron/webview host —
  and both carry their own paragraph explaining why (`rAF` never fires hidden,
  `setTimeout` throttles/clamps). No shared primitive exists in `libs/frontend/core`, which
  is exactly where `session-loader.service.ts` already imports host-neutral services from
  (`ClaudeRpcService`, `VSCodeService`). Because the batches were reviewed and verified in
  parallel (`batches.md:1407` "Parallel with: Batches 19, 20"), neither author could see
  the other had solved the same problem.
- Tradeoff: a correctness fact about this repo's hosts ("no `MessageChannel` in jsdom,"
  "prefer it over rAF/setTimeout for a forced yield") now lives in two places that can drift
  independently; a third caller needing "yield one macrotask" will likely write a third
  copy rather than search for the first two.
- Recommendation: lift a single `yieldToMacrotask()` (or a small `MacrotaskScheduler` if
  the router's dedup/schedule semantics need to stay distinct from the loader's plain
  await-once use) into `libs/frontend/core`, and have both consumers import it. Not a
  blocking issue for this batch alone — it is a legitimate independent addition — but it
  should not land twice without a follow-up noted.

## Minor issues

- `libs/frontend/chat/CLAUDE.md` and `libs/shared/CLAUDE.md` were not touched by this
  batch. `shared/CLAUDE.md`'s RPC section (`:27-28`) itemizes per-namespace contract notes
  for other RPC folders' quirks (e.g. `rpc-degradation.types.ts`) but says nothing about
  `rpc-chat.types.ts` losing its `messages` field; `chat/CLAUDE.md`'s "Key Files" section
  (`:26-27`) still describes `SessionLoaderService` without mentioning the chunked-replay
  contract this batch adds. Every other architecturally significant decision touched during
  this task (TASK_2026_437) got a bullet in the owning lib's `CLAUDE.md` — see
  `agent-sdk/CLAUDE.md`'s dense guideline list for the pattern this batch should have
  followed at smaller scale.
- Dead code: `TabManagerService.applyResumedHistory` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2138`)
  has zero production callers left — its only call site was the `messages`-branch this
  batch deleted from `session-loader.service.ts`. `chat-state` is out of this review's file
  scope, but the dead code is this batch's residue and should be flagged for removal in
  whichever batch next touches `TabManagerService` (or as a follow-up here, since it is a
  one-line consequence of Task 20.1/20.2).
- `rpc-chat.types.spec.ts` is a new, one-off pattern in `libs/shared`: a spec whose only
  purpose is a compile-time key-absence assertion (`'messages' extends ChatResumeResultKeys
? false : true`) plus a redundant runtime `not.toHaveProperty`. No other file under
  `libs/shared/src/lib/types/rpc/` carries a sibling spec — the folder's existing contract
  guarantees (dual-registration, `rpc-error-codes.types.ts`) are enforced by the
  `ALLOWED_METHOD_PREFIXES` runtime guard and `satisfies` assertions in
  `rpc-handler-manifest`, not by a per-file test. This isn't wrong (ts-jest genuinely
  type-checks it, and the field is a real historical regression risk — PR #493 already
  called out one parity break in this exact projection), but it establishes a precedent
  worth naming rather than leaving implicit: the next contract deletion in `libs/shared`
  will look for this pattern and not find a second example to confirm it's the house way.

## File-by-file

### `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor beyond the CLAUDE.md gap noted above. Clean
removal; the replacement doc comment on `events` (`:236-240`) correctly states the new
invariant. `deprecated` tag removed along with the field it deprecated, not left orphaned.

### `libs/shared/src/lib/types/rpc/rpc-chat.types.spec.ts` (new)

Score 7/10 — 0 blocking, 0 serious, 1 minor (precedent, above). Does what it says; the
compile-time type assertion is the part that actually enforces anything (a re-added field
compiles the conditional type to `false`, which then fails the `HasNoMessagesKey` typed
assignment) — the runtime `expect(reply).not.toHaveProperty('messages')` is belt-and-braces
on a plain object literal and doesn't add coverage the type check didn't already give.

### `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Straight, symmetric removal of `messages` at
every site it appeared (`:882`, `:939`(log), `:986`), doc comment updated in place
(`:822-825`). `chat-session-resume-activate.spec.ts` diff confirms the single-parse
invariant is still pinned by a (renamed, sharpened) test.

### `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`

Score 5/10 — 0 blocking, 1 serious (dead `readHistoryAsMessages`, above), 0 minor.
`readSessionHistory`'s own removal of `messages` is complete and correctly threaded through
every return branch (`:217`, `:247`, `:293`, `:306`); `projectHistoryMessages` correctly
stays because `readHistoryForCuration` still needs it. The one gap is the file not
finishing what its own governing batch note asked it to check.

### `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`,

`message-transform-helpers.ts`

Score 8/10 — comment-only updates, accurate and proportionate to the change (e.g.
`jsonl-reader.service.ts:364-366` now says "replays the single-parse `events`" instead of
"uses the single-parse `messages`" — correct, since the memoization rationale it documents
is unchanged).

### `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts`

Score 7/10 — 0 blocking, 0 serious, 0 minor. The substantive change (switching the
"hides isMeta AND isSynthetic" test from reading `snapshot.messages` to calling
`reader.readHistoryAsMessages` directly, `:307-322`) is correct and necessary given the
field removal — and ironically is the one place that still legitimately calls the method
Serious issue #1 says is otherwise dead, so removing `readHistoryAsMessages` would need
this test rewritten too, not just deleted outright. The rest of the diff is prettier
reflow of pre-existing long lines/arrow bodies (confirmed formatter-owned: `npx prettier
--check` passes clean on the file) — acceptable, not a style finding.

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

Score 5/10 — 0 blocking, 2 serious (facade-rule extraction, cross-batch `MessageChannel`
duplication), 0 minor beyond the CLAUDE.md gap. The replay logic itself is careful and
correct where it matters: claim supersession is checked after every yield and inside the
throw handler (`:914-941`), a closed or rebound tab is detected and its queue dropped
without touching a newer owner's queue (`:933-940`), and a throwing chunk drives
`clearPendingUpdates` + `applyResumeFailure` before rethrowing (`:816-828`) rather than
leaving a half-replayed tab that looks complete. The correctness is not in question here —
the placement and duplication are.

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. `configureRealPipeline` (`:2468-2538`) wires
the real `StreamingHandlerService`/`TabManagerService` pipeline rather than mocking it,
which is the only way to honestly assert the stated equivalence oracle — and the spec
delivers on it: 2,000 events, 8 yields (`CountingMessageChannel`, `:2717-2749`), and a
byte-for-byte `toEqual` between the chunked and single-pass final tab states (`:2781`).
Coverage for the throw-mid-replay and superseded-claim paths is present and specific
(`applyResumeFailure`/`clearPendingUpdates` assertions at `:1805`, `:1832`, `:2318-2319`,
`:2369-2371`).

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.cli-restore.spec.ts`,

`apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts`,
`apps/ptah-electron-e2e/src/specs/task-370-concurrent-session-isolation.spec.ts`,
`libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts`,
`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`

Score 7/10 — mechanical, correct fixture updates (`messages: [...]` → `events: [...]` with
proper `FlatStreamEventUnion` shapes, e.g. `compaction-duplicate-session.spec.ts:79-131`)
plus prettier reflow noise on adjacent lines in the e2e spec (formatter-owned, `prettier
--check` clean).

## Pattern compliance

| Repository rule or nearby convention                               | Status         | Evidence                                                                                                                                                                               |
| ------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC dual-registration (compile-time + `ALLOWED_METHOD_PREFIXES`)   | NOT_APPLICABLE | No namespace added or removed, only a field                                                                                                                                            |
| Facade rule (extract collaborator past size/nameability threshold) | FAIL           | `session-loader.service.ts:64-942`, over 700-line ceiling before this batch, grows further with a nameable, extractable concern left inline                                            |
| No dead code left behind a deletion                                | FAIL           | `session-history-reader.service.ts:532-546` (`readHistoryAsMessages`); `tab-manager.service.ts:2138` (`applyResumedHistory`, cross-batch residue)                                      |
| `catch (error: unknown)` narrowing                                 | PASS           | `session-loader.service.ts:816` `catch (error: unknown)` before rethrow                                                                                                                |
| Angular OnPush/signals/inject()                                    | NOT_APPLICABLE | No component touched in this batch                                                                                                                                                     |
| Zod schemas at RPC boundary                                        | NOT_APPLICABLE | No RPC params/schema changed, only the result shape                                                                                                                                    |
| CLAUDE.md kept current for architecturally significant change      | FAIL           | `chat/CLAUDE.md`, `shared/CLAUDE.md` not updated for the removed field or the replay contract                                                                                          |
| Prettier/formatter-owned diffs not flagged as findings             | PASS           | Verified via `npx prettier --check` on all touched files — clean                                                                                                                       |
| eslint clean (no new errors)                                       | PASS           | `npx eslint` on the five production files: 0 errors, 4 pre-existing `max-lines` warnings, 1 pre-existing unrelated warning (`createNewSession` empty method, not touched by this diff) |

## Maintenance debt

- Introduced: a chunked-replay + claim-supersession mechanism (110+ lines) inline in an
  already-oversized facade class; a second independent `MessageChannel`-yield primitive
  with no shared home; one new spec-only compile-time-assertion pattern in `libs/shared`.
- Retired: a duplicate JSONL parse projection (`messages`) and its 6+ call sites across 4
  libs — a real, substantial simplification of the `chat:resume` contract and the resume
  path's read cost.
- Net: positive on the core deletion (the duplicate transcript is genuinely gone and every
  consumer updated), negative on where the new replay logic was placed and on the two
  pieces of intentional dead code the deletion should have also removed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the field deletion itself is clean and complete, but the batch left two
  pieces of code its own plan anticipated removing (`readHistoryAsMessages`,
  `applyResumedHistory`) and put the new chunking logic in the one place the repo's facade
  rule says not to.
- What a 10/10 version would do differently: delete `readHistoryAsMessages` and update its
  file-header contract; extract `SessionHistoryReplayer` as a named `chat-store/`
  collaborator; add the CLAUDE.md bullets for the removed field and the replay contract;
  flag (or in the same commit, remove) `TabManagerService.applyResumedHistory`; and land
  the `MessageChannel`-yield helper once in `libs/frontend/core` rather than twice across
  parallel batches.
