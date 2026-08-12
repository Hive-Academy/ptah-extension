# TASK_2026_192 — Gateway inbound sessions run at `permissionLevel: 'yolo'`

Security bugfix. Findings + gate decision. Citations are `path:line`.

## P1 — Trust model and reach

### The path

- Adapters emit `InboundMessage` → `GatewayService.handleInbound` (`libs/backend/messaging-gateway/src/lib/gateway.service.ts:855`).
- `handleInbound` runs the binding/pairing gate then `this.emit('inbound', event)` (`gateway.service.ts:963`).
- `GatewayChatBridge` subscribes (`gateway-chat-bridge.ts:133` → `onInbound` → `runTurn` → `openStream`/`startNew`); each session was started/resumed with a hardcoded `permissionLevel: 'yolo'` (`gateway-chat-bridge.ts` ~:423, :440, :471 pre-fix).

### Two gates sit above the agent

1. **Adapter allowlist** — per adapter, and **empty means allow-all**.
2. **Binding pairing** — a human must approve each `(platform, externalChatId)` binding once with a 6-digit code before ANY message is forwarded (`gateway.service.ts:902-939`; `approveBinding:397`, constant-time compare `:411`). Until approved the message is dropped. Abuse cap 60 msgs/min per `allowListId` (`gateway.service.ts:855-870`).

The binding gate is per **channel/chat**, NOT per **sender**. After approval every later message on the binding is forwarded and (pre-fix) ran at `yolo`.

### Reachability / trust-model table

| Adapter                  | Inbound trigger                                                                  | Sender auth / allowlist                                                                                   | Granularity                             | Empty allowlist =                  | Extra gate      | Pre-fix perms |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- | --------------- | ------------- |
| **Telegram** (grammy)    | any `message` (`grammy.adapter.ts:104`, `handleInbound:158`)                     | `allowedUserIds` vs `message.from.id`; group chats also need chat id in set (`grammy.adapter.ts:162-184`) | per-user (`allowListId=fromId`, `:198`) | **allow ALL users** (`:79-80`)     | binding pairing | `yolo`        |
| **Discord** (discord.js) | `/ptah` cmd or @mention / Ptah thread (`discord.adapter.ts:290-367`, `:522-604`) | `allowedGuildIds` vs `guildId` (`:303-314`,`:504-507`,`:529-536`)                                         | **per-guild** (NOT per-user)            | **allow ALL guilds** (`:504-507`)  | binding pairing | `yolo`        |
| **Slack** (@slack/bolt)  | `app_mention` (`bolt.adapter.ts:130`,`:187`)                                     | `allowedTeamIds` vs `teamId` (`:190-197`)                                                                 | **per-team** (NOT per-user)             | **allow ALL teams** (`:94`,`:190`) | binding pairing | `yolo`        |

### What the gateway session exposes

- **Tools**: full SDK surface. `yolo` makes `SdkPermissionHandler.createCallback` auto-approve EVERY tool (`agent-sdk/src/lib/sdk-permission-handler.ts:359-367`), incl. `DANGEROUS_TOOLS=['Write','Edit','Bash','NotebookEdit']` (`permission/permission-tool-classifier.ts:36`), `NETWORK_TOOLS` (`:42`), MCP (`isMcpTool:60`). Only read-only `SAFE_TOOLS` auto-approve regardless of level (`sdk-permission-handler.ts:302-324`).
- **Workspace scope**: applied — `projectPath`/`workspaceId` = resolved root, fail-closed on revoked/missing root (`gateway-chat-bridge.ts:166-184`). Scopes default cwd only; `Bash` still runs arbitrary shell.
- **Configurable?** No — `yolo` was a hardcoded literal at all three sites.

### Severity verdict

**Not owner-only; it is "approved-channel", and the channel can be multi-user.** Telegram with a configured `allowedUserIds` approximates owner-only, but the allowlist defaults to allow-all, and Discord/Slack allowlists are per-guild/per-team — so after one human binding approval, ANY member of that channel/guild/team gets a remote, non-interactive path to `Bash`/`Write`/`Edit`/MCP under the host user's privileges. First-stage remote exposure (vs TASK_2026_174's second-stage). Even the Telegram-owner case is unsafe: remote + non-interactive + `yolo` lets relayed prompt-injection drive `Bash`. Gating warranted.

## P2 — The gate

### Decision

Replace unconditional `'yolo'` with a per-gateway configurable level read from `ptah.gateway.permissionLevel`, validated at the settings boundary, **defaulting to safe `'ask'`**. Accepted: `['ask','auto-edit','yolo']`; anything else → `'ask'`. Seeded at start/resume, never flipped post-hoc.

### Why

- **Fits P1**: remote + non-interactive + potentially multi-user → deny-by-default for dangerous tools. At `'ask'` only read-only `SAFE_TOOLS` auto-approve; `Write`/`Edit`/`Bash`/network/MCP route to `requestUserPermission` (`sdk-permission-handler.ts:418-489`).
- **`'ask'` is the out-of-band approval surface**: gateway requests carry the SDK session UUID (routable) and go to the local `ptah.main` webview — the host operator, not the chat sender, decides. No webview → denied immediately (`sdk-permission-handler.ts:153-174`); wedge bounded by the 10-min watchdog (`gateway-chat-bridge.ts:64,261-297`). Fail-closed either way.
- **Explicit opt-in for autonomy**: operator sets `'auto-edit'` (edits only) or `'yolo'` (all) deliberately.
- **Minimal + in-scope**: confined to `gateway-chat-bridge`, reads via the already-injected `IWorkspaceProvider` (mirrors `GatewayService` config reads). No new DI dep, no adapter/agent-sdk change. Pairing gate + adapter allowlists left intact (defense in depth).
- **Boundary validation**: raw setting validated against a fixed tuple; unknown values (incl. SDK-only `'bypassPermissions'`/`'plan'`) → `'ask'`.

### Not chosen

- Keep `yolo` (rejected by task + P1).
- Hardcode `'ask'` with no override (breaks legitimate unattended automation).
- New per-tool gateway allowlist (larger surface; SDK already classifies tools; `'ask'`/`'auto-edit'` express the policy).

## Files changed

- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` — class doc; import `PermissionLevel`; add `GATEWAY_PERMISSION_LEVEL_KEY`, `GATEWAY_PERMISSION_LEVELS`, `DEFAULT_GATEWAY_PERMISSION_LEVEL='ask'`, `resolvePermissionLevel()`; three `'yolo'` literals → `resolvePermissionLevel()`.
- `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` — harness `getConfiguration` mock + `gatewayPermissionLevel` option; prior `'yolo'` assertions → `'ask'`; new `inbound permission gate (TASK_2026_192)` suite.
- `libs/backend/gateway-chat-bridge/CLAUDE.md` — documents the gate.

## Operator note

`ptah.gateway.permissionLevel` lives in `~/.ptah/settings.json` (`ptah` section, schema-less via `getConfiguration`). Unset = `'ask'`. Set `'auto-edit'` or `'yolo'` to grant autonomous edit/exec to approved inbound conversations.
