# Code Logic Review — `TASK_2026_510_eb26`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

The committed implementation fixes both packaging regressions and has direct
runtime evidence. Electron Builder and `app-builder-lib` are pinned to stable
v26 release 26.16.1, whose retry and copy-and-delete recovery completed after
the reproducible Windows EPERM. The adapted better-sqlite3 v13 path forces the
source target, promotes its output over the binary selected by the v13 loader,
and tests that binary with a real query under Electron 44.

The clean `package-local-production` target passed all 15 tasks. Its final
artifact is `Ptah-Local-c24b6e4cf8a5-0.1.70.exe` (515,559,708 bytes,
SHA-256 `629CA0E0E9B8930A8C4DA7411795A828393B78A499C6629346230E505B1FF687`).
The complete evidence is recorded at
`.ptah/specs/TASK_2026_510_eb26/test-report.md:3`.

## Five logic questions

### 1. How does this fail silently?

No silent-success path was found. The native rebuild uses synchronous child
execution, so a compile failure throws before packaging
(`apps/ptah-electron/scripts/rebuild-native.js:145`). It also refuses a
successful rebuild command that did not create the expected output
(`apps/ptah-electron/scripts/rebuild-native.js:185`). The packed verifier
requires both an exact hash match and a successful Electron SQLite query; it
collects every mismatch or load failure and exits nonzero
(`apps/ptah-electron/scripts/verify-packed-native.js:330`).

Postinstall remains deliberately best-effort, but the explicit package target
depends on `rebuild-native` and therefore uses the fail-loud branch
(`apps/ptah-electron/project.json:386`,
`apps/ptah-electron/scripts/rebuild-native.js:275`).

### 2. What user action produces unexpected behaviour?

Packaging while Windows Search temporarily retains the extracted locale tree
previously produced EPERM
(`.ptah/specs/TASK_2026_510_eb26/context.md:9`). With 26.16.1, the same action
retries five times and then copies and deletes the directory; the diagnostic
and final clean runs both produced the expected installer
(`.ptah/specs/TASK_2026_510_eb26/context.md:17`,
`.ptah/specs/TASK_2026_510_eb26/test-report.md:29`).

### 3. What input data produces a wrong answer?

No wrong-answer input was found. Dependency resolution cannot silently return to
26.15.3 because the manifest pin is exact (`package.json:257`) and the test
asserts the manifest, root lock declaration, `electron-builder`, and
`app-builder-lib` entries
(`apps/ptah-electron/src/config/local-production-build.spec.ts:31`).

For native selection, platform and architecture determine the v13 prebuild path
(`apps/ptah-electron/scripts/rebuild-native.js:82`). The packed verifier
derives the same relative path from the rebuilt runtime binary instead of
assuming the legacy `build/Release` layout
(`apps/ptah-electron/scripts/verify-packed-native.js:318`).

### 4. What happens when a dependency fails?

- A missing Electron or rebuild CLI fails before compilation
  (`apps/ptah-electron/scripts/rebuild-native.js:62`,
  `apps/ptah-electron/scripts/rebuild-native.js:136`).
- A skipped better-sqlite3 source target fails before promotion
  (`apps/ptah-electron/scripts/rebuild-native.js:185`).
- A wrong packed binary fails the exact-hash check
  (`apps/ptah-electron/scripts/verify-packed-native.js:341`).
- A binary that has the right bytes but cannot load or query under Electron is
  still rejected
  (`apps/ptah-electron/scripts/verify-packed-native.js:343`).
- A missing or unusable `@parcel/watcher` fails its require/subscribe/
  unsubscribe gate
  (`apps/ptah-electron/scripts/verify-packed-native.js:264`).
- If Builder's retry and copy fallback both fail, Builder exits nonzero and the
  sequential Nx target stops before reporting later gates as passed
  (`apps/ptah-electron/project.json:389`).

### 5. What is missing that the requirements never mentioned?

No missing behavioral requirement was found. The implementation also verifies
the native dependency with actual operations rather than relying on file
presence: SQLite executes `SELECT 42`
(`apps/ptah-electron/scripts/verify-packed-native.js:144`) and the watcher
subscribes to a real temporary directory
(`apps/ptah-electron/scripts/verify-packed-native.js:257`).

