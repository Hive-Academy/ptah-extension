# Code Logic Review — Batch 20 (Tasks 20.1 + 20.3, "20a") — r1

Cross-side reviewer (Claude), reviewing an Antigravity CLI lane's work. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-d`, branch `fix/task-559-lane-d`.

## Summary

| Metric              | Value |
| ------------------- | ----- |
| Overall score       | 7/10 |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0 |
| Serious issues      | 1 |
| Moderate issues     | 1 |
| Minor issues        | 2 |
| Failure modes found | 2 |

## Scope examined

Full read of `fixture-workspace.ts` (662 lines), `fixture-workspace.spec.ts` (163 lines), `reducers.bench.spec.ts` (747 lines). Cross-checked against batches.md Batch 20 (20.1/20.3 quality requirements), Batch 2 amendment (reducer contract), context.md User Decision 7 (reducer pipeline, "specs on size AND preserved content"). Verified module-boundary claim by grep (no `workspace-intelligence` import in `tool-output-reducers`), verified `DEFAULT_TOOL_RESULT_BUDGET_TOKENS` actually lives in `vscode-lm-tools/tool-result-budget.ts` (not this lib), verified `workspace-intelligence` build uses esbuild bundling from `src/index.ts` (so an un-exported, unimported `src/testing/**` file is not shipped even though `tsconfig.lib.json` does not exclude it). Ran `nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers --skip-nx-cache` myself: all 6 targets green.

## Mutation results

