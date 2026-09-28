# Batch 9b executor report — background dependency-graph build, non-blocking tools

Executor: backend-developer (sub-agent). Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.
No git staging or commits were made. `batches.md` and `task.md` were not edited.

## Task 9b.1 — background build with a per-workspace in-flight latch: COMPLETE

### Governor API verification (the batch ASSUMPTION)

`libs/backend/vscode-core/src/diagnostics/background-work-governor.ts` does **not** accept jobs: it is an admission
signal only ("It does no work, holds no queue of its own beyond `whenClear` waiters"). Adopters call `isClear()` /
`whenClear({ lane, maxDeferMs, signal })` before each unit of work (`CodeSymbolIndexer.yieldToForeground`,
`code-symbol-indexer.service.ts:311`). The build is therefore wired the same way: a per-chunk yield inside
`DependencyGraphService.buildGraph`, injected as `@inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })`
exactly as the indexer does.

Deliberate difference from the indexer: each wait passes `maxDeferMs: 1_000`. With the governor's default 10-minute
ceiling per wait, an in-app build started inside a generating turn (always `foreground-busy`) would take up to 250 ×
10 min; one second per chunk throttles it while the foreground is busy (the loop gets that second back) and still lets
the agent's retry succeed. Only the detached build yields (`yieldToForeground: true`); an awaited build (the
`execute_code` `ptah.dependencies.buildGraph` call) stays ungoverned, because a governed wait inside a generating turn
would make the turn wait for itself (the indexer's `userInitiated` rule).

### What changed

- `protocol-dispatcher.ts`: `ensureDependencyGraphBuilt` replaced by `ensureDependencyGraph` → `GraphReadiness`
  (`ready | building | failed | not-host-root`) and `graphNotReadyResponse`. Per-`PtahAPI` latch (`WeakMap`, keyed by
  host root) following the Batch 6 `startBackgroundRun` pattern: the job is put in the latch synchronously before the
  call yields, so concurrent cold calls share one build; it leaves the latch in `.finally` after its outcome is
  recorded. A cold call waits at most `GRAPH_BUILD_WAIT_MS = 1_500` for the build (a small workspace is answered on the
  first call), then returns `{ status: 'building', retryAfterMs: 15000, filesDiscovered?, message }`. Discovery
  (`findFiles`) runs inside the detached job too, so the bound covers it. All three call sites
  (`ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index`) use it. Batch 9 paging and cap disclosure
  are unchanged once ready.
- `dependency-graph.service.ts`: optional governor; `BuildGraphOptions.yieldToForeground`; per-root generation guard
  (global monotonic counter, entry dropped by `evict` / `retainOnly` / `clear`) so a build only publishes while its
  generation is still the root's.
- `analysis-namespace.builders.ts` + `types.ts`: `buildGraph` takes an optional 4th `options` argument forwarded to the
  service (`yieldToForeground` defaults to false).
- `tool-description.builder.ts`: the three tools' own descriptions explain `status: "building"`, `retryAfterMs` and
  retry (dependents/dependencies also `status "failed"`). No shared prompt constant touched.

### execute_code decision

The `execute_code` dependencies namespace does not share the cold auto-build path: `getDependencies`,
`getDependents`, `getSymbolIndex` read whatever graph exists and never build; only an explicit
`ptah.dependencies.buildGraph(...)` builds. That call **may await** and was left awaited and ungoverned: the caller
asked for the build and runs under `execute_code`'s own timeout; returning `building` would change the return shape of
a public API for callers who wait on it deliberately, and governing it would make the calling turn wait for itself. If
`execute_code` times out, the build continues and publishes under the generation guard (it cannot overwrite a newer
build).

### Risk handling

| Risk                                        | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unhandled rejection from the detached build | `Promise.resolve().then(build).catch(record+log).finally(clear latch)`; the catch body cannot throw (log wrapped in `runObserver`), the finally only touches a Map, so the chain never rejects                                                                                                                                                                                                                                                                                   |
| Eviction during an in-flight build          | `evict`/`retainOnly`/`clear` drop the root's generation; the in-flight build finishes unpublished; the job still leaves the latch; the next call rebuilds (spec: real service, evict mid-build)                                                                                                                                                                                                                                                                                  |
| Explicit rebuild during an in-flight build  | each `buildGraph` takes a new generation; the earlier-started build cannot publish over the later one (spec: `execute_code` build during a background build keeps the explicit graph; service spec: earlier build finishing later is discarded). A warm graph always answers first (`isBuilt` checked before the latch)                                                                                                                                                          |
| Failed build                                | namespace `{ error }` and rejections both count as failure → `job.failed` + `latch.failed`; waiting calls get `isError: true` `{ status: 'failed', error: <fixed text> }`; a call arriving later gets it once; the next call rebuilds. Latch cleared in `.finally`. Failed discovery is a failed build too                                                                                                                                                                       |
| Status JSON within budget, status first     | `{ status, retryAfterMs, filesDiscovered?, message }` ≈ 250 chars, no unbounded field; specs assert `Object.keys(body)[0] === 'status'` and length ≤ tool budget                                                                                                                                                                                                                                                                                                                 |
| Fixed-text logs                             | `'[MCP] background dependency-graph build failed'` with `{ errorName }` only; service `'…Superseded by a later build or an eviction; graph not published'` and `'[DependencyGraphService] background-work wait failed; building anyway'`; the namespace's raw error message is replaced by a fixed-text Error before it reaches the latch. Specs assert no path/raw text in the tool result or the warn call                                                                     |
| Host-owned roots only (Batch 2f F1)         | `resolveGraphBuildRoot`: a caller-declared root is accepted only when it canonicalizes to exactly one of `deps.workspaceProvider.getWorkspaceFolders()` (reuses `findKnownWorkspaceFolder`), and the host's record is used; otherwise `isError` `{ status: 'unavailable' }` and nothing is discovered or built. Without a declared root the session-derived root (host records only) is used. Previously the caller-aware `ptahAPI.workspace.getInfo()` root was built unchecked |
| No work in `tools/list`                     | nothing added there                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Shared prompt constants frozen              | `ptah-core-prompt.ts`, `ptah-system-prompt.constant.ts` unchanged                                                                                                                                                                                                                                                                                                                                                                                                                |
| `from "<word>"` in string literals          | none added; validate-deps passes                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| New catches marked                          | `.catch` in `startGraphBuild` and the `catch` in `DependencyGraphService.yieldToForeground` carry `// degradation-audit: reported —` markers; audit stays at baseline                                                                                                                                                                                                                                                                                                            |

## Task 9b.2 — specs and descriptions: COMPLETE

- `protocol-dispatcher.spec.ts` — new describe "dependency graph background build (TASK_2026_559 Batch 9b)", run for
  each of the three tools (fake `setTimeout` only): cold call → `building` within the bound, status first, within
  budget, governed build under the host root; later call after the build resolves → real answer, one build; build
  finishing inside the wait → answered on the first call; 5 concurrent cold calls → one `findFiles`, one `buildGraph`;
  warm graph → answered with no timer and no build; failing build → `failed` (fixed text, no path) then the next call
  rebuilds; failure between calls reported once then rebuild; failed discovery → `failed`; undeclared-by-host root →
  `unavailable`, no discovery/build. Plus: real-time bound (never-resolving build returns `building` in ≤ 2,000 ms),
  declared root that the host opened builds under the host record, and two real-`DependencyGraphService` specs
  (eviction mid-build; explicit rebuild during a background build). The existing "builds from ABSOLUTE paths" spec
  now models a small workspace (built inside the wait) and expects the 4th `{ yieldToForeground: true }` argument.
- `analysis-namespace.builders.spec.ts` — the discovered-count spec expects the options argument; new spec: the
  namespace forwards `yieldToForeground` only when set.
- `dependency-graph.service.spec.ts` (not in the batch file list; added because the service changed) — no publish
  after `evict` / `retainOnly` / `clear` mid-build; later-started build wins; governor waited on per chunk only when
  yielding (`lane: 'dependency-graph'`, `maxDeferMs: 1000`); governor `AbortError` stops the build; a defective
  governor warns once with fixed text and the build completes.
- `tool-description.builder.spec.ts` — all three descriptions name `status: "building", retryAfterMs` and the retry,
  stay under the 1,000-char budget; dependents/dependencies name `status "failed"` and "calling again rebuilds".

## Verification (tailed)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`
  → `Successfully ran targets test, lint, typecheck for 2 projects`
  - focused: `protocol-dispatcher.spec.ts` 200 passed; `dependency-graph.service.spec.ts` 32 passed;
    dispatcher + description + namespace specs 298 passed
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `All external imports are covered by package.json dependencies.` / success
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)` (the two vscode-lm-tools sites are the pre-existing
  `getDependencies`/`getDependents` catches)
- `prettier --check` on the 9 changed files → `All matched files use Prettier code style!`

## Deviations

1. Files outside the 9b.1/9b.2 lists: `types.ts` (`DependenciesNamespace.buildGraph` gains the optional `options`
   argument, needed to carry `yieldToForeground` from the dispatcher to the service) and
   `dependency-graph.service.spec.ts` (regression specs for the service change).
2. The governor is used as a per-chunk admission yield with a 1 s ceiling (it cannot take a job); see above.
3. Behaviour change: a caller-declared root that is not a host-opened folder now gets `status: 'unavailable'` instead of
   a graph built under it (Batch 2f F1). A client whose declared root is e.g. a worktree the host did not open loses
   these three tools until the host opens that folder.
4. A workspace with no source files now builds (and caches) an empty graph instead of re-running discovery on every call.

## Out-of-scope observations

- `protocol-dispatcher.spec.ts` prints "Jest did not exit one second after the test run has completed" — pre-existing:
  it also appears with every Batch 9b spec excluded (`-t "^(?!.*Batch 9b)"`).
- The `execute_code` `getDependencies`/`getDependents`/`getSymbolIndex` answer `[]` from no graph when none is built
  (pre-existing; they never build). Worth a `building`-style hint in a later batch.
- `resolveDependencyQueryPath` still joins relative query paths with the caller-aware root; with a declared root that
  canonically equals a host folder but is spelled differently (case, trailing separator), multi-graph prefix routing
  could miss. The single-graph case is unaffected.

## Revision round 1 (review `reviews/batch-9b-code-logic-review-r1.md`, REVISE 4/10)

### Fix per finding

- **F1 (blocking) — discovery outside the generation fence.** `DependencyGraphService` gains `reserveBuild(root)`
  (a new generation, taken now), `getBuildState(root)` (`{ generation, building }`) and `BuildGraphOptions.generation`
  (a build runs under a reservation instead of taking a new generation). The namespace exposes them as
  `reserveGraphBuild` / `getGraphBuildState` and forwards `generation`. The dispatcher reserves the job's generation
  synchronously in `startGraphBuild`, before discovery; after discovery it builds nothing if the reservation is no longer
  the root's, and the service publishes only while it is. Explicit `buildGraph` calls and `evict` / `retainOnly` /
  `clear` supersede that same generation. A superseded background build stops parsing at its next file.
- **F2 (blocking) — permanent empty graph.** A background build that published an empty graph records the root in the
  latch's `empty` set. While the root's graph is still that empty snapshot (coverage `discoveredFiles === 0`), each call
  rediscovers through the normal bounded path: the empty snapshot answers unless the refresh found files and is still
  parsing them (`building`). An explicit non-empty build clears the mark.
- **F3 (serious) — CPU parsing delays the timer.** (a) The job's work starts on a later macrotask (`setImmediate`), so
  the call's bounded-wait timer is armed first; only the cheap generation reservation runs synchronously. (b) A
  background build parses one file at a time with a `setImmediate` yield before every file (a governor admission still
  precedes each 20-file chunk), and edge linking yields every 10 ms. The awaited `execute_code` build keeps its parallel
  chunks and never yields on purpose. (c) Governor check unchanged. Follow-up (not done this round, as instructed): a
  single huge file whose synchronous Tree-sitter parse alone exceeds the bound still delays the response by that parse's
  duration; moving parsing to a worker thread would remove this.
- **F4 (serious) — unopened worktrees refused.** `resolveGraphBuildRoot` and the `not-host-root` / `unavailable` answer
  are removed. The graph read root is `ptah.workspace.getInfo().path`, the caller-aware root every other read tool uses
  (declared root, caller session, active session, host folder); discovery (`search.findFiles`) and relative queries
  (`resolveDependencyQueryPath`) resolve against the same root, and the service normalizes graph keys. The latch is keyed
  by the normalized read root (`graphRootKey`: forward slashes, no trailing slash). Spool writes keep `resolveSpoolRoot`
  (Batch 2f F1) unchanged.
- **F5 (serious) — eviction leaves the latch set.** Each call compares its latched job's generation with
  `getGraphBuildState(root).generation`; an obsolete job (evicted or rebuilt) is dropped from the latch at once, so a stuck
  read cannot hold the root. A job records its outcome (`failed`, `empty`) and clears the latch only while it is still the
  latch's job, so a late completion or failure of an obsolete job cannot touch its replacement. A recorded failure whose
  generation was superseded before any call reported it is dropped. When the root's current generation is a running
  build that is not the dispatcher's own (an awaited `execute_code` build), the call answers `building` (or the empty
  snapshot) instead of superseding it.

### Kept

Status JSON unchanged (`status` first; `building` / `failed` only); fixed-text logs unchanged; no new catch (the one
`.catch` stays marked `reported`); no `from "<word>"` in a string literal; `ptah-core-prompt.ts` and
`ptah-system-prompt.constant.ts` untouched; the explicit `execute_code` `buildGraph` still awaits and returns its summary.

### Files

- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts` — `reserveBuild`, `getBuildState`,
  `GraphBuildState`, `BuildGraphOptions.generation`; `buildGraph` split into `parseAwaited` / `parseInBackground` /
  `parseFile` / `linkNodes` / `publish`; running-generation set.
