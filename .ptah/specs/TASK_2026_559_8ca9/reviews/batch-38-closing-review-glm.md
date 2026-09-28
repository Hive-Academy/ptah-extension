# Batch 38 Closing Review — GLM (refute stance)

Verdict: APPROVE

Score: 9/10

## Findings

### R38G-01 — Moderate (documentation only, per review charter)

- File: `.ptah/specs/TASK_2026_559_8ca9/implementation-plan-languages.md:485-487`
- The plan's "Required keys" table still lists `publicSymbols, graphEdges | csharp, java (34)`, `rust (35)` and `php, ruby, cpp (36)`. Decision 27 removed the java/rust/php/ruby/cpp graph keys. Line 640 ("Edit 4") is stale too: it still says "php/ruby/cpp `publicSymbols`/`graphEdges` and 36 required; gate 38 waits for 30k, 36, 37b".
- Concrete effect: `required-keys.ts:91` documents `CAPABILITY_TABLE` as "verbatim (`implementation-plan-languages.md:471-489`)", so the code now knowingly diverges from the table it claims to mirror verbatim.
- Fix: update the plan table (and line 640) to record the Decision 27 deferral, or soften the "verbatim" comment to cite the amendment.

### R38G-02 — Minor (documentation)

- File: `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts:5-6`
- The header still names "27, 29b, 30, 30k, 31, 33, 34, 35, 36a-c, 37b" as activating batches. No `b35` or `b36*.ts` fragment exists (only `b27-baseline`, `b29b`, `b30`, `b30k`, `b31`, `b33`, `b34`, `b37b`), and Decision 27 means none ever will in this task.
- Fix: drop 35/36a-c from the list, or mark them "deferred (Decision 27)".

### R38G-03 — Minor

- File: `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts:851-854` (comment) and `:905-925` (assertions)
- The comment says "One real TS file proves the graph still does real work alongside the deferred file". No assertion reads the TS file's own edges or an `analyzed` count; the contrast is pinned only indirectly, through `languages.unsupported !== 1` (a second unsupported file would break the count). That is sufficient to detect the regression it guards against, but the comment overstates the directness of the proof.
- Fix: either weaken the comment or add one assertion (for example `languages.analyzed === 1` or a non-empty edge on the TS file) that makes the contrast direct.

### R38G-04 — Minor

- File: `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts:904-933`
- `deferredLanguageGraphHonesty` reports failures by throwing `new Error(...)` instead of `expect(...)`. Failure messages are clear and the tests do fail, but jest diffing is lost. Consistent with the file's existing helper style, so this is a nit, not a defect.

No blocking or serious findings. No fabricated findings needed; the above is the complete list the evidence supports.

## Answers

### 1. Is the 48-key required list right, and does the union-equality test really fail on missing AND extra?

**Right, and yes — both directions fail.** The list in `required-keys.ts` (`CAPABILITY_TABLE` + 10 `HONESTY_KEYS`, lines 91-127) is exactly:

- `parse`/`outline`/`codeIndex`: tsx, java, rust, php, ruby, cpp, kotlin (21 keys)
- `enrichSummary`: tsx (1)
- `syntaxDiagnostics`: python, go, csharp, java, rust, php, ruby, cpp, kotlin (9)
- `publicSymbols`/`graphEdges`: python, go, csharp only (6)
- `typeCheck`: go (1)
- honesty: 10

Total 48, matching `EXPECTED_REQUIRED_KEYS` (`language-honesty.contract.spec.ts:182-259`, length asserted at `:267`). No graph key exists for java, kotlin, rust, php, ruby or cpp — matches Decision 27 and the review scope. TS/JS carries no graph key by design: the TS/JS graph is the incumbent capability (`implementation-plan-languages.md:221`: "`publicSymbols` and `graphEdges` true for js/ts only" from Batch 22), so no honesty key is owed for it. Python/Go/C# likewise owe no `parse`/`outline`/`codeIndex` key — incumbent `codeIndex` per line 221; only their newly-required capabilities are keyed.

The union test (`language-honesty.contract.spec.ts:319-326`) computes `missing = required − activated` and `extra = activated − required` and asserts `expect({ missing, extra }).toEqual({ missing: [], extra: [] })`. Jest `toEqual` is a two-way structural comparison, so a non-empty `missing` array and a non-empty `extra` array each make the object unequal and fail the test. Runtime evidence: I ran the spec — 56/56 passed, including this test and the pre-existing "every activated key is required" test, so both directions are live, not vacuous. A key removed from the fragments would surface in `missing`; a stale fragment key (for example a leftover `graphEdges:java` in `b34.ts`) would surface in `extra`. `b34.ts` now claims only `['graphEdges:csharp', 'publicSymbols:csharp']` (`b34.ts:25`).

### 2. Does the deferred-language test use the real DependencyGraphService and assert unsupported counts and a non-clean answer?

