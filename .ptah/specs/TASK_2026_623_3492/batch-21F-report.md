# Batch 21F report — remove the dock-port re-export from `src/ptah-ui.ts`

Verdict: DONE. Task 21F.1 is complete, the import-site grep is clean, and typecheck, lint and Jest pass.

## Scope

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\ptah-ui.ts`
- No other file changed. `src/index.ts` was not touched (Batch 23 Task 23.1). batches.md and decisions.md were not edited, and nothing was committed.

## Diff

```diff
@@ -15,20 +15,14 @@
  * Do not re-export anything from this file in `index.ts`.
  *
  * `PTAH_UI_DISPLAY_DOCK` lives in its own eager-light file
- * (`lib/services/ptah-ui-display-dock.ts`, `@angular/core` only). An eager
- * provider must not import it through this entry, which would pull the whole
- * entry into the initial chunk; it needs a main-barrel export of that file,
- * the same way `PTAH_UI_HOST_SOURCES` is exported.
+ * (`lib/services/ptah-ui-display-dock.ts`, `@angular/core` only) and is
+ * deliberately not exported from this entry: an eager provider importing it
+ * here would pull the whole entry into the initial chunk. It needs a
+ * main-barrel export of that file, the same way `PTAH_UI_HOST_SOURCES` is
+ * exported.
  */
 export { PtahUiMessageTextComponent } from './lib/organisms/ptah-ui/ptah-ui-message-text.component';
 export { PtahUiDisplayChipComponent } from './lib/organisms/ptah-ui/ptah-ui-display-chip.component';
-export {
-  PTAH_UI_DISPLAY_DOCK,
-  displayFenceKey,
-  type PtahUiDisplayDock,
-  type PtahUiDisplayFenceState,
-  type PtahUiDisplayFenceStatus,
-} from './lib/services/ptah-ui-display-dock';
 export {
   PtahUiBlockComponent,
   PTAH_UI_BLOCK_PIPELINE,
```

Why the header was reworded: the old text said an eager provider "must not import it through this entry". With the export gone, that wording suggested the port could still be imported through here. The new text says plainly that the entry does not export the port, and it keeps the reason (the initial chunk) and the main-barrel instruction.

## Import-site grep

`grep -rn "PTAH_UI_DISPLAY_DOCK\|displayFenceKey\|PtahUiDisplayFence\|PtahUiDisplayDock" libs apps --include=*.ts` returns 84 hits in 9 files, all of them in `libs/frontend/chat-ui`:

| File | Source of the dock symbols |
| --- | --- |
| `src/display-panel.ts` | comment only, no import |
| `src/ptah-ui.ts` | header comment only (line 17); the export block is gone |
| `src/lib/services/ptah-ui-display-dock.ts` | the file that defines the symbols |
| `lib/organisms/display-panel/display-surface-sync.component.ts` | `'../../services/ptah-ui-display-dock'` |
| `lib/organisms/display-panel/display-surface-sync.component.spec.ts` | `'../../services/ptah-ui-display-dock'` |
| `lib/organisms/display-panel/display-surfaces.ts` | `'../../services/ptah-ui-display-dock'` |
| `lib/organisms/display-panel/display-surfaces.spec.ts` | `'../../services/ptah-ui-display-dock'` |
| `lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts` | `'../../services/ptah-ui-display-dock'` |
| `lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts` | `'../../services/ptah-ui-display-dock'` |

These files import or mock `@ptah-extension/chat-ui/ptah-ui` (`grep -rn "chat-ui/ptah-ui'" libs apps --include=*.ts`). None of them uses a dock symbol:

- `libs/frontend/chat/.../execution/execution-node.component.ts:28` imports `PtahUiMessageTextComponent`.
- `libs/frontend/chat/.../execution/execution-node.ptah-ui.spec.ts:35` imports `PtahUiBlockComponent` and `PtahUiMessageTextComponent`.
- `libs/frontend/chat/.../transcript/chat-transcript.ptah-ui.spec.ts:56` imports `PtahUiBlockComponent`.
- `libs/frontend/chat/.../templates/electron-shell.review-dock.spec.ts:44` is a `jest.mock` that returns only `{ PtahUiMessageTextComponent }`.

Result: no file imports a dock symbol from the `ptah-ui` entry, and no mock of that entry returns one. No other file needed a change.

## Verification

All checks ran in bash from the worktree, one at a time, scoped to `@ptah-extension/chat-ui`.

`npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

```
> nx run @ptah-extension/chat-ui:typecheck
> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json
 NX   Successfully ran target typecheck for project @ptah-extension/chat-ui
```

`npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -n 20`

```
  137:29  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
✖ 10 problems (0 errors, 10 warnings)
 NX   Successfully ran target lint for project @ptah-extension/chat-ui
```

The 10 warnings were already there and none of them is in the changed file. Running `npx eslint libs/frontend/chat-ui/src/ptah-ui.ts` printed nothing and exited 0.

`npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/display-panel libs/frontend/chat-ui/src/lib/organisms/ptah-ui --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}' 2>&1 | tail -n 40`

```
Test Suites: 9 passed, 9 total
Tests:       184 passed, 184 total
Snapshots:   0 total
Time:        11.217 s, estimated 16 s
```

The Nx Cloud "organization disabled (401)" notice was printed after each Nx run. It has no effect on the local result.

## Out of scope

- `git status` shows two untracked files that this batch did not create: `libs/frontend/chat-ui/src/lib/organisms/display-panel/_files.html` and `_tests.html`. I left them alone. The team-leader should decide whether they belong in the 21F commit; they probably do not.
