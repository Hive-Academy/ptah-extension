# Independent Spike Review: Landing Page Live Webview Demo

**Verdict: Feasible with changes**

Booting the real `ptah-extension-webview` Angular SPA inside an isolated same-origin iframe backed by a deterministic replay bridge is architecturally sound and renders the genuine UI (`boot.png`, `mid-stream.png`, `complete.png`). However, the spike has several contract mismatches, boot races, and static-hosting gaps that must be fixed before production implementation.

---

## 1. Coordinator Observations — Root Causes & Expected Contracts

1. **Uncounted console warnings (`capture.mjs:38-41`)**:
   - `capture.mjs:39` filters strictly on `if (message.type() === 'error')`, ignoring all `console.warn` diagnostics.
2. **`ChatAttentionHostMessageHandler: Invalid attention snapshot dropped` (repeated 5×, then `retries exhausted`)**:
   - **Root cause**: `ChatAttentionHostMessageHandler` (`libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:17,108-149`) validates `attention:getSnapshot` against `SnapshotSchema = z.object({ notices: z.array(AttentionNoticeSchema) }).strict()`, matching `AttentionGetSnapshotResult` (`libs/shared/src/lib/types/rpc/rpc-attention.types.ts:6-8`). `scenarios/chat-tool-call.json:26` returns `{ "items": [], "notifications": [] }`, failing validation and triggering 5 exponential-backoff retries (`2s..16s`, visible in `evidence/run.json:383,407,412,413`), plus additional retries on `focus`/`visibilitychange` (`:49-58`).
   - **Right answer**: `{ "notices": [] }`.
3. **`PlanLimitsStore: provider:getPlanLimits returned a malformed snapshot`**:
   - **Root cause**: `PlanLimitsStore.load()` (`libs/frontend/core/src/lib/services/plan-limits.store.ts:185-204,351-364`) validates via `isPlanLimitsSnapshot()`, which requires `PlanLimitsSnapshot` (`libs/shared/src/lib/types/plan-limit.types.ts:236-243`): `{ generatedAt: number, owners: readonly PlanLimitOwnerSnapshot[], discoveryIncomplete?: boolean, sessionOwners: Readonly<Record<string, PlanLimitSessionOwner>> }`. `scenarios/chat-tool-call.json:33` returns `{ "providers": [] }`.
   - **Right answer**: `{ "generatedAt": 1793476800000, "owners": [], "sessionOwners": {} }`.
4. **`SurfaceRoutePersistence: Not persisting a route the restore contract rejects`**:
   - **Root cause**: `SurfaceRoutePersistence.persist()` (`libs/frontend/core/src/lib/routing/surface-route-persistence.ts:91-106`) validates `{ v: 1, route, seed, panelId }` via `parseWebviewRouteState()` (`libs/shared/src/lib/types/webview-route-state.ts:32-40,107-190`). It rejects any route containing `:` or `%3a` outside `/marketplace/skills/...` (`hasOnlyAllowedColons`, `:158-161`) and any `panelId` other than `''`, `'electron-main'`, or `ptah.panel.<id>` (`isValidPanelId`, `:181-190`). Furthermore, `ChatTabRouteSync.followUrl()` (`libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:180`) validates `:tabId` in `/chat/:tabId` with `TabId.validate(urlTab)` (`libs/shared/src/lib/types/branded.types.ts:41-42,202-204`), which requires a UUID v4—rejecting the seeded `'ptahcode-demo-tab'` (`replay-bridge.js:123`).
5. **`mid-stream.png` status contradiction ("done" in header chip, rail card, and right inspector while bubble says "Working" / "Orchestrating")**:
   - **Root cause**: Under `TASK_2026_360`, `chat:chunk` events (`message_start`, `text_delta`, `tool_start`, `tool_result`) only build the `StreamingState` tree (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:558-559`, `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:565-570`); they never set `tab.status = 'streaming'`. Only a `turn_state` event (`libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:16-86`) updates `tab.status`, `_streamingTabIds`, and `SessionLivenessRegistry`. `scenarios/chat-tool-call.json:45-53` never emits `turn_state` with `phase: "generating"` at turn start (only `phase: "idle"` at `at: 2600`, line 53). Thus `tab.status` stays `'loaded'`, causing `CompactSessionCardComponent.railStateValue` (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:540-552`) and the inspector roster to compute `'done'` while the bubble's `ExecutionNode` has `status: 'streaming'`.
