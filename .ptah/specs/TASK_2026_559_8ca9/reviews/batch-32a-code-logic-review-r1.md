# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Batch | 32a — Extraction contract, Lane G2; uncommitted changes against da21c936c |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Requested verdict | REVISE |
| Blocking issues | 3 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 5 |

The ordinary fixtures work and TS/JS/TSX parity holds on an independent fixture. However, valid Rust syntax can lose or invent dependencies with a clean parse, and the new contract loses C# static-import information. This separates 5/10 from 7–8: successful happy-path extraction does not establish a lossless resolver input. It is above 3–4 because declaration containment, grouping, relative levels and error propagation work in the examined paths. R5 is pre-existing and explicitly carried to 32b; it is not a 32a regression.

Scope: read all eleven changed source/spec files, the executor report, Batch 32a/32b, D3, common checks, language-plan extraction/resolution sections and context Decisions 18–26. Also examined parser query execution, export decoding, TS/JS/TSX queries and graph ingestion/linking. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder; the language plan and task.md provide the requirements. Direct ptah_search_files found no AGENTS.md; native scoped checks likewise found none. No source or task-state files were edited.

Verification: real shipped WASM grammars through the actual TreeSitterParserService and AstAnalysisService, using a temporary Node TypeScript loader, real shared Result, inert logging/DI tokens and the same WASM-location adaptation as the integration specs. Probe files are in the OS temp directory. Scoped ptah_get_diagnostics reported zero errors/warnings. The requested Nx run (PowerShell quoting and Select-Object -Last 30 equivalent of tail) reported all six test/lint/typecheck targets successful for workspace-intelligence and vscode-lm-tools, in 1m26s. The surrounding PowerShell command returned exit 1 despite Nx's explicit success summary; no individual task failed in that summary. Common cross-host checks/validate-deps/audit are executor-reported evidence, not independently repeated here.

## Five logic questions

### 1. How does this fail silently?

Rust's second parser is a regex tokenizer: nested comments truncate a use list (R1), and combining marks disappear from identifiers (R2), while analysis forwards the grammar's clean parse metadata (`languages/rust.language.ts:129`, `:130`; `ast-analysis.service.ts:182`). Empty TS/JS re-export clauses have no record at all (R5; `languages/javascript.language.ts:152`). These are extraction failures, not grammar failures.

### 2. What user action produces unexpected behaviour?

Adding a legal nested comment to a Rust use list changes the extracted dependency set (R1). Changing a C# namespace import into a global static type import can leave the serialized record unchanged (R3; `languages/csharp.language.ts:168`). Renaming Python imported members loses their local names (R4; `languages/python.language.ts:79`).

### 3. What input data produces a wrong answer?

`use crate::cafe\u0301::X;` with an actual U+0301 emits `crate::cafe::X`, a different identifier (R2). The nested-comment fixtures in R1 both parse with zero errors. Go escaped paths and Java/C# qualified names containing comments retain raw spelling (`languages/go.language.ts:53`, `languages/java.language.ts:93`, `ast-analysis.service.ts:475`); future resolvers must normalize these deliberately, not use them directly as semantic identity.

### 4. What happens when a dependency fails?

Grammar/query failures return Result.err; analyzeSource preserves the parser failure as a cause (`ast-analysis.service.ts:136`, `:148`). Query/tree objects are deleted in finally (`tree-sitter-parser.service.ts:636`), and the graph records failed analysis instead of creating a node (`dependency-graph.service.ts:642`). The existing failure spec exercises propagation (`ast-analysis.service.spec.ts:475`). No new asynchronous dependency or cancellation boundary was introduced: decoding runs synchronously after one queryMulti call (`ast-analysis.service.ts:130`, `:164`). No timeout/failure injection into native WASM was performed.

### 5. What is missing that the requirements never mentioned?

The contract needs orthogonal import traits rather than assuming one kind retains all semantics (R3), per-member alias information if exact import representation is required (R4), and dependency records independent of exported symbol count (R5). Public visibility/re-export symbol expansion is distinct from dependency edges: Rust pub use and Python star imports supply edges today, but do not supply exported-name records (`languages/rust.language.ts:254`, `languages/python.language.ts:112`). Public-symbol support remains later-batch work.

## Failure modes

All source anchors below are relative to `libs/backend/workspace-intelligence/src/ast/` unless explicitly stated.

### 1. R32A-01 — Blocking — Nested Rust comments silently remove imports

- Trigger: `use a::{b, /* outer /* nested */ } */ c};`.
- Symptom: real WASM analysis returns only `a::b`, omitting `a::c`, with parseStatus `ok` and errorNodeCount 0. Replacing the `}` inside the comment with `comment` instead produces phantom `a::comment` and wildcard `a` imports.
- Evidence: `languages/rust.language.ts:129` removes only through the first closing comment delimiter; the remaining comment text enters the use-tree parser at `:140`.
- Current handling: neither an extraction warning nor refusal; fabricated/truncated imports are returned normally at `ast-analysis.service.ts:534`.
- Impact: callers receive an incorrect dependency set; later resolution cannot reconstruct the discarded use path and may add phantom edges.
- Recommendation: decode grammar nodes without the depth-3 truncation, or implement a nested-comment-aware lexer. Add both real-grammar regression fixtures and assert the entire import array and clean grammar parse.
- Disposition: **fix-now**; verify the fix in the 32b review.

