# Batch 5 Report - TASK_2026_540_0940

## Files changed

All paths below are relative to `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu`.

- Created `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts`.
- Modified `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts`.
- Modified `apps/ptah-electron-e2e/src/support/ui-driver.ts`.
- Modified `apps/ptah-electron-e2e/src/showcase/thoth-tour.scene.ts`.
- Modified `apps/ptah-electron-e2e/src/showcase/skills-tour.scene.ts`.
- Modified `apps/ptah-electron-e2e/src/showcase/memory-recall.scene.ts`.
- Created `.ptah/specs/TASK_2026_540_0940/batch-5-report.md`.

No `libs/` files were edited. No state-changing git commands were run.

## Tasks 5.1-5.6

Read Batch 5 and plan-review.md implementer instruction 7 before editing. Verified the cited locations on disk: prewarm rules at 15-25, activeNavTitle at 32-38, driver comment/locator at 320-328, goToThoth at 105-126, and goToMemory at 61-78 matched. The Skills reference at 68-70 identifies only part of its candidate list; replaced the complete block at original lines 67-83 while preserving the following waits. References below describe the final files.

### Task 5.1 - Configuration menu helper

`config-menu.ts:4` exports the exact four-member `ConfigSurfaceId` union. `:11` records trigger and item clicks through Director, with a visibility wait between them. `:46` provides guarded raw navigation, bounded waits, swallowed errors, and a boolean result so prewarm can stop when navigation is unavailable. `:65` opens the menu without recording camera beats, reads the visible item carrying `aria-current="true"`, validates its data-test hook, and returns its id or null. Both silent public helpers close any remaining visible menu with Escape in `finally`. Every menu locator uses data-test hooks; none uses labels.

### Task 5.2 - Prewarm and originating-surface restoration

`prewarm.ts:33` checks visibility before reading the selected top-nav title, avoiding an absent-tab attribute wait on configuration surfaces. `:58` keeps prewarmNavSurface available for remaining tabs, updates its documentation, and restores an originating configuration surface when appropriate. `:88` enters Thoth with openConfigSurfaceSilently after capturing both the active tab title and active configuration surface (`:92-94`). Restoration at `:111-115` prefers the captured tab title, then the captured configuration id. Raw actions, guarded navigation, swallowed errors, and navigation-only behavior are retained; settle waits also swallow page-close errors.

### Task 5.3 - Chat tab locator

`ui-driver.ts:320-322` documents Chat as the canvas-grid surface. `:325-326` now uses `getByRole('tab', { name: 'Chat' })` with `[title="Chat"]` as the alternative. No other driver behavior changed.

### Task 5.4 - Thoth tour

`thoth-tour.scene.ts:5` imports the helper. `goToThoth` at `:105` calls openConfigSurface at `:106`; the `#thoth-tab-memory` visibility wait remains at `:109`. Navigation documentation now describes the menu and stable hooks.

### Task 5.5 - Skills tour

`skills-tour.scene.ts:4` imports the helper. `goToSkills` at `:67` enters Thoth through the menu at `:68`. The Skills-tab wait, Director click, and panel wait remain at `:69-73`. Navigation documentation was updated.

### Task 5.6 - Memory recall

`memory-recall.scene.ts:4` imports the helper. `goToMemory` at `:62` enters Thoth through the menu at `:63`. The Memory-tab wait, Director click, and panel wait remain at `:66-69`. Navigation documentation was updated.

## Risks and edge cases

- Silent helpers return false/null when the trigger or items are unavailable, hidden, or fail during interaction. They tolerate an already-open menu and attempt Escape cleanup even after a failure.
- Restoration is best-effort when the original tab or configuration entry disappears. If neither origin can be captured, there is no known surface to restore, matching the existing unknown-origin limitation.
- Scene navigation deliberately propagates failures; subsequent shell/panel waits remain intact.
- Live Electron scene playback and camera output were not executed. Verification below covers the requested scoped static checks and locator audit; runtime review remains separate.
- plan-review.md also mentions chat-code-edit.scene.ts. It is outside this batch's permitted files and was not edited.

## Verification

**PASS** - ran once, exit code 0:

```text
npx nx run-many -t typecheck,lint -p ptah-electron-e2e

 NX   Running targets typecheck, lint for project ptah-electron-e2e:

- ptah-electron-e2e

√  nx run ptah-electron-e2e:lint
√  nx run ptah-electron-e2e:typecheck

 NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e

Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/wdss85UdYV

  Run duration:      9.3s
  Cache:             0/2 hit (0%)
  Critical path:     9.3s (1 task)
  Recoverable time:  <1ms
BATCH5_CHECK_EXIT=0
```

Tailed output retained above (blank lines compacted; command selected the last 40 lines).

**PASS** - `rg -n -e "name: 'Thoth'" -e 'Orchestra Canvas'` against exactly the six TypeScript files listed under Files changed returned no matches (rg exit 1). This also rules out the obsolete Orchestra Canvas tab locators in those files.

**PASS** - `git diff --check -- <six TypeScript paths>` returned no findings (exit 0).

## Open issues

none

## Revision 1

Read `batch-5-internal-review.md` (SERIOUS, failure modes 1/2, and MODERATE) and `batch-5-glm-review.md` (both MINOR findings). Changed only `prewarm.ts`, `config-menu.ts`, and this report. No state-changing git commands were run.

- **SERIOUS / welcome-origin MINOR:** `prewarm.ts:97-101` captures the welcome origin before entering Thoth, requiring a visible `ptah-electron-welcome`, no `.electron-tabs` row, and no captured tab/configuration origin. The selectors were verified in `electron-shell.component.ts:122`, `:188`, and `:209`. `prewarm.ts:123-127` restores that origin through a visibility-guarded raw click on `[data-test="config-back-to-welcome"]`, with a bounded timeout and swallowed errors. The function documentation at `:86-89` limits restoration to tab-row, configuration-surface, and welcome origins; other origins such as setup-wizard and harness-builder remain on Thoth. This supersedes the original report's unknown-origin limitation for welcome screens.
- **Already-open-menu MINOR / failure mode 2:** `config-menu.ts:16-21` now checks the requested item's visibility before recording a trigger click. A visible target is clicked directly, so an open menu is not toggled shut. The silent helper applies the same target check at `:53-59`, retaining guarded raw actions, error swallowing, and Escape cleanup.
- **MODERATE:** `config-menu.ts:68-75` documents that null means either no active configuration surface or failed detection, without changing the return type. `prewarm.ts:88-89` documents null as no captured configuration origin; `:97-101` and `:119-127` use independent welcome detection rather than treating every null result as welcome.

**Verification: PASS.** Ran the requested command once; exit code 0. Tail (last 40 lines, blank lines compacted):

```text
npx nx run-many -t typecheck,lint -p ptah-electron-e2e

 NX   Running targets typecheck, lint for project ptah-electron-e2e:

- ptah-electron-e2e

√  nx run ptah-electron-e2e:lint
√  nx run ptah-electron-e2e:typecheck

 NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e

Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/Sy8yDIMvQy

  Run duration:      5.9s
  Cache:             0/2 hit (0%)
  Critical path:     5.9s (1 task)
  Recoverable time:  <1ms
BATCH5_REVISION1_CHECK_EXIT=0
```

All requested revision fixes are implemented. Live Electron playback was not run. Restoration remains best-effort if the back control disappears or an interaction fails; non-welcome untracked origins remain on Thoth as explicitly requested.
