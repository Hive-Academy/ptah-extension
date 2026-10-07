# B-P sub-batch P5 — Electron (tray, quit path, embedder warmup gate)

Plan: `pause-switches-plan.md` 3.8, 3.9, row M15, "### P5 — Electron", section 5 row `ptah-electron`.
Executor: backend-developer. No git operations were run.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\services\tray\tray.service.ts`
  - The tray now has two checkboxes, "Pause memory" (`memory.enabled`) and "Pause skills" (`skillSynthesis.enabled`), then a separator and "Quit Ptah".
  - The menu refreshes on a settings-change event and again when the menu is about to open.
  - The tooltip shows which switch is paused.
  - `isKeepAliveRequested()` reads the keep-alive setting live, and `handleWindowAllClosed` now takes a `keepAliveRequested` dependency.
  - The "keep-alive active" log is replaced by a log that states the real keep-alive mode.
  - The file header is rewritten.
  - `PAUSE_ITEM_LABEL` is replaced by `PAUSE_MEMORY_ITEM_LABEL` and `PAUSE_SKILLS_ITEM_LABEL`, and `TRAY_SETTINGS_KEYS` gains `memory.enabled`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\services\tray\tray.service.spec.ts` — rewritten for both checkboxes, refresh, the keep-alive log and the tooltip.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\main.ts`
  - The tray is always created (the `trayKeepalive === true` condition is removed).
  - `window-all-closed` passes `keepAliveRequested`.
  - Comments are updated, and the now-unused `PTAH_CONFIG_SECTION` / `TRAY_KEEPALIVE_KEY` imports are dropped.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\main.quit-path.spec.ts` — the first three groups are rewritten for the new quit matrix. The `will-quit` groups are byte-identical.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\activation\wire-runtime.ts` — adds the exported `isBackgroundLearningPaused()`. `runEmbedderWarmup()` is now exported and gated.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\apps\ptah-electron\src\activation\wire-runtime.spec.ts` — adds the group `runEmbedderWarmup pause gate (TASK_2026_620 M15)`.

## Tray behaviour matrix

The tray is always created. If construction fails, `create()` returns `null`; R10 still holds.

| trayKeepalive (read at close) | Tray          | Last window closed (win32/linux/freebsd)                     | darwin            |
| ----------------------------- | ------------- | ------------------------------------------------------------ | ----------------- |
| off (default)                 | live          | **quits** (same as before C5)                                | stays (unchanged) |
| off                           | none / failed | quits                                                        | stays             |
| on                            | live          | **stays running**; quit through "Quit Ptah"                  | stays             |
| on                            | none / failed | **quits** (R10: the setting alone never suppresses the quit) | stays             |

The two pause switches don't affect quitting; they only drive the menu and the tooltip:

| memory.enabled | skillSynthesis.enabled | "Pause memory" | "Pause skills" | Tooltip                  | Write on click                                                                   |
| -------------- | ---------------------- | -------------- | -------------- | ------------------------ | -------------------------------------------------------------------------------- |
| true           | true                   | unchecked      | unchecked      | `Ptah`                   | —                                                                                |
| false          | true                   | checked        | unchecked      | `Ptah — memory paused`   | memory item → `setConfiguration('ptah','memory.enabled', !checked)` only         |
| true           | false                  | unchecked      | checked        | `Ptah — skills paused`   | skills item → `setConfiguration('ptah','skillSynthesis.enabled', !checked)` only |
| false          | false                  | checked        | checked        | `Ptah — learning paused` | —                                                                                |

- **One key per click.** Each click writes exactly one key through `IWorkspaceProvider.setConfiguration`. Both keys are `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:254, 368`), so the Electron provider routes them to `PtahFileSettingsManager`, which writes `~/.ptah/settings.json` (`electron-workspace-provider.ts:217-226`). No trigger sub-key is written, so the memory switch can't clobber trigger keys.
- **Failed write.** If the write fails, a warning is logged and the menu is force-rebuilt from the persisted value, so the checkbox reverts.
- **Create log** (`tray.service.ts:241-247`):
  - keep-alive off: "Tray created (pause controls); keep-alive off — closing all windows quits"
  - keep-alive on: "… keep-alive on — closing all windows leaves Ptah running"
- **Logger.** Logging goes through the injected `Logger` (`TOKENS.LOGGER`, passed in by `main.ts:328-333`).

## How refresh-on-change is wired

- **Settings-change event.** `PtahTrayService.create()` calls `subscribeToChanges()` (`tray.service.ts:240`). That subscribes to `workspace.onDidChangeConfiguration` (`:305-321`) and filters on `affectsConfiguration('ptah.memory.enabled' | 'ptah.skillSynthesis.enabled')`. This covers every in-process write: Thoth tabs, RPC, and the tray itself.
- **Refresh before open.** `tray.on('mouse-enter' | 'click' | 'right-click')` triggers a refresh (`:323-325`). This catches a value changed by another process, which fires no event. The menu is only rebuilt when the persisted state differs from the last build (`refreshMenu(false)`, `:366-388`). After a click it rebuilds with `refreshMenu(true)` (`:400`), because Electron has already flipped the live checkbox.
- **Disposal.** `destroy()` disposes the subscription (`:296`). The tray listeners are released when the tray is destroyed.
- **Keep-alive read.** Keep-alive is read live at close time through `isKeepAliveRequested()` (`:275`). A failed read returns `false`, so the app quits. The decision itself is at `tray.service.ts:454`: `keepAliveRequested() && hasLiveTray()`. It is wired at `main.ts:382-387`.

