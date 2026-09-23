# Code Style Review — `TASK_2026_533` Batch 7d

Scope: `libs/frontend/ui/src/lib/native/catalog-card/{catalog-card,catalog-grid,storefront-panel}.component.ts` (+ specs), `catalog-card/index.ts`, one line in `native/index.ts`. Read in full in the worktree `D:\projects\ptah-extension\.claude-worktrees\agent-a8c302f40623c0284-9135923403a8` (branch `agent-a8c302f40623c0284`), uncommitted. Compared against `implementation-plan.md` C8 (:429-464), C13 (:534-620), R7 (:763-...), `batches.md` Batch 7d (:463-494), `CONVENTIONS.md` §2-3, and siblings `native/card/native-card.component.ts`, `native/tab-group/native-tab-group.component.ts`, `native/provider-mark/`, `native/peer-session-picker/`.

## Summary

| Metric          | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Overall score   | 7/10                                                                        |
| Assessment      | CHANGES REQUESTED                                                           |
| Blocking issues | 0                                                                           |
| Serious issues  | 2                                                                           |
| Minor issues    | 2                                                                           |
| Files reviewed  | 7 (3 components + 3 specs + 1 barrel; `native/index.ts` diff also reviewed) |

## Five style questions

### 1. What breaks when requirements change in six months?

`title` is the required accessible-name input on both `CatalogCardComponent` (`catalog-card.component.ts:254`) and `StorefrontPanelComponent` (`storefront-panel.component.ts:145`). It collides with the global HTML `title` attribute. Angular resolves a _bound_ `[title]="…"` to the component input correctly, but a _static_ `title="…"` on either host element still lands as a literal DOM attribute alongside setting the input — the browser renders a native tooltip nobody asked for. The author already knows this (the JSDoc example at `catalog-card.component.ts:36-37` warns "a static `title="…"` would also leave a native tooltip on the host"), but the guard is a comment, not a compile-time or template-lint check. Once 6 discovery views plus the connectors page and the dashboard picker (implementation-plan.md C13 :548-559, :602-608) bind this input, a rename becomes a multi-file, cross-lib change (marketplace, chat-ui, dashboard) instead of a one-line fix today.

### 2. What would a new team member misread?

A newcomer copy-pasting a native HTML pattern (`<ptah-catalog-card title="Sentry">` instead of `[title]="server.name"`) would get a working card and an unexplained tooltip on hover, with no lint or runtime signal pointing at the cause — the failure mode is silent and cosmetic, which makes it easy to ship and hard to trace back to this file.

### 3. What does this cost to maintain?

`CatalogGridComponent`'s `role="list"` / `role="listitem"` contract (`catalog-grid.component.ts:21-25`) cannot be enforced by the grid itself — `<ng-content>` cannot add attributes to projected children, so every future consumer across 6 views must remember `role="listitem"` by hand (verified correct in this batch's own spec, `catalog-grid.component.spec.ts:20`). That is an Angular-imposed constraint, not a mistake in this batch, but it is an ongoing manual-discipline cost with no automated backstop (e.g. a dev-mode `MutationObserver` warning, or a wrapping option) that the plan does not ask for either.

Separately, the plan promises "Loading skeletons become CatalogCard-shaped skeleton tiles inside CatalogGrid" (implementation-plan.md C13 :601, Failure behaviour), but neither Task 7d.1 nor 7d.2 (batches.md :472-489) delivers a shared skeleton, and none of the 7 files in this batch export one. The 6 consumer views (Batches 13, 20-24) will each need a skeleton tile shaped like the card. Without a shared piece in this directory, each view either imports the real card in a fake "loading" state (coupling to real content structure) or hand-copies the card's `bg-base-200 border border-base-300 rounded-xl` shell — a duplication-with-drift risk the moment the card's padding, radius or compact breakpoint changes and the copies don't follow.

### 4. Where is this inconsistent with the rest of the repository?

Compact-density padding breaks the C8 "8px spacing rhythm (Tailwind 2/4/6/8)" rule (implementation-plan.md :454): `catalog-card.component.ts:233` sets `padding: 0.75rem` (12px, Tailwind `p-3`, not in `{2,4,6,8}`) inside the `< 480px` container block, and `storefront-panel.component.ts:131` sets the same compact `gap: 0.75rem`. This is not a new deviation invented by this batch, though — the sibling `NativeCardComponent`'s compact density already uses `p-3 gap-2` (`native-card.component.ts:92`), so the code is consistent with the nearest sibling even though both are inconsistent with the written rule.

Naming is otherwise consistent: unlike the `native-*` filename prefix used by `dropdown`, `popover`, `autocomplete`, `drawer`, `card`, `tab-group` and `option` (all literally `Native*Component`), the catalog-card family follows the _other_ established pattern in this same directory — `provider-mark`, `peer-session-picker` and `provider-model-picker` also drop the `native-` prefix because the class itself isn't named `Native…`. `catalog-card.component.ts` matching `CatalogCardComponent` (not `NativeCatalogCardComponent`) is correct by that precedent.