6. **Timestamp mismatch (`8:03 PM` assistant vs `10:00 PM` user in `mid-stream.png`, then both `10:00 PM` in `complete.png`)**:
   - **Root cause**: `1793476800100` (`chat-tool-call.json:45`) formats as `10:00 PM` in `UTC+2`. During streaming (`mid-stream.png`), `StreamPresentationStore.streamingMessages()` (`libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:272-282`) calls `createExecutionChatMessage(...)` without passing `timestamp: tree.startTime`, which defaults to `Date.now()` (`8:03 PM` capture wall-clock time). On turn completion (`complete.png`), `MessageFinalizationService.finalizeCurrentMessage()` (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:278-287`) sets `timestamp: startTimestamp` (`1793476800550` = `10:00 PM`).
7. **Session card preview reads `"Now The app starts…"`**:
   - **Root cause (Refuted as chunk-join bug; confirmed as UI/DOM layout)**: `CompactRailCardComponent` (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:98-104,248-251`) renders `<span class="shrink-0">Now</span><span class="rc-ellipsis">{{ shownNow() }}</span>` inside `.rc-line` (`display: flex; gap: 4px`). `innerText` concatenates the label `Now` and `shownNow()`. Only the second text chunk (`blockIndex: 1`, `"The app starts..."`) appears in `shownNow()` because `collectTextBlocks` (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:598-629,653-663`) creates separate prose items per `blockIndex` (`0` and `1`) and `selectRecapItem()` displays the newest prose block.
8. **`shellReadyMs: 18721` (~15.5–18.7 s) in `evidence/run.json:5066` vs 1.6 s navigation (`FCP: 1068 ms`)**:
   - **Root cause**: Artificial timeout bug in `replay-bridge.js:192-200`. `waitForAngular()` polls `document.querySelector('app-root')` every `50ms` until `attempts > 200` (`201 × 50ms = 10.05s+` minimum, ~15–18s under timer load). The actual root element in `apps/ptah-extension-webview/src/index.html:185` (`dist/.../index.html:181`) is **`<ptah-root>`**, not `<app-root>` (`run.json:5070` confirms `"appRootHtmlLength": 0`). `waitForAngular()` always exhausts all 201 retries before setting `ready = true`.
9. **`replay-bridge.js:119-131` seeding fixed `localStorage` key (`ptah.tabs.ws._2Fworkspace_2Facme-app.electron-main`)**:
   - **Root cause**: Fragile coupling to `TabWorkspacePartitionService._getWorkspaceStorageKey()` (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:550-567`) AND it causes a boot race with `ptahConfig.initialSessionId` (`replay-bridge.js:116`). See Finding B2 below for why this also caused the user prompt mismatch between `coordinator-mid.png`/`coordinator-complete.png` (`"Can you find where the app starts?"`) and `boot.png`/`complete.png` (`"How is the authentication middleware wired into the API router?"`).

---

## 2. Findings by Severity (with `file:line` Evidence & Concrete Fixes)

### Blockers

- **[B1] `waitForAngular()` polls non-existent `app-root`, delaying `ready` and autoplay by 10–18 s**
  - **Evidence**: `task-tracking/landing-live-demo/spike/replay-bridge.js:195`, `task-tracking/landing-live-demo/spike/capture.mjs:66`, `apps/ptah-extension-webview/src/index.html:185`.
  - **Impact**: `document.querySelector('app-root')` is always `null`; `ready` only flips after 201 failed polls, delaying `play()` (`replay-bridge.js:158`) by 10–18 seconds.
  - **Fix**: Query `document.querySelector('ptah-root')` and gate readiness on the host's own `webview-ready` / `boot:getReadiness` RPC call (`replay-bridge.js:70`) plus rendered child content inside `ptah-root`.