| Mutation | Would the guard catch it? | Evidence |
| --- | --- | --- |
| Log reducer drops context lines (author's own claimed break: `ERROR_CONTEXT=0`, `growRegions()` disabled) | YES | `reducers.bench.spec.ts:511-516` asserts every line of all 3 `failureBlocks` (context + failure) via `toContain`; author's report shows the exact failing assertion with a `[setup-context]` line — plausible and matches the assertion shape |
| JSON reducer drops a scalar field from a kept row | YES | `reducers.bench.spec.ts:480-483` loops all 300 rows asserting `toContain(row.s)`; dropping any row's `s` value fails deterministically (values `s1..s300` are unique substrings) |
| Markdown outline drops a heading | YES | `reducers.bench.spec.ts:599-601` and `:717-719` assert every one of 31 headings present verbatim; a dropped heading fails |
| HTML extractor drops the article title | YES | `reducers.bench.spec.ts:448-450` loops all 4 headings including `headings[0]` (the H1 title); table-driven sweep (`:618`) also checks it |
| Budget silently raised (e.g. `2000`→`3000` in the real wiring) | NO — out of this batch's reach | The spec hardcodes its own local `DEFAULT_BUDGET = {budgetTokens:2000,...}` (`reducers.bench.spec.ts:13-16`) and calls `reduceOutput` directly; it never imports the production constant `DEFAULT_TOOL_RESULT_BUDGET_TOKENS`, which lives in `vscode-lm-tools/mcp-core/tool-result-budget.ts` and cannot be imported here (`type:util` boundary). This benchmark verifies the *reducer pipeline's* behaviour at a given budget, not the *wired default*. Batch 21.1 (`mcp-contract.sweep.spec.ts`, "pin the total tools/list JSON size") is the batch that must own this mutation — flagging it here as a residual gap this batch does not close, not a defect of this batch's own contract. Recommend the team-leader confirm Batch 21.1 actually pins the numeric default, not just per-tool `_meta` caps. |

## Five logic questions

### 1. How does this fail silently?
Not silently in the reducer bench itself — every assertion is a hard `expect` that fails the run, no swallowed try/catch, no `console.log`-only checks. The one silent-failure risk is architectural, not in this diff: `fixture-workspace.ts:647-653` `cleanup()` wraps `fs.rmSync` in `try { } catch { /* ignore */ }`. If cleanup fails (e.g. a locked file on Windows), the temp dir is orphaned with no signal to the test runner or CI — acceptable for a throwaway `os.tmpdir()` entry, but worth noting since Windows file locking is exactly the kind of flake this task asked to check for.

### 2. What user action produces unexpected behaviour?
Not user-facing (test-only code). The nearest analogue: a caller of `createMcpContractFixture({ seed: X })` reasonably expects the seed to control generation (that is the parameter's whole purpose, and the fixture spec explicitly tests "two independent builds with the same seed produce identical output" as if this were seed-dependent). It is not — see Serious issue below.

### 3. What input data produces a wrong answer?
`knownSymbols[].line` for `libs/shared-core/src/auth-session.ts`, `apps/react-client/src/client-layout.tsx`, and `apps/web-app/src/main-controller.ts` are hard-coded and wrong by a consistent off-by-2 (see Serious issue). Any future consumer (Task 20.2, explicitly named in batches.md as the fixture's consumer) that trusts `knownSymbols[].line` for exact-line assertions will either get spurious failures against correct production code, or silently accept a wrong ground truth — either way the fixture's own contract ("actually useful for 20.2") is compromised for 7 of its ~24 symbols.

### 4. What happens when a dependency fails?
`gpt-tokenizer` (`countTokensPiecewise`) is treated as always available and synchronous; no failure path is exercised or needed here since it's a pure local library call, consistent with the rest of the `tool-output-reducers` lib (no I/O, no host dependency). No gap found.

### 5. What is missing that the requirements never mentioned?
The requirements never asked the 20.1 fixture spec to verify its own `line` metadata against the files it writes — `fixture-workspace.spec.ts:132-154` checks only that `fileContent.toContain(sym.name)`, never that `fileContent.split('\n')[sym.line - 1]` actually contains the symbol. That is precisely the gap that let the off-by-2 error ship green.

## Failure modes

### Wrong `line` metadata for import-preceded files
- Trigger: any file in the fixture whose first declared symbol follows an `import` statement (`auth-session.ts`, `client-layout.tsx`, `main-controller.ts`).
- Symptom: `knownSymbols[].line` is 2 less than the symbol's real line (e.g. `SessionUserCredentials` claimed line 4, actually line 6; `AuthSessionService` claimed line 9, actually line 11; `verifySessionValidity` claimed 15, actually 17; `defaultSessionTimeoutMs` claimed 19, actually 21; `ClientAppLayoutView` claimed 4, actually 6; `MainWebController` claimed 4, actually 6; `initializeApplicationHost` claimed 12, actually 13).
- Evidence: `fixture-workspace.ts:445-474` (auth-session), `:546-552` (client-layout), `:583-598` (main-controller) — hand-typed `line:` literals, not computed from `lines.length`. Contrast with `token-utils.ts` (`:395-417`) and `navigation-bar.tsx` (`:508-530`), which have no leading import and whose hard-coded lines are correct, confirming the author simply mis-counted the import + blank-line pair when hand-authoring the numbers for files that do have one.
- Current handling: none — not caught by `fixture-workspace.spec.ts`, not caught by lint/typecheck (plain data literal).
- Recommendation: compute `line` the same way `generate300LineTsSource()` already does (`lines.length + 1` at push time) for every symbol in every generated file, instead of hand-counting; add a spec assertion that `fileContent.split('\n')[sym.line - 1]` contains `sym.name` for every `knownSymbol`.

### Seeded RNG is dead code
- Trigger: any call to `createMcpContractFixture({ seed })`.
- Symptom: the `seed` option has zero effect on the generated tree — `createSeededRng(seed)` is called and its return value (the `next()` generator) is discarded (`fixture-workspace.ts:268`, `// seed initialized`). All content is fully static string literals; no call site ever invokes the RNG.
- Evidence: `fixture-workspace.ts:268` plus the absence of any other reference to the local `createSeededRng` binding's result in the rest of the file.
- Current handling: `fixture-workspace.spec.ts:79-130` asserts "two independent builds with the same seed produce identical output" — true, but vacuously so (two builds with *different* seeds, or no seed at all, would also be identical, since nothing reads the seed). This test does not exercise what it claims to.
- Recommendation: either wire the RNG into at least the flat-directory content/order (the one place variable content would be plausible) so the determinism test is non-vacuous, or drop the seed option and the dead `createSeededRng` call, and rewrite the determinism spec to assert determinism directly (build twice with no seed argument, compare) rather than imply seed-dependence.

## Blocking issues

None.

## Serious issues

### Hard-coded `KnownSymbol.line` values are wrong for 7 of ~24 symbols
- File: `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts:445-474,546-552,583-598`
- Scenario: any consumer (Task 20.2 or later) that asserts exact line numbers from a real symbol indexer against `knownSymbols[].line`.
- Impact: either a false "regression" report against correct production code (CI flakiness — exactly the failure mode this review was asked to treat as the highest bar), or a silently wrong ground truth that a lenient consumer never notices, quietly weakening the guard's precision for 559's stated goal ("make sure we don't end up with future regressions again").
- Fix: derive every `line` value the way `generate300LineTsSource()` already does — from `lines.length` at push time — and add a self-check spec asserting the claimed line's actual file content matches the symbol name.

## Moderate and minor issues

- Moderate: `libs/backend/workspace-intelligence/tsconfig.lib.json` does not exclude `src/testing/**/*` the way `platform-core/tsconfig.lib.json` does (executor's own report acknowledges this at report §2). Verified this does **not** leak into the shipped bundle — `project.json:8-17` builds via `@nx/esbuild:esbuild` from `src/index.ts`, and no production file imports `testing/mcp-contract` (grep confirmed) — so the `typecheck` target compiles it but the dist output does not contain it. Recommend adding the exclude anyway, for consistency with the established pattern and to keep `typecheck` scoped to shippable code, but this is not a functional defect.
- Minor: `reducers.bench.spec.ts:481` (`expect(result.text).toContain(String(row.id))`) is a raw numeric substring check; for the 1–300 range used here it happens not to collide, but the assertion methodology is fragile in principle (a stronger check would assert the row's `id`+`s` pair renders as one recognisable unit, not two independent substring hits that could theoretically be satisfied by unrelated surviving rows).
- Minor: `fixture-workspace.ts:274-283` builds `abs()` over the pre-normalisation `root` (OS-native separators) while the returned `fixture.root` is forward-slash-normalised (`toForwardSlash`, `:275,656`); `knownSymbols[].absolutePath` and `knownEdges[].fromPath/toPath` are therefore OS-native while `fixture.root` is not. Works today (both `fs` calls and `path.join` tolerate mixed separators on Windows), but a future consumer doing string-prefix matching between `fixture.root` and `absolutePath` would find they don't share a literal prefix on Windows.

## Data flow

1. `createMcpContractFixture()` allocates a temp dir via `mkdtempSync` — OK.
2. Writes root config (`nx.json`, `package.json`, `tsconfig.base.json`) with mixed `react`/`@angular/core` deps, no `angular.json` — OK, matches requirement.
3. Writes 4 app/lib `project.json` files with distinct executors — OK, matches requirement (Nx-shaped, apps own their `project.json`).
4. Writes TS/TSX sources with hand-authored `knownSymbols`/`knownEdges` and hand-typed line numbers — gap: line numbers wrong for 3 of 6 authored files (see Serious issue).
5. Generates the 300-line file programmatically with computed line numbers — OK, correct pattern, just not applied consistently elsewhere.
6. Writes 500 flat files — OK, matches requirement, count asserted in spec.
7. `cleanup()` — OK, `try/finally` used at every call site in the spec; swallows its own `rmSync` errors (acceptable for `os.tmpdir()`).
8. `reduceOutput()` (bench spec) is exercised per content kind with realistic, large, hand-checkable fixtures, and every "preserved content" claim is checked exhaustively (every row, every heading, every failure block), not sampled — OK, this is the strongest part of the deliverable.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 20.1: Nx-shaped monorepo, mixed root deps, no root angular.json | COMPLETE | none |
| 20.1: apps own `project.json` | COMPLETE | none |
| 20.1: 500-file flat directory | COMPLETE | none |
| 20.1: TS/TSX with known exported symbols, import edges, camelCase identifiers | PARTIAL | symbols/edges present and named correctly; `line` metadata wrong for 7 symbols |
| 20.1: exactly 300-line TS file | COMPLETE | verified: generator pads to exactly 300 |
| 20.1: deterministic seed | PARTIAL | seed parameter is accepted but has no effect (dead RNG); determinism holds only because generation is fully static |
| 20.1: cleans up after itself | COMPLETE | `try/finally` at every call site; swallowed rmSync errors are an accepted risk for temp dirs |
| 20.1: not exported from barrel | COMPLETE | verified, `index.ts` has no `testing` export |
| 20.1: no module-boundary violation | COMPLETE | verified via grep + esbuild entry-point bundling |
| 20.3: size assertions (tokens ≤ budget AND ≤ pinned ratio, dated) | COMPLETE | all 6 kinds pinned with 10-15% headroom, dated 2026-09-26 |
| 20.3: preserved-content assertions per kind | COMPLETE | exhaustive, not sampled, for all 6 kinds |
| 20.3: fails on regression, never only logs | COMPLETE | hard `expect`, no log-only paths; author's own reverted break reproduced a real failure |
| 20.3: runtime < 10s | COMPLETE | reported 2.34s; not independently re-timed beyond the full `test,lint,typecheck` run (65s combined, both projects) which stayed well inside CI norms |

Implicit requirements not addressed: a self-check that the fixture's own `line` metadata is internally consistent with the files it writes (see Serious issue).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Cleanup after assertion failure | YES | `try/finally` in every spec test | none |
| Fixture line metadata correctness | NO | not checked anywhere | false ground truth for downstream consumers |
| Windows path separator consistency between `root` and `absolutePath` | PARTIAL | both work today via `path`/`fs` tolerance | latent, not exercised |
| No-outliner code fallback | YES | explicit `outliner: undefined` test case, asserts fallback reducer name and content survival | none |
| JSON reducer given empty/scalar-only input | N/A (out of scope) | not part of this batch's fixtures | covered in Batch 2b/2a specs, not re-tested here |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the fixture's hard-coded `line` numbers are wrong for exactly the files most likely to matter to Task 20.2 (files with realistic import structure), and nothing in 20.1's own spec would catch it — the defect is invisible until a downstream consumer trusts the number.
- What a robust implementation would add: (1) compute every `KnownSymbol.line` the same way the 300-line generator already does, and add a spec that cross-checks the claimed line against the actual file content; (2) either wire the seed into real content variation or stop implying seed-dependence in the fixture and its spec; (3) add `src/testing/**/*` to `tsconfig.lib.json`'s exclude list for consistency with `platform-core`'s established pattern, even though it does not currently leak into the shipped bundle.
