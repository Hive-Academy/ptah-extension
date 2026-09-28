# Batch 29b executor report — tsx, atomic

Worktree `task-559-mcp-tool-contract`, base HEAD `f5fbec072` (29a2). No git commands that change state were run. The
working tree is left dirty for the team leader. `batches.md` shows as modified in this worktree, but this batch did not
edit it; it was changed by someone else.

## What changed

### Task 29b.1: `tsx` id, module, outliner, manifest, fragment

- `WI/ast/ast.types.ts`: `SupportedLanguage` gains `'tsx'`.
- `WI/ast/languages/tsx.language.ts` (new): `.tsx` uses `tree-sitter-tsx.wasm`. It reuses `TYPESCRIPT_LANGUAGE.queries`
  unchanged, because the TSX grammar is the TypeScript grammar plus JSX.
  - Capabilities: outline, enrichSummary, codeIndex and `graphEdges: FILE_EDGES`.
  - `publicSymbols` is derived from the export query.
  - `definitionFallback: false`, because Electron's `declarationLanguage` still answers `.tsx` as unresolved.
  - `syntaxDiagnostics: false`, because the TS compiler already covers `.tsx`.
- `WI/ast/languages/index.ts`: adds the `tsx` entry.
- `typescript.language.ts`: extensions are now `['.ts']`, and its header comment is updated.
- `languages/types.ts`: comment updated.
- `language-registry.ts`: the `tsx: []` placeholder is removed. It would no longer compile, because
  `Exclude<LanguageId, SupportedLanguage>` no longer contains `tsx`.
- `WI/ast/tsx-grammar.integration.spec.ts` (new, 10 tests, real WASM), following the C# precedent. It checks:
  - the wiring: map, grammar file, registry grants, and no Electron fallback claim;
  - that a JSX parse is `ok` with 0 error nodes, while the TypeScript grammar is `recovered` on the same text (contrast);
  - that the queries find the function, arrow and generic-arrow components, `render`, the class component and every
    export kind;
  - that imports are identical to the TypeScript grammar's output.
- `MCP/mcp-core/code-outliner.adapter.ts`: adds `OUTLINE_QUERIES.tsx`. It shares `TS_OUTLINE_QUERIES` with `typescript`.
  The header is updated.
- `code-outliner.adapter.spec.ts`:
  - New real-grammar FB test "tsx outline not refused". It checks the hints `.tsx`, `tsx` and `src/App.tsx`, the exact
    body spans and the focus.
  - The old ".tsx returns null" test now forces JSX onto `typescript` and still expects a refusal.
  - Three new hint-resolution cases.
- `scripts/tree-sitter-grammars.json`: `tsx` is `active: true`.
- `scripts/copy-wasm.js --self-test`: the "activating a row copies it" probe used `tsx`, which is now already active, so
  the probe proved nothing. It now uses `java`.
  - `--self-test` PASS.
  - `--list` now includes `wasm/tree-sitter-tsx.wasm`.
  - The Electron, CLI and VSIX verifiers and `publish-cli.yml` read the manifest and have no hard-coded tsx, so they are
    unchanged.
- `WIT/matrix/activations/b29b.ts` (new): `parse:tsx`, `outline:tsx`, `codeIndex:tsx`, `enrichSummary:tsx`. There are no
  approximations. `required-keys.ts` is not edited.
- Every activated key has a check that runs:
  - `language-honesty.contract.spec.ts` `HONESTY_CHECKS` gains:
    - `parse:tsx`: a clean TSX parse, with a TypeScript-grammar contrast.
    - `codeIndex:tsx`: the real `CodeSymbolIndexer` indexes `Badge` and `Card`, with coverage analyzed 1 / unsupported
      0 / failed 0.
    - `enrichSummary:tsx`: the real service summarises the file, and load-time JSX falls back with
      `unsupported-declarations`.
  - `outline:tsx` goes into `CHECKED_ELSEWHERE`. The outliner lives in vscode-lm-tools, and the layering rule forbids
    importing it here.
  - `mcp-language-coverage.spec.ts`: `CHECKED_ELSEWHERE_KEYS` and `MCP_HONESTY_CHECKS` gain `outline:tsx`
    (`tsxOutlineHonesty`: real outliner and grammar, exact spans, TypeScript-grammar refusal as contrast). The literal
    sync test is updated, and real-WASM shims are added.

