# Development Tasks - TASK_2025_117: Multi-Webview Panel Support (Option B2)

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 3/3 complete

**Architecture**: B2 - VS Code Native Sidebar + Editor WebviewPanel (fully independent Angular instances)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

1. **`crypto.randomUUID()` availability**: VERIFIED - Node.js 20+ (VS Code extension host) supports it. Angular apps run in webview (Chromium), also supported.
2. **`StreamingHandlerService` filters by tabId**: VERIFIED at `streaming-handler.service.ts` line 73+87-88 - events for tabs not in this Angular instance are silently discarded (returns `null`). Broadcasting is safe.
3. **RPC responses are point-to-point**: VERIFIED - RPC responses flow back through the same `webview.postMessage` channel that received the request. No broadcast needed for RPC.
4. **`WebviewEventQueue` is a DI singleton**: VERIFIED at `webview-event-queue.ts` line 54 - uses `@injectable()` and is registered via `TOKENS.WEBVIEW_EVENT_QUEUE`. Per-panel queues must be manually instantiated.
5. **Local `WebviewManager` interfaces in RPC files**: VERIFIED at `rpc-method-registration.service.ts` lines 50-52 and `chat-rpc.handlers.ts` lines 42-44 - both define a local `interface WebviewManager` with only `sendMessage`. Must add `broadcastMessage` to both.
6. **`generateAngularWebviewContent` options parsing**: VERIFIED at `webview-html-generator.ts` lines 49-65 - uses discriminated union parsing (`'initialView' in options || 'workspaceInfo' in options`). Adding `panelId` to the check is clean.
7. **`WebviewManager.registerWebviewView()` auto-cleanup**: VERIFIED at `webview-manager.ts` lines 187-191 - sets up `view.onDidDispose()` that deletes from `activeWebviewViews` and `webviewMetrics`. Panels registered via this method get auto-cleanup.

### Risks Identified

| Risk                                                                              | Severity | Mitigation                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------- | --- | --------------------------------------------------------------------------- |
| `registerWebviewView()` casts `WebviewPanel` to `WebviewView`                     | MED      | Existing code at angular-webview.provider.ts line 136 already uses `panel as unknown as vscode.WebviewView`. This unsafe cast works because both have `.webview` property. Keep cast for now to minimize scope. |
| Per-panel `WebviewEventQueue` cannot use DI                                       | LOW      | Constructor requires Logger. Must pass manually: `new WebviewEventQueue(this.logger as any)`. This is safe because WebviewEventQueue only uses logger for debug/info logging.                                   |
| `postMessageDirect()` references `this._panel`                                    | LOW      | After migrating to `_panels` Map, `postMessageDirect()` (lines 206-216) must be updated. It is only used for sidebar event queue flush, so it should only reference `this._view`.                               |
| Options parsing in `generateAngularWebviewContent` uses discriminated union check | LOW      | Current check is `'initialView' in options                                                                                                                                                                      |     | 'workspaceInfo' in options |     | 'isLicensed' in options`. Must add `'panelId' in options` to the condition. |

### Edge Cases to Handle

- Sidebar webview (`ptah.main`) gets empty `panelId` (empty string) - backward compatible
- Panel disposal cleans up both local `_panels` Map and WebviewManager registry (auto via `onDidDispose`)
- Multiple panels each get independent event queues (manually instantiated per panel)
- `localStorage` key for sidebar remains `'ptah.tabs'` (no breaking change)
- Panel localStorage keys are orphaned on panel close (acceptable - small data, ~2-10KB each)

---

## Batch 1: Backend - Broadcast Infrastructure COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: d49f61e

### Task 1.1: Add `broadcastMessage()` method to WebviewManager COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\webview-manager.ts`
**Spec Reference**: implementation-plan.md lines 83-124 (Component 1)
**Pattern to Follow**: `sendMessage()` method at lines 209-247 of the same file

**Quality Requirements**:

- Must not throw if any individual webview fails - use `Promise.allSettled`
- Log failures as warnings, not errors (webview may have been disposed between check and send)
- Must iterate BOTH `activeWebviews` (panels) AND `activeWebviewViews` (sidebar views)
- Method signature: `async broadcastMessage<T extends StrictMessageType>(type: T, payload: any): Promise<void>`

**Validation Notes**:

- `activeWebviews` is `Map<string, vscode.WebviewPanel>` (line 68)
- `activeWebviewViews` is `Map<string, vscode.WebviewView>` (line 69)
- For panels: reuse existing `sendMessage()` which handles the webview lookup internally
- For sidebar views: post directly via `view.webview.postMessage({ type, payload })` wrapped in try/catch
- Use `Promise.allSettled()` on all panel send promises

