# Batch 38 Closing Review (Claude, independent of opencode/GLM) — TASK_2026_559_8ca9

Stance: refute. Read-only; no source edited (two temporary probe perturbations to
`matrix/activations/b30k.ts` and `matrix/activations/b37b.ts` were made and reverted during this
review to independently reproduce the executor's FB claims; `git status --short` on the
activations directory is confirmed clean after each).

## Verdict

**APPROVE — 8/10.**

Batch 38.1 is test-only, touches no production code, and every claim in
`batch-38-executor-report.md` that this review could independently probe reproduced exactly as
described. The one open item is Part 2: a Serious finding (R34G-03) was consciously not fixed —
correctly, on the evidence — but that leaves an un-fixed reference-scope gap in the merged C#
resolver that the completion gate does not itself test for regression. That is a documentation/
scope call, not a defect in Batch 38's own deliverable, so it does not block this gate.

## Part 1 — Batch 38 findings

### R38C-01 (Informational, not a defect) — the plan's "Required keys" table in

`implementation-plan-languages.md:471-489` is stale relative to Decision 27

- File: `implementation-plan-languages.md:484-489` (still lists `publicSymbols, graphEdges |
csharp, java | 34`, `rust | 35`, `php, ruby, cpp | 36` as required).
- `required-keys.ts:76-119` and the spec's `EXPECTED_REQUIRED_KEYS` correctly implement Decision
  27's reduction (48 keys, no java/rust/php/ruby/cpp graph rows). Decision 27 in `context.md:75`
  explicitly authorizes this scope cut and says the plan table is superseded, so this is not a
  drift the executor introduced — but the plan document itself was never edited to match, which
  will mislead a future reader who trusts the plan over the code. Recommendation for a follow-up:
  strike the deferred rows from the plan table or add a note pointing at Decision 27, same as
  `required-keys.ts`'s own doc-comment already does.
- Severity: Minor (documentation only; the enforced set is correct).

### Verified: 48-key required list matches product scope exactly

Independently counted `CAPABILITY_TABLE` (`required-keys.ts:77-119`): parse/outline/codeIndex ×
{tsx, java, rust, php, ruby, cpp, kotlin} = 21; enrichSummary:tsx = 1; syntaxDiagnostics × {python,
go, csharp, java, rust, php, ruby, cpp, kotlin} = 9; publicSymbols × {python, go, csharp} = 3;
graphEdges × {python, go, csharp} = 3; typeCheck:go = 1; 10 honesty keys. Total = 21+1+9+3+3+1+10 =
48, matching `EXPECTED_REQUIRED_KEYS`'s asserted length (`language-honesty.contract.spec.ts:230`)
and the executor report's claim. Grammar-level keys (parse/outline/codeIndex/syntaxDiagnostics)
correctly retain kotlin/php/ruby/cpp/java/rust; graph-level keys (`publicSymbols`/`graphEdges`)
correctly carry only TS/JS (pre-existing, not in this table), python, go, csharp; `typeCheck:go`
present. This matches Decision 27 exactly.

### Verified: the union-equality test truly fails on a missing key and on an extra key

Reproduced outside reliance on the executor's own claim, by directly perturbing the fragment
files and running jest (not a thought experiment):

- Moved `matrix/activations/b30k.ts` out, ran
  `npx jest -c libs/backend/workspace-intelligence/jest.config.ts language-honesty.contract.spec.ts -t "union of every activation fragment equals REQUIRED_KEYS"`
  → **FAILED** with `missing: ["codeIndex:kotlin", "outline:kotlin", "parse:kotlin", "syntaxDiagnostics:kotlin"]`.
  Restored the file; `git status --short` on the activations directory came back empty.
- Added `'graphEdges:java'` to `b37b.ts`'s `keys` array, ran the same spec filtered on
  `"REQUIRED_KEYS exactly|subset of REQUIRED_KEYS|HONESTY_CHECKS or CHECKED_ELSEWHERE"` → **3
  failures**: the subset check (`unknown: ["graphEdges:java"]`), the new completeness test
  (`extra: ["graphEdges:java"]`), and the `HONESTY_CHECKS`/`CHECKED_ELSEWHERE` coverage check
  (`missing: ["graphEdges:java"]`). Reverted; `git status --short` confirmed clean.

