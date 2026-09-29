# Architecture lane: chat transcript persistence, turn lifecycle, file-tool rendering

Read-only evidence for TASK_2026_576_e16a. All citations opened and confirmed in the working tree (branch `main`). Paths are repo-relative; line numbers are 1-based.

## Q1. Chat transcript persistence and reload

- `libs/shared/src/lib/types/execution/node.ts:136` — `ExecutionNode` is the persisted/rendered execution node: `type` (line 140), `toolName` (147-148), `toolInput` (150), `toolOutput` (152), `toolCallId` (154), `parentToolUseId` (159), `children` (207), `startTime`/`endTime`/`duration` (186-191), `tokenUsage`/`cost`/`model` (192-197). Doc comment at 129-134 states it is for "storage, rendering, and historical messages" — the frontend builds trees at render time from flat events.
- `libs/shared/src/lib/types/execution/node.ts:273` — `JSONLMessage` (273-308) is the raw Claude CLI JSONL line shape; `JSONLMessageType` union at 260-265 includes `'result'`.
- `libs/shared/src/lib/types/messages/session.ts:11` — `StrictChatMessage` (11-30): `id`, `sessionId`, `type: 'user' | 'assistant' | 'system'`, `contentBlocks`, `metadata` (20), `cost` (23), `tokens` (24-28), `duration` (29). `StrictChatSession` at 59-80.
- Persistence model: **the SDK's native JSONL transcript is the only message store.** `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:339-346` — `SessionMetadataStore` doc: "Minimal storage for session UI metadata. Relies on SDK's native ~/.claude/projects/ for message persistence." Write-serialization queue at 358; shutdown flush helper `flushSessionMetadataStores` at 329-337.
- Load path (frontend): `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:80` — `SessionLoaderService`. `switchSession` documented at 584-587 ("ExecutionNode tree with tool calls, thinking blocks"); sends the `chat:resume` RPC at 693-699 (with `historyPage` tail request at 699); reads `events`/`stats`/`resumableSubagents`/`cliSessions` from the reply at 747-750; replays via `SessionHistoryReplayer.replay` at 775.
- Load path (backend): `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:97` registers `chat:resume`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:800` handles it ("Load session history from JSONL files"); `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:33` (`ChatHistoryReadService`) calls `historyReader.readSessionEvents` at 105.
- JSONL reader: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:401` — `readSessionEvents` resolves the sessions directory and reads `<sessionsDir>/<sessionId>.jsonl` via `JsonlReaderService` (`this.jsonlReader.readJsonlMessages`, lines 409, 424-434; `JsonlReaderService` type imported at line 65 from `./helpers/history/jsonl-reader.service`). It also streams persisted `cost-state` lines from the same file (`readLastSavedCostState`, 367-387).
- Resume reply contract: `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:240` — `ChatResumeResult`. `events?: FlatStreamEventUnion[]` at 251 ("Full streaming events for session history replay — the ONE transcript this reply carries"); `historyPage` cursor at 256; `stats?: SessionStatsEntry | null` at 264. Params `ChatResumeParams` at 212-237. RPC method registry: `libs/shared/src/lib/types/rpc.types.ts:695`.
- Replay into the UI tree: `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:98` — `SessionHistoryReplayer` injects `StreamingHandlerService` (100) and exposes `replay` (191); replayed flat events are folded back into `ExecutionNode` trees by the same streaming handler used live.

## Q2. How the frontend knows a TURN ended

- Event constant: `libs/shared/src/lib/types/messages/message-constants.ts:138` — `SESSION_TURN_ENDED: 'session:turnEnded'`.
- Payload type: `libs/shared/src/lib/types/sdk-hook.types.ts:115` — `SdkTurnEndedPayload` (115-123): `sessionId`, `cwd`, `lastAssistantMessage`, `backgroundTasks`, `sessionCrons`, `terminalReason`, `timestamp`. Doc at 106-114: "Emitted after the SDK's Stop hook fires." Registered in the payload map at `libs/shared/src/lib/types/messages/payload-map.ts:365` (`'session:turnEnded': SdkTurnEndedPayload`). Zod schema `SdkTurnEndedPayloadSchema` at `libs/shared/src/lib/types/sdk-hook.schemas.ts:78`.
- Frontend handler chain: `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:118` subscribes `MESSAGE_TYPES.SESSION_TURN_ENDED`; dispatch `case MESSAGE_TYPES.SESSION_TURN_ENDED` at 169 → `libs/frontend/chat/src/lib/services/chat.store.ts:269` calls `this.turnEndHandler.handleTurnEnded(payload)` → `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:92` `handleTurnEnded` (finalizes the in-flight assistant message, stamps `pendingBackgroundTasks`/`pendingSessionCrons` per doc at 50-58). Failure twin: `handleTurnFailed` at 212, `SdkTurnFailedPayload` at `sdk-hook.types.ts:132`.
- Related raw CLI marker (not the UI signal): `JSONLMessageType` member `'result'` at `libs/shared/src/lib/types/execution/node.ts:265`.

