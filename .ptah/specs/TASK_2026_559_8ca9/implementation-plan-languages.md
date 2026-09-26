# Implementation Plan (languages) - TASK_2026_559_8ca9, User Decision 18 — revision 2 + r3 edits (approved, User Decision 19)

**Scope.** Every language-bound Ptah MCP tool says which files it analysed and which it did not. Support extends
beyond TS/JS, and polyglot fixtures guard both.

- Design only; no production code.
- Batches 22+ use the `batches.md` format and review bar: Decision 17 cross-side review, 2 revise rounds, a bounded
  correction and a post-cap review, then the user.
- Every fix and every finding gets a regression spec that fails before the fix.
- **Every batch is independently green in the listed order.** Each one passes typecheck, test and lint for every
  touched project plus the ptah-cli and ptah-electron typechecks. No batch leaves an exhaustive type, a registry
  flag or a matrix activation ahead of its implementation.
- Revision 2 answers `implementation-plan-languages-review.md` (r1) and `-review-r2.md` (r2); see "Review response".

**Rule tags:** **[user]** Decision 18 unless noted · **[project]** existing rule, cited · **[arch]** architect-proposed.

**Path prefixes** (all under `<WT>`):

| Prefix     | Path                                                           |
| ---------- | -------------------------------------------------------------- |
| `WI`       | `libs/backend/workspace-intelligence/src`                      |
| `MCP`      | `libs/backend/vscode-lm-tools/src/lib/code-execution`          |
| `PC`       | `libs/backend/platform-core/src`                               |
| `Electron` | `apps/ptah-electron/src/services/electron-ide-capabilities.ts` |

## Summary

1. **Today's defects: silent "complete" empties.**
   - `ptah_get_dependents` on `.py` returns `count:0` (`MCP/mcp-core/protocol-dispatcher.ts:1983-2015`; the
     discovery glob at `:2679-2682` is TS/JS only).
   - `ptah_code_reindex` on `.kt` returns `filesScanned:1, symbolsIndexed:0` (`WI/services/code-symbol-indexer.service.ts:381-384`,
     `MCP/namespace-builders/code-namespace.builder.ts:388-393`).
   - `ptah_get_diagnostics` on a TS+Python repo prints "No issues found" (`MCP/mcp-core/mcp-response-formatter.ts:515-520`).
   - Electron references for Python/C# declarations are narrowed to graph dependents that do not exist
     (`Electron:632-667`).
2. **Order [user][arch].**
   - Honesty first (22-26): one coverage contract, wired end to end per tool.
   - Harness 27: a fixed, enumerated Decision 18 key set with per-batch activation fragments.
   - Packaging 28: may run early (it activates nothing).
   - After 27: parser transition 29, new grammars 30/31/30k, extraction and resolvers 32-36 (36 required), `go vet` checker 37a/37b (required, gated on O2).
   - Gate 38: fails until every enumerated required key is active and every mandatory verification batch has landed.
3. **Grammars.** tsx/Java/Rust/PHP/Ruby/C++ ship in the installed `@vscode/tree-sitter-wasm` 0.3.1 (MIT). All six
   load in `web-tree-sitter` 0.27.0 (ABI 14/14/15/15/14/14; architect and reviewer probes). Decision 19 settles the
   rest:
   - Kotlin: the MIT Kotlin WASM is vendored (batch 30k, with a provenance gate).
   - C: `.c/.h` parse with the installed C++ grammar (`c:parsed-as-cpp`); there is no separate C grammar.
4. **Diagnostics beyond TS** (Decision 19).
   - Tier 0 (no process): a syntax-only check for requested files, always labelled as such.
   - Tier 1: `go vet` only, per-workspace opt-in; 37a is gated on O2.
   - **pyright is excluded by user Decision 19**: its search-path discovery runs a Python interpreter, and Python site
     initialisation runs `.pth` and `sitecustomize` code before any `-c` body.
   - Tier 2 (checkers that run project build code): prohibited in this task.
   - Every other language reports "not checked" honestly.

## Inputs and constraints

- **Requirements read:**
  - `context.md` Decisions 2, 4, 7, 13-18, and **19** (`context.md:59`: plan approval with Q1-Q4 settled; Batch 22
    starts in a new language-lane worktree while Lane A finishes 17 → 18 → 15 → 13).
  - `batches.md`: format; lanes :2152-2162; Batches 9, 9b, 20.1-20.3, 21.1-21.2 (:2586-2649); validate-deps note
    :1940-1945.
  - TASK_2026_561 Track B2.
  - Both reviews.
  - Lane D fixture API (`git show fix/task-559-lane-d:WI/testing/mcp-contract/fixture-workspace.ts`, db52fa759;
    `:5-43`, `:283`, `:695`).
- **[project] Frozen prompts (Decision 4):** the shared prompt constants stay frozen; per-tool descriptions may be
  corrected.
- **[project] Budget (Decisions 2, 15):** 2,000 tokens / 8,000 chars; status fields go before unbounded fields.
  Batch 9/9b field meanings and order stay: `count`, `incomplete`, `graphedFiles`, `discoveredFiles`, then `file`
  and lists (`protocol-dispatcher.ts:2005-2012`). `building` is a success; `failed` is an error (`:2731-2761`).
- **[project] validate-deps** (`apps/ptah-electron/scripts/lib/bundle-imports.js:121-134`) flags these shapes in
  bundled string literals: `from "x"`, `import("x")`, bare `import "x"`, `require("x")`. Query text, comments,
  messages and fixtures build them by concatenation, or use lane D's `${FROM}` (fixture-workspace.ts :88).
- **[project] Lib tags:** platform-core is `scope:shared,type:util` (`libs/backend/platform-core/project.json:6`).
  tool-output-reducers is `type:util` and is not touched.

## Codebase evidence