The fragments the test unions are discovered from disk via `fs.readdirSync(ACTIVATIONS_DIR)`
(`language-honesty.contract.spec.ts:140-147`), not derived from `REQUIRED_KEYS` itself, so the
test is not tautological — it is a real cross-check between two independently-authored sources.

### Verified: deferred-language test uses the real graph service and asserts unsupported + non-clean

`deferredLanguageGraphHonesty` (`language-honesty.contract.spec.ts:874-937`) constructs a real
`DependencyGraphService` (not the classifier stub used by `graphHonesty`/`csharpGraphHonesty`
elsewhere in the file), builds a real temp-dir graph with one supported TS file and one real
deferred-language file (Java/Kotlin/Rust/PHP/Ruby/C++, each syntactically valid), and asserts
`getDependents`/`getDependencies` are empty, `getCoverageReport(root).languages.unsupported === 1`
with `unsupportedByLanguage[language] === 1`, and `isCleanAnswer(languages) === false`. Ran it
directly: `Tests: 50 skipped, 6 passed` (six languages, one per `it.each` row) — all six pass.
This is exactly Gate item 2 from Decision 27/`batches.md:4663-4665`.

### Verified: the 24a parse-honesty gate exists and proves the claim

`ast-namespace.builder.spec.ts:619-784` has both describe blocks the report names — "24c parse
honesty (stubbed parser)" and "24c parse honesty (REAL parser, .tsx with JSX)" — each
`it.each`-parametrised over `PARSING_OPERATIONS = ['parse', 'queryFunctions', 'queryClasses',
'queryImports']`. The stubbed-parser block asserts `parseStatus: 'recovered'`, `coverage: {
census: 'complete', analyzed: 0, failed: 1 }`, `isCleanAnswer(coverage) === false`, and field
ordering (`coverage` before `file` before the list field) for all four operations; a second
`it.each` block proves the mirror case (missing parser metadata → `unknown`, never clean); a
third proves a genuinely clean parse reads clean (contrast case, so the gate isn't just
"everything fails"). The REAL-parser block runs actual tree-sitter against JSX text through the
non-JSX TypeScript grammar and gets the same `recovered`/`failed: 1`/`isCleanAnswer === false`
result for all four operations, plus an `errorNodeCount > 0` check. This is a genuine gate: it
would fail if any of the four ops read a recovered parse as clean.

### Verified: `go-vet-hostile.integration.spec.ts` skips visibly, never vacuously, and no CI installs Go

Ran the spec directly on this machine (no Go installed): `Test Suites: 1 skipped, 0 of 1 total`,
`Tests: 8 skipped, 8 total`, with the console warning
`[go-vet-hostile.integration] SKIPPED: no \`go\` binary resolves from the sanitised PATH on this
machine.`printed before the skip — Jest reports this as skipped, not passed, so it cannot be
mistaken for a green result in a summary that only checks pass/fail counts. Confirmed independently
(not just trusting the executor report) via`grep -rlE "setup-go|golang|GOROOT" .github/workflows/` → zero matches across all 21 workflow
files. The gate's Go-dependent assertions are therefore not exercised anywhere today, which is
disclosed by the report as a residual for the team leader, not concealed.

- Severity if raised as a finding: Moderate (observability/coverage gap, not a logic defect —
  the skip mechanism itself is honest and correctly gated on binary resolution, not on an
  environment flag someone could silently misconfigure to "always skip").

## Part 2 — Batch 34.1 closing fix round (commit 842b8add5)