- MODIFIED `libs/backend/workspace-intelligence/src/index.ts` — exports `GraphBuildState`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` — `reserveGraphBuild`, `getGraphBuildState`,
  `buildGraph` option `generation`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts` — the
  two methods; forwards `generation` only when set.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` — one
  help line for the two methods (not a frozen constant).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` — lifecycle above.
- MODIFIED specs: `dependency-graph.service.spec.ts`, `analysis-namespace.builders.spec.ts`, `protocol-dispatcher.spec.ts`.

### Regression specs

`protocol-dispatcher.spec.ts` (describe "dependency graph background build (TASK_2026_559 Batch 9b)"):

- F1: "does not build or publish when the root is evicted while discovery is pending"; "keeps an explicit build made
  while discovery is pending" (both pause `findFiles`; real service).
- F2: "finds a source file created after an empty graph was built" (real service; empty, then a file, then `total: 1`).
- F3: "answers within the bound while every file costs synchronous CPU, and the host keeps ticking" (real timers, real
  service, 40 files x 130 ms synchronous parse, 10 ms heartbeat: call <= 2,000 ms, max heartbeat gap < 650 ms, build
  stopped by eviction).
- F4: "builds and answers under a declared worktree root the host did not open" (all three tools); "keys the latch by
  the normalized read root: two spellings share one build".
