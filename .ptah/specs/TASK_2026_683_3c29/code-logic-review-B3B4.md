# Code Logic Review - TASK_2026_683_3c29, batches B3 and B4

Reviewer: Claude (implementer: codex). Read-only. Static trace only: I did not run nx, jest or a build.
The orchestrator's results (B3 spec 32/32, transcript specs 19 suites / 229 tests) are taken as given.

## Verdict

| Metric | Value |
| --- | --- |
| Overall score | 8.5/10 (B3 9, B4 8) |
| Assessment | APPROVED (no blocking or serious defects; fixes below are optional hardening) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 (B3-1, B4-1) |
| Minor | 5 |

Files read in full: `chat-tab-route-sync.service.ts` and its spec diff, `surface-view-transitions.ts`,
`transcript-entrance.ts` and its spec, `chat-transcript.session-enter.spec.ts`, the B4 diff of
`chat-transcript.component.{ts,html,css}` and `transcript-slot.directive.ts`, plus the activation, restore,
vm-freeze and scroll code of the component that the new code interacts with.

---

## B3 - ChatTabRouteSync deferral (`chat-tab-route-sync.service.ts`)

### What was checked and holds

- **Four-condition guard** (`:289-295`) matches plan section 5 exactly: (a) generation unchanged (`:290`),
  (b) `pendingSurface() === null` (`:291`), (c) router still on chat (`:292-293`), (d) URL does not already
  name the active tab (`:294`). All four apply only when `deferred` was true at queue time.
- **Generation bump** on every `NavigationStart` (`:123-124`) and on every correction queued (`:287`). The
  newest queued callback is the only one that can pass (a), so at most one replace runs. A correction never
  navigates back to chat after the user left (c), and never overwrites a newer navigation (a, b).
- **Idle path is behaviourally identical.** `afterTransition` runs `fn` synchronously when no transition is
  current (`surface-view-transitions.ts:44-50`), `deferred` is false so no guard runs, and
  `issueCorrection(this.tabManager.activeTabId())` reads the same value the old parameter carried (same
  synchronous turn, `:189-192`, `:225-226`). The extra `routeGeneration++` and the `NavigationStart` branch
  have no side effect when nothing is queued. The idle spec (`spec: 'issues an idle correction in the same
  effect turn'`) asserts the call within `TestBed.tick()`.
- **Subscriptions:** one `router.events` subscription, still unsubscribed through `destroyRef` (`:129`). The
  deferral adds no subscription and no timer; queued closures are released by `settle` (`:62-65`).
- **Rejected and skipped transitions flush:** `track` handles both outcomes of `finished` (`:56-59`); the spec
  `flushes a correction when the transition finishes with rejection` covers it.
- `issueCorrection` still records `this.correction` for the whole navigation, so `followUrl`'s stale-landing
  detection (`:146-148`) is unchanged. Deferral only delays when that bookkeeping starts, which is correct
  because no correction navigation exists before it.

### Defects

**B3-1 (Moderate) - A discarded correction is never re-issued when the navigation that discarded it does not end.**
- Where: `:122-125` (bump on `NavigationStart` only), `:289-295`.
- Scenario: settings -> chat with the active tab B (URL `/chat`, correction queued, transition running). The
  user clicks another surface; its navigation emits `NavigationStart` (generation bumps, queued correction is
  now dead) and is then cancelled or errors (`canDeactivate` veto, chunk load error, superseded by a
  same-URL no-op). No `NavigationEnd` follows, so `followUrl` never reconciles, and the effect does not
  re-fire (the active tab did not change). The URL stays `/chat` while tab B is active. Before B3 the
  correction was issued at `NavigationEnd` time and could not be lost this way.
- Impact: stale URL after a reload or restore shows the wrong tab. Rare, self-heals on the next tab change.
- Fix: keep a `correctionDropped` flag set when a deferred callback is discarded for reason (a) or (b). On
  `NavigationCancel` / `NavigationError` (add them to the filter at `:117-120`), if the flag is set and
  `pendingSurface()` is null, clear it and call `followActiveTab(this.tabManager.activeTabId(),
  this.tabsReady())`. Add one spec: chat correction queued, then a navigation vetoed by a `canDeactivate:
  () => false` route, then `finish()`: expect the replace to reach `/chat/<active>`.

