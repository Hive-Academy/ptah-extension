# Batch BF2 report: per-turn source snapshots (Phase B+C fixes)

## 1. Backend evidence: a turn that changed no files

- `libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.ts:235-236`: `diffSnapshots(...)`, then `if (changed.length === 0) return;`. Nothing is persisted (`store.append` :249) and nothing is pushed (`broadcastMessage(GIT_TURN_CHANGE_SET)` :260-261).
- The same silent return happens for a non-repo directory (:216, :219) and for an unavailable after-status (:220-225, warn log only). The class doc says so at :20-22.
- Recording runs on both `onTurnEnded` and `onTurnFailed` (:144, :147). `turnEndedAt` is the turn-end event's `timestamp` (:242-243).
- `session:turnEnded` and `session:turnFailed` carry that same `timestamp` (`libs/shared/src/lib/types/sdk-hook.types.ts:114-122, 132-140`, broadcast by `session-lifecycle-notifier.ts:116-141`).
- The store reconciled on `session:turnEnded` only through `requestReconcile`. That returns at once for a session with no sets (`change-set.store.ts` `rootFor`), so it could never tell "no set yet" from "no set ever".
- Backend recording is unchanged (Req 1.4).

## 2. Major 1 mechanism: `ChangeSetStore.settledThrough(sessionId)`

The fix is frontend only, in `libs/frontend/chat/src/lib/services/change-set/change-set.store.ts`. `settledThrough` is a reactive backend timestamp at or before which every ended turn's set is either already in `changeSetsFor` or will never arrive. It is `-Infinity` until the session is settled for the first time.

- **First read:** the session's first `git:turnChangeSets` read settles through the moment that read started (`load`, :395). Later reads, such as a re-shown tab, never move it, because one may start while a turn is still streaming.
- **Turn end:** `session:turnEnded`, and `session:turnFailed` (newly handled, settle only), start one grace timer per session (`startGrace`, :472). After `TURN_CHANGE_SET_GRACE_MS = 5_000` (:37) the timer settles through the payload `timestamp`.
- **Push:** a `git:turnChangeSet` push whose `turnEndedAt` reaches the pending end settles at once and clears the timer.
- **Scope:** only sessions already read or active are tracked, the same rule as a push.
- **Release paths:** each timer is cleared on `DestroyRef`. On session eviction (`forget`) both the timer and the mark are dropped.
- **Snapshot rule** (`transcript-turn-snapshots.ts`, `resolveChangeSet`): the newest finalized turn with no covering set is `pending` only while `transcriptOrderKey(end message) > settledThrough`. After that it is `unavailable`, per Req 3.4 ("no change set" is listed there). An older turn with no covering set is `unavailable` at once, as before.
- **Clocks:** both sides use backend time. The order key is the root `message_start` stamp; the first-read mark uses the renderer's `Date.now()`, which runs on the same machine in Electron.
- **Unavailable versus empty:** a no-op turn has no `TurnChangeSet` at all, so it resolves to unavailable, not Req 3.6's empty state. Empty applies only to an available set with zero files.

## 3. Extraction layout

- **CREATED** `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-snapshots.ts` (214 lines). It has no Angular dependency and holds:
  - `changeSetForMessage`, the anchored-set fallback and `resolveChangeSet`;
  - `PENDING_TURN_SNAPSHOT` and the per-message snapshot builder;
  - `class TranscriptTurnSnapshots`, whose `compute(sessionId, sources)` owns the identity-stable cache.
- **Cache pruning:** the cache is rebuilt on every compute, so only turns still present stay cached. It starts over on a session change.
- **Turn grouping:** it reuses `groupTurns`. `TranscriptTurn` gained `assistants` in `transcript-turns.ts`, and the duplicate `assistantRuns` is deleted.
- **CREATED** `transcript-turn-snapshots.spec.ts`, with 11 tests:
  - window rule, empty map, user messages excluded;
  - open turn shares one pending snapshot;
  - L-11 usage;
  - newest turn pending until settled, then unavailable;
  - older turn unavailable;
  - anchor fallback;
  - identity kept across recomputes, and only the pushed turn rebuilt;
  - prune;
  - session reset.
