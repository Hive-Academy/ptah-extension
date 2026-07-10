# TASK_2026_156 — Gateway Session & Workspace Switching from Discord

**Type**: FEATURE | **Workflow**: Full | **Branch**: `fix/gateway-turn-hang` (stacked on TASK_2026_155)
**Depends on**: TASK_2026_155 (turn-hang fix, committed), TASK_2026_139 (thread = conversation, merged)
**Author**: project-manager | **Date**: 2026-07-10
**Status**: Requirements — ready for software-architect

---

## 1. Problem Statement

Ptah's messaging gateway can run agent turns from Discord (thread = conversation since TASK_2026_139), but a Discord user has **no control plane**: they cannot see which Ptah session a thread is driving, cannot re-point a thread at an existing session, cannot start fresh without opening a brand-new thread, and — most importantly — cannot change which **workspace** the agent operates in. Today the workspace is frozen at whatever `binding.workspaceRoot` was set at approval time (or the Electron app's currently active folder as fallback, `gateway-chat-bridge.ts:143-144`), which silently changes behavior when the desktop user switches workspaces and gives the remote user no say at all.

Because gateway sessions run **yolo-approved** (auto-approved tool use, `gateway-chat-bridge.ts` seeds `permissionLevel: 'yolo'`), any workspace-switching mechanism is effectively "point an RCE-capable agent at a folder." The control plane must therefore be a **closed, server-validated picklist** — never free-text paths from chat.

