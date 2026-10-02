# Research Report - TASK_2026_584_5e7a

Checked against origin/main at the worktree `main-latest` (HEAD 722d921ab). All
paths below are relative to that worktree. "Verified" = read the source;
"inferred" = reasoning from what was read, not run.

## Question

- Decision this supports: how (and whether) to let a parent Ptah chat session
  start and supervise several full child chat sessions, one git worktree each.
- Question: can the existing chat-session start path be exposed as MCP tools so
  a parent gets messages, reports and a completion signal from children?
- Bounds: nothing was run. Frontend tab/sidebar behaviour for unknown tabIds was
  not traced. Cost/budget controls were searched for and not found. No web
  research; everything is repository evidence.

## Verdict

FEASIBLE WITH GAPS. The hard parts already exist in the host process: a
session can be started programmatically with any `projectPath` (the gateway
does it with no UI tab), the parent-to-child steering call
(`IAgentAdapter.sendMessageToSession`) and the child-to-parent push
(`AgentReportRouter`, `LaneCompletionNotifier`) are both generic over session
ids, and `/session/<id>` MCP identity plus per-session workspace resolution
are in place. What is missing is a spawn-side port for chat sessions (no
MCP tool calls `startChatSession` today), a child-to-parent link record for
chat sessions (the report/complete routers key on `AgentProcessInfo`, which a
chat session is not), a headless stream consumer, an unattended permission
policy, and a recursion/concurrency/cost budget. None is large individually;
together about one M-to-L task. Note that `session_submit` in the headless CLI
already starts a full chat session in an arbitrary `cwd` over MCP (synchronous
variant) - a partial duplicate that shapes the recommendation.

## Answer

Recommend Approach A: a host-process `ISessionSpawner` port implemented next to
`gateway-chat-bridge` (calls `IAgentAdapter.startChatSession` directly with
`projectPath = worktree`), exposed as `ptah_session_*` MCP tools, reusing the
report and completion routers through a child-link registry. It wins because
every message channel already works on session ids, so the only new pieces are
the start call and the link record; it runs in VS Code, Electron and the CLI
because `agent-sdk` is registered in all three.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| `chat:start` takes `tabId` (required), `workspacePath?`, `ptahCliId?`, `options`, `mcpServersOverride`; no permission, cwd-vs-root or parent param | libs/shared/src/lib/types/rpc/rpc-chat.types.ts:39-104 | undated | read |
| `chat:continue` / `chat:resume` / `chat:abort` exist with sessionId + tabId | rpc-chat.types.ts:117,161,212; libs/shared/src/lib/types/rpc.types.ts:693-705 | undated | read |
| `startSession` resolves `params.workspacePath` else workspace root, then refuses paths outside open folders (`isAuthorizedWorkspace`) or unsafe paths | libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:418-440 | undated | read |
| `isAuthorizedWorkspace` = path is within any open workspace folder (lexical containment), so a worktree UNDER the root passes | libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:12-24 | undated | read |
| Default worktree path is `<root>/<AGENT_WORKTREE_DIR>/<branch>`, i.e. inside the root | libs/backend/vscode-core/src/utils/worktree-path.ts:42-52 | undated | read |
| Session is started with `projectPath` AND `workspaceId` both = workspacePath; adapter takes them separately | chat-session.service.ts:543-560; libs/shared/src/lib/types/ai-provider.types.ts:150-151 | undated | read |
| Registry resolves workspace per session (tabId or real id), "concurrency-safe" | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:451-458 | undated | read |
| Chat session MCP URL is `/session/{tabId}`, parsed to `_callerSessionId`; used as `parentSessionId` for `ptah_agent_spawn` | libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1750-1805; .../mcp-http/http-server.handler.ts:254-294 | undated | read |
| Gateway starts chat sessions with no webview tab (`gw-<id>` tab), its own `permissionLevel`, `projectPath` = pinned root, and pumps the stream itself | libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:405,700-745,760-790 | undated | read |
| `sendMessageToSession(sessionId, content, {origin, admission:'require-idle'})` is on `IAgentAdapter` | libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1232-1248; ai-provider.types.ts:100-109 | undated | read |
| `AgentReportRouter.deliver` needs `/agent/{id}` identity + `AgentProcessInfo.parentSessionId`, then `sendMessageToSession` into parent; rate-limited, dedup'd | libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:221-329 | undated | read |
| `LaneCompletionNotifier` pushes one turn to the parent on terminal status, with a deliverable verdict, via the same adapter | lane-completion-notifier.service.ts:1-45 | undated | read |
| `ptah_agent_spawn` derives `parentSessionId` from the caller session, `workingDirectory` defaults to root | libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:172-316 | undated | read |
| Lane `workingDirectory` must be inside the caller's workspace root (realpath) | libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:350-376 | undated | read |
| Lane cap: setting `ptah.agentOrchestration.maxConcurrentAgents`, default 5, max 20 | agent-spawn-environment.service.ts:32,224-240 | undated | read |
| ptah-cli lane is a real Claude Agent SDK query with `settingSources: user/project/local`, Ptah MCP URL `/agent/{id}/workspace/{cwd}`, capability policy, role block | libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:173-312; ptah-cli-registry.ts (hardcoded settingSources per comment at spawn-options:320-328) | undated | read |
| Lane permission: global autopilot level; yolo -> `bypassPermissions`, else `canUseTool`; routable UUID session = webview prompt, non-routable = 60 s auto-deny | ptah-cli-registry.ts:1262-1335; libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:75-112,607-685 | undated | read |
| Chat RPC reads permission level from config `autopilot.permissionLevel` (global), not per call; adapter accepts per-session `permissionLevel` (gateway uses it) | chat-session.service.ts:727-737; gateway-chat-bridge.ts:700-745 | undated | read |
| `session_submit` MCP tool (stdio only): `chat:start` with `args.cwd`, streams progress, resolves on completion, abort on cancel, 15 min timeout | apps/ptah-cli/src/services/mcp/session-submit.service.ts:1-40,75-100,366,703; libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/session-submit.port.ts | undated | read |
| Session metadata records the exact `workingDirectory` (may differ from workspaceId for worktrees); `createChild` hides a child from the sidebar | libs/backend/agent-sdk/src/lib/session-metadata-store.ts:108-111,1090-1110 | undated | read |
| Process-wide git semaphore (default 4 children, interactive/background lanes, per-workspace round-robin); long worktree calls count as background | libs/backend/vscode-core/src/utils/exec-git.ts:26-33,100-135 | undated | read |

