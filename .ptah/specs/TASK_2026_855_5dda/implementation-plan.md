# Implementation Plan - TASK_2026_855_5dda

Per-session git view in the Electron git dock. Decisions with options and evidence are in
`decisions.md` (D1–D13). This plan names the components, their contracts and their file-disjoint
batches. All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\feat-session-git-view-d7cc38a5745d`.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_855_5dda/context.md`, `task.md`, and the spawner brief.
- Corrections applied: none.
- Design handoff used: none (no design spec exists). The UI follows the existing dock idioms in
  `worktree-scope-bar.component.ts` (DaisyUI `btn-ghost btn-xs`, `FOCUS_RING`, `role="status"`).
- Missing decision-critical input: the sibling TASK_2026_854 "session → worktree contract". It
  does not exist yet. Resolution: read the shipped `SessionOrganizationSummary.worktreePath` field
  (D13).
- Mandatory constraints (CLAUDE.md and the brief):
  - Electron first. Keep VS Code and TUI compiling.
  - Verify only with `npm run verify -- -p …`. Never run build, serve, e2e or package targets.
  - Do not edit display-panel files.
  - Do not edit session-organization, board-link-capture or todos-section files.
  - Do not edit other tasks' `.ptah/specs`.
  - Code style: standalone OnPush Angular, `inject()`, `input()`/`output()`, signals; Zod at
    boundaries; no `any`; an injected logger in backend libs.
  - Add nothing to `git-info.service.ts`.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Session root today: `agentOrigin.worktreePath ?? partitionPath ?? fallback`, no organization, no validation | `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts:133-139` | Replace its body with the shared resolver (one precedence) |
| Organization record carries `worktreePath`, `branch` | `libs/shared/src/lib/types/session-organization.types.ts:117-130`; on rows `node.ts:257`; rows in `ChatStore.sessions` `chat.store.ts:111` | Highest-precedence candidate |
| Agent origin carries `worktreePath`, `branch` | `libs/frontend/chat-types/src/lib/chat-types.ts:547-561` | Second candidate |
| No per-session cwd field on `TabState` or `ChatSessionSummary` | `chat-types.ts:566+`, `node.ts:222+` | "Session cwd" = tab workspace partition (`findTabByIdAcrossWorkspaces(id).workspacePath`, `compact-session-card.component.ts:388-397`) |
| git-ui imports only core, shared, ui, markdown; chat imports git-ui | grep `libs/frontend/git-ui/src`; `workspace-coordinator.service.ts:128`; `electron-shell.component.ts:605` | git-ui must not import chat; resolver goes in shared; session data reaches git-ui through a core token |
| Dependency-inversion token precedent | `libs/frontend/core/src/lib/tokens/workspace-coordinator.token.ts:17-29`; provided `apps/ptah-extension-webview/src/app/app.config.ts:296-297` | Same pattern for `GIT_SESSION_SCOPE_SOURCE` |
| All dock reads and writes take the root from `gitStatus.activeWorkspacePath()` | `commit-composer.component.ts:443,795`; `source-control.service.ts:334-336`; `git-stash.service.ts:106-475`; `git-dock-header.component.ts:167,326,369` | Drive that one signal to retarget the whole dock (D4) |
| Coordinator fans out `switchWorkspace` to 5 git services, ReviewNavigationService last | `workspace-coordinator.service.ts:120-137,197-205,303-307` | The scope store takes over this fan-out |
| Per-root cache exists but is unbounded and raw-keyed | `git-status.service.ts:214,329-356,447-466` | Normalize keys and add an LRU cap |
| Push already carries `workspaceRoot` | `libs/shared/src/lib/types/messages/git-status.ts:47-58`; `git-watcher.service.ts:1193-1215` | No payload change |
| GitBranchesService raw-compares push root | `git-branches.service.ts:213-218` | Normalize |
| Writes accept only a registered folder; reads accept a validated worktree | `git-rpc.handlers.ts:299-348`; workflow `git-workflow-rpc.handlers.ts:313-325`; validation `git-workspace-root.ts:41-111` | One shared `GitRootResolver` with a per-method policy (D5) |
| Path args traversal-checked; writes serialized per root | `git-info.service.ts:2830-2858,1183` | Safe in a worktree root |
| Discard confirm guards root change, but the RPC re-reads the root | `changed-file-tree.component.ts:794`; `source-control.service.ts:201-235` | Pass the confirmed root explicitly |
| Watcher is single-target, re-armed on switch; primary excludes agent worktrees | `git-watcher.service.ts:395-438,530-551,600-616` | Secondary per-root watchers in a pool |
| Worktree audit prunes and broadcasts `git:worktreeChanged` | `git-watcher.service.ts:925-975` | Disable it on secondary watchers |
| `IWorkspaceWatcher` supports independent subscriptions | `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.ts:360-361` | N watchers are allowed |
| Watcher constructed at boot with deps in hand; stopped at shutdown | `apps/ptah-electron/src/activation/boot-heavy-services.ts:384-414`; `shutdown.ts:244` | The pool is attached at the same place and disposed beside it |
| Electron-only port + capability precedent | `platform-core/src/di/tokens.ts:135-139`; `phase-4-handlers.ts:189-196`; `manifest.ts:489-493`; `capabilities.ts:74`; `host-profile.ts:83` | `gitRootWatch` capability + `GIT_ROOT_WATCH_REGISTRY` port |
| VS Code / CLI surface specs enumerate excluded methods and absent capabilities | `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:34,229`; `apps/ptah-extension-vscode/src/di/expected-absent.ts:68`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:37,117`; `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:18` | Smallest host change: add entries |
| `git:` prefix already allowlisted; host-source baseline ignores `git:watchRoots` | `vscode-core/src/messaging/rpc-handler.ts:72`; `host-source-registry.contract.spec.ts:17-18` | No allowlist or baseline edit |
| RPC registry: method map and name set | `libs/shared/src/lib/types/rpc.types.ts:1808,3377` (git entries) | Add `git:watchRoots` to both |
| Board git cell is a static span | `compact-session-activity.component.ts:831-845` | Make it a button with an output |
| Dock open API | `electron-layout.service.ts:237-239`; folders `:83,114-121` | Opener uses `setEditorPanelVisible(true)` |
| Electron flag | `libs/frontend/core/src/lib/services/vscode.service.ts:24,151` | Gate follow mode and leases (D12) |

## Architecture decision

- Chosen approach:
  1. A pure resolver in shared (D1, D2).
  2. A core token `GIT_SESSION_SCOPE_SOURCE`, implemented by chat (D3).
  3. A git-ui `GitDockScopeStore` that owns `follow-session | pinned` and is the single driver of
     the existing `switchWorkspace(root)` fan-out (D4).
  4. Backend handlers accept a validated worktree root for all `git:*` except worktree
     add/remove (D5).
  5. Per-root isolation in the frontend through normalized, LRU-bounded caches (D9).
  6. Backend secondary watchers in an Electron pool driven by a declarative lease RPC
     `git:watchRoots`, with refcount, cap 4, LRU eviction and lease expiry (D7, D8).
  7. A scope header in the dock; the read-only worktree scope bar is kept for foreign roots (D6).
  8. The stats-card git cell opens the dock pinned to that session (D10).
- Rationale: this reuses the per-root machinery that already exists (cache, push root,
  `switchWorkspace`, worktree validation). It adds only one decision point (the store) and one
  lifetime owner (the pool). Each part is backed by the cited lines.
- Rejected alternatives:
  - A new `scopeRoot` signal at about 40 call sites (D4).
  - Read-only session worktrees (D5).
  - Imperative acquire/release (D7).
  - A host-owned Electron handler (D8).
  - Activating the tab on cell click (D10).
- Assumptions:
  - A1. `git worktree list` run from a linked worktree lists the same set as from the main
    checkout. This is standard git behaviour. Resolve with the unit test in B2, which runs the
    resolver on a worktree root with a probe stub, and with the existing real-git spec
    `git-info.service.worktrees.real-git.spec.ts` (read only, do not edit).
  - A2. `GitRpcHandlers` and `GitWorkflowRpcHandlers` specs build the handler with explicit
    constructor args. Check the spec files in B2 and update their constructors.
  - A3. Electron `container.smoke.spec.ts` resolves every manifest handler that the Electron
    profile plans. Check in B3 whether `GitWatchRpcHandlers` needs a registration only, or also an
    entry in `expected-resolvable.ts`. The `appUpdater` handler is not in `EXPECTED_RESOLVABLE`
    (`expected-resolvable.ts:15-27`), so a registration is expected to be enough.
  - A4. `ChatStore.sessions()` holds the rows of the active workspace. A tab whose session row is
    not loaded reads organization worktree `null` and falls through to the agent origin. This is
    the deterministic result, not an error.
- Effect on existing code:
  - Replaced: `GitRpcHandlers.resolveRoot`/`resolveReadRoot` and
    `GitWorkflowRpcHandlers.resolveRoot` (deleted, delegated to the resolver); the body of
    `sessionWorkingRoot`; the coordinator's git `switchWorkspace` loop.
  - Left alone: `git-info.service.ts`, `git-workspace-root.ts` (reused), `ReviewWorktreeStatusService`,
    `WorktreeScopeBarComponent`, `git-watcher.real-git.spec.ts` (TASK_2026_618 flake; do not
    touch), push payload types.

## Component specifications

### 1. Session working-root resolver (shared, pure)

- Purpose: decide one session's working root, deterministically.
- Responsibilities:
  - Apply the precedence below and return the root and why it won.
  - Never perform I/O or read the clock.
- Verified contracts and entry points:
  - Uses `normalizeWorkspaceRoot` (`libs/shared/src/lib/utils/workspace-root-key.ts:44`).
  - Exported from `libs/shared/src/lib/utils/index.ts` (barrel, line 64 pattern).
- Contract (new):

```ts
export type SessionWorkingRootSource =
  | 'organization-worktree'
  | 'agent-origin-worktree'
  | 'session-cwd'
  | 'workspace-root';

