# Batch B1b settings report

## Files changed

- `libs/shared/src/lib/types/advanced-settings.types.ts`
- `libs/shared/src/lib/types/advanced-settings.types.spec.ts`
- `libs/backend/platform-core/src/file-settings-keys.ts`
- `libs/backend/platform-core/src/file-settings-keys.spec.ts`

## Implementation

Added the `notifications` advanced-settings group and two live boolean descriptors:

| Key | Label | Description | Default |
| --- | --- | --- | --- |
| `notifications.hostEnabled` | Host notifications | Shows OS or VS Code notifications for requests that need your attention. | `true` |
| `notifications.failureHostEnabled` | Failure notifications | Shows OS or VS Code notifications when a task fails. | `false` |

Both keys are explicitly in `FILE_BASED_SETTINGS_KEYS`; `FILE_BASED_SETTINGS_DEFAULTS` derives their values from the shared descriptor table. The guard specs pin the keys and defaults. A file-store test writes both preferences, reopens the settings manager, and confirms the values survive restart.

## Verification

- Shared spec: 85 passed, 85 total; exit 0.
- Platform-core spec: 296 passed, 296 total; exit 0.
- Scoped `ptah_get_diagnostics` after formatting: 0 errors, 0 warnings.
- Both requested `jest.config.ts` paths exist. Each spec ran serially with `--coverage=false --maxWorkers=2`.

## Decisions

- Added a dedicated `notifications` group. Existing advanced settings are grouped by feature, and the two preferences form a distinct feature. Reversible by changing descriptor group assignments.
- Used `apply: 'live'` for both preferences, as the plan says setting changes stop new host notices. Reversible by editing the descriptors.
- Did not add a session-title setting: binding decision #21 says titles are always included in issued host notices.

## Not done

None within B1b. Host adapters and their behavior belong to other batches.
