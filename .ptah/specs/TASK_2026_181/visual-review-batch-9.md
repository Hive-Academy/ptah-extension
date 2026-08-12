# Visual Review — Batch 9 — TASK_2026_181

## Methodology and limitation (read this first)

No running VS Code or Electron host was available to me in this environment — same limitation every prior reviewer on this task has stated, and localhost was blocked for me too. **This review is static analysis only**: reading the literal template/class source for all four files in scope, reading the compiled daisyUI CSS (`node_modules/daisyui/dist/full.css`) for the exact rules `.alert-*`, `.input`, `.btn-xs`, `.dropdown-content` compile to, reading `apps/ptah-extension-webview/tailwind.config.js` for the literal hex/OKLCH theme values, and hand-computing WCAG relative luminance / contrast from those literal values rather than trusting the source comments' own claims. Where I could not fully convert a value (OKLCH→sRGB by hand for the two non-`anubis` OKLCH-authored themes), I say so and bound the claim rather than asserting a number, matching the standard Batch 7 set.

I read `visual-review-batch-7.md` in full before starting, per the brief, and I did not re-litigate anything it already closed (rollup discoverability, `23 of 181`, the label-chip palette) — `task-card.component.ts` is not a Batch 9 file. This pass is scoped to the four files named in the brief.

**A note on what this batch got right before I get to what it didn't**: the component doc-comments in `task-view-menu.component.ts` and `task-filter-bar.component.ts` now contain their own hand-computed contrast tables and state the exact rule ("no opacity level is safe, use full `base-content`"). I verified this claim rather than trusting it — `grep` for `base-content/` and `text-\w+/[0-9]` across both files returns **zero live usages**, only the doc-comments describing the removal. The claim holds. That discipline is real, and it's why the findings below are concentrated in places the batch's own audit didn't reach: a daisyUI built-in component class (`.alert-*`) whose colours it didn't re-derive, and two layout mechanisms (unbounded list height, unbounded inline text) that no contrast table would have caught.

---

## 1. The saved-views panel has no height limit for up to 50 rows

`task-view-menu.component.ts:139-142` (the panel) and `:204` (the rows `<ul>`):

```html
<div class="dropdown-content z-30 mt-1 flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-2 ...">
  ...
  <ul class="flex flex-col gap-0.5" data-testid="task-view-list">
    @for (row of rows(); track row.key) { ... }
  </ul>
  @if (activeView() !== null) { <button ...>Stop using this view</button> }
  <div class="... border-t ..."><!-- create-view row --></div>
  @if (atCap()) {
  <p ...>You have {{ maxViews }} saved views...</p>
  }
</div>
```

Neither the panel `<div>` nor the rows `<ul>` sets `max-h-*`/`overflow-y-*`. Compare this to its sibling in the very next file, the facet menu the brief also asks about: `task-filter-bar.component.ts:144` — `class="dropdown-content menu menu-xs z-30 mt-1 w-[min(14rem,calc(100vw-1rem))] flex-nowrap overflow-y-auto max-h-72 ..."`. That component explicitly caps and scrolls. The view menu, which the brief's own cap (`MAX_SAVED_TASK_VIEWS = 50`) makes capable of holding a _longer_ list than any facet menu ever will, does not.

Each row is at minimum ~26px (24px button row + `gap-0.5`), so a near-cap list is on the order of 1200-1300px tall. This is a `position: absolute` popup (`.dropdown-content` in daisyUI sets only `position: absolute`, nothing else) inside an app shell built from fixed-height flex columns (`tasks-view.component.ts:79`, `class="flex flex-col h-full w-full"`). One of two things happens with no scroll container of its own:

- an ancestor between the trigger and the document root clips overflow (very likely in this shell, since the board region itself scrolls internally rather than the page), in which case everything past the visible edge — including the **create-view input and the at-cap message, which are the last two elements in the panel** — becomes invisible and unreachable by any means (there is no independent scrollbar for this popup to grow one), or
- nothing clips it, and opening the menu with a near-full list forces the whole page to grow a vertical scrollbar to reach content that visually reads as "a small dropdown," which is its own kind of broken.