## Q3. File-writing tool calls in the transcript

- Tool-name → input type map: `libs/shared/src/lib/type-guards/guards/unions.ts:95` — `ToolInputMap` (95-116): `Read: ReadToolInput` (96), `Write: WriteToolInput` (97), `Edit: EditToolInput` (98), `NotebookEdit: NotebookEditToolInput` (111), etc. **No `MultiEdit` key** — the union at 55-69 has no MultiEdit input either.
- Input shapes carrying `file_path`: `libs/shared/src/lib/type-guards/guards/fs.ts:2` (`ReadToolInput`), `:11` (`WriteToolInput`, `file_path` at 13), `:18` (`EditToolInput`, `file_path` at 20), `:29` (`NotebookEditToolInput`, uses `notebook_path`, guard at 211 checks `notebook_path`). Type guards: `isWriteToolInput` 187, `isEditToolInput` 198, `isNotebookEditToolInput` 211. Outputs: `EditToolOutput` 74-80, `WriteToolOutput` 133-139 (both carry `file_path`).
- `MultiEdit` exists only as a backend name-set constant: `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:40` and `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:50` — `const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit'])`.
- Transcript representation: file tools are ordinary `ExecutionNode`s — `toolName` + `toolInput` + `toolOutput` at `libs/shared/src/lib/types/execution/node.ts:147-152`. There is no dedicated delete-tool input type in `libs/shared/src/lib/type-guards`; deletions ride `Bash` (`BashToolInput` is in `unions.ts` map). See "Uncertain".
- Renderers (all in `libs/frontend/chat-ui/src/lib/molecules/tool-execution/`):
  - `diff-display.component.ts:34` — selector `ptah-diff-display`, class `DiffDisplayComponent` at 117; renders the Edit/Write diff view.
  - `tool-output-display.component.ts:57` — instantiates `<ptah-diff-display>`; gates on the Edit tool at 135 (`if (node?.toolName !== 'Edit') return null`) and 145.
  - `tool-input-display.component.ts:227-234` — branches on `toolName === 'TodoWrite'` (228), `=== 'Edit'` (231), `=== 'Read'` (234); `isWriteTool = toolName === 'Write'` at 267.
  - `tool-call-header.component.ts:236-242` — icon/label heuristic regex `/read|write|edit|replace|create_file|patch_file/` over the lowercased tool name.
  - Other molecules in the same folder: `tool-call-header.component.ts`, `tool-input-display.component.ts`, `tool-output-display.component.ts`, `code-output.component.ts`, `todo-list-display.component.ts`, `code-fence.ts`.

## Q4. Existing per-turn metadata mechanisms and backend session storage

