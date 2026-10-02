# Batch 8 — Cross-Platform real-git CI Job (`TASK_2026_576_e16a`)

- **Author**: in-process subagent (`devops-engineer`)
- **Reviewer**: CLI lane (`antigravity`), cross-side
- **Round**: 1
- **Score**: 9/10
- **Verdict**: APPROVED

---

## Round 1 recheck

### Finding Status

| Finding ID | Finding Description                                                                                                        | Original Severity | Status in Round 1 | Evidence / Verification                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BLK-1**  | `--testPathPattern` singular ignored by `@nx/jest`, causing all 166 suites across `vscode-core` and `ptah-electron` to run | Blocking          | **RESOLVED**      | [`.github/workflows/ci.yml:355, 357, 363, 365`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L355-L365): `--testPathPatterns=real-git` applied across all four invocations. Verified locally via `--listTests`: `@ptah-extension/vscode-core` selects exactly 4 suites (`git-info.service.paths`, `diff-config`, `hooks`, `write-lock.real-git.spec.ts`), `ptah-electron` selects exactly 1 suite (`git-watcher.real-git.spec.ts`). |
| **SER-1**  | `node_modules` cache key identical to `main` job on `ubuntu-latest`, causing race/collision                                | Serious           | **RESOLVED**      | [`.github/workflows/ci.yml:279`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L279): Cache key changed to `node-modules-realgit-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`. Uniquely namespaced per job.                                                                                                                                                                                                               |
| **MOD-1**  | `passWithNoTests: true` in `ptah-electron` risks silent pass on zero test matches                                          | Moderate          | **RESOLVED**      | [`.github/workflows/ci.yml:355, 357, 363, 365`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L355-L365): `--passWithNoTests=false` passed explicitly to both projects. Verified locally: non-matching pattern exits code 1 with `No tests found, exiting with code 1`.                                                                                                                                                              |
| **MOD-2**  | Runner global `init.defaultBranch main` could mask auto-detection bugs                                                     | Moderate          | **RESOLVED**      | [`.github/workflows/ci.yml:247-257`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L247-L257): Comment expanded documenting scoping to `git-real-git` runner and noting all current real-git specs pin their branch explicitly.                                                                                                                                                                                                      |

### Regressions or New Findings

None. YAML syntax parsed cleanly with `js-yaml`. No side effects or regressions introduced.

---

## Round 0 Review Summary (Baseline)

| Metric              | Value                             |
| ------------------- | --------------------------------- |
| Overall score       | 5/10                              |
| Assessment          | NEEDS_REVISION (CHANGES_REQUIRED) |
| Blocking issues     | 1                                 |
| Serious issues      | 1                                 |
| Moderate issues     | 2                                 |
| Failure modes found | 3                                 |

The Batch 8 change in `.github/workflows/ci.yml` introduces a new cross-platform matrix job `git-real-git` targeting `ubuntu-latest`, `windows-latest`, and `macos-latest` to provide CI evidence for Requirement 1.7 (RC5 watcher) and Requirement 1.5/1.6 (RC4/RC7 path encoding and diff configuration). While the workflow structure, matrix definition, shell defaults, and YAML syntax are well formed, there is a **critical blocker** in the test runner invocation: `@nx/jest:jest` does not recognize `--testPathPattern` (singular), causing Jest to fall back to its default empty pattern array and execute **all 47 test suites** in `@ptah-extension/vscode-core` and **all 119 suites** in `ptah-electron` instead of only the `*.real-git.spec.ts` suites. Additionally, the `node_modules` cache key collides directly with the concurrent `main` job on `ubuntu-latest`.

---

## Five Logic Questions

### 1. How does this fail silently — where does a failure produce a success-looking result?

