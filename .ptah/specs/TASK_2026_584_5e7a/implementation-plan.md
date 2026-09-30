# Implementation Plan - TASK_2026_584_5e7a

Agent-started child chat sessions, one git worktree each, each bound to a real
chat tab (MVP, Approach A).

All paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\main-latest`. "Verified" = the
definition was opened at the cited line. "Assumption" = not proven from
source; the check that resolves it is stated next to it.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_584_5e7a/task.md`,
  `.ptah/specs/TASK_2026_584_5e7a/context.md`,
  `.ptah/specs/TASK_2026_584_5e7a/research-report.md` (checked against source,
  corrections below), `.ptah/specs/TASK_2026_358/task.md`,
  `.ptah/specs/TASK_2026_386/task.md` + `context.md`,
  `.ptah/specs/TASK_2026_419_95af/task.md`,
  `.ptah/specs/TASK_2026_580_9f77/task.md` + `context.md`,
  `.ptah/specs/TASK_2026_402_a5c7/` (reused code, not re-planned),
  `CONVENTIONS.md`, `eslint.config.mjs` depConstraints (lines 254-380).
- Binding user decisions, as they stand after the 2026-09-30 decision change
  relayed by the coordinator:
  - Approach A: `ptah_session_*` MCP tools over an in-host `ISessionSpawner`
    (context.md:22).
  - SUPERSEDES context.md:24 ("no UI tabs"): a child session binds to the UI
    exactly as if the user created it — a real chat tab on the same tab/session
    model, the same stream to the webview, a sidebar/session-list entry,
    resumable, and the user can type into it. No separate headless consumer as
    the primary path. A host with no webview (CLI, or a closed panel) degrades
    to headless.
  - Steering is by messaging: parent -> child `ptah_session_send`, child ->
    parent `ptah_agent_report`, completion push. `ptah_session_status` /
    `ptah_session_read` stay as secondary tools.
  - Unattended permissions: auto-edit + a Bash allowlist, anything else denied
    after a bounded window, never an indefinite wait (context.md:23).
  - Coordinate with TASK_2026_358, TASK_2026_386 and TASK_2026_580; reuse
    TASK_2026_402 (two-way agent messaging, done) and TASK_2026_419 (resume keeps
    the worktree cwd, done); keep 584 separate.
  - Defaults: max 3 concurrent children, depth 1, the user owns merge / PR /
    worktree cleanup (context.md:26).
- Corrections applied: this document replaces the earlier draft of the same
  file written in this session (headless-consumer design, now superseded).
- Design handoff used: none. The UI surface is small (a tab badge and a banner)
  and is specified here with the existing components it extends.
- Instruction files: no `CLAUDE.md` exists in this worktree or the main
  checkout (searched `**/CLAUDE.md`); `CONVENTIONS.md` is applied (library
  shape, `Symbol.for` tokens in `di/tokens.ts`, one `register*Services` per lib,
  suffixes, layer rule). The brief's rules (hexagonal ports, boundary lattice,
  no deep imports, facade rule, new code logs via `IOutputChannel`) are applied
  as given.
- Missing decision-critical input: none. Three points nobody decided are
  resolved here and flagged under "Risks and disagreements": what "parent ends"
  means (SessionEnd also fires on Stop and slash commands), whether children may
  call Ptah MCP tools without a prompt (they must), and whether an adopted child
  tab takes focus (it does not).

### Research-report claims checked against source

| Research claim | Verdict | Evidence |
| --- | --- | --- |
| Gateway starts sessions via `startChatSession` at `gateway-chat-bridge.ts:744` | Line drift: the call is in `startNew`, `:748-765` | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:748-765` |
| The gateway is the pattern to copy | No longer applicable to the start path: gateway turns have no tab (`gw-*`) and the gateway ends the session after each turn. The UI-bound decision needs the chat-RPC internals instead | `gateway-chat-bridge.ts:116-117,675-695` |
| Unknown: does the frontend render chat events for a tabId it never created | Resolved: it cannot. There is no backend -> frontend "open tab" message (no such key in `MESSAGE_TYPES`), tab ids are minted client-side (`TabId.create()`), and `chat:chunk` is routed by `tabId` into existing tabs only. A new push message and a frontend adoption step are required | `libs/shared/src/lib/types/messages/message-constants.ts:19-54,128-155,200-207`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:811-854,2751-2753`; `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:423-468` |
| Chat RPC reads the permission level from `autopilot.permissionLevel` at `chat-session.service.ts:727-737` | Wrong mechanism: those lines are the stop-intent interrupt in `chat:continue`. `chat:start` passes no level; the executor falls back to the handler's in-memory global level | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:555-574`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:364-374` |
| A chat child's `ptah_agent_report` is refused at `agent-report-router.service.ts:230-235` | Incomplete: a `/session/{id}` caller is refused earlier, in the dispatcher | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1192-1207` |
| Validate the worktree with `isAuthorizedWorkspace` | Holds, but only inside `rpc-handlers`; the spawner (lower layer) uses platform-core `isPathWithinRoots` + realpath, as lanes do. `startSession` still runs `isAuthorizedWorkspace` on the chat path | `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:12-22`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:350-376` |
| Put the port beside `session-submit.port.ts` in `vscode-lm-tools`, implementation in `agent-sdk` or a new lib | Rejected, see decision D1 | import graph below |
| `ptah_git_worktree_add` can serve `baseRef` | No: no base-ref parameter; always branches from the root's HEAD | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts:97-143` |
| "Stopping the parent aborts children" via session end | Unsafe as stated: `SessionEnd` also fires on the Stop button (`chat:abort` -> `interruptSession`), on every slash-command re-query and on dead-record recovery | `chat-session.service.ts:967-976,1191-1197`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:593-595`; `.../session-lifecycle/session-control.service.ts:211-299` |
| Not in the report: children see `ptah_session_start` too | The tool list is byte-identical per caller by design; depth is enforced at call time | `protocol-dispatcher.ts:371-390` |
| Not in the report: child subagents get no Ptah MCP tools | `.mcp.json` is gitignored (`.gitignore:53`) so a fresh worktree has none, and the MCP server writes entries only for open folders | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:436-464,521-531` |
| Not in the report: sidebar grouping | `session:list` filters metadata by `workspaceId`; the chat path sets `workspaceId = projectPath`, so a child started in a worktree would be listed under the worktree, not under the parent's workspace | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:625-640,1072-1082`; `chat-session.service.ts:555-560` |
| Other cited facts (`startChatSession`/`sendMessageToSession`, `/session/{tabId}` identity, report/completion routers, lane cap, git gate, `workingDirectory` in metadata) | Verified | Codebase evidence |

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Lib import graph: `rpc-handlers` -> `cli-agent-runtime` (22 imports) -> `agent-sdk`; `vscode-lm-tools` -> `cli-agent-runtime`; `gateway-chat-bridge` -> `vscode-lm-tools` | grep of `from '@ptah-extension/...'` per lib | Spawner + ports in `cli-agent-runtime`; the chat-path adapter in `rpc-handlers` implements a `cli-agent-runtime` port (legal inversion) |
| All involved backend libs `scope:extension`/`type:feature`; platform-core `scope:shared`/`type:util`; frontend libs `scope:webview` | each `project.json`; `eslint.config.mjs:254-380` | Every planned edge is legal; frontend only touches `shared` + `scope:webview` libs |
| `registerChatServices` runs in all three hosts | `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:62`; `apps/ptah-electron/src/di/phase-4-handlers.ts:89`; `libs/backend/cli-engine/src/lib/container.ts:892`; body `libs/backend/rpc-handlers/src/lib/chat/di.ts:57-120` | Registering the host adapter there covers VS Code, Electron and CLI without app DI edits |
| `registerCliAgentRuntimeServices` runs in all three hosts | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:201`; `apps/ptah-electron/src/di/phase-2-libraries.ts:287`; `libs/backend/cli-agent-runtime/src/lib/di/register.ts:46-107` | Spawner registration needs no app DI edit |
| `ChatSessionService.startSession`: workspace resolution + `isAuthorizedWorkspace` + unsafe-path refusal, MCP registration, enhanced prompts, model, provider profile, output style, `workflowsDisabled`, `startChatSession`, `streamEventsToWebview(tabId, stream, tabId)` | `chat-session.service.ts:415-595` | The child start runs these exact internals (decision D2) |
| `ChatStreamBroadcaster.streamEventsToWebview` is the session's only consumer; ends the record by token on exit; `isStreaming(tabId)` marks a live loop | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:110-140,168-172,357-420` | No headless consumer is needed: the broadcaster drains the stream whether or not a webview listens |
| `WebviewManager.broadcastMessage` with no webview is a no-op | `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:294-315` | "No webview" degrades to headless with no special code path |
| `chat:continue` on a live tab sends into the running session (`hasLiveSessionStream`) | `chat-session.service.ts:600-760,1160-1206` | The user can type into an adopted child tab through the normal composer |
| Frontend tab model: `TabState` (frontend-generated UUID `id`, `claudeSessionId`, `titleOrigin`, `attachedBinding` precedent for a push-driven marker); `createTab` focuses; `openSessionTab` reuses; workspace partitions | `libs/frontend/chat-types/src/lib/chat-types.ts:463,520-700`; `tab-manager.service.ts:762-854`; `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:140-453`; `libs/frontend/chat-state/src/lib/tab-persistence.ts:20-184` | Adoption = a new `TabManagerService` method that creates a tab with the BACKEND's id |
| Frontend handler registry: `handledMessageTypes` + switch; gateway attach/detach push precedent | `chat-message-handler.service.ts:103-243` | New push message handled in the same class |
| Board start precedent: frontend creates a tab named after the task and sends `/orchestrate <taskId>` through `chat:start` | `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:103-124` | A `/orchestrate` task passes through verbatim (only `/clear` is intercepted, `chat-session.service.ts:464-488`) |
| RPC method registry is compile-enforced | `libs/shared/src/lib/types/rpc.types.ts:693-705,3542-3570`; handler list + `wire(...)` `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:95-110,305-309` | New `chat:agent-sessions` RPC touches both maps and the handler |
| `IAgentAdapter`: `startChatSession(AgentSessionStartConfig{tabId, permissionLevel, sessionName, projectPath, workspaceId...})`, `sendMessageToSession(..., {origin, admission})`, `interruptCurrentTurn`, `interruptSession`, `isSessionActive`, `getSessionToken` | `libs/shared/src/lib/types/agent-adapter.types.ts:127-170,221-307`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1061-1063,1232-1250,1330-1343` | All control calls exist |
| Admission refusal `SessionAdmissionRefusedError('busy' / 'session-ended')` | `.../session-lifecycle/session-stream-pump.service.ts:207-292`; `libs/backend/agent-sdk/src/lib/errors/session-admission-refused.error.ts:16-21`; exported `libs/backend/agent-sdk/src/index.ts:96` | Honest `if-idle` send mode |
| `interruptCurrentTurn` races 3 s; a timeout RETIRES the record | `session-control.service.ts:64-151` | `steer` can end a child (risk R4) |
| Registry `find` accepts a tab id or a real SDK id | `.../session-lifecycle/session-registry.service.ts:346-348,458-460` | The child tab id is a stable handle |
| Chat MCP URL is `/session/{tabId}` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1748-1812` | A parent's MCP caller id IS its tab id; a child reaches Ptah MCP as `/session/{childTabId}` |
| MCP identity is attribution, not authentication | `.../mcp-core/mcp-caller.ts:1-19` | Depth/cap/ownership are guards against mistakes, not a security boundary |
| `getCallerSessionId()` / `getCallerAgentId()` | `.../mcp-core/mcp-request-context.ts:61-80` | Parent id taken from the transport only |
| `SdkAdapterEvents.onTurnEnded` (`{sessionId: resolved real id, cwd, lastAssistantMessage, backgroundTasks, terminalReason, timestamp}`) and `onTurnFailed`, emitted from the Stop hook | `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:39-57,188-200`; `.../helpers/stop-hook-handler.ts:105-113`; token `SDK_TOKENS.SDK_ADAPTER_EVENTS` `di/tokens.ts:97`; subscriber precedent `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:47-60` | Completion detection without owning the stream |
| `SessionIdResolvedCallbackRegistry.register({tabId, realSessionId})` (multi-subscriber) | `sdk-agent-adapter.ts:1149-1159`; token `di/tokens.ts:145-147`; exported `index.ts:142` | Binds a child's SDK id to its tab id |
| `SessionTurnStateRegistry.get(id)` phase (`generating`/`awaiting-background`/`sleeping`/`idle`/`failed`) | `.../helpers/session-turn-state.registry.ts:274,448`; `libs/shared/src/lib/types/execution/stream-background.ts:227-292` | Live status for `ptah_session_status` |
| `SessionEndCallbackRegistry.register` fires `{sessionId: real ?? tab, workspaceRoot: projectPath}` after every teardown | `.../helpers/session-end-callback-registry.ts:21-83`; `session-control.service.ts:216-217,289-298` | Child-end detection (with a re-attach grace, D7); not used for parents |
| `ITranscriptReader.read(sessionId, workspacePath, {tailBytes})` -> `ROLE: content` text, `''` on error; registered by agent-sdk in every host | `libs/backend/memory-contracts/src/lib/transcript-reader.port.ts:1-21`; `libs/backend/agent-sdk/src/lib/sdk-transcript-reader.adapter.ts:10-50`; `libs/backend/agent-sdk/src/lib/di/register.ts:538-542` | `ptah_session_read` reads the child's JSONL; no output ring needed |
| Permission callback keyed by `routingHint = sessionConfig.tabId`; decision order; route classifier (UUID -> unbounded wait); undelivered prompt -> immediate deny; lifecycle events | `sdk-query-options-builder.ts:1051-1075`; `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:105-134,199-217,232-294,367-598,626-641,952-1020` | Per-child policy hook with a bounded window on the child's own tab |
| `auto-edit` -> SDK `acceptEdits`; MCP tools always prompt | `.../session-lifecycle/permission-mode-map.ts:23-24`; `sdk-permission-handler.ts:514-524,587-592`; `.../permission/permission-tool-classifier.ts:13-64` | Literal auto-edit would block `ptah_agent_report` (R1) |
| `AgentReportRouter.deliver` keyed on `AgentProcessInfo`; closed refusal union; `<agent-report>` envelope; `peer` origin (TASK_2026_402) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:111-149,221-361` | Reused and widened for chat children |
| `LaneCompletionNotifier.signal`; verdict rule; `<agent-lane-completed>` envelope; `LaneCompletionSignal.cli: CliType` | `.../cli-agents/lane-completion-notifier.service.ts:133-212,266-427`; `libs/shared/src/lib/types/agent-process.types.ts:443-496` | Reused for a session subject without widening the shared type |
| `AgentProcessManager.listTrackedAgents()`; lanes store `parentSessionId` resolved tab -> real id | `.../cli-agents/agent-process-manager.service.ts:808,968`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:171-182` | "Child waits on its own lanes" check |
| `AgentSpawnEnvironment.scopedWorkspaceRoot()`; realpath containment | `agent-spawn-environment.service.ts:318-324,350-376` | Parent root + worktree containment |
| `resolveWorktreePath` -> `<root>/.claude-worktrees/<stem>-<sha12>`; `execGit(args[], cwd, {timeoutMs, spawner})`; `WORKTREE_GIT_TIMEOUT_MS` | `libs/backend/vscode-core/src/utils/worktree-path.ts:17-52`; `libs/shared/src/lib/constants/workspace-scan.constants.ts:88`; `libs/backend/vscode-core/src/utils/exec-git.ts:10-33,405-447,733-740` | Hashed directory name, argument arrays, process-wide git gate |
| Metadata `create(real, workspaceId, name)` sets `workingDirectory = workspaceId`; `saveResumeState` rewrites it from `projectPath` at session end; resume reads it (TASK_2026_419) | `session-metadata-store.ts:580-622,1072-1082`; `sdk-agent-adapter.ts:1102-1140`; `chat-session.service.ts:223-233,804-810` | One small change makes a child's metadata correct from creation |
| `IMcpServerStatus.getPort()`, registered as a shim by vscode-lm-tools | `libs/backend/platform-core/src/interfaces/mcp-server-status.interface.ts`; `libs/backend/vscode-lm-tools/src/lib/di/register.ts:88-111` | Precedent for the registrar port (D6) |
| `IOutputChannel` via `PLATFORM_TOKENS.OUTPUT_CHANNEL` in cli-agent-runtime | `libs/backend/platform-core/src/di/tokens.ts:36`; `.../capabilities/capability-toggle-store.ts:47,175,289` | New services log through it |
| MCP tool definitions / Zod schema / parity spec / budget hints / contract sweep; separate-file precedent `surface-tools.ts` + `surface-tool-handlers.ts` | `.../mcp-core/tool-description.builder.ts:598-805` (`MAX_AGENT_MESSAGE_LENGTH` :805); `.../mcp-core/agent-spawn-args.schema.ts:15`; `.../mcp-core/agent-spawn-surface-parity.spec.ts:9-40`; `.../mcp-core/tool-result-budget.ts:96-108`; `.../mcp-core/mcp-contract.sweep.spec.ts:195-216`; `protocol-dispatcher.ts:124-125` | MCP surface layout |
| Shutdown sites | `apps/ptah-extension-vscode/src/main.ts:143`; `apps/ptah-electron/src/activation/shutdown.ts:240,278` | Spawner `dispose()` hook |

