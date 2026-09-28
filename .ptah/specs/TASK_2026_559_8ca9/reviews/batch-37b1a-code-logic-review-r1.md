# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Requested verdict | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Batch 37b1a successfully addresses the runner process-cleanup defect from Batch 37a review r1, and wires the opt-in `go vet` checker into `LanguageAwareDiagnosticsProvider` and `register.ts`. The implementation ensures that `go vet` never runs without stored, current per-workspace consent; process termination is guaranteed by executing `handle.kill('SIGKILL')` in a `finally` block even when process-tree termination fails; failures during checker execution are isolated and cannot compromise Tier 0 syntax or TypeScript diagnostics; and unmapped findings or diagnostics truncation prevent clean "No issues found" answers.

Score justification: Separated from the 9–10 band by an edge-case inconsistency in `LanguageAwareDiagnosticsProvider.ts:684` where all requested Go files are passed to `runGoVet` regardless of `SYNTAX_FILE_CAP`, resulting in files past the 50-file cap being simultaneously vetted and marked as `omittedByCap` in `notChecked`. Separated from the 5–6 band by rigorous consent enforcement, zero unhandled rejection paths, complete failure isolation, verified regression tests, and full test suite passes across platform-core and workspace-intelligence.

## Verification evidence

- Executed Nx run across changed projects: `cmd /c "node_modules\.bin\nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache"`. All 6 tasks passed with exit code 0 (1 skipped suite for hostile tests due to Go not installed on host; 57 test suites passed, 1,765 tests passed, 0 lint errors, 0 typecheck errors).
- Read the entire uncommitted diff of Batch 37b1a across all 7 changed files:
  - `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts`
  - `libs/backend/workspace-intelligence/src/di/register.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/checker-runner.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/checker-runner.spec.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-checker.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
  - `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts`
- Verified consumers of `DiagnosticsCoverageFields` and `mcp-response-formatter.ts` in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`: verified lines 520–548, 833–875, 1168–1212, and 1236–1308. All new fields (`goVet`, `unmappedFindings`, `diagnosticsTruncated`) are already parsed by `checkerLimits` and rendered through `goVetBlocks` and `checkerQualifiers`.

---

## Part 1 — Verification of Batch 37a fixes (commit fe3648eff)

| Finding / Requirement | Status | Evidence & Verification |
| --- | --- | --- |
| **1. File membership accounting:** Only files actually selected by `go vet` are credited; missing, build-tag excluded, `_`/`.`-prefixed, cgo, unreadable files -> `notChecked` with reason | **VERIFIED** | `go-file-membership.ts:220-242` implements `goFileMembership(realFile)` with `scanGoHeader` (handling single, grouped, and named C imports, build constraints `//go:build` and `// +build`), filename constraints (`hasFilenameConstraint` against known OS/Arch list), and size ceiling `MEMBERSHIP_MAX_BYTES` (1 MiB). In `go-vet-checker.ts:469-509` (`planPackages`), files are evaluated with `realpathOrNull` and regular-file check; non-members are placed into `skipped` and excluded from `packages`. In `go-vet-checker.ts:682-697`, only `plan.vetted` entries (files with `membership === 'member'`) can enter `checkedFiles`. Missing files become `not-found`. 10 regression tests in `go-vet-checker.spec.ts` pass. |
| **2. Canonical root containment:** Paths resolved through junctions/symlinks; real path outside consented root refused; `go vet` always runs inside real root | **VERIFIED** | `go-vet-checker.ts:558-565` resolves `rootReal = realpathOrNull(root)`. If unresolvable, fails closed (`root-unresolvable`). In `planPackages` (`:475-478`), each file is checked via `isPathWithinRoots(realFile, [rootReal], platform)`; any outward junction is refused as `outside-root`. In `findModuleDir` (`:480`), search walks up from `realDir` to `rootReal` strictly within canonical boundaries. The child process `cwd` is `moduleDir` (`:635`), guaranteed to reside within the consented real root. 3 regression specs in `go-vet-checker.spec.ts` pass. |
| **3. Unmapped diagnostic positions:** Positions outside root are counted in `unmappedFindings`, result is `findings` not `ok`, affected packages not credited | **VERIFIED** | `go-vet-output.ts:138-144` resolves diagnostic positions through `mapPosition(path.resolve(moduleDir, position.file))`. If outside root, `unmapped` count is incremented per package ID. `go-vet-checker.ts:671-702` maps `unmappedFindings = sum(parsed.unmapped.values())`; if `> 0`, `outcome` is forced to `'findings'`, `reason` is `'unmapped-findings'`, and all requested files in affected packages (`packageDirForId`) are moved to `skippedFiles` as `'unmapped-findings'` and removed from `checkedFiles`. 3 regression specs pass. |

