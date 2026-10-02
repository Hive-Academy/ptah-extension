# Implementation Plan - TASK_2026_580_9f77

Session organization record: priority, workflow status, pin, worktree, branch,
lineage, PR links and session-task links, stored in SQLite, with server-side
filter and sort, automatic capture, and UI in the sidebar and on task cards.

All paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\task-580` (branch
`feat/task-580-session-organization`). "Verified" means the definition was
opened at the cited line. "Assumption" means it is not proven from source; the
check that resolves it is given next to it.

Rule tags: `[user]` = user-requested (context.md or the user decision below),
`[project: <source>]` = project rule, `[lane]` = introduced by this plan (all
of them are also listed under "Lane-introduced constraints").

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_580_9f77/context.md`,
  `.ptah/specs/TASK_2026_580_9f77/task.md`,
  `.ptah/specs/TASK_2026_584_5e7a/implementation-plan.md` (Revision 1: D-table
  :144-156, Component 1 metadata identity :225-253, Component 3 snapshot
  :318-350, State :949-962, Coordination :1152-1175).
- Repository rules: `CONVENTIONS.md` (there is no root `CLAUDE.md` and no
  library `CLAUDE.md` in this worktree), `eslint.config.mjs` depConstraints
  :254-402.
- Missing decision-critical input: none. One was found and answered (next
  section).

### User decision, 2026-10-01 (binding) `[user]`

The first pass of this plan stopped on a clarification. The answer:

- **Option A, Electron-only.** VS Code gets no organization fields. The
  organization UI is hidden there, the new RPCs return a named
  `organization-unavailable` result, and the session list works as it does
  today.
- **Acceptance criterion 7 is narrowed** to Electron, plus the CLI when SQLite
  is available.
- **Correction to context.md Decision 1.** Its rationale says "SQLite already
  exists in Electron and VS Code". That is wrong for VS Code:
  - `apps/ptah-extension-vscode/src/rpc-host-profile.ts:4-9`: "The
    SQLite/native-backed subsystems ... are Electron-only by design —
    better-sqlite3 and the embedder worker are not available here."
  - `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:77-88`: nothing in
    the VS Code app calls `registerPersistenceSqliteServices`, so VS Code runs
    on `InMemoryTaskIndexStore`.
  - `apps/ptah-extension-vscode/src/di/expected-absent.ts:5-8,58-69` pins "no
    better-sqlite3" and keeps the `persistence` capability absent.

  Decision 1 itself (SQLite storage, degrade where it is absent) stands.

## Codebase evidence