### 2. R32A-02 — Blocking — Rust identifier tokenization removes combining characters

- Trigger: `use crate::café::X;` where the accent is U+0301 following `e` (not precomposed U+00E9).
- Symptom: actual output source is `crate::cafe::X`, with clean parse metadata.
- Evidence: `languages/rust.language.ts:130` accepts letters/numbers/underscore but omits combining marks; `:190` joins the altered segments into the source path.
- Current handling: unmatched characters disappear without validation or disclosure.
- Impact: dependency resolution can select a different existing module (`cafe`) or omit the intended accented module. This is wrong data, not an explicit unsupported-input result.
- Recommendation: retain grammar identifier text; apply the language's semantic normalization at the defined resolver boundary. Do not reconstruct identifiers by deleting characters. Add decomposed-Unicode and raw-identifier fixtures.
- Disposition: **fix-now**; verify in 32b.

### 3. R32A-03 — Serious — Global C# imports lose the static trait

- Trigger: compare `global using static Acme.Tools;` with `global using Acme.Tools;` in separate sources.
- Symptom: both yield exactly `{source:'Acme.Tools', kind:'global', line:0, scopePath:[]}`.
- Evidence: `languages/csharp.language.ts:168` gives global precedence and `:177` returns no remaining static discriminator; the fixture at `ast-analysis.service.spec.ts:995` pins that loss. The claim that the lost trait remains visible in `ast-analysis.interfaces.ts:61` does not hold here.
- Current handling: global versus static are mutually exclusive despite being independent language features.
- Impact: the resolver cannot distinguish a namespace target from a type target from ImportInfo alone. It must guess or read/reparse the source, undermining the planned seam.
- Recommendation: retain an orthogonal flag/trait (for example isStatic) while preserving global scope, and ensure ExtractedImport carries it. Add paired fixtures requiring distinguishable records.
- Disposition: **fix-now** before freezing the seam; verify in 32b, consume in 34.

### 4. R32A-04 — Moderate — Python member aliases are not representable

- Trigger: `from ..p import A as B, C as D`, including the same statement inside TYPE_CHECKING or try blocks.
- Symptom: the record contains source `..p` and importedSymbols `['A','C']`; B and D disappear. `from . import x as y` similarly loses y.
- Evidence: `languages/python.language.ts:79` maps aliased nodes only to their original names; `ast-analysis.interfaces.ts:128` defines alias as the source binding, not a per-member mapping.
- Current handling: original dependency names survive, so file-edge extraction can still work; exact binding/re-export information cannot be recovered. The fixture at `ast-analysis.service.spec.ts:1113` checks only original names.
- Impact: the requested exact representation of aliases is incomplete, though this does not by itself prevent Python file edges.
- Recommendation: add optional per-symbol local bindings or an equivalently lossless representation; preserve original importedSymbols for resolution. Cover multiple distinct aliases and relative imports.
- Disposition: **carry-to-33**; document the contract extension at the 32b handoff rather than claiming all aliases are represented already.

### 5. R32A-05 — Blocking, pre-existing — Empty re-export clauses disprove the universal re-export claim

- Trigger: JavaScript or TypeScript `export {} from './side';`.
- Symptom: both real grammars return imports `[]`, no exports and no unextractedExports, with parseStatus `ok`. An independent Node data-URL module probe confirmed an empty re-export executes its source module.
- Evidence: `languages/javascript.language.ts:152` requires an export_specifier; `dependency-graph.service.ts:733` links only imports. The proposed workaround in `.ptah/specs/TASK_2026_559_8ca9/batch-32a-executor-report.md:35` filters export records that do not exist for this form.
- Current handling: there is no record for the resolver to resolve. Ordinary named, namespace and wildcard re-exports do have source-bearing ExportInfo records.
- Impact: a real dependency is absent; merely resolving existing exports in 32b cannot fix every static re-export form. The existing referenceScopeComplete:false at `languages/javascript.language.ts:272` remains essential; a clean grammar parse is not proof of complete dependency extraction.
- Recommendation: capture module requests independently of the number of exported names, or supply an explicit dependency-source channel. Add forward/reverse graph regressions for an empty clause and ordinary re-exports. Preserve the 32a TS/JS parity commitment here; make the intentional extraction extension in 32b.
- Disposition: **carry-to-32b**, alongside its already-carried re-export edge work; update the executor's universal claim.

## Blocking issues

R32A-01 (`languages/rust.language.ts:129`) and R32A-02 (`:130`) require lossless Rust decoding now. R32A-05 (`languages/javascript.language.ts:152`) requires the carried 32b dependency-source fix. Concrete triggers, impacts and fixes are specified above; these are three distinct failure modes.

## Serious issues