---

## Part 2 — Review of Batch 37b1a

### Five logic questions

#### 1. How does this fail silently?
- **Omitted files vetted past the 50-file syntax cap:** In `language-aware-diagnostics-provider.ts:673-685`, `checked` takes `syntaxFiles.slice(0, SYNTAX_FILE_CAP)` (cap 50) and `omitted` takes files beyond 50. However, line 684 passes the entire uncapped `syntaxFiles.filter(e => e.language === 'go')` to `this.runGoVet`. If 60 Go files are requested within one module, `go vet` executes on all 60 files and reports findings for them, but `LanguageAwareDiagnosticsProvider` simultaneously records files 51–60 in `notChecked` (`OMITTED_TEXT`) and sets `coverage.omittedByCap: 10`. The caller receives diagnostics for files that the summary claims were not checked. (Finding 1).
- **`coverage.clean` is true on syntax success despite `go vet` being off or failing:** In `language-aware-diagnostics-provider.ts:723-753`, `syntax.failures` records only tree-sitter parse/read failures. If a Go file has zero syntax errors, `syntaxAnalyzed` is 1 and `coverage.clean` is computed as `true` by `withCoverageVerdict`, even if `goVet` answered `status: 'unchecked', reason: 'no-consent'` or `status: 'failed', reason: 'timeout'`. While `coverage.checks` is `'syntax-only'` and `mcp-response-formatter.ts` correctly prevents a bare "No issues found" output due to `checkerQualifiers(limits)`, any programmatic consumer inspecting `payload.coverage.clean` alone observes `true`.

#### 2. What user action produces unexpected behaviour?
- Requesting diagnostics on more than 50 Go files in a single scoped request: diagnostics for files beyond 50 are returned, but the files are listed as "Not checked" under `omittedByCap` in the coverage block.
- Requesting diagnostics when `go vet` consent is off: the user might expect `coverage.clean` to be false because vet checks did not run, but `coverage.clean` reflects Tier 0 syntax coverage. The vet restriction is conveyed via `notChecked` and `goVet.reason`.

#### 3. What input data produces a wrong answer?
- A module containing an actual subpackage folder named `*_test` (e.g. `pkg/foo_test` as an independent directory rather than a Go test variant): `packageDirForId` in `go-vet-output.ts:186` strips `_test` from the package ID, causing findings from `pkg/foo_test` to associate with directory `pkg/foo`.
- When the `go vet` checker throws an unexpected error: `runGoVet` catches the error, assigns `reason: 'checker-error'`, marks files in `notChecked`, and omits raw error messages to protect sensitive path details.

#### 4. What happens when a dependency fails?
- **Process tree kill fails on Windows:** In `checker-runner.ts:98-108`, `killTreeOf` executes `handle.kill('SIGKILL')` inside `finally`. If `taskkill` rejects, `killProcessTree` in `process-tree-reaper.ts:63` catches the error, calls `dependencies.onKillError`, and `handle.kill('SIGKILL')` terminates the parent process handle. The error is logged via `deps.logger.info('[Diagnostics] go vet stop failed', { workspaceHash })` without logging paths.
- **Process tree kill fails on POSIX:** `killProcessTree` sends `SIGKILL` to `-pid` (group) then `pid`. `checker-runner.ts` detached spawn ensures process group leadership. In `finally`, `handle.kill('SIGKILL')` terminates the handle.
- **Spawner getter throws or rejects:** `GoVetChecker.check` catches the error at line 611 and returns `failed('failed', 'no-spawner')`.
- **`GoVetChecker.check` throws an unhandled exception:** `LanguageAwareDiagnosticsProvider.runGoVet` wraps the call in `try / catch` (`:837-862`). The exception is captured, `goVet` is assigned `status: 'failed', reason: 'checker-error'`, requested Go files are added to `notChecked` (`GO_VET_ERROR_TEXT`), and TypeScript plus Tier 0 syntax results are returned intact.