**Implementation Details**:

- Add method after `getActiveWebviews()` (after line 304)
- `StrictMessageType` is already imported at line 7
- Build an array of promises from iterating `this.activeWebviews` keys (call `this.sendMessage(viewType, type, payload)` for each)
- Iterate `this.activeWebviewViews` entries and post directly with try/catch, logging failures at warn level
- Await `Promise.allSettled(promises)` for the panel sends

---

### Task 1.2: Replace 5x hardcoded `'ptah.main'` with `broadcastMessage` in RpcMethodRegistrationService COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md lines 133-141 (Component 2 - RPC sites)
**Pattern to Follow**: Existing `sendMessage('ptah.main', ...)` calls

**Quality Requirements**:

- Update the local `WebviewManager` interface (lines 50-52) to add `broadcastMessage`
- Replace ALL 5 sites from `sendMessage('ptah.main', TYPE, PAYLOAD)` to `broadcastMessage(TYPE, PAYLOAD)`
- No change to payload structure - events already include tabId and sessionId

**Sites to Change** (verified line numbers from source):

1. **Line 150-151**: `SESSION_ID_RESOLVED` in `setupSessionIdResolvedCallback()`
   - From: `this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, { tabId, realSessionId })`
   - To: `this.webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, { tabId, realSessionId })`
2. **Line 208-209**: `CHAT_CHUNK` (compaction) in `setupCompactionStartCallback()`
   - From: `this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_CHUNK, { sessionId, event })`
   - To: `this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, { sessionId, event })`
3. **Line 247-248**: `SESSION_STATS` in `sendStatsWithRetry()`
   - From: `this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_STATS, { ... })`
   - To: `this.webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, { ... })`
4. **Line 315-316**: `AGENT_SUMMARY_CHUNK` in `setupAgentWatcherListeners()`
   - From: `this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)`
   - To: `this.webviewManager.broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)`
5. **Line 367-368**: `CHAT_CHUNK` (agent-start) in `setupAgentWatcherListeners()`
   - From: `this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_CHUNK, { sessionId, event })`
   - To: `this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, { sessionId, event })`

**Implementation Details**:

- Update interface at lines 50-52 to:
  ```typescript
  interface WebviewManager {
    sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
    broadcastMessage(type: string, payload: unknown): Promise<void>;
  }
  ```
- For each of the 5 sites: remove the first `'ptah.main'` argument and change method name from `sendMessage` to `broadcastMessage`

---

### Task 1.3: Replace 4x hardcoded `'ptah.main'` with `broadcastMessage` in ChatRpcHandlers COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md lines 143-150 (Component 2 - Chat handler sites)
**Pattern to Follow**: Existing `sendMessage('ptah.main', ...)` calls in `streamExecutionNodesToWebview()`

**Quality Requirements**:

- Update the local `WebviewManager` interface (lines 42-44) to add `broadcastMessage`
- Replace ALL 4 sites from `sendMessage('ptah.main', TYPE, PAYLOAD)` to `broadcastMessage(TYPE, PAYLOAD)`
- No change to payload structure

**Sites to Change** (verified line numbers from source):

1. **Line 501-502**: `CHAT_CHUNK` (streaming events) in `streamExecutionNodesToWebview()`
   - From: `await this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_CHUNK, { tabId, sessionId, event })`
   - To: `await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, { tabId, sessionId, event })`
2. **Line 523-524**: `CHAT_COMPLETE` (turn completion)
   - From: `await this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_COMPLETE, { tabId, sessionId, code: 0 })`
   - To: `await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, { tabId, sessionId, code: 0 })`
3. **Line 536-537**: `CHAT_COMPLETE` (stream end fallback)
   - Same pattern as #2
4. **Line 572-573**: `CHAT_ERROR` (error handler)
   - From: `await this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_ERROR, { tabId, sessionId, error })`
   - To: `await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, { tabId, sessionId, error })`

**Implementation Details**:

- Update interface at lines 42-44 to:
  ```typescript
  interface WebviewManager {
    sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
    broadcastMessage(type: string, payload: unknown): Promise<void>;
  }
  ```
- For each of the 4 sites: remove the first `'ptah.main'` argument and change method name from `sendMessage` to `broadcastMessage`

---

**Batch 1 Verification**:

- `broadcastMessage()` method exists in WebviewManager class
- All 9 `'ptah.main'` hardcoded broadcast sites replaced (5 in RpcMethodRegistration + 4 in ChatRpcHandlers)
- Both local WebviewManager interfaces updated with `broadcastMessage` method
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 2: Backend - Multi-Panel Registry & panelId Plumbing COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (broadcast mechanism must exist before panels can use it)
**Commit**: b4a4db0