**Yes, on all six languages.** `deferredLanguageGraphHonesty` (`language-honesty.contract.spec.ts:878-944`, gate describe at `:946-956`) builds `new DependencyGraphService(analysis, realFileSystem(), silentLogger())` where `analysis` is the file's shared real `AstAnalysisService` over a real `TreeSitterParserService` (`:164-171`), and `realFileSystem()` reads the temp tree from disk with `fs.readFileSync` (`:368-370`). It calls `svc.buildGraph([supportedFile, deferredFile], root)` and asserts, per language:

- `getDependents(deferredFile)` and `getDependencies(deferredFile)` are both empty;
- `coverage.languages.unsupported === 1` and `unsupportedByLanguage[language] === 1`;
- `isCleanAnswer(languages)` is false.

`it.each` covers java, kotlin, rust, php, ruby, cpp (`DEFERRED_GRAPH_LANGUAGES`, `:853-901`). All six passed in my run (56/56). The TS-file contrast is only indirect (`unsupported === 1` implies the second file was analysed — see R38G-03), which is why this is not a 10.

### 3. Is the Required-keys table in implementation-plan-languages.md stale?

**Yes — doc finding only.** Lines 485-487 still carry the pre-Decision-27 rows (`csharp, java (34)`, `rust (35)`, `php, ruby, cpp (36)`), and line 640 (Edit 4) still says the gate "waits for 30k, 36, 37b". See R38G-01.

### 4. Does go-vet-hostile.integration.spec.ts skip visibly when Go is not installed?

**Yes.** I ran `npx jest -c libs/backend/workspace-intelligence/jest.config.ts .../diagnostics/external-checkers/go-vet-hostile.integration.spec.ts` on this machine (no `go` binary on the sanitised PATH): suite reported `1 skipped`, tests `8 skipped, 8 total`, and the skip is announced by a visible `console.warn` at `go-vet-hostile.integration.spec.ts:57-59`: "[go-vet-hostile.integration] SKIPPED: no `go` binary resolves from the sanitised PATH on this machine." The skip is neither silent nor reported as a pass.

## C# verification (commit 842b8add5)

**CLOSED — both gaps, with passing proof tests.**

`git show 842b8add5 -- src/ast/import-resolution/csharp-context.ts` shows the new module implementing exactly what the commit message claims: `findCSharpProjects` lists every C# file's directory chain for `.csproj`, `Directory.Build.props` and `Directory.Build.targets` (`isMsbuildManifest` accepts all three); a failed or capped listing sets `complete: false` (the `csharp-project-unknown` gap); and `<Using>` values built from a property are not evaluated (`msbuild-using-not-evaluated` gap). Files outside every `.csproj` form the root group, and the nearest `Directory.Build.props`/`.targets` `<Using>` items apply to them.

Proving tests, both in `libs/backend/workspace-intelligence/src/ast/import-resolution/csharp-import-resolver.spec.ts`, both passing (31/31 in my run):

- `csharp-project-unknown`: "R34G-01: with no .csproj, Directory.Build.props usings reach root-group files, and the guess is disclosed" (`:565-602`). A tree with only `Directory.Build.props` declaring `<Using Include="Acme.Billing" />` and `App/Program.cs` outside any project: `Program.cs`'s dependencies reach `Billing/Invoice.cs` and `Billing/Order.cs`, coverage context is `partial`, `isCleanAnswer` is false, `ctx.gaps` contains `csharp-project-unknown` (`:591`), and `implicitImports` returns the `Acme.Billing` global using with `declaredOutsideGraph: true`. The mixed-tree variant (`:604-613`) proves the props usings reach both the project file and the file outside it. A second gap assertion sits at `:379`.
- `msbuild-using-not-evaluated`: "R34G-02: a property-built <Using> value is disclosed, not skipped silently" (`:622-651`). `readMsbuildItems` on `<Using Include="$(RootNamespace).Models" />` returns `{ usings: [], unevaluatedUsings: true }`, and `ctx.gaps` contains `msbuild-using-not-evaluated` (`:649`).

## Verification evidence

- `language-honesty.contract.spec.ts`: 56/56 passed (6.4 s) — includes the 48-key snapshot, the union-equality test, and all six deferred-language tests.
- `csharp-import-resolver.spec.ts`: 31/31 passed (7.8 s).
- `go-vet-hostile.integration.spec.ts`: 8/8 skipped with visible `console.warn` (Go absent on this machine).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the stale plan-doc table (R38G-01) invites a future editor to "restore" the removed graph keys, because the code comment still claims verbatim parity with that table.
- What a robust implementation would add: a one-line amendment to `implementation-plan-languages.md:485-487` and `:640`, a corrected batch list in `required-keys.ts:5-6`, and (optionally) a direct TS-file contrast assertion in the deferred-language gate.
