# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Requested verdict | REVISE |
| Blocking issues | 3 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 4 |

Batch 37a has working consent denial, binary filtering and environment restrictions, but it can cross the consented workspace boundary and return success-looking results for files or findings it did not actually cover. Those defects prevent a 5–6 score; the implemented denial and execution controls distinguish it from a fundamentally unguarded implementation.

Reviewed the four production modules, all five new specs, and the complete `src/index.ts` listed in the executor report. Read Batch 37a/37b, O2 including its r1 revision, Decisions 19/24/25, the language plan's diagnostics contract, and the executor report. No task-description.md, implementation-plan.md or applicable code-style-review.md was present; implementation-plan-languages.md supplies the plan. The instruction search found no AGENTS.md. Native reads were necessary: no Ptah file-content reader was listed; `ptah_search_files` returned zero AGENTS.md matches.

All paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`. Bare checker filenames mean `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/<filename>`; `PC` means `libs/backend/platform-core/src`.

Scope limitation: the reviewer's governing role prohibits git operations, so I did not independently run git status/diff or verify HEAD. Scope came from the explicitly supplied file list and executor report (lines 10–21). No reviewed source or task state was edited.

## Verification evidence

- Ran the requested project-only Nx test/lint/typecheck command, using PowerShell's quoted `'-t=test,lint,typecheck'`, `nx.cmd`, and `Select-Object -Last 30` equivalents. Nx reported all three targets successful, cache skipped, 58.9 seconds. The tool reported the PowerShell pipeline exit as 1 despite Nx's explicit successful-target summary; this is disclosed rather than described as a clean shell exit. The initial unquoted command was rejected by PowerShell before Nx ran. No suite was rerun.
- `ptah_get_diagnostics`, scoped to go-vet-checker.ts, returned TypeScript compiler errors 0, warnings 0.
- The executor reports 57 passing suites and the real-Go suite skipped (`batch-37a-executor-report.md:82`, `:86`). Current Nx output suppressed task logs, so those counts are executor evidence, not independently recounted. Go was not installed or downloaded.
- Independent probes load the actual TypeScript implementations with TypeScript transpilation and the actual platform-core predicate/storage/kill helpers. Storage and Go process output are controlled doubles; filesystem roots and junctions are real. They reproduced findings 1–3 and the injected failure in finding 4.
- A separate native Windows probe ran the actual runner and default reaper against a Node parent with a live child: timeout at 1007 ms; both PIDs were no longer alive 800 ms later. This proves the normal Windows kill path, not POSIX or the Electron worker adapter.
- Retained only temporary probe material outside the repository: `%TEMP%/b37a-review-probe.cjs`, `b37a-review-probe.log`, `b37a-review-extra.cjs`, `b37a-review-extra.log`, `b37a-review-checks.log`, and their `b37a-review-*` / `b37a-tree-*` fixture directories. Nothing was executed as a real Go binary.

## Security checklist

PASS is limited to the stated evidence; host integration assigned to 37b remains unverified.

| Item | PASS/FAIL | Evidence |
| --- | --- | --- |
| No execution without stored/current consent | PASS | `go-vet-checker.ts:668`; independent off → 0 calls, grant → run, revoke → 0 additional calls; store read catches failures at `go-vet-consent-store.ts:163`. |
| Repository files cannot grant consent through this store | PASS | Only root-addressed host storage read at `go-vet-consent-store.ts:164`; scoped-storage and user-data containment guards at `:250`, `:270`; repository-file spec case 8. Actual host path wiring is 37b. |
| Revoke deletes and can be read back | PASS | `go-vet-consent-store.ts:204`; probe key list empty and read off. Automatic success/readback enforcement belongs to the O2 §3 RPC in 37b; the store itself does not verify persistence. |
| Binary/root staleness | PASS | `go-vet-consent-store.ts:224`, `:230`, `:234`; independent changed-mtime and real folder-replacement probes returned stale. Specs exercise real root-junction retarget. O2's null inode limitation remains. |
| Execution stays inside consented root | FAIL | `go-vet-checker.ts:305`, `:632`, `:693`; outward junction selects a different physical module with no consent. Finding 2. |
| Clean PATH; no implicit cwd, relative, UNC/device entries | PASS | `go-binary-resolver.ts:114`, `:174`; scoped suite includes hostile PATH and different host cwd. |
| Windows go.exe only, no PATHEXT/shim selection | PASS | `go-binary-resolver.ts:201`, `:213`; resolver specs cases 12/13. Absolute executable handling traced through cross-spawn; real host adapter proof remains 37b. |
| Reject symlink/junction binaries into root; continue search | PASS | `go-binary-resolver.ts:179`, `:207`, `:246`; real PATH-junction spec and candidate-link tests. This does not fix the separate input-module junction problem. |
| Fixed argument array, no caller flags | PASS | `go-vet-checker.ts:345`, `:692`; `checker-runner.ts:172`; no shell field. Adapter trace: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:705`, `:786`. |
| Environment code-injection controls | PASS | `go-vet-checker.ts:83`, `:100`, `:359`; exact allowlist probe removes hostile GOFLAGS, CC and auto toolchain setting; GOWORK off suppresses parent go.work. |
| Normal timeout/cancellation/tree kill and output cap | PASS | `checker-runner.ts:141`, `:154`, `:168`; native Windows parent/child probe plus scoped delayed-spawn, cancellation and combined-output specs. |
| Cleanup failure is handled honestly | FAIL | `checker-runner.ts:103`, `:115`, `:148`; rejected kill skips handle.kill; default reaper errors are not observed. Finding 4. |
| Real vet JSON hierarchy, positions and exit semantics | PASS | `go-vet-checker.ts:454`, `:475`, `:709`; source comparison and replay of nested maps, headers, analyzer error, multiple JSON objects and compiler stderr. Finding 3 concerns dropping valid positions, not the tree schema. |
| Requested-file coverage and cgo exclusion are honest | FAIL | `go-vet-checker.ts:558`, `:572`, `:589`, `:730`; missing, build-tagged and cgo variants all replay as checked. Finding 1. |
| Never claims type-check coverage | PASS | `go-vet-checker.ts:110` exports syntax-only / go:syntax-only; provider integration remains 37b. |
| Fixed audit fields, no raw output/paths | PASS | `go-vet-checker.ts:269`, `:610`; scoped audit spec checks path/error exclusion. |

