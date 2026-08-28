# Cross-vendor review — TASK_2026_314

Date: 2026-08-28
Reviewer: `codex` CLI agent (independent, no shared context)
Test runner: `ollama cloud` Ptah CLI agent (independent)
Orchestrated from the Ptah session as Round 1, Batch B.

## Verdict

**PASS.** No findings.

## What the fix actually did

The task asked, at minimum, for a WARN when `PERSISTENCE_TOKENS.SQLITE_CONNECTION`
is absent at subscribe time, and ideally for the ordering to become structural.
The shipped change took the structural option. `startTaskSpecsIndex` now defers
through tsyringe `afterResolution(..., { frequency: 'Once' })`, so the SQLite
upgrade arms itself when the token appears, whatever the registration order.

The host ordering requirement is therefore removed, not merely documented.

## Evidence

| Claim                                                                                     | Evidence                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Absent token defers instead of returning silently                                         | `libs/backend/task-specs/src/lib/di/start-index.ts:194-208`                                                                          |
| The deferred hook cannot fire twice                                                       | `node_modules/tsyringe/dist/cjs/dependency-container.js:135-144` removes once-only interceptors after resolution                     |
| A disposed hook creates no live subscription                                              | `libs/backend/task-specs/src/lib/di/start-index.ts:175-185`, `:216-222`                                                              |
| Late registration, pre-open arming, reopen, disposal and permanent absence are all pinned | `libs/backend/task-specs/src/lib/di/start-index.spec.ts:307-375`                                                                     |
| The required comment update landed                                                        | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:96-102`                                                                      |
| Existing host ordering is unchanged and still correct                                     | `apps/ptah-electron/src/di/phase-2-libraries.ts:297-332`, `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:81-130` |

One residual note from the reviewer, rated non-blocking: when the token is never
registered, the deferred closure stays inert in the container until the container
is collected. It holds no subscription and does no work.

## Verification

`@ptah-extension/task-specs` — 16/16 suites, 445/468 tests, 0 failed, 23 skipped.
`typecheck` passed.

## Test gap recorded (not blocking)

`libs/backend/task-specs/src/lib/di/start-index.spec.ts` should resolve a
late-registered `SQLITE_CONNECTION` twice and assert `openSubscriberCount()`
stays exactly one. The once-only guarantee currently rests on reading the
tsyringe source rather than on a Ptah test.

## Outcome

Status moved `in_review` → `done`.
