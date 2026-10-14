# Implementation Plan - TASK_2026_655 (session handoff skill + `ptah_session_handoff`)

## Inputs and constraints

- Requirements used: the launch prompt (user decision is final): "Wrap up & hand off" sends a
  skill; the skill wraps up, writes `HANDOFF.md`, calls a new MCP tool that opens a NEW normal
  top-level session (new tab, same workspace/cwd/branch, no worktree, no parent link) with the
  continuation prompt as its first message, then asks the user to close the old one. Fallback:
  print the prompt in one fenced code block.
- History honoured: PR #714 (`5a42273c0`) replaced the automatic handover coordinator with one
  wrap-up message. This plan adds no coordinator, no watcher, no automatic trigger, no state
  machine: one skill, one tool, one host call, one webview tab adoption.
- `.ptah/specs/TASK_SESSION_HANDOFF/` was not needed: the child-session host path
  (TASK_2026_584) already opens a tab in the user's window and sends its first message.
- Missing decision-critical input: none. No `context.md` / `task-description.md` exist in this
  folder; the launch prompt carries every decision.
- Repository rules applied (CLAUDE.md): verify only changed projects, `--parallel=1`,
  `--maxWorkers=2`; no build/serve/e2e/package targets.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Banner sends `SESSION_WRAP_UP_PROMPT` via `ChatStore.sendOrQueueMessage`; one-send guard `wrapUpSessions`; thrown error -> `actionBanner.showError` | libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:39-55,150-179 | Keep guard and error path; only what is sent changes. Today's prompt stays as the fallback |