- F5: "starts a replacement build after an eviction while the old read never settles" (real service, read stuck
  forever); "replaces a job obsoleted by an eviction, and ignores its late failure"; "does not report the failure of a
  build an eviction superseded".
- Removed: "refuses to build under a declared root the host did not open" and "builds under the host record of a
  declared root the host opened" (they pinned the reverted restriction). Fake-timer helpers now flush real
  `setImmediate`s before advancing the clock, since the build starts on a later macrotask.

`dependency-graph.service.spec.ts` (describe "reserved generations and host yielding (TASK_2026_559 Batch 9b r1)"):
publishes under a current reservation; never publishes a reservation superseded by a later build / an eviction; reports
a running build; stops parsing a superseded background build; lets host timers run between files (at most two 20 ms
parses without a timer tick).

`analysis-namespace.builders.spec.ts`: "forwards a reserved generation, and reserves and reads build state from the
service".

### Verification (tailed)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`
  → `Successfully ran targets test, lint, typecheck for 2 projects` (focused: Batch 9b describe 38 passed; service spec
  38 passed)
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `All external imports are covered by package.json dependencies.`
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`; `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`
- `prettier --check` on the 9 changed source/spec files → `All matched files use Prettier code style!`

### Deviations

1. The namespace (public to `execute_code`) gains `reserveGraphBuild` / `getGraphBuildState`: the dispatcher reaches the
   graph service only through it, and the reservation must be synchronous so no eviction can fall between the job's
   creation and its generation. Documented in the namespace help.
2. Empty-graph freshness uses rediscovery on each call against an empty snapshot (the reviewer's "restore retry"
   option) rather than a timed expiry; the latch still shares one refresh between concurrent calls.

## Revision round 2 (bounded correction after r2, REVISE 6/10)

Scope: exactly R2-B1, R2-M2, R2-M1 from `reviews/batch-9b-code-logic-review-r2.md`. Every round-1 invariant kept.

### Fix per finding

- **R2-B1 (blocking) — empty snapshot answered while a refresh/replacement is pending.**
  `protocol-dispatcher.ts:2451-2455`: when the root's current build is running and is not the dispatcher's job, the
  call answers `building` whether or not an empty snapshot exists (was `ready` for an empty snapshot).
  `protocol-dispatcher.ts:2473-2476`: after the bounded wait, an empty snapshot answers `ready` only when the refresh
  has ended or its discovery settled with 0 files (`job.filesDiscovered !== 0` replaces `(job.filesDiscovered ?? 0) > 0`,
  so an unknown discovery count is no longer read as zero). A non-empty warm graph still answers before any timer;
  concurrent calls still share one latched refresh.
- **R2-M2 (moderate) — obsolete job's outcome reaches its waiting caller.** `protocol-dispatcher.ts:2460-2466`: after
  the wait, the job's generation is compared with `getGraphBuildState(root).generation`; if superseded, the call is
  answered by the new `currentGraphReadiness` (`protocol-dispatcher.ts:2494`) with no second wait: no graph →
  `building`; a built non-empty graph → `ready`; the empty snapshot → `building` while a running build or a live latched
  job of the current generation may replace it, else `ready`. The catch (`protocol-dispatcher.ts:2588-2599`) records
  `job.failed` / `latch.failed` only while the job's generation is still the root's (plus the existing latch-identity
  guard). No new catch; the existing `// degradation-audit: reported —` marker is unchanged.
