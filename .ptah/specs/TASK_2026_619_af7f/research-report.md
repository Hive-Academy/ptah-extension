# Research Report - TASK_2026_619_af7f

## Question

- Decision this supports: how to (1) build a fact-based benchmark of the ptah MCP tools against the native Grep/Glob/Read baseline, and (2) fix each tool until it meets the unchanged prompt claims, then choose the eager/deferred tool set from the scorecard.
- Question: why do the ptah tools lose to native tools on this repository, what is the root cause per tool, and what benchmark and fix order measure and close the gap?
- Bounds: no production code edited, nothing committed. Not investigated: `ptah_web_search`, agent/session tools, browser tools, diagnostics. I did not exercise `ptah_get_dependents`, `ptah_relevance_rank_files` or `ptah_lsp_*` live; their root causes are read from code. The VS Code host was not run (only its wiring was read). Memory ranking quality was not measured.

## Answer

The main cause of the code-index failures is not a parser or per-file error. `CodeSymbolIndexer` stops discovery at 2,000 eligible files (`DEFAULT_MAX_FILES`), while this repository has about 3,860 eligible files. fast-glob returns them unsorted, so whole directories are never indexed. `libs/backend/vscode-lm-tools/.../mcp-core` has 0 of 25 eligible files in the first 2,000 (reproduced), and the live DB holds 0 of 26. Electron and CLI also never build the index at start or on save. The other tool failures have separate, local causes: the ranker never receives content or the symbol index, the reference and dependency tools are text-scan or lazily built, and the spool root ignores the caller's session. Recommendation: build the benchmark first, then fix in the order of section D.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Index discovery caps eligible files at 2,000; past the cap the run is `truncated` and later files are never read | `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:103` (`DEFAULT_MAX_FILES = 2000`), `:749`, `:769-772` | 2026-10-06 | read the source |
| Same repo has 3,860 eligible files after the indexer's skip patterns and gitignore; `protocol-dispatcher.ts` sits at position 3,362 in fast-glob order; `mcp-core` has 0 of 25 files in the first 2,000; `vscode-lm-tools` has 3 of 92 | scratch script `%TEMP%\t619_c.js` (fast-glob, `DEFAULT_WORKSPACE_EXCLUDES`, `git ls-files -co --exclude-standard`, the indexer's skip globs) | 2026-10-06 | ran it. Glob took 6.1 s and returned 201,285 raw matches, 6,725 not ignored. The ignore filter is approximated by git, not by the product's resolver. |
| Live DB: 22,750 symbol rows for `D:\projects\ptah-extension`, 2,434 distinct files. Of 3,608 git-tracked eligible files only 2,167 are indexed; 253 indexed paths no longer exist on disk; `libs/backend/vscode-lm-tools` has 6 of 91, `libs/frontend/chat` 17 of 183, `libs/web/core` 0 of 26; `mcp-core` 0 of 26 including `protocol-dispatcher.ts` and `tool-result-budget.ts` | scratch scripts `t619_a.py`, `t619_b.py` against a copy of `~/.ptah/state/ptah.sqlite` (+wal, +shm) in `%TEMP%\t619` | 2026-10-06 | ran it, read-only. The copy was taken while the app held the DB open (WAL), so counts may lag by minutes. |
| Dead rows are never purged: 253 files deleted from disk still have rows | same DB copy | 2026-10-06 | ran it |
| Only the VS Code host starts a full index at activation and reindexes on save; no Electron or CLI file references `indexWorkspace` or `reindexFile` | `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:199-251`; Grep of `apps/` and `libs/` for `.indexWorkspace(` and `.reindexFile(` | 2026-10-06 | read the source and grepped |
| Electron/CLI full runs start only from a user click (`indexing:start`) or a lazy run when the index is empty or older than 24 h | `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:467-520` (`userInitiated: true`); `code-namespace.builder.ts:45`, `:239-244`, `:302-326` | 2026-10-06 | read the source |
| Live index age is 72,335,771 ms (20.1 h) and `coverage.census` is `unknown`; `ptah_code_search_symbols markEagerTools` still returns unrelated hits (`getMarkedExtensions`, `markDone`) | live call | 2026-10-06 | ran it |
| Coverage is `unknown` because `getCoverage` reads only the in-process run record; a host session with no run has none | `code-symbol-indexer.service.ts:505-509`, `unknownCoverage` at `:384` | 2026-10-06 | read the source |
| Per-file errors are handled (read/parse/write failures are counted, never throw); a file over 1 MiB is recorded `failed:too-large` | `code-symbol-indexer.service.ts:827-833`, `:1007-1047`, `:1060-1071` | 2026-10-06 | read the source. Not the cause of the missing files (neither target exceeds 1 MiB). |
| `rankFiles` never passes a `symbolIndex` or file content to the scorer, and re-walks and stats the workspace on every call | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:323-342`; `file-relevance-scorer.service.ts:129`, `:403-417` (returns 0 with no `symbolIndex`) | 2026-10-06 | read the source |
| Scorer scores file name (+10), path (+5), file type (+3/+8/+1), and fixed task/framework keywords; no content term | `file-relevance-scorer.service.ts:57-135` | 2026-10-06 | read the source |
| `.md` files under `.ptah/specs/` score as "Test file matches query context" because the classifier treats a `specs` path segment as a test directory | `libs/backend/workspace-intelligence/src/context-analysis/file-type-classifier.service.ts:208-215`; `file-relevance-scorer.service.ts:84-91` | 2026-10-06 | read the source |
| Electron reference lookup is a name-based scan (`graph-scoped-scan` or `text-scan`), hard cap 500 matches, 8,000 files, 1 MiB per file; the CLI registers no IDE host (`mechanism: none`) | `apps/ptah-electron/src/services/electron-ide-capabilities.ts:105-118`, `:836-886`; `system-namespace.builders.ts:260-275` | 2026-10-06 | read the source |
| Every tool result has a default budget of 8,000 chars (2,000 tokens) except three tools; the overflow is spooled to a file | `mcp-core/tool-result-budget.ts:40-42`, `:63-69`, `:144-148` | 2026-10-06 | read the source |
| TypeScript 6.0.3 is already a runtime dependency of both Electron and CLI | `apps/ptah-electron/package.json:49`, `apps/ptah-cli/package.json:85`, `apps/*/project.json` externals | 2026-10-06 | read the source |
| TS language service on 3,405 root files (libs/backend, libs/shared, Electron and CLI src) with `tsconfig.base.json` paths: cold `findReferences` 10.5 s (1.3 s setup before it), warm 97 ms, 1,730 MB RSS. It returns 50 references in 14 files; `rg`-style text count is 53 mentions in 14 files | scratch script `t619_e.js` | 2026-10-06 | ran it. One identifier, one machine. Spec files are in the root set. |
| `ptah_get_dependents` returns `building` because the graph build starts on the first tool call, not at session start, and a background build parses one file per macrotask with governor yields | `protocol-dispatcher.ts:2670-2680` (`GRAPH_BUILD_WAIT_MS = 1_500`, "225 s measured on this repository, TASK_2026_559 Task 9.2"), `dependency-graph.service.ts` (background parse loop, around `:640-665`); only call site of `ptahAPI.dependencies.buildGraph` is `protocol-dispatcher.ts:3002` | 2026-10-06 | read the source. The 225 s figure is quoted from a code comment; I could not find the TASK_2026_559 folder to re-read it. |
| Memory search scope is resolved through the session-aware root (declared URL root, then caller session, then active session, then provider root) | `ptah-api-builder.service.ts:992-1018`; `protocol-dispatcher.ts:2377-2400`; `memory-namespace.builder.ts:105-180` | 2026-10-06 | read the source |
| Spool root uses a different resolver: a declared URL root that matches an open folder, else the host's first open folder, else the temp dir. It ignores the caller session | `protocol-dispatcher.ts:3434-3451` | 2026-10-06 | read the source |
| Memory rows are keyed by exact `workspace_root` strings; worktrees have their own roots (`...\.claude-worktrees\<name>`, `...\.claude\worktrees\<name>`) and `seshat` has only 27 recall rows | DB copy, `memories` table | 2026-10-06 | ran it |
| The HTTP MCP server sets no `keepAliveTimeout`, `requestTimeout` or `headersTimeout` | Grep of `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/` for those names found none | 2026-10-06 | grepped |
| The prompt claims (quoted below) | `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:33`, `:42-54`, `:59`, `:70`, `:74-77` | 2026-10-06 | read the source |
| Eager set today: always `ptah_search_files`, `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_get_diagnostics`, `ptah_workspace_analyze`; IDE hosts add `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`; SQLite hosts add `ptah_code_search_symbols`, `ptah_memory_search` | `protocol-dispatcher.ts:609-628`, `markEagerTools` at `:710` | 2026-10-06 | read the source |
| `ripgrep` is not a first-party dependency: `node_modules/.bin/rg` resolves to `@cursor/sdk-win32-x64/bin/rg.exe` (transitive) | `node_modules/.bin/rg` | 2026-10-06 | read the shim |
| No process-spawn port with three adapters exists; `IProcessSpawner` is bound to `SDK_TOKENS.SDK_PROCESS_SPAWNER` | `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:126`; `apps/ptah-electron/src/di/phase-2-libraries.ts:23` | 2026-10-06 | read the source |
| Open-source facts (licenses, releases, metrics) | see the prior-art table; retrieved via `gh api`, `npm view`, Hugging Face API by a sub-agent | 2026-10-06 | sub-agent report; I did not re-fetch |

## A. Per-tool forensics

Prompt claims (all in `ptah-core-prompt.ts`, unchanged by user decision):

- `:42` Grep for symbol usages -> `ptah_lsp_references`: "LSP-accurate, cross-file, rename-safe".
- `:43` `ptah_lsp_definitions`: "Go-to-definition via LSP".
- `:47` Grep/Glob for a function, class or method -> `ptah_code_search_symbols`: "BM25+vector symbol index - no false positives from string matches".
- `:48` `ptah_ast_analyze`: "40-60% fewer tokens than Read". `:49` `ptah_context_enrich_file`: ".d.ts-style summary".
- `:50` `ptah_get_dependents`: "Reverse import edges = blast radius". `:51` `ptah_memory_search`: "Persistent cross-session memory (BM25+vector)".
- `:52` `ptah_relevance_rank_files`: "Ranked 0-100 with reasons - triage before opening files". `:54` `ptah_get_symbol_index`: "Map of file -> exported symbol names".
- `:59` "Symbol and AST lookups are MANDATORY via ptah before Grep/Glob."
- `:33` "faster, more accurate, and far cheaper in context."

### A1. `ptah_code_search_symbols` (SQLite code index)

- Host path: VS Code, Electron and CLI use the same `CodeSymbolIndexer` and `code_symbols` table. A host without SQLite has no index (`searchSymbols` returns an error). VS Code is the only host that indexes at activation and on save.
- Root cause 1, zero symbols for `protocol-dispatcher.ts` and `tool-result-budget.ts`: the 2,000 eligible-file cap (`:103`, `:749`, `:769`) combined with unsorted fast-glob order (`electron-file-system-provider.ts:162`). Reproduced with the same globs and skip rules: 3,860 eligible files, `protocol-dispatcher.ts` at position 3,362, `mcp-core` 0 of 25 in the first 2,000. The live DB matches: those two files, and all of `mcp-core`, have no rows. Separately, because discovery order is not stable, different runs index different 2,000-file subsets; rows from earlier runs survive, which is why the DB holds more than 2,000 files.
  - Ruled out: `MAX_INDEXED_FILE_BYTES` (neither file exceeds 1 MiB), `shouldSkipFile` (neither name matches `DEFAULT_SKIP_PATTERNS`; note `index.ts` and `*.module.ts` are skipped by design), per-file errors (counted and logged, and they would show in `failed`).
  - Cap fills with low-value files first: the first 2,000 eligible files include 71 `.ptah/` files and apps outside the backend.
  - Deletes-before-reinsert: `_indexFile` deletes then inserts per file (`:1051`, `:1182`). A failed insert leaves the file empty until the next run (`:1188-1196`, outcome `failed:write`). This is a real but secondary risk; no evidence that it caused the two missing files.
- Root cause 2, stale and dead rows: nothing deletes rows for files removed from disk (253 found). A run only rewrites files it selected.
- Root cause 3, no refresh path on Electron/CLI: no startup run and no save hook. `isStale` is true only when the index is empty or older than 24 h (`code-namespace.builder.ts:239-244`). Today's index is 20.1 h old, so nothing will refresh until about 4 h from now. When it does refresh, the same cap applies and will reproduce the loss. An edited or added file is invisible to search until then (the benchmark's "edit then query" and "add then query" scenarios will fail).
- Root cause 4, coverage all `null`: `getCoverage` has no record for a root that had no full run in this process (`:505-509`). The DB has 22,750 rows, but the answer says `census: unknown`. The coverage block is about 350 tokens per call (from context.md; not re-measured), spent on a value that says nothing.
- ECONNRESET: see A9.
- Fix design (ranked):
  1. Index every eligible file: remove the 2,000 cap (or raise it to a measured bound such as 20,000), sort discovery (source roots first, `.ptah/`, `.github/skills` last), and make the cap report `omittedByCap` truthfully when it does bite.
  2. Start a governed background run at Electron and CLI boot, and subscribe to the existing workspace watcher for per-file `reindexFile` (the VS Code `wire-runtime.ts:216-246` logic, moved to a shared host-neutral service in `thoth-runtime`).
  3. Purge rows for paths that no longer exist at the end of a complete run.
  4. Persist the last run summary (root, time, census, counts) so a new session reports `current` or `incomplete` instead of `unknown`; shrink the coverage block to one line when `clean`.
  5. Make the delete and insert of a file one SQLite transaction.

### A2. `ptah_relevance_rank_files`

- Claim: ranked triage. Mechanism, all hosts: `rankFiles` -> `workspaceIndexer.indexWorkspace` (full walk and stat on every call) -> `FileRelevanceScorerService.getTopFiles(files, query, limit)` with no `symbolIndex` and no `activeFileImports` (`analysis-namespace.builders.ts:329-335`).
- Root cause: the score is name/path match plus file type plus fixed task keywords. `scoreBySymbols` exists but returns 0 because no symbol index is passed. No file content, no BM25. A query about "which task spec fixed the ptah tools" matches the word "tool" in file names, so every hit gets the same +10 (all scores 48 in the live test).
- Root cause of the mislabelled `.md` hits: the classifier marks any path segment named `spec` or `specs` as a test directory (`file-type-classifier.service.ts:208-215`), so everything under `.ptah/specs/` is `FileType.Test` and gets "+8 Test file matches query context" when the query contains "spec".
- The existing benchmark could not catch it: its relevance test uses three files whose names contain the query words (context.md, `mcp-contract.bench.spec.ts:817`).
- Fix design: replace the scorer inputs, not the claim. Score = BM25 over (a) code_symbols FTS rows (name, kind, path) and (b) file content chunks, fused with a path/name prior and an import-graph prior (borrowing Aider's personalised PageRank, see prior art). Keep `{file, score 0-100, reasons}` output; reasons name the matching symbol or line. Cache the file list from `WorkspaceFileIndexService` instead of re-walking. Fix the `specs` classification to require a code extension.

### A3. `ptah_lsp_references`

- Claim (`:42`): "LSP-accurate, cross-file, rename-safe".
- Per host: VS Code uses the language server. Electron uses `ElectronIDECapabilities` (name-based scan: `graph-scoped-scan` when the dependency graph certifies a narrowed scope, else `text-scan` over every recognised source file). CLI registers no IDE host and answers `mechanism: none`.
- Correction to the evidence table: the "50" is not a cap in the code. The scan cap is 500 matches (`:108`). The TS language service finds exactly 50 references for `getToolResultBudget` in 14 files (my run), and the text count was 53 in 14 files. So the Electron answer on that one identifier may have been complete. The observed "capped at 50" is most likely a coincidence with the true count, plus the 8,000-char result budget (about 50 lines at this line length); I could not confirm which. The benchmark must test identifiers whose true count is above 50, and identifiers with comments, strings, and same-name symbols, where a text scan produces false positives and `rename-safe` is false.
- Honest weakness that the claim hides: text matching cannot distinguish two symbols with one name; the scan drops matches in strings and comments through tree-sitter, but not same-name symbols.
- What using the TypeScript language service in Electron/CLI takes: TypeScript 6.0.3 is already shipped in both apps. A `ts.createLanguageService` over the tsconfig graph gives `findReferences`, `getDefinitionAtPosition` and rename locations. Measured here: 11.9 s cold start (setup plus first query), 97 ms warm, 1.7 GB RSS for 3,405 files. The memory cost forces a design: run it in a child process or worker with a memory ceiling, load it lazily on the first TS reference or definition call, and scope root files with `tsconfig` project references instead of the whole repo. Non-TS/JS languages stay on the scan or on the symbol index and are reported honestly (`approximations`).
- Fix design: add `TsLanguageServiceProvider` in `workspace-intelligence` (type:feature, no vscode import), selected by `ElectronIDECapabilities` and a new CLI IDE capability for `.ts/.tsx/.js/.jsx`. Keep `text-scan` as the fallback for other languages. Warm it at session start in the background.

### A4. `ptah_lsp_definitions`

- Claim: "Go-to-definition via LSP". Electron: symbol index first (`symbol-index`, top 25), then `declaration-scan`. Because of A1, a definition in an unindexed file is not found by the index and falls to a declaration scan. CLI: `none`.
- Fix: fixing A1 fixes most of it; the language service from A3 gives exact definitions for TS/JS.

### A5. `ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index`

- Claim: "Reverse import edges = blast radius"; "Map of file -> exported symbol names".
- Mechanism: `DependencyGraphService` (tree-sitter import extraction plus a module resolver) built per root, in memory. The only caller of `buildGraph` is the tool handler (`protocol-dispatcher.ts:3002`). The first call waits `GRAPH_BUILD_WAIT_MS = 1,500` ms and then answers `building` with a 15 s retry hint (`:2670-2680`). The build was measured at 225 s on this repository (code comment). A build nobody awaits parses one file per macrotask with a governor yield every `CHUNK_SIZE` files, which is slower than the awaited parallel path.
- Root cause of the `building` answers: the build begins on demand, never at session start, and the background mode is deliberately slow. Three retries in a row in the live test is consistent with a 225 s build and a 15 s retry hint.
- Fix: (1) start the build in the background at session start from the same shared boot service as the indexer; (2) persist the graph (edges keyed by file mtime and size) in SQLite so a restart reads it instead of reparsing; (3) rebuild only changed files on watcher events; (4) for TS/JS, offer the language-service module graph as an alternative resolver (see A3); (5) while building, return the partial graph with `coverage` instead of an empty `building` answer (the claim is blast radius; a partial answer flagged as partial is better than none, but this is a design choice for the architect).

### A6. `ptah_memory_search`

- Claim: "Persistent cross-session memory (BM25+vector)". Works in the live test.
- Scope: the handler passes `{ workspace: true }` unless `global` is set; the root comes from `getWorkspaceRoot()` = declared URL root, then caller session, then active session, then provider root (`ptah-api-builder.service.ts:992-1018`). That resolver is session-aware, so memory scope is probably correct (inferred; not run).
- The spill path went to `D:\projects\seshat\.ptah\tmp`: `resolveSpoolRoot` uses a different rule (`protocol-dispatcher.ts:3434-3451`): the declared URL root if it matches an open folder, otherwise the host's first open folder (`known[0]`). This session's MCP connection carried no `/workspace/{root}` segment (inferred from the result), so the first open folder (`seshat`) was used. This is a real defect: spooled output of a ptah-extension question lands in another project. It is separate from memory scope.
- Scope fragmentation, from the DB: worktrees carry their own `workspace_root` (`...\.claude-worktrees\<name>`, `...\.claude\worktrees\<name>`), so a session in a worktree sees none of the main repo's 25,805 rows (14,969 recall plus 10,836 archival).
- Fix: use the session-aware resolver for spool root as well (fall back to `known[0]` only when nothing else resolves), and treat a worktree root as the main repository for memory scope (map by `git rev-parse --git-common-dir`). The benchmark's two-workspace test covers both.

### A7. `ptah_search_files`

- Works (correct in the live test). Keep as the baseline reference; add to the benchmark for cost (tokens and latency) against Glob, since it is already eager. Not investigated beyond the live result.

### A8. `ptah_ast_analyze`, `ptah_context_enrich_file`

- `ptah_ast_analyze` worked in this research on a 1,200-line file and returned a compact structure (functions with line ranges, imports, exports). The 40-60% claim holds for large files; for small files the output can exceed the file. The existing benchmark pins >= 40% on a 300-line fixture (`mcp-contract.bench.spec.ts` header). Verified for one file only here. `ptah_context_enrich_file` returns the whole file as `mode: full` when the file is not declaration-only (per the tool's own description), which is the claim's boundary: the benchmark must report token ratio per file shape.
- Fix: none needed now; the benchmark adds per-file-size token ratios and declaration recall against the TS compiler API.

### A9. ECONNRESET on one `ptah_code_search_symbols` call

- Not reproduced. The HTTP MCP server (`mcp-http/http-server.handler.ts`) creates a plain `http.Server` on port 51820 with no keep-alive, request or header timeouts configured (grep found none), so Node's defaults apply (a 5 s idle keep-alive). A client that reuses an idle socket just after the server closes it sees `ECONNRESET`. A second candidate is the server being stopped and restarted on a workspace switch (`http-mcp-server.service.ts:659`). Both are inferred, not observed.
- Experiment: a transport test that makes 200 calls with idle gaps of 4 s to 8 s on one keep-alive connection, and one that restarts the server mid-run; count resets. Fix, if confirmed: set `server.keepAliveTimeout` above the client's idle time and send `Connection: keep-alive` with a matching `Keep-Alive: timeout`.

### A10. Failures of ptah tools during this research

- `ptah_code_search_symbols markEagerTools` returned unrelated hits (same as the user's test). `coverage` again `unknown` with null counts.
- `ptah_ast_analyze` on `code-symbol-indexer.service.ts` was correct and compact.
- I did not call `ptah_get_dependents`, `ptah_lsp_references` or `ptah_relevance_rank_files` because the root causes were readable from code; I used Grep, scratch scripts and the DB instead. The built-in Read tool rejected one parallel call with a parameter error; that is the harness, not ptah.

## B. Benchmark design

### B1. Where it lives and its tags

- New Nx project `tools/mcp-bench` (name `mcp-bench`), `projectType: application`, tags `["type:tool"]`, same shape as `tools/di-lint/project.json`. It is not shipped. `type:tool` is not in the `depConstraints` list I read (`eslint.config.mjs`), so a tool project can import any lib; it must not be imported by any lib. Confirm with `nx lint`; if the boundary rule blocks the imports, add `type:tool` to the constraints with `scope:extension` allowed. The question and ground-truth generators are pure Node and TypeScript, using `typescript` 6.0.3, `better-sqlite3`, `gpt-tokenizer`, `fast-glob` (all already in `node_modules`).
- The product code under test is called only through the MCP transport (B5), so the tool project needs no lib imports for the runs. Library imports are limited to schema types from `@ptah-extension/shared` if needed.
- Replace: the service-level `mcp-contract.bench.spec.ts` stays as a fast unit gate for size and recall on its fixture, but its relevance test (`:817`) and the "Works" ratings are retired as evidence. `scripts/build-eval-harness.ts` (self-consistency proxy) is replaced by the seeded-memory suite. Reuse: `gpt-tokenizer` counting, the fixture workspace for the lifecycle tests, `scripts/agent-usage/` readers for token accounting of live agent sessions (optional online track), and the TASK_2026_473 track A queries as a 4-query regression seed (they remain hand-graded, labelled as such).

### B2. Corpus

- A pinned commit of this repository, recorded in `scorecard.json` as `corpus.commit`, checked out to a temp directory at run time (`git worktree add`), never the live working tree. Real sizes (`protocol-dispatcher.ts` 3,940 lines). The pinned commit is advanced per release by one explicit edit; scores are comparable only within one commit.
- Lifecycle scenarios mutate a throwaway copy, not the pin.

### B3. Ground truth (generated)

| Suite | Generator | Question set (size) | Ground truth |
| --- | --- | --- | --- |
| Symbol search (exact) | TS compiler API walk of exported declarations of non-test files | 300 sampled by stratum: 100 in small files, 100 in files over 1,000 lines, 100 from the top-level lib with the most files; plus 50 negatives (names that do not exist) | declaration file and line |
| Symbol search (concept) | first sentence of the JSDoc of an exported declaration, with the identifier tokens removed from the text | 200 | the owning declaration; hit if it is in the top k |
| References | `ts.LanguageService.findReferences` over the pinned commit | 150 identifiers: 50 with fewer than 5 references, 50 with 5-50, 50 with more than 50; 25 with a same-name symbol elsewhere | set of `file:line` |
| Definitions | `getDefinitionAtPosition` for 150 call sites | 150 | `file:line` |
| Dependents / dependencies | `ts.resolveModuleName` with `tsconfig.base.json` paths over all imports (static, `export from`, dynamic `import()` with a string literal) | 100 files across size and fan-in strata | set of files |
| Relevance | merged PR titles and bodies from `gh pr list --state merged` mapped to their changed non-test, non-lockfile source files; commits before the pinned commit only | 200 PRs with 1-8 changed source files | changed files; recall@10 and MRR on the first changed file |
| Memory | seeded facts in a clean SQLite DB: 150 facts each with 1 verbatim query, 2 paraphrases, 1 temporal-update pair, 20 abstention queries; two workspace roots with overlapping facts and a worktree root | 150 + 20 | the fact ids; hit@1, hit@5, MRR, cross-workspace leak count |
| ast_analyze, enrich | compiler API declaration list | 100 files across size strata | declaration recall; token ratio versus Read |
| search_files | `fast-glob` plus the product's ignore rules | 100 glob patterns | file set |
| search_text (new, section C) | `rg --json` with the same rules | 150 literal and 50 regex queries | match set |

Independence notes: the JSDoc query removes identifier tokens to avoid a name lookup scoring as concept search. Relevance ground truth uses PRs merged after the earlier ranker was written only if the PR is not inside the pinned corpus's training of any tuning set; the architect must freeze a held-out PR split (suggest the most recent 200 PRs as test, the earlier ones for tuning) so Phase 2 tuning cannot fit the test.

### B4. Native baselines

For each question a scripted baseline in the same suite, same metrics, run with the same tokenizer:

- symbol search: `rg -n "\b(function|class|interface|type|enum|const)\s+NAME\b"` then the first 20 lines; concept: `rg -i -l` on the three longest tokens, ranked by match count.
- references: `rg -n -w NAME`, all lines (no cap), counted in tokens. Two metrics: raw recall of true references, and precision (true references over text matches).
- dependents: `rg -l "from '.*<module-stem>'"` over `libs` and `apps`.
- relevance: `rg -il` on query keywords, files ordered by match count; and `git log --grep` on the same keywords for the PR suite (one more native baseline, as in the user's test #1).
- memory: no native baseline; the comparison is to `rg` over `.ptah/specs` and `git log --grep`.
- ast_analyze: `Read` of the whole file (token count). search_files: `Glob`.

Score per tool = tool metric minus baseline metric. Tokens and calls are lower-is-better; the sign is normalised in the scorecard.

### B5. Transport

- Start the real server: `ptah mcp-serve` (stdio, `apps/ptah-cli/src/cli/commands/mcp-serve.ts`) for the CLI host, and the HTTP MCP server for the Electron host (the Electron app bootstrap or its headless main, whichever the e2e app `apps/ptah-electron-e2e` already launches). Drive both with an MCP client library over stdio and HTTP `tools/call`, measuring wall time per call at the client.
- Cold, warm and p50/p95 are measured on the client side, including serialisation and the 8,000-char budget cut, so a result the budget truncates counts as truncated.
- Hosts: the benchmark runs CLI and Electron (same corpus). VS Code is run only in the existing `vscode-e2e` workflow, as a separate nightly job, because it needs a real language server.

### B6. Metrics

hit@1, hit@5, MRR, recall@10 (and recall@all for references and dependents), precision, result tokens (`gpt-tokenizer`), calls per answer (baseline counts the commands it needs; a tool counts MCP calls including retries on `building`), p50/p95 latency, error rate (transport errors, `building`, `unavailable`, `unknown` coverage), truncation rate. For the relevance suite also report the LocAgent-style Acc@k and NDCG@k (see prior art).

### B7. Lifecycle scenarios (each is a scored case)

1. Cold start: fresh process, no DB: time to first correct answer, and the state the tool reports meanwhile.
2. Edit then query: change a declaration in a file, query within 5 s and within 60 s.
3. Add file then query: add a new file with a unique exported symbol.
4. Delete file then query: the symbol must disappear.
5. Large file: a 3,900-line file and a 1.5 MiB file (must fail honestly or succeed).
6. Index age beyond 24 h: backdate rows and check the lazy refresh result and its cap.
7. Two workspaces and one worktree: memory leak count, spool path, symbol scope.
8. Transport: 200 calls with 4-8 s idle gaps (ECONNRESET), and one server restart.

### B8. Output

- `scorecard.json` (one per run, kept under `.ptah/bench/scorecards/<release>/`, and attached to the release):

```json
{
  "schemaVersion": 1,
  "run": { "id": "...", "startedAt": "ISO", "host": "cli|electron|vscode", "os": "win32|linux", "node": "..." },
  "product": { "version": "...", "commit": "..." },
  "corpus": { "repo": "...", "commit": "...", "eligibleFiles": 0, "tsVersion": "6.0.3" },
  "suites": [
    {
      "tool": "ptah_code_search_symbols",
      "claim": "ptah-core-prompt.ts:47",
      "questions": 350,
      "tool_metrics": { "hit@1": 0, "hit@5": 0, "mrr": 0, "recall@10": 0, "precision": 0, "tokens_p50": 0, "calls_per_answer": 0, "latency_ms": { "p50": 0, "p95": 0 }, "error_rate": 0, "truncation_rate": 0 },
      "native_metrics": { "baseline": "rg", "...": 0 },
      "delta": { "quality": 0, "tokens": 0, "calls": 0, "latency_ms_p50": 0 },
      "verdict": "pass|fail|na",
      "failures": [ { "question": "...", "expected": ["..."], "got": ["..."] } ]
    }
  ],
  "lifecycle": [ { "scenario": "edit-then-query", "tool": "...", "pass": false, "detail": "..." } ],
  "eagerSelection": { "eager": [], "deferred": [], "rule": "see B10" }
}
```

- Markdown scorecard generated from the JSON: one table per tool (tool vs native, deltas, verdict), one lifecycle table, and the eager/deferred table.

### B9. CI gate

- New workflow `.github/workflows/mcp-bench.yml`: a PR run on a 40-question smoke subset per suite (budget under 10 minutes, CLI host only, `ubuntu-latest`), and a nightly and release run of the full set on both hosts (budget under 45 minutes, Windows and Linux). The existing `ci.yml` is left alone (it uses `nx affected`; the full bench is not an affected target).
- A suite fails when, on its primary quality metric, the tool is below the native baseline by more than a noise margin set from three baseline runs (suggest 2 standard deviations), or when error rate is above 1%, or when a lifecycle scenario fails. Before Phase 2 the gate is a recorded-failure gate: it passes only if the current `scorecard.json` equals the committed baseline within noise, so the loss is documented without blocking merges; as each Phase 2 fix lands, the baseline tightens to the claim.
- Cost to be measured, not assumed: corpus checkout and an indexing pass (the live index takes minutes) must fit the budget. If not, cache the SQLite DB and the graph keyed by commit.

### B10. Eager/deferred rule driven by the scorecard

Replace the hand-written sets at `protocol-dispatcher.ts:609-628` with a rule computed from the scorecard committed in the repo (the dispatcher reads a generated `eager-tools.json`, not live scores):

- A tool is eager on a host when, on that host, its suite verdict is `pass`, its quality delta to native is positive, and it saves at least one call or 20% of tokens against native, per the scorecard.
- A tool that fails stays deferred, and its prompt row is flagged by a test (the mandate manifest `mcp-mandate-manifest.spec.ts` already pins prompt rows; extend it to fail when an eager tool has a failing verdict, or a failing tool is named MANDATORY).
- The tool-search deferral cost counts too: a deferred tool costs an extra search call, so a tool passing with a large saving on a common question class (symbol lookup, references, relevance) is eager even if its schema is large.
- Today's data implies: keep eager `ptah_search_files`, `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_get_diagnostics`, `ptah_workspace_analyze`; the SQLite pair and the IDE trio are eager today but fail their claims, so after Phase 1 the rule would defer `ptah_code_search_symbols`, `ptah_lsp_references` (Electron/CLI) and `ptah_relevance_rank_files`. That is a rule outcome of the numbers, not my decision; the architect decides whether to apply it before Phase 2 fixes land.

## C. `ptah_search_text`

- Purpose: close the text-search gap that Grep covers and no ptah tool does (the user's test #4: concept "character budget" is found by `Grep \w*Budget\w*`).
- Claim it will make (for the prompt and the benchmark): "Ranked text search over the workspace: matches grouped by file, best files first, one line per match with a line number, bounded output; use before Grep." The benchmark tests: recall of all matches that `rg` finds (recall@all with the per-file cap reported as truncation), precision of the ranking (the file holding the definition ranks above files holding only call sites for identifier queries, using the declaration ground truth), tokens per answer no higher than raw `rg -n` for the same query, calls per answer no higher than one, p95 latency under 500 ms on this corpus after warm-up.
- Output (compact): `file (N matches)` header, then up to 3 lines per file as `line: text` trimmed to 160 chars, a total of at most 40 files, and a single trailer line `files: X, matches: Y, truncated: bool`. No coverage block.
- Ranking: per-file BM25 on matched terms, boosted when the match is a declaration line (cross-checked against the symbol index), penalised for generated and test paths; ties by path.
- Engine choice: wrap ripgrep. It is the baseline the benchmark compares to, so wrapping it gives recall equal to the baseline by construction; the ranking and the compact format are the added value. Zoekt (trigram index) would give faster repeated queries on large repositories but needs a Go binary and an index process per workspace, and I could not verify Windows support (CI runs only on ubuntu-latest); on a 6,900-file repository, `rg` is already fast enough that the benchmark can measure whether an index helps before anyone adds one. Not examined: sqlite FTS5 trigram tokenizer over file content (it would reuse the existing SQLite layer); it is the candidate to test if `rg` p95 fails the gate.
- Binary: `ripgrep` is not a first-party dependency (the only `rg` in `node_modules` is transitive via `@cursor/sdk`). Add `@vscode/ripgrep` (MIT per npm; prebuilt per-platform optional dependencies) or ship `@vscode/ripgrep-universal` (about 60 MB); fall back to a Node scan using `IFileSystemProvider.findFiles` and `readFile` when the binary is absent, and report the fallback in the answer.
- Hexagonal placement: new port `ITextSearchProvider` in `libs/backend/platform-core` (type:core). Adapters in `platform-vscode`, `platform-electron`, `platform-cli`. All three hosts run Node, so the adapters can share one implementation in the core and differ only in how the binary path is resolved (a VS Code extension can use the ripgrep binary VS Code ships, but that path is not a stable API, so the packaged `@vscode/ripgrep` is safer). The service that ranks and formats lives in `workspace-intelligence`, the tool definition in `tool-description.builder.ts`, the handler in `protocol-dispatcher.ts`, and the DI registration in each host's `phase-2-*` registration file. Add a parity spec in the style of `agent-spawn-surface-parity.spec.ts`.
- Not decided here: whether the tool is eager. Rule B10 decides it from its scorecard.

## D. Ordered fix plan and risks

Phase 1 deliverables (benchmark first, no product change):

1. `tools/mcp-bench` project with the corpus checkout, generators for each suite in B3, native baselines, the MCP client driver, scorecard JSON and Markdown writers.
2. First recorded scorecard on CLI and Electron, committed as the baseline. Expected results from this research: symbol search exact and concept fail (about 40% of eligible files indexed), references fail on false positives and speed for large counts, dependents `building`, relevance fails, edit-then-query fails, two-workspace spool path fails.
3. `.github/workflows/mcp-bench.yml` in recorded-failure mode.
4. Extend `mcp-mandate-manifest.spec.ts` so each MANDATORY claim links to a suite.

Phase 2 fixes, in order, each with the metric it moves:

| # | Fix | Metric it moves | Blast radius |
| --- | --- | --- | --- |
| 1 | Remove or raise the 2,000-file cap, sort discovery, purge dead rows, stop deleting before a successful parse, transactional write (A1) | symbol hit@5 and recall, edit/add/delete scenarios, `unchecked` count | `code-symbol-indexer.service.ts` (Grep: `CodeSymbolIndexer` is imported by `code-namespace.builder.ts`, `ptah-api-builder.service.ts`, `memory-rpc.handlers.ts`, `boot-thoth-runtime.ts`, `wire-runtime.ts`) |
| 2 | Boot-time governed index run and watcher reindex for Electron/CLI; persisted run summary and truthful, short coverage (A1) | cold-start scenario, `unknown` rate, tokens per call | `boot-thoth-runtime.ts` (shared by Electron and CLI); moves logic out of `wire-runtime.ts` |
| 3 | Ranker: BM25 over symbols and content, classifier fix, cached file list (A2) | relevance recall@10, MRR | `file-relevance-scorer.service.ts`, `analysis-namespace.builders.ts`, `file-type-classifier.service.ts` (classifier is used by indexer outputs; run its specs) |
| 4 | Language-service references and definitions for TS/JS on Electron and CLI, in a bounded child process (A3, A4) | references precision and recall, definitions hit@1, p95 latency, memory | `electron-ide-capabilities.ts`, new CLI IDE capability, a new `workspace-intelligence` provider |
| 5 | Warm and persist the dependency graph; partial answers (A5) | dependents `building` rate, recall, cold-start time | `dependency-graph.service.ts`, `protocol-dispatcher.ts` graph job code |
| 6 | `ptah_search_text` (C) | text recall, tokens, calls | new files plus one dispatcher case, builder, DI registration in three hosts |
| 7 | Spool root via the session-aware resolver; worktree-to-repo memory scope (A6) | two-workspace leak count, spool path | `resolveSpoolRoot` at `protocol-dispatcher.ts:3434`; memory scope resolver |
| 8 | Keep-alive and timeout settings if A9 reproduces | transport error rate | `http-server.handler.ts` |
| 9 | Eager/deferred selection from the scorecard (B10) | calls per answer in live agent sessions | `protocol-dispatcher.ts:609-628`, `mcp-mandate-manifest.spec.ts` |

Risks:

- Raising the cap raises first-run indexing time and SQLite size (22,750 rows today for about 2,200 files; expect about 40,000 rows). Index time on the full 3,860 files is unmeasured; measure in Phase 1. The governor path keeps it from stalling the foreground.
- The TS language service used 1.7 GB on this repository; it needs the child process and a ceiling, or Electron's main process is at risk. Not measured on a low-memory machine.
- Mutating the pinned corpus would invalidate scores across releases; the lifecycle scenarios use a copy.
- A held-out relevance split is needed or Phase 2 tuning overfits the benchmark.
- ECONNRESET and memory scope conclusions are inferred; Phase 1 tests settle them before Phase 2 spends effort.

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Benchmark as `tools/mcp-bench` (type:tool) over real MCP transport | Matches the existing tool-project shape (`tools/di-lint`) and the existing CLI stdio server | New project, generators, one workflow | Runtime budget on CI if indexing is slow; boundary lint for `type:tool` unconfirmed |
| Keep extending `mcp-contract.bench.spec.ts` | Already in CI | Low | The reason the loss was missed: synthetic fixture, in-process, no lifecycle, filename-matching test. Not recommended as the evidence source |
| Cap removal plus boot-time index and watcher (fixes 1-2) | Directly explains the zero-symbol files; reproduced | Small code, larger first-run time | Bigger DB; per-file reindex storms on branch switches (needs debounce as in `wire-runtime.ts:226-241`) |
| TS language service for references (fix 4) | TypeScript 6.0.3 already shipped in both apps | New provider, child process | 1.7 GB RSS, 10.5 s cold; TS/JS only |
| SCIP offline index for references | Compiler-accurate, usable as both ground truth and backend | Run `scip-typescript` (Apache-2.0, Node >= 22.13); write a reader; no documented incremental mode | Full reindex per change; Windows unverified |
| Wrap ripgrep for `ptah_search_text` | Equals the native baseline in recall by construction | Add `@vscode/ripgrep` and a fallback | Binary packaging for Electron and CLI |
| Zoekt for `ptah_search_text` | Index speed on very large repos | Go binary, index process | Windows unverified; unnecessary at this scale until the benchmark says so |

## Open-source prior art: adopt / borrow / ignore

Facts below are from a sub-agent using `gh api`, `npm view` and the Hugging Face API on 2026-10-06; I did not re-fetch them. Vendor-reported numbers are not used. Our benchmark decides.

| Project | License | What it would replace or speed up | Integration cost in Nx/TS/Electron | Host fit | Decision |
| --- | --- | --- | --- | --- | --- |
| LocAgent / LocBench (gersteinlab) | Apache-2.0 code. Dataset license unverified (HF shows no license tag) | Metric definitions for the relevance suite: Acc@k (strict, all ground-truth items in top k), Recall@k, NDCG@k, precision, MAP at file, module and function level (`evaluation/eval_metric.py`). Same shape as our PR-title-to-changed-files ground truth | Port the metric formulas to TypeScript (a few dozen lines); no runtime dependency; Python 3.12 for the original scripts | Offline benchmark only | Borrow the metrics. Ignore its graph agent as a dependency; do not use LocBench data (SWE-bench Python issues) as a score for this TS repository, only as a sanity check for the metric code. Dataset license must be checked before any reuse |
| LongMemEval (xiaowu0162) | MIT code, MIT dataset per HF API | Question taxonomy for the memory suite: single-session user, assistant and preference, multi-session, knowledge update, temporal reasoning, abstention (`_abs` ids); retrieval metrics recall@k and NDCG@k at session level | Reuse the categories and the update and abstention cases in our seeded set; the data are chat histories, not workspace memory, so questions are regenerated | Offline benchmark only | Borrow the taxonomy and retrieval metrics. Do not use its LLM-judge QA accuracy as a gate (non-deterministic, needs GPT-4o) |
| SCIP + scip-typescript | Apache-2.0 (both). scip-typescript v0.4.0 (2025-10-02), Node >= 22.13; `@scip-code/scip` reader 0.10.0, ESM only | Could generate reference and definition ground truth, and back references on Electron/CLI without a language service | Needs Node 22.13+ for the indexer; the reader gives documents and occurrences only, so we write the symbol-to-occurrence queries; no documented incremental indexing; monorepo project references not verified; its package.json pins TypeScript 6.x but the registry dependency list showed ^5.6.2 (partly unverified); Windows unverified (CI is ubuntu only) | Offline index works on any host, but the full reindex per change cannot answer "edit then query" | Adopt as a cross-check ground truth only after measuring its index time on this repository; do not make it the Electron/CLI backend (no incremental story). The in-process TypeScript language service is the primary ground truth and backend candidate |
| Aider repo map | Apache-2.0 | The relevance ranker (fix 3): files as nodes, edges from referencing to defining files weighted by sqrt of reference count, personalised PageRank, then a token-budget binary search over tags (`aider/repomap.py`) | Reimplement the algorithm in TypeScript on our tree-sitter and symbol index; no dependency; graph edges can come from the dependency graph or the symbol index; the multiplier constants were not read | Pure algorithm, all hosts | Borrow the algorithm. Test it in the benchmark against BM25 alone before adopting the graph part |
| Serena (oraios) | SolidLSP MIT; application GPL-3.0-or-later (GitHub reports NOASSERTION) | Extra baseline for references, definitions and symbol overview in the scorecard | Python >= 3.11 with `uv`; MCP over stdio; spawns real language servers | CLI and Electron could launch it as a separate MCP server for the benchmark only | Ignore as a dependency (GPL, Python, not shippable in our bundle). Use as an optional extra baseline in the nightly bench; do not copy code |
| zilliztech claude-context | MIT, TypeScript, Node >= 20 | Extra baseline for hybrid BM25 and dense retrieval | Needs a vector DB (Zilliz Cloud, or self-hosted Milvus) and an embedding provider key (OpenAI, VoyageAI, Gemini, or local Ollama) | Not shippable as a default (external services) | Ignore as a dependency. Optional baseline only with local Milvus plus Ollama. Its self-reported 39.4% fewer tokens and 36.1% fewer calls are vendor claims and not used |
| ripgrep | Unlicense or MIT (dual) | Engine for `ptah_search_text`; baseline for the text suite | `@vscode/ripgrep` 1.18.0 (MIT per npm; optionalDependencies per platform), or `@vscode/ripgrep-universal` (about 60 MB); not a first-party dependency today | All three hosts, Windows msvc builds exist | Adopt, with a Node-scan fallback |
| Zoekt (sourcegraph/zoekt) | Apache-2.0, Go, no releases (last commit 2026-09-11) | A trigram index for `ptah_search_text` | Go binary plus an index process per workspace | Windows unverified | Not now; reconsider only if the benchmark shows `rg` failing its p95 gate |

## Disagreements

- "Capped at 50" (context.md evidence #5) versus the code: the code caps text-scan references at 500 (`electron-ide-capabilities.ts:108`), and the TS language service independently returns exactly 50 references for that identifier. So the loss on #5 is probably not recall; it is no-compiler accuracy and the 8,000-char result budget. What decides it: the benchmark's references suite, with identifiers above 50 references and with same-name symbols.
- The TASK_2026_559 research rated `ptah_relevance_rank_files` "Works" (context.md) versus the code reading here: it was a pass on a three-file fixture whose names contain the query words. What decides it: the PR-recall suite on the real corpus.
- Memory scope: the session-aware resolver says `ptah-extension`; the spool path says `seshat`. These are two resolvers, not one wrong root (inferred, not run).

## Local consequences

- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`: `DEFAULT_MAX_FILES`, discovery order, dead-row purge, transactional write, persisted run summary.
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts` and `apps/ptah-extension-vscode/src/activation/wire-runtime.ts`: one shared boot-time index, graph warm-up and save/watch reindex for all hosts.
- `libs/backend/vscode-lm-tools/.../namespace-builders/analysis-namespace.builders.ts:323` and `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`, `file-type-classifier.service.ts:208`: ranker inputs and classifier.
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts` plus a new CLI IDE capability: TS language-service provider.
- `libs/backend/vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts`: `resolveSpoolRoot` (`:3434`), graph job (`:2670-3050`), eager sets (`:609-628`), a new `ptah_search_text` case.
- `libs/backend/vscode-lm-tools/.../mcp-http/http-server.handler.ts`: keep-alive and timeouts, if A9 reproduces.
- `libs/backend/platform-core` (new `ITextSearchProvider`) and the three platform libs.
- New `tools/mcp-bench` and `.github/workflows/mcp-bench.yml`. `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts:817` stops being cited as evidence for relevance.
- `ptah-core-prompt.ts`, `tool-description.builder.ts`, the substitution table: unchanged (user decision).

## Unknowns

- Whether the first 2,000 files differ run to run (fast-glob traversal order is concurrent). Smallest experiment: run the discovery script five times and compare the first 2,000.
- Full index time and DB size on all 3,860 files, and the real discovery cost: the glob returned 201,285 raw matches in 6.1 s before ignore filtering. Experiment: one timed `indexing:start` on a copy of the DB.
- Memory scope on the live session and why `seshat` was first: not observable offline. Experiment: call `ptah_memory_search` with `global: true` and with an explicit root and compare; log `getHostWorkspaceRoots()` order.
- ECONNRESET cause (keep-alive default versus server restart). Experiment: B7 scenario 8.
- Whether `ptah_get_dependents` can be answered faster by the language-service module graph than the 225 s tree-sitter build (the 225 s figure is quoted from a code comment). Experiment: time `ts.resolveModuleName` over all imports of the pinned commit.
- SCIP index time and Windows behaviour on this repository: not run.
- Whether the tool-search deferral cost (one extra call) is what keeps agents from using ptah tools, or the failures themselves. The online track from `scripts/agent-usage/` would measure it after Phase 2.

## Clarifications Needed

These are places where a prompt claim, unchanged, cannot be met by fixing the tool alone. I do not propose weakening any of them; the user decides what to build.

1. `ptah_lsp_references` "LSP-accurate, cross-file, rename-safe" for languages other than TypeScript and JavaScript on Electron and CLI. A TS language service covers TS/JS only. Options: (Recommended) build the TS language-service provider now and add per-language servers (for example Python, Go) later, leaving those languages on an honestly-labelled scan until then; require external language servers for every supported language now; narrow the table row to TS/JS (a claim change, which you ruled out).
2. "faster" for references on first call. The measured cold start of the compiler service is 10.5 s (about 12 s with setup) and 1.7 GB RSS on this repository, against `rg` in tens of milliseconds. Options: (Recommended) warm the service at session start so most calls are the 97 ms warm path; accept a cold-start first call and measure it in the scorecard; keep a fast text answer plus a precise answer that follows.
3. "far cheaper in context" while `coverage` is about 350 tokens per symbol call. Options: (Recommended) one-line coverage when clean, full block only when not clean; keep the full block always.
4. `ptah_get_dependents` "blast radius" for languages with no import resolver here. Options: (Recommended) TS/JS exact via module resolution and others reported as partial with coverage; drop non-TS languages from the claim (a change you ruled out); build resolvers per language.