## Building blocks that exist

| Capability | Where | Reusable as-is? |
| --- | --- | --- |
| Start a chat session in arbitrary `projectPath`, no UI tab | `SdkAgentAdapter.startChatSession` (sdk-agent-adapter.ts:665); gateway-chat-bridge.ts:744 | Yes (call directly) |
| Start/continue/resume/abort via RPC | chat-session.service.ts:414,600,780; chat-rpc.handlers.ts | No: requires webview broadcaster + `tabId`; no parent/permission params |
| Headless drive of the same RPC | apps/ptah-cli `ChatBridge`, `session-submit.service.ts` | CLI runtime only, synchronous |
| Parent steers child (queue/steer) | `sendMessageToSession` + `admission:'require-idle'` (sdk-agent-adapter.ts:1232) | Yes |
| Child reports to parent | `AgentReportRouter.deliver` | No: keyed on `AgentProcessInfo` + `/agent/{id}`; needs an adapter for chat children |
| Child completion signal | `LaneCompletionNotifier` (+ `<agent-lane-completed>` envelope) | No: driven by AgentProcessManager terminal status; chat sessions have none |
| Session identity on MCP | `/session/{tabId}` -> `_callerSessionId` | Yes |
| Worktree create/list/remove | git-namespace.builder.ts:97-165 (`worktreeAdd`) | Yes; creates under `<root>/<AGENT_WORKTREE_DIR>` |
| Per-session workspace resolution | SessionRegistry.getSessionWorkspace (session-registry.service.ts:458) | Yes |
| Skills, subagents (Task), Ptah MCP in a session | SDK query options, same builder as interactive chat | Yes (a full chat session has them by construction) |
| Peer message into another session by name | libs/backend/agent-sdk/src/lib/peer-sessions/ (TASK_2026_402) | Partial: composes via the SENDING model, never claims delivery; not a child API |
| Unattended permission surface | gateway permission level + out-of-band notices | Pattern only |
| Concurrency cap, git gate | agent-spawn-environment.service.ts:224; exec-git.ts | Lane cap: No (lanes only). Git gate: Yes |

## Findings per numbered question

