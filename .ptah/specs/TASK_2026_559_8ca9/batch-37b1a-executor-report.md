# Batch 37b1a executor report: runner kill fix and provider wiring (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base fe3648eff
(Batch 37a). No git command changed state. The tree is left dirty for the team leader.

`WI` = `libs/backend/workspace-intelligence/src`, `PC` = `libs/backend/platform-core/src`.

## Files

| Status   | File                                                            | Change                                                                                                                  |
| -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| MODIFIED | `WI/diagnostics/external-checkers/checker-runner.ts`            | `handle.kill` now runs in a `finally` after the tree kill. The default `killProcessTree` call receives `onKillError` as its error callback |
| MODIFIED | `WI/diagnostics/external-checkers/checker-runner.spec.ts`       | 2 FB cases (rejecting terminator; default-helper failure); `killProcessTree` is mocked so no real kill is sent          |
| MODIFIED | `WI/diagnostics/external-checkers/go-vet-checker.ts`            | `timeout`/`too-large` text now says "a stop was requested" instead of "was stopped". The default run passes `onKillError`, which logs a fixed-text line (`[Diagnostics] go vet stop failed`, `workspaceHash` only) |
| MODIFIED | `PC/interfaces/diagnostics-provider.interface.ts`               | `DiagnosticsCoverageFields` gains optional `unmappedFindings`, `diagnosticsTruncated` and `goVet` (`GoVetRunReport`: status, outcome, fixed `reason` code, `staleReason`, `checkedFiles`) |
| MODIFIED | `WI/diagnostics/language-aware-diagnostics-provider.ts`         | Optional 5th constructor argument `goVet` (`Pick<GoVetChecker,'check'>`). Requested Go files go to vet in parallel with the syntax and TypeScript checks. The results are merged as listed below |
| MODIFIED | `WI/diagnostics/language-aware-diagnostics-provider.spec.ts`    | 6 go vet cases plus 1 registration case, and one extra assertion in the existing registration case                     |
| MODIFIED | `WI/di/register.ts`                                             | `registerTypeScriptDiagnosticsProvider(container, logger, { getProcessSpawner? })`: when the getter is passed, the call builds the store and checker and attaches them |

## Task 37b1a.1: cleanup failure (37a r1 finding 4)

- `killTreeOf` wraps the pid wait and the tree kill in `try`, and `handle.kill('SIGKILL')` runs in `finally`. A tree
  kill that rejects still kills the handle, and the rejection still reaches `onKillError`.
- By default the runner calls `killProcessTree(pid, 'SIGKILL', dependencies.onKillError)`. The helper's own catch,
  which swallows a failed `taskkill` (`PC/utils/process-tree-reaper.ts:63`), now reports the failure to the caller.
- Fixed wording: the answer comes back before the tree is confirmed gone, so the timeout and overflow texts say "a stop
  was requested". The go vet checker observes kill failures through its audit logger and never logs the error text.
  POSIX group-kill failures are still best effort, because the helper has no error path there. That is outside this
  batch.

## Task 37b1a.2: checker attached to the provider

- **Denied by default, and nothing runs without current consent.** The checker is attached only when the host passes
  `getProcessSpawner`. Neither host passes it yet; that is Batch 37b1d. The consent store is
  `new GoVetConsentStore(container WORKSPACE_STATE_STORAGE, { userDataPath: PLATFORM_INFO.globalStoragePath })`. The
  checker reads consent once per run, before any spawn (37a). The spawner is a lazy getter (O2 §2).
- **O2 §1.2 assumption confirmed.** Electron sets `globalStoragePath: options.userDataPath`
  (`libs/backend/platform-electron/src/registration.ts:103`) from the same `options` that phase 1 gives
  `WorkspaceAwareStateStorage`/`WorkspaceContextManager` (`apps/ptah-electron/src/di/container.ts:41-42`,
  `phase-0-platform.ts:46`, `phase-1-infra.ts:128,154`). The CLI takes one `userDataPath`
  (`libs/backend/cli-engine/src/lib/container.ts:357`) for the platform options (`:365` →
  `libs/backend/platform-cli/src/registration.ts:59`) and for the workspace storage (`:448`, `:462`). The two paths are
  equal, so the path is read from `PLATFORM_INFO`.
- **Tier 0 is kept.** Every requested Go file is still syntax-checked. Vet findings (warnings) are merged into the
  same file entry. Paths are normalised to `/`.