### Task 2.1: Convert single `_panel` to `_panels` Map in AngularWebviewProvider COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`
**Spec Reference**: implementation-plan.md lines 162-256 (Component 3)
**Pattern to Follow**: Existing `createPanel()` at lines 112-164, `resolveWebviewView()` at lines 63-106

**Quality Requirements**:

- Replace `private _panel?: vscode.WebviewPanel` (line 40) with `private readonly _panels = new Map<string, vscode.WebviewPanel>()`
- Each panel gets unique ID via `crypto.randomUUID()` (format: `ptah.panel.{uuid}`)
- Each panel gets its own `WebviewEventQueue` instance (manually instantiated, NOT from DI)
- Register each panel with WebviewManager using existing `registerWebviewView(panelId, panel as unknown as WebviewView)` pattern
- Pass `panelId` to `generateAngularWebviewContent()` via options object
- `onDidDispose` callback: removes panel from `_panels` Map, disposes event queue, logs remaining count
- Add `get panelCount(): number` accessor
- Update `postMessageDirect()` (lines 206-216) to remove `this._panel` reference - only use `this._view` since it serves sidebar-only flush
- Remove single-panel guard at line 113 (`if (this._panel) { this._panel.reveal... return; }`)

**Validation Notes**:

- `WebviewEventQueue` constructor at webview-event-queue.ts line 58 requires `Logger`. Pass `this.logger as any`.
- The DI-injected `eventQueue` (line 52) remains for SIDEBAR only. Panels get manual instances.
- `WebviewManager.registerWebviewView()` at webview-manager.ts line 169 sets up auto-cleanup on dispose (line 187-191).
- Must import `WebviewEventQueue` directly since it's in the same app, not through DI.
- `reloadWebview()` (lines 270-295) references `this._panel` - update to iterate `this._panels` values.

**Implementation Details**:

- Remove line 40: `private _panel?: vscode.WebviewPanel;`
- Add: `private readonly _panels = new Map<string, vscode.WebviewPanel>();`
- Rewrite `createPanel()` method completely:
  - Generate `const panelId = \`ptah.panel.${crypto.randomUUID()}\`;`
  - Create panel via `vscode.window.createWebviewPanel(...)` (same options as existing)
  - Store: `this._panels.set(panelId, panel);`
  - Register: `this.webviewManager.registerWebviewView(panelId, panel as unknown as vscode.WebviewView);`
  - Create event queue: `const panelEventQueue = new WebviewEventQueue(this.logger as any);`
  - Setup message listener with `webviewId: panelId` and `onReady` that calls `panelEventQueue.markReady()` + flush
  - Generate HTML: `panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(panel.webview, { workspaceInfo: ..., panelId });`
  - Dispose handler: `panel.onDidDispose(() => { this._panels.delete(panelId); panelEventQueue.dispose(); this.logger.info(...); })`
- Update `postMessageDirect()`: remove `if (this._panel?.webview)` branch, keep only `this._view?.webview` branch
- Update `reloadWebview()`: iterate `this._panels.values()` instead of single `this._panel`
- Add getter: `public get panelCount(): number { return this._panels.size; }`

---

### Task 2.2: Add `panelId` to WebviewHtmlOptions and inject into `window.ptahConfig` COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-html-generator.ts`
**Spec Reference**: implementation-plan.md lines 259-301 (Component 4)
**Pattern to Follow**: Existing `WebviewHtmlOptions` at lines 9-15, `getVSCodeIntegrationScript()` at lines 410-487

**Quality Requirements**:

- Add `panelId?: string` to `WebviewHtmlOptions` interface (line 9-15)
- Add `'panelId' in options` to the discriminated union check at line 51-54
- Thread `panelId` through `_getHtmlForWebview()` to `getVSCodeIntegrationScript()`
- Inject `panelId` field into `window.ptahConfig` JavaScript object (after line 460)
- Sidebar gets `panelId: ''` (empty string when undefined), editor panels get `panelId: 'ptah.panel.{uuid}'`

**Implementation Details**:

- Update `WebviewHtmlOptions` interface:
  ```typescript
  export interface WebviewHtmlOptions {
    workspaceInfo?: Record<string, unknown>;
    initialView?: string;
    isLicensed?: boolean;
    panelId?: string;
  }
  ```
- In `generateAngularWebviewContent()` (lines 49-65): extract `panelId` from options alongside other fields:
  ```typescript
  let panelId: string | undefined;
  // In the 'new format' branch:
  panelId = (options as { panelId?: string }).panelId;
  ```