export interface SessionWorkingRootInput {
  readonly organizationWorktreePath: string | null;
  readonly agentOriginWorktreePath: string | null;
  /** The session's workspace partition path (no other cwd exists). */
  readonly sessionCwd: string | null;
  /** The workspace folder the dock or card falls back to. */
  readonly workspaceRoot: string | null;
  /** Open workspace folders: a candidate equal to one is accepted as is. */
  readonly openFolders: readonly string[];
  /**
   * Worktree paths registered in the workspace repository, as git lists them.
   * `null` = not loaded: worktree candidates are kept unvalidated (the backend validates).
   */
  readonly registeredWorktrees: readonly string[] | null;
}

export interface SessionWorkingRoot {
  readonly root: string | null;
  readonly source: SessionWorkingRootSource | null;
  /** Candidates skipped because they are not an open folder or a registered worktree. */
  readonly rejected: readonly { source: SessionWorkingRootSource; path: string }[];
}

export function resolveSessionWorkingRoot(
  input: SessionWorkingRootInput,
): SessionWorkingRoot;
```

- Rules:
  - Precedence: organization → agent origin → session cwd → workspace root.
  - Empty and whitespace-only strings count as absent.
  - Acceptance: a candidate is accepted when its normalized form equals a normalized `openFolders`
    entry or `workspaceRoot`, or a `registeredWorktrees` entry, or `registeredWorktrees === null`.
  - The returned `root` is the matching canonical string (the folder string, or the git-listed
    worktree path), not the caller's spelling.
  - `workspaceRoot` is always accepted, as the last resort.
  - All null → `{ root: null, source: null }`.
- Dependencies: shared only.
- Integration points: chat `sessionWorkingRoot` adapter (component 9);
  `ChatGitSessionScopeSource` (component 9); `GitDockScopeStore` (component 6).
- Failure behaviour: none (total function).
- Quality requirements: no allocation beyond the result; O(candidates × list).
- Verification seam: `session-working-root.spec.ts`, a table test covering:
  - each precedence level wins;
  - a rejected org worktree falls to agent origin;
  - `null` registered list keeps the worktree;
  - Windows case/separator spelling returns the canonical string;
  - an empty string is skipped;
  - all-null input.
- Files:
  - CREATE `libs/shared/src/lib/utils/session-working-root.ts`
  - CREATE `libs/shared/src/lib/utils/session-working-root.spec.ts`
  - MODIFY `libs/shared/src/lib/utils/index.ts`

### 2. `git:watchRoots` RPC contract (shared)

- Purpose: the typed lease contract.
- Contract (new, in `rpc-git.types.ts`; registered in `rpc.types.ts` method map and name set,
  beside `git:info` at `:1808` and `:3377`):

```ts
export interface GitWatchRootsParams {
  /** Renderer lease id, stable per renderer instance; 1..128 chars. */
  leaseId: string;
  /** Desired roots, highest priority first; ≤ 8 entries; replaces the lease's set. */
  roots: string[];
}
export interface GitWatchRootsResult {
  /** Canonical roots now watched for this lease (validated, ≤ cap). */
  watched: string[];
  /** Requested roots refused: not a folder or registered worktree. */
  rejected: string[];
  /** Roots dropped by the global cap. */
  evicted: string[];
}
```

- Failure behaviour: the handler never throws to the renderer. Invalid params →
  `{ watched: [], rejected: roots, evicted: [] }` plus a logged warn.
- Verification seam: compile only (typecheck of `@ptah-extension/shared`). The
  `host-source-registry.contract.spec.ts` must still pass.
- Files:
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts`