- **Coverage.** `GO_VET_COVERAGE.approximations` (`go:syntax-only`) is merged in when vet checked any file. Vet counts
  on the syntax side of `checks`, so it is never a type-check claim. The disjoint file counts are unchanged: Go files
  are counted once, by the syntax check.
- **Forwarding.** The vet run is forwarded as follows:
  - `goVet` carries the status, the outcome, the checker's fixed reason code (every `GoVetReason`, including the r1
    six) and `staleReason` (Decision 25 `go-changed`).
  - The checker's `notChecked` groups, with their fixed text, are appended to the provider's.
  - `unmappedFindings` is set only when above 0, and `diagnosticsTruncated` only when true.
  - These fields are forwarded on both the `available` and the `unavailable` answer.
- **Failure isolation.** `runGoVet` never rejects. A checker throw becomes `goVet` `failed/checker-error`, and every
  requested Go file is listed under `notChecked` with fixed text. The TypeScript and syntax results are unchanged and
  no error text is forwarded. The catch carries a `degradation-audit: reported` marker.
- **Unmapped findings are never a clean answer.** When `unmappedFindings > 0`, the answer carries the count and the
  `goVet` reason `unmapped-findings`. The files of the affected packages are listed under `notChecked`.
- **Interface change: 6 files, 2 libs, as the batch allows.** `notChecked` is file groups with free text, and no
  coverage field can carry a findings count, a truncation flag or the fixed reason codes. The 37b1b formatter spec
  ("payload with `unmappedFindings: 2`") needs them as structured fields. `GoVetRunReport` is exported from the
  interface file but not from the barrel. The provider types it as `NonNullable<DiagnosticsCoverageFields['goVet']>`,
  so `PC/index.ts` is unchanged.

## FB evidence (fails on fe3648eff, passes after)

| Check | Result |
| --- | --- |
| New runner spec run against `git show fe3648eff:…/checker-runner.ts` (the new spec file was kept) | **2 failed**, 13 passed. Restored: 15 passed |
| Provider spec run against the fe3648eff provider, `register.ts` and interface | Suite fails to compile (no 5th argument, no `goVet`/`unmappedFindings` fields). Restored: passes |
| Mutation A: the provider ignores the checker (`runGoVet` always returns `undefined`, as on the base) | **6 failed** / 7 go vet cases (consent-off FB, stale, unmapped FB, throw FB, merge, and the registration attach case). The "no Go requested" case passes |
| Mutation B: a checker throw propagates (no catch) | **1 failed**: "a go vet checker that throws leaves the TypeScript and syntax results intact" |

The FB cases named by the batch are:

- "FB: the checker does not run without consent". It uses a real `GoVetChecker` whose binary resolves and whose
  consent is off. Expected: 1 consent read, 0 `getSpawner` calls, 0 runs, `goVet` `unchecked/no-consent`, and the Go
  file in `notChecked` with the fixed text. `coverage` stays `analyzed: 1`, `syntax-only`, `go:syntax-only`.
- "FB: an unmapped-findings result is never a clean answer".
- "FB: a go vet checker that throws leaves the TypeScript and syntax results intact".
- Registration case: the host passes a getter and the storage is empty. Expected: the getter is never called, and
  `goVet` is `unchecked` (`no-go-binary` on this machine; `no-consent` where Go is installed).

## Verification (tail only)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache --parallel=2`
  gave "Successfully ran targets test, lint, typecheck for 2 projects" (6 tasks).