This task delivers three layers (design direction accepted in the orchestrating conversation — refine, don't re-litigate):

1. **Thread-per-session as the documented primary UX** — each Discord thread is its own conversation row and its own session; a new thread is the cheap way to get a fresh session.
2. **Slash commands as the control plane** — list/attach/reset sessions and list/switch workspaces. Plain messages remain agent turns; no magic message prefixes.
3. **Workspace switching with a hard allowlist** — conversation-level `workspaceRoot` (binding-level remains the default for new conversations), sourced and validated exclusively against Ptah's known workspace folders.

## 2. Current State (verified in code)

| Concern | What exists today | Anchor |
|---|---|---|
| Discord command surface | ONE registered command: `ptah`, type 1, single **required** string option `prompt`. Registered via raw REST POST per allow-listed guild (or global). | `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.ts:10-22` |
| Interaction handling | `DiscordAdapter.handleInteraction` filters `commandName !== 'ptah'`, checks guild allowlist, `deferReply()` (non-ephemeral), reads `options.getString('prompt')`, then forwards an `InboundMessage` **as an agent turn**. In a thread → `conversationMode: 'attach'`; in a parent channel → creates a public thread (`conversationMode: 'open'`). The `DiscordInteractionLike` seam exposes only `getString`, `deferReply`, `editReply` — **no subcommand accessor, no autocomplete handling, no ephemeral flag, no select-menu/component handling** (all are extensions the architect must design). | `discord.adapter.ts:11-21, 264-349` |
| Inbound pipeline | `GatewayService.handleInbound` (`gateway.service.ts:841`): abuse cap 60 msgs/min per allowListId, voice transcription, pairing gate (pending binding → one-shot pairing-code reply, message dropped), approved binding → persist + `resolveOrAdopt`/`resolveOrCreate` conversation → emit `inbound` event consumed by `GatewayChatBridge`. | `gateway.service.ts:841-949` |
| Turn execution | `GatewayChatBridge.runTurn`: `workspaceRoot = binding.workspaceRoot ?? workspace.getWorkspaceRoot() ?? null`; per-conversation serialization via `ConversationQueue` (concurrency 1 per conversationKey); 10-min watchdog; session ended after each turn; first real `sessionId` persisted to the conversation via `ConversationStore.setPtahSessionId`. | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:137-276, 537-551` |
| Session attach (webview-initiated) | `GatewayService.attachSession(bindingId, sessionUuid, workspaceRoot, externalConversationId)`: approved-binding check → `ISessionResumabilityChecker.isResumable(uuid, root)` → `bindings.setWorkspaceRoot` → `conversations.setPtahSessionId` → `AttachedSessionRegistry.attach`. Discriminated-union errors: `binding-not-found`, `binding-not-approved`, `session-not-resumable`. | `gateway.service.ts:431-485` |
| Session detach | `GatewayService.detachSession(bindingId)`: clears `ptah_session_id` on **all** the binding's conversations + `AttachedSessionRegistry.detach`. Binding-scoped; no per-conversation variant exists. | `gateway.service.ts:493-528` |
| Contention guard | `AttachedSessionRegistry` (in-memory `sessionUuid → bindingId`): blocks the **webview resume path** while a session is gateway-attached. It does NOT currently block the reverse (gateway attaching a session the webview is actively driving) — `IAgentAdapter.isSessionActive(id)` exists and is the available signal for that direction. | `attached-session-registry.ts`, `gateway-chat-bridge.ts:358-370` |
| Resumability | `JsonlSessionResumabilityChecker.isResumable(uuid, workspaceRoot)`: checks `~/.claude/projects/<escaped-root>/<uuid>.jsonl` exists; only blocks on an unambiguous on-disk miss. Sessions are workspace-bound by directory escaping. | `session-resumability.ts` |
| Conversation persistence | `gateway_conversations` (migration `0024`): `id, binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at`. **No `workspace_root` column.** Migration head is currently `0027` (`0027_skill_event_reconciliation.ts`) — new migration numbers from `0028`. | `conversation.store.ts:13-20`, `libs/backend/persistence-sqlite/src/lib/migrations/` |
| Binding persistence | `gateway_bindings` has nullable `workspace_root` (+ `setWorkspaceRoot`). | `binding.store.ts` |
| Workspace-list source (EXISTS — architect picks) | Electron: `ElectronWorkspaceProvider` implements `IWorkspaceProvider` + `IWorkspaceLifecycleProvider` (`getWorkspaceFolders()`, `getActiveFolder()`, `setActiveFolder()`); folder list is persisted as `ptah.workspaces` `{folders, activeIndex}` in global state storage and pruned of stale (deleted) paths on restore. RPC surface `workspace:getInfo/addFolder/registerFolder/removeFolder/switch` exists in `WorkspaceRpcHandlers`. Shared path-validation helper `isAuthorizedWorkspace(path, workspaceProvider)` (normalize → compare against `getWorkspaceFolders()` with separator-boundary check) lives in `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts`. NOTE: `messaging-gateway` must not import `rpc-handlers` (hexagonal rule) — reuse of that helper's *logic* vs. its *code location* is an architect decision. | `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts`, `apps/ptah-electron/src/activation/workspace-restore.ts:45-104` |
| Session-list source (EXISTS — architect picks) | `SessionMetadataStore.getForWorkspace(workspaceId)` (agent-sdk): returns `SessionMetadata[]` (`sessionId`, `name`, `workspaceId`, `lastActiveAt`, cost/tokens), sorted by `lastActiveAt` desc, child sessions excluded. Backed by `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` (workspace-aware storage — cross-workspace reads while a different workspace is active need architect verification). Lower-level alternatives: `SessionHistoryReaderService` / `JsonlReaderService` read `~/.claude/projects/` JSONL directly. | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:212-232` |
| Platform scoping | Feature is **Electron-only at runtime** (messaging gateway is wired only in `apps/ptah-electron`). Telegram (grammY) and Slack (Bolt) adapters exist but have no slash-command registration surface in Ptah today. | `libs/backend/messaging-gateway/CLAUDE.md`, `libs/backend/gateway-chat-bridge/CLAUDE.md` |

**Discord platform constraints that shape requirements** (facts, not design):
- An interaction must be acknowledged within **3 seconds** (defer or reply), else it fails visibly.
- A slash-command option can carry at most **25 static choices**; autocomplete responses are also capped at 25; select menus are capped at 25 options.
- If a command gains subcommands, it can no longer have sibling top-level options — i.e., the existing `/ptah prompt:<text>` shape cannot coexist with `/ptah sessions`-style subcommands under the same command name. The concrete shape (separate top-level commands vs. subcommands with the prompt flow moved) is an **architect decision**; the requirement is behavioral (see US-2..US-6) plus AC-1.4 (existing prompt flow keeps working).
- Ephemeral replies (visible only to the invoker) are supported on interactions and are the required privacy mechanism for error/list output (NFR-3).

Throughout this document, "the five commands" are named logically as `/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`. The architect maps them onto Discord's actual command tree.

## 3. Business Goals

1. A Discord user can fully steer *which session* and *which workspace* a thread drives, without touching the desktop app.
2. Zero new remote-attack surface: no free-text path or session input is ever trusted; everything is validated server-side against Ptah-known state.
3. The existing prompt flow (`/ptah` + plain thread messages) is untouched in behavior.

## 4. User Stories & Acceptance Criteria

### US-1: Thread-per-session is the documented product story

**As a** Discord user, **I want** each thread to be its own isolated session **so that** starting a new topic is as simple as starting a new thread.

- **AC-1.1** Given a parent channel, when I invoke the prompt command or @mention the bot, then a new thread is created and its first turn starts a **fresh** session bound to that thread's conversation row (existing behavior, re-asserted as a regression gate).
- **AC-1.2** Given an existing Ptah thread with a bound session, when I send a plain message in it, then the turn resumes that thread's session (`conversation.ptahSessionId`) — never another thread's session.
- **AC-1.3** Given any of the five control commands, when invoked, then the message is consumed by the control plane and is **never** forwarded as an agent prompt (no `inbound` agent-turn event, no session started, no turn queued).
- **AC-1.4** Given the existing prompt flow (`/ptah prompt:<text>` semantics, in-thread and parent-channel variants, @mention flow), when this feature ships, then that flow works exactly as before (same thread creation, same conversationMode, same replies).
- **AC-1.5 (docs)** The thread-per-session model and the five commands are documented in the gateway user docs (`apps/ptah-docs` gateway page) as part of this task's DoD.

### US-2: `/sessions` — list resumable sessions

**As a** Discord user in a Ptah thread, **I want** to list the resumable sessions for this conversation's workspace **so that** I can pick one to continue.

- **AC-2.1** Given an approved binding and a Ptah thread, when I invoke `/sessions`, then I receive a list of sessions for the conversation's **effective workspace** (conversation-level `workspaceRoot`, falling back to binding-level, falling back to the active Electron workspace — same resolution as US-7), each entry showing: session name, short session-id prefix (first 8 chars), and human-readable last-active time.
- **AC-2.2** Given more sessions than one Discord reply can carry, when I invoke `/sessions`, then the list is capped at the **25 most-recently-active** sessions (Discord picklist limit) and the reply states the list is truncated.
- **AC-2.3** Given a workspace with zero sessions, when I invoke `/sessions`, then I receive an explicit "no resumable sessions for `<workspace name>`" reply (not an empty message, not an error).
- **AC-2.4** Given the currently attached session, when it appears in the list, then it is visibly marked as current.
- **AC-2.5** Given `/sessions` invoked in a **parent channel** (no thread → no conversation row), then the reply lists sessions for the **binding's** effective workspace and states that attaching requires being inside a Ptah thread. *(DEFAULT: read-only commands work in parent channels; mutating ones do not — see AC-3.8, AC-6.8.)*
- **AC-2.6** Given a binding that is not approved (pending/rejected/revoked/unknown), when I invoke `/sessions`, then I get an ephemeral "not paired/approved" reply and no session data is disclosed (see SEC-6).

### US-3: `/session use <pick>` — attach a session to this thread

**As a** Discord user in a Ptah thread, **I want** to point this thread at an existing session **so that** my next messages continue that conversation.

- **AC-3.1** Given a Ptah thread and a session pick chosen from the closed list presented by Ptah (picklist/autocomplete — never free-typed as a trusted value), when I invoke `/session use`, then the conversation row's `ptahSessionId` is set to the picked session's UUID and I receive a confirmation naming the session.
- **AC-3.2** The server treats the submitted pick as **untrusted**: it MUST re-validate that the value resolves to exactly one session belonging to the conversation's effective workspace (re-derived server-side), and MUST pass the same `ISessionResumabilityChecker.isResumable(uuid, workspaceRoot)` gate used by `GatewayService.attachSession`. A pick failing either check → error reply, conversation unchanged.
- **AC-3.3** Given a pick that is ambiguous (e.g., a prefix matching multiple sessions) or matches nothing, then I receive an error reply telling me to re-run `/sessions`, and the conversation is unchanged.
- **AC-3.4** Given the target session is recorded in `AttachedSessionRegistry` as attached to a **different binding or conversation**, when I invoke `/session use`, then the attach is refused with a "session is in use elsewhere" reply. No stealing in v1 *(DEFAULT: no force flag; freeing requires `/new` or webview detach at the owning location)*.
- **AC-3.5** Given the target session is currently **active in the agent adapter** (e.g., the webview is mid-turn on it — signal: `IAgentAdapter.isSessionActive`), when I invoke `/session use`, then the attach is refused with a "session is currently running" reply.
- **AC-3.6** Given a turn is **mid-stream in this conversation** (a turn for this conversationKey is executing or queued in the `ConversationQueue`), when I invoke `/session use`, then the command is refused with a "finish or wait for the current turn first" reply and no state changes. Rationale: `pumpStream` rebinds `ptahSessionId` from in-flight events (`gateway-chat-bridge.ts:471-478`); mutating the link mid-turn creates a lost-update race. *(DEFAULT: reject rather than queue-behind-turn — deterministic and simple.)*
- **AC-3.7** Given a successful `/session use`, then: (a) the previously attached session for this conversation (if any) is detached in `AttachedSessionRegistry`, (b) the new UUID is registered attached, and (c) the next plain message in the thread resumes the new session in the conversation's effective workspace.
- **AC-3.8** Given `/session use` invoked in a parent channel (no conversation row), then it is refused with guidance to run it inside a Ptah thread.
- **AC-3.9** `/session use` never changes the conversation's `workspaceRoot`; the pick is constrained to sessions of the current effective workspace (workspace switching is exclusively US-6).

### US-4: `/new` — start fresh in this thread

**As a** Discord user in a Ptah thread, **I want** to clear this thread's session link **so that** my next message starts a brand-new session (keeping the same thread and workspace).

- **AC-4.1** Given a Ptah thread with a bound session, when I invoke `/new`, then the conversation row's `ptahSessionId` is set to NULL, the UUID is detached from `AttachedSessionRegistry`, and I receive a confirmation.
- **AC-4.2** Given a thread with **no** bound session, when I invoke `/new`, then the command succeeds idempotently ("already fresh") — no error.
- **AC-4.3** Given a turn mid-stream in this conversation, when I invoke `/new`, then it is refused with the same "turn in progress" behavior as AC-3.6.
- **AC-4.4** Given `/new` succeeded, when I send the next plain message, then a fresh session starts in the conversation's effective workspace and its new UUID is persisted on the conversation (existing first-turn binding path).
- **AC-4.5** `/new` is conversation-scoped: other threads on the same binding keep their sessions (contrast with binding-scoped `GatewayService.detachSession`, which stays unchanged for the webview flow).
- **AC-4.6** Given `/new` invoked in a parent channel, then it is refused with guidance to run it inside a Ptah thread.

### US-5: `/workspace list` — see allowed workspaces

**As a** Discord user, **I want** to see which workspaces Ptah will let me target **so that** I can pick one safely.

- **AC-5.1** Given an approved binding, when I invoke `/workspace list`, then I receive the closed list of Ptah-known workspace folders (source: the Electron workspace provider's registered folder list — the same list persisted as `ptah.workspaces`), each shown by folder name with enough disambiguation for same-named folders, and the conversation's (or, in a parent channel, the binding's) current effective workspace marked as current.
- **AC-5.2** The list contains ONLY workspaces from that Ptah-known set. There is no mechanism — no option, no fallback, no parsing — by which a raw path supplied in Discord enters this list or is accepted downstream (SEC-1).
- **AC-5.3** Given zero known workspaces (no folder ever opened in Ptah Electron), then the reply says so and points the user at the desktop app; no error.
- **AC-5.4** Given more than 25 known workspaces, then the list is capped at 25 *(DEFAULT: most-recently-used first if ordering info exists; otherwise provider order)* and the reply states truncation.
- **AC-5.5** Works both inside threads and in parent channels (read-only).
- **AC-5.6** Unapproved binding → same gate as AC-2.6.

### US-6: `/workspace use <pick>` — switch this thread's workspace

**As a** Discord user in a Ptah thread, **I want** to re-point this thread at a different allowed workspace **so that** subsequent turns operate on that project.

- **AC-6.1** Given a Ptah thread and a pick chosen from the closed `/workspace list` set, when I invoke `/workspace use`, then the **conversation row's** `workspaceRoot` is set to the picked path and I receive a confirmation naming the workspace.
- **AC-6.2** The server treats the pick as untrusted and MUST re-validate it server-side against the current Ptah-known workspace list (normalized comparison in the spirit of `isAuthorizedWorkspace` — resolve, normalize separators/case, exact-folder match; **exact roots only, no subpaths** for this feature). A value not in the list → refused, conversation unchanged (SEC-1/SEC-2).
- **AC-6.3** Given the picked workspace folder no longer exists on disk (deleted since the list was built), when I invoke `/workspace use`, then the switch is refused with a "workspace no longer available" reply and the conversation is unchanged. (Restore-time pruning in `workspace-restore.ts` already drops stale paths at app start; this AC covers mid-session deletion.)
- **AC-6.4** Given a successful workspace switch on a conversation with a bound session, then the conversation's `ptahSessionId` is **cleared** and the UUID detached from `AttachedSessionRegistry`, and the confirmation explicitly says a new session will start on the next message. Sessions are workspace-bound (JSONL lives under the escaped-root dir); a session MUST never be resumed against a different root (SEC-4).
- **AC-6.5** Given the pick equals the conversation's current effective workspace, then the command is a no-op that says so and does NOT clear the session link.
- **AC-6.6** Given a turn mid-stream in this conversation, then refused per AC-3.6 semantics.
- **AC-6.7** Switching a conversation's workspace MUST NOT change the Electron app's active workspace, the binding's `workspaceRoot`, or any other conversation. It also MUST NOT require the picked workspace to be the desktop-active one — any allowlisted folder is valid.
- **AC-6.8** Given `/workspace use` invoked in a parent channel, then it is refused with guidance to run it inside a Ptah thread. *(DEFAULT for v1: no binding-level default mutation from chat — changing the default for all future threads from a public channel is a sharper knife than this task needs; the webview Gateway tab remains the place to change binding defaults. Architect may revisit only with an explicit user-visible confirmation design.)*
- **AC-6.9** Given sessions exist in the previous workspace, they are untouched (not deleted, not migrated); switching back later and running `/sessions` shows them again.

### US-7: Conversation-level workspace resolution (data model)

**As** the gateway runtime, **I want** workspace resolution to be conversation-first **so that** two threads on one binding can drive two different workspaces safely.

- **AC-7.1** A migration (numbered from `0028`; verify head at implementation time) adds a nullable `workspace_root` column to `gateway_conversations`. Existing rows get NULL (= inherit binding-level). No data loss; migration is forward-only per existing persistence-sqlite conventions.
- **AC-7.2** Effective-workspace resolution for a turn becomes, in order: `conversation.workspaceRoot` → `binding.workspaceRoot` → `IWorkspaceProvider.getWorkspaceRoot()` → error reply "No workspace is open in Ptah…" (replacing the binding-first logic at `gateway-chat-bridge.ts:143-144`). The same resolution function is used by `/sessions` and `/session use` so the list, the validation, and the turn all agree.
- **AC-7.3** New conversations continue to be created with NULL `workspace_root` (binding-level remains the default for new threads).
- **AC-7.4** The webview-initiated `GatewayService.attachSession` flow continues to work; since it carries a session's real `workspaceRoot`, the conversation it targets must end up with a consistent workspace/session pair under the new resolution (exact write path is an architect decision; the invariant is: after any attach, `isResumable(conversation.ptahSessionId, effectiveWorkspace(conversation))` holds).
- **AC-7.5** `ConversationStore` exposes the conversation-level workspace read/write needed above with the same transactional style as existing methods; `binding.workspace_root` semantics are unchanged.

### US-8: Platform scoping — Discord-first, graceful degradation elsewhere

**As a** Telegram/Slack gateway user, **I want** existing behavior to keep working **so that** this Discord-first feature doesn't regress my setup.

- **AC-8.1** Telegram and Slack message flows (pairing, plain-message turns, voice) are byte-for-byte behaviorally unchanged by this task.
- **AC-8.2** The conversation-level `workspace_root` column and conversation-first resolution apply platform-neutrally; on Telegram/Slack the column simply stays NULL, so effective resolution degrades to today's binding-level behavior.
- **AC-8.3** No Telegram/Slack command surface is added in this task. **Recommendation (accepted scoping)**: defer Telegram (`setMyCommands`) and Slack (app-manifest slash commands) parity to a documented follow-up; record it in the task's future-enhancements notes and the gateway docs ("Discord-only for now").
- **AC-8.4** If a control-plane-shaped text (e.g., a literal `/sessions` message) arrives on Telegram/Slack, it is treated as a plain agent prompt exactly as today — explicitly NOT parsed as a command (no magic prefixes, per design direction).

## 5. Security Requirements (first-class, blocking)

- **SEC-1 (closed picklist, no raw paths)**: No workspace path and no session identifier originating from Discord is ever used directly. Every mutating command re-derives the allowed set server-side at execution time and validates membership. A gateway agent runs yolo-approved; an accepted arbitrary path is remote code execution over that folder. This must hold even if Discord-side UI constraints (choices/autocomplete/select menus) are bypassed by a crafted API client.
- **SEC-2 (allowlist source of truth)**: The workspace allowlist is exactly the Ptah-known workspace folder set from the Electron workspace provider (persisted `ptah.workspaces`). Exact-root matching only. Nothing in messaging-gateway may accept subpaths, UNC/relative/tilde forms, or normalize its way into a folder outside the set.
- **SEC-3 (contention)**: `/session use` respects `AttachedSessionRegistry` (refuse sessions attached to another binding/conversation) AND refuses sessions currently active in the agent adapter. Successful attach/detach keeps the registry consistent (attach new, detach old) so the existing webview-resume block keeps functioning.
- **SEC-4 (workspace switch clears session)**: Any effective-workspace change on a conversation clears its `ptahSessionId` (AC-6.4). There is no code path that resumes a session UUID against a root other than the one `isResumable` validated.
- **SEC-5 (binding approval gate)**: All five commands require an approved binding for `(platform, externalChatId)`. Pending → the reply may include only the pairing guidance (mirroring `handleInbound`'s single-prompt discipline — do not spam the code on every command). Rejected/revoked/unknown → generic refusal. Command handling MUST NOT create approved state or bypass `upsertPending`.
- **SEC-6 (information disclosure)**: Session names and workspace paths are user data. Replies that enumerate them (`/sessions`, `/workspace list`) and all error/refusal replies are **ephemeral** (invoker-only). Guild allowlist filtering (`allowedGuildIds`) applies to control commands exactly as it does to prompt interactions today.
- **SEC-7 (abuse/rate limiting)**: Control commands are subject to abuse limiting equivalent to the existing inbound cap (60/min per allowListId, `gateway.service.ts:113`) — a command flood must not bypass the guard just because commands skip the agent path.
- **SEC-8 (validation at boundary)**: All interaction payloads consumed by the new command handling are validated with Zod at the adapter boundary before use (strict TS, `catch (error: unknown)` per repo standards).

## 6. Data Requirements

1. **`gateway_conversations.workspace_root`** — new nullable TEXT column (migration ≥ `0028`). NULL = inherit binding-level. Set only by `/workspace use` (and, if the architect chooses, the webview attach flow per AC-7.4). Cleared: never automatically (a stale conversation-level root that leaves the allowlist simply fails resolution → see below).
2. **Effective workspace** (single shared function): `conversation.workspace_root ?? binding.workspace_root ?? activeElectronWorkspace ?? none`. When the resolved conversation-level root is no longer in the allowlist or missing on disk at turn time, the turn fails with the existing "no workspace" style error message telling the user to `/workspace use` again *(DEFAULT: fail closed; do not silently fall back to the binding root, which would run the agent somewhere the user didn't ask)*.
3. **Session link invariant**: `ptah_session_id` is only ever non-NULL alongside a workspace under which `isResumable` held at set-time (attach via US-3, first-turn bind via bridge, webview attach).
4. **`gateway_bindings.workspace_root`** — semantics unchanged: default for new conversations, still written by webview approve/attach flows.
5. **AttachedSessionRegistry** — remains in-memory/process-local; must end each command in a state consistent with the durable rows (attach on `/session use`, detach on `/new`, `/workspace use`, and re-attach replacement).
6. **Message persistence**: control-command invocations and their replies are NOT persisted as gateway chat messages *(DEFAULT — they are control plane, not conversation; avoids polluting `gateway_messages` and the Gateway tab transcript)*.

## 7. Non-Functional Requirements

- **NFR-1 (Discord ack deadline)**: every command interaction is acknowledged (deferred or replied) within Discord's 3-second window under all code paths, including validation failures.
- **NFR-2 (latency)**: command replies complete within 5 s p95. All data sources are local (SQLite, state-storage JSON, `~/.claude/projects` fs) — no LLM call, no network beyond Discord itself, is permitted on the control path.
- **NFR-3 (reply visibility)**: list output and every error/refusal reply → **ephemeral**. State-change confirmations (`/session use`, `/new`, `/workspace use` success) → posted **in the thread, publicly** so the thread has an audit trail of what it is pointed at *(DEFAULT)*.
- **NFR-4 (streaming isolation)**: command handling never blocks or is blocked by an in-flight turn in *another* conversation; within the same conversation the mid-stream rule is AC-3.6 (reject mutating commands, allow read-only ones).
- **NFR-5 (restart resilience)**: conversation-level workspace and session links survive app restart (SQLite); `AttachedSessionRegistry` is rebuilt/degraded gracefully as today (process-local backstop; durable truth is the rows).
- **NFR-6 (registration)**: updated Discord command registration remains one idempotent REST call per guild via the existing `registerDiscordCommands` flow; re-registering is safe (Discord upserts by name). Global-scope registration keeps its ~1 h propagation caveat documented.
- **NFR-7 (testability)**: all new adapter surface stays behind the existing `*Like` structural seams so unit tests need no live Discord client; GatewayService/bridge changes keep the `GatewayTestOverrides` seam working.

## 8. Explicitly Out of Scope

- Telegram/Slack command parity (deferred; AC-8.3 documents it).
- Voice-flow changes; streaming-mode changes (coalescer stays `'complete'`).
- Gateway UI (Electron Gateway tab) work beyond what already reflects conversation state; a read-only display of conversation-level workspace is OPTIONAL and only if trivially cheap — no new UI flows.
- Free-text workspace paths from chat, subpath targeting, adding NEW workspaces from Discord (the allowlist is managed only from the desktop app).
- Session "steal"/force-detach from Discord (AC-3.4 default: refuse).
- Cross-binding session sharing, multi-user permissions within a guild, per-user ACLs on commands.
- Changing the yolo permission model for gateway turns.
- Message-prefix command parsing (design direction explicitly: slash commands only).
- Webview attach/detach RPC surface changes beyond keeping AC-7.4's invariant.

## 9. Clarifications Needed

None blocking. Every decision point that could have been an open question has a sensible default stated inline and tagged *(DEFAULT)* — notably: reject-while-streaming (AC-3.6), no session stealing (AC-3.4), mutating commands refused in parent channels / no binding-default mutation from chat (AC-6.8), fail-closed on stale conversation workspace (Data-2), ephemeral lists + public state-change confirmations (NFR-3), and control commands not persisted as chat messages (Data-6). The user or architect may override any of these defaults during validation without re-opening the requirements.

## 10. Success Metrics / Definition of Done

1. All ACs above have automated coverage (unit tests at adapter/service/bridge level; the existing fake-adapter and `*Like` seams are sufficient — no live Discord needed).
2. A manual Discord smoke pass demonstrates: fresh thread → `/sessions` → `/session use` → continued context; `/new` → fresh context; `/workspace list` → `/workspace use` → next turn runs in the picked root and `/sessions` shows that workspace's sessions.
3. `npm run typecheck:all`, `npm run lint:all`, affected Jest suites green; migration applies cleanly on an existing `~/.ptah/ptah.db` with 0024-era rows.
4. Hexagonal boundaries hold: `messaging-gateway`/`gateway-chat-bridge` gain no imports from `rpc-handlers` or platform adapter libs (ports via `platform-core` only).
