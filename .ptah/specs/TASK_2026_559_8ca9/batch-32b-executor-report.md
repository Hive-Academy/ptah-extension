# Batch 32b executor report: resolver seam, context, bounds

Executor: backend-developer (sub-agent), Lane G2 worktree `task-559-lane-g2`, base HEAD `a5632f1bb` (Batch 32a).
No git command changed state. The working tree is left dirty for the team-leader. `code-logic-review.md` is untracked and was not touched.

## Tasks

- 32b.1 `ImportResolver` seam and TS/JS resolver: DONE
- 32b.2 `ResolverContext`, bounds, graph dispatch: DONE
- Carried 1 (26b closing R26B-C-B1): a re-export adds no graph edge. FIXED
- Carried 2 (32a R32A-05): an empty `export {}` + from clause adds no dependency. FIXED

## Changed paths (every one)

All paths are under `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-g2/libs/backend/workspace-intelligence/src/ast/`.

In the batch list:

1. `import-resolution/import-resolver.ts` (new). Seam: `ImportResolver.resolve(imp, fromFile, ctx) → ImportResolution { kind: file|package|namespace|external|unresolved-internal, targets, truncated?, caseFolded?, contextDependent? }`, plus `MAX_TARGETS_PER_IMPORT = 200`.
2. `import-resolution/ts-js-import-resolver.ts` (new). This is `TS_JS_IMPORT_RESOLVER`. It keeps today's relative, extension and index probes. It adds tsconfig `paths`, where the best pattern wins (an exact pattern first, then the longest prefix) and every target is tried in order. It adds `baseUrl` lookup. The case rule applies: an exact match first, then a unique case-folded match (marked `caseFolded`); an ambiguous match is `unresolved-internal`. Unresolved specifiers are classified as follows:
   - `.`, `/`, `#`, or a specifier an alias claims → `unresolved-internal`;
   - a Node builtin, or a package the root `package.json` declares → `external`;
   - any other bare specifier → `external` with `contextDependent` (see D2).
3. `import-resolution/resolver-context.ts` (new). `buildResolverContext` runs once per build. It lists the root `tsconfig*.json`, `package.json` and `pnpm-workspace.yaml`, and reads them within the bounds:
   - at most 64 files, at most 256 KiB each, at most 2 MiB in total;
   - the real path must be inside the root's real path;
   - UTF-8 text only (a NUL byte or invalid UTF-8 is rejected), and a BOM is dropped.

   Between reads it awaits `yieldBetweenReads`, and it checks `isCurrent()` after every await. It returns `undefined` once the build is superseded. It parses JSONC (comments, trailing commas). It collects `paths` (resolved against `baseUrl`, else the root), `baseUrls`, `declaredPackages` and a folded-path index of the node keys. Every limit or problem is a named `ResolverContextGap`:
   - `too-many-manifests`, `manifest-too-large`, `manifests-over-total`;
   - `manifest-outside-root`, `manifest-not-text`, `manifest-unreadable`, `manifest-unparseable`;
   - `extends-not-read`, `workspace-packages`, `root-unreadable`.

   Any gap makes the resolution context `partial`.
4. `import-resolution/resolver-context.spec.ts` (new). 25 tests: JSONC, caller-paths precedence, `extends`, unparseable forms, workspace packages, declared packages, the folded index, every bound, superseded mid-read, and a yield before every read.
5. `dependency-graph.service.ts`. The main changes:
   - Builds the context after parsing, under the generation guard; a superseded build returns an unpublished graph with no edges.
   - Dispatches on `LANGUAGE_MODULES[node.language].importResolver`.
   - Links imports and every re-export source.
   - Expands at most 200 targets per import (`truncatedImports`).
   - Yields and re-checks the generation for each target inside a multi-target expansion.
   - Sets `context` from context gaps or context-dependent answers, and sets `caseFolded` → `case-folded`.
   - Tracks re-export edges per graph (a private `WeakMap`, so the exported `DependencyGraph` shape is unchanged), keeps them on invalidation, and `getDependents` follows barrel chains.
   - Deletes the old `resolveImportPath`, `resolveRelativeImport`, `resolveTsconfigPath`, `matchTsconfigPattern`, `claimedByTsconfigPaths`, `RESOLVE_EXTENSIONS` and `INDEX_FILES`.
   - Keeps the `tsconfigPaths` parameter (caller paths are tried first), because 32c removes it from its only caller.
