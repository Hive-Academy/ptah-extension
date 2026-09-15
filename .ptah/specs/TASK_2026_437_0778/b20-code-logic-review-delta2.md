# Code Logic Review — Delta 2 — `TASK_2026_437_0778` Batch 20

Base: `b20-code-logic-review.md` (6/10, NEEDS_REVISION). Delta 1:
`b20-code-logic-review-delta.md` (7/10, APPROVE_WITH_FIXES, S2 open — fence
opened inside `replay()`, after `chat:resume` resolved, while the backend
starts the live query before responding). This delta re-verifies the
developer's stated fix against the current uncommitted diff in
`D:\projects\ptah-437` only (read-only; no test runs beyond what evidence
already required).

## Summary

| Metric              | Value              |
| ------------------- | ------------------ |
| Overall score       | 8/10               |
| Assessment          | APPROVE_WITH_FIXES |
| Blocking issues     | 0                  |
| Serious issues      | 0                  |
| Moderate issues     | 2                  |
| Failure modes found | 0 new              |

## S2 — status: CLOSED

Fix verified directly against source, not just the developer's description:

- `SessionHistoryReplayer.claim(tabId, sessionId)`
  (`session-history-replayer.service.ts:110-124`) now calls `openFence`
  itself, unconditionally — no longer gated on `chunked` and no longer deferred
  to `replay()`.
- `SessionLoaderService.switchSession` calls `historyReplayer.claim(...)` at
  `session-loader.service.ts:657`, **before** the `chat:resume` RPC is issued
  at `session-loader.service.ts:702`. Read both call sites directly to confirm
  ordering, not just comments.
- The backend activation path is unchanged: `chat-session.service.ts:951-985`
  still starts/joins the live SDK query (`autoResumeIfInactive`) _before_
  building and returning the RPC response at `:987`. The diff on this file
  only touches comments and the removed `messages` field
  (`chat-session.service.ts` diff, `-messages`/`-messages.length`), not the
  activate-then-respond ordering — so the hazard the fence has to cover is
  exactly what it always was.
- `replay()` no longer opens a fence; it only closes the one `claim()` opened,
  via `closeFence(claim)` after finalization (`session-history-replayer.service.ts:189-191`).
  `release()` closes it unconditionally otherwise (`:136-142`), and is called
  from `switchSession`'s `finally` (`session-loader.service.ts:823`) on every
  exit — success, throw before the RPC, RPC failure, empty events, superseded,
  stale-snapshot early return.
