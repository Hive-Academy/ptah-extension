# Code Logic Review — Batch 12 (`TASK_2026_453_1eb4`)

Scope: uncommitted diff under `libs/frontend/chat` only (Tasks 12.1-12.4). Backend/shared/CLI
changes (Batch 10, in progress) explicitly excluded per instructions.

## Summary

| Metric              | Value                    |
| -------------------- | ------------------------ |
| Overall score         | 8/10                      |
| Assessment            | APPROVED WITH MINOR       |
| Blocking issues       | 0                         |
| Serious issues        | 0                         |
| Moderate issues       | 2                         |
| Failure modes found   | 3 (all already mitigated) |

## Five logic questions

### 1. How does this fail silently?

- `HistoryPagingService.recordTail` (`history-paging.service.ts:36-41`) is invoked unconditionally
  after `applyCliSessions` even on a resume whose `events.length === 0` branch later runs
  `applyResumeFailure` (`session-loader.service.ts:807-816`). It sets `olderHistoryCursor` to
  `null` on a tab that is about to be marked failed. Not user-visible (the tab shows a failure
  state regardless) and self-corrects on the next successful resume, but it is a state write with
  no purpose on a path already headed for failure — a latent trap for a future reader who assumes
  `recordTail` runs only on success.
- `runLoadOlder`'s catch-all (`history-paging.service.ts:87-90`) swallows any exception (including
  ones from `replayOlderPage` unrelated to page building, e.g. a `TabManagerService` throw) into a
  generic `'failed'` outcome with only a `console.error`. This matches the spec ("failed keeps
  cursor") and the degradation-audit "no literal-return catch" rule, but it does mean a defect
  inside `prependHistoryMessages` itself would present to the user identically to a network
  hiccup — acceptable per D14, not a defect of this batch.

### 2. What user action produces unexpected behaviour?

- Clicking "load earlier" (once Batch 13 wires the affordance) while the tab is mid-resume fires
  the `chat:history-page` RPC to the backend before any local refusal check runs.
  `HistoryPagingService.loadOlder` (`history-paging.service.ts:41-59`) checks only
  `inFlight`/`olderHistoryCursor` before calling `this.rpc.call(...)`; the "refused while a claim
  is held" guard lives in `SessionHistoryReplayer.canContinueOlderPage`
  (`session-history-replayer.service.ts:399-410`), which runs only after the RPC round trip
  completes. The user sees no error (outcome resolves normally once the RPC returns, then
  `replayOlderPage` returns `'superseded'` and `onOlderHistoryRequested` does nothing) but a
  transcript read and IPC round trip is spent for nothing whenever this race occurs. See Moderate-1.
- Rapid repeat clicks are safe: `inFlight` map dedups per tab id, second call returns the same
  promise (`history-paging.service.ts:42-43`; proven by
  `history-paging.service.spec.ts:83-115`).

### 3. What input data produces a wrong answer?

- None found for in-scope files. Turn-boundary correctness (`selectHistoryPage`) is shared-lib
  code, out of scope here, and was already reviewed/tested at C6.
- `buildAnchorHint`'s new `occurrenceFromEnd` loop (`chat-view.component.ts:971-978`) uses the same
  trim/compare rule as the existing `occurrence` loop, so a message whose `rawContent` differs only
  by trailing whitespace is still matched consistently in both directions — no drift between the
  two counts.

### 4. What happens when a dependency fails?

- `HistoryMessageBuilder.accumulate` throwing mid-page (malformed event, dedup-store failure) is
  caught by the replayer's `try/finally` (`session-history-replayer.service.ts:243-289`):
  `clearCache(cacheKey)` and `releaseReplayAdmission()` both still run, the throw propagates, and
  `HistoryPagingService.runLoadOlder`'s catch converts it to `'failed'` with the cursor untouched.
  Pinned by `session-history-replayer.older-page.spec.ts:219-238`, which also proves admission is
  released (a second `replayOlderPage` call completes immediately after the failure).
  `TabManagerService.prependHistoryMessages` is never reached, so a throwing builder cannot commit
  a partial page.
- `chat:history-page` RPC failure/timeout: `RpcResult.success === false` → `'failed'`, cursor kept
  (`history-paging.service.ts:78-79`). `HISTORY_CURSOR_STALE` → cursor forced to `null`,
  `'stale'` (`:74-77`), so a real backend rewrite cannot be retried into a loop.
  `yieldToMacrotask` rejecting during a chunked older page (channel-post failure) is not
  independently tested for `replayOlderPage`, but it shares the exact `try/finally` structure that
  `replay()` uses for the same failure mode, which is tested elsewhere; low residual risk.

### 5. What is missing that the requirements never mentioned?

- The CLAUDE.md "Admission" bullet's FU-20a note ("global status may read `loaded` while a later
  replay waits") is unchanged, but the same global FIFO now also queues `replayOlderPage` calls.
  A `SessionManager.setStatus('loaded')` from one tab's completed resume can still fire while an
  unrelated tab's older-page load is queued behind it — the existing accepted risk now has one more
  producer of the race. `leftovers-inventory.md` B5 asked for this file to be "re-read after Batch
  12 since paging adds `replayOlderPage` admission"; the report does not record that re-read, and
  the CLAUDE.md text was not updated to mention the widened scope. Documentation gap only — FU-20a
  itself is already accepted with no fix planned.
- No UI-level guard (disabling the "load earlier" affordance during `historyReplaying`) exists yet
  in this batch — by design, since Batch 13 owns the template. Flagging here only so Batch 13's
  review confirms the button is disabled while `isReplaying(tabId)` is true, which would close the
  wasted-RPC gap in Q2 above at the UX layer even though the state layer already prevents any
  incorrect write.

## Failure modes

### Superseded older-page load after a wasted RPC round trip

- Trigger: user (or a future automated retry) calls `loadOlder(tabId)` while the tab holds an
  active resume claim.
- Symptom: one `chat:history-page` round trip and one transcript re-read on the backend, discarded
  with no user-visible error.
- Evidence: `history-paging.service.ts:41-59` (no pre-RPC claim check);
  `session-history-replayer.service.ts:399-410` (`canContinueOlderPage`, the only refusal point).
- Current handling: correct outcome (`'superseded'`, no state written), just late.
- Recommendation: non-blocking. If Batch 13's UI already disables the affordance during replay,
  this is unreachable in practice; otherwise consider exposing `isReplaying(tabId)` to
  `HistoryPagingService.loadOlder` as a cheap up-front guard.

### Throw during page accumulation

- Trigger: an event in an older page causes `HistoryMessageBuilder.accumulate` to throw.
- Symptom: `loadOlder` resolves `'failed'`; cursor unchanged so the user can retry.
- Evidence: `session-history-replayer.service.ts:243-289`; pinned by
  `session-history-replayer.older-page.spec.ts:219-238`.
- Current handling: correct — `finally` clears the cache key and releases admission before the
  promise rejects up to `HistoryPagingService`.
- Recommendation: none; this is the designed behaviour and is tested.

### Stale cursor after a compaction/rewrite

- Trigger: backend returns `HISTORY_CURSOR_STALE` for a cursor whose anchor no longer exists.
- Symptom: cursor forced to `null`; UI (Batch 13) hides "load earlier"; user is told to reopen.
- Evidence: `history-paging.service.ts:74-77`; `chat-view.component.ts:174-180`; pinned by
  `history-paging.service.spec.ts:129-143` and `chat-view.component.spec.ts` "reports stale
  history..." case.
- Current handling: correct, matches D14. No retry loop possible since `loadOlder` short-circuits
  to `'none'` once the cursor is `null` (`history-paging.service.ts:45-47`).
- Recommendation: none.

## Blocking issues

None found in the reviewed files.

## Serious issues

None found in the reviewed files.

## Moderate and minor issues

### Moderate 1 — `loadOlder` fires the RPC before checking claim/replay state

- File: `libs/frontend/chat/src/lib/services/chat-store/history-paging.service.ts:41-59`
- The refusal the acceptance criteria describe ("refused while a claim is held... both after
  admission and after each yield") is honoured, but only downstream in
  `SessionHistoryReplayer.canContinueOlderPage`. Nothing stops the RPC and transcript re-read from
  happening first. Not a correctness bug (no wrong state is ever written), but worth a one-line
  guard or an explicit note that Batch 13's UI is the intended backstop.

### Moderate 2 — FU-20a re-read (B5) not recorded

- File: `libs/frontend/chat/CLAUDE.md:78` (unchanged text at :74); `b12-codex-report.md` (no
  mention of B5).
- `leftovers-inventory.md` B5 and `batches.md:1240-1241` both call for FU-20a to be re-read once
  `replayOlderPage` admission exists, since the shared FIFO's scope widened. The report does not
  show this re-read happened, and the CLAUDE.md bullet was not touched to reflect that an
  in-flight older-page load can also be the "later replay" FU-20a refers to. Recommend a one-line
  addition to the Admission bullet, or an explicit note in the batch outcome that the re-read
  concluded "no new risk, still accepted."

### Minor — `recordTail` runs even on a resume that continues to a failure branch

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:769`
- `recordTail(resolvedTabId, resumeResult.data)` writes `olderHistoryCursor` before the
  `events.length === 0` / `!resumeResult.success` failure branch (`:807-816`) runs. Harmless (the
  tab ends up in a failure state regardless, and a later successful resume overwrites the cursor
  again), but it is a write with no purpose on that path. Not worth blocking on.

### Minor — `session-loader.cli-restore.spec.ts` deviation is disclosed and justified

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.cli-restore.spec.ts:112-119`
- Task 12.4 preferred this file stay byte-for-byte unedited; it required a `HistoryPagingService`
  test double because Task 12.1 (not 12.4) added the new constructor dependency to
  `SessionLoaderService`. The report flags this as a deviation and it is: injection-only, no
  assertion touched. Confirmed by reading the diff — accepted.

## Data flow

1. `SessionLoaderService.switchSession` sends `historyPage: tailRequest()` with `chat:resume`
   (`session-loader.service.ts:710`) — OK, additive, refresh path untouched (verified no other
   `historyPage`/`historyPaging` reference exists in the file outside these two sites).
2. After the existing `isCurrent(replayClaim)` stale-reply guard (`:728`), `recordTail` stores the
   cursor from the resume reply (`:769`) — OK, ordering matches AC 2.
3. `ChatViewComponent.onOlderHistoryRequested` → `HistoryPagingService.loadOlder` → dedup by
   `inFlight` map → cursor precondition → `chat:history-page` RPC — OK; no pre-RPC claim check
   (Moderate 1).
4. RPC result branches: stale → cursor `null`, `'stale'`; failure → cursor kept, `'failed'`;
   success → `SessionHistoryReplayer.replayOlderPage` — OK, matches D14 exactly.
5. `replayOlderPage`: pre-admission refusal check → admission (shared FIFO with `replay()`) →
   post-admission refusal check → chunked `accumulate` with a refusal re-check after every yield →
   `build` → `prependHistoryMessages` (reads current `tab.messages` synchronously, no snapshot held
   across an await) → `finally` always clears the page cache key and releases admission — OK, all
   claims in Task 12.1 AC verified by direct code reading, not just the report's assertions.
6. `TabManagerService.prependHistoryMessages` (pre-existing, Batch 11) dedups by id and writes
   `messages` + `olderHistoryCursor` in one `updateTabInternal` call — OK, confirmed still true,
   unmodified by this batch.

## Requirements fulfilment

| Requirement                                                          | Status   | Gap                                             |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| `tailRequest()` uses `HISTORY_TAIL_PAGE_EVENTS` (D11)                   | COMPLETE | none                                              |
| Loader sends `historyPage`, records cursor after `isCurrent`, refresh untouched | COMPLETE | none |
| `replayOlderPage` never touches `replayingTabIds`                      | COMPLETE | none (verified: no call to `markReplayStarted`/`_replayingTabIds` in the new method) |
| Refusal before/after admission and after every yield                   | COMPLETE | pre-RPC refusal is absent (Moderate 1), but that is a `HistoryPagingService` concern, not the replayer's AC |
| Admission released in `finally`                                        | COMPLETE | none |
| `accumulate()`+`build()` in one outer `try/finally` calling `clearCache`| COMPLETE | none |
| No `tab.messages` snapshot held across an await before prepend         | COMPLETE | none |
| `loadOlder` stale/failed/none semantics (D14)                          | COMPLETE | none |
| In-flight dedup of `loadOlder`                                         | COMPLETE | none |
| `occurrenceFromEnd` on `buildAnchorHint`                                | COMPLETE | none |
| Stale/failed UX via `showActionError`, no automatic resume              | COMPLETE | none |
| Rule 7 Tail paging bullet (D12)                                        | COMPLETE | none |
| Task 12.4 B3/B4 specs pin real ordering (not vacuous)                   | COMPLETE | mutation-removal claims in the report were independently corroborated by reading the guarded code paths (`canContinueReplay` post-yield check; replayer `finally` clearing the flag before the loader's catch runs `applyResumeFailure`) |
| FU-20a re-read (B5)                                                     | PARTIAL  | not recorded in the report or CLAUDE.md (Moderate 2) |

Implicit requirements not addressed: none beyond the two moderate notes above.

## Edge cases

| Case                                                       | Handled | How                                                                 | Concern |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------- | ------- |
| Cursor `null`/`undefined`                                     | YES     | `loadOlder` short-circuits to `'none'` before any RPC (`:45-47`)         | none |
| Two rapid `loadOlder(tabId)` calls                             | YES     | shared `inFlight` promise (`:42-43`); spec `history-paging.service.spec.ts:83-115` | none |
| Resume claims the tab while an older page is queued for admission | YES  | `canContinueOlderPage` re-check after admission; spec `session-history-replayer.older-page.spec.ts:186-217` | none |
| Session rebind or cursor change during a chunked older-page yield | YES  | re-check after every yield; spec `:162-184`                             | none |
| Accumulation throws before `build`                             | YES     | outer `try/finally` clears cache, releases admission; spec `:219-238`   | none |
| Compaction reload racing an in-flight tail replay (B3)         | YES     | pre-existing supersede + fence-delivery ordering; new regression spec `session-loader.service.spec.ts:2389-2448` | none |
| Throw mid tail-replay (B4)                                     | YES     | pre-existing `finally`-before-`applyResumeFailure` ordering; new regression spec `:2450-2545` | none |
| "Load earlier" clicked mid-resume (pre-Batch-13 affordance)    | PARTIAL | correctly refused at commit time, but after a wasted RPC round trip     | Moderate 1 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only residual risk (Moderate 1) is a wasted network round trip that
  the replayer's state checks already neutralize before any write, and it is very likely closed by
  Batch 13's UI gating.
- What a robust implementation would add: an up-front `isReplaying(tabId)` guard in
  `HistoryPagingService.loadOlder` so a mistimed click never reaches the RPC layer, and an explicit
  one-line record (here or in CLAUDE.md) that the FU-20a re-read the leftovers inventory asked for
  was actually performed and found no new risk.
