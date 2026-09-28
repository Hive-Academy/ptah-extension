# Batch 8 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent), 2026-09-26. No git operations were run; batches.md and task.md are unchanged.

## Task 8.1 — Import-resolution fallback in `declarationsFor` — implemented

File: `apps/ptah-electron/src/services/electron-ide-capabilities.ts`

- `declarationsFor` (:247) now takes its candidates from `indexCandidates` (:282), which holds the former index lookup
  unchanged and returns `[]` when there is no reader. With zero candidates it delegates to `declarationsWithoutIndex`
  (:314). With one candidate it returns it. With several it applies the same disambiguation as before (the cursor file
  wins, then the imported module, then all candidates).
- `declarationsWithoutIndex`:
  1. Scans the cursor file content, which is already in memory, for a declaration line (`findDeclaration`, :722).
  2. If that finds nothing, `resolveImportedModule` resolves the identifier's relative import. The existing AST-based
     resolver is reused.
  3. `findModuleFile` (:347) probes `MODULE_FILE_SUFFIXES` with `fs.exists`: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`,
     then the same list as `/index*`.
  4. It reads exactly one resolved file and scans it for the declaration line.
- `resolveDeclaration` no longer returns `[]` early when there is no symbol reader, so the fallback also works when
  SQLite is unavailable. `getHover` still requires the reader.
- Containment: `findModuleFile` returns null unless the module path is strictly inside the workspace root
  (`isInsideDirectory`, :749, which normalises the path and compares Windows drive paths case-insensitively). An
  import like `../../outside/x` never reaches `exists` or `readFile`. Absolute and package specifiers were already
  rejected by `resolveImportedModule`, which only accepts sources starting with `.`. Without a workspace root there is
  no import probe.
- tsconfig path aliases are not in the plan, so they are not resolved and return `[]`. Aliased imports (`{ A as B }`)
  and barrel re-exports (`export * from`) also return `[]` when the index is empty. This is honest and bounded.
- `findDeclaration` has per-language prefixes (`DECLARATION_PREFIXES`, :112):
  - TypeScript: export, default, declare, abstract and async forms of
    `class|interface|type|namespace|module|enum|const enum|const|let|var|function|function*`.
  - JavaScript: the same list minus the TypeScript-only kinds.
  - Python: `def` and `class`.
  - Go: `func` (including receivers), `type`, `var` and `const`.
  - The identifier is regex-escaped and followed by `(?![A-Za-z0-9_$])`, so names ending in `$` still match exactly.
  - The result's column points at the identifier.
- Fixed in the same code path: `stripExtension` (:712) used to strip ANY extension. That turned `./foo.service` into
  `foo`, so the existing multi-candidate disambiguation missed every dotted module name (`*.service.ts`), and the
  import probe had the same problem. It now strips only `MODULE_EXTENSIONS`. This also maps an ESM `./x.js` specifier
  to `x.ts`. A regression spec covers it.
- The file header doc comment describes the fallback.
- Side effect on references: `computeReferenceScope` calls `declarationsFor`. With a built graph and an empty index,
  the fallback's declaration now scopes the scan to that file plus its dependents, where before it did a brute scan.
  An unresolved import still gives `[]`, which still means a brute scan.

Spec: `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`

- New suite `lsp.getDefinition — without the symbol index (TASK_2026_559 Batch 8)`. It uses a real temp fixture tree
  (`mkdtemp`: `ws/src/widget.ts` declares `export class Widget`, `ws/src/consumer.ts` imports it), a real disk fs
  adapter, the REAL `AstAnalysisService` and `TreeSitterParserService`, and a reader whose `searchSymbols` returns
  `hits: []`. The grammar shims are the same two as in `code-outliner.adapter.spec.ts`, as the Electron
  `__mocks__/wasm-bundle-dir.ts` header allows. The cases:
  - The imported class is found (`widget.ts:1:13`), and `readFile` is called exactly twice: the cursor file plus one
    resolved file.
  - The same result with no symbol reader.
  - The ESM specifier `./widget.js` resolves to `widget.ts`.
  - A same-file declaration is found with 1 read and 0 `exists` probes.
  - `../../outside/secret` returns `[]`: 0 `exists` probes, and the outside file is never read.
  - A package import (`tsyringe`) returns `[]` with 0 probes.
- New case `disambiguates through an import of ./foo.service`, the regression test for the `stripExtension` fix.
- The existing multi-candidate, local-wins and imports-cannot-disambiguate cases are unchanged and green. One existing
  test title was reworded ("returns [] with no symbol reader when nothing declares the identifier") because the
  no-reader case now runs the fallback.
- Evidence: `jest -c apps/ptah-electron/jest.config.ts .../electron-ide-capabilities.spec.ts` gives 22 passed. A
  guard that failed to parse would return `[]` and fail, so a pass proves the real AST resolved the import.

## Task 8.2 — Host-accurate LSP tool descriptions — implemented

File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`

