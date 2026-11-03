# Implementation Plan - TASK_2026_865_2a1d

"Continue with <provider>" carry-over after a provider switch (Electron first).

Revision 1 (Gate 2 round 1, codex REVISE, 8 findings). The finding-to-section map is in
`## Revision 1` at the end of this document.

Paths below are relative to the worktree root
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`
(written `<wt>/`). Line numbers were read on `ff97e436a`.

## Inputs and constraints

- Requirements used: `task-description.md` (Revision 1 and the orchestrator edits to AC 3.1, 3.2
  and 3.8), `decisions.md` (rows 5-16 binding; row 17 pending; row 18 settles Gate 2 F7),
  `implementation-plan-review.md` (Gate 2 round 1), `task-description-review.md` (rounds 1-2),
  `context.md`, and the "Scope note for the orchestrator" in
  `provider-readiness/.ptah/specs/TASK_2026_864_1376/implementation-plan.md:1364-1403`.
- Corrections applied: decisions.md row 8 (no field added to the refusal, so D1 is superseded),
  row 10 (transfer policy and redaction), row 11 (bounded read, notice after binding), row 12
  (strict tail read cap, with AC 3.1, 3.2 and 3.8 as edited).
- Design handoff used: none. No designer: one button on an existing banner (decisions.md row 2).
- Missing decision-critical input: none blocks the plan. One requirement cannot happen as
  written. AC 3.10 asks for a Codex native fixture, and D9 asks for the Codex -> Claude
  direction. A native Codex session never gets the stored-provider mismatch refusal, so it never
  shows the button (evidence E3). The plan keeps both halves testable: a native Codex session is
  refused before any history read, and a spec asserts that zero bytes are read. See Decision
  K2. **K2 is PENDING USER (decisions.md row 17).** It narrows the approved D9 and AC 3.10, so
  it is written to be reversible: if the user rejects it, only the rejected alternative "bounded
  Codex native read" is added (Component 2 gains a native reader branch and Component 4 drops
  the `runtime === 'claude-sdk'` eligibility rule). No other component depends on K2.
- Parallel task TASK_2026_864_1376: its branch has no code commits yet (`git log main..HEAD` is
  empty in `provider-readiness`). Its planned AC 3.11 step 4 spec is a new file,
  `chat-session.connection-switch.spec.ts`, that asserts `AUTH_REQUIRED` and that
  `resumeSession` is not called (`TASK_2026_864_1376/implementation-plan.md:1296-1324`). This
  plan does not edit `continueSession`, `autoResumeIfInactive`, the slash router or the
  resolver, so that spec stays valid. This plan does not create that file.

## Codebase evidence

| # | Evidence | Location | Architectural implication |
| - | -------- | -------- | ------------------------- |
| E1 | The mismatch refusal is thrown only when `existingIdentity` is present on the Claude SDK route: `servingProviderId` is compared with `resolveAuthForPath(...)` and `rejectStoredProviderMismatch` is thrown. | `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:268-284`, `:542-553` | Eligibility must mirror this exact comparison (stored `providerId` against the active `providerId` for the session's folder). It must not call it with the stored identity (AC 2.3). |
| E2 | A stored proxy-era Codex Claude SDK session (`providerId 'openai-codex'`) is refused earlier, with `rejectLegacyCodexProfile` and a CODEX code, not with AUTH_REQUIRED. | same file `:273-275`, `:535-539` | Such sessions are not eligible (AC 1.2: other refusals keep today's banner). |
| E3 | A native Codex session (`existingIdentity.runtime === 'codex-app-server'`) takes the `resumeNative` branch and returns before any active-provider comparison. | same file `:190-266` | A native Codex session is never refused for a mismatch. Only Claude SDK runtime sessions are carry-over sources, so the source history is always Claude JSONL. |
| E4 | The active `providerId` is `'anthropic'` for both `apiKey` and `claudeCli`. Otherwise it is the third-party id, for example `'openai-codex'`. `resolveActiveAuthWithDefault` changes only the auth method and never the `providerId`. | `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:87-92`, `:115-128`, `:155-164` | The synchronous `resolveActiveAuthForPath(folder).providerId` equals the value the resolver compares. A host check can use it without the private credential probe. |
| E5 | The stored identity comes from `storedChatRuntimeIdentity(sessionId, metadata, workspaceId)`. It defaults to `runtime 'claude-sdk'`, with `providerId` taken from metadata or `'claude-cli'`. | `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:72-86`; `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts:31-43` | The carry-over computes the stored identity with the same helper the refusal uses. |
| E6 | `chat:continue` refusal shaping: `{ success:false, sessionId, error: message, errorCode:'AUTH_REQUIRED', providerId }`. | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2484-2495`, helper `:872-886`; the slash router at `chat-slash-command-router.service.ts:333-334`, `:459-469` | Untouched by this plan. AC 1.5 is pinned by strict-shape specs (Component 9). |
| E7 | Existing refusal specs use `toMatchObject`, not full shape. | `chat-session.native.spec.ts:576-627`; `chat-slash-command-router.native.spec.ts:357` | AC 1.5 needs new `toStrictEqual` cases beside them. |
| E8 | `startSession` creates the session on the active provider: it calls `prepare(config, undefined, modelIsStored)` with `modelIsStored = !options.model`, or `resolveClaudeExecution` when no runtime profile is bound. It returns `{success:true}` without a session id, streams to `tabId`, and admits host routing for a plain prompt. | `chat-session.service.ts:986-1134`, launch `:1379-1524` (prepare `:1462-1469`), routing admission `:1113-1116` | The carry-over reuses `startSession` (AC 2.1, 2.2, 2.4, 5.2). The new session id reaches the renderer only through `SESSION_ID_RESOLVED`. |
| E9 | Host routing sends the turn text to a decision model (`ScopeCheckService.assess`). | `chat-session.service.ts:970-983`; `chat/host-routing/host-routing.coordinator.ts:192-235`; `libs/backend/lane-routing/src/lib/scope/scope-check.service.ts:75` | The carry-over turn must not be admitted. Otherwise transcript text would reach a third consumer (AC 8.1). |
| E10 | `resolveSessionFolder` returns the session's own authorized, real folder or throws `RpcUserError` (`SESSION_NOT_FOUND` / `SESSION_FOLDER_UNAVAILABLE`). | `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:89-101`; `session-folder.ts:36-58`, `:61-97` | AC 2.6: the requested `workspacePath` must canonically equal this folder. The read and the start both use this folder. |
| E11 | The tail-window precedent: `readHistoryForCuration(..., { tailBytes })` reads through `jsonlReader.readJsonlTail` and projects user/assistant records after the last `compact_boundary`. Errors are swallowed to `[]`. | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:102-116`, `:905-994`, projection `:784-840` | A sibling carry-over read uses the same tail primitive with its own projection. It throws instead of returning `[]`, so it can report unreadable history. |
| E12 | `readJsonlTail` reads at most `maxBytes` from the end of the file, drops a partial first line, ignores the 50 MB guard and accepts an `AbortSignal`. | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:710-748`, `JsonlTailOptions :119-122` | The read is bounded by construction (AC 3.4, 3.10). A spec asserts the `maxBytes` that was passed. |
| E13 | Record flags available: `isMeta`, `isSynthetic`, `isSidechain`, `isCompactSummary`. | `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:79-87`; `jsonl-reader.service.ts:939-940`; hidden predicate `message-transform/message-transform-helpers.ts:33-38` | Sidechain records are excluded (AC 3.9). The compaction summary can be identified (AC 3.8). |
| E14 | Content extraction lives in `HistoryEventFactory` (`extractTextContent`, `extractContentForCuration`). | `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts:513-563` | A third extractor, `extractContentForCarryOver`, goes beside them. |
| E15 | File attachments are text blocks: `<file path="..." ... embedded="true">content</file>`, `<file path="..." ... />`, `<folder path="..." />`, plus one `<system-reminder>` block. Images are `type:'image'` blocks. | `libs/backend/agent-sdk/src/lib/helpers/attachment-processor.service.ts:142`, `:227`, `:257`, `:297`, image `:166-176` | AC 3.7 placeholders are text rewrites in the extractor. AC 3.6 also needs the `<system-reminder>` block stripped. |
| E16 | `redactSecrets` replaces literal values only (not patterns). It is not exported from the `cli-agent-runtime` barrel. The pattern-based redactors (`redactCodexDiagnostics`, `SECRET_SHAPES`) are module-private. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts:34-47`; `libs/backend/codex-runtime/src/lib/codex-stderr-tail.ts:6-15`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:38-42` | No reusable pattern redactor exists. A private pattern list in the carry-over renderer is required (Decision K6). |
| E17 | RPC registration chain: `RpcMethodRegistry` entry plus `RPC_METHOD_ENTRIES` (compile-enforced). `ChatRpcHandlers.METHODS` feeds the manifest (`host-profile/manifest.ts:219`). The allowlist spec checks the `chat:` prefix. The rpc-surface spec derives from the manifest. | `libs/shared/src/lib/types/rpc.types.ts:1040-1050`, `:3386-3405`; `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:117-128`, `:242-253`, `:255-`; `rpc-allowlist.spec.ts:81-128`; `apps/ptah-electron/src/di/rpc-surface.spec.ts:77-82` | Two registry entries, two `RPC_METHOD_ENTRIES` keys, `METHODS` entries and two `wire` calls. Nothing else needs a list edit. |
| E18 | The host-source baseline contract flags only names that match `/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i`. | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-22` | `chat:carry-over` and `chat:carry-over-check` do not match, so the baseline is unchanged. |
| E19 | The replay sanitizer allow-list is only checked to be a subset of `RPC_METHOD_NAMES`. | `apps/ptah-electron/src/replay/scenario-sanitizer.ts:94-120`; `scenario-sanitizer.spec.ts:286-297` | The new methods stay out of the allow-list (they move transcript text). No edit. |
| E20 | Chat sub-services are registered in `registerChatServices` as `CHAT_TOKENS` singletons in dependency order. | `libs/backend/rpc-handlers/src/lib/chat/tokens.ts:10-40`; `chat/di.ts:1-35`, `:96-101` | New `CHAT_TOKENS.CARRY_OVER`, registered after `SESSION`. `ChatRpcHandlers` resolves it, so the existing Electron smoke covers it transitively. |
| E21 | Renderer banner: one global signal `{providerId, message}`, set by `flagAuthRequired` and cleared by `clearAuthRequiredBanner`. | `libs/frontend/core/src/lib/services/auth-state.service.ts:186-189`, `:342`, `:1217-1227` | Gains `generation` and an optional `origin`. The existing `clearAuthRequiredBanner()` call sites keep working. |
| E22 | The only AUTH_REQUIRED handler is `handleAuthRequired`. The continue path has `sessionId`, `activeTabId` and `resolvedWorkspacePath` at the call. The `/compact` slash command goes through this same `chat:continue` call. | `libs/frontend/chat/src/lib/services/message-sender.service.ts:143-157`, `:806-848` | The offer origin is passed from `:848` only. The `chat:start` call at `:550` has no session and gets no offer. |
| E23 | `SESSION_ID_RESOLVED` calls `tabManager.attachSession(owner.tab.id, realSessionId)` with no ownership check. If the tab is gone, it attaches to the active tab when that tab has no session and is streaming or a draft. | `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:139-180`; `attachSession` `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2139-2157` | This one binding point needs a carry-over guard for AC 7.6 and 7.7 (closed or rebound tab). |
| E24 | The stream router appends a new session id to the tab's bound conversation. | `libs/frontend/chat-routing/src/lib/stream-router.service.ts:164-192`; `conversation-registry.service.ts:143-160` | AC 4.2 (old session first, new session after) needs no new code. |
| E25 | Tab-scoped transient notice: `ActionBannerService.showInfo(message, tabId, durationMs)`. `ChatViewComponent.actionInfo` shows it only on the matching tab. | `libs/frontend/chat/src/lib/services/action-banner.service.ts:33-85`; `chat-view.component.ts:404-410`, html `:111-121` | The AC 4.3 notice reuses it. No new notice surface. |
| E26 | Banner view: `chat-view.component.html:147-154`, handlers `chat-view.component.ts:279`, `:343-357`. The presentational banner has two buttons. | `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts:21-85` | One added `<button>` input/output pair. |
| E27 | The renderer RPC default timeout is 30 s. The chat admission methods use `CHAT_ADMISSION_RPC_TIMEOUT_MS`. An explicit `options.timeout` wins. | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:22-41` | The carry-over call passes `timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS`. `claude-rpc.service.ts` is not edited. |
| E28 | Safe error-name logging helper. | `libs/shared/src/lib/utils/loggable-error-name.ts:34` | Carry-over logs record session ids and `loggableErrorName(error)` only (AC 8.5). |
| E29 | Nx tags: `rpc-handlers` and `agent-sdk` are `scope:extension, type:feature`. `chat` is `scope:webview, type:feature`. `core` is `scope:webview, type:core`. | the `project.json` of each lib | All new imports follow existing edges (rpc-handlers -> agent-sdk/shared/auth-providers; chat -> core/chat-state). No new edge and no new project. |
| E30 | (Rev 1) `startSession` reaches the provider in `launchSdkSession` (`SdkSessionLaunch` `chat-session.service.ts:224`): `prepare`/`resolveClaudeExecution` with no identity re-resolves the active provider at `:1462-1469`, then `pendingLineage.set` at `:1473` and `sdkAdapter.startChatSession` at `:1501-1506`. The execution names its provider: `seed.providerId: 'openai-codex'` on the native branch (`workspace-provider-profile-resolver.ts:255-265`), `providerProfile.providerId` on the Claude branch (`provider-profile.types.ts:20-26`, `ResolvedExecutionProfile` `workspace-provider-profile-resolver.ts:125-140`). `providerProfile` is `undefined` only when the shared auth env serves the same provider as `resolveAuthForPath` (`:385-399`). `ChatSessionService` already injects the optional `activeProvider` resolver (`:359-362`). | listed | The provider can be revalidated after `prepare` and before `startChatSession`, the only call that sends the prompt, with no resolver change. |
| E31 | (Rev 1) The `startSession` catch logs the raw error (`:1124-1127`), sends it to Sentry through `captureSentry` (`:1128`, body `:2643-2646`) and returns `error.message` (`:1129-1133`). `codexFailure` (`:913-963`) and `mainSessionAccountFailure` (`chat-slash-command-router.service.ts:69-81`) already return fixed texts. The safe-name precedent is `new Error(\`admitUserTurn threw ${loggableErrorName(error)}\`)` (`chat-session.service.ts:977-981`), pinned by a sentinel spec (`chat-session.host-routing.spec.ts:455-476`, `loggedText`). A Sentry fake exists in `chat-session-auth.spec.ts:74-136` (`captureException` at `:89`). | listed | A carry-over launch needs its own failure branch in that catch; the precedent and the harness exist. |
| E32 | (Rev 1) `ContentBlock` carries `id`, `name` and `tool_use_id`. | `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts:125-135` | A `tool_result` can be named through the `tool_use` id seen in the same window. |
| E33 | (Rev 1) `SESSION_ID_RESOLVED` carries only `{ tabId, realSessionId }`; a tab with a rendered surface returns early before `ChatStore.handleSessionIdResolved`. | `chat-message-handler.service.ts:828-855` (`renderedSurfaceFor` `:837`, store call `:853`); `chat-lifecycle.service.ts:139-180` | No launch nonce exists to correlate a resolution, so launches on the refused tab are serialized instead. |
| E34 | (Rev 1) Every renderer launch on an existing tab enters `MessageSenderService` through `send` (`:378`, routes to continue/start at `:415-418`) or `continueExistingSessionForQueueFlush` (`:664`). Both already early-return through `isHeld` (`:382`, `:669`). Callers: `message-dispatch.service.ts:242`, `:303`; `ChatStore.sendOrQueueMessage` (`chat.store.ts:284`). | `libs/frontend/chat/src/lib/services/message-sender.service.ts` | A per-tab pending guard at those two entries serializes launches on the refused tab, following the `isHeld` early-return precedent. |
| E35 | (Rev 1) A chat-view spec harness exists: `makeHarness` (`chat-view.component.spec.ts:162`) with the `sessionContextTabId` option (`:177`, provided as `SESSION_CONTEXT` at `:613-620`), an `AuthStateService` stub with `authRequiredBanner` (`:523-528`), and an explicit provider list (`:550-634`). | `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` | The view-level tab-filter test is concrete, not conditional. |