6. `dependency-graph.service.spec.ts`. New blocks for the resolver context, multi-target expansion, the case rule and re-export edges (13 tests). The 23a expectations are unchanged: see D2.

Outside the batch list. Each one is required by a carried item or by the plan's registration rule; see Deviations:

7. `import-resolution/ts-js-import-resolver.spec.ts` (new). 26 unit tests of the resolver.
8. `languages/javascript.language.ts`. New import-query pattern `(export_statement source: (string) @import.reexport_source)`. It carries no `@import.source`, so both import decoders (`ast-analysis.service.ts` and the vscode-lm-tools `ast.queryImports` decoder) skip it. The file also registers `importResolver: TS_JS_IMPORT_RESOLVER`, and the `FILE_EDGES` comment no longer lists re-exports as a gap. `referenceScopeComplete` stays `false`, because globals, `require` and dynamic `import()` are still unmodelled (as the 26b closing review asked).
9. `languages/typescript.language.ts` and `languages/tsx.language.ts`: `importResolver` registration.
10. `languages/types.ts`: `LanguageModule.importResolver?: ImportResolver`, and the capability doc is updated.
11. `ast-analysis.interfaces.ts`: `CodeInsights.reExportSources?: string[]`, and the `ImportInfo` doc is corrected.
12. `ast-analysis.service.ts`: `extractReExportSources` decodes `import.reexport_source` for TS/JS/TSX. The key is absent when there is none, so every file without a re-export gets byte-identical output. A small `unquoteModuleString` helper now serves both decoders.
13. `ast-analysis.service.spec.ts`: real-grammar tests for `reExportSources` (ts, js, tsx), and a test that the key is absent without a re-export.
14. `graph-coverage.ts`: `GraphResolutionCounts.caseFolded?` → approximation `case-folded`; the `context` doc is updated. `classifyUnresolvedSpecifier` is deleted and its rules moved into the resolver. The resolver cannot import `graph-coverage.ts`, because that would create a runtime import cycle: languages → resolver → graph-coverage → language-registry → languages.
15. `graph-coverage.spec.ts`: the `classifyUnresolvedSpecifier` table is removed. Its cases are covered in `ts-js-import-resolver.spec.ts` › "unresolved specifiers".

Task documents: `.ptah/specs/TASK_2026_559_8ca9/batches.md` (Batch 32b heading only) and this report.

## FB evidence (base = a5632f1bb, new specs added before any source change)

- `dependency-graph.service.spec.ts` on base: 9 failed, 2 passed. The two that passed are "prefers an exact match" and "ambiguous case-folded match unresolved-internal"; they pin existing behaviour.
  - **"tsconfig alias resolves on the MCP path"**: FAILED, `getDependents(util)` expected `[a]` and received `[]` (`buildGraph(files, root, undefined)`, as `analysis-namespace.builders.ts:530` calls it).
  - "resolves a bare specifier through the tsconfig baseUrl", "discloses a manifest over the size limit as a partial context", "uses a unique case-folded match and discloses it": FAILED.
  - Re-export block: both "lists the barrel and its consumers as dependents of the source" cases (named and wildcard), "drops the barrel consumers with the barrel when the barrel is invalidated", "an empty re-export clause makes an edge and passes dependents on" (expected `[side]`, received `[]`), and "counts an unresolvable re-export source like an import": FAILED.