- **[B2] Dual session seeding (`localStorage` + `initialSessionId`) creates a boot race, wrong user prompt, and broken `$activeTabId` resolution**
  - **Evidence**: `replay-bridge.js:50-58,116-131`, `scenarios/chat-tool-call.json:18-24,45-46`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts:748-760`, `libs/frontend/core/src/lib/services/electron-layout.service.ts:872-905`, `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:189-206`.
  - **Impact**:
    1. Setting `ptahConfig.initialSessionId` (`replay-bridge.js:116`) triggers `TabManagerService`'s VS Code pop-out branch (`tab-manager.service.ts:749-759`), which creates a random-UUID tab, schedules `session:load` (`"How is the authentication middleware wired into the API router?"`), and saves to `localStorage['ptah.tabs.electron-main']`.
    2. Concurrently, `ElectronLayoutService.syncFromBackend()` calls `workspace:getInfo` → `workspace:switch`, loading `localStorage['ptah.tabs.ws._2Fworkspace_2Facme-app.electron-main']` (`"Can you find where the app starts?"`, `tabId: 'ptahcode-demo-tab'`). Depending on microtask timing, `session:load` either overwrites the workspace tab (`boot.png`) or loses the race (`coordinator-mid.png`, `coordinator-complete.png`).
    3. `activeTabId()` (`replay-bridge.js:50-58`) iterates `localStorage` and returns the **first** key matching `ptah.tabs*`. Once `ptah.tabs.electron-main` is written, `localStorage.key(i)` can return the pop-out tab's stale UUID instead of the workspace tab, dropping live `chat:chunk` events (`coordinator-mid.png`).
    4. `StreamingHandlerService` ignores live `message_start` events with `role: 'user'` (`chat-tool-call.json:45-46` are no-ops unless a user prompt boundary was queued).
  - **Fix**: Remove `localStorage` seeding (`replay-bridge.js:119-131`), remove `initialSessionId`/`initialSessionName` from `window.ptahConfig` (which real Electron `apps/ptah-electron/src/preload.ts:35-51` does not set on `electron-main`), and remove user `message_start`/`text_delta` from `timeline`. Instead, after `workspace:switch` settles, open the session cleanly by dispatching an `agentSession:opened` or `sessionHandoff:opened` host message with a valid UUID v4 `tabId` (`TabManagerService.adoptHandoffSessionTab`), or seed the workspace storage key with a valid UUID v4 `tabId` and single consistent initial message list matching `session:load`.

- **[B3] Missing `turn_state` (`phase: 'generating'`) and `message_complete` in stream timeline**
  - **Evidence**: `scenarios/chat-tool-call.json:10,45-53`, `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:526-562`, `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:16-86`, `libs/shared/src/lib/types/execution/stream-background.ts:311-339`.
  - **Impact**: Without `{ eventType: 'turn_state', phase: 'generating', revision: 2 }` at turn start, the tab, header chip, compact session card, and right inspector remain in `'done'`/`'idle'` state throughout streaming (`mid-stream.png`). Also, `demo-assistant` never emits `message_complete` before the terminal `turn_state`.
  - **Fix**: Emit a `chat:chunk` with `eventType: 'turn_state', phase: 'generating', revision: 2` before the assistant's `message_start`, and emit `eventType: 'message_complete'` before the terminal `turn_state` (`phase: 'idle', revision: 3`).

- **[B4] Production `/demo/` subpath and build-time font/asset rewriting are not handled without `serve.mjs`**
  - **Evidence**: `task-tracking/landing-live-demo/spike/serve.mjs:19-30,55-60`, `apps/ptah-extension-webview/src/index.html:6`, `apps/ptah-extension-webview/src/styles.css:7`, `dist/apps/ptah-extension-webview/browser/index.html:6`.
  - **Impact**: DigitalOcean App Platform serves `ptah-landing-page` as a static site (`output_dir: dist/ptah-landing-page/browser`), so `serve.mjs` does not exist in production. With `<base href="/">`, `/__spike__/...` paths, and `https://fonts.googleapis.com` in `styles.css:7`, deploying under `/demo/` will 404 all chunks/assets/scenarios and leak external requests to `fonts.gstatic.com`.
  - **Fix**: Add a build-time preparation script for `/demo/` that: (1) rewrites `<base href="/demo/">`, (2) injects `./replay-bridge.js`, (3) rewrites `https://fonts.gstatic.com/` URLs in `styles.css` to `./assets/fonts/gstatic/` and copies the `.woff2` files from `libs/frontend/webview-e2e-harness/src/lib/fonts/gstatic/`, and (4) keeps a strict self-only CSP `<meta>` tag instead of stripping it (`serve.mjs:20`).