- **`passWithNoTests: true` in `ptah-electron`** ([`apps/ptah-electron/project.json:436`](file:///D:/projects/ptah-extension/apps/ptah-electron/project.json#L436)): `ptah-electron` has `passWithNoTests: true` configured in its project target options. If a pattern matches zero test files (due to a typo, regex mismatch, or file relocation), Jest exits with status `0`. The CI step reports green even though no real-git tests were executed. _(Resolved in Round 1 via `--passWithNoTests=false`)_.
- **Unscoped `node_modules` cache key race on `ubuntu-latest`** ([`.github/workflows/ci.yml:261`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L261)): The step comment claims the cache is "scoped to this job so it does not race the main job's save of the identical key on ubuntu-latest", but line 261 uses `key: node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`, which is byte-for-byte identical to the `main` job at line 69. Concurrent runs on Ubuntu race to write this key; the runner logs a cache save warning or overrides the cache, masking dependency inconsistencies between jobs. _(Resolved in Round 1 via `node-modules-realgit-...`)_.

### 2. What user action produces unexpected behaviour?

- **Pushing a commit that touches `vscode-core` or `ptah-electron`**: When this workflow runs on GitHub Actions, the runner will execute all 47 suites of `vscode-core` and 119 suites of `ptah-electron` on all 3 operating systems. On Windows and macOS runners, running full suite trees with worker pools will dramatically exceed resource limits and likely exceed the 30-minute job timeout or fail on non-portable unit tests that were never intended for non-Linux runners. _(Resolved in Round 1 via `--testPathPatterns=real-git`)_.

### 3. What input data produces a wrong answer rather than an error?

- **`--testPathPattern=real-git` CLI option**:
  In `@nx/jest/dist/src/executors/jest/schema.json:160-167`, the property is named `testPathPatterns` (plural array, default `[]`). When `--testPathPattern=real-git` (singular) is passed:
  1. Nx places `testPathPattern` into `extraArgs`.
  2. In `@nx/jest/dist/src/executors/jest/jest.impl.js:72`, `testPathPatterns: options.testPathPatterns` sets `config.testPathPatterns = []`.
  3. Jest's `runCLI(config)` in `@jest/core/build/index.js:2596-2597` only evaluates `config.testPathPatterns`.
  4. Because `config.testPathPatterns` is `[]`, Jest's `TestPathPatterns` is not set (`isSet() === false`). Jest treats an empty pattern list as matching **all test files**.
     Empirical verification proved:
  - `npx nx test @ptah-extension/vscode-core --testPathPattern=real-git --listTests` matched **47 of 47 suites**.
  - `npx nx test @ptah-extension/vscode-core --testPathPatterns=real-git --listTests` matched **exactly 4 suites**.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- **Timeout in git real-git spec**: If a real-git spec hangs (e.g. child process lock contention or fs watcher timeout), Jest's default test timeout or the test's custom timeout will trigger. If Jest hangs entirely, the job-level `timeout-minutes: 30` aborts the runner.
- **`better-sqlite3` ABI mismatch**: Step `Rebuild native modules for runner Node ABI` (`npm rebuild better-sqlite3`) runs unconditionally on all 3 platforms, preventing binding failures on cache restore.
- **Rollup / unrs binaries on Linux**: Step `Install Linux platform binaries` is guarded with `if: matrix.os == 'ubuntu-latest'`, preventing invalid installation attempts on macOS and Windows.

### 5. What is missing that the requirements never mentioned?

- **Quoting and option schema compatibility with `@nx/jest`**: The plan specified `--testPathPattern=real-git`, which is the Jest CLI argument format, but overlooked that Nx 23's `@nx/jest` executor schema maps `--testPathPatterns` (plural) or positional arguments, discarding `--testPathPattern` into extraArgs where it is ignored by `jest.runCLI`.

---

## Failure Modes

### FM1: Whole-Project Test Suite Run Due to Parameter Name Mismatch

- **Trigger**: Job execution on any matrix OS runner (`ubuntu-latest`, `windows-latest`, `macos-latest`).
- **Symptom**: CI does not run only the real-git tests; it runs every test suite in `@ptah-extension/vscode-core` (47 suites) and `ptah-electron` (119 suites). The job takes 15–30+ minutes, risks hitting the 30-minute timeout on `windows-latest`, and fails on OS-specific unit tests outside the real-git scope.
- **Evidence**: [`.github/workflows/ci.yml:306, 308, 314, 316`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L306-L316)
- **Current handling**: Executes `npx nx test ... --testPathPattern=real-git`.
- **Recommendation**: Change `--testPathPattern=real-git` to `--testPathPatterns=real-git` or pass `real-git` as a positional filter `npx nx test @ptah-extension/vscode-core -- real-git`.

### FM2: Concurrent Cache Key Collision on `ubuntu-latest`

- **Trigger**: Workflow triggered on push or PR where the `node_modules` cache key is not yet present on GitHub Actions.
- **Symptom**: Both `main` and `git-real-git` jobs run simultaneously on `ubuntu-latest` and attempt to save to the identical key `node-modules-Linux-<hash>`. One job's cache save fails or corrupts, or `git-real-git` caches a `node_modules` that lacks the `prisma:generate` artifacts expected by `main`.
- **Evidence**: [`.github/workflows/ci.yml:253-261`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L253-L261) vs [`.github/workflows/ci.yml:63-69`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L63-L69)
- **Current handling**: The comment asserts the key is scoped to this job, but the key string omitted the job prefix.
- **Recommendation**: Change the key to `node-modules-realgit-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`.

### FM3: Silent False-Positive Pass on Zero Matches in `ptah-electron`

- **Trigger**: A test file rename or path pattern modification that causes zero tests to match in `ptah-electron`.
- **Symptom**: Step exits `0` without running any tests, giving a false impression that real-git specs passed on that OS.
- **Evidence**: [`apps/ptah-electron/project.json:436`](file:///D:/projects/ptah-extension/apps/ptah-electron/project.json#L436) (`"passWithNoTests": true`)
- **Current handling**: Inherits `passWithNoTests: true` from project configuration.
- **Recommendation**: Pass `--passWithNoTests=false` explicitly in the CI test command for `ptah-electron`.

---

## Blocking Issues

### 1. `--testPathPattern=real-git` is Ignored by `@nx/jest`, Running All Tests Monorepo-Wide in Both Projects

- **File**: [`.github/workflows/ci.yml:306, 308, 314, 316`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L306-L316)
- **Scenario**: The workflow invokes:
  ```bash
  npx nx test @ptah-extension/vscode-core --testPathPattern=real-git
  npx nx test ptah-electron --testPathPattern=real-git
  ```
- **Impact**: In `@nx/jest:jest`, the schema property for path regexes is `testPathPatterns` (plural array). Singular `--testPathPattern` is bypassed and Jest receives default `testPathPatterns: []`. Under Jest's `runCLI`, an empty pattern array matches all files. Consequently, all 47 suites in `vscode-core` and 119 suites in `ptah-electron` are executed on Windows, macOS, and Linux. This defeats the purpose of the targeted real-git job, wastes runner minutes, and will cause false failures on runners for tests not scoped for cross-platform execution.
- **Fix**: Replace `--testPathPattern=real-git` with `--testPathPatterns=real-git` in lines 306, 308, 314, and 316. _(Verified resolved in Round 1)_.

---

## Serious Issues

### 1. Unscoped `node_modules` Cache Key Collides With `main` Job on `ubuntu-latest`

- **File**: [`.github/workflows/ci.yml:261`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L261)
- **Scenario**:
  ```yaml
  # Same cache strategy as the main job (keyed on runner.os + lockfile
  # hash), scoped to this job so it does not race the main job's save of
  # the identical key on ubuntu-latest.
  - name: Cache node_modules
    id: cache-modules
    uses: actions/cache@v4
    with:
      path: node_modules
      key: node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
  ```
- **Impact**:
  The comment explicitly states that the key should be scoped to this job to prevent a race with `main`'s save on `ubuntu-latest`. However, the key was identical (`node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`). When both jobs execute concurrently on PR pushes, they race on post-job cache upload. On GitHub Actions, saving an existing key produces an error or warning, and could lead to cache corruption or inconsistent state (`main` generates Prisma clients into `node_modules/.prisma`, whereas `git-real-git` does not).
- **Fix**: Update the cache key to include a unique job prefix `node-modules-realgit-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`. _(Verified resolved in Round 1)_.

---

## Moderate and Minor Issues

### 1. Missing `--passWithNoTests=false` on `ptah-electron`

- **File**: [`.github/workflows/ci.yml:314, 316`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L314-L316) vs [`apps/ptah-electron/project.json:436`](file:///D:/projects/ptah-extension/apps/ptah-electron/project.json#L436)
- **Scenario**: `ptah-electron/project.json` defaults to `"passWithNoTests": true`. If the pattern fails to match any test (for example, if a test is moved or renamed), the step will silently pass with 0 tests executed.
- **Fix**: Pass `--passWithNoTests=false` to `npx nx test ptah-electron ...`. _(Verified resolved in Round 1)_.

### 2. Global Git Configuration Masking Branch Invariants

- **File**: [`.github/workflows/ci.yml:250`](file:///D:/projects/ptah-extension/.github/workflows/ci.yml#L250)
- **Scenario**: Setting `git config --global init.defaultBranch main` globally on the runner.
- **Impact**: If any code under test relies on the default branch name without discovering it dynamically or setting it via `-b main`, this global setting could mask defects that would appear on user systems where the default branch is `master` or unset. (Acceptable in CI for runner determinism; comment expanded in Round 1 to document this invariant).

---

## Data Flow

1. **Trigger & Filtering** (`ci.yml:214-219`): PR open check + branch exclusions (`chore/bump-*`, `chore(release)`). **[OK]**
2. **Matrix Initialization** (`ci.yml:205-207`): Matrix over `[ubuntu-latest, windows-latest, macos-latest]`, `fail-fast: false`. **[OK]**
3. **Environment Setup** (`ci.yml:228-251`): Checkout full depth (`fetch-depth: 0`, `filter: tree:0`), Node setup, git identity & defaults configured. **[OK]**
4. **Dependency Resolution & Cache** (`ci.yml:265-296`):
   - Cache check: `node_modules` key `node-modules-realgit-${{ runner.os }}-...`. **[OK]**
   - Fallback `npm ci || npm install` on cache miss. **[OK]**
   - Linux platform binaries installed only on `ubuntu-latest`. **[OK]**
   - `better-sqlite3` rebuilt for runner ABI. **[OK]**
5. **Nx Task Cache** (`ci.yml:298-305`): Scoped cache `nx-realgit-${{ runner.os }}-${{ github.sha }}`. **[OK]**
6. **Test Execution** (`ci.yml:352-367`):
   - Execution of `vscode-core` and `ptah-electron` with `--testPathPatterns=real-git --passWithNoTests=false`. **[OK]**
   - Negative lookahead `--testNamePattern='^(?!.*\[slow\]).*$'` excludes `[slow]` on non-Ubuntu runners. **[OK]**

---

## Requirements Fulfilment

| Requirement                                                         | Status   | Gap                                                                                      |
| ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Component 9: Matrix `[ubuntu-latest, windows-latest, macos-latest]` | COMPLETE | None                                                                                     |
| Component 9: `fail-fast: false`                                     | COMPLETE | None                                                                                     |
| Component 9: Run `@ptah-extension/vscode-core` real-git specs       | COMPLETE | Runs exactly the 4 real-git suites (`--testPathPatterns=real-git`)                       |
| Component 9: Run `ptah-electron` real-git specs                     | COMPLETE | Runs exactly the 1 real-git suite (`--testPathPatterns=real-git`)                        |
| Component 9: Exclude `slow` tests on windows/macos                  | COMPLETE | Negative lookahead `'^(?!.*\[slow\]).*$'` correctly filters test names matching `[slow]` |
| Cross-platform runner compatibility (bash on Windows)               | COMPLETE | `defaults.run.shell: bash` explicitly set                                                |
| Cache scoping                                                       | COMPLETE | `node-modules-realgit-${{ runner.os }}-...` prevents collision with `main`               |

---

## Edge Cases

| Case                                                  | Handled | How                                                                   | Concern                   |
| ----------------------------------------------------- | ------- | --------------------------------------------------------------------- | ------------------------- |
| Windows runner defaults to PowerShell                 | YES     | `defaults: run: shell: bash` forces Git Bash on Windows               | None                      |
| `npm ci` fails on Linux due to Windows lockfile drift | YES     | `npm ci \|\| npm install --no-audit --no-fund` fallback               | None                      |
| Linux platform binaries missing on Linux runner       | YES     | `npm install @rollup/...` guarded with `matrix.os == 'ubuntu-latest'` | None                      |
| Native module `better-sqlite3` ABI mismatch           | YES     | `npm rebuild better-sqlite3` runs on all platforms                    | None                      |
| `ptah-electron` requires watch host build             | YES     | Handled via Nx `dependsOn` in `apps/ptah-electron/project.json`       | None (esbuild bundle)     |
| Regex lookahead with brackets and exclamation         | YES     | Enclosed in single quotes `'...'` inside bash step                    | None                      |
| Zero tests matching in `ptah-electron`                | YES     | Handled via `--passWithNoTests=false`                                 | Exits 1 if no tests match |

---

## Verified Items

1. **Matrix & Runner Strategy**: `strategy.fail-fast: false` and `runs-on: ${{ matrix.os }}` with `[ubuntu-latest, windows-latest, macos-latest]`.
2. **Shell Consistency**: `defaults.run.shell: bash` enforces bash semantics across all runners, ensuring POSIX `||` and variable expansion operate uniformly.
3. **If Conditions**: Exact match with existing `main` job (`github.event_name`, `github.head_ref` chore branch guards, release commit message filter).
4. **Repository Fetch**: Full checkout with `filter: tree:0` and `fetch-depth: 0` ensures complete commit graph and tag availability for git test fixtures.
5. **Node ABI & Native Module Compilation**: `better-sqlite3` rebuild runs cleanly; `ptah-electron`'s `dependsOn` tasks use `@nx/esbuild:esbuild` (bundling JS/TS) rather than C++ compilation, and `@parcel/watcher` relies on prebuilt vendor binaries for win32/darwin/linux.
6. **Regex & Bash Escaping**: `--testNamePattern='^(?!.*\[slow\]).*$'` inside single quotes is evaluated verbatim by bash without history expansion or glob expansion, and correctly matches/filters in Jest circus runner.
7. **Targeted Test Selection**:
   - `npx nx test @ptah-extension/vscode-core --testPathPatterns=real-git --passWithNoTests=false --listTests` lists exactly 4 files (`paths`, `diff-config`, `hooks`, `write-lock.real-git.spec.ts`).
   - `npx nx test ptah-electron --testPathPatterns=real-git --passWithNoTests=false --listTests` lists exactly 1 file (`git-watcher.real-git.spec.ts`).
   - A non-matching pattern with `--passWithNoTests=false` fails with exit code 1 (`No tests found, exiting with code 1`).
8. **Workflow YAML Validity**: Parsed and validated via `js-yaml`.

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: None remaining for Batch 8. Future real-git specs must follow the `*.real-git.spec.ts` naming convention to be selected by `--testPathPatterns=real-git`.
- **Score justification (9/10)**: Exemplary resolution of the Nx-specific schema nuance (`testPathPatterns`), robust cache separation, and explicit zero-match error enforcement (`--passWithNoTests=false`).