- I checked which hosts register the capabilities. `IDE_CAPABILITIES_TOKEN` is registered by the VS Code extension
  (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:126`, where `ide-capabilities.vscode.ts` uses
  `vscode.executeDefinitionProvider` and `vscode.executeReferenceProvider`) and by Electron
  (`apps/ptah-electron/src/di/phase-3-storage.ts:189`). The CLI does not register it, so the tools are not listed
  there (gated on `hasIDECapabilities`).
- `ptah_lsp_references`: every original claim is kept, but scoped to "In the VS Code extension this uses VS Code's
  language server". The desktop mechanism is stated as a name-based scan: word-boundary matches outside strings and
  comments, limited to importing files once the dependency graph is built. The description also says same-named
  symbols can appear and aliased imports are missed.
- `ptah_lsp_definitions`: the original claims (across files, re-exports, `node_modules`) are kept and scoped to the VS
  Code extension. The desktop mechanism is stated as the workspace symbol index, then the cursor file's own
  declarations and its relative imports. The description also says it can return several same-named candidates, and
  that package, path-alias or re-exported symbols may return no location.
- JSDoc for both builders updated. The `ptah_context_enrich_file` block is untouched. `ptah-core-prompt.ts`,
  `ptah-system-prompt.constant.ts` and `NATIVE_AGENT_TOOL_POLICY` are untouched (User Decision 4).

Spec: `tool-description.builder.spec.ts`

- `describe.each` over both tools checks three things:
  - The name, and length < `DESCRIPTION_CHAR_BUDGET` (1,000; both descriptions are about 530-560 chars).
  - No `using VS Code LSP`, and the VS Code clause is present.
  - The desktop clause says "name-based".
- A second suite pins the desktop limits (`workspace symbol index`, `relative imports`, `path-alias`) and checks that
  `node_modules` sits inside the VS Code clause.

## Verification

- `nx run-many "-t=lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools --skip-nx-cache`:
  "Successfully ran targets lint, typecheck for 2 projects".
- `nx run @ptah-extension/vscode-lm-tools:test --skip-nx-cache`: 69 suites and 1653 tests passed. It printed a
  "worker failed to exit gracefully" note, which was already present.
- `nx run ptah-electron:test` (and `jest -c apps/ptah-electron/jest.config.ts --maxWorkers=2`) did NOT pass:
  "Test Suites: 8 failed, 1 skipped, 46 passed; Tests: 765 passed".
  - All 8 suites fail to load with the same error, `Must use import to load ES Module: node_modules/marked/lib/marked.esm.js`:
    `boot-order`, `wire-runtime`, `container.smoke`, `surface-composition`, `bootstrap.network`,
    `webview-manager-adapter`, `ipc-bridge.live-renderer` and `rpc-surface`.
  - These suites reach `tool-output-reducers`, which imports the ESM-only `marked` (added in Batches 2b/2e).
    `apps/ptah-electron/jest.config.ts` lacks the `transformIgnorePatterns: ['node_modules/(?!marked/)']` entry that
    `vscode-lm-tools` and `tool-output-reducers` carry.
  - This batch does not cause it: Batch 8 does not touch module loading or those suites, and Batch 7's verification
    did not run the `ptah-electron` tests.
  - The fix is that one config line, in a file outside Batch 8 ownership. It is left to the team-leader.
- `nx run degradation-audit:lint --skip-nx-cache`: `apps/ptah-electron: 4 ok (baseline 4)`,
  `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, success. No new catch was added. The fallback relies on
  `fs.exists`, which never throws in any provider, and on the existing marked catches in `safeReadFile` and
  `resolveImportedModule`.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered", success.
- `prettier --check` on the 4 changed source files: "All matched files use Prettier code style!".

## Out-of-scope observations

- `apps/ptah-electron/jest.config.ts` needs the `marked` transform (see above).
- `safeReadFile` (existing) logs the file path and the raw error message. It was not changed; it is outside the
  "new catch" rule.
- The cursor file path given to `getDefinition` and `getReferences` is not itself contained to the workspace
  (existing behaviour). Only the new import-resolved read is contained.
- The Electron DI log text `(LSP references/definitions via symbol index)` at `phase-3-storage.ts:203` is slightly
  stale now that there is a fallback. It is harmless and outside the batch.

## Revision round 1

Answers `reviews/batch-8-code-logic-review-r1.md` (REVISE 4/10). Every finding has a regression spec that reproduces the reviewer's case.

### Files

- MODIFIED `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
- MODIFIED `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- MODIFIED `apps/ptah-electron/jest.config.ts`: removed the `transformIgnorePatterns` marked exemption and its comment
- MODIFIED `apps/ptah-electron/tsconfig.spec.json`: removed `allowJs`
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.spec.ts`

### Fix per finding

- **B1 (physical escape).** `findModuleFile` still rejects a lexically outside module before any probe. For the first existing candidate it now canonicalises both the candidate and the workspace root with `realpath`, then checks containment on the canonical forms. The check folds case on a win32 host or a Windows-shaped path, handles the `\?\` prefix, and keeps UNC roots. The fallback reads only a candidate whose real path is inside the real root, and it reads that canonical path. The location it reports is the lexical path. If canonicalisation fails, the import stays unresolved (fail closed). `realpath` is a new last constructor parameter that defaults to `fs.promises.realpath`, so the DI registration in `phase-3-storage.ts` is unchanged. There is still at most one resolved-file content read.
- **B2 (reference narrowing).** `declarationsFor` is now split. `indexedDeclarations` returns index candidates only, and `declarationsFor` calls it and then the index-free fallback. `computeReferenceScope` uses only `indexedDeclarations` and calls `isBuilt(workspaceFolder)`. An empty index therefore always runs the full brute scan, and a graph built for another workspace never scopes the scan.
- **B3 (comment/string declarations).** The line regex (`DECLARATION_PREFIXES` / `findDeclaration`) is replaced by per-language Tree-sitter queries (`DECLARATION_QUERIES`) that run through the injected `TreeSitterParserService` over the content already read. They match only top-level declarations (root children, optionally behind `export`/`declare`) for TS, JS, Python and Go. The queries include an `(ERROR) @error` pattern. A parse error, a failed query or an unsupported language gives `'uncertain'`, and the whole fallback then returns `[]` without resolving imports.
- **M1 (UNC).** `resolveRelative` uses `path.win32.resolve` for drive-letter and `//server/share` paths, which keeps the UNC root, and POSIX for all other paths. `isInsideDirectory` is rebuilt on `comparablePath` with the same win32/posix split.
- **M2 (.d.ts).** The probe order is now the 8 source extensions, then `.d.ts`, then the 8 `index` sources, then `/index.d.ts`.
- **Part B: redundant workaround.** Removed the electron marked transform exemption and `allowJs`. The root `jest.preset.js` mapper covers `marked`. All ptah-electron suites pass (below).
- **M3 (role-resolver fixture).** The fixture's `beforeEach` now creates a local `.ptah/` marker next to `.git/`. The nearest-ancestor walk finds that marker before `%TEMP%/.ptah`. Product code and shared Temp state are untouched. This machine does have `C:/Users/abdal/AppData/Local/Temp/.ptah`, and the suite passes.

### Regression specs (`electron-ide-capabilities.spec.ts`)

- `revision 1 … B1: never reads an import reached through an in-workspace junction that points outside`: a real junction (`ws/linked` → `outside`)
- `B1: never reads an import whose file is a symlink to a file outside the workspace`: a symlinked file, via injected realpath
- `B1: leaves the import unresolved when the target cannot be canonicalised`
- `B2: keeps the full scan for an empty index so global-script references survive`: reproduces the reviewer's `GlobalThing` case
- `B2: does not scope by a graph built for a different workspace`; the existing scoping spec now also asserts `isBuilt('C:/repo')`
- `B3: a declaration inside a block comment is not a definition` (the reviewer's Ghost case), `… commented-out declaration does not shadow the real imported one`, `… inside a template literal …`, `… nested function-local declaration …`, `… file with a syntax error leaves the lookup unresolved`
- `B3: finds a top-level JavaScript / Python / Go declaration by parsing`: checks that each language query compiles against the real grammar
- `M1: UNC workspace roots › keeps the \server\share root when resolving a relative import` and `… rejects a UNC import whose real path is on another share`
- `M2: resolves an extensionless import backed only by a .d.ts file`: also asserts that `.d.ts` is probe #9, after the 8 source extensions

### Known limitation

A `.tsx` file is parsed with the TypeScript grammar because `SupportedLanguage` has no `tsx`. JSX produces ERROR nodes, so the index-free fallback now returns unresolved for `.tsx` cursor and target files. The regex version answered those, but without syntax awareness. The index path is unaffected.

### Degradation audit

One new `catch`, in `canonicalPath`. It carries a `degradation-audit: optional-capability` marker, fails closed, and logs fixed-text debug with no path or error text. The audit is unchanged: `apps/ptah-electron: 4 ok (baseline 4)`, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, TOTAL 300. `cli-agent-runtime` has no baseline entry, so it has 0 unsuppressed sites, and its change is spec-only.

### Verification (from the worktree root)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime --skip-nx-cache --parallel=2`: "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on". Test totals were 64/64 suites (1045 passed, 1 skipped), 69/69 suites (1653 passed) and 54/55 suites (864 passed, 3 skipped, 1 skipped suite). Lint had 0 errors, and its warnings are all pre-existing. ESLint on the three changed TS files reported no findings.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: success, figures as above.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: success.
- `prettier --check` on all 5 changed files: "All matched files use Prettier code style!"

## Bounded correction (round 2 review)

Source: `reviews/batch-8-code-logic-review-r2.md` (REVISE 6/10). This correction covers only S1 (disclosure plus an explicit unresolved result) and M1. Nothing else changed.

### S1: `.tsx` in the index-free fallback

- The packaged TypeScript grammar has no JSX, so valid JSX parses as ERROR. The full fix, a JSX-capable grammar, is out of scope here (see Follow-up).
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts`: the new `declarationLanguage(filePath)` returns `null` for `.tsx` and otherwise delegates to `extToLanguage`. It is used for the cursor file and the resolved import target, so any `.tsx` cursor or target gets an explicit unresolved `[]` and never a wrong location. It no longer depends on whether the file happens to contain JSX. For a cursor file, no parse is attempted and there is one content read. For a `.tsx` import target, the lookup returns before the target read, so no extra content read happens. `extToLanguage` is unchanged, so references and import analysis are unaffected.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`: one sentence was appended to the `ptah_lsp_definitions` description: "Without a symbol-index match, lookups from or into .tsx files return no location." The description stays under the 1,000-character budget. The enrich-file block and the frozen prompt constants were not touched.

### M1: Go type aliases

- `(type_declaration (type_alias name: (_) @name))` was added to the top-level Go declaration query.

### Specs added

`electron-ide-capabilities.spec.ts`, `describe('revision 2 (batch-8-code-logic-review-r2.md)')`, all using the real tree-sitter grammars:

- `M1: finds a top-level Go type alias by parsing`: `package p\ntype Widget = int\nvar value Widget\n` at (2,10) returns line 1, column 5.
- `S1: a .tsx cursor file with %s is unresolved, never a wrong location`, run for the reviewer's two reproductions (`export const Widget = () => <div/>;` and `export class Widget {}\nconst view = <div/>;` at (0,13)) and for a `.tsx` file with no JSX. Each returns `[]` with one read and no parser query.
- `S1: an import that resolves to a .tsx file is unresolved without reading it`.
- `S1: the symbol index still resolves a .tsx definition when it has a hit`: a JSX-containing `.tsx` cursor with an index hit in `widget.tsx:3-5` returns line 3.

`tool-description.builder.spec.ts`: `discloses that the index-free fallback does not resolve .tsx files`.

### Verification (from the worktree root)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`: "Successfully ran targets test, lint, typecheck for 2 projects and 6 tasks they depend on".
- `jest -c apps/ptah-electron/jest.config.ts .../electron-ide-capabilities.spec.ts -t "revision 2"`: 6 passed.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: success. `apps/ptah-electron: 4 ok (baseline 4)`, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, TOTAL 300. No new catch and no new log.
- `prettier --check` on the 4 changed files: "All matched files use Prettier code style!"

### Follow-up (cross-batch, not done here)

Package `tree-sitter-tsx.wasm` and wire a `tsx` `SupportedLanguage`. That touches `copy-wasm.js`, the verify-packed-wasm scripts, the tree-sitter parser service and `SupportedLanguage`. `declarationLanguage` should then map `.tsx` to it, and the description sentence should be removed. The same change also unblocks Batch 2d KI and Batch 7 `.tsx`. Before Batch 8, Electron had no index-free fallback at all, so a `.tsx` lookup with an empty index also returned nothing on main.

Deferred minor from r2 (outside this correction's scope): the `ptah_lsp_references` wording "limited to importing files once the dependency graph is built" should be qualified with "when the index has declarations of the symbol".
