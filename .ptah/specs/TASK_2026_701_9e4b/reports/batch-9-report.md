# Backend implementation — `TASK_2026_701_9e4b`, batch 9

**Tasks completed**: 9.1 (port status and `propagateWithReport`), 9.2 (Electron pass
outcome, `library:changed` broadcaster, config-home options, mirror sources), 9.3 (VS Code
and CLI refresher adapters and mirror sources). Carry-forward items: agent-sdk barrel types,
Batch 8's interim `.then(() => undefined)` replaced, mirror sources wired in all three hosts.

## Files

Batch-listed:

- MODIFIED `libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts` — new
  `UserLayerRefreshStatus = 'refreshed' | 'failed' | 'skipped'`; `refresh()` returns it;
  `NO_USER_LAYER_REFRESH` returns `'skipped'`.
- MODIFIED `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts` —
  `HarnessPropagationReport {health, userLayer}`; `propagateWithReport(cwd, reason, options)`;
  `propagate` delegates and returns `.health`; `refreshUserLayerInBackground(cwd, reason): void`
  (refresh only, no reconcile, fire-and-forget, logs `failed` and rejections). Never throws: a
  rejecting refresher becomes `'failed'`; a failed reconcile gives `health: null` and keeps the
  refresh status; no workspace gives `{health: null, userLayer: 'skipped'}`.
- MODIFIED `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.spec.ts` —
  default refresher resolves `'refreshed'`; new cases: each report status, `failed` warns and
  still reconciles, rejection → `failed`, skip option → `skipped`, no workspace, reconcile
  failure keeps status, `propagate` equals report health, background refresh (label, no
  reconcile, returns at once, logs failed status and rejection, no workspace).
- MODIFIED `libs/backend/harness-sync/src/lib/di/register.ts` — doc only (`NO_USER_LAYER_REFRESH`
  reports `'skipped'`). The constant itself lives in the port file, so no code change was needed.
- MODIFIED `libs/backend/harness-sync/src/index.ts` — exports `HarnessPropagationReport`,
  `UserLayerRefreshStatus` (types).
- MODIFIED `libs/backend/agent-sdk/src/index.ts` — `type PluginLoaderInitOptions`,
  `type PluginSourceDescriptor` in the plugin-loader.service block.
- MODIFIED `apps/ptah-electron/src/activation/plugin-activation.ts`:
  - `UserLayerStepStatus` (`ok|failed|skipped`), `UserLayerPassStatus` (`updated|failed`),
    `UserLayerPassOutcome = CoalescedOutcome<UserLayerPassStatus>`.
  - `mirrorUserLayer` / `reconcileUserLayer` / `syncSkillRegistryCatalog` keep swallowing and
    return a step status (`'skipped'` for no catalog service; SQLite closed → the pass records
    `'skipped'`).
  - `runUserLayerPass` aggregates (any `failed` → `failed`, else `updated`), broadcasts
    `LIBRARY_CHANGED {workspaceRoot: resolveHarnessWorkspaceRoot(root ?? ''), status, reasons}`,
    returns the status; coalescer typed `<UserLayerPassPayload, UserLayerPassStatus>`.
  - `refreshUserLayer` returns `Promise<UserLayerPassOutcome>` (interim `.then` removed).
  - `createUserLayerRefresher` returns `IUserLayerRefresher`; maps `ran:updated` → `refreshed`,
    `ran:failed`/`threw` → `failed`, `skipped` → `skipped`.
  - `initPluginLoader`: `initialize(pluginsPath, workspaceState, {harnessRootOf:
    resolveHarnessWorkspaceRoot, homeStorage: STATE_STORAGE})`.
  - `buildMirrorSources`: config read and `resolvePluginPaths` for `libraryScopeRoot`
    (harness root); `harnessPluginRoots` = harness roots + skills.sh roots minus
    `disabledPluginIds`; `pluginDescriptors: getPluginSourceDescriptors()`; `libraryScopeRoot`
    set only when a folder is open.
- MODIFIED `apps/ptah-electron/src/activation/plugin-activation.spec.ts` — loader mock gains
  skills.sh roots (one disabled) and descriptors; WEBVIEW_MANAGER mock; expected sources gain
  `libraryScopeRoot`/`pluginDescriptors`/skills.sh root. New cases: harness-root config read
  and scope for a sub-folder; step statuses; success → `updated` + `refreshed` + one
  `library:changed` push with merged reasons; step failure → refresher `failed` + push
  `failed`; catalog failure fails the pass; SQLite closed → `updated`; push carries the harness
  root; no WEBVIEW_MANAGER → requesters still settle; `initPluginLoader` passes
  `harnessRootOf` and the global storage. Updated: three `toBeUndefined` assertions now assert
  the outcome (`'failed'`, `{kind:'ran',result:'failed'}`, `{kind:'skipped'}`).
