# Electron Canvas E2E Fix Notes — TASK_2026_442

## Files changed

- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
  - Scoped the singleton layout assertion to `[data-testid="canvas-dock"]` and the exact dynamic label so it cannot match a tile's `tile-layout-trigger`.
  - Made the first drag cross decisively into the next row. The previous pointer endpoint sometimes remained in the original row, making the real Gridstack gesture flaky before the resize assertion ran.
  - Changed the east-handle resize from an approximately one-unit shrink to an approximately two-unit shrink. This lands the six-unit tile at the four-unit `third` snap point; its auto neighbour fills the remaining eight units.
  - Replaced the removed 1/2/3-column assertions with the three dock preset buttons under the `Layout presets` group.
  - Scoped the multi-tile dock trigger to `[data-testid="canvas-dock"]` with the exact `Layout options` accessible name.
  - Added locked/unlocked assertions for all four per-tile span actions reached through `data-testid="tile-layout-trigger"`.
  - Preserved the lock-during-drag cancellation check and the final gesture commit count of `3`: accepted drag, accepted resize, accepted drag. The lock-cancelled gesture commits nothing.

## Related-suite selector scan

Searched TypeScript and HTML under:

- `apps/ptah-electron-e2e`
- `apps/ptah-extension-vscode-e2e`
- `libs/frontend/webview-e2e-harness`

No additional references to 1/2/3-column buttons, `getByRole('button', { name: /Layout/ })`, or ambiguous `Layout options` selectors remain. The only remaining exact `Layout options` lookup is scoped to the canvas dock.

## Verification

Electron e2e did run locally on Windows.

Final command:

```text
npx nx run ptah-electron-e2e:e2e -- --grep "Canvas" --reporter=line
```

Final result lines:

```text
10 passed (3.2m)
NX   Successfully ran target e2e for project ptah-electron-e2e and 2 tasks it depends on
EXIT_CODE=0
```

The requested grep selected 10 tests across six spec files, including all five tests in `canvas/canvas.spec.ts`.

An intermediate repeat exposed the original first-drag endpoint as flaky before the resize step:

```text
1 failed
9 passed (3.0m)
EXIT_CODE=1
```

Failure detail: the expected first drag geometry `['0', '0', '6']` remained `['0', '0', '0']`. After moving the pointer decisively beyond the first row, the full requested grep passed as shown above.

Lint command:

```text
npx nx lint ptah-electron-e2e
```

Lint result lines:

```text
✖ 9 problems (0 errors, 9 warnings)
NX   Successfully ran target lint for project ptah-electron-e2e
```

All nine warnings are pre-existing and outside `canvas.spec.ts`: two non-null assertions in `git/hunk-revert-top-layer.spec.ts`, four unused eslint-disable directives in `tasks/tasks-list-visual.spec.ts`, and three empty fixture arrow functions. No lint error was reported.

