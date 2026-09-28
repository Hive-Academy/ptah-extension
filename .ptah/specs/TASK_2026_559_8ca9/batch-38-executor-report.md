# Batch 38 Executor Report — Completion gate (TASK_2026_559_8ca9)

## Scope

Task 38.1 only (Batch 38a already COMPLETE). Files touched:

- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
- `.ptah/specs/TASK_2026_559_8ca9/batches.md` (heading only)

No production code was changed. No product defects were found.

## 1. Required-key list, reduced per Decision 27

Decision 27 (2026-09-28) defers the Java graph (34.2), Rust (35) and PHP/Ruby/C++
(36a-c) dependency graphs to a follow-up task. `required-keys.ts`'s
`CAPABILITY_TABLE` previously carried `publicSymbols`/`graphEdges` rows for
`java`, `rust`, `php`, `ruby`, `cpp` (10 keys); these rows are removed. The
grammar-level rows (`parse`/`outline`/`codeIndex`/`syntaxDiagnostics` for every
grammar language, including kotlin/php/ruby/cpp/java/rust) are untouched —
already landed, still required.

`REQUIRED_KEYS` now (48 keys, sorted, exactly what
`EXPECTED_REQUIRED_KEYS` in the spec pins):

```
codeIndex:cpp, codeIndex:java, codeIndex:kotlin, codeIndex:php, codeIndex:ruby,
codeIndex:rust, codeIndex:tsx,
outline:cpp, outline:java, outline:kotlin, outline:php, outline:ruby,
outline:rust, outline:tsx,
parse:cpp, parse:java, parse:kotlin, parse:php, parse:ruby, parse:rust, parse:tsx,
enrichSummary:tsx,
syntaxDiagnostics:cpp, syntaxDiagnostics:csharp, syntaxDiagnostics:go,
syntaxDiagnostics:java, syntaxDiagnostics:kotlin, syntaxDiagnostics:php,
syntaxDiagnostics:python, syntaxDiagnostics:ruby, syntaxDiagnostics:rust,
graphEdges:csharp, graphEdges:go, graphEdges:python,
publicSymbols:csharp, publicSymbols:go, publicSymbols:python,
typeCheck:go,
honesty:ptah_ast_analyze, honesty:ptah_code_reindex,
honesty:ptah_code_search_symbols, honesty:ptah_context_enrich_file,
honesty:ptah_get_dependencies, honesty:ptah_get_dependents,
honesty:ptah_get_diagnostics, honesty:ptah_get_symbol_index,
honesty:ptah_lsp_definitions, honesty:ptah_lsp_references
```

No `graphEdges`/`publicSymbols` key exists for java, kotlin, rust, php, ruby or
cpp. The union of every activation fragment (`b27-baseline`, `b29b`, `b30`,
`b30k`, `b31`, `b33`, `b34`, `b37b`) equals this list exactly — a new test
(below) enforces that equality, not just "fragments are a subset."

## 2. New completeness test (union == REQUIRED_KEYS exactly)

`language-honesty.contract.spec.ts`, structure describe block, new test:

> "Task 38.1: the union of every activation fragment equals REQUIRED_KEYS
> exactly — no key missing, none extra"

Computes `missing` (required, not activated) and `extra` (activated, not
required) and asserts both are empty. The pre-existing tests only checked
"fragment ⊆ required" and "no duplicate owner"; neither would catch an
under-claimed required key. This one does (see FB evidence below).

## 3. Deferred-language graph honesty (Gate list addition 2)

New describe block, `language-honesty.contract.spec.ts`:

> "language-honesty matrix — deferred-language graphs are disclosed, never
> clean (Task 38.1, Decision 27)"

One parametrised test (`it.each`) over Java, Kotlin, Rust, PHP, Ruby, C++
(function `deferredLanguageGraphHonesty`), through the REAL
`DependencyGraphService` (not the classifier stub used elsewhere in the file):
builds a graph from one real supported TypeScript file plus one real file of
the deferred language (valid syntax, e.g. a minimal Java class, a Kotlin
`fun main`, a Rust `fn main`, PHP/Ruby classes, a C++ `main`), then asserts:

- `getDependents`/`getDependencies` for the deferred file are both empty;
- `getCoverageReport(root).languages.unsupported === 1` and
  `unsupportedByLanguage[<language>] === 1`;
- `isCleanAnswer(languages)` is `false`.