- Per-message metadata map: `StrictChatMessage.metadata?: Readonly<Record<string, unknown>>` at `libs/shared/src/lib/types/messages/session.ts:20`.
- Per-message accounting fields: `cost` (session.ts:23), `tokens { input, output, cacheHit }` (24-28), `duration` (29).
- Per-node accounting on the execution tree: `ExecutionNode.tokenUsage` (`MessageTokenUsage`, `libs/shared/src/lib/types/execution/node.ts:58-67`), `cost` (195), `duration` (191), `model` (197), fields at 186-197.
- Live per-turn stats event: `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:26` — `SessionStatsResultEvent` (`cost` at 28, `tokens` at 29); `SessionStatsSnapshotEvent` at 45; doc comments at 43 and 77-90 describe the **per-turn footer** fields and how a turn's stats fold into the finalized message without overwriting `cost/tokens/duration` with `undefined`.
- Session-level accounting DTO: `SessionStatsEntry` at `libs/shared/src/lib/types/rpc/rpc-session.types.ts:193` (`totalCost` at 203, `knownCost` at 209); doc at 180-192 names the three producers: sessions list `session:stats-batch`, the resume reply (`chat:resume` → `stats`), and the live `session:stats` broadcast.
- Backend persistence to disk:
  - Session UI metadata: `SessionMetadataStore` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:346`) with a coalesced write queue (358) over `WorkspaceAwareStateStorage`/`IStateStorage.update` (comment at 321-323).
  - Cost state: the backend persists a `cost-state` line inside the session's own SDK JSONL — `readLastSavedCostState` streams `'"cost-state"'` lines from `<sessionsDir>/<sessionId>.jsonl` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:367-387`).
  - Message transcript: not written by Ptah; the Claude SDK writes `~/.claude/projects/<workspace>/<id>.jsonl` (store doc at `session-metadata-store.ts:339-344`; `ChatSessionSummary.hasTranscript` doc at `node.ts:240-252` explains the CLI may prune it after `cleanupPeriodDays`).
- Per-turn UI consumer already renders this: see Q7's footer (`message-bubble.component.html:156-173`).

## Q5. Nx tags and dependency rules

Tags (from each `project.json`, `name` + `tags`):

- `libs/frontend/chat/project.json` — `@ptah-extension/chat`, tags `['scope:webview', 'type:feature']`
- `libs/frontend/chat-ui/project.json` — `@ptah-extension/chat-ui`, tags `['scope:webview', 'type:feature']`
- `libs/frontend/git-ui/project.json` — `@ptah-extension/git-ui`, tags `['scope:webview', 'type:feature']`
- `libs/frontend/ui/project.json` — `@ptah-extension/ui`, tags `['scope:webview', 'type:ui']`
- `libs/frontend/core/project.json` — `@ptah-extension/core`, tags `['scope:webview', 'type:core']`

Rule enforcement: `@nx/enforce-module-boundaries` at `eslint.config.mjs:222` (`'error'`, `enforceBuildableLibDependency: true`, line 225). `checkDynamicDependenciesExceptions` (narrow `/services` subpaths plus `marketplace/harness`) at 248-253. `depConstraints` at 254-402, verbatim:

- `sourceTag: 'scope:shared'` → `onlyDependOnLibsWithTags: ['scope:shared']` (255-258)
- `sourceTag: 'scope:extension'` → `['scope:shared', 'scope:extension']` (259-262)
- `sourceTag: 'scope:webview'` → `['scope:shared', 'scope:webview']` (263-266)
- `sourceTag: 'scope:landing'` → `['scope:shared', 'scope:landing', 'scope:web', 'scope:api-contracts']` (270-278)
- `sourceTag: 'scope:web'` → `['scope:shared', 'scope:web', 'scope:api-contracts']` (284-290)
- `sourceTag: 'scope:app'` → `['scope:shared', 'scope:api', 'scope:api-contracts']` (294-301)
- `sourceTag: 'scope:api'` → `['scope:shared', 'scope:api', 'scope:api-contracts']` (304-311)
- `sourceTag: 'scope:api-contracts'` → `['scope:api-contracts']` (314-317)
- `sourceTag: 'scope:electron'` → `['scope:shared', 'scope:electron', 'scope:extension']` (318-325)
- `sourceTag: 'scope:cli'` → `['scope:shared', 'scope:cli', 'scope:extension']` (326-333)
- `sourceTag: 'scope:e2e'` → `['scope:shared', 'scope:e2e']` (338-341)
- `sourceTag: 'type:application'` → `['type:feature', 'type:data-access', 'type:ui', 'type:util']` (342-350)
- `sourceTag: 'type:app'` → `['type:feature', 'type:data-access', 'type:ui', 'type:util', 'type:core']` (354-363)
- `sourceTag: 'type:feature'` → `['type:feature', 'type:data-access', 'type:ui', 'type:util', 'type:core']` (364-373)
- `sourceTag: 'type:data-access'` → `['type:data-access', 'type:util']` (374-377)
- `sourceTag: 'type:ui'` → `['type:ui', 'type:util']` (378-381)
- `sourceTag: 'type:util'` → `['type:util']` (382-385)
- `sourceTag: 'type:core'` → `['type:core', 'type:util']` (386-389)
- `sourceTag: 'type:e2e'` → `['type:feature', 'type:data-access', 'type:ui', 'type:util', 'type:core']` (390-401)