## Architecture decision

- Chosen approach: two new chat RPC methods.
  - `chat:carry-over-check` is read-only. It reports whether a refused session can be carried
    over to the active provider.
  - `chat:carry-over` re-runs the same check, reads the session's JSONL tail locally, renders a
    bounded, redacted plain-text transcript, and starts a new chat through the existing
    `ChatSessionService.startSession` on the refused tab.

  The renderer leaves the refusal untouched. After a refusal it asks the host with structured ids
  only, binds the offer to `{sessionId, tabId, workspacePath, generation}`, and lets the
  existing `SESSION_ID_RESOLVED` path relink the tab. One small guard at that path enforces the
  identity rules.

  Revision 1 adds three invariants:
  - Provider pin (F1): the click-time `evaluate` returns the active provider id. That id is
    re-checked after the history read and passed into `startSession`, which compares it with the
    provider the prepared execution actually serves, before `startChatSession`. A change fails
    the carry-over as `NOT_ELIGIBLE` with no session created.
  - Safe launch failure (F4): a carry-over launch logs and reports only fixed text plus the
    error name. Nothing raw goes to the logger, Sentry or the RPC result.
  - Launch serialization (F3): while a carry-over is pending on a tab, the renderer starts no
    other launch on that tab and the offer stays disabled until binding or a definitive failure.
    The next new-session resolution on that tab is therefore the carry-over's own.
- Rationale:
  - AC 1.4 and 1.5 forbid touching the refusal and allow a read-only host query. The
    renderer's provider vocabulary (`'anthropic'` for Claude, tile ids) differs from the host's,
    and per-workspace readiness is host knowledge (E4, E21).
  - One host check function serves both the query and the click-time re-check (AC 1.7, 2.5). It
    mirrors the resolver comparison (E1, E4, E5) and never calls `prepare` with the stored
    identity (AC 2.3).
  - Reusing `startSession` gives the active runtime, the default model, the existing error
    shaping and the streaming (AC 2.1, 2.2, 2.4, 5.2) with no parallel launch path (E8).
- Rejected alternatives:
  - An added field on the AUTH_REQUIRED refusal. Rejected by decisions.md row 8.
  - Renderer-only eligibility (refusal `providerId` against `AuthStateService.activeProviderId`).
    It cannot see readiness per workspace, its ids differ from the host's (`'anthropic'` covers
    both `claudeCli` and `apiKey`), and it would still need the host re-check.
  - A new launch path that bypasses `startSession`. It duplicates MCP, lineage and account
    gating, and the error shaping.
  - Extending `chat:continue` or `chat:start`. That changes contracts that other surfaces and
    the parallel task rely on.
  - A bounded Codex native read through `SessionHistoryRouter`, the codex-runtime history reader
    and the Electron port (about 5 files). No native session can reach the carry-over (E3).
  - A streaming full-file scan for exact counts. Rejected by decisions.md row 12.
  - Making `redactSecrets` public. It is literal-value only and does not meet "known patterns"
    (E16).
  - (Rev 1) Correlating `SESSION_ID_RESOLVED` with a launch nonce. The payload has no such field
    (E33); adding one changes the shared message, the host broadcaster and every consumer. Per-tab
    serialization gives the same guarantee inside `chat`.
  - (Rev 1) Pinning the provider by passing an expected id into
    `resolveExecutionProfile`. That edits the resolver, which this plan keeps unchanged for the
    parallel task; the post-`prepare` check in `launchSdkSession` (E30) needs no resolver change.
- Assumptions (each has a check the implementer runs):
  - A1. A Claude SDK compaction summary record carries `isCompactSummary: true`, and may also be
    `isMeta`. The projection keeps a record with `isCompactSummary === true` regardless of the
    hidden flags. Check: write a fixture from a real compacted JSONL (`~/.claude/projects/...`,
    with content scrubbed) and assert that the summary turn appears.
  - A2. On a tab still bound to the old session, the streaming handler mints streaming state for
    the new session's first assistant event, and `applyTurnState` accepts the new session's
    `generating` after `attachSession`. Check: the renderer integration case in Component 8 (real
    `TabManagerService`, `StreamingHandlerService`, `ChatLifecycleService`). If the first
    `generating` event is dropped because of session ownership, call
    `tabManager.markTabStreaming(tabId)` at click and `markTabIdle` on failure, mirroring
    `message-sender.service.ts:476-477`.
  - A3. The new-session `prepare` used as a readiness probe has no lasting side effect beyond what
    `chat:start` would do anyway (for example a provider proxy start in `buildProfile`). Check:
    read `workspace-provider-profile-resolver.ts:484-530` (`buildProfile`) and note any proxy
    start in the PR.
  - A4. `resolvedWorkspacePath` is set on the Electron continue path
    (`message-sender.service.ts:727-740`). When it is unset, no offer is made and the banner is
    today's.
  - A5 (Rev 1). The two `MessageSenderService` entries (E34) are the only renderer paths that
    launch on an existing tab. Check: search `libs/frontend` for other callers of `chat:start`,
    `chat:continue` and `chat:resume` that take a `tabId` of an existing tab; any found gets the
    same pending guard.
  - A6 (Rev 1). A refused tab can take the rendered-surface branch (E33), which skips the
    lifecycle guard. Check: the Component 8 integration case also drives a tab with a claimed
    surface. If that branch is reachable, it calls the same `claimSessionResolution` first, so a
    pending entry is never left without a release.
- Effect on existing code: `continueSession`, the slash router, the resolver, the onboarding lib,
  the Codex sign-in code and the native history path are not changed.
  - `startSession` gains one internal carry-over launch option: no host routing, a provider
    pin checked before `startChatSession`, and a safe failure branch.
  - `MessageSenderService.send` and `continueExistingSessionForQueueFlush` gain one pending
    guard each.
  - `ChatLifecycleService.handleSessionIdResolved` gains one guard call.
  - The banner gains one button.
  - `AuthStateService`'s banner gains `generation` and `origin`.