- Update `_getHtmlForWebview()` signature to accept `panelId?: string` parameter
- Update `getVSCodeIntegrationScript()` signature to accept `panelId?: string` parameter
- In `getVSCodeIntegrationScript()`, add to `window.ptahConfig` object (after `initialView` line ~460):
  ```javascript
  panelId: '${this.escapeJsString(panelId || '')}',
  ```
- Thread `panelId` through all the call chain: `generateAngularWebviewContent` -> `_getHtmlForWebview` -> `getVSCodeIntegrationScript`

---

### Task 2.3: Add `panelId` to `WebviewConfig` interface in VSCodeService COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
**Spec Reference**: implementation-plan.md lines 286-301 (Component 4 - Frontend Interface)
**Pattern to Follow**: Existing `WebviewConfig` interface at lines 7-16, default signal at lines 69-78

**Quality Requirements**:

- Add `panelId?: string` field to the `WebviewConfig` interface
- Update the default config signal value at lines 69-78 to include `panelId: ''`
- No other changes needed - config is auto-populated from `window.ptahConfig` via `initializeFromGlobals()` at line 104+114

**Implementation Details**:

- Add to `WebviewConfig` interface (after `userIconUri` at line 15):
  ```typescript
  panelId?: string;
  ```
- Update default signal value (inside lines 69-78):
  ```typescript
  panelId: '',
  ```
- The `initializeFromGlobals()` method at line 114 does `this._config.set(ptahWindow.ptahConfig)` which will automatically pick up the new `panelId` field from `window.ptahConfig` since `PtahWindow.ptahConfig` is typed as `WebviewConfig`.

---

**Batch 2 Verification**:

- AngularWebviewProvider creates multiple independent panels with unique `ptah.panel.{uuid}` IDs
- Each panel has its own WebviewEventQueue instance
- Panel disposal cleans up local Map and (auto) WebviewManager registry
- `window.ptahConfig.panelId` is populated in webview HTML for each panel
- Frontend `WebviewConfig` interface includes `panelId` field
- Sidebar still works with empty `panelId`
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 3: Frontend - localStorage Namespacing & Verification COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 (panelId must be in ptahConfig before frontend reads it)
**Commit**: 0f4af8d

### Task 3.1: Namespace localStorage key in TabManagerService COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
**Spec Reference**: implementation-plan.md lines 305-346 (Component 5)
**Pattern to Follow**: Existing `_doSaveTabState()` at lines 444-456, `loadTabState()` at lines 462-491

**Quality Requirements**:

- Add `private readonly storageKey: string` property
- In constructor, read `panelId` from `(window as any).ptahConfig?.panelId` and compute storage key
- Sidebar uses `'ptah.tabs'` (backward compatible - when panelId is empty/undefined)
- Editor panels use `'ptah.tabs.ptah.panel.{uuid}'` (namespaced by panelId)
- Replace hardcoded `'ptah.tabs'` in both `_doSaveTabState()` (line 452) and `loadTabState()` (line 464)
- Orphaned localStorage keys from closed panels are acceptable (small data, no cleanup needed)

**Validation Notes**:

- `window.ptahConfig` is injected BEFORE Angular bootstraps (verified in webview-html-generator.ts script injection)
- `TabManagerService` is `providedIn: 'root'` (line 20) - singleton per Angular app instance
- Each editor panel is a separate Angular app instance, so each gets its own TabManagerService with its own storageKey

**Implementation Details**:

- Add property after line 44 (`private _saveTimeout`):
  ```typescript
  private readonly storageKey: string;
  ```
- In constructor (line 82-90), add BEFORE `this.loadTabState()`:
  ```typescript
  const panelId = (window as any).ptahConfig?.panelId;
  this.storageKey = panelId ? `ptah.tabs.${panelId}` : 'ptah.tabs';
  ```
- In `_doSaveTabState()` (line 452): change `localStorage.setItem('ptah.tabs', JSON.stringify(state))` to `localStorage.setItem(this.storageKey, JSON.stringify(state))`
- In `loadTabState()` (line 464): change `localStorage.getItem('ptah.tabs')` to `localStorage.getItem(this.storageKey)`

---

### Task 3.2: Verify VSCodeService broadcast event handling (Verification Task) COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
**Spec Reference**: implementation-plan.md lines 64-67 (VSCodeService handles all push messages)

**Quality Requirements**:

