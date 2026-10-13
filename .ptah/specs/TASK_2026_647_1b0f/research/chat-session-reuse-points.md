# Chat session reuse points — baseline for the three setup surfaces

Research baseline: what a normal chat session gives today, and how another surface can
embed or own one. Repo state: `main` at 844ac41d8. All paths are repo-relative.
Labels: **[V]** = verified by reading the cited code; **[I]** = inferred, see note.

Bounds: webview/Electron frontend only. Backend session persistence internals, the
TUI/CLI surfaces and the Electron shell layout were not investigated.

## A. Anatomy of one session tile

**Host chain.** The canvas renders one `ptah-canvas-tile` per session tile
(`libs/frontend/canvas/src/lib/canvas-tile.component.ts:123`, class at `:426`). The tile
renders `ChatViewComponent` through `NgComponentOutlet` with a per-tile child
`EnvironmentInjector` — the tile content is the chat view plus tile chrome, nothing else
(`canvas-tile.component.ts:417-422`).

**Tile inputs/outputs** (`canvas-tile.component.ts`):

| Binding                                                                                      | Kind   | Line           |
| -------------------------------------------------------------------------------------------- | ------ | -------------- |
| `tabId` (required)                                                                           | input  | `:428`         |
| `focused`, `visible`                                                                         | input  | `:436`, `:444` |
| `widthIntent`, `rowBreakBefore`, `firstInOrder`, `layoutFocused`, `layoutLocked`             | input  | `:447-461`     |
| `focusRequested`, `closeRequested`, `spanRequested`, `layoutFocusToggled`, `rowBreakToggled` | output | `:468-481`     |

**Session binding is token-based, not input-based.** In `ngOnInit` the tile creates a
child injector providing `SESSION_CONTEXT` (a `Signal<string|null>` of the **tabId**, not
the claude session id), `SESSION_VISIBLE`, `SESSION_FOCUSED` and `SURFACE_ACTIVE`
(`canvas-tile.component.ts:616-626`; token docs
`libs/frontend/chat/src/lib/tokens/session-context.token.ts:4-11`). `ChatViewComponent`
has **no component inputs at all** (no `= input(` match in the file); it resolves its tab
as `ctx ? ctx() : tabManager.activeTabId()` (`chat-view.component.ts:771-772`), i.e. a
host that omits the token silently binds to the global active tab. **[V]**

**What the tile adds around the chat view:** header label from `TabState`
(`:594-597`), compact/full view-mode toggle (`:599-611`), layout menu and height stepper
(`:663-798`), agent indicator/mini-panel (`./tile-agent-indicator.component`,
`./tile-agent-mini-panel.component` imports), `SendToMessagingComponent` (import), and the
model/effort freeze effects that write `overrideModel`/`overrideEffort` onto the tab
(`:520-546`). Tile visibility registers/unregisters the tab as "visible" so streaming
flushes defer while hidden (`:556-563`).

**Chat view composition.** `ptah-chat-view` (`chat-view.component.ts:197`, template
`chat-view.component.html`) renders, among others:

- `ptah-chat-transcript` — message list (`chat-view.component.html:81`)
- `ptah-chat-input` — composer (`:245`)
- `ptah-permission-badge` / `ptah-question-card` — prompts (`:165`, `:177`)
- `ptah-session-stats-summary`, `ptah-compaction-notification`/`marker`,
  `ptah-resume-notification-banner`, `ptah-auth-required-banner`,
  `ptah-session-budget-banner`, `ptah-voice-provider-error-toast`, `ptah-agent-origin-banner`,
  `ptah-background-agent-tray`, `ptah-compact-session-card`, `ptah-chat-empty-state`
  (`:9-162`)
- `ptah-agent-monitor-panel` + `ptah-sidebar-tab` toggles, `ptah-display-dock`
  (`:254-352`)

In tile mode the view renders exactly one transcript — its bound tab
(`chat-view.component.ts:804-815`); the main panel renders the retained set for
keep-alive.

**Transcript and message rendering.** `ptah-chat-transcript`
(`chat-transcript.component.ts:167`) owns the scroll container and per-tab render window;
inputs `tabId` (required, `:239`), `active` (required, `:246`), `isSessionActive`,
`historyReplaying`, `hasOlderHistory`, `olderHistoryLoading` (`:253-261`), outputs
`olderHistoryRequested`, `branchRequested`, `rewindRequested`, `promptSelected`
(`:263-267`; bound at `chat-view.component.html:81-92`). It renders message bubbles
`ptah-message-bubble` (`message-bubble.component.ts:67`) and execution nodes
`ptah-execution-node` (`execution/execution-node.component.ts:145`) built by
`ExecutionTreeBuilderService` (chat-streaming). Host binding `data-ptah-tab-id` routes
file links to this tab's workspace (`chat-transcript.component.ts:208`).