Consequence for a new per-turn card: `chat`/`chat-ui`/`git-ui` are all `scope:webview` + `type:feature`, so a card living in `chat-ui` (`type:feature`) may depend on `ui` (`type:ui`) and `core` (`type:core`), and `chat` may depend on `chat-ui`. The dynamic `chat` → `git-ui` import is legal because both are `scope:webview` + `type:feature`.

## Q6. file-link-router.service.ts: git-ui reach and host detection

- Dynamic import: `libs/frontend/chat/src/lib/services/file-link-router.service.ts:121` — `const git = await import('@ptah-extension/git-ui');` then `git.GitReviewService` (122) and `git.DiffTabsService` (123). Why-dynamic comment at 57-63 (git-ui carries Monaco + the dock; static import would bloat the eager chat chunk and load the dock on VS Code where it does not exist). Dock is revealed before the import so both fetch in parallel (104-119).
- Host detection: `file-link-router.service.ts:96` — `if (this.vscode.isElectron) { openInDock } else { openInVsCode }`. `vscode` is `VSCodeService` injected at 68 and imported from `@ptah-extension/core` at 2-8.
- Detection symbol in core: `libs/frontend/core/src/lib/services/vscode.service.ts:171` — `get isElectron(): boolean { return this._config().isElectron === true; }` (doc at 168-170). Default config `isElectron: false` at 82. `ElectronLayoutService` (also injected, `file-link-router.service.ts:69`) gates the dock layout.

## Q7. Transcript list rendering in libs/frontend/chat

- List component: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:143` — selector `ptah-chat-transcript`; class `ChatTranscriptComponent` at 168.
- Iteration: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:34-38` — `@for (msg of vm().messages; track trackByMessageId($index, msg); let i = $index)`. Each message sits in a virtualized slot wrapper (`.chat-msg-slot`, 41-45) with `ptahTranscriptSlot`; the per-message card `<ptah-message-bubble>` is rendered at line 50-60 (`[message]="msg"`, `[messageIndex]="i"`, streaming/finalizing flags).
- Per-message card: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html` — assistant branch starts at line 1; streaming execution tree `<ptah-execution-node>` at 104-105; **per-turn footer** at 156-173 (`data-testid="message-metadata-footer"` at 158, `ptah-token-badge` 164, `ptah-cost-badge` 169, `ptah-duration-badge` 172, gated on `message().tokens !== undefined || message().duration !== undefined` at 156); a collapsed-state inline footer with the same badges at 126-143. A new per-turn card slots in either inside `ptah-message-bubble`'s footer block or as a sibling inside the `.chat-msg-slot` wrapper in the transcript `@for`.

## Uncertain

- Deletes: no dedicated `Delete`/`Remove` tool input type exists in `libs/shared/src/lib/type-guards` (searched `MultiEdit|NotebookEdit` across `libs/shared/src/lib`, `MultiEdit` across `libs/`). Deletions appear to ride the `Bash` tool; I did not trace a delete-specific renderer. `MultiEdit` itself has no typed input and no frontend renderer — only the backend `EDIT_TOOL_NAMES` sets in skill-synthesis.
- `chat-message-handler.service.ts:118/169` and `message-constants.ts:138` line contents were confirmed via grep with line numbers, not by a full file read; surrounding context was not reviewed.
- `jsonl-reader.service.ts` (`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts`) was referenced but not opened; the `findSessionsDirectory` path resolution (exact on-disk directory) was not confirmed.
- `chat.store.ts:269` and `session-loader.service.ts` internals beyond the switch-session flow (e.g. in-place reload paths at 659-673) were only partially reviewed; no claim is made about the compaction reload path beyond what the cited comments state.
- The exact wire parser used for `session:turnEnded` (`parseSdkTurnEndedPayload`, `libs/shared/src/lib/types/sdk-hook.parsers.ts:155`) was not opened.
