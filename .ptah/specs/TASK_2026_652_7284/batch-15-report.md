# Batch 15 report

## Task 15.1 — Content generation

- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:325,587`: await freshness before reading phase files. Resolve the workspace-relative status directory and the requested directory through storage authorization, and use phase text only when both identify the same fresh run. Otherwise send the formatted gathered context to the prompt and log a safe warning. Freshness lookup failure also falls back; the degradation catch carries the audit marker.
- `libs/backend/agent-generation/src/lib/services/content-generation.service.spec.ts:1670`: prompt-input cases prove stale and missing analysis use gathered context without phase reads. Existing phase prompt cases now provide fresh statuses and still prove phase enrichment, role filtering, truncation, caching, and read failure fallback.

## Task 15.2 — Enhanced prompts

- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:644`: regenerate always attempts workspace discovery, including when there is no analysis reader; forced regeneration still invalidates the cache. Discovery failure retains the existing typed error and does not save a new prompt or report success.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:967`: enrichment uses the registered freshness service and storage path authorization. Explicit and latest paths must match the fresh manifest directory before phase files are read. Stale, missing, unreadable, or mismatched analysis yields no phase enrichment. Removed raw explicit-manifest JSON parsing and kept the degradation catch with an audit marker and a safe logger warning.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts:1144,1261,1420,1469,1500`: cases cover fresh explicit and latest directories, stale and missing analysis discovering the workspace without a phase directory, discovery failure retaining the prior prompt without cache/state writes or success, and forced cache invalidation. Existing trace cases cover the actual phase IDs and destination directory.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts` was not edited; RPC path authorization remains intact.

## Task 15.3 — CLI consumer confirmation

- The prompts, setup, and wizard CLI command specs passed: 3 suites, 33 tests.

## Verification

| Command                                                                                                                                                                                                               | Result                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx prettier --check` on the four changed source/spec files                                                                                                                                                          | PASS: all matched files use Prettier code style.                                                                                                       |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --parallel=1`                                                                                                                                  | PASS: both scoped targets succeeded.                                                                                                                   |
| `npx nx test @ptah-extension/agent-generation --parallel=1 --maxWorkers=2`                                                                                                                                            | PASS after correcting phase-test freshness fixtures: 37 suites passed; 1280 tests passed, 1 skipped. Initial run had 7 fixture failures, all resolved. |
| `npx nx typecheck ptah-cli`                                                                                                                                                                                           | PASS: scoped typecheck succeeded.                                                                                                                      |
| `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/prompts.spec.ts apps/ptah-cli/src/cli/commands/setup.spec.ts apps/ptah-cli/src/cli/commands/wizard.spec.ts --coverage=false --maxWorkers=2` | PASS: 3 suites, 33 tests.                                                                                                                              |
| `npx nx run di-lint:lint`                                                                                                                                                                                             | PASS: 1830 `@inject` sites resolve to registered tokens.                                                                                               |
| Scoped `ptah_get_diagnostics` after edits                                                                                                                                                                             | PASS: 0 errors, 0 warnings.                                                                                                                            |

Nx reported a disabled Nx Cloud organization after successful local targets. Jest printed a worker teardown warning; all requested suites passed.

## Decisions

| Decision                                                                  | Options and evidence                                                                                                                                                                                                                               | Reversible? |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Compare canonical absolute analysis paths                                 | Compared explicit/latest paths with freshness's workspace-relative directory through `AnalysisStorageService.resolveAuthorizedAnalysisDir`, matching the Batch 14 RPC pattern and avoiding a false mismatch. Raw string comparison was unsuitable. | Yes.        |
| Use `findLatestMultiPhaseAnalysis` only after freshness qualifies the run | This preserves the existing reader and its manifest contract while removing raw explicit JSON parsing. Reading an explicit unvalidated manifest was rejected by the batch requirement.                                                             | Yes.        |
| Keep the existing `runWizard` discovery path for regeneration             | It already returns the typed discovery error and saves state only after successful generation; removing the no-analysis hard failure allows that path to run.                                                                                      | Yes.        |

## Not done

None within Batch 15 scope. No files outside the four allowed source/spec files and this report were edited.