**Composer.** `ptah-chat-input` (`chat-input.component.ts:115`) composes the model
selector, effort selector, `ptah-autopilot-popover` (template `:410`),
`ptah-mcp-status-chip` (`:414-417`), peer-session send (`:420`), file attachments and
paste/drop images (`chat-input.component.ts:784-1062`), and voice input. It resolves its
tab the same token way: `this._sessionContext?.() ?? this.tabManager.activeTabId()`
(`:507`, also `:532`, `:557`, `:601-603`) and passes `tabId` on send (`:1464`). **[V]**

**Prompt cards are per-tab filtered.** `resolvedQuestionRequests` filters
`chatStore.questionRequests()` by the resolved tab, and stands down when an interactive
workflow surface owns the question (`chat-view.component.ts:1151-1175`, `:1188-1193` →
`StreamRouter.interactiveSurfaceOwning`). Permission requests use the same
`request.tabId === sessionContext()` check (`:1295-1314`).

**State owners.**

| Concern                                                | Owner                                                                                                                        | Evidence                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Tab state, view mode, model/effort overrides           | `TabManagerService` (chat-state)                                                                                             | `canvas-tile.component.ts:520-546`, `:599-608`  |
| Messages, question/permission requests, queued content | `ChatStore` (chat lib)                                                                                                       | `chat-view.component.ts:1152`, `:1199`          |
| TabId↔ConversationId and SurfaceId↔ConversationId      | `TabSessionBinding` + `ConversationRegistry` (chat-state)                                                                    | `tab-session-binding.service.ts:1-20`, `:27-45` |
| Event routing, surface lifecycle                       | `StreamRouter`, `StreamingSurfaceRegistry`, `WorkflowSessionClaimService` (chat-routing)                                     | section C                                       |
| Streaming accumulation, execution tree, dedup, agents  | `StreamingAccumulatorCore`, `ExecutionTreeBuilderService`, `EventDeduplicationService`, `AgentMonitorStore` (chat-streaming) | `stream-router.service.ts` imports              |

## B. Can the input and message list be embedded by session/tab id?

**Message list — yes, almost.** `ptah-chat-transcript` takes `tabId` and `active` as
plain required inputs (`chat-transcript.component.ts:239-246`). But the tabId must be a
real tab in `TabManagerService`: the transcript reads tab state and per-tab streaming
state (`:215-216`, `:247`), and its `data-ptah-tab-id` host binding assumes a workspace
(`:208`). A host holding only a `SurfaceId` cannot render it today. **[V]**

**Composer — only via the token pattern.** `ptah-chat-input` has no session input; it
resolves the tab from `SESSION_CONTEXT` and falls back to the **global active tab**
(`chat-input.component.ts:459-461`, `:507`). Embedding it requires the host to build a
child `EnvironmentInjector` providing `SESSION_CONTEXT` — exactly what the canvas tile
does (`canvas-tile.component.ts:616-626`). A raw `<ptah-chat-input />` in another host
sends to whichever tab is globally active. **[V]**

**Whole chat view — same answer, one proven recipe.** `ChatViewComponent` is token-driven
only (`chat-view.component.ts:257-267`). The embeddable pattern already exists and is
copy-paste: `NgComponentOutlet` + `createEnvironmentInjector` with four tokens
(`canvas-tile.component.ts:417-422`, `:616-626`). Any host with a **tabId of a real tab**
can embed the full session UI today, including prompts and stats.

**What is coupled beyond the tabId [V]:**

1. Global fallback: without `SESSION_CONTEXT`, both view and composer bind to
   `tabManager.activeTabId()` (`chat-view.component.ts:771-772`;
   `chat-input.component.ts:507`) — wrong session whenever the user switches tabs.
2. Prompt routing: question cards depend on `chatStore.questionTargetTabsFor` and the
   router's interactive-surface gate (`chat-view.component.ts:1164-1173`).
3. Send path: the composer dispatches through `ChatStore`/message dispatch keyed to
   `TabManagerService` tabs (`chat-input.component.ts:1464`; imports `:457-458`).
4. Model/effort: selectors read global state; per-tab overrides live on the tab
   (`canvas-tile.component.ts:520-546`).
5. Chrome is global: tab strip, sidebar session list (fed by `session:list`,
   `session-rpc.handlers.ts:146`) and app shell live outside the tile; the embed does not
   bring them, but the session still appears in the global list (section C).

**Exact selectors/inputs for embedding [V]:**

