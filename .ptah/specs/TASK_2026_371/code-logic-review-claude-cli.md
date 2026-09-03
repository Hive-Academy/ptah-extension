# Code logic review — TASK_2026_371 D1 (commit `386fe012b`)

**Reviewer:** independent logic review, no shared context with the implementer.
**Scope:** `session-turn-state.registry.ts`, `session-turn-state.registry.spec.ts`,
`chat-stream-broadcaster.service.spec.ts`. The `vim-mode.service.ts` half of the
commit is out of scope. Comment-only edits are in scope only where a comment
claims something the code does not do.

**Score: 8.0 / 10**
**Verdict: APPROVE WITH FOLLOW-UP.** The fix is correct and it closes D1 end to
end. One comment in the new code states a defence that is false, and the gap it
hides can reproduce D1 on a live tab. Two smaller items are recorded below.

---

## What I verified, and the answer to each question in the brief

### 1. Is the new invariant total? — Yes, except under eviction

Claim under test: every revision issued under a session id is strictly greater
than every revision previously issued under that same id.

The invariant rests on one property: **`record.state.revision >= revisionFloors[id]`
holds at every point where `commit` reads it.**

- `ensure` (`session-turn-state.registry.ts:357`) seeds a new record at
  `revisionFloors.get(sessionId) ?? 0` — equal, never below.
- `commit` (`:374-386`) sets `revision = record.state.revision + 1` and then
  calls `noteFloor` with that value, so record and floor stay equal.
- `noteFloor` (`:396-404`) raises the floor with `Math.max`, so a floor never
  goes down.
- `rekey` (`:310-341`) stores `baseline = max(merged record revision,
placeholder floor, real-id floor)` onto the record and onto the floor. A
  `max` can only raise both.
- `recordStop` / `recordFailure` call `ensure` but never `commit`, so they
  issue no number.
- `applySnapshot` (`:250`) reads `records.get` directly and returns `null` when
  there is no record, so it cannot create a record below a floor.

I walked `rekey` through all four record combinations, each crossed with a
floor present or absent on either id:

| `from` record | `to` record | Result                                                               | Re-issue possible?                                                      |
| ------------- | ----------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| present       | present     | `mergeRecords`, then raised to `baseline`                            | No. `baseline >= max(both records, both floors)`.                       |
| present       | absent      | `merged = from`, raised to `baseline`                                | No. This is the resumed-alias case pinned at `spec:414`.                |
| absent        | present     | `merged = to`, raised to `baseline`                                  | No. This is the branch added beyond the plan; see below.                |
| absent        | absent      | no record written, `noteFloor(realId, baseline)` when `baseline > 0` | No. The placeholder floor folds forward and `ensure` will seed from it. |

The third row is the one the brief asked me to scrutinise hardest, because
pre-change `rekey` returned early on a missing placeholder record
(`if (!from) return;`) and now it rewrites the live real-id record. I could not
build a re-issue from it. The rewrite is always a `Math.max` upward, and
`baseline` can only exceed `to.state.revision` by taking the value of
`placeholderFloor`, which was issued under the **placeholder** id and never
under the real id. Skipping numbers upward is harmless to a `revision > last`
consumer.

I also checked the one case where a revision number is attached to a second
state object: `mergeRecords` (`:145-162`) can return the placeholder's
`generating` state carrying the canonical record's higher revision. That state
is never emitted as a chunk. It is only readable through `get()`, which
`session:status` returns (`session-rpc.handlers.ts:1155`). The webview drops it
as `revision <= last`, and the next real commit self-heals at `baseline + 1`.
This behaviour is unchanged by the commit and is not a finding.

The single hole is eviction — finding F1.

### 2. Eviction — the defending comment is false

Answered in full as finding F1 below. The short answer: **yes, LRU eviction can
drop the floor of a session whose tab is still live, and the comment that
defends it is false.**

### 3. Does the fix close the defect end to end? — Yes

