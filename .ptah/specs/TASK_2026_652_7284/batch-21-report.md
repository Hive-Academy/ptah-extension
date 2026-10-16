# Batch 21 report

## Task 21.1

- `libs/backend/agent-generation/src/lib/services/wizard/analysis-run-checkpoint.ts:52`: `open` now takes the injected logger, tries to archive a primary v3 run, and selects the `--v4` fallback after an archive error. Its warning includes the archive directory when available. Resume checks a current primary run, then a current fallback run, with model and lifecycle checks. Fresh creation uses the selected variant and leaves the v3 directory untouched.
- `analysis-run-checkpoint.ts:62`: fingerprint errors warn and produce a random SHA-256 digest, allowing analysis to proceed without a fingerprint that could match a later freshness check.
- `analysis-run-checkpoint.ts:192`: completed output verification uses `hashFileOrNull`. One-line public method documentation and the model-pinning rationale were restored.

## Task 21.2

- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:134`: session error classes now set `name` in constructors and remain private to the module.
- `multi-phase-analysis.service.ts:258`: prompt and prior-phase hashes use `sha256Hex` and `hashFileOrNull`.
- `multi-phase-analysis.service.ts:438`: the outer error path best-effort pauses an open running checkpoint, logs a pause failure, and preserves the original error.
- `multi-phase-analysis.service.ts:554,585,629`: both completion sites use `completeOrFailPhase`; missing SDK session IDs and hashing or completion errors become failed phase checkpoints. There is no non-null assertion on the session ID.
- `multi-phase-analysis.service.spec.ts:393`: the missing-session case asserts the phase is failed with the required message.
- `multi-phase-analysis.service.spec.ts:929`: archive failure warns, preserves the v3 manifest bytes and phase file, and runs a new v4 analysis in `demo--v4`; the logged `slugDir` and persisted manifest identify that folder.
- `multi-phase-analysis.service.spec.ts:977`: a paused fallback run resumes with its prior run ID.
- `multi-phase-analysis.service.spec.ts:1002`: fingerprint failure still executes the phases and logs a warning.
- `multi-phase-analysis.service.spec.ts:1018`: a hash read error after a phase result marks that phase failed with the error text and the run lifecycle failed.

## Task 21.3

- `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts:105`: removed the `MultiPhaseManifestSchema` alias; the v3 and v4 schemas remain for direct internal consumers.
- `libs/backend/agent-generation/src/lib/types/index.ts:39`: removed the alias and the unused `MultiPhaseManifestV3Schema`, `MultiPhaseManifestV4Schema`, `PhaseResultV4`, and `MultiPhaseManifestV3` barrel exports.
- Grep evidence: `rg -n 'MultiPhaseManifestSchema' . -g '*.ts'` returned no matches. `rg -n 'MultiPhaseManifestV3Schema|MultiPhaseManifestV4Schema|PhaseResultV4|MultiPhaseManifestV3' apps libs -g '*.ts'` found internal direct `multi-phase.types.ts` imports and shared RPC declarations, with no import of these names through `../types`, `./lib/types`, or `@ptah-extension/agent-generation`; the search covered both `apps/` and `libs/`.

## Verification

| Command                                                                                                                    | Result                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npx prettier --check` on the five scoped files                                                                            | PASS: All matched files use Prettier code style.                                         |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`                                       | PASS: both targets succeeded.                                                            |
| `npx nx test @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`                                                 | PASS after correcting the archive warning assertion: 1,274 passed, 1 skipped, 37 suites. |
| `npx nx typecheck @ptah-extension/rpc-handlers`                                                                            | PASS: target succeeded.                                                                  |
| `npx nx typecheck ptah-cli`                                                                                                | PASS: exit code 0.                                                                       |
| `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/analyze.spec.ts --coverage=false --maxWorkers=2` | PASS: 6 tests.                                                                           |
| `ptah_get_diagnostics` scoped to five changed files                                                                        | PASS: 0 errors, 0 warnings.                                                              |
| Targeted Jest run after final fallback-path assertion                                                                      | PASS: 1 passed, 34 skipped.                                                              |

Nx Cloud reported its organization quota warning after successful Nx targets; local target results were successful.

## Decisions

| Decision                                                                                                | Options                                                  | Evidence                                                                                                              | Reversible                                        |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Preserve primary v3 bytes and use the storage service's `legacy-fallback` variant after archive errors. | Abort analysis; overwrite primary; use fallback.         | Batch 21.1 contract and the existing `getRunDir`/`createSlugDir` variant.                                             | Yes, by changing `open` and its regression cases. |
| Hash a random UUID on fingerprint failure.                                                              | Abort analysis; fixed digest; random digest.             | Batch 21.1 requires a `sha256-v1` digest that cannot qualify as fresh later.                                          | Yes.                                              |
| Convert completion errors to failed phase checkpoints in one helper.                                    | Duplicate handling at both sites; shared private helper. | Both completion sites have the same session/hash/persistence contract; tests cover hash failure and missing identity. | Yes.                                              |

## Not done

- No work outside the five assigned source files and this report. No commits or workspace-wide checks.
