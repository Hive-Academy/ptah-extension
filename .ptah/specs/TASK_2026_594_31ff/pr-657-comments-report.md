# PR #657 review comments addressed — TASK_2026_594_31ff

## Comment 1 — progress value range check in `mapStatus`

**File:** `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:145-146` (inside `case 'progress'` / `case 'radial-progress'`)

Old (line 145):

```ts
      if (typeof component.value !== 'number' || !Number.isFinite(component.value)) {
```

New (lines 145-146, continuation style matches the neighbouring `badge` actions check):

```ts
      if (typeof component.value !== 'number' || !Number.isFinite(component.value)
        || component.value < 0 || component.value > 100) {
```

The `TypeError` message stays `'Invalid surface progress value.'`. `mapStatus` now rejects values outside the shared schema's inclusive 0..100 range exactly the way it already rejected non-number / non-finite values, so hostile in-process shapes fail closed into `renderFailed`.

### Regression test added

**File:** `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts:218-236`, inserted directly after the existing `it('fails closed on hostile in-process status nodes', ...)` block.

**Test name:** `fails closed on out-of-range progress values and accepts the 0..100 bounds`

Follows the existing hostile/in-process style exactly (a `hostile: readonly SurfaceComponent[]` array plus the same fail-closed loop over `buildSurfaceViewModel(v2([component]))`):

- `{ id: 'negative', kind: 'progress', value: -5, ... }` → `renderFailed` is `true`, `viewModel` is `null`
- `{ id: 'overflow', kind: 'progress', value: 250, ... }` → rejected the same way as the existing `Number.NaN` case
- `{ id: 'radial-negative', kind: 'radial-progress', value: -5, ... }` → rejected the same way
- `{ id: 'radial-overflow', kind: 'radial-progress', value: 250, ... }` → rejected the same way
- Bounds still accepted: `progress` with `value: 0` and `radial-progress` with `value: 100` project to full nodes (`selectable: false`).

## Comment 2 — `SURFACE_DISPLAY_KINDS` doc comment

**File:** `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:34`

Old:

```ts
/** v2 display vocabulary: the five v1 kinds first, then the six status kinds. */
```

New:

```ts
/** dashboard-catalog/3 display vocabulary: the five v1 kinds first, then the six status kinds. */
```

## Verification

Command (foreground, exit code 0):

```
npx nx run-many -t typecheck,test,lint -p declarative-dashboard shared
```

Summary — all 6 targets passed, no failing lines:

```
NX   Running targets typecheck, test, lint for 2 projects:
- @ptah-extension/declarative-dashboard
- @ptah-extension/shared
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/declarative-dashboard:typecheck
√  nx run @ptah-extension/declarative-dashboard:lint
√  nx run @ptah-extension/declarative-dashboard:test
NX   Successfully ran targets typecheck, test, lint for 2 projects
```

(The trailing "Nx Cloud encountered some problems" note is a FREE-plan/401 cloud-caching notice, not a task failure.)

Only the three named files were touched; no git commands were run.
