# Batch 37a executor report — `go vet` checker (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base
1eab01c35. No git state was changed; the tree is left dirty for the team leader.

## Files

`WI` = `libs/backend/workspace-intelligence/src`.

| Status   | File                                                            | Purpose                                                                                        |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CREATED  | `WI/diagnostics/external-checkers/checker-runner.ts`            | `runChecker`: spawns through `IProcessSpawner`; timeout, 2 MiB cap, cancellation, tree kill; `pickInheritedEnv` |
| CREATED  | `WI/diagnostics/external-checkers/checker-runner.spec.ts`       | 13 fake-spawner cases                                                                          |
| CREATED  | `WI/diagnostics/external-checkers/go-binary-resolver.ts`        | `resolveGoBinary` (O2 §4.1), `sanitisedPathDirectories`, `isSameGoBinary`                      |
| CREATED  | `WI/diagnostics/external-checkers/go-binary-resolver.spec.ts`   | O2 cases 10-14, the FB case, the user-data directory, POSIX X_OK                               |
| CREATED  | `WI/diagnostics/external-checkers/go-vet-consent-store.ts`      | `GoVetConsentStore` read/grant/revoke; strict record parse; staleness (Decision 25)            |
| CREATED  | `WI/diagnostics/external-checkers/go-vet-consent-store.spec.ts` | O2 cases 1-9, real junction retarget and real folder replacement                               |
| CREATED  | `WI/diagnostics/external-checkers/go-vet-checker.ts`            | `GoVetChecker`: fixed invocation, allowlisted env, JSON parsing, honest outcomes, audit        |
| CREATED  | `WI/diagnostics/external-checkers/go-vet-checker.spec.ts`       | O2 cases 15-24, partial success, parsing and classification                                    |
| CREATED  | `WI/diagnostics/external-checkers/go-vet-hostile.integration.spec.ts` | O2 §7.2 real-binary fixtures; skipped, with a printed reason, when no `go` resolves      |
| MODIFIED | `WI/index.ts`                                                   | Exports the checker, the store, the resolver and their types for 37b                           |

