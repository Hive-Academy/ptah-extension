# Batch 41c report - Agents tab card: outcome cell clipping, card-width grid, duplicate notice

This batch fixes three findings:

- P5 visual review S1 (Serious).
- P5 final logic review Minor 5 and P5 final style review D4, card half only.
- The coordinator's follow-up: the per-figure metrics clipped because the column count followed the viewport.

## Changes

All paths are relative to the worktree root.

### `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts`

- `:74-91`: a local `CloneMetricView` type, which is `CloneMetric` plus `fullRow` and `warning`. Also two constants:
  `OUTCOME_UNAVAILABLE_METRIC`, and `OUTCOME_SENTENCE_METRICS`, which lists the three single-sentence outcome states
  (`clone-metric-outcome-loading`, `-unavailable`, `-empty`).
- `:132-159`: a new `styles` block with native CSS container queries.
  - `.clone-card-metrics-container` sets up the `ptah-clone-metrics` inline-size container.
  - The grid has 1 column by default.
  - It has 2 columns at a container width of 10rem (160 px) or more.
  - It has 4 columns at 32rem (512 px) or more.
  - The column count now follows the card's own width, not the viewport. The Tailwind container-queries plugin is not installed.
    `catalog-grid.component.ts:27` records that the repo uses native `@container` CSS instead; this follows that pattern.
- `:220-244`: the metrics `<dl>` sits inside the new `.clone-card-metrics-container` div.
  - The `<dl>` no longer has `grid-cols-2 sm:grid-cols-4`. It now has `clone-card-metrics grid gap-x-4 gap-y-1.5 text-xs`.
  - The loop runs over `metricViews()`.
  - Each item binds `[class.col-span-full]="m.fullRow"`.
  - Each `<dd>` binds `[class.truncate]="!m.fullRow"`, `[class.text-warning]="m.warning"` and
    `[attr.title]="m.fullRow ? null : m.value"` (`:236`).
  - The three outcome sentences take a whole row and wrap. Every other value may still truncate, and its full text is in the title.
  - The Agents-list card content is about 176 px wide at a 1100 px window. The screenshot shows a 4-column cell of 33 px, which gives
    a content width of about 176 px. At that width the grid has 2 columns of about 80 px, which fits values like "80% (4/5)".
- `:247`: the "Outcome data unavailable." note now renders under `showUnavailableNote()`.
- `:538-544`: the `metricViews` computed.
- `:546-556`: the `showUnavailableNote` computed. It is true only when:
  - the card is an agent card,
  - the outcome state is `unavailable`, and
  - the metric row does not already show `clone-metric-outcome-unavailable`.

  That happens after a failed refresh that kept an earlier record. When the first read fails, the sentence appears once, in the
  full-row metric, in `text-warning`.

No `data-testid` was added, renamed or removed. `agent-outcome-signals.ts` and the drawer are unchanged.

### `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.spec.ts`

- `:345` "shows a safe unavailable state without raw errors": dropped the assertion that pinned the duplicate note.
- `:355` NEW "says "Outcome data unavailable" exactly once when the first read fails". It checks three things:
  - the sentence appears exactly once in the card text,
  - the separate note is absent,
  - the value has `text-warning`.
- `:368` "keeps figures visible with an unavailable note after a failed refresh": now also checks that the unavailable metric is absent
  and that the sentence appears exactly once.
- `:381` NEW `it.each` "gives the %s outcome sentence a full row with no truncation". It covers the `ready` (empty), `loading` and
  `unavailable` states. The value has no `truncate` and its item has `col-span-full`. Invocations on the same card keeps `truncate`
  and does not have `col-span-full`.
- `:408` NEW "leaves the per-figure outcome metrics in the grid unchanged": Delivered keeps `truncate` and does not have `col-span-full`.
- `:418` NEW "puts the full text on every truncating metric value as a title". Every `dd.truncate` in the grid has a `title` equal to its
  text. Top failure (`usage-limit`) and Window (`(last 30 days)`) are checked by name.
- `:449` NEW "leaves a full-row outcome sentence without a title (it wraps instead)".
- `:454` NEW "sizes the metric grid from the card, not the viewport". The `<dl>` has no `sm:`/`md:`/`lg:`/`xl:` `grid-cols-*` class. It
  has the `clone-card-metrics` class and sits inside `.clone-card-metrics-container`.

## Decisions

| Decision | Alternative | Evidence | Reversible |
| --- | --- | --- | --- |
| The outcome sentence gets a full row inside the existing grid (`col-span-full`). | Render the sentence outside the `<dl>`. That would need separate empty-grid handling and would change the metric order. | `surface-renderer.component.ts:268,274` | Yes |
| The sentence shows once by keeping the metric and suppressing the note. | Keep the note and drop the metric. The metric also feeds the drawer, and dropping it would bring "Never invoked yet" back for agents that have never run. | | Yes |
| Container queries are native `@container` CSS in the component's `styles`. | Tailwind `@sm:` variants. The plugin is not a dependency, and adding it is a new library. | `catalog-grid.component.ts:27-29`; `apps-surface-panel.component.ts:151-161`; `package.json` has `tailwindcss` ^3.4.18 and no container-queries plugin | Yes |
| The query container is a wrapper div around the `<dl>`. | Make the `:host` the container. A container cannot query its own width, and the host is an inline element inside an `<li>` (`skill-clones-view.component.ts:311-312`), so it would need a display change. The wrapper keeps the change local. | | Yes |
| Every value that may truncate gets a title. | Set a title only on values that actually overflow. That needs a measurement or a `ResizeObserver` for each card in an unbounded list, which the runtime-cost rule forbids. | | Yes |
| Breakpoints are 10rem and 32rem. | | Below 160 px a 2-column cell would be under about 72 px. At 512 px or more a 4-column cell is about 116 px. | Yes |

## Verification

- `ptah_get_diagnostics` scoped to both changed files, after the follow-up edits, reported "No diagnostics in the requested files".
  Other spec files in the same project have type errors, for example `skill-clones-view.component.spec.ts` and
  `skill-synthesis-tab.component.spec.ts`. None of them are files touched here.
- Jest and nx were not run, as the brief instructed. To run later:
  `npx jest -c libs/frontend/skill-synthesis-ui/jest.config.ts libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.spec.ts --coverage=false --maxWorkers=2`.
- jsdom does not lay out the page, so the specs pin classes and attributes, not measured column widths.
- No visual re-check was done, and Electron was not launched, as instructed. The column counts at real card widths still need a
  visual re-check.

## Out-of-scope observations

- The drawer shows the same duplicate notice (`clone-detail-drawer.component.ts:181-188`, style review D4). Not in this batch.
- `outcomeReadFailures` in `skill-clones-state.service.ts` is still never read. That is the other half of logic review Minor 5. Not in
  this batch.