- **R2-M1 (moderate) — no yield inside one node's import loop.** `dependency-graph.service.ts:367-414`: `linkNodes`
  takes `isCurrent` (background builds only, `:229`) instead of a boolean; `continueLinking` (`:387`) checks the
  10 ms slice before every node (`:402`) and every import (`:407`), yields with `setImmediate` inside the `for…of`
  (iterator position kept), and after each yield stops if the generation was superseded, returning the partial graph,
  which `buildGraph` does not publish. The awaited (`execute_code`) path passes `undefined` and never yields, as before.
  The node's edge set is registered before its imports are linked (same contents and order when linking completes).

### Regression specs (each failed on the pre-fix code, passes after)

Run before the fix: the dispatcher spec file reported `3 failed, 207 passed` (exactly the three below) and the service
spec file `2 failed, 38 passed` (exactly the two below). After the fix: `210 passed` and `40 passed`.

- `protocol-dispatcher.spec.ts`, describe "dependency graph background build (TASK_2026_559 Batch 9b)" › "with the real
  graph service":
  - (a) "answers building, not the empty graph, while its refresh is still discovering" (`:5021`)
  - (b) "answers building while an explicit build replaces the empty graph" (`:5047`)
  - (c) "answers a caller waiting on a superseded discovery from the newer graph when that discovery fails" (`:5084`)
