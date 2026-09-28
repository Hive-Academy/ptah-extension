# Batch 33 code-logic review — TASK_2026_559_8ca9, Lane G2

**Verdict: REVISE. Score: 4/10. Assessment: NEEDS_REVISION.**

| Finding severity | Count |
| --- | ---: |
| Blocking | 4 |
| Serious | 4 |
| Moderate | 2 |
| Minor | 0 |
| Numbered findings | 10 |

Scope: uncommitted Batch 33 against HEAD `fb94c68f0`, plus verification of the Batch 32b fix round. Reviewed resolver/context/manifest implementations, extraction and coverage changes, new resolver specs and activation checks, consumer-pin changes, executor reports, Batch 33/common checks, language-plan resolution/bounds requirements and the previous review. User Decision 27 controls scope: TS/JS, Python, Go and later C# graphs; other languages remain unsupported. Old Java/Rust/later-batch prose does not grant those capabilities.

The ordinary fixtures and scoped test target pass. Independent probes nevertheless reproduce wrong or incomplete dependency/symbol results that remain clean. The basic resolver architecture and bounds controls are substantial and useful, but the unqualified-success paths below prevent approval. No source, tests, batches/task state or git state was changed. Only this report and the task-folder `code-logic-review.md` were written; scripts and fixture directories are under OS temp.

## Findings

All source anchors are relative to `libs/backend/workspace-intelligence/src/ast/`, unless another path is stated. All ten findings require fixes in the rolled-forward fix round; no source changes were made by this review.

### R33-01 — Blocking — Python root search loses namespace portions and violates regular-package shadowing

**Anchors:** `import-resolution/python-import-resolver.ts:118`, `:120`, `:219`.

**Scenario A:** `main.py` contains `from ns import a, b`; the workspace has `ns/a.py` and `src/ns/b.py`, with no `ns/__init__.py`. Both root and src are configured source roots.

**Observed:** The real graph links only `ns/a.py`, not `src/ns/b.py`, and reports `clean: true`, zero unresolved imports and complete context. lookupFrom returns success when any target exists, then the outer loop stops at that first root. Missing requested members are not retained for subsequent namespace portions or disclosed.

**Scenario B:** Root `pkg/__init__.py` exists, but `pkg/sub.py` does not; `src/pkg/sub.py` exists. `import pkg.sub` falls through to src and creates an edge there, again clean. The earlier regular package actually shadows that namespace portion.