## Component specifications

### 1. Shared RPC contract (`chat:carry-over-check`, `chat:carry-over`)

- Purpose: the typed contract of the two new methods.
- Responsibilities: params and result types. Registry entries in `RpcMethodRegistry` and
  `RPC_METHOD_ENTRIES`.
- Verified contracts and entry points: `rpc-chat.types.ts:209-223` (style of
  `ChatContinueResult`); `rpc.types.ts:11` (`export *` of `rpc-chat.types`), `:127-148` (type
  import list), `:1040-1050` (registry), `:3386-3405` (`RPC_METHOD_ENTRIES`, a compile error if a
  key is missing); `RpcUserErrorCode` in `rpc/rpc-error-codes.types.ts:7-53` (not extended).
- Shapes (to add to `rpc-chat.types.ts`):
  - `ChatCarryOverCheckParams { sessionId: SessionId; workspacePath: string }`
  - `ChatCarryOverCheckResult = { eligible: true; providerId: string; providerName: string } | { eligible: false }`
  - `ChatCarryOverParams { sessionId: SessionId; tabId: string; workspacePath: string; name?: string; ptahUiFence?: boolean }`
  - `ChatCarryOverFailureReason = 'NOT_ELIGIBLE' | 'IN_FLIGHT' | 'HISTORY_UNREADABLE' | 'START_FAILED'`
  - `ChatCarryOverResult = { success: true; providerId: string; providerName: string } | { success: false; reason: ChatCarryOverFailureReason; error: string; errorCode?: RpcUserErrorCode; providerId?: string }`
- Dependencies: none new.
- Integration points: backend Component 4 and frontend Component 7.
- Failure behaviour: not applicable (types only).
- Quality requirements: no transcript text is in any result type. `error` is always a fixed,
  short host string.
- Verification seam: `@ptah-extension/shared` typecheck. `host-source-registry.contract.spec.ts`
  passes unchanged (E18). `scenario-sanitizer.spec.ts` passes unchanged (E19).
