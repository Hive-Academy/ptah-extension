# Multi-language design review r2 — TASK_2026_559_8ca9

**Verdict: REVISE**

The revision repairs important r1 omissions, especially diagnostics forwarding, explicit code-tool honesty work, TSX enrichment files, and archive verification. It is not ready for approval: the shared capability model contradicts existing Python/Go/C# indexing, the TSX split cannot pass its intermediate typecheck, graph limits still lack adequate response semantics, and completion/parallel ownership remain inconsistent. Q2 now acknowledges risk, but its suggested interpreter mitigation does not establish that project code cannot run.

Reviewed the 516-line revised plan and all twelve r1 findings on 2026-09-26. This is a design review, not implementation validation. Only this report was written; source, active Batch 17 work, and git state were untouched. No dependencies were installed and no project checker, packaging build, or project test suite was run. Targeted native reads were used because no Ptah file-content reader is exposed. Fresh source checks covered the index freshness port/store, index writer/search flow, AST query/extraction contracts, exhaustive outliner map, and search namespace. Official upstream source was inspected for the new pyright security claim.

## References

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- `Plan` means `.ptah/specs/TASK_2026_559_8ca9/implementation-plan-languages.md`.
- `Context` means `context.md` in the same task folder; Decisions 17 and 18 are at lines 55 and 57.
- `WI` = `libs/backend/workspace-intelligence/src`.
- `MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`.
- `PC` = `libs/backend/platform-core/src`.

## r1 issues status

FIXED means the design now specifies a sufficient remedy for that finding, not that production code has been fixed.

| r1                                                | Status      | Revised-plan evidence and remaining qualification                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Diagnostics coverage lost at namespace         | **FIXED**   | `Plan:254–282`, batches 25a/b at `:415–416`: both result arms, payload type, namespace forwarding, severity independence and a real end-to-end rendering test are named.                                                                                                                            |
| 2. Symbol search/reindex silent empties           | **PARTIAL** | `Plan:235–250`, batch 24b `:414` adds unsupported responses and accounting. The shared `symbols` capability is contradictory (issue 1 below), and retained last-run coverage does not describe rows being mutated by an in-flight or aborted run (issue 9).                                         |
| 3. Coverage cannot encode promised outcomes       | **PARTIAL** | `Plan:116–156`, `:254–267` adds disjoint counts, unknowns, reasons, atomic graph publication and the diagnostics floor amendment. Unchecked supported files, edge truncation, approximation overflow and the 1,000-character envelope remain unresolved (issues 2–3).                               |
| 4. Resolver inputs/declaration maps missing       | **PARTIAL** | `Plan:189–218`, batches 32a/b `:429–430` introduce normalized fields and post-processors. Per-import lexical module context remains unspecified, and the actual language resolution table was replaced with a reference to a first draft no longer present in the deliverable (issue 6).            |
| 5. LSP forwarding/narrowing incomplete            | **PARTIAL** | `Plan:306–329`, 26a/b `:417–418` explicitly repairs interfaces, forwarding, no-host behavior, C# queries and scan extensions. The new scope gate still accepts edge-truncated or unsupported-importer graphs (issue 3).                                                                             |
| 6. TSX enrichment service omitted                 | **FIXED**   | `Plan:181–187`, `:425–426` names the service gate, capability and enrichment cases. New sequencing/typecheck failure is tracked separately in issue 4.                                                                                                                                              |
| 7. Unbounded discovery/expansion/manifests        | **PARTIAL** | `Plan:219–231` adds concrete limits and yields. Vendor filtering before the census limit is not wired through the stated discovery call; edge caps have no defined response accounting (issues 2–3).                                                                                                |
| 8. Automatic PATH checker safety                  | **PARTIAL** | `Plan:283–302`, `:388–390`, Q2 `:504–509` now states trust, allowlisted environment, canonical executable checks and opt-in. This is a substantial correction. External interpreter location is insufficient to prevent project startup hooks; opt-in storage/enforcement is unspecified (issue 8). |
| 9. Registry-driven harness can waive requirements | **PARTIAL** | `Plan:345–366`, 27 `:420`, 38 `:438`: independent matrix, unconditional PHP/Ruby/C grammar fixtures, and harness-before-activation dependencies are present. Gate 38 omits authorized optional work/dependencies and does not pin the matrix's required key set (issue 7).                          |
| 10. Manifest staging/runtime/VSIX verification    | **FIXED**   | `Plan:175–177`, `:421–424`, `:488` distinguishes runtime/grammar rows and active flags, verifies actual archives, and adds negative checks. Q1-specific native C activation still needs an explicit batch owner (issue 7).                                                                          |
| 11. Footprints, shared ownership and FB specs     | **PARTIAL** | `Plan:404–456` improves decomposition and names many guards. Matrix ownership now creates G1/G2 conflicts, counts are still understated, and the TSX split is not independently green (issues 4–5).                                                                                                 |
| 12. Inventory/platform qualifications             | **FIXED**   | `Plan:94–109`, `:146–148`, `:216–218` distinguishes both indexes, indexed/fallback/no-host paths, provider-defined diagnostics, AST suboperations and case ambiguity. The `symbols` flag nevertheless recombines distinct capabilities in implementation guidance (issue 1).                        |