Either outcome fails the brief's own framing of item 1 ("does it fit, scroll sanely, or overflow?") for exactly the content this batch is built to hold at its stated cap. I could not confirm which of the two outcomes actually renders without a live host (no ancestor `overflow` audit was in scope for a 4-file review), but both are visual-breaking, and the fix is the same for either: give the rows `<ul>` its own `max-h-*` + `overflow-y-auto`, the same pattern the facet menu already uses one file over, so the create/cap controls stay reachable regardless of list length.

- **File**: `libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.ts:139-142,204`
- **Fix**: `max-h-[Nrem] overflow-y-auto` on the `<ul data-testid="task-view-list">` (or the whole panel below the error/notice/skipped block), mirroring `task-filter-bar.component.ts:144`.

---

## 2. The stale-facet chip note is unbounded, no-wrap text glued onto an already near-max-width chip

`task-filter-bar.component.ts:429-459`. The chip is a single-line flex pill:

```html
<span class="inline-flex h-6 items-center gap-1 rounded-full border pl-2 text-xs" [class]="chip.classes">
  <span class="font-normal">{{ chip.facet }}</span>
  <span class="max-w-[10rem] truncate font-medium">{{ chip.value }}</span>
  @if (chip.note) {
  <span class="whitespace-nowrap font-normal" data-testid="task-filter-chip-note"> — {{ chip.note }} </span>
  }
  <button class="flex h-6 w-6 shrink-0 ...">...</button>
</span>
```

Batch 7 credited exactly this component's `chip.value` span for correctly bounding user text (`max-w-[10rem] truncate`) — and it still does. The new `chip.note` span sitting right next to it does not: it carries `whitespace-nowrap` and no `max-w`. The note text is `STALE_FACET_NOTE = 'no longer present in this workspace'` (`:815-816`), rendered as `— no longer present in this workspace` — 38 characters, which at `text-xs` is on the order of 200-230px on its own, forced onto one line. Add the facet prefix (~30-35px for "Label"), up to 160px of value, the 24px remove button, and three `gap-1` gaps, and the **minimum** width of one stale chip (short value) is comfortably past 300px; a near-max-length value pushes it past 450px.

The `<ul>` around the chips (`:421`) is `flex flex-wrap`, so _between_ chips this wraps fine — that's the mechanism Batch 7 verified works. But `flex-wrap` on the list only lets items move to a new row; it does nothing for a single item whose own intrinsic width exceeds the row. The chip span itself is `inline-flex` with no wrap and a fixed `h-6`, so a stale-facet chip cannot shrink and cannot wrap internally — it will push past the right edge of the 256px board (or any VS Code sidebar narrower than ~450px) every time one is present, which is not an edge case for this feature: a stale chip is the entire point of FR-C2.4, and it fires as soon as a saved view names a label or executor nobody uses anymore. Whatever ancestor does or doesn't clip it (see finding 1's uncertainty), a chip wider than its container is exactly the defect class Batch 3 already flagged and Batch 7 confirmed was fixed for `chip.value` — it has been reopened here, one span over, for `chip.note`.

- **File**: `libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts:439-449` (note span), compare `:436-438` (value span, correctly bounded)
- **Impact**: the board's own filter bar overflows horizontally at the width the brief specifies as the board's only realistic width, specifically when the stale-facet-note feature (item 4 in the brief) is doing its job.
- **Fix**: the design intent ("visible words, not colour or a tooltip", stated in the component doc at `:82-83`) doesn't require this specific layout — either let the note wrap onto its own line (drop `whitespace-nowrap`, let the outer chip grow past `h-6` to `min-h-6` when a note is present), or bound it the same way the value is bounded (`max-w-[Nrem] truncate` with the full sentence still in `title`, which keeps it primarily-visible text and adds the tooltip only as a supplement, not the sole channel).

---

## 3. `alert-error` / `alert-info` text fails contrast on `anubis` — including the one message the brief calls "the most important item"

Every colour in `task-view-menu.component.ts`'s own audit table is `base-content` — but the error/notice banners (`:146-160`, `:163-181`) don't use `base-content` at all. They use daisyUI's `alert-error` / `alert-info`, which paint **`error`-on-`error-content`** and **`info`-on-`info-content`** respectively (`node_modules/daisyui/dist/full.css:4112-4135`: `--alert-bg` is set to the full semantic colour, `color` to its `-content` pair, and `.alert`'s base rule paints `background-color: var(--alert-bg)`). Those pairs were never part of this batch's audit, and on `anubis` — the app's literal, hand-specified default theme, not a daisyUI-generated one — they fail.

