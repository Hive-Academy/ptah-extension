# Batch 8q-2a report

Saved Codex permission level is one helper. The settings record calls it. No verification ran.

## What changed

- Created `codex-saved-permission-level.ts`. `resolveSavedCodexPermissionLevel` is at lines 7-24. It always reads `autopilot.enabled`, then `autopilot.permissionLevel`. When enabled is exactly `true`, it returns `ask`, `plan`, `auto-edit`, or `yolo`, and any other saved level calls `invalidSettings()`. Every other enabled value returns `ask`.
- Created `codex-saved-permission-level.spec.ts` with the cases below.
- Modified `codex-session-settings-record.ts`:
  - Line 11: dropped the unused `PermissionLevel` import.
  - Line 13: imports the helper.
  - Lines 103-105: the inline block (previously about lines 105-118) is `resolveSavedCodexPermissionLevel(read, () => { throw new CodexSessionSettingsError('invalid-settings'); })`.
- `libs/backend/rpc-handlers/src/index.ts` was not edited. Nothing outside this library imports the helper yet.

## Paths

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-saved-permission-level.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-saved-permission-level.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-session-settings-record.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8q-2a-report.md` (this report)

## Spec names

`describe('resolveSavedCodexPermissionLevel')`:

- `returns ask when autopilot.enabled is false` (line 15)
- `returns ask when autopilot.enabled is absent` (line 25)
- `returns ask when autopilot.enabled is the string true` (line 32)
- `returns ask, plan, auto-edit, and yolo when autopilot is enabled` (line 42)
- `throws invalid-settings when autopilot is enabled and the level is missing` (line 54)
- `throws invalid-settings when autopilot is enabled and the level is full-auto` (line 64)
- `reads autopilot.enabled then autopilot.permissionLevel` (line 77) — `false`, absent, the string `'true'`, and enabled `yolo`

`codex-session-settings-record.spec.ts` was not edited.

## Deviations

Error factory, not a one-argument helper. `CodexSessionSettingsError` is defined in `codex-session-settings-record.ts` (line 30). Importing it from the helper while the record imports the helper is a circular import. The class was not moved. The helper takes `invalidSettings: () => never` and does not import the record. The record and the spec pass `() => { throw new CodexSessionSettingsError('invalid-settings'); }`. Callers, including the later Codex profile binding, must pass that factory. The thrown value is still `CodexSessionSettingsError` with code `invalid-settings`.

## Verification

No verification ran. No Jest, Nx, tsc, lint, or diagnostics.

## Fix-up

The helper now reads `autopilot.enabled` and then `autopilot.permissionLevel` on every call, then applies the same rule. That matches the old record, including the Windows-path spec's call list. `invalidSettings: () => never` is unchanged. The spec `reads autopilot.enabled then autopilot.permissionLevel` (line 77) replaces the "level not read when disabled" case and expects both keys in that order. The record file was not edited again. No verification ran.