| Evidence                                                                                              | Location                                                                                                                                                                                  | Implication                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Map js/jsx/ts/tsx/py/go/cs/csx; `.tsx` uses the TS grammar                                            | `WI/ast/tree-sitter.config.ts:4-15`                                                                                                                                                       | tsx needs its own id                                                                                                   |
| Exhaustive records over `SupportedLanguage` (only two)                                                | `WI/ast/tree-sitter.config.ts:365-398`; `MCP/mcp-core/code-outliner.adapter.ts:74`; Electron maps are `Partial` (`:153, :216`)                                                            | a new id, its config entry and its outliner entry must land in **one** batch                                           |
| Python/Go/C# `exportQuery ''`; `queryExports` returns `[]` for them                                   | `tree-sitter.config.ts:380-397`; `WI/ast/tree-sitter-parser.service.ts:534-542`; `MCP/namespace-builders/ast-namespace.builder.ts:170-183`                                                | export extraction is a separate capability                                                                             |
| SQLite code index builds chunks from functions/classes, not exports                                   | `code-symbol-indexer.service.ts:437, :451`; extensions `:68-77`                                                                                                                           | `codeIndex` ≠ `publicSymbols` (r2-1)                                                                                   |
| Only the indexer writes `code_symbols`; per-file delete then insert                                   | `code-symbol-indexer.service.ts:416, :482` (the sole callers of the sink); runs started unawaited `code-namespace.builder.ts:211-220`; search reads live rows `:289-317`                  | coverage needs a live state, not a last-run snapshot (r2-9)                                                            |
| Freshness port: count + newest `updated_at` only                                                      | `libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts:20-37`; `memory-curator/src/lib/code-symbol.store.ts:240-255`                                                           | no persisted coverage; unknown after restart                                                                           |
| Indexer stops at 2,000 before its skip filter                                                         | `code-symbol-indexer.service.ts:203-221, :234`                                                                                                                                            | eligible-only counting                                                                                                 |
| Eager grammar load; all-or-nothing                                                                    | `tree-sitter-parser.service.ts:113-149`                                                                                                                                                   | lazy isolated loading                                                                                                  |
| Extraction keeps one capture per name; queries run as one `queryMulti` entry list                     | `WI/ast/ast-analysis.service.ts:83-95, :320-371, :379-420`                                                                                                                                | declarations run as an extra entry of the same call                                                                    |
| Captures carry start/end positions                                                                    | `ast-analysis.service.ts:300-301`                                                                                                                                                         | lexical scope by range containment (r2-6)                                                                              |
| Graph: input count published; parse failures skipped; publish under generation guard                  | `WI/ast/dependency-graph.service.ts:231, :238, :339-344, :435-451`                                                                                                                        | coverage published atomically with the graph                                                                           |
| Resolver gets `imp.source` only; relative + tsconfig                                                  | `dependency-graph.service.ts:406-414, :815-841`; tsconfig never passed `MCP/namespace-builders/analysis-namespace.builders.ts:453`                                                        | resolver dispatch + context                                                                                            |
| Graph discovery: unbounded `findFiles` then slice                                                     | `protocol-dispatcher.ts:2679-2693`                                                                                                                                                        | bounded discovery                                                                                                      |
| Search `findFiles` passes only `DEFAULT_WORKSPACE_EXCLUDES`; the provider accepts excludes            | `MCP/namespace-builders/core-namespace.builders.ts:149-159`; `PC/interfaces/file-system-provider.interface.ts:106-113`                                                                    | vendor excludes go **into** the discovery call (r2-3)                                                                  |
| Default excludes have `node_modules`, `dist`, `build`, `target`; lack `.venv`, `vendor`, `obj`, `bin` | `WI/file-indexing/workspace-default-excludes.ts:16-40`                                                                                                                                    | graph-discovery exclude additions                                                                                      |
| Diagnostics namespace rebuilds both arms                                                              | `core-namespace.builders.ts:225-231, :254-259`; `MCP/types.ts:200-210`                                                                                                                    | forward coverage                                                                                                       |
| Diagnostics floor rule                                                                                | `PC/interfaces/diagnostics-provider.interface.ts:34-45`; `PC/testing/contracts/run-diagnostics-provider-contract.ts`                                                                      | syntax-only amendment                                                                                                  |
| TS provider returns diagnostics, not checked files                                                    | `WI/diagnostics/type-script-diagnostics-provider.ts:504-508`                                                                                                                              | TS checked count is `null`                                                                                             |
| Registration point for Electron + CLI diagnostics                                                     | `WI/di/register.ts:80-93`                                                                                                                                                                 | wrap once                                                                                                              |
| VS Code diagnostics: `vscode.languages.getDiagnostics()`                                              | `libs/backend/platform-vscode/src/implementations/vscode-diagnostics-provider.ts:57`                                                                                                      | `provider-defined` coverage                                                                                            |
| IDE capability interface, namespace rebuild, no-host `[]`                                             | `MCP/namespace-builders/ide-namespace.builder.ts:42-56, :214-222, :345-352`                                                                                                               | report methods forwarded                                                                                               |
| Electron: graph-narrowed references; brute-scan caps silent; no C# fallback query                     | `Electron:632-667, :683-685, :72-93, :153, :459-460`                                                                                                                                      | narrowing gate + disclosure                                                                                            |
| Enrichment gate TS/JS only                                                                            | `WI/context-analysis/context-enrichment.service.ts:155-159`; `analysis-namespace.builders.ts:84-137`                                                                                      | `enrichSummary` capability                                                                                             |
| Host-owned per-workspace storage                                                                      | `PC/interfaces/workspace-scoped-state-storage.interface.ts` (`getStorageForWorkspace`)                                                                                                    | consent record for `go vet` (not repo config)                                                                          |
| Process port takes the complete env                                                                   | `PC/interfaces/process-spawner.interface.ts:26-28`                                                                                                                                        | allowlisted env; toolchain probe spreads the env (`WI/project-analysis/toolchain-probe.ts:115`) and is not a precedent |
| Packaging lists                                                                                       | `scripts/copy-wasm.js:38-65`; Electron verify `:31-36` (lacks py/go); CLI verify `:37-44`; `publish-cli.yml:362-363, :381`; VSIX none (`apps/ptah-extension-vscode/project.json:118-122`) | one manifest                                                                                                           |
| Barrel                                                                                                | `WI/index.ts:93, :103-104`                                                                                                                                                                | 22 owns the barrel edit                                                                                                |

## Inventory