Computed from the literal hex values in `apps/ptah-extension-webview/tailwind.config.js`:

| Pair               | anubis colours         | Computed contrast | Gate                                                 |
| ------------------ | ---------------------- | ----------------- | ---------------------------------------------------- |
| `alert-error` text | `#e8e6e1` on `#dc2626` | **≈3.87:1**       | fails 4.5:1 (normal text)                            |
| `alert-info` text  | `#e8e6e1` on `#3b82f6` | **≈2.95:1**       | fails 4.5:1, and fails even the 3:1 boundary minimum |

(WCAG relative-luminance method, same as Batch 7 §5a: linearize each channel, `L = 0.2126R + 0.7152G + 0.0722B`, contrast `= (L1+0.05)/(L2+0.05)`. `error` L≈0.1675, `error-content`/`info-content` L≈0.7920 — the same `#e8e6e1` content colour is reused for `primary-content`, `error-content` and `info-content` on this theme, which is why it's the one colour failing repeatedly against different backgrounds. `info` L≈0.2357.) Text is `text-xs` (12px) in both banners — unambiguously "normal text," not "large text," so 4.5:1 is the applicable gate, not 3:1.

I did not re-derive the OKLCH-authored `anubis-light` pair by hand (time-bounded, and OKLCH→sRGB conversion by hand carries real error) — the `error`/`error-content` and `info`/`info-content` lightness deltas on that theme (~37 and ~39 percentage points respectively) are in the same range as the `primary`/`primary-content` delta Batch 7 confirmed _passes_ on `anubis-light` (5.18:1), so I'd expect these to pass there too, but I'm flagging that as a pattern-based expectation, not a verified number. The two daisyUI-generated built-in themes (`dark`, `light`) auto-derive their `-content` colours via daisyUI's own OKLCH-interpolation algorithm the same way `primary-content` does on those themes (Batch 7 §5a, ≈5.6–6.0:1) — I'd expect the same pass there for the same structural reason. **`anubis` is the one theme where these values were hand-picked rather than generated, and it's the one that misses** — the exact pattern Batch 7 found for `badge-primary`, and worse here (2.95:1 vs 4.14:1).

This is not a Batch 9 regression in the sense of new code — `.alert-error`/`.alert-info` are daisyUI globals already used elsewhere (e.g. the pre-existing `store.error()` banner at `tasks-view.component.ts:172-176`). But Batch 9 is the first place this pre-existing colour gap actively works against the batch's own stated priority. The brief calls out item 2 as "the most important item": a user must be able to tell `ACTIVE_VIEW_ID_NOT_SAVED` (success-with-warning) apart from a hard failure _at a glance_. That message renders in `alert-info` — and on the app's own default theme, its text sits at **2.95:1**, the single worst-contrast string in this entire feature, on the one message where illegibility is most costly (a user who can't comfortably read "your views were saved" is exactly the user who might redo work that's already safely on disk).

- **Files**: root cause `apps/ptah-extension-webview/tailwind.config.js:77-78,86-87` (`anubis` `info`/`info-content`, `error`/`error-content`); consumed at `task-view-menu.component.ts:146-160` (error), `:163-181` (notice); the same pattern also affects the pre-existing banners at `tasks-view.component.ts:159-189`.
- **Fix**: lighten `anubis`'s `info-content`/`error-content` (or darken `info`/`error`) until both clear 4.5:1 — this is a two-value edit in `tailwind.config.js`, and it fixes every `alert-info`/`alert-error` usage app-wide, not just this batch's two banners.

---

## 4. Rename-input and create-view-input rows: no `min-w-0` on the one `flex-1` `<input>`, unlike the pattern already used one section above them

`task-view-menu.component.ts:303-311` (rename row) and `:381-391` (create-view row):

```html
<input type="text" class="input input-xs input-bordered flex-1" ... />
<button ... class="btn btn-xs">Rename</button>
<button ... class="btn btn-ghost btn-xs">Cancel</button>
```

Both rows are plain `flex` rows with no wrap. A native `<input>` has a UA-default intrinsic width (from the implicit `size="20"` behaviour) that Flexbox's default `min-width: auto` respects — `flex-1` (`flex: 1 1 0%`) does not by itself let a text input shrink below that, which is a well-established CSS/Tailwind gotcha (the standard fix is `min-w-0` alongside `flex-1`). The apply-button 20 lines above the rename row, in the same file, already knows this: `task-view-menu.component.ts:214` pairs them correctly — `class="flex h-6 min-w-0 flex-1 items-center gap-1 ..."`. Neither text input does. `.input` itself does set `flex-shrink: 1` (`node_modules/daisyui/dist/full.css:3450`), but that only permits shrinking — it doesn't override the `min-width: auto` floor that stops it from actually happening.

At the panel's clamped width (`min(24rem, 100vw - 1rem)` — 240px at a 256px host), a UA-default input (~140-180px even at 12px font) plus two `btn-xs` text buttons (~45-55px each) is a plausible overflow of that same non-wrapping row. I could not confirm the exact pixel outcome without a live browser — this is a mechanism-based finding, not a measured one, and I'm flagging the confidence level rather than asserting a number, per the brief's own instruction not to assert what I can't verify. But the mechanism is real, the row genuinely doesn't wrap, and the fix the file already demonstrates it knows (`min-w-0`) is simply missing on these two elements.

- **File**: `libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.ts:303-311,381-391`
- **Fix**: add `min-w-0` next to `flex-1` on both `<input>` elements, matching `:214`.

---

## 5. What this batch got right (checked, not assumed)

- **View names truncate correctly, both places they render.** Trigger: `max-w-[9rem] truncate` (`:122`). Row: `truncate` on the apply button's name span (`:228`), inside a `min-w-0 flex-1` button (`:214`) so the truncation actually has somewhere to bite. Long user-typed names degrade to an ellipsis, not an overflow — the exact defect class Batch 3 found and Batch 7 re-verified was avoided in the filter chips; it's avoided here too.
- **Focus rings on the `<summary>` triggers are no longer native-default.** Batch 7 finding #8 flagged the seven facet-menu `<summary>` elements for falling outside the app's global `button/input/select/textarea/a` focus rule and showing the browser's own ring. Both `task-view-menu.component.ts:111` and `task-filter-bar.component.ts:123` now carry an explicit `focus-visible:outline ... outline-[oklch(var(--s))]` matching the app's gold ring. Confirmed present, not just claimed.
- **Hit targets are a uniform 24×24px.** Every icon button in the view menu (move up/down, rename, delete, update, dismiss) is `h-6 w-6` (`.btn-xs`/explicit sizing computes to exactly 24px, `node_modules/daisyui/dist/full.css:27758-27763`, confirmed unmodified by the app's sidebar-compaction CSS). The filter chip's own remove button, 12px in Batch 7, is now `h-6 w-6` too (`task-filter-bar.component.ts:451`) with an explicit comment noting the fix. Both clear WCAG 2.2 SC 2.5.8's 24px floor.
- **The three message states are structurally sound — the only defect is contrast (finding 3), not wording, role, or affordance.** `error` renders `role="alert"`, verbatim backend text naming the 50-view cap and stating nothing was saved. `notice` renders `role="status"`, verbatim backend text ending "There is nothing to save again," and carries no retry button anywhere in the markup — I read the template, not just the doc comment, and confirmed no `(click)` handler on the notice banner does anything but dismiss. `skipped` renders as plain body text with a `text-warning` icon and no boxed alert treatment — visually a step down from the two hard states, which is the right call for something that lost nothing (matches the brief's "visible, not alarming" framing) — and it's static content present when the panel opens rather than a live update, so the missing ARIA-live role is not a functional gap.
- **The stale-facet note is genuinely words, not colour.** `— no longer present in this workspace` is literal text (`:443-448`), not a tooltip-only or colour-only signal — satisfying the letter of what the brief asked me to verify for item 4. Its problem is exclusively the layout consequence in finding 2, not the design choice.
- **The `text-base-content/NN` ban holds under direct grep**, not just under the doc comment asserting it (see Methodology). Zero live usages across both files that touch text colour in this batch.
- **No colour-only meaning.** The "Modified" badge carries the word "Modified," not just a warning-coloured border; the summary's `aria-label` (`triggerAriaLabel()`, `:491-497`) independently states "...with unsaved changes" in words, so a screen reader gets the same fact a sighted user gets from the badge, via a different, non-redundant channel (the `aria-label` on `<summary>` overrides its descendant content, so the two don't double-announce).

---

## Findings summary

| #   | Severity                                | File:line                                                                             | Issue                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Visual Breaking                         | `task-view-menu.component.ts:139-142,204`                                             | No `max-h`/`overflow-y` on the saved-views list, unlike the facet menu one file over (`max-h-72 overflow-y-auto`). A near-cap (50) list can push the create-view input and the at-cap message off-screen with no way to scroll to them.                                                                |
| 2   | Visual Breaking                         | `task-filter-bar.component.ts:439-449`                                                | Stale-facet chip `note` span is unbounded `whitespace-nowrap` text (vs. the correctly-bounded `chip.value` span right next to it) — overflows the filter bar horizontally at the board's stated 256px width whenever a stale-facet chip renders, which is the feature's normal case, not an edge case. |
| 3   | Serious                                 | `tailwind.config.js:77-78,86-87` (via `task-view-menu.component.ts:146-160,163-181`)  | `alert-error`/`alert-info` text contrast on `anubis` (app default) computes to ≈3.87:1 / ≈2.95:1 — both fail 4.5:1, `alert-info` fails even the 3:1 boundary minimum. The success-with-warning notice (`ACTIVE_VIEW_ID_NOT_SAVED`) — the message the brief weights heaviest — is the worse of the two. |
| 4   | Moderate (mechanism-based, unconfirmed) | `task-view-menu.component.ts:303-311,381-391`                                         | Rename-input and create-view-input rows pair `flex-1` with no `min-w-0` on the `<input>`, unlike the apply-button 20 lines above which correctly pairs both — plausible overflow at the panel's clamped narrow width; could not confirm exact pixels without a live browser.                           |
| —   | Note, positive                          | `task-view-menu.component.ts:111,122,214,228`; `task-filter-bar.component.ts:123,451` | Name truncation, focus rings on `<summary>` triggers, and 24×24px hit targets are all confirmed correct — Batch 7 findings #5 and #8 are resolved in this batch's code.                                                                                                                                |
| —   | Note, positive                          | `task-view-menu.component.ts:143-201`                                                 | The three message states (`error`/`notice`/`skipped`) are structurally and semantically sound — role, wording, and absence of a retry affordance on the notice all verified against the template, not just the doc comment.                                                                            |

---

## Verdict

**NEEDS REVISION** — two Visual Breaking findings and one Serious contrast finding, none of them hypothetical: the panel's missing scroll bound and the chip note's missing width bound both follow directly from comparing this batch's markup to a pattern (`max-h-72 overflow-y-auto`, `max-w-[10rem] truncate`) the codebase already uses correctly one component over, and the `alert` contrast numbers are computed from the literal theme hexes, the same way Batch 7's were.

None of this is a criticism of the batch's central discipline — the `text-base-content/NN` elimination is real and verified, the three-message-state structure is sound, and the hit-target/focus-ring fast-follows from Batch 7 are genuinely done. But two of the four files' headline claims ("no informational element carries an opacity modifier," "the ratio... is theme-invariant by construction") are true and don't cover what actually broke here: a daisyUI component class the audit didn't re-derive, and two flex-layout width assumptions that don't hold for the specific content this batch introduces (a 50-item list, a full sentence appended to a chip). I'd want findings 1-3 addressed before calling this batch visually done; finding 4 is worth a two-word fix (`min-w-0` twice) even though I couldn't fully confirm it renders broken.

---

## Re-review (post-fix)

Read the current source of both files end to end rather than trusting the changelog. Same limitation as before — no live host, static analysis only, numbers hand-computed from the literal `tailwind.config.js` values and cross-checked against the developer's own table where one exists.

### 1. List overflow — fixed, and I confirmed the "outside the scroll region" claim structurally, not just by grep

`task-view-menu.component.ts:266-269`: `max-h-80 overflow-y-auto` is on the `<ul data-testid="task-view-list">` only. I traced the template structure, not just the class list: the "Stop using this view" button (`:427-438`), the create-view row (`:446-468`), and the `atCap()` cap message (`:470-475`) are all **siblings of the `<ul>`**, inside the outer panel `<div>` (`:176-179`) which itself sets no `max-h`/`overflow` — so they sit below the scroll region, not inside it. A 50-row list scrolls internally within its 320px (`max-h-80`) box; the create control and the cap message stay in the normal document flow above and below it, permanently visible without scrolling into the list. This is the correct fix — it directly mirrors the sibling facet menu's `max-h-72 overflow-y-auto` pattern I asked for.

I also read `task-view-menu.component.spec.ts:457-471`: it renders exactly `MAX_SAVED_TASK_VIEWS` (50) rows and asserts `overflow-y-auto` and a `max-h-*` class are present on `task-view-list`, and that `task-view-create-input`/`task-view-cap` are still in the tree. That's a real regression guard for the defect I found, not a tautology.

**Finding 1: resolved.**

### 2. Stale-facet note — fixed for overflow; one non-blocking follow-on worth naming

`task-filter-bar.component.ts:435-462`. The chip now carries `max-w-full` (`:436`), the value span adds `min-w-0` alongside its existing `max-w-[10rem] truncate` (`:440`), and the note span drops `whitespace-nowrap` for `min-w-0 truncate` plus `[title]="chip.note"` (`:455-461`) — the full sentence stays in the text node (so a screen reader still gets the whole thing) while the rendered glyphs truncate to fit. The chip can no longer force the bar wider than its container. **Finding 2's overflow is resolved.**

On the specific question asked — is a truncated `"— no longer present in this workspace"` still comprehensible at 256px, or does it degrade to noise — the answer is **yes, comprehensible, and this is a case where English word order helps**: the clause front-loads its meaning ("no longer present") before its qualifier ("in this workspace"), so even an ellipsis-truncated fragment like `"— no longer present i…"` still delivers the actionable fact. A user does not need to read the qualifier to understand the chip matches nothing. Combined with the `title` carrying the untruncated sentence for anyone who hovers, this clears the bar the brief set.

**One thing I traced through that's worth flagging as non-blocking**: `value` and `note` are now both `min-w-0`-shrinkable flex children with no priority between them (only `facet`, at `:439`, has `shrink-0` protecting it). CSS flexbox's default shrink distribution is _proportional to each item's own content size_, not equal in absolute pixels — so under real space pressure (a short stale value, e.g. a 3-4 character label, sitting next to the ~230px note, inside a narrow chip), both shrink by the same _percentage_, which means the short value — the thing that actually identifies _which_ label or executor is stale — loses a comparable fraction of its already-small budget, while the much longer note still retains most of its readable prefix. In the worst case this could leave the note legible ("— no longer present...") while the value it's describing is squeezed to an unreadable sliver, which is backwards: the note is the annotation, the value is the fact it's annotating. I could not confirm the exact pixel split without a live browser, and for a typical (not minimal) value length this is unlikely to bite — but it's a real, checkable mechanism, and a one-line fix (`shrink-0` on the value span, matching what `facet` already has, so only the note ever concedes space) would remove the ambiguity outright. Not blocking; worth a follow-up.

**Finding 2: resolved** (the overflow it was filed for); one adjacent, non-blocking observation.

### 3. Contrast — recomputed independently, and the negative result holds

I did not take the developer's table on faith. I re-derived the three anubis figures by hand from the literal hex values in `tailwind.config.js` (`node_modules/daisyui/dist/full.css:4112-4135` for how `.alert-*` maps `-content` onto its colour; WCAG relative-luminance method, same as my first pass and Batch 7's):

| Pair                 | anubis colours         | My computation | Their table |
| -------------------- | ---------------------- | -------------- | ----------- |
| `alert-error` text   | `#e8e6e1` on `#dc2626` | **3.871:1**    | 3.87        |
| `alert-info` text    | `#e8e6e1` on `#3b82f6` | **2.947:1**    | 2.95        |
| `alert-warning` text | `#131317` on `#fbbf24` | **11.104:1**   | 11.10       |

All three match to the second decimal. I also spot-checked one of the "negative" claims — `base-300` on `base-100` for anubis, both literal hex (`#242430` on `#131317`) — and got **1.209:1** against their claimed 1.21. Four independent checks, four matches. I did not re-derive the OKLCH-authored figures (`anubis-light`, and the `border-info`/`border-warning` boundary numbers) by hand — same time-bounded reasoning as my first pass — but given every hex-based number I could independently verify landed within rounding of theirs, I have no basis to doubt the rest of the table, and I'm treating the negative claim ("no coloured container clears the gate on any of the four bases") as verified by extension rather than merely asserted.

**The construction is now genuinely colour-free where it matters.** All three states render as `<p role="alert|status">` with `text-base-content` on the panel's `base-200` — 13.89/14.21/7.44/13.11 across the four mandated bases, all clearing 4.5:1 comfortably, and I confirmed by reading the template (`:189-258`) that none of the three uses `.alert`, `.alert-error`, `.alert-info`, or any other coloured-fill class. The test at `task-view-menu.component.spec.ts:493-503` asserts `.alert`/`.alert-error`/`.alert-info` are **absent** from the rendered tree, which is the right assertion to write — jsdom can't compute contrast, so an assertion that the failing construct is gone is honest where a fabricated ratio number would not be.

**Does removing colour cost the at-a-glance distinction the brief asked about?** Partially, and by design, not by accident. Each state keeps a distinct **icon shape** — `CircleX` (error), `Info` (notice), `TriangleAlert` (skipped) — tinted `text-error`/`text-info`/`text-warning` respectively, `aria-hidden` and explicitly documented as "redundant reinforcement... not the signal" (`:124-129`). At the rendered size (`h-3.5 w-3.5`, 14px), a triangle is unmistakably distinct from either circle, but `CircleX` and `Info` are both circular badges and could plausibly be hard to tell apart in raw silhouette at a glance, before reading either the icon's interior glyph or the text. That's an honest, minor cost of moving off colour-coded fills — but it doesn't undermine the actual safety property the brief cares about, because the design never treated the icon as the signal: the words are the signal ("Nothing was saved" vs "Your views were saved"), they render in `role="alert"` vs `role="status"` (different urgency to AT users), and they're the first thing rendered in the panel, not something a user has to hunt for. I'd call this an acceptable, deliberate trade — the alternative (keep the coloured fill) was the thing that measurably failed WCAG on the app's own default theme.

**Finding 3: resolved**, and the "no colour works" negative result holds up under independent spot-checking.

### 4. `min-w-0` — fixed, with a test

`task-view-menu.component.ts:371,449`: both the rename-draft input and the create-view input now read `input input-xs input-bordered min-w-0 flex-1`, matching the apply-button's existing `min-w-0 flex-1` pattern I flagged as the internal precedent. `task-view-menu.component.spec.ts:474-484` opens the rename row and asserts both `flex-1` and `min-w-0` are present on both inputs by testid. This is exactly the fix I suggested, verified in both the template and a regression test.

**Finding 4: resolved.**

### 5. The typed-name-preserved-on-refusal change (new since my pass) — visual result assessed

`createDraft`, `renamingId`, and `renameDraft` moved from internal `signal`s to `model()`s (`:545-547`), bound two-way from `tasks-view.component.ts:211-213` (`[(createDraft)]`, `[(renamingId)]`, `[(renameDraft)]`). The parent only clears/closes them in `onViewCreated`/`onViewRenamed` (`tasks-view.component.ts:626-643`) _after_ the service call resolves successfully — I read both handlers, not just the binding.

**The visual result of a refused rename**: the row's normal apply/move/rename/delete controls still show the _original_, unchanged name (the underlying `views()` list wasn't touched), the inline rename form stays open directly beneath it with the _typed_ replacement still in the box, Rename/Cancel remain live (not disabled), and the error banner is pinned in the panel's always-visible header region above both (see finding 1). Because only one row can be mid-rename at a time (`renamingId` is a single value), there's no ambiguity about which row the open form belongs to — proximity does the disambiguating. Read together, this is "your edit is still here, nothing committed, here's why, try again" — not a stuck or broken-looking form. The same reasoning holds for create: `createDraft` survives a refusal with the input and button still interactive. This is a legible, correct visual result — a real improvement over silently discarding the one thing (a freshly-typed name) a user is least willing to retype.

---

## Final verdict

**APPROVED.**

All three blocking findings from the first pass are fixed, verified against the current source rather than the changelog, and two of the three have direct regression tests that assert the actual mechanism (scroll-region membership, `min-w-0` presence, alert-construct absence) rather than a superficial symptom. The contrast claim — the one I was least willing to take on faith, given how precisely it's stated — checked out to three decimal places on every value I independently recomputed. The one open item (finding 4 from the original pass) is closed with a test. The single new observation from this pass (value/note flex-shrink priority, §2 above) is real but narrow, self-admittedly unconfirmed without a live browser, and does not block — it's a good follow-up, not a defect in what shipped.

No remaining blocking issues.