## Architecture decision

- Chosen approach: the parent calls `ptah_session_start`; `SessionSpawnerService`
  (cli-agent-runtime) validates, creates the worktree, registers the child link
  and its unattended permission policy, then asks an `IChildChatSessionHost`
  port to start the session. The port's only implementation,
  `ChildChatSessionHostAdapter` (rpc-handlers, registered in
  `registerChatServices`), first pushes `agentSession:opened` to the webview so
  the panel that holds the parent tab adopts a tab under the backend-minted tab
  id, then runs the SAME internals `chat:start` runs (MCP registration, enhanced
  prompts, provider profile, output style, `startChatSession`,
  `streamEventsToWebview`). From then on the child is an ordinary chat tab:
  same stream, same composer, same sidebar entry, same resume path. The spawner
  never owns the stream; it observes the child through the existing SDK event
  fan-outs (turn ended/failed, session id resolved, session end, permission
  lifecycle). Control is by messaging: `ptah_session_send` injects a `peer`
  turn, the child's `ptah_agent_report` falls back to the child link, and every
  settled turn pushes one `<agent-lane-completed cli="ptah-session">`.
- Rationale: it satisfies the changed decision literally (the chat-RPC
  internals and the broadcaster are the UI's path) while keeping the start
  backend-driven, which is the only way a child can exist when no webview is
  open (CLI, closed panel). Every message channel already works on session ids
  (TASK_2026_402 router, TASK_2026_515 notifier), so the new code is the link,
  the policy, the limits, the worktree and the tab adoption.

### Material decisions

| # | Requirement | Decision | Evidence | Rejected alternative | Effect on existing code |
| --- | --- | --- | --- | --- | --- |
| D1 | Port + implementation placement | `ISessionSpawner`, `SessionSpawnerService`, `SessionChildRegistry`, `ChildWorktreeProvisioner` and the `IChildChatSessionHost` port live in `libs/backend/cli-agent-runtime/src/lib/session-children/`; tokens in `CLI_AGENT_RUNTIME_TOKENS` | Import graph; `AGENT_REPORT_ROUTER` precedent `ptah-api-builder.service.ts:453-461,706-719` | (a) impl in `agent-sdk`: cannot reach the routers in `cli-agent-runtime`. (b) impl in `rpc-handlers`: `vscode-lm-tools` (the MCP consumer) does not depend on `rpc-handlers` and must not. (c) beside `gateway-chat-bridge`: that lib depends on `vscode-lm-tools`, a cycle. (d) a `platform-core` port for the spawner: no platform-varying implementation | New folder; cli-agent-runtime `di/tokens.ts`, `di/register.ts`, `src/index.ts` gain entries |
| D2 | "Bind to the UI exactly as if the user created it" | Backend-driven start through the chat-RPC internals, behind `IChildChatSessionHost`; `ChatSessionService` gains `startAgentChildSession(...)` that shares a private `launchSdkSession(...)` extracted from `startSession`; the webview adopts the tab from an `agentSession:opened` push | `chat-session.service.ts:415-595`; broadcaster `:135-420`; no open-tab message exists (`message-constants.ts`) | (a) Frontend-driven: backend asks the webview to `createTab` + `chat:start`. With no webview the child never starts, the backend cannot register the policy/link before the first tool call, and rollback cannot be awaited. (b) Direct `startChatSession` + a headless consumer (the previous draft): violates the changed decision and duplicates the broadcaster | `startSession` behaviour unchanged (same internals, same parameters); a new method, a new RPC, a new push message |
| D3 | Sidebar entry under the parent's workspace, resume in the worktree | Child started with `workspaceId = parent root` (sidebar grouping, tab partition) and `projectPath = worktree` (cwd, MCP workspace, permission `writableRoot`); `startChatSession` forwards `config.workspaceId ?? resolvedProjectPath` as the metadata `workspaceId` and the worktree as `workingDirectory` (today it forwards the project path as `workspaceId`, `sdk-agent-adapter.ts:768-775`; exact change in component 1) | `session-metadata-store.ts:625-640,1072-1082`; `sdk-agent-adapter.ts:1102-1140`; resume `chat-session.service.ts:804-810` | Keep `workspaceId = worktree` (the `chat:start` default): the child vanishes from the parent workspace's sidebar | `create` gains an optional 4th parameter; every existing caller passes `projectPath === workspaceId`, so their records are unchanged |
| D4 | Unattended permission (user decision) | Per-child `UnattendedSessionPolicy` in an `agent-sdk` registry keyed by the child tab id; `SdkPermissionHandler` checks it first; anything not auto-allowed goes to the child's OWN tab as a normal prompt with a bounded deny window; with no webview the existing "not delivered" path denies at once | `sdk-permission-handler.ts:232-294,367-400,626-641`; routing hint = tab id `sdk-query-options-builder.ts:1068-1075` | Thread a policy through `AgentSessionStartConfig` -> adapter -> lifecycle -> executor -> builder (5 files, a shared-type change) | One optional collaborator + one early branch; interactive sessions untouched |
| D5 | Honest send modes | `queue` (default; held until the current turn ends), `steer` (`interruptCurrentTurn` then send; refused if the interrupt fails), `if-idle` (`admission:'require-idle'`; refused `busy`) | `session-stream-pump.service.ts:207-292`; stop-intent precedent `chat-session.service.ts:727-746` | Two modes only: the "refused when busy" case needs the admission mode, which exists | None |
| D6 | Subagents in the worktree see Ptah tools | Optional platform-core port `IMcpSubagentRootRegistrar`, implemented by `CodeExecutionMCP` as "retained roots" in its desired slot set | `http-mcp-server.service.ts:436-531`; shim precedent `vscode-lm-tools/src/lib/di/register.ts:88-111`; `.gitignore:53` | Spawner writes `<worktree>/.mcp.json`: duplicates slot planning and reconcile | Reconcile includes retained roots |
| D7 | Parent and child session end (revised by the user decision in Revision 1) | Parent end or inactivity never stops children; the link is kept, and ownership accepts the parent's tab id or SDK id. While the parent is not live, reports are refused to the child and completions are held (latest per child), see Data flow. A child's own `SessionEnd` arms one 30 s grace timer for that child; if the child id is not active again, it is marked ended | `session-control.service.ts:211-299`; `session-lifecycle-manager.ts:593-595`; `agent-report-router.service.ts:268-272` | (a) Stop children when the parent is gone for 30 s: rejected by the user. (b) Queue reports for a resumed parent: stale replay, see Data flow | None outside the spawner |
| D8 | Completion signal | One push per SETTLED turn of a child: `onTurnEnded` with no background tasks and no running Ptah lane naming the child as parent -> push `completed`; `onTurnFailed` -> push `failed`; dedupe by event timestamp. Envelope reuses `<agent-lane-completed>` with `cli="ptah-session"` and the lane verdict rule | `sdk-adapter-events.service.ts:39-57`; `lane-completion-notifier.service.ts:321-397`; `agent-process-manager.service.ts:808` | Push on stream exit (lanes): a streaming-input session never exits on its own. Push on every turn end: an orchestrating child ends turns while its lanes run and would report `no-deliverable` early | Notifier gains `signalSessionChild`; lane path unchanged |
| D9 | Limits | Host-wide cap on LIVE children (default 3, `agentSessions.maxConcurrent`, clamp 1..5); depth fixed at 1; wall-clock cap per child (default 120 min, `agentSessions.maxRuntimeMinutes`, clamp 5..720); slot reserved synchronously before the first await | lane-cap pattern `agent-spawn-environment.service.ts:224-240` | Per-parent cap: the protected resource (a Claude subprocess) is per host | New settings keys read per start |
| D10 | Link state vs TASK_2026_580 | Separate in-memory `SessionChildRegistry` now; 580 absorbs the durable fields later. No SQLite table, no migration, no new `SessionMetadata` field in 584 | 580 context.md Decisions 1, 3, 5 and Phase B.5; `session-metadata-store.ts:451-468` (4-field carry-over) | Build 580's `session_organization` table (or a `parent_session_id` column) now as the first slice | See "Coordination with related tasks" |
| D11 | Logging | New backend services log via `IOutputChannel` (`[SessionSpawner]` prefix); modified existing services keep `Logger` | `capability-toggle-store.ts:175,289` | Migrate the router/notifier/chat service loggers now: churn outside scope | None |

- Assumptions (each with its check):
  - A1: The panel that holds the parent tab receives `agentSession:opened`
    before the first `chat:chunk` for the child, because both are posted in
    order on the same webview channel and the push is awaited before the stream
    starts. Check: smoke S1 (first assistant text lands in the adopted tab).
  - A2: A tab adopted with a known `claudeSessionId`, status `loaded` and no
    messages (the state `openSessionTab` builds, `tab-manager.service.ts:762-804`)
    loads its history through the same lazy loader the sidebar-open path uses.
    Check: frontend-developer locates that trigger before coding the late
    adoption path; smoke S1b (reload the webview mid-run).
  - A3: Task subagents read the Ptah server from `<cwd>/.mcp.json` rather than
    inheriting the session's `mcpServers` (TASK_2026_318 note at
    `chat-session.service.ts:496-515`). Check: smoke S3 with and without the
    registrar.
  - A4: SDK `acceptEdits` auto-approves edits only inside `cwd`; an edit outside
    reaches `canUseTool`. Check: smoke S7.
  - A5: `ITranscriptReader.read(sdkId, worktreePath, ...)` locates the child's
    JSONL by the worktree cwd. Check: spawner integration spec or smoke S6.
  - A6: Host RPC allowlists (`apps/*/src/**/rpc-host-profile.ts`, referenced by
    TASK_2026_580 context) list chat methods explicitly. Check: grep before
    wiring `chat:agent-sessions`; add it where `chat:running-agents` appears.