### 3. `GitRootResolver` (rpc-handlers)

- Purpose: the one rule for "which root may a `git:*` call run in".
- Responsibilities:
  - Folder match through `findRegisteredWorkspaceFolder`.
  - Worktree match through `findRegisteredWorktree` for the `'folder-or-worktree'` policy.
  - A 5 s positive cache for worktree matches, keyed by normalized request plus the folder list.
  - A warn on refusal.
  - No fallback to the active folder when a named root is refused (preserves
    `git-rpc.handlers.ts:290-297`).
- Contract (new):

```ts
export type GitRootPolicy = 'folder' | 'folder-or-worktree';
export interface GitRootResolverDeps {
  readonly workspace: IWorkspaceProvider;
  readonly probe: WorktreeRootProbe; // git-workspace-root.ts:30-38
  readonly warn: (message: string, context: Record<string, unknown>) => void;
  readonly now?: () => number;
}
export class GitRootResolver {
  constructor(deps: GitRootResolverDeps);
  /** Named root → canonical root or undefined; omitted → active workspace root. */
  resolve(requested: string | undefined, method: string, policy: GitRootPolicy): Promise<string | undefined>;
}
export function createWorktreeRootProbe(gitInfo: Pick<GitInfoService, 'getWorktrees' | 'getCommonDir'>, fileSystem: IFileSystemProvider): WorktreeRootProbe;
```

- Policy table: `'folder'` for `git:addWorktree` and `git:removeWorktree`. `'folder-or-worktree'`
  for every other method in `GitRpcHandlers.METHODS` (`git-rpc.handlers.ts:128-155`), for the
  workflow methods that take a root (`git:generateCommitMessage`, `git:prStatus`,
  `git:operationAbort`, `git:operationContinue`, `git:log`), and for `git:watchRoots`.
- Dependencies: `git-workspace-root.ts` (unchanged); platform-core ports. Each handler builds it in
  its constructor from its injected deps. This adds no DI token. `GitWorkflowRpcHandlers` gains an
  injected `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`platform-core/src/di/tokens.ts:13`).
- Integration points: `GitRpcHandlers` (all `resolveRoot`/`resolveReadRoot` call sites become
  `await this.roots.resolve(...)`; delete the two private methods); `GitWorkflowRpcHandlers`
  (delete its `resolveRoot`).
- Failure behaviour: a probe error reads as "not a worktree" (same as
  `git-workspace-root.ts:66-70`). The handler returns its existing "No workspace folder open"
  shape.
- Security:
  - Single-root per call.
  - The canonical root returned is the registered spelling.
  - The cache holds positive results only, for 5 s, and the key includes the folder list, so
    closing a folder invalidates it.
- Verification seam: `git-root-resolver.spec.ts`. It covers:
  - a folder accepted under both policies;
  - a worktree accepted only under `'folder-or-worktree'`;
  - an unregistered path refused with a warn;
  - omitted → active root;
  - the cache hit within TTL and a re-probe after it;
  - a probe throw → undefined.
  Update `git-rpc.handlers.spec.ts` to add stage, commit and discard with a worktree root
  (accepted) and `git:removeWorktree` with a worktree root (refused). Update
  `git-workflow-rpc.handlers.spec.ts` constructor (A2).
- Files:
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.spec.ts`

### 4. Root-watch port, capability and `GitWatchRpcHandlers`

- Purpose: expose watcher leases to the renderer on hosts that have them.
- Port (new, platform-core):

```ts
// libs/backend/platform-core/src/interfaces/git-root-watch-registry.interface.ts
export interface GitRootWatchLeaseOutcome {
  readonly watched: readonly string[];
  readonly evicted: readonly string[];
}
export interface IGitRootWatchRegistry {
  /** Replace the canonical roots `leaseId` holds; roots are pre-validated by the caller. */
  setLease(leaseId: string, roots: readonly string[]): GitRootWatchLeaseOutcome;
}
// tokens.ts, beside APP_UPDATER (:135-139)
GIT_ROOT_WATCH_REGISTRY: Symbol.for('PlatformGitRootWatchRegistry'),
// doc: "Registered only by hosts whose profile sets `gitRootWatch: true`."
```

- Capability: add `'gitRootWatch'` to `RPC_CAPABILITIES` (`capabilities.ts`, after
  `providerAccounts`) with a doc line. Add `gitRootWatch: false` to the defaults
  (`host-profile.ts:83-86`).
- Manifest entry:
  `{ key: 'gitWatch', methods: GitWatchRpcHandlers.METHODS, requires: ['gitRootWatch'], handler: GitWatchRpcHandlers }`
  next to `git` (`manifest.ts:234-239`).
