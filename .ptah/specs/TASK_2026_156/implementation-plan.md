# TASK_2026_156 — Implementation Plan: Gateway Session & Workspace Switching from Discord

**Author**: software-architect | **Date**: 2026-07-10
**Base**: worktree `fix/gateway-turn-hang` (TASK_2026_155 turn-hang fix committed — design is on top of the CURRENT worktree code)
**Inputs**: `context.md`, `task-description.md` (US-1..8, AC-1.1..8.4, SEC-1..8, NFR-1..7, Data-1..6) — all satisfied below.

---

## 1. Architecture Overview

### 1.1 Two disjoint inbound planes

The core structural decision: **control commands never enter the prompt pipeline**. Today every Discord interaction funnels into `DiscordAdapter.handleInteraction` → `InboundMessage` → `GatewayService.handleInbound` → `inbound` event → `GatewayChatBridge.runTurn`. Control commands get a **second, parallel path** that terminates inside `messaging-gateway` and never emits an `inbound` event, never calls `MessageStore.insert`, and never touches the `ConversationQueue`. This satisfies AC-1.3 and Data-6 *structurally* (there is no code path from a command to the agent), and leaves the `/ptah` prompt flow byte-for-byte untouched (AC-1.4, AC-8.1).

```
                         DISCORD (interactionCreate)
                                   │
              ┌────────────────────┴──────────────────────┐
              │        DiscordAdapter.handleInteraction    │
              │  1. guild allow-list gate (existing, SEC-6)│
              │  2. Zod parse of interaction (SEC-8)       │
              └───────┬───────────────────┬───────────────┘
        commandName   │                   │  commandName ∈ {sessions, session,
          == 'ptah'   │                   │  new, workspace} (+ autocomplete ints)
                      ▼                   ▼
      ┌──────────────────────┐   ┌─────────────────────────────────────────┐
      │ EXISTING PROMPT PATH │   │ NEW CONTROL PLANE (never an agent turn) │
      │ deferReply()         │   │ autocomplete → handler.handleAutocomplete
      │ InboundMessage ──────┼─┐ │            → interaction.respond(≤25)   │
      │ (unchanged, AC-1.4)  │ │ │ command    → deferReply({ephemeral})    │
      └──────────────────────┘ │ │            → GatewayCommandInvocation   │
                               │ └───────────────────┬─────────────────────┘
                               │                     │ IGatewayCommandHandler
                               ▼                     ▼ (set via adapter.setCommandHandler,
   GatewayService.handleInbound          GatewayCommandService                wired by GatewayService.maybeStartDiscord)
   (abuse cap, pairing, persist,          (messaging-gateway/src/lib/commands/)
    resolveOrAdopt, emit 'inbound')       │  1. rate-limit 60/min per allowListId (SEC-7)
        │                                 │  2. approved-binding gate, no upsertPending (SEC-5)
        ▼                                 │  3. mid-turn gate: ConversationTurnTracker (AC-3.6)
   GatewayChatBridge.runTurn              │  4. dispatch:
   │ turnTracker.begin/end  ◄─────────────┼──── shares ConversationTurnTracker
   │ effective-workspace resolution ◄─────┼──── shares resolveEffectiveWorkspaceRoot()
   │   conversation → binding → active    │
   │ (155 watchdog/cancellation intact)   │   /sessions        → IGatewaySessionLister
        │                                 │   /session use     → lister re-validate
        ▼                                 │        + ISessionResumabilityChecker (SEC-1/3/4)
   IAgentAdapter (yolo turn)              │        + AttachedSessionRegistry + ISessionActivityProbe
                                          │   /new              → ConversationStore.clearPtahSessionId
   Ports (impl outside messaging-gateway):│   /workspace list   → IWorkspaceProvider.getWorkspaceFolders (SEC-2)
   • IGatewaySessionLister  ──────────────┼──► apps/ptah-electron MetadataGatewaySessionLister
   • ISessionActivityProbe  ──────────────┼──► apps/ptah-electron factory over TOKENS.AGENT_ADAPTER
   • IWorkspaceProvider (platform-core, existing port — IS the allowlist source)
                                          │   /workspace use    → allowlist validate + fs-exists
                                          │        → ConversationStore.setWorkspaceRootAndClearSession (txn, SEC-4)
                                          ▼
                              GatewayCommandOutcome { ephemeralText, publicText? }
                                          │
                              DiscordAdapter renders:
                              editReply → ephemeral (lists/errors, SEC-6/NFR-3)
                              sendMessage to thread → public audit line (NFR-3)
```

### 1.2 Data flow for a turn after this task (bridge, conversation-first)

```
gateway_conversations.workspace_root  (NEW, migration 0028, NULL = inherit)
        │ non-NULL? must still be in allowlist + on disk, else FAIL CLOSED (Data-2)
        ▼
gateway_bindings.workspace_root       (unchanged semantics — default for new threads)
        ▼
IWorkspaceProvider.getWorkspaceRoot() (active Electron folder)
        ▼
error reply "No workspace is open in Ptah…" / "workspace no longer available — run /workspace use"
```

One exported function, `resolveEffectiveWorkspaceRoot()`, is used by the bridge (turn), `/sessions`, `/session use`, and `/workspace use` no-op detection, so list/validation/turn always agree (AC-7.2, AC-2.1).

---

## 2. Command Surface Design (Discord)

### 2.1 Command tree — five top-level commands, registered via bulk-overwrite PUT

The existing `/ptah` has a **required top-level `prompt` option**, so it cannot gain subcommands without breaking AC-1.4. We therefore keep `/ptah` untouched and register the control plane as sibling application commands whose names match the logical names in the task description literally. Discord scopes command names per application (no cross-bot collision), and per-guild registration is instant.