- Effect on existing code: nothing is replaced. Extended in place:
  `ChatSessionService` (extract + one method), `SdkAgentAdapter` id callback and
  `SessionMetadataStore.create` (optional arg), `SdkPermissionHandler` (early
  branch), `AgentReportRouter` / `LaneCompletionNotifier` (session subject),
  `CodeExecutionMCP` (retained roots), `ptah_agent_report` case, chat RPC
  handler, `ChatMessageHandler`, `TabManagerService`, tab persistence, tab bar,
  chat view. Left alone: gateway, `session_submit`, lanes,
  `ptah_git_worktree_*`, the `chat:start` RPC contract.

## Component specifications

### 1. UnattendedSessionPolicy + metadata cwd at creation (agent-sdk)

- Purpose: decide every tool call of a child without an unbounded wait; record
  the child's worktree as its working directory from the first metadata write.
- Responsibilities:
  - `UnattendedSessionPolicyRegistry` (`*Registry`): `register(routingId, policy): () => void`,
    `get(routingId | undefined)`. Key = child tab id.
  - `UnattendedSessionPolicy` data: `{ bashAllowlist: readonly string[]; writableRoot: string; denyWindowMs: number; ownerLabel: string }`.
  - Pure matcher `evaluateUnattendedBash(command, allowlist)`: refuse a command
    containing a newline, `;`, `&`, `|`, a backtick, `$(`, `<` or `>`; else allow
    when its leading whitespace-separated tokens equal an allowlist entry's
    tokens (token boundary, case-sensitive).
  - `SdkPermissionHandler` callback: when `registry.get(routingHint)` exists,
    apply this table first and return; otherwise run the existing path
    unchanged.

    | Tool | Child decision |
    | --- | --- |
    | `SAFE_TOOLS` except `EnterPlanMode` | allow (unchanged) |
    | `EnterPlanMode` | deny now: plan mode is unavailable to unattended children; write the plan to a file |
    | `AskUserQuestion` | deny now: decide, then tell the parent with `ptah_agent_report` |
    | `ExitPlanMode` | allow |
    | `Write` / `Edit` / `NotebookEdit` | allow when the target resolves inside `writableRoot`, else bounded prompt |
    | `Bash` | allow when `evaluateUnattendedBash` allows, else bounded prompt |
    | `Task` | allow (unchanged) |
    | `mcp__ptah__*` | allow (R1) |
    | other `mcp__*`, `WebFetch`, `WebSearch`, unknown | bounded prompt |

    "Bounded prompt" = the existing `requestUserPermission` flow with the
    child's routable session/tab ids (so the prompt renders in the child's tab)
    and the deny window forced to `policy.denyWindowMs` instead of the unbounded
    webview wait. With no webview, the existing "not delivered" branch denies
    immediately (`sdk-permission-handler.ts:256-276`). "Always Allow" rules are
    not consulted for policy sessions. Deny text names the allowlist and tells
    the model to report the blocker to the parent.
  - Metadata identity (Revision 1, fix 1). Verified today:
    `SdkAgentAdapter.startChatSession` computes
    `resolvedProjectPath = config?.projectPath || os.homedir()` and passes it as
    the FIRST argument of `createSessionIdCallback`, which becomes the metadata
    `workspaceId` (`sdk-agent-adapter.ts:768-775,1102-1140`); `config.workspaceId`
    is ignored for metadata. Exact change:
    - `createSessionIdCallback(workspaceId, workingDirectory, sessionName, sessionToken, statsGeneration, tabId?)`
      — one new parameter after `workspaceId`.
    - `startChatSession` calls it with
      `workspaceId = config.workspaceId ?? resolvedProjectPath` and
      `workingDirectory = resolvedProjectPath`.
    - Inside the callback:
      `metadataStore.create(realSessionId, workspaceId, sessionName, workingDirectory)`.
    - `SessionMetadataStore.create(sessionId, workspaceId, name, workingDirectory?)`
      records `workingDirectory: workingDirectory ?? workspaceId`.
    - `recordPendingUserActivity(trackingId, resolvedProjectPath)` is unchanged
      (activity is about the cwd).
    - Every existing caller passes `workspaceId === projectPath`
      (`chat-session.service.ts:555-560`, `gateway-chat-bridge.ts:754-764`), so
      their metadata is byte-identical. Check the resume and slash-command
      paths (`resumeSession`, `executeSlashCommand`) for the same first-argument
      pattern and apply the same rule there if they create metadata.
    - Tests: (a) adapter spec — `startChatSession({ workspaceId: '/root', projectPath: '/root/.claude-worktrees/x', ... })`
      creates metadata with `workspaceId '/root'`, `workingDirectory` = the
      worktree; (b) adapter spec — omitted `workspaceId` keeps today's record;
      (c) store/list spec — a record created that way is returned by
      `getForWorkspace('/root')`, the source of `session:list`
      (`session-metadata-store.ts:625-640`), so the child is listed under the
      parent workspace.
- Verified contracts: `createCallback` `sdk-permission-handler.ts:367-400`;
  decision order `:447-598`; classifier `:626-641`; deny timer `:998-1019`;
  undelivered deny `:248-294`; tool tables `permission/permission-tool-classifier.ts:13-64`;
  `SDK_TOKENS` `agent-sdk/src/lib/di/tokens.ts:41`; handler registration
  `di/register.ts:177-178`; metadata `create` `session-metadata-store.ts:1041-1091`;
  id callback `sdk-agent-adapter.ts:1102-1140`.
- Dependencies: agent-sdk internal. New token
  `SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY = Symbol.for('SdkUnattendedSessionPolicyRegistry')`;
  the registry is an optional last constructor parameter of
  `SdkPermissionHandler`.
- Integration points: the spawner registers before start and releases on end.
- Failure behaviour: a matcher/path exception counts as "not allowed" (bounded
  prompt), never allow. Window clamped 0..600 000 ms; `0` = deny now.
- Quality requirements: no policy-session prompt ever uses `timeoutAt = 0`.
- Verification seam: matcher table spec; handler spec with a registered policy
  and UUID ids for every row, deny at `denyWindowMs` (fake timers), undelivered
  deny; spec proving an unregistered id is unchanged; metadata spec for the
  optional `workingDirectory`.
- Files:
  - CREATE `libs/backend/agent-sdk/src/lib/permission/unattended-session-policy.registry.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/agent-sdk/src/lib/permission/unattended-bash-policy.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/agent-sdk/src/lib/sdk-permission-handler.unattended.spec.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (+ its spec)
  - MODIFY `libs/backend/agent-sdk/src/lib/di/tokens.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/di/register.ts`
  - MODIFY `libs/backend/agent-sdk/src/index.ts` (two names only; the barrel is
    already 369 lines, over the 150-line rule)

### 2. McpSubagentRootRegistrar (platform-core port, vscode-lm-tools implementation)

- Purpose: keep a Ptah entry in `<worktree>/.mcp.json` while a child runs there.
- Responsibilities:
  ```ts
  export interface IMcpSubagentRootRegistrar {
    retainRoot(root: string): Promise<{ readonly registered: boolean; readonly reason?: string }>;
    releaseRoot(root: string): Promise<void>; // idempotent
  }
  ```
  Token `PLATFORM_TOKENS.MCP_SUBAGENT_ROOT_REGISTRAR = Symbol.for('PlatformMcpSubagentRootRegistrar')`.
  `CodeExecutionMCP` adds a `retainedRoots` set to the roots passed to
  `planPtahMcpSlots` in `desiredSlots()`; both methods run inside
  `enqueueMcpOp` and reconcile. Registered as a shim beside `MCP_SERVER_STATUS`.
- Verified contracts: `http-mcp-server.service.ts:436-464,493-531,923`;
  `mcp-http/ptah-mcp-slots.ts:275-280`; `vscode-lm-tools/src/lib/di/register.ts:88-111`;
  `platform-core/src/di/tokens.ts:72`.
- Failure behaviour: port absent or `registered: false` -> the child still
  starts (its main session has Ptah MCP via its URL); status reports
  `subagentPtahTools: 'unavailable'` with the reason. Release failures are
  logged, never block a stop.
- Verification seam: HttpMcpServer spec: retained root written, survives a
  folder-change reconcile, removed after release, release idempotent.
- Files:
  - CREATE `libs/backend/platform-core/src/interfaces/mcp-subagent-root-registrar.interface.ts`
  - MODIFY `libs/backend/platform-core/src/di/tokens.ts`
  - MODIFY `libs/backend/platform-core/src/index.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts` (+ its spec; Assumption: `http-mcp-server.service.spec.ts` exists, else CREATE)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/di/register.ts`

### 3. Link layer: ports, SessionChildRegistry, router and notifier widening (cli-agent-runtime)

- Purpose: the contracts every other component uses, the child -> parent link,
  and child -> parent delivery through the TASK_2026_402/515 channels.
