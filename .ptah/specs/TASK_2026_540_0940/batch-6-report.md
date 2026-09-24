# Batch 6 Report - TASK_2026_540_0940

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\gateway-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\cron-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\setup-wizard-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\settings-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\marketplace-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\.ptah\specs\TASK_2026_540_0940\batch-6-report.md`

## Tasks 6.1-6.5

Line ranges below refer to the original files; new call lines refer to the completed files.

| Task | File | Removed navigation block -> new call | Imports removed | Comments changed |
| --- | --- | --- | --- | --- |
| 6.1 | gateway-tour.scene.ts | Lines 86-94 -> line 87: `await openConfigSurface(page, director, 'thoth');` | none | Original line 85 now describes entry through the global configuration menu. |
| 6.2 | cron-tour.scene.ts | Lines 63-79 -> line 64: `await openConfigSurface(page, director, 'thoth');` | none | Selector note at original lines 39-40 and navigation doc comment at 59-60 now describe the global configuration menu. |
| 6.3 | setup-wizard-tour.scene.ts | Lines 48-54 -> line 49: `await openConfigSurface(page, director, 'setup-hub');` | none | none |
| 6.4 | settings-tour.scene.ts | Lines 84-89 -> line 85: `await openConfigSurface(page, director, 'settings');` | none | Selector note at original line 32 and navigation doc comment at 80-81 now describe the global configuration menu. |
| 6.5 | marketplace-tour.scene.ts | Lines 96-101 -> line 79: `await openConfigSurface(page, director, 'marketplace');` | none | Selector note at original line 31 and navigation doc comment at 92-93 now describe the global configuration menu. |

Added `import { openConfigSurface } from './_harness/config-menu';` at line 4 in each file. All existing imports remain in use.

Removed Marketplace's now-unused `clickFirstVisible` helper and its doc comment (original lines 68-84). The corresponding helpers in Settings and Setup remain in use and were preserved.

Compared each file with its pre-edit contents held in session memory: all content following the replaced navigation block is unchanged, including every subsequent wait, spotlight and narration beat. Marketplace's hub section-tab selectors at original lines 115 and 136 are unchanged.

## Verification

Command: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`

Result: **PASS**, exit code 0. Typecheck ran successfully; lint passed using existing matching Nx cache output. No retry was needed.

Tailed output:

```text
NX   Running targets typecheck, lint for project ptah-electron-e2e:

- ptah-electron-e2e


√  nx run ptah-electron-e2e:lint  [existing outputs match the cache, left as is]
√  nx run ptah-electron-e2e:typecheck



 NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e

Nx read the output from the cache instead of running the command for 1 out of 2 tasks.

Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/3lF6SJZV9O

  Run duration:      12.9s
  Cache:             1/2 hit (50%)
  Critical path:     12.9s (1 task)
  Recoverable time:  <1ms
```

Failures attributed by file: none. No errors reported in the five Batch 6 scenes or the parallel lane.

Only the five assigned scene files and this report were edited. No git commands were run.

## Open issues

none

## Revision 1

Updated only the `goToGateway` doc comment in `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\gateway-tour.scene.ts` (lines 81-84). It now describes entering Thoth through the global configuration menu via `openConfigSurface` and explicitly states that a missing menu trigger or item fails the scene loudly. No code changed.

Verification: `npx nx run-many -t lint -p ptah-electron-e2e` — **PASS**, exit code 0. Run once; lint executed without a cache hit.

Tailed output:

```text
NX   Running target lint for project ptah-electron-e2e:

- ptah-electron-e2e


√  nx run ptah-electron-e2e:lint



 NX   Successfully ran target lint for project ptah-electron-e2e


Output of 1 successful task was not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/L9fX9rtuuG

  Run duration:      19.0s
  Cache:             0/1 hit (0%)
  Critical path:     19.0s (1 task)
  Recoverable time:  <1ms
```

Only the gateway scene comment and this report were edited for Revision 1. No git commands were run. Open issues: none.