- Handler (`git-watch-rpc.handlers.ts`):
  - `static METHODS = ['git:watchRoots'] as const satisfies readonly RpcMethodName[]`.
  - Deps (injected): `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`,
    `TOKENS.GIT_INFO_SERVICE`, `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`,
    `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY`.
  - Parses params with a Zod schema (`git-watch-rpc.schema.ts`):
    `leaseId: z.string().min(1).max(128)`,
    `roots: z.array(WorkspaceRootSchema).max(8)`, reusing the `WorkspaceRootSchema` shape of
    `git-rpc.schema.ts:28`.
  - Validates each root with `GitRootResolver` (`'folder-or-worktree'`) and de-duplicates by
    normalized key.
  - Calls `registry.setLease(leaseId, validRoots)` and returns `GitWatchRootsResult`.
- Host changes (smallest):
  - Add `'gitRootWatch'` to `apps/ptah-extension-vscode/src/di/expected-absent.ts` and
    `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts` (capability lists).
  - Add `'git:watchRoots'` to the expected-absent method lists in both `rpc-surface.spec.ts` files.
- Failure behaviour: invalid params → all rejected. A registry that throws → logged error and
  `{ watched: [], rejected: [], evicted: [] }`. The renderer treats an empty `watched` as "no
  live pushes" and keeps fetching on switch.
- Verification seam: `git-watch-rpc.handlers.spec.ts` (fake registry and resolver deps). It
  covers: valid roots forwarded canonical and de-duplicated; a foreign root rejected and never
  forwarded; malformed params; the registry throws. Also the existing `manifest.spec.ts`
  invariants (disjoint, total) and the three host `rpc-surface.spec.ts` files.