## Failure modes

No material failure mode remained after reviewing the complete files and the
clean packaging evidence. The review covered:

- exact Builder manifest and lock resolution;
- both normal and local-production Nx package command chains;
- better-sqlite3 forced source compilation and v13 loader-path promotion;
- source and packed Electron SQLite probes;
- packed binary equality;
- `@parcel/watcher` lifecycle;
- tree-sitter WASM, ONNX, and unsigned executable policy gates.

Residual uncertainty is limited to platforms not exercised by this Windows
local-production artifact. The code derives native paths from the host platform
and architecture, while the normal release matrix remains responsible for its
macOS and Linux package runs.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None.

## Data flow

1. npm reads exact Builder 26.16.1 from `package.json:257` — **OK**.
2. The lock resolves `electron-builder` and `app-builder-lib` 26.16.1 — **OK**, guarded by `apps/ptah-electron/src/config/local-production-build.spec.ts:31`.
3. Nx runs build, renderer copy, and native rebuild before packaging — **OK**, `apps/ptah-electron/project.json:383`.
4. Native rebuild sets `npm_config_force_build=1` — **OK**, `apps/ptah-electron/scripts/rebuild-native.js:78`.
5. The compiled addon is copied to the v13 loader-selected prebuild path — **OK**, `apps/ptah-electron/scripts/rebuild-native.js:192`.
6. Electron loads that source build and executes SQLite before packaging — **OK**, `apps/ptah-electron/scripts/rebuild-native.js:261`.
7. Builder recovers from the Windows rename EPERM and creates NSIS — **OK**, `.ptah/specs/TASK_2026_510_eb26/context.md:17`.
8. The verifier locates the packed v13 runtime path and requires exact source/packed hash equality — **OK**, `apps/ptah-electron/scripts/verify-packed-native.js:318`.
9. Electron loads the packed package and executes SQLite — **OK**, `apps/ptah-electron/scripts/verify-packed-native.js:341`.
10. Watcher, WASM, ONNX, and executable-policy gates pass — **OK**, `.ptah/specs/TASK_2026_510_eb26/test-report.md:19`.

## Requirements fulfilment

| Requirement                              | Status   | Gap                                                                                                    |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Deterministic newest stable v26          | COMPLETE | Exact 26.16.1 manifest and lock pins.                                                                  |
| No silent drift to stale npm `latest`    | COMPLETE | Four version boundaries are asserted.                                                                  |
| Local-production packaging tests pass    | COMPLETE | Both focused suites passed uncached, 8/8.                                                              |
| Complete unsigned installer passes gates | COMPLETE | Clean 15-task package and every runtime/policy gate passed.                                            |
| Pre-existing TypeSafe edits restored     | COMPLETE | Final task evidence was recorded without production-file drift outside the two implementation commits. |

Implicit requirements not addressed: none.

## Edge cases

| Case                                      | Handled | How                                                     | Concern                                |
| ----------------------------------------- | ------- | ------------------------------------------------------- | -------------------------------------- |
| Windows EPERM survives all rename retries | YES     | Builder 26.16.1 falls back to copy-and-delete.          | Adds retry delay before recovery.      |
| v13 npm prebuild masks source output      | YES     | Forced build is promoted over the loader-selected path. | None found.                            |
| Source build silently emits no addon      | YES     | Promotion checks file existence and throws.             | None.                                  |
| Packed binary differs from source rebuild | YES     | Exact SHA-256 equality is mandatory.                    | None.                                  |
| N-API binary has no legacy ABI marker     | YES     | Real Electron query proves runtime compatibility.       | Correctly reports the marker as N-API. |
| Packed addon loads but is unusable        | YES     | Real SQLite query must return 42.                       | None.                                  |
| Watcher loads but hangs on first watch    | YES     | Subscribe and unsubscribe are bounded and exercised.    | None.                                  |
| Repeated/fresh packaging                  | YES     | Target is uncached and the clean committed run passed.  | None.                                  |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Future Electron, Builder, or better-sqlite3 upgrades must preserve the forced source-build and loader-path contract.
- What a robust implementation would add: no change required for this task; keep the focused tests and all post-pack gates mandatory in future dependency upgrades.
