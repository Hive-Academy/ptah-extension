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

## File index (`@`-mention picker)

`WorkspaceFileIndexService` is the in-memory file list the `@` picker queries.
Three rules, all from TASK_2026_344 (measured: 15249 files re-walked three times
in one session at 14826 / 9969 / 8626 ms, each followed by a run of 260-554 ms
`[event-loop]` lags):

- **One index per OPEN FOLDER; queries read the ACTIVE one.** Those are separate
  statements. The cache is keyed by `normalizeWorkspaceRoot`, so A→B→A between
  two open folders re-walks nothing and the second activation of A is a pointer
  swap. But `search`/`getAll`/`searchDirectories`/`fileCount`/`indexedRoot` all
  answer from the active entry ALONE — a union across folders would be the
  cross-workspace leak TASK_2026_200 exists to prevent. `ensureReadyFor` sets the
  active key SYNCHRONOUSLY, before any await, because
  `ContextService.assertIndexServes` reads `indexedRoot` in the same block as its
  query.
- **Eviction is by folder CLOSED, never by folder deactivated.** The one signal
  is `onDidChangeWorkspaceFolders` diffed against `getWorkspaceFolders()`; an
  empty list is treated as "no information" (the CLI reports none permanently).
  An inactive folder KEEPS ITS SUBSCRIPTION, which is what keeps its snapshot
  fresh enough to reuse (re-arming the old per-folder chokidar watcher readdirp-
  walked every directory, and that burst was the lag run behind each "Ready"
  line). An LRU cap (8) bounds hosts that pass
  ad-hoc roots the provider never lists; the active folder is never evicted.
  **The cap is SOFT, and enforced against `getWorkspaceFolders()` — not just
  against `lastActiveAt`.** `evictOverflow` skips every entry the provider still
  lists as open, so a genuine 9-root workspace holds nine entries and simply
  exceeds the cap. A hard LRU would reinstate this whole task's bug one level up:
  activating the 9th folder would dispose the least-recently-used OPEN folder's
  live watcher and clear its snapshot, so cycling across the nine re-walks on
  almost every switch — the alternating-eviction thrash the autocomplete cache
  above already fixed once at N=2.
- **The walk is PATH-ONLY, batched and yielding.** It consumes
  `WorkspaceIndexerService.discoverWorkspacePaths`, not `indexWorkspaceStream`:
  no `stat`, no `readFile`, no classification, ignore rules compiled once via
  `IgnorePatternResolverService.compileMatcher`, and a `setImmediate` between
  batches. `indexWorkspaceStream` still exists for consumers that want the stat +
  classification; do not point the index back at it. `compileMatcher` must keep
  answering exactly what `isIgnored` answers — the table test in
  `ignore-pattern-resolver.service.spec.ts` compares them on the same inputs.
- **Live updates are batches from `IWorkspaceWatcher`; lost events rebuild
  once** (TASK_2026_437 C10, INV-1, INV-6). Each folder holds one
  `PLATFORM_TOKENS.WORKSPACE_WATCHER` subscription (Electron and CLI: the
  `@parcel/watcher` watch host; VS Code: its own watcher behind the coalescer).
  Exclusion, storm breaking and coalescing happen where the events are
  produced: the subscription passes `DEFAULT_WORKSPACE_EXCLUDES` as globs,
  `NESTED_WORKSPACE_PATH_RULES` as segment rules, `nestedRepoDetection`, and the
  nested roots the walk skipped (below). This side does no per-event work: one
  synchronous pass per batch — deletes drop entries (a deleted directory drops
  everything below it in one sweep while the folder holds at most 5,000
  entries; above that the batch counts as incomplete and rebuilds instead), and
  a path not yet indexed is matched against the default excludes and the
  folder's ignore rules, compiled ONCE per build with `compileMatcher`, before
  the survivors are statted (a batch does not say file or directory). Every map
  key, file or directory, goes through `toIndexKey` (normalized separators, no
  trailing separator, upper-case drive letter), so the walk's `D:/…` and the
  watcher's `d:\…\` are one entry. An `overflow` or `truncated` batch runs ONE
  path-only rebuild with the subscription kept: the walk fills a staging
  snapshot while queries keep serving the previous one, live batches land in
  both, and success swaps it in synchronously. A failed rebuild keeps the
  previous snapshot; any number of overflows arriving mid-rebuild queue exactly
  one more (a degraded adapter repeats `overflow` every 60 s), which runs even
  if the current one fails. A `watch()` that throws leaves the folder static
  only until a later `ensureReadyFor` retries it (at most once a minute, no
  timer); a successful retry rebuilds once.
- **Query before the first build: nothing, never a partial list** (FU-4c).
  `search`/`getAll`/`searchDirectories` answer from the active folder only once
  its first build completed. The contract is that callers await
  `ensureReadyFor` first — all three production call sites do, in
  `ContextService.searchFiles`/`getAllFiles`/`getFileSuggestions` — and the gate
  keeps a caller that forgets from reading a half-walked folder.