| Tool / path                                                                          | Today                                                                                                                                               | Unsupported behaviour today                                                  | Target (batch)                                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ptah_get_dependents` / `_dependencies`                                              | TS/JS edges                                                                                                                                         | `.py` → silent `count:0`; file outside graph → `[]`                          | `unsupported-language`, `fileInGraph`, `coverage` incl. resolution (23a/23b); py/go/cs/java/rust edges (33-35)     |
| `ptah_get_symbol_index` (graph export index)                                         | TS/JS exports                                                                                                                                       | py/go/cs absent silently                                                     | `coverage`; `publicSymbols` per language (33-35)                                                                   |
| `ptah_code_search_symbols` / `ptah_code_reindex` (SQLite index; js/ts/py/go/cs)      | hand list; 2,000 stop                                                                                                                               | `.kt` reindex → `filesScanned:1`                                             | live index state + coverage before hits; unsupported answer (24b)                                                  |
| `ptah_ast_analyze`, execute_code `ast.query*`                                        | 5 languages; tsx via TS                                                                                                                             | unsupported → error (kept); recovered parse silent; `queryExports` py → `[]` | `parseStatus`; `queryExports` errors without `publicSymbols` (24a); new grammars (29b-31)                          |
| `ptah_context_enrich_file`                                                           | TS/JS                                                                                                                                               | full content + reason (kept)                                                 | `enrichSummary` incl. tsx (29b)                                                                                    |
| `ptah_lsp_definitions`                                                               | VS Code LS; Electron index → fallback ts/js/py/go; no host `[]`                                                                                     | no-host "Found: 0"; C# fallback absent                                       | report with mechanism (26a); C# fallback (26b)                                                                     |
| `ptah_lsp_references`                                                                | VS Code LS; Electron graph-narrowed or capped text scan                                                                                             | lost references; silent caps                                                 | narrowing only with per-query completeness evidence (26b)                                                          |
| `ptah_get_diagnostics` Electron/CLI                                                  | TS compiler                                                                                                                                         | mixed repo "No issues found"                                                 | typed coverage both arms, forwarded; syntax-only requested files (25a/25b); `go vet` opt-in (37a/37b, Decision 19) |
| `ptah_get_diagnostics` VS Code                                                       | installed extensions                                                                                                                                | unknowable per language                                                      | `checks:'provider-defined'`, `analyzed:null` (25b)                                                                 |
| Outline reducer                                                                      | 5 languages                                                                                                                                         | refuses (honest)                                                             | new languages (29b-31)                                                                                             |
| Packaging                                                                            | 3 hand lists                                                                                                                                        | Electron misses py/go; no VSIX check                                         | manifest (28a/28b)                                                                                                 |
| workspace_analyze, detect_monorepo, relevance_rank_files, search_files, count_tokens | language-agnostic (`project-detector.service.ts:288-311` detection only; `rankFiles` has no symbol index, `analysis-namespace.builders.ts:351-368`) | —                                                                            | out of scope                                                                                                       |

## Coverage contract (Batch 22) [arch]

Type-only, in `PC/interfaces/language-coverage.interface.ts`. Buckets are **disjoint file counts**. Resolution is
counted separately, per import.

```ts
type Count = number | null; // null = not knowable by this source
export interface LanguageCoverage {
  readonly supportedLanguages: readonly LanguageId[]; // capability claim of this tool on this host
  readonly census: 'complete' | 'truncated' | 'unknown';
  readonly censusLimit?: number;
  readonly state?: 'current' | 'updating' | 'incomplete'; // code index only (see 24b)
  readonly analyzed: Count; // analysed successfully
  readonly unchecked: Count; // supported, but this call did not analyse it (e.g. unscoped syntax check)
  readonly failed: Count; // supported, analysis failed
  readonly unsupported: Count; // recognised source file, language lacks the capability
  readonly excluded: Count; // vendor/generated; null when excluded inside discovery (not observed)
  readonly omittedByCap: Count; // eligible, dropped by a file or request limit
  readonly unsupportedByLanguage?: Readonly<Partial<Record<LanguageId | RecognisedLanguageId | 'other', number>>>; // top 8 + other
  readonly failedByReason?: Readonly<Partial<Record<FailureReason, number>>>;
  readonly resolution?: { external: Count; unresolvedInternal: Count; truncatedImports: Count; edgeCapHit: boolean; context: 'complete' | 'partial' }; // graph tools only
  readonly approximations?: readonly Approximation[]; // ≤ 4, by priority
  readonly approximationsOmitted?: number;
  readonly checks?: 'type-check' | 'syntax-only' | 'mixed' | 'provider-defined';
}
export interface UnsupportedLanguageAnswer {
  status: 'unsupported-language';
  language: string;
  supportedLanguages: readonly LanguageId[];
  message: string;
}
```

- **Closed vocabularies:**
  - **`LanguageId`**: typescript, javascript, tsx, python, go, csharp, java, kotlin, rust, php, ruby, cpp.
    `c` is not a separate id (Decision 19); `.c/.h` files are `cpp`.
  - **`RecognisedLanguageId`** (the extra keys allowed in `unsupportedByLanguage`): swift, scala, dart, elixir, lua,
    haskell, clojure, objc, r. `other` covers everything else. Longest id: 10 chars.
  - **`FailureReason`**: read, parse, grammar-unavailable, too-large, timeout.
  - **`Approximation`**, in priority order: `resolver-context-partial`, `<id>:syntax-only`, `text-scan`,
    `case-folded`, `c:parsed-as-cpp`, `go:package-edges`, `csharp:namespace-edges`, `java:package-wildcard`.
  - Overflow keeps the four highest-priority items and **discloses** the rest through `approximationsOmitted`.
    Not every per-language qualifier is guaranteed to survive: more than four syntax-only languages can fill the
    four slots.
  - When exact per-language check levels matter, `checks:'mixed'` is the bounded summary, and the full details
    stay in the raw (spooled) output.
- **Size.** Counts saturate at 9,999,999. Measured envelopes for the worst case (all ids, every bucket saturated, 9
  long language keys, 5 reasons, full `resolution`, 4 priority approximations, `approximationsOmitted`, `checks`,
  `state`):

  | Measured by                                                        | Result        |
  | ------------------------------------------------------------------ | ------------- |
  | Architect probe                                                    | 909 chars     |
  | Reviewer r3 probe                                                  | **920** chars |
  | Reviewer r3 probe, with `censusLimit` 50,000 and overflow count 20 | 913 chars     |

  The contract is therefore "≤ ~920 measured, asserted ≤ 1,000", not a proven universal maximum. Batch 22 commits
  the serialised worst-case fixture and records its measured length. Multi-root sums use the same saturation.

- **Clean answer rule.** A tool may present a bare clean or complete answer ("No issues found", "no dependents")
  only when all of these hold:
  - `census:'complete'`;
  - `unchecked`, `failed`, `unsupported` and `omittedByCap` are all 0 (`analyzed` may be `null`);
  - `excluded` is 0 or `null`;
  - `resolution` (when present) has `unresolvedInternal`=0, `truncatedImports`=0, `edgeCapHit:false` and
    `context:'complete'`;
  - `state` is absent or `'current'`.

  Anything else is a **qualified** answer that names the qualifier. `unknown` never reads as clean.

- **Placement.** After the Batch 9 status fields, before `file`, lists and hits. A spec with a very long path and an
  oversized list keeps `coverage` inside the budget cut (Decision 15 pattern). The symbol-index paginator carries it
  in its header.
- **Multi-root merge** (`protocol-dispatcher.ts:2185-2197`):
  - counts are summed, saturating; any `null` makes the sum `null`;
  - `census` and `state` take the worst value;
  - `supportedLanguages` and `approximations` are unions under the priority rule;
  - `edgeCapHit` is an OR; `context` is `partial` if any root is partial.
- **Atomicity.** Graph coverage is published in `publish()` with the graph under the generation guard
  (`dependency-graph.service.ts:231, :435-451`). Code-index coverage follows the live-state rules in 24b; it never
  claims to be atomic with rows it does not snapshot.
- **Unsupported single-file answers** are a success, except where a tool keeps its own honest contract:
  - `ptah_ast_analyze` error (`ast-namespace.builder.ts:223-231`);
  - enrich full content + `reason` (Decision 13).

  The harness asserts each tool's own contract.

- **Registry.** `WI/ast/language-registry.ts`; per-language modules from 29a1. Each language declares `{ id,
extensions, grammarFile | null, capabilities }` with these **separate** capabilities:
  - `parse`, `outline`, `enrichSummary`;
  - `codeIndex` (SQLite function/class chunks);
  - `publicSymbols` (export or public-declaration extraction: graph export index, `queryExports`);
  - `graphEdges: { granularity: 'file' | 'package' | 'namespace'; referenceScopeComplete: boolean } | null`;
  - `definitionFallback`, `syntaxDiagnostics`.

  Initial values: `codeIndex` true for js/ts/py/go/cs; `publicSymbols` and `graphEdges` true for js/ts only;
  `syntaxDiagnostics` true for py/go/cs.

## Per-area design

### Grammars and queries [user] (29a1, 29a2, 29b, 30, 31, 30k)

- **29a1 (pure move).** Current entries and queries move to `WI/ast/languages/<id>.language.ts` plus `index.ts`.
  `tree-sitter.config.ts` becomes the assembly. Existing specs stay green unchanged.
- **29a2 (lazy isolated loading).** The runtime loads at `initialize()`. Each grammar loads on first use behind a
  per-language latch.
  - A failure gives `failed.grammar-unavailable` for that language only.
  - A file over 1 MiB is `failed.too-large` (worker-thread parsing stays 561 B4).
  - A spec asserts that registry grammars equal the manifest's `active` grammar rows.
- **Queries per new language.** Node names must be confirmed against the shipped WASM in that batch's integration
  spec (C# precedent, `tree-sitter.config.ts:236-240`); the names below are the design, and the spec is the proof.

| Language                                                                                                                  | functions                                       | types                                                   | imports                                                                | public symbols                             | declarations (scope)                        |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| tsx                                                                                                                       | as TS + JSX-bearing functions                   | as TS                                                   | as TS                                                                  | as TS exports                              | —                                           |
| java                                                                                                                      | `method_declaration`, `constructor_declaration` | `class/interface/enum/record_declaration`               | `import_declaration` (static flag, `asterisk`)                         | types with `modifiers` containing `public` | `package_declaration`                       |
| kotlin (Decision 19, 30k)                                                                                                 | `function_declaration`                          | `class_declaration`, `object_declaration`               | `import_header`                                                        | declarations without `private`/`internal`  | `package_header`                            |
| rust                                                                                                                      | `function_item`                                 | `struct_item`, `enum_item`, `trait_item`, `impl_item`   | `use_declaration`, `mod_item` without body, `extern_crate_declaration` | items with `visibility_modifier`           | `mod_item` with body (inline module ranges) |
| php                                                                                                                       | `function_definition`, `method_declaration`     | `class/interface/trait/enum_declaration`                | `namespace_use_declaration`, include/require expressions               | top-level classes/functions                | `namespace_definition`                      |
| ruby                                                                                                                      | `method`, `singleton_method`                    | `class`, `module`                                       | `call` to `require`/`require_relative` with a string arg (`#match?`)   | top-level classes/modules                  | `module`/`class` ranges                     |
| cpp (+ `.c/.h` → `c:parsed-as-cpp`, Decision 19; real `.c` and `.h` fixtures are part of every cpp grammar and graph key) | `function_definition`                           | `class_specifier`, `struct_specifier`, `enum_specifier` | `preproc_include` (`string_literal` local, `system_lib_string` system) | non-`static` top-level functions/types     | `namespace_definition`                      |

- **tsx is one atomic batch (29b; r2-4).** In a single commit:
  - `SupportedLanguage` gains `tsx`, with its language module, index entry and `OUTLINE_QUERIES.tsx` entry.
  - The enrichment gate reads `enrichSummary`, and the `analysis-namespace` alias and `.tsx` refusal are deleted.
  - The manifest `active` flag is set, and its activation fragment lists only the keys proven in that commit.
  - The Decision 13 refusals stay.
  - Tests: a TSX declaration-only file summarises; a TSX file with JSX runtime falls back with its reason; explicit
    and inferred language agree; the TSX outline works; MCP enrich/outline go through the real dispatcher.

### Extraction contract [arch] (32a) — r1-4, r2-6

- **`ImportInfo`** gains:
  - `kind`: module | relative | wildcard | static | alias | global | mod-decl | include-local | include-system;
  - `relativeLevel`, `alias`, the full `importedSymbols` list;
  - `line`;
  - `scopePath: string[]`.
- **`CodeInsights`** gains `declarations?: Array<{ kind: 'package' | 'namespace' | 'module'; name: string;
startLine; endLine }>`, plus the 24a parse fields.
- Each language module may define a `declarationQuery`, run as an **extra entry of the same `queryMulti` call**
  (`ast-analysis.service.ts:83-95`), and `extractImports` / `extractDeclarations` post-processors.
- `scopePath` is computed by range containment of the import position within declaration ranges. C# nested
  namespaces concatenate, Rust inline modules nest, and file-scoped namespaces cover the rest of the file.
- The TS/JS extractor output stays byte-identical (existing specs).
- **Required fixtures:**
  - one Rust file with two inline modules whose `self::`/`super::` imports resolve differently;
  - nested C# namespaces, `using static`, an alias and `global using`;
  - Java nested-type and static imports;
  - Python multi-name and multi-level relative imports;
  - Go grouped and raw-string imports;
  - Rust grouped `use {a, b::c}`.

### Dependency graphs [user] (23a, 23b, 32b, 33-36)