### Task 29b.2: Enrichment gate and removal of the `.tsx` alias

- `context-enrichment.service.ts`: the gate is now
  `language === undefined || !hasCapability(language, 'enrichSummary')`. It was a hard-coded TS/JS check. The docs are
  updated.
- The Decision 13 refusals are unchanged: `unsupported-declarations`, `parse-failed`, `no-declarations`,
  `summary-not-smaller`, and so on.
- `WI/context-analysis/enrich-language.ts` (see Plan deviations for why this file):
  - The `.tsx` refusal (`TSX_EXTENSION`) and the hard-coded TS/JS guard are deleted.
  - `isEnrichLanguage` is now "a parsed language with `enrichSummary`" (registry).
  - `.tsx` now infers `tsx`.
  - Explicit `tsx` is accepted, and an explicit summary language still wins.
  - The `.mts/.cts/.mjs/.cjs` module-flavour alias is kept, because it serves working TS/JS enrichment.
- `analysis-namespace.builders.ts`:
  - The comment is updated: `.tsx` now infers `tsx` instead of being refused.
  - The pre-existing unused `EXTENSION_LANGUAGE_MAP` import is removed (lint warning).
- `context-enrichment.service.spec.ts` gains a `TSX (Batch 29b)` block:
  - "tsx declaration file summarises" (FB);
  - "falls back with its reason when the TSX file runs JSX at load time" (`unsupported-declarations`);
  - "explicit and inferred language agree for a .tsx file". It checks the `resolveEnrichLanguage` result and that the
    summaries are identical.
  - The B1 test (JSX with explicit `typescript` gives `parse-failed`) is kept.
- `analysis-namespace.builders.spec.ts`:
  - Inference now expects `.tsx`/`.TSX` → `tsx`.
  - New tests: "explicit tsx and the .tsx inference agree" and "ignores an unsupported explicit value", now with
    `typescriptreact` → `tsx`.
  - New describe **"ptah_context_enrich_file on .tsx through the real dispatcher"**. It uses the real
    `handleMCPRequest`, the real `buildContextNamespace`, the real `ContextEnrichmentService` and the real TSX grammar.
    It checks three things:
    - the declaration file comes back `structural`;
    - explicit `tsx` and the inferred language give the same answer;
    - load-time JSX falls back with its reason, with `content` as the last key.
  - The graph `supportedLanguages` literals now include `tsx`.

## Fails-before evidence (base `f5fbec072`, before any production edit)

I wrote the specs first and ran them against unmodified production code.

With the normal configuration, all three WI suites fail to compile. For example:

```
TS2345: Argument of type '"tsx"' is not assignable to parameter of type 'SupportedLanguage'
```

A temporary out-of-repo Jest config (the same config with `diagnostics: false`) was used to show the behaviour:

- WI: 17 failed / 87 passed. The failures include:

  ```
  ● … TSX (Batch 29b: the TSX grammar) › tsx declaration file summarises
      Expected: "structural"   Received: "full"
  ```

  The other failures are the `parse:tsx`, `codeIndex:tsx` and `enrichSummary:tsx` honesty checks, the registry-grant
  test, and all 10 `tsx-grammar.integration` tests.

- vscode-lm-tools: 12 failed / 142 passed. The failures include:

  ```
  ● … tsx outline not refused …   - "refused": false  + "refused": true   (hint ".tsx")
  ● MCP_HONESTY_CHECKS … outline:tsx   Error: the .tsx outline was refused
  ```

  The real-dispatcher test "a TSX file that runs JSX at load time falls back with its reason" also fails: the base
  answered `unsupported-language`. So do the `.tsx` inference and hint tests.