- Files:
  - CREATE `libs/backend/platform-core/src/interfaces/git-root-watch-registry.interface.ts`
  - MODIFY `libs/backend/platform-core/src/di/tokens.ts`
  - MODIFY `libs/backend/platform-core/src/index.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/git-watch-rpc.handlers.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/git-watch-rpc.schema.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/git-watch-rpc.handlers.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `libs/backend/rpc-handlers/src/index.ts` (export `GitWatchRpcHandlers`; follow the
    existing export location of `UpdateRpcHandlers`)
  - MODIFY `apps/ptah-extension-vscode/src/di/expected-absent.ts`
  - MODIFY `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`

### 5. Electron `GitRootWatcherPool` (+ `GitWatcherService` options)

- Purpose: own the lifetime of secondary per-root watchers.
- Responsibilities:
  - `Map<leaseId, { roots: string[]; renewedAt: number }>`.
  - Refcount per normalized root = the number of leases holding it.
  - Start a watcher when the refcount goes 0→1 and stop it on 1→0.
  - Cap `MAX_SECONDARY_ROOT_WATCHERS = 4`: beyond it, evict the root with the oldest
    `lastRequestedAt` and report it in `evicted`.
  - Skip a root equal to the primary watcher's root.
  - Drop leases older than `LEASE_TTL_MS = 180_000` on each `setLease`.
  - Before `attach()`, record leases and return `watched: []`. On `attach()`, arm them.
  - `dispose()` stops all.
- Contract (new, `apps/ptah-electron/src/services/git-root-watcher-pool.ts`):

```ts
export interface RootWatcher {
  start(root: string, broadcast: (type: string, payload: unknown) => void, options: GitWatcherStartOptions): void;
  stop(): void;
}
export interface GitRootWatcherPoolAttachment {
  readonly createWatcher: () => RootWatcher;            // new GitWatcherService(gitInfo, logger, workspaceWatcher)
  readonly broadcast: (type: string, payload: unknown) => void;
  readonly primaryRoot: () => string | null;            // refs.gitWatcher?.watchedRoot() ?? null
}
export class GitRootWatcherPool implements IGitRootWatchRegistry {
  constructor(logger: Logger, now?: () => number);
  attach(attachment: GitRootWatcherPoolAttachment): void;
  setLease(leaseId: string, roots: readonly string[]): GitRootWatchLeaseOutcome;
  dispose(): void;
}
```

- `GitWatcherService` changes (small, no logic move):
  - `start(workspacePath, broadcast, options: GitWatcherStartOptions = { agentWorktreeAudit: true })`
    with `export interface GitWatcherStartOptions { readonly agentWorktreeAudit: boolean }`.
  - When it is false, skip the arm-time audit flag (`:422-424`) and the audit path that prunes and
    broadcasts `git:worktreeChanged` (`:925-975`). The nested-root listing for excludes still runs.
  - Add the public getter `watchedRoot(): string | null` that returns `this.workspacePath`.
  - Status pushes are unchanged. They already carry `workspaceRoot` (`:1208-1215`).
- Wiring:
  - `phase-4-handlers.ts`: `const pool = new GitRootWatcherPool(logger)`;
    `container.register(PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY, { useValue: pool })`;
    `container.registerSingleton(GitWatchRpcHandlers)` beside `UpdateRpcHandlers` (`:196`). Also
    `container.register(ELECTRON_TOKENS.GIT_ROOT_WATCHER_POOL, { useValue: pool })` only if
    boot-heavy-services cannot reach it otherwise. Prefer resolving
    `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY` there.
  - `boot-heavy-services.ts:405-414`: after the primary `watcher.start`, resolve the pool and call
    `attach({ createWatcher, broadcast, primaryRoot: () => watcher.watchedRoot() })`. Store
    `refs.gitRootWatchers = pool`.
  - `boot-coordinator.ts:106,188`: add the ref type and its null default.
  - `shutdown.ts:244`: `nonFatal('Git root watchers stop', () => refs.gitRootWatchers?.dispose())`.
  - `rpc-host-profile.ts`: `gitRootWatch: true`.
- Failure behaviour: a watcher `start` that throws → logged warn, the root is reported neither
  watched nor evicted, and the lease keeps it so a later `setLease` retries. Broadcast failures are
  already handled by the webview manager.
- Runtime cost:
  - At most 4 secondary watchers, each with 2 subscriptions plus the nested-root listing timers
    the service already owns, all released by `stop()` (`:556-604`).
  - The pool adds no timer.
- Verification seam: `git-root-watcher-pool.spec.ts` with a fake `RootWatcher` factory. It covers:
  - refcount across 2 leases (stop only after both release);
  - replace semantics;
  - a primary root skipped;
  - cap 4 with LRU eviction reported;
  - lease expiry at TTL+1 with an injected clock;
  - pre-attach leases armed on attach;
  - `dispose` stops all;
  - an idempotent same-set call does not restart.
  In `git-watcher.service.spec.ts` (the unit spec, not real-git): `agentWorktreeAudit: false`
  never calls `pruneWorktrees` nor broadcasts `git:worktreeChanged`, and `watchedRoot()` follows
  `start`/`stop`. Do not edit `git-watcher.real-git.spec.ts` (TASK_2026_618 flake).
- Files:
  - CREATE `apps/ptah-electron/src/services/git-root-watcher-pool.ts`
  - CREATE `apps/ptah-electron/src/services/git-root-watcher-pool.spec.ts`
  - MODIFY `apps/ptah-electron/src/services/git-watcher.service.ts`
  - MODIFY `apps/ptah-electron/src/services/git-watcher.service.spec.ts`
  - MODIFY `apps/ptah-electron/src/di/phase-4-handlers.ts`
  - MODIFY `apps/ptah-electron/src/activation/boot-heavy-services.ts`
  - MODIFY `apps/ptah-electron/src/activation/boot-coordinator.ts`
  - MODIFY `apps/ptah-electron/src/activation/shutdown.ts`
  - MODIFY `apps/ptah-electron/src/rpc-host-profile.ts`
  - MODIFY (only if A3 shows it is needed) `apps/ptah-electron/src/di/expected-resolvable.ts`,
    `apps/ptah-electron/src/di/container.smoke.spec.ts`

### 6. `GIT_SESSION_SCOPE_SOURCE` token (core) and `GitDockScopeStore` (git-ui)

- Purpose: decide the dock's root and drive the git services and leases from it.
- Token (new, `libs/frontend/core/src/lib/tokens/git-session-scope.token.ts`, exported from
  `core/src/index.ts`):

```ts
export interface GitSessionScopeCandidate {
  readonly tabId: string;
  readonly sessionId: string | null;          // TabState.claudeSessionId
  readonly sessionName: string;               // TabState.title || 'New Chat'
  readonly organizationWorktreePath: string | null;
  readonly organizationBranch: string | null;
  readonly agentOriginWorktreePath: string | null;
  readonly agentOriginBranch: string | null;
  readonly sessionCwd: string | null;         // tab workspace partition path
}
export interface GitSessionScopeSource {
  /** Candidate of the active chat tab, or null. Reactive. */
  readonly activeSession: Signal<GitSessionScopeCandidate | null>;
  /** Candidates of the active workspace's open tabs, most recent first. Reactive. */
  readonly openSessions: Signal<readonly GitSessionScopeCandidate[]>;
  /** Candidate of one tab (any workspace), or null. Reactive read. */
  candidateForTab(tabId: string): GitSessionScopeCandidate | null;
}
export const GIT_SESSION_SCOPE_SOURCE = new InjectionToken<GitSessionScopeSource>('GIT_SESSION_SCOPE_SOURCE');
```

- Store (new, `libs/frontend/git-ui/src/lib/services/git-dock-scope.store.ts`,
  `providedIn: 'root'`, exported from `services.ts`):

```ts
export type GitDockScopeMode = 'follow-session' | 'pinned';
export interface GitDockScope {
  readonly mode: GitDockScopeMode;
  readonly root: string | null;
  readonly source: SessionWorkingRootSource | null;
  readonly session: { readonly tabId: string; readonly name: string; readonly closed: boolean } | null;
  /** True when root is not the workspace folder. */
  readonly isWorktree: boolean;
}
@Injectable({ providedIn: 'root' })
export class GitDockScopeStore {
  readonly scope: Signal<GitDockScope>;
  readonly mode: Signal<GitDockScopeMode>;
  setWorkspace(path: string): void;          // coordinator; reconciles synchronously
  removeWorkspace(path: string): void;       // clears workspace/pin under it, reconciles
  pin(): void;                               // pin current session scope
  unpin(): void;                             // back to follow-session
  showSession(tabId: string): void;          // active tab → follow; else pin to tab
}
```

- Behaviour:
  - Inputs:
    - `workspacePath` (set by the coordinator);
    - `source?.activeSession()` / `candidateForTab(pinned.tabId)`;
    - `layout.workspaceFolders()` (`electron-layout.service.ts:114`) as `openFolders`;
    - `WorktreeService.worktrees()` as `registeredWorktrees`, or `null` until a first load
      succeeds (new `loaded` signal on `WorktreeService`).
  - Root = `resolveSessionWorkingRoot({...candidate, workspaceRoot: candidate.sessionCwd ?? workspacePath, ...})`.
  - No candidate, follow mode disabled (`!vscode.config().isElectron`), or no source →
    `{ root: workspacePath, source: 'workspace-root' }`.
  - `reconcile()` is idempotent. It compares the normalized root with the last applied one. On a
    change, it calls `switchWorkspace(root)` in this order: GitStatusService, GitBranchesService,
    ReviewDiffService, GitReviewService, ReviewNavigationService (last, preserving
    `workspace-coordinator.service.ts:134`). Then it calls `worktrees.loadWorktrees()` when the
    list is not loaded, and `leases.update(...)`.
  - An `effect()` tracks the inputs and calls `reconcile()` untracked. `setWorkspace` and
    `removeWorkspace` call it synchronously.
  - The pin follows D11.
- Lease client (new, `git-root-watch-lease.service.ts`, root):
  - `update(roots: readonly string[])`, debounced at 300 ms with one timer.
  - Sends `git:watchRoots { leaseId, roots }`, where `leaseId = crypto.randomUUID()` per instance
    and `roots` = the scope root (if not the workspace folder) followed by the open-session roots,
    de-duplicated and capped at 4.
  - Renews every 60 s, only while roots are non-empty; the interval is cleared when empty and on
    `DestroyRef`.
  - No-op when not Electron.
  - Logs RPC failure with `console.warn` (the git-ui convention, `review-worktree-status.service.ts:72`)
    and retries on the next update or renewal.
- `GitStatusService` changes (isolation):
  - `_workspaceGitState` is keyed by `normalizeWorkspaceRoot(root)` from shared, and
    `applyGitInfo` and `switchWorkspace` compare normalized.
  - `MAX_CACHED_ROOTS = 12`, evicting the least-recently-updated non-active entry on insert.
  - Update the doc comment of `activeWorkspacePath` to "the root the dock is scoped to (a
    workspace folder or a session worktree)".
  - Update the `CACHE_TTL_MS` comment, which now holds only for roots without a secondary
    watcher.
- `GitBranchesService.handleMessage`: normalized compare (`:213-218`).
- `WorktreeService`: add `readonly loaded: Signal<boolean>`, set true on the first successful
  `loadWorktrees`.
- `SourceControlService.discardChanges(path, workspaceRoot)` and
  `discardAll(paths, workspaceRoot)`: explicit root. `changed-file-tree.component.ts` passes
  `pending.workspaceRoot`.
- `pending-discard.ts`: `discardConfirmCopy(pending, scopeLabel?: string | null)` appends
  " in worktree «label»" to the description when a label is given. The tree passes
  `worktreeFolderName(root)` when the store scope `isWorktree`.
- Failure behaviour:
  - A resolver rejection falls through (D2).
  - A root the backend refuses shows the existing "unavailable" or "not a Git repository" notice.
    The header still shows the scope, so the user can unpin.
  - A lease RPC failure → no live pushes for that root, and the existing fetch on switch still
    works.
- Quality requirements:
  - No per-session timer or observer: one debounce timer and one renewal interval per renderer,
    both released.
  - Rapid tab switching makes at most one fan-out per distinct root (idempotent reconcile).
- Verification seam:
  - `git-dock-scope.store.spec.ts`:
    - follow mode switches the 5 services in order on an active-tab change;
    - pin keeps the root across tab changes, and unpin returns to follow;
    - `showSession` on the active vs a non-active tab;
    - closed pinned tab keeps the root with `closed: true`;
    - `removeWorkspace` clears the pin;
    - non-Electron always uses the workspace root;
    - the same root twice gives no second fan-out.
  - `git-status.service.spec.ts`:
    - a push for root B while A is active lands only in B's cache (isolation);
    - a backslash vs forward-slash spelling lands on one key;
    - LRU evicts the 13th root and never the active one.
  - `git-root-watch-lease.service.spec.ts`:
    - debounce collapses changes;
    - the renewal interval runs only while non-empty and is cleared on destroy;
    - not Electron → no RPC.
  - `git-branches.service.spec.ts`: a normalized root match refreshes.
  - `source-control.service.spec.ts`: discard sends the explicit root.
- Files:
  - CREATE `libs/frontend/core/src/lib/tokens/git-session-scope.token.ts`
  - MODIFY `libs/frontend/core/src/index.ts`
  - CREATE `libs/frontend/git-ui/src/lib/services/git-dock-scope.store.ts`
  - CREATE `libs/frontend/git-ui/src/lib/services/git-dock-scope.store.spec.ts`
  - CREATE `libs/frontend/git-ui/src/lib/services/git-root-watch-lease.service.ts`
  - CREATE `libs/frontend/git-ui/src/lib/services/git-root-watch-lease.service.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/git-status.service.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/git-branches.service.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/git-branches.service.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/worktree.service.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/worktree.service.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/source-control.service.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/services/source-control.service.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/review-canvas/changed-file-tree.component.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/review-canvas/pending-discard.ts`
  - MODIFY `libs/frontend/git-ui/src/services.ts`

### 7. `GitDockScopeHeaderComponent` (git-ui UI)

- Purpose: show what the dock is scoped to and offer pin and unpin.
- Contract: presentational, standalone, OnPush.

```ts
@Component({ selector: 'ptah-git-dock-scope-header', ... })
export class GitDockScopeHeaderComponent {
  readonly scope = input.required<GitDockScope>();
  readonly branch = input<string | null>(null);
  readonly compact = input(false);
  readonly pinToggled = output<boolean>(); // true = pin, false = unpin
}
```

- Content:
  - A session name, or "Workspace" when there is no session; "(closed)" when `session.closed`.
  - The worktree folder name via `worktreeFolderName(root)`
    (`worktree-scope-bar.component.ts:12-19`), with the full root in `title`.
  - The branch.
  - A source hint ("session worktree", "agent worktree", "workspace").
  - A pin toggle `button` with `aria-pressed`, label "Pin scope" or "Follow active session", and
    the `FOCUS_RING` classes as in the scope bar. Its line is `role="status"` so a scope change is
    announced politely.
- Integration: `ReviewShellComponent` renders it above `<ptah-git-dock-header>`
  (`review-shell.component.ts` template, first child of the column). It binds
  `scope = scopeStore.scope()`, `branch = gitStatus.branchName()`, and
  `(pinToggled) → store.pin()/unpin()`. It changes the not-a-repo copy from "The active workspace
  is not a Git repository." to "This scope is not a Git repository." The read-only
  `WorktreeScopeBarComponent` is unchanged (D6).
- Failure behaviour: none (presentational). A null root shows "No folder open".
- Quality requirements: fits the 300 px dock minimum (truncate the labels, and in `compact` mode
  show the toggle icon only, with an `aria-label`). Keyboard reachable.
- Verification seam: `git-dock-scope-header.component.spec.ts` covers the label variants, the
  `aria-pressed` state, the emitted value, and the closed label. Update `review-shell.component.spec.ts`:
  the header renders with the store scope, and the toggle calls pin and unpin.
- Files:
  - CREATE `libs/frontend/git-ui/src/lib/git-dock/git-dock-scope-header.component.ts`
  - CREATE `libs/frontend/git-ui/src/lib/git-dock/git-dock-scope-header.component.spec.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts`
  - MODIFY `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.spec.ts`

### 8. Stats-card git cell entry (chat-ui)

- Purpose: make the board git cell an entry point into the dock.
- Contract: `CompactSessionActivityComponent` gains `readonly openGit = output<void>()`. The
  board-layout git cell (`:831-845`) becomes a `<button type="button">` with
  `aria-label="Show this session's changes in the git panel"`, the same visual, and `(click)`
  that calls `openGit.emit()` with `$event.stopPropagation()` so the card's own select does not
  fire. It is always a button, because the dock still opens when the state is unknown.
- Failure behaviour: not applicable.
- Verification seam: `compact-session-activity.component.spec.ts`: clicking the git cell emits
  `openGit` once and not `openFullView`.
- Files:
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts`