### Majors

- **[M1] Malformed RPC fixture shapes (`attention:getSnapshot`, `provider:getPlanLimits`)**
  - **Evidence**: `scenarios/chat-tool-call.json:26,33`, `libs/shared/src/lib/types/rpc/rpc-attention.types.ts:6-8`, `libs/shared/src/lib/types/plan-limit.types.ts:236-243`.
  - **Impact**: Triggers repeated Zod/type-guard warnings and 5× backoff retry loops during demo playback.
  - **Fix**: Change `attention:getSnapshot` to `{ "notices": [] }` and `provider:getPlanLimits` to `{ "generatedAt": 1793476800000, "owners": [], "sessionOwners": {} }`. Update `capture.mjs:39` to fail on unexpected `console.warn` as well as `console.error`.

- **[M2] Non-UUID `tabId` (`'ptahcode-demo-tab'`) violates `TabId` brand contract**
  - **Evidence**: `replay-bridge.js:58,123-124`, `libs/shared/src/lib/types/branded.types.ts:41-42,191-223`, `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:180`.
  - **Impact**: `TabId.validate('ptahcode-demo-tab')` returns `false`, breaking `ChatTabRouteSync` URL-to-tab selection and any service using `TabId.safeParse()`.
  - **Fix**: Use a valid UUID v4 for the demo tab ID (e.g. `'22222222-2222-4222-8222-222222222222'`).

- **[M3] Unchecked `event.origin` on `MessageRouterService` and `replay-bridge.js` control listener**
  - **Evidence**: `libs/frontend/core/src/lib/services/message-router.service.ts:110-122`, `task-tracking/landing-live-demo/spike/replay-bridge.js:177-184`.
  - **Impact**: `MessageRouterService` accepts any `window.postMessage` without checking `event.origin` or `event.source`, so any script with a reference to `iframe.contentWindow` can inject arbitrary host messages directly into Angular. In `replay-bridge.js:177-184`, `event.origin` is not checked, and when opened top-level (`window.parent === window`), any script on the page satisfies `event.source === window.parent`.
  - **Fix**: In `replay-bridge.js:177`, check `if (event.origin !== window.location.origin || event.source !== window.parent) return;`. Keep the iframe same-origin with `sandbox="allow-scripts allow-same-origin"`.

- **[M4] Network guard in `replay-bridge.js` does not cover declarative resource loads (`<img>`, CSS `url()`, `<script>`, `Worker`, `sendBeacon`)**
  - **Evidence**: `replay-bridge.js:24-49`, `serve.mjs:20`.
  - **Impact**: Monkey-patching `fetch`/`XHR`/`WebSocket`/`EventSource` does not block CSS `@import`/`url()` fonts, `<img src>`, `new Worker()`, `AudioWorklet`, or `navigator.sendBeacon()`, and `serve.mjs:20` deletes the CSP `<meta>` tag.
  - **Fix**: Retain a strict `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self';">` in `/demo/index.html`.

### Minors

- **[m1] Missing `window.ptahClipboard` global from Electron preload contract**
  - **Evidence**: `apps/ptah-electron/src/preload.ts:52-57` vs `replay-bridge.js:109-118`.
  - **Impact**: Clicking copy buttons in code blocks or messages falls back or errors if `window.ptahClipboard` is expected in Electron mode.
  - **Fix**: Stub `window.ptahClipboard = { readText: async () => '', writeText: async () => {}, hasImage: async () => false, readImageBase64: async () => null }` in `replay-bridge.js`.

- **[m2] Method-only RPC lookup (`scenario.rpc[msg.method]`) ignores `msg.params` and returns `data: null` for unmapped methods**
  - **Evidence**: `replay-bridge.js:68-78`, `libs/frontend/core/src/lib/services/claude-rpc.service.ts:259-264`.
  - **Impact**: Multi-session scenarios cannot return different payloads per `sessionId`, and interactive clicks on unmapped surfaces receive `{ success: true, data: null }`, which throws when callers destructure `result.data`.
  - **Fix**: Support parameter-keyed overrides (e.g., `rpc["session:load#1111..."]` falling back to `rpc["session:load"]`) and safe default empty shapes for common read RPCs.