Registration changes from `POST` (single command) to **`PUT /applications/{appId}/guilds/{gid}/commands`** (and `PUT …/commands` for global scope) with the full array — Discord's canonical idempotent bulk overwrite. This stays **one REST call per guild** (NFR-6). Note in the file header: bulk overwrite replaces ALL of this application's commands in the scope — acceptable because Ptah owns every command it registers.

Exact JSON registered (array body of the PUT):

```json
[
  {
    "name": "ptah", "description": "Ask Ptah a question", "type": 1,
    "options": [
      { "name": "prompt", "description": "What you want Ptah to do", "type": 3, "required": true }
    ]
  },
  { "name": "sessions", "type": 1,
    "description": "List resumable Ptah sessions for this thread's workspace" },
  {
    "name": "session", "type": 1,
    "description": "Manage which Ptah session this thread drives",
    "options": [
      {
        "type": 1, "name": "use",
        "description": "Point this thread at an existing session",
        "options": [
          { "type": 3, "name": "pick", "required": true, "autocomplete": true,
            "description": "Session to attach — pick from the list" }
        ]
      }
    ]
  },
  { "name": "new", "type": 1,
    "description": "Start a fresh Ptah session in this thread" },
  {
    "name": "workspace", "type": 1,
    "description": "See or switch the workspace this thread targets",
    "options": [
      { "type": 1, "name": "list", "description": "List workspaces Ptah can target" },
      {
        "type": 1, "name": "use",
        "description": "Switch this thread to an allowed workspace",
        "options": [
          { "type": 3, "name": "pick", "required": true, "autocomplete": true,
            "description": "Workspace to target — pick from the list" }
        ]
      }
    ]
  }
]
```

### 2.2 Pick UX: autocomplete (chosen) with server-side prefix fallback

**Decision**: use Discord **autocomplete** on the two `pick` options rather than numbered-picklist replies. Justification (the two options were genuinely close): autocomplete is Discord's native closed-picklist UI, matches the ACs' language ("pick from the closed list", 25-cap references), avoids the stale-index hazard of "reply with `/session use pick:3`" (an index re-derived at execution time can silently bind to a *different but still allowlisted* target after the list changes — a bounded but real mis-switch hazard), and its cost is small: one extra branch in `handleInteraction`, three new members on the `DiscordInteractionLike` seam, and all data sources are local (SQLite/state-JSON/fs), so the 3-second autocomplete deadline is trivially met (NFR-1/2). SEC-1 makes autocomplete pure UX sugar anyway: the submitted value is *always* re-validated server-side, so a crafted API client that bypasses autocomplete hits the same closed-set membership check. The AC-3.3 "ambiguous prefix" path is retained as that fallback: a submitted value that isn't an exact match from the closed set is treated as an untrusted prefix/name and must resolve to **exactly one** member of the re-derived set, else refused.

Autocomplete choice encoding (Discord caps: 25 choices; `name` ≤ 100 chars; `value` ≤ 100 chars):

- **Session pick**: `value` = full session UUID (36 chars). `name` = `"<session name> · <uuid first 8> · <humanized last-active>"`, truncated to 100.
- **Workspace pick**: `value` = the exact allowlisted path when ≤ 100 chars; otherwise `value` = `"#<sha256 hex, first 16> "` digest of the normalized path. Validation always re-derives the allowlist and matches by (a) exact normalized path, (b) digest of each allowlisted entry, then (c) unique case-insensitive basename/prefix — all three are closed-set membership tests, so no raw path can be conjured (SEC-1). `name` = basename plus trailing path segment disambiguation for same-named folders (AC-5.1).

### 2.3 Distinguishing commands from prompts; ephemeral policy

- `handleInteraction` first checks `interaction.isAutocomplete?.()` → autocomplete branch (respond, never defer). Then routes by `commandName`: `'ptah'` → existing prompt path unchanged; `'sessions' | 'session' | 'new' | 'workspace'` → control plane; anything else → ignore (as today).
- Plain messages (`messageCreate`) are untouched — no prefix parsing on any platform (AC-8.4; Telegram/Slack adapters not modified at all).
- **Every control command defers ephemerally** (`deferReply({ ephemeral: true })`, i.e. flags 64) within the 3-second window (NFR-1). Final `editReply` carries lists/errors/confirmations ephemerally (SEC-6, NFR-3). When a mutating command succeeds, the adapter additionally posts **one public message into the thread** (`sendMessage` with `conversationId = threadId`) as the audit line, e.g. `"📌 This thread now drives session \"fix build\" (a1b2c3d4)."` (NFR-3 default). Deciding visibility at defer time is why we defer ephemeral always and post the public part as a separate message.
- Guild allow-list filtering applies to command and autocomplete interactions exactly as it does to prompt interactions today (SEC-6): same `allowedGuildIds` check at the top of `handleInteraction`; autocomplete from a non-allowlisted guild gets an empty choice list.

---

## 3. Data Model

### 3.1 Migration `0028_gateway_conversation_workspace_root`

Head verified: `0027_skill_event_reconciliation` (`libs/backend/persistence-sqlite/src/lib/migrations/index.ts` MIGRATIONS ends at version 27). New file follows the exact conventions of `0020_gateway_binding_allow_list_id.ts` (static template-literal SQL, header comment, forbid `${...}`):

