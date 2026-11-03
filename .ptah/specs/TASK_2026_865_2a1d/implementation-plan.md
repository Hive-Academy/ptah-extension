# Implementation Plan - TASK_2026_865_2a1d

"Continue with <provider>" carry-over after a provider switch (Electron first), in both
directions, from the re-auth banner button and from `/compact`.

Revision 2 (user answer on K2, decisions.md rows 20-23; Gate 2 round 2 findings F1 and F3).
The change-to-section map is in `## Revision 2`. The Revision 1 map is kept in `## Revision 1`.

Paths below are relative to the worktree root
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`
(written `<wt>/`). Line numbers were read on `ff97e436a`. Revision 2 rechecked that no
code under `libs/` or `apps/` changed between `ff97e436a` and `34b2eaed8` (spec-only commits).

## Inputs and constraints

- Requirements used: `task-description.md` (Revision 1 and the orchestrator edits to AC 3.1, 3.2
  and 3.8; D9 and AC 3.10 already ask for both directions), `decisions.md` (rows 5-16 and 18
  binding; rows 20-23 binding for this revision; row 19 stays with the user),
  `implementation-plan-review.md` (Gate 2 rounds 1 and 2), `task-description-review.md`
  (rounds 1-2), `context.md`, `HANDOFF.md`, and the "Scope note for the orchestrator" in
  `provider-readiness/.ptah/specs/TASK_2026_864_1376/implementation-plan.md:1364-1403`.
- Corrections applied: decisions.md row 8 (no field added to the refusal; D1 superseded),
  row 10 (transfer policy and redaction), row 11 (bounded read, notice after binding), row 12
  (strict read cap, AC 3.1, 3.2 and 3.8 as edited), row 20 (K2 rejected: both directions),
  row 21 (Codex -> Claude must become a real switch, without touching the Claude-session
  refusal), row 22 (`/compact` is a second trigger of the same carry-over), row 23 (Gate 2
  round 2 F1 and F3 folded in exactly as stated).
- Design handoff used: none. No designer: one button on an existing banner (decisions.md row 2).
- Missing decision-critical input: none blocks this plan. Two items need the user and are in
  `## User-reserved items`: U1 (whether a native Codex resume after a switch changes),
  U2 (the transfer disclosure when `/compact` is the trigger). Neither blocks any batch: the
  plan is built on the recommended option of each, and the other option is a bounded change.
  Requirement wording that no longer fits is listed in `## Proposed requirement changes`;
  `task-description.md` is not edited.
- Parallel task TASK_2026_864_1376: its planned spec `chat-session.connection-switch.spec.ts`
  asserts `AUTH_REQUIRED` and that `resumeSession` is not called
  (`TASK_2026_864_1376/implementation-plan.md:1296-1324`). This plan still does not edit
  `continueSession`, `autoResumeIfInactive`, the slash router or the resolver, so that spec stays
  valid. The `/compact` trigger is in the renderer, before `chat:continue` is sent.

## Codebase evidence