- `ast-analysis.service.spec.ts` "%s: every re-export statement reports the module it loads" (typescript, javascript, tsx): 3 FAILED on base (`Received: undefined`). For that run only, the field was read through a cast so the suite compiled; the cast was then restored.
- "links at most 200 targets per import", "stops a superseded background build in the middle of one expansion", and the two new unit specs import modules that do not exist on base, so their base failure is module-not-found. On base, `truncatedImports` was hard-coded to 0 and no import had more than one target.
- After the change: all pass. The new and yielding specs were run 3 times in a row with the same result (21 passed each time).

## Carried items

1. **Re-export edge (R26B-C-B1, Blocking).** Every re-export source is a dependency edge. The sources come from `CodeInsights.reExportSources` (every `export … from`) together with each `ExportInfo` that has `isReExport` and `source` (this also covers TS `export import X = require(...)`). They are linked like imports, counted in the resolution tallies, and marked as re-export edges.
   - `getDependents(source)` returns the direct importers and re-exporters. Through every barrel chain it also returns the barrel's importers and re-exporters, so the consumer of the barrel and the barrel are both dependents of the source. A plain import passes nothing on.
   - Electron's reference-scope walk (`electron-ide-capabilities.ts:944`) and `ptah_get_dependents` both read `getDependents`.
   - Regressions (`dependency-graph.service.spec.ts` › "re-export edges (26b closing R26B-C-B1, 32a R32A-05)"):
     - "lists the barrel and its consumers as dependents of the source (a named re-export)" / "(a wildcard re-export)": the leaf → `lib/index.ts` barrel → `outer.ts` barrel → consumer chain;
     - "drops the barrel consumers with the barrel when the barrel is invalidated";
     - "counts an unresolvable re-export source like an import".