I traced one resumed turn:

1. `ResultMessageTransformer.transform` (`result-message.transformer.ts:25`)
   calls `settleTurn(sessionId)` with the real session id and wraps the result
   with `toTurnStateEvent`.
2. `settleTurn` calls `ensure`, which seeds from `revisionFloors[S]`. That
   floor survived the previous loop's `clear`, so `commit` issues `floor + 1`.
3. `ChatStreamBroadcaster.streamEventsToWebview` forwards the event as a
   `CHAT_CHUNK` (`chat-stream-broadcaster.service.ts:155-166`), keyed under
   `turnSessionId`, which the event's own `sessionId` already set at `:186`.
4. `TurnStateApplier.apply` (`turn-state-applier.service.ts:77-96`) calls
   `TabManagerService.canApplyTurnState`.
5. `acceptsTurnState` (`tab-manager.service.ts:1230-1250`): ownership passes
   (`bound === sessionId`), `lastTurnStateSessionId === sessionId` so there is
   no early accept, and the test is `revision > last`.

The tab's `last` is a revision it accepted, and every accepted revision was
issued through `commit`, so `floor >= last`. The resumed turn therefore issues
`floor + 1 > last` for `generating` and `floor + 2` for the terminal `idle`.
Both are now accepted where both were previously dropped. `applyTurnState` sets
`status: 'loaded'` on `idle` (`:1173-1176`), which releases the stuck spinner.
**The fix closes D1.**

I also confirmed the frontend reset sites the fix now depends on. The four
places that clear `lastTurnStateRevision` — `resetTab` (`:965`),
`applyNewConversationDraft` (`:1280`), `applyNewConversationStreaming` (`:1300`)
and `applyResumingSession` (`:1927`) — all clear `lastTurnStateSessionId` too,
and none of them runs on the `chat:continue` auto-resume path. That agrees with
the defect report and with the new comments.

### 4. Growth left behind — real, small, pre-existing

Answered as finding F2 below.

### 5. Test honesty

Four of the six new registry cases and the new broadcaster case fail against
the pre-change registry by behaviour, not only through the missing export. I
checked each by hand-executing the pre-change code from the diff:

| Case                                                             | Pre-change result                          | Fails pre-change?                  |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `spec:414` does not resurrect a lower baseline under the real id | `settleTurn` returns 2, not 5              | Yes                                |
| `spec:434` the same under the placeholder id                     | `markGenerating(SESSION)` returns 1, not 3 | Yes                                |
| `spec:496` does not restart the counter                          | `1 > 1` is false                           | Yes                                |
| `spec:505` strictly increasing across a clear                    | `[1,2,1,2,1]`, not `[1,2,3,4,5]`           | Yes                                |
| `spec:521` leaves the floor per session                          | `1` — identical                            | **No. It passes on the old code.** |
| `spec:527` bounds the floor map                                  | `session-256` returns 1, not 2             | Yes                                |
| `broadcaster spec:823` next loop starts above the last revision  | `1 > 2` is false                           | Yes                                |

`spec:521` is a legitimate scoping guard (a floor must not leak between
sessions), not a regression pin. I flag it only because the brief asked.

The broadcaster case carries an explicit non-vacuity assertion
(`expect(h.turnState.get(SESSION_ID)).toBeUndefined()`), which is the right
shape. It proves the record really was torn down before the second query runs.

One assertion pins the implementation rather than the behaviour: finding F3.

I ran the suites. `npx nx run-many -t test -p @ptah-extension/agent-sdk`
reported `Running target test for 1 project`, 84 suites, 1387 tests passed, 0
failed. The `rpc-handlers` target reported 91 suites, 2641 tests passed, 0
failed.

---

## Findings, most severe first

### F1 — MEDIUM. Floor eviction can strand a live tab, and the comment that defends it is false

**File:** `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:96-109`
(the `REVISION_FLOOR_MAP_LIMIT` doc block) and `:396-404` (`noteFloor`).

