# Implementation Report — TASK_2026_184

## Scope

Fix `KeyboardNavigationService.configure()` to reset `activeIndex` to `0` on every reconfigure (or `-1` when empty) instead of clamping to the last remaining index. Add service spec coverage and a chat wiring test for the live victim. Per the approved plan, `libs/frontend/tasks-ui` workaround is untouched.

## Files changed (absolute paths)

1. `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\shared\keyboard-navigation.service.ts` — modified `configure()` body and updated docblock.
2. `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\shared\keyboard-navigation.service.spec.ts` — rewrote T1/T2, added T3.
3. `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.spec.ts` — created wiring test for `UnifiedSuggestionsDropdownComponent`.

## Exact diff of `configure()`

### Before

```typescript
configure(config: KeyboardNavigationConfig): void {
  this.config = config;
  if (config.itemCount > 0 && this._activeIndex() === -1) {
    this._activeIndex.set(0);
  }
  if (config.itemCount > 0 && this._activeIndex() >= config.itemCount) {
    this._activeIndex.set(config.itemCount - 1);
  }
  if (config.itemCount === 0) {
    this._activeIndex.set(-1);
  }
}
```

### After

```typescript
configure(config: KeyboardNavigationConfig): void {
  this.config = config;
  if (config.itemCount > 0) {
    this._activeIndex.set(0);
  } else {
    this._activeIndex.set(-1);
  }
}
```

The docblock now states:

> Reconfiguring resets the active index to the first item (`0`), or `-1` when the list is empty. A consumer that must preserve a selection across a reconfigure re-applies it with `setActiveIndex()` after `configure()` returns.

## Test totals — baseline vs post-change

| Suite                   | Baseline                            | Post-change                      | Delta                                      |
| ----------------------- | ----------------------------------- | -------------------------------- | ------------------------------------------ |
| `npx nx test ui`        | 15 suites, 273 passed               | 15 suites, 274 passed            | +1 test (T3 added; T1/T2 rewrote in place) |
| `npx nx test chat`      | 49 suites, 651 passed, 2 skipped    | 50 suites, 652 passed, 2 skipped | +1 suite, +1 test (new wiring spec)        |
| `npx nx test chat-ui`   | 18 suites, 79 passed                | 18 suites, 79 passed             | 0 (regression witness)                     |
| `npx nx test tasks-ui`  | 17 suites, 470 passed               | 17 suites, 470 passed            | 0 (regression witness)                     |
| `npx nx typecheck ui`   | green                               | green                            | 0                                          |
| `npx nx typecheck chat` | green (pre-existing NG8102 warning) | green (same warning)             | 0                                          |

All deltas match the plan: `ui` +1, `chat` +1, `chat-ui` and `tasks-ui` unchanged.

## Consumer-audit verification

The plan's section-2 audit identified the real callers of `configure()`. Regression totals confirm no hidden caller broke:

- `unified-suggestions-dropdown.component.ts` — fixed by the shared reset; wiring test covers it.
- `native-autocomplete.component.ts` — covered by the unchanged `ui` suite total (its spec has no clamp-dependent expectations, per audit).
- `task-command-palette.component.ts` — `tasks-ui` total unchanged; the eager `setActiveIndex(0)` after `configure()` remains a no-op under signal equality and was left untouched.
- `effort-selector`, `model-selector`, `agent-selector` — never call `configure()`; `chat-ui` total unchanged.

## Deviations from the plan

1. **Wiring spec implementation details not in the plan's pseudocode.** The plan's section 5 describes the test intent and fixture shape (`N=4 → M=2`) but does not provide exact spec code. To make the host-component test compile and run against the real `SuggestionOptionComponent`, the created spec imports the `File` icon from `lucide-angular` and adds the same `Element.prototype.scrollIntoView` mock used by `native-autocomplete.component.spec.ts`. These are required test harness details, not production changes.
2. **No other deviations.** The `configure()` body, docblock, service spec T1/T2/T3, and the untouched `tasks-ui` palette all match the plan exactly.

## Note on no commit/stash/branch change

No git branch was created, switched, rebased, or stashed. No changes were staged or committed.