- ESLint on the changed files reports 0 errors and 1 warning: `max-lines` in `language-aware-diagnostics-provider.ts`
  (925 lines against a limit of 700). The file was already over the limit at 802 on the base, so this is the same
  warning, not a new one. See the notes.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` succeeded for both projects.
- `nx run ptah-electron:validate-deps --skip-nx-cache` printed "All external imports are covered by package.json
  dependencies".
- `nx run degradation-audit:lint --skip-nx-cache` printed "TOTAL 300 unsuppressed site(s)". workspace-intelligence has
  1 (baseline 1) and platform-core has 7 (baseline 7).
- **Hostile spec: SKIPPED.** Printed reason: "no `go` binary resolves from the sanitised PATH on this machine". Its 8
  cases were not run.
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged; `git status` lists only the 7 files above.
- No new `as any` or `@ts-ignore`. Every new catch uses `catch (error: unknown)`. The fixtures contain no import
  shapes. Every mkdtemp root, including the user-data directories, is removed in `afterEach`.

## Deviations and notes

1. **`go-vet-checker.ts` was edited, although only the runner files are listed for 37b1a.1.** The task requires the
   checker's "stopped" wording to be fixed. Wiring the observer into the production run is what makes a default
   `taskkill` failure observable at all.
2. **The provider file grew by 123 code lines.** It was already over the `max-lines` warning (a warning, not an error).
   I kept the vet adaptation in the provider (`runGoVet`, `goVetFields`, `mergeByFile`) to stay inside the batch's file
   list. Moving it to a sibling module is a candidate if the review asks for it.
3. **Unscoped calls do not run vet.** It runs only on requested files, as in 37a. The census still names Go files
   `unchecked`, with the hint to pass `files`.
4. **`coverage.clean` can still be true when vet is off.** The syntax check did cover the Go file, and the go vet
   limitation is carried by `notChecked` and `goVet`. The 37b1b formatter must render the §5.4 line from `goVet.reason`
   / `staleReason` and treat `unmappedFindings`/`diagnosticsTruncated` as named limitations.
5. **For 37b1d.** Hosts call `registerTypeScriptDiagnosticsProvider(container, logger, { getProcessSpawner: () =>
   container.resolve(SDK_TOKENS.SDK_PROCESS_SPAWNER) })`. A wiring spec can assert that `goVet` is present on a Go
   answer. Without the option, `goVet` is absent, and the extended registration spec proves that.

## Fix round (review r1)

Review: `reviews/batch-37b1a-code-logic-review-r1.md` (APPROVE 8/10). Per User Decision 24, the 37b1c review verifies
this round. No git commands were run. The vscode-lm-tools and agent-sdk changes in this worktree belong to the 37b1b
agent; this round did not touch them.

### Files

| Status   | File                                                          | Change                                                                                                   |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| MODIFIED | `WI/diagnostics/language-aware-diagnostics-provider.ts`       | Only the capped `checked` Go files go to vet. Vet findings in an `omittedByCap` file are dropped (compared by path identity, so win32 case-folds) |
| MODIFIED | `WI/diagnostics/language-aware-diagnostics-provider.spec.ts`  | Regression case "60 Go files: go vet receives exactly the 50 admitted files…"                            |
| MODIFIED | `PC/utils/process-tree-reaper.ts`                              | On POSIX, a pid kill that fails with anything other than ESRCH is now reported to `onError`, as the win32 path already did |
| MODIFIED | `PC/utils/process-tree-reaper.spec.ts`                         | Two cases: EPERM reaches `onError`; ESRCH (already exited) is not reported                                |

### Moderate 1: the syntax cap and vet scope agree

Vet now receives only the Go files in `checked`, the first `SYNTAX_FILE_CAP` files. One case needed a second change:
vet reports every file of a package it vets. An omitted file in the same package as an admitted one could therefore
still carry findings. `mergeByFile` drops those findings, so an `omittedByCap` file carries no result and stays named
in `notChecked` with "request these in another call". Coverage and `notChecked` stay consistent: analyzed 50,
omittedByCap 10.

FB evidence (each fix undone in turn, then restored):

- Vet given every requested Go file (the pre-fix code): the regression case fails (1 failed).
- Vet given the capped files, but the omitted-file filter removed: the regression case fails (1 failed).
- Both fixes in place: the regression case passes.

### Failure mode 2: the POSIX reaper did not call `onError`

This was a small change in `process-tree-reaper.ts`, so it is fixed here rather than carried to 37b1c. When both the
group kill and the single-pid kill throw, a non-ESRCH error (EPERM: the process may still be alive) goes to `onError`.
ESRCH means the process has already exited, which is the goal, so it is still treated as success. Against the HEAD
reaper, the EPERM spec fails (1 failed of 8); with the fix, all 8 pass. POSIX still does not confirm that the process
has terminated, which is why the checker text says "a stop was requested".

### Verification (tail)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache --parallel=2`
  gave "Successfully ran targets test, lint, typecheck for 2 projects".
- `nx run degradation-audit:lint --skip-nx-cache` gave "TOTAL 300". platform-core has 7 (baseline 7) and
  workspace-intelligence has 1 (baseline 1).
- Not addressed in this round: the Minor `max-lines` extraction, which the review carried to a later batch, and the
  `packageDirForId` `_test` directory observation.
