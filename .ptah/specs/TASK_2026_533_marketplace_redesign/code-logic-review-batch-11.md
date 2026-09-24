# Code Logic Review — `TASK_2026_533` Batch 11

Scope: 8 new files in `libs/frontend/marketplace/src/lib/ui/` (worktree
`D:\projects\ptah-extension\.claude-worktrees\task533-b11`, base `bff852d26`):
`source-band.component.ts(+.spec.ts)`, `storefront-hero.component.ts(+.spec.ts)`,
`featured-connectors.component.ts(+.spec.ts)`, `category-bento.component.ts(+.spec.ts)`.
All four are read in full, together with their specs, the collaborators they compose
(`catalog-card.component.ts`, `target-marks.component.ts`, `status-pill.component.ts`,
`connector-links.store.ts` types, `ptah-connectors.catalog.ts`), `batches.md` Batch 11 /
7d / 9 binding notes, and implementation-plan.md C8/C9. `npx nx run-many -t
lint,typecheck,test -p @ptah-extension/marketplace --skip-nx-cache` was re-run in the
worktree and passed (lint, typecheck, 3 successful tasks; matches the executor's report).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment           | APPROVED                             |
| Blocking issues      | 0                                    |
| Serious issues       | 0                                    |
| Moderate issues      | 2                                    |
| Failure modes found  | 2                                    |

## Five logic questions

### 1. How does this fail silently?

- A connect/authorize/disconnect action error can go completely unrendered if the
  connector it is pinned to is not present in the row currently being drawn. Both
  `FeaturedConnectorsComponent` and (by the same pinned-error pattern the report
  describes for the rest of the page) any other card consumer only render `actionError`
  when `actionError.connectorId === connector.id` for a connector that is actually in
  `items()` (`featured-connectors.component.ts:149-151, 513-516`). If a Connect click
  fails for a connector that then drops out of the featured set on the next recompute
  (e.g. `selectFeaturedConnectors` re-runs and the connector is no longer in the top 6,
  or the page swaps `items` for a different view before the error is dismissed), the
  error message vanishes with no visible trace — the user sees a normal card and no
  feedback that the action failed. This is not a new bug in this batch (the pinning
  design is documented as deviation 3 in `batch-11-report.md:89`), but it is a real gap
  this batch's component does nothing to close, and the page batches (13/15) should be
  told to keep `actionError` visible for at least the acting connector's detail view as
  a fallback.
- `groupConnectorsByCategory` (`category-bento.component.ts:56-90`) iterates only
  `PTAH_CONNECTOR_CATEGORIES` (`category-bento.component.ts:71`); a connector whose
  `category` is not one of that array's members is counted into `byCategory` but never
  reaches a tile or the total, with no error, no console warning, nothing. Today this
  cannot happen because `PtahConnectorCategory` is a closed union and
  `PTAH_CONNECTOR_CATEGORIES` lists every member (`ptah-connectors.catalog.ts:44-64`),
  which the batch's own spec (`category-bento.component.spec.ts:101-108`,
  "covers every connector of the real catalogue exactly once") confirms against the
  live catalogue. But `PTAH_CONNECTOR_CATEGORIES` is a plain array, not tied to the
  union by a `satisfies Record<PtahConnectorCategory, true>` (or similar) compile-time
  check, so a future category added to the union without a matching array entry would
  silently drop every connector of that category from the bento, with the build still
  green. Pre-existing pattern in `ptah-connectors.catalog.ts`, not introduced here, but
  worth flagging since this batch adds a second silent consumer of the same gap.

### 2. What user action produces unexpected behaviour?

- None found that is not already covered by a spec assertion. Clicking a disabled
  action button (busy/polling) is defended both at the template (`[disabled]`) and in
  `emitAction` (`featured-connectors.component.ts:523-530`), which re-checks
  `item.busy || item.polling` against the live `items()` before emitting — a genuine
  double guard, not just a UI-level one, and `featured-connectors.component.spec.ts:372-378`
  exercises it by dispatching a raw `click` event to bypass the native `disabled`
  short-circuit.
- Rapid repeated clicks on a `CategoryBentoComponent` tile or the hero's Retry button
  simply re-emit each time (no client-side debounce/lock) — correct for these, since
  debouncing an output is the store/page's job, not a presentational component's, and
  nothing here claims otherwise.

### 3. What input data produces a wrong answer?

- Verified `selectFeaturedConnectors` against catalogue-order, missing-from-map,
  limit-0/negative/NaN cases (`featured-connectors.component.ts:86-100`,
  `featured-connectors.component.spec.ts:99-145`) — correct: `Number.isFinite(limit)`
  guards NaN, `Math.max(0, Math.floor(limit))` guards negative/fractional.
