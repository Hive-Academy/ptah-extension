# Batch C report — TASK_2026_523_c3df

Shared picker extensions and vendor marks in `libs/frontend/ui`.

## Files changed

MODIFIED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-picker.component.ts` — the six extensions added; guard and sentinel kept.

MODIFIED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-picker.component.spec.ts` — new describe blocks for the six extensions.

MODIFIED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-model-picker\index.ts` — exports the new `ProviderIdentityOption` type.

MODIFIED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\index.ts` — added `export * from './provider-mark';`.

CREATED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-mark.component.ts` — new presentational mark component.

CREATED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-marks.data.ts` — the inlined, sanitized mark table.

CREATED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\index.ts` — barrel.

CREATED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-mark.component.spec.ts` — component pins.

CREATED `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\provider-mark\provider-marks.data.spec.ts` — table and sanitation pins.

Nothing outside `libs/frontend/ui` was touched. No git command ran.

## Picker API

The one existing `ProviderModelPickerComponent` gained six extensions. All arrive as inputs or public methods — the source-scan test still pins exactly one `inject()` call, `PROVIDER_MODELS_LOADER`.

- `fixedProvider = input<string>('')` — non-empty replaces the provider select with static text (`provider-model-picker-fixed-provider` testid). The name resolves from the registry; an unknown id renders raw. Every emission and every catalogue load points at the fixed id. It wins over `provider` when both are set.
- `extraProviders = input<readonly ProviderIdentityOption[]>([])` — new exported interface `{ id, name }`. Appended after the merged registry, deduped by id with the registry winning.
- `disabled = input<boolean>(false)` — disables both selects and the Retry button, and removes the manual-entry disclosure.
- `refreshCatalog(): void` — re-runs `loadModels(_provider())`. The error row now renders a `provider-model-picker-retry` button wired to it.
- `refreshProviders(): void` — bumps an internal registry-version signal. The provider list moved from a plain readonly array to a `computed` that also reads this signal, because `getAllAnthropicProviders()` is module-global mutable state and not signal-tracked.
- Arbitrary model entry — a native `details`/`summary` disclosure (`provider-model-picker-manual-entry`) with an input and a `Use model ID` button. It requires a pinned provider, trims the draft, pins it, and emits. The entered id renders through the existing not-in-catalog display.
- A trailing `<ng-content />` slot takes a host-rendered scope row at the end of the picker's section.

Preserved, per the brief:

- The stale-load `loadGeneration` guard is intact and untouched (`provider-model-picker.component.ts`, `loadModels`).
- The not-in-catalog display for a pinned unknown id is kept and now also covers manually entered ids: it renders as `` `<id>` · not in current catalog `` via a new `modelOptions` computed, with the `[value]`-on-select plus `[selected]`-on-options pairing intact.

## Sentinel

**The picker still emits `''` for inherit. It does NOT emit `'inherit'`.** `resolveJudgeModel` (model-resolver.ts:171) matches only the literal `'inherit'`; the translation from `''` to `'inherit'` stays owned at the binding by `ProvidersSettingsStateService` in a later batch. The sentinel option label, the `''` option value, and the `providerId || undefined` loader contract are all unchanged. The fixed-provider mode emits the fixed id verbatim, and the manual entry emits the typed id verbatim — both are model ids, never the sentinel.

## Verification

All commands ran in the repo root on branch `feat/task-2026-523-providers-auth`. No `nx test A B` form was used.

1. `npx nx run-many -t typecheck -p @ptah-extension/ui` — first run failed: `TS2339 Property 'push' does not exist on type 'readonly ProviderOption[]'` (my own annotation). Fixed the annotation; final run: `Successfully ran target typecheck for project @ptah-extension/ui`.
2. `npx nx run-many -t lint -p @ptah-extension/ui` — first run failed with 2 errors (`no-useless-escape` in the data spec, `component-selector` prefix in the spec host component) and 2 warnings (`no-non-null-assertion` in the mark spec). Fixed all four; final run: `Successfully ran target lint for project @ptah-extension/ui`.
3. `npx nx run-many -t test -p @ptah-extension/ui` — final run: `Test Suites: 20 passed, 20 total` / `Tests: 378 passed, 378 total`, including `dependency-boundaries.spec.ts` (the `type:ui` tag, the `['type:ui','type:util']` constraint list, and the no-`@ptah-extension/core` pin all ran green inside that suite).

Earlier failing runs were fixed by: jsdom has no `SVGPathElement` global (test rewritten to a null check), a source-scan test caught its own doc comment mentioning the forbidden binding (comment reworded), a disabled apply button needed a change-detection pass before `.click()` (test now runs `detectChanges` first), the slot assertion targeted the wrong element, and the Retry button now also honors `disabled()` with a matching test.

## Deviations

- `providerOptions` changed from a plain readonly array built once at construction to a `computed` that re-reads the merged registry on `refreshProviders()`. The observable behavior for every existing consumer is unchanged; this was the only way to make "refresh a changed registry" possible without a second inject.
- Retry is its own button next to the error text, not a link inside it. The design spec names a retry affordance but no exact element; I used a `btn btn-ghost btn-sm min-h-9 text-base-content` tertiary button per the spec's button tokens.
- The mark table pins three lucide records (`anthropic` → Bot, `claude-cli` → Terminal, `lm-studio` → Server). Decision 10 lists these ids as fallback consumers; pinning them in the table keeps the fallback choice in the data, not in host guesswork. Hosts can still steer unknown ids with the `fallback` input.
- All six path marks are hand-authored simplified monochrome stroke marks on a 24-grid. Decision 10 accepts that they can drift from a vendor's current mark; nothing here detects drift. Licensing review is batch D2/G territory and was not done here.
- The lucide fallback glyphs (Bot, Server, Terminal) are hand-inlined as stroke paths in the component file, because `libs/frontend/ui` has no lucide dependency and `type:ui` cannot pull a new dependency without justification. Lucide is ISC-licensed; rect/line/polyline primitives were converted to path data by hand.

## Not done

- No consumer wiring: nothing imports the new exports yet, by scope. Batch D mounts them.
- No `''` → `'inherit'` translation anywhere. Owned by a later batch.
- No licensing review of the vendor marks. Batch G owns the release gate.
- `git status` shows the new `provider-mark/` directory and my two modified picker files plus two barrels; nothing was staged or committed.