The comment states two things. Both are wrong.

> "losing it restarts that one session's counter, which is exactly what a
> process restart does — and a restarted webview has no `lastTurnStateRevision`
> for it either, so it accepts anything."

A process restart and an eviction are not the same event. On a process restart
the webview reloads, and `lastTurnStateRevision` is excluded from persistence
(`libs/frontend/chat-state/src/lib/tab-persistence.ts:66-71`, and
`projectTabForPersist` at `:92-102`), so a restored tab really does start at
`undefined` and accepts anything. An eviction happens **inside a running
process, with the webview still up and the tab still holding its revision.**
Nothing in the frontend clears `lastTurnStateRevision` on the auto-resume path.
The defence does not apply to the case that eviction actually creates.

> "Same number and same shape as `SURFACE_REVISION_MAP_LIMIT` … retaining
> floors for more sessions than the consumer keeps revisions for buys nothing."

`SURFACE_REVISION_MAP_LIMIT` bounds `TurnStateApplier.surfaceRevisions`
(`turn-state-applier.service.ts:57`, `:159-171`), which is consulted **only for
events that resolve no tab**, and whose only effect is the sidebar liveness dot.
The consumer the floor exists to stay ahead of is `tab.lastTurnStateRevision` on
`TabState`, which has no bound and no eviction at all. The symmetry argument
compares the floor against the wrong map.

**Failure scenario (concrete).**

1. Tab `T` is bound to session `S`. The last turn ended cleanly: `idle@120` was
   accepted, so `tab.lastTurnStateRevision = 120` and
   `tab.lastTurnStateSessionId = S`. `ChatStreamBroadcaster`'s `finally` called
   `turnState.clear(S)`, so `records` holds no entry for `S` and
   `revisionFloors[S] = 120`.
2. The user leaves the tab open. In the same Electron process, 256 other session
   ids each commit at least one turn state after that moment — other chat tabs,
   Thoth cron fires, gateway inbound sessions, tribunal lanes, surface sessions.
   Every commit runs `noteFloor`, and each new id evicts
   `revisionFloors.keys().next().value` (`:400`). `S` has not been written since
   step 1, so it becomes the victim.
3. The user sends a follow-up in tab `T`. `chat:continue` →
   `autoResumeIfInactive` starts a fresh query under the **same** id `S`.
4. `markGenerating(S)` → `ensure` finds no record and no floor → seeds `0` →
   issues `generating@1`. `settleTurn(S)` issues `idle@2`.
5. `acceptsTurnState` (`tab-manager.service.ts:1230-1250`): ownership passes,
   `lastTurnStateSessionId === S` so there is no early accept, and `1 > 120` and
   `2 > 120` are both false. **Both events are dropped before any side effect.**
6. The tab keeps `status: 'streaming'` from the optimistic `markStreaming`
   (`:1081-1090`, which does not reset the revision). The Stop button and the
   streaming quotes stay on for good.

That is D1, reproduced exactly, on a fix that is supposed to make it impossible.
The commit narrows the defect from "every resumed turn" to "a resumed turn on a
session that has been quiet for 256 sessions' worth of traffic", which is a
large improvement. But the residual case is not theoretical on a long-lived
Electron process with cron or gateway traffic, and its symptom is a permanently
stuck tab with no recovery short of a restart of the app.

**What I would ask for.** At minimum, correct the comment, so the next reader is
not told the gap is already covered. Beyond that, the cheapest real fix is a
frontend heal rather than a bigger map: when a bound tab rejects a `turn_state`
whose `revision` is lower than `last` **and** whose phase is terminal, the tab
is provably out of step with a backend that says the turn ended, and holding
`streaming` is the worse of the two errors. A larger
`REVISION_FLOOR_MAP_LIMIT` only moves the threshold.

### F2 — LOW. The `records` map is unbounded and leaks one entry per user abort