| # | Evidence | Location | Architectural implication |
| - | -------- | -------- | ------------------------- |
| E1 | The mismatch refusal is thrown only when `existingIdentity` is present on the Claude SDK route: `servingProviderId` is compared with `resolveAuthForPath(...)` and `rejectStoredProviderMismatch` is thrown. | `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:268-284`, `:542-553` | Eligibility mirrors this comparison (stored `providerId` against the active `providerId` for the session's folder). It never calls it with the stored identity (AC 2.3). |
| E2 | A stored proxy-era Codex Claude SDK session (`providerId 'openai-codex'`, runtime `claude-sdk`) is refused earlier, with `rejectLegacyCodexProfile` and a CODEX code. | same file `:273-275`, `:535-539` | Such sessions are not eligible (AC 1.2: other refusals keep today's banner). |
| E3 | (Rev 2, restated) A native Codex session (`existingIdentity.runtime === 'codex-app-server'`) takes the `resumeNative` branch and returns at `:251-266` before any active-provider comparison. Its stored identity has `providerId 'openai-codex'` (`libs/shared/src/lib/types/session-runtime.types.spec.ts:19-24`). | same file `:190-266` | A native Codex session is never refused for a mismatch, so it never shows the banner. After a switch to Claude, a plain send resumes it on Codex (`chat-session.service.ts:2409`) and `/compact` compacts it natively on Codex (E40). The Codex -> Claude direction therefore needs its own trigger (Decision K18). |
| E4 | The active `providerId` is `'anthropic'` for both `apiKey` and `claudeCli`. Otherwise it is the third-party id, for example `'openai-codex'`. `resolveActiveAuthWithDefault` changes only the auth method and never the `providerId`. | `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:87-92`, `:115-128`, `:155-164` | The synchronous `resolveActiveAuthForPath(folder).providerId` equals the value the resolver compares. A host check can use it without the private credential probe. |
| E5 | The stored identity comes from `storedChatRuntimeIdentity(sessionId, metadata, workspaceId)`: `metadata.codexExecution` when present, else `runtime 'claude-sdk'` with `providerId` from metadata or `'claude-cli'`. | `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:72-86`; `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts:31-43` | The carry-over computes the stored identity with the same helper the refusal and the resume use, for both runtimes. |
| E6 | `chat:continue` refusal shaping: `{ success:false, sessionId, error: message, errorCode:'AUTH_REQUIRED', providerId }`. The `/compact` path refuses at `prepare` (`chat-slash-command-router.service.ts:334`) and result-shapes at `:451-468`. | `chat-session.service.ts:2484-2495`, helper `:872-886`; slash router `:333-334`, `:451-468` | Untouched by this plan. AC 1.5 is pinned by strict-shape specs (Component 10). |
| E7 | Existing refusal specs use `toMatchObject`, not full shape. | `chat-session.native.spec.ts:576-627`; `chat-slash-command-router.native.spec.ts:357` | AC 1.5 needs new `toStrictEqual` cases beside them. |
| E8 | `startSession` creates the session on the active provider: it calls `prepare(config, undefined, modelIsStored)` with `modelIsStored = !options.model`, or `resolveClaudeExecution` when no runtime profile is bound. It returns `{success:true}` without a session id, streams to `tabId`, and admits host routing for a plain prompt. | `chat-session.service.ts:986-1134`, launch `:1379-1524` (prepare `:1462-1469`), routing admission `:1113-1116` | The carry-over reuses `startSession` (AC 2.1, 2.2, 2.4, 5.2). The new session id reaches the renderer only through `SESSION_ID_RESOLVED`. |
| E9 | Host routing sends the turn text to a decision model (`ScopeCheckService.assess`). | `chat-session.service.ts:970-983`; `chat/host-routing/host-routing.coordinator.ts:192-235`; `libs/backend/lane-routing/src/lib/scope/scope-check.service.ts:75` | The carry-over turn must not be admitted, or transcript text reaches a third consumer (AC 8.1). |
| E10 | `resolveSessionFolder` returns the session's own authorized, real folder or throws `RpcUserError` (`SESSION_NOT_FOUND` / `SESSION_FOLDER_UNAVAILABLE`). | `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:89-101`; `session-folder.ts:36-58`, `:61-97` | AC 2.6: the requested `workspacePath` must canonically equal this folder. The read and the start both use it. |
| E11 | The tail-window precedent: `readHistoryForCuration(..., { tailBytes })` reads through `jsonlReader.readJsonlTail` and projects user/assistant records after the last `compact_boundary`. Errors are swallowed to `[]`. | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:102-116`, `:905-994`, projection `:784-840` | A sibling carry-over read uses the same tail primitive with its own projection, and throws instead of returning `[]`. |
| E12 | `readJsonlTail` reads at most `maxBytes` from the end of the file, drops a partial first line, ignores the 50 MB guard and accepts an `AbortSignal`. | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:710-748`, `JsonlTailOptions :119-122` | The Claude read is bounded by construction (AC 3.4, 3.10). |
| E13 | Record flags: `isMeta`, `isSynthetic`, `isSidechain`, `isCompactSummary`. | `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:79-87`; `jsonl-reader.service.ts:939-940`; `message-transform/message-transform-helpers.ts:33-38` | Sidechain records are excluded (AC 3.9); the compaction summary is identifiable (AC 3.8). |
| E14 | Content extraction lives in `HistoryEventFactory` (`extractTextContent`, `extractContentForCuration`). | `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts:513-563` | A third extractor, `extractContentForCarryOver`, goes beside them. |
| E15 | File attachments are text blocks (`<file path="..." ...>`, `<folder path="..." />`, one `<system-reminder>` block). Images are `type:'image'` blocks. | `libs/backend/agent-sdk/src/lib/helpers/attachment-processor.service.ts:142`, `:227`, `:257`, `:297`, image `:166-176` | AC 3.7 placeholders are text rewrites; AC 3.6 also strips the reminder. |
| E16 | `redactSecrets` replaces literal values only and is not exported. The pattern redactors are module-private. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:34-47`; `libs/backend/codex-runtime/src/lib/codex-stderr-tail.ts:6-15`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:38-42` | A private pattern list in the carry-over renderer (Decision K6). |
| E17 | RPC registration chain: `RpcMethodRegistry` entry plus `RPC_METHOD_ENTRIES` (compile-enforced); `ChatRpcHandlers.METHODS` feeds the manifest; the allowlist spec checks the `chat:` prefix; the rpc-surface spec derives from the manifest. | `libs/shared/src/lib/types/rpc.types.ts:1040-1050`, `:3386-3405`; `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:117-128`, `:242-253`; `rpc-allowlist.spec.ts:81-128`; `apps/ptah-electron/src/di/rpc-surface.spec.ts:77-82` | Two registry entries, two `RPC_METHOD_ENTRIES` keys, `METHODS` entries and two `wire` calls. |
| E18 | The host-source baseline flags only names matching `/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i`. | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-22` | The new names do not match. |
| E19 | The replay sanitizer allow-list is only checked to be a subset of `RPC_METHOD_NAMES`. | `apps/ptah-electron/src/replay/scenario-sanitizer.ts:94-120`; `scenario-sanitizer.spec.ts:286-297` | The new methods stay out of it. |
| E20 | Chat sub-services are `CHAT_TOKENS` singletons registered in dependency order. | `libs/backend/rpc-handlers/src/lib/chat/tokens.ts:10-40`; `chat/di.ts:1-35`, `:96-101` | New `CHAT_TOKENS.CARRY_OVER`, registered after `SESSION`. |
| E21 | Renderer banner: one global signal `{providerId, message}`, set by `flagAuthRequired`, cleared by `clearAuthRequiredBanner`. | `libs/frontend/core/src/lib/services/auth-state.service.ts:186-189`, `:342`, `:1217-1227` | Gains `generation` and an optional `origin`. |
| E22 | The only AUTH_REQUIRED handler is `handleAuthRequired` (`message-sender.service.ts:143-157`). The continue path has `sessionId`, `activeTabId` and `resolvedWorkspacePath` at the call (`:806-848`). Both `send` (`:378`, routes to continue at `:415-416`) and `continueExistingSessionForQueueFlush` (`:664`) reach `runContinueConversation` (`:690`), which sends `chat:continue` at `:806-829`. | `libs/frontend/chat/src/lib/services/message-sender.service.ts` | The offer origin is passed from `:848`. (Rev 2) `runContinueConversation` is the single renderer point every follow-up `/compact` passes through (Component 13). |
| E23 | `SESSION_ID_RESOLVED` calls `tabManager.attachSession(owner.tab.id, realSessionId)` with no ownership check, falls back to the active draft tab, then calls `sessionLoader.loadSessions()`. | `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:139-180`; `attachSession` `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2139-2157` | This binding point needs the carry-over guard (AC 7.6, 7.7). |
| E24 | The stream router appends a new session id to the tab's bound conversation. | `libs/frontend/chat-routing/src/lib/stream-router.service.ts:164-192`; `conversation-registry.service.ts:143-160` | AC 4.2 needs no new code. |
| E25 | Tab-scoped transient notice: `ActionBannerService.showInfo(message, tabId, durationMs)`. | `libs/frontend/chat/src/lib/services/action-banner.service.ts:33-85`; `chat-view.component.ts:404-410`, html `:111-121` | The AC 4.3 notice reuses it. |
| E26 | Banner view: `chat-view.component.html:147-154`, handlers `chat-view.component.ts:279`, `:343-357`; the banner has two buttons. | `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts:21-85` | One added `<button>` input/output pair. |
| E27 | The renderer RPC default timeout is 30 s; an explicit `options.timeout` wins. `CHAT_ADMISSION_RPC_TIMEOUT_MS` = 90 s + 30 s. | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:22-41`; `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:33`, `:40`, `:47-48` | The carry-over call passes `CHAT_ADMISSION_RPC_TIMEOUT_MS`; the host read timeout (20 s) and the start fit well inside it. |
| E28 | Safe error-name logging helper. | `libs/shared/src/lib/utils/loggable-error-name.ts:34` | Logs record session ids and `loggableErrorName(error)` only (AC 8.5). |
| E29 | Nx tags: `rpc-handlers`, `agent-sdk` and `codex-runtime` are `scope:extension, type:feature`; `ptah-electron` is `scope:electron, type:app`; `chat` is `scope:webview, type:feature`; `core` is `scope:webview, type:core`. `agent-sdk` already imports `@ptah-extension/codex-runtime` (`session-history-router.ts:1-4`); `ptah-electron` already imports both (`codex-runtime-composition.ts:53-61`). | the `project.json` of each project | No new edge and no new project. |
| E30 | `launchSdkSession`: `prepare`/`resolveClaudeExecution` with no identity runs inside a callback at `:1462-1469` and returns `{config, execution}`; then `pendingLineage.set` at `:1473`, then `sdkAdapter.startChatSession` at `:1501-1506` (Codex through `withCodexStartLineage`, a metadata write for the NEW session). The execution names its provider: `seed.providerId` on the native branch (`workspace-provider-profile-resolver.ts:255-265`), `providerProfile.providerId` on the Claude branch, `undefined` profile when the shared env serves the active provider (`:385-399`). `ChatSessionService` injects the optional `activeProvider` resolver (`:359-362`). | `chat-session.service.ts` | The provider can be re-validated after `prepare` and before any lineage or adapter call, with no resolver change. |
| E31 | The `startSession` catch logs the raw error (`:1124-1127`), sends it to Sentry (`:1128`, body `:2643-2646`) and returns `error.message` (`:1129-1133`). The safe-name precedent is `chat-session.service.ts:977-981`, pinned by `chat-session.host-routing.spec.ts:455-476`. A Sentry fake exists in `chat-session-auth.spec.ts:74-136`. | listed | A carry-over launch needs its own failure branch. |
| E32 | `ContentBlock` carries `id`, `name` and `tool_use_id`. | `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:125-135` | A `tool_result` can be named through the `tool_use` id seen in the window. |
| E33 | `SESSION_ID_RESOLVED` carries only `{ tabId, realSessionId }`. When the tab has a rendered surface (`renderedSurfaceFor`, `:402-407`), the handler calls `streamRouter.onSurfaceCreated` and returns at `:837-852`, before `ChatStore.handleSessionIdResolved` (`:853`). So that branch never attaches the tab. | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:828-855` | (Rev 2, F3) The claimed-surface branch must call the carry-over claim itself and handle all three results (Component 8). |
| E34 | Every renderer launch on an existing tab enters `MessageSenderService` through `send` (`:378`) or `continueExistingSessionForQueueFlush` (`:664`). Both early-return through `isHeld` (`:382`, `:669`). | `libs/frontend/chat/src/lib/services/message-sender.service.ts` | A per-tab pending guard at those two entries serializes launches on the refused tab. |
| E35 | A chat-view spec harness exists: `makeHarness` (`chat-view.component.spec.ts:162`), `sessionContextTabId` (`:177`, `:613-620`), an `AuthStateService` stub (`:523-528`), an explicit provider list (`:550-634`). | `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` | The view-level tab-filter test is concrete. |
| E36 | (Rev 2) The native history route: `SessionHistoryRouter.nativeSession` selects a session whose `metadata.codexExecution.runtime === 'codex-app-server'`, validates its ids, and `nativeHistory` calls `NativeSessionHistoryPort.readHistory(session)`, which returns the complete snapshot; errors collapse to `SessionHistoryRouteError` with fixed text. The router is a `SDK_TOKENS.SESSION_HISTORY_ROUTER` singleton built with getter thunks. `ChatHistoryReadService` already injects it. | `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:9-12`, `:24-36`, `:38-120`; `libs/backend/agent-sdk/src/lib/di/register.ts:311-322`; `libs/backend/agent-sdk/src/lib/di/tokens.ts:61-64`; `chat-history-read.service.ts:72-73` | The carry-over read routes through this router (one routing rule for both session kinds). The port gains an optional bounded method; the router collapses its errors the same way. |
| E37 | (Rev 2) `readCodexSessionHistory` reads the root thread with `thread/read`; a `paginated` thread lists turns with `thread/turns/list` (`sortDirection 'asc'`, page 25, up to 400 pages) and per-turn items with `thread/items/list`; a legacy thread is read in one `thread/read { includeTurns: true }`. It then lists descendant threads with `thread/list` and hydrates them. | `libs/backend/codex-runtime/src/lib/codex-session-history.ts:55-60`, `:64-153`, `:186-257` | The full read is unbounded in turns (up to 10,000 rows) and reads subagent threads. A sibling tail reader reads the root only, newest first, with a page cap. |
| E38 | (Rev 2) The protocol allows `sortDirection: 'asc' \| 'desc'`, `limit` and `cursor` on `thread/turns/list` and `thread/items/list`, and `itemsView: 'full'` on turns. | `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:148-171`; `codex-protocol-schemas.ts:611-612` | A newest-first bounded listing is expressible without a protocol change. |
| E39 | (Rev 2) `CodexRuntime.readHistory(profile, resume, signal)` spawns a read-only app-server process (requests from the server are rejected), verifies the Codex home and closes the process in `finally`. Inbound frames are capped at 16 MiB. `CodexHistoryReader` is the interface; `CodexSessionHistory`/`CodexHistoryTurn` are exported types. | `libs/backend/codex-runtime/src/lib/codex-runtime.ts:171`, `:182-235`; `codex-app-server-process.ts:23-24`; `codex-runtime.types.ts:346-363`; `libs/backend/codex-runtime/src/index.ts:25-34` | The tail read reuses the same process lifecycle; the legacy one-frame read is bounded by the existing 16 MiB inbound cap. |
| E40 | (Rev 2) The Electron port `createElectronCodexHistoryPort` validates the native identity (`providerId === 'openai-codex'`, saved home equals current home, workspace key), builds a read-only profile, verifies the binary, races the read against a timeout (default 30 s) and an `AbortSignal`, allows two concurrent reads, and maps errors to `ElectronCodexHistoryError` codes. It is bound to `SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT`. | `apps/ptah-electron/src/di/codex-runtime-composition.ts:485`, `:505-524`, `:527-652`, `:792`, `:840` | The bounded method shares this validation, profile, timeout and scope; only the runtime call differs. No platform-cli/cli-engine binding exists for this port, so those hosts keep returning `nativePortUnavailable`. |
| E41 | (Rev 2) Codex thread items: `userMessage` (`content` with `text`, `image`, `localImage`, `audio`, `localAudio`, `skill`, `mention`), `agentMessage` (`text`, `phase`), `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall` (`server`, `tool`), `webSearch`, `imageView`, `contextCompaction` (id only, no summary text), `collabAgentToolCall`, `hookPrompt`. | `libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:96-113`, `:288-300`, `:320-399`, `:422`, `:490-506` | The native projection maps these to the same turn shape as the Claude projection. A native thread never has an in-window summary text (AC 3.8: the rendering never starts at a summary). |
| E42 | (Rev 2) Native `/compact` today: the slash router runs `requestManualCompact` (`:274-300`), resolves the stored identity, calls `prepare` with it (`:333-334`, native route because E3), and on `codex-app-server` with `commandName === 'compact'` resumes the thread if inactive and calls `runtimeControls.compact(sessionId)` (`:369-385`). | `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts` | `/compact` after a Claude switch still runs on Codex today. The redirect happens before `chat:continue` is sent, so this code stays unchanged (Component 13). |
| E43 | (Rev 2) The host classifies a slash command by `/^\/[a-zA-Z]/` on the trimmed text and takes the command name up to the first space. The renderer's send path applies `ultracode.applyKeyword` (which prefixes `ultracode: `) before the continue path, so a prefixed `/compact` is not a slash command on the host either. | `libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:38-49`, `:55-62`, `:91-103`; `libs/frontend/chat/src/lib/services/ultracode-state.service.ts:86-90`; `message-sender.service.ts:396-398` | The renderer `/compact` match mirrors the host parse exactly, on the text `runContinueConversation` receives. |
| E44 | (Rev 2) `/compact` is not in the renderer's Anthropic-only block list. Queued commands flush through `continueExistingSessionForQueueFlush`. `SendOutcome` has `success`, `error`, `cancelled`, `errorAlreadyShown`; a failure outcome is shown by `showSendFailure`. | `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:155-169`, `:185-190`, `:242-252`, `:300-325`; `message-sender.service.ts:67-74` | A redirected `/compact` reports its result through the existing send outcome; no new failure surface. |

## Architecture decision

- Chosen approach: two new chat RPC methods and two renderer triggers.
  - `chat:carry-over-check` is read-only. It reports whether a session can be carried over to
    the active provider, for a Claude SDK session and (Rev 2) for a native Codex session.
  - `chat:carry-over` re-runs the same check, reads a bounded tail of the session's history
    locally through `SessionHistoryRouter` (Claude JSONL tail, or (Rev 2) a bounded newest-first
    native Codex read), renders a bounded, redacted plain-text transcript, and starts a new chat
    through the existing `ChatSessionService.startSession` on the tab.
  - Trigger 1, the banner button (unchanged): after a mismatch refusal the renderer asks the host
    with structured ids only, binds the offer to `{sessionId, tabId, workspacePath, generation}`,
    and the click runs the carry-over. This is the Claude -> other-provider direction, because
    only Claude SDK sessions are refused (E1, E3).
  - Trigger 2, `/compact` (Rev 2, row 22): when the user sends `/compact` on a session's tab,
    the renderer asks `chat:carry-over-check` first. When eligible, it runs the same carry-over
    instead of sending `chat:continue`. When not eligible, or the check fails, it sends
    `chat:continue` exactly as today. This is the trigger for BOTH directions, and the only
    trigger for Codex -> Claude (Decision K18), because a native Codex session is never refused.
  - The relink uses the existing `SESSION_ID_RESOLVED` path, guarded by one claim function, in
    both the lifecycle branch and (Rev 2, F3) the claimed-surface branch.

  Invariants:
  - Provider pin (Rev 1 F1, Rev 2 F1): the click-time `evaluate` returns the active provider id.
    It is re-checked after the history read, and again in `launchSdkSession` after `prepare` on
    every runtime branch: the served provider of the prepared execution AND a fresh
    `resolveActiveAuthForPath(workspaceId).providerId` must both equal the pin, before
    `pendingLineage.set` and before any adapter call. A change fails the carry-over as
    `NOT_ELIGIBLE` with nothing created.
  - Safe launch failure (Rev 1 F4): a carry-over launch logs and reports only fixed text plus
    the error name.
  - Launch serialization (Rev 1 F3): while a carry-over is pending on a tab, the renderer starts
    no other launch on that tab, and the offer stays disabled until binding or a definitive
    failure.
  - Binding completeness (Rev 2 F3): every `SESSION_ID_RESOLVED` for a tab with a pending
    carry-over is claimed exactly once, whichever handler branch receives it; `'bind'` always
    attaches the owning tab and calls `completeBinding`; `'skip'` never binds a tab or surface.
  - Refusal untouched: the AUTH_REQUIRED refusal of `chat:continue` and of `/compact` is
    produced by unchanged code and reaches the renderer byte-identical whenever `chat:continue`
    is sent. A carry-over through `/compact` sends no `chat:continue`, so it produces no refusal
    at all.
- Rationale:
  - AC 1.4 and 1.5 forbid touching the refusal and allow a read-only host query. Renderer
    provider ids differ from host ids, and readiness per workspace is host knowledge (E4, E21).
  - One host check serves the query, both triggers and the click-time re-check (AC 1.7, 2.5).
    It mirrors the resolver comparison (E1, E4, E5) and never calls `prepare` with the stored
    identity (AC 2.3).
  - One history route (E36) reads both session kinds; the native tail reuses the existing port,
    process lifecycle and error collapsing (E39, E40), so AC 3.10's Codex half is real.
  - Putting the `/compact` trigger in the renderer before `chat:continue` (E22) keeps
    `continueSession`, the slash router, the resolver and the refusal untouched, covers both
    directions with one branch, and also covers queued `/compact` (E44).
  - Reusing `startSession` gives the active runtime, the default model, the error shaping and
    the streaming (AC 2.1, 2.2, 2.4, 5.2) with no parallel launch path (E8).
- Rejected alternatives:
  - An added field on the AUTH_REQUIRED refusal. Rejected by decisions.md row 8.
  - Renderer-only eligibility. It cannot see readiness per workspace and its ids differ.
  - A new launch path that bypasses `startSession`. It duplicates MCP, lineage, account gating
    and error shaping.
  - Extending `chat:continue` or `chat:start`. That changes contracts the parallel task relies on.
  - (Rev 2) A host-side `/compact` redirect inside `ChatSlashCommandRouterService`. The host
    would start a new session from inside `chat:continue`, and the renderer would need a new
    success field to know it was a carry-over (no offer generation, no pending entry, no notice
    timing). It also edits the slash router that the parallel task's contract runs through.
  - (Rev 2) Reading the full native snapshot and trimming it. It reads up to 10,000 rows and
    every subagent thread (E37), against AC 3.4 and 3.10.
  - (Rev 2) Parsing Codex rollout files from `CODEX_HOME` directly. It couples to Codex's private
    storage format; the app-server protocol is the supported reader (E37-E39).
  - (Rev 2) Refusing or redirecting a plain native Codex resume when the active provider is not
    Codex. It changes native-resume behaviour for every user; it is user-reserved (U1), not
    adopted.
  - A streaming full-file scan for exact counts. Rejected by decisions.md row 12.
  - Making `redactSecrets` public. Literal values only (E16).
  - (Rev 1) A launch nonce on `SESSION_ID_RESOLVED`. It changes the shared message, the host
    broadcaster and every consumer; per-tab serialization gives the same guarantee in `chat`.
  - (Rev 1) Pinning the provider inside `resolveExecutionProfile`. A resolver change; the
    post-`prepare` check needs none.
- Assumptions (each has a check the implementer runs):
  - A1. A Claude SDK compaction summary record carries `isCompactSummary: true` and may also be
    `isMeta`. The projection keeps it regardless of the hidden flags. Check: a fixture from a
    real compacted JSONL (content scrubbed) asserts the summary turn appears.
  - A2. On a tab still bound to the old session, the streaming handler mints streaming state for
    the new session's first assistant event, and `applyTurnState` accepts the new session's
    `generating` after `attachSession`. Check: the Component 8 integration case. If the first
    `generating` is dropped, call `tabManager.markTabStreaming(tabId)` at click and
    `markTabIdle` on failure, mirroring `message-sender.service.ts:476-477`.
  - A3. The new-session `prepare` used as a readiness probe has no lasting side effect beyond
    what `chat:start` would do. Check: read `workspace-provider-profile-resolver.ts:484-530`
    (`buildProfile`) and note any proxy start in the PR. (Rev 2) The probe now runs only after
    the cheap provider comparison finds a mismatch (Decision K22), so a same-provider `/compact`
    never probes.
  - A4. `resolvedWorkspacePath` is set on the Electron continue path
    (`message-sender.service.ts:722-745`). When unset, no offer is made and `/compact` takes
    today's path.
  - A5. The two `MessageSenderService` entries (E34) are the only renderer paths that launch on
    an existing tab. Check: search `libs/frontend` for other callers of `chat:start`,
    `chat:continue` and `chat:resume` with an existing tab's `tabId`; any found gets the guard.
  - A6. (Rev 2: resolved, no longer an assumption.) The claimed-surface branch is handled as a
    required edit (Component 8, F3).
  - A7. (Rev 2) The read-only Codex history process (E39) serves `thread/read`,
    `thread/turns/list` and `thread/items/list` from local thread storage and makes no model
    request; it also does not modify the stored thread (AC 6.1). Check: the existing history
    view already depends on the same process; the implementer confirms in the Codex app-server
    protocol docs pinned by `codex-protocol-methods.ts` that these methods are reads, and the
    Component 11 spec asserts that no `turn/start`, `thread/resume`, `thread/compact` or other
    non-read method is requested.
  - A8. (Rev 2) `thread/turns/list` with `sortDirection: 'desc'` returns the newest turns first
    for a `paginated` thread (E38). Check: one Electron manual read of a long native session,
    logged as request count and turn count only, before closing Component 11; if the server
    rejects `desc`, fall back to `asc` paging bounded by the same page cap from the cursor the
    root `thread/read` gives, and mark `coversWholeHistory = false` (reported in the PR).
  - A9. (Rev 2) After a `'skip'` in the claimed-surface branch, the skipped session still appears
    in history/the sidebar through the next session-list refresh (AC 7.6). Check: the Component 8
    integration case asserts the session list refresh is requested; if it is not, the branch
    calls the same `sessionLoader.loadSessions()` the lifecycle uses (E23) through
    `ChatStore` instead of adding a new dependency.
- Effect on existing code: `continueSession`, `autoResumeIfInactive`, the slash router, the
  resolver, the onboarding lib, the Codex sign-in code and the existing full native history read
  (`readHistory`, `readCodexSessionHistory`, `readSessionHistory`/`readSessionEvents`) are not
  changed.
  - `startSession` gains one internal carry-over launch option.
  - `MessageSenderService` gains one pending guard at each launch entry and (Rev 2) one
    `/compact` branch in `runContinueConversation`.
  - `ChatLifecycleService.handleSessionIdResolved` and (Rev 2) the claimed-surface branch of
    `ChatMessageHandlerService` each gain one claim call.
  - (Rev 2) `SessionHistoryRouter`, `NativeSessionHistoryPort`, `CodexRuntime`,
    `CodexHistoryReader` and the Electron history port each gain one bounded read method beside
    the existing full read.
  - The banner gains one button; `AuthStateService`'s banner gains `generation` and `origin`.

## Component specifications

### 1. Shared RPC contract (`chat:carry-over-check`, `chat:carry-over`)

- Purpose: the typed contract of the two new methods.
- Responsibilities: params and result types; registry entries in `RpcMethodRegistry` and
  `RPC_METHOD_ENTRIES`.
- Verified contracts and entry points: `rpc-chat.types.ts:209-223` (style of
  `ChatContinueResult`); `rpc.types.ts:11` (`export *` of `rpc-chat.types`), `:127-148` (type
  import list), `:1040-1050` (registry), `:3386-3405` (`RPC_METHOD_ENTRIES`); `RpcUserErrorCode`
  in `rpc/rpc-error-codes.types.ts:7-53` (not extended).
- Shapes (to add to `rpc-chat.types.ts`; unchanged in Rev 2, both triggers use them):
  - `ChatCarryOverCheckParams { sessionId: SessionId; workspacePath: string }`
  - `ChatCarryOverCheckResult = { eligible: true; providerId: string; providerName: string } | { eligible: false }`
  - `ChatCarryOverParams { sessionId: SessionId; tabId: string; workspacePath: string; name?: string; ptahUiFence?: boolean }`
  - `ChatCarryOverFailureReason = 'NOT_ELIGIBLE' | 'IN_FLIGHT' | 'HISTORY_UNREADABLE' | 'START_FAILED'`
  - `ChatCarryOverResult = { success: true; providerId: string; providerName: string } | { success: false; reason: ChatCarryOverFailureReason; error: string; errorCode?: RpcUserErrorCode; providerId?: string }`
- Dependencies: none new.
- Integration points: Components 4, 6, 7 and 13.
- Failure behaviour: not applicable (types only).
- Quality requirements: no transcript text in any result type; `error` is always a fixed host
  string. The check result does not reveal the source runtime (the renderer does not need it).
- Verification seam: `@ptah-extension/shared` typecheck; `host-source-registry.contract.spec.ts`
  (E18) and `scenario-sanitizer.spec.ts` (E19) pass unchanged.
- Files:
  - MODIFY `<wt>/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
  - MODIFY `<wt>/libs/shared/src/lib/types/rpc.types.ts`

### 2. Bounded Claude JSONL carry-over read (agent-sdk)

- Purpose: read the newest part of a Claude JSONL session and project it to plain turns, with
  tool calls, attachments and system content already reduced.
- Responsibilities:
  - (Rev 2) Declare the shared result type once, in `history.types.ts`:
    `CarryOverTranscript { turns: readonly CarryOverTurn[]; windowCoversWholeHistory: boolean; startsAtCompactionSummary: boolean }`,
    `CarryOverTurn { role: 'user' | 'assistant'; text: string; compactionSummary: boolean }`.
    Components 12 and 3 use the same type, so both session kinds render identically.
  - New public method `SessionHistoryReaderService.readCarryOverTranscript(sessionId,
    workspacePath, { tailBytes, signal }): Promise<CarryOverTranscript>`.
  - It validates the id (`validateSessionId`, `:320`), resolves `findSessionsDirectory`, builds
    the file path as in `:952-963`, sets `windowCoversWholeHistory = (await fs.stat(file)).size
    <= tailBytes`, then reads `jsonlReader.readJsonlTail(file, { maxBytes: tailBytes, signal })`.
  - Projection (start boundary from Rev 1, F6):
    - The start boundary is the latest non-sidechain record in the window with
      `isCompactSummary === true` (E13, A1). When one exists, the projection starts there (first
      turn, `compactionSummary: true`) and `startsAtCompactionSummary = true`. Otherwise nothing
      is cut and `startsAtCompactionSummary = false` (AC 3.8).
    - `system` records, including `compact_boundary`, are skipped as events (AC 3.6) and never
      move the boundary.
    - Skip `isSidechain` records, hidden records (`isHiddenTranscriptRecord`) except
      `isCompactSummary` ones, roles other than user/assistant, and `<task-notification>` content
      (as `:822`).
    - Merge consecutive same-role records; drop empty turns.
  - One pre-pass over the window's non-sidechain records builds `toolNamesById` from each
    `tool_use` block's `id` and `name` (E32), alive only for the call.
  - New `HistoryEventFactory.extractContentForCarryOver(content, toolNamesById)`:
    - `text` keeps its text with `<system-reminder>…</system-reminder>` removed; `<file path="P"…>…</file>`,
      `<file path="P" …/>` and `<folder path="P" />` become `[file: <basename(P)>]` (split on `/` and `\`);
    - `tool_use` becomes `[tool: <name or 'tool'>]`;
    - `image` becomes `[image omitted]`; `document` becomes `[file: <basename(title) or 'attachment'>]`;
    - `tool_result` becomes `[tool result: <name>]` when `toolNamesById.get(tool_use_id)` has a
      name, else `[tool result]`; its `content` and `is_error` are never read (AC 3.5);
    - `thinking`, `redacted_thinking` and everything else become `''`; string content gets the
      same text rules.
- Verified contracts and entry points: E11-E15, E32; `SDK_TOKENS.SDK_SESSION_HISTORY_READER` at
  `libs/backend/agent-sdk/src/lib/di/tokens.ts:61`.
- Dependencies: existing `JsonlReaderService` and `HistoryEventFactory` injections
  (`session-history-reader.service.ts:287-294`). No new DI. No barrel change.
- Integration points: (Rev 2) called only by `SessionHistoryRouter.readCarryOverTranscript`
  (Component 12) for non-native sessions.
- Failure behaviour: throws on an invalid id, a missing directory or file, a stat or read error,
  or an abort; never returns an empty result for an error; logs no content.
- Quality requirements: at most `tailBytes` bytes read (plus the 1-byte lookback of
  `readJsonlTail`); never calls `readJsonlMessages`; writes nothing.
- Verification seam: new spec with a mocked `JsonlReaderService` and a temp file for `stat`:
  - a 10x-bound fixture: `readJsonlTail` called once with `maxBytes === tailBytes`,
    `readJsonlMessages` never called, `windowCoversWholeHistory === false` (AC 3.10, Claude half);
  - `tool_use` gives the tool line and the input is absent (AC 3.5);
  - paired `tool_use`/`tool_result` with a content sentinel and `is_error: true` gives
    `[tool: Bash]` and `[tool result: Bash]`, sentinel absent; result-only gives `[tool result]`;
  - thinking, system, `compact_boundary` and the reminder removed (AC 3.6);
  - image and file placeholders, file content absent (AC 3.7); a sidechain record excluded (AC 3.9);
  - summary just inside the window, a boundary-less window (AC 3.8);
  - a `system` event after prose keeps every prose turn; a `compact_boundary` without an
    in-window summary keeps turns on both sides and `startsAtCompactionSummary === false`; two
    summaries start at the later one;
  - an invalid id throws and makes no read call (AC 2.6).
  Extractor unit cases go in `history-event-factory.spec.ts`.
- Files:
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` (Rev 2: the shared type)
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.spec.ts`
  - CREATE `<wt>/libs/backend/agent-sdk/src/lib/session-history-reader.carry-over.spec.ts`

### 3. Transcript renderer and redaction (rpc-handlers, pure)

- Purpose: turn a `CarryOverTranscript` (either session kind) into the first-turn prompt, within
  a fixed budget, with known secret patterns redacted.
- Responsibilities:
  - Constants:
    - `CARRY_OVER_READ_TAIL_BYTES = 2 * 1024 * 1024` (Claude JSONL bound);
    - (Rev 2) `CARRY_OVER_NATIVE_MAX_TURNS = 200`, `CARRY_OVER_NATIVE_MAX_TURN_PAGES = 8` (25 turns
      per page), `CARRY_OVER_NATIVE_MAX_ITEM_PAGES = 16` (total across the read) — the native
      bound passed to Component 11;
    - `CARRY_OVER_TEXT_BUDGET_CHARS = 48_000` (the rendered transcript, including the omission
      line and the truncation marker);
    - (Rev 2) `CARRY_OVER_READ_TIMEOUT_MS = 20_000` (raised from 10 s because the native read
      spawns a read-only process; still far inside the 120 s RPC timeout, E27);
    - `CARRY_OVER_INSTRUCTION`, a fixed text asking for a summary of the goal, decisions, current
      state and open next steps, replying with the summary only; it must not start with `/`.
  - `redactKnownSecrets(text)` replaces each match with `[REDACTED]` (Decision K6): an
    `Authorization:` header line; `Bearer <token>`; `sk-[A-Za-z0-9_-]{8,}`; `AKIA[0-9A-Z]{16}`;
    `gh[pousr]_[A-Za-z0-9]{20,}` and `github_pat_[A-Za-z0-9_]{20,}`; `xox[abprs]-[A-Za-z0-9-]+`;
    `AIza[0-9A-Za-z_-]{35}`; a JWT `eyJ…\.…\.…`; a PEM private key block;
    `(api[_-]?key|token|secret|password)\s*[:=]\s*<value>`. Modelled on
    `codex-stderr-tail.ts:6-15` and `route-tool-handlers.ts:38-42`. No generic base64 rule.
  - `renderCarryOverPrompt(transcript, budget = CARRY_OVER_TEXT_BUDGET_CHARS)` returns
    `{ prompt, keptTurns, omittedTurns }`, or `null` when there are no text turns:
    - labels `User:`, `Assistant:`, or `Summary of the earlier conversation:`;
    - redact each turn before measuring (rule of `codex-stderr-tail.ts:17`);
    - keep whole turns newest-first while they fit, drop the oldest first (AC 3.2);
    - a single oversize newest turn keeps its end, prefixed by `[start of this message omitted]`
      (AC 3.3);
    - omission line `Earlier conversation omitted (N turns).` only when
      `windowCoversWholeHistory` or `startsAtCompactionSummary`; otherwise
      `Earlier conversation omitted.`; the no-count line is always present when the window does
      not cover the whole history and no summary starts it; no line when everything fits and the
      window covers the whole history (AC 3.1, 3.2, 3.8);
    - `prompt = CARRY_OVER_INSTRUCTION + '\n\n<previous-conversation>\n' + transcript + '\n</previous-conversation>'`.
- Verified contracts and entry points: none external; pattern precedent E16.
- Dependencies: the `CarryOverTranscript` type only (type import from agent-sdk through
  `Awaited<ReturnType<SessionHistoryRouter['readCarryOverTranscript']>>`, the pattern at
  `session-history-router.ts:14-16`); no `cli-agent-runtime` import.
- Integration points: Component 4.
- Failure behaviour: does not throw on input; empty input returns `null`.
- Quality requirements: the rendered transcript length is at most the budget for any input.
- Verification seam: new spec — every turn in order when the history fits (AC 3.1); oldest-first
  drop with exact count / no-count line (AC 3.2); single oversize turn (AC 3.3); a property-style
  10x oversize input always within budget (AC 3.4); summary-first, summary-outside-window and
  turns-before-window cases (AC 3.8); (Rev 2) a native-shaped transcript
  (`startsAtCompactionSummary: false`, `windowCoversWholeHistory: false`) gives the no-count
  line; each secret pattern in prose and in a summary is absent from `prompt` (AC 8.2, 8.3).
- Files: CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts`,
  CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts`

### 4. `ChatCarryOverService` (rpc-handlers)

- Purpose: own the host side of the carry-over: eligibility, in-flight guard, bounded read,
  render and start, for both directions.
- Responsibilities:
  - `check(params): Promise<ChatCarryOverCheckResult>` calls `evaluate`; any throw gives
    `{ eligible:false }`.
  - `carryOver(params): Promise<ChatCarryOverResult>`:
    1. If the session id is in `inFlight`, return `IN_FLIGHT`; otherwise add it, remove it in
       `finally` (AC 5.4).
    2. Call `evaluate` (AC 1.7, 2.5). Not eligible gives `NOT_ELIGIBLE`. Otherwise keep its
       active id as `pinnedProviderId`.
    3. (Rev 2) Call `historyRouter.readCarryOverTranscript(sessionId, folder, { tailBytes:
       CARRY_OVER_READ_TAIL_BYTES, nativeBound: { maxTurns: CARRY_OVER_NATIVE_MAX_TURNS,
       maxTurnPages: CARRY_OVER_NATIVE_MAX_TURN_PAGES, maxItemPages:
       CARRY_OVER_NATIVE_MAX_ITEM_PAGES }, signal: AbortSignal.timeout(CARRY_OVER_READ_TIMEOUT_MS) })`
       (Component 12). The router picks the Claude or native reader from metadata. A throw gives
       `HISTORY_UNREADABLE`.
    4. `renderCarryOverPrompt`; `null` gives `HISTORY_UNREADABLE` (AC 5.1).
    5. Re-read `activeProviderResolver.resolveActiveAuthForPath(folder).providerId` (sync, E4).
       A difference from `pinnedProviderId` gives `NOT_ELIGIBLE` with no start.
    6. Call `session.startSession({ tabId, workspacePath: folder, prompt, name, ptahUiFence },
       { expectedProviderId: pinnedProviderId })` (Component 5).
       - `error === CARRY_OVER_PROVIDER_CHANGED` gives `NOT_ELIGIBLE`;
       - any other `!success` (including `cancelled`) gives `START_FAILED` with the start's
         `errorCode`/`providerId` and a fixed `error: "Couldn't start a new chat with
         <providerName>."` (AC 5.2, K11);
       - success gives `{ success:true, providerId, providerName }`.
  - `evaluate(sessionId, workspacePath)` is private and shared. (Rev 2: steps reordered so the
    cheap comparison precedes the probe, Decision K22; native sessions eligible.) In order:
    1. `folder = await historyRead.resolveSessionFolder(sessionId)` (E10); it must equal
       `fs.realpath(path.resolve(workspacePath))`, else not eligible (AC 2.6).
    2. `identity = storedChatRuntimeIdentity(sessionId, await metadataStore.get(sessionId),
       folder)` (E5). Source kinds:
       - `runtime === 'claude-sdk'` and `providerId !== 'openai-codex'`: Claude JSONL source;
       - (Rev 2) `runtime === 'codex-app-server'` and `providerId === 'openai-codex'`: native
         Codex source (the identity the Electron port accepts, E40);
       - anything else (proxy-era Codex Claude SDK, E2): not eligible.
    3. `activeId = activeProviderResolver.resolveActiveAuthForPath(folder).providerId` (E4);
       `activeProviderResolver` is optional and its absence means not eligible. Not eligible when
       `activeId === identity.providerId`. (This is the only difference test; it covers
       Claude -> Codex, Claude -> third party, third party -> Claude and Codex -> Claude/third party.)
    4. New-session readiness probe, only now:
       - when `runtimeProfile` is bound, `runtimeProfile.prepare({ tabId, workspaceId: folder,
         projectPath: folder, model: modelSettings.selectedModel.get() || 'default', … },
         undefined, true)`;
       - otherwise `resolveClaudeExecution(resolver, folder, model, true)` (the
         `chat-session.service.ts:1462-1469` branch).
       A throw means not eligible (AC 1.3). A `codex-app-server` result also requires
       `codexAuth.isAuthenticated() === true` (optional `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH`;
       absent means not eligible).
    5. `providerName`: `'openai-codex'` gives `'Codex'`, `'anthropic'` gives `'Claude'`, otherwise
       `getAnthropicProvider(activeId)?.name ?? activeId`
       (`libs/shared/src/lib/providers/provider-registry.ts:766-773`).
    Eligible returns `{ folder, activeId, providerName }`.
  - Logging: info `[carry-over] started { sessionId, tabId, providerId, source, keptTurns,
    omittedTurns }` (`source` is `'claude-jsonl'` or `'codex-native'`); warn `[carry-over] <step>
    failed { sessionId, error: loggableErrorName(e) }`. Never text or messages (AC 8.5). The
    service never calls Sentry.
- Verified contracts and entry points: `ChatHistoryReadService.resolveSessionFolder`
  `chat-history-read.service.ts:89`; `storedChatRuntimeIdentity` `chat-runtime-profile.service.ts:72`;
  `ChatRuntimeProfileService.prepare` `:120-140`; `resolveClaudeExecution` `:49-70`;
  `ActiveProviderResolver.resolveActiveAuthForPath` `active-provider-resolver.ts:87`;
  `ICodexAuthService.isAuthenticated` `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts:64`;
  `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH` `libs/backend/auth-providers-tokens/src/lib/tokens.ts:38`;
  `SDK_TOKENS.SESSION_HISTORY_ROUTER` `libs/backend/agent-sdk/src/lib/di/tokens.ts:62` and its
  injection precedent `chat-history-read.service.ts:72-73`; `SETTINGS_TOKENS.MODEL_SETTINGS`
  as at `chat-session.service.ts:1417-1418`; `loggableErrorName` (E28).
- Dependencies (all `@inject` tokens, pointing inward): `TOKENS.LOGGER`; `CHAT_TOKENS.SESSION`,
  `CHAT_TOKENS.HISTORY_READ`, `CHAT_TOKENS.RUNTIME_PROFILE` (optional);
  `SDK_TOKENS.SDK_SESSION_METADATA_STORE`; (Rev 2) `SDK_TOKENS.SESSION_HISTORY_ROUTER` replaces
  the direct `SDK_SESSION_HISTORY_READER` dependency;
  `AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER`, `SDK_ACTIVE_PROVIDER_RESOLVER`
  and `SDK_CODEX_AUTH` (both optional); `SETTINGS_TOKENS.MODEL_SETTINGS`.
- Integration points: `ChatRpcHandlers` (Component 6); `startSession` (Component 5);
  `SessionHistoryRouter` (Component 12).
- Failure behaviour: every failure is result-shaped with a fixed `error`; no throw escapes except
  `RpcUserError` for invalid params (Component 6); no session is created before step 6 nor on a
  provider change; the old session is only read (AC 6.1): no metadata write, no
  `resumeSession`, no `prepare` with an identity (AC 2.3), and (Rev 2) for a native source no
  native adapter call (no resume, no compact, no turn).
- Quality requirements: bounded read and time (2 MiB, or 200 turns / 24 page requests; 20 s
  abort); one in-flight carry-over per session id; `inFlight` always cleared in `finally`.
- Verification seam: new unit spec with fakes. Cases:
  - eligible mismatch: Claude -> Codex, OpenRouter -> Claude, and (Rev 2) native Codex -> Claude
    (D9, AC 1.1);
  - same provider (AC 2.5) for both kinds, with the `prepare` fake never called (K22);
  - a probe throw for each provider kind (AC 1.3); Codex not signed in;
  - a proxy-era Codex identity (E2) is not eligible;
  - (Rev 2) a native identity whose `providerId` is not `'openai-codex'` is not eligible and the
    router fake is not called;
  - folder mismatch or unknown session, with no read call (AC 2.6);
  - `prepare` never carries an identity; the fake adapter's `resumeSession` count is 0 (AC 2.3);
  - `startSession` called once with `workspacePath === folder`, no `options.model`, a prompt that
    starts with `CARRY_OVER_INSTRUCTION`, and `{ expectedProviderId: <click-time active id> }`;
  - deferred read plus provider switch: `NOT_ELIGIBLE`, `startSession` never called, no `prepare`
    after the read, zero metadata writes;
  - `CARRY_OVER_PROVIDER_CHANGED` maps to `NOT_ELIGIBLE`;
  - a start `error` holding a transcript sentinel: the RPC result and every logger call are free
    of it;
  - concurrent second call gives `IN_FLIGHT` and one start (AC 5.4);
  - unreadable or empty history (both kinds) makes no start (AC 5.1);
  - a start AUTH_REQUIRED or CODEX code passes through (AC 5.2);
  - a secret in a transcript and a summary is absent from logs and the RPC result, on success and
    a forced failure (AC 8.3, 8.5);
  - (Rev 2) the router fake receives `tailBytes === CARRY_OVER_READ_TAIL_BYTES` and the native
    bound constants (AC 3.10).
- Files: CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`,
  CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`

### 5. `startSession` carry-over launch option (rpc-handlers) (F1 completed in Rev 2)

- Purpose: start a chat on exactly the provider the carry-over checked, without host routing,
  and fail without leaking transcript text (E9, E30, E31).
- Responsibilities:
  - Optional second parameter `launch?: CarryOverLaunch` on `ChatSessionService.startSession`
    (`:986-988`); `CarryOverLaunch = { readonly expectedProviderId: string }` is declared and
    exported in `chat-session.service.ts`. The RPC path (`chat-rpc.handlers.ts:257-263`) passes
    nothing, so `chat:start` is unchanged.
  - Host routing: the admission at `:1115` runs only when `launch` is absent.
  - Provider pin (Rev 2, F1, exactly as the reviewer stated): `SdkSessionLaunch` (`:224`) gains
    `expectedProviderId?: string`. In `launchSdkSession`, right after the `prepare` /
    `resolveClaudeExecution` callback returns `{config, execution}` (`:1462-1471`) and before
    `pendingLineage.set` (`:1473`) and any `sdkAdapter` call (`:1501-1506`), when
    `expectedProviderId` is set, run `assertCarryOverProvider(execution, workspaceId,
    expectedProviderId)` on EVERY runtime branch:
    1. `activeNow = this.activeProvider?.resolveActiveAuthForPath(workspaceId).providerId`.
       Re-read here, after `prepare`, unconditionally. `undefined` (resolver not bound) or
       `activeNow !== expectedProviderId` throws.
    2. The served provider: `codex-app-server` gives `execution.seed.providerId`; `claude-sdk`
       gives `execution.providerProfile?.providerId ?? activeNow` (an `undefined` profile means
       the shared env serves the active provider, E30). A served id different from
       `expectedProviderId` throws.
    The throw is a module-private `CarryOverProviderChangedError`. Nothing after it runs: no
    lineage entry, no `startChatSession`, no `withCodexStartLineage` metadata write, no stream.
  - Safe failure (Rev 1, F4): in the `startSession` catch (`:1119-1134`), when `launch` is present:
    - `codexFailure` and `mainSessionAccountFailure` keep their fixed-text results;
    - `CarryOverProviderChangedError` returns `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }`
      (exported fixed constant), no log above debug, no Sentry;
    - any other error: `logger.warn('[carry-over] start failed', new Error(\`carry-over start
      threw ${loggableErrorName(error)}\`), { tabId })` and `sentryService.captureException(<that
      Error>, { errorSource: 'ChatSessionService.carryOverStart' })`, then `{ success:false,
      error: CARRY_OVER_START_FAILED, ...this.authErrorFields(error) }` (`:876-888`).
    The raw error, message and stack reach no logger, Sentry or result. The existing branch
    (`:1124-1133`) is unchanged for `chat:start`.
- Verified contracts and entry points: `chat-session.service.ts:224`, `:359-362`, `:986-988`,
  `:1115`, `:1119-1134`, `:1462-1473`, `:1501-1506`, `:2643-2646`; E30, E31.
- Dependencies: none new.
- Integration points: Component 4.
- Failure behaviour: as above; a provider change creates nothing and is a fixed constant that
  Component 4 maps to `NOT_ELIGIBLE`.
- Quality requirements: no change to the RPC contract or to `chat:start`; the check is one sync
  resolver read and one comparison, no I/O.
- Verification seam:
  - `chat-session.host-routing.spec.ts` (harness `:107`, `:205`): `admitUserTurn` not called for
    a carry-over launch, still called without one.
  - New `chat-session.carry-over-launch.spec.ts` (positional harness of
    `chat-session-auth.spec.ts:74-136`, Sentry fake `:89`, a `prepare` fake, an adapter fake, a
    metadata store fake, an active-resolver fake):
    - pin holds on each branch: Claude with a matching profile, Claude with an `undefined`
      profile, and a Codex execution whose `seed.providerId` matches: `startChatSession` once;
    - (Rev 2, F1 race test, the reviewer's case) `prepare` returns a Claude execution whose
      `providerProfile.providerId` equals the pin, while the active-resolver fake switches back
      to the old provider during `prepare` (the switch is applied inside the `prepare` fake
      before it resolves): `startChatSession` 0 calls, `resumeSession` 0 calls, metadata store
      writes 0 (old and new ids, including `withCodexStartLineage`), `pendingLineage` has no
      entry for the tab, result `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }`;
    - (Rev 2) the same race on the Codex branch (`seed.providerId === pin`, active switches
      during `prepare`) and on the `undefined`-profile branch: the same zero counts;
    - a served provider different from the pin (stored id in the profile; Codex execution with
      `expectedProviderId: 'anthropic'`) is refused the same way;
    - no active resolver bound: refused (fail closed);
    - (F4) `prepare` throws, and separately `startChatSession` throws, an `Error` whose message
      and stack hold a transcript sentinel: absent from every logger call (`loggedText` pattern,
      `chat-session.host-routing.spec.ts:474`), every `captureException` argument and the result;
    - without `launch`, the same throw takes today's branch (regression pin).
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts`
  - CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts`

### 6. Registration and RPC wiring (rpc-handlers)

- Purpose: expose Component 4 as two `chat:*` RPC methods through the existing patterns.
- Responsibilities:
  - `CHAT_TOKENS.CARRY_OVER = Symbol.for('ChatCarryOverService')`.
  - `registerChatServices` registers it after `SESSION` (`di.ts:101`) and updates the order
    comment (`:12-22`).
  - `ChatRpcHandlers` injects it after `permissionHandler` (`chat-rpc.handlers.ts:145-146`),
    appends `'chat:carry-over-check'` and `'chat:carry-over'` to `METHODS` (`:117-128`), wires
    both (`:255-405`), and adds the debug list entry (`:407-420`).
  - Schemas in `chat-rpc.schema.ts` with `uuidString` (`:56`) and `.strict()`:
    `ChatCarryOverCheckParamsSchema { sessionId: uuidString, workspacePath: z.string().min(1).max(4096) }`;
    `ChatCarryOverParamsSchema` adds `tabId: uuidString`, `name: z.string().max(200).optional()`,
    `ptahUiFence: z.boolean().optional()`.
  - A parse failure throws `RpcUserError('Invalid carry-over request', 'INVALID_PARAMS')`
    (pattern `:372-385`).
- Verified contracts and entry points: E17, E20.
- Dependencies: `rpc-handlers` internal only.
- Integration points: renderer `ClaudeRpcService.call`; manifest at `host-profile/manifest.ts:219`.
- Failure behaviour: invalid params raise `INVALID_PARAMS`; everything else result-shaped.
- Quality requirements: no param logging beyond `runRpc` lines (`:97-137`).
- Verification seam: `chat-rpc.handlers.spec.ts` (`METHODS` order test `:231`, constructor
  argument `:116`, delegation and `INVALID_PARAMS` cases); `chat/di.spec.ts` (`:59-60`
  pattern); `rpc-allowlist.spec.ts`, `register-shared-rpc-handlers.spec.ts`,
  `rpc-surface.spec.ts` and `container.smoke.spec.ts` pass unchanged. (Rev 2) The new
  `SESSION_HISTORY_ROUTER` dependency is already registered by `registerSdkServices`
  (`register.ts:311`) and listed in `expected-resolvable.ts`, so no smoke-list edit.
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/di.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/di.spec.ts`

### 7. Banner identity (core) and offer controller (chat)

- Purpose: bind each offer to the refusal that produced it, decide eligibility from structured
  data, run the launch for both triggers, and finish the relink safely.
- Responsibilities, `AuthStateService` (core):
  - Banner type `{ providerId; message; generation: number; origin: { sessionId; tabId;
    workspacePath } | null }`.
  - `flagAuthRequired(providerId, message, origin?)` increments a private counter and returns
    the new generation.
  - `clearAuthRequiredBanner(generation?)` clears only when no generation is given or it matches
    (AC 7.5).
  - Existing call sites and the `openai-codex` side effect (`:1217-1222`) unchanged.
- Responsibilities, `MessageSenderService` (offer origin): at `:848`, `handleAuthRequired(result,
  { sessionId, tabId: activeTabId, workspacePath: resolvedWorkspacePath })`; the origin only when
  all three are set; after flagging, `carryOver.offerFor(generation)` (not awaited, errors
  caught). Never reads `result.data.error` for this decision (AC 1.4). The `chat:start` call site
  (`:550`) passes no origin.
- Responsibilities, `ProviderCarryOverService` (new, chat, `providedIn: 'root'`):
  - Signals: `offer` (`{ generation, sessionId, tabId, workspacePath, providerId, providerName }
    | null`) and `pending`, a signal of `Map<tabId, { sessionId, generation: number | null,
    origin, bannerProviderId: string | null, providerName, trigger: 'button' | 'compact',
    rpcSettled }>`. At most one entry per open tab; deleted only on bind, skip, a definitive
    failure, a chat error for the tab, or a missing tab found at the next launch/claim.
  - `isPending(tabId)` and `isBusy(sessionId)` are the only busy predicates.
  - `offerFor(generation)` reads the banner origin and calls `chat:carry-over-check`; sets
    `offer` only if eligible and the banner generation is unchanged (AC 1.1-1.3, 1.6).
  - `start(offer)` (button trigger): click-time checks (AC 7.2) — offer generation equals the
    banner generation; the tab (`findTabByIdAcrossWorkspaces(offer.tabId)`) exists with
    `claudeSessionId === offer.sessionId`; neither `isPending(offer.tabId)` nor
    `isBusy(offer.sessionId)`. On a failed check: no RPC; clear the offer unless the failure is
    only "pending"; if the tab is gone, `clearAuthRequiredBanner(generation)` (AC 4.5). On pass:
    add `pending[tabId]` with `trigger: 'button'`, then `launch(entry)`.
  - (Rev 2) `startFromCompact({ sessionId, tabId, workspacePath, name, providerId,
    providerName })` (compact trigger, called by Component 13 after an eligible check): no-op
    with `'busy'` when `isPending(tabId)` or `isBusy(sessionId)`; otherwise add `pending[tabId]`
    with `trigger: 'compact'`, `generation` = the current banner generation when the banner's
    origin is this `{sessionId, tabId}` (so a success clears that banner and its offer) else
    `null`, and `bannerProviderId` = the banner's `providerId` in that case else `null`; then
    `launch(entry)` and return its mapped outcome (below).
  - Private `launch(entry)`: calls `chat:carry-over { sessionId, tabId, workspacePath, name,
    ...(isElectron ? { ptahUiFence:true } : {}) }` with `timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS`
    (E27), then maps:
    - success: `rpcSettled = true`; the entry stays (busy) until the claim binds it.
    - Every failure result is definitive: delete `pending[tabId]` first. UI effects then run only
      through `ownsUi(entry)`: the tab still exists and is bound to `entry.sessionId`, AND (when
      `entry.generation !== null`) the current banner generation equals `entry.generation`.
      - `NOT_ELIGIBLE`: button — if `ownsUi`, clear the offer of that generation (AC 2.5).
        compact — return `'not-eligible'` so Component 13 falls back to today's `chat:continue`.
      - `IN_FLIGHT`: no UI change; compact returns a failure outcome `'A new chat is starting in
        this tab.'`.
      - `HISTORY_UNREADABLE`: button — if `ownsUi`, `flagAuthRequired(entry.bannerProviderId,
        "Couldn't read this conversation to continue it.", entry.origin)` (AC 5.1). compact — if
        `ownsUi` and `entry.generation !== null`, the same banner replacement; otherwise return a
        failure outcome with that fixed text (shown by `showSendFailure`, E44).
      - `START_FAILED`: if `ownsUi`, `flagAuthRequired(result.providerId ??
        entry.bannerProviderId, result.error, entry.origin)` for the button trigger; for the
        compact trigger the same call with `origin` only when `entry.generation !== null`
        (otherwise no origin, so no offer is created for the active provider's own refusal),
        and the outcome is `{ success:false, errorAlreadyShown:true }` (AC 5.2).
      - A transport failure or timeout is not definitive: the entry stays (button disabled,
        sends refused) until resolution, a chat error for the tab, or the tab's removal; the
        compact trigger returns `{ success:false, error: 'A new chat is starting in this tab.' }`.
  - Launch serialization (Rev 1): `MessageSenderService.send` (`:378`) and
    `continueExistingSessionForQueueFlush` (`:664`) return early, before any RPC, when
    `carryOver.isPending(<target tab id>)`, with `{ success:false, error: 'A new chat is starting
    in this tab.' }` (the `isHeld` shape, E34).
  - `claimSessionResolution(tabId, realSessionId): 'none' | 'bind' | 'skip'` (pure for `'bind'`
    and `'none'`; it mutates only on `'skip'`):
    - `'none'` when there is no `pending[tabId]`;
    - `'none'` without consuming the entry when `realSessionId === pending.sessionId`;
    - `'skip'` when the tab is gone (AC 7.6); the entry is deleted;
    - `'skip'` when the tab is rebound (`claudeSessionId !== pending.sessionId`) (AC 7.7); the
      entry is deleted and `chat:abort { sessionId: realSessionId }` is issued (Decision K9);
    - otherwise `'bind'`.
  - `completeBinding(tabId)`, after the attach: `ActionBannerService.showInfo(NOTICE(providerName),
    tabId, CARRY_OVER_NOTICE_MS = 15_000)` with "Continued with <provider> in a new chat from a
    summary of this conversation. The original conversation is unchanged. This conversation's
    text was sent to <provider>." (AC 4.3, 8.4); `clearAuthRequiredBanner(pending.generation)`
    only when `generation !== null` (AC 4.4, 7.5); clear the offer of that generation; delete
    `pending`. Idempotent: a second call for a tab with no entry does nothing.
  - `onChatError(tabId)` deletes `pending[tabId]`; no notice.
- Verified contracts and entry points: E21, E22, E23, E25, E27, E44;
  `TabManagerService.findTabByIdAcrossWorkspaces` `tab-manager.service.ts:710`;
  `CHAT_ADMISSION_RPC_TIMEOUT_MS` (`rpc-chat.types.ts:47`); `VSCodeService.isElectron` as at
  `message-sender.service.ts:823`.
- Dependencies: `chat` -> `core` (`AuthStateService`, `ClaudeRpcService`, `VSCodeService`),
  `chat` -> `chat-state` (`TabManagerService`), `ActionBannerService` (same lib). Existing edges.
- Integration points: `MessageSenderService` (offer, guard, `/compact`), `ChatViewComponent`
  (render and click), `ChatLifecycleService` and `ChatMessageHandlerService` (claim, Component 8).
- Failure behaviour: a check failure means no offer and today's banner; a stale click sends
  nothing; failures change the banner only while the original generation and tab own it; a send
  on a pending tab is refused locally; the tab binding is untouched on every failure before a
  session id exists (AC 5.2).
- Quality requirements: no timers except the existing `ActionBannerService` one; `pending`
  bounded by open tabs; no transcript text held in the renderer.
- Verification seam: new `provider-carry-over.service.spec.ts` (mocked `ClaudeRpcService` with
  deferred promises, real `AuthStateService` signal state, stub `TabManagerService`):
  - the decision is identical when only the refusal `error` text differs (AC 1.4);
  - no offer when not eligible or stale (AC 1.2, 1.3, 1.6); the offer carries the four identity
    fields (AC 7.1);
  - click checks: stale generation, closed tab clears the banner, rebound tab (AC 7.2, 4.5);
  - double click gives one RPC (AC 5.4);
  - deferred races (AC 7.8): tab switch before/after the click, newer refusal mid-flight, tab
    closed mid-flight (`'skip'`, no attach), tab rebound mid-flight (`'skip'` plus `chat:abort`),
    stale-generation click;
  - failure mappings (AC 5.1, 5.2); newer refusal then `HISTORY_UNREADABLE` / `START_FAILED`
    leaves the newer banner and offer; the same with a rebound tab;
  - success before resolution keeps the button disabled; unrelated resolution (old id) returns
    `'none'`; transport timeout keeps the entry and `onChatError` releases it; notice only after
    `completeBinding` (AC 4.3);
  - (Rev 2) `startFromCompact`: no banner — success leaves no banner call, `generation === null`,
    `completeBinding` shows the notice and calls no `clearAuthRequiredBanner`; with a matching
    banner G — success clears G and its offer; `NOT_ELIGIBLE` returns `'not-eligible'`;
    `HISTORY_UNREADABLE` without a banner returns the fixed-text failure outcome and calls no
    `flagAuthRequired`; `START_FAILED` with `AUTH_REQUIRED` flags the active provider's banner
    with no origin and returns `errorAlreadyShown`; a pending tab returns `'busy'` with no RPC;
  - (Rev 2) `completeBinding` twice for one tab shows one notice.
  Also: `auth-state.service.spec.ts` (generation, origin, guarded clear);
  `message-sender.service.spec.ts` (origin passed on an AUTH_REQUIRED continue, `offerFor` once;
  start path passes no origin; with `isPending(tabId)` true, `send` (both branches) and
  `continueExistingSessionForQueueFlush` return the fixed outcome with no RPC; another tab sends).
- Files:
  - MODIFY `<wt>/libs/frontend/core/src/lib/services/auth-state.service.ts`
  - MODIFY `<wt>/libs/frontend/core/src/lib/services/auth-state.service.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/message-sender.service.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.service.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts`

### 8. Relink guard (chat lifecycle and claimed-surface branch) (F3 completed in Rev 2)

- Purpose: make both `SESSION_ID_RESOLVED` branches respect the carry-over identity rules, so a
  pending carry-over always ends in a bind or a skip.
- Responsibilities:
  - Lifecycle branch: in `ChatLifecycleService.handleSessionIdResolved` (`:139-180`), first call
    `carryOver.claimSessionResolution(tabId, realSessionId)`:
    - `'skip'`: return after the existing `loadSessions()` refresh; no owner attach, no
      active-tab fallback (AC 7.6, 7.7);
    - `'bind'`: the existing owner attach (`attachSession(owner.tab.id, realSessionId)`), then
      `carryOver.completeBinding(tabId)`;
    - `'none'`: today's code path, unchanged.
    `handleChatError` (`:202-`) calls `carryOver.onChatError(data.tabId)` when `tabId` is set.
  - (Rev 2, F3, required edit) Claimed-surface branch: in
    `ChatMessageHandlerService` at `chat-message-handler.service.ts:837-852`, when
    `claimedSurface` is set, call `carryOver.claimSessionResolution(tabId, realSessionId)` BEFORE
    `onSurfaceCreated`:
    - `'skip'`: return immediately. No `streamRouter.onSurfaceCreated`, no
      `refreshQuestionTargetsForSession`, no tab attach (surface binding suppressed; the claim
      already deleted the entry and, for a rebound tab, aborted the new session);
    - `'bind'`: run today's `onSurfaceCreated(claimedSurface, realSessionId)` and
      `refreshQuestionTargetsForSession(realSessionId)`, then call
      `this.chatStore.handleSessionIdResolved({ tabId, realSessionId })`. That reaches the
      lifecycle branch above, whose claim returns `'bind'` again (the claim is pure for `'bind'`)
      and runs the owner attach of the owning tab, `completeBinding(tabId)` and the
      `loadSessions()` refresh. One binding implementation serves both branches (Decision K20);
    - `'none'`: today's behaviour, byte for byte (`onSurfaceCreated`, refresh, return).
    `ProviderCarryOverService` is injected with `inject()` like the other services at
    `:73-98`; it depends on none of the handler's consumers, so no DI cycle.
  - Both branches catch any throw from the claim and treat it as `'none'`, so a guard bug cannot
    break normal session resolution.
- Verified contracts and entry points: E23, E33; `attachSession` `tab-manager.service.ts:2139`;
  `renderedSurfaceFor` `chat-message-handler.service.ts:402-407`; `ChatStore.handleSessionIdResolved`
  reached at `:853` and `chat.store.ts:587-591`.
- Dependencies: `ProviderCarryOverService` (same lib).
- Integration points: `ChatMessageHandlerService` -> `ChatStore.handleSessionIdResolved` ->
  `ChatLifecycleService` (`chat-message-handler.service.ts:196-197`, `:822-855`).
- Failure behaviour: as above; a claim throw is `'none'`.
- Quality requirements: tabs without a pending carry-over behave the same in both branches
  (pinned by `chat-lifecycle.service.spec.ts` and the existing message-handler specs).
- Verification seam:
  - `chat-lifecycle.service.spec.ts`: `'skip'` with the tab gone (no `attachSession`, including
    the fallback), `'skip'` with the tab rebound, `'bind'` (attach then `completeBinding`).
  - Integration case 1 (real `TabManagerService`, `StreamingHandlerService`, `StreamRouter`,
    `ConversationRegistry`), lifecycle branch: tab `claudeSessionId` is the new id (AC 4.1);
    conversation sessions `[old, new]` (AC 4.2); old messages kept and new assistant text
    appended (AC 2.2); no refused prompt resent (AC 4.6). Resolves A2.
  - (Rev 2, F3) Integration case 2, claimed-surface branch, with a surface registered for the
    refused tab through `WorkflowSessionClaimService` and `StreamingSurfaceRegistry`
    (`:83-84`, `:402-407`):
    - `'bind'`: after `SESSION_ID_RESOLVED { tabId, realSessionId: newId }` the owning tab's id
      has `claudeSessionId === newId` (asserting the tab id, not the active tab), `isPending(tabId)`
      is false, `onSurfaceCreated` was called once with `newId`, and `ActionBannerService.showInfo`
      was called exactly once, after the attach and not before the resolution event (notice
      timing, AC 4.3);
    - `'skip'` (tab rebound before resolution): `attachSession` is not called for any tab,
      `onSurfaceCreated` is not called, no notice is shown, `chat:abort { sessionId: newId }` is
      sent, and `isPending(tabId)` is false; resolves A9 for the sidebar refresh;
    - `'none'` (no pending entry): today's calls in today's order and no attach.
- Files:
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (Rev 2: required)
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts`

### 9. Banner button and view wiring (chat UI)

- Purpose: render one "Continue with <provider>" button for the bound offer, in the refused
  tab's view only.
- Responsibilities:
  - `AuthRequiredBannerComponent` adds inputs `carryOverProvider: string | null` and
    `carryOverBusy: boolean`, and output `carryOver`. When `carryOverProvider` is set: a native
    `<button type="button">` labelled `Continue with {{ provider }}`, before the existing action,
    no `aria-label` override; `[disabled]` and `aria-busy` while busy; `aria-describedby` to a
    visually hidden span "Sends this conversation's text to <provider> to start a new chat from a
    summary." (AC 8.4). Existing buttons, layout and copy unchanged.
  - `ChatViewComponent` adds computed `carryOverOffer` (the offer when `banner.generation ===
    offer.generation` and `offer.tabId === resolvedTabId()`, else `null`, AC 7.3),
    `carryOverBusy` (`isPending(offer.tabId) || isBusy(offer.sessionId)`), and `onCarryOver() ->
    carryOver.start(offer)`. The template binds them at `chat-view.component.html:149-154`.
    (Rev 2) A `/compact`-triggered carry-over on the same session makes `isBusy` true, so the
    button is disabled while it runs.
- Verified contracts and entry points: E26; `resolvedTabId` `chat-view.component.ts:859`.
- Dependencies: `ProviderCarryOverService`.
- Integration points: Component 7.
- Failure behaviour: no offer means today's banner, byte for byte, in the DOM (AC 1.2, 1.3).
- Quality requirements: keyboard reachable in the existing order; visible label equals the
  accessible name. Electron before/after screenshots, dark and light, by the visual-reviewer:
  the banner without the button, with the button, the busy state, and the notice (also after a
  `/compact` carry-over, Rev 2).
- Verification seam: new `auth-required-banner.component.spec.ts` (no button without a provider;
  label, `aria-describedby`, disabled, emission; existing buttons unchanged); required
  `chat-view.component.spec.ts` cases on `makeHarness` (`:162`) with `sessionContextTabId`
  (`:177`, `:613-620`), a `ProviderCarryOverService` stub in the provider list (`:550-634`) and
  the banner stub (`:523-528`) gaining `generation`/`origin`: matching tab (binding non-null,
  `carryOver` output calls `start` once), non-matching tab (`null`, today's banner), stale
  generation (`null`). The implementer picks the template mode in which the binding is observable
  (default, or `renderCompactTemplate` with `NO_ERRORS_SCHEMA`, `:645-652`).
- Files:
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

### 10. Refusal contract pins (specs only)

- Purpose: prove AC 1.5, 5.5 and 6.3: the refusal shape stays byte-identical.
- Responsibilities:
  - In `chat-session.native.spec.ts`, next to `:576-627`, a case asserting `toStrictEqual({
    success:false, sessionId, error: <exact resolver text>, errorCode:'AUTH_REQUIRED',
    providerId:'anthropic' })` and the five sorted keys (via `continueSession` if the harness
    reaches it, else `autoResumeIfInactive`).
  - The same strict case for `/compact` in `chat-slash-command-router.native.spec.ts`, next to
    `:357`.
  - (Rev 2) One pin that native `/compact` is unchanged on the host: in
    `chat-slash-command-router.native.spec.ts`, a native identity with the active resolver fake
    reporting `'anthropic'` still calls `runtimeControls.compact(sessionId)` and returns `{
    success:true, sessionId, settled:true }` — the redirect lives only in the renderer
    (Component 13), so a host caller that is not the chat renderer keeps today's behaviour.
- Verified contracts and entry points: E6, E7, E42.
- Dependencies: none. Failure behaviour: not applicable.
- Verification seam: these specs; they also pin that `continueSession` still refuses after a
  failed carry-over, because the carry-over never writes the session (AC 5.5, 6.3).
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts`

### 11. Bounded native Codex tail read (codex-runtime and Electron port) (Rev 2, new)

- Purpose: read the newest turns of a native Codex thread with a hard cap on requests and turns,
  without subagent threads, through the same read-only process and port the history view uses.
- Responsibilities:
  - `codex-session-history.ts`: new exported `readCodexSessionTail(rootThreadId, request,
    assertOpen, bound: { maxTurns: number; maxTurnPages: number; maxItemPages: number })`
    returning `{ thread: CodexHistoryThread; coversWholeHistory: boolean }`:
    1. `thread/read { threadId }` for the root (the same id check as `:101-102`).
    2. `historyMode === 'paginated'`: `thread/turns/list { threadId, sortDirection: 'desc',
       itemsView: 'full', limit: 25 }` page by page, collecting until `maxTurns` turns or
       `maxTurnPages` pages; the same malformed/stalled-cursor checks as `pages()` (`:83-98`).
       `coversWholeHistory = true` only when the last page had no `nextCursor` before a cap was
       reached. A turn without full items gets `thread/items/list { turnId, sortDirection:
       'desc', limit: 25 }` pages, counted against one shared `maxItemPages` budget; when the
       budget runs out the remaining (older) turns are dropped and `coversWholeHistory = false`.
       Turns and items are reversed to ascending before return.
    3. Legacy threads: one `thread/read { threadId, includeTurns: true }`, bounded by the existing
       16 MiB inbound frame cap (E39); keep the newest `maxTurns` turns;
       `coversWholeHistory = turns.length <= maxTurns`.
    4. Never calls `thread/list` (no descendants: AC 3.9) and never a non-read method.
  - `codex-runtime.types.ts`: `CodexHistoryReader` gains `readHistoryTail(profile, resume, bound,
    signal?)` with the same result type as step 1-3 (declared as `CodexHistoryTail` beside
    `CodexSessionHistory`).
  - `codex-runtime.ts`: `CodexRuntime.readHistoryTail` reuses `readHistory`'s abort wiring and
    `historyReads` tracking (`:182-201`) and the process lifecycle of `readHistoryProcess`
    (`:203-235`) by passing the reader function in (one private method takes
    `(request, assertOpen) => Promise<T>`), so spawn, home verification and `close()` are shared.
  - `codex-runtime-composition.ts`: `ElectronCodexHistoryPort` gains `readHistoryTail(session,
    bound, signal?)`. The identity validation, profile build, binary check, scope, timeout race and
    error mapping of `readHistory` (`:532-652`) move into one private helper that takes the
    runtime call; `readHistory` and `readHistoryTail` both call it. The concurrency cap (two
    reads) is shared. A runtime without `readHistoryTail` maps to `runtimeFailed`.
- Verified contracts and entry points: E37-E41; `CodexSessionHistoryError` codes
  `codex-session-history.ts:15-23`; `ElectronCodexHistoryError` `codex-runtime-composition.ts:485`.
- Dependencies: no new import edges (E29). `codex-runtime` exports `CodexHistoryTail` through the
  existing type export list in `index.ts` only if the Electron port names it; otherwise the port
  types it as `Awaited<ReturnType<CodexHistoryReader['readHistoryTail']>>` and `index.ts` is not
  edited.
- Integration points: `SessionHistoryRouter.readCarryOverTranscript` (Component 12) through
  `NativeSessionHistoryPort.readHistoryTail`.
- Failure behaviour: the same fixed error codes as the full read (`CodexSessionHistoryError`,
  `ElectronCodexHistoryError`); no protocol payload, path or stderr in any error; the process is
  always closed; an abort or the port timeout cancels the read.
- Quality requirements: at most `1 + maxTurnPages + maxItemPages` requests (25 with the Rev 2
  constants) for a paginated thread, 1 for a legacy thread; no descendant reads; read-only process
  (server requests rejected, E39). No change to `readHistory` or `readCodexSessionHistory`
  behaviour.
- Verification seam:
  - `codex-session-history.spec.ts` (existing fake request harness, `:95-127`): a paginated thread
    with 10x `maxTurns` turns gives at most `maxTurnPages` `thread/turns/list` calls, all with
    `sortDirection: 'desc'` and `limit: 25`, `coversWholeHistory === false`, the newest turns in
    ascending order, zero `thread/list` calls (AC 3.10, Codex half); a short thread gives
    `coversWholeHistory === true`; the item budget stops older turns; a legacy thread makes one
    `includeTurns` read and keeps the newest `maxTurns`; a repeated cursor throws `stalledCursor`;
    only read methods are requested (A7).
  - `codex-runtime.spec.ts`: `readHistoryTail` closes the process on success, on error and on
    abort (the existing `readHistory` cases' shape).
  - New Electron port spec: identity validation failures, `busy` at the third concurrent read,
    the timeout path, and that `readHistoryTail` passes the bound unchanged to the runtime.
- Files:
  - MODIFY `<wt>/libs/backend/codex-runtime/src/lib/codex-session-history.ts`
  - MODIFY `<wt>/libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts`
  - MODIFY `<wt>/libs/backend/codex-runtime/src/lib/codex-runtime.ts`
  - MODIFY `<wt>/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
  - MODIFY `<wt>/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`
  - MODIFY `<wt>/apps/ptah-electron/src/di/codex-runtime-composition.ts`
  - CREATE `<wt>/apps/ptah-electron/src/di/codex-history-port.spec.ts`

### 12. Carry-over history route and native projection (agent-sdk) (Rev 2, new)

- Purpose: one routed, bounded carry-over read for both session kinds, returning the same
  `CarryOverTranscript`.
- Responsibilities:
  - `NativeSessionHistoryPort` (`session-history-router.ts:9-12`) gains optional
    `readHistoryTail?(session, bound, signal?)`.
  - `SessionHistoryRouter.readCarryOverTranscript(sessionId, workspacePath, { tailBytes,
    nativeBound, signal })`:
    - `nativeSession(sessionId)` (unchanged, `:76-96`) decides the kind;
    - non-native: `getLegacy().readCarryOverTranscript(sessionId, workspacePath, { tailBytes,
      signal })` (Component 2); the `getLegacy` `Pick` gains `'readCarryOverTranscript'`;
    - native: `getNative()?.readHistoryTail`; absent port or absent method throws
      `SessionHistoryRouteError('nativePortUnavailable')`; port errors collapse exactly as
      `nativeHistory` does (`:98-110`, `ElectronCodexHistoryError` passes through, others become
      `nativeReadFailed`); then `projectCodexCarryOverTranscript(tail)`; a projection throw
      becomes `nativeReadFailed`.
  - New pure module `codex-carry-over-projector.ts` exporting
    `projectCodexCarryOverTranscript({ thread, coversWholeHistory }): CarryOverTranscript`:
    - `userMessage`: `text` parts joined; `image`/`localImage` become `[image omitted]`;
      `mention`/`skill` become `[file: <basename(path)>]`; `audio`/`localAudio` dropped;
    - `agentMessage`: its `text` as assistant prose (both `commentary` and `final_answer`);
    - `commandExecution` gives `[tool: shell]`; `fileChange` gives `[tool: apply_patch]`;
      `mcpToolCall` gives `[tool: <tool>]`; `webSearch` gives `[tool: web_search]`;
      `collabAgentToolCall` gives `[tool: <tool or 'agent'>]`; `imageView` gives
      `[image omitted]`. Inputs, outputs, commands, diffs and arguments are never read (AC 3.5,
      3.7, 3.9);
    - `reasoning`, `contextCompaction`, `hookPrompt` and unknown items give nothing (AC 3.6);
    - consecutive same-role output is merged, empty turns dropped;
    - `windowCoversWholeHistory = coversWholeHistory`; `startsAtCompactionSummary = false`
      (Codex keeps no summary text, E41; AC 3.8 then emits the no-count omission line whenever the
      window does not cover the whole history).
- Verified contracts and entry points: E36, E41; `CodexHistoryTurn` export
  `libs/backend/codex-runtime/src/index.ts:31`; registration `register.ts:311-322` (unchanged:
  the factory already passes the full reader and the port getter).
- Dependencies: agent-sdk -> codex-runtime (existing, E29). No barrel change: consumers use
  `SessionHistoryRouter['readCarryOverTranscript']`.
- Integration points: Component 4.
- Failure behaviour: fixed-text `SessionHistoryRouteError`s, as today; nothing logged with
  content.
- Quality requirements: the router adds no read of its own beyond `metadata.get`; the
  projection is linear in the bounded input.
- Verification seam: `session-history-router.spec.ts` (fixture `:99-109`, legacy fake gains
  `readCarryOverTranscript`): a non-native id routes to the legacy method with `tailBytes`; a
  native id routes to `readHistoryTail` with the bound and never calls `readHistory`; a port
  without `readHistoryTail` gives `nativePortUnavailable`; a port error is collapsed. New
  `codex-carry-over-projector.spec.ts`: each item kind's mapping; a sentinel in command output,
  file diff, MCP arguments and reasoning is absent; image and mention placeholders;
  `startsAtCompactionSummary === false` with a `contextCompaction` item in the window.
- Files:
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts`
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts`
  - CREATE `<wt>/libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.ts`
  - CREATE `<wt>/libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.spec.ts`

### 13. `/compact` trigger (renderer) (Rev 2, new)

- Purpose: make "switch provider, then `/compact`, then continue" (decisions.md rows 20, 22) a
  second entry point to the same carry-over, in both directions, without touching the refusal.
- Responsibilities:
  - In `MessageSenderService.runContinueConversation`, after `resolvedWorkspacePath` is known and
    the session file is validated (`:722-764`), after the `activeTabId` check (`:766-771`), and
    before the second `isHeld` check and the optimistic bubble (`:778-797`): when
    `isCompactCommand(content)` and `resolvedWorkspacePath` is set, call
    `carryOver.tryCompact({ sessionId, tabId: activeTabId, workspacePath: resolvedWorkspacePath,
    name: activeTab?.name })`.
  - `isCompactCommand(content)` mirrors the host parse (E43): `t = content.trim()`;
    `/^\/[a-zA-Z]/.test(t)` and the text between `/` and the first space (or the end) is exactly
    `compact`. Arguments after `/compact` are not forwarded (Decision K21).
  - `ProviderCarryOverService.tryCompact(origin)`:
    1. `chat:carry-over-check { sessionId, workspacePath }` with `timeout:
       CARRY_OVER_CHECK_TIMEOUT_MS = 5_000`. Not eligible, an RPC error or a timeout returns
       `'not-eligible'`.
    2. Eligible: `startFromCompact({ ...origin, providerId, providerName })` (Component 7) and
       return its outcome.
  - `runContinueConversation` maps the result:
    - `'not-eligible'`: continue today's path unchanged (bubble, `chat:continue` with today's
      params, today's refusal handling). This is the only path on which a `/compact` refusal can
      occur, and it is byte-identical;
    - `'busy'`: return `{ success:false, error: 'A new chat is starting in this tab.' }`;
    - a carry-over outcome: return it (`{ success:true }` after the host accepted the start;
      a failure outcome otherwise). No user bubble is added for `/compact`, no `chat:continue`
      is sent, the tab is not marked resuming, and the refused-prompt rule (AC 4.6) holds
      because `/compact` itself is consumed by the carry-over.
  - Because both `send` and `continueExistingSessionForQueueFlush` reach
    `runContinueConversation` (E22), a queued `/compact` takes the same branch; a success outcome
    means the dispatcher does not requeue it (E44).
- Verified contracts and entry points: E22, E42-E44; `runContinueConversation`
  `message-sender.service.ts:690-880`; the `chat:continue` call `:806-829`; `SendOutcome` `:67-74`.
- Dependencies: `ProviderCarryOverService` (same lib); no host change.
- Integration points: Components 7 (launch, pending, binding), 8 (relink), 4 (host).
- Failure behaviour: every check failure falls back to today's `/compact` behaviour; a
  carry-over failure is reported through the send outcome (or the banner when it already owns the
  tab, Component 7); a `NOT_ELIGIBLE` race falls back to today's path.
- Quality requirements: one extra RPC per `/compact` on an existing session (bounded by 5 s, no
  probe for a same-provider session, K22); no change for any other prompt; no new timers.
- Verification seam: `message-sender.service.spec.ts` cases:
  - Claude -> Codex: `/compact` with an eligible check calls `chat:carry-over` once, never
    `chat:continue`, adds no bubble, and returns success;
  - Codex -> Claude: a native session's `/compact` with an eligible check does the same (the
    renderer does not branch on direction);
  - not eligible, a check RPC error and a check timeout each send `chat:continue` with params
    deep-equal to today's for the same input (refusal path untouched, AC 1.5);
  - `/compact focus on tests` is redirected; `/compactx`, `/compact\nfoo` (no space) and
    `ultracode: /compact` are not (E43);
  - a queued `/compact` flushed through `continueExistingSessionForQueueFlush` is redirected;
  - a `/compact` on a tab with a pending carry-over returns the busy outcome with no RPC;
  - a plain (non-`/compact`) prompt never calls `chat:carry-over-check`.
  The relink integration spec (Component 8) gains one case: `/compact` -> eligible ->
  `SESSION_ID_RESOLVED` binds the tab and shows the notice once.
- Files: production code lands in the two files already listed in Component 7
  (`message-sender.service.ts`, `provider-carry-over.service.ts`); specs in
  `message-sender.service.spec.ts`, `provider-carry-over.service.spec.ts` and
  `provider-carry-over.relink.integration.spec.ts`. No new file.

## /compact trigger size

- Files added or changed for the `/compact` trigger alone:
  - production: 0 new files; 2 files that the plan already modifies or creates gain code
    (`libs/frontend/chat/src/lib/services/message-sender.service.ts`: one branch in
    `runContinueConversation` plus `isCompactCommand`; `provider-carry-over.service.ts`:
    `tryCompact` and `startFromCompact`, sharing the private `launch`);
  - host: 0 files. The slash router, `continueSession` and the resolver are not edited; the host
    carry-over is the same `chat:carry-over` method;
  - specs: 3 spec files already in the plan gain cases; one host pin case (Component 10).
- Projects: `@ptah-extension/chat` only (the host side it uses is the same as the button's).
- Refusal contract: not touched. The `/compact` refusal is produced by unchanged code and is
  sent only when the check is not eligible or fails; Component 10 pins its strict shape and
  Component 13 pins that the fallback sends today's params. The `chat:continue` refusal is
  unchanged.
- Risk: LOW-MEDIUM.
  - One extra RPC (at most 5 s) before every `/compact` on an existing session; a slow or failed
    check falls back to today's behaviour.
  - Behaviour change, by the user's instruction (rows 20, 22): an eligible `/compact` no longer
    shows the refusal banner (Claude session) or compacts natively on Codex (native session); it
    starts the new chat. Switching back to the session's own provider makes the check not
    eligible, so native `/compact` returns.
  - Disclosure timing differs from the button (no pre-click description): user-reserved U2.
- Verdict: under the threshold (0 new production files, no refusal-contract change), so build
  now, in the same phase as Component 7. Not marked "needs user decision"; only U2 (disclosure
  wording) needs the user, and it does not change the file list.

## User-reserved items

These go to the parent per decisions.md row 16. The plan is built on the recommended option of
each; the other option is described with its cost so it can be applied without a redesign.

### U1. Plain resume of a native Codex session after a switch to another provider

- Today: a native Codex session resumes on Codex after the workspace's active provider changed
  (E3); there is no refusal and no banner. Row 21 asks that the switch become real for this
  direction; this plan makes it real through `/compact` (Component 13), which is the user's own
  gesture (row 20). The plain resume is not changed.
- Options:
  - (A) RECOMMENDED: leave native resume unchanged. Codex -> Claude runs through `/compact`;
    the banner button exists only for Claude-session refusals. Cost: 0 extra files. Users who
    keep a Codex chat open while another provider is active keep working as today.
  - (B) Refuse a native Codex resume when the active provider is not Codex, with the same
    stored-provider mismatch refusal the Claude route throws (`rejectStoredProviderMismatch`).
    The existing banner and button then appear for Codex -> Claude with no renderer change
    (the host check already accepts native sources). Cost: a resolver edit
    (`workspace-provider-profile-resolver.ts:190-266`), its specs, and coordination with
    TASK_2026_864_1376, whose tests run through that resolver; it removes the ability to continue
    a Codex chat while another provider is active (a capability removal, row 16).
  - (C) Keep the resume and add a proactive, non-blocking "Continue with <provider>" offer on a
    tab whose native session's provider is no longer active. Cost: a new offer surface (the auth
    banner would be wrong for a non-auth state; needs a designer per decisions.md row 2) and a
    check RPC on tab open or provider change.
- Recommendation: (A). It matches the user's described workflow, changes no resume behaviour,
  and keeps the parallel task's resolver contract intact.

### U2. Transfer disclosure when `/compact` is the trigger

- Decisions.md row 14 (user): disclosure "on the button and the notice". A `/compact` carry-over
  has no button, so before the text is sent the user sees no disclosure; the notice after binding
  states it (AC 8.4 text).
- Options:
  - (A) RECOMMENDED: `/compact` after a switch is itself the user's request to summarize with the
    new provider (row 10: "sending the old conversation's text to the active provider IS the
    user's request"); disclose in the notice only for this trigger. Cost: 0 files.
  - (B) `/compact` only opens the offer and the user then clicks the button (disclosure before
    send). For Claude sessions this reuses the banner; for native Codex sessions there is no
    refusal, so the banner needs a non-auth offer state (a new banner mode, designer item) and
    one more click on the user's gesture.
- Recommendation: (A); record the user's answer as an AC 8.4 wording change (see
  `## Proposed requirement changes`).

Settled, listed for audit only (not open): the native `/compact` redirect (an eligible `/compact`
on a native Codex session starts the carry-over instead of native Codex compaction) follows the
user's words in row 20 and the row 22 instruction; Decision K18.

## Proposed requirement changes

The plan needs these wording changes in `task-description.md` (not edited here):

1. New Requirement 9, "`/compact` after a provider switch":
   - 9.1 When the user sends `/compact` (the command name exactly `compact`, with or without
     arguments) in a tab bound to a session whose stored provider differs from the workspace's
     active provider, and the active provider is ready, the renderer shall run the carry-over of
     Requirement 2 for that session and tab instead of sending `chat:continue`; arguments are not
     forwarded.
   - 9.2 This applies to Claude SDK sessions (today refused) and to native Codex sessions (today
     compacted natively on Codex).
   - 9.3 When the session is not eligible, or the eligibility check fails or takes longer than
     5 s, `/compact` shall behave exactly as today, including the byte-identical AUTH_REQUIRED
     refusal of AC 1.5.
   - 9.4 The carry-over started by `/compact` shall follow Requirements 2-8 (bounded read,
     rendering, notice after binding, failure paths, identity rules, transfer policy); on failure
     with no banner owning the tab, the fixed failure text appears as the tab's send failure.
   - 9.5 No `/compact` user bubble and no `chat:continue` call shall remain after a redirected
     `/compact`.
   - 9.6 A queued `/compact` delivered by the queue flush shall be handled the same way.
2. Scope "Both directions of mismatch" and D9: add "Codex -> Claude is reached through `/compact`
   (Requirement 9); the banner button appears only where a refusal exists (Claude SDK
   sessions), unless the user chooses U1 option B."
3. AC 1.1: append "The `/compact` trigger of Requirement 9 starts the carry-over without the
   button."
4. AC 2.3: append "Reading a native Codex session's stored thread through the read-only Codex
   history process (thread read methods only, as the history view does) is a local read, not a
   call to the old provider; no turn, resume or compaction request is made."
5. AC 3.4 and AC 3.10, native half: "For a native Codex session the read is bounded by turn
   count and request count (newest 200 turns, at most 8 turn pages and 16 item pages; a legacy
   thread is one read capped by the existing 16 MiB inbound frame limit), and the spec asserts
   the request parameters and counts passed to the source."
6. AC 3.8: append "A native Codex session keeps no compaction summary text, so its rendering
   never starts at a summary."
7. AC 5.1: append "For a `/compact`-triggered carry-over with no banner for that tab, the
   message appears as the tab's send failure instead of on the banner."
8. AC 8.4: per U2, either (A) "For the `/compact` trigger, the notice carries the disclosure",
   or (B) keep as is and make `/compact` open the offer.

## Integration architecture

- Data flow, button trigger (Claude-session refusal):
  1. `chat:continue` (plain send or a not-eligible `/compact`) is refused with today's response.
  2. `MessageSender.handleAuthRequired` calls `AuthState.flagAuthRequired(providerId, message,
     origin)` and gets generation G.
  3. `ProviderCarryOverService.offerFor(G)` calls `chat:carry-over-check`; the host `evaluate`
     runs folder, identity, provider comparison, then the readiness probe.
  4. The renderer sets the offer if the banner is still G; the refused tab's view shows the button.
  5. On click, the identity checks run, `pending[tabId]` is set, then `chat:carry-over`.
- Data flow, `/compact` trigger (Rev 2, both directions):
  1. `runContinueConversation` sees `/compact` on a bound session, calls `chat:carry-over-check`
     (5 s).
  2. Eligible: `startFromCompact` sets `pending[tabId]` (generation of a matching banner or
     `null`), then `chat:carry-over`. Not eligible: today's `chat:continue`.
- Host carry-over (both triggers): `evaluate` again (pin P), `SessionHistoryRouter.readCarryOverTranscript`
  (Claude: JSONL tail 2 MiB; native: newest 200 turns via the Electron port and the read-only
  Codex process), `renderCarryOverPrompt` (48k chars, redacted), the active id re-checked against
  P, then `startSession({tabId, workspacePath: folder, prompt}, {expectedProviderId: P})`; after
  `prepare`, the active id is re-read and the served provider checked against P on every runtime
  branch, before lineage and `startChatSession`.
- Relink: `SESSION_ID_RESOLVED(tabId, newId)` reaches the claim in the lifecycle branch or the
  claimed-surface branch; `'bind'` gives `attachSession` and `completeBinding` (notice, banner G
  cleared if still current, pending released); the stream router appends the new id to the
  conversation and the reply streams into the tab.
- State or persistence: host `inFlight: Set<sessionId>` per request; renderer `offer` and
  `pending` (bounded by open tabs); banner `generation` in memory. Nothing persisted by the
  feature. The new session persists through the existing start path. The old session (JSONL
  file, Codex thread, metadata) is only read.
- External boundaries: strict zod params (`uuidString`, length caps); the workspace must equal
  the session's own authorized real folder; the session id pattern guards the JSONL path; the
  native read validates the stored identity, Codex home and workspace (E40) and runs a read-only
  process. Transcript text crosses one boundary only: the first turn sent to the active provider.
  Host routing is skipped (E9). No transcript in logs, results, banners or notices.
- Failure and rollback: every failure before `startSession` creates nothing. A provider change
  during the read or the launch creates nothing and returns `NOT_ELIGIBLE`; for `/compact` that
  falls back to today's path. A start failure is shaped by the carry-over branch of the
  `startSession` catch. Failure results change the banner only while their generation and tab
  still own it. A failure after the session exists is the normal turn-error path (AC 5.3).
  Closed or rebound tabs are never bound in either relink branch; a rebound tab gets an abort of
  the new session.
- Observability: host `[carry-over] …` info/warn lines carry session id, tab id, provider id,
  source kind, kept/omitted counts and the error name; the Codex runtime's existing logger lines
  for the history process; a renderer `console.warn` on a guard skip with ids only; failures show
  fixed text.

## Architecture-level quality requirements

- Functional: every AC in Requirements 1-8 (and the proposed Requirement 9) maps to a named spec
  in Components 2-13. AC 3.10 has a Claude half (Component 2) and a Codex half (Component 11).
- Performance: Claude read at most 2 MiB; native read at most 25 requests and 200 turns, no
  descendants; 20 s abort; one check RPC per mismatch refusal and one per `/compact` (5 s cap,
  no probe on a same-provider session); no polling, no per-item timers.
- Security: no credentials, transcript text, paths or provider error bodies in UI payloads or
  logs; fixed failure strings; pattern redaction before budgeting; tool I/O and attachment
  content excluded at extraction for both session kinds; disclosure on the button description and
  the notice (U2 for `/compact`); the native read is a read-only local process.
- Maintainability: no new project and no new Nx edge; no `cli-agent-runtime` import; the
  AUTH_REQUIRED refusal, the slash router, `continueSession`, the resolver, the onboarding lib,
  the Codex sign-in code and the full native history read are untouched; each existing reader
  gains one bounded sibling method instead of a mode flag; one binding implementation for both
  relink branches.
- Testability: the specs per component, including (Rev 2) the F1 race on every runtime branch,
  the F3 claimed-surface integration case, the native 10x tail fixture with request-count
  assertions, the native projection sentinel cases, and the `/compact` redirect/fallback cases.

## Team-leader handoff

- Recommended executors:
  - Components 1-6, 10, 11 and 12: backend-developer (DI tokens, RPC wiring, JSONL projection,
    Codex protocol reads, Electron port composition);
  - Components 7, 8, 9 and 13: frontend-developer (Angular signals, banner, relink guard,
    message sender);
  - senior-tester for the race and integration specs if the executors do not finish them;
  - visual-reviewer for the Electron dark and light screenshots (Component 9).
- Complexity: HIGH. Backend: one new service, two bounded reads (one across codex-runtime and
  the Electron port). Renderer: relink races (Requirement 7), launch serialization, two relink
  branches and two triggers, and Assumptions A2, A8 and A9 carry the risk.
- Dependencies and ordering (component-level only):
  - Component 1 before Components 6, 7 and 13;
  - Component 11 before Component 12; Components 2 and 12 before Component 4;
  - Components 3 and 5 before Component 4;
  - Component 7 before Components 8, 9 and 13.
- Parallel-safe work (file-disjoint hints):
  - Backend: Component 1; Component 2; Component 11 (codex-runtime + Electron); Component 12
    (after 11 and 2's type); Components 3+4+5+6; Component 10. Components 2, 3, 10 and 11 touch
    disjoint files.
  - Frontend: Component 7 (+13, same files), then Components 8 and 9.
  - Backend and frontend are file-disjoint.
- Files affected:
  - CREATE (production):
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`
    - `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts`
    - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.ts` (Rev 2)
  - CREATE (specs):
    - `libs/backend/agent-sdk/src/lib/session-history-reader.carry-over.spec.ts`
    - `libs/backend/agent-sdk/src/lib/codex-app-server/codex-carry-over-projector.spec.ts` (Rev 2)
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts`
    - `libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts`
    - `libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts`
    - `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
    - `apps/ptah-electron/src/di/codex-history-port.spec.ts` (Rev 2)
  - MODIFY (production):
    - `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
    - `libs/shared/src/lib/types/rpc.types.ts`
    - `libs/backend/codex-runtime/src/lib/codex-session-history.ts` (Rev 2)
    - `libs/backend/codex-runtime/src/lib/codex-runtime.ts` (Rev 2)
    - `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` (Rev 2)
    - `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` (Rev 2)
    - `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
    - `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
    - `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts` (Rev 2)
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/di.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
    - `apps/ptah-electron/src/di/codex-runtime-composition.ts` (Rev 2)
    - `libs/frontend/core/src/lib/services/auth-state.service.ts`
    - `libs/frontend/chat/src/lib/services/message-sender.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (Rev 2: required)
    - `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
    - Conditional (Component 11 only if the Electron port names the tail type):
      `libs/backend/codex-runtime/src/index.ts`
  - MODIFY (specs):
    - rpc-handlers: `chat-session.host-routing.spec.ts`, `chat-session.native.spec.ts`,
      `chat-slash-command-router.native.spec.ts`, `chat-rpc.handlers.spec.ts`, `chat/di.spec.ts`
    - agent-sdk: `history-event-factory.spec.ts`, `session-history-router.spec.ts` (Rev 2)
    - codex-runtime: `codex-session-history.spec.ts`, `codex-runtime.spec.ts` (Rev 2)
    - core: `auth-state.service.spec.ts`
    - chat: `message-sender.service.spec.ts`, `chat-lifecycle.service.spec.ts`,
      `chat-view.component.spec.ts`

  Production count (Rev 2): 4 new and 22 modified (23 if `codex-runtime/src/index.ts` is
  needed). Rev 1 was 3 new and 15 modified (+1 conditional). Rev 2 adds: the native read
  (codex-runtime x3, Electron port x1, router x1, projector new, shared type file x1 = 6 modified
  and 1 new), the now-required claimed-surface edit (+1 modified), and 0 files for the `/compact`
  trigger. Seven modified files are one-to-ten-line registration or type edits (types x3, tokens,
  di, schema, html).
- Verification points (CLAUDE.md § Verification; decisions.md row 18):
  - Confirm A1-A5 and A7-A9 with the checks above before closing their components.
  - Per batch: `npm run verify -- -p <only the projects that batch changed>`, for example
    `npm run verify -- -p @ptah-extension/codex-runtime` for the codex-runtime part of
    Component 11, `npm run verify -- -p ptah-electron` for its Electron part, and
    `npm run verify -- -p @ptah-extension/agent-sdk` for Components 2 and 12. Extra Jest filters
    go after a second `--`. Confirm the header's project count equals the number requested.
  - Final, once all batches land:
    `npm run verify -- -p @ptah-extension/shared,@ptah-extension/codex-runtime,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/chat,ptah-electron,ptah-extension-webview`.
    Seven are changed projects (Rev 2: `ptah-electron` is now changed by Component 11);
    `ptah-extension-webview` is unchanged and included because CLAUDE.md (§ Electron first)
    requires the renderer project's scoped check when a shared lib changes. Confirm the header
    lists 8 projects.
  - Use `npm run verify`, never raw `nx`; one verify at a time from this task (it takes the
    machine-wide lock).
  - `ptah-electron` covers `rpc-surface.spec.ts`, `container.smoke.spec.ts` and the new history
    port spec; `ptah-extension-webview` is the renderer typecheck.
  - Provider CLI lanes and the benchmark's `platform-cli`/`cli-engine` keep working: they bind no
    native history port (E40) and use none of the new methods; the optional port method keeps
    their types valid. They are not in the affected list unless `nx affected` adds them; if it
    does, run them in their own scoped verify.
  - No VS Code app project exists in `apps/`; VS Code compiling is covered by the shared lib
    typechecks.
  - No build, serve, e2e or package targets; no workspace-wide runs.
  - Visual: before/after Electron screenshots, dark and light: banner without and with the
    button, busy state, the notice after a button carry-over and after a `/compact` carry-over.
  - The parallel task's `chat-session.connection-switch.spec.ts`, when it lands, must pass
    unchanged.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| The first `generating` turn-state of the new session is dropped while the tab still holds the old id (A2). | Medium | Low | Component 8 integration case; fall back to `markTabStreaming` at click. |
| Chunks reach a tab rebound mid-flight before resolution (AC 7.7 residual). | Low | Low | Abort the new session on `'skip'`; rebind flows are rare in a refused tab. |
| Pattern redaction misses a secret shape or masks a harmless token. | Medium | Medium | Best effort by decision (row 10); disclosure; unit-tested patterns; no generic base64 rule. |
| The readiness probe `prepare` starts a provider proxy for a check never clicked (A3). | Low | Low | Rev 2 runs the probe only after a mismatch is found; note it in the PR. |
| After a reload, the new session's history shows the full carry-over prompt as the first user bubble. | High | Low | Accepted; follow-up could tag it for compact display. |
| The notice is replaced by a later action banner. | Medium | Low | 15 s duration; the tab state is the durable truth. |
| A transport timeout with no later resolution or chat error leaves the tab's sends refused. | Low | Medium | Released by a chat error, a resolution or the tab's removal. |
| A provider error after the stream starts is logged by the existing stream path. | Low | Medium | Normal turn-error path (AC 5.3). |
| (Rev 2) The Codex app-server rejects `sortDirection: 'desc'` (A8) or a legacy thread exceeds the 16 MiB frame. | Low | Medium | A8 fallback (bounded `asc`, no count); a legacy oversize read fails as `HISTORY_UNREADABLE` with today's fixed text, like the history view would. |
| (Rev 2) The Codex binary is missing after the user switched away from Codex. | Medium | Low | `binaryUnavailable` maps to `HISTORY_UNREADABLE`; the old session stays intact. |
| (Rev 2) The extra check before every `/compact` slows `/compact` noticeably. | Low | Low | No probe on same-provider sessions (K22); 5 s cap and fallback. |
| (Rev 2) A user expects `/compact` on a Codex chat to compact on Codex while Claude is active. | Low | Medium | It is the user's requested behaviour (row 20); switching back to Codex restores native compaction; the notice says what happened. |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| K1 | Two new RPC methods, `chat:carry-over-check` (read-only eligibility) and `chat:carry-over` (action), served by one `ChatCarryOverService` with a shared `evaluate`. | Extend `chat:continue`/`chat:start`; one method with a `mode`; renderer-only eligibility. | AC 1.4, 1.5, 1.7; E4, E17, E18. | Yes |
| K2 | **Superseded by the user's answer (decisions.md row 20, 2026-11-03): K2 rejected; both directions are supported.** Native Codex sessions are eligible (Component 4), read through a bounded native tail (Components 11, 12), and reached through `/compact` (Component 13, K18). | (was) Only Claude SDK sessions eligible; native refused with zero reads. | Row 20, user's words; E3, E36-E41. | n/a |
| K3 | Eligibility mirrors the resolver: stored `providerId` (`storedChatRuntimeIdentity`) against `resolveActiveAuthForPath(folder).providerId`; readiness from a new-session `prepare(…, undefined, true)` plus `codexAuth.isAuthenticated()` for Codex. | `prepare` with the stored identity (forbidden, AC 2.3); duplicate per-provider readiness. | E1, E4, E5, E8. | Yes |
| K4 | The new chat starts through `startSession` with an internal `CarryOverLaunch { expectedProviderId }`: no host routing, provider pinned after `prepare`, safe failure branch. | A new launch path; admit host routing; flags; pin in the resolver. | E8, E9, E30, E31. | Yes |
| K5 | Claude bound: strict JSONL tail of 2 MiB via `readJsonlTail`. Budget 48,000 characters. (Rev 2) Read abort 20 s. | Streaming full scan (row 12); smaller window; token budget. | E12; `session-history-reader.service.ts:102-116`. | Yes (constants) |
| K6 | Secret redaction is a private pattern list in `chat-carry-over-transcript.ts`, per turn before budgeting. | Export `redactSecrets`; extract a shared redactor. | E16. | Yes |
| K7 | Offer identity in `AuthStateService` (`generation`, `origin`); offer, pending and relink guard in `ProviderCarryOverService` (chat); the button only in the refused tab's view. | Offer in `core`; per-tab banner redesign. | E21, E23, E26; AC 7.3. | Yes |
| K8 | The relink uses the existing `SESSION_ID_RESOLVED` attach, gated by `claimSessionResolution`; the host does not return the new id. | Host awaits the id; new tab. | E8, E23, E24. | Yes |
| K9 | A tab rebound mid-flight gets `chat:abort` for the new session; a closed tab relies on the tab-close abort; neither is bound. | Let it stream into the rebound tab. | AC 7.6, 7.7; `tab-close-session-end.integration.spec.ts:1-13`. | Yes |
| K10 | The notice reuses `ActionBannerService.showInfo(…, tabId, 15_000)`. | New notice surface; host-injected message. | E25; AC 4.3. | Yes |
| K11 | Failure messages are fixed host strings; `START_FAILED` passes through only `errorCode`/`providerId`. | Forward the start `error` text. | NFR security; `chat-session.service.ts:1126-1133`. | Yes |
| K12 | The new methods stay out of the replay sanitizer allow-list and the host-source baseline. | Add them. | E18, E19. | Yes |
| K13 | (Rev 1 F1, completed Rev 2) The provider is pinned to the click-time active id: re-checked after the read, and after `prepare` on every runtime branch by re-reading `resolveActiveAuthForPath(workspaceId).providerId` and comparing the served provider, before lineage and adapter calls. | Pin in the resolver; check only before `startSession`; re-read only on the `undefined`-profile branch (the round-2 defect). | E4, E30; review Round 2 F1. | Yes |
| K14 | (Rev 1 F3) Launches on a tab with a pending carry-over are serialized; the pending entry is the busy state until bind or definitive failure; a resolution carrying the old id is not claimed. | Launch nonce; accept any resolution. | E33, E34. | Yes |
| K15 | (Rev 1 F7, row 18) Verification on `npm run verify -- -p`; per batch the changed projects; final the changed projects plus `ptah-extension-webview`. | Raw `nx … --parallel=1`. | CLAUDE.md. | Yes |
| K16 | (Rev 2) The native tail read is a sibling of the full read at each layer (`readCodexSessionTail`, `CodexRuntime.readHistoryTail`, `ElectronCodexHistoryPort.readHistoryTail`, optional on `NativeSessionHistoryPort`), root thread only, newest-first, capped at 200 turns / 8 turn pages / 16 item pages; legacy threads are one frame-capped read. | Full snapshot then trim (unbounded, E37); parse rollout files; a mode flag on the full read. | E36-E40; AC 3.4, 3.9, 3.10. | Yes (constants and method) |
| K17 | (Rev 2) The carry-over reads through `SessionHistoryRouter.readCarryOverTranscript`, which routes by stored metadata exactly as the existing history read does; both kinds return one `CarryOverTranscript` type. | The service picks the reader itself; separate result types. | E36; `chat-history-read.service.ts:72-73`. | Yes |
| K18 | (Rev 2) Codex -> Claude is detected at `/compact`: the renderer asks the host check before sending `/compact`, and an eligible native session is carried over to the active provider. Native plain resume is unchanged (U1 option A). | Refuse native resume (U1-B); proactive offer surface (U1-C). | Rows 20-22; E3, E42. | Yes |
| K19 | (Rev 2) `/compact` is redirected in the renderer before `chat:continue`; the refusal is never produced for an eligible `/compact` and stays byte-identical otherwise. | Host-side redirect in the slash router; show the refusal and then auto-start (no trigger for native sessions, which are never refused). | E22, E42, E44; row 22. | Yes |
| K20 | (Rev 2 F3) The claimed-surface branch calls the claim before `onSurfaceCreated`: `'skip'` suppresses surface and tab binding; `'bind'` keeps the surface calls and delegates to `ChatStore.handleSessionIdResolved`, whose lifecycle claim (pure for `'bind'`) attaches the owning tab and calls `completeBinding`; `'none'` is today's code. | A second, explicit attach + `completeBinding` in the handler (two binding implementations); leave the branch conditional (the round-2 defect). | E23, E33; review Round 2 F3. | Yes |
| K21 | (Rev 2) `/compact` arguments are not forwarded into the carry-over prompt; the instruction is fixed. | Append the arguments as user guidance (more user text to redact and bound). | AC 8.1 (only conversation text and the instruction). | Yes |
| K22 | (Rev 2) `evaluate` compares the stored and active provider ids before the readiness probe, so a same-provider session (the common `/compact` case) never runs `prepare`. | Probe first (Rev 1 order). | A3; E4. | Yes |
| K23 | (Rev 2) The `/compact` eligibility check has its own 5 s RPC timeout and fails open to today's `/compact`. | The 30 s default; the admission timeout. | E27; Requirement 9.3 (proposed). | Yes |

## Revision 2

Inputs: decisions.md rows 20-23 (binding) and `implementation-plan-review.md` `## Round 2`.
Row 19 (Gate 2 at the revise cap) stays with the user; this revision does not pass Gate 2 by
itself (row 23).

| Change | Resolution | Sections changed |
| ------ | ---------- | ---------------- |
| K2 rejected by the user (row 20): support Claude -> Codex and Codex -> Claude | Native Codex sessions are eligible (`evaluate` source kinds); the bounded native tail read is added through codex-runtime, the Electron port and `SessionHistoryRouter`; one `CarryOverTranscript` type for both kinds. The Claude-session refusal contract is unchanged. | Inputs; Codebase evidence E3 (restated), E36-E41; Architecture decision (approach, invariants, rejected alternatives, A7, A8, effect on existing code); Component 2 (shared type, router caller); Component 3 (native constants, 20 s timeout, native spec case); Component 4 (router dependency, source kinds, specs); Components 11 and 12 (new); Integration architecture; Decisions K2 (superseded), K16, K17 |
| Codex -> Claude detection and offer (row 21) | Detected at `/compact` by the host check (a native session is never refused, E3); native plain resume is not changed; refusing or redirecting it, or a proactive offer, is user-reserved U1 with options and a recommendation. | Architecture decision; Component 13; `## User-reserved items` U1; Decisions K18; Proposed requirement change 2 |
| Bounded native history tail (AC 3.4/3.10, row 12 strict cap) | Root thread only, newest-first `thread/turns/list` pages, caps 200 turns / 8 turn pages / 16 item pages (25 requests max), legacy one frame-capped read, no descendants; spec asserts request params and counts on a 10x fixture. | Component 11; Component 12; Component 3 constants; Proposed requirement changes 4-6; Risks |
| `/compact` as a second trigger (row 22) | Renderer branch in `runContinueConversation`: `/compact` on a bound session asks `chat:carry-over-check` (5 s) and, when eligible, runs the same carry-over instead of `chat:continue`; otherwise today's path, so the `/compact` refusal is byte-identical whenever it can occur. Covers both directions and queued `/compact`. The banner button stays. | Component 7 (`startFromCompact`, shared `launch`, nullable generation, compact failure mapping); Component 9 (busy during a `/compact` run); Component 10 (native `/compact` host pin); Component 13 (new); `## /compact trigger size`; U2; Decisions K19, K21, K22, K23; Proposed requirement changes 1, 3, 7, 8 |
| Gate 2 round 2 F1 (Serious) | After `prepare`, on every runtime branch, re-read `resolveActiveAuthForPath(workspaceId).providerId` and compare it and the served provider with the pin, before `pendingLineage.set` and any adapter call; fail closed when the resolver is absent. Race test: `prepare` returns a pinned-provider profile while the active fake switches back; zero `startChatSession`, `resumeSession` and metadata writes; repeated on the Codex and `undefined`-profile branches. | Architecture decision (invariants); Component 5 (responsibilities, specs); Decisions K13 |
| Gate 2 round 2 F3 (Serious) | The claimed-surface branch at `chat-message-handler.service.ts:837-852` is a required edit: claim before `onSurfaceCreated`; `'skip'` suppresses surface and tab binding; `'bind'` keeps the surface calls and delegates to `ChatStore.handleSessionIdResolved` (attach of the owning tab, `completeBinding`); `'none'` is today's code. Integration test asserts the tab id, pending release, notice timing and no attach on skip. A6 removed; A9 added for the sidebar refresh after a skip. | Codebase evidence E33; Architecture decision (invariants, A6, A9); Component 7 (`claimSessionResolution` purity, idempotent `completeBinding`); Component 8 (rewritten); Decisions K20 |
| Footprint, files, batch hints, verify | Production 4 new / 22 modified (+1 conditional); `ptah-electron` and `@ptah-extension/codex-runtime` join the changed projects; final verify lists 8 projects; per-batch examples updated. | Team-leader handoff; Risks |

## Revision 1

Gate 2 round 1 (codex, REVISE; `implementation-plan-review.md`). F1-F6 and F8 accepted; F7 partly
disputed and settled by decisions.md row 18.

| Finding | Resolution | Sections changed |
| ------- | ---------- | ---------------- |
| F1 (Serious) provider can change between `evaluate` and launch | Pin the click-time active id; re-check after the read and in `launchSdkSession` after `prepare`; a change returns `NOT_ELIGIBLE` with nothing created. (Completed in Rev 2.) | Architecture decision; E30; Components 4, 5; Integration; K4, K13 |
| F2 (Serious) failure results overwrite a newer refusal | Every failure-side banner or offer mutation runs only through `ownsUi(entry)`. | Component 7; Integration |
| F3 (Serious) offer re-enables before binding; any resolution accepted | The pending entry is the busy state from click to bind or definitive failure; launches on the tab serialized; a resolution carrying the old id not claimed. (Claimed-surface branch completed in Rev 2.) | Architecture decision; E33, E34; Components 7, 8, 9; Risks; K14 |
| F4 (Serious) reused `startSession` logs and reports the raw error | Carry-over branch in the `startSession` catch: fixed text plus `loggableErrorName`; sentinel spec. | E31; Components 4, 5; Integration; Risks |
| F5 (Serious) `tool_result` dropped, against AC 3.5 | `toolNamesById` map; `[tool result: <name>]` or `[tool result]`; paired and result-only specs. | E32; Component 2 |
| F6 (Moderate) boundary cut at any `system` record | Start boundary from the latest in-window `isCompactSummary` record only. | Component 2 |
| F7 (Moderate, partly disputed) verification command | `npm run verify -- -p`, per-batch changed projects, final with the Electron and renderer projects. | Team-leader handoff; K15 |
| F8 (Moderate) view-level tab filter test was conditional | Concrete `chat-view.component.spec.ts` cases; visual-reviewer screenshots. | E35; Component 9; Team-leader handoff |
