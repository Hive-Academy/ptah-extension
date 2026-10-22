# Batch 2 report: enhancement settings keys and raw settings migration

## Task 2.1

- Registered `skills.enhancement.provider`, `.model`, `.timeoutMs`, and `skills.telemetry.enabled` beside the old keys. Defaults are `''`, `'inherit'`, `120000`, and `true`, respectively. The old judge and timeout routes remain registered.
- `PtahFileSettingsManager.loadSync()` flattens the stored JSON, copies each old value only if its new key is absent, and writes the migrated document synchronously through a unique temporary file and rename. It also copies a stored raw `skillSynthesis.triggers.skillInvocationTelemetry.enabled` value to `skills.telemetry.enabled` under the same rule.
- Added specs for routing/defaults, new-key round trips, stored-value migration, independent explicit overrides, restart behavior, absent old values, and warnings that do not reveal malformed input.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\platform-core\src\file-settings-keys.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\platform-core\src\file-settings-manager.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\platform-core\src\file-settings-manager.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\reports\batch-2-report.md`

## Risks and edge cases

- Stored values are detected with own-property checks on the flattened file contents. Registered defaults do not cause a copy or a write. An explicit new value, including `''` or `false`, wins over the old value.
- A successful migration writes all copied keys in one atomic replacement before construction returns. A restart sees the new keys and makes no further migration write. The old keys and values remain available until their later removal batch.
- Read and migration failure warnings contain only the path and an error code. JSON parse errors cannot echo a credential from malformed input.
- The repository's `loadSync`/`set` layout and LF line endings were inspected. Tests, typecheck, build, and Nx were not run, as the orchestrator reserved the project gate.

## Write-path trace

| Key | Scope and value format | Writer | Reader |
| --- | --- | --- | --- |
| `skills.enhancement.provider` | Profile `~/.ptah/settings.json`; string, default `''` | One-time `loadSync` copy from stored `skillSynthesis.judgeProvider`; later `settings:set` | File settings manager now; future `SkillEnhancerService` and Providers row per plan |
| `skills.enhancement.model` | Same profile JSON; string, default `'inherit'` | One-time copy from stored `skillSynthesis.judgeModel`; later `settings:set` | File settings manager now; future `SkillEnhancerService` and Providers row per plan |
| `skills.enhancement.timeoutMs` | Same profile JSON; number in milliseconds, default `120000` | One-time copy from stored `skillSynthesis.enhanceTimeoutMs`; later `settings:set` | File settings manager now; future `SkillEnhancerService` and Providers row per plan |
| `skills.telemetry.enabled` | Same profile JSON; boolean, default `true` | One-time copy from stored raw `skillSynthesis.triggers.skillInvocationTelemetry.enabled`; later `settings:set` | File settings manager now; future reduced `SkillTriggerService` and Library control per plan |

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Copy from the flattened stored JSON, not `get()` | `get()` falls back to defaults; the batch explicitly requires stored values only. Own-property checks preserve explicit new choices. | Yes |
| Persist during `loadSync` using the manager's atomic temp-file pattern | The plan requires a one-time raw-file migration before old routing is removed; `set()` is asynchronous and constructor loading is synchronous. | Yes |
| Include the raw telemetry switch in the same migration | The plan's persisted write-path trace requires this copy; the old raw key is outside file-settings routing. | Yes |

## Fix round 1

- Changed the two migration output reads in `libs/backend/platform-core/src/file-settings-manager.ts` from `parsed.$schema` and `parsed.version` to bracket access (`parsed['$schema']` and `parsed['version']`) because `parsed` is `Record<string, unknown>` and `noPropertyAccessFromIndexSignature` is enabled.
- Reviewed the other Batch 2 edits for the same pattern; no other index-signature dot accesses were found.
- Scoped `ptah_get_diagnostics` reported zero errors, and `npx tsc -p libs/backend/platform-core/tsconfig.lib.json --noEmit` exited 0. Jest/Nx remain with the orchestrator.