No r1 finding was rejected. Four are fixed at design level; eight are partially fixed. None is wholly unaddressed.

## Numbered findings

### 1. Serious — One `symbols` flag cannot represent code indexing and export-query support

**Plan sections:** Inventory `Plan:100–101`; registry `:160–164`; code tools `:238`; batch 24a `:413`.

**Verified evidence:** The revised plan correctly says SQLite already indexes Python/Go/C#. It then derives indexer extensions from `symbols`, while saying Python `queryExports` must error because it lacks `symbols`. Current code confirms these are different operations: `WI/services/code-symbol-indexer.service.ts:437` builds chunks from functions and `:451` from classes; Python/Go/C# have empty export queries at `WI/ast/tree-sitter.config.ts:380–397`. `WI/ast/tree-sitter-parser.service.ts:534–542` returns an empty export query result, and `MCP/namespace-builders/ast-namespace.builder.ts:170–183` exposes it.

**Impact:** Keeping `symbols=true` preserves existing indexing but defeats the proposed Python export-query guard. Setting it false regresses existing code indexing. The same ambiguity affects matrix activation and graph-export-index descriptions.

**Fix:** Distinguish code-symbol indexing from exported/public-declaration extraction, using separate capability keys or an equally explicit per-operation contract. Initialize the existing five-language code-index support as active and Python/Go/C# export extraction as pending until implemented. Pin a regression that Python remains searchable while its unavailable export-query operation reports honestly. Map graph-export-index capability independently of import-edge support.

### 2. Serious — Coverage still cannot describe all promised partial results or prove its size bound

**Plan sections:** `Plan:116–151`, `:221–228`, `:264–276`.

**Verified evidence in plan:** All buckets count files. There is no state for a supported non-TS file deliberately not checked by an unscoped diagnostics call (`:268`), or for per-import/aggregate edge truncation (`:227–228`). Unsupported is specifically a language lacking capability, so it cannot honestly classify Python when scoped syntax checking is supported but not invoked. The clean-result rule at `:274–276` tests unsupported/failed/omitted only, not unknown/truncated census or deliberately unchecked supported files. A six-entry approximation union cap (`:151`) can drop syntax-only or resolver-context qualifications without an overflow signal.

The plan promises a measured worst case but supplies neither the final closed vocabulary nor numeric bounds/overflow rules. A serialization probe using the stated envelope (20 twelve-character ids, top eight + other, all five failure reasons, six 32-character approximations, five-digit counts, all optional fields) is **1,028 characters**. This is not a measurement of a final concrete enum—it demonstrates that the textual maxima do not prove the asserted limit. Multi-root count growth is also unspecified.