**File:** `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:410-415`,
with `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:147-158`.

**Failure scenario.** The user presses Stop. `chat:abort` ends the SDK session
record. The broadcast loop sees the abort and reaches its `finally`.
`endSessionIfTokenMatches` finds no record (`session-control.service.ts:151-153`
returns `false` when `!rec`), so `ended` is `false`, so `recordReplaced` is set
to `true` (`:395`), so the guard at `:412` skips **both** `turnState.clear`
calls. The `TurnRecord` for that session stays in `records` for the life of the
process. The task's own evidence confirms this on the real abort path:
`context.md` records log line 475, "record was replaced before stream exit", on
a user abort.

**Judgement.** Real, but small, and not introduced by this commit. One leaked
`TurnRecord` is a phase string, three short arrays, two null snapshot slots and
a boolean — on the order of a few hundred bytes. A user needs thousands of
aborts in one process to reach a megabyte. It is not a crash risk and it does
not corrupt state: a leaked record makes `ensure` reuse it, so the counter stays
monotonic.

Two things make it worth its own task rather than a shrug:

- `session:status` (`session-rpc.handlers.ts:1155`) keeps returning a
  `turnState` for sessions that ended long ago, because the record is still
  there.
- **It is coupled to F1.** The leaked record is what protects an aborted session
  from the eviction hazard, because `ensure` never re-seeds from the floor. A
  fix for this leak alone would _widen_ F1. Whoever picks it up must fix both
  together.

The commit's own rationale for bounding `revisionFloors` (`registry.ts:33-35`:
"a map that only ever grows is a leak whatever its retention rule") applies with
more force to the larger map beside it. To bound the small one and leave the big
one is an inconsistency worth naming, not a defect in this change.

### F3 — LOW (test honesty). The eviction case does not pin the LRU rule it is named after

**File:** `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.spec.ts:527`
("bounds the floor map, evicting the least recently written entry").

The loop writes each of the 257 sessions exactly once, so insertion order and
write recency are identical. Every assertion in the case still passes if
`noteFloor` drops its `delete`-then-`set` re-insertion and eviction becomes
plain first-inserted-first-out. That re-insertion is exactly the load-bearing
part of the comment at `registry.ts:389-395` — "Map key order IS write recency,
which makes the eviction below drop the floor nobody has written for longest
instead of the oldest session still in use".

**The missing case.** Write floors for `session-0` through `session-255`. Commit
a second turn on `session-0`, so it is the most recently written. Then write
`session-256`. Under the current code the victim is `session-1`. Under
first-inserted-first-out it is `session-0`, the session most recently in use.
Nothing distinguishes the two today.

The second half of the same comment ("re-inserting an existing key also shrinks
the map first, so an update can never evict anything") is unpinned in the same
way: a full 256-entry map plus a commit on an existing key must leave all 256
entries in place.

Given F1, this matters more than an ordinary coverage gap. Eviction by write
recency is the only thing that keeps the victim to a session that is genuinely
quiet.

---

## Observation, not a finding

`rekey` deletes the placeholder id's floor unconditionally (`:315`), and the
spec pins that ("The dead alias keeps no floor of its own", `spec:452`). For
every tab-resolved session this is safe: a tab id is re-used as a placeholder
session id only after `resetTab`, `applyNewConversationDraft` or
`applyNewConversationStreaming` cleared the tab's `lastTurnStateRevision`, so
the tab accepts anything the restarted alias counter emits. For
**surface-owned** sessions the equivalent reset does not exist —
`TurnStateApplier.surfaceRevisions` has no clear hook — so a re-used surface
placeholder id could see its events dropped. I did not confirm that any surface
re-uses a placeholder id, the consequence is limited to the sidebar liveness dot
(`turn-state-applier.service.ts:148-156`), and the pre-change code restarted
every counter anyway, so this is not a regression. I record it only because the
brief asked for `rekey` in every combination.