| Slash commands must be UN-namespaced (`/orchestrate`, not `/ptah-core:orchestrate`) | libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:7-16 | Send `/session-handoff` |
| Skills under workspace `.claude/skills/<dir>/SKILL.md` are discovered as slash commands (`source: 'skill'`, name = frontmatter `name` or dir) | libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:546-587 | A SKILL.md alone is invocable as `/session-handoff`; no `commands/*.md` file needed |
| Precedent: suggestions type `/tribunal`, `/agent-lanes`, `/humanize-library` (skills) directly | libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts:233,266,284 | Same invocation mechanism |
| Interceptor: any non-`clear` slash command is `new-query`, sent to the SDK as a user message on the existing session | libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:8-11,37,77; libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:80-139 | `/session-handoff <args>` reaches the live session through the normal `chat:continue` path |
| Command search: `autocomplete:commands` filters by `name.includes(query)` | command-discovery.service.ts:291-329; frontend call shape libs/frontend/core/src/lib/services/command-discovery.facade.ts:69-90 | Presence probe for the skill in THIS workspace (what the SDK will resolve) |
| Probe precedent (`plugins:list-skills`, 3 outcomes, failure -> no-op) | libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts:40-42,324-340 | Probe-then-degrade pattern; we probe `autocomplete:commands` instead because it reflects the workspace `.claude/skills` the SDK reads |
| `pickerWorkspaceScope` exported from core; chat lib already uses it | libs/frontend/core/src/lib/services/index.ts:45; libs/frontend/chat/src/lib/services/file-picker.service.ts:5,229 | No new boundary crossing |
| `AVAILABLE_PLUGINS` ptah-core `skillCount: 8` is only a fallback; the disk scan wins | libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:251-259,557 | Update the fallback to the real count (stale today: 10 dirs) |
| Content manifest enumerates every ptah-core file; generator script | content-manifest.json:35-53; package.json:67-68 (`manifest:generate`, `manifest:check`) | Regenerate after adding SKILL.md |
| Repo tracks the reconciled mirror `.claude/skills/agent-lanes/SKILL.md` beside the bundled source | `git ls-files` (both paths) | Add the same mirror for the new skill |
| Skill-scanning guards: vendor names banned in plugin markdown; lane rules only in agent-lanes | libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts:195-220; lane-rule-single-home.spec.ts (scans agent-lanes/orchestration/tribunal) | SKILL.md names no vendor, restates no lane mechanics (no `resume_session_id`) |
| Host port `IChildChatSessionHost.startChildSession(input)` -> `{started, uiAnnounced}` / `{started:false, error}` | libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts:17-46 | REUSED: add one sibling method for a top-level start |
| Port bound in every host by `registerChatServices` under `Symbol.for('ChildChatSessionHost')` | libs/backend/rpc-handlers/src/lib/chat/di.ts:105-111; libs/backend/cli-agent-runtime/src/lib/di/tokens.ts:23; hosts: apps/ptah-electron/src/di/phase-4-handlers.ts:90, apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:68, libs/backend/cli-engine/src/lib/container.ts:940 | One host path for VS Code, Electron, CLI |
| Adapter: announce tab (broadcast) BEFORE starting; failed start after announce -> exactly one `chat:error` to that tab; never throws | libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:51-137 | Same ordering and failure path for the handoff tab |
| `ChatSessionService.startAgentChildSession`: authorises root + cwd, `rejectIfUnsafeWorkspace`, then `launchSdkSession` (`workspaceId`, `projectPath`, `prompt`, `name`, `permissionLevel`, `mcpServerRunning`) | libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:128-162,615-684 | Sibling `startHandoffSession` on the same `launchSdkSession` |
| Spawner guards: host lookup via container at call time, live caller, child depth, MCP port | libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:253-316,1406-1419 | Same guard set/codes for handoff; CLI host is port-less -> `mcp-unavailable` (comment at :204) |
| Caller record: `lifecycle.find(idOrTabId)` -> `SessionRecord { tabId, realSessionId, config: AISessionConfig{projectPath, workspaceId, sessionName}, permissionLevel, currentModel }` | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:538-575; libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:484-486; libs/shared/src/lib/types/ai-provider.types.ts (AISessionConfig) | Caller cwd = `config.projectPath`; root = `config.workspaceId ?? projectPath`; inherit permission level and model |
| Webview adopts child tab only in the panel holding the parent; inserts after it; never steals focus; sets `agentOrigin` | libs/frontend/chat-state/src/lib/tab-manager.service.ts:966-1093 | Handoff needs a sibling adoption: same placement, NO `agentOrigin`, WITH focus (`switchTab`, :1303) |
| Hand-written wire parser (no zod in initial bundle); adoption never throws; canvas tile request | libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:43-87,242-306 | Same parser style; canvas request with `focus: true` |
| Message routing: `MESSAGE_TYPES.AGENT_SESSION_OPENED` + payload map + handler switch | libs/shared/src/lib/types/messages/message-constants.ts:178-186; payload-map.ts:113,402; libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:142,213-237 | New `SESSION_HANDOFF_OPENED` follows the same three registrations |
| Session tool defs generated from strict zod (`inputSchemaOf`), static descriptions | libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:25-76; session-tool-args.schema.ts:1-80 | New tool in the same files |
| Handler `runTool` switch; non-fault refusal => `isError:false`, fault => `isError:true`; held completions appended | mcp-core/session-tool-handlers.ts:184-209,328-441 | New case; same reply conventions |
| Dispatcher: session names routed to `handleSessionToolCall(name,args,ptahAPI.session,logger)`; always-on tools listed beside task tools | mcp-core/protocol-dispatcher.ts:510-518,539-545,2314-2328 | Add case label; list the tool always-on |
| `ptah.session` namespace resolves its backend per call; api builder resolves `SESSION_SPAWNER` lazily | namespace-builders/session-namespace.builder.ts:61-100; ptah-api-builder.service.ts:914-920,1149-1154 | Add `handoff()` + lazy `getHandoff` |
| Result budget map lists every session tool as `preformatted` | mcp-core/tool-result-budget.ts:115-121 | Add entry |
| Contract sweep pins served-tool counts and per-description char budgets | mcp-core/mcp-contract.sweep.spec.ts:917,975-1030,1497-1501,1893-1897,2354 | Update pins deliberately (+1 where served) |
| MCP permission: `mcp__ptah__*` tools are Ptah's own | libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:55-56 | No allowlist change; a user "deny" is the "refused" fallback |

## Architecture decision

- Chosen approach: a bundled skill `session-handoff` drives the agent; a new always-on MCP tool
  `ptah_session_handoff` is served by a small `SessionHandoffService` in `cli-agent-runtime`
  that starts the new session through the EXISTING chat host port (one new method on
  `IChildChatSessionHost`, implemented by the existing `ChildChatSessionHostAdapter` on the
  existing `ChatSessionService.launchSdkSession`). The webview adopts the new tab from a new
  `sessionHandoff:opened` push, placed after the old tab in the same panel and focused. The
  banner probes for the skill and sends `/session-handoff …`, else today's inline prompt.
- Rationale: reuses the only path that already opens a backend-started session as a tab and sends
  its first message (announce-then-start, chat:error on failure) on every host; the new session is
  a plain `launchSdkSession` session (not in `SessionChildRegistry`), so it is top-level, appears in
  the sidebar like any chat, and can call `ptah_session_handoff` itself later.