- Verified `groupConnectorsByCategory` sample-distinctness (Asana v1/v2 sharing a
  `brandSlug`) and count-vs-sample divergence (`category-bento.component.ts:74-81`,
  spec `:80-93`) — correct, `Set<string>` on `brandSlug` is the right key since two
  different products are required to use different slugs
  (`ptah-connectors.catalog.ts:76-78`).
- Verified `toTileView`'s "never invents a number" rule
  (`storefront-hero.component.ts:55-70`): `null`, `NaN`, and negative counts all render
  "—" plus sr-only "Not available", never a fabricated `0`; a genuine `0` renders `0`.
  Spec `storefront-hero.component.spec.ts:180-212` pins exactly this distinction, which
  is the one place a naive `count ?? 0` implementation would have quietly lied to the
  user.
- Verified `connectorPillStatus`'s exhaustive `switch` (`featured-connectors.component.ts:108-121`)
  has no `default` branch, so a future addition to `ConnectorStatus` fails to compile
  instead of falling through to a wrong pill — good defensive typing.

### 4. What happens when a dependency fails?

- Not applicable in the strict sense: all four components are purely presentational,
  take no injected services (`batch-11-report.md:81` — confirmed by inspection, no
  `inject()` call in any of the four files) and issue no RPCs. `FeaturedConnectorsComponent`'s
  `loading`/`error`/`ready`-empty states are driven entirely by inputs the page will
  set from `ConnectorLinksStore` failures; the component itself correctly falls back
  to a generic message when `loadError` is blank (`featured-connectors.component.ts:518-521`,
  spec `:440-445`), so a store that fails without a message still shows something
  actionable rather than an empty string.

### 5. What is missing that the requirements never mentioned?

- Duplicate `connector.id` or `category` values in the array passed to `@for (... track
  card.connector.id)` (`featured-connectors.component.ts:298`) or `@for (... track
  item.category)` (`category-bento.component.ts:138`) are not defended. Angular would
  throw `NG0955` rather than silently misrender, so this is a crash risk under
  malformed page data rather than a "wrong answer" risk — reasonable for a
  presentational component to trust its input shape, but worth a one-line note for
  whichever page batch assembles `items()`/`connectors()` that ids must be unique.
- No requirement asked for it, and none is needed here, but the two "Synced to"/`[card-status]`
  slots both correctly treat `null` (unknown) and `[]` (known-empty) as different states
  (`storefront-hero.component.ts:265-281`), which matches the plan's stated rule that
  the hero "never makes up a number" and extends it correctly to CLI detection.

## Failure modes

### Pinned action error can disappear silently

- Trigger: an action fails for a connector that later falls out of the array the
  consuming component renders (featured-set recompute, filter change, page navigation
  away and back) while `actionError` is still set to that connector's id.
- Symptom: the user receives no error feedback at all — no card shows the alert, the
  action appears to have simply done nothing.
- Evidence: `featured-connectors.component.ts:149-151` (`error` only set when
  `actionError.connectorId === connector.id` for a connector present in `cards()`),
  `:513-516` (`cards` is derived solely from `this.items()`).
- Current handling: none in this batch — by design, the component only has the
  connectors it was given.
- Recommendation: not a defect this batch should fix (it owns no store), but the
  finding should travel to Batch 13/15: either keep the acted-on connector in the
  rendered set until its error is dismissed, or surface `actionError` at the page level
  as a fallback toast/banner when its connector isn't currently visible.

### `groupConnectorsByCategory` silently drops out-of-enum categories

- Trigger: a `PtahConnector.category` value that is not a member of
  `PTAH_CONNECTOR_CATEGORIES` (currently impossible given the catalogue, but not
  compile-enforced).
- Symptom: the connector is counted into an internal bucket and then never surfaces in
  any tile, in the total, or in an error — it simply disappears from "Explore by
  category".
- Evidence: `category-bento.component.ts:63-73` (bucket built from all connectors,
  iterated only over `PTAH_CONNECTOR_CATEGORIES`); `ptah-connectors.catalog.ts:55-64`
  (`PTAH_CONNECTOR_CATEGORIES` is a plain `readonly PtahConnectorCategory[]`, not tied
  to the union by an exhaustiveness check).
- Current handling: the batch's spec (`category-bento.component.spec.ts:101-108`) pins
  correctness against today's real catalogue, which is honest evidence but does not
  close the gap for tomorrow's catalogue.
- Recommendation: outside this batch's file set (the array lives in
  `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`, not touched here);
  worth a follow-up note (e.g. `PTAH_CONNECTOR_CATEGORIES` built via
  `Object.keys(... satisfies Record<PtahConnectorCategory, true>)` or a spec that
  fails fast if a category is missing) rather than a blocker on Batch 11.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate — pinned `actionError` can render nowhere (see failure mode above),
  `featured-connectors.component.ts:149-151`.
- Moderate — `PTAH_CONNECTOR_CATEGORIES` iteration silently drops any future
  out-of-enum category (see failure mode above), `category-bento.component.ts:71`;
  root cause is outside this batch's files.