| Finding                                                                                           | Verdict                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R34G-01 (Blocking: root-group MSBuild usings dropped)                                             | **CLOSED**                                 | `csharp-context.ts:15-39` module comment documents the root-group rule and its `csharp-project-unknown` gap; `csharp-import-resolver.spec.ts` "closing-review fixes" describe block has 3 tests for this exact scenario (no-`.csproj` root group, mixed tree, root-group `global using` reaching only the root group). Ran `npx jest ... csharp-import-resolver.spec.ts -t "closing-review fixes\|R34G\|R34C"` → **7/7 pass** (24 unrelated tests skipped by the `-t` filter, not failing).                                                                            |
| R34G-02 (Serious: `$(...)`-built `<Using>` silently dropped)                                      | **CLOSED**                                 | `csharp-context.ts:39,206,226-246` adds `unevaluatedUsings` and the new `msbuild-using-not-evaluated` gap (module comment line 39 documents it); the regression test in the same passing run above exercises a `<Using Include="$(RootNamespace).Models" />` case and checks both the flag and the disclosed gap.                                                                                                                                                                                                                                                      |
| R34G-04 (Minor: undeclared-file types filed under global namespace, minting a false-precise edge) | **CLOSED**                                 | `csharp-import-resolver.ts:104-109` distinguishes a namespace-with-only-nested-namespaces (`LINKS_NOTHING`) from a lookup miss, and the executor report's fix in `dependency-graph.service.ts` (keeping `declarations` empty-vs-absent) plus `csharp-context.ts`'s "files nowhere" handling for absent declarations is corroborated by the two named regression tests passing in the same run.                                                                                                                                                                         |
| R34C-01 (Moderate: tally-once relies on an unstated invariant)                                    | **CLOSED as documented, not code-changed** | `csharp-import-resolver.ts:112-122` `implicitImports` and the report's description match: the fix is a code comment recording the invariant (`fromFile`-independence of `outsideTheWorkspace`'s classification) plus one regression test ("a missing manifest using shared by two files is tallied once", part of the same 7/7 passing run). This is the correct remedy for a Moderate finding whose root cause is "an invariant existed but was unstated," not a wrong answer today — recording it is sufficient; no behavioural fix was needed and none was claimed. |

### R34G-03 non-adoption — judged CORRECT

