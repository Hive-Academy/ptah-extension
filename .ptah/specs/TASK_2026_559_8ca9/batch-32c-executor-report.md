# Batch 32c executor report — drop the dead tsconfig parameter

Base: `fix/task-559-mcp-tool-contract` @ 082a0c15b. Uncommitted.

## Callers found

`ptah_lsp_references` was not in the tool list, so I used Grep over `libs/` and `apps/` (`buildGraph(` and `tsconfigPaths`).

- **Production:** only one caller passes the service's third argument: `analysis-namespace.builders.ts` (`dependencyGraph.buildGraph(..., workspaceRoot, undefined, discoveredFiles, {...})`), and it always passes `undefined`. No other production code calls `DependencyGraphService.buildGraph`. The namespace API (`types.ts` `DependenciesNamespace.buildGraph`) never exposed a tsconfig argument, so `protocol-dispatcher.ts:2784`, the system prompt and `system-namespace.builders.ts` needed no change.
- **Tests:** several specs passed the argument. Most passed `undefined` or `{}`. Four passed real `paths` mappings to inject aliases: two in the service spec's "tsconfig path aliases" tests, one in "counts external and unresolved internal imports", and one in the "a supplied paths object never certifies resolution" test (`it.each`). The bench spec's `buildRealGraph` also had a `tsconfigPaths` parameter, but no call passed it.
- The resolver context's `callerPaths` option (Batch 32b) was fed only by this parameter, so removing the parameter made it dead.

## Changed paths

- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`: removed the `tsconfigPaths` parameter. The signature is now `buildGraph(filePaths, workspaceRoot, discoveredFiles?, options?)`, and the `callerPaths` spread is gone. The doc now says the resolver context reads the root tsconfig.
- MODIFIED `libs/backend/workspace-intelligence/src/ast/import-resolution/resolver-context.ts`: removed the `callerPaths` option and the caller-rule merge. `tsconfigPaths` is now the root tsconfig's effective rules only, and its doc is updated.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`: removed the positional `undefined`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`:
  - Updated the mock-argument index expectations (`slice(2)`, `[4]`→`[3]`).
  - Updated the real-service calls.
  - **New spec:** "buildGraph resolves a root tsconfig alias with no paths argument (real graph service)". It uses a temp root with `tsconfig.json` `paths {"@app/*":["src/*"]}` and calls `ns.buildGraph(['a.ts','src/util.ts'], root)`. It checks for 2 nodes, 1 edge, `getDependents(util) == [a]`, and resolution `external 0 / unresolvedInternal 0`.
- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts`: updated all call sites mechanically, and rewrote the four alias-injection tests to put the same `paths` in an on-disk root `tsconfig.json` (using the existing 32b `tempRoot` helper). Their assertions are unchanged.
- MODIFIED `libs/backend/workspace-intelligence/src/ast/import-resolution/resolver-context.spec.ts`: the "caller paths first" test now covers only the baseUrl-relative tsconfig rule.
- MODIFIED `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`: removed the unused `tsconfigPaths` parameter from `buildRealGraph`.
- MODIFIED `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`: one call site, `{}` removed.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`: three real-service call sites lost their `undefined`. Prettier then collapsed the multi-line calls.
- MODIFIED `.ptah/specs/TASK_2026_559_8ca9/batches.md`: Batch 32c heading status.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: "Successfully ran targets test, lint, typecheck for 2 projects". The protocol-dispatcher flake did not appear.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache`: "Successfully ran target validate-deps for project ptah-electron".
- `npx nx run degradation-audit:lint --skip-nx-cache`: "degradation-audit: TOTAL 300 unsuppressed site(s)", succeeded.
- `node_modules/.bin/nx run ptah-cli:typecheck --skip-nx-cache`: "Successfully ran target typecheck for project ptah-cli".
- Extra check: `nx test ptah-electron --testPathPattern=electron-ide-capabilities` (its spec calls `graph.buildGraph` with 2 arguments): 954 passed, 3 skipped.

## Deviations

- **Footprint:** batches.md scopes Task 32c.1 to the namespace builder and its spec. The parameter is positional, so the caller cannot drop its `undefined` without changing the service signature. With the parameter gone, `ResolverContextOptions.callerPaths` became dead, so I removed it too (replace, don't accumulate). Every spec that passed the positional argument had to change, and TypeScript flagged each one, since `{}` and `undefined` in the third slot no longer type-check against `number`.
- **The "if no other caller passes it" condition:** only specs passed real values. I moved those four tests onto an on-disk root tsconfig, which is the mechanism production now uses, rather than keep a test-only injection point.
- **Overlap with other lanes:** Batch 33 (Python/Go) may touch `resolver-context.ts`, for example to read pyproject. My edit there is small: one option and one block removed.
- `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` are untracked and untouched.
