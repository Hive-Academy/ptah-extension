# Code Logic Review, Phase C (TASK_2026_700_dcce)

Reviewer: Anthropic family (independent of the codex implementer lanes).
Scope: command-node-detail, command-work-list, command-pending-input (components and specs), read in full, plus the C1 and C2 diffs. I ran no nx, jest or build.

## Verdict: NEEDS_FIXES. Score 6.5/10

The behaviour is mostly sound. Nesting, keyboard wrap, focus return, the Tribunal guards and D9 compliance hold up. One real regression (root task dropped) breaks an existing spec. There is also one lint error that fails the gate, and a few smaller defects.

## Defects

1. **Blocking: root task no longer shown (fails command-overlay.component.spec.ts:133).**
   - File: `command-node-detail.component.ts:206`.
   - `taskPreview` starts with `if (this.node().kind === 'root') return null;`. The design only says the root omits the body line that repeats the subtitle. The root subtitle is already `null` (line 194), so the early return hides a real user task.
   - Fix: delete line 206. The existing `firstLine !== this.subtitle()` check already handles the dedupe, because `null` never equals a task string. The task stays rendered as text interpolation `Task: {{ task }}` at line 106, so `<b>Review</b>` is escaped and there is no innerHTML. This restores the overlay spec, where the card must contain `<b>Review</b>` as text.
   - Also add a node-detail spec case: a root node with a task renders `Task: <first line>`.

2. **Serious (lint gate): `ngAfterViewInit` without the interface.**
   - File: `command-work-list.component.ts:140` (class) and `:202` (method).
   - Fix: `implements AfterViewInit, OnDestroy`, and add `AfterViewInit` to the `@angular/core` import.

3. **Lint warnings (4).**
   - File: `command-work-list.component.spec.ts:319-322`.
   - The FakeResizeObserver members need `public`: `public observe`, `public unobserve`, `public disconnect`, and `public constructor(...)`.

4. **Moderate: the assertive pending live region sits inside the `@if (pending())` block.**
   - File: `command-pending-input.component.ts:31`.
   - A live region that is inserted already containing text is often not announced by screen readers. Parity row 38 requires an assertive pending announcement.
   - Fix: render a permanent `<p class="sr-only" aria-live="assertive" aria-atomic="true">{{ pending() ? 'Action required: ' + pending()!.title : '' }}</p>` outside the `@if`. Wrap the section in an outer element or use two top-level nodes. Add a spec asserting the region exists while `pending` is null.
   - Lines 92, 195 and 201 are `role="status"` (implicit polite), so the pending card has its own live regions besides the work list's polite region. These are error text only and acceptable, but note them against "ONE polite region" (row 38).

5. **Moderate: `updateClipping()` runs on every render and forces a layout read.**
   - File: `command-work-list.component.ts:222`.
   - `afterEveryRender` runs on every change-detection pass in the page, including the per-tick `now` updates. It does `querySelector` plus `scrollHeight` and `clientHeight` reads each time.
   - Fix: gate it so it only runs when the row count or the ul content changes. For example, an `effect` or `afterRenderEffect` that reads `rows().length`, plus the existing ResizeObserver and scroll handler.
   - Fix: also drop the duplicate initial call in `ngAfterViewInit` (line 207), since `afterEveryRender` already covers it.

6. **Moderate: the roving `activeIndex` is positional, so it is stale after a reorder.**
   - File: `command-work-list.component.ts:183`, `:196`.
   - When a node is added or removed, or a parent arrives and moves rows, the numeric index silently points at a different row. The tab stop moves, and focus restore by index (`focusRow`) can land on the wrong row after relayout.
   - Fix: store the active node id and derive the index from `rows()`, falling back to 0.

7. **Minor: Provider line shows "unknown".**
   - File: `command-node-detail.component.ts:88` and `:183-190`.
   - The work list hides provider `'unknown'` (`work-list:247`), but the detail card renders "Provider: unknown" with a monogram tile.
   - Fix: reuse the same guard, `providerId && providerId.toLowerCase() !== 'unknown'`, in the `@if` at line 88. The spec should not assert an "unknown" provider line.

8. **Minor: static subtitle text is not backed by data.**
   - File: `command-node-detail.component.ts:196-202`.
   - The default branch returns "Delegated engineering work" for any other kind, for example `agent` and `tribunal-lane`. This is generic copy, not a real field. Accept it if the design lists it, otherwise show nothing for unmapped kinds (return `null`).

9. **Minor: tests do not cover nesting edge cases.**
   - File: `command-work-list.component.spec.ts` (nesting test).
   - The code at `command-work-list.component.ts:144-165` handles a missing parent (promoted to depth 0), a cycle or self-parent (the last loop at line 163 visits leftovers) and the depth cap of 3. I verified this by reading, and it is correct.
   - None of these three cases has a test. Add one case with an orphan `parentId`, one with a mutual cycle (A and B each the other's parent, expecting both rows exactly once), and one chain of 5 expecting a 3-level pad cap (`8 + 3*16 = 56px`).

10. **Minor: the invalid-proposal disabled Confirm has no explanation hook.**
    - File: `command-pending-input.component.ts:104` (the disabled `Confirm Tribunal` button).
    - A disabled button with no `aria-describedby` to the "Invalid Tribunal proposal" status text gives a screen-reader user no reason. Fix: give that status paragraph an id and add `aria-describedby` on the button.

## Capability and parity check (no regressions found beyond the above)

- **Keyboard (rows 20-23):** ArrowUp and ArrowDown wrap over the flat DOM order (`work-list:263-279`). Enter selects. Roving `tabindex` is on (line 58). `aria-current` is on (line 57). Focus return maps the projection index to the row by id (`:185-195`). The wrap test covers both directions (spec "wraps the flat keyboard index").
- **Announcements (row 38):** There is one polite region in the work list. The state-transition effect (`:223-235`) is unchanged.
- **Pending (rows 25-30):** The guards are untouched. They are the timedOut/respondedIds/inFlightIds checks in `respond`, the `confirmRoster` guards, and `confirmFromKey` with `event.target !== document.activeElement`. The typed answer resets through `linkedSignal`. Rejection and timeout feedback are intact. The invalid proposal now shows a disabled Confirm, and `confirmRoster` still rejects it. The new Tribunal test exercises the focus guard on Enter and Space.
- **Untrusted text:** All interpolation, with no `innerHTML` in any of the three components.
- **D9:** There is no Open tab control and no tab-availability text. A search of the diff found none. The child glyph is display only.
- **N1:** The asserted strings are retained: `N messages`, `~12.3k tokens`, `Confirm Tribunal`. The overlay failure is defect 1.
- **N3:** The ResizeObserver is created behind `typeof ResizeObserver !== 'undefined'`, observes one element, and is disconnected in `ngOnDestroy` (`:204-212`). The spec asserts the single observe call and the disconnect.
- **Reduced motion:** Spin classes are gated on `reducedMotion()` in both detail and list. No new infinite animation was added.
- **Dead code:** `delegatedNodes` is now a derived pass-through of `rows`. It is still used for the counts and the announcements, so it is acceptable. In node-detail, `firstLine !== this.subtitle()` is nearly dead once the root special case is removed. It is harmless.
- **Scroll cue and fade:** `isClipped && !atEnd` is correct, with a 1px tolerance (`:217-218`). The scroll handler on the ul updates `atEnd`. Both cue and fade are `aria-hidden` and `pointer-events-none`.

## Required to pass

Fix defects 1 and 2 (they fail the spec and lint). Fix 3 with them. Defects 4-6 are recommended before the phase gate. Defects 7-10 can ride along.