2. **Empty clause (R32A-05).** `export {}` + from now yields `reExportSources: ['./side']` from the real TS, JS and TSX grammars. The graph links it. Regressions:
   - `ast-analysis.service.spec.ts` › "%s: every re-export statement reports the module it loads" (empty, named, `*`, `* as ns`, duplicate, in source order; imports identical to the import statement alone);
   - `dependency-graph.service.spec.ts` › "an empty re-export clause makes an edge and passes dependents on".

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache --output-style=static`
  - Result: "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence" (1 project).
  - Test Suites: 63 passed, 1 skipped (64). Tests: 1949 passed, 10 skipped (1959).
  - Lint: 0 errors, 64 warnings, down from 65 at 32a. None is in a new file. The warnings in changed files predate this batch: `dependency-graph.service.ts` max-lines and `analysisResult.value!`, and the non-null assertions in the older spec blocks.
- `node_modules/.bin/nx run-many -t=test,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: "Successfully ran targets test, typecheck for project @ptah-extension/vscode-lm-tools". Test Suites 77 passed (77); Tests 2430 passed (2430).
- `npx nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies." (The new `module` builtin import is covered.)
- `npx nx run degradation-audit:lint --skip-nx-cache`: "TOTAL 300 unsuppressed site(s)". No catch in the new code returns a literal, and no audit marker was added.
- Extra checks:
  - `nx run-many -t=typecheck -p ptah-electron ptah-cli`: succeeded for 2 projects.
  - `nx test ptah-electron --testFile=electron-ide-capabilities` (the `getDependents` consumer): 110/110 passed.
- Prettier was run only on the changed and new files.

## Deviations

- **D1: footprint.** The batch lists 6 files; this change touches 15 source and spec files (1 lib). The extra files:
  - Carried item 2 needs an extraction change: the query in `javascript.language.ts`, plus `ast-analysis.interfaces.ts`, `ast-analysis.service.ts` and its spec. There is no record for the empty clause to resolve.
  - The plan says "each language module registers an `ImportResolver`" (plan "Resolver dispatch (32b)"). That needs the field in `types.ts` and the registration in the JS, TS and TSX modules. This also keeps 33-36 inside their own language-module footprints.
  - Removing `classifyUnresolvedSpecifier` touches `graph-coverage.ts`/`.spec.ts`, and adds `caseFolded` so that `case-folded` is disclosed.
  - One unit spec for the pure resolver.
- **D2: bare specifiers.** The 23a rule (r1 B2: an unproven bare specifier makes the context `partial`) is kept, but it is narrowed with what the context now reads:
  - a Node builtin, or a package declared in the root `package.json`, is proven external (`complete`);
  - any other bare specifier (a Vite `@/` alias, a nested tsconfig alias, a workspace package) stays `contextDependent` → `partial`.

  The 23a spec expectations ("counts external and unresolved internal imports per import", "a supplied paths object never certifies resolution") and the Batch 27 benchmark "a bare/workspace-alias import with no tsconfig paths given is unconditionally reported partial" all pass unchanged.

  A first version counted every unmatched bare specifier as external. It failed that benchmark, so it was replaced.
- **D3: only root manifests.** Only root `tsconfig*.json` files are read. This matches the plan's TS/JS row. A root tsconfig that `extends` a package or a nested file is a gap (`extends-not-read`), not a silent guess.
- **D4: `tsconfigPaths` parameter kept.** It stays on `buildGraph`, and caller paths take precedence. Its only production caller passes `undefined`, and 32c (Lane H) removes the parameter from there.
- **D5: a superseded build.** A build superseded while its manifests are read now returns its parsed nodes without edges. Before, an awaited superseded build linked anyway. It is never published in either case, so this changes nothing a reader can observe.

## Out-of-scope observations

- In this worktree's `batches.md`, the Batch 32a heading still reads `— PENDING` although 32a is committed (`a5632f1bb`). It was left untouched.
- The TS/JS import decoder emits a second, bare-`source` record for every named or default import (see the existing benchmark comment). A bare specifier therefore counts twice in `external`. This predates 32b and was not changed, to keep `imports` byte-identical.
- Batch 27's `language-honesty` matrix has no key for re-export edges. 32b does not activate a key (no activation fragment), because TS/JS `graphEdges` keys already exist and `referenceScopeComplete` stays `false`.

## Fix round (review r1)

Source: `reviews/batch-32b-code-logic-review-r1.md` (REVISE 4/10), User Decision 24, one round. Paths below are relative to `libs/backend/workspace-intelligence/src/ast/`. No git state was changed, and Prettier was run only on changed files.

### Structure

`resolver-context.ts` would have grown to about 700 lines, so its two new responsibilities moved into their own files:

- `import-resolution/manifest-reader.ts` (new): bounded, identity-checked, cancellable reading of one manifest. `MANIFEST_LIMITS` and the `ManifestFileSystem` / `ManifestHandle` seam live here.
- `import-resolution/tsconfig-mapping.ts` (new): effective root-tsconfig options with `extends` semantics.
- `import-resolution/resolver-context.ts` now orchestrates reading, `package.json` handling and JSONC parsing.

No compatibility re-exports were kept; the spec imports from the new modules.

### Findings → fixes → regression tests

1. **R32B-01 (Blocking), tsconfig inheritance.** `mapRootTsconfigs` builds each root config's effective `baseUrl` and `paths`:
   - an `extends` list applies in order, and the child overrides it;
   - `paths` and `baseUrl` are replaced whole;
   - a config extended by another root config is superseded and not applied on its own.

   The remaining top configs are independent. Where they map the same pattern differently, or declare different `baseUrl`s, that pattern (or the `baseUrl`) is left out and a new `conflicting-configs` gap is added, so the context is partial. A top config that maps nothing, such as an Nx references-only `tsconfig.json`, conflicts with nothing. An extends cycle is disclosed (`manifest-unparseable`).

   Tests:
   - `resolver-context.spec.ts` › "tsconfig extends semantics (R32B-01)":
     - "applies the child paths over the inherited baseUrl"
     - "lets a child that overrides paths replace the parent mapping"
     - "applies an extends list in order, the later entry winning"
     - "discloses independent configs that map a module differently, using neither"
     - "discloses independent configs with different baseUrls"
     - "uses independent configs that agree, or map different modules"
     - "discloses an extends cycle"
   - `dependency-graph.service.spec.ts` (the reviewer's on-disk scenario):
     - "resolves an alias through the overriding child tsconfig, not the base" (main → `new.ts`; `old.ts` has no dependents; clean)
     - "discloses independent root tsconfigs that map an alias differently" (no edge; partial; not clean)
2. **R32B-02 (Blocking), local packages.** The context keeps dependency specifications.
   - `file:`, `link:`, `portal:`, `workspace:` and path specifications go into `localPackages`. A `file:`/`link:` path inside the root is recorded with its directory; `workspace:*` and paths outside the root have no directory.
   - A package declared local in any dependency field is never placed in `externalPackages`.
   - The resolver resolves a local package, or a subpath of it, through its directory (index probes; `main`/`exports` are not read). A local package it cannot locate is `unresolved-internal`, never external.

   Tests:
   - `resolver-context.spec.ts` › "keeps local package specifications internal, with their directory"
   - `ts-js-import-resolver.spec.ts` › "local packages" (3 tests)
   - `dependency-graph.service.spec.ts`:
     - "links a file: dependency to the local package, not to an external" (the reviewer's `file:./packages/local` fixture: an edge to `packages/local/index.ts`, `external: 0`)
     - "never reads a workspace: dependency it cannot locate as clean"
3. **R32B-03 (Blocking), the check/open race.** The flow is:
   1. `realpath` of the manifest path; it must be inside the root's real path.
   2. `stat` of the real path.
   3. `open` the file.
   4. `handle.stat()`: it must be a regular file with the same `dev` and `ino`.
   5. `realpath` of the path again: it must equal the first real path and still be inside the root.

   Any mismatch adds the new `manifest-changed` gap, and the content is not used. Every decision and the read itself use that one handle, which is always closed.

   Tests (`resolver-context.spec.ts` › "manifest identity (R32B-03)"):
   - "rejects a real junction swap between the lookup and the open": a real file system under the OS temp dir. The injected `stat` delegates to the real stat, then renames the root and replaces it with a junction (a directory symlink off Windows) to an outside `tsconfig.json`. Result: `['manifest-changed']`, and the outside `@outside` rule is not admitted.
   - "rejects a file swapped between the lookup and the open" (injected).
   - "rejects a path that resolves outside the root after the open" (injected).
   - "reads a stable manifest (control)".
   - The stable-link test "does not read a manifest whose real path leaves the root" is kept, and now also asserts that nothing is opened.
4. **R32B-04 (Serious), physical bounds.** The read goes through the handle into a buffer of `min(maxFileBytes, remaining budget) + 1` sentinel byte. Every byte read is charged to the total, whether the content is accepted, rejected as not text, or unparseable. Before each manifest the budget is checked, and once it is spent `manifests-over-total` is disclosed and reading stops. A stat above either limit is rejected without opening the file.

   Tests (`resolver-context.spec.ts` › "bounds"):
   - "charges rejected (NUL) manifests to the 2 MiB budget": 12 × 250 KiB NUL files. Physical bytes ≤ 2 MiB (8 × 256,000), gaps `['manifest-not-text', 'manifests-over-total']`.
   - "bounds the read of a manifest that grew after its stat": an endless handle; exactly `maxFileBytes + 1` bytes are read, then `manifest-too-large`.
   - "stops reading at 2 MiB in total" now asserts the physical bytes.
   - "does not open a manifest over 256 KiB".
5. **R32B-05 (Moderate), escaped module strings.**
   - New `moduleStringValue(node)` in `export-extraction.ts` decodes a string node's fragments and escapes with the existing `decodeEscapeSequence` (`\uXXXX`, `\u{…}`, `\xNN`, simple and legacy escapes, line continuation), with no eval.
   - It is used for every source-bearing `ExportInfo` (named, `*`, `* as ns`, `export import = require`) and for `reExportSources`, so both channels carry the same decoded value and `dependenciesOf` deduplicates them.
   - A node whose children were not converted keeps its unquoted text.
   - The TS/JS import decoder is unchanged, so import output stays byte-identical. `ExportInfo.source` changes only for escaped input.

   Tests:
   - `ast-analysis.service.spec.ts` › "%s: escaped re-export module strings are decoded" (typescript, javascript): empty, named, star and namespace clauses, plus an escaped quote and a line continuation, in both channels.
   - `dependency-graph.service.spec.ts` › "links a re-export reported by both channels once" (`unresolvedInternal: 0`).
6. **R32B-06 (Moderate), cancellation during lookup.** `readManifest` receives `isCurrent` and re-checks it after the first `realpath`, after `stat`, after `open`, after `handle.stat`, after the second `realpath`, and before every chunk read. A superseded build returns `superseded` without further I/O (the bytes already read are still charged), and the context builder returns `undefined`.

   Tests (`resolver-context.spec.ts` › "generation checks and yielding"):
   - "opens nothing once the build is superseded during the stat": `open` is never called, 0 bytes read.
   - "stops reading once the build is superseded": the build is superseded during `open`; one open, 0 bytes read.

### Changed paths in this round

- New: `import-resolution/manifest-reader.ts`, `import-resolution/tsconfig-mapping.ts`.
- Modified:
  - `import-resolution/resolver-context.ts`: rewritten around the two new modules; `externalPackages` and `localPackages` replace `declaredPackages`; new gaps `manifest-changed` and `conflicting-configs`.
  - `import-resolution/ts-js-import-resolver.ts`: local packages.
  - `import-resolution/resolver-context.spec.ts`: rewritten on an open/handle in-memory file system that counts physical bytes, plus the real-file-system swap test.
  - `import-resolution/ts-js-import-resolver.spec.ts`
  - `dependency-graph.service.spec.ts`
  - `ast-analysis.service.ts`, `ast-analysis.interfaces.ts` (doc) and `ast-analysis.service.spec.ts`
  - `export-extraction.ts` (outside the batch list; the `ExportInfo` source fallback named in R32B-05 lives there).
- `dependency-graph.service.ts` is unchanged in this round.

### FB note

The failing scenarios are the reviewer's own probes in the r1 review. The new regressions encode them directly, but I did not re-run them against the pre-fix source in this round.

### Verification (fix round)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache --output-style=static`
  - Result: "Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence".
  - Test Suites: 63 passed, 1 skipped (64). Tests: 1974 passed, 10 skipped (1984).
  - Lint: 0 errors, 64 warnings, the same count as before the round; none is in a new or changed import-resolution, export-extraction or analysis file.
- `node_modules/.bin/nx run-many -t=test,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: "Successfully ran targets test, typecheck". Test Suites 77/77; Tests 2430/2430.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `npx nx run degradation-audit:lint --skip-nx-cache`: "TOTAL 300 unsuppressed site(s)". No catch returns a literal, and no marker was added.
- Extra checks:
  - `nx run-many -t=typecheck -p ptah-electron ptah-cli`: succeeded for 2 projects.
  - `nx test ptah-electron --testFile=electron-ide-capabilities`: 110/110 passed.

### Remaining limits (disclosed, not hidden)

- A local package's `main` or `exports` entry is not read: only its directory index and its subpaths are probed. A miss is `unresolved-internal`, which the coverage discloses.
- Which of several independent root tsconfigs governs a file is not modelled. Conflicting mappings are dropped and disclosed as `conflicting-configs`, not guessed.