Nothing else is touched. `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged: `git status` lists only the
rows above.

## Design (follows O2's current text, including "Revision (review r1)")

- **Order per run** (O2 §3): scope → module and packages → `resolveGoBinary` → one `GoVetConsentStore.read(root, binary)`
  (not cached) → `getSpawner()` (lazy, so a throw becomes `failed/no-spawner`) → spawn. A revoke therefore stops the next run.
- **Invocation:** `<canonical go> vet -json <pkg>…` as an argument array with no shell. `cwd` is the nearest `go.mod`
  inside the root. Packages are `.` or `./rel`, validated (no `..`, no `...`, never a leading `-`), at most 20.
  Nothing is caller-supplied.
- **Environment:** built from scratch. It keeps `PATH` (the sanitised directories), inherits `HOME`, `USERPROFILE`,
  `SystemRoot`, `TEMP`, `TMP`, `XDG_CACHE_HOME`, `LANG` and, on win32 only, `LOCALAPPDATA`, then sets the
  `GO_VET_FIXED_ENV` table from O2 §4.3 exactly.
- **Result:** `status` is `checked`, `unchecked` or `failed`, and `outcome` and `reason` use the §6 codes. Each skipped
  file carries its own reason, and the skipped files are grouped into `NotCheckedFiles` (language `go`). `checked`
  requires a clean exit with parseable output. Go diagnostics are never returned on `unchecked` or `failed`.
- **Coverage (25a/25b):** the exported `GO_VET_COVERAGE` is `{ checks: 'syntax-only', approximations: ['go:syntax-only'] }`,
  so vet results are never a type-check claim. 37b merges this fragment into the provider's coverage.
- **Findings:** each finding becomes severity `warning`, code = analyzer name. Only files inside the root are kept, with
  a cap of 500 findings (`diagnosticsTruncated`). An analyzer `{error}` gives `failed/analyzer-error`.
- **Non-zero exit:** classified by fixed patterns into `toolchain-mismatch`, `missing-modules`, `build-errors` or
  `unparseable`.
- **goVersion:** read from `<GOROOT>/VERSION` next to the canonical binary. No second process is run.

## Security checklist (evidence = spec name)

| Requirement                                                                            | Evidence                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opt-in per workspace; never runs without stored, current consent                       | checker spec "case 15" (off and stale: 0 spawns), "case 16" (grant→spawn, revoke→no spawn; order `resolve, consent, spawn`)                                                                     |
| Consent never enabled by a repository file                                              | store spec "case 8" (`.ptah/workspace-state.json`, `.ptah/settings.json`, `.vscode/settings.json` → off); "case 9" (user-data directory inside the root → off, grant refuses)                    |
| Fail closed (not scoped, unregistered, malformed, not ready, any throw)                 | store spec cases 1, 2 (no sibling or active leak), 4 (7 malformed shapes and 5 non-records), 5 (`StateStorageNotReadyError`)                                                                     |
| Consent ends when the binary changes or the root moves or is replaced (Decision 25)     | store spec "case 6" (root-moved, root-replaced, a null rootId skips the ino check, go-changed on path, size, mtime or absence; real junction retarget; real folder replacement)                  |
| Revoke deletes the key and read-back verifies                                           | store spec "case 7" (`keys()` no longer lists the key; `read` → off). The RPC read-back is 37b                                                                                                   |
| Binary only from the cleaned PATH; no cwd; no PATHEXT; `go.exe` only                    | resolver spec "FB", cases 10, 11 (real `process.chdir` into a directory holding `go.exe`), 12 (`go.cmd`/`go.bat` with `PATHEXT` set)                                                            |
| Search continues past a rejected candidate                                              | resolver spec "case 13" (link into the workspace, link to `.cmd`), "case 13 (real link)" (junction into the workspace dropped), a `go.exe` directory skipped                                    |
| Argument array, no shell                                                                | runner spec "passes the argument array…"; checker spec "spawns `<canonical go> vet -json ./b ./a`…"                                                                                              |
| Environment allowlisted, never spread                                                   | checker spec "case 17" (win32 and linux; hostile `GOFLAGS`, `GOENV`, `GOCACHEPROG`, `GOTOOLCHAIN`, `CGO_ENABLED`, `CC`, `NODE_OPTIONS`, `PATHEXT`; whole-object `toEqual`)                     |
| Timeout, output cap, cancellation, tree kill                                            | runner spec (delayed spawn then timeout, too-large, cancelled, spawn-failed, pid null, kill error); checker spec cases 19, 20, 22                                                                  |
| Never "No issues" on failure                                                            | checker spec case 21 and "a non-zero exit is failed/…" (4 reasons: no diagnostics, files named in `notChecked`)                                                                                  |
| No path or raw text logged                                                              | checker spec case 24: whole-object audit fields; no root, basename, file name, stderr token or binary path                                                                                      |
| `catch (error: unknown)`; no new `as any`/`@ts-ignore`; package-alias imports only      | source review; `eslint` on the folder is clean (0 problems)                                                                                                                                      |
| Fixtures avoid import string shapes                                                     | Go import lines are concatenated (`'imp' + 'ort'`); `validate-deps` passes                                                                                                                       |
| mkdtemp roots cleaned                                                                   | every spec removes them in `afterEach`                                                                                                                                                           |

## FB evidence (fails before, passes after)

On the batch base none of the four modules exists, so every new suite fails to resolve its import there. The behaviours
were also mutation-checked: each change was applied, the named spec was run, and the file was restored and re-run.

| Mutation                                                                           | Spec (filter)                                  | Mutated result      | Restored            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------- | ------------------- |
| Resolver keeps in-workspace PATH directories (containment check disabled)          | resolver "hostile PATH entry rejected" (FB)    | 1 failed            | 1 passed            |
| Checker skips the consent check                                                    | checker "consent"                              | 3 failed / 4        | 4 passed            |
| Environment spreads the parent env instead of the allowlist                         | checker "case 17"                              | 2 failed / 2        | 2 passed            |
| Runner timeout disabled (×1000)                                                    | runner "timeout"                               | 1 failed            | 1 passed            |
| Store falls back to a single, non-scoped storage                                   | store "case 1"                                 | 1 failed            | 1 passed            |

## Verification (tail only; header counts)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` →
  "Successfully ran targets test, lint, typecheck". Test Suites: 1 skipped, 57 passed, 57 of 58 total. Tests: 9 skipped,
  1748 passed, 1757 total. Lint reported 0 errors and 63 warnings; none of the warnings is in the new files (`eslint` on
  the folder is clean).
- **Hostile spec: SKIPPED.** Printed reason: "no `go` binary resolves from the sanitised PATH on this machine" (Go is
  not installed here). Its 7 cases have not been run against a real toolchain.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → both succeeded.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies".