```text
<ptah-canvas-tile [tabId] [focused] [visible] ... />           canvas-tile.component.ts:123
<ptah-chat-view />                    (no inputs; token-bound)  chat-view.component.ts:197
<ptah-chat-transcript [tabId] [active] ... />                   chat-transcript.component.ts:167,239-266
<ptah-chat-input />                   (no inputs; token-bound)  chat-input.component.ts:115
```

## C. How a non-chat surface starts and owns a session today

**Contract.** `chat:start` (`rpc.types.ts:754`) takes `ChatStartParams`
(`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:45-114`): `tabId` **required** as the
frontend correlation id (`:53`), `prompt` seed (`:47`), `name` (`:55`), `workspacePath`
(`:57`), `surfaceMode` — "drives an in-surface workflow (setup wizard / harness builder)"
(`:60-65`), `mcpToolProfile` (`:67`), `options.systemPrompt` (`:73`), `options.preset`
(`:85`), `options.model`/`effort` (`:72-89`), `mcpServersOverride` (`:113`). The backend
threads `surfaceMode` into every streamed chunk
(`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:505-513`).

**Claim lifecycle (harness builder / New Project — the reference implementation).**
`HarnessWorkflowService.startWorkflow` (`harness-workflow.service.ts:283-330`) does, in
order:

1. Mint a correlation id (a `TabId.create()` value that is **never** registered as a tab)
   and a `SurfaceId`.
2. `claims.claim(correlationId, surfaceId)` — `WorkflowSessionClaimService`, a plain
   correlationId→SurfaceId map (`workflow-session-claim.service.ts:10-16`).
3. `state.registerWorkflowSurface(surfaceId)` — registers the adapter with
   `{ interactive: true }` so prompts stay alive (`harness-builder-state.service.ts:567-576`).
4. `streamRouter.onSurfaceCreated(surfaceId)` (`harness-workflow.service.ts:297`).
5. `chat:start` with `tabId: correlationId`, `surfaceMode: true`, model/effort options
   (`:305-315`). On failure, `rollBackFailedStart` releases the claim, closes the surface
   and clears storage (`:341-357`).

Follow-ups use `chat:continue` with `surfaceMode: true` and the same correlation id
(`:373-378`).

**Event routing.** `chat:chunk` payloads reach `ChatMessageHandlerService.handleChatChunk`
(`chat-message-handler.service.ts:482-510`). It looks up
`renderedSurfaceFor(tabId)` = a claim **plus** a registered adapter (`:344-349`); if
found, the event goes to `streamRouter.routeStreamEventForSurface(event, claimedSurface)`
(`:498`); if `surfaceMode === true` but no surface is claimed, the chunk is **dropped**
(`:502-503`). Inside `StreamRouter` (`stream-router.service.ts`): `onSurfaceCreated` is
idempotent and reuses or mints a conversation (`:229-254`); `routeStreamEventForSurface`
resolves the conversation, appends new sessions, and runs the canonical accumulator
against the adapter's state slot, pushing mutations back through `onStateChanged`
(`:322-370`, with the blank-transcript bug note at `:352-360`); `onSurfaceClosed` unbinds,
unregisters, and cleans dedup/agents/registry only when **no tabs and no surfaces**
remain (`:274-305`). Permission and AskUserQuestion prompts route to interactive surfaces
via `interactiveSurfaceOwning` (`:613-626`) and `interactiveSurfacesForSession`
(`:637-645`).

**Reload.** The workflow survives in `localStorage` key `ptah.harness.workflow.v1`
(`harness-workflow.service.ts:59`). The service is root-provided and the view never
disposes it (`:100-102`). On rehydrate it mints **fresh** correlation + surface ids (the
old ids died with the page), rebinds them to the persisted session through
`onSurfaceCreated(surfaceId, existingSessionId)`, and replays history with `chat:resume`
(without `activate`) fed back through the router (`:104-108`, `:634-650`). Panel close
and reopen do not tear anything down; only "Start over" does. **[V]**

**Does it appear in the chat list?** It never appears as a **tab**: the workflow service
never injects `TabManagerService`, and `TabSessionBinding` keeps the TabId and SurfaceId
key spaces disjoint so surfaces never leak into tab enumeration
(`tab-session-binding.service.ts:13-16`). The persisted **session**, however, is stored
under its `name` ("New Project Setup", `harness-workflow.service.ts:301-302`), and
`session-rpc.handlers.ts` contains no `surfaceMode` filter (search: no matches), so it is
expected to appear in the saved-session sidebar list like any other session. **[I]** — the
list-population path was not traced end to end.

**Races and gaps [V]:**