**Fix:** Define supported-but-unchecked accounting and graph resolution/edge completeness independently from file counts. Treat unknown/truncated coverage as a qualified result, never a bare clean answer. Preserve essential qualifiers when approximation lists overflow. Supply the actual closed vocabulary, count bounds or saturation semantics, and a worst-case serialized example meeting 1,000 characters; otherwise revise the limit explicitly. Include mixed scoped/unscoped syntax support, unknown coverage, >6 approximations, aggregate roots and edge-cap cases in the budget tests. Keep coverage before unbounded fields as already planned; that placement is correct.

### 3. Serious — Reference narrowing and vendor discovery still violate their new guarantees

**Plan sections:** bounds `Plan:223–228`; narrowing `:319–322`.

**Evidence:** The reference gate checks failed files, omitted files and census completeness. It does not reject unsupported source files or truncated import/edge expansion. A 250,000-edge limit can leave every file parsed, no files omitted, and a complete census while reverse dependencies are incomplete. A TS declaration imported by a graph-unsupported language similarly passes a gate based only on the declaration language. The flag is a language-level claim, not proof of a particular graph's completeness.

The planned `findFiles(glob, 50_001)` delegates to `IFileSystemProvider.findFiles` with only existing default exclusions (`MCP/namespace-builders/core-namespace.builders.ts:149–159`). Filtering new vendor trees after that bounded return cannot meet “before any cap”: 50,001 `.venv` paths may prevent ordinary source files from being discovered. Existing default excludes lack those added trees, as already established in r1.

**Fix:** Require query-scope evidence covering resolution/edge truncation and potential unsupported importers before narrowing; otherwise use the honest bounded text scan. Define conservative handling for unresolved imports and partial resolver context. Push vendor exclusions into the bounded discovery operation or explicitly describe a separate bounded census and eligible-file walk, without pretending excluded totals are exact when not observed. Test a complete-file census with truncated edges, a supported declaration referenced by an unsupported importer, and a vendor tree larger than the census limit preceding normal code.

### 4. Blocking — Batch 29b cannot be green before 29c

**Plan sections:** batch table `Plan:425–426`; common checks `:397–398`.

**Verified evidence:** 29b adds `tsx` to `SupportedLanguage`; 29c later adds the outliner entry. `MCP/mcp-core/code-outliner.adapter.ts:74` is an exhaustive `Record<SupportedLanguage, OutlineQueries>`. Between these commits the outliner record lacks `tsx`, so the required downstream typecheck cannot pass. 29b also says TSX matrix rows become active before 29c makes outline and inferred enrichment paths work, conflicting with the real capability tests.

**Fix:** Make the shared union, required exhaustive-record entry and relevant capability activation one independently verifiable integration unit, or redesign the intermediate type boundary explicitly without weakening final coverage. Activate only rows actually implemented at that commit. Include the matrix file in 29b's footprint, and require a green downstream host typecheck plus real TSX MCP tests at every merge boundary. Do not solve this by skipping the common checks.

### 5. Moderate — Parallel matrix edits are a shared-file conflict; file counts remain inaccurate

**Plan sections:** `Plan:425–435`, lanes `:451–456`.

**Evidence:** G1's 30/31 and G2's 33 can run concurrently and all edit `required-capabilities.matrix.ts`. Moving ownership from T to each activation batch does not make them file-disjoint. The declaration-module handoffs fix Java/Rust source ownership, but not this matrix collision.

Counts also remain understated: 30 lists nine files without Kotlin (union, two language modules, index, integration spec, outliner + spec, manifest, matrix), ten with Kotlin—not 7–8. Batch 33 lists seven files if each resolver has its own spec, six only with one explicitly shared spec. 29b's seven-file count omits its required matrix edit. Optional native C/Kotlin assets and tests are not enumerated.

**Fix:** Give matrix integration one owner in quiet merge windows, or use file-disjoint per-language matrix fragments assembled by a fixed, independently verified required-key manifest. Specify exact spec filenames and recount every batch including activation/asset edits; justify remaining cohesive exceptions. Keep dispatcher, formatter, namespace and description edits serialized through H as the revision already does. Reconcile FB parent labels with actual dependency/merge parents so a “fails-before” result is reproducible.

