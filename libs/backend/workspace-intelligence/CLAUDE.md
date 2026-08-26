# @ptah-extension/workspace-intelligence

[Back to Main](../../../CLAUDE.md)

## Purpose

Workspace analysis, file indexing, context optimization, AST parsing (tree-sitter), and code symbol indexing for downstream AI consumers. The "what's in this workspace" service layer.

## Boundaries

**Belongs here**:

- Workspace analyzer + project/framework/dependency/monorepo detectors
- File indexer with pattern matching and ignore resolution
- Context services: search, orchestration, optimization, enrichment, relevance scoring
- AST: tree-sitter parser, dependency graph, symbol indexer
- Token counter and file system helpers

**Does NOT belong**:

- LLM calls (consumers pass context to `agent-sdk`)
- Persistence beyond what the symbol indexer needs (via `ISymbolSink` from `memory-contracts`)
- RPC handlers (in `rpc-handlers`: `ContextRpcHandlers`, `WorkspaceRpcHandlers`)

## Public API

Workspace: `WorkspaceService`, `WorkspaceAnalyzerService`, `ProjectDetectorService`, `FrameworkDetectorService`, `DependencyAnalyzerService`, `MonorepoDetectorService`.
Context: `ContextService`, `ContextOrchestrationService`, `FileTypeClassifierService`, `FileRelevanceScorerService`, `ContextSizeOptimizerService`, `ContextEnrichmentService`.
Indexing: `WorkspaceIndexerService`, `PatternMatcherService`, `IgnorePatternResolverService`.
Files: `FileSystemService` (+ `FileSystemError`), `TokenCounterService`.
AST: `TreeSitterParserService`, `AstAnalysisService`, `DependencyGraphService` (+ `DependencyGraph`, `FileNode`, `SymbolIndex`). Languages: JavaScript, TypeScript, Python, Go, C#. Adding one means a grammar in `scripts/copy-wasm.js`, the `SupportedLanguage` union, `EXTENSION_LANGUAGE_MAP`, a grammar load, and a query set reusing the shared capture names so the extraction layer needs no change.
Toolchain: `probeToolchain` (`project-analysis/toolchain-probe.ts`) — answers whether a stack's CLI is installed, for `STACK_PROFILES` consumers.
Diagnostics: `TypeScriptDiagnosticsProvider` (`IDiagnosticsProvider` for Electron/CLI, behind `ptah_get_diagnostics`). See "Type-check worker" below.
Plus rich typing (`WorkspaceAnalysisResult`, `WorkspaceInfo`, `ContextRecommendations`, `OptimizedContext`, `IndexingProgress`, `FileSearchOptions`, AST query types, etc.) and a code-symbol indexer (TASK_2026_THOTH_CODE_INDEX).

## Internal Structure

- `src/workspace/` — `WorkspaceService`
- `src/composite/` — `WorkspaceAnalyzerService` façade
- `src/project-analysis/` — project/framework/dependency/monorepo detectors
- `src/file-indexing/` — `WorkspaceIndexerService`, `PatternMatcherService`, `IgnorePatternResolverService`
- `src/context/` — `ContextService`, `ContextOrchestrationService`
- `src/context-analysis/` — classifier, relevance scorer, size optimizer, enrichment
- `src/ast/` — tree-sitter parser, dependency graph, types/config
- `src/services/` — `TokenCounterService`, `FileSystemService`
- `src/autocomplete/` — `AgentDiscoveryService` (`@` picker) + `CommandDiscoveryService`
  (`/` picker) + `workspace-folder-watchers.ts`. See "Autocomplete discovery" below
- `src/diagnostics/` — `TypeScriptDiagnosticsProvider` + its type-check worker
- `src/quality/` — additional capability bucket
- `src/types/workspace.types.ts`
- `src/di/`

## Autocomplete discovery (`@` and `/` pickers)

`AgentDiscoveryService` and `CommandDiscoveryService` back
`autocomplete:agents` / `autocomplete:commands`. That manifest entry has
`requires: []`, so **every host serves them** — VS Code, Electron and the CLI.
Three rules, all learned from defects:

