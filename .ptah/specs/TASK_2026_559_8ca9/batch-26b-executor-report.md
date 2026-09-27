# Batch 26b executor report — Electron report, C# fallback, narrowing gate (Lane H)

Base: HEAD ea46dc9ad (26a committed). Working tree left dirty; no git commands run.

## Files

- MODIFIED `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
  - `lsp.getDefinitionReport` / `lsp.getReferencesReport` implement the 26a `LspLocationReport` contract. The array APIs
    (`getDefinition`, `getReferences`, `getTypeDefinition`) share the same lookups and keep their `[]` answers.
  - Mechanisms: `symbol-index` (index hit), `declaration-scan` (index-free fallback), `graph-scoped-scan` (gate held),
    `text-scan` (everything else; approximation `text-scan`). `language` comes from the WI registry
    (`languageForExtension`). `languageSupported` is per mechanism:
    - `symbol-index`: the extension has `codeIndex`.
    - `declaration-scan`: the extension has `definitionFallback`, and a declaration query exists for the file's parse
      language. `.tsx` is therefore false.
    - `graph-scoped-scan`: true.
    - `text-scan`: the extension is scanned.
  - A lookup that cannot run (no workspace root, unreadable cursor file, no identifier at the position) throws
    `Lookup did not run: …` from the report API instead of returning an empty report. The array APIs still answer `[]`.
    Neither API ever answers `none` on Electron.
  - Scan extensions are `recognisedSourceExtensions()` from the registry, which adds `.kt/.kts`, `.java`, `.rs`, `.swift`,
    `.csx`, `.c++`, … (fast-glob matching of `**/*.c++` was checked).
  - Caps are reported as `truncated: true`:
    - the file cap (8,000), when files remain;
    - the match cap (500);
    - a scan that stopped on an error.
  - C# gets a `DECLARATION_QUERIES.csharp` entry for top-level types: class, interface, struct, enum, record and
    delegate, found in `compilation_unit` (global or file-scoped namespace) and in `namespace_declaration` bodies at any
    depth. It also gets a `COMMENT_STRING_QUERIES.csharp` entry covering comments, regular, verbatim, raw and character
    literals, and only the `string_content` of interpolated strings (code in `{…}` is kept). `.cs/.csx` map to `csharp`.
  - Narrowing gate (`narrowedReferenceScope` + `graphReferenceScopeIsComplete`), evaluated per query. The scan is scoped
    only when all of these hold:
    - the graph is built for this root and publishes `getCoverageReport(root).languages`;
    - `resolution` is present and `isCleanAnswer(coverage)` is true. That means a complete census, nothing
      unsupported, unrecognised, failed or omitted, and no unresolved internal import, truncated import, `edgeCapHit`
      or partial context;
    - every census language (the graph's `supportedLanguages` claim, plus any non-zero `unsupportedByLanguage` key) is a
      `LanguageId` whose `graphEdges.referenceScopeComplete === true`;
    - the symbol index names declarations, and each declaration file resolves to a graph node (`resolveNodePath`).
  - The dependent walk starts from graph node keys.
- MODIFIED `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
  - New helpers `graphCoverage` and `builtGraph`. The three existing Tier-1 graph tests now publish clean coverage.
  - New describe "TASK_2026_559 Batch 26b" with 31 tests (the file now has 75, all passing).
- MODIFIED `libs/backend/workspace-intelligence/src/ast/language-registry.ts` — `csharp.definitionFallback: true` (see
  Deviations).
- MODIFIED `libs/backend/workspace-intelligence/src/ast/language-registry.spec.ts` — the `definitionFallback` row adds
  `csharp`, and the header note is updated. The spec already said "`definitionFallback` gains C# in Batch 26b".

## Required tests (Task 26b.2) and where they are

1. Complete census with `edgeCapHit`: the FB test (below).
2. A TS declaration imported by a Python file: the `it.each` row, where the graph has `unsupportedByLanguage.python`.
   The Python user is found by the text scan.
3. A vendor tree beyond the census limit, sorted first:
   - an `it.each` row with census `truncated` gives a text scan;
   - 8,000 vendor files ahead of normal code give `truncated: true`.
4. C# same-namespace references, on the real grammar: 4 hits. The comment, the `"Invoice"` string and the interpolated
   string text are dropped, and `nameof(Invoice)` inside `{…}` is kept.
5. Java same-package references: a text scan with `language: 'java'`.
6. A capped graph: an `it.each` row with `omittedByCap: 5`. Other rows cover an unknown census, an unresolved internal
   import, a partial context, no resolution, a graphed `go` (no scope-complete edges), no coverage, and a declaration
   that is not a graph node.
7. Kotlin scan: the include patterns contain `.kt/.kts/.java/.rs/.cs/.swift`, the `.kt` and `.kts` references are
   found, and `language: 'kotlin'`.
8. No-host CLI: not added in the Electron spec (see Deviations).
   - It is covered by 26a's `ide-namespace.builder.spec.ts` ("no-host" FB, `mechanism:'none'`) and by
     `protocol-dispatcher.spec.ts` ("no-host definitions are not Found: 0").
   - `grep IDE_CAPABILITIES_TOKEN apps/ptah-cli` finds no registration, so the CLI takes that path.
   - The Electron spec pins the other side: Electron never answers `none`, and a lookup that cannot run is an error.

C# `definitionFallback` real-grammar tests pass:
- found: a record struct in a file-scoped namespace, a delegate, a class, and an interface in nested block namespaces;
- not answered: a type nested in a class, a declaration in a comment;
- a file with a syntax error stays unresolved.

The node names were first probed with the shipped `@vscode/tree-sitter-wasm` `tree-sitter-c-sharp.wasm` through
`web-tree-sitter`, using a scratch script in the OS temp directory, outside the repo.

## 26a review fixes on the Electron path

- M1 (an empty answer without explicit support is qualified):
  - Pinned: an empty text scan carries `approximations: ['text-scan']`, and a `.java` definition reports
    `languageSupported: false`.
  - Rendered once through the real 26a formatter with a temporary spec, which was then deleted:
    - "Found: 0 references (qualified as above; not proof that none exist)";
    - "language: java (not supported by this mechanism) … Found: 0 definitions (qualified …)".
- M2 (line/column 0 render):
  - Pinned: the report keeps `{line: 0, column: 0}`, and the symbol-index report keeps `column: 0`.
  - Rendered: `C:/repo/src/a.ts:0:0`.

## FB evidence

`apps/ptah-electron/src/services/electron-ide-capabilities.ts` was temporarily replaced by its base content. The base
copy was taken from the integration worktree, which is byte-identical in line count and structure to the pre-edit file
(971 lines). The file was then restored and `cmp` confirmed it.

- `jest … -t "Batch 26b"` → **31 failed**, 44 skipped.
- `-t "FB: complete-census|Kotlin scan"` → **2 failed**. The FB fails behaviourally through the pre-existing array API:
  the base narrows, so the expected Python hit is missing (Expected −5 / Received +0 lines).
- After the change, the whole file passes: 75 passed.

## Verification

- `nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/workspace-intelligence --skip-nx-cache`
  (2 projects):
  - test and lint passed for both;
  - typecheck failed in that run only because I forwarded `--maxWorkers=2` to `tsc` (TS5023 unknown option);
  - re-run without it: `nx run-many -t=typecheck -p ptah-electron @ptah-extension/workspace-intelligence` passed.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2
  projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json
  dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300. ptah-electron 4 (baseline 4), workspace-intelligence 1
  (baseline 1).
- `ptah-core-prompt.ts` and `cli-adapter.utils.ts` (`NATIVE_AGENT_TOOL_POLICY`) are byte-identical to the integration
  worktree.
- No `as any` or `@ts-ignore`. No `from "`, `import("`, bare `import "` or `require("` in the changed files. Only
  package-alias imports.
- No mkdtemp was used: every new test uses in-memory files.
- The known Electron stress-bundle flake did not occur.

## Deviations

1. **Registry edit outside the listed files.** The requirement "`definitionFallback` for C# set only when the
   real-grammar spec passes" can only be met in `language-registry.ts`, which is the single source of the claim. Its
   spec already pinned the change for 26b. So two WI files changed, and workspace-intelligence was added to the scoped
   run.
2. **No-host CLI test.** It is not duplicated in the Electron spec. Building the no-host namespace needs
   `buildIDENamespace` or `PtahAPIBuilder`, and neither is on the vscode-lm-tools barrel. It is covered by the 26a
   specs, as listed above.
3. **Report APIs throw when a lookup cannot run.** They do this instead of returning an empty report, so "no
   identifier" is never rendered as "Found: 0". The array APIs are unchanged.

## Out-of-scope observations

- Scoped narrowing still trusts TS/JS `referenceScopeComplete: true`. A global-script (non-module) reference to an
  index-named declaration has no import edge. This was already the case before 26b (B2 covers only the empty-index case).
- `execute_code` help and the tool descriptions do not yet mention the report methods (carried to 24c).

## Fix round (review r1)

All nine findings in `reviews/batch-26b-code-logic-review-r1.md` are fixed. Line numbers below are in
`apps/ptah-electron/src/services/electron-ide-capabilities.ts` (**E**) and
`apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts` (**S**) after the round. The rule applied everywhere:
an answer that may be incomplete is reported as `truncated` or raised as an error, and narrowing happens only when it
is provably safe.

Files changed in this round:
- **E** and **S**;
- `libs/backend/workspace-intelligence/src/ast/language-registry.ts` and its spec;
- `apps/ptah-electron/src/di/phase-3-storage.ts`. The capability no longer takes the `WorkspaceIndexerService`, so the
  wiring drops one constructor argument and its resolve.

### Per finding

- **R26B-B1 (Blocking)** — an uncertain declaration scan used to become an empty report with support true.
  - The fallback now returns a typed `FallbackOutcome` (E:329): `found`, `not-found`, `unsupported` or `failed`.
    `definitionLookup` (E:474) maps it as follows:
    - `failed` is raised as an error by the report API ("Lookup could not answer: … could not be parsed reliably" or
      "… import target … could not be read"). This covers a query error, an ERROR node, and an unreadable or
      unparseable import target;
    - `not-found` is `truncated: true`. The scan reads at most the cursor file and one import target, so an empty
      result is bounded, not proof of absence. This covers a C# same-namespace type and package or alias imports;
    - `unsupported` is `languageSupported: false`.
  - The array APIs still answer `[]`. `findDeclaration` now separates `unsupported` (no query for the language) from
    `uncertain` (parse or query failure).
  - Specs:
    - S:1785 — C# syntax error rejects;
    - S:1794 — C# same-namespace, truncated;
    - "B1: …" describe in S:1854 — query failure rejects, unreadable import target rejects, clean-but-empty is
      truncated.
- **R26B-B2 (Blocking)** — TS/JS narrowing lost global-script references.
  - TS/JS no longer claim `referenceScopeComplete` (`language-registry.ts:103`). The TS/JS graph draws edges from
    `import` statements only (`JS_TS_IMPORT_QUERY`; `resolveImportPath` gets no tsconfig paths from the Electron
    build). So global scripts, re-exports (`export { X } from`, which I found adds no edge), `require`, dynamic
    `import()` and unmapped aliases all reach a declaration without an edge.
  - No shipped language can narrow today. The gate stays, with every other condition, for resolvers that can claim it
    (32b+).
  - The registry spec pins `false`. Gate specs grant the claim through a registry override that is scoped to each test
    (`mockScopeComplete` at the top of S).
  - Specs: S:1365, plus "B2: a global-script reference is found" on a real `DependencyGraphService` over mkdtemp
    files.
- **R26B-B3 (Blocking)** — the coverage check happened before the index await and was never re-checked.
  - The index lookup, which was the only await, now runs first. `certifiedScope` (E:873) then reads the certificate
    and walks the graph synchronously, so nothing can change between them.
  - After the scoped reads, `certificateHolds` (E:918, used at E:812) checks that the root still publishes the same
    coverage object. Invalidation and rebuild both replace it. If it changed, the answer is a text scan.
  - Specs on the real graph: invalidation during the index lookup, and invalidation during the scoped reads.
- **R26B-B4 (Blocking)** — the parent graph was certified but the nested graph was traversed.
  - Every declaration file and every node the walk visits must be answered by the certified graph:
    `getCoverageReportForFile(file).languages === certified` (E:884). Otherwise there is no narrowing.
  - Spec: a real parent graph plus a real `pkg` graph. `use.ts` is found, by a text scan.
- **R26B-B5 (Blocking)** — per-file omissions were silent.
  - `collectMatchesInFile` (E:1025) stats each file first and returns `scanned`, `unreadable` or `too-large`
    (over 1 MiB, E:109). `scanFiles` (E:982) sets `truncated` for any skip, for an unexpected per-file failure, and for
    the match cap. This applies to scoped and text scans alike.
  - Text-scan discovery now calls `IFileSystemProvider.findFiles` directly (E:935, see M3). An
    `IncompleteFileSearchError` keeps its matches and sets `truncated`; any other discovery failure gives `truncated`
    with no locations.
  - Specs: an unreadable scoped member, a stat failure, an oversized file, and incomplete discovery.
- **R26B-B6 (Blocking)** — the string filters dropped executable interpolations.
  - TS/JS now exclude only `(template_string (string_fragment))` and Python only `(string (string_content))`
    (E:273-275). The C# query already did this. Node names were probed on the shipped grammars.
  - Real-grammar specs: a TS template, a JS template, and a Python f-string. `${Foo()}` / `{Foo()}` are kept and the
    literal "Foo" text is dropped.
- **R26B-M1 (Moderate)** — the top-25 index cap was lost.
  - `indexCandidates` reports `saturated` when the raw page is full (E:588). A definition from a full page with no
    confident pick (local or imported-module) is `truncated`. Narrowing refuses any saturated candidate set.
  - Specs: truncated definition, a confident local pick left unqualified, and no narrowing.
- **R26B-M2 (Moderate)** — `$` identifier boundaries.
  - `identifierMatcher` (E:1406) uses `(?<![A-Za-z0-9_$])…(?![A-Za-z0-9_$])` instead of `\b`.
  - Spec: `$Foo` matches whole. `x$Foo` and `$FooBar` do not match, and `Foo` does not match inside `$Foo`.
- **R26B-M3 (Moderate)** — discovery and match allocation were not bounded.
  - Discovery is `fs.findFiles(pattern, DEFAULT_WORKSPACE_EXCLUDES, 8001, root)`, the bounded-discovery precedent of
    Batch 23b. One path past 8,000 means `truncated`.
  - Matches are streamed straight into the output with the cap checked per match. There is no raw-candidate array, and
    the file is parsed only when a first match exists.
  - Spec: S:1493 asserts the bounded call.
  - The streaming change is source-level. It has no observable before/after difference, so it has no FB, and I did not
    add adapter-level instrumentation.
  - Trade-off: `.gitignore` rules no longer filter the text scan, same as graph discovery. The default vendor/build
    excludes still apply. Extra files can only add hits (which carry the `text-scan` approximation) or trigger an
    earlier, disclosed cap.

### FB evidence

The reviewed Electron source (the first-round 26b file) was put back with a test-only adapter. It keeps the removed
indexer by feeding the spec's `findFiles` mock through `indexWorkspaceStream`. The registry was also set back to TS/JS
`referenceScopeComplete: true`. The whole spec file was then run.

- Result: **25 failed**, 72 passed.
- Every finding has at least one failing spec:
  - B1: 5 specs;
  - B2: 2;
  - B3: 2;
  - B4: 1;
  - B5: 4;
  - B6: 3;
  - M1: 2;
  - M2: 1;
  - M3: 1 (the discovery bound);
  - 4 more failed only because of the error-prefix and `findFiles` shape changes.
- Both files were restored and checked with `cmp`.
- After the fix: **97 passed** in the file.

### Verification (fix round)

- `nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/workspace-intelligence --skip-nx-cache` →
  "Successfully ran targets test, lint, typecheck for 2 projects and 6 tasks they depend on".
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success for 2 projects.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered".
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300. ptah-electron 4 (baseline 4), workspace-intelligence 1
  (baseline 1).
- No `as any`, `@ts-ignore`, or import-shaped literals: spec fixtures build `from` by concatenation. Every mkdtemp root
  is removed in `afterEach`. `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are untouched.

### Out-of-scope observations (fix round)

- TS/JS narrowing can return only once the graph resolver models every way a file reaches a declaration: global
  scripts, re-exports, `require`, dynamic `import()` and aliases. `DependencyGraphService` does not add edges for
  re-exports today, and that also affects `ptah_get_dependents` answers (their coverage does not say so). This is a
  candidate for 32b.
