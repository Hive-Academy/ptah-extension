# Batch 23 report — `diff-renderer` secondary entry and `TextDiffViewComponent`

Executor: frontend-developer. Worktree `task-576-p3` (branch `feat/task-2026-576-p3`). No git operations were run.

## Files

| Change   | Path                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts`                                    |
| CREATED  | `libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.spec.ts`                               |
| CREATED  | `libs/frontend/git-ui/src/diff-renderer.ts`                                                            |
| MODIFIED | `tsconfig.base.json`: added `@ptah-extension/git-ui/diff-renderer` alias                               |
| MODIFIED | `.ptah/specs/TASK_2026_576_e16a/bundle-measurements.md`: added Batch 23 measurements row and section  |

## Implementation Details

1. **`TextDiffViewComponent` (`libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts`)**:
   - Standalone Angular 22 component (`ChangeDetectionStrategy.OnPush`).
   - Inputs:
     - `oldText`: `input<string | null>(null)`
     - `newText`: `input<string | null>(null)`
     - `fileName`: `input<string>('')` (optional file name hint for syntax highlighting)
     - `language`: `input<string>('')` (optional language hint fallback)
     - `themeType`: `input<PierreThemeMode>(readDocumentThemeMode())`
   - Uses Pierre's `parseDiffFromFile` to generate unified diff metadata for in-memory text comparisons.
   - UNIFIED view only (`diffStyle: 'unified'`), word-level diff (`lineDiffType: 'word'`), read-only with no hunk toolbars.
   - Registers Pierre language loaders once via `registerPierreLanguages()`.
   - Imperative `FileDiff` creation and cleanup in `afterRenderEffect`, cleanly disposed on input changes and on component destruction.
   - Theme changes applied in place via `setThemeType(mode)` without re-parsing or destroying the instance.
   - Graceful error state handling: catches parse or render errors and displays a status notice (`[data-testid="text-diff-error"]`).

2. **`TextDiffViewComponent` Unit Tests (`libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.spec.ts`)**:
   - Mocks `@pierre/diffs` replicating Pierre's 1.5.1 `FileDiff` contract and `parseDiffFromFile`.
   - Loads `TextDiffViewComponent` via dynamic `await import('./text-diff-view.component')` to ensure mock application in Jest without hoisting issues.
   - 8 comprehensive test cases covering configuration, input propagation, fallback file naming from language hint, null-input no-op, error rendering, instance disposal on content change, in-place theme change, and destroy cleanup.

3. **Secondary Entry Point `diff-renderer.ts` (`libs/frontend/git-ui/src/diff-renderer.ts`)**:
   - Lightweight barrel exporting:
     - `PierreDiffHostComponent` and `PierreHunkToolbarContext`
     - `TextDiffViewComponent`
     - `PierreDiffStyle` and `PierreThemeMode`
   - Keeps Pierre isolated so that consumers like the Skills drawer (Batch 44) can lazily import `@ptah-extension/git-ui/diff-renderer` without pulling the full `git-ui` barrel or Monaco.

4. **Path Alias in `tsconfig.base.json`**:
   - Added `"@ptah-extension/git-ui/diff-renderer": ["./libs/frontend/git-ui/src/diff-renderer.ts"]` adjacent to the `@ptah-extension/git-ui/services` alias.

## Measurement Method and Numbers

### Eager Webview Bundle
Verified via `npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` (assert mode):
- `main.js`: 1,480,803 B raw, **362,218 B gz** (353.7 KB gz) — identical to Batch 21.
- Eager closure: 3,011,139 B raw, **778,076 B gz** (759.8 KB gz) — identical to Batch 21.
- Assert mode passed: 0 forbidden markers (`ptah-git-`, `ptah-diff-view`) in the eager closure. Pierre is **NOT** in the eager closure.

### Lazy Chunk Measurement (Throwaway Build)
- Method: esbuild browser ESM bundle of `libs/frontend/git-ui/src/diff-renderer.ts` with code splitting, minification, target `es2022`, and externalized `@angular/*` and `@ptah-extension/shared`. Throwaway build created under `D:/tmp/batch23-out`.
- `diff-renderer.js` entry chunk: 472,887 B raw, 136,984 B gz (133.8 KB gz).
- Entry closure (`diff-renderer.js` + helper `chunk-TN3OZQAE.js`): 473,172 B raw, 137,212 B gz (134.0 KB gz).
- First realistic diff (`entry closure` + `typescript` language chunk of 16,067 B gz):
  - Total raw: 654,278 B
  - Total gzip: **153,279 B gz** (~**149.7 KB gz**)
  - Bar / budget: **≤ 217.0 KB gz** (222,208 B gz)
  - **Verdict: PASS** (67.3 KB under budget).

## Verification

| Command | Result |
| ------- | ------ |
| `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui --parallel=1` | **Passed**. Typecheck: 0 errors. Lint: 0 errors. Test: **31 suites, 544 tests passed** (Batch 22 had 30 suites, 536 tests; +1 suite, +8 tests). |
| `npx jest libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.spec.ts --config libs/frontend/git-ui/jest.config.ts` | **Passed**: 1 suite, 8 tests passed in 6.01s. |
| `npx prettier --check libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.spec.ts libs/frontend/git-ui/src/diff-renderer.ts` | **Clean** (0 formatting errors). |
| `npx nx run ptah-extension-webview:verify-eager-bundle --skip-nx-cache` | **Passed**: "no forbidden markers in the eager closure". `main.js` 362,218 B gz, closure 778,076 B gz. |

## Deviations

None. All files implemented according to plan and specification. Throwaway measurement artifacts were strictly placed under `D:/tmp`.

## Out-of-scope observations

None.