- **[m3] Streaming message bubble timestamp uses wall-clock `Date.now()` until finalized**
  - **Evidence**: `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:272-282`.
  - **Impact**: While streaming (`mid-stream.png`), the assistant bubble shows the viewer's current clock time while historical messages show the scenario's recorded timestamp (`1793476800100`).
  - **Fix**: Either pass `timestamp: tree.startTime` in `StreamPresentationStore` or rewrite scenario timestamps relative to `Date.now()` in `replay-bridge.js` when loading a scenario.

---

## 3. Answers to Explicit Review Questions

1. **Bridge correctness vs real contracts**:
   - `rpc:call` / `rpc:response` (`claude-rpc.service.ts:85-92,219-222,259-264`): Envelope `{ type: 'rpc:response', correlationId, success, data }` is valid, but unmapped methods return `data: null` (`[m2]`) and two scenario answers violate schema contracts (`[M1]`).
   - Electron globals (`apps/ptah-electron/src/preload.ts:24-73`): `window.vscode` and `window.ptahConfig` work, but `initialSessionId` triggers the VS Code pop-out flow (`[B2]`) and `window.ptahClipboard` is missing (`[m1]`).
   - `chat:chunk` / `FlatStreamEventUnion` (`libs/shared/src/lib/types/execution/stream.ts`, `stream-background.ts`, `chat-message-handler.service.ts:526-562`): Missing `turn_state` (`phase: 'generating'`) and `message_complete` (`[B3]`), plus redundant user `message_start`/`text_delta` (`[B2]`).
   - `session:turnEnded` (`libs/shared/src/lib/types/sdk-hook.types.ts:115-123`, `chat-message-handler.service.ts:448-464`): Matches `SdkTurnEndedPayload` (`sessionId`, `cwd`, `lastAssistantMessage`, `backgroundTasks`, `sessionCrons`, `terminalReason`, `timestamp`).
2. **Security/privacy for public hosting**:
   - External font escape exists in `apps/ptah-extension-webview/src/styles.css:7` (`fonts.googleapis.com` / `fonts.gstatic.com`), masked only by `serve.mjs:57` at runtime (`[B4]`). Note also that `styles.css:7` imports `Cinzel`, which is not in `libs/frontend/webview-e2e-harness/src/lib/fonts/gstatic` (only `Inter` and `JetBrains Mono` are cached there).
   - `MessageRouterService` (`message-router.service.ts:110-122`) and `replay-bridge.js:177-184` do not validate `event.origin` (`[M3]`), and `serve.mjs:20` strips CSP (`[M4]`).
3. **PII / secrets check (`scenarios/chat-tool-call.json`, `replay-bridge.js`)**:
   - **Clean**: Contains only synthetic paths (`/workspace/acme-app`, `src/main.ts`, `src/api/router.ts`), synthetic UUID `11111111-1111-4111-8111-111111111111`, and no real names, emails, or secrets.
4. **Production feasibility & uncovered risks**:
   - **Feasible with changes** (`[B1]`–`[B4]`, `[M1]`–`[M4]`). Uncovered production risks to address in the implementation plan:
     - **Bundle weight on mobile/slow connections**: Initial load is ~4.1 MB raw (~1.04 MB brotli); gate iframe mount behind `IntersectionObserver` / user click on mobile or `prefers-reduced-motion` / `saveData`.
     - **Cache invalidation**: `ptah-extension-webview` uses `outputHashing: "none"` (`apps/ptah-extension-webview/project.json:45`), so `/demo/main.js` and `chunk-*.js` need deploy-versioned query strings or `Cache-Control: no-cache` on `/demo/index.html`.
     - **Contract drift**: Validate scenario JSON files in CI against the shared TypeScript/Zod schemas (`SnapshotSchema`, `isPlanLimitsSnapshot`, `FlatStreamEventUnion`) so future schema changes cannot silently break landing-page demos.
     - **Interactive clicks outside scripted path**: Add an optional interaction scrim or safe fallback RPC responses so visitors clicking unscripted sidebar/navbar actions do not hit unhandled null-data errors.