### 9. Chat wiring: scope source, opener, coordinator, stats root

- `ChatGitSessionScopeSource` (new,
  `libs/frontend/chat/src/lib/services/session-git-scope/chat-git-session-scope.source.ts`, root)
  implements `GitSessionScopeSource`.
  - `candidateFor(tab: TabState)` builds the candidate from:
    - `tab.agentOrigin` (`chat-types.ts:547-561`);
    - `ChatStore.sessions()` row `.organization` matched by `tab.claudeSessionId`
      (`chat.store.ts:111`);
    - the partition path from `tabManager.findTabByIdAcrossWorkspaces(tab.id)?.workspacePath`.
  - `activeSession` = computed over `tabManager.activeTab()` (`tab-manager.service.ts:481`).
  - `openSessions` = computed over the active workspace's tabs.
  - It reads the organization rows only. It must not import or edit the session-organization
    editor or organizer files.
- `sessionWorkingRoot` (`session-git-stats.store.ts:133-139`):
  - New signature `sessionWorkingRoot(tab, partitionPath, fallback, organizationWorktreePath: string | null = null)`.
  - Body: `resolveSessionWorkingRoot({ organizationWorktreePath, agentOriginWorktreePath: tab.agentOrigin?.worktreePath ?? null, sessionCwd: partitionPath, workspaceRoot: fallback ?? null, openFolders: [], registeredWorktrees: null }).root`.
  - With the default it returns exactly the old result, so `chat-input.component.ts:750` is
    unchanged.
  - `compact-session-card.component.ts:391-397` and `inspector-git-section.component.ts:125`
    pass the organization worktree. A helper `organizationWorktreeFor(sessionId)` on the source
    reads it, so card stats and dock root agree (D10).