- `nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300 unsuppressed site(s)"; workspace-intelligence 1 (baseline
  1). Each flagged `catch` in the new code carries a `degradation-audit: optional-capability` reason; none is orphaned.

## Deviations and notes

1. **No zod.** O2 §1.1 says "strict zod parse". workspace-intelligence does not depend on zod
   (`libs/backend/workspace-intelligence/package.json`), and adding it falls outside this batch's files. The record is
   parsed instead by a hand-written strict guard, `parseGoVetConsentRecord`: exact key sets, exact types, `v === 1`.
2. **Extra reason codes** beyond O2 §6: `unscoped`, `no-go-files`, `spawn-failed`, `cancelled`, `build-errors`,
   `analyzer-error`, plus per-file `cgo`, `other-module`, `omitted-by-cap`, `invalid-package-path`, `not-found`. Each is
   fixed text with no path.
3. **One module per call.** Files in a second `go.mod` are `other-module` rather than a second run, so a call stays within
   the single 30 s timeout.
4. **cgo detection is lexical.** The first 64 KiB of each requested file is scanned for a C import. Those files are
   reported `cgo` and their package is still vetted when other files in it are requested. With `CGO_ENABLED=0` the go
   command excludes them.
5. **Real-toolchain behaviour is unverified here.** The `-json` layout (`# pkg` headers plus a JSON tree, written to
   stderr) and the failure patterns are taken from the Go sources and documentation, not from a run. The Codex review or
   a machine with Go should run `go-vet-hostile.integration.spec.ts` once.
6. **Environment limitation (O2 §4.3 as written).** `GOPATH`, `GOMODCACHE` and `GOCACHE` are not inherited. A user who
   relocated them gets `missing-modules` rather than a result.
7. **Plain storage is denied.** A non-scoped `IStateStorage` answers `off`, following O2 §1.1 and case 1, which supersede
   the plan's "single IStateStorage" wording. Both hosts register `WorkspaceAwareStateStorage`.

## For 37b

- Construct `GoVetConsentStore(container WORKSPACE_STATE_STORAGE, { userDataPath: PLATFORM_INFO.globalStoragePath })`.
  O2 §1.2 lists confirming that `globalStoragePath` equals the host's user-data directory as an open assumption.
- Construct `GoVetChecker({ consentStore, getSpawner: () => container.resolve(SDK_PROCESS_SPAWNER), userDataPath, logger })`.
- Merge `GO_VET_COVERAGE` and `notChecked` into the provider, and keep the Tier 0 syntax result for every Go file.

## Fix round (review r1)

Review: `reviews/batch-37a-code-logic-review-r1.md` (REVISE 4/10). This round fixes the three Blocking findings. The
Moderate finding (a rejected tree kill skips the handle fallback; errors from the default reaper are not observed) is
carried to 37b as directed: `checker-runner.ts` was not edited in this round.

### Files