| Evidence                                                                                                                                                                                                                                                                                                                                      | Location                                                                                                                                                                                                                                                       | Architectural implication                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The latest migration is `0049_memory_sediment_quarantine`; the registry array ends at version 49                                                                                                                                                                                                                                              | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:77,363-367`                                                                                                                                                                                       | The new migration is **0050**                                                                                                                                                                        |
| Ten migration specs assert the maximum version is exactly 49; two more list versions ending at 49                                                                                                                                                                                                                                             | `0028…spec.ts:83`, `0030…:38`, `0038…:91`, `0039…:65`, `0040…:78`, `0041…:62`, `0042…:70`, `0043…:54`, `0045…:33`, `0047…:34`; `0044…:67-69`, `0046…:32-34` (all under `persistence-sqlite/src/lib/migrations/`)                                               | The migration batch must update them                                                                                                                                                                 |
| Migration SQL is static text; `${` is forbidden by lint and Semgrep                                                                                                                                                                                                                                                                           | `migrations/index.ts:14-18`; header `0029_task_specs.ts:7-8`                                                                                                                                                                                                   | 0050 is a plain `sql` string                                                                                                                                                                         |
| Migration spec pattern: real SQLite opener, the file fails if no opener loads, registry-entry assertion                                                                                                                                                                                                                                       | `0049_memory_sediment_quarantine.spec.ts:30-49,318-321,355-378`                                                                                                                                                                                                | Template for the 0050 spec                                                                                                                                                                           |
| `SqliteConnectionService`: `db` getter throws `RpcUserError('PERSISTENCE_UNAVAILABLE')` when closed; `isOpen` is live; `onDidOpen`                                                                                                                                                                                                            | `persistence-sqlite/src/lib/sqlite-connection.service.ts:362-370,450-452,479-486`                                                                                                                                                                              | The store checks `isOpen` before each read or write and never caches it                                                                                                                              |
| `SqliteTaskIndexStore`: injects `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, static `?` SQL, `db.transaction(...)`, `isReady()` = `connection.isOpen`                                                                                                                                                                                              | `task-specs/src/lib/task-index.store.ts:244-301,341-382`                                                                                                                                                                                                       | Store template                                                                                                                                                                                       |
| Store spec: real better-sqlite3 `:memory:` via a native probe; one contract suite run against each implementation                                                                                                                                                                                                                             | `task-specs/src/lib/task-index.store.spec.ts:121,532-556`                                                                                                                                                                                                      | Store spec template                                                                                                                                                                                  |
| Store selection when SQLite is absent: `isRegistered(SQLITE_CONNECTION)`                                                                                                                                                                                                                                                                      | `task-specs/src/lib/di/register.ts:73-86`                                                                                                                                                                                                                      | The new lib registers its service only when the connection token is registered                                                                                                                       |
| `startTaskSpecsIndex`: host-activation helper, never aborts activation, subscribes to `onDidOpen`                                                                                                                                                                                                                                             | `task-specs/src/lib/di/start-index.ts:81-133,170-224`                                                                                                                                                                                                          | Pattern for `startSessionOrganization` (registration stays side-effect free, `CONVENTIONS.md` §5)                                                                                                    |
| SQLite is registered in Electron (`phase-2-libraries.ts:358`) and the CLI (`cli-engine/src/lib/thoth/register-thoth-libraries.ts:101`); both then call `registerTaskSpecsServices` / `startTaskSpecsIndex` (Electron `:388,393`; CLI `:146,150`); SDK services are registered earlier (Electron `:194`; CLI `container.ts:640` before `:716`) | cited                                                                                                                                                                                                                                                          | The new register and start calls go right after `startTaskSpecsIndex` in both hosts; VS Code gets no call                                                                                            |
| `normalizeWorkspaceRoot` is the one canonical key function, promoted to platform-core so libs avoid a dependency edge on `task-specs` "(which pulls persistence-sqlite → better-sqlite3 with it)"                                                                                                                                             | `task-specs/src/lib/normalize-workspace-root.ts:1-19`                                                                                                                                                                                                          | The `workspace_root` key uses it. Capture producers (agent-sdk, cli-agent-runtime, vscode-lm-tools) must not import the SQLite lib; they call a platform-core port                                   |
| Port precedent: `IMemoryWriter` in platform-core, implemented by the SQLite lib, "When no adapter is registered (VS Code without SQLite today) ... treat the absence as a graceful skip"                                                                                                                                                      | `platform-core/src/interfaces/memory-writer.interface.ts:1-9`; token `platform-core/src/di/tokens.ts:62-63`; bound in `memory-curator/src/lib/di/register.ts:90-94`; optional injection `vscode-lm-tools/.../ptah-api-builder.service.ts:423-424`              | `ISessionOrganizationRecorder` follows this pattern exactly                                                                                                                                          |
| `IOutputChannel` (`appendLine`) under `PLATFORM_TOKENS.OUTPUT_CHANNEL`; prefix style `'[HarnessPolicySync]'`                                                                                                                                                                                                                                  | `platform-core/src/interfaces/output-channel.interface.ts:9-15`; `platform-core/src/di/tokens.ts:36`; `agent-sdk/src/lib/harness/harness-policy-sync.ts:44,55-56,80-81`                                                                                        | New services log `[SessionOrganization]` lines through it                                                                                                                                            |
| Lint lattice: `scope:extension` → shared/extension; `type:feature` → feature/data-access/ui/util/core; platform-core is `scope:shared,type:util`; persistence-sqlite is `scope:extension,type:util`                                                                                                                                           | `eslint.config.mjs:254-385`; each `project.json`                                                                                                                                                                                                               | New lib tagged `scope:extension,type:feature`; every planned edge is legal                                                                                                                           |
| `SessionMetadata` has no organization field; `_saveInternal` keeps only 4 fields                                                                                                                                                                                                                                                              | `agent-sdk/src/lib/session-metadata-store.ts:64-122,451-501`                                                                                                                                                                                                   | Nothing is added to `SessionMetadata` `[user]`                                                                                                                                                       |
| `onMetadataChanged(listener)` emits `{kind: 'created'\|'updated'\|'deleted'\|'forked', sessionId, workspaceId}`; `delete` emits `'deleted'`                                                                                                                                                                                                   | `session-metadata-store.ts:411-431,976-982`; kinds `shared/src/lib/types/rpc/rpc-editor.types.ts:22-42`                                                                                                                                                        | The delete cascade subscribes to this event, so every delete path is covered. The two production deleters are `session-rpc.handlers.ts:510` and the importer prune `session-importer.service.ts:344` |
| `getForWorkspace(workspaceId)` filters by workspace, excludes children, sorts by `lastActiveAt` descending                                                                                                                                                                                                                                    | `session-metadata-store.ts:630-643`                                                                                                                                                                                                                            | `session:list` keeps this as the row source                                                                                                                                                          |
| `session:list` handler: authorize, `getForWorkspace`, `since`, slice, rows with `messageCount: 0`, `isActive: false`                                                                                                                                                                                                                          | `rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:333-422` (`:386-387`)                                                                                                                                                                                   | Filters and sort are added here through a pure helper. The `messageCount`/`isActive` defect is not fixed here (Follow-ups)                                                                           |
| `SessionRpcHandlers` already injects `SDK_SESSION_TURN_STATE_REGISTRY`                                                                                                                                                                                                                                                                        | `session-rpc.handlers.ts:142-143`; `get(id)` `agent-sdk/.../session-turn-state.registry.ts:448-450`; phases `shared/.../stream-background.ts:227-228`                                                                                                          | Live phase is read at list time and never stored `[user]`                                                                                                                                            |
| `session:delete` flow                                                                                                                                                                                                                                                                                                                         | `session-rpc.handlers.ts:498-538`                                                                                                                                                                                                                              | Cascade is event-driven, so this handler is not changed                                                                                                                                              |
| Params `SessionListParams {workspacePath, limit?, offset?, since?}`; result `{sessions, total, hasMore}`; row `ChatSessionSummary`                                                                                                                                                                                                            | `shared/src/lib/types/rpc/rpc-session.types.ts:65-84`; `shared/src/lib/types/execution/node.ts:225-253`                                                                                                                                                        | Additive optional fields only                                                                                                                                                                        |
| RPC registry and entry map are compile-enforced                                                                                                                                                                                                                                                                                               | `shared/src/lib/types/rpc.types.ts:692,709-743,3564,3572-3582`                                                                                                                                                                                                 | New methods touch both                                                                                                                                                                               |
| Manifest: `requires: []` means every host serves the entry; `session` and `tasks` entries                                                                                                                                                                                                                                                     | `rpc-handlers/src/lib/host-profile/manifest.ts:87-99,259-264,289-294`                                                                                                                                                                                          | The new handler family is `requires: []`, so VS Code serves it and answers `organization-unavailable` `[user]`                                                                                       |
| `persistence` capability is on in Electron and the CLI, off in VS Code                                                                                                                                                                                                                                                                        | `apps/ptah-electron/src/rpc-host-profile.ts:32`; `cli-engine/src/lib/rpc/cli-host-profile.ts:32`; VS Code `:24-30`                                                                                                                                             | Not used as a gate, because a gated method would not exist in VS Code instead of answering "unavailable"                                                                                             |
| Tasks handler pattern: Zod schema file, `parse` → `RpcUserError('INVALID_PARAMS')`, `isAuthorizedWorkspace`, sanitize, `tasks:changed` push rebroadcast from a change event                                                                                                                                                                   | `rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:1-33,284-308,1473-1515`                                                                                                                                                                                   | Pattern for `SessionOrganizationRpcHandlers` and `session:organizationChanged`                                                                                                                       |
| `session:metadataChanged` push is wired only when `wiring.sessionMetadataEvents`, which is false in Electron and the CLI                                                                                                                                                                                                                      | `rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:264-266`; `apps/ptah-electron/src/rpc-host-profile.ts:75`                                                                                                                                           | Electron needs a separate organization push (scope C.4); it is broadcast directly by the handler, like `tasks:changed`                                                                               |
| `MESSAGE_TYPES.SESSION_METADATA_CHANGED`; payload map                                                                                                                                                                                                                                                                                         | `shared/src/lib/types/messages/message-constants.ts:133-134`; `shared/src/lib/types/messages/payload-map.ts:269,364-368`                                                                                                                                       | New `SESSION_ORGANIZATION_CHANGED` sits beside it                                                                                                                                                    |
| Ordered-tuple pattern `TASK_ESTIMATES` + Zod `z.enum(tuple)` + sort by tuple index                                                                                                                                                                                                                                                            | `shared/src/lib/types/task-spec.types.ts:44-45`; `shared/src/lib/types/task-filter.schemas.ts:52`; `shared/src/lib/types/task-filter.ts:542-548`                                                                                                               | `SESSION_PRIORITIES` and `SESSION_WORKFLOW_STATUSES` `[user]`                                                                                                                                        |
| SDK `WorktreeCreate` hook: `input.session_id` (SDK id), `input.name` (branch), `result.worktreePath` known; the callback payload omits the path                                                                                                                                                                                               | `agent-sdk/src/lib/helpers/worktree-hook-handler.ts:50-55,152-259` (`:199-203,226-239`)                                                                                                                                                                        | Capture here, where path and branch are both known                                                                                                                                                   |
| `wireWorktreeCallbacks` broadcasts `git:worktreeChanged` without a session id                                                                                                                                                                                                                                                                 | `cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:338-376`; payload `shared/src/lib/types/rpc/rpc-git.types.ts:212-224`                                                                                                                                       | Add optional `sessionId` to the notification                                                                                                                                                         |
| `ptah_git_worktree_add` → `buildGitNamespace().worktreeAdd` → `onWorktreeChanged` (shared handler that broadcasts)                                                                                                                                                                                                                            | `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts:1298-1330`; `namespace-builders/git-namespace.builder.ts:28-43,97-143`; `ptah-api-builder.service.ts:756-761,999-1024`                                                                                    | Record through a new git-namespace dependency, not in the shared handler (584 reuses that handler, see Coordination)                                                                                 |
| MCP caller identity is the tab id (`getCallerSessionId`); the builder already has optional `SDK_SESSION_LIFECYCLE_MANAGER` with `find(id).realSessionId`                                                                                                                                                                                      | `mcp-core/mcp-request-context.ts:61-63`; `ptah-api-builder.service.ts:137-144,236-241,383-385`                                                                                                                                                                 | MCP-side captures resolve tab id → SDK id before calling the port                                                                                                                                    |
| MCP task tools: always-on core set; thin cases returning the namespace's `{ok:false,error}` JSON; namespace built with Zod schemas                                                                                                                                                                                                            | `protocol-dispatcher.ts:326-336,401-414,2275-2330`; `namespace-builders/tasks-namespace.builder.ts:137-210,660`; `ptah-api-builder.service.ts:810-816`                                                                                                         | Template for `ptah_session_link_task`                                                                                                                                                                |
| `PostToolUsePayload {toolName, toolInput, toolOutput, exitCode, success, sessionId, workspaceRoot, timestamp}`; hook always installed, fans out only when subscribers exist; `sessionId` from `resolveHookSessionId`                                                                                                                          | `agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts:8-26`; `post-tool-use-hook-handler.ts:55-110`; builder `sdk-query-options-builder.ts:1874,1913`                                                                                                  | PR capture subscribes here; `workspaceRoot` is the cwd, not the metadata workspace                                                                                                                   |
| Subscriber precedent with `start()` / disposers                                                                                                                                                                                                                                                                                               | `memory-curator/src/lib/triggers/memory-trigger.service.ts:152-153,172-230`                                                                                                                                                                                    | Capture service shape                                                                                                                                                                                |
| Fork: `metadataStore.create(result.sessionId, workspaceId, forkName, 'forked')`; no source id stored                                                                                                                                                                                                                                          | `agent-sdk/src/lib/helpers/session-fork.service.ts:46-60,123-136`                                                                                                                                                                                              | Fork capture site                                                                                                                                                                                    |
| Ptah CLI child: `addCliSession(parentSessionId, ref)` inside a retry, then `markChildSession(sdkSessionId, …)`; the parent may still be a tab id until it resolves ("Parent session not found" is not retried)                                                                                                                                | `cli-agent-runtime/src/lib/wiring/agent-events.ts:305-329,385-391,422-504`                                                                                                                                                                                     | Child lineage is recorded only after `addCliSession` succeeds, so the parent is a real session with metadata                                                                                         |
| Board start PREFILLS a composer tab; the user presses send; `ChatPromptRequest {prompt, sessionName, resolve}`                                                                                                                                                                                                                                | `tasks-ui/src/lib/services/task-start.service.ts:31-48,111-124`; `core/src/lib/services/app-state.service.ts:173-186`; consumer `chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:48-85`; kept alive by `chat/src/lib/services/chat.store.ts:85` | The session id is known only after the user sends; the link is written at `session:id-resolved` for that tab                                                                                         |
| Frontend `session:id-resolved` handling                                                                                                                                                                                                                                                                                                       | `chat/src/lib/services/chat-message-handler.service.ts:111,148,605-614`                                                                                                                                                                                        | Board-start capture hook point                                                                                                                                                                       |
| Sidebar list: `SessionLoaderService` page size 30, `session:list` calls, client-side name/date filter                                                                                                                                                                                                                                         | `chat/src/lib/services/chat-store/session-loader.service.ts:125,298-342,348-389`; `chat/src/lib/components/templates/app-shell.component.ts:238-270,514-520`                                                                                                   | Loader gains a query; the client-side filter stays only for hosts without organization                                                                                                               |
| Task board components                                                                                                                                                                                                                                                                                                                         | `tasks-ui/src/lib/components/board/task-card.component.ts`; `tasks-ui/src/lib/components/detail/task-detail.component.ts`; board push handling `tasks-ui/src/lib/services/tasks-store.service.ts:53,428,1118`                                                  | Reader for task links; `tasks-ui` must not import `chat` (`task-start.service.ts:40-41`)                                                                                                             |
| Opening a session from outside chat: grid → `requestCanvasSession`; single → `chatStore.switchSession`                                                                                                                                                                                                                                        | `app-shell.component.ts:514-520`; `app-state.service.ts:1161`                                                                                                                                                                                                  | New `requestOpenSession` bridge for the task card                                                                                                                                                    |

## Architecture decision

- **Chosen approach.**
  - A new backend lib, `@ptah-extension/session-organization`, owns:
    - the SQLite store over three tables (migration 0050);
    - a service that owns availability, workspace resolution, validation and
      change events;
    - a capture service that subscribes to PostToolUse (PR links) and to
      metadata deletes (cascade).
  - Capture producers in lower or sibling libs do not import that lib. They
    call a platform-core port, `ISessionOrganizationRecorder`, injected as
    optional. The port is bound only where SQLite is registered (Electron,
    CLI). In VS Code every capture is a no-op.
  - RPCs live in `rpc-handlers`:
    - a new `SessionOrganizationRpcHandlers` served on every host (it answers
      `organization-unavailable` without the service);
    - `session:list` in `SessionRpcHandlers`, which merges JSON metadata rows
      with the organization map in memory and then filters, sorts and pages.
  - The UI keys off a server flag, `organizationAvailable`, not off host
    detection.
- **Rationale.**
  - It follows the two patterns the repository already uses for SQLite-only
    features: the port-with-optional-adapter pattern (`IMemoryWriter`) and the
    "register when the connection token exists" pattern (task index).
  - The JSON store stays the owner of the session itself `[user]`.
  - The in-memory join is linear in sessions, so 500 rows meet the 200 ms
    budget with room to spare (verified by the AC1 spec).

### Material decisions

| #   | Requirement                                                                         | Decision                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                          | Rejected alternative                                                                                                                                                                                                        | Effect on existing code                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Where the store lives `[user: SQLite]`                                              | New lib `libs/backend/session-organization` (`scope:extension`, `type:feature`), imported only by `rpc-handlers` and the Electron/CLI composition roots                                                                                                                                                                     | `normalize-workspace-root.ts:6-10` (why libs avoid the SQLite edge); lattice `eslint.config.mjs:259-262,364-373`  | (a) `agent-sdk`: would pull `persistence-sqlite` into the lib every host and the MCP server depend on. (b) `task-specs`: wrong subject. (c) `persistence-sqlite`: that lib owns the connection and migrations, not features | New lib; `tsconfig.base.json` path; two host call sites                                                                                                                                                                      |
| D2  | Capture from agent-sdk, cli-agent-runtime and vscode-lm-tools without a SQLite edge | Port `ISessionOrganizationRecorder` + `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` in platform-core; consumers inject it `{ isOptional: true }`                                                                                                                                                                          | `memory-writer.interface.ts:1-9`; `ptah-api-builder.service.ts:423-424`                                           | Each producer resolves the service by class: forbidden edge and a crash in VS Code                                                                                                                                          | One interface file, one token, one barrel line                                                                                                                                                                               |
| D3  | Key `(workspace_root, session_id)` `[user]`                                         | `workspace_root = normalizeWorkspaceRoot(metadata.workspaceId ?? hint)`. The service reads the session's metadata first, because a capture's cwd can be a worktree (584 children: `workspaceId` = parent root, cwd = worktree; PostToolUse `workspaceRoot` = cwd)                                                           | `session-metadata-store.ts:566-578`; `post-tool-use-hook-handler.ts:95`; 584 plan D3 :148                         | Key by the capture's cwd: rows for a worktree session would never join the parent workspace's `session:list`                                                                                                                | None                                                                                                                                                                                                                         |
| D4  | Server-side filter and sort `[user]`                                                | `session:list` = metadata rows → join organization map (3 indexed SELECTs per workspace) → filters → sort → count → page → enrich the page only (transcript flag, live phase, missing-task flag)                                                                                                                            | `session-rpc.handlers.ts:353-404`                                                                                 | Filter in SQL: name and `lastActiveAt` live in the JSON store, not SQLite                                                                                                                                                   | `session:list` gains optional params and fields. A request with none of the new params returns the same rows, order and total as today; only additive optional row fields are new (Revision 1, see component 5 "query mode") |
| D5  | VS Code `[user]`                                                                    | New RPCs return `{ ok: false, reason: 'organization-unavailable' }`; `session:list` returns `organizationAvailable: false` and ignores organization params; the UI hides organization controls when the flag is false                                                                                                       | User decision above                                                                                               | Gate the family with `requires: ['persistence']`: the methods would not exist in VS Code at all, instead of returning the named result                                                                                      | VS Code sidebar unchanged                                                                                                                                                                                                    |
| D6  | Workflow status vs run state `[user]`                                               | Stored: `status`. Not stored: live phase, read from `SessionTurnStateRegistry.get(id)?.phase` at list time                                                                                                                                                                                                                  | Decision 3; `session-turn-state.registry.ts:448-450`                                                              | Persist the phase: stale after every restart                                                                                                                                                                                | None                                                                                                                                                                                                                         |
| D7  | Delete cascade `[user]`                                                             | The capture service subscribes to `SessionMetadataStore.onMetadataChanged`; on `'deleted'` it deletes the session's rows in all three tables in one transaction                                                                                                                                                             | `session-metadata-store.ts:411-431,976-982`                                                                       | Cascade in the `session:delete` handler only: misses the importer prune (`session-importer.service.ts:344`)                                                                                                                 | No change to `session:delete`                                                                                                                                                                                                |
| D8  | SDK worktree capture `[user]`                                                       | `WorktreeHookHandler` gets the optional recorder and calls `recordWorktree` after `addWorktree` succeeds; the callback payload gains `worktreePath`; `wireWorktreeCallbacks` adds `sessionId` to `git:worktreeChanged`                                                                                                      | `worktree-hook-handler.ts:199-239`; `sdk-callbacks.ts:347-376`                                                    | Capture in `sdk-callbacks.ts`: that lib only has the branch name and resolves the path again through a host callback                                                                                                        | Two additive fields                                                                                                                                                                                                          |
| D9  | MCP worktree capture `[user]`                                                       | `buildGitNamespace` gets an optional `recordWorktreeForCaller(worktreePath, branch)` dependency and a `resolveCallerSessionId()` dependency, called only in `worktreeAdd` success. The shared `buildWorktreeChangeHandler` is NOT changed                                                                                   | `git-namespace.builder.ts:97-143`; `ptah-api-builder.service.ts:999-1024`                                         | Record inside the shared handler using the MCP caller: 584's `ptah_session_start` fires the same handler (584 plan :723-727), which would record the child's worktree on the PARENT                                         | New optional deps; the handler stays unchanged                                                                                                                                                                               |
| D10 | PR capture `[user]`                                                                 | PostToolUse subscriber in the new lib; pure extractor `extractGhPrCreateUrl(payload)`: tool `Bash`, `toolInput.command` contains `gh pr create`, `success`, first `https://github.com/<owner>/<repo>/pull/<n>` in the stringified output                                                                                    | `post-tool-use-callback-registry.ts:8-17`; `post-tool-use-hook-handler.ts:72-97`                                  | Parse every tool output for PR URLs: would link PRs the agent only mentioned or viewed                                                                                                                                      | None                                                                                                                                                                                                                         |
| D11 | Board start link `[user]`                                                           | Frontend capture: `TaskStartService` passes `taskId` on `ChatPromptRequest`; the bridge registers `(tabId → taskId)` with a root `BoardTaskLinkCaptureService`; `ChatMessageHandler` on `session:id-resolved` hands `(tabId, realSessionId)` to it, which calls `session:linkTask {role: 'primary', source: 'board-start'}` | `task-start.service.ts:111-124`; `task-prompt-bridge.service.ts:48-85`; `chat-message-handler.service.ts:605-614` | Backend capture through a new `chat:start` param: changes the `chat:start` contract and the send path for a prefill the user may never send                                                                                 | `ChatPromptRequest` gains optional `taskId`                                                                                                                                                                                  |
| D12 | Agent links a task `[user]`                                                         | New always-on MCP tool `ptah_session_link_task {taskId, role?}`; the caller comes from the transport (never an argument), resolved tab → SDK id                                                                                                                                                                             | `protocol-dispatcher.ts:326-336,401-414`; `ptah-api-builder.service.ts:236-241`                                   | A `sessionId` option on `ptah_task_update`: that tool writes `task.md`; links are deliberately not frontmatter (Decision 2)                                                                                                 | New tool definition + case                                                                                                                                                                                                   |
| D13 | Lineage `[user]`                                                                    | Fork: `SessionForkService` calls `recordLineage({forkOfSessionId})` after `create`. Ptah CLI child: `persistCliSessionReference` calls `recordLineage({parentSessionId, startedBy: 'agent'})` after `addCliSession` succeeds. 584 child: see Coordination                                                                   | `session-fork.service.ts:131-136`; `agent-events.ts:438-470,491-504`                                              | Record the child at `markChildSession` time: the parent may still be a tab id there                                                                                                                                         | Two optional injections / resolves                                                                                                                                                                                           |
| D14 | Organization change push for Electron `[user: C.4]`                                 | `SessionOrganizationService.onDidChange` → `SessionOrganizationRpcHandlers` broadcasts `session:organizationChanged {workspaceRoot, sessionIds, reason}` (the `tasks:changed` pattern). The sidebar and the task board reload on it                                                                                         | `tasks-rpc.handlers.ts:304-307,1502-1515`                                                                         | Turn on `sessionMetadataEvents` in Electron: a different event, and a separate existing gap                                                                                                                                 | New `MESSAGE_TYPES` key                                                                                                                                                                                                      |
| D15 | Logging `[user]`                                                                    | New backend classes log via `IOutputChannel` with a `[SessionOrganization]` prefix. Modified existing classes (`WorktreeHookHandler`, `SessionForkService`, agent-events, handlers) keep their current logger                                                                                                               | `harness-policy-sync.ts:44,55-56`; 584 plan D11 :156                                                              | Migrate existing loggers: churn outside scope                                                                                                                                                                               | None                                                                                                                                                                                                                         |

- **Assumptions (each with its check):**
  - **G1 (was A1): SDK id rotation. Revision 1 turns this from an
    assumption into a gate with a decided outcome.** The gate passes before
    batch A3 starts because the decision below is final. The executor
    implements it and does not re-decide it.

    The trace (Verified in this worktree):

    1. Every system `init` message calls `onSessionIdResolved(tabId, realSessionId)`
       (`agent-sdk/src/lib/helpers/stream-transformer.ts:472-477`).
    2. New-chat path, `createSessionIdCallback`
       (`sdk-agent-adapter.ts:1102-1160`):
       - `bindRefused` accepts `bound`, `already-bound` and `rebound`
         (`:1187-1203`);
       - then `metadataStore.create(realSessionId, …)` (`:1140`). `create`
         makes a NEW record for an unknown id (`session-metadata-store.ts:1061-1091`).
    3. Resume path, `resumeCallback` (`sdk-agent-adapter.ts:1002-1039`): only
       `metadataStore.touch(realSessionId)` (`:1027`). `touch` is a no-op for
       an unknown id (`session-metadata-store.ts:879-887`), so a resume can
       never create a record under a new id. The visible row keeps the old
       id, and so do its organization rows.
    4. The ONLY registry outcome in which the SAME conversation (same record,
       proven by the owner token) reports a different SDK id is `'rebound'`
       (`session-lifecycle/session-registry.service.ts:147-152,310-324`). The
       code comment names resume + `forkSession` as the cause. A first `init`
       on a fresh record is `'bound'` (`realSessionId` starts null, `:59`).
       `/clear` starts a new record, not a rebind
       (`chat-session.service.ts:473-483`).
    5. No production caller passes `forkSession: true` to a resume today:
       - the option is only threaded through
         (`session-lifecycle-manager.ts:238,608`,
         `sdk-query-options-builder.ts:1311,1425-1433`);
       - user forks use the standalone SDK `forkSession()` export instead
         (`session-fork.service.ts:71-114`), which is a new session recorded
         as fork lineage (D13).
    6. Source cannot rule out the SDK emitting a second `init` with a new id
       inside one process, for example after compaction. The frontend treats
       that as real (`stream-router.service.ts:168-173,336-341,481`). If it
       happens on the new-chat path, step 2 creates a second metadata record
       and a second sidebar row. Organization rows keyed by the old id would
       stay on the old row.

    **Outcome (decided):** rotation reaches `SessionMetadataStore` only
    through `'rebound'` on the new-chat path. The plan re-keys exactly there:
    - `SessionIdResolvedPayload` gains `previousSessionId?: string`;
    - `SdkAgentAdapter.createSessionIdCallback` sets it only when the bind
      outcome is `'rebound'` (not on the resume path, where no new record
      exists and the visible row keeps the old id);
    - `SessionOrganizationCaptureService` subscribes to
      `SessionIdResolvedCallbackRegistry` and calls
      `store.rekeySession(previousSessionId, realSessionId)`.

    Details: component 13 (agent-sdk signal) and component 4 (store and
    capture). Smoke S5 remains as field evidence, not as the design check.

  - **A2.** Ptah CLI `createChild` call sites have no parent id
    (`rpc-handlers/.../agent-rpc.handlers.ts:971`,
    `chat-stream-broadcaster.service.ts:211`). Check: read both. If one has a
    real parent id, add the same `recordLineage` call there.
  - **A3.** An RPC exists to open a folder path in the desktop host, for
    "Open worktree". Check: frontend-developer greps the RPC registry for an
    editor/folder open method (e.g. `editor:*`, `file:open`). If none fits a
    directory, the action copies the path to the clipboard and says so.
  - **A4.** Rows for hidden ptah-cli children (`isChildSession`) stay hidden
    from the sidebar (unchanged). Their lineage is read only through the
    parent's `childCount`. Check: none needed; this is a statement of scope.
- **Effect on existing code.** Nothing is replaced.
  - Extended in place: `SessionRpcHandlers.session:list` (optional params and
    fields), `WorktreeHookHandler`, `SessionForkService`,
    `persistCliSessionReference`, `wireWorktreeCallbacks`, `buildGitNamespace`,
    the dispatcher, the MCP builder, `ChatPromptRequest`,
    `TaskPromptBridgeService`, `ChatMessageHandler`, `SessionLoaderService`,
    the app shell, and the task card and detail.
  - Left alone: `SessionMetadata`, `session:delete`, the `chat:start`
    contract, `sessionMetadataEvents` wiring, and task frontmatter.

## Component specifications

### 1. Shared contracts (shared)

- **Purpose:** the one definition of the vocabulary and the wire shapes.
- **Responsibilities:**
  - New file `session-organization.types.ts`:
    - `SESSION_PRIORITIES = ['urgent','high','normal','low'] as const` (tuple
      order is the sort order) `[user]`.
    - `SESSION_WORKFLOW_STATUSES = ['active','waiting','in_review','done','archived'] as const` `[user]`.
    - `SESSION_TASK_LINK_ROLES = ['primary','related']` `[user]`.
    - `SESSION_TASK_LINK_SOURCES = ['board-start','agent','user']` `[user]`.
    - `SESSION_PR_LINK_SOURCES = ['agent','user']` `[user]`.
    - `SESSION_PR_STATES = ['open','draft','merged','closed']` `[lane]`.
    - `SESSION_STARTED_BY = ['user','agent']` `[user: 584]`.
    - `SESSION_LIST_SORTS = ['lastActive','priority','created','name']` `[user]`.
    - `SESSION_LIST_GROUPS = ['none','status','task','parent']` `[lane]`.
    - Derived union types.
    - `SessionOrganizationSummary`:
      ```ts
      {
        priority;
        status;
        pinned: boolean;
        worktreePath: string | null;
        branch: string | null;
        parentSessionId: string | null;
        forkOfSessionId: string | null;
        startedBy;
        tasks: {
          taskId;
          role;
          source;
          createdAt: number;
          missing: boolean;
        }
        [];
        prLinks: {
          url;
          number: number | null;
          repo: string | null;
          state: SessionPrState | null;
          source;
          createdAt: number;
        }
        [];
        childCount: number;
        updatedAt: number | null;
      }
      ```
      `updatedAt` is null when no row exists.
    - `SESSION_ORGANIZATION_DEFAULTS` (`normal`, `active`, `false`, `user`).
  - `rpc-session.types.ts`:
    - `SessionListParams` gains optional `status?`, `priority?`, `taskId?`,
      `pinned?`, `hasPr?`, `text?`, `sort?`, `groupBy?`.
    - `SessionListResult` gains `organizationAvailable: boolean`.
    - New params/results for `session:setOrganization`, `session:linkTask`,
      `session:unlinkTask`, `session:addPrLink`, `session:removePrLink`,
      `session:listForTasks`.
    - Mutation result:
      ```ts
      type SessionOrganizationMutationResult = { ok: true; organization: SessionOrganizationSummary } | { ok: false; reason: 'organization-unavailable' | 'session-not-found'; message: string };
      ```
    - `session:listForTasks` result:
      ```ts
      | { available: true; links: Record<string, TaskLinkedSession[]> }
      | { available: false }
      ```
      with `TaskLinkedSession = { sessionId; name; role; source; livePhase: SessionTurnPhase | null; prLinks }`.
  - `ChatSessionSummary` (`execution/node.ts:225`) gains optional
    `organization?: SessionOrganizationSummary` and
    `livePhase?: SessionTurnPhase`.
  - `rpc.types.ts`: six registry entries and six `RPC_METHOD_ENTRIES` keys.
  - `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED = 'session:organizationChanged'`
    and a payload-map entry
    `{ workspaceRoot: string; sessionIds: string[]; reason: 'user' | 'capture' | 'delete' }`.
  - `GitWorktreeChangedNotification` gains optional `sessionId?: string`.
  - `WorktreeCreatedCallback` data in `shared/src/lib/types/agent-adapter.types.ts:96-101`
    gains optional `worktreePath?: string`. This is the shared twin of the
    agent-sdk type that component 6 extends, so the field lands here with the
    other shared edits.
  - Every addition is optional or new, so existing callers compile unchanged
    `[project: CONVENTIONS.md §3 barrel rules]`.
- **Verified contracts:** `rpc-session.types.ts:65-84`; `node.ts:225-253`;
  `rpc.types.ts:692,3564`; `message-constants.ts:133-134`;
  `payload-map.ts:269,364-368`; `rpc-git.types.ts:212-224`;
  `task-spec.types.ts:44-45`.
- **Dependencies:** none (L0).
- **Failure behaviour:** not applicable (types and constants).
- **Verification seam:**
  - A spec pins tuple order.
  - The registry compile check.
  - `rpc-surface.spec.ts` in VS Code stays green (the new methods are
    registered, not excluded).
- **Files:**
  - CREATE `libs/shared/src/lib/types/session-organization.types.ts` (+ `.spec.ts`)
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-session.types.ts`
  - MODIFY `libs/shared/src/lib/types/execution/node.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`
  - MODIFY `libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-git.types.ts`
  - MODIFY `libs/shared/src/lib/types/agent-adapter.types.ts`
  - MODIFY the shared barrel that exports `task-spec.types` (Assumption:
    `libs/shared/src/index.ts` or `lib/types/index.ts`; the executor adds one
    grouped line where `task-spec.types` is exported)

### 2. Migration 0050 (persistence-sqlite)

- **Purpose:** the durable schema, with room for 584 `[user]`.
- **Responsibilities:** `0050_session_organization.ts`, static SQL `[project: migrations/index.ts:14-18]`:
  ```sql
  CREATE TABLE IF NOT EXISTS session_organization (
    workspace_root     TEXT    NOT NULL,
    session_id         TEXT    NOT NULL,
    priority           TEXT    NOT NULL DEFAULT 'normal',
    status             TEXT    NOT NULL DEFAULT 'active',
    pinned             INTEGER NOT NULL DEFAULT 0,
    worktree_path      TEXT,
    branch             TEXT,
    parent_session_id  TEXT,
    fork_of_session_id TEXT,
    started_by         TEXT    NOT NULL DEFAULT 'user',
    updated_at         INTEGER NOT NULL,
    PRIMARY KEY (workspace_root, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_session_org_parent
    ON session_organization (workspace_root, parent_session_id);

  CREATE TABLE IF NOT EXISTS session_task_links (
    workspace_root TEXT    NOT NULL,
    session_id     TEXT    NOT NULL,
    task_id        TEXT    NOT NULL,
    role           TEXT    NOT NULL,
    source         TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_root, session_id, task_id)
  );
  CREATE INDEX IF NOT EXISTS idx_session_task_links_task
    ON session_task_links (workspace_root, task_id);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_session_task_links_primary
    ON session_task_links (workspace_root, session_id) WHERE role = 'primary';

  CREATE TABLE IF NOT EXISTS session_pr_links (
    workspace_root TEXT    NOT NULL,
    session_id     TEXT    NOT NULL,
    url            TEXT    NOT NULL,
    number         INTEGER,
    repo           TEXT,
    state          TEXT,
    source         TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (workspace_root, session_id, url)
  );
  ```
  - No `CHECK` constraints on enum columns `[lane L1]`: SQLite cannot alter a
    CHECK without rebuilding the table, so the vocabulary is enforced at the
    boundary (Zod) and read tolerantly (component 3).
  - No foreign keys to sessions: sessions live in the JSON store.
  - Registry entry `{ version: 50, name: '0050_session_organization', sql }`.
- **Verified contracts:** `migrations/index.ts:80-129,363-367`; spec pattern
  `0049…spec.ts:30-49,318-321,355-378`; version asserts listed in Codebase
  evidence.
- **Failure behaviour:** a migration failure closes the connection and
  classifies it (`sqlite-connection.service.ts:251-255`). The feature then
  reports unavailable (component 3); no special code.
- **Verification seam:** `0050_session_organization.spec.ts` covers:
  - the registry entry and static SQL;
  - applied on top of 1..49: tables, indexes, defaults;
  - the partial unique index rejects a second `primary`;
  - re-run is prevented by the ledger (0031 pattern).

  The twelve existing specs are updated from 49 to 50.

- **Files:**
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts` (+ `.spec.ts`)
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
  - MODIFY the twelve specs: `0028…spec.ts`, `0030…`, `0038…`, `0039…`,
    `0040…`, `0041…`, `0042…`, `0043…`, `0044…`, `0045…`, `0046…`, `0047…`
    (lines in Codebase evidence)

### 3. Recorder port (platform-core)

- **Purpose:** let capture producers write without a SQLite dependency.
- **Responsibilities:** `session-organization-recorder.interface.ts`:
  ```ts
  export interface ISessionOrganizationRecorder {
    recordWorktree(input: { sessionId: string; workspaceRootHint?: string; worktreePath: string; branch?: string }): void;
    recordLineage(input: { sessionId: string; workspaceRootHint?: string; parentSessionId?: string; forkOfSessionId?: string; startedBy?: SessionStartedBy }): void;
    linkTask(input: { sessionId: string; workspaceRootHint?: string; taskId: string; role: SessionTaskLinkRole; source: SessionTaskLinkSource }): void;
    addPrLink(input: { sessionId: string; workspaceRootHint?: string; url: string; state?: SessionPrState; source: SessionPrLinkSource }): void;
    /** 584: one call when an agent-started child's SDK id is known. One transaction. */
    recordAgentStartedSession(input: { sessionId: string; workspaceRoot: string; parentSessionId?: string; worktreePath: string; branch: string; taskId?: string }): void;
  }
  ```
  - Contract, stated in the file header (`memory-writer.interface.ts:1-9`
    pattern):
    - every `sessionId` is an SDK session UUID, never a tab id;
    - methods never throw and return nothing;
    - when no adapter is registered (VS Code), consumers skip.
  - Token `SESSION_ORGANIZATION_RECORDER: Symbol.for('PlatformSessionOrganizationRecorder')` `[project: CONVENTIONS.md §4]`.
- **Verified contracts:** `platform-core/src/di/tokens.ts:11-127`;
  `platform-core/src/index.ts:119-135`.
- **Dependencies:** platform-core → shared (types). Legal (`scope:shared`).
- **Failure behaviour:** not applicable (contract).
- **Verification seam:** typecheck; the adapter's contract spec (component 4).
- **Files:**
  - CREATE `libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts`
  - MODIFY `libs/backend/platform-core/src/di/tokens.ts`
  - MODIFY `libs/backend/platform-core/src/index.ts`

### 4. `@ptah-extension/session-organization` lib: store, service, delete cascade, registration

- **Purpose:** own the organization data and its rules.
- **Responsibilities:**
  - **`SessionOrganizationStore`** (`*Store`, pure I/O, `[project: CONVENTIONS.md §6]`):
    - `isReady()` returns `connection.isOpen`, read live each call
      (`task-index.store.ts:264-266` pattern).
    - `listWorkspace(root)`: 3 prepared SELECTs on the PK prefix, returns
      `Map<sessionId, StoredOrganization>`.
    - `listTaskLinks(root, taskIds?)`.
    - `upsertOrganization(root, sessionId, patch, now)`: only the patched
      columns change; the row is inserted with defaults on first write.
    - `linkTask(root, sessionId, link, now)`: in one transaction, a `primary`
      demotes an existing different primary to `related` `[lane L2]`.
    - `unlinkTask`, `addPrLink` (upsert by url), `removePrLink`.
    - `recordAgentStartedSession(...)` in one transaction.
    - `deleteSession(root, sessionId)` in one transaction over the three
      tables.
    - `countChildren(root)`: `GROUP BY parent_session_id`.
    - `rekeySession(oldId, newId)` (Revision 1, G1): one transaction, all
      workspaces (SDK ids are globally unique, so no root is needed):
      - move `session_organization`, `session_task_links` and
        `session_pr_links` rows from `oldId` to `newId`;
      - rewrite `parent_session_id = oldId` and `fork_of_session_id = oldId`
        to `newId`;
      - when `newId` already has an organization row, keep the `newId` row,
        still move links whose `(task_id)` / `(url)` are not present under
        `newId`, delete the remaining `oldId` rows, and log one line;
      - no-op when `oldId === newId` or no `oldId` rows exist;
      - returns the affected workspace roots for `onDidChange`.
    - Static SQL, `?` parameters only `[project: CONVENTIONS / task-index.store.ts:341-382]`.
  - **Tolerant read** `[lane L1]`: an enum column holding an unknown value
    maps to the default, and one `[SessionOrganization]` line is logged per
    list call.
  - **`SessionOrganizationService`** (`*Service`; implements
    `ISessionOrganizationRecorder` and the query/mutation API used by
    handlers):
    - `isAvailable()` = store ready.
    - `resolveRoot(sessionId, hint)` [D3] via `SessionMetadataStore.get`. If
      neither is known, the write is dropped and logged.
    - Mutations validate with the shared tuples and return the discriminated
      result. `session-not-found` when no metadata exists.
    - PR URL parsing: `https:` only, ≤ 2048 chars. GitHub `owner/repo` and
      `number` are parsed when the URL matches; otherwise both are null
      `[lane L14]`.
    - Emits `onDidChange({workspaceRoot, sessionIds, reason})` after every
      committed write.
    - When not available, recorder calls are no-ops with one log line per
      call, so captures before the DB opens are dropped and logged
      `[lane L8]`.
    - `queryWorkspace(root)` is the organization map for `session:list`.
  - **`SessionOrganizationCaptureService`**: `start()`/`dispose()` (sync,
    idempotent `[project: CONVENTIONS.md §9]`). `start()` subscribes to
    `SessionMetadataStore.onMetadataChanged`: `'deleted'` →
    `store.deleteSession(normalize(workspaceId), sessionId)` → `onDidChange`
    with `reason: 'delete'` [D7]. The PR subscription is added in component 7.
    - Revision 1 (G1): `start()` also subscribes to
      `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY`
      (`agent-sdk/src/lib/di/tokens.ts:145-147`).
    - When `payload.previousSessionId` is set and differs from
      `payload.realSessionId`, it calls `store.rekeySession(previous, real)`,
      emits `onDidChange` with `reason: 'capture'`, and logs one
      `[SessionOrganization]` line.
    - The handler is synchronous (better-sqlite3 is synchronous), which
      honours the registry's "treat the handler as synchronous" contract
      (`session-id-resolved-callback-registry.ts:26-27`).
    - Unavailable store → the rekey is dropped and logged (L8).
    - The disposer is released in `dispose()`. Three host-wide
      subscriptions in total.
  - **`registerSessionOrganizationServices(container)`** `[project: CONVENTIONS.md §5]`:
    - registers store, service and capture service as singletons, plus
      `SESSION_ORGANIZATION_TOKENS.SERVICE`;
    - binds `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` via `useToken` to
      the service;
    - all of it only when `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)`
      (`task-specs/src/lib/di/register.ts:80-86` pattern);
    - no side effects.
  - **`startSessionOrganization(container)`**: resolves the capture service
    and calls `start()`. Every failure is swallowed into an `IOutputChannel`
    line (`start-index.ts:13-17` guarantees). Returns `IDisposable`.
- **Verified contracts:** `sqlite-connection.service.ts:46-78,362-370,450-452`;
  `PERSISTENCE_TOKENS.SQLITE_CONNECTION` `persistence-sqlite/src/lib/di/tokens.ts:12`;
  `SDK_TOKENS.SDK_SESSION_METADATA_STORE` `agent-sdk/src/lib/di/tokens.ts:27`;
  `onMetadataChanged` `session-metadata-store.ts:411-416`;
  `normalizeWorkspaceRoot` (platform-core, re-exported
  `normalize-workspace-root.ts:19`); `IOutputChannel`
  `output-channel.interface.ts:9-15`.
- **Dependencies (downward only):** `persistence-sqlite`, `platform-core`,
  `shared`, `agent-sdk` (metadata store and PostToolUse registry types and
  tokens). Nothing imports this lib except `rpc-handlers` and the two
  composition roots.
- **Integration points:**
  - the port consumers (components 6-8);
  - `SessionRpcHandlers` and `SessionOrganizationRpcHandlers` (component 5);
  - host wiring (component 9).
- **Failure behaviour:**
  - `db` getter throws (connection closed mid-call): the service catches it,
    logs, returns `organization-unavailable` / no-op.
  - Constraint violation on the primary index cannot happen, because the
    demotion is in the same transaction.
  - Any other SQL error is logged and surfaced as a sanitized RPC error by the
    handler (`tasks-rpc.handlers.ts:1493-1499` pattern).
- **Quality requirements:**
  - `queryWorkspace` for 500 sessions with 2 links each takes < 20 ms on the
    test machine (part of AC1).
  - No timer, no per-session listener; host-wide subscriptions only
    (metadata events, session-id resolved in Revision 1, PostToolUse in
    component 7), released in `dispose()`.
- **Verification seam:**
  - store contract spec on real SQLite (native probe pattern
    `task-index.store.spec.ts:532-556`): every method, primary demotion,
    tolerant read, transactional delete;
  - service spec with fake store and metadata store: root resolution order,
    validation, unavailable path, change events, PR URL parsing table;
  - capture spec with a REAL `SessionMetadataStore` over fake storage:
    `delete()` removes rows (AC6, reachability of the cascade);
  - Revision 1 (G1):
    - store spec for `rekeySession`: move, reference rewrite, conflict
      rule, no-op cases;
    - capture reachability spec with the REAL
      `SessionIdResolvedCallbackRegistry`: `notifyAll({tabId, realSessionId: B, previousSessionId: A})`
      calls `rekeySession(A, B)`; a payload without `previousSessionId`
      calls nothing;
  - register spec: nothing is bound without `SQLITE_CONNECTION`; the port and
    service are bound with it.
- **Files:**
  - CREATE `libs/backend/session-organization/project.json` (tags
    `scope:extension`, `type:feature`; targets copied from `task-specs`),
    `jest.config.ts`, `tsconfig.json`, `tsconfig.lib.json`,
    `tsconfig.spec.json`, `package.json` if the `task-specs` template has one
  - CREATE `libs/backend/session-organization/src/index.ts`
  - CREATE `libs/backend/session-organization/src/lib/di/tokens.ts`, `src/lib/di/register.ts` (+ spec), `src/lib/di/start.ts` (+ spec)
  - CREATE `libs/backend/session-organization/src/lib/session-organization.store.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/session-organization/src/lib/session-organization.service.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/session-organization/src/lib/session-organization-capture.service.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/session-organization/src/lib/utils/pr-url.ts` (+ `.spec.ts`)
  - MODIFY `tsconfig.base.json` (one path entry, `task-specs` line 147 pattern)

### 5. RPC handlers: `session:list` extension and `SessionOrganizationRpcHandlers` (rpc-handlers)

- **Purpose:** the only webview entry to organization data.
- **Responsibilities:**
  - **`session-list-query.ts`** (pure, `utils`-style): `applySessionListQuery(rows, orgMap, params)`. 0. **Query mode (Revision 1).** The request is in query mode when it
    carries at least one of the new params: `status`, `priority`,
    `taskId`, `pinned`, `hasPr`, `text`, `sort`, `groupBy`.
    - Without query mode (every existing caller today, e.g.
      `SessionLoaderService` before C1 and `ClaudeRpcService.listSessions`
      `core/src/lib/services/claude-rpc.service.ts:254-264`), steps 1-3
      are skipped. The rows, their order (`getForWorkspace`'s
      `lastActiveAt` descending, `session-metadata-store.ts:642`) and
      `total` are identical to today. Only the additive optional fields
      (`organization`, `livePhase`, `organizationAvailable`) are new.
    - Archived rows are therefore returned without query mode.
    1. Organization filters, only in query mode and only when the map is
       present:
       - `status[]`: rows without a stored row count as `active`;
       - `archived` is excluded unless the `status` filter lists it. This
         applies only in query mode (Revision 1) `[lane L3]`;
       - `priority[]`, `pinned`, `hasPr`, `taskId`.
    2. `text`: case-insensitive substring of `name`.
    3. Sort (query mode only):
       - pinned first when organization is available (Revision 1: query mode
         only) `[lane L4]`;
       - then the `groupBy` key when set `[lane L5]`;
       - then the `sort` key (`priority` by tuple index, `created`, `name`,
         default `lastActive`);
       - ties broken by `lastActiveAt` descending.
    4. Return the sorted rows and the total.
  - **`SessionRpcHandlers.session:list`:**
    - new optional injections `SESSION_ORGANIZATION_TOKENS.SERVICE` and
      `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE`;
    - validates the new params with a Zod schema (tasks pattern), otherwise
      `INVALID_PARAMS`;
    - `organizationAvailable = service?.isAvailable() ?? false`;
    - applies the query, then pages;
    - for the page only adds `organization`, including `missing` per linked
      task (one `taskIndex.list(root)` id set, only when a page row has
      links) and `childCount`, plus `livePhase = turnState.get(id)?.phase`;
    - a request with no new param is not in query mode, so its rows, order
      and total are identical to today (Revision 1);
    - logs one `[SessionOrganization]` warn line when the call takes more than
      200 ms `[lane L13]`.
  - **`SessionOrganizationRpcHandlers`** (new; `METHODS` =
    `session:setOrganization`, `session:linkTask`, `session:unlinkTask`,
    `session:addPrLink`, `session:removePrLink`, `session:listForTasks`):
    - Zod schemas in `session-organization-rpc.schema.ts`:
      - `taskId` uses the task-id regex;
      - `url` is a string of at most 2048 characters;
      - `setOrganization` requires at least one field;
      - `linkTask.source` is `'user' | 'board-start'` (default `'user'`), so
        the webview cannot claim `agent`.
    - `authorizeSessionAccess` (the `session-rpc.handlers.ts:281-294`
      semantics: metadata exists and its workspace is open).
    - **Injection (Revision 1):** the service is injected as
      `@inject(SESSION_ORGANIZATION_TOKENS.SERVICE, { isOptional: true }) private readonly organization: SessionOrganizationService | undefined`.
      A plain `@inject` would throw at surface registration on VS Code:
      `requires: []` makes `resolveRpcHandlerPlan` construct the class on
      every host (`rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:104-127`;
      `requires: []` is always enabled, `:58-71`), and VS Code registers no
      service (component 9). `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE` and
      `TOKENS.WEBVIEW_MANAGER` are optional too; the tasks handler injects
      them required, but this handler must not fail where they are absent.
    - Without the service: `{ok: false, reason: 'organization-unavailable'}`
      `[user]`.
    - The constructor subscribes to `organization.onDidChange` **only when
      the service is present** (`if (this.organization) { … }`). It broadcasts
      `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED` [D14]. On VS Code no
      subscription is made (Revision 1).
    - The subscription lives as long as the host, like the `tasks:changed`
      subscription (`tasks-rpc.handlers.ts:304-307`). It is released when the
      service's own `dispose()` clears its emitter.
    - `session:listForTasks {workspacePath, taskIds?}` returns links grouped
      by task, with session name (metadata), `livePhase` and PR links.
  - **Manifest:** `{ key: 'sessionOrganization', methods: SessionOrganizationRpcHandlers.METHODS, requires: [], handler: SessionOrganizationRpcHandlers }`
    `[project: manifest.ts:87-99]`. The handler is auto-resolved like
    `TasksRpcHandlers`, so no app registration is needed.
- **Verified contracts:** `session-rpc.handlers.ts:112-164,281-294,333-422`;
  `manifest.ts:87-99,289-294`; `tasks-rpc.handlers.ts:284-308,1473-1515`;
  `TaskIndexService.list` `task-specs/src/lib/task-index.service.ts:309-332`.
- **Dependencies:** rpc-handlers → session-organization, task-specs,
  agent-sdk, shared, vscode-core. All are existing or legal edges.
- **Failure behaviour:**
  - invalid params → `RpcUserError('INVALID_PARAMS')`;
  - unknown session → `session-not-found`;
  - unavailable → the named result;
  - SQL error → sanitized error, raw error logged;
  - a failing broadcast is logged, never thrown.
- **Quality requirements:** AC1: `session:list` p95 < 200 ms over 500 seeded
  sessions with status and priority filters and priority sort.
- **Verification seam:**
  - `session-list-query.spec.ts`: filter/sort/group table and tie-break.
    Revision 1 cases:
    - no new params: archived and pinned rows keep today's position, and
      `total` counts them;
    - any single new param (e.g. `sort: 'lastActive'`): archived is excluded
      and pinned rows sort first;
    - `status: ['archived']` returns only archived rows.
  - Handler specs:
    - VS Code shape (no service): params ignored, flag false, rows unchanged;
    - Electron shape (fake service): rows enriched;
    - missing task flag;
    - new RPCs: unavailable, not found, validation, broadcast on change.
    - Revision 1:
      - construct `SessionOrganizationRpcHandlers` in a child container with
        NO `SESSION_ORGANIZATION_TOKENS.SERVICE` registered; construction
        succeeds, no `onDidChange` subscription is attempted, and every
        method returns `organization-unavailable`;
      - with the service registered, one subscription is made.
  - **AC1 spec** `session-list.perf.spec.ts`:
    - real `SessionOrganizationStore` on a temp SQLite database with 0050
      applied, a fake metadata store returning 500 sessions, and 500
      organization rows with mixed status/priority, 250 task links and 100 PR
      links;
    - runs the real `session:list` handler function 20 times with
      `{status: ['active','waiting'], priority: ['urgent','high'], sort: 'priority'}`;
    - asserts p95 < 200 ms and that `total` equals the number of rows
      matching the seed;
    - the native module MUST load: the spec fails, not skips, when no SQLite
      opener is available (`0049…spec.ts:355-357` pattern).
- **Files:**
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/session-list.perf.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` (+ its spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY the rpc-handlers barrel that exports handler classes (Assumption:
    `libs/backend/rpc-handlers/src/index.ts`; add where `TasksRpcHandlers` is
    exported)

### 6. SDK-side capture: worktree hook and fork (agent-sdk)

- **Purpose:** record worktree, branch and fork lineage where they happen.
- **Responsibilities:**
  - `WorktreeHookHandler`:
    - optional `@inject(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, { isOptional: true })`;
    - after a successful `addWorktree` (`:199-225`), calls
      `recorder?.recordWorktree({ sessionId: input.session_id, worktreePath: result.worktreePath, branch: input.name, workspaceRootHint: input.cwd })`
      inside the existing try, before the callback;
    - `WorktreeCreatedCallback` data gains `worktreePath` (`:50-55`).
  - `SessionForkService`: optional recorder; after `metadataStore.create(...)`
    (`:131-136`), calls
    `recorder?.recordLineage({ sessionId: result.sessionId, forkOfSessionId: sessionId, workspaceRootHint: workspaceId })`.
  - Both keep their existing `Logger` [D15].
  - Recording lives in the hook, not in `wireWorktreeCallbacks`, because the
    CLI profile sets `worktree: false` (`cli-engine/src/lib/rpc/cli-host-profile.ts:42`),
    so the callback wiring never runs there. The hook runs in every host.
- **Verified contracts:** `worktree-hook-handler.ts:117-259`;
  `session-fork.service.ts:46-146`; token `SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER`
  `agent-sdk/src/lib/di/tokens.ts:61`.
- **Failure behaviour:** the recorder never throws (port contract). The hook's
  return value and the fork result are unchanged.
- **Verification seam (AC8):**
  - Hook spec: build the hooks with `createHooks(cb)`, invoke
    `WorktreeCreate[0].hooks[0]` with a fake `GitInfoService` success, and
    assert `recordWorktree` gets the SDK id, path and branch. The same spec
    with `addWorktree` failing asserts no call.
  - Fork spec: after `forkSession`, `recordLineage` is called with the new id
    and the source id.
  - Both specs fail if the production method stops calling the port.
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts` (+ spec)
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts` (+ spec)

### 7. PR capture subscriber (session-organization lib)

- **Purpose:** `gh pr create` → PR link without user action (AC3).
- **Responsibilities:**
  - `extractGhPrCreateUrl(payload)` (pure, in `utils/pr-url.ts`) [D10]:
    - requires `toolName === 'Bash'`, a `toolInput.command` string containing
      `gh pr create`, and `success`;
    - searches `typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)`
      for `https://github\.com/[\w.-]+/[\w.-]+/pull/\d+`;
    - takes the first match; `state` is `'draft'` when the command contains
      `--draft`, else `'open'` `[lane L7]`.
  - `SessionOrganizationCaptureService.start()` also registers on
    `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` and calls
    `service.addPrLink({ sessionId: payload.sessionId, workspaceRootHint: payload.workspaceRoot, url, state, source: 'agent' })`.
    The disposer is released in `dispose()`.
  - **Tab-id fallback (Revision 1).** `payload.sessionId` is normally the SDK
    id, but `resolveHookSessionId` falls back to the hook closure's routing
    id, which is the tab id, when the hook input lacks `session_id`
    (`post-tool-use-hook-handler.ts:77-87`; `hook-session-resolver.ts:48-53`).
    The adapter documents that this residual case is real
    (`sdk-agent-adapter.ts:1150-1154`).
    - The capture passes the id through unchanged.
    - `SessionOrganizationService.resolveRoot` [D3] finds no metadata under
      a tab id, so the write is **dropped and logged**
      (`[SessionOrganization] PR link dropped: session id has no metadata (likely a tab id)`).
    - The capture must never write a row keyed by a tab id, and must not
      "repair" the drop by using the hint alone. The port contract (component
      3: "every `sessionId` is an SDK session UUID") stands.
    - Outcome: a missed PR link, never a wrong row (risk R5b).
- **Verified contracts:** `post-tool-use-callback-registry.ts:8-26`;
  `callback-registry.base.ts:22-45` (subscriber isolation);
  `post-tool-use-hook-handler.ts:55-110`; token
  `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` `agent-sdk/src/lib/di/tokens.ts:102`.
- **Failure behaviour:**
  - No match: nothing.
  - Subscriber errors are isolated by the registry base and also caught and
    logged locally.
  - A duplicate URL is an upsert (idempotent).
- **Verification seam (AC8):**
  - Extractor table spec: string output, object output, `--draft`, failed
    exit, non-Bash tool, `gh pr view` output, multiple URLs.
  - Reachability spec with the REAL `PostToolUseCallbackRegistry` and the
    REAL `PostToolUseHookHandler`: `startSessionOrganization` on a container
    with fake store and connection, invoke the PostToolUse hook with a
    `gh pr create` input, and assert the store's `addPrLink` was called with
    the session id and `source: 'agent'`.
  - Revision 1: the same reachability spec with a hook input lacking
    `session_id` (so the closure tab id is used) asserts the store is NOT
    called and one drop line is logged.
- **Files:**
  - MODIFY `libs/backend/session-organization/src/lib/utils/pr-url.ts` (+ spec)
  - MODIFY `libs/backend/session-organization/src/lib/session-organization-capture.service.ts` (+ spec)

### 8. Runtime-side capture: worktree notification, child lineage, MCP worktree and link tool (cli-agent-runtime, vscode-lm-tools)

- **Purpose:** the remaining capture paths.
- **Responsibilities:**
  - **`wireWorktreeCallbacks`** (`sdk-callbacks.ts:347-376`):
    - includes `sessionId: data.sessionId` in the `git:worktreeChanged`
      payload `[user]`;
    - uses `data.worktreePath` when present, before falling back to
      `resolveWorktreePath`.
  - **`persistCliSessionReference`** (`agent-events.ts:466-470`): in the
    `.then` after `addCliSession` succeeds, when `sdkSessionId` is set and
    differs from the parent, resolves the optional recorder from `container`
    (`isRegistered` guard, pattern `:333-341`) and calls
    `recordLineage({ sessionId: sdkSessionId, parentSessionId, startedBy: 'agent', workspaceRootHint: info.workingDirectory })`
    [D13].
  - **`buildGitNamespace`**:
    - new optional deps `resolveCallerSessionId?: () => string | undefined`
      and `recordWorktreeForCaller?: (e: { sessionId: string; worktreePath: string; branch: string }) => void`;
    - after a successful add (`:124-136`), when both resolve, records and
      passes `sessionId` in the `onWorktreeChanged` event;
    - the event type gains optional `sessionId`.

    `PtahAPIBuilder` supplies:
    - `resolveCallerSessionId = () => { const c = getCallerSessionId(); return c ? (this.sdkSessionLifecycleManager?.find(c)?.realSessionId ?? undefined) : undefined; }`;
    - `recordWorktreeForCaller` → the optional `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER`;
    - `buildWorktreeChangeHandler` forwards `event.sessionId` into the
      broadcast. It records nothing [D9].

  - **`ptah_session_link_task`** [D12]:
    - Tool definition in a new `session-organization-tools.ts`: input
      `{ taskId: task-id regex, role?: 'primary' | 'related' }` (default
      `primary`).
    - The description says the link is made for the calling session, is
      stored per user, does not edit `task.md`, and returns
      `organization-unavailable` in VS Code.
    - Always-on beside the task tools (`protocol-dispatcher.ts:409-414`)
      `[lane L11]`.
    - Handler through a new `PtahAPI.sessionOrganization` namespace
      (`session-organization-namespace.builder.ts`, Zod-validated,
      `{ok, …}` results like `tasks-namespace.builder.ts`).
    - The caller comes from `getCallerSessionId()` → SDK id. Unresolvable
      caller → `{ok: false, error: 'unattributed-caller'}`.
    - No recorder → `{ok: false, error: 'organization-unavailable'}`.
    - The dispatcher adds one `case`.
    - `TOOL_CONTENT_HINTS` / result budget entry.
    - Sweep spec changes (`mcp-contract.sweep.spec.ts`):
      - add a `TOOL_DRIVERS` entry (`:216`; a missing driver fails at
        `:1210,1817`);
      - add a `DESCRIPTION_BUDGETS` entry (`:2082+`);
      - bump the pinned tool counts `toHaveLength(56)` (`:1707`) and
        `toHaveLength(53)` (`:1731`) by one each. 584 also bumps them, so the
        numbers are a merge point, not a contract.
    - `protocol-dispatcher.spec.ts` `TASK_TOOLS`-style list (`:597-603`).
    - The help text in `namespace-builders/system-namespace.builders.ts:142-147`.
- **Verified contracts:** `sdk-callbacks.ts:31-60,338-394`;
  `agent-events.ts:305-511`; `git-namespace.builder.ts:28-143`;
  `ptah-api-builder.service.ts:236-241,383-385,756-761,810-816,999-1024`;
  `protocol-dispatcher.ts:401-414,2275-2330`; `mcp-request-context.ts:61-63`;
  `tasks-namespace.builder.ts:137-210,660`.
- **Dependencies:** cli-agent-runtime → platform-core (existing);
  vscode-lm-tools → platform-core (existing). No new lib edge.
- **Failure behaviour:**
  - no recorder or unresolved id → the capture is skipped with a debug log;
  - the MCP tool returns typed refusals;
  - worktree add results are unchanged.
- **Quality requirements:** the tool list stays byte-identical per caller
  (`protocol-dispatcher.ts:371-390`).
- **Verification seam (AC8):**
  - `sdk-callbacks` spec: the broadcast carries `sessionId`.
  - `agent-events` spec: after `addCliSession` resolves, `recordLineage` is
    called with the parent; when it rejects with "Parent session not found",
    it is not called.
  - Git namespace spec: success → `recordWorktreeForCaller` gets the resolved
    SDK id; failure or unresolved caller → no call.
  - Builder-level spec: run `ptahAPI.git.worktreeAdd` inside
    `runWithMcpRequestContext({ callerSessionId: tab })` with `execGit`
    mocked, a fake lifecycle `find(tab) → sdk`, and a fake recorder. Assert
    `recordWorktree` gets the SDK id. Also assert that calling the shared
    change handler directly records nothing.
  - Dispatcher spec for `ptah_session_link_task`: caller from context, not
    args; unavailable; unattributed.
  - Sweep and parity updated.
- **Files:**
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` (+ spec)
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` (+ spec)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts` (+ spec)
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts` (+ spec)
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-organization-tools.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (+ spec)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (+ spec)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`

### 9. Host wiring (apps, cli-engine)

- **Purpose:** turn the feature on where SQLite exists.
- **Responsibilities:**
  - Electron: `registerSessionOrganizationServices(container)` and
    `startSessionOrganization(container)` right after
    `startTaskSpecsIndex(container, logger)` (`phase-2-libraries.ts:393`).
  - CLI: the same after `register-thoth-libraries.ts:150`.
  - VS Code: no change. Its `expected-absent` and `rpc-surface` specs stay
    green because the new handler family is `requires: []` and resolves with
    the optional service absent.
- **Verified contracts:** `apps/ptah-electron/src/di/phase-2-libraries.ts:194,358,388-393`;
  `cli-engine/src/lib/thoth/register-thoth-libraries.ts:101,146-150`;
  `cli-engine/src/lib/container.ts:640,716`.
- **Failure behaviour:** `start` never throws. If SQLite registration was
  skipped (the try at `register-thoth-libraries.ts:122-126`), register binds
  nothing and the feature reports unavailable.
- **Verification seam:**
  - Electron `container.smoke.spec.ts` gains one assertion: the recorder
    token and `SessionOrganizationRpcHandlers` resolve.
  - A VS Code spec asserts `SessionOrganizationRpcHandlers` resolves and
    `session:setOrganization` returns `organization-unavailable`.
- **Files:**
  - MODIFY `apps/ptah-electron/src/di/phase-2-libraries.ts`
  - MODIFY `apps/ptah-electron/src/di/container.smoke.spec.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`
  - CREATE `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`

### 10. Board-start capture and organization push handling (core, tasks-ui, chat)

- **Purpose:** AC2's write, and the refresh trigger for C.4.
- **Responsibilities:**
  - `ChatPromptRequest` gains optional `taskId?: string` (`app-state.service.ts:173-186`).
  - `TaskStartService.launchPrompt` sets `taskId`.
  - `TaskPromptBridgeService.consume`: when `request.taskId` is set, calls
    `boardTaskLinkCapture.expect(tabId, request.taskId)` after `createTab`.
  - `BoardTaskLinkCaptureService` (chat, new, `providedIn: 'root'`):
    - a `Map<tabId, taskId>` capped at 20, oldest evicted `[lane L10]`;
    - `onSessionIdResolved(tabId, realSessionId)` deletes the entry and calls
      `session:linkTask { sessionId, taskId, role: 'primary', source: 'board-start' }`;
    - an `ok: false` result or an RPC failure is logged to the console, and
      nothing is retried.
  - `ChatMessageHandler`:
    - `handleSessionIdResolved` calls the capture after
      `chatStore.handleSessionIdResolved` (`:605-608`);
    - adds `SESSION_ORGANIZATION_CHANGED` to `handledMessageTypes` and routes
      it to the same debounced path `session:metadataChanged` already uses:
      `handleSessionMetadataChanged()` (`chat-message-handler.service.ts:116,163-164,409-422`)
      waits 250 ms, then `chatStore.loadSessions()` waits 300 ms and shares
      the in-flight call (`session-loader.service.ts:146,250-285`). No new
      debounce.
- **Verified contracts:** `task-start.service.ts:74-124`;
  `task-prompt-bridge.service.ts:30-93`; `chat-message-handler.service.ts:103-243,605-614`.
- **Dependencies:** `scope:webview` libs + shared only. `tasks-ui` still does
  not import `chat`.
- **Failure behaviour:**
  - user never sends → the entry is evicted later, no link;
  - webview reload before the first send → the entry is lost `[lane L10]`,
    see risks;
  - VS Code → `organization-unavailable`, ignored.
- **Quality requirements:** one map, no timer, no observer per tab.
- **Verification seam (AC8, board-start path, a chain of 3 specs):**
  1. `TaskStartService` spec: the request carries `taskId`.
  2. Bridge spec: `expect(tabId, taskId)` with the tab id `createTab`
     returned.
  3. Handler spec: `session:id-resolved {tabId, realSessionId}` calls
     `onSessionIdResolved`.
  4. Capture spec: calls `session:linkTask` with `source: 'board-start'`,
     once.

  Plus: `session:organizationChanged` triggers `loadSessions`.

- **Files:**
  - MODIFY `libs/frontend/core/src/lib/services/app-state.service.ts` (+ spec if present)
  - MODIFY `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts` (+ spec)
  - CREATE `libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (+ spec)

### 11. Sidebar organization UI (chat)

- **Purpose:** scope C.1 and C.2 in the sidebar.
- **Responsibilities:**
  - **`SessionLoaderService`:**
    - a `listQuery` signal (`status[]`, `priority[]`, `taskId`, `pinned`,
      `hasPr`, `text`, `sort`, `groupBy`) sent on both `session:list` calls
      (`:312,364`);
    - a change resets the offset and reloads;
    - `organizationAvailable` signal from the result.
  - **When `organizationAvailable` is false:**
    - no organization params are sent beyond `sort` (see "Every host"
      below);
    - the existing client-side name/date filter (`app-shell.component.ts:238-270`)
      stays exactly as today `[user]`.
  - **Every host (Revision 1):** every loader call carries `sort` (default
    `'lastActive'`), so the sidebar is always in query mode.
    - With organization available, archived sessions are hidden until the
      status filter includes `archived`, and pinned rows sort first.
    - Without it (VS Code), there is no organization map, so neither rule
      applies and `sort: 'lastActive'` is today's order. The VS Code result
      is identical to today and needs no second call.
  - **When true:**
    - search text goes to the server (`text`);
    - the date filter stays client-side over loaded pages (unchanged
      behaviour).
  - **New components** (names are this plan's; no design handoff exists):
    - `SessionFilterBarComponent` (molecule): status and priority
      multi-select, task id, "has PR", pinned toggle, sort menu, group menu.
    - `SessionOrganizationChipsComponent` (atom): priority chip, status chip,
      pin icon, live-phase dot, agent badge (`startedBy === 'agent'`),
      task chips with a "missing" label (AC6), PR count.
    - `SessionOrganizationEditorComponent` (molecule, opened from the row
      menu next to rename/delete): edit priority/status/pin, link or unlink a
      task (text input + role), add a PR URL or open one (external link), and
      show worktree path and branch with "Open worktree" (Assumption A3).
  - **App shell:** renders the filter bar and chips only when available;
    group headers over the loaded rows by the selected key; children nest
    under their parent when `groupBy === 'parent'`.
  - **Live phase:** the row's `livePhase` from the list call.
    - For a session the webview tracks, `SessionLivenessRegistry.status(sessionId)`
      (`chat-state/src/lib/session-liveness.registry.ts:27,37,51-52`) wins,
      because it is live. This is the same source the tab bar reads
      (`chat/.../organisms/tab-bar.component.ts:67,165-169`).
    - The dot reuses the `TabItemComponent` dot styling
      (`chat-ui/src/lib/molecules/session/tab-item.component.ts:44-49,59-69`).
    - No new subscription per row: one computed over the registry's
      `statuses` signal.
  - **Why a server flag and not `VSCodeService.isElectron`**
    (`core/src/lib/services/vscode.service.ts:24,171-172`, the only host
    switch the webview has): the CLI with SQLite, and Electron with a failed
    SQLite open, need the server's answer. `isElectron` would be wrong in both
    cases.
  - **Accessibility:** chips carry `aria-label`s (for example "Priority:
    high"); the editor is keyboard reachable with a labelled dialog; the
    status is not conveyed by color alone.
- **Verified contracts:** `session-loader.service.ts:125,298-389`;
  `app-shell.component.ts:238-270,514-528`; `ClaudeRpcService.call`
  `core/src/lib/services/claude-rpc.service.ts:254-264`.
- **Failure behaviour:** RPC failure → existing console error path, the list
  is unchanged; mutation `ok: false` → inline message in the editor.
- **Quality requirements:**
  - no timer or observer per row;
  - filter changes debounced in the component (one pending call; the text
    input is debounced 250 ms `[lane]`, released on destroy).
- **Verification seam:**
  - loader spec: params sent only when available; offset reset;
  - component specs for the filter bar, chips (missing task, agent badge,
    aria labels) and editor (each mutation RPC, `ok: false` rendering);
  - app-shell spec: VS Code shape (flag false) renders today's controls
    only.
- **Files:**
  - MODIFY `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (+ `.html`, spec)
  - CREATE `libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts` (+ spec)
  - CREATE `libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.ts` (+ spec)
  - CREATE `libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts` (+ spec)

  (Assumption: the `molecules/` and `atoms/` folders exist under
  `chat/src/lib/components/`, as 584's plan uses `molecules/`; otherwise use
  the nearest existing folder.)

### 12. Task board session links and "Open session" (tasks-ui, core, chat)

- **Purpose:** scope C.3.
- **Responsibilities:**
  - **`TaskSessionLinksService`** (tasks-ui, root):
    - calls `session:listForTasks` for the active workspace when the board
      loads;
    - reloads on `session:organizationChanged`, `session:turnEnded` and
      `session:turnFailed` pushes (`handledMessageTypes` pattern,
      `tasks-store.service.ts:428,1118`), so live phases refresh when turns
      settle `[lane]`;
    - exposes `linksFor(taskId)` as a computed map.

    Unavailable → empty map, and the card shows nothing.

  - **`TaskCardComponent`:** a compact "sessions" row: count, live-phase
    dots, first PR link.
  - **`TaskDetailComponent`:** a full list with role, source, live phase,
    PR links, and "Open session".
  - **`AppStateManager.requestOpenSession({sessionId, name})`** plus a
    signal, consumed by a new `SessionOpenBridgeService` (chat, root, kept
    alive from `chat.store.ts` like the prompt bridge at `:85`):
    - `setCurrentView('chat')`;
    - grid → `requestCanvasSession`; single → `chatStore.switchSession`
      (`app-shell.component.ts:514-520` behaviour).
- **Verified contracts:** `app-state.service.ts:1161,1294-1322`;
  `task-prompt-bridge.service.ts:38-46`; `chat.store.ts:85`.
- **Failure behaviour:**
  - RPC failure → the card shows no sessions and one console error;
  - opening a deleted session → the existing `switchSession` error path.
- **Quality requirements:**
  - one fetch per board load or push, never one per card;
  - no per-card timer.
- **Verification seam:**
  - service spec: fetch on load, reload on each push, unavailable → empty;
  - card and detail specs: render links, missing-PR state, and "Open
    session" calls `requestOpenSession`;
  - bridge spec: grid vs single routing.
- **Files:**
  - CREATE `libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts` (+ spec)
  - MODIFY `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` (+ template, spec)
  - MODIFY `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts` (+ template, spec)
  - MODIFY `libs/frontend/core/src/lib/services/app-state.service.ts` (after batch C0, which also edits it)
  - CREATE `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/services/chat.store.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/chat-store/index.ts`

### 13. Session id rotation signal (agent-sdk) — Revision 1, gate G1

- **Purpose:** give the one rotation path (`'rebound'` on the new-chat path,
  G1) an explicit old → new signal so organization rows follow the
  conversation.
- **Responsibilities:**
  - `SessionIdResolvedPayload`
    (`helpers/session-id-resolved-callback-registry.ts:44-58`) gains
    `readonly previousSessionId?: string`, documented as "set only when the
    same record was rebound from this id to `realSessionId`".
  - **Revision 2:** `SdkAgentAdapter.bindRefused` (`sdk-agent-adapter.ts:1187-1210`)
    is **unchanged**. It keeps its `boolean` signature and body.
    - Both call sites stay untouched: `resumeCallback` `:1017` and
      `createSessionIdCallback` `:1130`.
    - Revision 1 would have made `bindRefused` return an object. Both call
      sites test truthiness, so an always-truthy object would have skipped
      the resume `touch` and both resolve notifications, and TypeScript would
      not flag it.
  - New private method (Revision 2):
    `private readReboundSource(tabId: string, realSessionId: string): string | undefined`.
    - It returns `this.sessionLifecycle.find(tabId)?.realSessionId` when that
      id is non-null and differs from `realSessionId`; otherwise `undefined`.
    - `SessionLifecycleManager.find(idOrTabId)` is Verified at
      `helpers/session-lifecycle-manager.ts:407-409`.
    - It is read-only and never binds.
  - `createSessionIdCallback` (`:1102-1160`), Revision 2:
    - One new statement BEFORE the existing `if (tabId && this.bindRefused(...)) return;`
      (`:1130`):
      `const previousSessionId = tabId ? this.readReboundSource(tabId, realSessionId) : undefined;`
    - When `bindRefused` then returns `false` and `previousSessionId` is
      defined, the outcome was necessarily `'rebound'`. The registry
      guarantees this (`session-registry.service.ts:304-324`):
      - `'already-bound'` requires the same id;
      - `'bound'` requires a null prior id;
      - a different non-null prior id is either `'rebound'` (accepted) or
        `'stale-mismatch'` (refused, so the callback already returned).
    - `previousSessionId` is added to the `sessionIdResolvedRegistry.notifyAll`
      payload (`:1155-1159`) only when defined.
  - `resumeCallback` (`:1002-1039`) is unchanged, including its
    `bindRefused` call at `:1017`. It passes no `previousSessionId`, because
    the resume path never creates a record for the new id (G1 step 3).
  - The single-slot `emitSessionIdResolved` is unchanged.
  - Existing subscribers ignore the new optional field: memory
    (`memory-trigger.service.ts:208-213`), skill (`skill-trigger.service.ts:175`),
    chat (`rpc-handlers/src/lib/chat/di.ts:104-119`) and agent-sdk
    (`di/register.ts:451-489`).
- **Verified contracts:** `sdk-agent-adapter.ts:1002-1039,1102-1160,1187-1210`;
  `session-registry.service.ts:142-158,290-330`;
  `session-lifecycle-manager.ts:395-409` (Revision 2);
  `session-id-resolved-callback-registry.ts:44-68`.
- **Dependencies:** agent-sdk internal.
- **Failure behaviour:** `find(tabId)` returning no record means no
  `previousSessionId`, so no rekey (the pre-Revision behaviour). The field is
  additive, so no subscriber breaks.
- **Verification seam:** adapter spec with the real registry:
  - first `init` → `'bound'`, no `previousSessionId`;
  - second `init` with a new id and the owner token → `'rebound'`,
    `previousSessionId` = first id, and `metadataStore.create(newId)` still
    called;
  - `'stale-mismatch'` → nothing notified (unchanged);
  - resume path with a new id → no `previousSessionId`;
  - **Revision 2 regression guard:** a resume WITH a `tabId` whose bind is
    accepted (`'bound'` / `'already-bound'`) still calls
    `metadataStore.touch(realSessionId)` once and fires both
    `emitSessionIdResolved` and `sessionIdResolvedRegistry.notifyAll`. The
    spec fails if the `:1017` guard ever becomes always-truthy;
  - Revision 2: `readReboundSource` unit cases:
    - no record → `undefined`;
    - null prior id → `undefined`;
    - same id → `undefined`;
    - different id → the prior id.
- **Files:**
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (+ its spec).
    584 Component 1 also edits `createSessionIdCallback`'s parameters
    (584 plan :225-253). Both edits are additive and touch different lines;
    see Coordination.

## Integration architecture

### Data flow

**User edit (Electron):**

1. Editor → `session:setOrganization`.
2. Zod → authorize → `service.setOrganization`.
3. The store upserts (one transaction).
4. `onDidChange` → broadcast `session:organizationChanged`.
5. `ChatMessageHandler` → `loadSessions()`.
6. `session:list` → rows with the new values.

**`session:list`:**

1. authorize;
2. `metadataStore.getForWorkspace(ws)` (JSON, unchanged);
3. `service.queryWorkspace(normalize(ws))` (3 SELECTs);
4. `applySessionListQuery`;
5. `total`, then `slice`;
6. enrich the page (transcript ids, `livePhase`, missing tasks via one task
   index read, `childCount`).

**Capture paths** (all end in `SessionOrganizationService` → store →
`onDidChange` → push):

| Path                            | Producer                                                                                                                                               | Call                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| SDK `WorktreeCreate`            | `WorktreeHookHandler` (agent-sdk)                                                                                                                      | `recordWorktree` (SDK id from hook input)                     |
| `ptah_git_worktree_add`         | `buildGitNamespace.worktreeAdd` via builder deps                                                                                                       | `recordWorktree` (caller tab → SDK id)                        |
| `gh pr create`                  | `SessionOrganizationCaptureService` on PostToolUse                                                                                                     | `addPrLink` (source `agent`)                                  |
| Board start                     | `BoardTaskLinkCaptureService` on `session:id-resolved`                                                                                                 | RPC `session:linkTask` (source `board-start`, role `primary`) |
| Agent link                      | `ptah_session_link_task` → namespace                                                                                                                   | `linkTask` (source `agent`)                                   |
| Fork                            | `SessionForkService`                                                                                                                                   | `recordLineage(forkOf)`                                       |
| Ptah CLI child                  | `persistCliSessionReference` after `addCliSession`                                                                                                     | `recordLineage(parent, startedBy agent)`                      |
| 584 `ptah_session_start`        | 584 `SessionSpawnerService` `SessionIdResolved` handler (see Coordination)                                                                             | `recordAgentStartedSession`                                   |
| Delete                          | `SessionOrganizationCaptureService` on `metadataChanged: deleted`                                                                                      | `store.deleteSession`                                         |
| SDK id rebound (Revision 1, G1) | `SessionOrganizationCaptureService` on `SessionIdResolvedCallbackRegistry` with `previousSessionId` (set by `SdkAgentAdapter.createSessionIdCallback`) | `store.rekeySession(previous, real)`                          |

### State or persistence

- **Owner:** `session-organization` lib, in `~/.ptah/ptah.db`. Lifetime:
  until the session is deleted (cascade) or the user resets the DB.
- **Write paths and their runtime readers** (every written value has a
  reader) `[user: constraint 5]`:

| Written value                             | Writer(s)                                                            | Runtime reader                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `priority`, `status`, `pinned`            | `session:setOrganization`                                            | `session:list` filters/sort + sidebar chips (C1)                                            |
| `worktree_path`, `branch`                 | worktree hook, MCP worktree add, 584 start                           | sidebar chips + editor "Open worktree" (C1)                                                 |
| `parent_session_id`                       | Ptah CLI child, 584 start                                            | `session:list` `childCount` + group-by-parent (C1)                                          |
| `fork_of_session_id`                      | fork                                                                 | group-by-parent nests forks under the source + "fork of" chip (C1)                          |
| `started_by`                              | Ptah CLI child, 584 start                                            | agent badge in chips (C1)                                                                   |
| `updated_at`                              | every organization write                                             | editor "changed <relative time>" (C1)                                                       |
| `session_task_links.*`                    | board start, `session:linkTask`, `ptah_session_link_task`, 584 start | `session:list` `taskId` filter + chips (C1); `session:listForTasks` → task card/detail (C2) |
| `session_task_links.source`, `created_at` | same                                                                 | chip tooltip and ordering (C1, C2)                                                          |
| `session_pr_links.*`                      | PR capture, `session:addPrLink`                                      | `hasPr` filter + chips + editor (C1); card/detail PR links (C2)                             |
| `session_pr_links.state`                  | PR capture (`open`/`draft`), user                                    | PR chip state (C1, C2)                                                                      |

- **Not persisted:** live phase (turn-state registry); the board-start
  pending map (webview memory).

### External boundaries

- Webview params: Zod per method; workspace and session authorization; the
  webview cannot claim `source: 'agent'`.
- MCP: the caller from the transport only (attribution, not authentication,
  `mcp-caller.ts:1-19` per 584 evidence); Zod args.
- PR URLs are stored as data, never fetched; only `https:` URLs are accepted
  and the UI opens them as external links.
- SQL: static, parameterised `[project: migrations/index.ts:14-18]`.

### Failure and rollback

| Step              | Failure                                                                                                          | Behaviour                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Any read or write | Host has no SQLite (VS Code)                                                                                     | No service bound; RPCs `organization-unavailable`; list flag false; captures no-op                                                             |
| Any read or write | Connection registered but not open or failed (boot window, native load failure)                                  | `isAvailable()` false; same as above; capture writes dropped with a `[SessionOrganization]` line `[lane L8]`                                   |
| Multi-table write | SQL error mid-transaction                                                                                        | Transaction rolls back; error logged; RPC returns a sanitized error                                                                            |
| Capture           | Session id not resolvable (tab not yet bound, no metadata; includes the PostToolUse tab-id fallback, Revision 1) | Skipped and logged; never written under a tab id                                                                                               |
| Delete cascade    | Store throws                                                                                                     | Logged; rows remain orphaned; they are harmless because `session:list` joins from metadata; they are removed on the next delete of the same id |
| Board start       | Webview reload before first send                                                                                 | Pending link lost `[lane L10]`                                                                                                                 |
| Push              | Broadcast fails                                                                                                  | Logged; the next list call reads fresh data                                                                                                    |

### Observability

- `IOutputChannel` `[SessionOrganization]` lines:
  - availability transitions (first unavailable call, first available call);
  - each dropped capture with its reason;
  - each capture write (path, session id, what);
  - cascade deletes;
  - tolerant-read corrections;
  - slow `session:list` (> 200 ms, with row count and elapsed).
- `session:list.organizationAvailable` tells the UI and tests which mode is
  active.

## Architecture-level quality requirements

- **Functional:**
  - AC1: 500 seeded sessions; filter status+priority, sort priority (a
    query-mode request, Revision 1); p95 < 200 ms; `total` equals the rows
    matching the filter and is shown as the sidebar count. The seed includes
    archived rows, which the filter excludes.
  - AC2: board start → one `primary`/`board-start` link after the first
    send; the card lists the session with its phase.
  - AC3: `gh pr create` in a session → PR link on that session, no user
    action.
  - AC4: SDK hook worktree and `ptah_git_worktree_add` worktree show on the
    calling session with the branch.
  - AC5: data survives restart, resume, rename and importer re-scan (keyed by
    SDK id in SQLite; the JSON store writes never touch it). Revision 1 (G1):
    the one rotation path, a `'rebound'` on the new-chat path, re-keys the
    rows to the new id (component 13 + `rekeySession`).
  - AC6: session delete removes all three tables' rows; a deleted task folder
    leaves link rows and the UI shows "missing".
  - AC7 (narrowed): Electron, plus the CLI when SQLite is available; VS Code
    shows today's list and `organization-unavailable`.
  - AC8: one reachability spec per capture path (Test strategy).
- **Performance:** no per-row or per-card timers or observers; one
  organization query per list call; enrichment only for the page.
- **Security:** static parameterised SQL; boundary validation; no secrets;
  PR URLs are never fetched.
- **Maintainability:**
  - no new `SessionMetadata` field;
  - capture producers depend on a platform-core port only;
  - `Symbol.for` tokens `[project: CONVENTIONS.md §4]`;
  - one `register…Services` per lib `[project: §5]`;
  - the new lib barrel stays ≤ 150 lines `[project: §3]`.
- **Testability:** every capture path has a spec that fails when the
  production path stops calling it; the store runs on real SQLite.

## Test strategy

**Commands:**

```
npx nx test shared
npx nx test platform-core
npx nx test persistence-sqlite
npx nx test session-organization
npx nx test agent-sdk
npx nx test cli-agent-runtime
npx nx test vscode-lm-tools
npx nx test rpc-handlers
npx nx test core
npx nx test chat
npx nx test tasks-ui
npx nx test ptah-extension-vscode
npx nx test ptah-electron
```

(The last two cover the `rpc-surface` / `expected-absent` / container smoke
specs.) Then `npx nx lint` and typecheck for every touched project.

| Scope                | Level                                                   | Proves                                                                                                                                   |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tuples               | unit (shared)                                           | Order and membership                                                                                                                     |
| Migration 0050       | real SQLite (shared opener, fails without one)          | DDL, defaults, partial unique index, ledger                                                                                              |
| Store                | real SQLite contract suite                              | Every method, demotion, tolerant read, transactional delete                                                                              |
| Service              | unit, fakes                                             | Root resolution order (D3), validation, unavailable, events, PR parsing                                                                  |
| Cascade              | unit with real `SessionMetadataStore` over fake storage | AC6 delete path, including the importer prune kind                                                                                       |
| `session:list` query | unit                                                    | Query mode vs none (Revision 1), filters, archived exclusion in query mode only, pinned first in query mode only, group, sort, tie-break |
| Handlers             | unit                                                    | VS Code shape unchanged; Electron shape enriched; missing tasks; new RPCs; push                                                          |
| **AC1**              | integration (`session-list.perf.spec.ts`, real SQLite)  | p95 < 200 ms over 20 runs, 500 sessions; correct `total`                                                                                 |
| Host wiring          | Electron smoke, VS Code spec                            | Bound where SQLite exists; `organization-unavailable` in VS Code                                                                         |
| Frontend             | unit                                                    | Loader params by availability; chips/editor/filter bar; board links; open-session bridge                                                 |

**AC8 reachability specs (each fails if production stops calling the capture):**

| Capture path                    | Spec                                                      | Production entry invoked                                                                     |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| SDK `WorktreeCreate`            | `worktree-hook-handler.spec.ts`                           | The hook function returned by `createHooks()`                                                |
| `ptah_git_worktree_add`         | `ptah-api-builder` spec + `git-namespace.builder.spec.ts` | `ptahAPI.git.worktreeAdd` inside an MCP request context                                      |
| `gh pr create`                  | `session-organization-capture.service.spec.ts`            | The real `PostToolUseHookHandler` hook after `startSessionOrganization`                      |
| Board start                     | 4 chained specs (component 10)                            | `TaskStartService.start` → bridge → handler → capture                                        |
| `ptah_session_link_task`        | `protocol-dispatcher.spec.ts`                             | The dispatcher `tools/call` case                                                             |
| Fork                            | `session-fork.service.spec.ts`                            | `forkSession`                                                                                |
| Ptah CLI child                  | `agent-events.spec.ts`                                    | `persistCliSessionReference`                                                                 |
| Delete cascade                  | capture spec                                              | `SessionMetadataStore.delete`                                                                |
| SDK id rebound (Revision 1, G1) | `sdk-agent-adapter` spec + capture spec                   | `createSessionIdCallback` second init → `SessionIdResolvedCallbackRegistry` → `rekeySession` |
| 584 start                       | added by whichever task merges second (Coordination)      | 584's `SessionIdResolved` handler                                                            |

**Real-host smoke (senior-tester; Electron dev build, then VS Code, then CLI):**

- **S1 (AC1):** seed 500 sessions (script writes metadata through the
  RPC-less store seam or imports fixtures, and inserts organization rows).
  Filter by status and priority, sort by priority; the output channel shows
  no slow-list line; the sidebar count equals the filtered total.
- **S2 (AC2):** start a task from the board, send the prefilled prompt; the
  card shows the session with a live phase that changes to idle when the
  turn ends.
- **S3 (AC3):** in a scratch repo with a GitHub remote, the agent runs
  `gh pr create --draft`; the session shows a draft PR chip without user
  action.
- **S4 (AC4):**
  - An isolated subagent creates an SDK worktree; the session shows the
    path and branch, and the `git:worktreeChanged` payload carries the
    session id.
  - `ptah_git_worktree_add` from a session does the same.
- **S5 (AC5):** set priority/status/pin and a link, then restart the app,
  resume the session, rename it, and trigger an importer re-scan; all values
  remain. This is field evidence for G1; the design check is the component
  13 and `rekeySession` specs (Revision 1).
- **S6 (AC6):** delete the session and check the rows are gone (SQLite
  query). Delete a linked task folder; the chip shows "missing".
- **S7 (AC7):**
  - VS Code: the sidebar looks and behaves as before, and no organization
    controls are visible;
  - from the MCP, `ptah_session_link_task` returns `organization-unavailable`;
  - CLI: `session:setOrganization` works through the JSON-RPC surface.
- **S8:** run all unit suites above; write `test-report.md`.

## Risks

- **R1 (Revision 1):** SDK session id rotation. Gate G1 traced it to one path
  (`'rebound'` on the new-chat path), which now re-keys rows (component 13,
  `rekeySession`).
  - Residual: the old metadata record still exists as a second sidebar row
    and now shows defaults. That is existing `SessionMetadataStore`
    behaviour, not changed here.
  - Residual: a rotation the registry does not see as `'rebound'` (for
    example an SDK re-init under a fresh record) is not re-keyed. Source
    shows no such path (G1 steps 3-5).
- **R2:** captures that fire before the DB opens are dropped `[lane L8]`. In
  Electron the DB opens late in boot (`boot-heavy-services.ts:161-171` per
  evidence). A session cannot usually create a worktree or a PR before that,
  but a very early resume could. Accepted and logged.
- **R3:** the board-start link is lost if the webview reloads between
  prefill and first send `[lane L10]`. The user can link the task by hand or
  the agent's `/orchestrate` flow can call `ptah_session_link_task`
  (skill-doc follow-up).
- **R4:** the live phase on rows is read at list time. Rows for sessions not
  open in a tab refresh only on the next list call or push. Task cards
  refresh on turn-settle pushes.
- **R5:** `gh pr create` output format changes or a wrapper script hides the
  command. Then capture misses, and the user can add the link.
- **R5b (Revision 1):** a PostToolUse payload whose `sessionId` fell back to
  the tab id (`post-tool-use-hook-handler.ts:77-87`) is dropped and logged by
  `resolveRoot`. The PR link is missed, never written under a tab id. The
  user can add it by hand. Frequency is bounded to hook inputs without
  `session_id` (the residual case `sdk-agent-adapter.ts:1150-1154`
  describes).
- **R6:** hidden Ptah CLI children contribute only `childCount`
  (Assumption A4).
- **R7:** with no `CHECK` constraints, a bad writer could store an unknown
  enum. Mitigated by boundary Zod and tolerant read `[lane L1]`.
- **R8:** shared-file merges with 584 (listed in Coordination). No schema or
  contract conflict.

## Coordination with TASK_2026_584_5e7a (schema contract)

584 keeps its `SessionChildRegistry` in memory and ships independently,
possibly first (584 plan D10 :155, Coordination :1152-1175). This section is
the contract both tasks honour, so neither changes the other's schema.

**584 fields → 580 storage:**

| 584 `SessionChildSnapshot` field (584 plan :324-350)                                                                                                                                  | 580 storage                                           | Notes                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdkSessionId`                                                                                                                                                                        | `session_organization.session_id`                     | The durable key is the SDK id, never the child tab id                                                                                        |
| `parentSdkSessionId`                                                                                                                                                                  | `session_organization.parent_session_id`              | SDK id. If unknown at record time, pass `lifecycle.find(parentTabId)?.realSessionId`; if still unknown, omit it (column stays NULL) `[lane]` |
| `workspaceRoot` (parent root)                                                                                                                                                         | `workspace_root` (normalized)                         | Matches 584 D3: metadata `workspaceId` = parent root                                                                                         |
| `worktreePath`                                                                                                                                                                        | `worktree_path`                                       | This is the worktree capture for `ptah_session_start` `[user]`                                                                               |
| `branch`                                                                                                                                                                              | `branch`                                              |                                                                                                                                              |
| `taskId`                                                                                                                                                                              | `session_task_links (role 'primary', source 'agent')` |                                                                                                                                              |
| (implicit)                                                                                                                                                                            | `started_by = 'agent'`                                | `[user: 584 consumer section]`                                                                                                               |
| `label`                                                                                                                                                                               | not stored here                                       | Metadata `name` (584 sets `sessionName`)                                                                                                     |
| `status`, `pendingPermission`, `turnsSettled`, `reports*`, `heldCompletion`, `lastCompletion`, `startedAt`, `endedAt`, `endReason`, `subagentPtahTools`, `deliverables`, `taskFolder` | not stored                                            | Run state; 580 Decision 3 keeps run state out of the table                                                                                   |

**Ownership:**

- **580 owns:** migration 0050, the three tables, the store, the service and
  its write semantics, and the `ISessionOrganizationRecorder` port with
  `recordAgentStartedSession`.
- **584 owns:** the in-memory registry and all run state, and WHEN the call
  happens: exactly once, in its `SessionIdResolved` handler, when the child's
  SDK id binds.
  - 584 injects `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` with
    `{ isOptional: true }`, so VS Code (no adapter) and a 584 build without
    580 are both no-ops.
- 580 never reads or writes 584's registry. 584 never writes the tables
  directly.

**Absorption:**

- 584's registry is not absorbed or replaced. It stays the live run-state
  owner.
- The durable link lives only in 580's table.
- Restart recovery of 584's parent → child ownership from 580's table needs
  a reader method (`childrenOf(parentSessionId)`). No consumer exists yet, so
  it is a Follow-up, not built here.

**Landing order:**

- The task that merges SECOND adds the one call line in 584's
  `session-spawner.service.ts` `SessionIdResolved` handler, plus a spawner
  spec asserting `recordAgentStartedSession` is called with the SDK id,
  parent SDK id, worktree, branch and task id.
- If 584 merges first, 580's batch B3 adds it.
- If 580 merges first, 584 adds it.

**Capture separation:**

- 584's `ptah_session_start` fires the shared `buildWorktreeChangeHandler`
  (584 plan :723-727). 580 does not record in that handler [D9], so a child
  worktree is never recorded on the parent.
- 580 records the child's worktree only through `recordAgentStartedSession`.

**No `SessionMetadata` field is added by either task.** 584 changes metadata
`workspaceId` / `workingDirectory` at creation (584 Component 1); 580 relies
on that for D3.

**Shared files (merge only, no contract conflict):**

- `vscode-lm-tools`: `protocol-dispatcher.ts`, `types.ts`,
  `ptah-api-builder.service.ts`, `tool-result-budget.ts`,
  `mcp-contract.sweep.spec.ts`. Both tasks bump the pinned tool counts at
  `:1707,1731`; the second to merge adds the other's increment.
- `shared`: `rpc.types.ts`, `message-constants.ts`, `payload-map.ts`.
- `frontend/chat`: `chat-message-handler.service.ts`.
- Revision 1: `agent-sdk/src/lib/sdk-agent-adapter.ts`.
  - 584 Component 1 adds a `workingDirectory` parameter to
    `createSessionIdCallback` and changes the `create(...)` call (584 plan
    :225-253).
  - Revision 2: 580 component 13 does NOT change `bindRefused` or either of
    its call sites. It adds:
    - one private method `readReboundSource`;
    - one statement just before the `:1130` guard;
    - the optional `previousSessionId` field in the `notifyAll` payload at
      `:1155-1159`.
  - Rechecked for Revision 2: 584 touches the parameter list (`:1102-1108`)
    and the `create(...)` call (`:1140`). 580 touches the line before `:1130`,
    the payload at `:1155-1159`, and a new method. They are different
    statements, so this is a merge point, not a contract conflict. Neither
    edit changes the other's inputs: `realSessionId` and `tabId` are the
    same values in both.

580's new MCP files are named `session-organization-*` so they do not collide
with 584's `session-tools.ts` / `session-namespace.builder.ts`, and the MCP
namespace is `PtahAPI.sessionOrganization`, not 584's `PtahAPI.session`.

## Lane-introduced constraints

| #   | Constraint                                                                                                                                                                                                                                                            | Reason                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| L1  | No `CHECK` constraints on enum columns; Zod at the boundary; tolerant read maps unknown values to defaults                                                                                                                                                            | SQLite cannot alter a CHECK without a table rebuild; the tuples may grow          |
| L2  | At most one `primary` task link per session; a new primary demotes the old one to `related` in the same transaction                                                                                                                                                   | Board start and agent links would otherwise conflict                              |
| L3  | (Revision 1) In query mode (the request carries any new `session:list` param), `archived` sessions are excluded unless the `status` filter includes `archived`. Without query mode, `session:list` returns the same rows, order and total as today, archived included | Archiving shortens the organized sidebar list, and existing callers see no change |
| L4  | (Revision 1) Pinned sessions sort first in every sort in query mode, when organization is available; never without query mode                                                                                                                                         | Pin semantics without reordering existing callers                                 |
| L5  | `groupBy` makes the group key the primary sort key (server side)                                                                                                                                                                                                      | Group headers over paged results stay contiguous                                  |
| L6  | New RPC `session:listForTasks`                                                                                                                                                                                                                                        | Task cards need links for many tasks in one call; one call per card was rejected  |
| L7  | PR capture: Bash + `gh pr create` + success + first GitHub PR URL; `draft` when `--draft`, else `open`                                                                                                                                                                | Avoid linking PRs that are only mentioned                                         |
| L8  | Captures while SQLite is not open are dropped and logged, not buffered                                                                                                                                                                                                | No second store; boot-window loss is rare and visible                             |
| L9  | Workspace key = session metadata `workspaceId`, falling back to the capture's hint                                                                                                                                                                                    | Worktree cwd differs from the sidebar workspace (584 D3)                          |
| L10 | Board-start pending links live in webview memory (cap 20) and are lost on reload before the first send                                                                                                                                                                | Keeps the `chat:start` contract and `TabState` unchanged                          |
| L11 | `ptah_session_link_task` is always-on, caller from transport, default role `primary`                                                                                                                                                                                  | Same reasoning as the task tools (`protocol-dispatcher.ts:329-335`)               |
| L12 | Rows are created lazily on first write; missing rows read as defaults (`normal`, `active`, unpinned, `user`)                                                                                                                                                          | No backfill migration over JSON-owned sessions                                    |
| L13 | `session:list` over 200 ms logs a warn line                                                                                                                                                                                                                           | Makes AC1 regressions visible in the field                                        |
| L14 | PR URLs: `https:` only, ≤ 2048 chars; `owner/repo` and number parsed only for GitHub                                                                                                                                                                                  | Boundary validation; any host allowed for manual links                            |
| L15 | MCP worktree capture only through the git namespace, never the shared change handler                                                                                                                                                                                  | Prevents 584 child worktrees being recorded on the parent                         |
| L16 | Task board refetches links on `session:turnEnded` / `session:turnFailed`                                                                                                                                                                                              | Keeps card live phase fresh without a per-card subscription                       |
| L17 | Sidebar search text debounced 250 ms                                                                                                                                                                                                                                  | One pending list call while typing                                                |

## Follow-ups (not in this task)

- **Related defect 1 (file separately):**
  `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts:71`
  checks `Array.isArray(raw)` and misses the `{schemaVersion, items}` shape,
  so it probably lists no sessions after the storage split.
- **Related defect 2 (file separately):** `session:list` returns
  `messageCount: 0` and `isActive: false` for every row
  (`session-rpc.handlers.ts:386-387`).
- **584 restart recovery:** a `childrenOf(parentSessionId)` reader on the
  service, for 584's registry to rebuild parent ownership after restart.
  Build it when 584 needs it.
- **Orchestration skill:** tell `/orchestrate` runs to call
  `ptah_session_link_task` for their task (mitigates R3).
- **Out of scope per context.md:** task priority, polling GitHub for PR
  state, cross-workspace views (TASK_2026_459).

## Team-leader handoff

- **Recommended executors:**
  - backend-developer for components 1-9 and 13 (types, migration, port,
    lib, RPC, capture, wiring, rotation signal);
  - frontend-developer for components 10-12;
  - senior-tester for the AC1 run, smoke S1-S8 and `test-report.md`.
- **Complexity:** HIGH. A new library and migration; capture hooks in four
  backend libs; RPC contract changes; three frontend libs; three hosts with
  different storage availability.
- **Dependencies and ordering (component level):**
  - 1 and 2 and 3 are independent; 13 (Revision 1) is independent too;
  - 4 needs 1, 2, 3 and 13; 5 needs 4; 9 needs 4;
  - 6 needs 3; 7 needs 4; 8 needs 1 and 3 (and 6 for the `worktreePath`
    callback field);
  - 10 needs 1; 11 needs 1 and 10 (shared handler file); 12 needs 1 and 10
    (shared `app-state.service.ts`);
  - the smoke run needs everything.
- **Suggested batches (file-disjoint within each parallel group):**

| Batch | Phase | Content                                                                                                                                                                                | Executor           | Depends on             | Parallel with  |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------- | -------------- |
| A1    | A     | Component 1 (shared contracts)                                                                                                                                                         | backend-developer  | —                      | A2             |
| A2    | A     | Components 2 + 3 + 13 (migration 0050 + 12 spec updates; recorder port; Revision 1: rotation signal in agent-sdk — `session-id-resolved-callback-registry.ts`, `sdk-agent-adapter.ts`) | backend-developer  | —                      | A1             |
| A3    | A     | Component 4 (new lib: store, service, cascade, register/start, specs; `tsconfig.base.json`)                                                                                            | backend-developer  | A1, A2                 | —              |
| A4    | A     | Component 5 (`session:list` extension, organization handlers, schemas, manifest, AC1 perf spec)                                                                                        | backend-developer  | A3                     | A5, B1, B2, C0 |
| A5    | A     | Component 9 (Electron + CLI wiring, smoke/VS Code specs)                                                                                                                               | backend-developer  | A3                     | A4, B1, B2, C0 |
| B1    | B     | Component 6 (agent-sdk worktree hook + fork)                                                                                                                                           | backend-developer  | A2                     | A4, A5, B2, C0 |
| B2    | B     | Component 7 (PR capture in the new lib: `utils/pr-url.ts`, capture service)                                                                                                            | backend-developer  | A3                     | A4, A5, B1, C0 |
| B3    | B     | Component 8 (cli-agent-runtime notification + child lineage; vscode-lm-tools git namespace, link tool, dispatcher, builder, sweep) plus the 584 call line if 584 is already merged     | backend-developer  | A1, A2, B1             | C1, C2         |
| C0    | C     | Component 10 (board-start capture + organization push handling)                                                                                                                        | frontend-developer | A1                     | A4, A5, B1, B2 |
| C1    | C     | Component 11 (sidebar UI)                                                                                                                                                              | frontend-developer | C0 (and A4 at runtime) | C2, B3         |
| C2    | C     | Component 12 (task board links + open-session bridge)                                                                                                                                  | frontend-developer | C0 (and A4 at runtime) | C1, B3         |
| T1    | —     | AC1 evidence, smoke S1-S8, `test-report.md`                                                                                                                                            | senior-tester      | all                    | —              |

- C0 is listed under phase C because its files are frontend; it carries
  the phase-B board-start capture.
- B2 edits `session-organization-capture.service.ts`, which A3 created, so
  it runs after A3.
- A4 and A5 are file-disjoint. A5 touches only app/cli-engine files and
  one new VS Code spec.
- Revision 1: gate G1 is decided in this plan (Architecture decision), so
  A3 does not wait on an investigation. A3 depends on A2 for the
  `previousSessionId` field.
- B1 and A2 both touch agent-sdk but in different files: A2 edits
  `sdk-agent-adapter.ts` and `session-id-resolved-callback-registry.ts`;
  B1 edits `worktree-hook-handler.ts` and `session-fork.service.ts`.
- **Files affected:**
  - **CREATE:**
    - `libs/shared/src/lib/types/session-organization.types.ts` (+ spec)
    - `libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts` (+ spec)
    - `libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts`
    - `libs/backend/session-organization/**`: `project.json`, jest/tsconfig
      files, `src/index.ts`, `src/lib/di/{tokens,register,start}.ts`,
      `session-organization.store.ts`, `session-organization.service.ts`,
      `session-organization-capture.service.ts`, `utils/pr-url.ts`
      (+ specs)
    - `libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts` (+ spec)
    - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts` (+ spec)
    - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/session-list.perf.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-organization-tools.ts`
    - `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts` (+ spec)
    - `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts` (+ spec)
    - `libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts` (+ spec)
    - `libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.ts` (+ spec)
    - `libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts` (+ spec)
    - `libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts` (+ spec)
  - **MODIFY:**
    - `libs/shared/src/lib/types/rpc/rpc-session.types.ts`,
      `execution/node.ts`, `rpc.types.ts`, `messages/message-constants.ts`,
      `messages/payload-map.ts`, `rpc/rpc-git.types.ts`,
      `agent-adapter.types.ts`, the shared types barrel
    - `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` + the 12
      specs listed in component 2
    - `libs/backend/platform-core/src/di/tokens.ts`,
      `libs/backend/platform-core/src/index.ts`
    - `tsconfig.base.json`
    - `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`
      (+ spec), `host-profile/manifest.ts`, rpc-handlers barrel
    - `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`
      (+ spec), `helpers/session-fork.service.ts` (+ spec)
    - Revision 1: `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts`,
      `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`
      (+ spec), `wiring/agent-events.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts`
      (+ spec), `ptah-api-builder.service.ts` (+ spec), `types.ts`,
      `mcp-core/protocol-dispatcher.ts` (+ spec),
      `mcp-core/tool-result-budget.ts`, `mcp-core/mcp-contract.sweep.spec.ts`,
      `namespace-builders/system-namespace.builders.ts`
    - `apps/ptah-electron/src/di/phase-2-libraries.ts`,
      `apps/ptah-electron/src/di/container.smoke.spec.ts`,
      `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`
    - `libs/frontend/core/src/lib/services/app-state.service.ts`,
      `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts`,
      `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts`,
      `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`,
      `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`,
      `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
      (+ html), `libs/frontend/chat/src/lib/services/chat.store.ts`,
      `libs/frontend/chat/src/lib/services/chat-store/index.ts`,
      `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`,
      `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts`
    - 584's `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts`
      (+ spec), only if 584 merged first
  - **REWRITE:** none.
- **Verification points:**
  - **Confirm before coding:**
    - G1 (Revision 1) needs no check; it is decided. The executor implements
      component 13 and `rekeySession` as written;
    - A2: `createChild` sites;
    - A3: folder-open RPC;
    - `session-loader.service.ts` contains a NUL byte, so the Grep tool
      skips it as binary. Search it with `grep -a` or read it directly;
    - the shared and rpc-handlers barrel locations;
    - the `molecules/` and `atoms/` folders.
  - **Contracts to honour:**
    - `SessionMetadata` shape unchanged;
    - `session:list` returns the same rows, order and total as today for
      callers that send no new params (query mode, Revision 1);
    - `chat:start` unchanged;
    - the tool list stays byte-identical per caller;
    - `Symbol.for` tokens with identifier == key;
    - register functions without side effects;
    - `dispose()` sync and idempotent;
    - new backend classes log via `IOutputChannel`;
    - the recorder never throws.
  - **Data changes:** migration 0050 (three new tables, no data migration).
  - **Commands that must pass:**
    - the Test strategy commands;
    - `npx nx lint` for every touched project (module boundaries);
    - typecheck/build of `ptah-extension-vscode`, `ptah-electron`, the CLI
      and the webview app;
    - `ptah_get_diagnostics` on every changed file.

## Revision 1

This revision responds to `.ptah/specs/TASK_2026_580_9f77/implementation-plan-review.md`,
which gave the verdict REVISE with four defects. No material decision
(D1-D15) changed. Line numbers below refer to this revised file.

1. **Major: archived exclusion vs "defaults unchanged".** Option (a), as
   directed.
   - A new "query mode" step 0 (:560-571): a request is in query mode when it
     carries any new `session:list` param. Without query mode, the rows, order
     and total are identical to today, archived and pinned rows included, and
     only the additive optional fields are new.
   - Archived exclusion and pinned-first now apply only in query mode:
     - component 5 step 1 and step 3 (:572-582) and the handler bullet
       (:596);
     - D4 effect column (:135);
     - L3 and L4 reworded (:1464-1465);
     - contracts to honour (:1618).
   - The sidebar always sends `sort` in every host, so it is always in query
     mode (component 11 "Every host", :962-968). In VS Code there is no
     organization map, so the result is still today's list.
   - AC1 wording names the filtered request as query mode and seeds archived
     rows (:1224-1227).
   - Spec cases were added (:649-655, test table :1286).
2. **Major: Assumption A1, SDK id rotation.** It is now gate G1 with a
   decided outcome (:149-201). The trace was done in this worktree:
   - a resume can only `touch` an existing id (`sdk-agent-adapter.ts:1027`;
     `session-metadata-store.ts:879-887`), so it never creates a record under
     a new id;
   - the only same-conversation id change is the registry's `'rebound'`
     (`session-registry.service.ts:147-152,310-324`);
   - on the new-chat path, `'rebound'` reaches `metadataStore.create(newId)`
     (`sdk-agent-adapter.ts:1140`);
   - no production resume passes `forkSession: true`;
   - source cannot exclude an SDK re-init inside one process.

   **Outcome:** re-key on `'rebound'` in the new-chat path. What changed:
   - new component 13 (:1075-1124): `previousSessionId` on
     `SessionIdResolvedPayload`; `bindRefused` returns the outcome
     (superseded by Revision 2: `bindRefused` stays boolean);
     `createSessionIdCallback` fills the field;
   - `rekeySession(oldId, newId)` added to the component 4 store API
     (:436-447);
   - the capture service subscribes to `SessionIdResolvedCallbackRegistry`
     (:473-485); specs at :533-541 and the AC8 table row (:1304);
   - data-flow row (:1162); AC5 (:1235-1237); S5 (:1326); R1 (:1339-1347);
   - batch A2 now carries component 13 (:1520, note :1538-1543);
   - verification points (:1608); coordination merge note for
     `sdk-agent-adapter.ts` with 584 Component 1 (:1445).

3. **Minor: `SessionOrganizationRpcHandlers` injection.** The service (plus
   the task index and webview manager) is pinned as `{ isOptional: true }`,
   and the `onDidChange` subscription is made only when the service is
   present (:611-631). A spec constructs the handler with no service and
   asserts construction succeeds, no subscription is made, and every method
   returns `organization-unavailable` (:661-666).
4. **Minor: PR capture tab-id fallback.** Component 7 now states:
   - `resolveHookSessionId` can yield the tab id
     (`post-tool-use-hook-handler.ts:77-87`);
   - `resolveRoot` drops and logs that write, and nothing is ever written
     under a tab id (:737-750);
   - a spec pins the drop (:768-770);
   - the failure table row now covers it (:1204);
   - new risk R5b sits next to R5 (:1361-1366).

## Revision 2

This revision responds to `.ptah/specs/TASK_2026_580_9f77/implementation-plan-review-r1.md`.
All four Revision 1 defects are resolved and the G1 trace is verified. It
fixes one new Major. No material decision changed. Component 13 grew by 28
lines, so every Revision 1 line reference above :1085 still holds, and every
reference at or after :1085 is now 28 higher (for example the data-flow row
:1162 → :1190, R5b :1361 → :1389).

1. **Major: `bindRefused` returning an object would break both truthiness
   call sites** (`sdk-agent-adapter.ts:1017` resume, `:1130` new chat). An
   always-truthy object would make every resume with a `tabId` skip the
   metadata `touch` and both resolve notifications, silently. The fix is the
   reviewer's preferred option.
   - `bindRefused` keeps its boolean signature and body, and both call sites
     are untouched (component 13, :1085-1092).
   - The rebound source is exposed by a new read-only private method
     `readReboundSource(tabId, realSessionId)` over
     `SessionLifecycleManager.find` (Verified
     `session-lifecycle-manager.ts:407-409`) (:1093-1099).
     `createSessionIdCallback` reads it in one new statement before the
     `:1130` guard (:1100-1115).
   - Why "defined `previousSessionId` + accepted bind" means `'rebound'` is
     stated from the registry's branch order
     (`session-registry.service.ts:304-324`) (:1105-1112).
   - Specs added (:1136-1144):
     - a resume with a `tabId` still calls `metadataStore.touch` and fires
       `emitSessionIdResolved` and `sessionIdResolvedRegistry.notifyAll`
       (this fails if the `:1017` guard becomes always-truthy);
     - `readReboundSource` case table.
   - The Revision 1 summary item 2 is marked superseded (:1709-1710).
2. **584 merge point rechecked** (Coordination, :1473-1488). It still holds:
   - 584 edits `createSessionIdCallback`'s parameter list (`:1102-1108`) and
     its `create(...)` call (`:1140`);
   - 580 now edits only a new statement before `:1130`, the `notifyAll`
     payload (`:1155-1159`), and a new private method;
   - neither task touches `bindRefused` or `:1017`;
   - the statements are different, and neither edit changes the other's
     inputs.
