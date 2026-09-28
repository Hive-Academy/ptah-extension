# Batch 29a1 executor report — Language modules (pure move)

Executor: backend-developer sub-agent (fallback executor), worktree `task-559-mcp-tool-contract`, base HEAD `6c91157f2`
(Batch 27). No git state changed.

## Moves (old → new)

| Old location (HEAD `tree-sitter.config.ts` / `language-registry.ts`)                                                                              | New location (`WI/ast/languages/`)                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `LanguageQueries` interface (config :32-41)                                                                                                       | `types.ts` (config re-exports it: `export type { SupportedLanguage, LanguageQueries }`)             |
| `DeclaredCapabilities` type + its "where implemented" comment (registry :88-91, :106-119)                                                         | `types.ts` `DeclaredLanguageCapabilities`, on `LanguageModule.capabilities`                         |
| `RECOGNITION_ONLY_EXTENSIONS` comment (registry :182-190)                                                                                         | `types.ts` `LanguageModule.recognitionOnlyExtensions` doc                                           |
| `JS_TS_FUNCTION_QUERY`, `JS_CLASS_QUERY`, `JS_TS_IMPORT_QUERY`, `JS_TS_EXPORT_QUERY` (config :43-76, :99-314)                                     | `javascript.language.ts` (shared JS_TS_* now `export const`)                                        |
| `FILE_EDGES` (registry :93-104)                                                                                                                   | `javascript.language.ts` (imported by `typescript.language.ts`)                                     |
| `TS_CLASS_QUERY`, `TS_EXPORT_QUERY_SUFFIX` (config :78-97, :316-376)                                                                              | `typescript.language.ts`                                                                            |
| Python queries (config :378-408)                                                                                                                  | `python.language.ts`                                                                                |
| Go queries (config :410-436)                                                                                                                      | `go.language.ts`                                                                                    |
| C# queries (config :438-559)                                                                                                                      | `csharp.language.ts`                                                                                |
| Per-language rows of `EXTENSION_LANGUAGE_MAP`, `GRAMMAR_FILE_MAP`, `LANGUAGE_QUERIES_MAP`, `DECLARED_CAPABILITIES`, `RECOGNITION_ONLY_EXTENSIONS` | one `<ID>_LANGUAGE: LanguageModule` object per module                                               |
| —                                                                                                                                                 | `index.ts`: `LANGUAGE_MODULES` keyed javascript, typescript, python, go, csharp (the old map order) |

- `tree-sitter.config.ts` is now the assembly: it builds `EXTENSION_LANGUAGE_MAP`, `GRAMMAR_FILE_MAP` and
  `LANGUAGE_QUERIES_MAP` from `LANGUAGE_MODULES`. Its exports are the same names and types as before.
- `language-registry.ts` reads the modules (`LANGUAGE_MODULES[id]`: extensions, recognition-only extensions, grammar
  file, `publicSymbols` from `exportQuery`, declared capabilities). `extensionsOf`, `DECLARED_CAPABILITIES`,
  `RECOGNITION_ONLY_EXTENSIONS` and `FILE_EDGES` are gone from it. Public exports and the lib `index.ts` are unchanged.
- Query text was cut out of the HEAD file by line range (`sed -n`), so it is byte-identical. The only textual edit was
  `const JS_TS_*` → `export const JS_TS_*`.

## "No behaviour change" evidence

**Equivalence probe** (temporary, deleted afterwards): the HEAD `tree-sitter.config.ts` and `language-registry.ts` were
bundled with esbuild next to the new ones and compared at runtime:

```
config equal: true keys EXTENSION_LANGUAGE_MAP,GRAMMAR_FILE_MAP,LANGUAGE_QUERIES_MAP | (same)
registry equal: true keys same: true
behaviour equal: true        (recognisedSourceExtensions, supportedLanguagesFor x 8 capabilities, languageForExtension/classifyFileForCoverage on 8 paths)
extension key order equal: true .js,.jsx,.ts,.tsx,.py,.go,.cs,.csx
(no "QUERY DIFF" line: all 20 query strings ===)
```

**Test counts** (`npx jest -c libs/backend/<p>/jest.config.ts --maxWorkers=2`):

| Project                | HEAD (before)                                 | After                                         |
| ---------------------- | --------------------------------------------- | --------------------------------------------- |
| workspace-intelligence | 54 suites; 1685 passed, 1 skipped, 1686 total | 54 suites; 1685 passed, 1 skipped, 1686 total |
| vscode-lm-tools        | 77 suites; 2331 passed, 2331 total            | 77 suites; 2331 passed, 2331 total            |

`git diff --stat -- '*.spec.ts'` is empty: no spec was touched.

**tools/list bytes**: a temporary copy of `mcp-contract.sweep.spec.ts` (deleted afterwards) wrote `payloads[0]` of
"pins the total tools/list JSON size" to a temp file. Before: 125,790 bytes, sha256 `43c89fe1…eac0a4`; after: 125,790
bytes, same sha256; `cmp` identical. The 22c / 20.2 size pins and `PINNED_TOOLS_LIST_BYTES_AT_HEAD` live in spec files
that are unchanged and still pass.

## FB evidence

The batch says "FB n/a (refactor) — existing specs green unchanged is the proof; show `git diff --stat` of spec files is
empty", and the batch names no structural spec. Adding one would break the "spec diff empty" requirement, so none was
added. The failing-on-HEAD evidence is structural: on HEAD `WI/ast/languages/` does not exist, so the equivalence probe
cannot resolve `LANGUAGE_MODULES`. After the change the probe resolves, and every old/new comparison above is `true`.

## Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` → "Successfully ran
  targets test, lint, typecheck". Lint has 0 errors and 66 warnings, none in the touched files (`eslint` on the 9
  files exits 0 with no output).
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → "Successfully ran target typecheck for 2
  projects".
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json
  dependencies".
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`, workspace-intelligence "1 ok (baseline 1)".
- `ptah-core-prompt.ts` and `cli-adapter.utils.ts` (`NATIVE_AGENT_TOOL_POLICY`) are unchanged vs HEAD.
- The Batch 27 harness (`src/testing/mcp-contract/`) runs inside the workspace-intelligence suite and passes unchanged.

## Deviations

- Executor: the backend-developer fallback ran this batch, not the recommended Codex lane, and it ran in this
  worktree, not lane G.
- `languages/types.ts` imports `LanguageCapabilities` type-only from `language-registry.ts`, and the registry imports
  `LANGUAGE_MODULES` as a value. The cycle is type-only and erased at runtime. The capability interfaces stay in the
  registry, which is their public owner (exported through lib `index.ts`), so no re-export shim is needed.
- The two assembled `Record<SupportedLanguage, …>` maps use one `as` cast after `Object.fromEntries`. This follows the
  registry's existing `LANGUAGE_REGISTRY` precedent.
- `batches.md` shows as modified in the worktree. This batch did not touch it.