- **The cache is per workspace root** (`Map` keyed by `normalizeWorkspaceRoot`,
  LRU-capped at 8), never a single slot. A single slot was first a correctness
  bug (one workspace answered for every other — TASK_2026_200) and then a
  thrash bug (two folders in alternating use evicted each other on every
  keystroke). Never re-read the cache field after an `await`: resolve it into a
  local in the same synchronous block as the lookup and filter that.
- **Watchers are per OPEN FOLDER, and invalidate the folder they were armed
  for.** `watchWorkspaceFolders` arms one per `getWorkspaceFolders()` entry with
  the folder as `cwd`, and re-arms on `onDidChangeWorkspaceFolders`. The
  earlier single unscoped watcher re-ran discovery for whatever
  `getWorkspaceRoot()` reported, so an edit in folder B rescanned folder A and
  left B stale. The old header said not to thread a root through, because doing
  so would pin the watcher to the activation-time folder — that constraint still
  holds and is met: nothing is pinned, and the folder is closed over rather than
  parsed back out of the event path.
- **The handler invalidates; it does not re-discover.** Warming a background
  folder's list on an edit nobody has asked about is work for an answer that may
  never be requested. `invalidateCache(root?)` drops one root, or everything
  when the change is not attributable to a folder (the plugin handlers' call
  after a harness reconcile).

Both hosts that switch or add folders at runtime must call `initializeWatchers()`
once after the RPC surface is registered — `apps/ptah-extension-vscode`'s
`bootstrap.ts` and `apps/ptah-electron`'s `wire-runtime.ts`. It is idempotent.
The cache has no TTL, so a host that skips it serves the list captured at first
use for the rest of the session.

## Type-check worker (`ptah_get_diagnostics`)

`ts.createProgram` + `ts.getPreEmitDiagnostics` is one synchronous call with no
yield point — tens of seconds on this monorepo. It used to run inline on the
caller's thread, which in Electron is the MAIN process, so a single
`ptah_get_diagnostics` froze the window and back-pressured every agent
subprocess (TASK_2026_323 blocker B3). Three rules now hold:

- **The compile runs on a `worker_threads` Worker**, started from an inline
  source string (`ts-diagnostics-worker-source.ts`) with `eval: true`. A real
  worker entry file would need an esbuild target in every host that binds the
  tool plus a host-implemented factory port to hand the lib the emitted path —
  the `IEmbedderWorkerProcessFactory` shape in `memory-curator`. That is worth
  paying for a native ONNX runtime; it is not worth paying for a pure-JS
  compiler pass. The string is not type-checked, so it is covered by
  `type-script-diagnostics-provider.spec.ts` driving every case through it.
- **One worker process-wide**, `unref`'d while idle and `ref`'d while a run is
  outstanding, terminated after 60 s idle. Requests need no queue: the compile
  is synchronous inside the worker, so a second message waits in the worker's
  own queue. Ids correlate replies.
- **Single-flight per root plus a 30 s per-root result cache.** The core prompt
  tells every agent to call this tool, so three agents in one session call it in
  a burst; they share one compile, and a repeat inside the TTL pays nothing. The
  cache is keyed by resolved root and LRU-capped at 8 — never a single slot.

A dead, timed-out or throwing worker reports `unavailable`, never `available`
with zero diagnostics. `available` + `[]` must only ever mean "checked, and
clean" (TASK_2026_299 / TASK_2026_301).

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/memory-contracts`
**External**: `web-tree-sitter` (^0.26.8), `picomatch`, `gray-matter`, `tsyringe`, `cross-spawn` (toolchain probe only — see `project-analysis/toolchain-probe.ts` for why it is not a `platform-core` port)

## Guidelines

- File access via `IFileSystemProvider` (platform-core) — never `node:fs` directly.
- Tree-sitter WASM grammars load lazily; respect platform-info paths for asset resolution.
- The symbol indexer writes through `ISymbolSink` (memory-contracts) — concrete sink is registered by memory-curator.
- `IndexingProgress` events flow via `createEvent` (platform-core utility) — keep them disposable.
- Long-running operations must honor cancellation tokens.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `agent-generation`, `vscode-lm-tools`, `rpc-handlers`. Imports `platform-core`/`vscode-core`/`memory-contracts` only. Frontend libs MUST NOT import this.