After the change, all of these pass (counts below). The FB runs on base double as the sabotage proof for each new
honesty check: each one throws while its capability is absent.

## Verification (after)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`
  passes: "Successfully ran targets test, lint, typecheck for 2 projects".
  - vscode-lm-tools: Test Suites 77 passed / 77; Tests 2341 passed / 2341.
  - workspace-intelligence: Test Suites 56 passed / 56; Tests 1721 passed, 1 skipped (1722).
  - Lint: 0 errors, warnings only. The changed files add no new warnings; the remaining ones are pre-existing lines.
- `nx run-many -t=test -p @ptah-extension/rpc-handlers` gives Test Suites 111 passed, 1 failed (112); Tests 3275 passed,
  1 failed, 4 skipped. The only failure is the known flake `harness-skill-selection` › "never writes state.json" (see
  Plan deviations for the mock fix).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` passes (2 projects).
- `nx run ptah-electron:test` gives Test Suites 54 passed, 1 skipped; Tests 927 passed, 3 skipped.
- `nx run ptah-electron:lint` passes.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json
  dependencies." The new fixtures use relative imports only.
- `nx run degradation-audit:lint --skip-nx-cache`: TOTAL 300.
- `node scripts/copy-wasm.js --self-test` PASS.
- `ptah-core-prompt.ts` and the `NATIVE_AGENT_TOOL_POLICY` files show an empty `git diff`.
- Prettier is clean on every changed file except `ast.types.ts` and `electron-ide-capabilities.spec.ts`. Both already
  fail `prettier --check` on HEAD, and I left their formatting untouched.

## Tool descriptions (24c budgets)

The registry-generated lists grew by `tsx` for parse, outline, codeIndex, enrichSummary, publicSymbols, graphEdges and
the diagnostics type-check set. `ptah_code_search_symbols` went from 699 to 709 characters, over its 702 pin. I
shortened the wording rather than raise the pin: the leading "Search " is dropped, so the text now reads "SQLite code
index (BM25+vector); beats Grep. …". The tool name still says search, and every required item the spec checks is kept.
It measures 702, the pin is unchanged, and the sweep passes. No other per-tool budget or the `tools/list` total was
exceeded.

## Plan deviations (files outside the 12 listed; each is a direct consequence of the atomic union)

1. **`WI/context-analysis/enrich-language.ts`**. Since Batch 20 r1, the `.tsx` alias and refusal live here, not in
   `analysis-namespace.builders.ts`: `resolveEnrichLanguage` was extracted. Deleting them here is the task.
2. **`WI/ast/language-registry.ts` and `language-registry.spec.ts`**. The exhaustive `Exclude<>` record had to drop
   `tsx`. The spec's pinned lists ("update in the batch that changes them") now include `tsx`, and the
   "keeps .tsx on typescript until 29b" test became "gives .tsx its own tsx grammar".
3. **`WIT/language-honesty.contract.spec.ts` and `MCP/mcp-core/mcp-language-coverage.spec.ts`**. Every activated key
   needs a check that runs (Batch 27 harness, team-leader instruction).
4. **Registry-list literals that gained `tsx`**:
   - `dependency-graph.service.spec.ts`
   - `graph-coverage.spec.ts`
   - `code-symbol-indexer.service.spec.ts`
   - `code-namespace.builder.spec.ts`
   - `protocol-dispatcher.spec.ts`
5. **`tool-description.builder.ts`**: the budget trim above.
6. **`apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`**:
   - The `.tsx` report's `language` is now `'tsx'`, where it was `'typescript'`.
   - The narrowing-gate tests now also grant `mockScopeComplete` for `tsx`, because `tsx` is now its own graph
     language.
   - Production Electron code is untouched.
7. **`scripts/copy-wasm.js`**: the self-test probe row changed from `tsx` to `java`, as noted above.
8. **`libs/backend/rpc-handlers/src/test-utils/heavy-module-mocks.ts`**. Six rpc-handlers suites failed to load:
   - Cause: vscode-lm-tools calls `recognisedSourceExtensions()` (since 23b, `analysis-namespace.builders.ts:397`) and
     `supportedLanguagesFor()` (24c descriptions) at module load, and the WI mock lacked both.
   - This predates the batch: neither the call nor the mock changed here.
   - Fix: I added two stubs, following the "mocks must keep up" instruction.

## Out-of-scope observations (not changed)

- The dispatcher never passes a `languageHint` to `applyToolResultBudget`, so over-budget code responses never reach
  the outliner through dispatch ("no language hint"). The outline is therefore proved through the real adapter and
  grammar, and the harness's `outline:tsx` check. Enrich is proved through the real dispatcher.
- Electron `declarationLanguage` still refuses `.tsx`, and its comment ("`.tsx` has the claim through TypeScript") is
  now stale. The tsx grammar would let the definition fallback cover `.tsx`, but `definitionFallback:tsx` is not a
  required key.
- `ast-namespace.builder.spec.ts` mocks `EXTENSION_LANGUAGE_MAP` with `'.tsx': 'typescript'`. Its "24c parse honesty
  (.tsx with JSX)" block still passes, but it now describes a mapping production no longer uses.
- `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` were already untracked before this batch.

## Fix round (review r1)

Source: `reviews/batch-29b-code-logic-review-r1.md` (REVISE 5/10). I fixed all three findings, and each has a
regression spec that failed before the fix. No git commands were run. The only probes were Jest temp roots under
`os.tmpdir()`.

### R29b-01 (Blocking): Electron reference filter used the TypeScript grammar for `.tsx`

- Fix, in `apps/ptah-electron/src/services/electron-ide-capabilities.ts`:
  - `extToLanguage` now reads the shared `EXTENSION_LANGUAGE_MAP`, keeping an explicit `.mts/.cts/.mjs/.cjs`
    module-flavour alias. `.tsx` therefore selects `tsx`.
  - `COMMENT_STRING_QUERIES.tsx` is added. In the TSX grammar, JSX text is neither a string nor a comment node.
  - `declarationLanguage` now returns a language only when this scan has a declaration query for it. `.tsx` stays
    unresolved, which matches the registry: `definitionFallback` is not claimed for tsx.
  - `resolveImportedModule` shares the lookup, so it now parses `.tsx` cursor files with the TSX grammar.
- Other consumers audited:
  - Graph, code index, AST namespace and diagnostics already read the shared map (the review confirms this).
  - One more grammar selection was found: `WI/composite/workspace-analyzer.service.ts` `extractCodeInsights` hard-coded
    `.tsx` → `typescript`. It now selects `tsx`.
  - The other `.tsx` literals (quality rules, display names, glob lists) select no grammar.
- Regression spec: `electron-ide-capabilities.spec.ts`, describe "Batch 29b r1 R29b-01".
  - The review's exact case `<div>"{needle}"</div>`, plus its `// {needle}` and `/* {needle} */` variants, go through
    the public `getReferencesReport` with the real grammar.
  - Fails-before: all three variants failed on the unfixed code; the report was missing the line-1 location.
  - Contrast test: a real comment and a real string in a `.tsx` file are still excluded.