- `dependency-graph.service.spec.ts`, describe "DependencyGraphService — edge linking inside one node (TASK_2026_559
  Batch 9b r2)" (1,000 unresolved relative imports in one node; `Date.now` advances 1 ms per read; `setImmediate`
  heartbeat):
  - "lets host timers run while one import-heavy node is linked" (`:681`) — a heartbeat tick falls between that node's
    first and last linked import
  - "stops linking a superseded background build mid-node" (`:704`) — eviction from the heartbeat stops linking with
    fewer than 1,000 imports linked; nothing published

### Verification (tailed)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`
  → header "for 2 projects"; `Successfully ran targets test, lint, typecheck for 2 projects` (focused: dispatcher spec
  210 passed; service spec 40 passed)
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `All external imports are covered by package.json dependencies.`
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`; `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`
- `prettier --check` on the 4 changed files → `All matched files use Prettier code style!`

### Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts`

### Deviations

None. Kept: status JSON shape (`status` first, `building` / `failed` only); fixed-text logs; no new catch; no
`from "<word>"` in string literals; shared prompt constants and `NATIVE_AGENT_TOOL_POLICY` untouched; nothing added to
`tools/list`; Batch 9 paging and cap disclosure unchanged. Note: the catch's generation read calls the namespace's
`getGraphBuildState` (a synchronous map lookup in the service); it was not wrapped in a new catch, to keep the audit at 300.

