# Batch 33 executor report: Python + Go import graphs

Executor: backend-developer (sub-agent), Lane G2 worktree `task-559-lane-g2`, base HEAD `fb94c68f0` (Batch 32b).
No git command changed state. `git show fb94c68f0:<path>` was the only git command used for the FB run, and it is read-only. The working tree is left dirty. `code-logic-review.md` is still untracked and was not touched. No other writer's changes were seen.

## Tasks

- 33.1 Python resolver: DONE
- 33.2 Go resolver and the `b33` fragment: DONE
- Carried R32A-04 (Python per-member aliases): FIXED

## Changed paths

Paths are relative to the worktree. `WI/` is `libs/backend/workspace-intelligence/src/`, and `LM/` is `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

### In the batch list (7)

1. `WI/ast/import-resolution/python-import-resolver.ts` (new). This is `PYTHON_IMPORT_RESOLVER`, with file edges.
   - **Relative imports:** the resolver goes up `relativeLevel` - 1 directories from the importing file's directory. An import that climbs out of the root, or that finds no file, is `unresolved-internal`. It is never `external`.
   - **Absolute imports:** a `pyproject.toml` package directory that owns the longest prefix is tried first; a missing file there is `unresolved-internal`. Then every source root is tried in order: the root, `src/` when a graphed file is under it, then the pyproject roots.
   - **Module files:** `a/b.py` is tried, then `a/b/__init__.py`. For `from a.b import c`, the submodule `a/b/c` is linked when `c` is one, and the module `a/b` is linked for every other name and for `*`.
   - **Shadowing:** a regular module or package in a root shadows the standard library, but a plain (namespace) directory does not.
   - **Imports found in no root:** if the first segment exists in some root, the import is `unresolved-internal`. A standard-library module, or a dependency the root pyproject declares, is proven `external`. Anything else is `external` with `contextDependent`, which makes the context `partial`.
   - **Case rule:** an exact match wins; a unique case-folded match is used and marked `caseFolded`; an ambiguous match is `unresolved-internal`.
2. `WI/ast/import-resolution/python-import-resolver.spec.ts` (new). 29 tests. Each test builds its context with the real `buildResolverContext` over a temporary directory, so pyproject reading goes through the bounded, handle-verified manifest reader.
3. `WI/ast/import-resolution/go-import-resolver.ts` (new). This is `GO_IMPORT_RESOLVER`, with package edges.
   - **Module match:** the longest module path that prefixes the import decides.
     - A local module (the root `go.mod`, a `go.work` `use` module, or a local `replace` into the root) maps the import to a directory. The import then links every graphed non-`_test.go` file of that directory, sorted, with at most 200 targets (`truncated` beyond that) and `approximation: 'go:package-edges'`.
     - A module proven outside the root is `external`. That covers `require`, a replacement by a module version, and a replacement by a directory outside the root.
   - **No module matches:** a standard-library first element (a fixed list, including `C`) is `external`. Anything else is `external` with `contextDependent`.
   - **Dotless paths:** a dotless first element is never taken as proof on its own, because a module may be named without a dot.
   - **Unresolved:** an empty package directory, or one holding only tests, is `unresolved-internal`. So is a GOPATH-style `./x` path that names no package.
   - **Case rule:** an exact directory wins; a unique case-folded directory is used and marked; an ambiguous one is `unresolved-internal`.
4. `WI/ast/import-resolution/go-import-resolver.spec.ts` (new). 17 tests on a real temporary directory. They cover `go.mod`, `require`, local and non-local `replace`, longest prefix, `go.work` `use` with nested `go.mod` files, unreadable and outside-root `use` modules, the 200-target bound, the case rule, and the `go.mod`/`go.work` lexer.
5. `WI/ast/languages/python.language.ts`:
   - registers `importResolver: PYTHON_IMPORT_RESOLVER`;
   - sets `graphEdges: { granularity: 'file', referenceScopeComplete: false }`;
   - adds `PYTHON_EXPORT_QUERY`, which turns `publicSymbols` on. It captures module-level `def`, `class` (decorated or not) and assignments, including tuple targets, and skips `_`-prefixed names;
   - adds the R32A-04 fix (below).
6. `WI/ast/languages/go.language.ts`:
   - registers `importResolver: GO_IMPORT_RESOLVER`;
   - sets `graphEdges: { granularity: 'package', referenceScopeComplete: false }`;
   - adds `GO_EXPORT_QUERY`, which captures upper-case package-level functions, types (`type_spec` and `type_alias`, grouped or not), constants and variables (including `var ( … )` lists). Methods are not captured.
7. `WIT/matrix/activations/b33.ts` (new). It activates `graphEdges:python`, `publicSymbols:python`, `graphEdges:go` and `publicSymbols:go`, with approximation `graphEdges:go → ['go:package-edges']`.

### Outside the batch list, and why

Production code needed for the seam, the manifests, the disclosure and R32A-04:

8. `WI/ast/import-resolution/python-manifest.ts` (new). It reads a `pyproject.toml` as text only, with a small TOML parser. What it reads:
   - `[tool.setuptools] package-dir` (the `""` entry → a source root, other entries → package directories);
   - `packages.find.where`;
   - Poetry `packages[].from`;
   - Hatch wheel `packages`;
   - dependencies from `[project] dependencies` and `optional-dependencies`, `[dependency-groups]`, and Poetry `dependencies`, `dev-dependencies` and group dependencies. Names are normalised (PEP 503, with `_` as the separator).

   Any TOML error, or any of those entries with the wrong shape, returns `undefined`, which becomes the `manifest-unparseable` gap. It is a separate file for the same reason `tsconfig-mapping.ts` is: `resolver-context.ts` would otherwise pass the 700-line lint limit.
9. `WI/ast/import-resolution/go-manifest.ts` (new). It lexes `go.mod` and `go.work` (`module`, `require`, `replace`, `use`, blocks, `//` comments, `"…"` and raw strings). A local replace is Go's rule: a `./`, `../` or absolute target with no version. A malformed line, or a `go.mod` without `module`, returns `undefined` (a gap).
10. `WI/ast/import-resolution/resolver-context.ts`. The plan says resolvers read only `ctx`, and the brief says to use the one bounded reader, so the context now reads more:
    - It lists `pyproject.toml`, `go.mod` and `go.work` at the root.
    - A second round reads the `go.mod` of each `go.work` `use` directory. It shares the same 64-file limit (now counted per attempt, across rounds) and the same 2 MiB byte budget.
    - A `use` or `replace` target outside the root is never read. A `use` outside the root adds the `manifest-outside-root` gap.
    - New fields:
      - `filesByDirectory` and `directories` (each node's directory and its ancestors up to the root);
      - `python: { sourceRoots, packageDirs, dependencies }`;
      - `go: { local (longest path first), external }`.

    The file is now 681 lines. Batch 35 adds Cargo here and will probably need to extract as 32b did.
11. `WI/ast/import-resolution/import-resolver.ts`: `ImportResolution.approximation?: GraphEdgeApproximation` (currently `'go:package-edges'`), so that a resolver can declare an edge approximation. Batch 34's `csharp:namespace-edges` and `java:package-wildcard` extend the `Extract<>`.
12. `WI/ast/dependency-graph.service.ts`: `linkNodes` collects the approximation of each resolution that links at least one target into `resolution.edgeApproximations`.
13. `WI/ast/graph-coverage.ts`: `GraphResolutionCounts.edgeApproximations?` flows into the coverage `approximations`, under the existing priority and overflow rule. Without items 11–13, `go:package-edges` would never be disclosed.
14. `WI/ast/ast-analysis.interfaces.ts`: `ImportInfo.importedSymbolAliases?: Array<string | null>` (R32A-04).
15. `WI/ast/languages/types.ts`: `ExtractedImport` picks `importedSymbolAliases`, and the `graphEdges` capability doc is updated.

Specs that pinned "Python and Go have no graph and no public symbols". Each is updated in the batch that changes the pin, as `language-registry.spec.ts` requires. Kotlin, which has no graph by Decision 19, now stands in as the graph-unsupported example, and C# as the example without public symbols:

16. `WI/testing/mcp-contract/language-honesty.contract.spec.ts`:
    - four new `HONESTY_CHECKS`: `pythonGraphHonesty`, `goGraphHonesty`, and `publicSymbolsHonesty` for Python and for Go;
    - `graphHonesty` uses a `.kt` file as the unsupported file;
    - imports `node:os` and `planPythonApp`.
17. `WI/ast/language-registry.spec.ts`:
    - the `publicSymbols` and `graphEdges` lists gain `python` and `go`;
    - "separate" now uses `csharp`, `java` and `rust`;
    - new test "draws Python edges per file and Go edges per package".
18. `WI/ast/graph-coverage.spec.ts`:
    - the `.py` and `.go` exemplars become `.kt`, or are now selected;
    - `supportedLanguages` gains `python` and `go`;
    - new test "discloses the edge approximations the resolvers declared".
19. `WI/ast/dependency-graph.service.spec.ts`: the `.py` exemplars become `.kt`, and `supportedLanguages` is updated.
20. `WI/ast/ast-analysis.service.spec.ts`:
    - R32A-04 real-grammar test;
    - Python and Go public-symbols real-grammar test;
    - the existing `Account as Acct` expectation now carries `importedSymbolAliases: [null, 'Acct']`;
    - the registration test no longer says Python and Go have an empty export query.
21. `WI/ast/import-resolution/ts-js-import-resolver.spec.ts`: the hand-built context has the new required fields.

Graph consumers (vscode-lm-tools and Electron). Their specs hard-code the TS/JS/TSX-only lists:

22. `LM/namespace-builders/analysis-namespace.builders.spec.ts`: `supportedLanguages` gains `python` and `go`; `tool.py` and `main.go` are graph-capable; the unsupported example is `App.kt`.
23. `LM/mcp-core/protocol-dispatcher.spec.ts`: `src/tool.py` becomes `src/App.kt` (discovery e2e: `unsupportedByLanguage { kotlin: 1, r: 1 }`, and the unsupported-language answers); `supportedLanguages` gains `python` and `go`.
24. `LM/namespace-builders/ast-namespace.builder.spec.ts`: the "24a rejects … exports" test uses C# (`.cs` was added to the mocked extension map).
25. `LM/namespace-builders/code-namespace.builder.spec.ts`: "C# stays searchable while C# queryExports errors" replaces the Python case.
26. `LM/mcp-core/mcp-contract.sweep.spec.ts` and `LM/mcp-core/tool-description.builder.spec.ts`: description pins were raised. The only reason is that the registry language lists grew by `, python, go` (12 characters, once per description). No other wording changed:

    | Tool | Old pin | New pin | List that grew |
    | --- | --- | --- | --- |
    | `ptah_ast_analyze` | 503 | 515 | publicSymbols |
    | `ptah_get_dependents` | 722 | 734 | graphEdges |
    | `ptah_get_dependencies` | 689 | 701 | graphEdges |
    | `ptah_code_search_symbols` | 702 | 714 | publicSymbols, both pins |

    Each change carries a comment.
27. `LM/mcp-core/tool-description.builder.ts`: `ptah_get_symbol_index` reached exactly the global 1,000-character description budget (the spec requires < 1000). Four characters of fixed wording were removed ("(a JSON file of all its symbols)" became "(a JSON file of its symbols)"), so the budget was not raised. Batches 34–36 will add about 35 more characters to this list: see Observations.
28. `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`: the real-graph narrowing tests grant the mocked `referenceScopeComplete` claim to `python` and `go` as well. The narrowing gate checks every language the graph supports, so the control would otherwise never narrow and the negative tests would pass vacuously. `withTsScopeCompleteClaim` is unchanged, so the constructed-coverage case "a graphed language whose edges do not bound references" (`go`) keeps its meaning.

Task documents: the `batches.md` Batch 33 heading (only that line) and this report.

## R32A-04: Python per-member aliases

- **Contract:** `ImportInfo.importedSymbolAliases`, index for index with `importedSymbols`. Each entry is the `as` name, or `null` when the member keeps its own name. The field is present only when at least one member is renamed, so the output of every import without a rename is byte-identical. `importedSymbols` keeps the original names, which is what resolution uses.
- **Extraction:** `python.language.ts` `aliasOf()` reads each `aliased_import`'s `alias` identifier.
- **Test (real grammar):** `ast-analysis.service.spec.ts` › "Python: every renamed member keeps its local name (R32A-04)". It covers:
  - `from ..p import A as B, C as D` → `['A','C']` / `['B','D']`;
  - `from . import x as y` → `['y']`;
  - inside `if TYPE_CHECKING:`, `User as U, Account` → `['U', null]`;
  - in `try`/`except`, the parenthesised `(dumps as to_json)` and plain `dumps as to_json`;
  - `from typing import TYPE_CHECKING` has no aliases field.

  The existing multi-name test now pins `[null, 'Acct']`.

## FB evidence (fails on base 32b behaviour)

Method: the base language modules were put in place with `git show fb94c68f0:<L>/python.language.ts > <L>/python.language.ts` (and the same for `go.language.ts`). The new keys and tests were run, and the working copies were then restored from a backup. `git diff --stat` on `languages/` afterwards showed only this batch's changes.

Command: `npx jest -c libs/backend/workspace-intelligence/jest.config.ts …/language-honesty.contract.spec.ts …/ast-analysis.service.spec.ts --maxWorkers=2` → **`Tests: 9 failed, 72 passed, 81 total`**:

- `every activated capability:language key is actually granted by the registry`: received `["graphEdges:python","publicSymbols:python","graphEdges:go","publicSymbols:go"]`.
- `graphEdges:python`: "python edge app/service.py -> app/models.py was not found".
- `graphEdges:go`: "go package edge did not link every non-test file: []".
- `publicSymbols:python` and `publicSymbols:go`: public symbols missing (`publicSymbolsHonesty`).
- `Python: every renamed member keeps its local name (R32A-04)`: `importedSymbolAliases` was `undefined` for every statement.
- `Python: multi-name, aliased, …`: missing `[null, 'Acct']`.
- `Python and Go public symbols (Batch 33 publicSymbols)`: `Received: undefined`.
- The registration test: `exportQuery` was `""`.

The new resolver and manifest specs import modules that do not exist on base, so on base they fail with module-not-found.

After the restore, all of these pass (below).

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: 1 project, "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence".
  - The same suite through jest directly (`--maxWorkers=2`): `Test Suites: 1 skipped, 65 passed` and `Tests: 10 skipped, 2028 passed, 2038 total`.
  - The first full run, before the consumer pins were updated, had 11 failures, all Python/Go "unsupported" pins. They are listed above.
- `node_modules/.bin/nx run-many -t=test,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: "Successfully ran targets test, typecheck for project @ptah-extension/vscode-lm-tools". Before the pin updates: `Tests: 19 failed, 2411 passed`. The run after the first fix round: `1 failed, 2431 passed, 2432 total` (the C# mock map), which was then fixed.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`: `Tests: 110 passed, 110 total`.
- `npx eslint` on the changed vscode-lm-tools and Electron files: 0 errors (23 existing `max-lines` warnings).
- `npx nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies." (exit 0).
- `npx nx run degradation-audit:lint --skip-nx-cache`: **`TOTAL 300`**, `workspace-intelligence: 1 ok (baseline 1)`. The first run was 302: two `catch-return-sentinel` sites in `python-manifest.ts`. They were fixed by assigning in the catch (the `parseJsonc` pattern). No baseline was raised.
- `npx prettier --write` was run only on the changed files.
- The `context-enrichment.service.spec.ts` flake did not occur.

## Deviations

- **D1, footprint:** 28 paths instead of 7; see "Outside the batch list" for the reason for each.
  - The pinned consumer specs are the bulk. They hard-code "Python/Go are not graphed" and have to move in the batch that changes it.
  - The rest is required for honest behaviour: the context and manifest reading (the plan says resolvers read only `ctx`), the approximation seam (otherwise `go:package-edges` would be invisible), and the R32A-04 contract.
- **D2, proven vs `contextDependent` external:** the plan row says "first-segment miss → external" for Python, and "stdlib and other modules → external" for Go. Following the 32b Blocking theme, `external` is certified only with proof:
  - Python: a standard-library module or a dependency the root pyproject declares. PyPI names that differ from their import name, such as `PyYAML` → `yaml`, stay unproven.
  - Go: a standard-library first element, a `require`d module, or a non-local or outside-root replace.

  Everything else is `external` with `contextDependent`, so the context is `partial`. A Python repository with undeclared third-party imports, or a Go repository with no root `go.mod` (nested modules are not discovered), therefore never reads as clean.
- **D3, pyproject additions:** besides the plan's setuptools `package-dir`/`packages`, the reader also takes `packages.find.where`, Poetry `from` and Hatch wheel `packages`. Dependencies are read only as proof of externality.
- **D4, Go export rule:** only an ASCII upper-case first letter counts as exported. Go also exports names that start with a non-ASCII upper-case letter; the tree-sitter predicate regex has no Unicode flag. This is documented in `go.language.ts`.
- **D5, Python public symbols:** by the `_` convention at module level; `__all__` is not read. Names bound only inside a module-level `if`/`try`, or re-exported through imports, are not listed. This is documented in `python.language.ts`.

## Observations (not changed)

- **O1:** the `ptah_get_symbol_index` description is at 996 of the < 1,000 budget. Batches 34 (`, csharp, java`), 35 (`, rust`) and 36 (`, php, ruby, cpp`) each lengthen the registry `graphEdges` list it embeds. The description needs a structural fix, for example not embedding the list, owned by the description lane (H/A). Each of those batches will otherwise fail `tool-description.builder.spec.ts`.
- **O2:** the Electron narrowing gate requires `referenceScopeComplete` from every language the graph supports. Python and Go (like TS/JS today) do not claim it, so behaviour is unchanged: no shipped narrowing.
- **O3:** `resolver-context.ts` is at 681 of 700 lines. Batch 35 (Cargo) should extract it.

## Fix round (review r1)

Source: `reviews/batch-33-code-logic-review-r1.md` (REVISE 4/10), User Decisions 24 and 28, one round. The rule followed throughout: when exact semantics cost too much or are uncertain, disclose (unresolved-internal, or a partial context with a named gap) and never certify a result as external or clean without proof.

Paths below are relative to `libs/backend/workspace-intelligence/src/ast/` unless stated otherwise. No git state was changed. Prettier was run only on files this batch changed. The `ptah_get_symbol_index` description was not touched in this round (34.1 handles it).

### Findings → fixes → regression tests

1. **R33-10 (Blocking), independent tsconfig `paths` (User Decision 28).** Changed in `import-resolution/tsconfig-mapping.ts`.
   - Each effective option set now records `pathsFrom`, the config that declared the `paths`.
   - If the top configs' `paths` come from two or more declaring configs, or from different `baseUrl` directories, no `paths` rule is used and `conflicting-configs` is disclosed. An alias-matched import then falls through to external-with-context-dependency (partial). The resolver never picks a target across configs.
   - One config, or one extends chain shared by several tops (the Nx app/spec/base shape), keeps full resolution.

   Tests in `resolver-context.spec.ts`:
   - "discloses independent configs that both declare paths (%s), using none", four cases: the same key mapped differently, a wildcard against an exact key (the reviewer's `@*` vs `@x`), overlapping wildcards, and identical mappings;
   - "keeps full resolution for one extends chain shared by several top configs";
   - "uses the one config that declares paths beside configs that map nothing". This replaces the old "agree" test, which Decision 28 reverses.
2. **R33-08 (Serious), exponential extends evaluation.** `tsconfig-mapping.ts` now memoises effective options per config, with a cycle-safe visiting set. Test "evaluates each config once in a repeated-parent extends graph": 15 configs, each extending the previous one twice, with `compilerOptions` reads counted, asserts ≤ 15.
3. **R33-07 (Serious), bytes lost on read or close errors.** In `import-resolution/manifest-reader.ts`, a per-manifest `ConsumedBytes` counter is updated after every successful chunk. The outer catch (read error, close error in `finally`, any later failure) returns `manifest-unreadable` with `bytesRead` set to the consumed count. `readManifests` charges it before the gap decision and before the next manifest.

   Tests in `resolver-context.spec.ts`:
   - "charges partial reads that end in a read error to the 2 MiB budget": 12 × 250 KiB manifests, one successful 250 KiB read and then EIO; asserts served bytes ≤ 2 MiB, 8 opens, and gaps `['manifest-unreadable','manifests-over-total']`;
   - "charges a manifest whose close fails after it was read".
4. **R33-01 (Blocking), Python regular vs namespace packages.** `import-resolution/python-import-resolver.ts` was rewritten around a path-finder model:
   - Every lookup scans the search path entry by entry. A regular package (`__init__.py`) or a module returns immediately and shadows later entries. Plain directories collect namespace portions, used only when no entry has a regular package or module; a later regular package wins over earlier portions.
   - Below a namespace package, the search path is all of its portions.
   - A requested member that no file or submodule provides is counted in the new `ImportResolution.unresolvedMembers` (`import-resolution/import-resolver.ts`). `dependency-graph.service.ts` adds it to `unresolvedInternal`, even when other members linked.

   Tests in `python-import-resolver.spec.ts` › "packages across source roots (R33-01)". The real `DependencyGraphService` checks cover full target arrays and coverage:
   - "Scenario A: a namespace package gathers its portions from every root": targets `ns/a.py` and `src/ns/b.py`, graph dependencies both, `unresolvedInternal` 0;
   - "Scenario B: a regular package in an earlier root shadows later portions": `unresolved-internal`, no edge, `unresolvedInternal` 1, not clean;
   - "a later regular package wins over earlier namespace portions";
   - "discloses a requested member that nothing provides, beside the found ones".
5. **R33-02 (Blocking), Python local dependencies.**
   - **Manifest (`import-resolution/python-manifest.ts`):** it now keeps `localDependencies`, taken from a Poetry dependency table with `path`, a `[tool.uv.sources]` entry with `path` or `workspace`, and a PEP 508 direct reference to a `file:` URL or a bare path (`${PROJECT_ROOT}` is understood). A remote URL (`git+https:` and similar) stays an external dependency. A name declared local anywhere is removed from the proof set.
   - **Layout (`import-resolution/python-context.ts`, new):** it maps each local dependency to a directory under the root, or to `undefined` when the location cannot be placed.
   - **Resolver:** a top-level name that no source root has, but that is a local dependency, is looked up in `<dir>` and `<dir>/src`. It is `unresolved-internal` when it cannot be located, and never external.

   Tests in `python-import-resolver.spec.ts` › "local dependencies (R33-02)":
   - "resolves a Poetry path dependency into its directory" (the reviewer's `lib = {path = "packages/lib", develop = true}`);
   - "resolves a PEP 621 file reference through a src layout";
   - "a local dependency that cannot be located is unresolved-internal, never external".
6. **R33-04 (Blocking), Go replacement selection.**
   - **Manifest (`import-resolution/go-manifest.ts`):** it keeps `require` versions, the replaced version (`fromVersion`) and the replacement module.
   - **Selection (`import-resolution/go-context.ts`, new, from `resolver-context.ts` under the facade rule):** `selectGoModules` applies the Go module reference.
     - A `go.work` replace overrides `go.mod` replaces.
     - A version-qualified replace applies only to the single known required version, and wins over an unqualified one.
     - If the required version is unknown or ambiguous, or members replace a module differently, or a replacement directory cannot be looked up, the module becomes `unknown` and the gap is the new `module-selection-unknown`.
     - `locateGoDirectory` resolves relative directories lexically against the manifest's directory, and absolute `replace` and `use` directories through realpath, checked against the root's real path.
   - **Resolver (`import-resolution/go-import-resolver.ts`):** an import under an `unknown` module is `unresolved-internal`, and `unknown` wins ties.

   Tests in `go-import-resolver.spec.ts` › "replacement selection (R33-04)":
   - the reviewer's three cases: "a go.work replace overrides the go.mod replace of the same module", "a replace of another version does not apply to the required one", "an absolute replace directory inside the root is local";
   - "a replace of the required version wins over an unqualified one";
   - "a version-qualified replace of a module whose version is unknown is not guessed";
   - "members that replace one module differently are a conflict, not a guess";
   - "an absolute replace directory that cannot be looked up is not guessed";
   - "reads the go.mod of an absolute go.work use directory inside the root".

   The existing replace test now requires `example.com/forked v1.2.0`, so that its version-qualified replace applies.
7. **R33-05 (Serious), Go Unicode exports.** The `languages/go.language.ts` query no longer uses a regex predicate. Every package-level name carries a second capture, `@export.visibility_upper`. `export-extraction.ts` keeps such a match only when the name matches `/^\p{Lu}/u`. This applies on both decoder paths: `analyzeSource` and the vscode-lm-tools `queryExports`. Test in `ast-analysis.service.spec.ts`: "Go: a name starting with any Unicode upper-case letter is exported" (`Éclair`, `ASCII`, `Äpfel`, the type `Ωmega`, the const `Ñandú`; lowercase `émigré`, `ärger`, `ñu` excluded).
8. **R33-06 (Serious), Python public symbols.**
   - **Decoder (`python-public-symbols.ts`, new):** it is called from `extractExportsFromMatches`, which gained an optional `{ fileName }`, passed by `ast-analysis.service.ts` and by vscode-lm-tools `ast-namespace.builder.ts`.
     - A static `__all__` (a single module-level list or tuple of plain string literals) is the public surface, with underscored and imported names included.
     - Without one: public module-level definitions, redundant-alias re-exports, and in `__init__.py` the names its `from` imports bind.
     - Disclosed as unextracted, so the file stays in the index with the existing incomplete marker: a dynamic or changed `__all__`, public bindings inside a module-level `if`/`try`, and in `__init__.py` a star import or a conditional `from` import.
   - **Query:** `languages/python.language.ts` has a new export query with the `export.py_*` captures.

   Tests in `ast-analysis.service.spec.ts`:
   - "Python: a package __init__ with a static __all__ exports what it lists" (the reviewer's fixture: `X` and `_visible`);
   - "Python: without __all__, an __init__ re-exports its from-imports";
   - "Python: what cannot be read statically is disclosed, not dropped" (conditional `fast` and `LIMIT`, `__all__ +=`, `__init__` star import).
9. **R33-03 (Moderate), Python case rule at the top level.** The shared `lookupName` does exact matches along the whole search path first, including namespace directories. Only when there is none does `foldedLookup` run, over `filesByFoldedPath` and the new context index `directoriesByFoldedPath`: a unique match is used and marked `caseFolded`, and more than one is `unresolved-internal`.

   Tests › "top-level case rule (R33-03)":
   - "uses a unique case-folded top-level module" (`Widget.py` / `import widget`);
   - "uses a unique case-folded namespace package";
   - "an exact match in a later root outranks a folded one in an earlier root";
   - "an ambiguous case-folded top-level name is unresolved-internal".
10. **R33-09 (Moderate), Go escaped import paths.** `languages/go.language.ts` has a new `goStringValue`:
    - Interpreted strings decode `\xNN` and octal `\NNN` as bytes, `\uXXXX` and `\UXXXXXXXX` as code points, plus the simple escapes, and the bytes are read as UTF-8.
    - Raw strings are unchanged.
    - A malformed escape keeps the text as written.

    Test: "Go: escaped import paths are decoded (grouped, blank, dot, aliased)".

### Structure

`resolver-context.ts` was 681 lines and is now 597, under the facade rule: `buildResolverContext` keeps its name and signature. It now reads raw manifest facts and delegates to `go-context.ts` (`selectGoModules`, `locateGoDirectory`, `GoModules`) and `python-context.ts` (`pythonLayout`, `PythonLayout`). New context fields: `directoriesByFoldedPath`, `go.unknown`, `python.localDependencies`. The `ts-js-import-resolver.spec.ts` helper gained them.

### FB evidence

- **R33-07, R33-08, R33-10:** the base (fb94c68f0) versions of `tsconfig-mapping.ts` and `manifest-reader.ts` were put in place with the read-only `git show`, and `resolver-context.spec.ts` was run against them. Result: **7 failed, 40 passed**. The partial-read EIO case consumed **3,072,000** bytes (the reviewer's figure), the repeated-parent graph made **65,519** evaluations (the reviewer's figure), and all four independent-config cases failed, along with the close-failure case. Both files were then restored and `git diff` confirmed it.
- **R33-05, R33-06, R33-09:** the pre-fix-round Batch 33 `python.language.ts` and `go.language.ts` (saved copies) were put in place and `ast-analysis.service.spec.ts` was run. Result: **5 failed, 47 passed**, namely the Unicode export test, the escaped import test and the three `__all__`/disclosure tests. The files were then restored.
- **R33-01 to R33-04:** the resolver specs were not rerun against the pre-fix resolvers. Those were untracked files and no copy was kept. The FB for these findings is the reviewer's independent reproduction. The new tests encode the reviewer's scenarios and expected values exactly.

### Verification (fix round)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache`: 1 project, "Successfully ran targets test, lint, typecheck". Through jest directly: `Test Suites: 1 skipped, 65 passed` and `Tests: 10 skipped, 2059 passed, 2069 total`.
- `node_modules/.bin/nx run-many -t=test,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: "Successfully ran targets test, typecheck".
  - One earlier run failed one timing test under parallel load: `protocol-dispatcher.spec.ts` › "delivers a slow empty build to the next call, then rediscovers".
  - That spec file alone passed twice (298 of 298), and the full rerun was green.
- `npx jest … apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`: 110 of 110 passed.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `npx nx run degradation-audit:lint --skip-nx-cache`: **TOTAL 300** (workspace-intelligence 1 against baseline 1, vscode-lm-tools 2 against baseline 2). The new catches assign a value and do not return.
- No new pin was raised in this round.

### Paths changed in this round

- New: `import-resolution/go-context.ts`, `import-resolution/python-context.ts`, `python-public-symbols.ts`.
- Modified:
  - `import-resolution/`: `tsconfig-mapping.ts`, `manifest-reader.ts`, `resolver-context.ts`, `resolver-context.spec.ts`, `go-manifest.ts`, `go-import-resolver.ts`, `go-import-resolver.spec.ts`, `python-manifest.ts`, `python-import-resolver.ts`, `python-import-resolver.spec.ts`, `import-resolver.ts`, `ts-js-import-resolver.spec.ts`;
  - `dependency-graph.service.ts`, `export-extraction.ts`, `ast-analysis.service.ts`, `ast-analysis.service.spec.ts`;
  - `languages/python.language.ts`, `languages/go.language.ts`;
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts` (passes `fileName`).

### Remaining limits (disclosed, not fixed)

- Python: non-`__init__` modules re-export only through a redundant alias or `__all__`. `__all__` with an escaped or prefixed string counts as dynamic, so it is disclosed.
- Go: a module whose required version is not in any `go.mod` read (for example one required only indirectly) cannot have a version-qualified replace applied. It is disclosed as `module-selection-unknown`.