### 6. Serious — The revised plan refers to deleted design content and does not define lexical import context

**Plan sections:** grammars `Plan:179`; extraction `:191–201`; resolution `:211`.

**Evidence:** The plan was replaced in place, but now says node names follow “the first draft” and resolution follows “the first-draft table.” Neither table exists in this revised document, and no immutable artifact/revision is referenced. The revised batch acceptance gives names of languages, not the missing Python roots, Go module/workspace/replace, Rust crate/module or optional resolver rules and limitations.

The new `CodeInsights.declarations.modulePath?: string[]` is per file, while one Rust file may contain multiple inline modules with separate `self::`/`super::` imports. `ImportInfo` as specified has no per-import lexical module path or location that lets the resolver distinguish those contexts. Optional `extractDeclarations` is named, but its query/match source is not specified; existing analysis only queries functions, classes, imports and exports (`WI/ast/ast-analysis.service.ts:118–131`).

**Fix:** Restore the corrected resolution/query tables in place, or cite a stable retained source artifact. Specify how declaration queries are invoked and how imports retain lexical scope needed for inline modules and scoped namespace resolution. Open and name the affected extraction contracts and owner files; `CodeInsights` also needs its parse-status fields in 24a, whose file list currently omits `ast-analysis.interfaces.ts`. Add a single file containing two inline modules with different relative imports as a required resolver test. This is a technical design correction, not a new user decision.

### 7. Serious — Gate 38 is not a complete gate for the choices presented to the user

**Plan sections:** harness `Plan:353–366`; batch 38 `:438`; Q1–Q4 `:497–516`.

**Evidence:** Gate 38 depends on 30–35 and optional 36, but not 28b (VSIX verification), selected 37a/b (checker support/opt-in), or completion of 21.1/21.2 integration. The matrix is said to incorporate Q2, yet 37a/b never names activation of its rows. If checker rows exist, the gate can fail permanently; if they do not, it can pass while approved checker work is absent. The matrix's required key set is described but not enumerated or independently pinned; “no pending rows” alone also passes if a required row is deleted.

Q1 offers a native C grammar, but 31 still specifies only cpp; Q3 offers consented build-running checkers while `Plan:390` says they are not built and no batch implements that choice. Q2 offers automatic execution while the implementation only specifies opt-in. These are not equally implemented alternatives in this plan.

**Fix:** Enumerate the fixed required tool/language/capability keys and validate exact membership independently of mutable activation states. Make gate 38 depend on all mandatory verification/integration and all selected option batches; explicitly assign their row activation. Spell out native C implementation/assets/tests if selected. Mark unsupported Q2/Q3 alternatives as requiring a design amendment and renewed review rather than implying existing batches cover them. Kotlin omission must continue to require explicit scope reduction, as the revision correctly states.

### 8. Serious — Q2 risk is disclosed, but the proposed mitigation and opt-in implementation are incomplete

**Plan sections:** `Plan:283–302`, `:388–390`, `:436–437`, `:504–509`.

**Assessment:** Opt-in authorizes an action; it is not isolation. An environment allowlist and an interpreter binary outside the repository do not by themselves prevent project code from executing during interpreter startup. The revised wording does surface a pyright caveat, which is an improvement, but confines the example to a project venv and suggests external `--pythonpath` may suffice.

**New primary evidence:** Upstream Pyright's `findPythonSearchPaths` passes the project root to the host and falls back to an interpreter. `FullAccessHost._getSearchPathResultFromInterpreter` invokes `_executeCodeInInterpreter` with an empty interpreter-argument list; that method adds `-c` and executes with the supplied working directory. Version detection separately uses `-I`, so it must not be confused with search-path discovery. These are current upstream-source observations, not verification of an installed/pinned checker here. [Pyright path discovery](https://raw.githubusercontent.com/microsoft/pyright/main/packages/pyright-internal/src/analyzer/pythonPathUtils.ts), [Pyright execution host](https://raw.githubusercontent.com/microsoft/pyright/main/packages/pyright-internal/src/common/fullAccessHost.ts).