#### 5. What is missing that the requirements never mentioned?
- Coordination between Tier 0 syntax cap (`SYNTAX_FILE_CAP = 50`) and Tier 1 `go vet` scope: the plan specified that `go vet` runs on requested Go files alongside syntax checks, but did not define whether `go vet` should be restricted to the files admitted by the syntax cap (`checked`) or allowed to check all requested files.

---

## Failure modes

### 1. Inconsistent coverage and diagnostics when requested Go files exceed `SYNTAX_FILE_CAP`
- **Trigger:** A diagnostics request includes more than 50 Go files within one module.
- **Symptom:** Files 51 to N are vetted by `go vet`, diagnostics for them are included in `diagnostics`, and `goVet.checkedFiles` counts them. Concurrently, `LanguageAwareDiagnosticsProvider` places files 51 to N into `notChecked` with reason `The syntax check covers at most 50 files per call...` and reports `coverage.omittedByCap > 0`.
- **Evidence:** `language-aware-diagnostics-provider.ts:673-674, 682-686, 708-714`.
- **Current handling:** `checked = syntaxFiles.slice(0, 50)` is used for syntax parsing, while `syntaxFiles` (all files) is passed to `this.runGoVet`.
- **Recommendation:** In `LanguageAwareDiagnosticsProvider.ts:684`, pass `checked.filter((entry) => entry.language === 'go').map((entry) => entry.file)` so that only files admitted by the provider's cap are vetted, or omit vetted Go files from the syntax `omitted` list.

### 2. POSIX reaper does not invoke `onError` callback
- **Trigger:** Process-tree termination fails on a POSIX host during timeout or cancellation.
- **Symptom:** The fallback `handle.kill('SIGKILL')` terminates the leader process, but `onKillError` is not called, so no audit log line `[Diagnostics] go vet stop failed` is emitted on POSIX.
- **Evidence:** `libs/backend/platform-core/src/utils/process-tree-reaper.ts:69-79`.
- **Current handling:** POSIX termination swallows `process.kill` errors silently.
- **Recommendation:** Documented in executor report as existing behavior outside this batch; pass `onError` into POSIX error branches in `process-tree-reaper.ts` when platform-core utilities are next updated.

---

## Blocking issues

None established.

---

## Serious issues

None established.

---

## Moderate and minor issues