- Port contracts (`session-spawner.port.ts`):
  ```ts
  export type SessionChildStatus =
    | 'starting' | 'working' | 'awaiting-permission' | 'waiting' | 'idle'
    | 'failed' | 'stopped' | 'timed-out' | 'ended';

  export interface SessionChildSnapshot {
    readonly childSessionId: string;        // child tab id (UUID v4) — the handle every tool takes
    readonly sdkSessionId?: string;
    readonly parentSessionId: string;       // parent tab id (its MCP routing id)
    readonly parentSdkSessionId?: string;
    readonly label: string;
    readonly taskId?: string;
    readonly branch: string;
    readonly baseRef: string;               // resolved commit sha
    readonly workspaceRoot: string;         // parent root: sidebar group + tab partition
    readonly worktreePath: string;          // cwd + metadata workingDirectory
    readonly taskFolder?: string;
    readonly deliverables: readonly string[];  // absolute, resolved at start
    readonly status: SessionChildStatus;
    readonly pendingPermission?: { readonly toolName: string; readonly description: string; readonly deniesAt: string };
    readonly subagentPtahTools: 'available' | 'unavailable';
    readonly startedAt: string;
    readonly endedAt?: string;
    readonly endReason?: string;
    readonly turnsSettled: number;
    readonly reportsDelivered: number;
    readonly reportsRefused: number;       // refused while the parent was not live
    readonly lastRefusedReport?: string;   // summary of the last refused report
    readonly heldCompletion?: { readonly turn: number; readonly verdict: LaneCompletionVerdict; readonly heldSince: string }; // latest completion not yet delivered
    readonly lastRecap?: string;
    readonly lastCompletion?: { readonly turn: number; readonly verdict: LaneCompletionVerdict; readonly delivered: boolean; readonly refusal?: string };
  }

  export interface SessionChildStartRequest {
    readonly callerSessionId: string | undefined; // transport only
    readonly task: string;
    readonly branch: string;
    readonly baseRef?: string;
    readonly label?: string;
    readonly taskId?: string;
    readonly taskFolder?: string;
    readonly deliverables?: readonly string[];
    readonly model?: string;
  }

  export type SessionSpawnRefusalCode =
    | 'unattributed-caller' | 'depth-exceeded' | 'cap-reached' | 'mcp-unavailable'
    | 'chat-runtime-unavailable' | 'no-workspace' | 'invalid-arguments' | 'branch-exists'
    | 'worktree-failed' | 'worktree-outside-workspace' | 'session-start-failed';

  export type SessionChildStartResult =
    | { readonly ok: true; readonly child: SessionChildSnapshot }
    | { readonly ok: false; readonly refusal: SessionSpawnRefusalCode; readonly detail: string;
        readonly rollback?: readonly { readonly step: 'remove-worktree' | 'delete-branch' | 'release-policy' | 'release-mcp-root' | 'remove-link'; readonly ok: boolean; readonly detail?: string }[] };

  export type SessionSendMode = 'queue' | 'steer' | 'if-idle';
  export interface SessionChildSendRequest { readonly callerSessionId: string | undefined; readonly childSessionId: string; readonly message: string; readonly mode: SessionSendMode }
  export type SessionChildSendResult =
    | { readonly delivered: true; readonly effect: 'started-turn' | 'held-until-turn-end' | 'interrupted-and-started' }
    | { readonly delivered: false; readonly reason: 'not-a-child-of-caller' | 'unknown-child' | 'unattributed-caller' | 'session-ended' | 'busy' | 'interrupt-failed' | 'delivery-failed'; readonly detail: string };

  export interface SessionChildQuery { readonly callerSessionId: string | undefined; readonly childSessionId?: string }
  export type SessionChildLookupRefusal = { readonly ok: false; readonly reason: 'not-a-child-of-caller' | 'unknown-child' | 'unattributed-caller'; readonly detail: string };
  export interface SessionChildReadResult { readonly child: SessionChildSnapshot; readonly transcript: string; readonly truncated: boolean; readonly available: boolean }

  export interface ISessionSpawner {
    start(request: SessionChildStartRequest): Promise<SessionChildStartResult>;
    send(request: SessionChildSendRequest): Promise<SessionChildSendResult>;
    status(query: SessionChildQuery): { readonly ok: true; readonly children: readonly SessionChildSnapshot[] } | SessionChildLookupRefusal;
    read(query: SessionChildQuery & { readonly childSessionId: string; readonly tailKiB?: number }): Promise<{ readonly ok: true; readonly result: SessionChildReadResult } | SessionChildLookupRefusal>;
    stop(query: SessionChildQuery & { readonly childSessionId: string }): Promise<{ readonly ok: true; readonly child: SessionChildSnapshot } | SessionChildLookupRefusal>;
    /** Live children as UI descriptors — serves `chat:agent-sessions` for late tab adoption. */
    listUiDescriptors(workspaceRoot?: string): readonly AgentSessionOpenedPayload[];
    /** Held completions of the caller's children, returned once and then marked delivered (parent was not live when they settled). */
    takeHeldCompletions(callerSessionId: string | undefined): readonly SessionChildCompletionEnvelope[];
    dispose(): void;
  }
  ```
  Host port (`child-chat-session-host.port.ts`):
  ```ts
  export interface ChildChatSessionStartInput {
    readonly tabId: string;               // backend-minted UUID v4
    readonly workspaceRoot: string;       // parent root -> metadata workspaceId, tab partition
    readonly worktreePath: string;        // projectPath / cwd
    readonly prompt: string;              // contract + task (what the SDK receives)
    readonly descriptor: AgentSessionOpenedPayload; // what the webview adopts
    readonly sessionName: string;
    readonly model?: string;
  }
  export type ChildChatSessionStartOutcome =
    | { readonly started: true; readonly uiAnnounced: boolean }
    | { readonly started: false; readonly error: string };
  export interface IChildChatSessionHost {
    startChildSession(input: ChildChatSessionStartInput): Promise<ChildChatSessionStartOutcome>;
  }
  ```
  `AgentSessionOpenedPayload` comes from `@ptah-extension/shared` (component 5).
  Refusals follow the repository's discriminated-result shape
  (`agent-report-router.service.ts:111-149`).
- `SessionChildRegistry` API: `reserveSlot(max)` (synchronous; live records +
  outstanding reservations), `add(record, reservation)`, `release(reservation)`,
  `get(id)` by tab or SDK id, `findByCwd(path)`, `isChild(id)`,
  `childrenOf(parentIds)`, `bindSdkSessionId`, `markReportDelivered`,
  `update`, `markEnded`, `pruneEnded(20)`, `liveCount()`. Plain serialisable
  records (TASK_2026_580 absorbs the durable part, D10).
