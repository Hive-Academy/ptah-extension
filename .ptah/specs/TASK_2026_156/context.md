# TASK_2026_156 — Gateway Session & Workspace Switching (Discord control plane)

## Metadata

- **Type**: FEATURE
- **Workflow**: Full (PM → Architect → user validation → implement → QA)
- **Branch/Worktree**: `fix/gateway-turn-hang` (same worktree as TASK_2026_155, stacked on its 3 commits `8d4056003`/`289d76c9d`/`6e58d3465`)
- **cli_delegation**: disabled
- **Created**: 2026-07-10
- **Depends on**: TASK_2026_155 (turn-hang fix — committed on this branch); TASK_2026_139 (Discord multi-session Option A — thread = conversation, already merged)

## User Intent

From Discord (and by extension Telegram/Slack where applicable), the user wants to:
1. **Switch which Ptah session a conversation drives** — list resumable sessions, attach one, start fresh.
2. **Switch which workspace the agent operates in** — among workspaces known to Ptah, safely.

## Design Direction (agreed in orchestrating conversation — treat as requirements input, refine don't re-litigate)

Three layers, previously recommended and accepted as the follow-up scope:

1. **Thread-per-session is the primary UX** (already mostly true post-TASK_2026_139: each Discord thread = own `gateway_conversations` row = own session). Make this the documented product story; new thread → fresh session.
2. **Slash commands as the control plane** (extend the existing `/ptah` registration in `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.ts`):
   - `/sessions` — list resumable sessions for the conversation's workspace (name, last-active, uuid prefix)
   - `/session use <pick>` — re-point the current conversation's `ptahSessionId`; MUST reuse `GatewayService.attachSession`-style resumability check (`ISessionResumabilityChecker`) + `AttachedSessionRegistry` guard (cannot steal a session the webview is driving)
   - `/new` — clear `ptahSessionId` on the current conversation (per-conversation variant of detach)
   - `/workspace list` / `/workspace use <pick>` — closed picklist only
   - Control plane = slash commands, NOT magic message prefixes; plain messages remain agent turns.
3. **Workspace switching with a hard allowlist**:
   - Move/duplicate `workspaceRoot` from binding-level to **conversation-level** (migration on `gateway_conversations`; binding-level root remains the default/fallback for new conversations).
   - **Never accept a raw path from Discord** — `/workspace use` presents a closed picklist sourced from Ptah-known workspaces (Electron recent/open workspaces list) and validates server-side against that same list. A gateway agent runs yolo-approved; arbitrary paths = RCE over any folder. Mirror the `isAuthorizedWorkspace` gating philosophy.
   - Switching workspace clears the conversation's `ptahSessionId` (sessions are workspace-bound; `isResumable` checks against workspaceRoot). Never resume a session against a different root.

## Key Code Anchors (verified in TASK_2026_155 investigation)

- `libs/backend/messaging-gateway/src/lib/gateway.service.ts` — `attachSession` (:431), `detachSession` (:493), `handleInbound` (:841), `registerDiscordCommands` (:692)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.ts` — single `/ptah` command registration (REST POST)
- `libs/backend/messaging-gateway/src/lib/adapters/discord/discord.adapter.ts` — interaction handling (needs reading: how `/ptah prompt` interactions are consumed today; new subcommands + autocomplete/pick UX likely via Discord options or select menus)
- `libs/backend/messaging-gateway/src/lib/conversation.store.ts` — `resolveOrCreate`/`resolveOrAdopt`/`setPtahSessionId`/`clearPtahSessionId`
- `libs/backend/messaging-gateway/src/lib/binding.store.ts` — binding `workspace_root`
- `libs/backend/messaging-gateway/src/lib/attached-session-registry.ts` — webview-contention guard
- `libs/backend/messaging-gateway/src/lib/session-resumability.ts` — `ISessionResumabilityChecker`
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` — `runTurn` uses `binding.workspaceRoot ?? current` (:90-98); must become conversation-first resolution
- Session listing source: agent-sdk `SessionMetadataStore` / session history reader (needs architect decision on which service lists resumable sessions per workspace)
- Workspace list source: Electron workspace switcher / recent workspaces (needs architect discovery — see TASK_2026_154 fast workspace switching + `IWorkspaceProvider`)
- Persistence migrations live in `libs/backend/persistence-sqlite` (latest known migration ~0024 `gateway_conversations` from TASK_2026_139; check current head before numbering)

## Constraints

- Hexagonal rules: messaging-gateway/gateway-chat-bridge must not import rpc-handlers or platform adapters; ports via platform-core.
- Adapter logic stays behind `IMessagingAdapter`; GatewayService orchestrates; bridge consumes events.
- Zod at boundaries; TypeScript strict; `catch (error: unknown)`; no `any`.
- Discord-first delivery; Telegram/Slack parity may be deferred to future-enhancements if the adapter surfaces diverge (PM to scope explicitly).
- Security is a first-class requirement: closed workspace picklist, server-side validation, no raw paths from chat, respect AttachedSessionRegistry.

## Out of Scope (unless PM/user says otherwise)

- Voice, streaming-mode changes, gateway UI (Electron Gateway tab) beyond what's needed to reflect conversation-level workspace/session state
- Telegram/Slack full command parity (documented as follow-up if deferred)
