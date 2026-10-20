# Batch 16 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\core\src\lib\services\providers-settings.types.ts:42` — added enhancement key map, state and patch types; patch field at line 101.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\core\src\lib\services\providers-settings-state.service.ts:127` — added enhancement section store and signal; load at line 671, refresh integration at line 225, commit readiness at line 999.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\core\src\lib\services\providers-commit.service.ts:134` — added per-field enhancement write and readback operations.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\core\src\lib\services\providers-settings-state.service.spec.ts:245` — added load and save/readback coverage, including unchanged judging and lanes state; updated mock routing at line 2573.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\core\src\lib\services\providers-commit.service.spec.ts:368` — added direct operation coverage for RPC key and call order.

## Write path trace

`ProvidersSettingsPatch.enhancement.{provider,model,timeoutMs}` → `ProvidersCommitService.operations()` → exact `skills.enhancement.{provider,model,timeoutMs}` keys → `settings:set` → acknowledged write → `settings:get` readBack with strict value comparison → `ProvidersSettingsStateService.refresh()` → `refreshEnhancement()` reads all three keys with `settings:get` → `enhancement` section signal. Blank model picker input persists as `inherit` and loads back as blank, matching the old judging picker convention.

## WRITE-PATH risk and verification

- Each field gets its own `settings:set` and subsequent `settings:get` readback. A failed acknowledgement or mismatched readback cannot count as saved under the existing commit pipeline.
- The new section participates in refresh and post-save readiness, so a failed load cannot appear as a successful fully refreshed save.
- The existing judging and lanes operations and stores were left in place. Specs check their values remain stable and no legacy write RPC runs for an enhancement-only patch.
- Frontend uses literal keys from its own type module; no backend import was added. The strings match `file-settings-keys.ts:296-298`.
- Scoped `ptah_get_diagnostics` found no diagnostics in the five edited files. It reported 100 errors in sibling core files outside this batch. No tests, Nx, Jest, lint, build, or explicit typecheck command was run, per executor instruction. The orchestrator should run project verification.

## Decisions

- **Model representation:** Keep the existing picker convention: blank in frontend state, `inherit` in persisted settings. Options were raw `inherit` in UI state or blank UI state. The judging slice and plan's default inherit meaning support blank UI state. Reversible.
- **Slice shape:** Use `{ provider, model, timeoutMs }` and separate per-key operations. Options were one aggregate object or three file settings keys. The registered keys and `settings:get`/`settings:set` RPC contracts require per-key operations. Reversible.

## Fix round 1

- Defect: The enhancement save spec captured judging and lanes as unloaded (null), then compared them with loaded values after the save refresh.
- Change: Refresh both slices before capturing their prior values; keep the assertions that enhancement-only save makes no legacy write RPC calls. `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:266-270`, `:303-307`.