- Router widening: `AgentReportInput = { agentId; message; summary? } | { childSessionId; message; summary? }`.
  The `childSessionId` branch resolves the child in the registry (unknown ->
  `unattributed-caller`, detail "this session was not started with
  ptah_session_start"); parent = recorded parent tab id, else parent SDK id when
  the tab id is not active; envelope
  `<agent-report agent-id="{childSessionId}" agent="{label}" cli="ptah-session">`;
  origin `{ kind: 'peer', from: 'ptah-session:{childSessionId}', name: 'session · {label}' }`;
  shared size/`SessionId.safeParse`/`isSessionActive`/burst/duplicate checks,
  rate keys namespaced `session:{id}`; on delivery `registry.markReportDelivered`;
  on `parent-session-not-active` `registry.markReportRefused(childId, summary)`
  (counted for status, not queued).
  The agent branch is byte-identical.
- Notifier widening: `signalSessionChild(subject, settle)`; subject =
  `{ childSessionId, label, parentSessionIds, task, taskFolder?, deliverables, worktreePath, branch, startedAt, reportsDelivered, lastRecap? }`,
  settle = `{ turn, status: 'completed' | 'failed' | 'timeout', completedAt }`;
  it also exposes the pure envelope builder so a held completion can be
  rendered later (`SessionChildCompletionEnvelope = { childSessionId; turn; verdict; text }`,
  defined in the port file); when the parent is not live the notifier returns
  the refusal with the built envelope and the spawner stores it as the child's
  `heldCompletion` (latest wins);
  reuses the private deliverable check (generalised to
  `{ deliverables, taskFolder, workingDirectory, id }`), `verdictOf`,
  `escapeAttribute`, `formatDuration`; dedupe key `{childSessionId}:turn:{n}`.
  Envelope:
  ```
  <agent-lane-completed agent-id="{childSessionId}" agent="{label}" cli="ptah-session" status="{status}" verdict="{verdict}" turn="{n}">
  Child session {label} settled: {status} after {duration} (settled turn {n}).
  Task: {headline}
  Branch: {branch}
  Worktree: {worktreePath}
  [Task folder: ...]
  Deliverables: ... (lane rendering: MISSING / EMPTY / N bytes / NOT written by this run)
  Reports sent by this child so far: {n}.
  [Last message: {lastRecap}]
  Next: {verdict-specific: steer with ptah_session_send, inspect with ptah_session_read; the child stays open in its tab and holds a slot until ptah_session_stop; the user owns merge, PR and worktree cleanup}
  </agent-lane-completed>
  ```
  Verdict semantics are the lane semantics (`completed` + all non-empty =
  `delivered`; none declared = `unverified`; missing/empty = `no-deliverable`;
  `failed`/`timeout` = `failed`), with one stricter rule for session subjects
  (Revision 1, fix 3):
  - Reference time: the child's `startedAt`, stamped by the spawner AFTER
    `git worktree add` returns and before the host starts the session. It is
    fixed for the child's life, not reset per settled turn, because a
    deliverable written in an earlier turn is still this run's work. The
    notifier's `checkOne` compares `stat.mtime >= startedMs`
    (`lane-completion-notifier.service.ts:276-284`) against that value.
  - Files checked out into the fresh worktree get their mtime during
    `git worktree add`, which finished before `startedAt`, so they report
    `writtenAfterSpawn: false`.
  - For a session subject, a deliverable with `writtenAfterSpawn === false`
    counts as NOT delivered (verdict `no-deliverable`, rendered
    `NOT written by this run`). The lane verdict (`:321-331`) ignores that flag
    and stays unchanged; a tracked file that merely exists in the checkout must
    not read as the child's work. `writtenAfterSpawn` absent (mtime unreadable)
    keeps the lane behaviour (existence + non-empty).
  - Residual: filesystems with coarse mtime (2 s on FAT) could date a checkout
    file inside the same tick; `startedAt` is taken from `Date.now()` after the
    git call returns, and the spec pins the boundary (`mtime === startedAt`
    counts as written, matching `>=`).
  - Tests: notifier spec — a deliverable with mtime before `startedAt` ->
    `no-deliverable` for a session subject but `delivered` for a lane subject;
    one after -> `delivered`. The return type
  `SessionChildCompletionDelivery` lives in the port file, not in `shared`.
- Verified contracts: `agent-report-router.service.ts:221-361`;
  `lane-completion-notifier.service.ts:133-427`; `SessionId` `branded.types.ts:39-109`.
- Failure behaviour: every branch delivered or a closed refusal. A refused
  completion is stored on the record (`lastCompletion.delivered = false`) so
  `ptah_session_status` is the poll fallback.
- Verification seam: registry spec (reservation race, lookups, pruning); router
  spec (child delivery, unknown child, parent inactive, shared burst limit);
  notifier spec (verdict table, per-turn dedupe, `no-deliverable`, envelope
  snapshot); existing lane specs unchanged.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts`
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts`
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts` (+ `.spec.ts`)
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts` (+ spec)
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` (+ spec)
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts`
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts` (`SESSION_SPAWNER = Symbol.for('SessionSpawner')`, `CHILD_CHAT_SESSION_HOST = Symbol.for('ChildChatSessionHost')`)
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/di/register.ts` (registry singleton before the router)
  - MODIFY `libs/backend/cli-agent-runtime/src/index.ts` (one grouped export for `./lib/session-children`)

### 4. ChildWorktreeProvisioner (cli-agent-runtime)

- Purpose: create, verify and roll back one child's worktree; nothing else.
- Responsibilities (all through `execGit(args[], root, { timeoutMs: WORKTREE_GIT_TIMEOUT_MS, spawner? })`):
  1. `git check-ref-format --branch <branch>` -> `invalid-arguments`.
  2. `git rev-parse --verify --quiet refs/heads/<branch>` must fail -> else
     `branch-exists`.
  3. `git rev-parse --verify --quiet <baseRef ?? 'HEAD'>^{commit}` -> sha or
     `invalid-arguments`.
  4. `path = resolveWorktreePath(root, branch)`; refuse when it exists.
  5. `git worktree add -b <branch> <path> <sha>` -> `worktree-failed` (stderr).
  6. `realpath(path)` within `realpath(root)` (`isPathWithinRoots`) -> else
     rollback + `worktree-outside-workspace`.
  - `rollback`: `git worktree remove --force <path>`, then `git branch -D <branch>`,
    only for what this call created; each step reported.
- Verified contracts: `worktree-path.ts:37-52`; `exec-git.ts:10-33,405-447,733-740`;
  `SDK_TOKENS.SDK_PROCESS_SPAWNER` `agent-sdk/src/lib/di/tokens.ts:65` (optional;
  Electron binds it).
- Failure behaviour: git failure -> refusal with stderr; 300 s timeout ->
  `worktree-failed`; rollback never throws and never hides a failed step.
- Verification seam: unit spec with `execGit` mocked; one integration spec on a
  temp repo proving add + rollback leave no worktree and no branch.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/child-worktree.provisioner.ts` (+ `.spec.ts`, `.integration.spec.ts`)

### 5. Chat-path host adapter, shared contracts and `chat:agent-sessions` RPC (shared + rpc-handlers)

- Purpose: start a child through the same internals as `chat:start`, announce
  its tab to the webview, and let a (re)loaded webview adopt live child tabs.
- Responsibilities:
  - Shared contracts:
    - `MESSAGE_TYPES.AGENT_SESSION_OPENED = 'agentSession:opened'` with
      payload-map entry (backend -> frontend push).
    - ```ts
      export interface AgentSessionOpenedPayload {
        readonly tabId: string;              // child tab id: the stream key
        readonly sessionId: string | null;   // child SDK id once resolved (null in the live push)
        readonly parentTabId: string;        // parent's tab id (its MCP routing id)
        readonly parentSessionId: string | null;
        readonly workspaceRoot: string;      // tab partition
        readonly worktreePath: string;
        readonly branch: string;
        readonly label: string;
        readonly taskId?: string;
        readonly displayPrompt: string;      // the task text shown as the first user turn
        readonly startedAt: number;
      }
      ```
    - RPC `chat:agent-sessions`: params `{ workspaceRoot?: string }`, result
      `{ sessions: AgentSessionOpenedPayload[] }` (live children only), added to
      `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`.
  - `ChatSessionService`: extract the SDK-launch half of `startSession`
    (lines ~489-580: MCP registration, enhanced prompts, model, provider
    profile, output style, `startChatSession`, `streamEventsToWebview`) into a
    private `launchSdkSession(input)`; `startSession` calls it with
    `workspaceId = projectPath = workspacePath` (behaviour unchanged). New
    `startAgentChildSession({ tabId, workspaceRoot, worktreePath, prompt, sessionName, model })`
    runs `isAuthorizedWorkspace(worktreePath)` and the unsafe-path refusal, then
    `launchSdkSession` with `workspaceId = workspaceRoot`,
    `projectPath = worktreePath`, `permissionLevel: 'auto-edit'`, enhanced
    prompts / provider profile / output style resolved for `workspaceRoot`, and
    `mcpServerRunning = codeExecutionMcp.getPort() !== null` (a child without
    MCP could never report; the active-root `.mcp.json` outcome does not
    downgrade it — subagent tools are the registrar's concern, D6). No
    slash-command intercept and no Ptah-CLI branch.
  - `ChildChatSessionHostAdapter implements IChildChatSessionHost`
    (`@injectable`, registered in `registerChatServices` under
    `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`):
    `await webviewManager.broadcastMessage(AGENT_SESSION_OPENED, descriptor)`
    (`uiAnnounced = true` when it resolves; a throw is caught -> `false`), then
    `startAgentChildSession(...)`; a thrown error or `{ success: false }` ->
    `{ started: false, error }`. When `uiAnnounced` is true and the start
    fails or throws, the adapter itself sends
    `MESSAGE_TYPES.CHAT_ERROR` with `{ tabId, sessionId: tabId, error: 'Child session could not start: <reason>' }`
    to the webview before returning (Revision 1, fix 2). Reason: chat errors are
    emitted only from `streamEventsToWebview` (`chat-session.service.ts:583-594`;
    broadcaster `chat-stream-broadcaster.service.ts:294-356`), which is never
    reached when the launch fails, and the adopted tab sits in `streaming`
    (`tab-manager.service.ts:697-698`). The frontend's existing `CHAT_ERROR`
    handler (`chat-message-handler.service.ts:469-493`) then resets the tab. A
    failing error broadcast is logged and does not change the returned
    outcome.
  - `ChatRpcHandlers`: wire `chat:agent-sessions` to
    `spawner.listUiDescriptors(params.workspaceRoot)`; spawner injected with
    `{ isOptional: true }` (absent -> `{ sessions: [] }`).
- Verified contracts: `chat-session.service.ts:415-595`;
  `chat/di.ts:57-92`; `chat-rpc.handlers.ts:95-110,305-309`;
  `rpc.types.ts:693-705,3542-3570`; `message-constants.ts:128-207`;
  `webview-manager.ts:294-315`; `session-lifecycle-notifier.ts:40-60`
  (`WebviewBroadcaster` shape).
- Dependencies: rpc-handlers -> cli-agent-runtime (port + token), existing
  direction; rpc-handlers -> shared.
- Failure behaviour: a start error is returned, never thrown into the spawner;
  the broadcast never blocks the start (no webview = headless, the broadcaster
  still drains the stream). In the CLI host the push adapter has no listener for
  the child tab, so the child is headless there by construction (moot in the
  MVP: the spawner refuses `mcp-unavailable` in the CLI).
- Quality requirements: `startSession` output unchanged for every existing
  caller (pinned by its current specs).
- Verification seam: `chat-session.service` spec proving `startSession` still
  passes `workspaceId === projectPath` and the child method passes
  `workspaceId = root`, `projectPath = worktree`, `permissionLevel = 'auto-edit'`;
  adapter spec (announce-then-start order; broadcast failure still starts;
  start failure returned; when announced, a `{ success: false }` start AND a
  thrown start each send exactly one `CHAT_ERROR` for the child `tabId`; when
  not announced, no `CHAT_ERROR` is sent); RPC handler spec.
- Files:
  - MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`
  - MODIFY `libs/shared/src/lib/types/messages/payload-map.ts`
  - CREATE `libs/shared/src/lib/types/messages/agent-session.ts` (payload type; exported where `gateway.ts` payloads are exported)
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (params/result)
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts` (registry + entries)
  - MODIFY `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ spec)
  - CREATE `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts` (+ `.spec.ts`)
  - MODIFY `libs/backend/rpc-handlers/src/lib/chat/di.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (+ spec)
  - MODIFY host RPC allowlists if they enumerate chat methods (Assumption A6)

### 6. SessionSpawnerService and child contract (cli-agent-runtime)

- Purpose: implement `ISessionSpawner`: guard, provision, link, start via the
  host port, observe, route messages, stop, and push one completion per settled
  turn.
- Responsibilities:
  - `SessionSpawnerService` (`@injectable`, singleton under
    `SESSION_SPAWNER`). Subscribes ONCE (constructor) to
    `SdkAdapterEvents.onTurnEnded` / `onTurnFailed`,
    `SessionIdResolvedCallbackRegistry.register`,
    `SessionEndCallbackRegistry.register`,
    `SdkPermissionHandler.onPromptLifecycle`; all disposers released in
    `dispose()`.
  - Status derivation (`status()` computes, nothing polls): ended -> its
    terminal status; `pendingPermission` set -> `awaiting-permission`; else
    `SessionTurnStateRegistry.get(sdkId ?? tabId)?.phase`: `generating` ->
    `working`, `awaiting-background`/`sleeping` -> `waiting`, `idle`/`failed`
    -> `idle` (or `waiting` when a running lane names the child); none ->
    `starting`.
  - `read`: `ITranscriptReader.read(sdkSessionId, worktreePath, { tailBytes: tailKiB * 4 KiB })`,
    clamped to `tailKiB` KiB of output (default 32, max 256); before the SDK id
    is known -> `available: false` with "no transcript yet".
  - `renderSessionChildContract(input)` (pure): prepended to the task — child of
    `{parent label}` on branch `{branch}` in `{worktree}`; runs unattended in its
    own tab (the user may also type there); AskUserQuestion and plan mode are
    unavailable; report progress and blockers with `ptah_agent_report` (reaches
    the parent); cannot start sessions; Bash limited to `{allowlist}`, others
    denied after `{window}` unless approved in this tab; commit on this branch
    only, never merge/push/remove the worktree (the user owns it); write every
    declared deliverable before going idle. Separate from
    `renderLaneCompletionContract` (`lane-reporting-contract.ts:29-63`), whose
    text is about process exit.
  - `readSessionChildSettings(workspace)` (pure): `agentSessions.maxConcurrent`
    (3, 1..5), `agentSessions.maxRuntimeMinutes` (120, 5..720),
    `agentSessions.permissionDenyWindowMs` (60 000, 0..600 000),
    `agentSessions.bashAllowlist` (default: `git status`, `git diff`, `git log`,
    `git show`, `git add`, `git commit`, `git rev-parse`, `git ls-files`,
    `git branch --show-current`, `npx nx`, `npm test`, `npm run`, `ls`, `pwd`);
    invalid values fall back to defaults (pattern
    `agent-spawn-environment.service.ts:224-240`).
- Verified contracts: listed in Codebase evidence (adapter, events, registries,
  transcript reader, lanes, spawn environment, settings); `SDK_SESSION_TURN_STATE_REGISTRY`
  `agent-sdk/src/lib/di/tokens.ts:153`; `SDK_SESSION_LIFECYCLE_MANAGER` `:43`;
  `SDK_SESSION_END_CALLBACK_REGISTRY` `:57-59`; `MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER`
  `memory-contracts/src/lib/tokens.ts:9`; `SETTINGS_TOKENS.MODEL_SETTINGS`
  `settings-core/src/di/tokens.ts:18`.
- Dependencies (constructor-injected, all downward): `TOKENS.AGENT_ADAPTER`
  (optional), `CHILD_CHAT_SESSION_HOST` (optional; absent ->
  `chat-runtime-unavailable`), `SessionChildRegistry`,
  `ChildWorktreeProvisioner`, `LaneCompletionNotifier`,
  `TOKENS.AGENT_PROCESS_MANAGER`, `AgentSpawnEnvironment`,
  `SDK_UNATTENDED_SESSION_POLICY_REGISTRY`, `SDK_ADAPTER_EVENTS`,
  `SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY`, `SDK_SESSION_END_CALLBACK_REGISTRY`,
  `SDK_PERMISSION_HANDLER`, `SDK_SESSION_LIFECYCLE_MANAGER`,
  `SDK_SESSION_TURN_STATE_REGISTRY`, `TRANSCRIPT_READER`,
  `PLATFORM_TOKENS.MCP_SERVER_STATUS` (optional),
  `PLATFORM_TOKENS.MCP_SUBAGENT_ROOT_REGISTRAR` (optional),
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `PLATFORM_TOKENS.OUTPUT_CHANNEL`.
- Failure behaviour: "Failure and rollback" table.
- Quality requirements: timers — one runtime timer per live child (<= cap) and
  at most one grace timer per ended CHILD id; all cleared on
  end and in `dispose()`. Four host-wide listeners, none per child. Ended
  records bounded at 20.
- Verification seam: spawner spec with a fake `IAgentAdapter` (pattern
  `agent-sdk/src/lib/peer-sessions/peer-session-messenger.service.spec.ts:47-57`),
  fake host port, fake provisioner, real event registries driven by hand; covers
  guard order, rollback on host failure, settle rules (background tasks,
  running lanes, failed turn, dedupe), send modes incl.
  `SessionAdmissionRefusedError`, stop, parent-inactive hold (latest completion held, replaced by a newer one, returned once by the next parent call; reports refused and counted; parent resumed under a new tab id still owns its children), child grace (re-register cancels, absence
  acts), runtime timeout, SDK id binding by resolved callback and by cwd,
  dispose; contract snapshot; settings clamp table.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-contract.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-settings.ts` (+ `.spec.ts`)
  - CREATE `libs/backend/cli-agent-runtime/src/lib/session-children/index.ts`
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/di/register.ts` (provisioner + spawner)

### 7. MCP surface and `ptah_agent_report` fallback (vscode-lm-tools)

- Purpose: expose the port to parent sessions over the HTTP MCP server.
- Responsibilities:
  - One Zod schema per tool shared by definition and handler (pattern
    `agent-spawn-args.schema.ts:15` + parity spec):

    | Tool | Input schema | Notes |
    | --- | --- | --- |
    | `ptah_session_start` | `{ task: string (1..MAX_AGENT_MESSAGE_LENGTH), branch: string (1..200), baseRef?: string (1..200), label?: string (1..60), taskId?: string (/^TASK_\d{4}_\d{3}(_[0-9a-f]{4})?$/), taskFolder?: string (relative, no ".."), deliverables?: string[] (<= 20, each 1..500), model?: string }`; required `task`, `branch` | No permission, path or parent argument. Description: the child opens as a tab in the user's window, runs unattended (auto-edit + Bash allowlist), steer it with `ptah_session_send`, it reports with `ptah_agent_report`, a completion turn is pushed per settled turn, `/orchestrate ...` passes through, the user owns merge/PR/cleanup |
    | `ptah_session_send` | `{ sessionId: string, message: string (1..MAX_AGENT_MESSAGE_LENGTH), mode?: 'queue' \| 'steer' \| 'if-idle' }` (default `queue`) | Primary control channel. Result states the effect or the refusal verbatim |
    | `ptah_session_status` | `{ sessionId?: string }` | Omit -> all children of the caller. `readOnlyHint` |
    | `ptah_session_read` | `{ sessionId: string, tailKiB?: integer 1..256 (default 32) }` | Transcript tail. `readOnlyHint` |
    | `ptah_session_stop` | `{ sessionId: string }` | States that the tab, the transcript, the worktree and the branch remain |

  - Definitions in `mcp-core/session-tools.ts`, handlers + formatting in
    `mcp-core/session-tool-handlers.ts` (surface-tools precedent); the
    dispatcher lists them in the `agent` group (`protocol-dispatcher.ts:433-443`)
    and adds five delegating `case` lines.
  - `PtahAPI.session: SessionNamespace` built by
    `namespace-builders/session-namespace.builder.ts` from the optional spawner
    (absent -> NAMED error, rule `ptah-api-builder.service.ts:706-719`); after a
    successful start fires the existing worktree change handler
    (`ptah-api-builder.service.ts:999`).
  - The caller id is `getCallerSessionId()`, never an argument.
  - Every `ptah_session_*` result appends `spawner.takeHeldCompletions(caller)`
    as a "Held while this session was not live" block of
    `<agent-lane-completed>` envelopes (empty -> nothing appended).
  - `ptah_agent_report` (`protocol-dispatcher.ts:1179-1218`): no agent id but a
    session id -> `agent.report({ childSessionId, message, summary })`; neither
    -> today's `unattributed-caller`. `AgentNamespace.report` input widens
    (`types.ts:329-339`, `agent-namespace.builder.ts:334-347`).
  - `TOOL_CONTENT_HINTS`: the five tools as `'preformatted'`.
- Failure behaviour: Zod failure -> `isError` naming the issues; port refusals
  -> plain text results with code and detail; `session-start-failed` /
  `worktree-failed` -> `isError` with the rollback table.
- Quality requirements: tool list stays byte-identical per caller.
- Verification seam: schema/definition parity spec; dispatcher spec with a fake
  spawner (caller id from context, not args); report fallback spec (child
  delivered, unlinked session refused, anonymous unchanged); sweep drivers for
  five tools.
- Files:
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts`
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts`
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts`
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts`
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.ts` (+ `.spec.ts`)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (+ spec)
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
  - MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`

### 8. Frontend: tab adoption, origin label, late adoption (chat-types, chat-state, chat)

- Purpose: make an agent-started child a real, visibly-labelled tab.
- Responsibilities:
  - `TabState.agentOrigin?: { parentTabId: string; parentSessionId: string | null; label: string; branch: string; worktreePath: string; taskId?: string; startedAt: number }`
    — PERSISTED (unlike `attachedBinding`), because the origin is a fact of the
    session, not a live flag. `tab-persistence.ts` keeps it through
    save/restore.
  - `TabManagerService.adoptAgentSessionTab(payload, mode: 'live' | 'late')`:
    idempotent (an existing tab with `id === payload.tabId` is left as is);
    adopts ONLY when this panel holds `payload.parentTabId` in any workspace
    partition (prevents duplicate tabs across panels); creates the tab with the
    backend's `tabId`, `name`/`title` = label, `titleOrigin: 'user'` (so
    auto-titling does not overwrite it; `TitleOrigin` members
    `chat-types.ts:463`), `order` = right after the parent tab, `agentOrigin`
    set; does NOT change the active tab. `live`: status `streaming`, one user
    message with `displayPrompt`. `late` (reload / panel opened later): status
    `loaded`, `claudeSessionId = payload.sessionId` (the child's SDK id; when
    still null, adopt as `streaming` like `live`), no messages, relying on the
    sidebar-open history loader (A2). When
    the parent's partition is not the active workspace, the tab is added to
    that partition through a new
    `TabWorkspacePartitionService.addTabToWorkspace(workspacePath, tab)`.
  - `ChatMessageHandler`: add `AGENT_SESSION_OPENED` to `handledMessageTypes`
    and delegate to `adoptAgentSessionTab(payload, 'live')`, with the same
    defensive payload checks the gateway handlers use (`:194-243`).
  - `AgentSessionAdoptionService` (chat, new, `providedIn: 'root'`): on webview
    bootstrap and on workspace switch, calls `chat:agent-sessions` through the
    same RPC client `conversation.service.ts` uses for `chat:running-agents`, and
    adopts every descriptor not present (`late`).
  - Tab bar (`tab-bar.component.ts`): an "agent" badge on tabs with
    `agentOrigin`, `aria-label` "Started by agent session {parent title}",
    tooltip `Started by {parent title} · {branch} · {worktreePath}`; activating
    the badge switches to the parent tab (`switchTab(parentTabId)`); if the
    parent tab is gone, the tooltip says so.
  - Chat view: an `AgentOriginBannerComponent` (molecule, new) above the
    transcript for tabs with `agentOrigin`, `role="note"`: "Started by
    {parent} via ptah_session_start on branch {branch} ({worktreePath}). Runs
    unattended: edits inside the worktree and allowlisted commands run without
    asking; other actions wait {window} for your approval here, then are
    denied. The parent is notified each time this session goes idle. You can
    type here." With an "Open parent" action. The composer stays enabled.
- Verified contracts: `TabState` `chat-types.ts:520-700`; `createTab` /
  `openSessionTab` `tab-manager.service.ts:762-854`; partitions
  `tab-workspace-partition.service.ts:140-453`; persistence
  `tab-persistence.ts:20-184`; handler `chat-message-handler.service.ts:103-243,423-468`;
  `TabId.create()` `tab-manager.service.ts:2751-2753` (UUID; the backend mints
  with `SessionId.create()`, `branded.types.ts:54-56`, same format).
- Dependencies: `scope:webview` libs + `shared` only.
- Failure behaviour: malformed payload -> warn and drop (existing pattern); no
  parent tab in this panel -> no adoption (the child stays in the sidebar and
  in `chat:agent-sessions`); adoption throwing never breaks the handler switch.
- Quality requirements: no focus change; badge and banner keyboard reachable
  and labelled; no per-tab timer or observer added.
- Verification seam: tab-manager specs (adopt live/late, idempotent, parent
  absent -> no-op, background partition, order after parent, focus unchanged,
  persistence round-trip of `agentOrigin`); handler spec; adoption service spec
  with a fake RPC; component specs for badge and banner.
- Files:
  - MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts`
  - MODIFY `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (+ a new `tab-manager.agent-adoption.spec.ts`)
  - MODIFY `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat-state/src/lib/tab-persistence.ts` (+ `tab-manager.persistence.spec.ts`)
  - MODIFY `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (+ spec)
  - CREATE `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts` (+ its template/spec)
  - CREATE `libs/frontend/chat/src/lib/components/molecules/agent-origin-banner/agent-origin-banner.component.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (+ its template)
  - MODIFY the chat app bootstrap that starts app-level services (Assumption:
    the same place `ChatMessageHandler` is registered; frontend-developer
    confirms)

### 9. Host shutdown wiring (apps)

- Purpose: stop timers and listeners, end children deliberately, no push into
  a dying parent.
- Responsibilities: resolve `SESSION_SPAWNER` inside the existing non-fatal
  shutdown pattern and call `dispose()` (sync, idempotent, `CONVENTIONS.md` §9)
  BEFORE `agentProcessManager.disposeAll()`. `dispose()` marks live children
  `stopped` (`host-shutdown`), clears timers, releases policies and MCP roots,
  fires `interruptSession` without awaiting.
- Verified contracts: `apps/ptah-extension-vscode/src/main.ts:143`;
  `apps/ptah-electron/src/activation/shutdown.ts:240,278`.
- Files:
  - MODIFY `apps/ptah-extension-vscode/src/main.ts`
  - MODIFY `apps/ptah-electron/src/activation/shutdown.ts`

### 10. Skill and docs

- Responsibilities: "Agent sessions (ptah_session_*)" section in the
  `agent-lanes` skill (both copies): when to use a child session vs a CLI lane,
  messaging-first control, the envelope with `cli="ptah-session"`, the
  permission policy, cap 3 / depth 1, idle children hold slots, the tab is the
  user's too, user owns merge/PR/cleanup, CLI host unsupported for now. A user
  doc page with the four settings keys.
- Files:
  - MODIFY `.claude/skills/agent-lanes/SKILL.md`
  - MODIFY `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`
  - CREATE `apps/ptah-docs/src/content/docs/agents/agent-sessions.md`

## Integration architecture

### Data flow

**Start** (`ptah_session_start` from parent tab P):

1. Dispatcher validates (Zod), calls `ptahAPI.session.start({ ...args, callerSessionId: getCallerSessionId() })`.
2. Spawner guards, synchronously and in order: host port + adapter present
   (`chat-runtime-unavailable`); caller present, `SessionId.validate(P)` and
   `isSessionActive(P)` (`unattributed-caller`; also refuses a gateway `gw-*`
   caller that could never receive a report); `registry.isChild(P)`
   (`depth-exceeded`); MCP port not null (`mcp-unavailable`);
   `reserveSlot(max)` (`cap-reached`, detail lists P's live children).
3. Root = `scopedWorkspaceRoot()` within the open folders (`no-workspace`);
   `taskFolder` and deliverables resolved inside the future worktree
   (`invalid-arguments` on escape).
4. `ChildWorktreeProvisioner.create(root, branch, baseRef)`.
5. `childTabId = SessionId.create()`; registry record `starting` (parent tab id
   P, parent SDK id from `lifecycle.find(P)?.realSessionId`);
   `policyRegistry.register(childTabId, { bashAllowlist, writableRoot: worktree, denyWindowMs, ownerLabel })`;
   `registrar?.retainRoot(worktree)`.
6. `host.startChildSession({ tabId: childTabId, workspaceRoot: root, worktreePath, prompt: contract + task, descriptor, sessionName: label, model })`:
   the adapter awaits the `agentSession:opened` broadcast (every panel; only
   the panel holding P adopts), then runs `startAgentChildSession` -> the chat
   internals -> `startChatSession` -> `streamEventsToWebview(childTabId, ...)`.
7. Arm the runtime timer; return the snapshot. The namespace fires the
   worktree `created` notification.

**Parent -> child message** (primary control): ownership check (P or its SDK id
must equal the recorded parent), then `queue` / `steer` / `if-idle` per D5, all
with origin `{ kind: 'peer', from: 'ptah-session:{P}', name: 'parent session' }`
so the child tab renders it as a message from the parent, not from the user.

**Child -> parent report**: the child calls `ptah_agent_report` on
`/session/{childTabId}` -> dispatcher -> router `childSessionId` branch ->
`<agent-report cli="ptah-session">` injected into P (TASK_2026_402 path).

**User -> child**: the user types in the child tab -> `chat:continue` ->
`sendMessageToSession` into the live child (unchanged chat path).

**Completion push**: `onTurnEnded(e)`: child = `registry.get(e.sessionId) ?? registry.findByCwd(e.cwd)`;
if `e.backgroundTasks.length > 0` or a running lane names the child -> no push
(status derives `waiting`); else `turn += 1` and
`notifier.signalSessionChild(..., { status: 'completed', lastRecap: e.lastAssistantMessage })`.
`onTurnFailed(e)` -> same with `failed`. Dedupe on `e.timestamp`. Turns started
by the user in the child tab also settle and push (the parent learns the child
changed).

**Stop** (`ptah_session_stop`): ownership check -> mark `stopping` with reason
`stopped-by-parent` -> `await adapter.interruptSession(childTabId)` -> the
broadcaster loop exits and tears the record down by token; the tab stays open
with its transcript; no completion push; worktree and branch retained.

**Parent ends or goes inactive** (user decision, Revision 1): nothing happens
to the children. They keep running, keep their slots and keep their link. The
spawner does not subscribe to the parent's `SessionEnd`. Only the user stops a
child: `ptah_session_stop` from a parent, or the Stop button in the child's own
tab. While the parent is not live (`isSessionActive` false for both its tab id
and its SDK id):
- Reports: the router refuses with `parent-session-not-active` (existing
  reason, `agent-report-router.service.ts:268-272`) and returns it to the child.
  The child learns right away, and the contract tells it to repeat the content
  in its final message. The spawner counts `reportsRefused` and keeps the last
  refused summary for `ptah_session_status`. Reports are not queued: a report is
  a point-in-time message, the child already knows it was not delivered, and
  replaying a burst into a resumed conversation would present stale progress as
  current.
- Completions: not pushed and not dropped. The latest undelivered completion
  per child is held (bounded: one per child, a newer settle replaces an older
  one) and shown in `ptah_session_status` as `heldCompletion`. The next
  `ptah_session_*` call from the parent (the parent is live by definition)
  returns the held completions in a "while you were away" block and marks them
  delivered. The reason for holding: a completion is the state the parent must
  act on; holding the latest one costs bounded memory and needs no parent
  re-attach detection.
- Resumed parent: ownership accepts either the recorded parent tab id or the
  recorded parent SDK id, compared with `lifecycle.find(caller)?.realSessionId`.
  So a parent reopened from the sidebar in a new tab can still steer, read and
  stop its children.

**Child session ends**: `SessionEndCallbackRegistry` fires for the child's id
-> one 30 s grace timer for that child (a slash-command re-query in the child
re-registers the same tab id, `session-lifecycle-manager.ts:593-595`) -> if
still inactive: mark `ended` (reason "ended outside the spawner: stop button,
error or teardown"), push or hold `failed` only if it ended while `working`,
and release the slot, policy and MCP root. A child the user resumes later from
its tab runs as an ordinary interactive session (policy released).

**Runtime cap**: timer -> reason `timed-out`, push `timeout` if working, then
`interruptSession`.

### State or persistence

- `SessionChildRegistry`: in memory, one per host, lifetime = process. Not
  persisted in 584 (D10). After a host restart, child tabs survive in the
  webview (persisted `agentOrigin`) and child sessions resume as ordinary
  sessions in their worktree (metadata `workingDirectory`, TASK_2026_419); the
  parent link for messaging, limits and pushes is gone until TASK_2026_580
  persists it.
- `SessionMetadata`: unchanged shape. Children get `workspaceId = parent root`
  and `workingDirectory = worktree` at creation (D3). No `parentSessionId`
  field is added — 580's `_saveInternal` carry-over finding
  (`session-metadata-store.ts:451-468`) is why that belongs in 580's table.
- Webview: `TabState.agentOrigin` persisted with the tab.
- Worktrees and branches persist; the user removes them.

### External boundaries

- Tool args: Zod at the MCP boundary; git re-validates branch and base ref;
  directory name from `resolveWorktreePath` (hashed, no traversal) + realpath
  containment; `isAuthorizedWorkspace` again on the chat path.
- Git: argument arrays via `execGit`; no shell.
- Identity: from the transport only; attribution, not authentication
  (`mcp-caller.ts:17-19`). The default Bash allowlist has no network client, so
  a child cannot forge `/session/{P}` unless the user widens it (R8).
- Webview payloads: typed payload-map entry; defensive checks in the handler.

### Failure and rollback

| Flow | Failure | Behaviour |
| --- | --- | --- |
| start | caller absent / not a live UUID session | `unattributed-caller`, nothing created |
| start | caller is a child | `depth-exceeded` |
| start | cap reached | `cap-reached`, lists live children to stop |
| start | no MCP server (CLI host) | `mcp-unavailable` |
| start | bad branch / base ref / deliverable path | `invalid-arguments` |
| start | branch exists | `branch-exists` |
| start | `git worktree add` fails / times out | `worktree-failed` with stderr; slot released |
| start | worktree outside the root | rollback -> `worktree-outside-workspace` |
| start | host returns `started: false` or throws | reverse rollback: release MCP root, release policy, remove link, `git worktree remove --force`, `git branch -D`; `session-start-failed` + per-step table. If the tab was announced, the host adapter sends an explicit `CHAT_ERROR` to the child `tabId` before returning, so the adopted tab leaves `streaming` and shows the reason; the tab stays (with banner) so the user sees what failed |
| start | webview absent / broadcast fails | child starts headless (`uiAnnounced: false`); late adoption on the next bootstrap |
| start | registrar fails | child starts; `subagentPtahTools: 'unavailable'` |
| send | not the caller's child / unknown / ended | refusal, nothing sent |
| send `if-idle` | busy | `busy`, nothing queued |
| send `steer` | interrupt false | `interrupt-failed`, nothing sent |
| send `steer` | interrupt timeout retires the record | child session ends -> `ended`, reason recorded (R4) |
| report | parent not live | `parent-session-not-active` returned to the child; `reportsRefused` + last summary in status; not queued |
| report | rate-limited / duplicate / too large | existing router refusals returned to the child |
| completion | parent not live / delivery fails | held as `heldCompletion` (latest per child); returned by the parent's next `ptah_session_*` call and marked delivered; logged |
| permission | outside allowlist / worktree / foreign MCP / network | prompt in the child tab, denied after the window (default 60 s); `awaiting-permission` meanwhile; no webview -> denied at once |
| permission | AskUserQuestion / EnterPlanMode | denied at once with guidance |
| stop | `interruptSession` throws | status `stopped`, error recorded; the broadcaster's finally ends the record by token |
| parent end / inactive | any duration | children keep running and keep their slots; only the user stops them |
| child session end | re-registered within 30 s | nothing happens |
| child session end | still inactive after 30 s | `ended`, slot/policy/MCP root released |
| host shutdown | — | `dispose()`: children `stopped (host-shutdown)`, no push |

### Observability

- `IOutputChannel` `[SessionSpawner]` lines: start guards passed or refusal;
  every rollback step; announce outcome; SDK id binding; every settle with turn,
  verdict and delivery outcome; child permission requests/resolutions; stops
  with reason; child grace armed/fired; reports refused and completions held while the parent is not live.
- `ptah_session_status`: `status`, `pendingPermission`, `lastCompletion`,
  `subagentPtahTools`, `endReason`.
- The child tab itself: the full live transcript for the user.

## Architecture-level quality requirements

- Functional:
  - Three starts from one parent: three worktrees under
    `<root>/.claude-worktrees/`, three adopted tabs next to the parent with the
    agent badge, three sidebar entries under the parent workspace; status lists
    three distinct `worktreePath`s; a fourth start -> `cap-reached`.
  - A start from a child -> `depth-exceeded`.
  - The user can type into a child tab and see the reply stream there.
  - A child's report arrives as one `<agent-report cli="ptah-session">` turn in
    the parent; an unlinked session caller -> `unattributed-caller`.
  - Each settled turn -> exactly one `<agent-lane-completed cli="ptah-session">`;
    a missing declared file -> `no-deliverable`.
  - `if-idle` to a busy child -> `busy`; `queue` reports the observed effect.
  - No child permission prompt waits longer than the configured window.
  - After a webview reload, live child tabs are present (restored or adopted
    late) and still stream.
  - Parent ended or inactive for any time -> children keep running; while it
    is not live, a child's report is refused to the child with a counted
    reason, and the latest completion is held and returned by the parent's
    next `ptah_session_*` call; a parent reopened in a new tab still steers its
    children.
- Performance: at most `maxConcurrent` (default 3, max 5) child subprocesses;
  no new per-child timers beyond one runtime timer; no per-tab observer in the
  webview.
- Security: children never run `yolo`; token-prefix Bash allowlist with
  metacharacters refused; edits outside the worktree never auto-approved; git
  argument arrays; parent identity from the transport only.
- Maintainability: no reverse layer imports; ports owned by the lower lib;
  `Symbol.for` tokens in `di/tokens.ts`; `startSession` behaviour unchanged; no
  SQLite schema (580 owns it).
- Testability: every refusal code and table row tested at its owning
  component; one real-host smoke run for the UI and permission paths.

## Test strategy

Commands: `npx nx test agent-sdk`, `npx nx test platform-core`,
`npx nx test cli-agent-runtime`, `npx nx test rpc-handlers`,
`npx nx test vscode-lm-tools`, `npx nx test shared`, `npx nx test chat-state`,
`npx nx test chat`, `npx nx test ptah-cli` (session_submit regression).

| Scope | Level | Proves |
| --- | --- | --- |
| Policy, matcher, metadata cwd | unit (agent-sdk) | Every policy row; bounded window with UUID ids; undelivered deny; no policy -> unchanged; `workingDirectory` optional arg |
| Registrar | unit (vscode-lm-tools) | Retain, survive reconcile, release |
| Registry, router, notifier | unit (cli-agent-runtime) | Link semantics; child report delivery/refusals; per-turn completion + verdicts; lanes unchanged |
| Provisioner | unit + temp-repo integration | Refusals; add + rollback leave nothing |
| Chat internals + host adapter + RPC | unit (rpc-handlers) | `startSession` unchanged; child start parameters; announce-then-start; failure returned; `chat:agent-sessions` |
| Spawner | unit with fake adapter, fake host, fake provisioner, hand-driven SDK event registries, fake timers | Guard order, rollback, settle rules, send modes, stop, grace, timeout, id binding, dispose |
| MCP surface | unit (vscode-lm-tools) | Caller id from context; five tools; report fallback; sweep drivers |
| Frontend | unit (chat-state, chat) | Adoption live/late/idempotent/parent-absent/background partition/no focus/persistence; handler; adoption service; badge; banner accessibility |

### Real-host smoke procedure (Electron dev build, then VS Code; senior-tester)

Setup: a scratch git repo as the only workspace folder with
`.ptah/specs/TASK_SMOKE_1..3/task.md`; Ptah MCP server running.

- S1 (UI binding, A1): from a parent tab, `ptah_session_start` x3
  (`branch: smoke/one|two|three`, `task: "/orchestrate TASK_SMOKE_n"` or a small
  task, `deliverables: [".ptah/specs/TASK_SMOKE_n/done.md"]`). Expect three
  tabs right after the parent, badge + banner, focus unchanged, live streaming
  in each; three sidebar entries under the root workspace; three worktrees;
  metadata `workingDirectory` = worktree.
- S1b (A2): reload the webview mid-run; child tabs are back and keep streaming.
  Close and reopen the panel (VS Code); late adoption brings them back.
- S2: fourth start -> `cap-reached`.
- S3 (A3): a child runs the orchestration skill, launches a Task subagent, and
  both call a Ptah MCP tool (subagent only when `subagentPtahTools: available`).
- S4: a child calls `ptah_session_start` -> `depth-exceeded`.
- S5: a child's `ptah_agent_report` lands as one parent turn; from an ordinary
  tab, `ptah_agent_report` -> `unattributed-caller`.
- S6 (A5): `if-idle` on a working child -> `busy`; `queue` ->
  `held-until-turn-end`; idle child -> `started-turn`; `ptah_session_read`
  returns the transcript tail.
- S7 (A4): instruct a child to run `curl https://example.com` and to edit a
  file in the parent root: the prompt appears in the CHILD tab with a countdown;
  unanswered -> denied at ~60 s; status shows `awaiting-permission` meanwhile;
  approving within the window works.
