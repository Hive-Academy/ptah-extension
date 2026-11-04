# PR #924 CI fixes — batch 1

## Items, causes, and fixes

1. **DI lint:** Eighteen class-typed constructor parameters in review-core lacked explicit `@inject`. Added decorators using the concrete class tokens already registered by `registerReviewCore` to the orchestrator and six stage runners. Scanned the other review-core, review-github, and Electron review constructors; no additional missing decorators were identified by DI lint.
2. **Windows spawn guard:** Four `execFileAsync` calls in the Electron review environment and command runner passed a shared options variable. The source guard checks each call expression for `windowsHide`, so it could not see the flag in the variable. Moved the existing options into each call with `windowsHide: true`. The other review child-process `spawn` already has the flag.
3. **Linux artifact writer spec:** The test used `C:\\...` literals, which are relative on Linux. Replaced them with `path.resolve` and `path.join`, preserving checks for a relative root, an absolute root outside `out/`, and a successful write within `out/`. Searched the remaining review-core, review-github, and Electron review specs for hardcoded `C:\\` and `D:\\` paths; found none.

## Files changed

- `libs/backend/review-core/src/lib/review-orchestrator.service.ts`
- `libs/backend/review-core/src/lib/stages/context-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/discovery-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/lens-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/triage-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/verification-stage.runner.ts`
- `libs/backend/review-core/src/lib/lanes/review-artifact.writer.spec.ts`
- `apps/ptah-electron/src/services/review/electron-review-environment.ts`
- `apps/ptah-electron/src/services/review/review-command-runner.ts`

## Verification

- `npx ts-node --transpile-only tools/di-lint/check-injects.ts` exited 0: `di-lint OK: 2012 @inject sites all resolve to a registered token (903 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`.
- `ptah_get_diagnostics` reported no diagnostics in the requested changed files. Its wider project scan reported unrelated sibling errors.
- Nx/npm tests were not run under the task's D26 restriction; the orchestrator handles CI verification.

## Decisions

- Used concrete class tokens for the eighteen decorators because review-core registers those classes as singletons. Token aliases were another option; the existing registration supports direct class injection. Reversible.
- Kept spawn options inline because the source guard examines call arguments. A shared variable had the same runtime effect but failed the guard. Reversible.