## Five logic questions

### 1. How does this fail silently?

A successful package run credits files that Go excluded or that do not exist (`go-vet-checker.ts:589`, `:730`, finding 1). A valid finding with an adjusted position outside the root is discarded and changes the outcome to ok (`:494`, `:723`, finding 3). A default tree-kill failure has no observer (`checker-runner.ts:115`; `PC/utils/process-tree-reaper.ts:63`, finding 4).

### 2. What user action produces unexpected behaviour?

Checking a requested file below a workspace junction can run vet in another physical workspace whose consent is off (`go-vet-checker.ts:305`, `:668`, `:693`, finding 2). Checking platform-specific/build-tagged files can claim they were vetted despite their exclusion (finding 1).

### 3. What input data produces a wrong answer?

An existing package plus a nonexistent requested filename; a file with an unsatisfied build tag; a cgo import with a trailing block comment or beyond the 64 KiB scan; and JSON with a valid outside-root adjusted posn (`go-vet-checker.ts:314`, `:330`, `:494`, `:558`). Probes demonstrate each result transformation.

### 4. What happens when a dependency fails?

Storage/read failure denies consent (`go-vet-consent-store.ts:169`); unavailable binary/spawner, nonzero process exit, malformed JSON, analyzer errors, timeout and overflow return unchecked/failed (`go-vet-checker.ts:661`, `:679`, `:700`, `:710`, `:715`). Cleanup failure is the remaining gap (finding 4). No partial vet diagnostics survive a failed run (`:755`); retaining other languages is a 37b integration requirement.

### 5. What is missing that the requirements never mentioned?

A trustworthy requested-file membership rule for Go's build selection, canonical containment of input modules, and handling of compiler-adjusted diagnostic filenames. The fixed invocation and authorization are not a sandbox (`implementation-plan-languages.md:373`), but that does not justify treating a different physical module as inside the consented root or turning discarded findings into a clean result.

## Failure modes

### 1. Blocking — package success is falsely promoted to file coverage

