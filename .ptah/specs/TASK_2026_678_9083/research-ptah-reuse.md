# Ptah Command Center reuse inventory — TASK_2026_678_9083

Evidence below is from the current worktree, 2026-10-15. Paths are repository-relative and line numbers refer to this checkout. This inventory covers Ptah only; the separate property-hub implementation was outside this assignment.

## 1. Canvas board (TASK_2026_629)

- The earlier task describes a mission board for multiple **chat sessions**, with a live focused transcript, compact cards for other sessions, lane tabs, and a needs-you queue. It explicitly retains a session-oriented canvas and agent monitor (`.ptah/specs/TASK_2026_629_c0b3/context.md:28`, `:35`, `:39`, `:49`, `:66`).
- Implementation is `libs/frontend/canvas`: `OrchestraCanvasComponent` mounts `ptah-canvas-rail-board` (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:49`, `:249`); the board template is Angular components, including focus area and session details (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:77`, `:161`, `:182`). The code inspected shows a DOM component tree, **not** an HTML `<canvas>` renderer or SVG graph. The component source contains no `<canvas>`/`<svg>` element; the board's established interaction model is cards and rail.
- Data model is `CanvasTile = TileIntent`, held by `CanvasStore` and keyed to session tabs/workspaces (`libs/frontend/canvas/src/lib/canvas.store.ts:39`, `:106`, `:135`, `:237`). It reads `AgentMonitorStore` to count running agents and subagents (`libs/frontend/canvas/src/lib/canvas.store.ts:89`, `:191`). This is a session tile model, not an arbitrary agent-node/edge model.
- The canvas lives **inside** the shared chat surface, with retained mounting across navigation (`apps/ptah-extension-webview/src/app/app.routes.ts:34-38`; `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:118`, `:224-242`). Electron launches chat in grid mode (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:436`); VS Code can use the shared chat surface. A dedicated Command Center route and graph renderer would be new.

## 2. Tribunal UI and workflow

- Tribunal is a lazy top-level Angular route, `tribunal`, loading `TribunalPageComponent` (`apps/ptah-extension-webview/src/app/app.routes.ts:162-168`). Its page composes conductor, vendor cards, relay phase rail, and Crucible verdict panel (`libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts:21-29`, `:138-140`).
- `TribunalRunService` prepares the run and generates conductor framing that explicitly calls `ptah_agent_spawn` for selected lanes (`libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:149`, `:348`, `:402`). Reuse that workflow framing and role vocabulary, subject to a Command Center orchestration contract; the UI service itself is tied to Tribunal's run state.
- `TribunalProgressService` derives Relay and Crucible status from monitored lane status plus `tasks:get` artifacts and `tasks:getRoundJudge` reports (`libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts:113-127`, `:322-361`, `:488`, `:532`). It reacts to meaningful signal changes rather than raw output chunks (`:168`, `:208-210`). `TribunalStateService.progress` exposes the derived result (`libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:129-130`, `:248-249`). There is no dedicated Tribunal phase push event evidenced; phase changes are derived client-side.
- Lane identity is joined through `[tribunal:<laneId>]` task tokens and session-scoped monitored agents (`libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts:414-416`). Command Center can reuse the derivation for an active Tribunal run, but needs a separate aggregate view for general delegated work.

## 3. Voice and speech

- Voice already supports both **local Whisper STT / Kokoro TTS** (`libs/backend/voice-providers/src/lib/worker/voice-worker.ts:16-17`) and **ElevenLabs Scribe STT / TTS** (`libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-stt-provider.ts:2`, `:24`, `:60`; `libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts:120-130`, `:161-183`). Provider selection and a voice settings drawer exist (`libs/backend/voice-providers/src/lib/voice-provider-selector.ts:47`; `libs/frontend/chat/src/lib/settings/ptah-ai/voice-config.component.ts`; `libs/frontend/chat/src/lib/settings/ptah-ai/elevenlabs-panel.component.ts`).
- Current microphone path is **record, stop, then transcribe**: `VoiceInputService` calls `getUserMedia({audio:true})`, starts `MediaRecorder`, packages a blob as base64, then calls `voice:transcribe` (`libs/frontend/chat/src/lib/services/voice-input.service.ts:73-80`, `:114-120`, `:144-180`). That is useful capture/UI plumbing, but does not give near-realtime duplex conversation.
- `voice-rpc.handlers.ts` exposes `voice:transcribe`, `voice:synthesize`, provider list/config, `voice:setApiKey`, and test connection (`libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:170-183`, `:244-274`). The ElevenLabs client uses HTTPS `fetch` for speech endpoints (`libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts:24`, `:161-183`, `:235`); no streaming WebSocket transport was found in this provider directory. Realtime audio transport, turn taking, cancellation/barge-in, and spoken orchestrator status would need work.
- Electron explicitly permits microphone requests from the app shell (`apps/ptah-electron/src/windows/permission-policy.ts:12`, `:174`). The VS Code webview currently restricts `connect-src` to self and its CSP source (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:302`).