**Resolver dispatch (32b).** Each language module registers an `ImportResolver`, and the graph dispatches on the
importing file's language: `resolve(imp, fromFile, ctx) → { kind: 'file' | 'package' | 'namespace' | 'external'
| 'unresolved-internal', targets, truncated? }`. `ResolverContext` is built once per build with generation checks
and yields between reads; it reads tsconfig `paths` itself, and 32c removes the dead namespace parameter. Resolver
batches set `graphEdges`/`publicSymbols` in their own language modules.

| Language                              | Resolution rules                                                                                                                                                                                                                                                                                                                                   | Edge                                          | `referenceScopeComplete`                  | Cannot be known statically (disclosed)                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| TS/JS                                 | relative + extensions/index (today) + tsconfig `paths` from the root `tsconfig*.json`                                                                                                                                                                                                                                                              | file                                          | true                                      | dynamic `import()` with non-literal specifiers; package `exports` maps |
| Python                                | relative: `relativeLevel`-1 dirs up from the file's package; absolute: source roots = workspace root, `src/` if present, dirs named in `pyproject` `[tool.setuptools] package-dir`/`packages`; try `a/b.py`, `a/b/__init__.py`; `from a.b import c` prefers module `a/b/c.py`, else `a/b/__init__.py`; first-segment miss in every root → external | file                                          | false (star imports, dynamic imports)     | `importlib`, `sys.path` edits, namespace packages outside the repo     |
| Go                                    | `go.mod` `module` prefix → dir; `go.work` `use` dirs (each module); local `replace x => ./y` only; stdlib and other modules → external                                                                                                                                                                                                             | package: every non-`_test.go` file in the dir | false (same-package files need no import) | build tags/GOOS (all files included), cgo, vendor (excluded)           |
| C#                                    | `using N` / `using static N.T` / alias / `global using` → files whose `declarations` include namespace N (nested names composed)                                                                                                                                                                                                                   | namespace                                     | false                                     | same-namespace use, ImplicitUsings, extension methods, reflection/DI   |
| Java                                  | FQN `a.b.C` → the unique file declaring `package a.b` and top-level `C` (nested `a.b.C.D` → C's file); wildcard/ambiguous → package dir files                                                                                                                                                                                                      | file, else package (`java:package-wildcard`)  | false (same package)                      | reflection, annotation processors, split packages                      |
| Rust                                  | crate roots from `Cargo.toml` (`src/lib.rs`, `src/main.rs`, `[lib] path`, `[[bin]] path`), workspace `members`; `mod x;` → `x.rs` or `x/mod.rs` relative to the module dir; `use crate::/self::/super::` resolved from `scopePath`; longest module prefix that is a file; other workspace crates by package name → their root                      | file (module)                                 | false (macros, `pub use` chains)          | `#[path]`, `cfg`-gated and macro-generated modules                     |
| PHP (36, required)                    | composer `autoload.psr-4` prefix → dir + class path; literal include/require → relative file                                                                                                                                                                                                                                                       | file                                          | false                                     | runtime autoloaders                                                    |
| Ruby (36, required)                   | `require_relative` → file; `require` → `lib/` then root                                                                                                                                                                                                                                                                                            | file                                          | false                                     | Zeitwerk constant autoload, `$LOAD_PATH` edits                         |
| C/C++ (36, required; `.c/.h` via cpp) | `#include "x"` → file dir, then include dirs from `compile_commands.json` (read-only, `-I` only); `<x>` → external                                                                                                                                                                                                                                 | file                                          | false                                     | macros, generated headers, other flags                                 |

**Case rule.** Exact identity first. A case-folded match is used only when it is unique, and is marked
`case-folded`. An ambiguous match is `unresolved-internal`. No filesystem is assumed to be case-insensitive.

**Bounds (23a/32b; r1-7, r2-3):**

| Resource             | Limit                                                                                                                                                                                                                                                                                                                                                                               | Response when hit                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Discovery            | new `ptah.dependencies.discoverSourceFiles(root, limit)` calls `IFileSystemProvider.findFiles(glob, [...DEFAULT_WORKSPACE_EXCLUDES, ...GRAPH_VENDOR_EXCLUDES], 50_001, root)`. Vendor globs: `**/.venv/**`, `**/venv/**`, `**/site-packages/**`, `**/__pycache__/**`, `**/vendor/**`, `**/obj/**`, `**/bin/**`, `**/.gradle/**`, `**/Pods/**`; excluded **inside** the bounded walk | `census:'truncated'` at 50,001; `excluded:null` (not observed) |
| Parse cap 5,000      | eligible (graph-capable) files only, round-robin per language in stable path order                                                                                                                                                                                                                                                                                                  | `omittedByCap`                                                 |
| Manifests            | ≤ 64 files, ≤ 256 KiB each, ≤ 2 MiB total, realpath inside root, text extraction only                                                                                                                                                                                                                                                                                               | `context:'partial'`                                            |
| Per-import expansion | ≤ 200 targets                                                                                                                                                                                                                                                                                                                                                                       | `truncatedImports`                                             |
| Aggregate edges      | ≤ 250,000                                                                                                                                                                                                                                                                                                                                                                           | `edgeCapHit:true`, linking stops                               |

Linking yields and re-checks the generation inside multi-target expansion (`dependency-graph.service.ts:386-393`).
Discovery of recognised-unsupported extensions for the census uses the same bounded call. Assumption: the analysis
namespace deps lack `fileSystemProvider`; 23b adds it through `ptah-api-builder.service.ts` (H). Check the builder
before editing.

### Code symbol tools [user] (24b) — r1-2, r2-1, r2-9

- **Accounting.** Indexer extensions come from `codeIndex`. Discovery also streams recognised-unsupported
  extensions, for counting only. Vendor and skip filters run before the eligible-only 2,000 stop.
  - Buckets: `analyzed`, `failed` by reason, `unsupported`, `omittedByCap` (truncated).
- **Live state [r2-9]:**
  - `beginRun(root)` runs **synchronously before any write**, including from `startBackgroundRun`
    (`code-namespace.builder.ts:211-220`). It sets `state:'updating'` and drops the previous run's counts.
  - A successful run sets `state:'current'` with its counts.
  - An aborted or failed run sets `state:'incomplete'`, which is retained until a successful run.
  - **Per-file writes (r3).** One indexer service can run overlapping async operations. It is the only writer, but
    that alone does not make the counts exact. Rules:
    - A per-file write during a full run is folded into that run's final accounting, or the run ends
      `incomplete`.
    - Outside a run, a per-file reindex updates the per-file record (`Map<file, bucket>`, bounded at 2,000 entries).
      It never promotes an `unknown` or `incomplete` census to complete; only a successful full run does.
    - Past 2,000 distinct per-file entries, the record stops tracking and coverage turns
      `census:'truncated'`/qualified (disclosed).
    - 24b tests cover a same-file overlap (per-file reindex racing a full-run write of that file) and the 2,001st
      distinct per-file update.
  - A new host session has no record: `census:'unknown'`, `state` absent.
  - Search never claims a snapshot: `updating` and `incomplete` are qualified answers.
- **Shapes.**
  - Search: `{ index, coverage, bm25Only, hits }`.
  - Search with `filePath` in an unsupported language, or a reindex of an unsupported file:
    `UnsupportedLanguageAnswer`, with no delete and no count.
  - Tests: a search between two file updates of a run → `updating`; a search after an aborted run → `incomplete`;
    Python stays searchable while Python `queryExports` errors.

### Diagnostics [user] (25a, 25b, 37a, 37b)

- **25a contract.**
  - `coverage` on both arms.
  - Floor-rule amendment: the floor governs type-check claims, and syntax-only languages are named in
    `checks`/`approximations`.
  - A contract case: a syntax-only file is never reported as type-checked.
- **25a provider.** `LanguageAwareDiagnosticsProvider` wraps the TS provider at `register.ts:80-93`; the function
  name is kept.
  - **Scoped call:** TS/JS go to the TS provider (`analyzed:null`, type-check). Other grammar languages get a syntax
    check, at most 50 files; file 51 and later are `omittedByCap`.
  - Syntax check limits: ≤ 1 MiB per file; ≤ 20 ERROR/MISSING per file.
  - **Unscoped call:** no syntax scan. Syntax-capable files are `unchecked`, with the hint "pass files"; other
    languages are `unsupported`.
  - Census for unscoped calls: from the graph build if present, else from one bounded `discoverSourceFiles`, cached
    per root and dropped by `invalidate`.
  - A project with no tsconfig answers `unavailable` with coverage.
- **25b forwarding and rendering.**
  - `DiagnosticsPayload.coverage` is forwarded on both arms.
  - The formatter follows the clean-answer rule.
  - VS Code: `provider-defined`.
  - End-to-end spec: real provider (fake inner TS provider) → real namespace → real dispatcher → formatter, on a
    mixed TS/Python workspace. Cases: empty and non-empty results, `getErrors`, a long result through the budget,
    and the Batch 1 requested-file order.