- Disposition: **fix-now**.
- File/evidence: `go-vet-checker.ts:558` checks only the directory; `:572` uses a lexical cgo heuristic; `:589` unconditionally appends the file; `:730` returns that list as checked. The 64 KiB bound is at `:80`, `:330`; the regexes at `:314` cannot recognize all legal import syntax.
- Trigger/scenario: a module contains valid plain.go, and the requested file is missing.go; or tagged.go starts with `//go:build excludedtag`; or native.go contains `import "C" /* valid trailing comment */`; or a long leading comment pushes the C import beyond 64 KiB. Go vets the package's other buildable files.
- Symptom/impact: all four independent replays returned `status: checked`, the requested file in checkedFiles, and no skipped entries. These are false vet-coverage claims even though GO_VET_COVERAGE correctly avoids the stronger type-check label.
- Current handling: directory membership is treated as evidence of inclusion; unreadable file content becomes an empty string at `:334`. Ordinary false-positive cgo matches in comments can also unnecessarily exclude files.
- Source evidence: Go applies explicit tags and implicit GOOS/GOARCH filename constraints; package success therefore does not prove every file was included. [Go build constraints](https://pkg.go.dev/cmd/go#hdr-Build_constraints).
- Recommendation: check that each requested file is a readable regular file and establish membership under the actual fixed build environment before crediting it. If membership cannot be proven within the approved single-invocation contract, report it as unchecked/uncertain rather than inventing coverage. Parse cgo imports correctly, or conservatively disclose uncertainty; do not silently ignore a truncated/unreadable import scan. Add failing regressions for the above cases, platform suffixes, and commented-out imports. Any extra Go invocation needs an explicit contract amendment.

### 2. Blocking — input junction bypasses the workspace consent boundary

- Disposition: **fix-now**.
- File/evidence: `go-vet-checker.ts:628` and `:632` normalize/check paths lexically; `:305` selects go.mod through the same lexical boundary; `:668` reads consent for the original root; `:693` uses the selected module as cwd. `PC/utils/path-containment.ts:23` explicitly documents that this predicate does not resolve junctions.
- Trigger/scenario: consent is on for A; A/linked is a junction to B, which has its own go.mod and no stored consent. Request A/linked/plain.go.
- Symptom/impact: the real-junction probe captured cwd A/linked, canonical cwd B, and B consent off, while the checker returned checked. It authorizes a separate physical workspace through A's consent. No arbitrary-code-execution claim is needed: this already breaks the per-workspace execution contract.
- Current handling: source/module paths are not canonicalized. Canonicalizing the Go executable does not protect the input cwd.
- Recommendation: canonicalize the workspace and requested file/module directories, reject outward links before module planning, and bind the actual cwd to the consented root. Fail closed on realpath failures. Test both a linked nested module and a linked package directory, including the root itself being a legitimate junction. Do not silently transfer A's consent to B.

### 3. Blocking — valid Go positions can erase every finding

- Disposition: **fix-now**.
- File/evidence: `go-vet-checker.ts:493` resolves posn; `:494` silently continues for an outside-root path; `:723` derives ok solely from retained diagnostics; `:730` still credits all planned files.
- Trigger/scenario: a checked source file uses a valid `//line ../generated.go:42:1` directive and has a vet finding after that directive. Generated code legitimately uses these directives; repository authors can also supply them.
- Symptom/impact: replaying the matching package→printf→diagnostics JSON with a posn outside the root returned `checked / ok / diagnostics: [] / checkedFiles: 1`. A real diagnostic becomes a success-looking empty result.
- Current handling: no dropped-diagnostic count, incomplete flag, failure reason or package-level finding survives the containment filter.
- Source evidence: x/tools JSON serialization uses `fset.Position(f.Pos).String()` ([flags.go, lines 426–429](https://github.com/golang/tools/blob/v0.36.0/go/analysis/internal/analysisflags/flags.go#L426)); FileSet.Position honors line adjustments ([go/token](https://pkg.go.dev/go/token#FileSet.Position)); line directives can specify relative or absolute filenames ([compiler directives](https://pkg.go.dev/cmd/compile#hdr-Line_directives)). The real-Go case is inferred from these sources; the actual parser/result transformation was executed.
- Recommendation: never silently erase a reported finding. Keep a safe package-level/unmapped finding or fail with a disclosed unmappable-position reason and no clean coverage. Do not solve this by opening arbitrary reported paths. Add a source-derived JSON regression now and a real-Go line-directive fixture for Go-enabled CI.

### 4. Moderate — cleanup failure can skip the fallback kill and is not observable by default

- Disposition: **carry-to-37b** (per Decision 24); fix the runner/helper integration before presenting a confirmed “stopped” message.
- File/evidence: `checker-runner.ts:103` awaits killTree before `:105` handle.kill, with no finally; rejection is only passed to optional onKillError at `:148`. The default at `:115` does not pass an error callback to `killProcessTree`, whose Windows catch suppresses errors at `PC/utils/process-tree-reaper.ts:63`. User text says stopped at `go-vet-checker.ts:214`.
- Trigger/scenario: the tree terminator rejects, or Windows taskkill fails. The injected rejecting-killer probe returned timeout with handleKills 0 and one callback. In the default path, the existing helper resolves after failure and only the leader fallback is attempted; successful tree removal is not established.
- Symptom/impact: child work can remain after the request ends, while the result text asserts it was stopped. The native successful-tree probe does not exercise this failure.
- Current handling: best-effort asynchronous termination; the default reaper failure cannot reach the runner's observer. This is an unlikely cleanup failure, hence Moderate rather than a likely-path Serious issue.
- Recommendation: put the handle fallback in finally, connect the real reaper's failure signal, and distinguish timeout/cancel request from verified termination in fixed-text reporting. Test rejecting terminators and default-helper taskkill failure, not only invocation counts.

## Blocking issues

Findings 1–3 above are the three blocking issues: false file coverage, physical-root consent escape, and silently erased findings. Each has a concrete trigger, evidence, impact and fix. They must be fixed in 37a; the 37b review should verify those regressions under Decision 24.

## Serious issues

None established.

## Moderate and minor issues

Finding 4 is Moderate and may roll forward to 37b. Additional verification uncertainty: the hostile network fixture checks only that a cache entry did not appear (`go-vet-hostile.integration.spec.ts:312`, `:338`); that is evidence of no persisted fetch, not a direct observation of zero network attempts. Likewise checking the module root for _cgo output (`:341`, `:363`) is weaker than observing the compiler invocation/temp work area. These are test-strength limitations, not evidence that the fixed production environment permits network or C compiler execution.

## Real Go format comparison

The parser's main JSON structure is correct. x/tools uses a package-ID map containing analyzer-name entries, each either a diagnostic array or an error object; diagnostics contain posn and message. A clean package can yield an empty object. [JSONTree and serialization](https://github.com/golang/tools/blob/v0.36.0/go/analysis/internal/analysisflags/flags.go#L349).

JSON-mode unitchecker emits its tree to stdout and exits zero even with findings or serialized analyzer errors; plain-text mode has different exit behavior. Current cmd/go passes JSON output through, while Go versions may wrap child output with package headers. Consuming both streams, handling analyzer errors explicitly, and treating compiler/load failures separately is appropriate. [unitchecker Run](https://github.com/golang/tools/blob/v0.36.0/go/analysis/unitchecker/unitchecker.go#L124), [cmd/go vet](https://go.dev/src/cmd/go/internal/vet/vet.go).

Independent replays confirmed Windows file:line:col, multiple package objects with headers, serialized analyzer errors, and nonzero compiler stderr. No nested-map mismatch was found. The real-format gap is finding 3's handling of valid adjusted positions. No installed-Go execution is claimed.

## Data flow

1. Requested files → lexical root filter: **GAP**, finding 2 (`go-vet-checker.ts:625`).
2. Files → one module / maximum 20 packages / cgo heuristic: **GAP**, finding 1; module and package caps disclose their omissions (`:546`, `:568`, `:582`).
3. Parent PATH → canonical accepted Go binary and child PATH: **OK** within approved trust model (`go-binary-resolver.ts:236`).
4. Host storage + current root/binary identity → consent: **OK** for the supplied root, but wrong physical cwd can bypass that scope (`go-vet-consent-store.ts:159`; finding 2).
5. Lazy spawner + fixed argv/env → bounded child: **OK** normal path (`go-vet-checker.ts:678`, `:689`).
6. Timeout/overflow/cancel → tree termination: **GAP** on cleanup failure, finding 4 (`checker-runner.ts:141`).
7. Exit + streams → parser → findings/coverage: **GAP**, findings 1 and 3; errors otherwise fail closed (`go-vet-checker.ts:709`).
8. Checker result → language provider / surfaces: **37b-owned**, not implemented by 37a (`batches.md:4304`, `:4313`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Opt-in and stale/revoked denial | COMPLETE | Component-level proof; host persistence/readback remains 37b. |
| Canonical Go binary, safe PATH | COMPLETE | POSIX runtime test skipped on Windows; native host adapter assertion assigned to 37b. |
| Fixed invocation/environment | COMPLETE | Real Go hostile execution skipped as explicitly permitted. |
| Per-workspace execution authorization | PARTIAL | Finding 2: actual module can be outside root. |
| Limits and process-tree termination | PARTIAL | Normal Windows path proven; finding 4 on failure. |
| Real JSON parsing | PARTIAL | Shape correct; valid out-of-root positions silently lost. |
| Honest coverage and cgo | PARTIAL | Finding 1. |
| Type-check floor rule | COMPLETE | Exported syntax-only fragment; 37b must preserve it. |
| Consent RPC/UI/CLI, provider wiring | MISSING in this batch, intentionally | Carry to 37b under O2 §7.3; not a 37a defect. |

Implicit requirements not addressed: physical input-root identity, exact build membership, and unmapped diagnostics (findings 1–3).

### Deviations and handoff decisions

- **Manual consent parser:** acceptable behaviorally for this host JSON record. `go-vet-consent-store.ts:105` checks exact key sets, version, types and finite nonnegative numeric identity fields. No demonstrated authorization bypass results from not using zod. O2 should record the implementation choice; adopting zod is not a security fix by itself.
- **Extra reason codes:** acceptable; `go-vet-checker.ts:121` and `:201` keep them typed and fixed-text. Carry their union into 37b RPC/formatter handling; update O2 §6 rather than silently narrowing outcomes.
- **One module per call:** acceptable bounded partial behavior, because other-module is explicitly disclosed (`go-vet-checker.ts:568`). Request order determines the first module, including when its requested files are subsequently skipped; this is a limitation, not a complete multi-module check.
- **Relocated caches:** retaining the approved allowlist is acceptable for this batch. `go-vet-checker.ts:100` omits GOPATH/GOMODCACHE/GOCACHE; missing dependencies at default locations fail visibly at `:524`. Passing host-selected validated cache-location variables could improve usability later, but is not required to repair the security boundary. Correct the executor note at `batch-37a-executor-report.md:109`: dropping GOCACHE alone usually rebuilds into the default cache (possibly timing out), not necessarily missing-modules.
- **37b gates:** verify actual user-data path equals the storage location, mutation success only after reliable readback, stale displayed-root rejection, host capability registration, real adapter no-shell behavior, Tier 0 preservation, failure isolation, and propagation of both notChecked and diagnosticsTruncated. These are already assigned by O2 §3/§7.3 and `batches.md:4309`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/unscoped request | YES | unchecked/unscoped at `go-vet-checker.ts:621` | No vet process. |
| Absent/malformed/not-ready consent | YES | off at `go-vet-consent-store.ts:164` | Host integration still required. |
| Binary upgrade / root replacement | YES | stale at `go-vet-consent-store.ts:224` | Metadata identity/null-inode limits follow O2. |
| Missing requested file in existing package | NO | Directory accepted at `go-vet-checker.ts:558` | Finding 1. |
| Build-excluded or missed cgo file | NO | Credited at `go-vet-checker.ts:589` | Finding 1. |
| Outward module junction | NO | Lexical containment at `go-vet-checker.ts:305` | Finding 2. |
| Adjusted diagnostic outside root | NO | Dropped at `go-vet-checker.ts:494` | Finding 3. |
| More than 20 packages / 500 findings | YES | Named omission / truncation at `:582`, `:495` | 37b must propagate flags. |
| Analyzer error / compile failure | YES | failed at `go-vet-checker.ts:710`, `:716` | Partial Go findings deliberately discarded. |
| Delayed spawn, timeout, cancel, overflow | YES on normal termination path | `checker-runner.ts:101`, `:141`, `:159` | Cleanup failure is finding 4. |
| Repeated runs after revoke | YES | Fresh read at `go-vet-checker.ts:668` | Already spawned run is allowed to finish under its limit, per O2. |
| Concurrent host grant/revoke | Not established end to end | Store awaits update at `go-vet-consent-store.ts:200`, `:205` | Ordering and verified user-facing outcomes belong to 37b persistence tests. |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** in the reproduced transformations and code findings; **MEDIUM** in whole-product runtime assurance because Go and host wiring were not exercised.
- Top risk: a success-looking vet result can be attributed to files or a physical workspace that this request did not validly cover.
- What a robust implementation would add: canonical input containment, truthful file-membership accounting, loss-aware diagnostic handling, and observable cleanup failure. Fix findings 1–3 now; carry finding 4 to 37b if needed, with regression evidence checked in that next review.