- `workspace-analyzer.service.spec.ts`: the `.tsx` expectation changed to `tsx`. Fails-before on the unfixed code:
  expected "tsx", received "typescript".

### R29b-02 (Serious): tool results never reached the outliner

- Budget layer: `ApplyToolResultBudgetInput.languageHint` is new and is passed to `reduceOutput`, next to `hint` and
  `outliner` (`tool-result-budget.ts`).
- Dispatcher (`protocol-dispatcher.ts`):
  - `createToolSuccessResponse` and `budgetToolText` carry `languageHint` through.
  - Trustworthy source of the hint: a new optional `execute_code` argument, `resultLanguage` (id or extension, e.g.
    `"tsx"`, `".py"`).
    - It is the caller's declaration about the returned text. It is never inferred from the executed code or from the
      producer.
    - It applies only when the sandbox returned a string. An object result is serialised JSON, whatever the caller said.
    - It is then budgeted with `hint: 'code'` and that language.
    - Validation at the boundary: a present value that is not a non-empty string of at most 32 characters is refused
      with `-32602`.
- Schema:
  - `resultLanguage` is added to the `execute_code` input schema (`tool-description.builder.ts`).
  - The `ExecuteCodeParams` type gains `resultLanguage?: unknown`.
- Reducer names stay honest, because the trailer names the reducer that ran:
  - an outlined result says `code-outline`;
  - a result without the argument keeps its previous reducer.
  - The Batch 21 sweep passes unchanged, including the `execute_code` description pin (567) and the `tools/list` total.
    Its reducer-name expectations did not need to change.
