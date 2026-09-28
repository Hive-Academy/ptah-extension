Verdict: APPROVE
Score: 9/10

# Batch 32c code-logic review (r1) — drop the dead tsconfig parameter

Reviewed the uncommitted diff against base `082a0c15b`: `dependency-graph.service.ts` (+ spec), `resolver-context.ts` (+ spec), `analysis-namespace.builders.ts` (+ spec), `protocol-dispatcher.spec.ts`, `mcp-contract.bench.spec.ts`, `language-honesty.contract.spec.ts`, and the one-line `batches.md` status change. For this review I re-ran both affected suites: `analysis-namespace.builders.spec.ts` **101/101 passed**; `dependency-graph.service.spec.ts` + `resolver-context.spec.ts` **140 passed, 1 skipped**.

## Findings

**R32C-01 — Minor — libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts:1361-1368**
The new spec re-implements the throw-away-root scaffolding (`mkdtempSync` → `realpathSync` → backslash-replace → write `tsconfig.json`) that already exists as `tempRoot` in `dependency-graph.service.spec.ts:1774`, under a different prefix (`ptah-32c-` vs `ptah-32b-`). Failing scenario: none today — both suites pass and both clean up after themselves. It is a drift risk only: a future change to the root-fixture convention (e.g. a `package.json` becomes required at the root) must be applied in two files in two projects, and the namespace-level copy can silently keep testing a weaker fixture.

**R32C-02 — Minor — libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts:1404-1407**
The new spec pins `coverage.resolution` to `{ external: 0, unresolvedInternal: 0 }` but does not pin `context`/clean-ness. Concrete scenario: a regression that still resolves the alias (edgeCount 1, `getDependents` correct) but misclassifies the tsconfig read as a gap — coverage flips to `context: 'partial'` with a `resolver-context-partial` approximation — would stay green in this spec; only the workspace-intelligence specs would catch it. The spec's stated purpose (an alias import still becomes an edge without the parameter) is fully covered, so this is a scope note, not a defect.

**R32C-03 — Minor (informational) — libs/backend/workspace-intelligence/src/ast/import-resolution/resolver-context.spec.ts:137-148**
The old test's first expected row pinned the caller-rules-first precedence order. That ordering is gone with the `callerPaths` option, so nothing production-facing is now untested; ordering across multiple root tsconfigs remains pinned at `resolver-context.spec.ts:260` and `:291`. No action needed; recorded so the dropped assertion is a visible decision, not an accident.

## Check 1 — No behaviour change / remaining callers

Clean. Repo-wide search (`libs/` + `apps/`) for `buildGraph(`, `callerPaths`, and `buildResolverContext(`:

- The only production caller of `DependencyGraphService.buildGraph` is `analysis-namespace.builders.ts:530`, now passing `(files, root, discoveredFiles, options)` — the positional `undefined` is gone and nothing shifted.
- `protocol-dispatcher.ts:2784` calls the _namespace_ API (`ptahAPI.dependencies.buildGraph(files, root, discovered, {...})`), whose signature (`types.ts` / builders line 518) is `(filePaths, workspaceRoot, discoveredFiles?, options?)` — unchanged by this batch.
- No remaining caller passes a real value into the removed plumbing: `callerPaths` has zero matches repo-wide; `buildResolverContext` is called only by the service (no `fileSystem`/`callerPaths` extras) and its own spec.
- Every other `.buildGraph(` site (service spec, dispatcher spec, bench spec, language-honesty spec, `export-disclosure.integration.spec.ts:144`, `electron-ide-capabilities.spec.ts` six 2-arg calls) was checked line-by-line in the diffs: `undefined`/`{}` third-slot arguments were removed, numeric third arguments correctly moved from slot 4 to slot 3 (`discoveredFiles`), and nothing passes an object into the now-`number` slot (TypeScript rejects that; the executor's `test,lint,typecheck` runs for both projects plus ptah-cli typecheck passed).

## Check 2 — Spec assertions

No assertion was weakened, deleted, or loosened. Compared old vs new for every changed spec:

- Service spec "tsconfig path aliases" (2 tests) and the "counts external and unresolved internal imports" test: identical expectations, only the mechanism changed (same `paths` values now written into an on-disk root `tsconfig.json`; `toEqual({external: 1, unresolvedInternal: 2, truncatedImports: 0, edgeCapHit: false, context: 'partial'})` and the no-tsconfig half `{external: 3, unresolvedInternal: 1, ...}` + `approximations: ['resolver-context-partial']` byte-identical).
- `it.each` "never certifies resolution": data rows, branches (`unresolvedInternal 1/external 0` vs `external 1, context: 'partial'`) and `isCleanAnswer(languages) === false` all unchanged.
- Mock-index expectations shifted correctly (`slice(2)` drops one leading `undefined`; `[4]` → `[3]`).
- `protocol-dispatcher.spec.ts`: only the dead `undefined` removed; assertions untouched.
- `resolver-context.spec.ts`: only the `callerPaths` expected row was removed — the removed behaviour's assertion (see R32C-03).

## Check 3 — The new namespace-builder spec

It genuinely exercises the tsconfig alias path. `analysis-namespace.builders.spec.ts:1360-1411` creates a real temp root on disk with a real `tsconfig.json` (`paths {"@app/*": ["src/*"]}`) and a real `DependencyGraphService`; only `AstAnalysisService`/`FileSystemService`/`Logger` are mocked. Crucially, the mocked `FileSystemService.readFile` cannot feed the alias: `buildGraph` passes no `fileSystem` to `buildResolverContext`, which defaults to `NODE_MANIFEST_FILE_SYSTEM` (real node fs, `resolver-context.ts:131`), so the tsconfig is read from disk exactly as in production. If alias resolution broke, `@app/util` is a bare specifier with no `package.json` in the temp root (not provably external), not relative, no `baseUrl` — it cannot become an edge, so all three assertions fail (`edgeCount: 1`, `getDependents(util) === [consumer]`, `unresolvedInternal: 0`). Corroborated by the passing sibling tests over real on-disk tsconfigs (non-matching `paths` → no dependents; no tsconfig → `external: 3`). The suite ran green in this review (101/101).

## Check 4 — Temp directories

All removed. New namespace spec: `try/finally` + `fs.rmSync(root, {recursive: true, force: true})` (lines 1364/1408-1410). Rewritten service-spec helpers (`aliasBuild`, `pathsRoot`) push roots into a `roots[]` cleaned by `afterAll` in both describes (lines 188-192, 883-886); `afterAll` runs even when a test fails. `resolver-context.spec.ts`, bench and dispatcher specs create no temp dirs. Matches the established Batch 32b pattern.

## Check 5 — Unrelated changes

None. Every modified file is inside the batch's justified footprint. The footprint expansion beyond the batches.md scope (service signature + `callerPaths` option + every positional-arg spec) is forced — the parameter is positional, so the caller could not drop its `undefined` without the signature change, and `callerPaths` became dead — and is documented in the executor report's Deviations. `batches.md` is the single status-line change. The prettier-collapsed multi-line calls in the dispatcher/builder specs are exactly the lines whose arguments were removed, not a reformat. The untracked files (`code-logic-review.md`, `research/diagnostics-worktree-repro.ts`, `reviews/lane-a-closing-review-30k.md`) belong to other lanes and are untouched by this diff.