- **Nested repositories never enter the index** (TASK_2026_437 D4).
  `WorkspaceIndexerService.discoverFiles` (every walk: the picker, `indexWorkspace*`,
  `getFileCount`) drops any directory below the root holding a `.git` entry — a
  repository's directory or a worktree's pointer file, which also covers every
  worktree git registers under the root without spawning git. One existence
  check per directory that holds a discovered file, one depth level at a time,
  nothing probed below a root already found. `discoverWorkspacePaths` reports
  the roots through `onNestedRepoRoots`; the file index seeds its subscription
  with them, because a repository that already exists produces no `.git` event
  for the watcher to detect.

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
- **One worker per COMPILER**, keyed by resolved `typescript` module path, each
  `unref`'d while idle and `ref`'d while a run is outstanding, terminated after
  60 s idle. Requests need no queue: the compile is synchronous inside the
  worker, so a second message waits in the worker's own queue. Ids correlate
  replies. A single process-wide worker was wrong once TypeScript began
  resolving from the workspace: two roots on different compiler versions made
  each spawn tear down the other's worker, so an arriving second root rejected
  the first root's still-running compile (TASK_2026_325).
- **Single-flight per root plus a 5 s per-root result cache.** The core prompt
  tells every agent to call this tool, so three agents in one session call it in
  a burst; they share one compile, and a repeat inside the TTL pays nothing. The
  cache is keyed by resolved root and LRU-capped at 8 — never a single slot.
  Only COMPLETED checks are cached: an `unavailable` result is not, so one
  transient worker death cannot answer for the whole window. The window is
  short because the cache has no other change signal — the newest `mtimeMs`
  across a monorepo's source roots costs the full walk the cache exists to
  avoid — and `invalidate(root?)` lets a caller that just wrote say so.

- **`getDiagnostics(root, scope)` takes an optional file scope, and the caller
  is expected to use it.** Unscoped means "compile every discovered project",
  which on this repository is 297 `tsconfig*.json` files — measured at over
  400 s with no response returned at all, past the worker's own 300 s
  wedge-breaker and past any MCP client's timeout. A scoped call walks UP from
  each file with `readDirectory` until it finds a directory holding
  `tsconfig*.json`, and compiles those. No glob, no workspace walk, 3-4 programs
  instead of 297. `ptah_get_diagnostics` exposes it as `files` and its tool
  description tells the model to pass the files it just changed.

  Three rules make the scope safe rather than merely fast. **It is a floor, not
  a filter**: every diagnostic from the owning project is returned, including
  ones in sibling files, because a break the caller's edit caused next door is
  the whole reason it asked. **The cache and single-flight keys include the
  scope** — keyed by root alone, one scoped clean answer would be served to the
  next whole-workspace call, which is `available` over coverage never taken.
  **A scope that named files and kept none is refused**, never widened: falling
  back to the whole workspace would hand a caller avoiding the 400 s compile
  exactly that compile, and answer about files this root does not contain.
  Taking every config in the owning directory rather than picking one is also
  deliberate — deciding which one covers a file needs the
  `include`/`exclude`/`extends` chain resolved, which only the compiler can do,
  and a wrong guess drops coverage silently.

- **`RESULT_BUDGET_MS` (45 s) answers the caller; it does not cancel the run.**
  Every other timeout in this path is a wedge-breaker owned by the worker, so
  nothing was answerable to the person holding the request — the 400 s
  measurement above returned no result and no reason, and the client gave up
  first. The budget resolves `unavailable` with a sentence naming the `files`
  escape hatch. The compile keeps its thread and writes the cache when it lands,
  so the retry that reason string asks for is normally instant and complete.
  Do NOT "fix" this by dropping the run from `inFlight` on expiry: every retry
  would then start a second full compile beside the first.

A dead, timed-out or throwing worker reports `unavailable`, never `available`
with zero diagnostics. `available` + `[]` must only ever mean "checked, and
clean" (TASK_2026_299 / TASK_2026_301). A run that is merely STILL GOING is
`unavailable` for the same reason — it has not been checked yet.

**A config that failed to compile is part of that rule, not an exception.** The
worker returns a structured `ConfigFailure` per config it could not process, and
the provider folds each one into `diagnostics` as an error entry ON the tsconfig
that failed, ahead of the compiled findings — the same thing `tsc -b` does.
Reporting it any other way loses it: the sole consumer,
`buildDiagnosticsNamespace` (`vscode-lm-tools`), rebuilds the payload as
`{status, source, diagnostics}` and drops every sibling field, so a `partial`
flag beside the union would never reach the caller. Before this, one clean
config beside one malformed config rendered as "No issues found"
(TASK_2026_325).

**Hand `readConfigFile` a forward-slashed path.** On Windows `ts.readConfigFile`
normalizes internally and then asserts the parsed file name still matches, so an
OS-native path made every MALFORMED tsconfig throw
`Debug Failure. Expected C:/x/tsconfig.json === C:\x\tsconfig.json` instead of
returning its diagnostic — which the outer catch then reported as a generic
processing failure. Same for `parseJsonConfigFileContent`.

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