- Files:
  - MODIFY `<wt>/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
  - MODIFY `<wt>/libs/shared/src/lib/types/rpc.types.ts`

### 2. Bounded carry-over read (agent-sdk)

- Purpose: read the newest part of a Claude JSONL session and project it to plain turns, with
  tool calls, attachments and system content already reduced.
- Responsibilities:
  - New public method `SessionHistoryReaderService.readCarryOverTranscript(sessionId,
    workspacePath, { tailBytes, signal })`. It returns
    `{ turns: readonly { role: 'user' | 'assistant'; text: string; compactionSummary: boolean }[]; windowCoversWholeHistory: boolean; startsAtCompactionSummary: boolean }`.
  - It validates the id (`validateSessionId`, `:320`). It resolves `findSessionsDirectory` and
    builds the file path as in `:952-963`. It sets `windowCoversWholeHistory = (await
    fs.stat(file)).size <= tailBytes`, then reads `jsonlReader.readJsonlTail(file, { maxBytes:
    tailBytes, signal })`.
  - Projection (start boundary revised in Rev 1, F6):
    - The start boundary is the latest non-sidechain record in the window with
      `isCompactSummary === true` (E13, A1). When one exists, the projection starts at that
      record (it becomes the first turn, `compactionSummary: true`) and
      `startsAtCompactionSummary = true`. When none exists, nothing is cut: every eligible turn
      in the window is kept and `startsAtCompactionSummary = false` (AC 3.8).
    - `system` records, including `compact_boundary`, are skipped as events (AC 3.6). They never
      move the start boundary, so a `system` event after prose, or a `compact_boundary` whose
      summary is not in the window, erases no turn.
    - Skip `isSidechain` records.
    - Skip hidden records (`isHiddenTranscriptRecord`), except `isCompactSummary` ones (A1).
    - Skip roles other than user and assistant, and `<task-notification>` content (as `:822`).
    - Merge consecutive same-role records into one turn.
    - Drop empty turns.
  - Before projecting, one pass over the window's non-sidechain records builds
    `toolNamesById: Map<string, string>` from each `tool_use` block's `id` and `name` (E32). The
    map lives only for the call.
  - New `HistoryEventFactory.extractContentForCarryOver(content, toolNamesById)`:
    - `text` keeps its text, with `<system-reminder>…</system-reminder>` removed.
      `<file path="P"…>…</file>`, `<file path="P" …/>` and `<folder path="P" />` become
      `[file: <basename(P)>]`. The base name splits on `/` and `\`.
    - `tool_use` becomes `[tool: <name or 'tool'>]`.
    - `image` becomes `[image omitted]`.
    - `document` becomes `[file: <basename(title) or 'attachment'>]`.
    - (Rev 1, F5) `tool_result` becomes `[tool result: <name>]` when
      `toolNamesById.get(tool_use_id)` has a name, else the generic `[tool result]`. Its
      `content` and `is_error` are never read into the text (AC 3.5).
    - `thinking`, `redacted_thinking` and everything else become `''`.
    - A string content gets the same text rules.
- Verified contracts and entry points: E11, E12, E13, E14, E15. The `SDK_TOKENS.SDK_SESSION_HISTORY_READER`
  token is at `libs/backend/agent-sdk/src/lib/di/tokens.ts:61`.
- Dependencies: existing `JsonlReaderService` and `HistoryEventFactory` injections
  (`session-history-reader.service.ts:287-294`). No new DI. No barrel change: consumers type the
  result as `Awaited<ReturnType<SessionHistoryReaderService['readCarryOverTranscript']>>`, the
  pattern at `session-history-router.ts:14-16`.
- Integration points: called only by Component 4, and only for Claude SDK runtime sessions
  (E3). It deliberately does not go through `SessionHistoryRouter`, because native sessions are
  not eligible (Decision K2).
- Failure behaviour: it throws on an invalid id, a missing sessions directory, a missing file, a
  stat or read error, or an abort. It never returns `[]` for an error. It logs nothing with
  content.
- Quality requirements: at most `tailBytes` bytes are read from the file (plus the 1-byte
  partial-line lookback that `readJsonlTail` already does). It never calls `readJsonlMessages`.
  It writes nothing.
- Verification seam: a new spec drives the method with a mocked `JsonlReaderService`
  (`findSessionsDirectory`, `readJsonlTail`) and a temp file for `stat`. Cases:
  - a 10x-bound fixture: `readJsonlTail` called once with `maxBytes === tailBytes`,
    `readJsonlMessages` never called, `windowCoversWholeHistory === false` (AC 3.10);
  - `tool_use` produces the tool line and the tool input is absent (AC 3.5);
  - (Rev 1, F5) paired: a `tool_use` (`id: X`, `name: Bash`) and a later `tool_result`
    (`tool_use_id: X`) with a content sentinel and `is_error: true` give `[tool: Bash]` and
    `[tool result: Bash]`, and the sentinel is absent;
  - (Rev 1, F5) result-only: a `tool_result` whose `tool_use` lies before the window gives
    `[tool result]`, and its content sentinel is absent;
  - thinking, system, `compact_boundary` and the reminder are removed (AC 3.6);
  - image and file placeholders, with the file content absent (AC 3.7);
  - a sidechain record is excluded (AC 3.9);
  - a summary just inside the window, and a boundary-less window (AC 3.8 fixtures);
  - (Rev 1, F6) a `system` event after user and assistant prose keeps every prose turn;
  - (Rev 1, F6) a `compact_boundary` in the window with no `isCompactSummary` record after it
    keeps the turns before and after it, and `startsAtCompactionSummary === false`;
  - (Rev 1, F6) two summaries in the window: the projection starts at the later one;
  - an invalid id throws and makes no read call (AC 2.6).
  Extractor unit cases (paired name, unknown id, content never read) go in the existing
  `history-event-factory.spec.ts`.
- Files:
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
  - MODIFY `<wt>/libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.spec.ts`
  - CREATE `<wt>/libs/backend/agent-sdk/src/lib/session-history-reader.carry-over.spec.ts`

### 3. Transcript renderer and redaction (rpc-handlers, pure)

- Purpose: turn the projected turns into the first-turn prompt, within a fixed budget, with
  known secret patterns redacted.
- Responsibilities:
  - Constants:
    - `CARRY_OVER_READ_TAIL_BYTES = 2 * 1024 * 1024`;
    - `CARRY_OVER_TEXT_BUDGET_CHARS = 48_000` (the rendered transcript, including the omission
      line and the truncation marker);
    - `CARRY_OVER_READ_TIMEOUT_MS = 10_000`;
    - `CARRY_OVER_INSTRUCTION`, a fixed text that asks for a summary of the goal, decisions,
      current state and open next steps, and to reply with the summary only.
  - `redactKnownSecrets(text)` replaces each match with `[REDACTED]` (Decision K6). Patterns:
    - an `Authorization:` header line;
    - `Bearer <token>`;
    - `sk-[A-Za-z0-9_-]{8,}`, which covers `sk-ant-…`;
    - `AKIA[0-9A-Z]{16}`;
    - `gh[pousr]_[A-Za-z0-9]{20,}` and `github_pat_[A-Za-z0-9_]{20,}`;
    - `xox[abprs]-[A-Za-z0-9-]+`;
    - `AIza[0-9A-Za-z_-]{35}`;
    - a JWT `eyJ…\.…\.…`;
    - PEM `-----BEGIN [A-Z ]*PRIVATE KEY-----…-----END [A-Z ]*PRIVATE KEY-----`;
    - `(api[_-]?key|token|secret|password)\s*[:=]\s*<value>`.
    The patterns are modelled on `codex-stderr-tail.ts:6-15` and `route-tool-handlers.ts:38-42`.
    There is no generic 40-character base64 rule, because it would destroy commit hashes and ids
    that the summary needs.
  - `renderCarryOverPrompt(transcript, budget = CARRY_OVER_TEXT_BUDGET_CHARS)` returns
    `{ prompt, keptTurns, omittedTurns }`, or `null` when there are no text turns.
    - Label each turn `User:`, `Assistant:`, or `Summary of the earlier conversation:` (for
      `compactionSummary`).
    - Redact each turn before measuring, so a cut can never expose a secret prefix (the rule in
      `codex-stderr-tail.ts:17`).
    - Keep whole turns from the newest backwards while they fit, and drop the oldest first
      (AC 3.2).
    - When the newest turn alone exceeds the budget, keep its end, prefixed by
      `[start of this message omitted]` (AC 3.3).
    - Omission line: `Earlier conversation omitted (N turns).` only when
      `windowCoversWholeHistory` or `startsAtCompactionSummary`. Otherwise
      `Earlier conversation omitted.`. The no-count line is always present when the window does
      not cover the whole history and no summary starts the window (AC 3.2, 3.8). There is no
      line when everything fits and the window covers the whole history (AC 3.1).
    - `prompt = CARRY_OVER_INSTRUCTION + '\n\n<previous-conversation>\n' + transcript + '\n</previous-conversation>'`.
- Verified contracts and entry points: none external. Pattern precedent E16.
- Dependencies: none (pure module). No import from `cli-agent-runtime`.
- Integration points: Component 4.
- Failure behaviour: it does not throw on input. An empty input returns `null`.
- Quality requirements: the rendered transcript length is at most the budget for any input. The
  prompt adds only the fixed instruction and the tags.
- Verification seam: a new spec covers:
  - every turn in order when the history fits (AC 3.1);
  - oldest-first drop with the exact count when the window covers the whole history, and the
    no-count line otherwise (AC 3.2);
  - a single oversize newest turn keeps its tail and stays within the budget (AC 3.3);
  - a property-style oversize input (10x the budget, many turns, one huge turn) always gives
    `transcript.length <= budget` (AC 3.4);
  - the summary as the first block, and the summary-outside-window and turns-before-window
    cases (AC 3.8);
  - each secret pattern in user prose and in a summary is absent from `prompt` (AC 8.2, 8.3).
- Files: CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts`,
  CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts`

### 4. `ChatCarryOverService` (rpc-handlers)

- Purpose: own the host side of the carry-over. That is the eligibility check, the in-flight
  guard, the bounded read, the render and the start.
- Responsibilities:
  - `check(params): Promise<ChatCarryOverCheckResult>` calls `evaluate`. Any throw gives
    `{ eligible:false }`.
  - `carryOver(params): Promise<ChatCarryOverResult>`:
    1. If the session id is in the `inFlight` set, return `IN_FLIGHT`. Otherwise add it, and
       remove it in `finally` (AC 5.4).
    2. Call `evaluate` again (AC 1.7, 2.5). When it is not eligible, return `NOT_ELIGIBLE`.
       Otherwise keep its active id as `pinnedProviderId` (Rev 1, F1).
    3. Call `reader.readCarryOverTranscript(sessionId, folder, { tailBytes:
       CARRY_OVER_READ_TAIL_BYTES, signal: AbortSignal.timeout(CARRY_OVER_READ_TIMEOUT_MS) })`.
       A throw gives `HISTORY_UNREADABLE`.
    4. Call `renderCarryOverPrompt`. `null` gives `HISTORY_UNREADABLE` (AC 5.1).
    5. (Rev 1, F1) Re-read `activeProviderResolver.resolveActiveAuthForPath(folder).providerId`
       (synchronous, no provider call, E4). When it differs from `pinnedProviderId`, return
       `NOT_ELIGIBLE` with no start. This closes the window opened by the up-to-10 s read.
    6. Call `session.startSession({ tabId, workspacePath: folder, prompt, name, ptahUiFence },
       { expectedProviderId: pinnedProviderId })` (Component 5). The launch re-checks the pin
       after `prepare` and before `startChatSession`, which closes the remaining window.
       - A result whose `error === CARRY_OVER_PROVIDER_CHANGED` (the constant Component 5
         exports) gives `NOT_ELIGIBLE`.
       - Any other `!success` (including `cancelled`) gives `START_FAILED` with the start's
         `errorCode`/`providerId` passed through and a fixed
         `error: "Couldn't start a new chat with <providerName>."` (AC 5.2). The start's own
         `error` text is never forwarded (K11).
       - Success gives `{ success:true, providerId, providerName }`.
    `CARRY_OVER_INSTRUCTION` must not start with `/`, so the slash interceptor in `startSession`
    (`chat-session.service.ts:1039-1041`) passes the prompt through.
  - `evaluate(sessionId, workspacePath)` is private and shared by both methods. In order:
    1. `folder = await historyRead.resolveSessionFolder(sessionId)` (E10). It must equal
       `fs.realpath(path.resolve(workspacePath))`, otherwise the session is not eligible
       (AC 2.6).
    2. `identity = storedChatRuntimeIdentity(sessionId, await metadataStore.get(sessionId),
       folder)` (E5). It is not eligible unless `identity.runtime === 'claude-sdk'` and
       `identity.providerId !== 'openai-codex'` (E2, E3).
    3. Run the new-session readiness probe:
       - when `runtimeProfile` is bound,
         `runtimeProfile.prepare({ tabId, workspaceId: folder, projectPath: folder, model:
         modelSettings.selectedModel.get() || 'default', … }, undefined, true)`;
       - otherwise `resolveClaudeExecution(resolver, folder, model, true)`, the same branch as
         `chat-session.service.ts:1462-1469`.
       A throw means not eligible (AC 1.3). A result with `runtime === 'codex-app-server'` also
       requires `codexAuth.isAuthenticated() === true`, where `codexAuth` is optional
       `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH`; when it is absent the session is not eligible.
    4. `activeId = activeProviderResolver.resolveActiveAuthForPath(folder).providerId` (E4).
       `activeProviderResolver` is optional; when it is absent the session is not eligible. It
       is not eligible when `activeId === identity.providerId`. An eligible result returns
       `{ folder, activeId, providerName }`; `carryOver` uses `activeId` as the pin (Rev 1).
    5. `providerName`: `'openai-codex'` gives `'Codex'`, `'anthropic'` gives `'Claude'`,
       otherwise `getAnthropicProvider(activeId)?.name ?? activeId`
       (`libs/shared/src/lib/providers/provider-registry.ts:766-773`).
  - Logging: info `[carry-over] started { sessionId, tabId, providerId, keptTurns,
    omittedTurns }`; warn `[carry-over] <step> failed { sessionId, error:
    loggableErrorName(e) }`. Never text or messages (AC 8.5). The service itself never calls
    Sentry; the launch's safe failure branch (Component 5) is the only Sentry path (Rev 1, F4).
- Verified contracts and entry points:
  - `ChatHistoryReadService.resolveSessionFolder` `chat-history-read.service.ts:89`;
  - `storedChatRuntimeIdentity` `chat-runtime-profile.service.ts:72`;
  - `ChatRuntimeProfileService.prepare` `:120-140`;
  - `resolveClaudeExecution` `:49-70`;
  - `ActiveProviderResolver.resolveActiveAuthForPath` `active-provider-resolver.ts:87`;
  - `ICodexAuthService.isAuthenticated` `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts:64`;
  - token `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH` `libs/backend/auth-providers-tokens/src/lib/tokens.ts:38`;
  - optional injection precedent for the active provider resolver
    `chat-session.service.ts:359`;
  - `SETTINGS_TOKENS.MODEL_SETTINGS` as used at `chat-session.service.ts:1417-1418`;
  - `loggableErrorName` (E28).
- Dependencies (all through `@inject` tokens, pointing inward):
  - `TOKENS.LOGGER`;
  - `CHAT_TOKENS.SESSION`, `CHAT_TOKENS.HISTORY_READ`, and `CHAT_TOKENS.RUNTIME_PROFILE`
    (optional);
  - `SDK_TOKENS.SDK_SESSION_METADATA_STORE` and `SDK_TOKENS.SDK_SESSION_HISTORY_READER`;
  - `AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER`, plus
    `SDK_ACTIVE_PROVIDER_RESOLVER` and `SDK_CODEX_AUTH` (both optional);
  - `SETTINGS_TOKENS.MODEL_SETTINGS`.
- Integration points: `ChatRpcHandlers` (Component 6). It calls `startSession` (Component 5).
- Failure behaviour:
  - every failure is result-shaped with a fixed `error`, and no throw escapes except
    `RpcUserError` for invalid params (Component 6);
  - no session is created on any failure before step 6, nor when the launch reports a provider
    change (Rev 1);
  - a provider change between the click-time check and the launch never reaches the old
    provider: step 5 catches it before `startSession`, and Component 5 catches it after
    `prepare` and before `startChatSession` (Rev 1, F1);
  - the old session is only read (AC 6.1): no metadata write, no `resumeSession`, no `prepare`
    with an identity (AC 2.3).
- Quality requirements:
  - bounded read and time (2 MiB, 10 s abort);
  - one in-flight carry-over per session id;
  - the `inFlight` set holds only active requests and is always cleared in `finally`.
- Verification seam: a new unit spec with fakes. Cases:
  - eligible mismatch (Claude -> Codex, and OpenRouter -> Claude) (AC 1.1, D9);
  - same provider (AC 2.5) and a probe throw for each provider kind (AC 1.3);
  - Codex not signed in;
  - a native Codex identity, with the reader and router not called (Decision K2, AC 3.10);
  - a proxy-era Codex identity (E2);
  - a folder mismatch or unknown session, with no read call (AC 2.6);
  - `prepare` calls never carry an identity, and the fake adapter's `resumeSession` count is 0
    (AC 2.3);
  - `startSession` is called exactly once, with `workspacePath === folder`, no `options.model`,
    a prompt that starts with `CARRY_OVER_INSTRUCTION`, and `{ expectedProviderId: <the
    click-time active id> }` (AC 2.1, 2.2, 2.4);
  - (Rev 1, F1) deferred read plus provider switch: the reader fake returns a deferred promise;
    while it is pending the active-provider fake switches back to the stored provider; after the
    read resolves the result is `NOT_ELIGIBLE`, the `startSession` fake is never called (so no
    call reaches any provider), the `prepare` fake records no call after the read and never one
    with an identity, and the metadata store fake records zero writes for any id (old-session
    writes = 0). The launch-boundary half of the pin is proved in Component 5;
  - (Rev 1, F1) a `startSession` fake that returns `{ success:false, error:
    CARRY_OVER_PROVIDER_CHANGED }` maps to `NOT_ELIGIBLE`;
  - (Rev 1, F4) a `startSession` fake that returns an `error` holding a transcript sentinel:
    the RPC result and every logger mock call are free of the sentinel;
  - a concurrent second call returns `IN_FLIGHT` and makes one start (AC 5.4);
  - an unreadable or empty history makes no start (AC 5.1);
  - a start AUTH_REQUIRED or CODEX code is passed through (AC 5.2);
  - a secret in a fixture transcript and in a summary is absent from the logger mock calls and
    from the RPC result, on success and on a forced start failure (AC 8.3, 8.5);
  - the reader fake's `tailBytes === CARRY_OVER_READ_TAIL_BYTES` (AC 3.10).
- Files: CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`,
  CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`

### 5. `startSession` carry-over launch option (rpc-handlers) (rewritten in Rev 1)

- Purpose: let the carry-over start a chat on exactly the provider it checked, without host
  routing, and fail without leaking transcript text (E9, E30, E31).
- Responsibilities:
  - Add the optional second parameter `launch?: CarryOverLaunch` to
    `ChatSessionService.startSession` (`:986-988`), where
    `CarryOverLaunch = { readonly expectedProviderId: string }` is declared and exported in
    `chat-session.service.ts`. Its presence marks a carry-over launch; there is one caller
    (Component 4), so it is one option, not a set of flags. The RPC path
    (`chat-rpc.handlers.ts:257-263`) passes nothing, so `chat:start` behaviour is unchanged.
  - Host routing: the admission at `:1115` runs only when `launch` is absent.
  - Provider pin (F1): `SdkSessionLaunch` (`:224`) gains `expectedProviderId?: string`, passed
    from `launch`. In `launchSdkSession`, right after the `prepare`/`resolveClaudeExecution`
    result (`:1462-1469`) and before `pendingLineage.set` (`:1473`) and
    `sdkAdapter.startChatSession` (`:1501-1506`), when `expectedProviderId` is set, compute the
    served provider:
    - `codex-app-server`: `execution.seed.providerId`;
    - `claude-sdk`: `execution.providerProfile?.providerId`, or, when the profile is
      `undefined` (shared env serves the active provider, E30),
      `this.activeProvider?.resolveActiveAuthForPath(workspaceId).providerId`;
    - no value (resolver not bound): treat as changed (fail closed).
    When it differs from `expectedProviderId`, throw a module-private
    `CarryOverProviderChangedError`. No stream, lineage entry or session is created.
  - Safe failure (F4): in the `startSession` catch (`:1119-1134`), when `launch` is present:
    - `codexFailure` and `mainSessionAccountFailure` keep their fixed-text results, as today;
    - `CarryOverProviderChangedError` returns `{ success:false, error:
      CARRY_OVER_PROVIDER_CHANGED }` (an exported fixed constant) with no log above debug and
      no Sentry capture;
    - any other error: `logger.warn('[carry-over] start failed', new Error(\`carry-over start
      threw ${loggableErrorName(error)}\`), { tabId })` and
      `sentryService.captureException(<that same Error>, { errorSource:
      'ChatSessionService.carryOverStart' })`, then return `{ success:false, error:
      CARRY_OVER_START_FAILED, ...this.authErrorFields(error) }` (fixed constant; only
      `errorCode`/`providerId` from `authErrorFields`, `:876-888`).
    The raw `error`, its `message` and its `stack` reach no logger, Sentry or result. The
    existing branch (`:1124-1133`) is unchanged for `chat:start`.
- Verified contracts and entry points: `chat-session.service.ts:224`, `:986-988`, `:1115`,
  `:1119-1134`, `:1462-1469`, `:1473`, `:1501-1506`, `:2643-2646`; E30, E31.
- Dependencies: none new (`loggableErrorName` from `@ptah-extension/shared`, the existing
  `activeProvider` and `sentryService` injections).
- Integration points: Component 4.
- Failure behaviour: as above. A provider change creates nothing and is reported as a fixed
  constant that Component 4 maps to `NOT_ELIGIBLE`.
- Quality requirements: no change to the RPC contract or to `chat:start`; the check is one
  comparison and adds no I/O on the Claude-with-profile and Codex branches.
- Verification seam:
  - `chat-session.host-routing.spec.ts` (harness at `:107`, `:205`): `admitUserTurn` is not
    called for a carry-over launch and is still called without one.
  - New `chat-session.carry-over-launch.spec.ts`, using the positional harness of
    `chat-session-auth.spec.ts:74-136` (Sentry fake at `:89`) with a `prepare` fake and an
    adapter fake:
    - pin holds: `prepare` resolves a Claude execution whose `providerProfile.providerId`
      equals `expectedProviderId`, so `startChatSession` is called once;
    - (F1) `prepare` resolves the old provider (`providerProfile.providerId` = the stored id),
      and, separately, an `undefined` profile while the active-resolver fake reports the old id:
      `startChatSession` and `resumeSession` are called 0 times, no metadata write happens, and
      the result is `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }`;
    - (F1) a Codex execution with `expectedProviderId: 'anthropic'` is refused the same way;
    - (F4) `prepare` throws, and separately `startChatSession` throws, an `Error` whose message
      and stack hold a transcript sentinel: the sentinel is absent from every logger method's
      calls (`loggedText` pattern, `chat-session.host-routing.spec.ts:474`), from every
      `captureException` call argument (message, stack, context), and from the returned
      result; the Sentry call carries only the fixed text plus the error name;
    - without `launch`, the same throw still takes today's branch (regression pin).
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts`
  - CREATE `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts`

### 6. Registration and RPC wiring (rpc-handlers)

- Purpose: expose Component 4 as two `chat:*` RPC methods through the existing patterns.
- Responsibilities:
  - Add `CHAT_TOKENS.CARRY_OVER = Symbol.for('ChatCarryOverService')`.
  - `registerChatServices` registers it after `SESSION` (`di.ts:101`) and updates the order
    comment (`:12-22`).
  - `ChatRpcHandlers` injects it after `permissionHandler` (`chat-rpc.handlers.ts:145-146`) as a
    required parameter. It appends `'chat:carry-over-check'` and `'chat:carry-over'` to
    `METHODS` (`:117-128`) and wires both (`:255-405`).
  - Add the debug list entry (`:407-420`).
  - Schemas in `chat-rpc.schema.ts`, using `uuidString` (`:56`) and `.strict()`:
    - `ChatCarryOverCheckParamsSchema { sessionId: uuidString, workspacePath: z.string().min(1).max(4096) }`;
    - `ChatCarryOverParamsSchema` adds `tabId: uuidString`, `name: z.string().max(200).optional()`
      and `ptahUiFence: z.boolean().optional()`.
  - A parse failure throws `RpcUserError('Invalid carry-over request', 'INVALID_PARAMS')`, the
    pattern at `:372-385`.
- Verified contracts and entry points: E17, E20.
- Dependencies: `rpc-handlers` internal only.
- Integration points: renderer `ClaudeRpcService.call`. The manifest picks up `METHODS` at
  `host-profile/manifest.ts:219`. The Electron rpc-surface spec derives from the manifest.
- Failure behaviour: invalid params raise `INVALID_PARAMS`. Everything else is result-shaped by
  Component 4.
- Quality requirements: no handler logs params beyond the existing `runRpc` method/code lines
  (`:97-137`).
- Verification seam: update `chat-rpc.handlers.spec.ts`: the `METHODS` order test at `:231`, the
  constructor argument at `:116`, and one case each that the two methods delegate and that bad
  params give `INVALID_PARAMS`. Add `CARRY_OVER` registration to `chat/di.spec.ts` (`:59-60`
  pattern). `rpc-allowlist.spec.ts`, `register-shared-rpc-handlers.spec.ts` and
  `apps/ptah-electron/src/di/rpc-surface.spec.ts` / `container.smoke.spec.ts` must pass
  unchanged.
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/di.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/di.spec.ts`

### 7. Banner identity (core) and offer controller (chat)

- Purpose: bind each offer to the refusal that produced it, decide eligibility from structured
  data, run the click, and finish the relink safely.
- Responsibilities, `AuthStateService` (core):
  - The banner type becomes `{ providerId; message; generation: number; origin: { sessionId;
    tabId; workspacePath } | null }`.
  - `flagAuthRequired(providerId, message, origin?)` increments a private counter and returns
    the new generation.
  - `clearAuthRequiredBanner(generation?)` clears only when no generation is given or the
    generation matches (AC 7.5).
  - The existing call sites and the `openai-codex` side effect (`:1217-1222`) are unchanged.
- Responsibilities, `MessageSenderService`: at the continue call site (`:848`),
  `handleAuthRequired(result, { sessionId, tabId: activeTabId, workspacePath:
  resolvedWorkspacePath })`. It passes the origin only when all three are set, and after
  flagging calls `carryOver.offerFor(generation)`. That call is not awaited and its errors are
  caught. It never reads `result.data.error` for this decision (AC 1.4). The `chat:start` call
  site (`:550`) passes no origin.
- Responsibilities, `ProviderCarryOverService` (new, chat, `providedIn: 'root'`):
  - Signals: `offer` (`{ generation, sessionId, tabId, workspacePath, providerId,
    providerName } | null`) and `pending`, a signal of `Map<tabId, { sessionId, generation,
    origin, bannerProviderId, providerName, rpcSettled }>` (Rev 1: `inFlightSessionIds` is
    removed; busy state is derived from `pending`). It holds at most one entry per open tab and
    deletes each entry only on bind, skip, a definitive failure, a chat error for the tab, or a
    missing tab found at the next `start`/claim.
  - (Rev 1, F3) `isPending(tabId)` and `isBusy(sessionId)` (any pending entry for that
    session) are the only busy predicates. The button is disabled from the click until the
    entry is deleted, which spans the RPC and the wait for `SESSION_ID_RESOLVED`.
  - `offerFor(generation)` reads the banner origin and calls `chat:carry-over-check { sessionId,
    workspacePath }`. It sets `offer` only if the result is eligible and the banner generation
    is still the same (AC 1.1-1.3, 1.6).
  - `start(offer)` does the click-time checks (AC 7.2). The offer generation must equal the
    banner generation. The tab (`findTabByIdAcrossWorkspaces(offer.tabId)`) must exist and have
    `claudeSessionId === offer.sessionId`. Neither `isPending(offer.tabId)` nor
    `isBusy(offer.sessionId)` may be true (Rev 1, F3: a second click after RPC success but
    before resolution sends nothing). If any check fails: no RPC; clear the offer unless the
    failure is only "pending"; and, if the tab is gone, `clearAuthRequiredBanner(generation)`
    (AC 4.5).

    If the checks pass:
    1. Add `pending[tabId]`, capturing `generation`, the banner `origin` and
       `bannerProviderId` at click time. This disables the button (AC 5.4).
    2. Call `chat:carry-over { sessionId, tabId, workspacePath, name: tab.name, ...(isElectron ?
       { ptahUiFence:true } : {}) }` with `timeout: CHAT_ADMISSION_RPC_TIMEOUT_MS` (E27).
    3. Map the result:
       - success: mark `pending.rpcSettled`. The entry stays, so the button stays disabled.
         Binding happens in `claimSessionResolution`.
       - Every failure result below is definitive: delete `pending[tabId]` first. Then apply
         its UI effect only through the Rev 1 (F2) guard `ownsUi(entry)`: the current banner
         `generation === entry.generation` AND the entry's tab still exists AND that tab's
         `claudeSessionId === entry.sessionId`. When the guard fails, no banner or offer is
         touched (a newer refusal, or a tab that moved on, keeps its own UI).
       - `NOT_ELIGIBLE`: if `ownsUi`, clear the offer when `offer.generation ===
         entry.generation` (AC 2.5).
       - `IN_FLIGHT`: no UI change (another host request owns the session); the offer
         re-enables because the entry is deleted.
       - `HISTORY_UNREADABLE`: if `ownsUi`, `flagAuthRequired(entry.bannerProviderId,
         "Couldn't read this conversation to continue it.", entry.origin)` gives a new
         generation, so the button is gone (AC 5.1).
       - `START_FAILED`: if `ownsUi`, `flagAuthRequired(result.providerId ??
         entry.bannerProviderId, result.error, entry.origin)` (AC 5.2).
       - A transport failure or timeout is not definitive: the entry stays (button disabled)
         until resolution, a chat error for the tab, or the tab's removal.
    4. No `finally` cleanup of busy state (Rev 1): the entry's lifetime is the busy state.
  - (Rev 1, F3) Launch serialization: `MessageSenderService.send` (`:378`) and
    `continueExistingSessionForQueueFlush` (`:664`) return early, before any RPC, when
    `carryOver.isPending(<target tab id>)`, with the fixed outcome `{ success:false, error:
    'A new chat is starting in this tab.' }`, the same early-return shape as `isHeld`
    (`:382`, `:669`, E34). So no other launch can resolve a session id on that tab while the
    entry exists.
  - `claimSessionResolution(tabId, realSessionId): 'none' | 'bind' | 'skip'`:
    - `'none'` when there is no `pending[tabId]`;
    - (Rev 1, F3) `'none'` without consuming the entry when `realSessionId ===
      pending.sessionId` (a resolution of the old session is not the carry-over's; today's
      attach of the same id is a no-op change);
    - `'skip'` when the tab is gone (AC 7.6), and the pending entry is deleted;
    - `'skip'` when the tab is rebound (`claudeSessionId !== pending.sessionId`) (AC 7.7). The
      entry is deleted and `chat:abort { sessionId: realSessionId }` is issued so the new
      session stops streaming into a tab that now shows another conversation. The session
      stays in history (Decision K9). Because launches on the tab are serialized, the resolved
      id is the carry-over's own, so the abort never hits a session the user started (Rev 1);
    - otherwise `'bind'`.
  - `completeBinding(tabId)`, after the attach:
    - shows `ActionBannerService.showInfo(NOTICE(providerName), tabId, CARRY_OVER_NOTICE_MS =
      15_000)`, with the notice text "Continued with <provider> in a new chat from a summary of
      this conversation. The original conversation is unchanged. This conversation's text was
      sent to <provider>." (AC 4.3, 8.4);
    - calls `clearAuthRequiredBanner(pending.generation)` (AC 4.4, 7.5), so a newer banner
      stays;
    - clears the offer if it belongs to that generation;
    - deletes `pending`.
  - `onChatError(tabId)` deletes `pending[tabId]`. No notice is shown (AC 5.2, 5.3: after a bind
    the notice was already shown, and a later turn failure does not remove it).
- Verified contracts and entry points: E21, E22, E23, E25, E27.
  - `TabManagerService.findTabByIdAcrossWorkspaces` `tab-manager.service.ts:710`;
  - `ClaudeRpcService.call` `claude-rpc.service.ts`;
  - `CHAT_ADMISSION_RPC_TIMEOUT_MS` from `@ptah-extension/shared` (`claude-rpc.service.ts:19`);
  - `VSCodeService.isElectron` as used at `message-sender.service.ts:823`.
- Dependencies: `chat` -> `core` (`AuthStateService`, `ClaudeRpcService`, `VSCodeService`),
  `chat` -> `chat-state` (`TabManagerService`), and `ActionBannerService` in the same lib. These
  are existing edges (E29). `core` does not import `chat`.
- Integration points: `MessageSenderService` (offer), `ChatViewComponent` (render and click),
  and `ChatLifecycleService` (Component 8).
- Failure behaviour:
  - a check RPC failure means no offer and today's banner;
  - a click on a stale offer sends no request;
  - start failures replace the banner message with a fixed text and remove the button, but only
    while the original refusal generation and tab identity still own the UI (Rev 1, F2);
  - a send on a tab with a pending carry-over is refused locally with a fixed message and no
    RPC (Rev 1, F3);
  - the tab binding to the old session is untouched on every failure before a session id exists
    (AC 5.2).
- Quality requirements:
  - no timers except the existing `ActionBannerService` one;
  - `pending` is bounded by open tabs and released on bind, skip, definitive failure, chat
    error, or the tab's removal (detected at the next `start`/claim);
  - no transcript text is held in the renderer.
- Verification seam: a new spec for `ProviderCarryOverService`, with a mocked `ClaudeRpcService`
  that returns deferred promises, a real `AuthStateService` signal state, and a stub
  `TabManagerService`. Cases:
  - the decision is identical when only the refusal `error` text differs (AC 1.4);
  - no offer when the check is not eligible or the generation is stale (AC 1.2, 1.3, 1.6);
  - the offer carries all four identity fields (AC 7.1);
  - click checks: stale generation, a closed tab clears the banner, a rebound tab (AC 7.2, 4.5);
  - a double click gives one RPC (AC 5.4);
  - deferred races (AC 7.8): tab switch before the click, tab switch after it, a newer refusal
    mid-flight (the newer banner is not cleared, and the notice goes only to the refused tab), a
    tab closed mid-flight (`'skip'`, no attach, no banner clear), a tab rebound mid-flight
    (`'skip'` plus `chat:abort`), and a stale-generation click;
  - failure mappings (AC 5.1, 5.2);
  - (Rev 1, F2) newer refusal, then failures: click on generation G (deferred RPC); a newer
    refusal flags G2; resolve the RPC with `HISTORY_UNREADABLE`, and in a second case with
    `START_FAILED`. In both, the banner stays G2 with its message and origin, the G2 offer is
    untouched, `flagAuthRequired` is not called again, and `pending` is empty. The same pair
    of cases with the tab rebound instead of a newer refusal also leaves the banner as is;
  - (Rev 1, F3) success before resolution: the RPC resolves `success`; the button stays
    disabled (`isPending` true); a second click sends no RPC; then `SESSION_ID_RESOLVED` binds
    and the entry is gone;
  - (Rev 1, F3) unrelated resolution: with an entry pending, a resolution carrying the old
    `sessionId` returns `'none'` and keeps the entry; a later new id binds;
  - (Rev 1, F3) transport timeout keeps the entry (button disabled); `onChatError(tabId)`
    releases it;
  - the notice appears only after `completeBinding` (AC 4.3).

  Add `auth-state.service.spec.ts` cases for the generation, the origin, and the guarded clear.
  Add a `message-sender.service.spec.ts` case: an AUTH_REQUIRED continue passes the origin and
  calls `offerFor` once, and the start path passes no origin. (Rev 1, F3) Add
  `message-sender.service.spec.ts` cases: with `isPending(tabId)` true, `send` (both the
  existing-session and the new-session branch) and `continueExistingSessionForQueueFlush`
  return the fixed outcome and make no `chat:start`/`chat:continue` call; another tab still
  sends.
- Files:
  - MODIFY `<wt>/libs/frontend/core/src/lib/services/auth-state.service.ts`
  - MODIFY `<wt>/libs/frontend/core/src/lib/services/auth-state.service.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/message-sender.service.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.service.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts`

### 8. Relink guard (chat lifecycle)

- Purpose: make the existing `SESSION_ID_RESOLVED` binding respect the carry-over identity rules.
- Responsibilities: in `ChatLifecycleService.handleSessionIdResolved` (`:139-180`), first call
  `carryOver.claimSessionResolution(tabId, realSessionId)`:
  - on `'skip'`: return after the existing `loadSessions()` refresh. There is no owner attach
    and no active-tab fallback (AC 7.6, 7.7);
  - on `'bind'`: run the existing owner attach, then `carryOver.completeBinding(tabId)`;
  - on `'none'`: today's code path, unchanged.

  `handleChatError` (`:202-`) calls `carryOver.onChatError(data.tabId)` when `tabId` is set.
- Verified contracts and entry points: E23. `attachSession` is at `tab-manager.service.ts:2139`.
- Dependencies: `ProviderCarryOverService` (same lib).
- Integration points: `ChatMessageHandlerService` -> `ChatStore.handleSessionIdResolved` ->
  here (`chat-message-handler.service.ts:196-197`, `:822-855`; `chat.store.ts:587-591`).
- Failure behaviour: any throw from the guard is caught and treated as `'none'`, so a guard bug
  cannot break normal session resolution.
- Quality requirements: tabs without a pending carry-over behave the same (pinned by the
  existing `chat-lifecycle.service.spec.ts`).
- Verification seam: `chat-lifecycle.service.spec.ts` cases for `'skip'` with the tab gone (no
  `attachSession`, including the active-tab fallback), `'skip'` with the tab rebound, and
  `'bind'` (attach then `completeBinding`). One integration case (real `TabManagerService`,
  `StreamingHandlerService`, `StreamRouter`, `ConversationRegistry`) drives `SESSION_ID_RESOLVED`
  and chunks for the refused tab. It asserts:
  - the tab `claudeSessionId` is the new id (AC 4.1);
  - the conversation sessions are `[old, new]` (AC 4.2);
  - the old messages are kept and the new assistant text is appended (AC 2.2);
  - no refused prompt was resent (AC 4.6, no `chat:continue`/`chat:start` call).
  This case also resolves A2. (Rev 1) A second integration case gives the refused tab a claimed
  rendered surface (E33) and resolves A6: either the entry is released by the guard on that
  branch, or the case proves the branch is unreachable for a refused tab.
- Files:
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts`
  - MODIFY only if A6 finds the branch reachable:
    `<wt>/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`

### 9. Banner button and view wiring (chat UI)

- Purpose: render one "Continue with <provider>" button for the bound offer, in the refused
  tab's view only.
- Responsibilities:
  - `AuthRequiredBannerComponent` adds inputs `carryOverProvider: string | null` and
    `carryOverBusy: boolean`, and output `carryOver`. When `carryOverProvider` is set:
    - a native `<button type="button">` labelled `Continue with {{ provider }}`, placed before
      the existing action and with no `aria-label` override, so the accessible name equals the
      visible label;
    - `[disabled]` and `aria-busy` while busy;
    - `aria-describedby` pointing at a visually hidden span that reads "Sends this
      conversation's text to <provider> to start a new chat from a summary." (AC 8.4, NFR
      accessibility).
    The existing buttons, layout and copy are unchanged (no redesign).
  - `ChatViewComponent` adds a computed `carryOverOffer`: the offer when
    `banner.generation === offer.generation` and `offer.tabId === resolvedTabId()`, else `null`
    (AC 7.3 option "hidden for that tab"). It also adds `carryOverBusy`
    (`carryOver.isPending(offer.tabId) || carryOver.isBusy(offer.sessionId)`, Rev 1) and
    `onCarryOver() -> carryOver.start(offer)`. The template binds them at
    `chat-view.component.html:149-154`.
- Verified contracts and entry points: E26. `resolvedTabId` is at `chat-view.component.ts:859`.
- Dependencies: `ProviderCarryOverService`.
- Integration points: Component 7.
- Failure behaviour: no offer means today's banner, byte for byte, in the DOM (AC 1.2, 1.3).
- Quality requirements: keyboard reachable in the existing tab order, and a visible label equal
  to the accessible name. Visual before/after screenshots in Electron, dark and light
  (decisions.md row 2), taken by the visual-reviewer (Rev 1, F8): the banner without the
  button (before), the banner with the button, the disabled busy state, and the notice.
- Verification seam: a new `auth-required-banner.component.spec.ts` covers:
  - no button without a provider;
  - the label, `aria-describedby` text, disabled state and emission;
  - the existing buttons unchanged.

  (Rev 1, F8) Required chat-view cases in the existing `chat-view.component.spec.ts`, built on
  `makeHarness` (`:162`) with `sessionContextTabId` (`:177`, `:613-620`) (E35). The harness gains
  a `ProviderCarryOverService` stub (an `offer` signal plus `isPending`/`isBusy`/`start`
  fakes) in its provider list (`:550-634`), and the `authStateStub.authRequiredBanner` value
  (`:523-528`) gains `generation` and `origin`. Cases:
  - matching tab: `sessionContextTabId: 'tile-A'`, banner G, offer `{ generation: G, tabId:
    'tile-A' }` gives a non-null `carryOverOffer` and the provider bound to
    `ptah-auth-required-banner`; the `carryOver` output calls `start` once with that offer;
  - non-matching tab: the same banner and offer with `sessionContextTabId: 'tile-B'` give
    `null`, and the banner renders without a provider (today's banner);
  - stale generation: offer G with banner G2 gives `null` in the matching view.
  Assumption: the implementer picks the harness template mode (default, or
  `renderCompactTemplate` with `NO_ERRORS_SCHEMA`, `:645-652`) in which the banner element and
  its `carryOverProvider` binding are observable; the assertion targets the binding, not
  internal state, where the mode allows it.
- Files:
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
  - CREATE `<wt>/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - MODIFY `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

### 10. Refusal contract pins (specs only)

- Purpose: prove AC 1.5, 5.5 and 6.3 by asserting that the refusal shape stays byte-identical.
- Responsibilities:
  - In `chat-session.native.spec.ts`, next to `:576-627`, add a case that awaits the same
    refusal and asserts `toStrictEqual({ success:false, sessionId, error: <exact resolver
    text>, errorCode:'AUTH_REQUIRED', providerId:'anthropic' })` and
    `Object.keys(...).sort()` equal to the five keys. Use `continueSession` if the harness
    reaches it, else `autoResumeIfInactive`.
  - Add the same strict case for `/compact` in `chat-slash-command-router.native.spec.ts`, next
    to `:357`.
- Verified contracts and entry points: E6, E7.
- Dependencies: none.
- Failure behaviour: not applicable.
- Verification seam: these specs. They also pin that `continueSession` still refuses after a
  failed carry-over, because the carry-over never writes the session (AC 5.5, 6.3).
- Files:
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts`
  - MODIFY `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts`

## Integration architecture

- Data flow:
  1. `chat:continue` (plain send or `/compact`) is refused with today's response (unchanged).
  2. `MessageSender.handleAuthRequired` calls `AuthState.flagAuthRequired(providerId, message,
     origin)` and gets generation G.
  3. `ProviderCarryOverService.offerFor(G)` calls `chat:carry-over-check { sessionId,
     workspacePath }`. On the host, `ChatCarryOverService.evaluate`: the session folder, the
     stored identity, the new-session readiness probe and the active id. It returns
     `{eligible, providerId, providerName}`.
  4. The renderer sets the offer if the banner is still G. The view of the refused tab shows the
     button.
  5. On click, the identity checks run. `pending[tabId]` is set (button disabled, sends on that
     tab refused locally), then `chat:carry-over` is called.
  6. On the host: `evaluate` again (pin P = active id), `readCarryOverTranscript` (tail 2 MiB),
     `renderCarryOverPrompt` (48k chars, redacted), the active id re-checked against P, then
     `startSession({tabId, workspacePath: folder, prompt}, {expectedProviderId: P})`. After
     `prepare`, the served provider is checked against P before `startChatSession`. That runs
     the active runtime and streams to `tabId`.
  7. `SESSION_ID_RESOLVED(tabId, newId)` reaches the lifecycle guard. `'bind'` leads to
     `attachSession` and `completeBinding`: the notice, the banner cleared if still G, and the
     pending entry released.
  8. The stream router appends the new id to the tab's conversation, and the reply streams into
     the tab.
- State or persistence:
  - host `inFlight: Set<sessionId>`, per request;
  - renderer `offer` and `pending` (bounded by open tabs; busy state derives from `pending`);
  - banner `generation`, a monotonic counter in memory.
  Nothing is persisted. The new session persists through the existing start path. The old
  session file and metadata are only read.
- External boundaries: RPC params are validated by strict zod schemas (`uuidString`, length
  caps). The workspace must equal the session's own authorized real folder. The session id
  pattern guards the JSONL path. Transcript text crosses one boundary only: the first turn sent
  to the active provider. Host routing is skipped (E9). No transcript is in logs, results,
  banners or notices.
- Failure and rollback: every failure before `startSession` creates nothing.
  - A provider change during the read or the launch creates nothing and returns
    `NOT_ELIGIBLE`; no call reaches the old provider (Rev 1).
  - A start failure is shaped by the carry-over branch of the `startSession` catch: fixed text
    plus error name in the logger and Sentry, a fixed result (Rev 1; no session).
  - A failure result changes the banner only while its refusal generation and tab still own it
    (Rev 1).
  - A failure after the session exists is the normal turn-error path in the bound tab
    (AC 5.3).
  - Closed or rebound tabs are never bound (guard). A rebound tab gets an abort of the new
    session.
- Observability: host info/warn lines `[carry-over] …` carry the session id, tab id, provider id,
  kept/omitted turn counts and the error name. The renderer `console.warn` on a guard skip
  carries ids only. A failure shows a fixed banner message.

## Architecture-level quality requirements

- Functional: every AC in Requirements 1-8 maps to a named spec in Components 2-10. AC 3.10's
  Codex half becomes "a native Codex session is refused with zero reads" (Decision K2).
- Performance:
  - the read is at most 2 MiB per click, parsed with the existing batched yields, with a 10 s
    abort;
  - the check RPC runs once per mismatch refusal;
  - no polling and no per-item timers.
- Security:
  - no credentials, transcript text, paths or provider error bodies in UI payloads or logs;
  - fixed failure strings;
  - best-effort pattern redaction before budgeting;
  - tool I/O and attachment content are excluded at extraction;
  - a disclosure is on the button description and the notice.
- Maintainability:
  - no new project, no new Nx edge, no `cli-agent-runtime` import;
  - the AUTH_REQUIRED refusal, the onboarding lib, the Codex sign-in code and the native
    history path are untouched;
  - `ChatSessionService` gains one internal launch option, not the feature;
  - `MessageSenderService` gains one pending guard at each of its two launch entries.
- Testability: the specs listed per component. The deferred-promise race specs cover AC 7.8. One
  renderer integration case covers the relink (A2). A strict-shape refusal spec covers AC 1.5.
  Rev 1 adds: a deferred-read provider-switch spec and a launch-boundary pin spec (zero
  old-provider calls, zero old-session writes); a transcript-sentinel spec across logger,
  Sentry and RPC result; newer-refusal-then-failure specs; success-before-resolution,
  second-click and unrelated-resolution specs; paired and result-only tool specs; boundary
  specs for a system event and a summary-less `compact_boundary`; and concrete chat-view
  matching and non-matching tab specs.

## Team-leader handoff

- Recommended executors:
  - Components 1-6 and 10: backend-developer (DI tokens, RPC wiring, JSONL projection);
  - Components 7-9: frontend-developer (Angular signals, banner, lifecycle guard);
  - senior-tester for the race and integration specs if the executors do not finish them;
  - visual-reviewer for the Electron dark and light screenshots (Component 9, F8); executors
    do not take them.
- Complexity: HIGH. The backend is moderate, with one new service and a bounded read. The
  renderer relink races (Requirement 7), launch serialization and Assumptions A2 and A6 carry
  the risk.
- Dependencies and ordering (component-level only):
  - Component 1 (shared types) comes before Components 6 and 7;
  - Component 2 comes before Component 4;
  - Component 3 comes before Component 4;
  - Component 5 comes before Component 4;
  - Component 7 comes before Components 8 and 9.
- Parallel-safe work (file-disjoint batch hints):
  - Backend: Components 1, 2, 3+4+5+6, and 10. Components 2, 3 and 10 touch disjoint files.
  - Frontend: Components 7, 8 and 9, after Component 1 lands.
  - Backend and frontend are file-disjoint.
- Files affected:
  - CREATE:
    - `libs/backend/agent-sdk/src/lib/session-history-reader.carry-over.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts` (+ `.spec.ts`)
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts` (+ `.spec.ts`)
    - `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts` (+ `.spec.ts`)
    - `libs/frontend/chat/src/lib/services/provider-carry-over.relink.integration.spec.ts`
    - `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts` (Rev 1)
  - MODIFY (production):
    - `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
    - `libs/shared/src/lib/types/rpc.types.ts`
    - `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
    - `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/di.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
    - `libs/frontend/core/src/lib/services/auth-state.service.ts`
    - `libs/frontend/chat/src/lib/services/message-sender.service.ts`
    - `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
    - `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
    - Conditional (A6 only): `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
  - MODIFY (specs):
    - `chat-session.host-routing.spec.ts`, `chat-session.native.spec.ts`,
      `chat-slash-command-router.native.spec.ts`, `chat-rpc.handlers.spec.ts`, `chat/di.spec.ts`
      (rpc-handlers)
    - `history-event-factory.spec.ts` (agent-sdk, Rev 1)
    - `auth-state.service.spec.ts` (core)
    - `message-sender.service.spec.ts`, `chat-lifecycle.service.spec.ts`,
      `chat-view.component.spec.ts` (chat; the last is Rev 1)

  Production count: 3 new and 15 modified (16 if A6 requires the handler edit). Rev 1 adds no
  production file; it adds one spec file and two modified spec files. Six of the modified files
  are one-to-five-line registration or type edits (types x2, tokens, di, schema, html). The
  substantive production units number 12, in the targeted range.
- Verification points (revised in Rev 1, F7; decisions.md row 18):
  - Confirm A1-A6 with the checks above before closing their components.
  - Per batch: `npm run verify -- -p <only the projects that batch changed>` (for example
    `-p @ptah-extension/agent-sdk` for Component 2). Confirm that the header's project count
    equals the number requested.
  - Final, once all batches land:
    `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/core,@ptah-extension/chat,ptah-electron,ptah-extension-webview`.
    Five of these are the changed libs. `ptah-electron` and `ptah-extension-webview` are not
    changed; they are included because CLAUDE.md (§ Electron first) requires scoped checks of
    the affected Electron and renderer projects when a shared lib changes, and
    `@ptah-extension/shared` changes here. Confirm that the header lists 7 projects.
  - Use `npm run verify` (CLAUDE.md § Verification), not raw `nx test/lint/typecheck`: it takes
    the machine-wide lock, so only one heavy check runs per slot. Run one verify at a time from
    this task.
  - `ptah-electron` covers `rpc-surface.spec.ts` and `container.smoke.spec.ts`.
    `ptah-extension-webview` is the renderer typecheck.
  - There is no VS Code app project in this repository (`apps/` lists none), so "VS Code still
    compiles" is covered by the shared lib typechecks.
  - No build, serve, e2e or package targets.
  - Visual: the visual-reviewer takes before/after screenshots of the banner with the button,
    its busy state and the notice, in Electron, dark and light (Rev 1, F8).
  - The parallel task's `chat-session.connection-switch.spec.ts`, when it lands, must pass
    unchanged. This plan does not touch its code paths.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| The first `generating` turn-state of the new session is dropped while the tab still holds the old id (A2), so the spinner or status lags. | Medium | Low | The integration case in Component 8. Fall back to `markTabStreaming` at click. |
| Chunks reach a tab rebound mid-flight before resolution (AC 7.7 residual). | Low | Low | Abort the new session on `'skip'` for a rebound tab. The rebind flows (`rebindTabSession`, `tab-manager.service.ts:2856`) are rare in a refused tab. |
| Pattern redaction misses a secret shape or masks a harmless token. | Medium | Medium | Best effort by decision (row 10). A disclosure is shown before the click. Patterns are unit-tested. No generic base64 rule. |
| The readiness probe `prepare` starts a provider proxy for a check that is never clicked (A3). | Low | Low | The same work `chat:start` does. Note it in the PR. Change to a lazier probe only if review objects. |
| After a reload, the new session's history shows the full carry-over prompt as the first user bubble. | High | Low | Accepted. It is the honest record of what was sent. A follow-up could tag it for compact display. |
| The `ActionBannerService` notice is replaced by a later action banner. | Medium | Low | A 15 s duration. The notice is informative, and the tab state (new session) is the durable truth. |
| (Rev 1) A transport timeout with no later resolution or chat error leaves the refused tab's sends refused and the button disabled. | Low | Medium | The entry is released by a chat error, a resolution, or the tab's removal. The host-side start either resolves an id or fails through the stream's CHAT_ERROR; closing the tab always clears it. |
| (Rev 1) A provider error raised after the stream starts is logged by the existing stream path, outside the carry-over failure branch. | Low | Medium | Out of scope: it is the normal turn-error path for any chat (AC 5.3). The carry-over branch covers every failure before the stream exists. |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| K1 | Two new RPC methods, `chat:carry-over-check` (read-only eligibility) and `chat:carry-over` (action), served by one `ChatCarryOverService` with a shared `evaluate`. | Extend `chat:continue`/`chat:start`; one method with a `mode`; renderer-only eligibility. | AC 1.4, 1.5, 1.7; E4 (renderer and host ids differ), E17, E18 (name passes the baseline contract). | Yes |
| K2 | **PENDING USER (decisions.md row 17); kept as written until answered.** Only Claude SDK runtime sessions whose stored provider is not `openai-codex` are eligible. Native Codex sessions are refused before any read. AC 3.10's Codex-native half and D9's Codex -> Claude half become "a native Codex session is refused with zero reads". Gate 2 confirmed the evidence (implementation-plan-review.md § K2 evidence); scope is the user's call. To reverse: add the bounded native read (Component 2 branch) and drop the `runtime === 'claude-sdk'` rule in Component 4 step 2; no other component changes. | Build a bounded native Codex tail read (about 5 files across codex-runtime, the Electron port and the router) for a path no refusal reaches. | E3: the native resume branch never compares providers (`workspace-provider-profile-resolver.ts:190-266`). E2: proxy-era Codex refuses with a CODEX code. | Yes. A native read can be added if native sessions ever get the mismatch refusal. |
| K3 | Eligibility mirrors the resolver: stored `providerId` (`storedChatRuntimeIdentity`) against `resolveActiveAuthForPath(folder).providerId`. Readiness comes from a new-session `prepare(…, undefined, true)` plus `codexAuth.isAuthenticated()` for the Codex route. | Call `prepare` with the stored identity (forbidden by AC 2.3); duplicate the per-provider readiness from the auth handlers. | E1, E4, E5, E8; `codex-provider.types.ts:64`. | Yes |
| K4 | (Rev 1) The new chat starts through `ChatSessionService.startSession` with an internal `CarryOverLaunch { expectedProviderId }` option: no host routing, the provider pinned after `prepare` and before `startChatSession`, and a safe failure branch. | A new launch path; admit host routing; separate boolean flags; pinning inside the resolver. | E8 (one launch path); E9 (scope check sends turn text to a decision model); E30, E31. | Yes |
| K5 | Bounded read: a strict JSONL tail of `CARRY_OVER_READ_TAIL_BYTES = 2 MiB` via `readJsonlTail`. Budget: `CARRY_OVER_TEXT_BUDGET_CHARS = 48_000` characters on the rendered transcript. Read abort after 10 s. | A streaming full scan (rejected, decisions.md row 12); a smaller window (fewer turns); a token budget (needs a tokenizer per provider). | E12; the memory curator tail precedent (`session-history-reader.service.ts:102-116`). 48k characters is about 12k tokens, which fits every supported provider's context with room for the reply. | Yes (constants). |
| K6 | Secret redaction is a private pattern list in `chat-carry-over-transcript.ts`, applied per turn before budgeting. | Export `redactSecrets` (literal values only, not patterns); extract a shared redactor from the three private copies (scope creep across codex-runtime, vscode-lm-tools and cli-agent-runtime). | E16. | Yes. A shared redactor is a follow-up. |
| K7 | Offer identity lives in `AuthStateService` (`generation`, `origin`). Offer state, in-flight state and the relink guard live in a new `ProviderCarryOverService` in `libs/frontend/chat`. The button shows only in the refused tab's view. | Put the offer in `core` (core cannot see tabs); a per-tab banner redesign. | E21, E23, E26; AC 7.3 allows "hidden for that tab". | Yes |
| K8 | The relink uses the existing `SESSION_ID_RESOLVED` attach, gated by `claimSessionResolution`. The host does not return the new session id. | Make the host await the real id; open a new tab. | E8 (start returns before the id exists); E23, E24. | Yes |
| K9 | A tab rebound mid-flight gets `chat:abort` for the new session. A closed tab relies on the existing tab-close abort. Neither is bound. | Let the new session keep streaming into the rebound tab. | AC 7.6, 7.7; `tab-close-session-end.integration.spec.ts:1-13`. | Yes |
| K10 | The notice reuses `ActionBannerService.showInfo(…, tabId, 15_000)`. | A new per-tab notice surface; a host-injected assistant message (cannot know "tab bound"). | E25; AC 4.3 timing. | Yes |
| K11 | Failure messages are fixed host strings. `START_FAILED` passes through only `errorCode`/`providerId` from `startSession`. | Forward the start `error` text. | NFR security; `startSession` returns `error.message` (`chat-session.service.ts:1126-1133`). | Yes |
| K12 | The new methods are not added to the replay sanitizer allow-list or the host-source baseline. | Add them. | E18, E19. Both carry transcript-derived state. | Yes |
| K13 | (Rev 1, F1) The provider is pinned to the click-time active id: re-checked after the read (sync, no provider call) and again after `prepare`, before `startChatSession`. A change returns `NOT_ELIGIBLE`. | Pin inside `resolveExecutionProfile` (resolver change); re-check only before `startSession` (leaves the `prepare` window). | E4, E30. | Yes |
| K14 | (Rev 1, F3) Launches on a tab with a pending carry-over are serialized in the renderer (`MessageSenderService` guard), and the pending entry is the busy state until bind or definitive failure. A resolution carrying the old id is not claimed. | A launch nonce on `SESSION_ID_RESOLVED` (shared message and host broadcaster change); accept any resolution for the tab (the reviewed defect). | E33, E34. | Yes |
| K15 | (Rev 1, F7, decisions.md row 18) Verification stays on `npm run verify -- -p`. Per batch: the batch's changed projects only. Final: the five changed libs plus `ptah-electron` and `ptah-extension-webview`, because a shared lib changes (CLAUDE.md § Electron first). | Raw `nx test/typecheck/lint <project> --parallel=1` (the reviewer's proposal; bypasses the verify lock that CLAUDE.md requires). | CLAUDE.md § Verification and § Electron first. | Yes |

## Revision 1

Gate 2 round 1 (codex, REVISE; `implementation-plan-review.md`). F1-F6 and F8 accepted; F7 partly
disputed and settled by decisions.md row 18. Decision K2 is unchanged and marked PENDING USER
(row 17). Rev 1 adds no production file and no Nx edge; it adds one spec file
(`chat-session.carry-over-launch.spec.ts`), two modified spec files
(`history-event-factory.spec.ts`, `chat-view.component.spec.ts`) and one conditional
production edit (A6).

| Finding | Resolution | Sections changed |
| ------- | ---------- | ---------------- |
| F1 (Serious) provider can change between `evaluate` and launch | Pin the click-time active id; re-check it after the read, and again in `launchSdkSession` after `prepare` and before `startChatSession`; a change returns `NOT_ELIGIBLE` with nothing created. Specs: deferred read plus switch (zero `startSession`, zero old-session writes) and launch-boundary pin (zero `startChatSession`/`resumeSession`). | Architecture decision (invariants, rejected alternatives); Codebase evidence E30; Component 4 steps 2, 5, 6, failure behaviour, specs; Component 5 (rewritten); Integration data flow 6, failure and rollback; Decisions K4, K13 |
| F2 (Serious) failure results overwrite a newer refusal | Every failure-side banner or offer mutation runs only through `ownsUi(entry)`: original generation still current and the same tab still bound to the refused session. The click captures generation, origin and banner provider. Specs: newer refusal then `HISTORY_UNREADABLE`, and then `START_FAILED`; the same with a rebound tab. | Component 7 (`start` step 1 and 3, failure behaviour, specs); Integration failure and rollback |
| F3 (Serious) offer re-enables before binding; any resolution is accepted | The pending entry is the busy state from click to bind or definitive failure (`inFlightSessionIds` removed). Launches on that tab are serialized by a pending guard at both `MessageSenderService` launch entries; a resolution carrying the old id is not claimed. Specs: success before resolution, second click, unrelated resolution, timeout release, sender guard. | Architecture decision (invariants, A5, A6, effect on existing code, rejected alternatives); Codebase evidence E33, E34; Component 7; Component 8 (A6 case, conditional file); Component 9 (`carryOverBusy`); Integration state; Risks; Decisions K14 |
| F4 (Serious) reused `startSession` logs and reports the raw error | Carry-over branch in the `startSession` catch: logger and Sentry get only a fixed text plus `loggableErrorName`; the result gets a fixed constant plus `authErrorFields`. Spec: a sentinel in a thrown error's message and stack is absent from every logger call, every Sentry call and the result; `chat:start` keeps today's branch. | Codebase evidence E31; Component 4 (logging, specs); Component 5 (rewritten); Integration failure and rollback; Risks |
| F5 (Serious) `tool_result` dropped, against AC 3.5 | A per-call `toolNamesById` map from the window's `tool_use` blocks; `tool_result` becomes `[tool result: <name>]` or `[tool result]`, never content. Specs: paired and result-only, with content sentinels. | Codebase evidence E32; Component 2 (projection, extractor, specs, files) |
| F6 (Moderate) boundary cut at any `system` record | The start boundary is the latest in-window `isCompactSummary` record only; `system` records including `compact_boundary` are skipped and never cut. Specs: a system event after prose, a boundary without an in-window summary, two summaries. | Component 2 (projection, specs) |
| F7 (Moderate, partly disputed) verification command | Kept `npm run verify -- -p` (CLAUDE.md requires it and its lock). Per batch: only that batch's changed projects. Final: the five changed libs plus `ptah-electron` and `ptah-extension-webview`, with the stated reason (a shared lib changes; CLAUDE.md § Electron first). The "changed projects" wording is corrected. | Team-leader handoff (verification points); Decisions K15 |
| F8 (Moderate) view-level tab filter test was conditional | Concrete cases in the existing `chat-view.component.spec.ts` harness (`makeHarness`, `sessionContextTabId`): matching tab, non-matching tab, stale generation. The visual-reviewer takes the Electron dark and light screenshots. | Codebase evidence E35; Component 9 (quality, specs, files); Team-leader handoff (executors, files, verification points) |