- VERIFICATION ONLY: Confirm `setupMessageListener()` handles ALL broadcast message types without code changes
- Verify these message types are handled: `CHAT_CHUNK`, `CHAT_COMPLETE`, `CHAT_ERROR`, `PERMISSION_REQUEST`, `AGENT_SUMMARY_CHUNK`, `SESSION_STATS`, `SESSION_ID_RESOLVED`
- Each handler routes through ChatStore which uses tabId-based routing
- No code changes expected unless a gap is discovered

**Verification Checklist**:

- Line 249: `CHAT_CHUNK` handler - extracts `tabId` and `sessionId` from payload, passes to `chatStore.processStreamEvent()`
- Line 275: `CHAT_COMPLETE` handler - extracts `tabId`, passes to `chatStore.handleChatComplete()`
- Line 294: `CHAT_ERROR` handler - extracts `tabId`, passes to `chatStore.handleChatError()`
- Line 316: `PERMISSION_REQUEST` handler - routes to `chatStore.handlePermissionRequest()`
- Line 331: `AGENT_SUMMARY_CHUNK` handler - routes to `chatStore.handleAgentSummaryChunk()`
- Line 354: `SESSION_STATS` handler - routes to `chatStore.handleSessionStats()`
- Line 377: `SESSION_ID_RESOLVED` handler - extracts `tabId`, routes to `chatStore.handleSessionIdResolved()`

**Implementation Details**:

- Read the file and verify all 7 handlers exist at the expected locations
- Confirm each handler correctly passes tabId for routing
- Mark as COMPLETE after verification - no code changes required

---

### Task 3.3: Verify StreamingHandlerService tab filtering safety (Verification Task) COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`
**Spec Reference**: implementation-plan.md lines 55-58, 69-77 (StreamingHandlerService already filters by tabId)

**Quality Requirements**:

- VERIFICATION ONLY: Confirm `processStreamEvent()` correctly discards events that don't match any tab in this Angular instance
- Verify that unmatched events return `null` (safe discard)
- This is the key safety mechanism that makes broadcast safe: each Angular instance only processes events for its own tabs
- No code changes expected unless a gap is discovered

**Verification Checklist**:

- `processStreamEvent()` at line 73 routes by `tabId` first, then `sessionId` fallback
- Lines 87-88: Tab lookup by tabId: `targetTab = this.tabManager.tabs().find((t) => t.id === tabId)`
- Lines 121-126: If no matching tab found, returns `null` (event silently discarded)
- No side effects for unmatched events
- Each Angular instance has its own independent TabManagerService (its own set of tabs)

**Implementation Details**:

- Read the file and verify tab filtering logic
- Confirm unmatched events are discarded without errors or side effects
- Mark as COMPLETE after verification - no code changes required

---

**Batch 3 Verification**:

- localStorage is namespaced per panel (sidebar uses `'ptah.tabs'`, panels use `'ptah.tabs.ptah.panel.{uuid}'`)
- VSCodeService handles all 7 broadcast message types correctly (verified)
- StreamingHandlerService safely discards unmatched events for other webviews (verified)
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved

---

## Summary

### File Modification Map

| File                                                                             | Batch | Task | Action | Changes                                                       |
| -------------------------------------------------------------------------------- | ----- | ---- | ------ | ------------------------------------------------------------- |
| `libs\backend\vscode-core\src\api-wrappers\webview-manager.ts`                   | 1     | 1.1  | MODIFY | Add `broadcastMessage()` method (~20 lines)                   |
| `apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` | 1     | 1.2  | MODIFY | Replace 5x `sendMessage('ptah.main')`, update local interface |
| `apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`      | 1     | 1.3  | MODIFY | Replace 4x `sendMessage('ptah.main')`, update local interface |
| `apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`           | 2     | 2.1  | MODIFY | Replace `_panel` with `_panels` Map, multi-panel lifecycle    |
| `apps\ptah-extension-vscode\src\services\webview-html-generator.ts`              | 2     | 2.2  | MODIFY | Add `panelId` to options and `window.ptahConfig`              |
| `libs\frontend\core\src\lib\services\vscode.service.ts`                          | 2     | 2.3  | MODIFY | Add `panelId` to `WebviewConfig` interface                    |
| `libs\frontend\chat\src\lib\services\tab-manager.service.ts`                     | 3     | 3.1  | MODIFY | Namespace localStorage key with panelId                       |
| `libs\frontend\core\src\lib\services\vscode.service.ts`                          | 3     | 3.2  | VERIFY | Confirm broadcast event handling (no code changes)            |
| `libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`    | 3     | 3.3  | VERIFY | Confirm tab filtering safety (no code changes)                |

### Total: 7 files modified (5 with code changes, 2 verification-only), 0 new files