The reviewer's claim was that after `using Acme;`, where `Acme` holds only nested namespaces
(e.g. `Acme.Billing`), files under `Acme.Billing` should be linked. The fix-round author checked
this against the C# language specification and left it unfixed, with the rationale recorded
in-line at `csharp-import-resolver.ts:95-103`: a using-namespace directive "specifically does not
import nested namespaces" per the C# spec, so `Acme.Billing.Invoice` never binds to a bare `using
Acme;`. This is the correct reading of C# semantics (`using Acme;` brings members of `Acme` itself
into scope, not members of nested namespaces one level down) — GLM's finding was itself mistaken
about C# import semantics. The non-adoption is not a shortcut: it is backed by a cited
authoritative source, a code comment for future maintainers, and a cross-reference to the
`referenceScopeComplete: false` gap that already discloses the qualified-reference case this
scenario actually falls into (a file writing `Acme.Billing.Invoice` outright depends on it via no
directive, which is a different, already-disclosed gap). I did not find a counter-example where
this reasoning fails. **Judgment: correctly not adopted; closing it as a non-fix is the right
outcome, and the accompanying comment prevents this from silently regressing into "should be
fixed" folklore later.**

## Part 3 — Overall honesty regression sweep (graph tools, whole-task diff)

Scope: `git diff origin/main...HEAD --stat` for orientation (19 files, +7845/-279, concentrated in
`import-resolution/*` and `dependency-graph.service.ts`, all net-new resolver infrastructure this
task built). A full line-by-line re-review of ~7,800 added lines is out of scope for a batch-38
completion-gate review — that surface has already been through dedicated batch reviews (23a/23b,
24d, 32b/32c, 33, 34/34.1, each with their own closing reviews in `reviews/`). This review instead
ran a targeted sweep for the specific regression shapes this repository's honesty contract
guards against (silent-clean defaults, empty catch blocks, stub markers) across the diff:

```
git diff origin/main...HEAD -- .../import-resolution .../dependency-graph.service.ts \
  | grep -nE "TODO|FIXME|catch \(.*\) \{\s*\}|catch\s*\{\s*\}|clean:\s*true|isCleanAnswer.*true\)|// stub|not implemented"
```

Zero matches. No new honesty regression was found in this pass. This is not a certification of
the full 7,800-line diff (see the caveat above) — it is targeted evidence that the specific
failure shapes this task has repeatedly had to fix (silent success, unmarked stubs) are not newly
present, combined with the fact that the deferred-language and 24a gates added in Batch 38 itself
now actively test the honesty property at the graph-tool boundary going forward.

## Five logic questions

1. **Silent failure:** none found in Batch 38's own diff (test-only). The closest residual is the
   go-vet-hostile integration spec (Part 1) — its skip is visible in Jest's suite count, not
   silent, but a CI run that greps only for "0 failed" without reading suite-skip counts would
   treat a Go-toolchain regression as a pass. Moderate, pre-existing, disclosed by the executor.
2. **Unexpected user action:** none — this batch adds no MCP-facing behaviour, only test
   infrastructure. Not applicable.
3. **Wrong-answer input data:** the deferred-language test only proves the six languages it lists;
   a seventh deferred language added later without its own row would not be caught until someone
   remembers to add it (the completeness test only checks the _required-keys_ list, not that every
   language absent from `CAPABILITY_TABLE`'s graph rows has a `deferredLanguageGraphHonesty` case).
   This is a real gap but matches the task's closed scope (Decision 27 names exactly six deferred
   languages); flagging as Minor for a follow-up task, not a defect here.
4. **Dependency failure:** the go-vet-hostile spec's dependency (a `go` binary) is absent here and
   in CI; handled correctly via `describe.skip`, verified above.
5. **Missing from requirements:** the plan document (`implementation-plan-languages.md`) was not
   updated to reflect Decision 27's key-list reduction, though the code and spec were (R38C-01
   above). Nothing else material found missing against Decision 27/29's stated scope for Batch 38.

## Failure modes

### Stale plan document vs. enforced key set

- Trigger: a future engineer reads `implementation-plan-languages.md:471-489` instead of
  `required-keys.ts` to learn what's required.
- Symptom: believes java/rust/php/ruby/cpp graph support is still required in this task; may
  reopen already-deferred work or misjudge Batch 38's completeness.
- Evidence: `implementation-plan-languages.md:484-487` vs. `required-keys.ts:112-118`.
- Current handling: `required-keys.ts`'s own doc-comment (lines 21-29) and Decision 27 in
  `context.md:75` carry the authoritative, current statement; the plan file is silent.
- Recommendation: one-line edit to the plan table or a pointer comment, non-blocking.

### Deferred-language gate is enumerated, not derived

- Trigger: a future task adds a seventh grammar-only (no-graph) language without updating
  `DEFERRED_GRAPH_LANGUAGES` in the spec.
- Symptom: that language's graph honesty is untested by this gate even though the gate's name
  ("deferred-language graphs are disclosed, never clean") implies full coverage.
- Evidence: `language-honesty.contract.spec.ts:855-882` (hard-coded six-language array), contrasted
  with `CAPABILITY_TABLE`'s grammar rows which are the actual source of "which languages have no
  graph capability."
- Current handling: none — relies on the next task's author remembering to extend the array.
- Recommendation: for the follow-up task (34.2/35/36a-c), add a cross-check that every grammar
  language absent from the `publicSymbols`/`graphEdges` rows appears in `DEFERRED_GRAPH_LANGUAGES`
  (or its successor), so removing the deferral without extending the honesty test is caught. Not
  blocking for Batch 38, since Decision 27's six languages are all covered today.

## Blocking issues

None found.

## Serious issues

None found in Batch 38 itself. R34G-03 (Serious, from Batch 34.1's original review) is closed by
sound technical rebuttal, not left open — see Part 2.

## Moderate and minor issues

- Moderate: go-vet-hostile.integration.spec.ts's Go-dependent path is untested in every CI
  workflow (`.github/workflows/*.yml`, 0/21 matches for `setup-go`/`golang`/`GOROOT`) — disclosed,
  not hidden, by the executor; recommend a follow-up task add a `setup-go` step.
- Minor: `implementation-plan-languages.md:471-489` not updated for Decision 27 (R38C-01 above).
- Minor: `DEFERRED_GRAPH_LANGUAGES` is a hand-maintained list, not derived from `CAPABILITY_TABLE`
  (failure mode above).

## Data flow

1. `required-keys.ts` `CAPABILITY_TABLE` + `HONESTY_KEYS` → `REQUIRED_KEYS` (union). **OK** —
   independently recounted to 48.
2. Each `matrix/activations/<batch>.ts` fragment declares its claimed keys, discovered from disk
   by `discoverFragments()`. **OK** — proven to be a real, non-tautological source by perturbation.
3. `language-honesty.contract.spec.ts`'s new completeness test diffs (2) against (1) in both
   directions (missing, extra). **OK** — proven to fail on both perturbations.
4. `deferredLanguageGraphHonesty` drives the real `DependencyGraphService` for the six deferred
   languages and asserts `unsupported`/`unsupportedByLanguage`/`isCleanAnswer(false)`. **OK** —
   ran and passed for all six.
5. The 24a gate (pre-existing, `ast-namespace.builder.spec.ts`) is confirmed still present and
   passing, not re-written by this batch. **OK**.
6. `go-vet-hostile.integration.spec.ts` degrades to `describe.skip` with a visible warning when no
   Go binary resolves; CI never installs Go, so this path is dark end-to-end today. **Gap disclosed,
   not hidden** — see Moderate finding above.

## Requirements fulfilment

| Requirement                                                                            | Status            | Gap                                                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 48-key required list matches product scope (Decision 27)                               | COMPLETE          | None found; independently recounted.                                                                                              |
| Union-equality test fails on missing and extra key                                     | COMPLETE          | Independently reproduced both directions.                                                                                         |
| Deferred-language graph honesty (java/kotlin/rust/php/ruby/cpp) via real graph service | COMPLETE          | Ran; 6/6 pass. Not derived from the capability table (Minor, noted above).                                                        |
| 24a parse-honesty gate present and proving the claim                                   | COMPLETE          | Pre-existing from 24c; re-verified running and correct.                                                                           |
| go-vet-hostile skips visibly, never vacuously; CI Go-install status disclosed          | COMPLETE          | Skip behaviour correct; CI gap is real and disclosed, not a defect of this batch.                                                 |
| Batch 34.1 fix round (R34G-01/02/04, R34C-01)                                          | COMPLETE (closed) | None found in scope of this review's checks.                                                                                      |
| R34G-03 non-adoption judged                                                            | COMPLETE          | Judged correct on C# spec grounds.                                                                                                |
| Whole-diff honesty regression sweep                                                    | PARTIAL           | Targeted pattern sweep only; full manual line review of ~7,800 added lines out of scope for this gate review (see Part 3 caveat). |

Implicit requirements not addressed: none identified beyond the plan-doc staleness (Minor) and the
hard-coded deferred-language list (Minor), both noted above.

## Edge cases

| Case                                                            | Handled | How                                                         | Concern                                                    |
| --------------------------------------------------------------- | ------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Missing activation fragment                                     | YES     | Completeness test's `missing` set                           | None — reproduced                                          |
| Extra/unclaimed activation key                                  | YES     | Completeness test's `extra` set + two other existing checks | None — reproduced                                          |
| Deferred-language file mixed with a supported file in one graph | YES     | `deferredLanguageGraphHonesty`, real service                | None — ran, passed                                         |
| Recovered (error-recovery) parse on all 4 AST sub-ops           | YES     | 24c gate, stub + real parser                                | None — pre-existing, still passing                         |
| No `go` binary present                                          | YES     | `describe.skip` + console.warn                              | CI never exercises the non-skip path (Moderate, disclosed) |
| A future 7th deferred grammar-only language                     | NO      | N/A                                                         | Hard-coded array won't auto-flag it (Minor)                |

## Verdict

- **Recommendation: APPROVE**
- **Confidence: HIGH** — every quantitative claim in the executor report that was checkable was
  independently reproduced by running the actual perturbed tests, not by re-reading the report's
  prose.
- **Top risk:** the Go-toolchain-dependent diagnostics path (`go-vet-hostile.integration.spec.ts`
  and, by extension, the real `typeCheck:go` behaviour under actual `go vet` output) has never run
  in this repository's CI and is not exercised by this worktree either — the gate is honest about
  skipping, but the underlying capability it gates has zero real-binary coverage in the pipeline
  that will actually ship this.
- **What a robust implementation would add:** (1) a `setup-go` CI job (even nightly-only) to
  exercise `go-vet-hostile.integration.spec.ts` for real at least once per release; (2) a
  structural cross-check tying `DEFERRED_GRAPH_LANGUAGES` to `CAPABILITY_TABLE` so a future
  capability reduction/addition can't silently outrun the honesty test; (3) a one-line update to
  `implementation-plan-languages.md`'s Required-keys table so the plan and the enforced list never
  visibly disagree.
