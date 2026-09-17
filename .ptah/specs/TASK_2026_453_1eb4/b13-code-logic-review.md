# Code Logic Review — `TASK_2026_453_1eb4` Batch 13

Scope: C13 "Load earlier" affordance. Reviewed the uncommitted diff only:
`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.{ts,html}`,
the new `transcript-older-history-sentinel.directive.ts` and
`chat-transcript.older-history.spec.ts`, and the orchestrator-approved
scope amendment in `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html,spec.ts}`
(the two protected read methods `hasOlderHistory`/`isOlderHistoryLoading` and their tests only).
Task 13.2 produced no code (stopped by guardrail; verified below). Read whole files, not only
the diff hunks, for `chat-transcript.component.ts`, `chat-view.component.ts` and
`history-paging.service.ts`.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 7/10                                   |
| Assessment            | NEEDS_REVISION                        |
| Blocking issues       | 0                                      |
| Serious issues        | 0                                      |
| Moderate issues       | 2                                      |
| Failure modes found   | 3                                      |

## Five logic questions

### 1. How does this fail silently?

- The frozen `vm` (`chat-transcript.component.ts:431-452`) is gated ONLY on
  `active()`. While a tab is inactive, `vm().hasOlderHistory` is whatever it was
  the last time the tab was active — a change in the `hasOlderHistory` INPUT
  while inactive (cursor flips from `null` to a string on late resume
  completion, or from a string to `null` after the tab's last page loads while
  backgrounded) produces no template update and no error; the button's shown/
  hidden state is simply stale until the tab reactivates. This is not a new
  failure class — `isStreaming`, `hasMessages` etc. are frozen the same way by
  design (comment at `:423-430`) — but it is silent by construction: nothing
  logs or surfaces the staleness, and no test pins that reactivation
  self-corrects `hasOlderHistory` specifically. In the one case that matters
  visually the host element carries `[class.hidden]="!active()"`
  (`chat-transcript.component.ts:153-154`), so a stale-shown button while
  inactive is not visible until the tab reactivates, at which point `vm()`
  fully recomputes (`:431-434`) and self-corrects before paint. See Failure
  modes below and Edge cases.
- `ChatViewComponent.hasOlderHistory(tabId)` (`chat-view.component.ts:176-181`)
  returns `false` for a `tabId` not present in `this._tabManager.tabs()`
  (active-workspace tabs only) even when the tab genuinely has an
  `olderHistoryCursor` and `HistoryPagingService.loadOlder` (which looks the
  tab up via `findTabByIdAcrossWorkspaces`, `history-paging.service.ts:47`)
  would serve it. The failure is silent: no button renders, no error, the
  affordance is just absent. See Serious/Moderate discussion below — I could
  not confirm this path is reachable today (see Moderate issue 1), but the
  divergence itself is real and unguarded by a test.

### 2. What user action produces unexpected behaviour?

- Clicking "Load earlier messages" twice in quick succession, or clicking it
  while an auto-load from the sentinel is in flight: both routes call
  `ChatViewComponent.onOlderHistoryRequested` → `HistoryPagingService.loadOlder`,
  which dedups on a synchronous `inFlight` map check before the first `await`
  (`history-paging.service.ts:43-46`) — verified no double RPC call is
  possible even before the `olderHistoryLoading` signal round-trips back to
  disable the button (traced the call chain; no test pins the concurrent-call
  case directly, see Moderate issue 2).
- Scrolling up fast enough that the sentinel intersects and disarms/re-arms
  in the same frame: the directive's `armed`/`intersecting` closure state is
  synchronous and single-threaded, so this cannot double-emit; the new spec
  proves once-per-arm behaviour directly (`chat-transcript.older-history.spec.ts:222-252`).

### 3. What input data produces a wrong answer?

- None found that produces a wrong RENDERED answer for the reachable cases
  tested. The `hasOlderHistory` boolean is a straightforward
  `typeof tab?.olderHistoryCursor === 'string'` check
  (`chat-view.component.ts:176-181`); an empty string would satisfy `typeof
  === 'string'` and show the button, but nothing in the paging contract ever
  produces an empty-string cursor (`HistoryPagingService.recordTail`,
  `history-paging.service.ts:36-41`, always writes a real cursor or `null`).

