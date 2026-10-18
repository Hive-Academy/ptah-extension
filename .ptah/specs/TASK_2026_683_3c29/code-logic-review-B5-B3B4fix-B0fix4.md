# Code Logic Review - TASK_2026_683: B5, B3/B4 fix, B0 probe fix 4, CR739

Review family: claude (reviewer) vs codex (implementer)

Score: 7/10. Verdict: NEEDS_REVISION (one Serious test-quality item with an exact fix; no Blocking items).

Method: read the diffs and whole new files (`transcript-session-entrance.ts`, `transcript-entrance.ts`, the route-sync service, the tracker, the three new/changed specs, the probe spec's recorder, gate and assertion blocks). I did not run anything: the orchestrator owns the checks, and I could not mutate source to prove an assertion can fail. Where I say "cannot fail" I give the reasoning, not a run.

## Summary

| Metric | Value |
| --- | --- |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 6 |
| Minor | 6 |

## 1. B5 - ChatView session entrance

### Critical check: did the lane weaken the timer assertions?

The lane replaced two assertions that counted all Jest timers (which include Angular's own) with behavioural ones. Per assertion:

| Behaviour to prove | New assertion | Still proves it? |
| --- | --- | --- |
| Timer fires at 400 ms (not earlier, not later) | `chat-view.session-enter.spec.ts:162-166`: entering is true at 399 ms and false at 400 ms | YES. Fails if the window is changed to anything other than 400 ms. |
| A new tab switch cancels the previous timer, only one live | `:172-182` (A -> B at 0, B -> A at 200, assert A still entering at 400 and clear at 600) | YES. The B timer from t=0 would fire at exactly 400 ms and clear A early if it were not cancelled. At 600 ms the restarted timer is proven to fire. This is stronger than a timer count. |
| Destroy cancels the current timer | `:167-170`: `expect(clearTimer).toHaveBeenCalled()` | NO, weakened. See finding 1. |

### Findings

**1. SERIOUS - destroy-cancels-timer assertion can pass without the cancellation.**
`chat-view.session-enter.spec.ts:155-170`. `jest.spyOn(global, 'clearTimeout')` is installed before `jest.advanceTimersByTime(...)`, `detectChanges()` and `fixture.destroy()`, and the expectation is only `toHaveBeenCalled()`. Angular's scheduler and `TestBed` teardown call `clearTimeout` on their own paths (for example the zoneless scheduler's rAF/timeout race cleanup), so deleting `if (this.enteringTimer !== null) clearTimeout(this.enteringTimer)` at `chat-view.component.ts:701` would likely not fail the test. The test also never asserts that the destroyed component's timer does not fire afterwards.

Exact replacement (spy on `setTimeout` to capture the 400 ms handle, then assert the clear is for that handle and that the signal is not reset afterwards):

```ts
it('cancels the live entrance timer on destroy', () => {
  const setSpy = jest.spyOn(global, 'setTimeout');
  const h = mount(); fixture = h.fixture;
  h.activeTabId.set('B'); fixture.detectChanges();
  const component = fixture.componentInstance as unknown as { enteringTabId(): string | null };
  expect(component.enteringTabId()).toBe('B');
  const call = setSpy.mock.calls.map((args, i) => ({ args, id: setSpy.mock.results[i].value }))
    .filter((c) => c.args[1] === 400).at(-1);
  expect(call).toBeDefined();
  const clearSpy = jest.spyOn(global, 'clearTimeout');
  fixture.destroy(); fixture = undefined;
  expect(clearSpy).toHaveBeenCalledWith(call!.id);
  jest.advanceTimersByTime(400);
  expect(component.enteringTabId()).toBe('B'); // a live timer would have reset it to null
  setSpy.mockRestore(); clearSpy.mockRestore();
});
```

Keep the existing 399/400 test without the destroy half. The trailing `advanceTimersByTime` plus `enteringTabId() === 'B'` check is the part that fails if the cancel is removed.

**2. MODERATE - the "outside the zone" requirement is untested.** No spec asserts the timer is created under `ngZone.runOutsideAngular`. The code is correct (`chat-view.component.ts:1209-1214`), but a refactor to a plain `setTimeout` would pass every B5 test. The app is zoneless by default (`app.config.ts:144-146`), so the practical risk is low; the zone fallback flag still exists. Suggested: spy `NgZone.runOutsideAngular` and assert it was called once per switch.

**3. MODERATE - `.is-entering` no longer restarts inspector rows on a second switch inside 400 ms.** The old code removed the class, forced a reflow and re-added it, which restarted running animations. Now `[class.is-entering]="enteringTabId() !== null"` (`chat-view.component.ts:197`) stays true across A -> B within the window, so `.st-r` rows that reuse DOM keep their running animation instead of restarting. Rows created fresh by the new tab still animate. Impact is limited to rapid switches with a shared inspector DOM. Either accept and record it as a decision, or key the class on the tab id (for example a data attribute `[attr.data-entering]` that changes per tab) so the selector re-matches.

**4. MINOR - last inspector row is clipped by the 400 ms window.** `chat-view.component.css:199-201`: delay `60ms + min(i,6) * 28ms` gives 228 ms for i = 6, plus the 200 ms duration = 428 ms, but the class is removed at 400 ms. The tail of an ease-out (28 ms) is cut; imperceptible, and the plan fixes 400 ms (plan line 438). The code comment "Includes the last inspector row's entrance" (`chat-view.component.ts:174`) is slightly wrong for i >= 6.

**5. MINOR - initial mount plays an entrance.** First non-null tab also enters (recorded decision in the B5 report). It is correct per the report, but note that every ChatView host (rail, tiles, embeds) now runs a 400 ms timer plus a transcript snapshot pass at startup. No leak: the timer is cleared on every switch and on destroy.

Checked and sound:
- A -> B -> A: the previous timer is cleared before the new one is set (`:1202`), and the signal is set before the timer so the transcript edge and timer cannot disagree. Both writes are inside `untracked`, so the effect does not self-trigger.
- View-mode change or first session id: `tabId === lastTabId` returns early (`:1198`), so no replay. Tested (`:148-153`).
- Zone leak: the timeout callback only sets a signal, which works zoneless and with the hybrid scheduler.
- Destroy: `ngOnDestroy` clears the handle (`:701`); the effect is destroyed with the component, so no timer can be re-armed after destroy.

## 2. B3/B4 fix

### Critical check: the pure selector

`transcript-entrance.ts` (17 lines): signature `selectVisibleEntrance(viewport: DOMRectReadOnly, itemsNewestFirst: readonly {id; rect}[], cap: number): string[]` is identical to plan lines 488-490. It imports nothing (no Angular, no DOM globals other than the `DOMRectReadOnly` type), writes only to a local array, `selected.reverse()` acts on that local array, and inputs are never mutated. Walk order matches the plan (skip below, `break` at first fully above, collect, stop at cap, return oldest first). It is still pure.

One deviation from the plan, minor and spec-covered: a `height <= 0` item is skipped without spending a cap slot (`transcript-entrance.ts:10`, spec `:34-37`). The plan said "collect every item that intersects". The deviation is sensible (a display:none or empty slot should not take index 0) and has a test.

The lazy-rect adapter in `transcript-session-entrance.ts:70-84` puts a memoised DOM-reading getter into the items. That keeps the selector pure, since the impurity belongs to the caller's data and it executes inside `earlyRead`. The getter is memoised, so `height`/`top`/`bottom` cost one read per slot, and `MAX_RECT_READS = 24` bounds the all-below case (tested at `chat-transcript.session-enter.spec.ts:192-209`, expects exactly 24 reads).

### Critical check: read and write phases

- `read()` (`transcript-session-entrance.ts:57-98`) only calls signal getters, `getBoundingClientRect`, `scrollHeight/clientHeight/scrollTop`, builds `DOMRectReadOnly`. No class, style, or attribute writes. The spec "does not write entrance marks during rect reads" (`chat-transcript.session-enter.spec.ts` ~`:196-216`) asserts no `.ptah-turn-enter` or `data-enter-i` is present at the moment of every slot rect read. That test can fail if a write is moved before a read.
- `write()` (`:100-115`) only writes (style property, attribute, class) and re-checks `generation`, `entering()` and `workActive()` before doing so, so a falling edge between phases aborts.
- `afterNextRender` inside an effect is legal (only `afterEveryRender` asserts non-reactive context in this Angular version). The effect only tracks `entering()`; `setEntering` is edge-gated so repeated runs are no-ops.

### Race and state analysis

- Rapid A -> B -> A: `setEntering(false)` bumps `generation`, clears marks, and any in-flight `afterNextRender` for the old edge returns null/no-ops. Tested (`...session-enter.spec.ts` "clears falling-edge marks and re-arms").
- Destroy: `destroy()` bumps generation and clears. Tested. `cleanup()` calls it (`chat-transcript.component.ts:1346`).
- Pane fade (unpinned with saved offset) and bottom-projected viewport (D11) match the plan. `savedScrollTop` is only cleared by scroll events, not by the activation rAF, so the pane/slots decision in `read()` is stable at that point.
- Marks are applied once per rising edge and never re-evaluated, so streaming/resync slots are not marked (tested).

### Findings

**6. MODERATE - route-sync: a `NavigationCancel`/`NavigationError` reconciliation depends on a microtask guess about Router internals.** `chat-tab-route-sync.service.ts:131-134`. The code assumes the Router clears `currentNavigation` after the terminal event and before the microtask. The two new specs (cancel via guard, error via rejected guard) run against the real Router and pass, which is real evidence. If a later Angular version moves the clear later, `pendingSurface()` is still non-null in the microtask, `reconcileDroppedCorrection` returns early (`:318`) and `correctionDropped` stays true with nothing to re-trigger it until the next navigation end/cancel. Failure mode: URL left on the wrong tab until the next navigation. Mitigation (optional): on the early return, re-queue once, or also reconcile from `tracker.afterTransition`.

**7. MODERATE - route-sync: an unsettled view transition defers a correction forever (B3-4, left open).** `replaceChatUrl` defers through `afterTransition`, which only runs on `transition.finished` settle (`surface-view-transitions.ts:54-70`). `finished` always settles per spec, so this is low probability, but if it does not, `busy()` stays true, `ptah-vt-active` stays on the root and the tab/URL mismatch is never corrected. The lane documented this as outside its ownership. Recommend a bounded watchdog in the tracker (settle after, for example, 2 s) in the batch that owns the tracker.

**8. MINOR - B3-2/B3-3 coverage left open.** URL-match and pending-surface guards inside the deferred callback (`:299-304`) have the pending-surface test (`spec :463-470`), but no test where the URL already matches when the transition settles (`:307-309`). Still guarded by code, so low risk.

Route-sync logic that I traced and found sound: generation bump on `NavigationStart` and on each correction (`:122`, `:300`); superseded deferred callbacks return without issuing a stale correction (the second call overwrites `deferredCorrectionGeneration`, so the first callback does not reconcile); the final correction reads the active tab fresh at execution time (A -> B -> A during a transition ends on A); cancel then re-defer path when the transition is still busy; supersede-by-new-navigation leaves `correctionDropped` set until the new `NavigationEnd` clears it.

**9. MINOR - `ptah-pane-enter` duration `160ms` is hard-coded** (`chat-transcript.component.css:12`) while the rest uses tokens. The plan allows the pane fade, so style only.

## 3. B0 probe fix 4 (`nav-session-motion.perf.spec.ts`)

Gate: `probeVersion = 2` (`:31`) is written into both partial and complete JSON (`:355`). The M1 gate (`:335-341`) rejects: a missing m0.json, a baseline whose `probeVersion !== 2` (so a v1 file or one without the field is refused), `complete !== true`, a non-array `windows`, and any scenario whose window count differs from `expectedWindowCounts` (102 total = 30+10+5+3+2+44+4+4). The gate runs before any `rmSync`, so a refused run does not delete output. M1 cannot silently use the stale 408-false-positive M0. A run with `PTAH_MOTION_ASSERT` unset skips the gate by design (it records only).

Completeness on the recording side: partial JSON is written after each window and on any failure (`:679`); the complete file is written only after the per-scenario count check (`:673-675`), so an aborted M0 can never be mistaken for a complete one.

### Findings

**10. MODERATE - S3/S4 "entrance exists" assertion may contradict the intentional B4 behaviour.** `:653-659` requires at least one `ptahTurnEnter` start in every S2, S3 and S4 window. S3 (non-retained) and S4 (first open of an unopened session) load history asynchronously. B4 deliberately does not animate history that arrives after an empty or replaying activation (`read()` returns null when `slotCount() === 0` or `historyReplaying()`; spec "does not animate history that arrives after an empty non-retained activation"). If the fixtures arrive after the snapshot pass, M1 will report a failure that is really a product decision, not a regression. The plan text (M1 criteria, lines ~800-805) only requires that animated messages be inside the viewport with the first at 0 ms; it does not require an entrance in S3/S4. Fix: assert `exists` only for S2, and for S3/S4 assert the conditional form (`if (animated.length) { every visibleAtStart; first index 0; first delay 0 }`), recording the count for the report. If the intent is that first opens must cascade, that is a B4 requirement gap and should go back to the plan owner.

**11. MODERATE - `visibleAtStart` is sampled at `animationstart` dispatch, which may precede the activation scroll-restore rAF.** `:143-152`, assertion `:655`. The transcript marks slots using a viewport projected onto the post-restore scroll position (D11) precisely because the restore happens in a later frame. If `animationstart` is dispatched before that rAF, `visibleInScroller` measures the not-yet-scrolled scroller and can report a correctly chosen message as not visible, producing false failures for pinned long threads. I cannot confirm the event/rAF ordering without running Chromium. Mitigation: compute `visibleAtStart` inside a `requestAnimationFrame` queued from the event (second frame), or evaluate visibility against the final scrolled position.

**12. MINOR - `visibleAtSwitch` is taken at click time from the previous session's scroller** (`capture()` uses `visibleMessages()` before the switch), so for the new session it is almost always false. It is recorded but not asserted, so harmless; do not use it in future assertions.

**13. MINOR - nothing binds an `m0.json` to pre-change code.** `probeVersion` proves the recorder version only. M0 must be re-recorded against main's code with this same spec file (the probe file is untracked), otherwise the baseline would already contain the new animations. This is a process step for the orchestrator.

**14. MINOR - soft-assert failures still produce a `complete: true` m1.json.** Intended (the test fails through `expect.soft`), but a reader of m1.json alone cannot see that assertions failed.

Verified: `:active-view-transition` is supported (Electron `^44` is far past Chromium 125). View-transition start flag uses capturing `animationstart` on the `::view-transition*` pseudo-elements and S6 requires no start and no active sample (`:667`). Split-pane starts are captured on the pane `section`; late `at50` samples no longer decide. The S4 shift check compares against the same-named M0 row plus 0.001 (`:643`), and fails when the M0 row is absent (`:641`).

## 4. CR739

### message-finalization (`message-finalization.service.ts:355-358`)

`deepCopyStreamingState` now copies `latestTodoWrite` into a new marker object with a new `input` object; an absent marker stays `undefined`. Correct and sufficient for the stated race (finalize versus stream writes to the marker). The test (`message-finalization.service.spec.ts:228-238`) can fail without the fix: before it, `copy.latestTodoWrite` was `undefined`, so `toEqual(original.latestTodoWrite)` fails, as do the two `not.toBe` checks.

- **MINOR (15)** - the copy is shallow: nested values in `input` (for example the `todos` array) are still shared with the live state. That matches how this method copies other records and the history builder only reads it.
- **MINOR (16)** - when the marker has no `input`, the copy gets an explicit `input: undefined` key. `toEqual` ignores it; `toStrictEqual` or `'input' in marker` would not. The replayer deliberately omits the key in that case (`session-history-replayer.service.ts` liveState block), so for consistency use `...(m.input ? { input: { ...m.input } } : {})`.

### session-history-replayer (`session-history-replayer.service.ts:374-379`)

Question: do missing-owner rows really stay in `tab.messages` and stay out of live state?

- All owners missing: `owners` becomes empty, a warn with `{ tabId, ownerIds }` is logged (IDs only, no content), and the condition at `:381` skips both `setMessages` and `setStreamingState`. The finalized rows stay in `tab.messages` (the test asserts `tabs[0].messages` is the same array and `setMessages`/`setStreamingState` were not called). Before the fix: `ownerPositions` was empty, `Math.min()` gave `Infinity`, the owner rows were removed from `tab.messages` and a live state with no owner events was set, which lost the rows. The fix removes that data loss. The new test fails without the fix (it would call `setMessages` and `setStreamingState`).
- Partial: `owners` is reduced before `messageIds`, `ownerStarts`, `ownerPositions` and `orderedOwners` are derived from it, so every downstream set uses only present owners. Only present owners' rows are removed (`ownerStarts`). `resyncOwnerPredecessors` is built from `tab.messages` with the missing owner's row still there, so a present owner whose predecessor is a kept missing-owner row records that row as predecessor (the test asserts `start-B -> start-A`), which is consistent with where the row actually is. `currentMessageId` is the last present owner (`'B'`). The missing owner's tool and child message IDs are never added (the `toolIds` fixpoint starts from `messageIds`). The partial test fails without the fix (both rows would be removed and `messageEventIds` would not match).
- `historyState` is captured before `finalizeSessionHistory` (`:340-342`); the new check relies on that object's `messageEventIds` as it was before finalize. That is the same object the pre-existing code used, so the new filter and the old position lookup agree.

Findings:
- **MODERATE (17)** - the degraded outcome is a `warn` only. In the all-missing case the live seeded-subagent state is not restored while the user sees owner rows with no live card state. That is safer than deleting rows, but it is silent for the user. Acceptable; if you want it surfaced, a counter or an action banner belongs to the owner of that flow.
- **MINOR (18)** - `messageEventIds.includes(id)` inside `filter` is O(owners x events). Owners are few; use a `Set` only if event counts grow.
- Spec harness change (`setStreamingState` mock, `streamingState?` on the tab type) is test-only and correct.

## Five logic questions

1. Silent failure: B5 destroy test (finding 1) can pass without the cancel; route-sync stays on a mismatched URL if the Router clears `currentNavigation` later than the microtask (6) or a view transition never settles (7); the S3/S4 M1 assertion can report a failure that is the intended behaviour (10).
2. Unexpected user action: a second switch inside 400 ms does not restart inspector row motion (3); first-open sessions whose history arrives late get no cascade (10, by design).
3. Input data giving a wrong answer: a tall last reply or fewer than six visible slots is handled by the selector (tested); zero-height slots are skipped; an all-below viewport is bounded at 24 reads.
4. Dependency failure: `NavigationCancel/Error` now reconciles (tested against the real Router); `transition.finished` rejection is handled in the tracker; a never-settling transition is not (7).
5. Missing: a watchdog on the tracker, the outside-zone test (2), and a restated rule for first-open entrances in the plan (10).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| B5: tab-id keyed 400 ms outside-zone `enteringTabId`, `[entering]` binding | COMPLETE | zone test missing (2) |
| B5: new switch cancels the previous timer, destroy cancels the current one | PARTIAL | destroy half not provable (1) |
| B5: inspector `.st-r` on global tokens, CV-2.1 removed | COMPLETE | no restart on rapid second switch (3); last-row clip (4) |
| B3-1: reconcile after cancel/error | COMPLETE | microtask assumption (6) |
| B4: pure `selectVisibleEntrance` with U5 signature | COMPLETE | zero-height skip is an extension |
| B4: earlyRead reads only, write writes only | COMPLETE | tested |
| B4: file size reduced, one helper per transcript | COMPLETE | |
| B0-4: `probeVersion` 2 gate and completeness | COMPLETE | |
| B0-4: M1 entrance criteria | PARTIAL | S3/S4 over-strict (10), `visibleAtStart` timing (11) |
| CR739 both fixes | COMPLETE | |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| A -> B -> A inside 400 ms | YES | timer restart plus generation bump | test proves it |
| Destroy mid-window | YES | timer cleared, marks cleared | destroy test too weak (1) |
| View-mode change on the same tab | YES | tab id unchanged | |
| Unpinned restored offset | YES | pane fade | |
| All slots below viewport | YES | 24-read bound | |
| Navigation cancelled or errored after a deferred correction | YES | microtask reconcile | Router-internals assumption (6) |
| Transition never settles | NO | none | (7) |
| History arrives after activation | YES (by design) | not animated | M1 expectation (10) |
| Seeded owners missing from `messageEventIds` | YES | skipped or filtered | warn only (17) |

## Verdict

- Recommendation: REVISE (small). Replace the destroy assertion (finding 1); then address 10 and 11 before the orchestrator records M1, because they can produce false probe failures that cost a full 30-minute recording.
- Confidence: HIGH for B3/B4, CR739 and the selector purity review (read in full, traced against the real Router tests); MEDIUM for the probe findings 10 and 11, which depend on browser event timing I could not run.
- Top risk: a test that looks like destroy-cancellation coverage but would pass without it, and an M1 gate that can fail for intended behaviour.
- What a robust implementation would add: the exact replacement test above, an outside-zone spy, a tracker watchdog, conditional S3/S4 entrance assertions, a second-frame `visibleAtStart`, and a re-queue on the early return of `reconcileDroppedCorrection`.