## Warmup gate

- `isBackgroundLearningPaused()` is at `apps/ptah-electron/src/activation/wire-runtime.ts:630`. It returns true only when both `memory.enabled` and `skillSynthesis.enabled` are `false`; both default to `true`.
- `runEmbedderWarmup()` checks it at `wire-runtime.ts:657`, before resolving the embedder. When both are paused it logs one `Logger.info` line ("Embedder warmup skipped — memory and skills are both paused") and returns. Otherwise the existing warmup body runs unchanged.
- The arm site `coordinator.armWarmup(() => runEmbedderWarmup(container))` (`:505`) is unchanged.

## Specs that pin each behaviour

| Behaviour (plan section 5)                                                                                                                                                                                                                   | Spec                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Both items render from settings (4 combinations), with order memory, skills, separator, quit                                                                                                                                                 | `tray.service.spec.ts` › `"Pause memory" and "Pause skills" checkboxes`        |
| A click writes the right key and only that key (4 cases)                                                                                                                                                                                     | same group, `"%s" writes ONLY %s`                                              |
| A failed write is logged, the tray stays live, and the checkbox reverts                                                                                                                                                                      | same group                                                                     |
| An external in-process `setConfiguration` refreshes the menu; an unrelated key does not                                                                                                                                                      | `the menu stays current with the persisted switches`                           |
| Refresh on open picks up a value changed with no event (`mouse-enter`, `click`, `right-click`); no rebuild when unchanged                                                                                                                    | same group                                                                     |
| Listener disposed on destroy                                                                                                                                                                                                                 | same group, `disposes the settings listener on destroy`                        |
| Create log matches the keep-alive mode; the old "keep-alive active" line is never logged; keep-alive is read live; a failed read means quit                                                                                                  | `keep-alive mode`                                                              |
| Tooltip for all 4 states, set at creation, follows a toggle                                                                                                                                                                                  | `tray tooltip`                                                                 |
| R10: quit item present in all 4 states and after each toggle; `assertQuitItemPresent` rejections; construction failure returns `null`                                                                                                        | `R10 — the tray menu always carries a usable "Quit Ptah" item`                 |
| `memory.enabled` / `skillSynthesis.enabled` / `trayKeepalive` are file-routed                                                                                                                                                                | `the tray writes keys that are actually routed to the file store`              |
| Quit matrix: no tray → quit; tray + keep-alive false → quit (parity with the pre-C5 oracle on every platform); tray + keep-alive true → stay; darwin → stay; keep-alive and liveness read at close time; keep-alive true with no tray → quit | `main.quit-path.spec.ts` › `parity — …`, `keep-alive — …`, `R10 fail-safe — …` |
| Warmup runs when either switch is on (including defaults) and is skipped, with a log line, only when both are paused                                                                                                                         | `wire-runtime.spec.ts` › `runEmbedderWarmup pause gate (TASK_2026_620 M15)`    |

## Checks (exact lines)

1. `npx nx run-many -t test,typecheck,lint -p ptah-electron --parallel=1` (filtered):
   ```
   Test Suites: 12 failed, 1 skipped, 47 passed, 59 of 60 total
   Tests:       7 failed, 3 skipped, 1026 passed, 1036 total
   libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts(219,5): error TS2322: Type 'IDisposable' is not assignable to type '() => void'.
   libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts(663,26): error TS2339: Property 'restartCurator' does not exist on type 'SkillSynthesisService'.
    NX   Running targets test, typecheck, lint for project ptah-electron and 6 tasks it depends on failed
   ```
   Both TS errors are in P1/P3 files that are still being edited, not in P5 files.
   - The 12 "Test suite failed to run" are ts-jest compile failures from those two errors. Every suite that imports `memory-curator` or `rpc-handlers` fails this way, including `wire-runtime.spec.ts`.
   - The 7 failed tests are `effective Electron shell CSP › …`. They are not on any P5 code path; the evidence is in the section after step 7.
2. P5 specs alone: `npx jest -c apps/ptah-electron/jest.config.ts --maxWorkers=2 <wire-runtime.spec, tray.service.spec, main.quit-path.spec>`:
   ```
   Test Suites: 1 failed, 2 passed, 3 total
   Tests:       78 passed, 78 total
   ```
   The failed suite is `wire-runtime.spec.ts`, blocked by `memory-trigger.service.ts:219` (TS2322). `tray.service.spec.ts` and `main.quit-path.spec.ts` pass.