- `SessionGitDockOpener` (new, `session-git-scope/session-git-dock-opener.service.ts`, root):
  `open(tabId: string): Promise<void>`. It dynamically imports
  `@ptah-extension/git-ui/services` (precedent `workspace-coordinator.service.ts:128`), then:
  - `store.showSession(tabId)`;
  - `navigation.selectTab('changes')`;
  - `layout.setEditorPanelVisible(true)`.
  An import failure is logged with `console.error` and the dock stays as is.
- `compact-session-card.component.ts`: bind `(openGit)="openGitScope()"` on
  `ptah-compact-session-activity` (template `:178-195`). The method calls
  `void this.gitDockOpener.open(this.tabId())`. Two small hunks only (sibling risk, D13).
- `WorkspaceCoordinatorService`:
  - `resolveGitServices` also resolves `GitDockScopeStore`.
  - `switchWorkspace` replaces the loop at `:203-205` with `store.setWorkspace(newPath)`, keeping
    the generation check at `:202`.
  - `removeWorkspaceState` keeps the per-service loop (`:304-307`) and adds
    `store.removeWorkspace(workspacePath)`.
  - Update the class doc (`:35-53`).
- `app.config.ts`:
  `{ provide: GIT_SESSION_SCOPE_SOURCE, useExisting: ChatGitSessionScopeSource }` beside
  `WORKSPACE_COORDINATOR` (`:296-297`).
- Failure behaviour: a missing org row → null (falls through). A dynamic import failure in the
  coordinator is caught and logged as today (`:207-212`).
- Verification seam:
  - `chat-git-session-scope.source.spec.ts`: candidate fields from tab, org row and partition;
    `activeSession` reacts to an active-tab change.
  - `session-git-dock-opener.service.spec.ts`: open calls `showSession`, `selectTab` and
    `setEditorPanelVisible(true)`.
  - `workspace-coordinator.service.spec.ts`: switch calls `store.setWorkspace` once and no
    per-service `switchWorkspace`; remove calls both.
  - `session-git-stats.store.spec.ts`: `sessionWorkingRoot` with an org worktree prefers it, and
    without one keeps the old result.
- Files:
  - CREATE `libs/frontend/chat/src/lib/services/session-git-scope/chat-git-session-scope.source.ts`
  - CREATE `libs/frontend/chat/src/lib/services/session-git-scope/chat-git-session-scope.source.spec.ts`
  - CREATE `libs/frontend/chat/src/lib/services/session-git-scope/session-git-dock-opener.service.ts`
  - CREATE `libs/frontend/chat/src/lib/services/session-git-scope/session-git-dock-opener.service.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts`
  - MODIFY `libs/frontend/chat/src/index.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts`

## Integration architecture

- Data flow:
  1. A tab switch updates `TabManagerService.activeTab`, which updates
     `ChatGitSessionScopeSource.activeSession`.
  2. `GitDockScopeStore.reconcile()` runs `resolveSessionWorkingRoot` and gets the canonical root.
  3. If the root changed, the store calls `switchWorkspace(root)` on the 5 git services. Each
     restores its per-root cache and fetches when it is stale.
  4. `GitRootWatchLeaseService.update([root, ...openSessionRoots])` sends `git:watchRoots`.
  5. On the backend, `GitWatchRpcHandlers` validates each root with `GitRootResolver`, then calls
     `GitRootWatcherPool.setLease`, which starts or stops `GitWatcherService` instances.
  6. A file change produces `git:status-update { workspaceRoot }`. GitStatusService routes it by
     its normalized key to that root's cache only. SessionGitStatsStore updates the cards of that
     root.
- Writes: dock action → `rpcCall('git:stage' | 'git:commit' | 'git:discard' …, { workspaceRoot: scopeRoot })`
  → `GitRootResolver('folder-or-worktree')` → `GitInfoService` runs in that single root.
- State or persistence:
  - Scope mode and pin: in memory, renderer lifetime (`GitDockScopeStore`).
  - Per-root git caches: in memory, LRU 12.
  - Leases: backend memory, TTL 180 s, renewed every 60 s.
  - Watchers: owned by the pool and disposed at shutdown.
- External boundaries:
  - Renderer → `git:watchRoots`: params validated with Zod, and every root validated as an open
    folder or a live worktree of one.
  - Every `git:*` root goes through `GitRootResolver`.
  - Path arguments keep the `validatePaths` traversal check (`git-info.service.ts:2830`).