- Minor — `@for` track expressions on `connector.id` / `category` assume uniqueness
  with no defensive check; a duplicate would throw `NG0955` rather than corrupt state,
  so this is a robustness note, not a logic defect —
  `featured-connectors.component.ts:298`, `category-bento.component.ts:138`.
- Minor — `FeaturedConnectorsComponent.emitAction` does an `Array.prototype.find` over
  `this.items()` on every click (`featured-connectors.component.ts:527`) instead of
  reading the already-computed `card.locked` passed from the template; harmless at
  featured-row scale (≤6 items) and arguably safer (re-checks the live signal rather
  than a possibly-stale closure value), so left as an observation only.

## Data flow

1. Page (future Batch 13/15) builds `FeaturedConnectorView[]` from
   `ConnectorLinksStore` + `PTAH_CONNECTORS`, using `selectFeaturedConnectors` — OK,
   pure, total, spec-verified against the real catalogue.
2. `FeaturedConnectorsComponent.cards` computed re-derives a `FeaturedCardView` per
   item, folding in the pinned `actionError` — OK; the one identified gap is that a
   connector missing from `items()` can never surface its error (see failure modes).
3. Template renders each view through `ptah-catalog-card` with `[card-mark]` /
   `[card-status]` / `[card-actions]` slots — OK, matches the Batch 7d contract
   (`role="listitem"`, `heading` input) verified in `catalog-card.component.ts:107-189`.
4. Button click → `emitAction` re-validates against the live `items()` signal before
   emitting `action` — OK, closes a stale-closure race a naive template-only guard
   would have left open.
5. `CategoryBentoComponent.items` computed calls the pure `groupConnectorsByCategory`
   on every `connectors()` change — OK for today's closed category enum; gap noted
   above for a future addition.
6. `StorefrontHeroComponent.tileViews` computed maps `tiles()` through `toTileView`,
   which is the sole place a count can become "—" instead of a real value — OK, no
   other code path renders a count.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `SourceBandComponent`: heading is page `h1` by default, storefront/compact layouts, two collapsing slots, ≤3 meta items | COMPLETE | none |
| `StorefrontHeroComponent`: gold eyebrow used only on the eyebrow, hero gradient, real-count tiles with loading/error/Retry, "Synced to" via `ptah-target-marks`, two-column `@container` layout, no search/My Stack | COMPLETE | none |
| `FeaturedConnectorsComponent`: `ptah-catalog-card`s (no separate connector card), brand mark + status pill + actions via slots, loading/error/empty states, featured rule as a reusable pure helper | COMPLETE | actionError visibility gap noted above, not a scope miss |
| `CategoryBentoComponent`: category tiles in catalogue order, sample brand marks, `?category=` navigation via emitted output, `aria-current`, `@container` columns | COMPLETE | category-enum exhaustiveness is a shared-lib gap, not this batch's |
| No `[innerHTML]`, no injection, OnPush + signals + standalone | COMPLETE | verified by inspection and by the specs' own `innerHTML` assertions |

Implicit requirements not addressed: none found beyond the two moderate findings above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Ready count missing/NaN/negative | YES | `toTileView` → "—" + sr-only "Not available" | none |
| Ready count is a real 0 | YES | renders `0`, not "—" | none |
| `syncedTargets` null vs empty array | YES | skeleton vs "No CLI detected" | none |
| Blank action-error message | YES | `errorText` trims and treats blank as no error | matches hero's own blank-handling convention |
| Action error pinned to a connector not currently rendered | NO | error silently has nowhere to render | see failure mode above (page-level gap) |
| Busy/polling card, direct click bypassing `disabled` | YES | `emitAction` re-checks live `items()` | none |
| Category not in `PTAH_CONNECTOR_CATEGORIES` | NO | silently excluded from tiles and total | see failure mode above (shared-lib gap) |
| Smaller/zero/negative `limit`/`sampleSize` | YES | `Math.max(0, Math.floor(...))` on both pure helpers | none |
| Distinct-brand sampling with shared slugs (Asana v1/v2) | YES | `Set<string>` on `brandSlug` | none |
| Empty `items()` / `connectors()` | YES | explicit empty-note branches with a CTA | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: an action-error message can be silently swallowed if the connector it is
  pinned to isn't in the currently-rendered set when the error arrives; this is a
  page-wiring risk for Batch 13/15 to close, not a defect in these four components.
- What a robust implementation would add: (1) a page-level fallback so a pinned
  `actionError` is never invisible (e.g. keep the acted-on card in view until
  dismissed, or a page-level toast as backstop); (2) a compile-time exhaustiveness tie
  between `PtahConnectorCategory` and `PTAH_CONNECTOR_CATEGORIES` in
  `ptah-connectors.catalog.ts` so a future category can't silently vanish from the
  bento.
