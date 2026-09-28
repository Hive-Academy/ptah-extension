# Batch 32a executor report — Extraction contract

Executor: backend-developer (sub-agent), Lane G2 worktree `task-559-lane-g2`, base HEAD `da21c936c`.
No git state changed; the working tree is left dirty for the team-leader.

## Tasks

- 32a.1 Contract and service — DONE
- 32a.2 Per-language declaration queries and fixtures — DONE

## Changed paths (every one)

All under `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-g2/`:

1. `libs/backend/workspace-intelligence/src/ast/ast-analysis.interfaces.ts` — `ImportKind` (9 kinds, documented precedence), `ImportInfo` gains optional `kind`, `relativeLevel`, `alias`, `line`, `scopePath`; `DeclarationInfo`; `CodeInsights.declarations?`.
2. `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts` — declaration query runs as an extra entry of the same `queryMulti` call; generic declaration decoder (`@declaration.<kind>[.file]` + `@declaration.name`), nested-name composition and range-containment `scopePath` (row/column positions, file-scoped declarations extended to end of file); contract imports decoded once per `@import.statement` node, in source order. TS/JS keep the old decoder (byte-identical output, no `declarations` key).
3. `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.spec.ts` — real-grammar block (FB + all required fixtures + TS/JS shape guard); the three mocked py/go/cs tests now assert imports come only from statement captures.
4. `libs/backend/workspace-intelligence/src/ast/languages/types.ts` — `ExtractedImport`, `LanguageExtraction` (`extractImports`, optional `declarations: { query, scopeSeparator }`), optional `LanguageModule.extraction`.
5. `libs/backend/workspace-intelligence/src/ast/languages/python.language.ts` — statement patterns + `extractPythonImports` (multi-name, alias, wildcard, multi-level relative; `__future__` not matched). No declaration query (Python declares no package in source).
6. `libs/backend/workspace-intelligence/src/ast/languages/go.language.ts` — `(import_spec) @import.statement` (grouped, raw-string), package declaration (file-scoped); dot → wildcard, named/blank → alias.
7. `libs/backend/workspace-intelligence/src/ast/languages/csharp.language.ts` — `(using_directive) @import.statement`; global/static/alias/module; block + file-scoped namespace declarations (`.` separator).
8. `libs/backend/workspace-intelligence/src/ast/languages/java.language.ts` — `(import_declaration) @import.statement`; static/wildcard/module; package declaration (file-scoped).
9. `libs/backend/workspace-intelligence/src/ast/languages/rust.language.ts` — statement patterns for `use`, bodiless `mod`, `extern crate`; use-tree expander (grouped/nested lists, `self`, aliases, wildcards, leading `::`); inline-module declarations (`::` separator); `self::`/`super::` → `relative` with `relativeLevel`.
10. `libs/backend/workspace-intelligence/src/ast/java-rust-grammar.integration.spec.ts` — DEVIATION (not in the 9-file list): Java/Rust import expectations updated to the contract (grouped Rust `use` now split; `super::*` → source `super`, `importedSymbols: ['*']`).
11. `libs/backend/workspace-intelligence/src/ast/csharp-grammar.integration.spec.ts` — DEVIATION (not in the list): alias test now asserts `kind: 'alias', alias: 'Alias'` (the alias is no longer reported as an imported symbol).
12. `.ptah/specs/TASK_2026_559_8ca9/batch-32a-executor-report.md` — this report.

## Contract decisions

- New `ImportInfo` fields are optional: present for every language whose module defines `extraction` (py, go, cs, java, rust); TS/JS/TSX carry none (plan: "TS/JS output byte-identical"). Guarded by the spec "TS/JS keep their earlier import shape and get no declarations".
- `importedSymbols` = names requested from `source` under their original names (`['*']` for wildcards); `alias` = the local name the source itself is bound to. One kind per import, precedence `global > static > relative > wildcard > alias > module`; the lost trait stays visible (`importedSymbols: ['*']`, `alias`).
- `relativeLevel`: 1 = own package/module (Python `.`, Rust `self::`), +1 per level up.
- `scopePath` = enclosing declarations' names as written, outermost first (C# `['Acme', 'Billing.Api']`); `declarations[].name` is the composed full name (`Acme.Billing.Api`, `alpha::helper`). Java/Go `package` and C# `namespace N;` cover the rest of the file.
- execute_code `ast.queryImports` (vscode-lm-tools) is unaffected: the `@import.source` patterns are unchanged; the new statement-only patterns carry no `@import.source`, which that decoder skips.
- **Re-exports (carried Blocking item for 32b):** `export { X } from '...'` is not represented as an import, and it needs no contract change. It is already an `ExportInfo` with `isReExport: true` and `source`, and the graph node already stores `exports` (`dependency-graph.service.ts`, node build). 32b's TS/JS resolver can add the edge by resolving `node.exports.filter(e => e.isReExport && e.source)` alongside `node.imports`. Rust `pub use` is already a `use` import, so it gets its edge through `imports`.
- Plan's optional `extractDeclarations` post-processor is not needed: the declaration capture convention is decoded generically by the service.

## FB evidence