- **MODIFIED** `chat-transcript.component.ts`, from 1120 to 936 lines. `ptahUiSnapshots` is now thin `computed` wiring: the Electron gate, the freeze-while-hidden (`_frozenPtahUiSnapshots`, unchanged) and one `compute` call. `_frozenAnchors` and `_frozenTurnTestsAnchors` are untouched.
- **MODIFIED** `testing/transcript-spec-harness.ts`: the store stand-in gained `settledThrough`, an optional signal that defaults to `-Infinity`.

## 4. L-11 decision

`implementation-plan.md:908-909` says L-11: "`$usage` uses the block's own message". Line 232 says the same ("`$usage` = the block's own message"). The reviewer was right.

- Each assistant message of a finalized turn now gets its own snapshot object. `diff`, `tests`, `state` and `incomplete` are shared with the turn snapshot; `usage` is the message's own.
- Usage comes from `buildTurnSourceSnapshot({ turnMessages: [], blockMessage, changeSet: null, finalized: true }).usage`. This uses the public API without walking the turn's trees again.
- A mid-turn message without tokens or cost shows `$usage` as unavailable.
- An open turn still shares the one pending constant.
- The old spec, "turn-ending usage, one snapshot per turn", was rewritten to the L-11 behaviour.

## 5. Snapshot-refresh rule (`ptah-ui-block.component.ts`)

`isSettled(snapshot)` is true when:

- the snapshot is `null` (no host data), or
- `state === 'terminal'` and none of `diff`, `tests` or `usage` is `pending`.

Behaviour:

- **Freeze on a settled snapshot:** the block detaches after render, as before.
- **Freeze on an unsettled snapshot:** the block keeps change detection attached and sets `awaitingSettle`.
- **Settling:** one constructor effect reads the snapshot only while `awaitingSettle` is true. When the snapshot settles, the effect runs the pipeline exactly once (`frozen.set(resolve())`), clears `awaitingSettle` and detaches after render. After that the effect tracks only a signal that never changes again, so there is no further work.

"Settled" also requires `$diff` not to be pending. A terminal turn whose push is still in flight therefore waits for the push or the 5 s settle, and does not lock in `pending`.

- **Existing specs:** the frozen-block and 12-block live-cap specs freeze on a `null` snapshot, so they are unchanged and pass.
- **New spec** ("re-resolves a frozen block exactly once when its pending snapshot settles"), in order:
  - pending: 1 run;
  - terminal with `$diff` pending: still 1 run, not detached;
  - settled: 2 runs, still a snapshot, "No files changed this turn", detached once;
  - a later change: still 2 runs.

## 6. Other spec changes

- **`chat-transcript.ptah-ui.spec.ts`:**
  - The late-push e2e test now models a live turn (`LIVE_AT = Date.now() + 60_000`). With the real store, the first read settles through its own start time, so the old fixture (key 110) is now correctly a settled, reloaded turn.
  - Added a harness test: pending, then unavailable once `settledThrough` passes the turn.
  - Added a real-chain test: a reloaded newest turn with no set shows "unavailable", not "pending".
- **`change-set.store.spec.ts`:** added 7 "settled through" tests:
  - unsettled until the first read;
  - a later read does not move the mark;
  - grace expiry;
  - a push settles at once and drops the timer;
  - `turnFailed`;
  - a payload without a timestamp, or for an unopened session, is ignored;
  - destroy clears the grace timer.

## 7. Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat,@ptah-extension/chat-ui --parallel=1` exited 0, with "Successfully ran targets typecheck, test, lint for 2 projects".

| Project                   | Test suites | Tests                               |
| ------------------------- | ----------- | ----------------------------------- |
| `@ptah-extension/chat-ui` | 45 / 45     | 487 passed                          |
| `@ptah-extension/chat`    | 165 / 165   | 3027 passed, 2 skipped (3029 total) |

`npx prettier --write` was run on all 10 touched files. `electron-shell.review-dock` is not in these projects; no timeout appeared.

## Files

- MODIFIED `libs/frontend/chat/src/lib/services/change-set/change-set.store.ts` and `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.ptah-ui.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turns.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/testing/transcript-spec-harness.ts`
- CREATED `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-snapshots.ts` and `.spec.ts`
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts` and `.spec.ts`

## Residual notes

- A session's first-ever read that starts while one of its turns is already streaming leaves that turn's set unsettled until its own push. For example, a canvas tile opened on a running background session briefly shows `unavailable` before the push makes it `available`.
- A failed first read still settles, so the newest turn there shows unavailable rather than staying pending.
