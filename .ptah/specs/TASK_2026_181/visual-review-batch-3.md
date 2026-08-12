# Visual Review — Batch 3 — TASK_2026_181

## Methodology and limitation (read this first)

No running VS Code or Electron host was available to me either. `ptah_browser_navigate` blocks `localhost` by default in this environment, so I could not load the webview and take real screenshots. This review is **static analysis only**: reading the actual template/class source, recomputing the WCAG 2.1 relative-luminance math from the literal hex values in `task-presentation.ts`, diffing the pre-batch card against the current one via `git show`, and reasoning about CSS/box-model mechanics. Anywhere I could not verify a claim without a live renderer, I say so explicitly rather than asserting a pass.

---

## Gate 1 — R15 contrast (NFR-12)

**Verified independently.** I recomputed WCAG 2.1 relative luminance from the literal hex values (Tailwind 3.4 palette) rather than trusting the table.

**Text:fill** — recomputed values match the developer's table exactly for all 8 slots (slate 13.35, red 6.80, orange 6.38, emerald 6.78, sky 6.59, indigo 8.06, fuchsia 7.08, rose 6.68). All clear 4.5:1 by a wide margin, and this ratio is theme-independent by construction (absolute hexes), so the "one audit covers all 30+ themes" reasoning is sound.

**Border:base boundary** — I recomputed border-vs-background across all four cited bases (`anubis` `#131317`, `anubis-light` `#faf7f5`, daisyui `dark` `#1d232a`, daisyui `light` `#ffffff`) and reproduced the reported worst case exactly: orange `border-orange-600` (`#ea580c`) vs `anubis-light` = **3.34:1**, matching the developer's number bit-for-bit. I also reproduced the amber-cut number exactly: `amber-600` vs `anubis-light` = **2.99:1** — confirms the developer actually measured before cutting it, not just eyeballed it. On the two dark bases the border ratio _alone_ is sometimes below 3:1 (e.g. slate border vs `anubis-dark` = 2.45:1), but that's immaterial: the near-white fill against a dark base is already 14–17:1, so the boundary is carried by the fill there, not the border. "Best of fill-or-border per base" is a legitimate way to model a visible boundary, and the math checks out. **Gate 1's arithmetic claim is CONFIRMED.**

### What the arithmetic can't tell you (the two qualitative questions asked)

**1. Does a near-white fill + thin border read as a "chip" on light themes, or as coloured text?**
On `anubis-light`/daisyui-`light`, fill:base is only 1.03–1.23:1 — invisible. The entire "chip-ness" of the shape is carried by a single-pixel border at `badge-xs` size (the card renders labels at `badge-xs`; the detail panel at `badge-sm`). At that size, on a light theme, this will visually read closer to "coloured text with a thin underline-like ring" than a filled pill — the fill provides essentially no shape cue. This isn't a contrast failure, it's a legibility-as-a-chip concern the ratio can't capture. **Non-blocking but real** — flagging for design follow-up (e.g. one darker fill step, or a slightly heavier border on light themes only).

**2. Are adjacent hue slots distinguishable at chip size, and did the developer cut the right pairs?**
I checked all 8 fills for near-duplicates. The `amber`/`teal` cuts were justified (verified above). But two shipped pairs are close enough to be a real concern, one of them worse than what was cut:

- **`red` vs `rose` — the closest pair in the palette, closer than the cut `amber`.** `red-100` `#fee2e2` = `(254,226,226)`, `rose-100` `#ffe4e6` = `(255,228,230)` — a ΔRGB of `(1,2,4)`, essentially imperceptible. The border colours (`red-600` `#dc2626` vs `rose-600` `#e11d48`) differ more (ΔRGB `(5,-9,34)`) but at 1px width that's a weak signal. Only the _text_ colour (`red-800` `#991b1b` vs `rose-800` `#9f1239`) is meaningfully different, and text is the smallest, least-salient part of a chip. At chip size, on either theme, `red` and `rose` will look like the same colour to most users. This is a stronger case than the `teal`/`emerald` pair that was already cut for exactly this reason — worth cutting one of the two, or re-hueing one of them.
- **`sky` vs `indigo` — secondary, milder.** Fills are close (`sky-100` `(224,242,254)` vs `indigo-100` `(224,231,255)`, ΔRGB `(0,11,1)`), but the text colours are genuinely different (`#075985` teal-blue vs `#3730a3` violet), so this pair is more recoverable than red/rose. Worth a second look but not urgent.

**File**: `libs/frontend/tasks-ui/src/lib/task-presentation.ts:139-148` (`LABEL_CHIP_CLASSES`).