An isolated Python 3.14 interpreter over the same temporary fixtures finds both namespace members in A and raises ModuleNotFoundError for B. Namespace portions can span search-path locations; regular packages have different search semantics. [Python import-system reference](https://docs.python.org/3/reference/import.html#namespace-packages).

**Impact:** Missing consumers and phantom dependencies despite a completeness claim.

**Disposition: fix-now.** Model regular-package ownership separately from namespace portions; gather each requested submodule across eligible portions. Preserve/disclose unmatched or ambiguous members even when other members resolve. Add both fixtures, including full target-array and coverage assertions.

### R33-02 — Blocking — Python local dependency declarations are certified external

**Anchors:** `import-resolution/python-manifest.ts:133`, `:135`, `:143`; `import-resolution/python-import-resolver.ts:124`.

**Scenario:** Root pyproject contains `[tool.poetry.dependencies]` and `lib = {path = "packages/lib", develop = true}`. The workspace contains `packages/lib/lib/__init__.py`; `main.py` imports `lib`.

**Observed:** The parser keeps only the dependency name and ignores its path specification. Resolution is `{kind:'external', targets:[]}` with no contextDependent flag. The real graph has no edge and reports clean/complete. A PEP 508 local direct reference would likewise have its location discarded by addRequirement.

**Impact:** The newly introduced Python external-proof rule repeats the local-package failure fixed for TS/JS in R32B-02. Declaring the local dependency makes the answer look more certain while concealing its workspace location.

**Disposition: fix-now.** Retain local/path/direct-reference information. Resolve supported layouts or return unresolved/partial; never use such names as proof of externality. Test Poetry path dependencies and project dependencies with local file references. Distribution-name matching alone is not proof of import location.

### R33-03 — Moderate — Python's top-level gate prevents the promised case rule

**Anchors:** `import-resolution/python-import-resolver.ts:118`, `:175`.

**Scenario:** Graphed `Widget.py` and `main.py` containing `import widget`.

**Observed:** The unique case-folded match is never attempted because hasTopLevel checks exact knownFiles/directories only. Resolution returns external/contextDependent, the graph has no edge, and coverage becomes partial. The case-folding logic inside lookupModule is unreachable for this absolute import.

**Impact:** The declared exact/unique-fold/ambiguous rule is not consistently implemented. Coverage is conservative here, so this is not a false-clean finding.

**Disposition: fix-now.** Make root eligibility use the same case-aware lookup policy without letting a folded candidate outrank an exact candidate from another eligible root. Add absolute top-level, namespace and ambiguous-case fixtures; current nested/relative case coverage is insufficient.

### R33-04 — Blocking — Go replacement facts do not preserve effective selection rules

**Anchors:** `import-resolution/go-manifest.ts:52`, `:100`; `import-resolution/resolver-context.ts:275`, `:378`, `:419`; `import-resolution/go-import-resolver.ts:126`.

Three independently reproduced cases expose information lost by the same flattened local/external representation:

1. Root go.mod requires `example.com/lib v1.0.0` and replaces it with `./old`. go.work uses `.` and replaces that module with `./new`. Both package directories exist. The graph links `old/x.go`; the workspace override should select `new/x.go`. Equal-length entries are kept in insertion order and find selects the first.
2. Root go.mod requires v1.0.0 but only replaces `example.com/lib v2.0.0+incompatible => ./local`. The graph nevertheless links local/x.go: the replaced version is discarded.
3. A replacement names an absolute directory inside the current root. The context classifies it external, with no gaps, because relativeInsideRoot rejects every absolute spelling rather than checking whether its resolved location is inside root.

The first two real graphs are clean, with only `go:package-edges`; the third pure resolver result is external/complete. That approximation describes package fanout, not selecting the wrong module. Go workspace replacements override corresponding module replacements, and a version-qualified replacement applies only to that version. Absolute local file paths are supported. [Go module reference](https://go.dev/ref/mod#go-work-file-replace), [version-qualified replacement semantics](https://go.dev/ref/mod#go-mod-file-replace).

**Impact:** A valid workspace configuration can redirect edges to stale code or conceal an internal dependency entirely.

**Disposition: fix-now.** Preserve replacement version and manifest provenance, apply workspace precedence, and normalize absolute/relative locations before containment classification. Where selected-version information is insufficient, qualify context rather than guessing. Cover conflicting member replacements and absolute go.work use locations too; currently absolute use locations are conservatively rejected even when inside root.

### R33-05 — Serious — Go public-symbol activation silently excludes valid Unicode exports

**Anchors:** `languages/go.language.ts:53`, `:58`, `:62`, `:67`.

**Scenario:** A package declares `func Éclair() {}`, `func ASCII() {}`, and `var Äpfel = 1`.

**Observed:** Real WASM analysis/graph indexing includes only ASCII. Coverage remains clean; no unextracted-export marker or symbol approximation is emitted. The implementation comment admits the restriction, but tool callers do not receive it.

Go exports package-level identifiers beginning with a Unicode uppercase letter, not just ASCII A–Z. [Go exported-identifier specification](https://go.dev/ref/spec#Exported_identifiers).

**Impact:** ptah_get_symbol_index can falsely report that valid public symbols do not exist. referenceScopeComplete:false is a reference-narrowing guard, not disclosure of missing public symbols.

**Disposition: fix-now.** Capture candidates then apply a Unicode-aware visibility test in decoding, or mark affected files incomplete. The tree-sitter predicate's missing Unicode flag does not require discarding identifiers. Add Unicode function/type/constant/variable controls.

### R33-06 — Serious — Python public-symbol omissions are documented only in source

**Anchors:** `languages/python.language.ts:51`, `:55`, `:58`, `:173`; `dependency-graph.service.ts:1074`.

**Scenario:** `pkg/__init__.py` contains `from .a import X`, `__all__ = ["X", "_visible"]`, and `def _visible(): pass`; pkg/a.py defines X.

**Observed:** The real graph records the dependency to pkg/a.py but omits pkg/__init__.py from the export index entirely, while reporting clean. Neither explicitly exported name appears there. Public module bindings inside if/try and imported bindings are also deliberately excluded by the direct-child query, without unextractedExports or any coverage qualification.

**Impact:** Activating publicSymbols makes the symbol-index tool claim support for this file while its valid public surface reads empty. The underscore convention is useful for a heuristic, but an implementation comment is not user-visible disclosure. This finding does not require executing Python or solving every dynamic __all__ expression.

**Disposition: fix-now.** Support straightforward static bindings/__all__, or conservatively flag affected files and retain them in the index as incomplete. Add a real package re-export/__all__ fixture and conditional-definition disclosure. Keep the code-index/public-symbol distinction intact.

### R33-07 — Serious — Manifest read failures still erase consumed-byte accounting (R32B-04)

**Anchors:** `import-resolution/manifest-reader.ts:104`, `:146`, `:166`.

**Scenario:** Twelve 250 KiB manifests each return a successful 250 KiB first read, then throw EIO on the next read.

**Observed:** The adapted bounded-reader probe consumed **3,072,000 bytes**, opened all twelve files, and returned only manifest-unreadable. The outer catch rewrites each failed operation to bytesRead:0. A close failure in finally can similarly replace an already computed result and lose its byte count.

The original NUL and growing-file cases now pass; rejection accounting is fixed only when the handle operation itself succeeds.

**Impact:** Physical I/O can again exceed the 2 MiB aggregate bound. This also affects pyproject and the second round of go.work member reads because all use this reader.

**Disposition: fix-now.** Preserve cumulative consumed bytes through read and close error paths. Charge them before deciding the gap and before starting another manifest. Regress partial successful reads followed by read failure and close failure, in addition to decode rejection.

### R33-08 — Serious — Tsconfig inheritance evaluation expands a small DAG exponentially

**Anchors:** `import-resolution/tsconfig-mapping.ts:71`, `:82`, `:93`.

**Scenario:** Each root tsconfig extends the preceding config twice using a valid extends array. All files fit easily within 64 manifests and the byte limits.

**Observed:** A pure mapper probe counted compilerOptions visits using property access instrumentation: 10 configs produced 2,036 evaluations; 15 produced 65,519. Each recursive branch recalculates its parents, and every config is also evaluated from scratch. There is cycle detection but no memoization. The 15-config run took 28 ms on this host; a full 64-config stress run was deliberately not attempted.

**Impact:** Bounded manifest I/O does not bound synchronous config processing. Larger repeated/shared-parent graphs can block the host event loop, preventing generation cancellation and scheduled yields from running.

**Disposition: fix-now.** Memoize effective options by config after cycle-safe evaluation, or evaluate the inheritance graph topologically with explicit work bounds. Add a shared-parent/repeated-parent regression asserting bounded evaluations. This is introduced by the rolled-forward 32b inheritance implementation, not by the Python/Go resolver bodies.

### R33-09 — Moderate — Go interpreted import paths are passed to resolution as raw escapes

**Anchors:** `languages/go.language.ts:96`; `import-resolution/go-import-resolver.ts:116`.

**Scenario:** Module `example.com/app`, local widget/x.go, and `import "example.com/\x61pp/widget"` in main.go (a literal Go escape for `a`).

**Observed:** The real grammar parses the source, but extraction strips only the quotes. The graph records no widget edge; resolution returns unproven external and coverage is partial. Raw/backtick strings need different treatment from interpreted strings.

**Impact:** A valid static import is unsupported even though all necessary source and module context are available. This was a pre-existing extraction spelling limitation; activating Go graph resolution makes its effect observable now. It is qualified, not clean.

**Disposition: fix-now.** Decode interpreted Go string escapes at the extraction/resolver boundary without altering raw-string semantics. Cover grouped, blank/dot/aliased imports with escaped paths. Retain original spelling separately if needed.

### R33-10 — Blocking — Independent tsconfig conflicts are detected only for identical pattern keys (R32B-01)

**Anchors:** `import-resolution/tsconfig-mapping.ts:108`, `:116`; `import-resolution/ts-js-import-resolver.ts:46`.

**Scenario:** Independent tsconfig.a.json declares `paths: {"@*": ["old/*"]}`; tsconfig.b.json declares `paths: {"@x": ["new.ts"]}`. Both old/x.ts and new.ts exist. The importing file's governing config is not modeled.

**Observed:** The mapper returns both rules with gaps:[], and the actual resolver picks new.ts for @x. Under config A it should resolve old/x.ts. Unlike the fixed identical-key conflict, overlapping patterns are treated as unrelated because conflict detection is keyed by the literal pattern string. No contextDependent flag is emitted.

**Impact:** The fix still guesses a target while certifying complete context for conflicting independent configs. The earlier simple extends/override scenario is corrected, but the stated conservative fallback is incomplete.

**Disposition: fix-now.** Keep independent config provenance through resolution and compare effective results for each specifier, or conservatively qualify potentially overlapping mappings. Do not combine cross-project specificity into one synthetic config. Test wildcard/exact and overlapping-wildcard conflicts, as well as the existing identical-key case.

## Rolled-forward Batch 32b findings

| Previous finding | Status | Independent evidence |
| --- | --- | --- |
| R32B-01 — effective config mapping | **STILL OPEN** | Original base/child override now selects new.ts in a real graph. Identical-key independent conflict drops paths and emits conflicting-configs. Different overlapping patterns still select an arbitrary complete-context target: R33-10. The new evaluator also has R33-08's work amplification. |
| R32B-02 — local package declarations | **CLOSED for TS/JS** | Real file: package fixture links packages/local/index.ts. link: to an absent directory and workspace:* both count unresolved-internal; external count is zero. Python's analogous new defect is separately R33-02. |
| R32B-03 — manifest check/open race | **CLOSED for the reported race** | Repeated real Windows junction swap after pre-open stat now returns manifest-changed and admits no outside path rules. Dev/ino and repeated-realpath checks validate the retained handle. Stable outside-root member lookup is also rejected. |
| R32B-04 — physical read bounds | **STILL OPEN** | NUL probe stops after 8 reads/2,048,000 bytes with both not-text and over-total gaps; growing-file probe reads exactly 262,145 bytes (bound plus one sentinel), then rejects. Partial-read EIO still consumes 3,072,000 uncharged bytes: R33-07. |
| R32B-05 — escaped re-export strings | **CLOSED** | Real JavaScript fixture combines escaped empty, named, star and namespace clauses. They resolve to one leaf.js edge, zero unresolved imports and clean coverage. Both source channels agree. |
| R32B-06 — generation after awaits | **CLOSED** | Cancellation in stat opens zero handles and reads zero bytes. A second-round member-stat cancellation reads/opens only the preceding go.work and returns undefined. Reader checks guard lookup/open/handle-stat/re-realpath and chunk boundaries; required handle cleanup remains allowed. |

**R32A-04 is CLOSED:** real Python grammar probes return importedSymbols A/C alongside importedSymbolAliases B/D, and relative x-as-y preserves y. Source/imported names remain intact for resolution. The changed integration spec also covers conditional and try imports and mixed aliased/unaliased names.

## Other acceptance checks and limits

| Area | Result |
| --- | --- |
| Python relative imports | RelativeLevel minus one and under-root guard are implemented. Scoped tests exercise sibling, parent, star and missing imports. R33-01 concerns absolute-root composition, not that arithmetic. |
| Python source roots | Root, src, setuptools package-dir/find.where, Poetry from and Hatch package paths flow through the shared bounded reader. Ordinary cases pass. Unsupported layout/dependency interpretations must not become false proof of externality (R33-02). |
| Python module/submodule preference | Ordinary a/b.py, a/b/__init__.py and from-import submodule preference match the plan. Namespace composition and root shadowing fail R33-01. |
| Go package expansion | Package-directory lookup returns sorted non-_test.go files, limited to 200 with truncated and go:package-edges. The scoped resolver tests cover this limit; graph linking retains the 250,000-edge cap and cancellation checks. |
| Build constraints | They are **not excluded**: build tags and GOOS/GOARCH suffixes do not filter files. This matches the plan's explicit all-files approximation. referenceScopeComplete stays false. |
| vendor | Excluded upstream by GRAPH_VENDOR_EXCLUDES (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:363`). The pure resolver does not independently filter a caller-supplied vendor node; production discovery owns this boundary. |
| Go second-round bounds | 70 use members plus go.work open only 64 manifests and emit too-many-manifests. Twelve large valid member manifests stop at 2,048,006 total bytes including go.work, with manifests-over-total. Member-stat cancellation starts no member open. An outside-root member realpath is rejected after only the go.work read. Failure accounting still needs R33-07. |
| New external rule | Undeclared Python/Go misses are partial, which is the correct conservative direction. Evidence is still misclassified for Python local declarations and Go replacement semantics (R33-02/04). |
| Deferred languages | Real graph probe with Java, Rust, Kotlin, PHP, Ruby and C++ produces unsupported:6, analyzed:0, clean:false and per-language unsupported counts. None was activated by Batch 33. C# remains pending Batch 34. |
| Coverage approximation | Actual Go graph output contains go:package-edges; it survives the resolver-to-coverage seam. This does not excuse wrong package selection or missing symbols. |

### Description pins and next-batch handoff

The four +12 pins in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts:2095` onward correspond exactly to adding `, python, go` to registry-derived descriptions: dependents, dependencies, code-search-symbols and AST analyze. That adjustment is justified; it is not concealing additional fixed prose. The global description budget was not increased, and required-item assertions remain.

Independently evaluated the actual symbol-index builder function and constants: **996 characters now**, **1,004 with only C# added**. The strict less-than-1,000 assertion will therefore fail in the still-in-scope Batch 34 unless wording/structure changes (`tool-description.builder.ts:1982`; budget assertion in its spec). Carry this concrete handoff to Batch 34 or the description owner. It is not a present runtime failure, and no deferred Java/Rust/PHP/Ruby/C++ activation is needed to trigger it. Do not simply raise the global budget.

## Data flow and five logic questions

Imports and public declarations come from the actual grammars. The context reads root manifests and bounded go.work member manifests once per build, then resolvers use only the context and return file/package targets. Graph linking enforces edge limits and builds reverse links; its resolution counters and approximation set become coverage. Errors before publication do not publish a stale generation. The weak points are semantic facts discarded before resolution and unreported omissions after extraction.

1. **How can it fail silently?** Partial namespace success, local-dependency names, flattened replacements, overlapping aliases and incomplete symbol queries all have successful/clean paths above.
2. **What user action changes behavior unexpectedly?** Adding another namespace portion, declaring a local Poetry dependency, overriding a module in go.work, or naming a public Go declaration with an uppercase Unicode letter changes results incorrectly.
3. **What input produces a wrong answer?** Every numbered finding includes a concrete fixture or bounded probe. The compiler/interpreter semantic distinctions were checked independently where available.
4. **What happens when dependencies fail or work is cancelled?** Manifest failures qualify context and obsolete work is discarded, but consumed bytes are lost on exceptions (R33-07); synchronous inheritance amplification delays cancellation (R33-08).
5. **What remains missing from the contract?** Effective-config/replacement provenance and partial multi-target resolution need explicit representation or conservative qualification. Public-symbol support must distinguish a useful partial index from complete absence. A boolean capability and referenceScopeComplete:false do not disclose per-file symbol omissions.

## Verification evidence

- Ran the scoped command once: `node_modules/.bin/nx.cmd run-many -t=test -p @ptah-extension/workspace-intelligence --skip-nx-cache`, with a final 30-line tail. Its single completion check reported **Successfully ran target test** for workspace-intelligence, duration **2m 21s**. PowerShell's surrounding pipeline returned exit 1 after NativeCommandError formatting of stderr; Nx itself explicitly reported the single task successful. Detailed suite counts were suppressed by Nx, so no independently observed numeric test count is asserted. The executor reports 65 passing suites/1 skipped and 2,028 passing tests/10 skipped.
- Independent Node probes used the actual resolver/context/graph services and shipped WASM grammars, a temporary TypeScript loader, real Result, and inert logging/DI adapters. No synthetic AST matches were used to establish grammar findings. Fault-injected filesystem handles were used explicitly for resource/cancellation checks.
- Python 3.14 ran only isolated, reviewer-created temporary fixtures (`-I -S -B`) for namespace/shadowing controls. No project Python code was executed. No Go toolchain was available; replacement and Unicode semantics were checked against the official Go references linked above.
- Repeated the previous junction, NUL budget, growing file, cancellation, config override/local package and escaped re-export scenarios, adapting only the probe filesystem interface to the new handle API. Additional probes cover error accounting, second-round reads, config overlap and evaluation counts.
- Temporary evidence scripts: `ptah-33-review-probe.cjs`, `ptah-33-manifest-probe.cjs`, `ptah-33-round2-probe.cjs`, `ptah-33-extra-probe.cjs`, `ptah-33-overlap-probe.cjs`, `ptah-33-python-oracle.py`; primary logs are `ptah-33-review-probe.log`, `ptah-33-manifest-probe.log`, `ptah-33-review-nx.log`, all under OS temp.
- Lint/typecheck, validate-deps, degradation audit, downstream consumer suites and FB baseline failures remain executor-reported evidence, not independently rerun here. No workspace-wide verification, formatter, source modification or state-changing git operation was performed.

Acceptance: fix R33-01 through R33-10, retain the successful controls, and carry the measured description adjustment to Batch 34. Four 32b findings close; R32B-01 and R32B-04 remain open as specified above. The earlier Python alias contract finding now closes.