1. Start path. The webview calls `chat:start` (tabId required; workspacePath
   optional), `chat:continue`, `chat:resume`, `chat:abort`. cwd: the service
   uses `params.workspacePath`, else the provider's workspace root
   (chat-session.service.ts:418), and passes it as both `projectPath` and
   `workspaceId` (:543). A session CAN run in a worktree cwd different from the
   host root provided the path is inside an open workspace folder (:428, path
   containment) - true for the default worktree location. Keyed by the session's
   workspace: session metadata `workspaceId` (sidebar grouping), enhanced
   prompts, output style, provider profile (`resolveProviderProfileForWorkspace`,
   :546), MCP workspace scoping. Keyed globally instead: permission level
   (`autopilot.permissionLevel`), model settings, MCP server/port. Specs and
   `.ptah` live in the cwd, so a child works on its worktree copy of the specs.
2. Agent MCP tools. Defined in `agent-namespace.builder.ts`; git worktree tools
   in `git-namespace.builder.ts`. A ptah-cli lane is an SDK query with the
   Ptah MCP server, user/project/local settings (so skills and project agents
   load), role block and capability policy - so a lane that spawns subagents
   and calls Ptah MCP tools is close to a headless session (verified for
   options; whether Task subagents behave as in chat was not run). Lacks: a
   persisted, resumable chat session and transcript in the sidebar (children are
   created with `createChild`, hidden), a UI tab, per-tab permission prompts
   (prompts go to the agent monitor or auto-deny), slash commands, the session
   lifecycle (compaction UI, stats owner), `/session/{id}` identity (it uses
   `/agent/{id}`), and `chat:continue` semantics (it has `agent:continue`).
3. Linking and messaging. Parent to child: `sendMessageToSession` works for any
   active session id (parent steer/queue). Child to parent: the routers only
   resolve the parent from `AgentProcessInfo.parentSessionId` via `/agent/{id}`;
   a chat child has no such record, and its MCP calls arrive as `/session/{id}`
   so `ptah_agent_report` would be refused `unattributed-caller`
   (agent-report-router.service.ts:230-235). Reusing the router needs either a
   synthetic `AgentProcessInfo` per chat child, or a small parallel
   `SessionChildRegistry` (childSessionId -> parentSessionId) consulted by the
   report tool. Completion: there is no terminal-status source for a chat
   session, but the stream ends (`chat:complete`/`message_complete`) and
   `session_submit` already detects it; the notifier envelope can be reused with
   the verdict logic (deliverable files on disk).
4. Permissions/safety. No human watches: routable UUID sessions wait forever
   for a webview prompt (sdk-permission-handler.ts:75), so an unattended child
   in `ask` mode blocks silently. Options: per-session `permissionLevel`
   (adapter supports it, RPC does not expose it), which means yolo or
   auto-edit for children - a security decision for the user. Recursion: a
   child has the same Ptah MCP tools, so it could call `ptah_session_start`;
   nothing limits depth today (lane cap is lanes only). Concurrency: no
   session cap found in session-lifecycle; each session is a Claude Code
   subprocess. Cost: no per-session budget found; parent must watch stats.
   Git: `GitProcessGate` caps concurrent git children process-wide (default 4)
   and round-robins per workspace, so parallel worktrees share slots but do not
   deadlock; it serialises nothing semantically (no branch/merge protection).
   I did not find a separate "git write lock" beyond this gate; the prompt
   referenced one, treat as unverified.
5. Runtimes. All three register `agent-sdk` and the MCP server
   (`mcpServerRunning`), so host-side Approach A works in VS Code, Electron and
   CLI. In-process multi-session in different cwds: the registry is keyed by
   tabId with per-record `projectPath`, and the CLI `ChatBridge` test covers
   multi-tabId isolation (apps/ptah-cli/src/cli/session/chat-bridge.spec.ts:359),
   so concurrency is designed for. Caveat: a single `mcpServerRunning`/port
   is shared; workspace scoping relies on per-session lookup. In VS Code only the
   open workspace folders are authorized; a worktree outside the root (user-
   supplied path) would be refused.
6. Prior art in .ptah/specs. No task covers agent-started full chat sessions.
   Related: TASK_2026_402 (peer sessions, report router) - reuse, not overlap;
   TASK_2026_515 (lane completion signal) - reuse; TASK_2026_147 (agent:continue);
   TASK_2026_128 `session_submit` (code present, headless-CLI-only, blocking) -
   partial overlap, extend/share the implementation; TASK_2026_358 (resumable
   fleet runner, SQLite run state; backlog/XL) - overlaps if it also owns
   multi-stage orchestration: coordinate, it is the natural durable state
   holder; TASK_2026_386 (worktree per task in the UI, backlog) - shares the
   task-to-worktree binding; TASK_2026_419 (worktree cwd persisted on resume) -
   needed so resumed children stay in their worktree; TASK_2026_429
   (spawned agents lie about lifecycle) - a lesson: status must be real.