- **Tier 1 (37a/37b, required by Decision 19; 37a is gated on O2): `go vet` with per-workspace opt-in.**
  - **What it executes.** The user's trusted Go toolchain and its inherent compiler/analyzer work.
  - **What it does not execute:** generators, tests, project build scripts, custom vet tools (`-vettool`) or
    downloaded toolchains.
  - Opt-in is authorisation, not a process sandbox. The safety statement covers only the fixed invocation and
    environment below, not arbitrary PATH programs.
  - **Fixed invocation (pinned in 37a).** `go vet -json <validated package patterns>`. Package arguments are
    derived from the requested files' directories under the root and validated. Caller-supplied build or vet
    flags are never accepted.
  - **Honest "not checked".** Missing module dependencies (readonly mode, no proxy), unsupported configurations and
    failed vet runs report `failed`/`unchecked` for Go with the reason, never "No issues".
  - **Consent.** Stored host-side under `getStorageForWorkspace(root)`, or the single `IStateStorage` on
    single-workspace hosts, as key `ptah.diagnostics.goVet.consent`.
    - Default is denied, and repository files never count as consent.
    - **Fail closed:** when `getStorageForWorkspace(root)` returns `undefined`, consent is denied. It never falls
      back to another workspace's storage (`PC/interfaces/workspace-scoped-state-storage.interface.ts` forbids it).
  - **Enable/revoke surface: open item O2.** O2 is closed by a short reviewed amendment that names both the Electron
    and the CLI enable/revoke surfaces, their files and their tests, before 37a starts.
  - **Binary.** The canonical realpath from a sanitised PATH: absolute entries only, none inside the workspace; a
    symlink resolving into the workspace is rejected.
  - **Environment** (allowlist, never spread):
    - base: `PATH`, `HOME`/`USERPROFILE`, `SystemRoot`, `TEMP`/`TMP`, `LANG`;
    - Go: `GOENV=off`, `GOCACHEPROG=`, `GOTOOLCHAIN=local`, `GOFLAGS=-mod=readonly`, `GOPROXY=off`, `GONOPROXY=`,
      `GOPRIVATE=`, `GONOSUMDB=`, `GOSUMDB=off`, `GOWORK=off`, `CGO_ENABLED=0`.
  - **Execution.** Through the `IProcessSpawner` each host passes in; 45 s budget; tree kill; 2 MiB output cap.
  - **Isolation.** One failing checker leaves the other languages intact.
  - **Tests:**
    - fake-spawner: hostile PATH/env, delayed spawn then timeout, overflow, non-zero exit, cancellation, partial
      success;
    - a **real-binary hostile fixture** (skipped with a printed reason when `go` is absent). Each claim is proven
      by its own observable evidence, and a cgo failure alone never counts as exercising the later cases:
      - no generator run: a `go:generate` directive whose marker file must stay absent;
      - no toolchain switch: a `go.mod` with a `toolchain` line newer than the local toolchain, with no download
        and the local version reported;
      - no network: `GOPROXY=off` and a missing dependency that is reported as `failed`, not fetched;
      - no cgo: the cgo file reports as not built under `CGO_ENABLED=0`, in a separate package from the other
        cases.
- **pyright: excluded by user Decision 19.** Upstream `findPythonSearchPaths` runs an interpreter with `-c`, and
  Python's `site` initialisation runs `.pth` lines and `sitecustomize` before `-c`, so project code can run.
- **Tier 2** (cargo, dotnet, gradle/maven, clang with compile_commands, mypy plugins, rust-analyzer): **prohibited
  by Decision 19**. Never run; the answer names the command to run in the shell.

### LSP honesty [user] (26a, 26b) — r1-5, r2-3

- **26a (H).**
  - `IIDECapabilities.lsp` gains optional `getDefinitionReport?` / `getReferencesReport?` → `{ locations,
mechanism, language, languageSupported, approximations, truncated? }`.
  - `LSPNamespace` forwards both; the array APIs stay.
  - The no-host path answers `mechanism:'none'`, rendered as "not available on this host".
- **26b (E).**
  - Report methods.
  - Scan extensions from all recognised source extensions.
  - C# `DECLARATION_QUERIES` / `COMMENT_STRING_QUERIES`; `definitionFallback` is set only when the real-grammar
    spec passes.
  - **Narrowing gate (per query), all of which must hold:**
    - every language present in the root's graph census (graphed or unsupported) has
      `referenceScopeComplete: true`, i.e. no graph-unsupported or incomplete-scope language exists in the root;
    - graph coverage passes the clean-answer rule, including `resolution`;
    - the declaration files are in the graph.
  - Otherwise: a brute scan with `text-scan`, and its caps reported as `truncated`.
  - Tests:
    - complete file census with `edgeCapHit`;
    - a TS declaration imported by a Python file;
    - a vendor tree larger than the census limit sorted before normal code;
    - C# same-namespace references;
    - Java same-package references;
    - a capped graph;
    - Kotlin scan;
    - no-host CLI.

### Descriptions (24c) [user]

`languagesNote(capability)` generates the language list for each language-bound tool. Descriptions separate the
two symbol indexes and the host mechanisms. H alone edits `tool-description.builder.ts`.

### Harness [user] (27, 38) — r1-9, r2-5, r2-7

- **Fixtures.** `WI/testing/mcp-contract/polyglot-fixtures.ts` builds on lane D's plan types, adding
  `PolyglotKnownEdge extends KnownEdge { granularity }`. Lane D's file is not edited.
  - Fixture sets: python-app, go-csharp, java-rust (plus Kotlin files for 30k), ts-python-monorepo, no-grammar
    (`.ex`, `.swift`), and php-ruby-cpp. php-ruby-cpp includes real `.c` and `.h` files that `#include` each other
    and a `.cpp` file.
  - Bounds fixtures: a 300-file namespace, 80 manifests, a vendor tree beyond the census limit, a superseded build.
- **Fixed keys.** `WI/testing/mcp-contract/matrix/required-keys.ts` (written in 27) enumerates every key
  `capability:language`, or `honesty:<tool>` for the no-grammar fixture. It carries the Decision 19 selection as a
  committed constant: `SELECTED_OPTIONS = { kotlin: 'vendored', c: 'via-cpp', checkers: 'go-vet-opt-in',
buildCheckers: 'none', extraGraphs: 'include' }`. The full set is below.
  - **Pinning:** the exact key count and a sorted-keys snapshot are asserted, so a deleted key fails.
  - **Changes:** only an approved scope change edits this file.
- **Activation fragments (file-disjoint).** Each activating batch **creates** its own file
  `matrix/activations/<batch>.ts` listing the keys it proves. The spec discovers fragments through `fs`; there is
  no shared index file. It asserts:
  - fragment keys ⊆ required keys, and no key appears in two fragments;
  - activated keys have 100% recall on the fixtures, with only declared approximations;
  - the registry grants each activated capability;
  - non-activated keys meet the tool's unsupported contract;
  - any empty answer without a coverage signal fails.
- **Dispatcher spec** `MCP/mcp-core/mcp-language-coverage.spec.ts`: new shapes pass through the reducer/budget
  path with raw spool equality; `building`, `failed` and partial shapes stay ordered.
- **H reconciles 21.1/21.2:** the new shapes go into the sweep, the new guards into the mandate manifest, and 26b
  becomes the host guard for `ptah_lsp_references`.

**Required keys (Decisions 18 and 19); all required, none optional:**

| Capability                | Languages                                                                                                                                                                                                                                                                                                                                                                                                                                   | Activation owner                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| parse, outline, codeIndex | tsx                                                                                                                                                                                                                                                                                                                                                                                                                                         | 29b                                    |
| parse, outline, codeIndex | java, rust                                                                                                                                                                                                                                                                                                                                                                                                                                  | 30                                     |
| parse, outline, codeIndex | php, ruby, cpp (cpp keys proven on `.c`, `.h` and `.cpp` fixtures)                                                                                                                                                                                                                                                                                                                                                                          | 31                                     |
| parse, outline, codeIndex | kotlin                                                                                                                                                                                                                                                                                                                                                                                                                                      | 30k                                    |
| enrichSummary             | tsx                                                                                                                                                                                                                                                                                                                                                                                                                                         | 29b                                    |
| syntaxDiagnostics         | python, go, csharp                                                                                                                                                                                                                                                                                                                                                                                                                          | 27 (baseline fragment; 25a implements) |
| syntaxDiagnostics         | java, rust                                                                                                                                                                                                                                                                                                                                                                                                                                  | 30                                     |
| syntaxDiagnostics         | php, ruby, cpp                                                                                                                                                                                                                                                                                                                                                                                                                              | 31                                     |
| syntaxDiagnostics         | kotlin                                                                                                                                                                                                                                                                                                                                                                                                                                      | 30k                                    |
| publicSymbols, graphEdges | python, go                                                                                                                                                                                                                                                                                                                                                                                                                                  | 33                                     |
| publicSymbols, graphEdges | csharp, java                                                                                                                                                                                                                                                                                                                                                                                                                                | 34                                     |
| publicSymbols, graphEdges | rust                                                                                                                                                                                                                                                                                                                                                                                                                                        | 35                                     |
| publicSymbols, graphEdges | php, ruby, cpp (cpp graph proven on `.c`/`.h` includes)                                                                                                                                                                                                                                                                                                                                                                                     | 36                                     |
| honesty (10 literal keys) | `honesty:ptah_get_dependents`, `honesty:ptah_get_dependencies`, `honesty:ptah_get_symbol_index`, `honesty:ptah_code_search_symbols`, `honesty:ptah_code_reindex`, `honesty:ptah_ast_analyze`, `honesty:ptah_context_enrich_file`, `honesty:ptah_lsp_definitions`, `honesty:ptah_lsp_references`, `honesty:ptah_get_diagnostics`. Each is asserted against that tool's own honest contract (e.g. ast error, enrich full content with reason) | 27                                     |
| typeCheck                 | go                                                                                                                                                                                                                                                                                                                                                                                                                                          | 37b                                    |