3. `wire-runtime.spec.ts` with ts-jest `diagnostics: false`, from a temporary config outside the repo (since deleted), to exercise the logic past P1's type error:
   ```
   Tests:       1 failed, 23 passed, 24 total
   ● wire-runtime DI resolution (TASK_2026_127 v2-17) › MemoryTriggerService starts and stops cleanly with all SDK hook-registry deps wired
   ```
   All 7 new M15 tests pass. The one failure starts and stops P1's in-progress `MemoryTriggerService`, the same `:219` defect (it stores an `IDisposable` where a function is called).
4. Typecheck, `npx tsc -p apps/ptah-electron/tsconfig.app.json --noEmit` and `… tsconfig.spec.json --noEmit`: the only errors are the same two lines in `libs/backend/memory-curator` and `libs/backend/rpc-handlers`. **No error in `apps/ptah-electron`.**
5. Lint, `npx eslint <6 changed files>`: `✖ 1 problem (0 errors, 1 warning)`. The warning is `main.ts:126 no-useless-assignment`, which was already there before this change (`sentryService` in `armBootGuards`); exit 0.
6. `npx prettier --check <6 changed files>`: `All matched files use Prettier code style!`
7. `npx nx run degradation-audit:lint`:
   - **First run:** `apps/ptah-electron: 5 FAIL (baseline 4)`. The new site was `apps/ptah-electron/src/services/tray/tray.service.ts:284 [catch-return-sentinel]`, the catch in `isKeepAliveRequested()`.
   - **Fix:** failing soft is correct there, because an unreadable `trayKeepalive` must answer `false` so the app quits (R10). The catch already logged at warn through the injected Logger. I added the marker `// degradation-audit: reported - logged at warn through the injected Logger; …` as the first line of the catch body. The baseline is unchanged.
   - **Re-run:** `apps/ptah-electron: 4 ok (baseline 4)` / `NX   Successfully ran target lint for project degradation-audit`. ESLint and Prettier were re-run after the fix, with the results in steps 5 and 6.

### The 7 "effective Electron shell CSP" failures are not on any P5 code path

`apps/ptah-electron/src/windows/shell-csp.spec.ts` does not import `main.ts`, `tray.service.ts` or `wire-runtime.ts`. Its inputs are:

- `scripts/copy-renderer.js` (`secureRendererHtml`, `:13`)
- `apps/ptah-extension-webview/src/index.html` (`:20-23`)
- `src/windows/fixtures/shell-probe.js` (`:63`)
- `src/windows/permission-policy.ts`, bundled with esbuild (`:66-72`)

It then spawns the real Electron binary on `src/windows/fixtures/shell-security.cjs` (`:84-95`).

- **Imports.** That fixture requires only `electron`, `node:path`, `node:url` and the bundled permission policy. `permission-policy.ts` imports only `electron` types and `zod`; `copy-renderer.js` imports only `fs`, `path` and `node:crypto`.
- **Grep.** A grep for `tray|wire-runtime|main.ts` over the fixtures, `permission-policy.ts` and `copy-renderer.js` returns no match (exit 1).
- **Changed files.** `git status` lists no changed file among those inputs. The only changed files in `apps/ptah-electron` are the six P5 files.
- **Shape of the failure.** All 7 tests depend on one `beforeAll` that launches a real Electron process with a 40 s / 60 s budget. Every test failing together matches that launch failing or timing out while several agents were running suites on the same machine. A P5 assertion failure would look different.
- **Not re-run.** I did not re-run it, because P5 doesn't launch Electron.
- **Leftover directory.** A fixture directory, `apps/ptah-electron/src/windows/.shell-security-QReE6X/`, is still on disk (untracked). That fits an interrupted `beforeAll`/`afterAll`. I left it in place because I can't confirm which run created it.

**Re-run needed:** step 1 once P1 (`memory-trigger.service.ts:219`) and P3/P2 (`restartCurator`) land.

## Deviations

- **Open-time refresh events.** The plan named `click` / `right-click`. I added `mouse-enter` (win32 and darwin, per `electron.d.ts` 44.4.3) so the menu is current before a right-click on Windows. Rebuilds are skipped when nothing changed, so the extra event is cheap. Linux AppIndicator emits no tray events, so there only in-process changes refresh the menu. A Linux external edit stays stale until the next in-process change.
- **Where the keep-alive read lives.** `keepAliveRequested` is a method on the tray service (`isKeepAliveRequested()`), not a separate read in `main.ts`. This keeps `main.ts` branch-free, and a failed read is R10-safe (it means quit).
- **Cleanup after a failed `create()`.** `create()` now destroys a tray that was constructed but failed the quit-item assertion. Before, the icon was left on screen with no menu.
- **`runEmbedderWarmup` exported** so the spec can call it. The arm site is unchanged.

## Out-of-scope observations (not touched)

- `apps/ptah-electron-e2e/src/specs/tray-keepalive.spec.ts:41` and `tray-icon-packaging.spec.ts:64` still mention the old "Tray keep-alive active" log in their doc comments. Their assertions (keep-alive false → quit, true → survive, then tray quit) still match the new behaviour.
- The 7 `effective Electron shell CSP` test failures in the full `ptah-electron` run are not in P5 files.