- S8: a child settles without its deliverable -> one `no-deliverable` push;
  with it -> `delivered`.
- S9: type into a child tab -> reply streams there; the settle pushes to the
  parent.
- S10: `/compact` in the parent -> children continue. Stop the parent and wait
  several minutes -> children keep running; a child report meanwhile returns
  `parent-session-not-active` to the child; a settle meanwhile shows as
  `heldCompletion` in status. Resume the parent (also from the sidebar in a new
  tab), call `ptah_session_status` -> the held completion is returned once and
  the parent can send/stop. Quit with a live child -> clean shutdown, no push
  logged after shutdown.
- S11: run the full unit suites listed above.

## Risks and disagreements

- R1 (ACCEPTED by the user, Revision 1): literal `auto-edit` prompts
  for every MCP tool (`sdk-permission-handler.ts:587-592`), which would block a
  child's own `ptah_agent_report`. The plan auto-allows `mcp__ptah__*` for
  children. Narrower alternative: allow only `mcp__ptah__ptah_agent_report`,
  which would cripple child orchestration.
- R2 (narrows auto-edit, by design): edits outside the worktree are not
  auto-approved; AskUserQuestion and EnterPlanMode are denied at once; global
  "Always Allow" rules are ignored for children.
- R3 (user decision, Revision 1): children outlive their parent. Risk: a
  forgotten parent leaves up to `maxConcurrent` children running (and holding
  slots) until the user stops them or the runtime cap (default 120 min) fires;
  the runtime cap is the only automatic bound. Reports sent while the parent is
  not live are refused to the child, not lost silently.
