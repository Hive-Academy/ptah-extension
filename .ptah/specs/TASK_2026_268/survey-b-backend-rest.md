# Survey B — remaining backend libs (13 files)

TASK_2026_268, partition B. Read-only assessment. No code changed.

Method: `ptah_ast_analyze` for structure on all 13, targeted `Read` only on the
regions that decide a verdict (constructors, the one giant method, the region a
proposed cut would move). Lib `CLAUDE.md` read for `vscode-core`,
`vscode-lm-tools`, `agent-generation`, `cli-agent-runtime`, `agent-sdk`,
`messaging-gateway`, `auth-providers`.

---

## Ranked table

| #   | File                                                                | LOC  | Classification                                               | Verdict                                                                                                                                                                                                                                                             | Effort                                                              |
| --- | ------------------------------------------------------------------- | ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `agent-sdk/.../helpers/sdk-query-options-builder.ts`                | 1296 | Facade (DI class) + shared-function extraction               | **Real seam, and the file already violates guardrail 3 by 13.** 21 ctor deps; 14 of them are hook handlers touched by ONE private method. Separately, four exported pure functions that `cli-agent-runtime` depends on are buried in a file named "options builder" | S–M, behaviour-preserving                                           |
| 2   | `vscode-core/src/services/git-info.service.ts`                      | 2194 | Facade (DI token `GIT_INFO_SERVICE`)                         | **Real seam.** A complete diff/patch/hunk-apply engine (~1080 lines, own snapshot-token protocol, own error taxonomy, own rollback) lives inside a service whose other half is `git <cmd> --porcelain` wrappers                                                     | M–L, behaviour-preserving w/ security review                        |
| 3   | `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts`               | 1799 | Handler split by namespace (deps are a plain object, not DI) | **Real seam.** `handleIndividualTool` is a 47-case switch spanning lines 480–1560; the cases are already grouped by MCP namespace in source order                                                                                                                   | M, behaviour-preserving                                             |
| 4   | `agent-generation/.../user-layer/user-layer-mirror.service.ts`      | 1642 | Facade (DI class, ONE injected dep)                          | **Real seam.** Five distinct protocols (mirror / reconcile / history+revert / rebase+keep / user-layer writes) share nothing but a logger and a slug lock                                                                                                           | M, behaviour-preserving                                             |
| 5   | `cli-agent-runtime/.../cli-agents/agent-process-manager.service.ts` | 1413 | Facade (DI class)                                            | **Real seam.** A stateful output-accumulation subsystem (its own Maps, flush timers, caps) is inlined into a process supervisor                                                                                                                                     | M, behaviour-preserving                                             |
| 6   | `cli-agent-runtime/.../ptah-cli/ptah-cli-registry.ts`               | 1149 | Facade (DI class, 13 ctor deps)                              | **Real seam.** ~340 lines of provider auth-env / proxy / tier construction inside an agent-CRUD + spawn registry                                                                                                                                                    | M, needs care — touches the documented output-style spawn invariant |
| 7   | `agent-generation/.../services/orchestrator.service.ts`             | 1188 | Facade (DI class, 12 ctor deps)                              | **Real seam, moderate.** Phase 3 (render+validate+fallback) and the project-context detectors are two coherent lumps; the orchestration itself is thin                                                                                                              | M, behaviour-preserving                                             |
| 8   | `messaging-gateway/src/lib/gateway.service.ts`                      | 1178 | Facade (DI class, 14 ctor deps)                              | **Partly incidental.** It is a façade _by design_ and already delegates to 3 stores + 3 adapters + coalescer + command service. One honest seam: secret/config resolution. Voice residue is small                                                                   | S–M, behaviour-preserving                                           |
| 9   | `agent-generation/.../enhanced-prompts/enhanced-prompts.service.ts` | 1155 | Facade (DI class)                                            | **Real but modest seam.** ~310 lines of pure input/summary composition + ~145 lines of SDK stream driving around a thin state machine                                                                                                                               | M, behaviour-preserving                                             |
| 10  | `auth-providers/src/lib/provider-models.service.ts`                 | 1165 | Facade (DI class) — **defer**                                | **Length is mostly load-bearing.** Three roles, but the big one (tier derivation/writing) is the subject of a just-landed fix and is documented as "ONE accessor, four sites". Only the pricing role (~190 lines) is safely separable                               | S for pricing only; the tier cut is NOT a size refactor             |
| 11  | `vscode-lm-tools/.../mcp-core/tool-description.builder.ts`          | 1717 | **EXEMPT standalone** — rider on #3                          | 51 independent literal builders, zero interleaving, zero shared state. Splitting alone is relocation. Worth doing _only_ in the same change as #3, using the same namespace grouping                                                                                | S as a rider                                                        |
| 12  | `vscode-lm-tools/.../mcp-core/mcp-response-formatter.ts`            | 1162 | **EXEMPT standalone** — rider on #3                          | 29 independent pure formatters. Same reasoning as #11                                                                                                                                                                                                               | S as a rider                                                        |
| 13  | `vscode-lm-tools/.../code-execution/types.ts`                       | 1617 | **EXEMPT** (type barrel)                                     | It is the `PtahAPI` contract barrel. Everything in it is the same role. Splitting buys import churn and a second place to look for one API surface. A drain already exists and needs no task — see the file's section                                               | —                                                                   |