## 4. Orchestrator runtime

- Existing chat RPC has `chat:start`, `chat:continue`, `chat:resume`, `chat:abort`, and agent queries (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:107-112`, `:388-396`). The frontend `MessageSenderService` calls `chat:start` for a new session and `chat:continue` for follow-ups (`libs/frontend/chat/src/lib/services/message-sender.service.ts:362`, `:446`, `:513`, `:698`). A Command Center caller can drive the same session through this host RPC and stream handling, with a persistent orchestrator session identity.
- The Claude SDK session executor accepts MCP server overrides; a constrained session path explicitly uses Ptah-only MCP (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:492`, `:546`). The reusable core prompt tells agents to list CLI lanes, spawn with self-contained prompts, and wait for `<agent-lane-completed>` (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:95-100`). The other Ptah prompt documents `ptah_agent_spawn` and the completion push (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts:259-269`). These are runtime/tool affordances, not a dedicated “head of engineering” persona yet.
- `ptah_session_start` already creates child chat sessions in worktrees (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:3`), but requires a live parent chat session (`:273`). Thus Command Center orchestration should own a normal live parent session rather than issue detached calls. CLI agent process management and reporting are already wired (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:172-203`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:137`).

## 5. Page and host integration

- Add a surface id to the shared `ViewType`/route-id list (`libs/shared/src/lib/types/webview-surface.types.ts:53`, `:74`), a lazy route in `apps/ptah-extension-webview/src/app/app.routes.ts` following Tribunal (`:162-168`), and navigation in the shell (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:172-173`, `:508`). `AppStateManager` uses that route list for current view (`libs/frontend/core/src/lib/services/app-state.service.ts:44`).
- Electron-only routing is an available pattern (`apps/ptah-extension-webview/src/app/app.routes.ts:180-183`; `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts:19-20`). **Recommendation for planning:** keep the initial near-realtime voice surface Electron-only if direct media/WebSocket transport is chosen, while keeping model/event code host-neutral. The existing nonstreaming voice RPC path already works in the shared webview, so a cross-host later phase is plausible. Host scope is a product decision, not settled by this inventory.
- The existing canvas is embedded in chat and Electron makes it its default chat layout (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:703-704`; `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:436`). A new top-level page should not silently repurpose that session view.

## 6. Secrets, network, and microphone

- **No new ElevenLabs key type is needed.** `VoiceSecretStore` already encrypts and persists `voice.elevenlabs.apiKeyCipher` (`libs/backend/voice-providers/src/lib/voice-secret-store.ts:3`, `:22`, `:75`), and `voice:setApiKey` is registered (`libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts:267-268`, `:768`). `platform-core` defines the generic secret-storage port (`libs/backend/platform-core/src/interfaces/secret-storage.interface.ts`), but the voice integration already has its own vault path.
- Existing ElevenLabs calls originate in the backend over HTTPS (`libs/backend/voice-providers/src/lib/elevenlabs/elevenlabs-client.ts:24`, `:235`). A browser WebSocket to `wss://api.elevenlabs.io` would encounter the VS Code webview's `connect-src` policy (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:302`), and Electron's shell CSP test expects `connect-src 'self'` (`apps/ptah-electron/src/windows/shell-csp.spec.ts:159`). A host-side streaming bridge avoids exposing the API key to the renderer and preserves the current secret boundary; exact Electron CSP generation and permission behavior should be validated in the implementation spike.
- Electron's permission policy names `getUserMedia({audio:true})` and installs a permission request handler (`apps/ptah-electron/src/windows/permission-policy.ts:12`, `:174`). This establishes a microphone path, though continuous capture behavior still needs validation.

## 7. Events for canvas animation

- CLI process events: `agent:spawned`, `agent:output`, `agent:exited` are emitted/bridged to `agent-monitor:spawned`, `agent-monitor:output`, `agent-monitor:exited`; expiry is `agent-monitor:expired` (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:172-203`, `:244-268`; `libs/shared/src/lib/types/messages/message-constants.ts:230-239`). `AgentMonitorMessageHandlerService` routes those pushes into the store (`libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts:38-60`).
- `AgentMonitorStore` exposes reactive `agents` and `subagents` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:758`, `:816`) and handles CLI spawn/output/exit (`:1160`, `:1310`, `:1456`) plus SDK `agent_start`, `agent_progress`, `agent_status`, `agent_completed` (`:2008`, `:2107`, `:2141`, `:2175`). Its own comment notes a foreground completion can arrive through tool result even without `agent_completed` (`:2396-2410`); use store state, not a single raw event, to animate terminal state.
- Tribunal phases are computed from lane state and task artifacts, not a standalone phase event (`libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts:113-127`, `:208-210`, `:322-361`). Session-child origin is represented in chat types (`libs/frontend/chat-types/src/lib/chat-types.ts:581`, `:624`), while `ptah_session_start`'s live-parent requirement is in `session-spawner.service.ts:273`. A unified Command Center node stream combining CLI lanes, SDK subagents, and child sessions is new.

## Reuse map

| Requirement | Existing asset | Disposition | Notes |
| --- | --- | --- | --- |
| Agent visual language | `libs/frontend/canvas/src/lib/canvas-rail/` | Extend | Reuse card/status ideas; new graph or `<canvas>` rendering if required. |
| Session and lane state | `libs/frontend/canvas/src/lib/canvas.store.ts`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` | Extend | Existing tile key is session tab, not agent node. |
| Tribunal workflow | `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts`; `tribunal-progress.service.ts` | Extend | Reuse framing/derivation; decouple from Tribunal page state for general work. |
| Voice provider settings and keys | `libs/frontend/chat/src/lib/settings/ptah-ai/`; `libs/backend/voice-providers/src/lib/voice-secret-store.ts` | Reuse as-is | ElevenLabs configuration already exists. |
| STT/TTS calls | `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.ts` | Reuse as-is for turn-based path | Existing endpoints take completed audio/text. |
| Near-realtime speech | `libs/backend/voice-providers/src/lib/elevenlabs/` | Build new | Existing adapter uses HTTP request/response. |
| Orchestrator chat | `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`; `libs/frontend/chat/src/lib/services/message-sender.service.ts` | Extend | Keep a live parent session and voice turn coordinator. |
| Spawn/report/status animation | `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` | Extend | Add aggregate projection and narration policy. |
| Top-level page | `apps/ptah-extension-webview/src/app/app.routes.ts`; `libs/shared/src/lib/types/webview-surface.types.ts` | Build new | Follow Tribunal route pattern. |

## Gaps

1. Streaming/duplex ElevenLabs transport, incremental transcripts, playback queue, interruption, and audio turn control.
2. Dedicated persistent Ptah orchestrator session with voice-specific instructions and safe status narration; existing chat/session infrastructure is reusable.
3. Agent-centric graph data model and drawing layer; the existing canvas models session tiles in Angular DOM.
4. Unified projection of CLI lanes, SDK subagents, child sessions, and Tribunal phases into stable node IDs and lifecycle states.
5. Command Center route/nav/host policy and a live status summary that prioritizes voice updates over transcript detail.

## Decisions

- **Evidence-based reuse decision:** use the existing ElevenLabs key, provider configuration, host RPC, and monitor store; adding a second provider setup would duplicate working infrastructure. Alternative: a separate ElevenLabs integration. Evidence: `voice-secret-store.ts:22`, `voice-rpc.handlers.ts:170-183`, `agent-monitor.store.ts:758-816`. Reversible: yes.
- **Research recommendation:** keep the API key and streaming connection in the host/backend, forwarding bounded audio/status over the established host bridge. Alternative: direct renderer WebSocket. Evidence: encrypted key boundary (`voice-secret-store.ts:3`, `:75`) and current CSP (`webview-html-generator.ts:302`; `shell-csp.spec.ts:159`). Reversible: yes; architect should choose the final transport.
- **Research recommendation:** derive visible lifecycle from `AgentMonitorStore` and Tribunal progress, not raw completion pushes alone. Alternative: independently reduce every push in the page. Evidence: foreground completion fallback (`agent-monitor.store.ts:2396-2410`) and derived phases (`tribunal-progress.service.ts:113-127`). Reversible: yes.

## Open Questions

1. Does “near realtime” require ElevenLabs conversational/WebSocket audio with barge-in, or is short turn-based record/transcribe/respond/synthesize acceptable for the first release? A prototype comparing latency and interruption behavior would settle this.
2. Is Command Center an Electron-only first release, or must the same page work in the VS Code webview from day one? This determines CSP, mic, and streaming bridge scope.
3. Should the new page show only agents spawned by its own orchestrator session, or also agents from all existing chat/Tribunal sessions? The `AgentMonitorStore` supports session-scoped queries, but the intended ownership boundary is a product choice.
4. Should the Command Center invoke Tribunal's exact run modes, or borrow its workflow phases as a general planning convention? `TribunalRunService` currently binds runs to a dedicated Tribunal state and spec folder.
