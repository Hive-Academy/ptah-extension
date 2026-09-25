# Code Style Review — `TASK_2026_533` Batch 9

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 12 (6 components + 6 specs)          |

Scope: all 12 new files under
`libs/frontend/marketplace/src/lib/ui/` in worktree `task533-b9`
(status-pill, target-marks, copy-command-button, removal-lock-badge,
bulk-action-bar, docked-inspector), read in full. Compared against
`libs/frontend/ui/src/lib/native/brand-mark/brand-mark.component.ts`,
`.../catalog-card/catalog-card.component.ts`,
`libs/frontend/marketplace/src/lib/shell/marketplace-status-bar.component.ts`
and `.../shell/marketplace-nav.component.ts`, `.../oauth-surface.component.ts`
(clipboard pattern), `.../popover/native-popover.component.ts`. Checked
`libs/frontend/marketplace/eslint.config.mjs` for the lib's own
`explicit-member-accessibility` rule, and `ptah_get_diagnostics` scoped to the
six component files (0 errors in scope; 6 pre-existing errors elsewhere,
matching the executor's report).

## Five style questions

### 1. What breaks in six months?

`target-marks.component.ts:87-95` scales `ptah-provider-mark` (a fixed 32px,
no-size-input component) down to 24px with a bare `scale-[0.625]` transform
inside an `overflow-hidden` tile, instead of through a contract on
`ProviderMarkComponent`. If a future change to `ProviderMarkComponent`'s
internal padding or icon viewBox changes what "32px" means, this scale factor
silently mis-centers OpenCode's mark and nothing here would catch it — no
spec asserts the visual centring, only that the node exists
(`target-marks.component.spec.ts:80-89`).

### 2. What would a new team member misread?

`bulk-action-bar.component.ts:71-91`: the `role="region"` landmark stays in
the DOM and is styled empty (`idle() ? '' : '...'`) even when nothing is
selected, so a reader skimming the template could assume the region only
appears once something is selected. The component doc comment
(`:45-47`) does explain the "stays in the DOM, visually hidden" rule, so this
is a minor legibility cost, not a hidden defect — the deviation is also
called out explicitly in `batch-9-report.md` item 6.

### 3. What does this cost to maintain?

The `scale-[0.625]` workaround (`target-marks.component.ts:90-95`) is the one
real cost: it duplicates knowledge of `ProviderMarkComponent`'s fixed box size
in a second file, and the executor's own report (`batch-9-report.md` item 2)
names the cleaner fix (a `size` input on `ProviderMarkComponent`) as
"outside this batch." Everything else in the six components is
self-contained: pure formatting functions co-located with their component
(matching `marketplace-status-bar.component.ts`'s `marketplaceStatusSummary`
and `bulk-action-bar.component.ts`'s own `bulkSelectionLabel`/
`bulkResultSummary`), no store or service injection, no new barrel to keep in
sync.

### 4. Where is this inconsistent with the rest of the repository?

It isn't, on the points that matter for this batch. Inputs/outputs use
`input()`/`input.required()`/`output()` exclusively (no `@Input`/`@Output`
found), `public readonly` on every input/output and `protected readonly` on
every internal computed — this matches `marketplace-nav.component.ts:294,297`
(the batch's nearest marketplace-lib sibling with inputs) and is in fact
required by `libs/frontend/marketplace/eslint.config.mjs:45-48`
(`explicit-member-accessibility: 'explicit'`, warn). The `ui`-lib siblings
(`brand-mark.component.ts`, `catalog-card.component.ts`) omit the `public`
keyword because `libs/frontend/ui/eslint.config.mjs` carries no such rule —
a real difference, but one the two libs' own configs create, not something
Batch 9 introduced inconsistently.

### 5. What would you have done differently?

Add a `size: MarkTileSize` input to `ProviderMarkComponent` (or a matching
`sm`/`md` variant) so `TargetMarksComponent` selects a size instead of
transform-scaling a black box, and land it as a fast follow before Batch 10
starts consuming target marks in `ProviderTableComponent`/
`ProviderCardListComponent`.

## Blocking issues

None.

## Serious issues

### Provider-mark sized by CSS transform instead of a component contract

- File: `libs/frontend/marketplace/src/lib/ui/target-marks.component.ts:86-96`
- Problem: `ptah-provider-mark` renders at a fixed 32px with no size input
  (`libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts`).
  `TargetMarksComponent` wraps it in a 24px `overflow-hidden` tile and applies
  `scale-[0.625]` to visually match `ptah-brand-mark size="sm"`, rather than
  the mark exposing the smaller size itself.
- Tradeoff: works today, but the scale factor is derived by inspection of
  `ptah-provider-mark`'s current box, not enforced by any type or contract; a
  future change to that box (or to `MARK_TILE_BOX_CLASS.sm`, which
  `TargetMarksComponent` re-derives as a bare `h-6 w-6` literal rather than
  importing the constant) desyncs silently. No spec pins visual alignment,
  only DOM presence.
- Recommendation: add a size input to `ProviderMarkComponent` (tracked by the
  executor as a known follow-up, `batch-9-report.md` item 2) and swap the
  transform for it once that lands; in the meantime this is acceptable to
  ship since it is documented and scoped, not silently introduced.

## Minor issues

- `target-marks.component.ts:88` hard-codes `h-6 w-6` for the provider-mark
  tile instead of importing `MARK_TILE_BOX_CLASS.sm` from
  `monogram-tile.component.ts` (which `brand-mark.component.ts:12-14` already
  exports and uses for the same 24px size) — two sources of truth for "sm
  tile size."
- `status-pill.component.ts:60-67` and `removal-lock-badge.component.ts`'s
  warning-tone classes independently re-derive the
  `border-*/40 bg-*/10 text-*` convention that `harness-health-badge.component.ts:28-34`
  established (correctly cited in `batch-9-report.md` item 5, but the shared
  string pattern itself is duplicated rather than centralised — acceptable at
  this scale, worth a shared token constant if a third tone-badge component
  appears in Batch 10/11).

## File-by-file

### status-pill.component.ts

9/10 — 0B, 0S, 0M. Clean pure/presentational split; `statusPresentation()`
exported alongside the component matches the established local convention
(`marketplace-status-bar.component.ts`'s `marketplaceStatusSummary`). Icon +
text pattern is followed for every tone including `unknown`, never colour
alone (:118-120).

### target-marks.component.ts

7/10 — 0B, 1S, 1M. Correct import boundary (`CLI_TARGET_BRANDS`,
`BrandMarkComponent`, `ProviderMarkComponent` from the `@ptah-extension/ui`
barrel), correct a11y structure (decorative marks, sr-only target list). The
provider-mark scaling workaround is this batch's one real style debt (see
Serious issues).

### copy-command-button.component.ts

9/10 — 0B, 0S, 0M. `inject(DestroyRef)` is used only for timer cleanup, the
one legitimate lifecycle need in this kit, and mirrors
`oauth-surface.component.ts:610-641`'s existing clipboard/select-fallback
behaviour and its `COPIED_FEEDBACK_MS` naming exactly.

### removal-lock-badge.component.ts

9/10 — 0B, 0S, 0M. Composes `CopyCommandButtonComponent` and
`NativePopoverComponent` correctly (`trigger`/`content` slots, `closed`
output, Escape handled by the popover itself per
`native-popover.component.ts:226-229` — confirmed no duplicate handler was
added here). Never renders a `<p>` in the closed state
(`removal-lock-badge.component.spec.ts:80-85` pins it).

### bulk-action-bar.component.ts

8/10 — 0B, 0S, 1M (the idle-region legibility note above, self-documented).
Live-region wiring (`aria-live="polite"` on both the count and the result
container, present before content) is correct and spec-verified
(`bulk-action-bar.component.spec.ts:142-150`).

### docked-inspector.component.ts

10/10 — 0B, 0S, 0M. Smallest file (84 lines) and the clearest contract: never
calls `.focus()`, verified both by a source-text spec assertion and by
behavioural specs for three distinct scenarios (appear, heading/content
change, user-placed focus inside).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Standalone + OnPush on every component | PASS | `changeDetection: ChangeDetectionStrategy.OnPush`, `standalone: true` in all six files |
| Signals-only inputs/outputs (no `@Input`/`@Output`) | PASS | grep found zero decorator usage in `ui/` |
| No injection except where lifecycle demands it | PASS | only `copy-command-button.component.ts` injects, for `DestroyRef` timer cleanup |
| `explicit-member-accessibility: 'explicit'` (marketplace eslint) | PASS | `public readonly`/`protected readonly` throughout; rule confirmed at `libs/frontend/marketplace/eslint.config.mjs:45-48` |
| Only `@ptah-extension/ui` barrel + marketplace-local `data/` imports | PASS | `target-marks.component.ts:8-14`, `removal-lock-badge.component.ts:9`; no deep paths into `ui/src/lib/native/*` found |
| No import of `shell/`/nav from `ui/` | PASS | zero references to `../shell` in any of the six files |
| Theme tokens only, no hex | PASS | executor's grep in `batch-9-report.md` confirms; spot-checked template classes, all `bg-*`/`text-*`/`border-*` tokens |
| No `innerHTML` | PASS | grepped source; every spec also asserts this via a source-text test |
| Spec style consistent with marketplace shell specs | PASS | same `render()`/`byTestId()` helper shape as `marketplace-status-bar.component.spec.ts`, same `TestBed.resetTestingModule()` in `afterEach` |
| File sizes within norms | PASS | largest is `bulk-action-bar.component.ts` at 230 lines, far under the repo's 700-line soft cap |
| `statusPresentation()` in the right home | PASS (with a caveat) | co-located pure function matches the local convention (`marketplaceStatusSummary`, `bulkSelectionLabel`); it does pull `lucide-angular` into any future consumer that imports it for the label/tone alone (e.g. a Batch 10 filter), which is unavoidable given `StatusPresentation.icon: LucideIconData` |

## Maintenance debt

- Introduced: six small, fully-tested presentational primitives with no
  store coupling; a documented, scoped size-workaround in
  `target-marks.component.ts` for one CLI provider mark.
- Retired: nothing (net-new files; the batch touches no existing component).
- Net: positive — low coupling, high test coverage (80 tests across 6 specs
  per the executor's report), one named follow-up.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the provider-mark CSS-transform sizing in `target-marks.component.ts` is a workaround around a missing `ProviderMarkComponent` size input; it is documented and low-risk but should not be allowed to become the pattern for a second consumer.
- What a 10/10 version would do differently: give `ProviderMarkComponent` a size input before Batch 9 instead of after it, and import `MARK_TILE_BOX_CLASS` rather than re-deriving `h-6 w-6`.