## Revision round 3 (R3-S1, User Decision 16 — no further review)

Scope: R3-S1 only (`reviews/batch-9b-code-logic-review-r3-postcap.md`). R2-B1 / R2-M2 / R2-M1 behaviour and specs kept.

### Fix

`protocol-dispatcher.ts`:

- `GraphBuildJob.delivered` — set once a call answered `ready` from that job's result (set at `:2499`, the waiter's
  ready return).
- `GraphBuildLatch.empty` is now `Map<root, GraphBuildJob>` (was `Set`): the job that published the empty graph, so the
  mark carries its generation (`:2606`).
- `:2440-2454`: before starting a refresh, an empty snapshot whose publishing job was never delivered is answered
  `ready` once and marked delivered, only while that job's generation is still the root's, no build is running
  (`getGraphBuildState().building === false`) and no job is latched. Supersession or eviction changes the generation and
  invalidates the mark; a pending replacement or foreign build still answers `building`. The call after the delivery
  rediscovers as before (empty-to-first-source path unchanged). A fast empty build answered inside the wait is already
  delivered, so it does not suppress the next rediscovery.

No new catch; status JSON, fixed-text logs and all other invariants unchanged.

### Regression spec

`protocol-dispatcher.spec.ts` (Batch 9b describe › "with the real graph service", `:5085`): "delivers a slow empty build
to the next call, then rediscovers" — discovery resolves `[]` after the wait → first call `building`; after it finishes
the next call (with later discoveries held) → no `status`, `total: 0`, `findFiles` called once; the following call
rediscovers (`findFiles` twice) and answers `building` while that rediscovery is pending.

Before the fix: `1 failed, 210 passed` (this spec; `Expected path: not "status"`, `Received value: "building"`).
After: `211 passed`. "finds a source file created after an empty graph was built" and the R2 delayed-refresh /
foreign-build / superseded-waiter specs pass.

### Verification (tailed)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`
  → header "for 2 projects"; `Successfully ran targets test, lint, typecheck for 2 projects`
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `All external imports are covered by package.json dependencies.`
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`; `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`
- `prettier --check` on the 2 changed files → `All matched files use Prettier code style!`

### Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`

### Deviations

None.