### 1. Moderate — `runGoVet` receives uncapped `syntaxFiles` instead of `checked`
- **File:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:684`
- **Scenario:** Requesting diagnostics on > 50 Go files.
- **Impact:** Diagnostics are returned for files 51+ while the same files are reported as not-checked (`omitted-by-cap`) in `notChecked` and `coverage.omittedByCap`.
- **Fix (Disposition: carry-to-37b1b):** In `language-aware-diagnostics-provider.ts:684`, pass `checked.filter(e => e.language === 'go').map(e => e.file)` to `runGoVet`.

### 2. Minor — Provider file size exceeds 700-line soft ceiling (925 lines)
- **File:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
- **Scenario:** File expanded with `runGoVet`, `goVetFields`, `mergeByFile` additions (123 new lines).
- **Impact:** Triggers ESLint warning `max-lines` (925 / 700 lines).
- **Fix (Disposition: carry-to-37b1b):** Extract Go vet provider collaboration logic (`mergeByFile`, `goVetFields`, `runGoVet` helper) into `language-aware-go-vet-coordinator.ts`.

---

## Data flow

1. Caller invokes `getDiagnostics(workspaceRoot, { files })` → Validates root and scopes: **OK** (`language-aware-diagnostics-provider.ts:602-632`).
2. Requested files classified into `typeCheckFiles`, `syntaxFiles`, `unsupported`, `unrecognised`, `nonSource`: **OK** (`:634-663`).
3. `typeCheck`, `syntaxCheck(checked)`, and `runGoVet(...)` launched in parallel via `Promise.all`: **GAP** (files > 50 passed to vet, Finding 1) (`:679-686`).
4. `runGoVet` checks consent via `deps.consentStore.read(root, binary)`: **OK** (`go-vet-checker.ts:598-606`).
5. Process spawned with sanitized PATH and allowlisted env; runner wraps execution in tree-kill boundary: **OK** (`go-vet-checker.ts:631-640`, `checker-runner.ts:98-108`).
6. Timeout or abort signal triggers `terminate()` → `killTreeOf` invokes `killTree` and guarantees `handle.kill('SIGKILL')` in `finally`: **OK** (`checker-runner.ts:98-108`).
7. Failure of tree kill invokes `onKillError` → emits fixed-text audit log with `workspaceHash`: **OK** (`go-vet-checker.ts:624-629`).
8. Checker parses JSON output via `parseVetDiagnostics`, maps positions through canonical root, accumulates `unmappedFindings`: **OK** (`go-vet-output.ts:108-171`).
9. `LanguageAwareDiagnosticsProvider` merges `syntax.diagnostics` and `vet.diagnostics` using `mergeByFile` with normalized `/` paths: **OK** (`language-aware-diagnostics-provider.ts:446-463`).
10. `LanguageAwareDiagnosticsProvider` constructs `DiagnosticsResult` with `coverage`, `notChecked`, `goVet`, `unmappedFindings`, and `diagnosticsTruncated`: **OK** (`:788-802`).

---

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Opt-in only; no execution without stored current consent | COMPLETE | Evaluated in `GoVetChecker.check` before spawn; default off in `register.ts`. |
| Process tree termination with fallback to handle kill | COMPLETE | `handle.kill('SIGKILL')` in `finally`; `taskkill` failure calls `onKillError`. |
| Kill failure observability | COMPLETE | Windows `taskkill` failure logged as fixed text `[Diagnostics] go vet stop failed`. |
| Failure isolation | COMPLETE | `runGoVet` catches all throws; TS and syntax diagnostics preserved. |
| Honest coverage (no bare clean on failure/unmapped/truncation) | COMPLETE | `checks: 'syntax-only'`, `unmappedFindings`, `diagnosticsTruncated`, and `goVet` populated. |
| Interface consistency across hosts | COMPLETE | `DiagnosticsCoverageFields` updated in `platform-core`; parsed by `mcp-response-formatter.ts`. |
| Single package cap & file membership rules | COMPLETE | Batch 37a r1 fixes verified; regular files and constraint rules enforced. |

---

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| > 50 Go files requested | PARTIAL | Syntax check caps at 50; `go vet` checks all 60 | Files 51..N reported as both vetted and omitted-by-cap (Finding 1). |
| Process tree killer throws exception | YES | `killTreeOf` catches and ensures `handle.kill('SIGKILL')` in `finally` | None. |
| `taskkill` fails on Windows | YES | `killProcessTree` passes error to `onKillError`; logged with hash | None. |
| Spawner getter throws | YES | `GoVetChecker.check` catches and returns `failed/no-spawner` | None. |
| `GoVetChecker.check` throws | YES | `runGoVet` catches and returns `failed/checker-error`; TS/syntax intact | None. |
| Diagnostic position outside root | YES | Position mapped to null; counted in `unmappedFindings`; outcome `findings` | None. |
| Over 500 diagnostics from vet | YES | Truncated flag set to true; forwarded to provider result | None. |
| Stale consent (`go-changed`, `root-moved`) | YES | Returns `unchecked/consent-stale` with `staleReason`; zero spawns | None. |
| Go file in second `go.mod` | YES | Skipped with `other-module`; first module vetted | None. |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: Requests with > 50 Go files produce contradictory reporting between `goVet` and `coverage.omittedByCap`.
- What a robust implementation would add:
  1. Align `runGoVet` input with `checked` (cap to 50 files) in `language-aware-diagnostics-provider.ts:684`.
  2. Extract Go vet provider coordination into `language-aware-go-vet-coordinator.ts` to reduce `language-aware-diagnostics-provider.ts` below 700 lines.