---

## Gate 2 — pixel-identity

**The reasoning is sound; the evidence method has a real gap that happens not to matter here.**

I diffed `git show 7cadd50:.../task-card.component.ts` against the current file directly. For a zero-metadata task (no parent, no estimate, no labels, no children, no duplicates), every one of the five new blocks (`parentCrumb`, `estimate`, `childRollup`, `duplicates`, `labels`) is behind an `@if` whose condition is false. Angular compiles each `@if` to a DOM comment anchor when the branch doesn't render — no element, no box. Comment nodes are not part of the CSS box tree at all (browsers never generate a layout object for them), so:

- They cannot themselves paint anything.
- Flex `gap` (used throughout via `gap-1.5`/`gap-1`) only applies between in-flow child _elements_ — a comment is not a flex item, so 5 extra anchor comments add zero extra gap.
- `:empty`, `:last-child`, `:only-child`, `:nth-child` are all element-counting pseudo-classes; comment nodes don't participate, so no selector newly matches or stops matching because of the anchors. I checked this file and its siblings for any such selectors (including Tailwind `first:`/`last:`/`only:` variants and any `> * + *` sibling-combinator patterns like `space-y-*`/`divide-y`) — none are used anywhere in the touched templates, so this risk is moot here regardless.
- No new component-level `styles:` block was added (still pure utility classes), so there's no new CSS whose selectors could unexpectedly re-target the pre-existing markup. No `@container` queries are in play either.

Given all that, the 2963→3043 byte / 7→12 comment-node delta, with byte-identity after stripping the anchors, is real evidence and the conclusion is very likely correct.

**The gap**: a DOM/byte diff is not itself a _pixel_ measurement — it's a structural argument that happens to be airtight for _this_ specific change (comment-only additions), not a general proof technique. It didn't verify actual rendered `getBoundingClientRect()`/computed-style output, and it didn't check daisyUI's own internal component CSS (e.g. whether `.card-body` or `.badge` ship any child-combinator rules) for a stray combinator that could react to child count — I did not find one, but I could not run the actual stylesheet to be 100% certain the way a real screenshot diff would be. **Recommendation (non-blocking)**: add one Playwright `toHaveScreenshot()` regression test for the zero-metadata card as a durable substitute for re-deriving this argument by hand on every future change to this template — the reasoning won't automatically hold once someone adds a sibling-combinator rule or a `:has()` selector later.

**Verdict on Gate 2: sound, evidence is credible but not literally pixel-level; no counter-example found.**

---

## General visual quality

### 1. Card density — this is the most important finding in this review

`task-column.component.ts:31` fixes the column width at `w-64` (256px) — **this is not a narrow-sidebar edge case, it is the board's only, always-on width.** After column padding and `card-compact` card padding, the actual content width available to badges/chips is roughly 200–215px, every time, for every card.

Walking the new template (`task-card.component.ts`) top to bottom for a "loaded" card (6 labels, an estimate, a parent breadcrumb, a duplicate marker, one dependency, one child rollup):

1. Header row (id + menu)
2. Parent breadcrumb row (new)
3. Title (clamped to 2 lines)
4. Meta row: type badge + estimate + executor + depends_on + rollup + duplicate = up to 6 badges wrapping at ~200px → realistically 2–3 lines
5. Labels row: 6 chips wrapping at ~200px → realistically 2–3 lines
6. Footer (isolate toggle + Start, or terminal footer)

That's a card that can realistically run 8–10 visual lines tall versus the pre-batch card's ~4. This directly works against "scans at a glance" — a column of these will show far fewer cards per screen and each one takes noticeably longer to read. **This is a legitimate, verifiable-from-the-code design regression, not a hypothetical.** Nothing in the five new affordances is individually wrong, but there is no cap anywhere (no "+N more" pattern, no max visible labels) and no attempt to keep the meta row and the labels row from both fully expanding on the narrowest, and only, column width the app has. **Serious, non-blocking-for-merge but should be a fast follow**: cap visible labels (e.g. 3 + "+N more" chip) and/or collapse rarely-populated meta badges behind the existing overflow (`⋮`) menu.

### 2. Long-label overflow (concrete, blocking-adjacent)