- Kotlin graph support is not required (Decision 19), so there is no `graphEdges:kotlin` key.
- The sorted-key snapshot and the exact count are asserted, and gate 38 requires every key above.

## Grammar sources (settled by Decision 19)

Sizes: raw bytes and per-file `gzip -9` (2026-09-26 probes); 28a/28b record the real artifact deltas.

| Source                                                                                             | Grammars                                              | Licence            | Raw / gz               | State                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed `@vscode/tree-sitter-wasm` 0.3.1                                                         | tsx, java, rust, php, ruby, cpp (also parses `.c/.h`) | MIT                | 11,532,709 B / ~1.0 MB | loaded by both architect and reviewer                                                                                                                                                                                   |
| Vendored Kotlin WASM (`@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0) → batch 30k (**required**) | kotlin                                                | MIT (npm metadata) | 3,360 KB / 288 KB      | temp-dir probe loaded (ABI 14), **not reproducible from this checkout**. **Batch-level gate:** 30k starts only with source URL, version, sha256, LICENSE text and a load record attached and re-checked by the reviewer |

Not in this task (Decision 19):

- a separate C grammar;
- npm grammar dependencies;
- `tree-sitter-wasms` (its C/Kotlin WASM failed `Language.load` on 0.27 in the architect probe).

## Security notes

- Grammars run as sandboxed WASM. Vendored files are sha256-checked by `copy-wasm.js`; a mismatch fails the build.
- Manifest reads are bounded, realpath-contained and text-extracted, and are never evaluated. Resolved targets are
  discovered files that are also realpath-contained.
- Tier 0 spawns nothing.
- Tier 1 runs the user's installed Go toolchain after host-stored, fail-closed consent. It is an execution trust
  decision (authorisation, not a sandbox), scoped to the fixed invocation and allowlisted environment, and verified
  claim by claim by the hostile real-binary fixture.
- pyright is excluded by Decision 19 because project startup code can run.
- Build-running checkers are prohibited by Decision 19.
- No paths or raw error text are logged (`protocol-dispatcher.ts:2635-2655` rule).

## Proposed batches

Common checks for every batch **[project]**:

- `nx run-many -t=test,lint,typecheck -p <touched> --skip-nx-cache`
- `nx run-many -t=typecheck -p ptah-cli ptah-electron`
- `nx run ptah-electron:validate-deps --skip-nx-cache`
- `nx run degradation-audit:lint --skip-nx-cache` at baseline
- shared prompt constants unchanged
- Decision 17 review

FB is the fails-before spec. It fails on **the batch's base**, meaning its last listed dependency merged into the
integration branch, and passes after. Counts include specs, assets and fragments. H owns the dispatcher, formatter,
`tool-description.builder.ts`, `MCP/types.ts`, namespace builders, `ptah-api-builder.service.ts` and lib barrels.

| #    | Title                                                                                                          | Lane                           | Files (count; libs)                                                                                                                                                                                                                                                                                                                                                     | Depends on                                                                                      | Acceptance                                                                                                                       | FB                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 22   | Coverage contract + registry                                                                                   | H (new language-lane worktree) | `PC/interfaces/language-coverage.interface.ts`, `PC/index.ts`, `WI/ast/language-registry.ts`, `WI/ast/language-registry.spec.ts`, `WI/ast/tree-sitter.config.ts`, `WI/index.ts` (6; 2)                                                                                                                                                                                  | —                                                                                               | separate capabilities with initial values; worst-case JSON ≤ 1,000                                                               | `language-registry.spec.ts` "worst-case coverage ≤ 1,000 chars", "codeIndex and publicSymbols are separate" |
| 23a  | Graph accounting, bounds, atomic publish                                                                       | H                              | `WI/ast/graph-coverage.ts`, `WI/ast/graph-coverage.spec.ts`, `WI/ast/dependency-graph.service.ts`, `WI/ast/dependency-graph.service.spec.ts` (4; 1)                                                                                                                                                                                                                     | 22                                                                                              | fair cap; resolution counts; edge cap; superseded build publishes neither                                                        | "edge cap is disclosed", "cap does not starve the second language"                                          |
| 23b  | Graph tools answer honestly; bounded discovery                                                                 | H                              | `protocol-dispatcher.ts`, `protocol-dispatcher.spec.ts`, `analysis-namespace.builders.ts`, `analysis-namespace.builders.spec.ts`, `MCP/types.ts`, `MCP/ptah-api-builder.service.ts` (6; 1)                                                                                                                                                                              | 23a                                                                                             | `.py` → unsupported; vendor tree > limit before code still finds code; coverage ahead of a long path; multi-root merge           | "dependents of a python file is not a silent empty list", "vendor tree does not exhaust discovery"          |
| 24a  | Parse status; ast sub-operations                                                                               | H                              | `WI/ast/ast-analysis.interfaces.ts`, `WI/ast/tree-sitter-parser.service.ts`, `…parser.service.spec.ts`, `WI/ast/ast-analysis.service.ts`, `…analysis.service.spec.ts`, `MCP/namespace-builders/ast-namespace.builder.ts`, `…builder.spec.ts` (7; 2 — cohesive: one field end to end)                                                                                    | 22                                                                                              | `.tsx` JSX → `recovered`; py `queryExports` errors                                                                               | "recovered parse not reported clean", "python queryExports is not a silent []"                              |
| 24b  | Code index live coverage                                                                                       | H                              | `WI/services/code-symbol-indexer.service.ts`, `…indexer.service.spec.ts`, `MCP/namespace-builders/code-namespace.builder.ts`, `…builder.spec.ts`, `MCP/types.ts` (5; 2)                                                                                                                                                                                                 | 22                                                                                              | tests in 24b design                                                                                                              | "search during a run reports updating", "kt reindex is not filesScanned 1"                                  |
| 25a  | Diagnostics contract + provider                                                                                | H                              | `PC/interfaces/diagnostics-provider.interface.ts`, `PC/testing/contracts/run-diagnostics-provider-contract.ts`, `WI/diagnostics/language-aware-diagnostics-provider.ts`, `…provider.spec.ts`, `WI/di/register.ts` (5; 2)                                                                                                                                                | 22, 23a, 23b (bounded `discoverSourceFiles`)                                                    | 51 files → 1 omitted; unscoped python → `unchecked`                                                                              | contract "syntax-only is not a type-check claim"                                                            |
| 25b  | Diagnostics forwarding + e2e                                                                                   | H                              | `core-namespace.builders.ts`, `core-namespace.builders.spec.ts`, `MCP/types.ts`, `mcp-response-formatter.ts`, `mcp-response-formatter.spec.ts`, `MCP/mcp-core/diagnostics-coverage.e2e.spec.ts` (6; 1)                                                                                                                                                                  | 25a                                                                                             | e2e cases                                                                                                                        | "mixed repo never prints a bare No issues found"                                                            |
| 26a  | LSP report contract + forwarding                                                                               | H                              | `ide-namespace.builder.ts`, `ide-namespace.builder.spec.ts`, `MCP/types.ts`, `protocol-dispatcher.ts`, `protocol-dispatcher.spec.ts`, `mcp-response-formatter.ts` (6; 1)                                                                                                                                                                                                | 25b                                                                                             | no-host answer; report preferred                                                                                                 | "no-host definitions are not Found: 0"                                                                      |
| 26b  | Electron report, C# fallback, narrowing gate                                                                   | E                              | `Electron`, `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts` (2; app)                                                                                                                                                                                                                                                                                | 26a, 23b                                                                                        | tests in 26b design                                                                                                              | "complete-census graph with edgeCapHit is not used to narrow"                                               |
| 24c  | Registry-generated descriptions                                                                                | H                              | `tool-description.builder.ts`, `tool-description.builder.spec.ts` (2; 1)                                                                                                                                                                                                                                                                                                | 26a                                                                                             | lists = registry                                                                                                                 | "description language list equals registry"                                                                 |
| 27   | Harness H3                                                                                                     | T (+H for 21 rows)             | `polyglot-fixtures.ts`, `matrix/required-keys.ts`, `matrix/activations/b27-baseline.ts`, `language-honesty.contract.spec.ts`, `MCP/mcp-core/mcp-language-coverage.spec.ts` (5; 2) + H: `mcp-contract.sweep.spec.ts`, `mcp-mandate-manifest.spec.ts` if 21 landed                                                                                                        | 20.1 merged; the full honesty chain explicitly: 22, 23a, 23b, 24a, 24b, 24c, 25a, 25b, 26a, 26b | key snapshot pinned (ten honesty keys); honesty keys active                                                                      | on base 22 the honesty keys fail                                                                            |
| 28a  | Grammar manifest                                                                                               | P                              | `scripts/tree-sitter-grammars.json`, `scripts/copy-wasm.js`, `apps/ptah-electron/scripts/verify-packed-wasm.js`, `apps/ptah-cli/scripts/verify-packed-wasm.cjs`, `.github/workflows/publish-cli.yml` (5)                                                                                                                                                                | —                                                                                               | runtime + grammar rows with `active`; `--self-test` negatives in CI                                                              | Electron asar without python passes today                                                                   |
| 28b  | VSIX packed check                                                                                              | P                              | `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs`, `apps/ptah-extension-vscode/project.json` (2)                                                                                                                                                                                                                                                              | 28a                                                                                             | runs after `package` on the real `.vsix`                                                                                         | missing grammar in `.vsix` passes today                                                                     |
| 29a1 | Language modules (pure move)                                                                                   | G                              | `WI/ast/languages/{typescript,javascript,python,go,csharp}.language.ts`, `languages/index.ts`, `languages/types.ts`, `tree-sitter.config.ts`, `language-registry.ts` (9; 1 — justified move)                                                                                                                                                                            | 27, 28a                                                                                         | existing specs green unchanged                                                                                                   | n/a (refactor)                                                                                              |
| 29a2 | Lazy isolated loading                                                                                          | G                              | `tree-sitter-parser.service.ts`, `…service.spec.ts`, `WI/ast/grammar-manifest.spec.ts` (3; 1)                                                                                                                                                                                                                                                                           | 29a1                                                                                            | corrupt grammar isolated; > 1 MiB refused                                                                                        | "a failing grammar does not disable the others"                                                             |
| 29b  | tsx, atomic                                                                                                    | H                              | `ast.types.ts`, `languages/tsx.language.ts`, `languages/index.ts`, `context-enrichment.service.ts`, `…service.spec.ts`, `WI/ast/tsx-grammar.integration.spec.ts`, `code-outliner.adapter.ts`, `…adapter.spec.ts`, `analysis-namespace.builders.ts`, `…builders.spec.ts`, manifest, `matrix/activations/b29b.ts` (12; 2 — justified: exhaustive union + outliner record) | 29a2                                                                                            | tsx keys active; host typechecks green                                                                                           | "tsx declaration file summarises", "tsx outline not refused"                                                |
| 30   | Java + Rust grammars                                                                                           | G1                             | `ast.types.ts`, `languages/java.language.ts`, `languages/rust.language.ts`, `languages/index.ts`, `WI/ast/java-rust-grammar.integration.spec.ts`, `code-outliner.adapter.ts`, `…adapter.spec.ts`, manifest, `matrix/activations/b30.ts` (9; 2 — justified activation unit)                                                                                              | 29b                                                                                             | keys active                                                                                                                      | new keys fail on base 29b                                                                                   |
| 31   | PHP, Ruby, C++ grammars                                                                                        | G1                             | as 30 with `php`, `ruby`, `cpp` modules and `php-ruby-cpp-grammar.integration.spec.ts`, `b31.ts` (10; 2)                                                                                                                                                                                                                                                                | 30                                                                                              | keys active; `c:parsed-as-cpp`                                                                                                   | as 30                                                                                                       |
| 30k  | Kotlin grammar (required; **batch gate: Kotlin provenance record attached and reviewer-checked before start**) | G1                             | `ast.types.ts`, `languages/kotlin.language.ts`, `languages/index.ts`, `assets/tree-sitter/tree-sitter-kotlin.wasm`, `assets/tree-sitter/LICENSE-tree-sitter-kotlin`, manifest, `kotlin-grammar.integration.spec.ts`, `code-outliner.adapter.ts`, `…adapter.spec.ts`, `b30k.ts` (10; 2)                                                                                  | 31, provenance gate                                                                             | sha256 verified; keys active                                                                                                     | kotlin keys fail on base 31                                                                                 |
| 32a  | Extraction contract                                                                                            | G2                             | `ast-analysis.interfaces.ts`, `ast-analysis.service.ts`, `…service.spec.ts`, `languages/types.ts` (4; 1)                                                                                                                                                                                                                                                                | 29b                                                                                             | TS/JS byte-identical; fixtures in 32a design                                                                                     | "two inline Rust modules keep separate scopePath"                                                           |
| 32b  | Resolver seam, context, bounds                                                                                 | G2                             | `import-resolution/import-resolver.ts`, `…/ts-js-import-resolver.ts`, `…/resolver-context.ts`, `…/resolver-context.spec.ts`, `dependency-graph.service.ts`, `…service.spec.ts` (6; 1)                                                                                                                                                                                   | 32a                                                                                             | alias edge resolves; limits disclosed; cancellation mid-expansion                                                                | "tsconfig alias resolves on the MCP path"                                                                   |
| 32c  | Drop dead tsconfig parameter                                                                                   | H                              | `analysis-namespace.builders.ts`, `…builders.spec.ts` (2; 1)                                                                                                                                                                                                                                                                                                            | 32b                                                                                             | no behaviour change                                                                                                              | n/a                                                                                                         |
| 33   | Python + Go graphs                                                                                             | G2                             | `import-resolution/python-import-resolver.ts`, `…/python-import-resolver.spec.ts`, `…/go-import-resolver.ts`, `…/go-import-resolver.spec.ts`, `languages/python.language.ts`, `languages/go.language.ts`, `matrix/activations/b33.ts` (7; 1)                                                                                                                            | 32b, 27                                                                                         | keys active                                                                                                                      | keys fail on base 32b                                                                                       |
| 34   | C# + Java graphs                                                                                               | G2                             | `csharp-import-resolver.ts` + spec, `jvm-import-resolver.ts` + spec, `languages/csharp.language.ts`, `languages/java.language.ts` (handed over by G1 after 30), `b34.ts` (7; 1)                                                                                                                                                                                         | 33, 30                                                                                          | approximations declared                                                                                                          | keys fail on base 33                                                                                        |
| 35   | Rust graph                                                                                                     | G2                             | `rust-import-resolver.ts` + spec, `languages/rust.language.ts` (handoff), `resolver-context.ts`, `b35.ts` (5; 1)                                                                                                                                                                                                                                                        | 34                                                                                              | inline modules, grouped use, Cargo workspace                                                                                     | keys fail on base 34                                                                                        |
| 36   | PHP/Ruby/C++ graphs (required, Decision 19; cpp graph proven on `.c`/`.h` includes)                            | G2                             | three resolvers + three specs, three language modules (handoff after 31), `b36.ts` (10; 1 — justified)                                                                                                                                                                                                                                                                  | 35, 31                                                                                          | keys active                                                                                                                      | keys fail on base 35                                                                                        |
| 37a  | `go vet` checker (required; **batch gate: O2 amendment reviewed**)                                             | checker author                 | `WI/diagnostics/external-checkers/checker-runner.ts`, `…/checker-runner.spec.ts`, `…/go-vet-checker.ts`, `…/go-vet-checker.spec.ts`, `…/go-vet-hostile.integration.spec.ts` (5; 1)                                                                                                                                                                                      | O2 closed, 25a                                                                                  | fixed invocation pinned; per-claim hostile evidence; fail-closed consent read                                                    | "hostile PATH entry rejected"                                                                               |
| 37b  | Checker host wiring + consent                                                                                  | H                              | `language-aware-diagnostics-provider.ts`, `WI/di/register.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`, consent surface files per O2, `matrix/activations/b37b.ts` (≥ 6; 2 + app)                                                                                                                              | 37a                                                                                             | denied by default; typeCheck:go active                                                                                           | "checker does not run without consent"                                                                      |
| 38   | Completion gate                                                                                                | T                              | `language-honesty.contract.spec.ts` (1)                                                                                                                                                                                                                                                                                                                                 | 21 (21.1, 21.2), 27, 28b, 29b, 30, 30k, 31, 33, 34, 35, 36, 37b (all required)                  | activated keys == the enumerated required keys exactly, incl. the ten honesty keys, kotlin, php/ruby/cpp graphs and typeCheck:go | fails on any earlier base                                                                                   |

## Lanes [arch] (reviewer's proposal, amended)

At most 3 CLI lanes at once (Decision 17). Only the team-leader merges.

| Lane                                            | Batches                                                              | Ownership rule                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H (**new language-lane worktree**, Decision 19) | 22 → 23a → 23b → 24a → 24b → 25a → 25b → 26a → 24c → 29b → 32c → 37b | all hub files. Starts while Lane A (this worktree) finishes 17 → 18 → 15 → 13; shared-file changes merge in quiet windows by the team-leader. 21 stays with Lane A |
| P                                               | 28a → 28b                                                            | now; no source edits                                                                                                                                               |
| E                                               | 26b                                                                  | after 26a (+23b); Electron file and spec only                                                                                                                      |
| T                                               | 27, 38                                                               | 27 after 20.1 and the explicit honesty chain 22-26b incl. 24a/24b/25b; later batches only **add** fragment files                                                   |
| G                                               | 29a1 → 29a2                                                          | after 27 and 28a                                                                                                                                                   |
| G1                                              | 30 → 31 → 30k (provenance gate)                                      | after 29b (H); owns `ast.types.ts`, `languages/index.ts`, the outliner and new language modules; hands java/rust/php/ruby/cpp modules to G2 after each merge       |
| G2                                              | 32a → 32b → 33 → 34 → 35 → 36 (required)                             | 32a after 29b; 34 after 30; 36 after 31                                                                                                                            |
| checker author                                  | 37a                                                                  | after O2 amendment is reviewed                                                                                                                                     |

Matrix edits are file-disjoint: each activating batch creates its own fragment, and `required-keys.ts` is written
once (27). The manifest `active` flags are edited by G1 (grammars) and H (29b) only, in merge windows.

## Risks

| Risk                                                    | Severity | Mitigation                                                                                  |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| Grammar memory (cpp ~20 MB, C# ~16 MB RSS, noisy probe) | HIGH     | 29a2 lazy loading precedes activation                                                       |
| Large synchronous parse                                 | HIGH     | 1 MiB refusal; worker thread stays 561 B4                                                   |
| Polyglot build time (225 s TS-only, batches.md:1913)    | HIGH     | bounded discovery, eligible-only fair cap, vendor excludes in the walk, 9b background build |
| Quadratic namespace/package edges                       | HIGH     | per-import 200 / aggregate 250,000 limits, disclosed                                        |
| Approximate graph used as proof of absence              | HIGH     | per-query narrowing gate                                                                    |
| Size +11.5 MB installed per host (+3.4 MB Kotlin)       | MEDIUM   | manifest; real artifact deltas in 28                                                        |
| Wrong node names                                        | HIGH     | real-grammar specs + fixed-key recall                                                       |
| Coverage lost at a boundary                             | HIGH     | e2e specs 25b, 27                                                                           |
| Index coverage vs live rows                             | MEDIUM   | `updating`/`incomplete` states, sole writer verified                                        |
| validate-deps false MISSING                             | MEDIUM   | string rule; validate-deps each batch                                                       |
| Hub contention with Lane A                              | MEDIUM   | H sequential                                                                                |
| Tier 1 trust                                            | HIGH     | consent, allowlist, hostile real-binary fixture, pyright excluded                           |

## Review response

### r1 (12 issues; recorded in revision 1)

- 1-12 were addressed in revision 1. r2 rated 1, 6, 10 and 12 FIXED, and 2, 3, 4, 5, 7, 8, 9 and 11 PARTIAL.
- Each PARTIAL item is closed below through the matching r2 finding: 2 → r2-1/r2-9; 3 → r2-2; 4 → r2-6; 5 and 7
  → r2-3; 8 → r2-8; 9 → r2-7; 11 → r2-4/r2-5.

### r2 (9 findings)

| #   | Severity | Change                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Serious  | `codeIndex` and `publicSymbols` are separate capabilities (code index already active for py/go/cs; export extraction pending until 33/34). FB "codeIndex and publicSymbols are separate"; 24b test "Python stays searchable while Python `queryExports` errors"                                                                                                       |
| 2   | Serious  | `unchecked` bucket; `resolution` block (external / unresolvedInternal / truncatedImports / edgeCapHit / context); clean-answer rule treats unknown/truncated/updating as qualified; closed vocabularies enumerated; priority overflow with `approximationsOmitted`; saturation at 9,999,999; worst case measured at 909 chars; budget tests list the reviewer's cases |
| 3   | Serious  | Vendor globs passed **into** `IFileSystemProvider.findFiles` via a new `discoverSourceFiles` (`excluded:null`, honest); narrowing gate requires every census language to be scope-complete + clean resolution + declarations in the graph; the reviewer's three tests added to 26b/23b                                                                                |
| 4   | Blocking | tsx is one atomic H batch (29b): union + config module + outliner record + enrichment + namespace + manifest + activation fragment; 30/31/30k each add their union ids and outliner entries in the same batch; every batch independently green                                                                                                                        |
| 5   | Moderate | Matrix = fixed `required-keys.ts` + per-batch activation fragment files (created, never shared); exact filenames and recounted counts incl. manifest/fragments/assets; FB base defined as "last listed dependency merged"                                                                                                                                             |
| 6   | Serious  | Query table and resolution table restored in place (no first-draft references); `declarationQuery` runs as an extra `queryMulti` entry; `ImportInfo.scopePath` by range containment; two-inline-module Rust FB; 24a now lists `ast-analysis.interfaces.ts`                                                                                                            |
| 7   | Serious  | Keys enumerated with owners; exact-membership + sorted snapshot; gate 38 depends on 21, 28b and every selected option batch (30k, 31c, 36, 37b); native C batch 31c; unsupported Q1-C / Q2 automatic / Q3 consent branches marked "not designed, amendment required"                                                                                                  |
| 8   | Serious  | pyright excluded with the upstream evidence; Q2 = `go vet` only; consent in host-owned workspace-scoped storage, default denied, repo config never consent; enable/revoke surface is open item O2 and blocks 37a; hostile real-binary fixture                                                                                                                         |
| 9   | Moderate | Live states `updating` (set synchronously before any write) / `current` / `incomplete`; per-file reindex rules; sole-writer verification; tests between file updates and after an abort; no atomicity claim                                                                                                                                                           |

Rejected: none. Amendment to the reviewer's lanes: matrix activation is by new fragment files, so no lane shares a
matrix file.

### r3 (APPROVED WITH EDITS)

Every required edit is applied; none rejected.

| Edit      | Change                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finding 1 | the ten honesty keys are listed literally; the snapshot and gate 38 require all ten                                                                                                                                        |
| Finding 2 | size claim corrected to the measured envelope (909 / 920 / 913 chars, asserted ≤ 1,000, fixture recorded in 22); overflow "disclosed, not guaranteed to survive"; `RecognisedLanguageId` added to the map key type         |
| Edit 1    | Decision 19 recorded in Inputs, the title and the Summary; O1 closed; the questions replaced by Recorded decisions                                                                                                         |
| Edit 2    | Kotlin/30k required with a batch-level provenance gate; native C batch 31c and the `c` id removed; `.c/.h` via cpp, with real `.c/.h` fixtures in the cpp keys; size and risk text updated                                 |
| Edit 3    | 37a/37b required; 37a gated on O2 (Electron and CLI enable/revoke surfaces, files and tests); pyright excluded by Decision 19; build-running checkers prohibited; consent fails closed on an `undefined` workspace storage |
| Edit 4    | `SELECTED_OPTIONS` committed; php/ruby/cpp `publicSymbols`/`graphEdges` and 36 required; gate 38 waits for 30k, 36, 37b and its mandatory dependencies; no Kotlin graph key                                                |
| Edit 5    | Go execution scope stated exactly; fixed invocation with validated package arguments and no caller flags; claim-by-claim hostile evidence; honest "not checked" on failures                                                |
| Edit 6    | per-file / concurrent-write accounting rules, no promotion of an unknown census by one file, 2,000-entry overflow disclosed; same-file overlap and 2,001st-update tests in 24b                                             |
| Edit 7    | H runs in the new language-lane worktree while Lane A finishes 17 → 18 → 15 → 13; 25a depends explicitly on 23b; 27 depends explicitly on the whole honesty chain 22-26b                                                   |

## Open items (batch-level gates, not open questions)

- **O1 — closed by Decision 19.**
- **O2 — `go vet` consent surface (gates 37a).** A short reviewed amendment names the Electron and the CLI
  enable/revoke surfaces, their files and tests. Storage (host-owned, default denied, fail-closed) is designed.
- **O3 — Kotlin provenance (gates 30k).** The load probe ran in a temp directory and cannot be reproduced from this
  checkout. 30k starts only with source URL, version, sha256, LICENSE and a load record attached and re-checked by
  the reviewer.
- **O4 — Response size.** Coverage adds up to ~920 measured characters (asserted ≤ 1,000) to language-bound
  responses, inside the 8,000-char budget and ahead of lists. Pages carry correspondingly fewer entries.

## Recorded decisions (User Decision 19, context.md:59)

1. **Grammars.**
   - The MIT Kotlin WASM is bundled (30k, required, provenance gate O3).
   - `.c/.h` parse with the installed C++ grammar (`c:parsed-as-cpp`, disclosed; some valid C may parse with
     errors and is reported as `failed.parse`).
   - No separate C grammar and no npm grammar dependencies.
2. **Checkers.**
   - `go vet` only, per-workspace opt-in (37a/37b, required; 37a gated on O2).
   - pyright is excluded.
   - Every other language reports "not checked" honestly.
3. **Build-running checkers** (cargo, dotnet, gradle/maven, clang via compile_commands) are never run.
4. **Batch 36** (PHP, Ruby, C/C++ graphs) is included and required, and gate 38 checks it.