Python performs site initialization before the `-c` body, including executable `.pth` lines and `sitecustomize`/`usercustomize` imports. Removing cwd from `sys.path` inside that body is too late to establish startup isolation. [Python site initialization](https://docs.python.org/3/library/site.html).

**Fix:** Resolve the stated pre-Q2 assumption against supported checker/interpreter versions before offering a no-project-execution guarantee. Require a demonstrated nonexecuting mode or tested startup isolation; otherwise explicitly say project startup code may run and obtain authorization for that consequence, or leave pyright unavailable. Keep it disabled until this gate passes. Add a hostile startup-hook test that verifies no marker is executed using the actual supported invocation, not just a fake-spawner argument assertion. No such execution was performed in this review.

For opt-in, name the existing setting/consent mechanism or design its host-owned storage, workspace identity, enable/revoke path and default-denied behavior. Neither 37b's four files nor another batch currently owns that surface. Repository-controlled configuration must not count as user consent. The automatic Q2 option must have a separately stated execution policy; it cannot inherit “opt-in” by implication.

### 9. Moderate — Last completed index-run coverage is not atomic with live search results

**Plan sections:** `Plan:152–156`, `:243–250`.

**Verified evidence:** Background indexing is started without awaiting it (`MCP/namespace-builders/code-namespace.builder.ts:211–220`), and search immediately reads the live index (`:289–317`). The writer updates files one at a time (`WI/services/code-symbol-indexer.service.ts:241–249`), deleting each file's old symbols at `:416`; cancellation can occur after prior writes at `:261–267`. There is no whole-run snapshot or stored generation on the freshness port (`libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts:20–37`).

**Impact:** Keeping coverage only after a full run finishes associates a previous run's complete coverage with a mixture of old/new rows while the next run runs or after it aborts. In-memory generation labels alone do not change those row semantics. Per-file reindex overlapping a full run likewise needs a defined accounting policy.

**Fix:** Prefer the small honest solution: invalidate/downgrade completed-run coverage before writes begin, expose in-progress/unknown coverage during partial mutation, and retain an incomplete state after cancellation/failure until a successful recomputation. Define serialized or version-aware handling for per-file writes. Only introduce transactional snapshot publication if required and explicitly designed. Test searches between file updates and after an aborted run. Do not claim atomic index coverage unless the actual storage/read boundary provides it.

## Approval and remaining user questions

**Not ready for user approval.** The original blocking diagnostics forwarding gap is repaired in the design, but issue 4 introduces an independently unbuildable batch boundary and issues 1–3 leave honesty semantics contradictory. Fix the technical issues before asking the user to approve this as an executable plan.

No additional product question beyond Q1–Q4 is needed. The existing questions need these qualifications:

1. **Q1:** Preserve explicit Kotlin scope-reduction language; include a concrete native-C branch before presenting it as ready to implement.
2. **Q2:** State that opt-in and external interpreter location alone do not prevent startup execution. Finish the safety check or make the residual project-code execution risk explicit, and specify how users actually opt in/revoke. Automatic execution is a different policy requiring a corresponding design branch.
3. **Q3:** “No build-running checkers” is the only implemented branch. Selecting consented build execution requires an amended design and review.
4. **Q4:** Include or omit the optional graphs explicitly; gate 38 must reflect the selected set and cannot call an approved row “droppable” without a scope change.

## Verification limits

The coverage-envelope probe was in-memory and created no files. It tests the written maxima, not a final implementation or final enum. Pyright is not installed in this dependency tree; its current official source explains why the proposed guarantee needs verification but does not establish behavior for every PATH version. No production code, source regression, actual checker invocation, package archive, or batch build was changed or run. The remaining issues are grounded in the revised plan and the opened source boundaries above.