- Rejected alternatives:
  1. Put `handoff()` on `ISessionSpawner`/`SessionSpawnerService`: that unit owns child lifecycles
     (worktrees, registry, completions, event subscriptions, ~1500 lines); a handoff has none of
     those. A separate ~150-line service with no event subscriptions keeps one responsibility.
     Cost: ~15 lines of duplicated host lookup (two contexts; not a third use yet).
  2. Reuse `agentSession:opened` with a discriminator: its payload means "child of parentTabId"
     (worktree, branch, `agentOrigin` banner, late adoption from `chat:agent-sessions`). Overloading
     it would leak child semantics into a top-level tab. A separate message type is cheaper to read.
  3. Let the webview open the tab and call `chat:start` itself: the MCP tool could not report
     whether the session started, and a host without a webview would silently do nothing.
  4. A `commands/session-handoff.md` command file: unnecessary, skills are slash-invocable
     (evidence above); one file instead of two.
- Ptah-core disabled / skill missing: decided as probe-then-fallback. The banner asks
  `autocomplete:commands` for `session-handoff`; exact name present -> slash command; absent or
  probe failed -> today's `SESSION_WRAP_UP_PROMPT` (which already ends in the fenced-code-block
  prompt). Safe in every state.
- Child sessions calling the tool: REFUSED (`child-session`). A child runs unattended in its own
  worktree under a parent that supervises it; handing it off would orphan work outside that
  supervision. The skill's fallback still prints the prompt.
- Assumptions (implementer checks):
  - A1: when ptah-core is disabled, the harness reconciler removes its skills from the workspace
    `.claude/skills/`. Check: `libs/backend/harness-sync` reconciler removal path. If it does not,
    the probe says "present" and the skill still runs - acceptable, no code change.
  - A2: a message queued by `sendOrQueueMessage` while a turn streams is flushed through
    `chat:continue` (so `routeFollowUpSlashCommand` sees the `/`). Check the ChatStore queue flush
    path; if it bypasses the router, flush still delivers the text as a user message, which the
    SDK also resolves as a slash command - verify once manually in Electron.
  - A3: `SessionRecord.currentModel` is accepted as `options.model` by `launchSdkSession`. Check
    `launchSdkSession` model resolution; if not, omit model (session uses the default).