- CREATED `apps/ptah-electron/src/activation/library-change-broadcaster.ts` —
  `broadcastLibraryChanged(container, payload)`: lazy `TOKENS.WEBVIEW_MANAGER` via
  `isRegistered`, `void` + `.catch`, sync throw caught (pattern of
  `boot-readiness-broadcaster.ts`).
- CREATED `apps/ptah-electron/src/activation/library-change-broadcaster.spec.ts` — push
  payload, no WEBVIEW_MANAGER → no throw and no resolve, sync throw, rejection.
- `apps/ptah-electron/src/di/phase-2-libraries.ts` — left UNCHANGED (see Plan deviations): the
  reader already forwards `workspaceRoot`; its config-home contract is documented in the new
  spec instead.
- CREATED `apps/ptah-electron/src/di/phase-2-libraries.config-home.spec.ts` — the phase-2
  reader case: real `PluginLoaderService` initialized through the real Electron
  `initPluginLoader`, temp repo with `.git`, only `packages/app` registered; reading the harness
  root returns the sub-folder config, imported once into the home record (`origin:
  'imported'`), sub-folder spelling reads the same record, folder record untouched. All writes
  go to in-memory storages and temp dirs.
- MODIFIED `apps/ptah-extension-vscode/src/activation/plugin-activation.ts` — same mirror-source
  fields as Electron; no config-home options; `reconcileUserLayer` returns `boolean`;
  `createUserLayerRefresher` returns `IUserLayerRefresher` and reports `refreshed`/`failed` from
  its own try/catch; never broadcasts.
- MODIFIED `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts` — same mirror-source
  fields; refresher returns `skipped` (no agent-generation), `refreshed`, or `failed` from its
  try/catch (warns through `TOKENS.LOGGER` resolved lazily when registered); signature unchanged.