## Gaps

1. No spawn port for chat sessions. New port `ISessionSpawner`
   (start/send/status/stop/list) in `libs/backend/vscode-lm-tools`
   (beside `session-submit.port.ts`), implemented in `agent-sdk` or a new
   lib modelled on `gateway-chat-bridge.ts:744`; wire into
   `ptah-api-builder.service.ts` and `agent-namespace.builder.ts`. M.
2. No MCP surface: add `ptah_session_start/send/status/read/stop` in
   `mcp-stdio/tool-builders.ts` (+ HTTP namespace builder and tool-description
   builder). Note tool names must not collide with `session_submit`. M.
3. Child-to-parent link: nothing maps a chat child to its parent. Add
   `SessionChildRegistry` (child -> parent, worktree, label, state), populated
   at start from the caller's `_callerSessionId`
   (`http-server.handler.ts:254-294`, `agent-namespace.builder.ts:172`). Extend
   `ptah_agent_report` to fall back to it when `/agent/{id}` is absent
   (`agent-report-router.service.ts:230`). M.
4. Completion signal for chat children: drain the stream headlessly (pattern:
   gateway `pumpStream`), detect end/error, and push a
   `<agent-lane-completed>`-style turn via `LaneCompletionNotifier` logic
   (`lane-completion-notifier.service.ts`). The notifier is typed on
   `AgentProcessInfo`; needs a generalised input. M.
5. Stream consumer with no UI: `streamEventsToWebview(tabId, ...)` sends to
   webview keyed by tabId (chat-session.service.ts:566). Headless children need
   their own consumer and a rule for whether the UI shows them. Unknown whether
   the frontend auto-creates a tab for an unknown tabId. S-M.
6. Unattended permission policy: per-child `permissionLevel` parameter (RPC has
   none: chat-session.service.ts:727; adapter has it), default-deny semantics or
   bounded auto-deny instead of indefinite wait
   (`sdk-permission-handler.ts:75,607`). M, needs a user decision.
7. Limits: max concurrent sessions, max depth (propagate `depth` via link
   registry; refuse in spawner), optional per-child cost/time budget. There is
   no enforcement today. M.
8. Worktree binding: `worktreeAdd` only runs in caller root and returns a path;
   spawner should do add-then-start atomically with rollback, validate the path
   via `isAuthorizedWorkspace`, and persist `workingDirectory` (TASK_419) so
   resume stays in the worktree. S-M.
9. Lifecycle of the parent: a parent ending or being aborted should abort or
   orphan children (`endSession` semantics); restart recovery of the link
   registry (in-memory vs SQLite; TASK_358 territory). M.
10. Runtime packaging: the port must be registered in the VS Code, Electron and
    CLI DI containers; CLI `session_submit` should converge on it. S.

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| A: new `ptah_session_*` MCP tools over an in-host `ISessionSpawner` using `startChatSession` directly (gateway pattern) | Uses the same code as chat; `sendMessageToSession`, routers, `/session/{id}` identity already exist; works in all hosts | M-L: gaps 1-10, about 10 files | Shared-process blast radius: many Claude subprocesses in the host; unattended permission deadlock (gap 6) |
| B: extend the ptah-cli lane (`ptah_agent_spawn ptahCliId`) into a "full session" lane | Reports, completion, status, stop, concurrency cap and scope validation come free; lane console UI exists | M: add chat-session parity (slash commands, resume semantics, sidebar visibility, `chat:continue`) to lanes | Two session kinds drift; lane stays second-class (no tab, separate identity, `AgentProcessInfo` semantics); TASK_429-style lifecycle bugs |
| C: spawn a `apps/ptah-cli` process per worktree (session_submit / `ptah session start --task`) | Hard isolation, cwd unrestricted by the host's folder allowlist; existing CLI tool | M: parent needs process management + result transport; port `session_submit` to HTTP surface | No live messaging into child beyond what the CLI exposes; each process has its own MCP/port/auth/DB; heavy; no UI tab; different runtime than the parent |

Not examined: building on Claude Agent SDK native subagents only (no worktrees),
and the pi-ai loop (TASK_2026_362).

## Recommendation

Approach A, delivered as an MVP that reuses B's report/completion routers
instead of forking them. Keep `session_submit` working and make it a thin
client of the same spawner later. The architect owns the final call.

## Proposed MVP scope