**Exempt: 3** (one unconditional type barrel, two conditional riders on #3).

---

## 1. `sdk-query-options-builder.ts` (1296) — agent-sdk

**Full path**: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

### Classification

Facade — `SdkQueryOptionsBuilder` is `@injectable()` and resolved through
`SDK_TOKENS`; keep the class, its name and `build()`'s signature.

### Verdict — two seams, both real

**Seam A (the big one).** The constructor takes **21 injected dependencies**
(lines 511–553). Fourteen of them —
`subagentHookHandler`, `compactionHookHandler`, `worktreeHookHandler`,
`postToolUseHookHandler`, `userPromptSubmitHookHandler`,
`userPromptExpansionHookHandler`, `stopHookHandler`, `stopFailureHookHandler`,
`sessionEndHookHandler`, `toolFailureHookHandler`, `preToolUseHookHandler`,
`sessionStartHookHandler`, `subagentStopHookHandler`,
`teammateLifecycleHookHandler` — are referenced by exactly one method,
`createHooks` (1196–1295), which calls `.createHooks(...)` on each and merges the
results into one `Partial<Record<HookEvent, HookCallbackMatcher[]>>`.

This is not "the file is long". Guardrail 3 in `context.md` names constructor
params as _the real gate_ at ~8; this file is at 21 and every future hook event
adds a 22nd. The concern has an obvious noun: assembling the SDK lifecycle hook
map.

**Seam B.** Lines 86–341 are module-level _exported_ pure functions —
`buildModelIdentityPrompt`, `getActiveProviderId`, `assembleSystemPrompt`
(+ `AssembleSystemPromptInput`, `SystemPromptAssemblyResult`,
`UNRESOLVED_MODEL_IDS`). Their own docblock says "Shared function used by
SdkQueryOptionsBuilder **and PtahCliAdapter**" — i.e. a documented cross-lib
role, reached from `cli-agent-runtime` through the `@ptah-extension/agent-sdk`
barrel, sitting inside a file named for one of its two callers. That is the
TASK_2026_256 shape exactly.

Concerns actually mixed: hook assembly; system-prompt assembly (shared); output-
style flag settings; base-URL/model-availability validation; MCP server map
construction; beta flag construction; the `build()` orchestration itself.

### Proposed cut

1. **`libs/backend/agent-sdk/src/lib/helpers/sdk-lifecycle-hook-assembler.ts`**
   — new `@injectable() SdkLifecycleHookAssembler`, new
   `SDK_TOKENS.SDK_LIFECYCLE_HOOK_ASSEMBLER`. Takes the 14 hook handlers, exposes
   `createHooks(cwd, sessionId, { onCompactionStart, onWorktreeCreated,
onWorktreeRemoved })` — the body of 1196–1295 verbatim, including the
   diagnostic `logger.info` (it is the only evidence of which hook events wired
   up, do not drop it). **≈ 200 lines** (14 imports + ctor + method + doc).
2. **`libs/backend/agent-sdk/src/lib/helpers/session-prompt-assembly.ts`** —
   lines 86–287 moved verbatim (`UNRESOLVED_MODEL_IDS`,
   `buildModelIdentityPrompt`, `getActiveProviderId`, `assembleSystemPrompt` and
   its two interfaces). **≈ 200 lines.** Re-export from
   `helpers/index.ts` so `@ptah-extension/agent-sdk`'s public surface is byte-
   identical for `cli-agent-runtime`.

**Leave in place**: `assertSingleOutputStylePath` + `buildFlagSettings`
(289–341, 53 lines). Guardrail 2 forbids a ~60-line file created to satisfy a
ceiling, and `buildFlagSettings` is called by `build()` directly.

**Facade retains**: `build()`, `resolveContextWindowOverride`,
`warnIfForkOptionsDroppedSilently`, `validateBaseUrlForProvider`,
`isProfiledCrossProvider`, `validateModelAvailability`, `buildBetas`,
`buildSystemPrompt`, `buildMcpServers`, `mergeMcpOverride`, `calculateMaxTurns`

- the flag-settings pair.

**Resulting sizes**: builder ≈ 900, hook assembler ≈ 200, prompt assembly ≈ 200.
**Constructor drops 21 → 8** (logger, permissionHandler, compactionConfigProvider,
authEnv, modelService, memoryPromptInjector, codeSymbolPromptInjector, hookAssembler).

### Risk

- The hook merge order in the `for (const hooks of [...])` loop determines
  matcher order per event. Preserve the array order literally.
- `SDK_TOKENS` gains one entry; `di/register.ts` gains one registration. Any host
  that constructs `SdkQueryOptionsBuilder` by hand (check `cli-engine/container.ts`
  and the Electron container) must be updated — DI-resolved sites are free.
- Seam B must keep the barrel export or `cli-agent-runtime`'s
  `import { buildFlagSettings } from '@ptah-extension/agent-sdk'` breaks; the lib's
  own CLAUDE.md calls that "the one builder".

### Effort

**S–M**, behaviour-preserving. Two mechanical moves; no logic edits.

---

## 2. `git-info.service.ts` (2194) — vscode-core

**Full path**: `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts`

### Classification

Facade — DI token `TOKENS.GIT_INFO_SERVICE` (`di/tokens.ts:166`), exported from
`vscode-core/src/index.ts:84`, consumed by `rpc-handlers/git-rpc.handlers.ts`,
`agent-sdk/helpers/worktree-hook-handler.ts`, and `cli-engine/container.ts:278`.

### Verdict — a real seam, and it is the largest one in the partition

Three unrelated bodies of work share one class:

- **Repo interrogation** (155–292, 1602–2192, ≈ 750 lines): `getGitInfo`,
  worktrees, branches, tags, remotes, stash, last commit, plus `parseBranchInfo`,
  `parseFileStatus`, `mapStatusCode`, `parseBranchRefLine`. Thin `execGit` wrappers
  over porcelain output.
- **Working-tree mutation** (298–504, 1757–1800, ≈ 250 lines): stage, unstage,
  discard, commit, push, checkout.
- **A diff/patch/hunk-apply engine** (511–1592, ≈ 1080 lines): `showFile`,
  `readBlob`, `diffFile`, `readPatch`, `splitPatch`, `parseHunkRefs`, `applyHunks`
  (333 lines on its own), `applyFailure`, `applyArgsFor`, `normalizeHunkSelection`,
  `writeIndexTree`, `restoreAfterFailedApply`, `parseApplyOffsets`,
  `readWorktreeBlob`, `resolveHeadSha`, `probeReadErrorCode`, `classifyExecError`,
  `gitReadError`, `computeSnapshotToken`, `describeRef`, `describeBlob`,
  `validatePaths`, `validatePathSegment`.

The third body is not "more git commands". It has its own **snapshot-token
protocol** (`diffFile` issues a token, `applyHunks` refuses a stale one), its own
**error taxonomy** (`GitReadErrorCode`, `classifyExecError`, `probeReadErrorCode`),
its own **rollback** path (`writeIndexTree` + `restoreAfterFailedApply`), and its
own **injected-capability interfaces** already declared in this file at 101–132
(`WorktreeFileReader`, `WorktreeFileAccess`, `DiffFileRequest`,
`ApplyHunksRequest`). That is a subsystem with a documented contract living
inside a service named `GitInfoService`. `git-rpc.schema.ts:12,52` cites it by
method name as the security boundary — the role is documented outside the file
and still has no file of its own.

### Proposed cut

1. **`libs/backend/vscode-core/src/services/git-diff-apply.service.ts`** — new
   `GitDiffApplyService`, constructor `(logger: Logger)` mirroring the current
   one. Moves `showFile`, `readBlob`, `diffFile`, `readPatch`, `applyHunks`,
   `applyFailure`, `applyArgsFor`, `writeIndexTree`, `restoreAfterFailedApply`,
   `parseApplyOffsets`, `readWorktreeBlob`, `resolveHeadSha`,
   `probeReadErrorCode`, `classifyExecError`, `gitReadError`, plus the four
   request/capability interfaces at 101–132. **≈ 900 lines.**
2. **`libs/backend/vscode-core/src/services/git-patch-reader.ts`** — pure
   functions, no class: `splitPatch`, `parseHunkRefs`, `normalizeHunkSelection`,
   `computeSnapshotToken`, `describeRef`, `describeBlob`, `validatePaths`,
   `validatePathSegment`. **≈ 220 lines.** Both the facade and the apply service
   import it — which is required, because `validatePathSegment` is the shared
   path-traversal guard.
3. **`libs/backend/vscode-core/src/services/git-repo-query.service.ts`** —
   `getBranches`, `parseBranchRefLine`, `getTags`, `getRemotes`, `stashList`,
   `getLastCommit`, `parseBranchInfo`, `parseFileStatus`, `mapStatusCode`.
   **≈ 620 lines.**

**Facade retains**: `getGitInfo`, worktree add/remove/list, stage, unstage,
discard, commit, push, checkout, `isGitRepo`, `execGit`/`execGitBuffer`, and
thin delegations for `diffFile`/`applyHunks`/`showFile`/`readBlob` so every
existing caller signature survives. **≈ 480 lines**, constructor grows 1 → 3.

### Risk

- **`cli-engine/container.ts:278` constructs it by hand**:
  `new GitInfoService(c.resolve(TOKENS.LOGGER))`. Adding constructor params
  breaks that site silently at runtime, not at compile time if the factory is
  loosely typed. Update it in the same change.
- `validatePathSegment` is named in `git-rpc.schema.ts` as the guard both RPC
  paths are put through. If the facade and the apply service end up with two
  copies, the guard can drift. It must live in exactly one module (proposal 2).
- The class docblock at 134–151 (workspace path MUST be the repo top level)
  applies to _all three_ pieces — copy it, do not drop it.
- `applyHunks` writes to the worktree and to the index. Any behaviour drift here
  is data loss. This split needs the existing hunk-apply specs green before and
  after, not just a typecheck.

### Effort

**M–L**, behaviour-preserving but requires security review of the shared guard.

---

## 3. `protocol-dispatcher.ts` (1799) — vscode-lm-tools

**Full path**: `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`

### Classification

Handler split by namespace. **Not** a facade — there is no class and no DI token;
dependencies arrive as a plain `ProtocolHandlerDependencies` object (134–143).
That is what makes this cheap.

### Verdict — real seam

`handleIndividualTool` (480–1560) is **1080 lines of one function**, a 47-case
switch. The cases are already grouped by namespace in source order, and those
groups are the _same_ groups `handleToolsList` uses for its
`disabledMcpNamespaces` toggles (255–333) — so the grouping is not invented, it
is already the shipped runtime contract:

| Group                                                                  | Lines     | ≈ LOC |
| ---------------------------------------------------------------------- | --------- | ----- |
| workspace / search / diagnostics / lsp / dirty / tokens                | 491–573   | 85    |
| agent (`ptah_agent_*`)                                                 | 574–728   | 155   |
| web search                                                             | 729–759   | 30    |
| git worktree                                                           | 760–837   | 78    |
| json validate                                                          | 838–868   | 30    |
| browser (`ptah_browser_*`, 11 tools)                                   | 869–1151  | 283   |
| harness (`ptah_harness_*`)                                             | 1152–1350 | 199   |
| code intelligence (ast/context/deps/symbols/memory/relevance/monorepo) | 1351–1511 | 160   |
| tasks (`ptah_task_*`)                                                  | 1512–1560 | 48    |

The concerns mixed are: JSON-RPC transport (`handleMCPRequest`,
`createErrorResponse`), the tool catalogue + eager-loading policy
(`handleToolsList`, `markEagerTools`), `execute_code` execution, and nine
unrelated capability domains.

### Proposed cut

Three sibling modules under
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-handlers/`,
each exporting one function
`handleXTool(name, args, request, deps): Promise<MCPResponse | null>` returning
`null` for "not mine":

1. **`browser-tool-handlers.ts`** — 869–1151 plus `resolveScreenshotPath`
   (1773–1798). **≈ 320 lines.**
2. **`harness-tool-handlers.ts`** — 1152–1350. **≈ 210 lines.**
3. **`code-intelligence-tool-handlers.ts`** — 491–573 + 1351–1511 plus
   `ensureDependencyGraphBuilt`, `toAbsoluteWorkspacePath`,
   `resolveDependencyQueryPath` (1587–1623). **≈ 290 lines.**

**Dispatcher retains**: `handleMCPRequest`, `handleInitialize`,
`handleToolsList`, `markEagerTools` + the eager sets, `handleToolsCall`,
`handleExecuteCodeCall`, `buildAgentFriendlyError`, `createErrorResponse`,
`createToolSuccessResponse`, `missingStringArgResponse`, and the agent / worktree
/ json / web-search / tasks cases (small, and the tasks cases are deliberately
always-on per the 219–250 docblock). **≈ 800 lines** — over 700, and that is
acceptable: cutting further would fragment the transport layer, which guardrail 4
warns against.

Do #11 and #12 in the same change, with the same three group names.

### Risk

- `vscode-lm-tools` backs the model-facing MCP surface. The _dispatch_ side is
  safe to move (behaviour is per-case and self-contained), but **`handleToolsList`
  must not move and must not be reordered** — the array order and the
  `disabled.has(...)` guards are the tools the model is shown, and the
  always-on task tools are explicitly _not_ wrapped in a guard (comment at 265).
- `markEagerTools` stamps `anthropic/alwaysLoad`; the eager sets are runtime-
  conditional (`hasIDECapabilities`, `hasSqliteLayer`). Leave them with
  `handleToolsList`.
- `runWithMcpRequestContext` wraps the call path — the extracted handlers must be
  invoked from inside that wrapper, not around it.
- No `platform-core` port gains a concrete export here; nothing in this file
  touches `platform-core`.

### Effort

**M**, behaviour-preserving. Mechanical because `deps` is a plain object.

---

## 4. `user-layer-mirror.service.ts` (1642) — agent-generation

**Full path**: `D:/projects/ptah-extension/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`

### Classification

Facade — `@injectable()`, exported from the lib barrel
(`agent-generation/src/index.ts:108`), consumed by
`agent-sdk/helpers/skill-junction.service.ts` and
`cli-engine/thoth/cli-skill-repropagation.ts`. **One** injected dependency
(`Logger`), which makes extraction unusually cheap.

### Verdict — real seam

54 methods, 1500 lines of class body, five protocols that share nothing but the
logger and the slug lock:

| Protocol          | Methods                                                                                                                                                                            | Lines                                   | ≈ LOC |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----- |
| Mirror            | `mirrorAll`, `mirrorPluginSkills`, `mirrorSynthesizedSkills`, `mirrorSkillSlug`, `mirrorPluginCommands`, `mirrorAgents`, `recordConflict`                                          | 159–198, 1142–1435                      | 330   |
| Reconcile         | `reconcile`, `reconcilePlugin{Skills,Commands}`, `reconcileAgents`, `reconcile{Dir,File}Clone`, `refreshSidecar{Dir,At}`, `markDiverged{Dir,At}`, `reconcileMissing{,File}Sidecar` | 252–286, 738–1037, 1277–1300, 1462–1518 | 420   |
| History + revert  | `listHistory`, `revert`, `revert{Dir,File}Clone`, `snapshotDirToHistory`, `makeUniqueHistoryDir`, `snapshotTreeRec`, `snapshotFileToHistory`                                       | 384–534, 1039–1117                      | 230   |
| Rebase / keep     | `rebaseClone`, `keepClone`, `rebase{Dir,File}Clone`, `keep{Dir,File}Clone`                                                                                                         | 288–308, 580–716                        | 160   |
| User-layer writes | `writeTextAtomic`, `copyTree(Rec)`, `copyFileAtomic`, `clearCloneTrackedContent`, `assertUnderUserLayer`, `dirExists`, `fileExists`, `isEnoent`, `listSubdirectories`              | 556–578, 1520–1640                      | 165   |

"Reconcile a clone against its upstream source" and "snapshot a clone into
`.history/` and restore from it" are different jobs with different failure modes;
neither needs to know the other exists.

### Proposed cut

1. **`user-layer-history.store.ts`** — `UserLayerHistoryStore`. The whole history
   protocol: `listHistory`, `revertDirClone`, `revertFileClone`,
   `snapshotDirToHistory`, `makeUniqueHistoryDir`, `snapshotTreeRec`,
   `snapshotFileToHistory`. **≈ 260 lines.**
2. **`user-layer-reconciler.ts`** — `UserLayerReconciler`. The reconcile
   protocol plus sidecar refresh/divergence marking. **≈ 440 lines.**
3. **`user-layer-writer.ts`** — the containment guard and the only writes into
   `~/.claude`: `assertUnderUserLayer`, `writeTextAtomic`, `copyTree`,
   `copyTreeRec`, `copyFileAtomic`, `clearCloneTrackedContent`, plus the three
   `fs` predicates. **≈ 190 lines.** Named for the invariant it owns.

**Facade retains**: `getUserLayerRoots`, `mirrorAll` + the mirror family,
`reconcile`/`rebaseClone`/`keepClone`/`revert`/`listHistory`/`writeEnhanced*` as
delegating entry points, `withSlugLock`, `buildSidecar`, `listClones`, the
rebase/keep family, and all 15 exported interfaces at 33–140.
**≈ 750 lines**, constructor 1 → 3 deps.

### Risk

- `withSlugLock` (1119–1140) serialises per `kind:slug`. Every extracted
  protocol must be invoked _inside_ the facade's lock, never take its own — two
  lock maps is a lost mutual exclusion, and the failure is a corrupted clone.
- `assertUnderUserLayer` is the containment guard against writing outside
  `~/.claude`. It must have exactly one definition after the split (proposal 3).
- The three spec files in the same folder (`user-layer-reconcile.spec.ts`,
  `user-layer-enhance.spec.ts`, `user-layer-activation-sequence.spec.ts`) exercise
  the facade; if they green before and after, the move is proven.

### Effort

**M**, behaviour-preserving. Only one injected dep to thread.

---

## 5. `agent-process-manager.service.ts` (1413) — cli-agent-runtime

**Full path**: `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`

### Classification

Facade — `@injectable() AgentProcessManager`, 6 ctor deps, `EventEmitter`-based.

### Verdict — real seam

There is already a sibling `agent-process-manager-helpers.ts` holding the caps
and pure helpers, so the extraction habit exists; what was left behind is a
_stateful_ subsystem, which is why it did not get pulled out with the constants:

- **Output accumulation** (630–697, 910–1072, ≈ 240 lines): `appendBuffer`,
  `accumulateDelta`, `accumulateSegment`, `accumulateStreamEvent`, `flushDelta`,
  `cleanupFlushTimer`, `readOutput`, `readOutputForPersistence`. This owns its own
  state — per-agent buffers, `PendingDelta` maps, flush timers, `MAX_BUFFER_SIZE`
  / `MAX_ACCUMULATED_SEGMENTS` / `MAX_ACCUMULATED_STREAM_EVENTS` caps. The rest
  of the class touches that state only through these methods.
- **Spawn preflight** (1224–1411, ≈ 190 lines): `getPreferredCli`,
  `validateWorkingDirectory`, `resolveMcpPort` (which probes ports over `axios`),
  `getWorkspaceRoot`.
- **Static settings resolution** (133–235, ≈ 100 lines): `mapEffortToCli`,
  `mapEffortToAgy`, `resolveReasoningEffort`, `resolveAutoApprove`,
  `resolveConfiguredModel` — already static, already pure-ish.
- Genuine supervision (spawn, SDK handle tracking, steer, continue, stop,
  shutdown, timeout, exit, kill) — this is the class's job and stays.

### Proposed cut

1. **`cli-agents/agent-output-buffer.ts`** — `AgentOutputBuffer`, owning the
   buffer/delta/timer maps and the caps, exposing `append`, `accumulateSegment`,
   `accumulateStreamEvent`, `flush(agentId)`, `read(agentId, tail)`,
   `readForPersistence(agentId)`, `dispose(agentId)`. **≈ 280 lines.**
2. **`cli-agents/agent-spawn-preflight.ts`** — `AgentSpawnPreflight`:
   `getPreferredCli`, `validateWorkingDirectory`, `resolveMcpPort`,
   `getWorkspaceRoot`. Takes `cliDetection`, `workspaceProvider`, `logger`.
   **≈ 230 lines.**
3. Move the five static resolvers (133–235) into the existing
   `agent-process-manager-helpers.ts` as exported functions. **No new file** —
   guardrail 2.

**Facade retains**: spawn/doSpawn/doSpawnSdk/spawnFromSdkHandle/trackSdkHandle,
getStatus, steer, continueConversation, stop, shutdownAll, acquireSpawnLock,
handleTimeout, handleExit, scheduleCleanup, killProcess, the running-count
accessors, `markParentSubagentsAsCliAgent`, `AgentContinueError`.
**≈ 800 lines**, constructor 6 → 8 (at the gate, not past it).

### Risk

- The delta flush emits `AgentOutputDelta` events on the manager's own
  `EventEmitter`. The buffer must take an emit callback rather than a second
  emitter, or the renderer stops receiving deltas.
- `handleExit` / `scheduleCleanup` / `shutdownAll` all clear buffer state; every
  clear site must route through `AgentOutputBuffer.dispose` or agents leak.
- 8 ctor deps is the ceiling — do not add a third collaborator here.

### Effort

**M**, behaviour-preserving. The stateful move needs care, not judgement.

---

## 6. `ptah-cli-registry.ts` (1149) — cli-agent-runtime

**Full path**: `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`

### Classification

Facade — `@injectable() PtahCliRegistry`, **13 ctor deps** (already past the
guardrail), with a `helpers/` folder beside it that already holds four extracted
collaborators (config persistence, spawn options, stream loop, prompt mailbox).

### Verdict — real seam

Two jobs:

- **Agent CRUD + spawn** (117–303, 313–476, 482–773): list/create/update/delete,
  `getProfile`, `testConnection`, `spawnAgent` (267 lines), `disposeAll`,
  `stopProfileProxy`, `resolvePermissionOptions`, `createCallbackInfrastructure`.
- **Provider auth-env and proxy construction** (117–143, 842–1147, ≈ 340 lines):
  `isTrulyLocal`, `resolveAgentApiKey`, `buildProxyAuthEnv`,
  `createProxyForProvider`, `applyTierEnv`, `buildAuthEnv`,
  `resolveEffectiveTiers`, `buildDefaultTierMappings`.

The second is a coherent noun — "given an agent config and a provider, produce
the `AuthEnv` (and the translation proxy) this spawn will run under" — and it is
what drags `ProviderModelsService`, `ModelResolver`, `IAuthSecretsService` and
`ConfigManager` into the registry's constructor.

### Proposed cut

**`ptah-cli/helpers/ptah-cli-auth-env.builder.ts`** — `PtahCliAuthEnvBuilder`,
new `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_AUTH_ENV_BUILDER`, following the
naming of the four existing `helpers/ptah-cli-*` collaborators. Moves the eight
methods above; takes `logger`, `authSecrets`, `providerModels`, `modelResolver`,
`configManager` (5 deps). **≈ 380 lines.**

**Facade retains**: CRUD, `getProfile`, `testConnection`, `spawnAgent`,
`resolvePermissionOptions`, `createCallbackInfrastructure`, `disposeAll`,
`stopProfileProxy`. **≈ 780 lines**, constructor **13 → 9**.

`createCallbackInfrastructure` (991–1077, 87 lines) is a second candidate but is
below the 150-line floor on its own — leave it.

### Risk

- The lib's `CLAUDE.md` pins a two-part invariant on this exact path: every spawn
  carries the user's output style via `settings: buildFlagSettings(...)`, and
  `userSettingSourceIncluded: true` must be passed because the path hardcodes
  `settingSources: ['user','project','local']`. Both live in `spawnAgent`, which
  **stays in the facade** — the proposed cut deliberately does not touch it.
- `buildProxyAuthEnv` returns a `stopProxy` closure that `stopProfileProxy` and
  `disposeAll` later call. Proxy lifetime must stay owned by the registry; the
  builder returns the handle, it must not hold the map.
- `applyTierEnv` / `resolveEffectiveTiers` are a **fourth** consumer of the tier
  precedence chain documented in `auth-providers/CLAUDE.md`. Moving them is fine;
  changing them is not. Do not "unify" them with `ProviderModelsService` in this
  refactor — that file's docblock warns explicitly about writers that look
  correct in isolation.

### Effort

**M**, behaviour-preserving, but review-heavy because of the spawn invariant next
door.

---

## 7. `orchestrator.service.ts` (1188) — agent-generation

**Full path**: `D:/projects/ptah-extension/libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`

### Classification

Facade — `@injectable() AgentGenerationOrchestratorService`, 12 ctor deps.

### Verdict — real seam, moderate value

The file's own docblock names four phases (analysis → selection → rendering →
writing). Phases 1, 2 and 4 delegate to injected services; **phase 3 does not** —
it is implemented inline, and it dragged a fifth, undeclared concern in with it:

- **Rendering + validation + fallback** (713–1049, ≈ 340 lines): `renderAgents`,
  `resolveAgentContent`, `hasCriticalSafetyIssue`, `renderStaticFallbackContent`,
  `buildAgentFileContent`, `humanizeName`, `extractTemplateDescription`.
- **Project-context detection** (518–601, 1059–1186, ≈ 210 lines):
  `analyzeWorkspace`, `buildVariables`, `detectLanguagesFromProjectType`,
  `detectBuildTools`, `detectTestingFrameworks`, `detectPackageManager`. This is
  the concern that pulls `WorkspaceAnalyzerService`, `ProjectDetectorService`,
  `FrameworkDetectorService` and `MonorepoDetectorService` into the constructor —
  four of the twelve deps, used by one region.
- **Orchestration proper**: `generateAgents` (266 lines) + `selectAgents`.

### Proposed cut

1. **`services/agent-content-renderer.service.ts`** — `AgentContentRenderer`,
   taking `contentGeneration`, `templateStorage`, `outputValidation`, `logger`.
   **≈ 380 lines.**
2. **`services/agent-project-context.builder.ts`** — `AgentProjectContextBuilder`,
   taking the four workspace-intelligence detectors + logger. **≈ 250 lines.**

**Facade retains**: `generateAgents`, `selectAgents`, the multi-CLI write fan-out,
Sentry reporting, `OrchestratorGenerationOptions`. **≈ 560 lines**, constructor
**12 → 8**.

### Risk

- `generateAgents` is a transaction with rollback on write failure; the render
  phase returning partial results plus `warnings` must keep the same shape or the
  rollback branch changes meaning.
- `resolveProjectType` is imported from `./wizard/analysis-schema` — the context
  builder takes that import with it; do not duplicate the mapping.
- Both new services need DI tokens in `agent-generation/di/tokens.ts` and
  registration in `di/register.ts`.

### Effort

**M**, behaviour-preserving.

---

## 8. `gateway.service.ts` (1178) — messaging-gateway

**Full path**: `D:/projects/ptah-extension/libs/backend/messaging-gateway/src/lib/gateway.service.ts`

### Classification

Facade — `@injectable() GatewayService`, 14 ctor deps. The lib's `CLAUDE.md`
calls it "façade" in its first sentence.

### Verdict — length is _partly_ incidental

This file has already been through the treatment the survey recommends: three
stores, three adapters, the coalescer, the command service, the turn tracker and
`workspace-resolution.ts` are all separate files, and the CLAUDE.md documents
each. What is left is genuinely façade work — wire adapters, route inbound,
flush outbound, admin the bindings.

One honest seam remains, and it is a small one:

- **Secret + config resolution** (365–384, 645–748, 1025–1098, ≈ 200 lines):
  `setToken`, `decryptToken`, `decryptSlackAppToken`, `getAllowList`,
  `setAllowList`, `allowedKeyFor`, `enabledKeyFor`, `cfgBool`, `cfgArray`,
  `getDiscordAppId`, `setDiscordAppId`. This is the only region that knows the
  shape of `GatewaySettings` cipher keys and the `ptah.*` config keys, and it
  carries its own `decryptFailures` / `lastErrors` state.

Voice residue (`gcOldVoiceFiles`, `defaultVoiceCacheDir`,
`bridgeVoiceDownloadEvents`, plus 12 lines of transcription inside
`handleInbound`) totals ≈ 70 lines — **below the floor, do not extract it.** The
lib already moved the real voice code out to `voice-providers`; what is left is
wiring, and it belongs to the façade.

### Proposed cut

**`src/lib/gateway-credentials.ts`** — `GatewayCredentials`, taking
`gatewaySettings`, `vault`, `workspace`, `logger`. Owns token set/decrypt,
allowlist read/write, the `ptah.*` config accessors and the Discord app-id pair;
keeps `decryptFailures` and surfaces `lastError(platform)` for `status()`.
**≈ 250 lines.**

**Facade retains**: everything else. **≈ 930 lines**, constructor **14 → 12**
(loses `vault` and `gatewaySettings`, gains one; keeps `workspace` for the
allowlist source rule).

### Risk

- `CLAUDE.md` states the workspace allowlist source is _exactly_
  `IWorkspaceProvider.getWorkspaceFolders()` with exact-root matching and no
  subpaths, deliberately different from the `rpc-handlers` helper. Whatever the
  credentials object exposes must not become a second allowlist notion.
- `constantTimeStringEqual` (1172–1177) backs pairing-code comparison — leave it
  where the comparison is.
- `status()` reads `lastErrors`; if that map moves, `status()` must read through
  the new object, not a stale copy.

### Effort

**S–M**, behaviour-preserving. Low value relative to #1–#5; do it when this file
is being touched anyway.

---

## 9. `enhanced-prompts.service.ts` (1155) — agent-generation

**Full path**: `D:/projects/ptah-extension/libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`

### Classification

Facade — `@injectable() EnhancedPromptsService`, 7 ctor deps, exported from the
lib barrel (`index.ts:92`). State already lives in a sibling
`enhanced-prompts-state-store.ts`.

### Verdict — real but modest seam

Three concerns:

- **Feature state machine** (223–664, minus the SDK block): lock acquire/release,
  `getStatus`, `setEnabled`, `isEnabled`, `runWizard`, `regenerate`, and the four
  content accessors. This is the service's job.
- **SDK driving** (676–818, ≈ 145 lines): `generateGuidanceViaSdk`,
  `processPromptDesignerStream` — abort controller, `SdkStreamProcessor`, progress
  event mapping.
- **Pure composition** (839–1153, ≈ 315 lines): `enrichWithMultiPhaseAnalysis`,
  `buildDetectedStackFromInput`, `buildDetectedStack`, `buildDesignerInput`,
  `buildSummary`, `buildCombinedPrompt`. Almost entirely data shaping; the only
  I/O is the analysis-dir read in `enrichWithMultiPhaseAnalysis`.

### Proposed cut

1. **`enhanced-prompts/prompt-designer-input.builder.ts`** — the composition
   block (839–1153) as `PromptDesignerInputBuilder`. **≈ 340 lines.**
2. **`enhanced-prompts/guidance-generation.runner.ts`** — `GuidanceGenerationRunner`,
   taking `internalQuery`, `promptDesigner`, `logger`; owns 676–818.
   **≈ 190 lines.**

**Facade retains**: lock, status, enable/disable, `runWizard`, `regenerate`, the
content accessors, `setAnalysisReader`. **≈ 650 lines**, constructor 7 → 7 (it
loses `internalQuery` + `promptDesigner`, gains the runner and the builder).

### Risk

- `setAnalysisReader` injects a reader used by `enrichWithMultiPhaseAnalysis`;
  if the enrich method moves, the setter must forward to the builder or the
  wizard silently loses its multi-phase analysis (degrades quietly, which is the
  worst kind).
- `acquireGenerationLock` guards concurrent wizard runs — keep it in the façade.

### Effort

**M**, behaviour-preserving.

---

## 10. `provider-models.service.ts` (1165) — auth-providers

**Full path**: `D:/projects/ptah-extension/libs/backend/auth-providers/src/lib/provider-models.service.ts`

### Classification

Facade — `@injectable() ProviderModelsService`, 4 ctor deps. **Recommended
verdict: defer everything except the pricing cut.**

### Verdict — the length is mostly load-bearing

Three roles:

- **Catalogue** (142–482, 945–951, ≈ 400 lines): `persistCatalog`,
  `readPersistedCatalog`, `fetchModels`, `fetchDynamicModels`,
  `mergeStaticMetadata`, `clearCache`, `registerDynamicFetcher`.
- **Tier resolution and env writing** (490–950, 1148–1163, ≈ 500 lines):
  `setModelTier`, `getModelTiers`, `clearModelTier`, `readLiveCatalog`,
  `getLiveDerivedTiers`, `applyPersistedTiers`, `refreshTiersFromLiveCatalog`,
  `reapplyTiersForWarmedCatalog`, `applyTierMetadata`, `clearAllTierEnvVars`,
  `switchActiveProvider`, `getPersistedTierValue`.
- **Pricing** (966–1133, ≈ 180 lines): `prefetchPricing`, `transformApiModels`,
  `parsePricingField`, `feedPricingMap`.

The tier role _looks_ like the obvious extraction and it is the one to leave
alone. `auth-providers/CLAUDE.md` devotes ~150 lines to it: **three writers plus
one reader**, all funnelled through `ProviderModelsService.getLiveDerivedTiers`
so that the rule _and the source_ agree; the doc states plainly that a
disagreement there is invisible because both sides look correct in isolation. Two
of those writers live in other files and reach this accessor by class. Moving it
to a new class is a cross-lib public-API change made for line-count reasons — the
worst justification available for touching that code. It is also the freshest
code in the partition: TASK_2026_265 just deleted `autoResolveDefaultTiers` from
this file and the proving spec
(`provider-models-cross-provider-contamination.spec.ts`) is still untracked in
the working tree.

The pricing role, by contrast, shares nothing with either of the others — it
reads the OpenRouter catalogue and feeds a global pricing map.

### Proposed cut (the only one)

**`src/lib/provider-pricing-prefetcher.ts`** — `ProviderPricingPrefetcher`:
`prefetchPricing`, `transformApiModels`, `parsePricingField`, `feedPricingMap`.
Takes `logger` + `configManager`. **≈ 200 lines.** Facade **≈ 970 lines**,
constructor unchanged at 4 (+1 = 5).

Record the tier/catalogue split as **explicitly declined** with the reason above,
so the next survey does not re-derive it.

### Risk

- `feedPricingMap` calls `updatePricingMap` from `@ptah-extension/shared` — a
  global mutation. One caller only, keep it that way.
- If the pricing prefetcher is given its own catalogue read it will become a
  _second_ source next to `readLiveCatalog`. Have it call the service, or pass
  the models in.

### Effort

**S** for the pricing cut. The tier cut is not S/M/L — it is out of scope.

---

## 11. `tool-description.builder.ts` (1717) — vscode-lm-tools

**Full path**: `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`

### Classification

**EXEMPT standalone** — builder decomposition, but only as a rider on #3.

### Verdict — no seam is buried; the length is the catalogue

51 exported `buildXTool()` functions, each returning one `MCPToolDefinition`
literal, plus `buildExecuteCodeDescription` (1611–1716). There is no shared
state, no branching, no cross-function coupling, and no second concern hiding in
here — the file is exactly one thing (the MCP tool contract) written out 51
times. That matches `context.md`'s own description of a file that can be long and
fine.

Splitting it on its own is relocation with an import diff and no behavioural or
comprehension win. Splitting it _with_ the dispatcher is different: the two files
would then share one namespace grouping, and a change to the browser surface
would touch `browser-tool-handlers.ts` + `browser-tool-descriptions.ts` instead
of two 1700-line files.

### Proposed cut (only if #3 is executed)

Mirror #3's three groups under `mcp-core/tool-descriptions/`:
`browser-tool-descriptions.ts` (866–1168, ≈ 310), `harness-tool-descriptions.ts`
(1174–1372, ≈ 200), `code-intelligence-tool-descriptions.ts` (317–482 +
1378–1605, ≈ 400). Root file retains execute-code, approval, agent, web search,
worktree, json, tasks and `buildExecuteCodeDescription`. **≈ 800 lines.**

### Risk

- These strings are what the model reads. A pure move is safe; a "tidy-up" of
  wording while moving is not — it changes tool selection behaviour with no test
  to catch it. Move verbatim.
- `buildExecuteCodeDescription` embeds `PTAH_SYSTEM_PROMPT`; keep it with
  `buildExecuteCodeTool`.
- `handleToolsList` imports all 51 by name — the import list moves, the call
  order must not.

### Effort

**S** as a rider on #3; **not worth doing alone**.

---

## 12. `mcp-response-formatter.ts` (1162) — vscode-lm-tools

**Full path**: `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`

### Classification

**EXEMPT standalone** — formatter decomposition, rider on #3.

### Verdict — same shape as #11

29 exported pure `formatX(result): string` functions over `json2md`, plus four
private helpers (`renderDirectoryTree`, `formatDiagnosticItem`,
`extractRangeLine`, `formatCliLabel`, `fallbackJson`). No state, no
inter-function coupling beyond those helpers. Nothing is buried.

### Proposed cut (only if #3 is executed)

`browser-response-formatters.ts` (826–1153, ≈ 330),
`agent-response-formatters.ts` (416–627, ≈ 210),
root retains workspace/search/diagnostics/lsp/dirty/tokens/websearch/worktree/
json + the shared helpers (**≈ 620**). Note this grouping is _agent + browser_
rather than #3's _browser + harness + code_ — the formatters have no harness or
code-intelligence entries, so follow the content, and keep the shared
`fallbackJson`/`renderDirectoryTree` helpers in the root file.

### Risk

- Same as #11: the output is model-facing. Move verbatim.
- `fallbackJson` is the catch-all for unknown shapes; a duplicated copy would
  drift.

### Effort

**S** as a rider on #3; **not worth doing alone**.

---

## 13. `code-execution/types.ts` (1617) — vscode-lm-tools

**Full path**: `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`

### Classification

**EXEMPT** — type barrel.

### Verdict — split buys import churn, and a drain already exists

The file is the `PtahAPI` contract: one root interface listing 21 namespaces
(32–81), the namespace interfaces themselves, and the result types those
namespaces return. Rough composition: core namespaces ≈ 280 lines; browser
(namespace + 12 result types) ≈ 290; context/dependencies/project/relevance
≈ 220; ast (namespace + 7 types) ≈ 190; IDE/LSP/editor/actions/testing ≈ 420;
orchestration ≈ 130.

Every consumer imports from `../types`. There is no logic, no coupling risk, no
test burden, and no _second role_ hiding in it — the 256 test ("an important,
documented role buried among unrelated concerns") returns nothing. Same call as
the partition-A judgement on `rpc.types.ts` should be: a contract barrel is
allowed to be long.

Two facts make the exemption stronger rather than weaker:

- The file **already delegates**: lines 644–653 re-export the MCP protocol types
  from `./mcp-core/types/mcp-protocol.types`, so the split-and-re-export
  technique has been applied here once and the remainder is what was left on
  purpose.
- Six of the 21 namespace interfaces (`HarnessNamespace`, `SkillNamespace`,
  `MemoryNamespace`, `CorpusNamespace`, `CodeNamespace`, `TasksNamespace`) are
  **already declared next to their builders** in `namespace-builders/` and merely
  imported here. That is the repo's established pattern for new namespaces, and
  it drains this file over time at zero cost.

### Recommendation instead of a refactor

No task. Record the existing convention in `vscode-lm-tools/CLAUDE.md`: a new
namespace declares its interface and its result types beside its builder in
`namespace-builders/`, and `types.ts` imports it into `PtahAPI`. If someone is
already editing the browser or IDE surface for another reason, co-locating those
blocks is a free rider — but it is not worth a task of its own.

### Risk

n/a — nothing proposed.

---

## Cross-cutting note: is `agent-generation` becoming the agent-sdk monolith?

**Answer: no, but it has an undocumented subsystem, and that is the real
finding.**

Measured: 69 hand-written `.ts` files, 18,142 LOC. Three files over 1000
(user-layer-mirror 1642, orchestrator 1188, enhanced-prompts 1155) = 4,022 LOC,
**22 % of the lib in 4 % of its files**. Below those three, the distribution is
healthy: 901, 778, 761, 699, 635, 569, 546, 525, then a long tail under 500. The
`prompt-designer/`, `wizard/`, `cli-agent-transforms/` and `user-layer/`
sub-trees are all properly decomposed.

That is not the agent-sdk shape. The `CLAUDE.md` warning is about a lib that owns
ten concerns; agent-generation's problem is three fat services inside concerns it
already owns. **Per-file splits are the right answer** (#4, #7, #9 above), and
they alone take the lib from three >1000 files to zero.

The one boundary defect worth recording separately: **`services/user-layer/` is
not in the lib's `CLAUDE.md` at all.** Its "Belongs here" list names templates,
analysis, validation, selection, writers, wizard services — nothing about
mirroring `~/.claude/{skills,agents,commands}`, origin sidecars, divergence
reconciliation or history/revert. That subtree is ~1,800 LOC, is exported from the
lib barrel, and is consumed by `agent-sdk` (`skill-junction.service.ts`) and
`cli-engine` (`cli-skill-repropagation.ts`) — i.e. by callers that have nothing
to do with agent generation. Whether it should eventually be its own lib is a
question for a boundary task, not for this survey; what this survey should
deliver is that the lib's documented boundary and its actual contents disagree,
and #4 is a good moment to fix the document.

---

## Suggested execution order

If only three are executed: **#1, #2, #3** — they cover the one guardrail
violation (21 ctor deps), the largest buried subsystem (1080-line diff engine),
and the largest single function (1080-line switch). #3 should carry #11 and #12
as riders or be skipped.

`#10` (provider-models) should **not** be scheduled until the TASK_2026_265 spec
is committed and the tier decision above is recorded as declined.