### 5. What would you have done differently, and why is that better rather than merely other?

I would rename `title` to `heading` (or `label`) on both components before any of the 6 consumer batches lands, and add a template-lint or a unit-test guard in this spec asserting no host static-attribute collision risk — cheap now, expensive after adoption. I would also land a minimal `ptah-catalog-card-skeleton` (or a `loading` input on `CatalogGridComponent` that renders N placeholder `role="listitem"` tiles reusing the card's own CSS classes) in this same batch, since the shape it needs to mimic is defined here and nowhere else yet.

## Blocking issues

None.

## Serious issues

### 1. `title` input shadows the native HTML `title` attribute on two components

- File: `libs/frontend/ui/src/lib/native/catalog-card/catalog-card.component.ts:254`, `libs/frontend/ui/src/lib/native/catalog-card/storefront-panel.component.ts:145`
- Problem: the required accessible-name input is literally named `title`, the same name as the global HTML attribute that triggers the browser's native tooltip. A static (unbound) `title="…"` on the host still sets the DOM attribute even though Angular also routes it to the component input, producing an unwanted tooltip. The risk is documented only in a JSDoc comment (`catalog-card.component.ts:36-37`), not structurally prevented.
- Tradeoff: implementation-plan.md C13 (:521-527) literally specifies the name `title: string` for both components, so this is not an implementer deviation — it is a plan-level choice that the code correctly implements and even proactively documents. But documentation is not enforcement, and the cost of changing it grows with every consumer that binds it.
- Recommendation: rename to `heading` (or similarly non-colliding) in this batch, before Batches 13/20-24 wire 6+ call sites to `[title]`. If the architect prefers to keep `title` per the plan text, that should be a stated, reviewed decision (e.g. an accepted-risk note in batches.md like the other "deviations (accepted, binding on later batches)" entries at :44-53), not a comment-only mitigation.

### 2. No shared loading-skeleton piece, despite the plan requiring skeleton tiles shaped like the card

- File: `libs/frontend/ui/src/lib/native/catalog-card/index.ts` (24 lines, no skeleton export); `libs/frontend/ui/src/lib/native/catalog-card/catalog-card.component.ts` (no `loading` state)
- Problem: implementation-plan.md C13 "Failure behaviour" (:601) states "Loading skeletons become `CatalogCard`-shaped skeleton tiles inside `CatalogGrid`," but Batch 7d's two tasks (batches.md :472-489) never mention a skeleton component, and the delivered files contain none.
- Tradeoff: leaving this to the 6 individual view batches means each view either couples its loading state to the real `CatalogCardComponent`'s internal markup (fragile — no supported "skeleton" input exists) or hand-rolls its own skeleton tile with copied Tailwind classes that will silently drift from the real card's shell (padding, radius, compact breakpoint) whenever this file changes later.
- Recommendation: add a small `ptah-catalog-card-skeleton` presentational component to this same directory (or a `loading` input on `CatalogCardComponent`/`CatalogGridComponent`) before Batch 13 starts consuming skeleton states, so every view shares one definition of "what a loading card looks like."

## Minor issues

- `catalog-card.component.ts:233` and `storefront-panel.component.ts:131`: compact-density `padding`/`gap` of `0.75rem` (Tailwind `p-3`) is outside the stated "8px rhythm (Tailwind 2/4/6/8)" rule (implementation-plan.md :454). Pre-existing pattern shared with `native-card.component.ts:92` (`p-3 gap-2`), so not new to this batch, but worth a single follow-up across both files if the rule is meant to be enforced.
- `catalog-grid.component.ts:21-25`: the `role="listitem"` contract on projected children is a real Angular content-projection limitation and is documented and spec-tested (`catalog-grid.component.spec.ts:20`), but there is no automated guard against a consumer forgetting it across 6 future call sites. Worth a note for the team-leader to require an explicit assertion in every consumer spec (the plan's own migration rule already implies this).

## File-by-file

### catalog-card.component.ts

Score 8/10 — 0 blocking, 1 serious (shared with storefront-panel, `title` naming), 1 minor (p-3 rhythm). Well-documented slot contract (`:15-21`), correct stretched-link activation pattern with no nested interactive elements (verified by its own spec, `catalog-card.component.spec.ts:302-315`), theme-token-only styling, `OnPush`/standalone/signals throughout. Ties to `CatalogGridComponent`'s container for compact density is clean and tested (`:135` of the grid spec).

### catalog-grid.component.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor (manual `role="listitem"` discipline, documented). Native `@container` implementation matches `apps/ptah-extension-webview/src/styles.css` precedent per its own JSDoc (:27-29); `ariaLabel` input matches `native-card.component.ts:171`'s naming and is explicitly required by batches.md Task 7d.2 (:487), so it is not an unjustified addition.

### storefront-panel.component.ts

Score 7/10 — 0 blocking, 1 serious (shared `title` naming issue), 0 minor beyond the shared p-3 note. Otherwise mirrors the card's structure (instance-scoped ids, `empty:hidden` slot wrappers, theme tokens only) consistently.

### catalog-card/index.ts

Score 9/10 — explicit named exports per `CONVENTIONS.md §3` (`:11-24`), well under the 150-line barrel cap, grouped by component. The one gap is the missing skeleton export noted above (Serious #2), which is a completeness issue, not a barrel-structure issue.

### native/index.ts (diff)

Score 10/10 — single `export * from './catalog-card';` line added in alphabetical position matching every other subfolder's wildcard re-export (`:34`); consistent with the existing pattern for this specific barrel (`type:ui` — no cross-lib imports introduced).

### catalog-card.component.spec.ts / catalog-grid.component.spec.ts / storefront-panel.component.spec.ts

Score 9/10 — thorough coverage of slots, clamp, badge/meta edge cases, activation-only-when-interactive, no-nested-interactive-element, no-`innerHTML`, and (in the grid spec) the container column rule and role contract. No spec exercises the `title`-as-static-attribute risk, which is consistent with Serious #1 being undetected by tests as currently written.

## Pattern compliance

| Repository rule or nearby convention                             | Status                                   | Evidence                                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type:ui` boundary — imports only `@angular/*`                   | PASS                                     | `catalog-card.component.ts:55-62`, `catalog-grid.component.ts:43`, `storefront-panel.component.ts:40-45` import only `@angular/core`/`@angular/common`       |
| `OnPush` change detection                                        | PASS                                     | `catalog-card.component.ts:101`, `catalog-grid.component.ts:51`, `storefront-panel.component.ts:54`                                                          |
| Standalone components                                            | PASS                                     | `standalone: true` on all three (`:99`, `:50`, `:53`)                                                                                                        |
| Signal-based inputs/outputs, no injection                        | PASS                                     | `input()`/`output()`/`computed()` throughout; no `inject()` calls                                                                                            |
| No `[innerHTML]`                                                 | PASS                                     | asserted by `catalog-card.component.spec.ts:330-336`; grep confirms no other occurrences                                                                     |
| Theme tokens only (C8 hex map)                                   | PASS                                     | `bg-base-200`, `border-base-300`, `badge-success` etc.; no hard-coded hex in any of the three components                                                     |
| Barrel: explicit named exports, ≤150 lines (`CONVENTIONS.md §3`) | PASS                                     | `catalog-card/index.ts` is 24 lines, named exports only                                                                                                      |
| Sibling `native-*` filename prefix                               | NOT_APPLICABLE (alternate precedent)     | matches `provider-mark`/`peer-session-picker`/`provider-model-picker` naming, not `native-card`/`native-tab-group` — both patterns coexist in this directory |
| `ariaLabel` input naming                                         | PASS                                     | matches `native-card.component.ts:171`; required by batches.md Task 7d.2 (:487)                                                                              |
| 8px spacing rhythm (implementation-plan.md :454)                 | FAIL (pre-existing, shared with sibling) | `catalog-card.component.ts:233`, `storefront-panel.component.ts:131` vs. `native-card.component.ts:92`                                                       |
| `title` input non-collision with native attributes               | FAIL                                     | `catalog-card.component.ts:254`, `storefront-panel.component.ts:145`                                                                                         |
| C13 skeleton requirement (implementation-plan.md :601)           | FAIL (incomplete)                        | no skeleton component/export delivered in this batch                                                                                                         |
| `role="list"`/`role="listitem"` grid contract                    | PASS (documented, consumer-dependent)    | `catalog-grid.component.ts:21-25`, tested via host template in `catalog-grid.component.spec.ts:20`                                                           |

## Maintenance debt

- Introduced: one clean, well-tested shared card/grid/panel contract that 6 discovery views, the connectors page and the dashboard picker can all consume without duplicating markup; a documented (if not yet enforced) `title`-collision risk; a documented (if not yet enforced) manual `role="listitem"` obligation for every future consumer.
- Retired: nothing yet — this batch only adds the shared pieces; the 6 view-specific duplicated card markups this is meant to replace are retired in later batches (13, 20-24).
- Net: positive for the shared vocabulary, but two open items (naming, skeleton) should close before the 6 consumer batches multiply their cost.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the `title` input name is a real, plan-inherited footgun best fixed with one file each while there are zero consumers, and the missing shared skeleton will otherwise be reinvented (and drift) six times over the next several batches.
- What a 10/10 version would do differently: rename `title` to a non-colliding name (or get an explicit, recorded architect decision to keep it, the same way other batch deviations are recorded in batches.md); ship a `ptah-catalog-card-skeleton` (or a `loading` input) in this same batch; align the compact-density padding with the stated 8px rhythm rule in both this batch and its `native-card` sibling in one follow-up.