`task-card.component.ts:240-248` (card) and `task-detail.component.ts:106-112` (detail panel): the label `<span>` has **no `truncate`/`max-w-*`**, unlike the task-id span two rows up (`task-card.component.ts:80-82`, which does have `.truncate`). A daisyUI `.badge` is `white-space: nowrap` by default, so a single long, space-free label (a URL-shaped label, a long slug) will not wrap internally — it will force its own badge wider than the ~200px column content width. The card's outer container (`task-card.component.ts:64-65`) has no `overflow-hidden`, so this is a genuine horizontal-overflow risk on the one column width this app has. **Concrete fix**: add `truncate max-w-[9rem]` (or similar) to both label spans, matching the pattern already used for the id.

### 3. Authored vs derived distinction (FR-B4.9)

The two-homogeneous-groups-plus-sentence approach is a reasonable structural choice, but two things undercut "the sentence carries the meaning":

- **The origin note (`task-relations.component.ts:99-101`) is the stated "load-bearing half" of the distinction, yet it's rendered at `text-[10px]` with `text-base-content/40` opacity** — the smallest text size and lowest-contrast text token used anywhere in this batch. A sentence explicitly designed to carry meaning that raw colour/style cannot is being rendered in the least legible way available. This wasn't covered by the Gate 1 audit (which only checked `LABEL_CHIP_CLASSES`), and 40%-opacity text at 10px is a real risk of falling under 4.5:1 depending on the active theme's `base-content`/`base-100` pair — worth an explicit check the same way the chip palette got one, since by the developer's own logic in this file, this text is at least as load-bearing as the chips.
- **The `related` group is split into two sections that share the identical visible heading text "Related" (`task-relations.component.ts:94`, `TASK_RELATION_GROUP_LABELS['related']` used for both halves via the `:authored`/`:derived` key suffix that never reaches the DOM).** A reader skimming headings alone (before reading the tiny note underneath) sees "Related … Related …" twice with nothing in the heading itself to tell them apart. This directly contradicts "the sentence carries the meaning" — the _heading_ carries no distinguishing information at all; only the fine print two lines down does. **Fix suggestion**: put the word "authored"/"derived" in the heading itself (e.g. "Related (declared here)" / "Related (declared elsewhere)"), not only in the note paragraph.

### 4. Colour is never the sole carrier of meaning (NFR-12)

Verified: every label chip renders `{{ label }}` as literal text (`task-card.component.ts:246`, `task-detail.component.ts:110`), every relation entry renders `{{ entry.id }}` as text (`task-relations.component.ts:116`), the estimate badge renders the letter code, and the duplicate marker renders the literal word "duplicate" alongside its icon. Colour is reinforcement throughout, not the carrier. **Confirmed, no issue.**

### 5. Refused-parent state — title-only tooltip is not adequate

`task-card.component.ts:152-164`. The non-navigable branch renders two `<span>`s (not `<button>`s, no `tabindex`): the parent id and a "not linked" label, both carrying the actual refusal reason only via `[title]`. Two problems:

- **Neither span is focusable.** A keyboard-only user can Tab through the card but has no way to land on this element and trigger the tooltip — the reason text is simply unreachable without a mouse.
- **`title` is not a reliable accessible-name/description mechanism** for screen readers on static, non-interactive elements — support is inconsistent across AT/browser combinations, and it's never announced on focus since there's nothing to focus.

The good news: the review prompt's core question ("is it visually distinguishable from the button state?") is answered **yes**, but not because of the dimmer text — it's because of the explicit visible "not linked" text next to it, which is the part that actually works well here (visible text, not a tooltip). The _reason itself_, though, is genuinely inaccessible to non-mouse users. **Fix suggestion**: make the non-navigable state a `disabled` `<button>` (as `task-relations.component.ts:104-117` already correctly does for its own disabled entries) so it's focusable and the reason is exposed via `title`+`aria-label` the same way, rather than a bare span.

### 6. Responsive behaviour at ~250px

As noted in §1, this is not a hypothetical narrow state — `w-64` (256px) is the board's only column width, so everything above already describes the "narrow" case. The relations panel (`task-detail.component.ts:37`, fixed `w-96` = 384px) is not subject to the same squeeze since the detail panel has its own fixed width independent of board columns, and its label/relation chips have more room; I did not find an equivalent overflow risk there beyond the same missing-truncate issue noted in §2.

### 7. Accessibility beyond contrast