- Regression spec: `mcp-language-coverage.spec.ts`, describe "outline:tsx through the real dispatcher (Batch 29b r1
  R29b-02)". It drives the real `handleMCPRequest` → `execute_code` → budget → real `TreeSitterCodeOutliner` → real TSX
  grammar, with a temporary spool root.
  - The test asserts:
    - the trailer reducer is `code-outline`;
    - `FirstDeclaration`, `MiddleDeclaration` and `LastDeclaration` are all kept;
    - the spool file equals the raw text byte for byte.
  - Contrast: without `resultLanguage` the result is not outlined (spool still byte-equal).
  - Negative: `resultLanguage: 42` returns `-32602`.
  - The `outline:tsx` honesty check (`MCP_HONESTY_CHECKS`) now also requires the served path, not only the adapter.
- Fails-before: with only the `languageHint` forwarding removed from `tool-result-budget.ts` (a temporary probe, then
  restored), both the new test and the `outline:tsx` honesty check fail with `Expected "code-outline"`,
  `Received "code-fallback:log-reduced"`.
- Not changed: `ptah_context_enrich_file` full-content answers are a JSON envelope. Outlining the `content` field inside
  that envelope would change its wire format, so its over-budget text still takes the JSON reducer, which keeps
  `mode`/`reason` and spools the raw text.

### R29b-03 (Moderate): the enrich description still excluded TSX

- Fix, in the `ptah_context_enrich_file` description and schema:
  - "(not .tsx)" is removed.
  - "'unsupported-language' (another language, or .tsx)" became "(another language)".
  - The language argument now says ".tsx → tsx" instead of ".tsx is not summarised".
  - The `unsupported-declarations` reason now names "JSX rendered at load time", the load-time refusal a TSX file can
    still get.
  - The text got shorter; the 1175 pin holds.
- Regression spec: `tool-description.builder.spec.ts`, "ptah_context_enrich_file tells callers .tsx is summarised as
  tsx (Batch 29b r1 R29b-03)". It failed before the fix: the description contained "(not .tsx)".

### Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`:
  "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on".
  - vscode-lm-tools: 77/77 suites, 2345/2345 tests.
  - workspace-intelligence: 56/56 suites, 1721 passed, 1 skipped.
  - ptah-electron: 54 passed, 1 skipped; 931 passed, 3 skipped.
- rpc-handlers: 111 passed, 1 failed (112 suites); 3275 passed, 1 failed, 4 skipped. The only failure is the known
  `harness-skill-selection` › "never writes state.json".
- `ptah-cli` typecheck passes.
- validate-deps: "All external imports are covered".
- Degradation audit: TOTAL 300.
- Prettier is clean on the changed files, except `electron-ide-capabilities.ts`, which already fails the check on HEAD.

Files touched in this round:

- `apps/ptah-electron/src/services/electron-ide-capabilities.ts` and its spec
- `WI/composite/workspace-analyzer.service.ts` and its spec
- `MCP/mcp-core/tool-result-budget.ts`
- `MCP/mcp-core/protocol-dispatcher.ts`
- `MCP/mcp-core/types/mcp-protocol.types.ts`
- `MCP/mcp-core/tool-description.builder.ts` and its spec
- `MCP/mcp-core/mcp-language-coverage.spec.ts`