- Effect on existing code: `IChildChatSessionHost` gains one method (both implementations: the
  adapter and the spawner spec's fake). `ChildChatSessionHostAdapter` generalises its `announce` /
  `reportStartFailure` helpers (message type + text become parameters). `ChatSessionService`
  extracts the two authorisation checks of `startAgentChildSession` into a private helper used by
  both starts. Nothing in the spawner, the child registry or the child tab adoption changes.
  `SESSION_WRAP_UP_PROMPT` remains (fallback). Observed, out of scope: the adapter passes
  `permissionLevel` to `startAgentChildSession`, whose params type lacks it and which hard-codes
  `auto-edit` (chat-session.service.ts:128-140,667) - do not "fix" it in this task.

## Component specifications

### 1. Shared wire contract (`@ptah-extension/shared`)

- Purpose: the push that tells the webview a handoff session's tab should open.
- Responsibilities: `SessionHandoffOpenedPayload` type; `MESSAGE_TYPES.SESSION_HANDOFF_OPENED =
  'sessionHandoff:opened'`; payload-map entry.
- Contract (new):
  `{ tabId: string /* new tab id = stream key */; fromTabId: string /* caller tab id */;
  fromSessionId: string | null /* caller SDK id */; workspaceRoot: string; cwd: string;
  label: string; displayPrompt: string /* first user turn */; startedAt: number }`.
- Dependencies: none. Failure behaviour: n/a (types).
- Verification seam: typecheck of shared + consumers.
- Files: CREATE `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/session-handoff.ts`;
  MODIFY `.../messages/index.ts` (barrel export), `.../messages/message-constants.ts` (constant +
  doc comment beside `AGENT_SESSION_OPENED`), `.../messages/payload-map.ts` (entry).

### 2. Handoff host port + `SessionHandoffService` (`@ptah-extension/cli-agent-runtime`)

- Purpose: validate the caller and start one top-level session through the chat host port.
- Port additions (`child-chat-session-host.port.ts`; update header to say the port carries both
  agent-started session kinds):
  - `HandoffChatSessionStartInput { tabId; workspaceRoot; cwd; prompt; sessionName;
    descriptor: SessionHandoffOpenedPayload; model?; permissionLevel? }`
  - `IChildChatSessionHost.startHandoffSession(input): Promise<ChildChatSessionStartOutcome>`.
- Service port (`session-handoff.port.ts`, type-only):
  - `SessionHandoffRequest { callerSessionId: string | undefined /* transport only */;
    handoffPath: string; prompt: string; label?: string }`
  - `SessionHandoffRefusalCode = 'unattributed-caller' | 'child-session' | 'already-handed-off'
    | 'chat-runtime-unavailable' | 'mcp-unavailable' | 'no-workspace' | 'handoff-file-missing'
    | 'session-start-failed'`
  - `SessionHandoffResult = { ok: true; tabId; label; workspaceRoot; cwd; tabOpened: boolean }
    | { ok: false; refusal: SessionHandoffRefusalCode; detail: string }`
  - `ISessionHandoff { handoff(request): Promise<SessionHandoffResult> }`
- Responsibilities of `SessionHandoffService.handoff`, in order:
  1. Host: `container.resolve(CHILD_CHAT_SESSION_HOST)` at call time (same lookup as
     session-spawner.service.ts:1406-1419) and `TOKENS.AGENT_ADAPTER` present, else
     `chat-runtime-unavailable`.
  2. Caller: `SessionId.safeParse(callerSessionId)` and `lifecycle.find(caller)` record, else
     `unattributed-caller`.
  3. `registry.isChild(caller) || registry.isChild(record.realSessionId)` -> `child-session`.
  4. `mcpStatus?.getPort() == null` -> `mcp-unavailable` (the new session must be able to hand
     off again; also the CLI/TUI refusal).
  5. Paths: `cwd = record.config.projectPath`, `root = record.config.workspaceId ?? cwd`; both
     must pass `isPathWithinRoots(path, workspace.getWorkspaceFolders())`, else `no-workspace`.
  6. `handoffPath`: absolute, `fs.promises.stat` is a regular file, inside the open folders, else
     `handoff-file-missing` (detail names the path). This proves step 2 of the skill happened.
  7. One handoff per caller: a bounded in-memory set (64 most recent caller ids, tab id and SDK id,
     oldest evicted) -> second call `already-handed-off` (detail names the earlier tab id).
     Recorded only after a successful start.
  8. Start: mint `SessionId.create()` as tab id; label = arg, else
     `Continued: <record.config.sessionName ?? 'session'>` truncated to 60; descriptor with
     `fromTabId = record.tabId`, `fromSessionId = record.realSessionId`, `displayPrompt = prompt`,
     `startedAt = Date.now()`; call `host.startHandoffSession({... permissionLevel:
     record.permissionLevel, model: record.currentModel })` inside try/catch (throw == not
     started). `started:false` -> `session-start-failed` with the host's error.
  9. Log one line per outcome to `PLATFORM_TOKENS.OUTPUT_CHANNEL` (prefix
     `[SessionHandoff]`), never the prompt text.
- Dependencies (all existing tokens, verified in the spawner constructor
  session-spawner.service.ts:159-223): `SessionChildRegistry` (class token),
  `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`,
  `PLATFORM_TOKENS.OUTPUT_CHANNEL`, optional `TOKENS.AGENT_ADAPTER`,
  `PLATFORM_TOKENS.DI_CONTAINER`, `PLATFORM_TOKENS.MCP_SERVER_STATUS`. No event subscriptions, so
  no dispose path is needed.
- DI: new token `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF: Symbol.for('SessionHandoff')`
  (tokens.ts); register as singleton in `register.ts` beside `SESSION_SPAWNER`.
- Failure behaviour: never throws; every exit is a closed refusal.
- Quality: no prompt text in logs; no timers; set bounded at 64.
- Verification seam: unit spec with a child container (pattern: session-spawner.service.spec.ts
  :91,170 fake host registered under `CHILD_CHAT_SESSION_HOST`). Cases: each refusal code; happy
  path passes cwd/root/permission/model/descriptor to the host; host throw ->
  `session-start-failed`; second call -> `already-handed-off`; child caller refused; a successful
  handoff session (not in the registry) can itself hand off.
- Files: CREATE `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.port.ts`,
  `.../session-children/session-handoff.service.ts`, `.../session-children/session-handoff.service.spec.ts`;
  MODIFY `.../session-children/child-chat-session-host.port.ts`, `.../session-children/index.ts`
  (export service, port types, input type), `.../lib/di/tokens.ts`, `.../lib/di/register.ts`,
  `.../session-children/session-spawner.service.spec.ts` (fake host gains `startHandoffSession`).

### 3. Chat host implementation (`@ptah-extension/rpc-handlers`)

- Purpose: start the handoff session and announce its tab, using the child path's mechanics.
- `ChildChatSessionHostAdapter.startHandoffSession(input)`: broadcast
  `MESSAGE_TYPES.SESSION_HANDOFF_OPENED` with `input.descriptor` (announce first, as :92-112);
  call `session.startHandoffSession(...)`; on failure after a successful announce send one
  `chat:error` to the new tab with `Handoff session could not start: <reason>`; return
  `{started, uiAnnounced}`. Generalise the private `announce` and `reportStartFailure` to take the
  message type / text instead of duplicating them.
- `ChatSessionService.startHandoffSession(params: HandoffSessionStartParams)` where params =
  `{ tabId; workspaceRoot; cwd; prompt; sessionName; model?; permissionLevel? }`: same checks as
  `startAgentChildSession` (extract `authorizeAgentSessionPaths(root, cwd, label)` covering both
  `isAuthorizedWorkspace` checks + `rejectIfUnsafeWorkspace`), then `launchSdkSession({ logLabel:
  'handoff session', workspaceId: workspaceRoot, projectPath: cwd, prompt, name: sessionName,
  options: model ? {model} : undefined, mcpServerRunning: codeExecutionMcp.getPort() !== null,
  mcpServersOverride: undefined, permissionLevel, surfaceMode: undefined })`. Never throws.
- Dependencies: unchanged injections. Integration: called only by the adapter.
- Failure behaviour: `{ success:false, error }` -> adapter -> `session-start-failed`.
- Verification seam: extend `child-chat-session-host.adapter.spec.ts` (announce-before-start,
  chat:error after announced failure, broadcast failure -> `uiAnnounced:false`, throw ->
  `started:false`) and the chat-session service spec for authorisation refusals and the launch
  args (permission level passed through, not forced to auto-edit).
- Files: MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts`,
  `.../chat/session/child-chat-session-host.adapter.spec.ts`,
  `.../chat/session/chat-session.service.ts`, and its existing spec (locate with
  `ptah_search_files "**/chat-session.service*.spec.ts"`).

### 4. MCP tool `ptah_session_handoff` (`@ptah-extension/vscode-lm-tools`)

- Args schema (`session-tool-args.schema.ts`), strict, no caller/path-of-session keys:
  `SessionHandoffArgsSchema = z.object({ handoffPath: z.string().min(1).max(1000).refine(isAbsolute
  (win or posix), 'must be an absolute path'), prompt: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
  label: z.string().min(1).max(60).optional() }).strict()`.
- Definition (`session-tools.ts`): `SESSION_HANDOFF_TOOL_NAME = 'ptah_session_handoff'`, added to
  `SESSION_TOOL_NAMES`; `buildSessionHandoffTool()` with a static description, roughly: "Hand
  this session off to a NEW top-level chat session in the same workspace and working directory
  (same branch, no worktree). It opens as a new tab in the user's window and receives `prompt` as
  its first message; it is not your child and can hand off again. Write the handoff document
  first: `handoffPath` must be an existing absolute file path, and `prompt` must name it. Call
  once. A child session cannot hand off. Refusals are returned as text with a code." No
  `HELD_NOTE` change needed (held completions are still appended by the shared handler).
  No `readOnlyHint`.
- Handler (`session-tool-handlers.ts`): new `runTool` case -> `session.handoff(parsed.data)`;
  `sessionHandoffReply(result)`: ok -> `Opened a new session "<label>" (tab <tabId>) in <cwd>.
  Tell the user it is open and ask them to close this session. Do no further work here.`, plus
  when `tabOpened` is false: `No Ptah window took the tab; it is listed in the session sidebar.`
  Refusal -> `ptah_session_handoff refused (<code>): <detail>`; `isError: true` only for
  `session-start-failed`. Add the `REQUIRED_KEYS` entry for the invalid-args message.
- Namespace (`session-namespace.builder.ts`): `SessionNamespace.handoff(input: Omit<
  SessionHandoffRequest,'callerSessionId'>)`; deps gain `getHandoff: () => ISessionHandoff |
  undefined`; absent -> throw a named `SESSION_HANDOFF_UNAVAILABLE_MESSAGE` error (same rule as
  :92-95). The caller is `deps.getCallerSessionId()`, never an argument.
- API builder (`ptah-api-builder.service.ts`): `resolveSessionHandoff()` resolving
  `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF` per call (same as :1149-1154); pass to the namespace.
- Dispatcher (`protocol-dispatcher.ts`): list `buildSessionHandoffTool()` ALWAYS-ON beside
  `buildSessionLinkTaskTool()` (:516-518) with a comment: the budget banner's handoff relies on it,
  so the `agent` toggle must not remove it; add `SESSION_HANDOFF_TOOL_NAME` to the
  `handleSessionToolCall` case labels (:2314-2318) and to the doc list at :423-439.
- Budget (`tool-result-budget.ts`): `ptah_session_handoff: 'preformatted'`.
- Failure behaviour: invalid args -> isError with the required keys; namespace throw -> handled by
  `handleSessionToolCall`'s catch (:418-429).
- Verification seam: `session-tools.spec.ts` (schema/inputSchema parity, strictness, absolute
  path refinement), a handler test for each reply branch, `protocol-dispatcher.spec.ts`
  routing, and the deliberate pin updates in `mcp-contract.sweep.spec.ts` (contract row, every
  served-count assertion that includes always-on tools, description char budget measured once).
- Files: MODIFY under `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/`:
  `mcp-core/session-tool-args.schema.ts`, `mcp-core/session-tools.ts`, `mcp-core/session-tools.spec.ts`,
  `mcp-core/session-tool-handlers.ts`, `mcp-core/protocol-dispatcher.ts`,
  `mcp-core/protocol-dispatcher.spec.ts`, `mcp-core/tool-result-budget.ts`,
  `mcp-core/mcp-contract.sweep.spec.ts`, `namespace-builders/session-namespace.builder.ts`
  (+ its spec if present), `ptah-api-builder.service.ts`.

### 5. Webview tab adoption (`@ptah-extension/chat-state`, `@ptah-extension/chat`)

- `TabManagerService.adoptHandoffTab(payload): 'adopted' | 'exists' | 'source-absent' |
  'invalid'`: TabId-parse; idempotent (`locateTabInPanel`); locate the source tab by `fromTabId`,
  else by session id `fromTabId`/`fromSessionId` (generalise the private
  `locateAgentSessionParent` to take `(tabId, sessionId)` and reuse it); insert after the source
  in its partition (`insertTabAfter` / `addTabToWorkspace`, as :983-1002); tab = normal tab:
  `name/title = label`, `titleOrigin: 'user'`, `status: 'streaming'`, first user message
  `displayPrompt` (same `createExecutionChatMessage` shape as :1066-1077), `hasLiveSession: true`,
  NO `agentOrigin`. If the source tab is the active tab, `switchTab(newId)` (focus). `saveTabState`.
- `parseSessionHandoffOpenedPayload(value)`: hand-written validator beside
  `parseAgentSessionOpenedPayload` (agent-session-adoption.service.ts:43-87).
- `AgentSessionAdoptionService.adoptHandoff(payload)`: calls the tab manager; never throws (log
  and continue); on `adopted`, request a canvas tile with `focus: true` (generalise
  `requestCanvasTile(tabId, label, focus)`).
- `ChatMessageHandler`: add `MESSAGE_TYPES.SESSION_HANDOFF_OPENED` to the handled list (:142) and
  a case that parses, warns-and-drops on invalid, else `adoptHandoff`.
- Failure behaviour: invalid payload dropped with a warning; `source-absent` is a no-op (another
  panel owns it; the session is still in the sidebar).
- Quality: no timers or listeners added. Accessibility: focus moves to the new tab only when the
  user was looking at the old one.
- Verification seam: tab-manager spec (placement after source, active switch, no agentOrigin,
  idempotency, source-absent, background partition), adoption-service spec (parser accept/reject,
  canvas request with focus true), message-handler spec (routing, invalid drop).
- Files: MODIFY `D:/projects/ptah-extension/libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  (+ its spec); `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts`,
  `.../agent-session-adoption.service.spec.ts`, `.../chat-message-handler.service.ts`,
  `.../chat-message-handler.service.spec.ts`.

### 6. Banner action (`@ptah-extension/chat`)

- `SessionBudgetActionsService.sendWrapUp()` keeps: tab/session/budget preconditions, the
  one-send guard set BEFORE any await (so the probe cannot be double-clicked), the
  `outcome?.success` re-enable, and the catch -> `showError`.
- New: `SESSION_HANDOFF_COMMAND = '/session-handoff'`; `buildHandoffCommand(budget)` ->
  `/session-handoff This session has used {used} tokens.` (reuse `usedFigure`).
  Private `handoffSkillAvailable(): Promise<boolean>`: `ClaudeRpcService.call(
  'autocomplete:commands', { query: 'session-handoff', maxResults: 10,
  ...pickerWorkspaceScope(vscodeService.config().workspaceRoot) })`; true only when
  `result.success` and some `commands[i].name === 'session-handoff'`; any failure/throw -> false.
  Message = skill available ? `buildHandoffCommand(budget)` : `buildWrapUpPrompt(budget)`.
- Update the class/doc comments (it now sends a slash command when the skill is present).
- Verification seam: spec cases - skill present -> sends `/session-handoff …` once; absent ->
  sends today's prompt; probe rejects -> sends today's prompt; double click during probe -> one
  send; send failure re-enables; thrown send error shows the banner error.
- Files: MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/session-budget-actions.service.ts`,
  `.../session-budget-actions.service.spec.ts`.

### 7. Skill `session-handoff` (bundled content)

- SKILL.md outline:
  - Frontmatter (repo convention: only `name` + quoted `description`):
    `name: session-handoff`;
    `description: 'Wrap up this session and continue in a fresh one: finish the current step,
    write HANDOFF.md, then open a new Ptah session with ptah_session_handoff. Use only when the
    user or the Ptah session-budget banner runs /session-handoff.'`
  - Arguments line: anything after the command (e.g. the usage figure) is context only.
  - Step 1 Wrap up: start no new work; bring the current step to a safe stopping point; wait for
    every running subagent, CLI agent lane (`ptah_agent_wait` / `ptah_agent_status`; lane
    mechanics live in the `agent-lanes` skill) and child session (`ptah_session_status`); collect
    their results. Do not stop them unless they cannot finish.
  - Step 2 Write `HANDOFF.md` in the task folder you are working on (e.g. its `.ptah/specs/<task>`
    folder); without one, in the root of the current worktree. Overwrite an earlier HANDOFF.md.
    Sections: Goal; Done (commits, branches, PRs); In progress; Open problems and decisions; Key
    files; Background work still running; Next steps with the exact verification commands.
  - Step 3 Compose the continuation prompt: self-contained, gives the ABSOLUTE path of HANDOFF.md,
    tells the new session to read it first and continue from Next steps, and that it can run
    `/session-handoff` itself when its budget runs low.
  - Step 4 Call `ptah_session_handoff { handoffPath, prompt, label? }` exactly once.
  - Step 5 On success: tell the user the new session is open (its label) and ask them to close
    this one; do no further work.
  - Fallback: tool not listed, call refused (any code) or failed: do not retry; print the prompt in
    exactly one fenced code block and tell the user to paste it into a new session.
  - Constraints from guards: name no CLI vendor; restate no lane mechanics (no
    `resume_session_id`, no concurrency numbers).
- Also: bump ptah-core `skillCount` fallback to the real directory count (11 after this change)
  in `AVAILABLE_PLUGINS`; add the skill name to its `keywords` only if keywords list skills
  (check); run `npm run manifest:generate` then `npm run manifest:check`; add the tracked mirror
  `.claude/skills/session-handoff/SKILL.md` (byte-identical).
- Verification seam: `npm run manifest:check`; `npx nx test @ptah-extension/vscode-lm-tools`
  covers vendor-roster-drift and lane-rule specs (run once in Component 4's batch, after this
  file exists); `npx nx test @ptah-extension/agent-sdk -- plugin-loader` via Jest on the spec.
- Files: CREATE `D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md`,
  `D:/projects/ptah-extension/.claude/skills/session-handoff/SKILL.md`;
  MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`,
  `D:/projects/ptah-extension/content-manifest.json` (generated).

## Integration architecture

- Data flow: banner click -> probe `autocomplete:commands` -> `sendOrQueueMessage('/session-handoff
  …')` -> `chat:continue` -> interceptor `new-query` -> SDK runs the skill -> agent writes HANDOFF.md
  -> MCP `ptah_session_handoff` (caller = transport session id) -> `handleSessionToolCall` ->
  `ptah.session.handoff` -> `SessionHandoffService` guards -> `IChildChatSessionHost.
  startHandoffSession` -> broadcast `sessionHandoff:opened` -> `ChatSessionService.
  startHandoffSession` -> `launchSdkSession` (workspaceId=root, projectPath=cwd) -> stream under
  the new tab id -> webview `adoptHandoffTab` (after source tab, focused) -> tool result text ->
  agent tells the user to close the old session.
- State: new tab state owned by TabManager; the bounded handed-off set in `SessionHandoffService`
  (process lifetime, 64 entries). No persistence added; the new session's metadata is written by
  the existing launch path.
- External boundaries: tool args validated by strict zod at the MCP boundary; `handoffPath`
  re-validated on the host (absolute, exists, inside open folders); caller identity only from the
  transport; cwd/root re-authorised by `ChatSessionService`; webview payload validated by the
  hand-written parser.
- Host behaviour: VS Code and Electron - full flow (MCP HTTP server running, webview adopts).
  CLI/TUI - refused `mcp-unavailable` (no MCP port, no tab UI), the skill prints the prompt.
  Host without `registerChatServices` - `chat-runtime-unavailable`. Webview closed - session
  starts, `tabOpened:false`, listed in the sidebar.
- Failure and rollback: every refusal precedes any side effect except a failed start after the
  tab was announced, which gets one `chat:error` in that tab (same as children). No partial state
  persists; the handed-off set is written only after success.
- Observability: one `[SessionHandoff]` output-channel line per outcome; adapter warns on failed
  start (existing logger pattern).

## Architecture-level quality requirements

- Functional: one click sends the skill when present; the agent ends with a new focused tab whose
  first user turn is the continuation prompt, in the same cwd; the new session can hand off again;
  a child session cannot; missing tool/refusal yields one fenced prompt.
- Performance: one extra RPC on click; no timers, observers or subscriptions added.
- Security: no caller/session/path-of-session arguments; prompt text never logged; paths checked
  against open folders on both the runtime and the chat side.
- Maintainability: module boundaries unchanged (`cli-agent-runtime` defines the port,
  `rpc-handlers` implements it, `vscode-lm-tools` consumes the runtime barrel; frontend imports
  only `shared`/`core`/`chat-state`). `Symbol.for` token, barrels updated, zod at the MCP boundary.
- Testability: each refusal code, host announce/failure ordering, tool reply branches, tab
  placement/focus, banner probe branches are unit-tested.

## Team-leader handoff

- Recommended executors: backend-developer for Components 1-4 and 7 (content + backend constant);
  frontend-developer for Components 5-6.
- Complexity: MEDIUM - small new surfaces across five projects, all on existing patterns; the
  contract-sweep pin updates need care.
- Dependencies and ordering: Component 1 and the port types of Component 2 first (everything
  imports them). Then Components 3, 4 and 5+6 are file-disjoint and parallel-safe. Component 7 is
  independent, but run the vscode-lm-tools suite after it lands (skill-scanning specs).
- Suggested file-disjoint batches:
  - B1 (backend-developer): Components 1 + 2. Verify: `npx nx test @ptah-extension/cli-agent-runtime --parallel=1`;
    `npx nx typecheck @ptah-extension/shared --parallel=1`.
  - B2 (backend-developer, after B1): Component 3. Verify: `npx nx test @ptah-extension/rpc-handlers --parallel=1`.
  - B3 (backend-developer, after B1): Component 4. Verify: `npx nx test @ptah-extension/vscode-lm-tools --parallel=1`.
  - B4 (frontend-developer, after B1): Components 5 + 6. Verify:
    `npx nx run-many -t test -p @ptah-extension/chat-state @ptah-extension/chat --parallel=1`
    (header must say 2 projects).
  - B5 (backend-developer, any time; before B3's final test run): Component 7. Verify:
    `npm run manifest:check`; Jest on `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.spec.ts`
    with `--coverage=false --maxWorkers=2`.
  - One heavy check at a time across lanes (CLAUDE.md).
- Files affected:
  - CREATE: `libs/shared/src/lib/types/messages/session-handoff.ts`;
    `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.port.ts`,
    `session-handoff.service.ts`, `session-handoff.service.spec.ts`;
    `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md`;
    `.claude/skills/session-handoff/SKILL.md`.
  - MODIFY: shared `messages/index.ts`, `message-constants.ts`, `payload-map.ts`;
    cli-agent-runtime `child-chat-session-host.port.ts`, `session-children/index.ts`,
    `di/tokens.ts`, `di/register.ts`, `session-spawner.service.spec.ts`;
    rpc-handlers `child-chat-session-host.adapter.ts` (+spec), `chat-session.service.ts` (+spec);
    vscode-lm-tools `session-tool-args.schema.ts`, `session-tools.ts` (+spec),
    `session-tool-handlers.ts`, `protocol-dispatcher.ts` (+spec), `tool-result-budget.ts`,
    `mcp-contract.sweep.spec.ts`, `session-namespace.builder.ts`, `ptah-api-builder.service.ts`;
    chat-state `tab-manager.service.ts` (+spec); chat `agent-session-adoption.service.ts` (+spec),
    `chat-message-handler.service.ts` (+spec), `session-budget-actions.service.ts` (+spec);
    agent-sdk `plugin-loader.service.ts`; root `content-manifest.json` (generated).
  - REWRITE: none.
- Verification points: `Symbol.for('SessionHandoff')` unique (grep); `IChildChatSessionHost`
  has exactly two implementations (adapter, spec fake); `ptah_session_handoff` listed once and
  always-on; served-count pins updated with a comment naming TASK_2026_655; SKILL.md passes the
  vendor and lane-rule specs; assumptions A1-A3 checked and recorded in the batch report; no
  build/serve/e2e targets run.