- Failure and rollback:
  - A refused root returns the existing failure shapes. The UI shows "unavailable" with the scope
    header still visible, and unpin or follow returns to a valid root.
  - A watcher start failure leaves the root without live pushes, and fetch on switch still works.
  - Nothing is persisted, so a revert needs no data migration.
- Observability:
  - Backend: `[GitRpc]`/`[GitRoot]` warns on refused roots (method plus root). The pool logs
    start, stop and evict at info with the root.
  - Frontend: `console.warn` on a lease failure.

## Architecture-level quality requirements

- Functional:
  - The dock root equals `resolveSessionWorkingRoot` of the active tab in follow mode.
  - A pin survives tab switches.
  - Stage, commit and discard in a session worktree change only that worktree.
  - A push for root X never alters the signals while root Y is scoped.
  - A git-cell click opens the dock on Changes, scoped to that card's root.
- Performance:
  - At most 4 secondary watchers.
  - At most 1 fan-out per distinct root change.
  - At most 1 debounce timer and 1 renewal interval per renderer.
  - Worktree validation is cached for 5 s, so a burst of writes does not respawn the list and
    rev-parse probes each time.
- Security:
  - No cross-tree operation: one validated root per call.
  - `git:addWorktree`/`git:removeWorktree` stay folder-only.
  - A refused root never falls back to the active folder.
  - Destructive actions keep their confirmations, which name the worktree, and send the confirmed
    root.
- Maintainability:
  - Add nothing to `git-info.service.ts`.
  - Root policy lives in one file.
  - git-ui does not import chat.
  - New projects need no new tags.
  - Existing `scope:*`/`type:*` constraints hold (shared util ← feature; core token ← feature).
- Testability: unit coverage for:
  - the resolver precedence and validation table;
  - scope switching (follow, pin, unpin, showSession, workspace removal);
  - per-root isolation (push routing, key normalization, LRU);
  - watcher release (refcount, cap, eviction, lease expiry, dispose);
  - the root policy (worktree writes accepted, worktree admin refused).

## Team-leader handoff

- Recommended executors:
  - Components 1–5: backend-developer (shared contracts, rpc-handlers, platform-core, Electron
    main process).
  - Components 6–9: frontend-developer (Angular signals and components).
- Complexity: HIGH. The work crosses 9 projects and two processes, and changes the root policy of
  every `git:*` handler. Each piece reuses an existing pattern.
- Dependencies and ordering (component-level):
  - 1 and 2 before 3, 4 and 6.
  - 3 before 4.
  - 4 before 5.
  - 6 before 7, 8 and 9 (9 also needs 8's output).
  - 2 before 6 (lease types).
- Parallel-safe work: after B1, B2 (backend) and B4 (frontend core/git-ui services) touch
  disjoint files and may run in parallel. B3 waits for B2. B5 waits for B4. B6 waits for B4 and B5.

### Batches (file-disjoint)

| Batch | Owner | Components | Files | Verify |
| --- | --- | --- | --- | --- |
| B1 | backend-developer | 1, 2 | component 1 and 2 files | `npm run verify -- -p @ptah-extension/shared` |
| B2 | backend-developer | 3, 4 | component 3 and 4 files | `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-extension-vscode` |
| B3 | backend-developer | 5 | component 5 files | `npm run verify -- -p ptah-electron` |
| B4 | frontend-developer | 6 | component 6 files | `npm run verify -- -p @ptah-extension/core,@ptah-extension/git-ui` |
| B5 | frontend-developer | 7, 8 | component 7 and 8 files | `npm run verify -- -p @ptah-extension/git-ui,@ptah-extension/chat-ui` |
| B6 | frontend-developer | 9 | component 9 files | `npm run verify -- -p @ptah-extension/chat,ptah-extension-webview,ptah-electron` |

Final scoped check after B6 (dependents of the changed shared libs; the host typecheck rule from
CLAUDE.md): `npm run verify -- -t typecheck -p ptah-tui,ptah-extension-vscode,ptah-electron`.
Confirm that the header says "Running target typecheck for 3 projects".

- Files affected:
  - CREATE:
    - `libs/shared/src/lib/utils/session-working-root.ts` and its spec
    - `libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.ts` and its spec
    - `libs/backend/rpc-handlers/src/lib/handlers/git-watch-rpc.handlers.ts`, its spec, and
      `git-watch-rpc.schema.ts`
    - `libs/backend/platform-core/src/interfaces/git-root-watch-registry.interface.ts`
    - `apps/ptah-electron/src/services/git-root-watcher-pool.ts` and its spec
    - `libs/frontend/core/src/lib/tokens/git-session-scope.token.ts`
    - `libs/frontend/git-ui/src/lib/services/git-dock-scope.store.ts` and its spec
    - `libs/frontend/git-ui/src/lib/services/git-root-watch-lease.service.ts` and its spec
    - `libs/frontend/git-ui/src/lib/git-dock/git-dock-scope-header.component.ts` and its spec
    - `libs/frontend/chat/src/lib/services/session-git-scope/chat-git-session-scope.source.ts`
      and its spec
    - `libs/frontend/chat/src/lib/services/session-git-scope/session-git-dock-opener.service.ts`
      and its spec
  - MODIFY: every MODIFY path listed in components 1–9.
  - REWRITE: none.
- Verification points:
  - Every `resolveRoot`/`resolveReadRoot` call site in `git-rpc.handlers.ts` (lines 207, 231,
    250, 364, 390, 457, 537, 558, 579, 624, 692, 734, 835, 881, 902, 918, 968, 999, 1022, 1045,
    1080, 1097, 1114, 1131) moves to the resolver with the policy from component 3.
  - The `manifest.spec.ts` invariants (disjoint, total) pass with the new `gitWatch` entry.
  - All three `rpc-surface.spec.ts` files pass (Electron excludes nothing; VS Code and CLI list
    `git:watchRoots`).
  - Check `container.smoke.spec.ts` (A3).
  - `host-source-registry.contract.spec.ts` passes unchanged.
  - No edit to `git-info.service.ts`, `git-watcher.real-git.spec.ts`, display-panel files,
    session-organization editor or organizer files, board link capture, the todos section, or
    other tasks' specs.
  - `nx` lint: no `@nx/enforce-module-boundaries` violation (git-ui must not import chat or
    chat-state).
