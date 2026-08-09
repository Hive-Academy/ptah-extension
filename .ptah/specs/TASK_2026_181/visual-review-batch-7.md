# Visual Review — Batch 7 — TASK_2026_181

## Methodology and limitation (read this first)

No running VS Code or Electron host was available to me, matching the limitation stated by the three agents before me on this task. `ptah_browser_navigate` was not exercised (localhost was blocked for the Batch 3 reviewer under the same conditions, and nothing in this environment indicates that changed). **This review is static analysis only**: reading the actual template/class source for every file in scope, reading the compiled daisyUI CSS (`node_modules/daisyui/dist/full.css`) and the theme-generation source (`node_modules/daisyui/src/theming/functions.js`) to get the _exact_ colours the browser will paint (including daisyUI's own auto-generated `*-content` algorithm, not just the ones hand-specified in `tailwind.config.js`), and recomputing WCAG 2.1 relative luminance from those literal values by hand. Anywhere I could not get a literal value, I say so and give a bounded estimate rather than asserting a number.

I did not re-verify Gate 1/Gate 2 from Batch 3 (`LABEL_CHIP_CLASSES`, comment-node pixel-identity) — those are unchanged by Batch 7 and already covered. This pass is scoped to the five Batch 7 files.

---

## 1. The filter bar at 256px (and narrower)

`task-filter-bar.component.ts` is mounted once, above the whole board (`tasks-view.component.ts:192-203`), not per-column — so unlike the card, it isn't forced to live at exactly 256px; it spans the full view. Still assessed at 256px per the brief, since the view can be a narrow split-editor tab.

**No horizontal-overflow risk, structurally — this is the good news.** Both rows (`task-filter-bar.component.ts:194` controls row, `:353` chips row) are `flex flex-wrap`, so at any width the content wraps down rather than forcing a scrollbar. The `w-44` (176px) text input alone consumes most of a 256px row, so at that width the bar will wrap into roughly 8-10 short rows (icon+input, then one facet button per row or two, then ANY/ALL if present, then warnings/sort/direction/count/clear each mostly on their own row) — a lot of vertical space, but not a break.

**Chips do NOT reintroduce the Batch 3 label-overflow bug.** `task-filter-bar.component.ts:363`: `<span class="max-w-[10rem] truncate">{{ chip.value }}</span>` — every chip's value is capped and truncated exactly the way Batch 3 asked the card to do. Eight chips with long user-authored labels wrap the `<ul>` (`:352`) onto multiple rows; none of them can force the row wider than its container. **Confirmed: the specific defect class Batch 3 found (missing `truncate`/`max-w` on user text) was not reintroduced here.**

**A real, new overflow risk: the facet-menu popup itself.** `task-filter-bar.component.ts:106-107`:

```html
<ul class="dropdown-content menu menu-xs z-30 mt-1 w-56 ... "></ul>
```

`w-56` = 224px, fixed. The trigger is a bare `<details class="dropdown">` (`:94`) with **no `dropdown-end` and no collision handling** — daisyUI's default `.dropdown-content` opens left-aligned to the trigger and extends rightward. In a ~256px-wide host, a facet button that lands anywhere but the very left edge of a wrapped row (e.g. the second of two buttons that fit on one row before wrapping) will open a 224px popup that runs past the right edge of the container. This is the same _class_ of problem Batch 3 flagged for chips, just on the popover axis instead of the flow axis, and nothing here bounds it.

- **File**: `libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts:106-107`
- **Fix**: add `dropdown-end` on the menus most likely to sit toward the right of a row (Structure/Relations/Executor), or swap `w-56` for `w-[min(14rem,calc(100vw-1rem))]` so the popup can never exceed the viewport.

---

## 2. The rollup as a button

`task-card.component.ts:214-234`.

**Before hover it is visually indistinguishable from three adjacent _inert_ elements on the same row.** The rollup renders `badge badge-xs badge-ghost gap-0.5 tabular-nums hover:badge-primary`. The executor badge (`:191-197`), the depends-on badge (`:199-207`), and the duplicate marker (`:238-246`) all use the identical `badge badge-xs badge-ghost gap-0.5` recipe and are plain `<span>`s with no click handler at all. At rest, nothing — not colour, not weight, not an icon variant — marks the rollup as the one pressable item among four look-alike badges. This directly confirms the team-leader's concern: **the only affordance is the hover colour flip, so a control that only announces itself on hover is invisible to anyone not currently hovering it** (touch users, and anyone visually scanning without a mouse over the card).

**It doesn't even get a pointer cursor on hover.** I checked daisyUI's compiled CSS: `.btn` explicitly sets `cursor: pointer` (`node_modules/daisyui/dist/full.css:2707`); `.badge` sets none (`:2564-2587`), and neither `.badge-ghost` nor `.badge-primary` add one either. The rollup uses only `badge`/`badge-ghost`/`hover:badge-primary` — never `.btn` — so it keeps the browser's default `<button>` cursor (not a hand) even while hovered. **Two of the three cues a user relies on to spot a clickable badge (shape difference, cursor) are both absent; only the colour-on-hover cue exists**, and per §5 below that colour-on-hover cue itself is under-contrast on the app's default theme.

**Hit target: 12px tall.** `badge-xs` is `height: 0.75rem` = 12px (`node_modules/daisyui/dist/full.css:27706-27711`). That's under both the 44×44px mobile-touch guideline and WCAG 2.2 SC 2.5.8's 24×24px minimum. The same is true of the filter chip's own remove button (`task-filter-bar.component.ts:364-372`, a bare icon with no padding beyond the inherited badge padding) — a second small-target instance this batch adds, not just the rollup.

- **File**: `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:214-234`
- **Fix suggestion**: at minimum add `cursor-pointer` explicitly so the affordance isn't 100% colour-dependent even before the contrast fix in §5; consider a persistent, non-hover-only visual cue (e.g. a 1px `badge-outline` ring or a chevron glyph) so the control reads as pressable at rest, matching the pattern the app already uses for the navigable parent-crumb `<button>` (`:145-153`, which is visually a link — underline on hover, distinct colour — not a same-look badge).

**Nesting**: the rollup sits inside the card's `role="button" tabindex="0"` (`:70-71`). _Click_ nesting is handled cleanly — `$event.stopPropagation()` (`:220`) means a mouse click on the rollup visually does exactly one thing (filters, no detail panel). Visually this reads as intentional, not an accident, **for mouse users**. The keyboard case is different — see §4.

---

## 3. The `23 of 181` asymmetry

`task-filter-bar.component.ts:326-332` (top counter) vs `task-column.component.ts:46-56` (per-column counter).

The column counter's own code comment (`task-column.component.ts:42-45`) states the design rule explicitly: _"the second number appears ONLY while a filter is hiding something... 'X of X' is noise."_ The column honours that: it only renders `shown of total` when `hidden() > 0` (`:51-55`), otherwise just the bare count.

**The top counter does not follow its own team's rule.** `task-filter-bar.component.ts:326-332` renders `{{ matchedCount() }} of {{ totalIndexed() }}` **unconditionally** — no `@if`. With no filter active, `matchedCount() === totalIndexed()`, so the header will read **"181 of 181"** at rest, every time a user opens the board with no filter set — exactly the noise pattern the column deliberately avoids one row below it. This isn't a rendering bug, but it is a real inconsistency: two counters on the same screen, built in the same batch, with one of them documenting _and following_ a "don't show redundant X of X" rule and the other silently not applying it.

- **File**: `libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts:326-332`
- **Fix**: wrap in `@if (active())`, mirroring the column's `hidden() > 0` gate, or explicitly justify why the two counters diverge (e.g. the top one is meant as a standing board-size readout). As written it reads as an oversight, not a decision.

The underlying semantics (filtered-shown vs indexed-total) are otherwise legible on their own — the column's `title`/`countTitle()` (`:125-131`) spells out the relationship in words for anyone who hovers, which is a real mitigation.

---

## 4. Filtered-empty state

`tasks-view.component.ts:250-277`. This is solid: icon, a sentence that states what happened ("the active filter is hiding every one of them"), and a `Clear the filter` button that's the one action a user in this state actually wants — no dead-end, no "create a 182nd task" CTA that would answer a question nobody asked (the surrounding comment at `:245-249` says exactly that, and the markup matches it). No blocking issue here structurally.

The one real defect in this state is contrast on the explanatory sentence — see §5, `text-base-content/40` at `:263-267`, which is the **body text carrying the actual explanation** in this exact screen.

---

## 5. Contrast — recomputed, not asserted

Per the brief, I recomputed rather than trusting any implicit assumption. Batch 3's LABEL_CHIP_CLASSES table used **absolute Tailwind hexes**, specifically so one audit covers every theme. **Batch 7 does not follow that rule.** Every new text colour in this batch is a daisyUI CSS-variable token at partial opacity — `text-base-content/30`, `/40`, `/50`, `/60`, `/70` — plus one solid daisyUI semantic class, `badge-primary`. Both are theme-variant by construction, and neither is accompanied by any audit table the way `LABEL_CHIP_CLASSES` was. I computed the real numbers across the four mandated bases.

### 5a. `hover:badge-primary` / `badge-primary` (the rollup hover state, and the facet-menu selected-count badge at `task-filter-bar.component.ts:101`)

`.badge-primary` sets `background-color: var(--p)`, `color: var(--pc)` (`node_modules/daisyui/dist/full.css:4152-4158`) — text-vs-fill is what matters.

| Theme                                 | primary                       | primary-content                                         | Source                          | Contrast                 |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------- | ------------------------ |
| **anubis** (app default, `darkTheme`) | `#2563eb`                     | `#e8e6e1` (hand-specified, `tailwind.config.js:51-53`)  | literal hex                     | **4.14:1 — FAILS 4.5:1** |
| anubis-light                          | `oklch(85% 0.138 181.071)`    | `oklch(43% 0.078 188.216)` (hand-specified, `:105-107`) | OKLCH→linear-sRGB by hand       | 5.18:1 — passes          |
| daisyUI `dark`                        | `oklch(65.69% 0.196 275.75)`  | _auto-generated_ (none specified)                       | daisyUI's own algorithm (below) | ≈6.0:1 — passes          |
| daisyUI `light`                       | `oklch(49.12% 0.3096 275.75)` | _auto-generated_ (none specified)                       | daisyUI's own algorithm         | ≈5.59:1 — passes         |

For the two built-in themes, `primary-content` isn't in `themes.js` at all, so I read daisyUI's own generator (`node_modules/daisyui/src/theming/functions.js:43-54`): it picks white or black by comparing `wcagContrast(primary,"black")` vs `wcagContrast(primary,"white")`, then interpolates 80% of the way from `primary` toward that pole **in OKLCH space** (not a flat black/white swap) — I replicated that exact interpolation and converted the result back to linear sRGB to get the ≈6.0 / ≈5.59 figures above.

**anubis is the one theme where the colour was hand-picked, not generated, and it's the one that misses the gate.** anubis is also the app's `darkTheme` and the first (root) theme in `tailwind.config.js:47-49`, i.e. the theme most installs will actually be looking at. 4.14:1 is a real, verifiable AA failure on badge text — small (`badge-xs` ⇒ 0.75rem line-height, unambiguously "normal text" for the 4.5:1 threshold, not "large text"). This is the same order of miss Batch 3 blocked amber for (2.99:1 vs a 3:1 _boundary_ gate); here it's a _text_ gate, which is the stricter one, missed by more.

- **File**: `tailwind.config.js:51-53` (root cause), consumed at `task-card.component.ts:217` and `task-filter-bar.component.ts:101`.
- **Fix**: either lighten anubis's `primary-content` a few steps, or stop using `badge-primary`/`hover:badge-primary` for small text on anubis specifically (e.g. use `badge-outline badge-primary` so the hover state changes the _border_ rather than fills a low-contrast solid).

### 5b. `text-base-content/NN` — the column count, empty-column copy, facet-menu counts, sort label, filtered-empty body text

I computed alpha-blended-over-`base-100` luminance (the actual paint result of a translucent text colour over its background) for daisyUI's plain `light` theme, since it's one of the four mandated bases and has `base-100: oklch(100% 0 0)` (pure white) — the simplest, and worst-case-revealing, base to blend against:

| Opacity | Used at                                                                                                                                                            | Blended-vs-white contrast |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `/30`   | `task-column.component.ts:74` — empty-column text ("No tasks" / "N hidden by the filter")                                                                          | **≈1.85:1**               |
| `/40`   | `tasks-view.component.ts:228,263` — filtered-empty and no-tasks-at-all body sentences                                                                              | **≈2.35:1**               |
| `/50`   | `task-filter-bar.component.ts:121` (facet option counts), `:302` (Sort label), `:129` (empty-menu text), `:362` (chip facet-prefix, e.g. "Label" before the value) | **≈3.05:1**               |
| `/60`   | `task-filter-bar.component.ts:327` — the `23 of 181` counter                                                                                                       | **≈4.06:1**               |
| `/70`   | `tasks-view.component.ts:221,260` — headline text in both empty states                                                                                             | ≈5.53:1 — passes          |

All four below `/70` **fail 4.5:1 on daisyUI `light`**, and `/30`/`/40`/`/50` fail even the more lenient 3:1 non-text boundary minimum. `/30` at ≈1.85:1 is not a near-miss — that's close to the floor of visibility for grey-on-white; a user on the plain, unmodified `light` theme will find the sentence explaining _why their column looks empty_ (the exact feature this batch adds) close to unreadable. This is the most severe single number in this review.

I confirmed `/30` on the empty-column paragraph is new to this batch, not inherited: `git blame -L 70,84 task-column.component.ts` shows those lines as "Not Committed Yet" against a `9cc2da7fb`-authored empty-column block that pre-dates this batch — so the opacity choice was made now, for both the pre-existing "No tasks" copy and the new "N hidden by the filter" copy.

On anubis (dark base, near-white `base-content`), the same `/60` case computes to ≈5.94:1 — comfortably passing — so this specific failure is theme-dependent, but it fails on one of the four bases Batch 3 established as mandatory, which is the standard this review is holding the batch to. I did not exhaustively run every opacity across all four bases (time-bounded), but the pattern is consistent with Batch 3's own unresolved flag on this exact construct (`task-relations.component.ts:99-101`, "worth an explicit check the same way the chip palette got one") — that flag went unaddressed, and Batch 7 adds five more instances of it rather than resolving it.

- **Files**: `task-column.component.ts:47,74`; `task-filter-bar.component.ts:121,302,129,327,362`; `tasks-view.component.ts:221,228,260,263`.
- **Fix**: replace the opacity-scale pattern with the same absolute-hex approach `LABEL_CHIP_CLASSES` uses, or at minimum raise the floor — `/70` passed on the one base I could check in full; nothing under that should be used for text carrying information (the `/30`–`/50` uses here are all label/meta text, not decoration).

---

## 6. Accessibility beyond contrast

- **Focus outline on the 7 facet-menu triggers is native/unstyled, not the app's gold ring.** The global focus rule (`apps/ptah-extension-webview/src/styles.css:439-448`) targets `button, input, select, textarea, a` only. `TaskFacetMenuComponent`'s trigger is a `<summary>` (`task-filter-bar.component.ts:95`) — not in that list, and not covered by the matching "suppress default outline" rule at `:451-457` either. Every checkbox _inside_ the menu (`:112-117`, a real `<input>`) gets the correct gold outline; the seven `<summary>` triggers themselves will show whatever the browser's own default focus indicator is (Chromium: a blue ring, different shape/colour from the rest of the app). Tabbing through the filter bar will visibly flip between two different focus-ring styles depending on which control has focus. Non-blocking, but a real, checkable inconsistency, and it follows directly from choosing `<details>/<summary>` over a `<button>`-based popover (a choice the component doc justifies for open/close/Escape semantics — see next point).
- **The Escape-to-close claim in the component doc is very likely wrong.** `task-filter-bar.component.ts:82-83` states the menu is built on `<details>/<summary>` so that "the open/close state, the Escape key and the expanded state exposed to assistive technology are all the browser's, not ours." Per the HTML spec, native `<details>` has no Escape-to-close behaviour at all — that behaviour belongs to `<dialog>`, not `<details>`. If this holds in a live browser, pressing Escape while a facet menu is open does nothing visible: the menu stays open, with no feedback that the keypress was received. I could not verify this in a live browser, so I'm flagging it as a likely-but-unconfirmed gap rather than a confirmed one — worth a 30-second manual check.
- **Accessible names are handled well elsewhere in this batch.** `summaryAriaLabel()` (`:151-156`) states count in words ("Filter by status, 2 selected"), not just a colour/number badge. The rollup's `rollupActionTitle()` (`task-card.component.ts:434-438`) states both the counts _and_ what activating it does — a real improvement over the Batch 3-era duplicate-marker gap. Chip remove buttons carry `removeLabel` (`:604`) stating facet and value. None of the new controls rely on colour alone to carry meaning — every value is rendered as text somewhere (facet label, chip value, count digits).

---

## The keyboard double-fire: what the user actually sees (not a new defect, just its visual consequence)

The underlying cause (card `keydown.enter`/`keydown.space` unguarded against focused descendants) is already recorded and owned by Batch 10 — not re-reported here. What was asked for is the _visual_ result when it fires on the rollup specifically, and I traced it through the actual filter semantics rather than guessing:

`matchesChildrenOf` (`libs/shared/src/lib/types/task-filter.ts:380-387`) matches a task whose **own** `effectiveParent` equals the selected id. A parent task's `effectiveParent` never points at itself. So:

1. User tabs to a card, tabs again to its rollup button ("3 / 5"), presses **Enter**.
2. The button's own click fires first: `filterChildren.emit(task().id)` → `store.showChildrenOf(parentId)` → the board filter narrows to _only this task's children_ — the parent card itself is now **excluded** from every column, because it doesn't match its own `childrenOf` facet.
3. The unguarded `keydown.enter` on the card root then _also_ fires: `selectTask.emit(task().id)` → the detail panel opens for the **parent** — the exact task that just vanished from the board in step 2.

**Net visual result**: the board re-renders to show only the children (columns shrink, some columns may now show the new "N hidden by the filter" empty state), a new "Sub-tasks of: `<parent-id>`" chip appears in the filter bar, _and_ the detail panel slides open showing a task that is no longer visible anywhere on the board behind it. A user who pressed Enter expecting "show me this task's children" gets that, but also gets a detail panel for a task that just disappeared — the selected-and-highlighted task (`[selected]="task.id === selectedTaskId()"`, `task-card.component.ts:66-69`) and the visible board are now telling two different stories at once. That reads less like "the app did two things" and more like "the app opened the wrong thing," because the one task the UI visually foregrounds (open detail panel) is simultaneously the one task the UI just hid.

---

## Findings summary

| #   | Severity            | File:line                                                                                         | Issue                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Serious             | `tailwind.config.js:51-53` (via `task-card.component.ts:217`, `task-filter-bar.component.ts:101`) | `badge-primary` text contrast on **anubis** (app default theme) is 4.14:1, below the 4.5:1 gate this codebase enforces elsewhere — recomputed from the literal hex values, not asserted.                                                                                                                                                              |
| 2   | Serious             | `task-column.component.ts:74`                                                                     | Empty-column text at `text-base-content/30` computes to ≈1.85:1 against daisyUI `light`'s white base — the sentence explaining _why the column is empty_ is close to unreadable on an unmodified theme.                                                                                                                                               |
| 3   | Serious             | `tasks-view.component.ts:228,263`; `task-filter-bar.component.ts:121,129,302,327,362`             | `text-base-content/40`, `/50`, `/60` all fail 4.5:1 (≈2.35 / ≈3.05 / ≈4.06) against daisyUI `light`; this batch reintroduces the theme-variant-token pattern Batch 3 explicitly moved away from for exactly this reason, and adds five new instances of a construct Batch 3 already flagged as unaudited.                                             |
| 4   | Serious             | `task-card.component.ts:214-234`                                                                  | Rollup button has zero pre-hover affordance (identical `badge badge-xs badge-ghost` recipe as three adjacent inert spans) and no pointer cursor even on hover (`.badge`/`badge-ghost`/`badge-primary` never set `cursor`, unlike `.btn`) — the only "this is clickable" signal is a colour flip that itself fails contrast on the default theme (#1). |
| 5   | Serious             | `task-card.component.ts:217`, `task-filter-bar.component.ts:364-372`                              | Hit targets are 12px tall (`badge-xs`), under both the 44px touch guideline and WCAG 2.2's 24px minimum, for the rollup button and the chip remove button.                                                                                                                                                                                            |
| 6   | Moderate            | `task-filter-bar.component.ts:106-107`                                                            | Facet-menu popup is a fixed `w-56` (224px) with no `dropdown-end`/collision handling — can overflow the right edge of a narrow (~256px) host depending on which row the trigger wraps to.                                                                                                                                                             |
| 7   | Moderate            | `task-filter-bar.component.ts:326-332`                                                            | Top counter always renders "X of Y" (reads as "181 of 181" noise when unfiltered), while the column counter beneath it explicitly avoids that exact pattern per its own code comment — an internal inconsistency in the same batch.                                                                                                                   |
| 8   | Moderate            | `task-filter-bar.component.ts:95` vs `apps/ptah-extension-webview/src/styles.css:439-448`         | The 7 facet-menu `<summary>` triggers fall outside the global focus-visible rule (scoped to `button/input/select/textarea/a`) and show the browser's native, differently-styled focus ring instead of the app's gold outline.                                                                                                                         |
| 9   | Minor / unconfirmed | `task-filter-bar.component.ts:82-83`                                                              | Doc comment claims Escape closes the `<details>` menu natively; per the HTML spec that behaviour belongs to `<dialog>`, not `<details>` — likely means Escape does nothing visible. Flagged as likely, not confirmed (no live browser available).                                                                                                     |
| —   | Note, positive      | `task-filter-bar.component.ts:363`                                                                | Filter chips correctly cap and truncate user-authored values (`max-w-[10rem] truncate`) — the exact defect class Batch 3 found in card labels was **not** reintroduced here.                                                                                                                                                                          |
| —   | Note, positive      | `tasks-view.component.ts:250-277`                                                                 | Filtered-empty state explains what happened and offers exactly one correct way out; no dead end, no CTA mismatched to the situation.                                                                                                                                                                                                                  |

---

## Verdict

**NEEDS REVISION on contrast; everything else is fast-follow-grade.**

Nothing here is a layout break, an overflow, or a crash — the filter bar wraps safely at any width, chips are properly bounded (the one class of defect Batch 3 explicitly warned about was avoided), and the filtered-empty state is well-designed. Correctness (already approved) is not in question.

But this batch's own contrast story does not meet the bar the codebase set for itself. `LABEL_CHIP_CLASSES` earned its "one audit covers every theme" claim by using absolute hexes and getting audited to the decimal; Batch 7 reverts to theme-variant daisyUI tokens for every new text colour, without an audit, and when I ran the numbers two of the four mandated bases produced real failures — including a 1.85:1 on the sentence that explains this batch's own headline feature (why a column is empty under a filter), and a 4.14:1 on the app's own default dark theme for the rollup's hover state and the facet-menu's selected-count badge. Both are precisely computed, not estimated, and both are worse misses than the amber cut this codebase already treated as disqualifying. I'd want these addressed (§5) before calling this batch visually done; the discoverability/hit-target findings on the rollup button (§2) are real but more in line with "should fix," not "must fix."