**B3-2 (Minor) - Guard (d) is not exercised by any spec.** Reachable case: URL `/chat/A`, transition running,
active A -> B (queues a correction, generation 1) then B -> A (the effect returns at `:225`, no new queue).
At flush (a) holds and (d) alone discards. Every new spec reaches the discard through (a) or (b)
(`does not overwrite a newer chat navigation` discards through the generation bump of `/chat/B`). Add that
case to the spec; without it, deleting `:294` keeps the suite green and issues a pointless replace.

**B3-3 (Minor) - Guard (b) is exercised only by `jest.spyOn(pendingSurface).mockReturnValue('settings')`**
(spec "does not issue a correction while another surface is pending"). That is a mock of the guard's input,
not behaviour. Prefer a real in-flight navigation held open by a guard promise.

**B3-4 (Minor, plan-accepted) - No upper bound on the wait.** If `finished` never settles (a window the OS
occludes, frames throttled), corrections and the stale URL wait with it, and every `afterTransition` caller
is stuck. The plan records this as impossible. A cheap safety is a timer in the tracker (about 1 s after
`track`) that calls `settle`. Out of B3's files; note for the tracker owner.

**B3-5 (Minor, outside B3's files) - `SurfaceTransitionTracker.settle` runs callbacks in a bare `for` loop**
(`surface-view-transitions.ts:63`). One throwing callback drops the rest. B3's callback cannot throw
synchronously (`issueCorrection` is async and `navigateToSurface` never rejects), so it is safe today.

---

## B4 - Transcript session entrance

### What was checked and holds

**(a) Reads only in `earlyRead`, writes only in `write`.** `earlyRead` (`component.ts:1094-1130`) calls
`getBoundingClientRect`, `scrollTop`, `scrollHeight`, `clientHeight`, signal reads and
`DOMRectReadOnly.fromRect`; no style, class or attribute writes. `write` (`:1131-1146`) does only
`addClass`, `setProperty`, `setAttribute`. No `offsetWidth`, no reflow trick. The Angular phase order
(all `earlyRead`s before all `write`s in a tick) keeps other components' writes from interleaving.

**(b) D11 projection.** The restore target the activation rAF will use is "bottom when pinned or
`savedScrollTop === null`, else the saved offset" (`:1387-1391`). The new code mirrors the decision exactly:
unpinned with a saved offset returns the pane fade (`:1100-1102`, as plan section 6 specifies, not a
projection); every other case projects to `scrollHeight - clientHeight`. The viewport is the scroller rect
moved down by `target - scrollTop` (`:1105-1112`). Geometry check: after the restore a slot with current
rect top `t` appears at `t - offset`, and it is visible iff `t` is within `[rect.y + offset, rect.y + offset
+ h)`, which is the shifted viewport. Correct for pinned, for first show with no saved offset (spec
`projects the pending pinned restore...` asserts `scrollTop` is 0 and the tall last reply alone is marked
with index 0), and for a `display:none` retained transcript whose `scrollTop` the browser reset to 0.

**(c) `selectVisibleEntrance`** (`transcript-entrance.ts`). Empty input and `cap <= 0` return `[]`. Slots
entirely below are skipped (`continue`), the walk stops at the first slot with `bottom <= viewport.top`, a
partly visible top slot is kept, the cap stops the walk, and the result is reversed (oldest visible first,
index 0). The unit spec covers each of those, including a poisoned `rect` getter proving that nothing
older than the stop slot is read.

**(d) Entering edge.** Only a change of `entering()` passes `:1083-1086`; `wasEntering` makes the effect
act on edges, and the falling edge clears synchronously (`:1089-1092`, `clearEntrance` `:1446-1457`
removes class, `--i`, `data-enter-i`, and the pane class). Destroy bumps the generation first and clears
(`cleanup`, `:1427-1428`, registered on `destroyRef` at `:1297`). The snapshot is taken once per rising
edge, so later stream, replay or resync ids (new elements) are never marked; spec
`never marks streaming or resync slots added after the snapshot` pins this. A->B->A: A's falling edge
clears its marks in one tick and its next rising edge marks again (spec `clears falling-edge marks and
re-arms on rapid A to B to A`). A falling edge between `earlyRead` and `write` is caught by the generation
re-check (`:1132`).

**(e) Retained vs non-retained load (round-1 finding 2).** The snapshot is taken in the after-render phase of
the tick in which the parent bound `active=true` and `entering=true`. The component effect runs before the
transcript's template is refreshed, so `vm()` has already left `_frozenView`, the `@for` has diffed in the
messages appended while hidden, and `viewChildren` is refreshed before after-render hooks run. `earlyRead`
checks `workActive()` and `vm().slots.length` after that, and uses `slotRefs()` (current wrapper elements),
never a cached list. A non-retained session with zero slots at the edge returns "nothing" (`:1097`), and the
spec confirms history arriving a tick later, then a replay on/off, marks nothing. If a host binds `entering`
before `active`, the pass aborts on `!workActive()` and that switch has no entrance (safe, as the plan says).

**(f) CSS** (`chat-transcript.component.css:1-20`). `ptahTurnEnter` animates opacity and `translateY` only;
`.ptah-pane-enter` is opacity only (`ptahFadeIn`, defined at `:106`); reduced-motion block sets
`animation: none !important; animation-delay: 0ms !important`. The `:host` tokens are gone from the
transcript and now resolve from `:root` in `styles.css:40-45` (`--ptah-ease-soft`, `--ptah-ease-gentle-in`,
`--ptah-motion-in`, `--ptah-stagger-step`), and the remaining transcript uses (`:125`, `:129`) still
resolve. `animation-delay` is declared after the `animation` shorthand, so it is not reset. The old
`.st-t` / `ptahStaggerUp` / `:host` tokens in `chat-view.component.css` (`:126-127`, `:200`, `:228`) are
untouched, as required until B5. The template change is a comment only.

**(g) Specs** use real `ChatTranscriptComponent` instances in a host binding `[active]` / `[entering]` and
drive `detectChanges` plus `ApplicationRef.tick()`, with `getBoundingClientRect` and scroll metrics stubbed
by geometry (slot rect = index x height). That exercises the real active, vm-freeze and after-render path,
which a signal-only test would not.

### Defects

**B4-1 (Moderate) - Component-level specs under-test the behaviour the plan listed.**
- Retained test (`'selects current B slots after hidden B received messages...'`) asserts exactly one mark,
  `['B-11']` index `0`. It never shows "up to 6 from the newest visible current slots, `--i` rising from 0",
  and with 100 px slots in a 100 px scroller the frozen-snapshot bug would produce a different single id,
  which this does catch, but an order or off-by-one regression across several slots does not.
- No component-level test of the cap (6): every geometry yields at most 2 visible slots. The cap is proved
  only on the pure function.
- No assertion that `earlyRead` is write-free (acceptance criterion "reads only in `earlyRead`"). A
  regression that adds `classList.add` to `earlyRead` passes the suite.
- The falling-edge test checks the class only; `--i` and `data-enter-i` removal (`:1450-1451`) are untested.
- Fix: add (1) a 40 px-slot case in a 300 px scroller expecting exactly `B-4..B-9` with `data-enter-i`
  0..5 and no `B-3`; (2) a retained case on that geometry; (3) a spy on `Element.prototype.setAttribute` /
  `classList.add` asserting no call occurs between the first `getBoundingClientRect` stub call and the
  write phase, or simpler, assert `renderer.addClass` is not reached before `earlyRead` returns by
  snapshotting classes inside the rect stub; (4) assert `--i` / `data-enter-i` are absent after the falling
  edge.

**B4-2 (Minor) - The component re-implements `selectVisibleEntrance`'s walk.** `component.ts:1114-1127`
duplicates the visibility test, the stop rule and the cap, then calls `selectVisibleEntrance` on the result
and re-looks-up elements with `measured.find`. The two copies agree today (`<` / `>=` at the same
boundaries), but they can drift, and the second pass adds nothing. The plan allowed "a lazy iterable
adapter". Fix: make `itemsNewestFirst` an `Iterable` and pass a generator that reads the rect of each slot
lazily and yields `{ id, rect, element }`; delete the manual loop and the `find`. The existing "does not
read an item older than the first fully above slot" spec already proves the laziness contract.

**B4-3 (Minor) - Zero-height slots count as visible.** A wrapper with no rendered content (`.chat-msg-slot`
is `display:block`, `:61-63`) has top == bottom. If it lies inside the viewport it passes both tests, takes
a cap slot and an index, and delays every later (visible) message by 28 ms without animating anything
itself. Fix: in `selectVisibleEntrance`, `continue` when `rect.height <= 0` (before the stop rule), and add a
unit case.

**B4-4 (Minor) - Rect reads below the viewport are unbounded.** The skip branch (`continue`) bounds nothing,
so if the projection is wrong (content shrinks between measure and restore, a trailing spacer) the loop
reads every slot below the viewport before it reaches visible ones. With the pinned projection this is zero
in practice, so the reads are the planned "1 + about 7". Folded into B4-2's fix: the lazy iterable plus a
hard limit (for example 24 reads) before giving up with an empty selection.

**B4-5 (Minor, observation) - Edge coalescing.** `wasEntering` is a plain field; if `entering` goes
true -> false -> true before the effect runs (two programmatic switches in one tick), the effect sees no edge,
no new snapshot is taken and the old marks stay until the next falling edge. Harmless visually (animation
already played), and B5's timer re-arm bounds it. No action needed unless B5 makes such double switches
routine.

### Five logic questions (B3 and B4 combined)

1. **Silent failure.** B3: a deferred correction dropped after a navigation that starts but never ends leaves a
   stale `/chat` URL with no error (B3-1). B4: when the host binds `entering` before `active`, or the
   transcript has no slots at the edge, the entrance silently does not run (designed, safe).
2. **Unexpected user action.** Rapid tab clicks during a page transition coalesce to one replace (verified by
   spec). A->B->A switches clear and re-arm marks correctly. Switching away and back inside one tick gives no
   second animation (B4-5).
3. **Wrong answer on data.** Zero-height slots take cap slots and indices (B4-3). Placeholder heights that
   change after restore can make the projection a few pixels wrong; effect is a missing or extra stagger
   step, not a defect in behaviour.
4. **Dependency failure.** Rejected/skipped transition: flushes. Never-settling transition: waits forever
   (B3-4). Missing scroller element: "nothing". `matchMedia` throw: handled in the tracker.
5. **Missing requirement.** None blocking. Components could use a tracker-side timeout (B3-4) and a read cap
   (B4-4).

### Data flow (B4)

1. Parent binds `active=true`, `entering=true` -> component effect sees the rising edge (OK, edge-based).
2. Effect registers one `afterNextRender` with a generation (OK).
3. Template refresh unfreezes `vm`, diffs slots, refreshes `viewChildren` (OK, before the hook).
4. `earlyRead`: abort checks -> pane fade or projected measurement -> selection (OK; B4-2/3/4 notes).
5. `write`: generation re-check -> marks or pane class (OK).
6. Restore rAF scrolls to the projected target (OK, matches the projection).
7. Falling edge or destroy -> `clearEntrance` (OK).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| B3 four-condition discard guard | COMPLETE | (d) untested in isolation (B3-2) |
| B3 idle behaviour unchanged | COMPLETE | none |
| B3 rejected/skipped transition flushes | COMPLETE | none |
| B3 no leaked subscription | COMPLETE | none |
| B4 reads/writes split, no forced layout | COMPLETE | write-free `earlyRead` not asserted (B4-1) |
| B4 D11 projection, pinned and first show | COMPLETE | none |
| B4 `selectVisibleEntrance` rules | COMPLETE | zero-height slots (B4-3) |
| B4 rising-edge-only marking, cleanup, destroy | COMPLETE | none |
| B4 retained vs non-retained snapshot | COMPLETE | multi-slot retained case thin (B4-1) |
| B4 CSS: transform/opacity, reduced motion, tokens, old path untouched | COMPLETE | none |
| B4 real-behaviour specs | PARTIAL | cap and ordering on the component (B4-1) |

## Recommendation

APPROVE both batches. Confidence HIGH on the logic of B3 and B4; MEDIUM on runtime motion (M1 evidence is
not part of this review). Suggested follow-up before B5, in priority order: B3-1 (with its spec), B4-1
(specs), B4-2/B4-3/B4-4 (one small change to `transcript-entrance.ts` and the component loop), B3-2.