- **Focus states**: confirmed via `apps/ptah-extension-webview/src/styles.css:438-456` — a global `button/input/select/textarea/a:focus-visible` rule gives a 2px gold outline. Both new interactive elements that matter (`parentCrumb`'s navigable `<button>` at `task-card.component.ts:143-151`, and the relation `<button>`s at `task-relations.component.ts:104-117`) are real `<button>` elements, so they correctly inherit this. **Good.**
- **Keyboard reachability**: the non-navigable parent-crumb spans and the duplicate-marker/rollup spans are not reachable at all (see §5) — their `title` content is mouse-only.
- **`title` used where visible text is needed**: label chips are fine (label text is already visible; `title="Label: X"` is just redundant reinforcement). The rollup badge (`task-card.component.ts:209-217`) is not fine: its only visible/accessible-name content is `"{{ rollup.done }} / {{ rollup.total }}"` (e.g. "3 / 5") with zero context — a screen reader announces bare digits and a slash. The actual meaning ("Sub-tasks: X done · Y open · Z cancelled") lives only in `[title]`, which for a `<span>` with existing text content is not guaranteed to surface as the accessible description either. **Fix**: add an explicit `[attr.aria-label]="rollupTitle()"` the same way `AlertTriangleIcon`'s span already does at `task-card.component.ts:88-90`.
- **Duplicate marker accessible name** (`task-card.component.ts:220-229`): better off — the visible text literally says "duplicate", so a screen reader gets _some_ context, just not which task(s) it duplicates (that's title-only, same gap as above, lower severity since the word itself isn't meaningless on its own).
- **Icons**: confirmed via `node_modules/lucide-angular` source that `lucide-angular` sets `aria-hidden="true"` on icons by default unless an a11y prop is passed — the new `ListTree`/`Copy`/`CornerLeftUp` icons are correctly silent to AT and don't double up with the adjacent visible text. **No issue.**

---

## Findings summary

| #   | Severity                            | File:line                                                                          | Issue                                                                                                                                                                                    |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Serious (non-blocking, fast-follow) | `task-column.component.ts:31` + `task-card.component.ts` (whole meta/labels block) | Card can grow to 8–10 visual lines at the board's one and only column width (256px); no cap on labels or meta badges.                                                                    |
| 2   | Serious / blocking-adjacent         | `task-card.component.ts:240-248`, `task-detail.component.ts:106-112`               | Label chip has no `truncate`/`max-w`; a long single-word label can overflow the card horizontally (card has no `overflow-hidden`).                                                       |
| 3   | Serious                             | `task-presentation.ts:139-148`                                                     | `red` and `rose` chip fills are visually near-identical (ΔRGB 1-2-4) — closer than the `teal`/`emerald` pair already cut for the same reason.                                            |
| 4   | Moderate                            | `task-relations.component.ts:99-101`                                               | The "load-bearing" authored/derived sentence renders at `text-[10px]` / `40%` opacity — smaller and lower-contrast than anything covered by the Gate 1 audit.                            |
| 5   | Moderate                            | `task-relations.component.ts:94`                                                   | Both halves of the `related` group render the identical heading "Related" — the heading itself carries no authored/derived distinction, only the fine print does.                        |
| 6   | Moderate                            | `task-card.component.ts:152-164`                                                   | Refused-parent reason is only reachable via mouse-hover `title` on non-focusable `<span>`s — unreachable for keyboard/AT users.                                                          |
| 7   | Minor                               | `task-card.component.ts:209-217`                                                   | Child-rollup badge's accessible name is bare "`3 / 5`" with no context; context lives only in `title`.                                                                                   |
| 8   | Minor / non-blocking                | `task-presentation.ts:139-148`                                                     | `sky` vs `indigo` fills are also fairly close (secondary to red/rose).                                                                                                                   |
| 9   | Note, not a defect                  | Gate 2 methodology                                                                 | DOM-diff + comment-node reasoning is sound and I found no counter-example, but it is not literally a pixel measurement; recommend a Playwright screenshot regression test going forward. |
| 10  | Note, not a defect                  | Gate 1, light-theme chip fill                                                      | Near-invisible fill + 1px border at `badge-xs` may read as coloured text rather than a "chip" on light themes — contrast math passes, legibility-as-a-shape is a judgment call.          |

---

## Verdict

**APPROVED WITH CONCERNS.**

Both gates hold up under independent recomputation: Gate 1's numbers are correct to the decimal (verified against amber's cut number too), and Gate 2's structural reasoning is sound for this specific change even though it substitutes for, rather than proves, a true pixel-diff. Nothing here is a rendering bug or a broken layout. The concerns are real but none of them block this batch from shipping as reviewed code: the label-overflow gap (#2) and the card-density trend (#1) are the two I'd most want addressed before this batch is considered done, and the red/rose collision (#3) is a one-line palette fix. The accessibility gaps (#4, #6, #7) are worth a quick follow-up but are graceful-degradation issues, not breakage.