- R4: `steer` uses `interruptCurrentTurn`; a 3 s interrupt timeout retires the
  child's record and ends it. `queue` is the default and the tool text says so.
- R5 (ACCEPTED by the user, Revision 1): an adopted child tab does NOT take focus,
  unlike `createTab` (`tab-manager.service.ts:843`). Three children stealing
  focus mid-conversation is worse; flip in one line if the user wants focus.
- R6: a child is adopted only by the panel holding its parent tab. A parent in a
  closed panel or a non-tab parent leaves the child reachable from the sidebar
  and via late adoption only; opening it from the sidebar creates a NEW tab id,
  which will not receive the live stream (existing behaviour for sessions
  streaming under another tab id).
- R7: user-typed turns in a child also produce parent pushes; the parent may
  receive turns it did not cause. Honest, but noisy if the user chats a lot.
- R8: attribution is not authentication; widening the Bash allowlist to a
  network client lets a child impersonate its parent on the MCP URL.
- R9: up to five extra Claude subprocesses in the host; no per-child cost
  budget (research Gap 7); idle children hold slots until stopped.
- R10: after a host restart the parent link is gone (tabs and sessions remain);
  TASK_2026_580 is the durable fix.
- R11: a child waiting on its own lanes whose completion push was refused stays
  `waiting` until the runtime cap.