### 4. What happens when a dependency fails?

- No `IntersectionObserver` in the runtime: the directive guards
  `typeof IntersectionObserver !== 'undefined'`
  (`transcript-older-history-sentinel.directive.ts:58`) and simply never
  attaches an observer; the manual button still works, pinned by
  `chat-transcript.older-history.spec.ts:203-220` (`makeHarness(false)`).
- `chat:history-page` RPC failure or throw: caught in
  `HistoryPagingService.runLoadOlder`'s try/catch
  (`history-paging.service.ts:101-106`), returns `'failed'`, surfaced by
  `ChatViewComponent.onOlderHistoryRequested` as an action-error banner
  ("Could not load earlier messages. Please try again.") — the button is
  re-enabled because `setLoading(tabId, false)` runs in the `finally`
  (`history-paging.service.ts:67-70`) regardless of outcome. Matches the
  plan's stated failure behaviour ("a failed load leaves the button enabled").
  This part is outside Batch 13's files but is exercised transitively by the
  transcript's `[disabled]`/`[olderHistoryLoading]` wiring, so it was traced
  end to end.

### 5. What is missing that the requirements never mentioned?

- No spec proves the self-heal-on-reactivation behaviour for `hasOlderHistory`
  specifically (Q1) — every existing frozen-`vm` field already relies on this
  same implicit guarantee, so it is a pre-existing gap this batch inherits and
  slightly enlarges, not a new one it introduces.
- No spec proves `hasOlderHistory`/`isOlderHistoryLoading` agree with
  `HistoryPagingService.loadOlder`'s tab-resolution strategy across workspace
  partitions (Q2) — see Moderate issue 1.

## Failure modes

### Frozen `vm.hasOlderHistory` while a tab is inactive

- Trigger: a background/retained tab's `olderHistoryCursor` changes (resume
  completes, or the tab's last older page is consumed) while that tab's
  `ChatTranscriptComponent.active()` is `false`.
- Symptom: `vm().hasOlderHistory` in the template does not reflect the new
  value until the tab reactivates. Because `[class.hidden]="!active()"`
  hides the whole transcript while inactive, the user never sees the stale
  value; on reactivation `vm()` fully recomputes from live signals
  (`chat-transcript.component.ts:431-452`) before the hidden class is removed
  by the same change-detection pass, so no visibly wrong state is exposed in
  the traced code path.
- Evidence: `chat-transcript.component.ts:421-452` (freeze discipline),
  `:153-154` (`[class.hidden]`).
- Current handling: consistent with every other frozen `vm` field; not
  specific to this batch's addition.
- Recommendation: add one assertion (in `chat-transcript.older-history.spec.ts`
  or the existing render-window spec family) that toggles `active` false→sets
  `hasOlderHistory` while inactive→true, and confirms `vm().hasOlderHistory`
  catches up on the next active flip — this is currently asserted for no
  `vm` field, including the pre-existing ones, so it is a gap in the freeze
  discipline's own test coverage rather than a Batch 13 regression.

### `ChatViewComponent.hasOlderHistory`/`isOlderHistoryLoading` tab lookup diverges from `HistoryPagingService.loadOlder`