- Direct proof the round-trip window is now fenced, not just claimed to be:
  `session-history-replayer.service.spec.ts:356-375` ("fences from claim — the
  chat:resume round trip — until finalization, and not before the claim or
  after release") — an event offered immediately after `claim()` and before
  `replay()` is called returns `true` (buffered); one offered before `claim()`
  or after `release()` returns `false`.
- End-to-end proof through the real caller, not just the collaborator in
  isolation: `session-loader.service.spec.ts:2387-2428` ("applies a live chunk
  that arrives during the round trip after the replayed history") drives
  `switchSession(SESSION, { activate: true })`, holds the `chat:resume` RPC
  pending, offers a live chunk while `rpc.sent()` is true and the reply has not
  landed, then resolves the RPC with 600 history events. Assertion order:
  `['e0', 'e599', 'finalize', 'live', 'status:loaded']`, live event delivered
  exactly once. This is the precise scenario delta 1's S2 finding described as
  open (activation before response), now closed with a spec that fails if the
  fence regresses to opening inside `replay()`.
- The three failure variants (`chat:resume` fails / times out / returns no
  events) and "newer resume supersedes before its replay" and "throw between
  claim and RPC" are each pinned at
  `session-loader.service.spec.ts:2430-2460`, `:2462-2493`, `:2495-2521`
  respectively — all assert the round-trip-buffered live event delivers
  exactly once, after the failure/supersession branch runs.

No gap found in the fix itself. `chat/CLAUDE.md` bullet 7
(`libs/frontend/chat/CLAUDE.md`, rewritten) now states "the fence **opens at
claim time**... before `chat:resume` is sent" — the delta-1 finding that the
doc overclaimed coverage (M-new-2) is also resolved; the doc now matches the
code.

## Five logic questions

### 1. How does this fail silently?

Not found in this delta's scope. The one path that could plausibly hide a
problem — the microtask fallback on a host without `MessageChannel`
(`macrotask-scheduler.ts`) — resolves in order with every claim check
preserved (`session-history-replayer.service.spec.ts:284-305`); it is a
documented consequence of jsdom lacking a real macrotask queue, not a
production code path (real hosts — VS Code webview, Electron renderer, CLI's
own transport — all have `MessageChannel`).

### 2. What user action produces unexpected behaviour?

Resuming a session with `activate: true` while an old resume of the same tab
is still in flight (double-click a session row before the first load
finishes) exercises the "newer claim of the same session takes over the hold"
path — verified exactly-once and in-order at
`session-history-replayer.service.spec.ts:498-524` and
`session-loader.service.spec.ts:2462-2493`. No unexpected-behaviour path
found for this action.

### 3. What input data produces a wrong answer?

Not found. `events.length === 0` and the stale-compaction-snapshot early
return are both exercised by the it.each block
(`session-loader.service.spec.ts:2430-2460`) and the compaction branch above
it in the same file; both route the round-trip buffer through the failure/
early-return path exactly once.

### 4. What happens when a dependency fails?

`chat:resume` failing, timing out, or the `MessageChannel` post throwing
(`yieldToMacrotask` rejection) are each traced to the same outcome: the
`finally`'s `release(replayClaim)` runs, closes the fence, and delivers
anything buffered during the failed window exactly once
(`session-history-replayer.service.spec.ts:261-282`,
`session-loader.service.spec.ts:2430-2460,2524-2561`). No gap found.

### 5. What is missing that the requirements never mentioned?

- No spec for "tab A's replay of a session fails while tab B's replay of the
  _same_ session is still mid-chunk" (both tabs open, both fenced by the same
  session-keyed fence, refcounted by `holders: Set<number>`). Only same-outcome
  pairs are tested (`session-history-replayer.service.spec.ts:456-497`, both
  succeed). The refcount mechanism is structurally symmetric with the tested
  cases (a failing claim's `closeFence` only removes its own holder), so this
  is a coverage gap, not a suspected defect — carried from delta 1 as M-new-1,
  still open, unchanged.
- The CLI's `session.history` limit-trim (`interact.ts:548-549`,
  `all.slice(all.length - limit)`) is now permanently a no-op: `session:load`
  always returns `messages: []` (`SessionLoadResult`), and the spec that used
  to pin the trim was rewritten to match (`interact.spec.ts` diff, `m1`/`m2`/
  `m3` fixture removed). This is not a functional gap — trimming an empty
  array is correct for any `limit` — but it leaves genuinely dead logic
  unflagged as such; see Moderate issues.

## Failure modes

None found that were not already covered by the base review, delta 1, or the
two moderate items below. The mandatory probes below found no new failure
mode.

## Mandatory probes (task-specified)

- **Exactly-once, in-order delivery across every exit.** Confirmed by
  construction: `fence.buffered` is only read in `leaveFence` and the overflow
  branch, both of which remove the fence/splice the array before iterating, so
  no code path can deliver from a buffer twice (this reasoning was already
  verified in delta 1 and is unchanged by this batch's diff — the delivery
  mechanics were not touched, only where `openFence` is called from).
- **Newer-claim-same-session handoff: can the buffer be delivered twice or
  lost if the newer resume also fails/supersedes?** Traced via
  `session-history-replayer.service.spec.ts:498-524` — older superseded,
  released twice (idempotent no-op on the second call since `closeFence`
  checks `held.claim === claim.claim`), buffer still held by newer; newer then
  released twice (also idempotent), buffer delivered exactly once, in arrival
  order (`kept` before `more`). No loss, no duplication, through two levels of
  double-release.
- **Fence can stay open if the loader returns early before the try, or a
  caller uses `claim()` without `release()`.** `switchSession` has two early
  returns before entering the `try` (`session-loader.service.ts:602-608` dup
  guard, `:612-619` already-live-tab reuse) — both are before
  `replayClaim` is declared and before `claim()` is ever called, so there is
  no fence to leak there. Every path from `claim()` onward is inside the
  `try`/`finally`, and `release()` is unconditional in `finally`
  (`:820-823`). No caller of `historyReplayer.claim` other than
  `SessionLoaderService.switchSession` was found in the diff
  (`grep -rn "historyReplayer.claim("` → one call site), so "claim without
  release" is not reachable from the current call graph. If a future caller
  is added, nothing in the API prevents it forgetting `release()` — worth a
  one-line lint/convention note, not a defect in this batch.
- **Fence spanning a slow RPC (up to `RESUME_TIMEOUT_MS` 120 s) holding a
  sibling tile's live stream.** Confirmed the fence is keyed by session, and
  `findFence` matches by held tab OR by session id on the event/payload
  (`session-history-replayer.service.ts:264-276`), so a sibling tile
  rendering the _same_ session during a 120 s resume has its live events
  buffered too — by design, per the doc comment
  (`session-history-replayer.service.ts:56-60`) and the two-tab spec
  (`:456-497`). A sibling tile on a _different_ session is unaffected (`fences`
  is a `Map<sessionId, LiveEventFence>`, one entry per session). This is the
  intended scope, not a new problem; note that a 120 s worst case is also the
  practical bound on how stale a sibling tile's transcript can look before the
  fence's own 2,000-event overflow forces it through anyway.
- **2,000-event overflow order-safety.** Unchanged from delta 1: at the bound,
  `deferLiveEvent` warns, `splice(0)`s and delivers the full buffer in arrival
  order, sets `overflowed = true`, and lets every later event for that fence
  bypass the fence (`session-history-replayer.service.ts:244-259`,
  spec `:630-661`). Order-safe among the buffered events and among the
  post-overflow events separately; the two streams are not merged/re-sorted
  against each other, which is the documented trade (interleaving over loss).
- **`yieldToMacrotask` semantics on the new path.** Re-confirmed unchanged
  from delta 1: microtask resolve when `MessageChannel` is absent
  (`macrotask-scheduler.ts`, spec `:284-305`), rejection when the post throws
  (spec `:261-282`). The developer's fix did not touch this primitive; only
  where `claim()`/`openFence` are called changed.

## Blocking issues

None.

## Serious issues

None. S2 is closed (see above).

## Moderate and minor issues

- M-new-1 (carried from delta 1, unchanged) — no spec pins "tab A fails while
  tab B (same session) is still mid-replay." `session-history-replayer.service.ts`
  `holders: Set<number>` refcounting is exercised only by all-succeed and
  one-superseded-by-newer-claim combinations. Recommend one spec before this
  is trusted under a real two-tile failure.
- New-moderate — `apps/ptah-cli/src/cli/commands/interact.ts:548-549`'s
  limit-trim (`all.slice(all.length - limit)`) is dead in practice: `all`
  (`resp.result.messages`) is always `[]` per `SessionLoadResult`, and the
  test that used to exercise a non-empty trim was rewritten to the empty-array
  shape rather than replaced with one that pins "trim is a no-op given the
  real backend contract." Not a functional defect — the code path is
  unreachable with harmful input, not wrong — but it is exactly the kind of
  code this batch's own S1 fix (base review) was about: a shape kept "for
  existing A2A callers" whose behaviour no test protects going forward. Either
  remove the trim (simplest, since nothing can exercise it) or add one
  regression spec asserting `session:load`'s `messages` is always `[]` so a
  future change to `SessionLoadResult` that resurrects non-empty `messages` is
  caught rather than silently re-enabling untested trim logic.

## Data flow

1. `switchSession(sessionId, opts)` called → dup-guard / live-tab-reuse early
   returns (no claim yet) — OK.
2. `session:load` RPC → tab resolved/opened → `historyReplayer.claim(tabId,
sessionId)` — fence opens here, before any network round trip for
   `chat:resume` — OK, this is the fix.
3. `chat:resume` RPC sent with `activate` conditionally set → backend reads
   events from disk, then (if `activate`) starts/joins the live query, then
   responds — OK, fence already covers this window from step 2.
4. Reply received → `isCurrent(replayClaim)` checked; if superseded, return
   early (fence closes in `finally`) — OK.
5. `events` handed to `historyReplayer.replay(...)` → chunks of ≤250 processed
   synchronously, `yieldToMacrotask()` between chunks, claim/tab/session
   re-checked after each yield → `finalizeSessionHistory` → `closeFence` →
   `'replayed'` — OK, matches spec.
6. Any live `chat:chunk` for the session/tab arriving between steps 2 and 5
   (inclusive) is buffered by `deferLiveEvent` (wired at
   `chat-message-handler.service.ts:464`, real caller, not just the spec
   double) → delivered in arrival order immediately after step 5's
   finalization, before `setStatus('loaded')` — OK, this is the closed gap.
7. `finally`: `release(replayClaim)` — idempotent, closes any fence this claim
   still held (only relevant on non-`replayed` exits, since `replay()` already
   closed it on success) — OK.

## Requirements fulfilment

| Requirement                                                                    | Status   | Gap                                              |
| ------------------------------------------------------------------------------ | -------- | ------------------------------------------------ |
| Fence covers the `chat:resume` round trip, not just inter-chunk gaps (S2 fix)  | COMPLETE | None found                                       |
| Exactly-once, in-order live-event delivery under supersession/failure/overflow | COMPLETE | None found                                       |
| `chat/CLAUDE.md` accurately describes fence coverage                           | COMPLETE | None found                                       |
| CLI fixtures reflect the real `SessionLoadResult` (`messages: []`) contract    | COMPLETE | Trim logic now untested dead code (see moderate) |
| Two-tab same-session failure/mid-replay interleave                             | PARTIAL  | No spec (M-new-1, carried)                       |

Implicit requirements not addressed: a lint/convention guard against a future
`claim()` call site that forgets `release()` — currently correct only because
there is exactly one call site today.

## Edge cases

| Case                                                          | Handled                               | How                                                                | Concern                        |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Live event during RPC round trip (the S2 case)                | YES                                   | Fence opens at `claim()`, before RPC send                          | None                           |
| `chat:resume` fails/times out/empty during round trip         | YES                                   | Buffer delivered on `release()` after failure branch               | None                           |
| Newer resume of same session supersedes before its own replay | YES                                   | Fence hold transfers via `openFence`'s previous-hold handoff       | None                           |
| Newer resume of a different session takes the tab             | YES                                   | Old fence loses its only holder, delivers immediately, normal path | None                           |
| Two tabs, same session, one fails mid-replay                  | NO (structurally plausible, untested) | Refcount `holders` set                                             | M-new-1                        |
| 2,000-event fence overflow                                    | YES                                   | Warn, flush, bypass fence after                                    | Documented trade, not a defect |
| `yieldToMacrotask` post throws                                | YES                                   | Rejects like a throwing chunk; failure branch + release            | None                           |
| No `MessageChannel` (jsdom only)                              | YES                                   | Microtask resolve, order preserved, no real turn                   | Not a production path          |
| CLI `session.history` limit trim on non-empty messages        | N/A (unreachable)                     | Code present but `messages` always `[]`                            | Untested dead branch           |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: none blocking merge. The residual is M-new-1 — the two-tab,
  one-fails-one-replays combination for the same session is structurally
  sound by inspection of the refcounted `holders: Set<number>` but has no
  direct test, so a future change to `leaveFence`/`closeFence` could regress
  it silently.
- Required fixes before merge: none blocking. Recommended before this batch is
  considered fully closed: (1) one spec pinning "tab A fails, tab B (same
  session) still mid-chunk" (M-new-1, carried two deltas now); (2) either
  delete `interact.ts:548-549`'s now-dead trim or add a spec that pins
  `session:load`'s `messages` as always `[]`, so the trim's dead status is
  asserted rather than incidental.
- Everything the base review and delta 1 flagged as open (S2) is now closed
  with direct evidence: the fence opens at `claim()`, strictly before
  `chat:resume` is sent, and both the collaborator in isolation and the real
  `SessionLoaderService` call path have specs that fail if that ordering
  regresses.