1. Unclaimed `surfaceMode` chunks are silently dropped
   (`chat-message-handler.service.ts:502-503`); the claim and adapter registration must
   complete before the first chunk — the setup wizard encodes this ordering requirement
   (`setup-wizard-state.service.ts:556-561`).
2. `routeStreamEventForSurface` drops events when the adapter is unregistered
   (`stream-router.service.ts:326-329`) — e.g. chunks racing a panel teardown.
3. `SurfaceUpdateInbox.claim` throws on a duplicate id, and unclaimed pushes are not
   buffered — catch-up needs `surface:read` (`surface-update-inbox.service.ts:26-28`,
   `:61-68`).
4. The accumulator mutates the adapter state in place; an adapter that does not push
   `setState` back leaves the transcript blank until a re-mount
   (`stream-router.service.ts:352-360`).

## D. Extension points for add-ons

| Need                        | Available today?                                                                                                                     | Evidence                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Seed prompt                 | Yes — `ChatStartParams.prompt`                                                                                                       | `rpc-chat.types.ts:47`                                 |
| System-prompt append        | Yes — `options.systemPrompt` (Apps page uses it)                                                                                     | `rpc-chat.types.ts:73`; `apps-session.service.ts:249`  |
| Prompt preset               | Yes — `options.preset: 'claude_code' \| 'enhanced'`                                                                                  | `rpc-chat.types.ts:78-85`                              |
| Restricted tools            | Partial — profile enum only: `mcpToolProfile: 'coding' \| 'apps'`                                                                    | `rpc-chat.types.ts:67`; `ai-provider.types.ts:150-151` |
| Extra MCP tools per session | Partial — `mcpServersOverride`, HTTP transport only, merged over the registry                                                        | `rpc-chat.types.ts:99-113`                             |
| Per-session skill           | No parameter; skills can only be seeded through prompt text; slash commands are intercepted backend-side from the prompt             | `chat-session.service.ts:517-519`                      |
| Side-panel / header slot    | No. No `ng-content` in `chat-view.component.html` or the canvas tile template; the only panel hook is the `HIDE_AGENT_SIDEBAR` token | searches: no matches; `session-context.token.ts:20-22` |

**Missing [V]:** an arbitrary per-session tool allow/deny list; a per-session skill
binding; content-projection slots for header actions or a side panel in the tile/chat
view; and any public "embed a session by id" component (the canvas pattern is private to
`CanvasTileComponent`).

## E. Recommended minimal embeddable-session API

The baseline already contains both halves; they are just not packaged for reuse.

1. **`ptah-session-embed` (new component, `chat` lib).** Inputs `tabId` (required),
   `visible`, `focused`, `hideAgentSidebar`; content-projected slots `header` and
   `panel`. Internally it is exactly the canvas tile's injector recipe
   (`canvas-tile.component.ts:616-626`) — `createEnvironmentInjector` with
   `SESSION_CONTEXT`/`SESSION_VISIBLE`/`SESSION_FOCUSED`/`SURFACE_ACTIVE`/`HIDE_AGENT_SIDEBAR`
   — rendering `ChatViewComponent` via `NgComponentOutlet`. Living in `chat` keeps the
   rule intact: presentational `chat-ui` imports nothing; the orchestrator component
   stays in `chat`, and `canvas` (which already imports `chat`) can later delegate to it.
2. **`EmbeddedSessionService` (new facade, `chat-routing`).** One implementation of the
   harness lifecycle for all three setup surfaces:
   `start({ seedPrompt, systemPrompt?, mcpToolProfile?, name?, workspacePath?, model?, effort?, interactive })`
   → claim + register adapter + `onSurfaceCreated` + `chat:start { surfaceMode: true }`;
   `send(text)` → `chat:continue { surfaceMode: true }`; `adoptAfterReload(sessionId)` →
   fresh ids + `onSurfaceCreated(surfaceId, sessionId)` + `chat:resume` replay;
   `dispose()` → release claim + `onSurfaceClosed`. This extracts the verified sequence
   from `harness-workflow.service.ts:283-330`, `:373-378`, `:634-650` so the three surfaces
   do not each re-implement it.
3. **Tab-shaped sessions when the surface should behave like a tile.** If a setup surface
   wants the transcript and composer as a live chat, the cheapest path is a real tab in
   `TabManagerService` rendered through `ptah-session-embed` — full reuse of send, prompts
   and history paging — with `EmbeddedSessionService` used only when the session must stay
   out of the tab strip.

Changes required: `chat` exports the embed component; `chat-routing` exports the facade;
`chat-ui` unchanged.

## Reuse API proposal