- R12: a held completion reaches the parent only when the parent next calls a
  `ptah_session_*` tool; a resumed parent that never calls one does not see it.
  The `ptah_session_start` description and the agent-lanes skill tell the
  parent to call `ptah_session_status` after a resume.
- Research proposed a `permission` argument on `ptah_session_start`; dropped
  (ACCEPTED by the user, Revision 1): a model-chosen `yolo` would override the
  user's decision.
- No disagreement with Approach A, the UI-bound change, messaging-first control,
  cap 3, depth 1, or user ownership of merge/PR/cleanup (the failed-start
  rollback removes only the worktree and branch the same failed call created).

## Coordination with related tasks

- TASK_2026_580 (session organization, backlog) — recommendation: keep 584's
  `SessionChildRegistry` in memory and let 580 absorb the durable part; do not
  build 580's table or a `parent_session_id` column in 584. Reasons:
  1. 580's schema is undecided in detail and unbuilt (`session_organization`
     keyed by `(workspace_root, session_id)`, priority/status/pin/PR columns,
     SQLite-absent degradation). A 584 slice would fix column names, keys and
     migration numbering for 580 — the conflicting schema we must not create.
  2. Most of 584's link state is run state that 580 explicitly does not store
     (580 Decision 3): slot reservations, pending permission, turn counters,
     grace timers, live status.
  3. The durable key must be the child's SDK session id, known only after the
     SDK `init`; 580's capture hooks (Phase B.5 "child creation sets
     `parent_session_id`", Phase B.2 worktree/branch capture) are designed for
     exactly that moment.
  4. Children must work where SQLite is absent; 580 degrades there by design.
  Field mapping for 580 (no code in 584): `parentSdkSessionId` ->
  `parent_session_id` (store the SDK id, not the tab id), `worktreePath` ->
  `worktree_path`, `branch` -> `branch`, `taskId` -> `session_task_links(role
  'primary', source 'agent')`. When 580 lands, its store is called from the
  spawner's `SessionIdResolved` handler (one call site) and `listUiDescriptors`
  can read parent links for restart recovery. 584 adds no `SessionMetadata`
  field, so 580's `_saveInternal` carry-over problem is not widened.
- TASK_2026_358 (fleet runner, backlog): no SQLite in 584; `ISessionSpawner` is
  a candidate stage dispatcher for 358; 358 would read 580's durable links for
  resume rather than a 584 store.
- TASK_2026_386 (worktree per task, backlog): 584 writes no task frontmatter
  and adds no merge/PR action; it uses the same `resolveWorktreePath` and fires
  the same `git:worktreeChanged` notification, so 386's UI lists child
  worktrees. Suggested branch convention for parents: `task/<TASK_ID>`.
- TASK_2026_402 (done) — reused: `AgentReportRouter` (size cap, burst limit,
  dedupe, `peer` origin, envelope), `/session/{id}` identity, the "never claim a
  delivery you did not make" rule. Not used: `PeerSessionMessenger` (it composes
  through the sending model for cross-process peers; children are in-process, so
  direct injection is correct, as the messenger's own header states).
- TASK_2026_419 (done) — relied upon: `workingDirectory` in metadata and the
  resume restore (`chat-session.service.ts:804-810`); D3 makes it correct from
  the first write.
- TASK_2026_128 `session_submit` (CLI): unchanged. Later convergence: once the
  CLI host serves Ptah MCP to sessions, `SessionSubmitService` can call
  `ISessionSpawner.start` (no-worktree mode) and await the first settled turn
  instead of driving `chat:start` over its in-process transport; not built now.

## Team-leader handoff

- Recommended executors: backend-developer for components 1-7 and 9;
  frontend-developer for component 8; technical-content-writer for component
  10; senior-tester for the smoke run and `test-report.md`.
- Complexity: HIGH — six backend libraries, three frontend libraries, two apps,
  a permission-path change, a change to the chat start internals, and a
  real-host acceptance run with six open assumptions.
- Dependencies and ordering (component level): 1, 2 and 3 are independent; 5
  needs 3 (port types); 4 and 6 need 1, 2, 3 and 5; 7 needs 6; 8 needs 5's
  shared contracts only; 9 needs 6; 10 needs 7; the smoke run needs 7 and 8.
- Suggested batches (the team-leader owns the final split):

  | Batch | Content | Executor | Depends on |
  | --- | --- | --- | --- |
  | B1 | Component 1 (agent-sdk policy + metadata cwd) | backend-developer | — |
  | B2 | Component 2 (registrar port + HttpMcpServer retained roots) | backend-developer | — |
  | B3 | Component 3 (ports, registry, router + notifier widening) | backend-developer | — |
  | B4 | Component 5 (shared contracts, chat internals extraction, host adapter, `chat:agent-sessions`) | backend-developer | B3 |
  | B5 | Components 4 + 6 (provisioner, spawner, contract, settings, registration) | backend-developer | B1, B2, B3, B4 |
  | B6 | Components 7 + 9 (MCP surface, report fallback, shutdown hooks) | backend-developer | B5 |
  | B7 | Component 8 (frontend adoption, badge, banner, late adoption) | frontend-developer | B4 |
  | B8 | Component 10 (skills + docs) | technical-content-writer | B6 |
  | B9 | Smoke S1-S11 + `test-report.md` | senior-tester | B6, B7 |

- Parallel-safe work: B1, B2, B3 are file-disjoint. B7 runs in parallel with
  B5/B6 (frontend libs vs backend libs; B4's shared files are done first). B8
  and B9 run in parallel. B3 and B5 both touch
  `cli-agent-runtime/src/lib/di/register.ts` and are sequential.
- Files affected:
  - CREATE:
    - `libs/backend/agent-sdk/src/lib/permission/unattended-session-policy.registry.ts` (+ spec)
    - `libs/backend/agent-sdk/src/lib/permission/unattended-bash-policy.ts` (+ spec)
    - `libs/backend/agent-sdk/src/lib/sdk-permission-handler.unattended.spec.ts`
    - `libs/backend/platform-core/src/interfaces/mcp-subagent-root-registrar.interface.ts`
    - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts`
    - `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts`
    - `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/session-children/child-worktree.provisioner.ts` (+ spec, integration spec)
    - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-contract.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-settings.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/session-children/index.ts`
    - `libs/shared/src/lib/types/messages/agent-session.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.ts` (+ spec)
    - `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` (+ spec)
    - `libs/frontend/chat/src/lib/components/molecules/agent-origin-banner/agent-origin-banner.component.ts` (+ spec)
    - `libs/frontend/chat-state/src/lib/tab-manager.agent-adoption.spec.ts`
    - `apps/ptah-docs/src/content/docs/agents/agent-sessions.md`
  - MODIFY:
    - `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
    - `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
    - `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (+ spec)
    - `libs/backend/agent-sdk/src/lib/di/tokens.ts`
    - `libs/backend/agent-sdk/src/lib/di/register.ts`
    - `libs/backend/agent-sdk/src/index.ts`
    - `libs/backend/platform-core/src/di/tokens.ts`
    - `libs/backend/platform-core/src/index.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/di/register.ts`
    - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` (+ spec)
    - `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts`
    - `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`
    - `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
    - `libs/backend/cli-agent-runtime/src/index.ts`
    - `libs/shared/src/lib/types/messages/message-constants.ts`
    - `libs/shared/src/lib/types/messages/payload-map.ts`
    - `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
    - `libs/shared/src/lib/types/rpc.types.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ spec)
    - `libs/backend/rpc-handlers/src/lib/chat/di.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (+ spec)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`
    - `libs/frontend/chat-types/src/lib/chat-types.ts`
    - `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
    - `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` (+ spec)
    - `libs/frontend/chat-state/src/lib/tab-persistence.ts`
    - `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (+ spec)
    - `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts` (+ template/spec)
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (+ template)
    - `apps/ptah-extension-vscode/src/main.ts`
    - `apps/ptah-electron/src/activation/shutdown.ts`
    - `.claude/skills/agent-lanes/SKILL.md`
    - `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`
    - host RPC allowlists, if they enumerate chat methods (A6)
  - REWRITE: none.
- Verification points:
  - Confirm before coding: A2 (frontend history-load trigger), A6 (RPC
    allowlists), `http-mcp-server.service.spec.ts` presence, the fake-adapter
    pattern (`peer-session-messenger.service.spec.ts:47-57`).
  - Contracts to honour: `startSession` behaviour and the `chat:start` RPC
    contract unchanged; `AgentReportRouter` refusal union unchanged;
    `LaneCompletionSignal` in `shared` unchanged; `SessionMetadata` shape
    unchanged; tool list byte-identical per caller; `Symbol.for` tokens with
    identifier == key; `dispose()` sync + idempotent; new backend services log
    via `IOutputChannel`.
  - Data changes: none (no migration, no persisted backend schema; one
    persisted webview field `TabState.agentOrigin`).
  - Commands that must pass: the test targets above; `npx nx lint` for every
    touched project (module-boundary rule); typecheck/build of
    `ptah-extension-vscode`, `ptah-electron` and the webview app;
    `ptah_get_diagnostics` on every changed file.

## Revision 1

Response to `.ptah/specs/TASK_2026_584_5e7a/implementation-plan-review.md`
(verdict REVISE). No decision or disagreement changed.

1. MAJOR, metadata `workspaceId`. Verified that `startChatSession` passes
   `resolvedProjectPath` as `createSessionIdCallback`'s first argument, which
   becomes the metadata `workspaceId` (`sdk-agent-adapter.ts:768-775`).
   Component 1 now gives the exact change: a `workingDirectory` parameter on
   `createSessionIdCallback`, `workspaceId = config.workspaceId ?? resolvedProjectPath`,
   `workingDirectory = resolvedProjectPath`, forwarded to
   `SessionMetadataStore.create(..., workingDirectory)`. It also names the
   resume and slash-command paths to check, and adds three tests. One of them
   proves `getForWorkspace('/root')`, the source of `session:list`, lists the
   child under the parent workspace. D3 is updated to match. Batch B1 already
   owns `sdk-agent-adapter.ts` and `session-metadata-store.ts`.
2. MAJOR, start error in an adopted tab. The assumption that the error arrives
   "by the normal chat:error path" is removed. `ChildChatSessionHostAdapter`
   now sends an explicit `CHAT_ERROR` to the child `tabId` when `uiAnnounced`
   is true and the start fails or throws. The failure table (start / host
   failure row) and the adapter spec in B4 cover both the failure and the
   throw, and check that no error is sent when the tab was not announced.
3. MINOR, deliverable timing. Component 3 now states the reference time: the
   child's `startedAt`, stamped after `git worktree add` returns and fixed for
   the child's life, not reset per turn. Files checked out into the worktree
   are older than that time, so they report `writtenAfterSpawn: false`. For
   session subjects such a file counts as not delivered. The lane verdict is
   unchanged. B3's notifier spec pins both cases and the `>=` boundary.

### User decisions on the four disagreements (binding, relayed 2026-10-01)

4. R1, auto-allow `mcp__ptah__*` for children: ACCEPTED. R1 is marked
   accepted; component 1's policy table is unchanged.
5. R3, parent end: the 30 s grace stop is REJECTED and removed. Children keep
   running when the parent ends or goes inactive; only the user stops them
   (`ptah_session_stop` or the child tab's Stop). Changes:
   - D7 and the Data flow no longer subscribe to the parent's `SessionEnd`.
   - The `parent-ended` status is removed.
   - Ownership accepts the parent's tab id or SDK id, so a parent resumed in a
     new tab still steers its children.
   - While the parent is not live, reports are refused to the child with
     `parent-session-not-active`. They are counted (`reportsRefused`,
     `lastRefusedReport`) and not queued, because replaying them would show
     stale progress as current and the child already knows.
   - While the parent is not live, completions are held: the latest one per
     child, as `heldCompletion`. The parent's next `ptah_session_*` call
     returns them once (`takeHeldCompletions`), because a completion is the
     state the parent must act on.
   - Updated to match: the failure table, the functional requirements, smoke
     step S10, the spawner spec scope, and risks R3 and R12. The child-side
     30 s grace, for slash-command re-queries inside a child, stays.
6. R5, no focus for child tabs: ACCEPTED.
7. No permission argument on `ptah_session_start`: ACCEPTED.
