| Project | Target | Result (PASS/FAIL) | Evidence (Nx summary line or test counts) |
| --- | --- | --- | --- |
| @ptah-extension/core | typecheck | PASS | `√ nx run @ptah-extension/core:typecheck` |
| @ptah-extension/core | lint | PASS | `√ nx run @ptah-extension/core:lint [existing outputs match the cache, left as is]` |
| @ptah-extension/core | test | PASS | `√ nx run @ptah-extension/core:test [existing outputs match the cache, left as is]` |
| ptah-electron-e2e | typecheck | PASS | `√ nx run ptah-electron-e2e:typecheck` |
| ptah-electron-e2e | lint | PASS | `√ nx run ptah-electron-e2e:lint` |
| @ptah-extension/webview-e2e-harness | typecheck | PASS | `√ nx run @ptah-extension/webview-e2e-harness:typecheck` |
| @ptah-extension/webview-e2e-harness | lint | PASS | `√ nx run @ptah-extension/webview-e2e-harness:lint` |

## Failures

None.

## Decisions

1. Accepted Nx cached results for core lint and test. The core run reported `Successfully ran targets typecheck, lint, test for project @ptah-extension/core`.
2. Confirmed the second run's header said `Running targets typecheck, lint for 2 projects` and its summary reported success.
3. Nx Cloud reported a disabled organization (code 401) after both successful runs; it did not change either command's exit code.