In: `ptah_session_start({task, branch, baseRef?, permission, role?})` (creates
worktree under the root, starts a full session there with the orchestration
prompt, records parent link), `ptah_session_send({sessionId, message,
mode: steer|queue})`, `ptah_session_status/read`, `ptah_session_stop`;
child-to-parent reporting via `ptah_agent_report` fallback; one completion push
(`<agent-lane-completed>`-style envelope, verdict from deliverable files);
hard limits (default 3 concurrent, depth 1, wall-clock timeout). Host: VS Code
and Electron first; CLI via the same port after.
Out: UI tab rendering for children, cross-restart recovery, cost budgets,
auto-merge/PR, child-spawned grandchildren.

Acceptance criteria:
1. A parent calls `ptah_session_start` three times; three worktrees exist under
   `<root>/<AGENT_WORKTREE_DIR>`, and `ptah_session_status` shows 3 sessions with
   distinct `workingDirectory` (session metadata).
2. Each child runs the orchestration skill and can launch a subagent and call a
   Ptah MCP tool in its worktree (check via transcript).
3. A child's `ptah_agent_report` arrives as one turn in the parent; a report
   from an unlinked caller is refused with a reason.
4. On child completion the parent gets exactly one completion turn, with
   `no-deliverable` when the declared file is missing.
5. `ptah_session_send` to an idle child starts a turn; to a busy child it is
   refused or queued per the declared mode (never claimed as delivered when not).
6. A 4th start beyond the cap and any child-initiated start are refused with
   a stated reason; stopping the parent aborts children.
7. Unattended child cannot hang forever on a permission prompt (bounded, visible
   in `status` as `awaiting-permission` or denied).
8. No regression in `session_submit` and lane tests; unit tests with fake
   `IAgentAdapter` for link registry, limits, completion envelope.

## Disagreements

- "Lane is already a headless session": the lane options (settingSources,
  Ptah MCP) say yes; the lifecycle code (`AgentProcessManager` records,
  `/agent/{id}` identity, hidden `createChild` metadata, `agent:continue`)
  says no. Decided here by identity and resumability: a lane is not a chat
  session, so B needs parity work that A avoids.
- Gateway precedent vs RPC path: context.md frames this as "expose chat RPC";
  the RPC service is coupled to the webview broadcaster and `tabId`, while the
  gateway shows the adapter call is the reusable seam. Recommend calling the
  adapter, not the RPC.

## Local consequences

- libs/backend/vscode-lm-tools: new port and tools; `session_submit` should
  share the spawner later.
- libs/backend/cli-agent-runtime: `AgentReportRouter` and
  `LaneCompletionNotifier` inputs widened beyond `AgentProcessInfo`.
- libs/backend/agent-sdk (or a new lib beside `gateway-chat-bridge`): spawner
  implementation, link registry, per-session permission level.
- libs/backend/rpc-handlers: `ChatSessionService` unchanged for MVP; optional
  later `permissionLevel` param.
- libs/backend/agent-sdk sdk-permission-handler: bounded policy for headless.
- Skills/docs: update `agent-lanes`/orchestration guidance and the
  "max 3 concurrent" stale text already flagged at
  agent-spawn-environment.service.ts:219.

## Unknowns

- Does the frontend render or choke on chat events for a tabId it never
  created? Smallest experiment: start a session with a synthetic tabId in
  Electron and watch the webview.
- Real per-session resource cost (Claude Code subprocess RSS) at 3-5 children.
  Experiment: start N gateway-style sessions and measure.
- Whether Task subagents and skills behave identically in a host-started
  session with no webview (inferred yes; never run).
- Permission policy for children (yolo vs auto-edit vs bounded deny) is a user
  decision, not a fact.
- Whether `ptah_git_worktree_add` should be folded into start, and branch
  naming/cleanup ownership.
- Interaction with TASK_2026_358 (run-state persistence) and TASK_2026_386
  (task-to-worktree binding) - not read in depth.

## Open questions for the user

1. Child permission mode: auto-edit, yolo, or ask-with-bounded-deny? (Affects
   safety; recommended: auto-edit plus deny on Bash outside an allowlist.)
2. Must children be visible as tabs in the UI for MVP, or is a read-only
   status/transcript view via `ptah_session_read` enough?
3. Should children be allowed to start grandchildren (depth > 1)?
4. Default caps: concurrent children (proposed 3) and wall-clock timeout?
5. Who merges: does the parent or the user own merge/PR/worktree cleanup?
6. Is host-process isolation acceptable, or do you require process isolation
   (Approach C) for crash containment?
7. Should this absorb or coordinate with TASK_2026_358 (fleet runner) and
   TASK_2026_386 (worktree per task)?