This extends (does not replace) the existing single-language spot checks
already in the file — `csharpGraphHonesty` (java + kotlin beside the C# graph)
and `graphHonesty` (kotlin beside the TS/Python graph) — with one test that
covers all six deferred languages explicitly, per the task's "one parametrised
test" instruction.

## 4. FB evidence

**Missing fragment** — moved `matrix/activations/b30k.ts` out of the
directory, ran `nx test @ptah-extension/workspace-intelligence --testPathPattern="language-honesty.contract.spec.ts"`:
the new completeness test failed with
`missing: ["codeIndex:kotlin", "outline:kotlin", "parse:kotlin", "syntaxDiagnostics:kotlin"]`.
Restored the file; reran — 69/70 suites passed, 0 failed (`git diff --stat`
on the activations directory empty afterward).

**Extra key** — temporarily added `'graphEdges:java'` to `b37b.ts`'s `keys`
array, ran the same command: three assertions failed —
"every fragment key is a subset of REQUIRED_KEYS" (`unknown: ["graphEdges:java"]`),
the new completeness test (`extra: ["graphEdges:java"]`), and "every activated,
locally-owned key has an entry in HONESTY_CHECKS or CHECKED_ELSEWHERE"
(`missing: ["graphEdges:java"]`). Reverted; `git diff --stat` on `b37b.ts`
confirmed empty.

## 5. 24a gate addition (parse honesty on the four ast sub-operations)

Already landed in Batch 24c, not something this batch needed to write:
`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.spec.ts`
has two describe blocks — "24c parse honesty (stubbed parser)" and "24c parse
honesty (REAL parser, .tsx with JSX)" — each `it.each`-parametrised over
`PARSING_OPERATIONS = ['parse', 'queryFunctions', 'queryClasses',
'queryImports']`, asserting `parseStatus: 'recovered'`,
`coverage: { failed: 1, analyzed: 0 }`, `errorNodeCount > 0` and
`isCleanAnswer(coverage) === false` for a genuinely recovered parse (real
tree-sitter, JSX text run through the non-JSX grammar). This is exactly the
gate item 24a r1 M2 describes: "the gate fails if any of the four returns a
clean-looking result for a recovered parse." Verified it still runs and
passes as part of the `nx run-many` verification below (part of
`@ptah-extension/vscode-lm-tools:test`). No change was needed.

## 6. Real-Go integration spec (carried item e)

`libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-hostile.integration.spec.ts`,
lines 51-62:

```ts
const GO: ResolvedGoBinary | null = resolveGoBinary({ ... });
if (GO === null) {
  console.warn('[go-vet-hostile.integration] SKIPPED: no `go` binary resolves from the sanitised PATH on this machine.');
}
const describeWithGo = GO === null ? describe.skip : describe;
```

On this machine (no Go installed), `resolveGoBinary` returns `null`, the
warning prints, and the whole describe block runs under `describe.skip` — a
visible, explicit skip (Jest reports it as "1 test suite skipped", never as
passed). Confirmed by running
`nx test @ptah-extension/workspace-intelligence --testPathPattern="go-vet-hostile"`:
"Test Suites: 1 skipped, 69 passed, 69 of 70 total" with the console warning
printed. It never passes vacuously.

**CI**: grepped every file under `.github/workflows/*.yml` for `setup-go`,
`golang`, `GOROOT` and `go-vet-hostile` — no match in any of the 18 workflow
files (`ci.yml`, `nightly-coverage.yml`, `cli-e2e.yml`, `electron-e2e.yml`,
etc.). No workflow installs a Go toolchain, so this integration spec is
skipped in CI today, exactly as it is here, for the same reason (no `go`
resolves from PATH). This is reported for the team leader to decide whether a
follow-up task should add a `setup-go` step to one workflow (e.g.
`ci.yml`) to exercise this spec for real; no CI file was changed by this
batch.

## Changed paths

- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/required-keys.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
- `.ptah/specs/TASK_2026_559_8ca9/batches.md` (Batch 38 heading only)

## Verification

- `node_modules/.bin/nx test @ptah-extension/workspace-intelligence --skip-nx-cache --testPathPattern="language-honesty.contract.spec.ts" --maxWorkers=2` — 69/70 suites, 2216/2226 tests passed, 10 skipped (unrelated: go-vet-hostile and other pre-existing environment-gated skips), 0 failed.
- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache` — `Successfully ran targets test, lint, typecheck for 2 projects`.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache` — `Successfully ran target validate-deps`, "All external imports are covered by package.json dependencies."
- `npx nx run degradation-audit:lint --skip-nx-cache` — `degradation-audit: TOTAL 300 unsuppressed site(s)` (unchanged).

## Product defects found

None.

## Notes for review

- `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` remain untracked and untouched (confirmed via `git status --short`).
- No commit, push, stash, reset, restore, checkout or clean was run.
