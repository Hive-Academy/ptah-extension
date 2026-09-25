# Code Logic Review — `TASK_2026_494_ca38` (Batch 20, round 2, FINAL)

## Summary

| Metric               | Value    |
| --------------------- | -------- |
| Overall score          | 9/10     |
| Assessment             | APPROVED |
| Blocking issues        | 0        |
| Serious issues         | 0        |
| Moderate issues        | 0        |
| Failure modes found    | 0 new (all round-1 modes resolved) |

Scope examined: full diff of `libs/frontend/core/src/lib/services/electron-layout.service.ts` (+`.spec.ts`)
and `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts`, read whole, against the round-1
serious finding (S-1/MOD-1/FM-1), the two moderate findings (M-2/MOD-2, M-3), and the two minor findings
(MIN-1, M-4/MIN-2/FM-4). Re-read `apps-page-splitter.spec.ts` in full (501 lines, 21 tests, was 374/11).
Independently re-ran both suites rather than trust `batch-20-fix-1-report.md`'s counts:
`npx jest -c libs/frontend/mcp-apps-page/jest.config.ts apps-page-splitter.spec.ts` → 21/21 green;
`npx jest -c libs/frontend/core/jest.config.ts electron-layout.service.spec.ts` → 98/98 green (was 97, +1
rounding spec, matches the report). `ptah_get_diagnostics` (unscoped, workspace tsconfig) surfaces 99
pre-existing errors, none in `electron-layout.service.ts` or `apps-page.component.ts` production code; the
`electron-layout.service.spec.ts` and `mock-rpc-service.ts`/`monaco-loader.service.ts` hits match the fix
report's named baseline and are far from the touched line ranges (1170-1244, 2080-2141) — consistent with
round 1's conclusion that this tool's unscoped project resolution is noisy on this repo and the scoped gate
(`tsc -p .../tsconfig.spec.json`, reported clean at exactly 8 baseline errors) is the trustworthy one.

Fix round 1 resolves every round-1 finding with a real code change, not a re-labelling. I traced the new
logic by hand (not just read the diff) against seven scenarios the fix report did not spell out — a
returning drag through an intermediate real change, a container resize mid-gesture, a no-op keydown at the
start of a key run, double-fire of the destroy hook, Escape during a keyboard (not pointer) resize — and
found no new defect. The write-path narrowing (S-1) is fixed correctly and symmetrically for both gestures;
the commit-gating (M-2/MIN-1) and destroy-flush (M-3) fixes are exact, not approximate. Nothing here rises
to a correctness defect; the two residual notes below are the same non-blocking items already carried from
round 1 (nested separator a11y, Escape not wired to the keyboard path) with no new material added.

## Confirm table