| Status   | File (`WI/diagnostics/external-checkers/…`) | Change                                                                                                                                                                 |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATED  | `go-file-membership.ts`                     | `goFileMembership`, `scanGoHeader` (a Go-aware scanner for the package clause and imports), `hasFilenameConstraint` (Go's GOOS/GOARCH suffix rule)                        |
| CREATED  | `go-vet-output.ts`                          | The vet JSON parsing moved here (the checker had reached the `max-lines` limit), plus a per-package count of unmapped findings, `packageDirForId` and `classifyFailure` |
| MODIFIED | `go-vet-checker.ts`                         | Planning in canonical paths, membership gating, position mapping, `unmappedFindings`, new reason codes                                                                   |
| MODIFIED | `go-vet-checker.spec.ts`                    | Regression specs for findings 1-3; the cwd expectation is now the real root; the old `importsCgo` spec is replaced by `scanGoHeader` and filename-rule specs              |
| MODIFIED | `go-vet-hostile.integration.spec.ts`        | Adds a real-Go `//line` directive fixture for finding 3 (skipped here, because Go is not installed)                                                                     |

### Finding 1 — only files Go selects are credited

A file enters the plan only if its realpath resolves to a regular file; a missing file is `not-found`, even when its
package directory exists. `goFileMembership(realFile)` then decides whether a clean run of the package may be credited to
the file:

- `ignored-name`: the name starts with `_` or `.`.
- `build-constraints`: a known GOOS or GOARCH filename suffix, or any `//go:build` or `// +build` line before the
  package clause. The constraint is not evaluated. A file it might exclude is simply never claimed.
- `cgo`: the scanner handles comments, and grouped, named and single imports. A trailing block comment is caught, the
  whole file is read (up to 1 MiB) instead of the first 64 KiB, and a commented-out C import does not count.
- `unverifiable`: the file is over 1 MiB, unreadable, has an escaped import path, or has an unterminated comment.

Only `member` files are counted as checked. The others are skipped with their reason, and a directory in which no
requested file qualifies is not passed to vet. The single fixed invocation is unchanged; no extra Go process is run.

### Finding 2 — links never leave the consented root

The root and every requested file are resolved with `realpathSync.native` first. If the root does not resolve, the run
is not started (`root-unresolvable`).

- A file whose real path lies outside the real root is `outside-root` and is never planned.
- The `go.mod` search, the package patterns and the run's `cwd` all use real paths inside the real root, so the process
  always runs inside the folder the consent binds.
- A root that is itself a junction runs in its real folder, and results are reported under the paths the caller used.

### Finding 3 — findings with unmappable positions are never erased

`parseVetDiagnostics` maps each position through the real root, falling back to the root as the caller spelled it. A
position outside both is counted per package id instead of being dropped. When any such finding exists:

- `outcome` is `findings`, never `ok`, and `reason` is `unmapped-findings`.
- `unmappedFindings` gives the count.
- Each requested file in the package concerned, resolved by `packageDirForId` (test variants included), is skipped with
  `unmapped-findings`.
- If the package id is not under the module (for example `command-line-arguments`, or a `go.mod` with no readable
  module path), every vetted file is skipped.

Findings whose positions do map are kept.

### Regression specs and FB evidence

| Finding | Specs (in `go-vet-checker.spec.ts`)                                                                                                                                                                                                                                                                                   | Mutation (fix disabled) → result                                                  | Restored     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ |
| 1       | a missing file in an existing package; `//go:build excludedtag`; `// +build`; `_plan9` suffix; `_s390x_test` suffix; leading `_`; cgo import with a trailing block comment; cgo import past 64 KiB; escaped import path; a commented-out C import is still checked                                                        | membership forced to `member`: **8 failed** / 10                                  | 10 passed    |
| 2       | outward junction to another module (only that file: 0 spawns; mixed with a normal file: cwd = real root, args `./a` only); outward-linked package directory; junction root reported under the caller's paths                                                                                                            | lexical planning (the pre-fix behaviour): **3 failed** / 3                        | 3 passed     |
| 3       | a `//line`-style outside position in package `a`: `findings`, `unmapped-findings`, `a` skipped, `b` still checked, audit line reason set; a package id outside the module skips every file; `packageDirForId` mapping                                                                                                 | outside positions dropped (the pre-fix behaviour): **2 failed** / 3               | 3 passed     |

The reviewer's probe scenarios (a missing file, a build tag, a trailing-comment cgo import, a cgo import past 64 KiB, an
outward junction to its own module, a valid outside `posn`) each have a spec above.

### Verification (tail)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` → "Successfully ran
  targets test, lint, typecheck". Test Suites: 1 skipped, 57 passed, 57 of 58 total. Tests: 10 skipped, 1765 passed,
  1775 total. The hostile spec, now 8 cases, is still skipped because no `go` binary is available.
- `eslint` on `external-checkers/`: 0 problems.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → both projects succeeded.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered".
- `nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300"; workspace-intelligence 1 (baseline 1). The new flagged
  catches carry `optional-capability` markers, and none is orphaned.
- The temporary edit files were written under `%TEMP%` and deleted afterwards. No git commands were run.

### Notes and deviations

- Two new files in the same folder (`go-file-membership.ts`, `go-vet-output.ts`), for cohesion and the `max-lines`
  limit. Their behaviour is tested through `go-vet-checker.spec.ts`.
- New reason codes: `root-unresolvable`, `outside-root`, `build-constraints`, `ignored-name`, `unverifiable`,
  `unmapped-findings`. `GoVetCheckResult` gains `unmappedFindings`, and on a `checked` answer `reason` is now allowed
  only as `unmapped-findings`. 37b must carry these codes and the field into the provider, formatter and RPC.
- The membership check is deliberately conservative. A file with any build line is never credited, even when its tags
  would match. This under-claims; it never over-claims.
- Correction to the first report's deviation 6, per the review: dropping `GOCACHE` usually rebuilds into the default
  cache, possibly timing out; it does not necessarily produce `missing-modules`.