Outside the batch list (approved by the coordinator, option A, or required to keep specs
compiling):

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation.preview-fidelity.spec.ts`
  — inline refresher stub gains `return 'refreshed';` (port return type). Coordinator-approved.
- MODIFIED `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.spec.ts` — loader mock gains
  `discoverSkillsShPluginPaths`/`getPluginSourceDescriptors` (the new source fields call them);
  `toBeUndefined` → `'skipped'`; new cases: `refreshed`, `failed` + warn, no `libraryScopeRoot`
  without a workspace, skills.sh filtering and descriptors in the sources assertion. Same-shape
  stub fix the coordinator asked for.
- Searched every other spec for the refresher stub shape (`userLayerRefresher`,
  `new HarnessPropagationService`, `createUserLayerRefresher`, `createCliUserLayerRefresher`):
  `blocked-repair.service.spec.ts` uses `NO_USER_LAYER_REFRESH` (no change needed);
  `boot-order.spec.ts` mocks `refreshUserLayer` through `jest.mock` (untyped, no change).

## Stack observed

- tsyringe containers, explicit tokens; hosts wire harness-sync through
  `registerHarnessSyncServices(..., {userLayerRefresher})` (`harness-sync/src/lib/di/register.ts`,
  Electron `di/phase-2-libraries.ts:268`, VS Code `di/phase-2-libraries.ts:244`, CLI
  `cli-engine/src/lib/container.ts:742`).
- Electron activation logs with `console.*` (house style of `plugin-activation.ts`,
  `boot-readiness-broadcaster.ts`); harness-sync/VS Code/CLI use the injected `Logger`.
- Push pattern: `boot-readiness-broadcaster.ts:40-67`. Coalescer contract:
  `coalesced-job.ts:80-160` (Batch 8).
- Degradation-audit grammar: `tools/degradation-audit/check-degradation.ts:1-60,135-142` (a
  catch returning a string literal is `catch-return-sentinel`; a non-empty object literal is
  not, so a marker above one would be orphaned).

## Verification

1. `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/agent-sdk,@ptah-extension/cli-engine,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli`
   (rpc-handlers added per the coordinator).
   - First run: 67 tasks, 65 succeeded, 2 failed: `@ptah-extension/agent-sdk:lint`
     (`session-query-executor.accounts.spec.ts:174,183`, accepted D21) and `ptah-electron:test`
     (`container.smoke.spec.ts` "lane outcomes": it asserts the exact one-line source text of
     `phase-2-libraries.ts:308`, which my prettier pass had rewrapped). Fixed by restoring the
     two lines prettier rewrapped (import of `vscode-lm-tools`, the `MCP_ATTACHMENT_PROBE`
     register); my diff in that file is now the comment only. All new and updated suites
     passed in that run (Electron: 70 suites passed, 1 failed = the smoke case). I then
     reverted `phase-2-libraries.ts` entirely (see Plan deviations).
   - Second run: aborted by the environment (Windows `0xC0000142` / `spawnSync ... EOF`
     process-start failures: agent-sdk spawn specs, and Electron test/typecheck/lint exiting
     with no output); not a code failure.
   - Third run: `NX 67 tasks: 66 succeeded, 60 cached, 1 failed` — the only failure is
     `@ptah-extension/agent-sdk:lint` (accepted D21). Nx flagged the environment-failed tasks of
     run 2 as flaky; all passed here (ptah-electron test/typecheck/lint, agent-sdk test).
2. `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`:
   `NX 55 tasks: 55 succeeded, 50 cached`, exit 0.
3. Degradation audit (`node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node
   --transpile-only tools/degradation-audit/check-degradation.ts`): exit 0;
   `apps/ptah-electron: 2 ok (baseline 4)`, `apps/ptah-extension-vscode: 8 ok (baseline 9)`,
   `libs/backend/cli-engine: 12 ok (baseline 12)`, `libs/backend/harness-sync: 6 ok
   (baseline 6)`, `libs/backend/agent-sdk: 3 ok (baseline 4)`, `libs/backend/rpc-handlers: 1 ok
   (baseline 1)`. The only orphaned marker is the known `session-importer.service.ts:993`
   (Batch 8b out-of-scope note). New `'failed'` returns carry `reported` markers in attach
   zone 2; the propagation reconcile catch lost its marker because it now returns a non-empty
   object (would be orphaned).
4. Electron `container.smoke.spec.ts` unchanged; no new DI token.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A step is `failed` only when it throws; per-file `MirrorResult.errors`/reconcile `errors` stay logged but do not fail the pass | count `errors > 0` as failed | Plan B10 "per-file errors counted in `MirrorResult.errors`, never thrown"; B11 "pass steps keep swallowing errors"; one unreadable file would otherwise show a failed Library forever | yes |
| No folder open → push `library:changed` with `workspaceRoot: ''` (the unscoped Library) | skip the push | Payload requires a string (`payload-map.ts:200`); `resolveHarnessWorkspaceRoot('')` returns `''`; plugin/synth clones still change with no folder | yes |
| skills.sh roots are filtered by `disabledPluginIds`; harness roots stay unfiltered in mirror sources | filter both | Batch 9 carry-forward names skills.sh roots only; A-disabled check: hosts never filtered `harnessPluginRoots` in mirror sources (only the overlay, `plugin-loader.service.ts:1655-1664`), and the reaper keeps clones of a present-but-disabled dir (`user-layer-orphan-reaper.ts:297-305`) | yes |
| `resolvePluginPaths` gets the same `libraryScopeRoot` as the config read | keep active root | `plugin-loader.service.ts` doc at `resolveCurrentPluginPaths`: config and plugin root "travel together on purpose" | yes |
| `initPluginLoader`'s log-only `getWorkspacePluginConfig()` keeps no root | pass harness root | It reads the active folder; with the home active the loader already maps it via `harnessRootOf(active root)` (`plugin-loader.service.ts:933-936`), so the answer is identical | yes |
| `refreshUserLayerInBackground` passes `reason` as the refresh label | host default label | Signature `(cwd, reason)` (plan :611); `plugins:save-config` is not in `GOVERNED_USER_LAYER_REASONS`, so it is never held | yes |
| CLI refresher logs via lazily resolved `TOKENS.LOGGER` | add a `logger` parameter | A parameter changes `cli-engine/src/lib/container.ts:742` (outside the batch); lazy resolution matches how the refresher already resolves the mirror | yes |
| VS Code `reconcileUserLayer` returns `boolean`; `mirrorUserLayer` keeps `UserLayerRoots | null` | status unions as in Electron | Minimal change for D3; `wire-runtime.ts` callers ignore both results | yes |
| The phase-2 reader case lives in a new `phase-2-libraries.config-home.spec.ts` | test inside plugin-activation.spec | No phase-2 spec existed; plugin-activation.spec mocks agent-sdk, so it cannot run the real loader | yes |

## Plan deviations

- `register.ts`: the plan says `NO_USER_LAYER_REFRESH` → `'skipped'` there, but the constant is
  defined in the port file; changed there, `register.ts` got the doc line only.
- `phase-2-libraries.ts` is not modified. A comment there is all the batch allowed, and
  committing any edit to it runs `nx format:write` (lint-staged), which rewraps line 308; the
  unchanged `container.smoke.spec.ts:508` asserts that line's exact one-line text, so the commit
  would break `ptah-electron:test` (observed in verify run 1 after a local prettier pass). The
  reader explanation lives in `phase-2-libraries.config-home.spec.ts`.
- Electron `mirrorUserLayer` no longer returns `UserLayerRoots | null` (its only caller,
  `runUserLayerPass`, ignored it); it returns the step status as the plan requires.

## Out-of-scope observations

- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1453-1468` (doc of
  `discoverSkillsShPluginPaths`) still says skills.sh roots are overlay-only and never reach
  `buildMirrorSources`; that is now false. Doc-only fix needed in a batch that owns the file.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:508` asserts a one-line source string in
  `phase-2-libraries.ts` that prettier rewraps, so any future batch that edits
  `phase-2-libraries.ts` breaks this spec at commit. The assertion should move to a regex.
- `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:170` (mirror catch returning
  `null`) is a pre-existing unmarked site, counted in the baseline.