| # | Item | Verdict | Evidence |
| - | ---- | ------- | -------- |
| 1 | Keyboard/drag no longer overwrite the stored preference on a no-visible-change interaction | CONFIRMED | `apps-page.component.ts:393-403` (`onSplitKeydown`): `target = clampSplitWidth(shown + direction*step)`; `if (target === null \|\| target === shown) return;` — returns before touching `keyRunStartStored` or calling `setAppsSplitWidth`. `apps-page.component.ts:365-374` (`onSplitDragMoved`): `target === drag.startShown ? drag.startStored : target` — a frame that reproduces the drag-start *shown* width writes back the drag-start *stored* width, not the clamped target. Pinned live: `apps-page-splitter.spec.ts:393-404` (ArrowRight/Shift+ArrowRight at the 334 ceiling with stored 900: `layout.appsSplitWidth()` stays `900`, `setState` never called, widening to 1400 shows `900px`); `:406-416` (ArrowLeft 334→318: sets and persists 318 — the ruling's example, verbatim); `:418-429` (drag past the ceiling keeps 900 and writes nothing; a real move to 500 sets 500; a return to the ceiling restores 900); `:444-451` (Escape after a visible drag restores 900, not the shown 634, zero writes). Independently re-ran: 21/21 green. |
| 2 | Persistence only when the stored width changed since drag/key-run start | CONFIRMED | `apps-page.component.ts:380-386` (`onSplitDragEnded`): commits only `if (this.layout.appsSplitWidth() !== drag.startStored)`. `:413-419` (`commitKeyResize`): commits only `if (this.layout.appsSplitWidth() !== start)`. Pinned: `:294-303` (Escape, 0 writes, 360 restore still checked); `:455-463` (window blur, 0 writes); `:465-471` (plain click, press+release with no move, 0 writes); `:473-480` (key run back to its start, 0 writes); `:279-292` and `:431-442` (a real drag, exactly 1 write, correct value). |
| 3 | Destroy mid-drag commits a changed width only | CONFIRMED | `apps-page.component.ts:326-330`: the `DestroyRef.onDestroy` hook now runs `this.commitKeyResize(); this.onSplitDragEnded();` before the (separately registered) observer-disconnect hook. Both callees are idempotent no-ops when their respective gesture state is already `null`. Pinned: `:482-492` (destroy mid-drag with a changed width, LEFT+420, exactly 1 write with `appsSplitWidth: 420`); `:494-499` (destroy mid-drag with no change, press only, 0 writes). |
| 4 | `Math.round` in `setAppsSplitWidth` | CONFIRMED | `electron-layout.service.ts:215-222`: `Math.round(Math.min(Math.max(width, MIN_APPS_SPLIT_WIDTH), MAX_APPS_SPLIT_WIDTH))`, applied after the clamp so out-of-range fractional inputs round to the correct in-range integer. `restoreLayout()` (`:664-667`) routes through this same setter, so a fractional persisted value is rounded on restore too. Pinned: `electron-layout.service.spec.ts:1188-1195` (360.75→361, 420.4→420, 239.6→240). Independently re-ran: 98/98 green (was 97). |
| 5 | The two changed assertions are not weaker | CONFIRMED | `apps-page-splitter.spec.ts:294-303` ("keeps the handle's Escape restore exact and writes nothing") still asserts the exact restore (`layout.appsSplitWidth()` and `layoutColumn()` both `360`) *and* now additionally asserts `setState` is never called — strictly more coverage than the round-1 version, not less. `:324-336` ("clamps key resizes and leaves other keys alone", `mount(700)`) still asserts the display clamps to `334` and the 240 floor after 10 repeated Shift+ArrowLeft presses, and still asserts `ArrowUp`/`Enter` are ignored (`key(...)` returns `false`, width stays `240`) — the original clamp-bound and other-keys-ignored assertions are untouched; the only addition is `expect(layout.appsSplitWidth()).toBe(360)` after the Shift+ArrowRight-at-ceiling press, which is the fix itself being pinned, not a weakening. |
| 6 | `aria-keyshortcuts` correct | CONFIRMED | `apps-page.component.ts:254`: `aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"`, matching the actual step keys (`SPLIT_KEY_DIRECTION` at `:54-57`, step sizes at `:52-53,398`). Pinned: `apps-page-splitter.spec.ts:240-242`. |
| 7 | No regressions in the unchanged guarantees | CONFIRMED | Offset/grab math: `apps-page.component.ts:348-357` unchanged from round 1, still exact (`onSplitPointerDown` records `startShown`/`offset`/`startStored`; algebra re-verified: `pointerX - left - offset` recovers `startShown` at `pointerX == clientX0`), pinned `:251-260`. Clamp + non-finite rejection: `clampSplitWidth` (`:422-427`) and `setAppsSplitWidth` (`electron-layout.service.ts:216`) both still guard with `Number.isFinite`, pinned `apps-page-splitter.spec.ts:262-277` and `electron-layout.service.spec.ts:1197-1205`. ResizeObserver cleanup: `apps-page.component.ts:326-341`, two independent `DestroyRef.onDestroy` registrations (gesture-flush unconditional, observer-disconnect gated on `ResizeObserver` existing), pinned `apps-page-splitter.spec.ts:373-379`. ARIA values: `:257-259` unchanged, reactive off `splitWidth()`/`splitMinWidth`/`splitMaxWidth()`, pinned `:228-249,313,328,353`. Stacking: `stacked` computed (`:292-295`) and `@if (!stacked())` (`:246`) unchanged, pinned `:359-371`. `LAYOUT_STATE_KEY` write path: `persistLayout()` (`electron-layout.service.ts:612-627` per diff context) adds `appsSplitWidth` to the object literal without removing any existing field (`sidebarWidth`, `sidebarVisible`, `editorWidth`, `editorVisible`, `gitRailWidth`, `gitRailCollapsed` all still present in the diff hunk); confirmed by `electron-layout.service.spec.ts:1210-1226` (object equality assertion including every field) and `:2138-2150` (another writer's payload still carries `appsSplitWidth: 480` via `objectContaining`). B15 (page holds no width state): the page's only fields are `containerWidth` (measurement), `drag` (per-gesture: grabOffset/startShown/startStored) and `keyRunStartStored` (per-run bookkeeping) — none is a persisted width, consistent with the class doc (`apps-page.component.ts:18-48`). B8 (synchronous write-back): `commitAppsSplitWidth()` calls `persistLayout()` directly, no `await`/microtask boundary (`electron-layout.service.ts:224-226`). Interaction via computed: `splitWidth`, `splitMaxWidth`, `stacked` are all `computed()` (`:292-311`). No `innerHTML`: none in either file (confirmed by full read). |
| 8 | Every round-1 finding: resolved/partial/not resolved | See below | |

### Round-1 finding disposition

| Round-1 finding | Severity | Disposition | Evidence |
| ---------------- | -------- | ----------- | -------- |
| S-1 / FM-1 (mine) = MOD-1 (antigravity): keyboard/drag while clamped truncates a wider stored preference | Serious | RESOLVED | Confirm items 1, 7 above; red/green in `batch-20-fix-1-report.md` independently corroborated by re-running the full suite green (21/21) and by hand-tracing the `target === shown`/`target === drag.startShown` guards. |
| M-2 / FM-2 (mine) = MOD-2 (antigravity): Escape/blur restore always commits | Moderate | RESOLVED | Confirm item 2; `onSplitDragEnded` now gates on `appsSplitWidth() !== drag.startStored`. |
| MIN-1 (antigravity, merged into M-2 in my round-1): plain click persists | Minor | RESOLVED | Same gate as above; a click with zero movement leaves `drag.startStored === layout.appsSplitWidth()`, so no commit. Pinned `:465-471`. |
| M-3 / FM-3 (mine): no destroy-time flush for a pointer drag in progress | Moderate | RESOLVED | Confirm item 3. |
| M-4 / MIN-2 / FM-4 (both): sub-pixel width stored while display rounds | Minor | RESOLVED | Confirm item 4. |
| M-5 / FM-5 (mine): nested `role="separator"` | Minor/awareness | NOT RESOLVED (by design, correctly deferred) | No code change; `batch-20-fix-1-report.md` explicitly routes this to the visual/a11y review rather than a code fix, matching my round-1 recommendation ("worth a screen-reader spot check at the visual review rather than a code change here"). Carried forward below, not re-raised as a code finding. |

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was introduced. The two silent paths noted in round 1 — non-finite coordinates
dropped without a `console.warn` (`apps-page.component.ts:423`, `electron-layout.service.ts:216`) — are
unchanged and were already agreed by both round-1 reviewers to be deliberate, consistent with every other
setter in `ElectronLayoutService`. Checked again for a new one specific to the fix: the `target === shown`
/`target === drag.startShown` early-returns in `onSplitKeydown`/`onSplitDragMoved` are themselves silent (no
log), but that silence is the fix's entire point — a no-op interaction must look like nothing happened, and
it does not touch storage, so there is nothing to warn about.

### 2. What user action produces unexpected behaviour?

None found that the fix leaves open. I specifically hand-traced the case the fix report does not narrate —
returning to the drag-start width through an intermediate *different* real value (`apps-page-splitter.spec.ts:418-429`,
900 → clamped-334-equivalent(no-op) → 500(real) → back to 634(=startShown, restores 900)) — because the
guard compares every frame against the fixed `drag.startShown` reference captured once at `onSplitPointerDown`,
not against the previous frame, so a there-and-back-again drag correctly restores the true preference
regardless of what happened in between. I also traced pressing Escape *during a keyboard* (not pointer)
resize: `onSplitKeydown` only recognises `ArrowLeft`/`ArrowRight` (`SPLIT_KEY_DIRECTION`, `:54-57`), so an
`Escape` keydown on the separator falls through both branches and does nothing — the in-progress key run is
not cancelled, only left pending until `keyup`/`blur`/destroy commits or discards it by the existing
same-as-start check. This was true before this round too (the batch brief only asked for Escape/blur restore
on the drag handle, which owns that behaviour natively) and is not a new gap from the fix; noted for the
visual review as an implicit-requirements item, not a logic defect.

### 3. What input data produces a wrong answer?

None new. A container resize firing mid-gesture (between two `dragMoved` frames, or between two keydowns) is
still handled correctly because `splitMaxWidth()`/`splitWidth()` are computed fresh on every read — `drag.startShown`/`drag.startStored`
are fixed at pointer-down, but `clampSplitWidth` always clamps against the *current* `splitMaxWidth()`, so if
the container shrinks mid-drag such that the pointer's original position is no longer achievable, `target`
will legitimately differ from `drag.startShown` and the narrower value is set — a real container-driven
change, not a bug. No spec pins this exact interleaving, but it cannot silently corrupt the stored value: any
write it produces reflects the container truly no longer fitting the old position, which is within the
batch's stated clamp contract.

### 4. What happens when a dependency fails?

Unchanged from round 1: `ResizeObserver` absence is handled (`apps-page.component.ts:333`); `VSCodeService.setState`
without `window.vscode` logs and returns without throwing (pre-existing, untouched by this diff); `ElectronResizeHandleComponent`
destroyed mid-drag now *is* handled by this fix (previously M-3) — the parent's own `DestroyRef.onDestroy`
flushes the drag itself rather than depending on the child to emit `dragEnded`, which sidesteps the original
gap entirely rather than working around it.

### 5. What is missing that the requirements never mentioned?

Same two carry-forwards as round 1, neither of which the batch brief specifies and neither of which is a
logic defect: (a) the nested `role="separator"` a11y double-announcement risk (visual/a11y review item); (b)
no Escape-cancel path for an in-progress *keyboard* resize (only the pointer-drag handle has built-in
Escape/blur restore, per the brief's own wording — "Escape/blur restore is built into the handle"). Both are
pre-existing, not introduced or worsened by this fix round.

## Failure modes

None found in this round beyond the round-1 modes, all of which are resolved per the confirm table above.
Scope examined: full re-read of both production files, full re-read of the new/changed spec file
(21 tests), independent test execution of both suites, and hand-traced counterfactuals (return-through-a-real-value
drag, mid-gesture container resize, Escape during keyboard resize, double-fire of the destroy hook,
no-op-keydown-then-real-keydown within one key run) that neither reviewer's round-1 report walked through
explicitly. No residual uncertainty beyond the two carried notes, both already routed to the visual review.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None new. Carried forward for the visual/a11y review only (not re-raised as code-logic findings, per the
coordinator's original routing):

- Nested `role="separator"` (`apps-page.component.ts:249-250` wrapping `electron-resize-handle.component.ts:34-38`,
  unchanged) — screen-reader spot check.
- No Escape-cancel for an in-progress keyboard resize (only the pointer-drag handle has built-in cancel) —
  not a stated requirement; flag only if the visual review's manual QA finds it surprising in practice.
- Already-ruled, not re-raised: the 481-605px band (deferred to R10 visual review), service length (accepted),
  `persistLayout()` never persisting `workspaceFolders`/`activeWorkspaceIndex` (pre-existing follow-up).

## Data flow

1. **Restore (app boot):** unchanged from round 1, still correct — `restoreLayout()` gates on `typeof === 'number'`,
   `setAppsSplitWidth` gates on `Number.isFinite`, clamps to `[240, 1200]`, now also rounds — OK, pinned
   `electron-layout.service.spec.ts:2085-2141`.
2. **Mount:** unchanged — OK.
3. **Drag frame:** `dragMoved` → `onSplitDragMoved` now compares the clamped target to the drag-start
   *shown* width and, on a match, writes the drag-start *stored* width instead of the clamped target — OK,
   this is the S-1 fix, verified by hand and by test.
4. **Gesture end (drag/key):** `commitAppsSplitWidth()`/`commitKeyResize()` now gate on the stored width
   having actually changed since gesture start before calling `persistLayout()` — OK, this is the M-2/MIN-1 fix.
5. **Destroy:** now flushes both a pending key run and a pending drag (via the same conditional-commit logic
   used at normal gesture end) before the observer disconnects — OK, this is the M-3 fix.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Reuse `ptah-electron-resize-handle`, no fork | COMPLETE | None. |
| Subtract container left offset; no jump on pointer-down | COMPLETE | None. |
| Clamp, reject non-finite | COMPLETE | None (round-1 PARTIAL now resolved — the clamp no longer silently overwrites the true stored preference). |
| Escape/blur restore | COMPLETE | Restore is exact and, as of this round, a true no-op on the write path. |
| Keyboard resize + ARIA | COMPLETE | None. |
| Persist on commit only, in `LAYOUT_STATE_KEY` | COMPLETE | Write-path shape and write-path correctness both hold now. |
| Page holds no width state | COMPLETE | None. |
| Hidden/stacked ≤480px and embedded sidebar | COMPLETE | None. |

Implicit requirements not addressed: none blocking. The two carry-forwards above (nested separator,
Escape-cancel for keyboard resize) are visual/a11y-review items, not implementation gaps against the stated
brief.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Stored width exceeds container fit, no interaction | YES | Display clamps; stored value untouched | None |
| Stored width exceeds container fit, then a no-op key/drag interaction | YES (fixed) | `target === shown`/`target === startShown` guards skip the write | None |
| Stored width exceeds container fit, then a real (visibly different) key/drag interaction | YES (by design, per coordinator ruling) | Sets and persists the new value — a real choice | None; this is the explicitly ruled-on behaviour |
| Non-finite drag coordinate (NaN/Infinity) | YES | `Number.isFinite` in both page and service | None |
| Escape/blur mid-drag (unclamped) | YES | Restores exact width, 0 writes | None |
| Escape/blur mid-drag (clamped) | YES | Restores the true stored width, not the shown value, 0 writes | None |
| Plain click, no movement | YES | 0 writes | None |
| Repeated/held arrow key | YES | Single commit on `keyup`, skipped if net width unchanged | None |
| Component destroy mid key-resize | YES | `commitKeyResize()` on destroy | None |
| Component/handle destroy mid pointer-drag | YES (fixed) | `onSplitDragEnded()` now also runs on destroy | None |
| Malformed/missing persisted `appsSplitWidth` | YES | `typeof`/`Number.isFinite` gates, falls back to 360 | None |
| Fractional persisted/dragged width | YES (fixed) | `Math.round` in `setAppsSplitWidth` | None |
| Container ≤480px | YES | `@if (!stacked())` + CSS `@container` | None |
| 481-605px band | Partially (accepted) | Deferred to visual review per coordinator ruling | Not re-raised |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none rising to a correctness defect. The only residual items are a visual/a11y nested-separator
  note and the absence of an Escape-cancel path for keyboard resize, both pre-existing, both out of this
  round's scope, both already routed to the visual review.
- What a robust implementation would add: nothing required. Optional polish for a future pass: a
  `console.debug`/telemetry hook on the non-finite-input drop paths (still not a defect, just an
  observability nicety both round-1 reviews already agreed was out of scope).
