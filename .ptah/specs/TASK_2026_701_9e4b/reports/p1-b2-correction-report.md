# P1 B2 correction — legacy clone adoption across installed sources

## Verdict

Fixed. Ambiguity is now judged over every INSTALLED plugin source, disabled ones included. The caller signatures do not change.

## Decisions

- **Decision**: treat the keys of `MirrorSources.pluginDescriptors` as the installed set, combined with the pass's plugin roots. No new "installed sources" input is added.
- **Options considered**:
  1. Add a new `installedPluginPaths` input. Every caller would have to pass it.
  2. Reuse the descriptor map that every host already passes.
  3. Never adopt a legacy clone that has a descriptor. This would break requirement (2).
- **Evidence for option 2**:
  - `PluginLoaderService.getPluginSourceDescriptors()` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:634`) describes every installed source whether enabled or not:
    - all `AVAILABLE_PLUGINS` bundled ids
    - every discovered harness directory, in both global and workspace scope
    - every skills.sh directory
    - every external consent record (`externalPlugins.listInstalled()`)
  - It does not filter on `enabledPluginIds`. Enable state is applied only by `resolvePluginPaths`.
  - All three hosts already pass this map:
    - Electron: `apps/ptah-electron/src/activation/plugin-activation.ts:365`
    - VS Code: `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:114`
    - CLI: `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:101`
  - The only caller without descriptors is `harness-fs.service.ts:176` (`mirrorAll`, harness root only). Without a descriptor, `withSourceIdentity` leaves the sidecar unchanged, so no `sourceRef` can be assigned and no adoption can happen.
- **Reversible**: yes. The change is one internal function and its two call sites. `sharedPluginBasenames` is not exported from the library barrel.

## Change

- `sharedPluginBasenames(pluginPaths, descriptors)` now builds its set from the pass roots plus the described paths. Each path is resolved and de-duplicated, so a path that is both enabled and described counts once.
- A basename shared with a disabled plugin is therefore `ambiguous`. The clone is then kept:
  - no fast-forward
  - no identity backfill
  - no `conflictsWith`
  - the existing "more than one plugin with this directory name" warning is logged (for agents in `mirrorExisting`, and for agents, skills and commands in `ownsForReconcile`)
- Call sites updated:
  - `UserLayerMirrorService.reconcile` (skills and commands)
  - `UserLayerPluginAgents.mirror`
  - `UserLayerPluginAgents.reconcile`
- Doc comments now say "installed (enabled or disabled)" instead of "in this pass".

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-plugin-agents.ts`: `sharedPluginBasenames` takes the descriptors as the installed set; both pass sites pass `pass.descriptors`; docs updated.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`: `reconcile()` passes `sources.pluginDescriptors` to `sharedPluginBasenames`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-plugin-agents.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.plugin-agents.spec.ts`

No changes to agent-sdk, any host caller, rpc-handlers, setup-wizard, shared, or `generation-checkpoint.types.ts`.

## New and changed spec cases

1. Unit, `sharedPluginBasenames counts installed (described) plugins the pass left out`:
   - acme is described but not in the pass, and other is in the pass, so `toolkit` is shared.
   - A path that is both in the pass and described counts once.
2. Service, `a disabled original owner keeps its legacy clone from an enabled same-named plugin` (the regression for this finding).
   - Setup: acme clones the agent and the skill, and the sidecars are aged to legacy. acme is then disabled: `pluginPaths: [other]`, with descriptors for both. The other plugin's upstream changes.
   - `mirrorAll` and `reconcile` give `agentsMirrored 0`, `fastForwarded 0`, `diverged 0` and `noop 0`.
   - The agent and skill bodies are still acme's.
   - Neither sidecar has a `sourceRef`, and the agent sidecar has no `conflictsWith`.
   - The ambiguity warning is logged for `reviewer` and for `audit`.
3. Service, the existing two-order case, single-owner follow-up (changed):
   - Old version: it passed descriptors for both plugins with only acme in the pass. That is the exact defect shape, so it now correctly yields ambiguous.
   - New version: acme is the only installed source (descriptors `{acme}`).
   - Result: `fastForwarded 1` (the agent body becomes `# acme v2`), and both the agent and skill sidecars record `sourceRef: external:acme/repo/toolkit`. This proves single-owner adoption still works.

## Verification

- Command: `npm run verify -- -p @ptah-extension/agent-generation`. Result: `3 tasks: 2 succeeded, 1 failed`.
  - lint passed; typecheck passed.
  - test: 42 of 43 suites and 1294 tests passed (1 skipped).
  - The one failing suite is `src/lib/services/orchestrator.service.spec.ts:2377`, a TS2345 compile error: a `status: string` literal against the new outcome union. This file and `orchestrator.service.ts`/`core.types.ts` belong to the parallel Batch 12 working set. They are not mine and were not touched.
- Changed specs run directly under the lock: `node scripts/verify.mjs --exec --task b2-userlayer-specs -- npx jest -c libs/backend/agent-generation/jest.config.ts --maxWorkers=2 user-layer-plugin-agents.spec user-layer-mirror.service.plugin-agents.spec`. Result: 2 suites passed, 31 tests passed.
- Hosts were not re-run: no host file or public signature changed.
- No new catch blocks were added, so the degradation-audit baseline is unchanged.

## Out-of-scope observations

- `reconcileMissingSidecar` and `reconcileMissingFileSidecar` still mint a sidecar from the first same-basename plugin. This is the earlier, separate note from the fix-round report; it is a different path and was not changed.
- The ambiguity is reported through the logger warning only. There is no counter in `ReconcileResult`. The UI cannot show it today.