```ts
// chat lib — host-facing embed (wraps ChatViewComponent)
@Component({ selector: 'ptah-session-embed' })
class SessionEmbedComponent {
  tabId = input.required<string>(); // a TabManagerService tab id
  visible = input(true); // → SESSION_VISIBLE
  focused = input(true); // → SESSION_FOCUSED
  hideAgentSidebar = input(false); // → HIDE_AGENT_SIDEBAR
  sessionClosed = output<void>();
  // slots: <ng-content select="[slot=header]" /> / <ng-content select="[slot=panel]" />
}

// chat-routing lib — surface-owned session lifecycle
class EmbeddedSessionService {
  start(opts: { seedPrompt: string; systemPrompt?: string; mcpToolProfile?: 'coding' | 'apps'; name?: string; workspacePath?: string; model?: string; effort?: EffortLevel; interactive: boolean }): { correlationId: string; surfaceId: SurfaceId };
  send(text: string): Promise<void>; // chat:continue, surfaceMode
  adoptAfterReload(sessionId: string): void; // fresh ids + chat:resume replay
  dispose(): void; // release claim + onSurfaceClosed
}
```

## Gaps to close

1. `ChatInputComponent` has no session input and falls back to the global active tab —
   embedding hosts must replicate the injector pattern or send to the wrong tab
   (`chat-input.component.ts:459-461`, `:507`).
2. `ChatViewComponent` likewise: no inputs, global fallback
   (`chat-view.component.ts:257-259`, `:771-772`).
3. `ChatTranscriptComponent` requires a real `TabManagerService` tab; there is no
   surface-id render path (`chat-transcript.component.ts:239`, `:215-216`).
4. No content-projection slots for header actions or a side panel
   (`chat-view.component.html` — no `ng-content`; `canvas-tile.component.ts:414-422`).
5. No arbitrary per-session tool restriction — only the two-value `mcpToolProfile`
   (`rpc-chat.types.ts:67`; `ai-provider.types.ts:150-151`).
6. No per-session skill parameter; skills are reachable only through prompt text
   (`chat-session.service.ts:517-519`).
7. `mcpServersOverride` supports HTTP transports only (`rpc-chat.types.ts:106-107`).
8. Unclaimed `surfaceMode` chunks are dropped without a warning
   (`chat-message-handler.service.ts:502-503`).
9. Adapters must push `setState` back or the surface transcript stays blank
   (`stream-router.service.ts:352-360`).
10. Surface sessions persist into the saved-session list with no `surfaceMode` exclusion —
    the setup surfaces may clutter the chat list (`session-rpc.handlers.ts` — no filter
    found; **[I]**).
11. The canvas tile's injector recipe is duplicated knowledge, not a shared component
    (`canvas-tile.component.ts:616-626`).
12. No "adopt a surface session as a chat tab" path exists in `TabManagerService` — a
    setup session cannot be handed to the chat UI after the surface closes.

## Decisions

(Recommendation only; the choice stays with the architect.)

- **Reuse the token-injector pattern rather than adding inputs to `ChatViewComponent`.**
  The pattern is proven in the canvas tile, keeps `ChatViewComponent` unchanged, and one
  mechanism then serves tiles and setup surfaces. Adding inputs would create a second
  binding path alongside the tokens.
- **Put the embed component in `chat`, not `chat-ui` or `canvas`.** `chat-ui` must stay
  presentational (rule); `canvas` is a consumer, not a provider, of session UI.
- **Standardize the surface lifecycle in one `chat-routing` facade.** The harness,
  wizard and Apps page each hand-roll the claim/register/start sequence today
  (`harness-workflow.service.ts:283-330`; `setup-wizard-state.service.ts:563-578`;
  `apps-session.service.ts:228-249`).

## Open questions

1. Should a setup session be visible and resumable in the saved-session list after the
   surface closes (gap 10), or hidden until "converted" to a chat tab (gap 12)?
2. Should each of the three surfaces run interactive (prompt cards, like the harness
   workflow) or full-auto (like wizard analysis phases)? The registry supports both
   (`streaming-surface-registry.service.ts:56-65`); each surface must declare it.
3. Does the embed need the full `ChatViewComponent` chrome (banners, dock, agent panel)
   or a slimmed transcript+composer variant? `HIDE_AGENT_SIDEBAR` covers only the
   sidebar (`session-context.token.ts:20-22`).
4. Model/effort for tab-less sessions: the tab stores overrides
   (`canvas-tile.component.ts:520-546`) — where do setup surfaces persist theirs?
5. [I] Whether the persisted setup session actually renders in today's sidebar list was
   not verified end to end; one manual check of the sidebar after a New Project run
   settles it.