- Trigger: a `tabId` passed to `ChatTranscriptComponent` via `chat-view.component.html:70-72`
  that is present in `TabManagerService.findTabByIdAcrossWorkspaces` but absent
  from `TabManagerService.tabs()` (the active-workspace-only list).
  `tabs()`'s own doc comment (`tab-manager.service.ts:511-522`) states
  `findTabByIdAcrossWorkspaces` exists precisely because `tabs().find(...)` is
  "active workspace only," and `chat-view.component.ts:693-696`'s own comment
  records a prior bug ("`resolvedTab()` instead fell back to the GLOBAL active
  tab whenever SESSION_CONTEXT held a tab id absent from `tabs()` — a tile
  still...") from exactly this class of mismatch.
- Symptom: the "Load earlier messages" button never renders for such a tab
  (`hasOlderHistory` returns `false`), even though
  `HistoryPagingService.loadOlder(tabId)` — which resolves the tab via
  `findTabByIdAcrossWorkspaces` (`history-paging.service.ts:47`) — would serve
  the request if it were ever called. The failure is silent: no error, no log,
  just a permanently missing affordance for that tab.
- Evidence: `chat-view.component.ts:176-181` (`.tabs().find(...)`) vs
  `history-paging.service.ts:47` (`findTabByIdAcrossWorkspaces`);
  `chat-view.component.ts:611-617` (`resolvedTab`, the SAME `.tabs().find(...)`
  pattern used elsewhere in this file for tile rendering, so the new method is
  consistent with the file's existing convention, not a novel divergence).
- Current handling: none — no code path reconciles the two lookups, and no
  test in `chat-view.component.spec.ts` (`:250` stubs `findTabByIdAcrossWorkspaces`
  to always return `null`, and the affordance tests at `:496-516` only use
  `tabs()`) exercises a tab that is in one list and not the other.
- Recommendation: confirm with the architect whether a canvas tile's
  `SESSION_CONTEXT` tab id can ever diverge from the active workspace's
  `tabs()` while that tile is actually mounted (the canvas store's own comment
  at `canvas.store.ts:47,77` — "its grid unmounts" / "background workspaces
  keep their own live tile state" — suggests background-workspace tiles are
  normally unmounted, which would make this unreachable in practice). If
  unreachable, downgrade to a code comment; if reachable, `hasOlderHistory`
  and `isOlderHistoryLoading` should resolve the tab the same way
  `loadOlder` does.

### Sentinel row occupies a fixed position above all messages, not just above the tail

- Trigger: none needed — by construction the sentinel/button row is rendered
  once, before the `@for`, and stays the first child of `#messageContent`
  regardless of how many older pages have already been prepended
  (`chat-transcript.component.html:6-24`).
- Symptom: none observed as a bug. Reasoned through explicitly because the
  review was asked to check prepend interaction: each successful `loadOlder`
  prepends older messages AFTER the sentinel and BEFORE the previously-oldest
  message (`TabManagerService`'s prepend, outside this batch's files), so the
  sentinel's distance from the top of scrollable content is unaffected by a
  prior page load; the directive's `armed` flag is reset to `false` by its own
  emit (`transcript-older-history-sentinel.directive.ts:35-46`) and a
  scroll-position-preserving adjustment after a prepend moves `scrollTop`
  UP (larger), which the directive's `onScroll` treats as a downward move and
  therefore does not re-arm (`:48-53`) — so a loop of auto-load → prepend →
  compensating scroll → auto-load again is not possible by construction.
- Evidence: `chat-transcript.component.html:6-24`;
  `transcript-older-history-sentinel.directive.ts:35-53`.
- Current handling: correct by inspection; no test exercises a real prepend
  against the sentinel (the new spec only manipulates `scrollTop` directly,
  never actually prepends messages), so this is verified by reasoning, not by
  evidence from a running test.
- Recommendation: none blocking; a functional e2e case (already planned in
  C14/M2 per `implementation-plan.md` (ii).6 #14) is the right place to prove
  this against real DOM mutation rather than a unit spec.

## Blocking issues

None.

## Serious issues

None. The tab-lookup divergence above would be Serious if confirmed reachable
(a silently missing affordance for a legitimate paged tab), but I could not
establish reachability from the code read in scope, so it is recorded as
Moderate pending the architect's confirmation.

## Moderate and minor issues

- **Moderate 1** — `hasOlderHistory`/`isOlderHistoryLoading` resolve the tab via
  `TabManagerService.tabs()` while `HistoryPagingService.loadOlder` resolves it
  via `findTabByIdAcrossWorkspaces`; no test proves the two agree for a tab
  outside the active workspace. `chat-view.component.ts:176-184`,
  `history-paging.service.ts:47`, `chat-view.component.spec.ts:250,496-516`.
- **Moderate 2** — No spec directly proves the in-flight dedup between a manual
  click and a concurrent auto-load emit (both routes converge on
  `HistoryPagingService.loadOlder`, which is tested in isolation in
  `history-paging.service.spec.ts`, but `chat-view.component.spec.ts` and
  `chat-transcript.older-history.spec.ts` never fire both triggers in the same
  tick against the real service). Traced correct by inspection (see Q2 above).
- **Minor** — Task 13.2's stop decision is honestly reported (76 noncontiguous
  lines vs the ~150 floor, itemized by line range in
  `b13-codex-report.md:37`) and I independently confirmed no
  `transcript-replay-hold.service.ts` or similar file was created
  (`git status --short` shows no such file) and that
  `chat-transcript.component.ts` still contains the replay-hold fields/effects
  the report lists (`:283`, `:466-483`, `:537-550` region, `:678`, `:700-706`
  all present in the read file) — the estimate is plausible on inspection, not
  independently re-measured line-by-line against the guardrail's own counting
  method.

## Data flow

1. Chat-view template binds `[hasOlderHistory]="hasOlderHistory(tabId)"`,
   `[olderHistoryLoading]="isOlderHistoryLoading(tabId)"`,
   `(olderHistoryRequested)="onOlderHistoryRequested(tabId)"` per tab
   (`chat-view.component.html:70-72`) — OK, wiring present for every rendered
   `tabId` in `transcriptTabIds()`.
2. `ChatTranscriptComponent` receives the three IO members
   (`chat-transcript.component.ts:199-201`) and folds `hasOlderHistory` into
   the frozen `vm` (`:447`) — OK while active; stale while inactive by design
   (see Q1/Failure mode 1), invisible to the user due to `[class.hidden]`.
3. Template gates the sentinel+button row on
   `vm().hasOlderHistory && !historyReplaying()` (raw, ungated replay flag,
   per chat `CLAUDE.md` rule 7 "Replay boundary" — confirmed no use of
   `motionSuppressed`/`replayMotionHold` here) — OK, matches "never during
   replay."
4. `TranscriptOlderHistorySentinelDirective` arms only on a scrollTop decrease,
   emits only when armed AND intersecting AND scrollable AND not disabled,
   disarms on emit, tears down on destroy — OK, pinned by
   `chat-transcript.older-history.spec.ts:222-296`.
5. Manual click and the directive's emit both call
   `olderHistoryRequested.emit()` → `ChatViewComponent.onOlderHistoryRequested`
   → `HistoryPagingService.loadOlder` — OK, dedup via a synchronous `inFlight`
   map check (`history-paging.service.ts:43-46`) before either the async RPC
   or the `loadingTabIds` signal changes; not directly spec-pinned for the
   two-trigger-at-once case (Moderate 2).
6. Outcome (`'stale'` / `'failed'` / others) maps to an action-error banner or
   silence — OK, pinned by `chat-view.component.spec.ts:463-494` (pre-existing,
   unedited by this batch; only read for context).
7. `chat-transcript.component.ts`'s `onScroll`, `scheduleStickToBottom`,
   `restoreScrollOnActivation`, `lastScrollTop`, the render-window feed
   effect and the CSS file all show no hunk in the diff — confirmed directly
   by `git diff --stat` (2 modified transcript files, no `.css`) and by
   reading the full diff of `chat-transcript.component.ts` (only the import,
   view-model field, IO block, `vm()` population and the Task 13.0
   timer-clear reuse are touched).

## Requirements fulfilment

| Requirement                                                              | Status   | Gap                                                                 |
| -------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 13.0: dedupe `clearReplayMotionHold` call, behaviour-preserving             | COMPLETE | none — traced glitch-free (signal set false-then-true synchronously, no observable intermediate render) |
| 13.0: no hunk in the four protected scroll members / CSS / cleanup         | COMPLETE | none                                                                  |
| 13.0: three pre-existing specs unedited and green                          | COMPLETE | confirmed unedited via `git status --short`; "green" taken on the report's word (tests not re-run per instructions) |
| 13.1: directive arms only after upward scroll, once per arm                | COMPLETE | pinned by new spec                                                    |
| 13.1: never on open, never during replay, never during downward stick      | COMPLETE | pinned by new spec (open/downward) and by the template gate (replay)  |
| 13.1: manual button always works without `IntersectionObserver`            | COMPLETE | pinned by new spec                                                    |
| 13.1: `hasOlderHistory`/`olderHistoryLoading`/`olderHistoryRequested` bound per tab | PARTIAL | binding present and correct in isolation, but `hasOlderHistory`'s tab lookup diverges from `HistoryPagingService.loadOlder`'s (Moderate 1) |
| 13.1: no scroll writes, no CSS diff, no `content-visibility`               | COMPLETE | confirmed by diff read                                                |
| 13.2: stop decision honestly reported at ~76 lines vs ~150 floor           | COMPLETE | plausible on inspection, not re-measured line-by-line                |
| Chat-view scope amendment: only two protected read methods + their tests   | COMPLETE | confirmed — diff shows exactly `hasOlderHistory`/`isOlderHistoryLoading` added, `historyPaging` stays private |

Implicit requirements not addressed: a regression test that the paging
affordance and `HistoryPagingService.loadOlder` agree on which tabs are
eligible across workspace partitions (see Moderate 1); a test that
`vm().hasOlderHistory` self-heals on tab reactivation (pre-existing gap,
inherited).

## Edge cases

| Case                                                             | Handled | How                                                                 | Concern                                            |
| ------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| No `IntersectionObserver`                                          | YES     | manual button only, guarded `typeof` check                              | none                                                    |
| Auto-load on open (no scroll yet)                                   | YES     | `armed` starts `false`, requires a scrollTop decrease first             | none                                                    |
| Auto-load during a downward stick                                   | YES     | `armed` set only on decrease; increase never arms                       | none                                                    |
| Auto-load during replay                                             | YES     | whole sentinel row gated out of the DOM by `!historyReplaying()`        | none                                                    |
| Double click / click-during-auto-load                                | YES (by code) | `inFlight` map dedup in `HistoryPagingService.loadOlder`           | not directly spec-pinned for the concurrent case (Moderate 2) |
| Cursor becomes `null` mid-session (active tab)                       | YES     | `vm()` recomputes live while active; button disappears                 | none                                                    |
| Cursor changes while tab inactive                                    | YES (self-heals) | frozen `vm`, hidden by `[class.hidden]`, corrects on reactivation | not directly spec-pinned (Failure mode 1)               |
| Tab present in `findTabByIdAcrossWorkspaces` but not in `tabs()`      | UNCLEAR | `hasOlderHistory` returns `false`; `loadOlder` would still work if reached | affordance silently missing if this state is reachable (Moderate 1) |
| Container element identity changes                                    | N/A     | `#messageContainer` is outside the `@if`, never recreated for a live instance | none                                                    |
| Prepend re-triggering auto-load (loop)                                 | YES (by reasoning) | disarm-on-emit + compensating scroll moves scrollTop up (treated as downward) | not exercised by a real prepend in any spec (Failure mode 3) |

## Verdict

- Recommendation: REVISE (non-blocking; the fixes are test additions and one
  architect confirmation, not behavioural changes)
- Confidence: MEDIUM — the core arm/emit/disable/replay logic is solid and
  well-tested; my residual uncertainty is entirely about reachability of the
  cross-workspace tab-lookup mismatch, which I could not resolve from the
  files in scope.
- Top risk: if a canvas tile's tab can ever be mounted while absent from the
  active workspace's `tabs()` list, the "Load earlier" affordance silently
  and permanently disappears for that tab even though the backend would serve
  the request — worth a one-line architect confirmation before this ships,
  given the file's own comment records a prior bug in exactly this class of
  lookup.
- What a robust implementation would add: (1) either switch
  `hasOlderHistory`/`isOlderHistoryLoading` to `findTabByIdAcrossWorkspaces`
  for parity with `loadOlder`, or a code comment plus a regression test
  asserting the two are intentionally scoped differently and why; (2) a spec
  that fires a manual click and a directive auto-load emit in the same tick
  against the real `HistoryPagingService` (not just the isolated service spec)
  to pin the dedup end to end; (3) a spec that flips `active` false→true across
  a `hasOlderHistory` change to pin the freeze-and-self-heal behaviour this
  batch newly depends on.