```
libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.ts

export const sql = `
-- 0028_gateway_conversation_workspace_root.sql — conversation-level workspace
-- pinning for the messaging gateway (TASK_2026_156). NULL = inherit the
-- binding-level workspace_root (today's behavior). Set only by the Discord
-- '/workspace use' control command and the webview attach flow. Forward-only;
-- no backfill (existing rows inherit).
ALTER TABLE gateway_conversations ADD COLUMN workspace_root TEXT;
`;
```

Registered in `migrations/index.ts` as `{ version: 28, name: '0028_gateway_conversation_workspace_root', sql: … }`. Spec file mirrors `0024_gateway_conversations.spec.ts`: apply 0001..0028 to a fresh in-memory DB with 0024-era rows present → column exists, existing rows read back NULL (AC-7.1).

### 3.2 Fallback semantics (single shared function)

`libs/backend/messaging-gateway/src/lib/workspace-resolution.ts` exports:

```ts
export function normalizeWorkspacePath(p: string): string;
// path.resolve → forward slashes → toLowerCase → strip trailing slash
// (mirrors rpc-handlers isAuthorizedWorkspace normalization, but…)

export function isAllowlistedWorkspaceRoot(root: string, folders: string[]): boolean;
// EXACT-root match ONLY — deliberately NO subpath acceptance, unlike
// rpc-handlers/utils/workspace-authorization.ts (SEC-2). Documented divergence.

export type EffectiveWorkspace =
  | { ok: true; root: string; source: 'conversation' | 'binding' | 'active' }
  | { ok: false; reason: 'conversation-root-revoked' | 'no-workspace-open' };

export function resolveEffectiveWorkspaceRoot(args: {
  conversationRoot: string | null | undefined;   // absent in parent channels
  bindingRoot: string | null;
  workspace: IWorkspaceProvider;                  // folders + active root
}): EffectiveWorkspace;
```

Rules (AC-7.2, Data-2): if `conversationRoot` is set → it must pass `isAllowlistedWorkspaceRoot` or resolution **fails closed** with `conversation-root-revoked` (no silent fallback to binding). If NULL → `bindingRoot ?? workspace.getWorkspaceRoot() ?? no-workspace-open`. On-disk existence is a separate async check (`fs.access`) done at the two places that need it: the bridge before a turn, and `/workspace use` before writing (AC-6.3) — kept out of the pure resolver so it stays synchronously testable.

This is **not** a new platform-core port: the workspace allowlist source required by SEC-2 is exactly `IWorkspaceProvider.getWorkspaceFolders()`, which `ElectronWorkspaceProvider` populates from the persisted `ptah.workspaces` list (restored + stale-pruned in `apps/ptah-electron/src/activation/workspace-restore.ts`). `GatewayService` and the bridge already inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER`. We must NOT reuse `rpc-handlers/utils/workspace-authorization.ts` (forbidden import + it accepts subpaths, which SEC-2 forbids here); we reimplement the normalization locally with exact-root semantics.

### 3.3 `/workspace use` clears the session (SEC-4, AC-6.4)

`ConversationStore` gains a transactional method:

```ts
setWorkspaceRootAndClearSession(id, workspaceRoot): GatewayConversation
// single better-sqlite3 txn: UPDATE gateway_conversations
//   SET workspace_root = ?, ptah_session_id = NULL, last_active_at = ? WHERE id = ?
```

so there is no window where the new root and the old session coexist. The command service then calls `attachedSessionRegistry.detach(oldUuid)` (Data-5). No-op path (AC-6.5): if the pick normalizes to the current *effective* root, reply "already targeting X" and change nothing (session kept).

### 3.4 Full `ConversationStore` / type changes

- `GatewayConversation` (types.ts) gains `workspaceRoot: string | null`.
- `ConversationRow`, `SELECT_COLS`, `toConversation`, `insert` (explicit NULL — AC-7.3) updated.
- New methods (same style: prepare/run + re-read + throw-if-vanished, txn where multi-write):
  - `setWorkspaceRoot(id, root)` — used by webview `attachSession` (AC-7.4).
  - `setWorkspaceRootAndClearSession(id, root)` — `/workspace use` (§3.3).
  - `setPtahSessionIdAndWorkspaceRoot(id, uuid, root)` — txn used by `GatewayService.attachSession` so the invariant `isResumable(ptahSessionId, effectiveWorkspace(conversation))` holds atomically after a webview attach (Data-3, AC-7.4).
  - `findBySessionId(sessionUuid): GatewayConversation[]` — durable ownership check for AC-3.4 ("another thread on any binding already drives this uuid").
- `/session use` deliberately does **not** write `workspace_root` (AC-3.9): it validates the pick against the *current effective* workspace and writes only `ptah_session_id` (via existing `setPtahSessionId`). Contrast documented in code: the webview attach flow *does* stamp the conversation root because it carries the session's authoritative root.
- Binding-level `workspace_root` semantics unchanged (Data-4): still written by approve/webview-attach; still the default for new conversations.

---

## 4. Hexagonal Placement, Ports & DI

### 4.1 Placement summary

| Piece | Lives in | Why |
|---|---|---|
| Interaction parsing, Zod schemas, ephemeral/defer/respond mechanics, outcome rendering | `messaging-gateway/src/lib/adapters/discord/` (`discord.adapter.ts`, new `discord-command.schema.ts`) | Adapter logic stays behind `IMessagingAdapter`; only the adapter knows Discord payload shapes (SEC-8 at the boundary) |
| Command semantics (five commands), gates SEC-5/7, AC-3.x refusal logic | NEW `GatewayCommandService` in `messaging-gateway/src/lib/commands/` | Platform-neutral orchestration; GatewayService stays a façade (already 1,160 lines); Telegram/Slack parity later = new adapter surface only (AC-8.3) |
| Reply text formatting | NEW `commands/command-replies.ts` (pure functions) | Reused verbatim by future Telegram/Slack parity; keeps service spec assertions on structured data |
| Effective-workspace resolution + allowlist membership | NEW `messaging-gateway/src/lib/workspace-resolution.ts` | Shared by command service AND bridge (bridge already imports messaging-gateway) |
| Turn-in-flight signal | NEW `ConversationTurnTracker` in `messaging-gateway/src/lib/turn-activity-tracker.ts` | Written by the bridge (which depends on messaging-gateway — correct edge direction), read by the command service (AC-3.6/4.3/6.6, NFR-4: per-conversationKey, so other conversations are never blocked) |
| Session listing port `IGatewaySessionLister` | interface in `messaging-gateway/src/lib/session-lister.interface.ts`; impl `MetadataGatewaySessionLister` in `apps/ptah-electron/src/services/gateway/` | Same pattern as `ITokenVault` (interface in lib, Electron host registers impl). messaging-gateway must not grow an `agent-sdk` dependency, and `SessionMetadataStore.getForWorkspace` alone is WRONG cross-workspace (see §4.2) |
| Session activity port `ISessionActivityProbe` | interface in `messaging-gateway/src/lib/session-activity.interface.ts`; impl = inline `useFactory` in `apps/ptah-electron/src/di/phase-2-libraries.ts` wrapping `TOKENS.AGENT_ADAPTER.isSessionActive` | AC-3.5 needs `IAgentAdapter.isSessionActive` without coupling messaging-gateway to `shared`/agent types |
| Conversation-first turn resolution | `gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` | It owns turn execution (replaces `binding.workspaceRoot ?? active` at :143-144) |
| Migration | `persistence-sqlite` | Owns all migrations |

**No new platform-core port and no platform-core changes**: the only platform capability needed (workspace allowlist + active root) is already `IWorkspaceProvider`. Everything else is domain-shaped and follows the established consumer-side-port pattern inside messaging-gateway. messaging-gateway and gateway-chat-bridge gain **zero** imports from `rpc-handlers` or `platform-*` adapter libs (DoD #4).

### 4.2 Why the session lister is host-implemented and aggregate-scanning

`SessionMetadataStore` (agent-sdk) is backed by `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` = `WorkspaceAwareStateStorage`, whose `get()` delegates to the **active** workspace's storage. So `getForWorkspace(otherRoot)` while a different workspace is active reads the wrong storage file and returns nothing — the PM's flagged verification concern is confirmed real. Additionally, gateway turns running in a non-active root can write their metadata into the *active* workspace's storage (workspaceId field still correct), so per-storage placement is unreliable in both directions.

`MetadataGatewaySessionLister` therefore resolves `WorkspaceAwareStateStorage` directly (Electron app already owns it, `phase-1-infra.ts:144`) and:
1. reads the `ptah.sessionMetadata` key from the **default storage AND every registered workspace storage** (`getAllWorkspacePaths()` + `getStorageForWorkspace()` — no active-workspace switch, so zero interference with the desktop user),
2. concatenates, filters by `normalize(workspaceId) === normalize(requestedRoot)` (forward-slash compare like `getForWorkspace`), excludes `isChildSession`,
3. dedupes by `sessionId` (max `lastActiveAt` wins), sorts desc, caps at 25 and reports `truncated: boolean` (AC-2.2).

Port shape:

```ts
export interface GatewaySessionSummary {
  sessionId: string; name: string; lastActiveAt: number;
}
export interface IGatewaySessionLister {
  listForWorkspace(workspaceRoot: string): Promise<{
    sessions: GatewaySessionSummary[]; truncated: boolean;
  }>;
}
```

All local JSON reads — comfortably inside NFR-2's 5 s and the 3 s autocomplete window.

### 4.3 DI tokens + registration sites

New `GATEWAY_TOKENS` entries (`di/tokens.ts`, same `Symbol.for('Ptah…')` convention):

| Token | Bound to | Registered where |
|---|---|---|
| `GATEWAY_COMMAND_SERVICE` | `GatewayCommandService` | `registerMessagingGatewayServices` (lib register.ts) |
| `GATEWAY_TURN_TRACKER` | `ConversationTurnTracker` | `registerMessagingGatewayServices` |
| `GATEWAY_SESSION_LISTER` | `IGatewaySessionLister` | **host** — `apps/ptah-electron/src/di/phase-2-libraries.ts`, next to `GATEWAY_TOKEN_VAULT`, before `registerMessagingGatewayServices` |
| `GATEWAY_SESSION_ACTIVITY_PROBE` | `ISessionActivityProbe` | **host** — same place, `useFactory` over `TOKENS.AGENT_ADAPTER` (resolve-time, so phase ordering is safe) |

**Electron-only, deliberately**: `registerMessagingGatewayServices`/`registerGatewayChatBridge` are invoked only from `apps/ptah-electron/src/di/phase-2-libraries.ts:175-176` (verified — no VS Code/CLI call sites). The VS Code and CLI containers never construct the gateway, so no registration is added there; the register.ts doc-comment gains the two new host preconditions (lister + probe), mirroring the existing `GATEWAY_TOKEN_VAULT` contract. `GatewayService` gains one constructor injection (`GATEWAY_COMMAND_SERVICE`) used solely to call `adapter.setCommandHandler?.(commandService)` inside `wireAdapter`/`maybeStartDiscord` — no cycle (the command service injects stores/ports, never `GatewayService`).

`IMessagingAdapter` gains an **optional** member so Telegram/Slack and every existing test fake compile unchanged (AC-8.1, NFR-7):

```ts
setCommandHandler?(handler: IGatewayCommandHandler): void;
```

### 4.4 Command-plane contracts (messaging-gateway `commands/gateway-command.types.ts`)

```ts
export type GatewayCommand =
  | { kind: 'sessions' }
  | { kind: 'session-use'; pick: string }        // UNTRUSTED string
  | { kind: 'new' }
  | { kind: 'workspace-list' }
  | { kind: 'workspace-use'; pick: string };     // UNTRUSTED string

export interface GatewayCommandInvocation {
  platform: GatewayPlatform;
  externalChatId: string;      // parent channel id (thread case) or channel id
  threadId?: string;           // present iff invoked inside a thread
  allowListId?: string;        // guild id (rate limiting, SEC-7)
  command: GatewayCommand;
}

export interface GatewayCommandOutcome {
  ephemeralText: string;       // always set: list / error / confirmation echo
  publicText?: string;         // set on successful mutation → adapter posts to thread
}

export interface GatewayAutocompleteRequest {
  externalChatId: string; threadId?: string; allowListId?: string;
  target: 'session-pick' | 'workspace-pick';
  query: string;               // current focused text (untrusted, used only to filter)
}

export interface IGatewayCommandHandler {
  handleCommand(inv: GatewayCommandInvocation): Promise<GatewayCommandOutcome>;
  handleAutocomplete(req: GatewayAutocompleteRequest):
    Promise<ReadonlyArray<{ name: string; value: string }>>;
}
```

### 4.5 `GatewayCommandService` behavior matrix (per command)

Common preamble for every command: (1) rate-limit 60/min keyed on `allowListId` (same sliding-window shape as `GatewayService.handleInbound`, own counter map — SEC-7); (2) `bindings.findByExternal(platform, externalChatId)`; pending → ephemeral pairing *guidance without the code* ("This channel is awaiting approval in the Ptah desktop app.") — never `upsertPending`, never re-sends the code (SEC-5); rejected/revoked/missing → generic ephemeral refusal with no data disclosure (AC-2.6/5.6, SEC-6). (3) Conversation resolution: thread → `conversations.findByExternal(binding.id, threadId)`; for **mutating** commands with no row yet → `resolveOrAdopt(binding.id, threadId)` (identical to what the next plain message would do on the Discord attach path — keeps adoption semantics in one place); parent channel → no conversation (read-only allowed per AC-2.5/5.5; mutating refused with in-thread guidance per AC-3.8/4.6/6.8).

- **`/sessions`** — `resolveEffectiveWorkspaceRoot` (conversation → binding → active; parent channel uses binding-effective). Revoked conversation root → fail-closed error telling the user to `/workspace use` (consistent with the turn path). Then `lister.listForWorkspace(root)` → format ≤25 entries `name · uuid8 · humanized(lastActiveAt)`, mark `conversation.ptahSessionId` as **(current)** (AC-2.4), truncation note (AC-2.2), empty → "No resumable sessions for `<basename(root)>`" (AC-2.3), parent-channel variant appends "attach requires a Ptah thread" (AC-2.5). Ephemeral only.
- **`/session use <pick>`** — thread-only. Mid-turn gate: `turnTracker.isBusy(conversationKey)` → refuse "finish or wait for the current turn first" (AC-3.6). Re-derive effective root; re-run `lister.listForWorkspace(root)`; resolve `pick` against that closed set (exact UUID → unique prefix/name; 0 or >1 matches → "re-run /sessions" error, AC-3.3). Then, in order: `resumability.isResumable(uuid, root)` (AC-3.2, same gate as `attachSession`); `attachedSessionRegistry.bindingFor(uuid)` set and ≠ this binding → "in use elsewhere" (AC-3.4); `conversations.findBySessionId(uuid)` owned by a *different* conversation row → same refusal (durable half of AC-3.4); `activityProbe.isActive(uuid)` → "session is currently running" (AC-3.5). On success: `setPtahSessionId(conversation.id, uuid)`; `registry.detach(oldUuid)` + `registry.attach(uuid, String(binding.id))` (AC-3.7, SEC-3, Data-5). Never touches `workspace_root` (AC-3.9). Outcome: ephemeral confirmation + public audit line.
- **`/new`** — thread-only; mid-turn gate (AC-4.3). No row or NULL session → idempotent "already fresh" (AC-4.2). Else `clearPtahSessionId` + `registry.detach(uuid)` (AC-4.1); conversation-scoped only — binding-scoped `detachSession` untouched (AC-4.5). Next message starts fresh via the bridge's existing first-turn path (AC-4.4). Public audit line on actual clear.
- **`/workspace list`** — `workspace.getWorkspaceFolders()` verbatim (SEC-2/AC-5.2 — no other source, no parsing), disambiguated basenames, current-effective marker (conversation- or binding-effective per context, AC-5.1), zero-folders message pointing at the desktop app (AC-5.3), 25-cap + truncation note in provider order (AC-5.4 — the provider list carries no MRU info; documented). Works in threads and parent channels (AC-5.5). Ephemeral.
- **`/workspace use <pick>`** — thread-only (AC-6.8: no binding-default mutation from chat); mid-turn gate (AC-6.6). Resolve `pick` against the freshly re-read folder list (exact normalized path → digest → unique basename/prefix; miss → refusal, SEC-1/AC-6.2). `fs.access` the target → "workspace no longer available" on miss (AC-6.3). Equal to current effective root → no-op reply, session kept (AC-6.5). Else `setWorkspaceRootAndClearSession(conversation.id, pickedPath)` + `registry.detach(oldUuid)`; confirmation explicitly states a new session starts on the next message (AC-6.4, SEC-4). Writes ONLY the conversation row — never `setActiveFolder`, never `bindings.setWorkspaceRoot`, never another conversation (AC-6.7); previous workspace's sessions untouched (AC-6.9). Ephemeral confirmation + public audit line.

Nothing in the command path calls `messages.insert` (Data-6) or emits `inbound` (AC-1.3).

### 4.6 `ConversationTurnTracker`

```ts
@injectable() export class ConversationTurnTracker {
  begin(key: ConversationKey): void;   // increment counter
  end(key: ConversationKey): void;     // decrement, delete at 0
  isBusy(key: ConversationKey): boolean;
}
```

Counter-based (a queued turn behind a running one keeps the key busy). The bridge marks it in `onInbound`:

```ts
this.turnTracker.begin(conversationKey);
void this.queue
  .enqueue(conversationKey, () => this.runTurn(event))
  .catch(() => undefined)
  .finally(() => this.turnTracker.end(conversationKey));
```

TASK_2026_155 interplay: the 155 fix guarantees the enqueue promise settles even when the watchdog fires (Promise.race + sealed finally), so `end()` always runs and busy-state cannot leak. After a watchdog fire, the abandoned continuation is already inert (`cancellation.cancelled` blocks `bindSession`/chunk appends), so a `/session use` issued right after the watchdog reply cannot race a late rebind — the mid-stream lost-update hazard in AC-3.6's rationale is closed from both sides.

---

## 5. Security Enforcement Points (SEC-1..8 → code)

| SEC | Enforcement location(s) |
|---|---|
| SEC-1 no raw paths/ids trusted | `GatewayCommandService` re-derives session set (`IGatewaySessionLister`) and folder set (`IWorkspaceProvider.getWorkspaceFolders()`) **at execution time** and resolves the pick by closed-set membership only (`workspace-resolution.ts` + lister match). Autocomplete is advisory; crafted values hit the same checks. Adapter passes strings, decides nothing. |
| SEC-2 allowlist source | `workspace-resolution.ts:isAllowlistedWorkspaceRoot` — exact-root normalized match against `getWorkspaceFolders()` (= persisted `ptah.workspaces` on Electron). No subpaths (deliberate divergence from `rpc-handlers` helper, documented in the file header); no UNC/tilde/relative acceptance because comparison is post-`path.resolve` exact-equality against provider entries. |
| SEC-3 contention | `GatewayCommandService` session-use gate: `AttachedSessionRegistry.bindingFor` + `ConversationStore.findBySessionId` + `ISessionActivityProbe.isActive`; registry kept consistent (attach new / detach old) in `/session use`, `/new`, `/workspace use` so the existing webview-resume block (`PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD` binding in register.ts) keeps functioning. |
| SEC-4 switch clears session | `ConversationStore.setWorkspaceRootAndClearSession` (single txn) — the only write path for conversation `workspace_root` from chat; `/session use` validates `isResumable(uuid, effectiveRoot)` before linking; bridge fail-closed on revoked conversation root means no resume ever runs against an unvalidated root. |
| SEC-5 approval gate | Preamble of `GatewayCommandService.handleCommand` (`bindings.findByExternal`, approved-only; pending → guidance without code; never `upsertPending`). Autocomplete for non-approved bindings returns []. |
| SEC-6 disclosure | `DiscordAdapter`: guild allow-list check precedes any handling (commands + autocomplete, same code as prompts); all list/error output via ephemeral `editReply`; only success audit lines are public (NFR-3). Non-approved replies carry no session/workspace data (command-replies.ts fixed strings). |
| SEC-7 rate limit | Sliding-window 60/min per `allowListId` inside `GatewayCommandService.handleCommand` + `handleAutocomplete` (same constant/shape as `GatewayService.handleInbound:841-856`; separate counter map because commands bypass `handleInbound`). |
| SEC-8 boundary validation | `discord-command.schema.ts` (Zod): schemas for command interaction (commandName enum, subcommand, `pick` string ≤ 200 chars, channel/guild/user ids) and autocomplete payloads; parsed in `DiscordAdapter.handleInteraction` before an invocation object is built; parse failure → ephemeral generic error, `catch (error: unknown)` throughout. |

---

## 6. Interaction with TASK_2026_155 (bridge changes, no regressions)

Changes to `gateway-chat-bridge.ts` are confined to (a) workspace resolution at the top of `runTurn` and (b) tracker begin/end in `onInbound`:

```ts
// runTurn — replaces lines 143-151
const conversation = event.conversation;               // now carries workspaceRoot
const resolved = resolveEffectiveWorkspaceRoot({
  conversationRoot: conversation.workspaceRoot,
  bindingRoot: binding.workspaceRoot,
  workspace: this.workspace,
});
if (!resolved.ok) {
  await this.sendError(route, resolved.reason === 'conversation-root-revoked'
    ? 'This thread\'s workspace is no longer available in Ptah. Run /workspace use to pick another.'
    : 'No workspace is open in Ptah. Open a project folder, then try again.');
  return;
}
// + async fs.access(resolved.root) — miss → same revoked-style error (fail closed)
const workspaceRoot = resolved.root;
```

Everything downstream is untouched: `resolvePremiumContext(workspaceRoot)` already takes the resolved root as input (enhanced prompts/plugins/MCP now simply follow the conversation-level root — parity preserved); watchdog, `TurnCancellation`, seal-once `finally`, zero-event sentinel, fallback-start, and `endSessionAfterTurn` are byte-identical. `pumpStream`'s first-`sessionId` rebind (`bindSession`) remains the first-turn persistence path (AC-4.4). The early-return error paths above run before the watchdog is armed and still hit the `finally` seal — same contract as the existing "no workspace" return? **No** — note: the existing `!workspaceRoot` return at :145-151 exits *before* `sealTurn` is defined; the new code keeps that exact position/behavior (sendError drains directly), so sealing semantics are unchanged. The tracker `begin/end` wraps the whole enqueue (§4.6) and cannot alter turn timing.

`GatewayService.attachSession` (webview flow) changes one call: `setPtahSessionId(conversation.id, uuid)` → `setPtahSessionIdAndWorkspaceRoot(conversation.id, uuid, workspaceRoot)` — the binding-root write stays (Data-4), and the AC-7.4 invariant now holds under conversation-first resolution even if the binding root is later repointed.

---

## 7. File-by-File Change List

### Create

| # | File (all under `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang/`) | Responsibility |
|---|---|---|
| C1 | `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.ts` | §3.1 ALTER TABLE (static SQL, header comment) |
| C2 | `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.spec.ts` | Column exists post-migration; 0024-era rows NULL |
| C3 | `libs/backend/messaging-gateway/src/lib/workspace-resolution.ts` | `normalizeWorkspacePath`, `isAllowlistedWorkspaceRoot` (exact-root), `resolveEffectiveWorkspaceRoot`, workspace-pick digest helper |
| C4 | `libs/backend/messaging-gateway/src/lib/workspace-resolution.spec.ts` | Precedence, fail-closed, normalization (case/slashes/trailing), subpath rejection, digest matching |
| C5 | `libs/backend/messaging-gateway/src/lib/turn-activity-tracker.ts` | `ConversationTurnTracker` (§4.6) |
| C6 | `libs/backend/messaging-gateway/src/lib/turn-activity-tracker.spec.ts` | begin/end nesting, isBusy, key isolation |
| C7 | `libs/backend/messaging-gateway/src/lib/session-lister.interface.ts` | `IGatewaySessionLister`, `GatewaySessionSummary` |
| C8 | `libs/backend/messaging-gateway/src/lib/session-activity.interface.ts` | `ISessionActivityProbe { isActive(sessionUuid: string): boolean }` |
| C9 | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.types.ts` | §4.4 contracts |
| C10 | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.ts` | §4.5 behavior matrix, SEC-1/3/4/5/7 gates, autocomplete provider |
| C11 | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.spec.ts` | Primary AC coverage (see §8) |
| C12 | `libs/backend/messaging-gateway/src/lib/commands/command-replies.ts` | Pure reply/choice formatting (truncation notes, current markers, humanized times, disambiguated basenames) |
| C13 | `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command.schema.ts` | Zod schemas for command + autocomplete interaction payloads (SEC-8) |
| C14 | `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts` | §4.2 aggregate-scan lister over `WorkspaceAwareStateStorage` |
| C15 | `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.spec.ts` | Cross-storage aggregation, dedupe, child-session exclusion, cap/truncated |

### Modify

| # | File | Change |
|---|---|---|
| M1 | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` | Import + append `{ version: 28, … }` |
| M2 | `libs/backend/messaging-gateway/src/lib/types.ts` | `GatewayConversation.workspaceRoot: string \| null` |
| M3 | `libs/backend/messaging-gateway/src/lib/conversation.store.ts` (+ `conversation.store.spec.ts`) | §3.4 columns + 4 new methods |
| M4 | `libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts` | Optional `setCommandHandler?(handler)` |
| M5 | `libs/backend/messaging-gateway/src/lib/adapters/discord/discord.adapter.ts` (+ `.spec.ts`) | Seam: `deferReply(opts?: { ephemeral?: boolean })` (impl passes flags 64), `options.getSubcommand()`, `options.getFocused()`, `isAutocomplete?()`, `respond(choices)`; routing per §2.3; invocation build + outcome rendering (ephemeral edit + public thread send); `setCommandHandler` storage |
| M6 | `libs/backend/messaging-gateway/src/lib/adapters/discord/discord-command-registration.ts` (+ `.spec.ts`) | Five-command array (§2.1), PUT bulk overwrite per guild / global |
| M7 | `libs/backend/messaging-gateway/src/lib/gateway.service.ts` (+ `.spec.ts`) | Inject `GATEWAY_COMMAND_SERVICE`; `wireAdapter` calls `adapter.setCommandHandler?.(…)`; `attachSession` → `setPtahSessionIdAndWorkspaceRoot` |
| M8 | `libs/backend/messaging-gateway/src/lib/di/tokens.ts` | 4 new tokens (§4.3) |
| M9 | `libs/backend/messaging-gateway/src/lib/di/register.ts` | Register command service + turn tracker; doc host preconditions (lister, probe) |
| M10 | `libs/backend/messaging-gateway/src/index.ts` | Export new ports/types/resolver/tracker (bridge + electron host need them) |
| M11 | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts` (+ `.spec.ts`) | §6 resolution + fs-exists fail-closed; inject `GATEWAY_TURN_TRACKER`; begin/end in `onInbound` |
| M12 | `apps/ptah-electron/src/di/phase-2-libraries.ts` | Register `GATEWAY_SESSION_LISTER` (class C14) + `GATEWAY_SESSION_ACTIVITY_PROBE` (factory over `TOKENS.AGENT_ADAPTER`) before `registerMessagingGatewayServices` |
| M13 | `apps/ptah-docs/src/content/docs/automation/messaging/discord.md` (+ touch `automation/messaging/index.md` if it lists capabilities) | AC-1.5: thread-per-session product story + the five commands; AC-8.3: "Discord-only for now" note |
| M14 | `.ptah/specs/TASK_2026_156/future-enhancements.md` (task folder, new) | Telegram `setMyCommands` / Slack manifest parity deferral record (AC-8.3) |

No changes to: Telegram/Slack adapters, `StreamCoalescer`, `MessageStore`, `binding.store.ts`, RPC handlers/`rpc.types.ts` (no new RPC namespace — the control plane is chat-side, not webview-side), `platform-core`, watchdog constants.

---

## 8. Test Strategy

All tests use the existing seams — fake `DiscordInteractionLike`/`DiscordClientLike` objects, in-memory better-sqlite3, `GatewayTestOverrides`, constructor-injected fakes. No live Discord (NFR-7, DoD #1).

| Component | Spec file | Key cases |
|---|---|---|
| Migration 0028 | C2 (new) | applies on a DB built through 0027 with 0024-era rows; column NULL; forward-only |
| ConversationStore | extend `conversation.store.spec.ts` | workspaceRoot round-trip; `setWorkspaceRootAndClearSession` atomicity (both fields in one txn); `setPtahSessionIdAndWorkspaceRoot`; `findBySessionId`; insert keeps NULL (AC-7.3) |
| workspace-resolution | C4 (new) | conversation→binding→active precedence (AC-7.2); revoked conversation root fails closed (Data-2); exact-root only — subpath/UNC/tilde/case/trailing-slash rejected or normalized (SEC-2); digest closed-set matching |
| ConversationTurnTracker | C6 (new) | busy across queued turns; end-on-settle; per-key isolation (NFR-4) |
| GatewayCommandService | C11 (new, primary suite) | per-command matrix of §4.5: SEC-5 gates (pending/rejected/unknown, no code spam, no upsertPending); SEC-7 61st command dropped; AC-2.1..2.6 list shapes incl. current-marker + truncation + empty; AC-3.1..3.9 (untrusted pick re-validation, ambiguity, registry/durable-row/active refusals, mid-turn refusal, registry swap, no workspaceRoot write); AC-4.1..4.6 idempotency + conversation-scoping; AC-5.1..5.6; AC-6.1..6.9 (allowlist miss, deleted-on-disk, no-op, session cleared + registry detach, no setActiveFolder/binding write); Data-6 (no messages.insert — assert fake store untouched) |
| DiscordAdapter | extend `discord.adapter.spec.ts` | `/ptah` path regression (AC-1.4 — existing tests must pass unmodified); control commands never reach the inbound listener (AC-1.3); guild allow-list on commands + autocomplete (SEC-6); Zod rejection → ephemeral error, no handler call (SEC-8); ephemeral defer for all commands within handler entry (NFR-1); public audit send only when `publicText` present; autocomplete respond ≤ 25 |
| Command registration | extend `discord-command-registration.spec.ts` | PUT (not POST) with 5-command array; one call per guild; global fallback; error surfacing |
| GatewayService | extend `gateway.service.spec.ts` | `attachSession` stamps conversation workspace_root + invariant (AC-7.4); `setCommandHandler` wired on start for discord (incl. test-override adapters without the method → no throw); binding-scoped `detachSession` unchanged (AC-4.5) |
| GatewayChatBridge | extend `gateway-chat-bridge.spec.ts` | conversation-root-first turn; NULL conversation root → binding → active (AC-8.2 degradation); revoked/missing root → fail-closed error, no session start; tracker busy during turn incl. watchdog-fire path then released; ALL existing 155 specs (seal-once, cancellation, zero-event sentinel, watchdog) pass unmodified |
| MetadataGatewaySessionLister | C15 (new) | aggregates default + all workspace storages; filters by normalized workspaceId; dedupes; excludes children; sorts desc; caps at 25 + truncated flag |

Manual smoke pass (DoD #2) scripted in the PR description: fresh thread → `/sessions` → `/session use` → context continues; `/new` → fresh; `/workspace list` → `/workspace use` → next turn in picked root; migration applies on an existing `~/.ptah/state/ptah.sqlite`.

---

## 9. Phased Delivery Order (developer batches)

**Batch 1 — Data layer & messaging-gateway foundations** (no behavior change; everything compiles green alone)
C1, C2, M1 (migration); M2, M3 (store + type); C3, C4 (resolution); C5, C6 (tracker); C7, C8, C9 (ports + command types); M8, M9, M10 (tokens/register/barrel). *Dependencies: none.*

**Batch 2 — Bridge conversation-first resolution + webview attach alignment** (first behavioral change; ships safely because all conversation roots are still NULL)
M11 (bridge: resolution + tracker wiring + spec), M7-part-1 (`attachSession` → `setPtahSessionIdAndWorkspaceRoot` + spec). *Depends: Batch 1.*

**Batch 3 — Command service + Electron host collaborators**
C10, C11, C12 (service + replies + spec); C14, C15, M12 (lister + probe + phase-2 registration). *Depends: Batch 1 (parallelizable with Batch 2 except the shared tracker/types, which Batch 1 already landed).*

**Batch 4 — Discord surface** (user-visible switch-on)
M4 (interface), C13 (Zod), M5 (adapter routing/autocomplete/ephemeral + spec), M6 (PUT bulk registration + spec), M7-part-2 (`setCommandHandler` wiring + spec). *Depends: Batch 3.*

**Batch 5 — Docs, deferral record, regression sweep**
M13, M14; `npm run typecheck:all`, `npm run lint:all`, affected Jest suites; manual Discord smoke checklist (DoD #2/#3). *Depends: Batch 4.*

---

## 10. Risks & Alternatives Considered

1. **Autocomplete vs numbered-picklist replies** — chose autocomplete (justified §2.2). Residual risk: the `DiscordInteractionLike` seam grows three members; mitigated by keeping every new member optional-or-defaulted so all existing fakes compile, and by the prefix-resolution fallback meaning autocomplete failures degrade to typed picks, not broken commands.
2. **Per-conversation vs per-binding workspace** — per-conversation chosen (design directive + AC-6.7: two threads on one binding must drive two roots). Binding-level root remains the inherited default; rejected alternative (mutating binding root from chat) is explicitly out of scope (AC-6.8) because it retargets every future thread from a public channel.
3. **Migration backfill** — none: NULL inherits binding-level, which is exactly today's behavior for every existing row (AC-7.1/8.2). Backfilling `binding.workspace_root` into conversations was rejected: it would freeze conversations onto roots the user never explicitly pinned and break the "binding default can evolve" semantics.
4. **Discord 100-char choice-value limit vs long Windows paths** — digest fallback (§2.2); still closed-set membership, SEC-1 unaffected. Alternative (index-based values) rejected for stale-index mis-switch risk.
5. **`SessionMetadataStore` cross-workspace skew** — confirmed real (§4.2); mitigated by aggregate-scan lister. Alternative (raw `~/.claude/projects` JSONL listing) rejected: no friendly names (AC-2.1) and materially slower. Residual: sessions created before metadata existed won't list — same limitation the webview sidebar has today.
6. **Bulk PUT overwrite** replaces all app commands in scope — acceptable (Ptah owns its commands); global registration keeps the documented ~1 h propagation caveat (NFR-6) in the file header and docs. Users must re-run "Register commands" from the Gateway tab once after upgrade; docs note it.
7. **Generic command names (`/new`, `/sessions`)** — Discord namespaces commands per application (shown with the bot's avatar), so collisions with other bots are cosmetic only. Alternative single `/ptah-ctl` command rejected: worse discoverability and the ACs name the commands users should see.
8. **Turn-tracker leakage wedging mutating commands** — the 155 fix guarantees queue settlement (watchdog), and `end()` runs in a `.finally` on the enqueue promise; tracker is also process-local so a crash resets it with the process (NFR-5 posture identical to `AttachedSessionRegistry`).
9. **Pending-binding UX from commands** — SEC-5 forbids code-spam; the guidance reply intentionally omits the pairing code (the code flows only through `handleInbound`'s one-shot prompt), trading a small UX seam for a smaller disclosure surface.