R32A-03 (`languages/csharp.language.ts:168`): preserve static independently of global before consumers rely on the contract.

## Moderate and minor issues

R32A-04 (`languages/python.language.ts:79`): carry the missing per-member alias representation to 33. No separate style findings are included.

## Data flow

1. Language registration selects queries and optional extraction — OK (`ast-analysis.service.ts:117`). TS/JS/TSX retain the old decoder.
2. One queryMulti parses and captures imports plus declarations — OK (`:130`; `tree-sitter-parser.service.ts:610`). Captures stop at depth 3, which motivated but does not justify Rust's lossy re-parser.
3. Declarations sort by exact row/column containment and compose scope names — OK for examined nested/file-scoped fixtures (`ast-analysis.service.ts:483`). Names retain source spelling, so semantic normalization is a resolver obligation.
4. Import statements deduplicate by position, not source — OK; repeated identical imports in sibling scopes survive (`:515`). Rust lexical corruption, C# trait loss and Python alias loss occur in language decoders (R1–R4).
5. Parse metadata and imports return together — GAP: syntax success does not detect extraction loss (`:182`, `:534`).
6. Graph retains imports/exports but currently drops declarations — expected 32b integration obligation (`dependency-graph.service.ts:657`). Context construction must retain declarations for C#/Java/Go; it must not attempt to reconstruct namespace maps from imports.
7. Linker currently sees imports only — carried 32b work (`dependency-graph.service.ts:733`), with the extra missing-input case R5.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Nine kinds, optional fields, line/scopePath | PARTIAL | Global/static combination loses data; member aliases missing |
| Declaration query in the same parse | COMPLETE | ast-analysis.service.ts:125 |
| Nested C#/Rust and file-scoped declarations | COMPLETE | Exact containment implemented at ast-analysis.service.ts:489; normal fixtures pass |
| Python relative, star, multi-name and conditional imports | PARTIAL | Sources/original names retained; aliases R4 |
| Go grouped, raw, dot, blank, named forms | COMPLETE | languages/go.language.ts:48; real-grammar probes match |
| Java static, wildcard, nested-type paths | COMPLETE | languages/java.language.ts:79; fixtures pass |
| Rust nested groups, self/super/crate, file/inline modules | PARTIAL | Ordinary cases pass; valid comment/Unicode forms fail R1/R2 |
| TS/JS output byte-identical | COMPLETE for tested fixture | JSON.stringify entire insights equals HEAD for TS, JS and TSX; not a universal equivalence proof |
| Re-export edge input sufficient for every form | PARTIAL | R5; no public-name expansion for Python/Rust promised here |
| Scoped checks | COMPLETE | Six Nx targets report success; diagnostic errors/warnings 0 |

Implicit requirements not fully addressed: lossless handling of legal lexical trivia and Unicode; compound import traits; an edge source with zero exported symbols.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty source | YES | Empty query map and clean metadata, parser service:566 | Declarations [] only for declaration-capable languages |
| Repeated source in distinct inline modules | YES | Position identity, analysis service:520 | Preserves different scopes |
| Nested Rust `a::{b::{c,d as e},*}` | YES | Probe emitted a::b::c, a::b::d alias e, wildcard a | R1/R2 still apply |
| Rust pub use / Python __init__ star | YES for direct edge input | Rust imports retained; Python .a plus ['*'] retained | Exports/public visibility absent; do not equate edge completeness with symbol completeness |
| Python conditional imports | YES as conservative union | Captured in TYPE_CHECKING/try/except | No execution-condition metadata; do not promise runtime-exact edges |
| C# global alias | YES | Alias survives kind global, csharp.language.ts:179 | Static does not (R3) |
| Go interpreted escapes | NO semantic decoding yet | Probe retains example.com/\\x66oo, go.language.ts:53 | Batch 33 must decode valid escapes before path lookup |
| Java/C# qualified-name comments | NO semantic normalization yet | Raw text retained, analysis service:475 | Batch 34 must normalize both declarations and import targets |
| Malformed Python | YES disclosed syntax recovery | Probe returned parseStatus recovered | Extracted partial names must not be treated as complete |
| Very large input | YES bounded parsing | Existing 1 MiB cap, parser-refusal.ts:15 | No large declaration-count performance benchmark performed |
| Native dependency failure | YES by code/spec evidence | Result.err propagation and cleanup | Not independently fault-injected |
| Empty TS/JS re-export clause | NO | No capture requiring zero specifiers | R5 |

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for reproduced extraction failures; MEDIUM for future resolver consequences because 32b–35 are not implemented here.
- Top risk: syntactically valid Rust can yield a different dependency set while retaining clean parse metadata.
- What a robust implementation would add: grammar-faithful Rust expansion; orthogonal C# import traits; explicit Python member bindings; dependency-source extraction independent of exported symbol count; regression tests using the reproduced inputs.
- Roll-forward: verify R1–R3 fixes in the 32b review, implement R5 in 32b, and carry R4 into 33. Preserve conservative capability claims until each resolver and symbol extractor is actually wired.