- Spec: `ast-analysis.service.spec.ts` › "two inline Rust modules keep separate scopePath".
- On base `da21c936c` (spec added before any source change; `declarations` read through a cast so the suite compiles): FAILED — imports carried no `kind`/`line`/`scopePath`, and beta's two imports were missing entirely (the base decoder deduplicated them against alpha's by source).
- After: PASSES.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` → "Successfully ran targets test, lint, typecheck"; Test Suites 61 passed, 1 skipped (62); Tests 1887 passed, 10 skipped (1897); lint 0 errors, 65 warnings, none in a changed file.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → exit 0.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300 unsuppressed site(s)".
- `nx run-many -t=test -p @ptah-extension/rpc-handlers` → 112/113 suites; the 1 failure is the known flake `harness-skill-selection-rpc.service.spec.ts` ("never writes state.json"). It fails the same way when run alone and has no path to the AST code.
- `nx run-many -t=test -p @ptah-extension/vscode-lm-tools` (extra, `ast.queryImports` consumer) → 77/77 suites, 2430 tests passed.
- `ptah-core-prompt.ts` and `cli-adapter.utils.ts` (`NATIVE_AGENT_TOOL_POLICY`): `git diff --stat` empty (unchanged).
- Harness (Batch 27): no activation fragment. 32a activates no key, and capabilities are unchanged (graphEdges keys belong to 33-36). `required-keys.ts` is untouched.
- Prettier was run only on the changed files.

## Out-of-scope observations

- The C# fixture in `csharp-grammar.integration.spec.ts` mixes a file-scoped namespace with a later block namespace. C# rejects this (CS8955). If anyone asserts declarations on it, the block namespace would compose as `Acme.Billing.Acme.Billing.Legacy`. Nothing asserts that today.
- `ast.queryImports` (vscode-lm-tools) still misses Go raw-string paths and Python relative, aliased and wildcard from-imports: its `@import.source` patterns were not extended, so that its output stays unchanged. `analyzeSource` covers all of them.

## Fix round (review r1)

Source: `reviews/batch-32a-code-logic-review-r1.md` (REVISE 5/10), User Decision 24. The 32b review verifies this round. No git commands were run. Probes stayed in the OS temp dir, and Prettier was run only on the changed files.

### Fixes

- **R32A-01 (Blocking), Rust nested block comments.** The regex comment stripper is replaced by `tokenizeUseTree` (`languages/rust.language.ts`). It skips `//` line comments and block comments with nesting depth, as the Rust lexer does, so a nested comment inside a use list no longer drops a path (`a::c`) or invents one (`a::comment`, wildcard `a`).
- **R32A-02 (Blocking), identifiers lost characters.** Words are no longer matched against a letter/number class. A word is every character up to the next whitespace, `::`/`{`/`}`/`,`/`*` or comment opener, sliced verbatim from the source. Combining marks (decomposed `e` + U+0301), other scripts and `r#` raw identifiers are kept byte-exact, and nothing is normalised.
- **R32A-03 (Serious), C# `global using static`.** New orthogonal trait `ImportInfo.isStatic?: true` (added to the `ExtractedImport` pick). It is set on every static import: C# `using static`, `global using static` (kind stays `global`) and Java `import static`. `global using static X` and `global using X` are now distinguishable.

### Regression specs (all in `ast-analysis.service.spec.ts`, real grammars)

- `Rust nested comments keep the use list exact` (3 cases, including both reviewer probes). Each asserts the whole import array and `parseStatus: 'ok'`.
- `Rust identifiers keep combining marks and raw prefixes byte-exact` (decomposed U+0301, `r#type::{r#match, <Cyrillic>}`).
- `C#: global using static keeps the static trait` (paired sources).
- Before the fix, all 5 tests FAILED on the pre-fix source. The only change for that run was to spread `isStatic` through a cast so the suite compiled, and it was then restored. After the fix, all pass.

### Changed paths in this round

All under `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-g2/`:

- `libs/backend/workspace-intelligence/src/ast/languages/rust.language.ts`: nesting-aware, byte-exact use-tree tokenizer.
- `libs/backend/workspace-intelligence/src/ast/ast-analysis.interfaces.ts`: `isStatic` field; the precedence note now says how the static trait survives.
- `libs/backend/workspace-intelligence/src/ast/languages/types.ts`: `ExtractedImport` picks `isStatic`.
- `libs/backend/workspace-intelligence/src/ast/languages/csharp.language.ts`: sets `isStatic`.
- `libs/backend/workspace-intelligence/src/ast/languages/java.language.ts`: sets `isStatic`.
- `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.spec.ts`: the 3 regression specs, plus `isStatic` in the C#/Java fixture expectations.
- `libs/backend/workspace-intelligence/src/ast/java-rust-grammar.integration.spec.ts`: the Java static import expects `isStatic: true`.
- `.ptah/specs/TASK_2026_559_8ca9/batch-32a-executor-report.md`: this section.

### Carried (not fixed in this round)

- **R32A-05 → 32b** (with the re-export edge). An empty TS/JS re-export clause (`export {} ` + `from './side'`) produces no import and no export record, so the graph misses that dependency. This corrects the universal claim above: resolving `exports` with `isReExport && source` covers named, namespace and wildcard re-exports, but not the empty clause. 32b must capture module requests independently of the exported-name count.
- **R32A-04 → 33.** Python per-member aliases (`from ..p import A as B, C as D`, `from . import x as y`) keep only the original names (`importedSymbols: ['A', 'C']`), so the local bindings are not represented. 33 adds a lossless per-symbol binding.

### Verification (fix round)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache` reported "Successfully ran targets test, lint, typecheck for 2 projects".
  - workspace-intelligence: 61 suites passed and 1 skipped; 1892 tests passed and 10 skipped.
  - vscode-lm-tools: 77 suites and 2430 tests passed.
  - Lint: 0 errors and 65 warnings in workspace-intelligence, the same count as before and none in a changed file.
- `nx run degradation-audit:lint --skip-nx-cache` reported "TOTAL 300 unsuppressed site(s)".
