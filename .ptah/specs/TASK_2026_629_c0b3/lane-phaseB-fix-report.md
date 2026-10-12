# Phase B fix report

| Finding | Status                                                                                                                                                                             | File:line                                                                                                                                      | Test                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1      | Fixed: running tabs use `claudeSessionId ?? tab.id`; unresolved agent parents still count for no session.                                                                          | `libs/frontend/canvas/src/lib/canvas-running-cap.ts:22`, `libs/frontend/canvas/src/lib/canvas.store.ts:160`                                    | `canvas-running-cap.spec.ts:90` covers two fresh tabs and binding; existing unresolved-parent spec remains.                                           |
| M2      | Fixed: the running cap reads deduplicated tile IDs from every workspace.                                                                                                           | `libs/frontend/canvas/src/lib/canvas.store.ts:151`                                                                                             | `canvas.store.spec.ts:149` covers 5 running in A and 4 in B, with the cap reached in either workspace.                                                |
| M4      | Fixed: `respondLane` returns `true` when posted and `false` when skipped; a skipped queue answer clears its answering key. The posting exception still releases the request guard. | `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:20`, `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts:162` | `agent-permission-responder.spec.ts:65` covers the return values; `canvas-needs-you-queue.component.spec.ts:168` covers re-emitted answered requests. |

## Checks

All checks ran with `--parallel=1 --skip-nx-cache`; tests also used `--coverage=false --maxWorkers=2`.

| Command                                                                                                                                               | Result                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npx nx test @ptah-extension/canvas --testFile=canvas-running-cap.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`               | Passed: 5 tests.                                                                 |
| `npx nx test @ptah-extension/canvas --testFile=canvas.store.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`                     | Passed: 17 tests.                                                                |
| `npx nx test @ptah-extension/canvas --testFile=canvas-needs-you-queue.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Passed: 5 tests.                                                                 |
| `npx nx test @ptah-extension/chat --testFile=agent-permission-responder.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`         | Passed: 4 tests.                                                                 |
| `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`                                                                                | Passed; one NG8107 warning in unchanged `peer-session-send-dialog.component.ts`. |
| `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`                                                                                     | Passed; 3 warnings in unchanged `canvas-tile.component.spec.ts`.                 |
| `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`                                                                                  | Passed; same NG8107 warning.                                                     |
| `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`                                                                                       | Passed; 36 warnings in unchanged files.                                          |

## Open items

M3 and the Minor findings remain recorded in `decisions.md` row 18 and were outside this fix round. No requested check failed.

The scoped `ptah_get_diagnostics` call was unavailable after its 45-second timeout; both project typecheck targets above passed independently.
