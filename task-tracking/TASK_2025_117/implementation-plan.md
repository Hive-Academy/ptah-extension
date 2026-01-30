# Implementation Plan - TASK_2025_117: Multi-Webview Panel Support

## Architecture Overview

### Strategy: B2 - Fully Independent Angular Instances with Broadcast Push Events

Each editor panel is a fully independent Angular SPA instance. The sidebar (`ptah.main`) and every editor panel share the same Angular build. All backend push events broadcast to ALL webviews. Each frontend instance filters events using its own tabId/sessionId (already implemented in StreamingHandlerService).

### Core Principle: Minimal Changes

The existing architecture already supports multi-tab isolation at the frontend level. The backend only needs:
1. A panel registry `Map<panelId, WebviewPanel>` for lifecycle management (create/reveal/dispose)
2. A broadcast mechanism to send push events to ALL registered webviews instead of just `'ptah.main'`
3. Unique panel IDs (`ptah.panel.{uuid}`) for each editor panel
4. Pass `panelId` into `window.ptahConfig` so each Angular instance can namespace its localStorage

---

## Codebase Investigation Summary

### Current Architecture

**AngularWebviewProvider** (`apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`):
- Manages a single sidebar `WebviewView` (`this._view`) and a single editor panel (`this._panel`)
- Registers sidebar as `'ptah.main'` with WebviewManager (line 71)
- Registers panel as `'ptah.panel'` with WebviewManager (line 135)
- `createPanel()` (line 112) only allows ONE panel -- if `this._panel` exists, it reveals it
- Uses a single `WebviewEventQueue` for readiness gating

**WebviewManager** (`libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`):
- Two maps: `activeWebviews` (panels) and `activeWebviewViews` (sidebar views)
- `sendMessage(viewType, type, payload)` sends to ONE specific registered webview
- `getActiveWebviews()` returns all registered viewType keys
- Already tracks metrics per webview

**RpcMethodRegistrationService** (`apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`):
- 5 hardcoded `'ptah.main'` broadcast sites:
  - Line 151: `SESSION_ID_RESOLVED`
  - Line 209: `CHAT_CHUNK` (compaction)
  - Line 248: `SESSION_STATS`
  - Line 316: `AGENT_SUMMARY_CHUNK`
  - Line 368: `CHAT_CHUNK` (agent-start)

**ChatRpcHandlers** (`apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`):
- 4 hardcoded `'ptah.main'` broadcast sites:
  - Line 502: `CHAT_CHUNK` (streaming events)
  - Line 524: `CHAT_COMPLETE` (turn completion)
  - Line 537: `CHAT_COMPLETE` (stream end)
  - Line 573: `CHAT_ERROR`

**WebviewHtmlGenerator** (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts`):
- `getVSCodeIntegrationScript()` (line 410) injects `window.ptahConfig` with workspace info, theme, URIs
- Does NOT currently include any panel/webview identifier in ptahConfig

**StreamingHandlerService** (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`):
- `processStreamEvent()` (line 73) routes by `tabId` first, then `sessionId` fallback
- Already handles multi-tab isolation -- events for the wrong tab are simply not matched
- Broadcast approach works because unmatched events return `null` (line 123)

**TabManagerService** (`libs/frontend/chat/src/lib/services/tab-manager.service.ts`):
- Uses `localStorage.setItem('ptah.tabs', ...)` (line 452) -- single key, not namespaced
- All Angular instances sharing localStorage would collide without namespacing

**VSCodeService** (`libs/frontend/core/src/lib/services/vscode.service.ts`):
- Reads `window.ptahConfig` in constructor (line 104)
- Routes incoming messages (CHAT_CHUNK, CHAT_COMPLETE, etc.) to ChatStore
- Already handles all push message types -- each Angular instance processes independently

### Verified Frontend Event Filtering

StreamingHandlerService already filters by tabId (line 87-88):
```typescript
if (tabId) {
  targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
}
```
If no matching tab is found, event is discarded (line 121-126). This means broadcasting to all webviews is safe -- only the webview with the matching tab processes the event.

---

## Component Specifications

### Component 1: Broadcast Support in WebviewManager

**Purpose**: Add a `broadcastMessage()` method that sends a message to ALL registered webviews (both sidebar views and editor panels).

**Pattern**: Extension of existing WebviewManager (verified at `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`)

**Specification**:
```typescript
// Add to WebviewManager class (line ~300)
async broadcastMessage<T extends StrictMessageType>(
  type: T,
  payload: any
): Promise<void> {
  const promises: Promise<boolean>[] = [];

  // Send to all panels
  for (const [viewType] of this.activeWebviews) {
    promises.push(this.sendMessage(viewType, type, payload));
  }

  // Send to all sidebar views
  for (const [viewType, view] of this.activeWebviewViews) {
    try {
      await view.webview.postMessage({ type, payload });
    } catch (error) {
      this.logger.warn(`[WebviewManager] Broadcast failed for ${viewType}`,
        error instanceof Error ? error : new Error(String(error)));
    }
  }

  await Promise.allSettled(promises);
}
```

**Quality Requirements**:
- Must not throw if any individual webview fails (use `Promise.allSettled`)
- Log failures as warnings, not errors (webview may have been disposed between check and send)
- Must include both panels (`activeWebviews`) and views (`activeWebviewViews`)

**Files Affected**:
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` (MODIFY)

---

### Component 2: Replace Hardcoded `'ptah.main'` with Broadcast

**Purpose**: Change all 9 push event sites from `sendMessage('ptah.main', ...)` to `broadcastMessage(...)`.

**Pattern**: Direct replacement -- same arguments except remove the viewType parameter.

**Sites in RpcMethodRegistrationService** (5 sites):

| Line | Event Type | Current | New |
|------|-----------|---------|-----|
| 151 | SESSION_ID_RESOLVED | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 209 | CHAT_CHUNK (compaction) | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 248 | SESSION_STATS | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 316 | AGENT_SUMMARY_CHUNK | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 368 | CHAT_CHUNK (agent-start) | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |

**Sites in ChatRpcHandlers** (4 sites):

| Line | Event Type | Current | New |
|------|-----------|---------|-----|
| 502 | CHAT_CHUNK (streaming) | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 524 | CHAT_COMPLETE | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 537 | CHAT_COMPLETE (fallback) | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |
| 573 | CHAT_ERROR | `sendMessage('ptah.main', ...)` | `broadcastMessage(...)` |

**Quality Requirements**:
- The `WebviewManager` interface used locally in both files (line 50-52 in rpc-method-registration.service.ts, line 42-44 in chat-rpc.handlers.ts) must be updated to include `broadcastMessage`
- No change to payload structure -- events already include `tabId` and `sessionId`

**Files Affected**:
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (MODIFY)

---

### Component 3: Multi-Panel Support in AngularWebviewProvider

**Purpose**: Replace single `this._panel` with a `Map<string, WebviewPanel>` panel registry. Generate unique panel IDs. Support creating multiple independent editor panels.

**Pattern**: Based on existing `createPanel()` method (line 112-164 in angular-webview.provider.ts)

**Specification**:

```typescript
// Replace:
//   private _panel?: vscode.WebviewPanel;
// With:
private readonly _panels = new Map<string, vscode.WebviewPanel>();

// Replace createPanel() with:
public async createPanel(): Promise<void> {
  const panelId = `ptah.panel.${crypto.randomUUID()}`;

  const panel = vscode.window.createWebviewPanel(
    'ptah-angular-spa',
    'Ptah - Claude Code Assistant',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'browser'),
        vscode.Uri.joinPath(this.context.extensionUri, 'assets'),
        this.context.extensionUri,
      ],
    }
  );

  // Track in local registry
  this._panels.set(panelId, panel);

  // Register with WebviewManager (for broadcast)
  this.webviewManager.registerWebviewView(
    panelId,
    panel as unknown as vscode.WebviewView
  );

  // Per-panel event queue for readiness gating
  const panelEventQueue = new WebviewEventQueue(this.logger as any);

  // Setup message handling
  this.messageHandler.setupMessageListener(
    {
      webviewId: panelId,
      webview: panel.webview,
      onReady: () => {
        this.logger.info(`Panel ${panelId} webview ready`);
        panelEventQueue.markReady();
        panelEventQueue.flush((event) => panel.webview.postMessage(event));
      },
    },
    this._disposables
  );

  // Generate HTML with panelId in ptahConfig
  panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
    panel.webview,
    {
      workspaceInfo: this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>,
      panelId,  // NEW: pass panelId to frontend
    }
  );

  // Cleanup on dispose
  panel.onDidDispose(() => {
    this._panels.delete(panelId);
    panelEventQueue.dispose();
    this.logger.info(`Panel ${panelId} disposed, ${this._panels.size} panels remaining`);
  }, undefined, this._disposables);
}
```

**Additional Methods**:
```typescript
/** Get count of active panels */
public get panelCount(): number {
  return this._panels.size;
}
```

**Quality Requirements**:
- Each panel gets a unique ID via `crypto.randomUUID()`
- Each panel has its own event queue (readiness is per-panel)
- Dispose removes panel from registry AND from WebviewManager
- No limit on panel count (resource-bounded by VS Code)
- The existing `postMessageDirect()` method that sends to `this._panel` OR `this._view` is used for the sidebar's event queue flush only. Panel event queues flush directly via their own closure.

**Files Affected**:
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` (MODIFY)

---

### Component 4: Pass panelId Through WebviewHtmlGenerator

**Purpose**: Include `panelId` in `window.ptahConfig` so the frontend Angular instance knows which panel it is.

**Pattern**: Extend existing `WebviewHtmlOptions` and `getVSCodeIntegrationScript()` (verified at webview-html-generator.ts lines 9-15, 410-487)

**Specification**:

Add `panelId` to the options interface:
```typescript
export interface WebviewHtmlOptions {
  workspaceInfo?: Record<string, unknown>;
  initialView?: string;
  isLicensed?: boolean;
  panelId?: string;  // NEW: unique panel identifier for multi-webview
}
```

Inject into `window.ptahConfig`:
```typescript
window.ptahConfig = {
  // ...existing fields...
  panelId: '${panelId || ''}',  // Empty string for sidebar
};
```

**Frontend Interface Update**:
Add `panelId` to `WebviewConfig` in VSCodeService:
```typescript
export interface WebviewConfig {
  // ...existing fields...
  panelId?: string;
}
```

**Quality Requirements**:
- Sidebar webview gets `panelId: ''` (empty string / undefined)
- Editor panels get `panelId: 'ptah.panel.{uuid}'`
- Frontend reads this value to namespace localStorage

**Files Affected**:
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` (MODIFY)
- `libs/frontend/core/src/lib/services/vscode.service.ts` (MODIFY -- add panelId to WebviewConfig)

---

### Component 5: Namespace localStorage by panelId

**Purpose**: Prevent localStorage collisions between multiple Angular instances by prefixing the storage key with the panel's unique identifier.

**Pattern**: Modify existing `saveTabState()` / `loadTabState()` in TabManagerService (verified at tab-manager.service.ts lines 428-491)

**Specification**:

```typescript
// In TabManagerService constructor or init:
private readonly storageKey: string;

constructor() {
  // Read panelId from ptahConfig
  const panelId = (window as any).ptahConfig?.panelId;
  this.storageKey = panelId ? `ptah.tabs.${panelId}` : 'ptah.tabs';

  this.loadTabState();
  if (this._tabs().length === 0) {
    this.createTab('New Chat');
  }
}

// Replace hardcoded 'ptah.tabs':
private _doSaveTabState(): void {
  localStorage.setItem(this.storageKey, JSON.stringify(state));
}

loadTabState(): void {
  const stored = localStorage.getItem(this.storageKey);
  // ...existing logic...
}
```

**Quality Requirements**:
- Sidebar continues using `'ptah.tabs'` (backward compatible)
- Each editor panel uses `'ptah.tabs.ptah.panel.{uuid}'`
- Panel localStorage is orphaned on panel close (acceptable -- small data, cleared on next VS Code restart or by user)

**Files Affected**:
- `libs/frontend/chat/src/lib/services/tab-manager.service.ts` (MODIFY)

---

## Integration Architecture

### Event Flow (Broadcast)

```
SDK generates event (CHAT_CHUNK, etc.)
  |
  v
ChatRpcHandlers / RpcMethodRegistrationService
  |
  v
webviewManager.broadcastMessage(type, payload)
  |
  +---> Sidebar (ptah.main) webview.postMessage()
  +---> Panel 1 (ptah.panel.abc123) webview.postMessage()
  +---> Panel 2 (ptah.panel.def456) webview.postMessage()
  |
  v  (each Angular instance independently)
VSCodeService.setupMessageListener()
  |
  v
ChatStore.processStreamEvent(event, tabId, sessionId)
  |
  v
StreamingHandlerService.processStreamEvent()
  |
  v
Tab lookup by tabId -> only matching tab processes event
  (other instances discard event silently)
```

### RPC Flow (Point-to-Point, No Change)

RPC requests/responses are already per-webview:
```
Angular Instance -> webview.postMessage({type: 'rpc:call', ...})
  |
  v
WebviewMessageHandlerService.handleRpcMessage()
  |
  v
RpcHandler.handleMessage()
  |
  v
Response -> same webview.postMessage({type: 'rpc:response', ...})
```
No change needed -- RPC responses flow back on the same webview channel they came from.

### Panel Lifecycle

```
User clicks "Open in Editor Panel" command
  |
  v
AngularWebviewProvider.createPanel()
  |
  +-- Generate panelId: ptah.panel.{uuid}
  +-- Create vscode.WebviewPanel
  +-- Register in this._panels Map
  +-- Register with WebviewManager (for broadcast)
  +-- Create per-panel WebviewEventQueue
  +-- Generate HTML with panelId in ptahConfig
  +-- Setup message listener via WebviewMessageHandlerService
  |
  v
Panel is ready -- receives broadcast events
  |
  v
User closes panel (X button or close command)
  |
  v
panel.onDidDispose()
  |
  +-- Remove from this._panels Map
  +-- Dispose per-panel WebviewEventQueue
  +-- WebviewManager auto-removes via its own dispose listener
```

---

## File Inventory

### Backend (5 files modified, 0 new files)

| File | Action | Changes |
|------|--------|---------|
| `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` | MODIFY | Add `broadcastMessage()` method (~20 lines) |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` | MODIFY | Replace 5x `sendMessage('ptah.main', ...)` with `broadcastMessage(...)`. Update local WebviewManager interface. |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | MODIFY | Replace 4x `sendMessage('ptah.main', ...)` with `broadcastMessage(...)`. Update local WebviewManager interface. |
| `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` | MODIFY | Replace `_panel` with `_panels` Map, generate unique panelId, per-panel event queue, pass panelId to HTML generator |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` | MODIFY | Add `panelId` to options and inject into `window.ptahConfig` |

### Frontend (2 files modified, 0 new files)

| File | Action | Changes |
|------|--------|---------|
| `libs/frontend/core/src/lib/services/vscode.service.ts` | MODIFY | Add `panelId` to `WebviewConfig` interface |
| `libs/frontend/chat/src/lib/services/tab-manager.service.ts` | MODIFY | Namespace localStorage key with panelId |

### Total: 7 files modified, 0 new files

---

## Risk Assessment

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Broadcast overhead (events sent to 2-4 webviews) | Negligible -- events are small JSON payloads (text deltas). Even at 100 events/sec, the overhead of 3 extra postMessage calls is under 1ms | StreamingHandlerService already discards unmatched events in O(1) tab lookup |
| localStorage orphaning on panel close | Minimal -- each panel's tab state is a few KB. Accumulates slowly. | Could add cleanup on extension deactivate, but not strictly necessary |
| WebviewEventQueue is currently singleton | Medium -- shared queue between sidebar and panels would cause readiness gating issues | Solution: create per-panel queue instances (not from DI), dispose on panel close |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Panel registration in WebviewManager uses `registerWebviewView()` which expects `WebviewView`, not `WebviewPanel` | Breaking type cast | Current code already does `panel as unknown as vscode.WebviewView` (line 136). Consider adding a `registerWebviewPanel()` method or keeping the cast. |
| Existing `createPanel()` logic has single-panel guard (`if (this._panel)`) | Must be removed to allow multiple panels | Remove the guard, always create new panel. Optionally add a max panel limit. |

### Addressed Non-Risks

| Concern | Why It Is Not a Risk |
|---------|-------------------|
| "Events go to wrong tab" | StreamingHandlerService routes by tabId (line 87). Each Angular instance has its own tab set. Events for tabs not in this instance are silently discarded. |
| "RPC responses go to wrong webview" | RPC responses are sent back on the same `webview.postMessage` channel that received the request. Point-to-point, no broadcast. |
| "Permission prompts appear in all panels" | Permission requests are sent via `CHAT_CHUNK` with sessionId. StreamingHandlerService routes to matching tab. Only the panel with the correct tab shows the permission. |
| "Frontend ChatStore/ConversationService need changes" | Zero changes. These services already work with tabId-based isolation. Multiple Angular instances = multiple independent ChatStore instances. |

---

## Performance Analysis

### Broadcast Overhead

**Current**: 1 `postMessage` call per event
**After**: N `postMessage` calls per event (N = sidebar + panel count, typically 2-4)

**Cost per extra postMessage**: ~0.01ms (structured clone of small JSON object)
**Typical streaming rate**: 10-50 events/second during active generation
**Worst case overhead**: 50 events/sec * 3 extra calls * 0.01ms = 1.5ms/sec additional CPU

**Verdict**: Negligible. VS Code's webview postMessage is highly optimized.

### Memory

**Per additional panel**: ~15-20MB (full Angular SPA instance)
**Panel registry overhead**: ~100 bytes per entry in Map

**Verdict**: Acceptable. Users will not open more than 2-3 panels. VS Code itself uses ~50MB per editor tab.

### localStorage

**Per panel tab state**: ~2-10KB (depends on tab count and message count)
**Orphan rate**: One entry per panel session (cleaned on extension restart)

**Verdict**: Negligible.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both backend-developer and frontend-developer (or a single full-stack developer)

**Rationale**:
- Backend: WebviewManager.broadcastMessage(), AngularWebviewProvider panel registry, broadcast replacement
- Frontend: TabManagerService localStorage namespace, VSCodeService WebviewConfig update

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

### Suggested Task Breakdown

1. **Add `broadcastMessage()` to WebviewManager** (~30 min)
2. **Replace 9x hardcoded `'ptah.main'` with broadcast** (~45 min)
3. **Multi-panel registry in AngularWebviewProvider** (~1.5 hours)
4. **Pass `panelId` through WebviewHtmlGenerator to ptahConfig** (~30 min)
5. **Frontend: Add panelId to WebviewConfig** (~15 min)
6. **Frontend: Namespace localStorage in TabManagerService** (~30 min)
7. **Integration testing: Create multiple panels, verify broadcast** (~1 hour)

### Critical Verification Points

**Before implementation, developer must verify**:

1. **`crypto.randomUUID()` availability**: Available in Node.js 19+ and all modern browsers. VS Code extension host runs Node.js 20+. Verified.

2. **`WebviewManager.registerWebviewView()` cast**: Current code at angular-webview.provider.ts:136 already casts `panel as unknown as WebviewView`. Consider adding a proper `registerWebviewPanel()` method to avoid unsafe cast.

3. **Per-panel WebviewEventQueue**: Cannot use DI singleton. Must instantiate manually per panel with `new WebviewEventQueue(logger)`. The Logger DI token must be passed through.

4. **`broadcastMessage` interface**: The local `WebviewManager` interface in rpc-method-registration.service.ts (line 50-52) and chat-rpc.handlers.ts (line 42-44) must add `broadcastMessage` to their type declarations.

### Architecture Delivery Checklist

- [x] All components specified with evidence (file:line citations throughout)
- [x] All patterns verified from codebase (existing WebviewManager, AngularWebviewProvider patterns)
- [x] All imports/decorators verified as existing (TOKENS, injectable, WebviewManager, etc.)
- [x] Quality requirements defined (broadcast resilience, per-panel cleanup, localStorage namespace)
- [x] Integration points documented (event flow, RPC flow, panel lifecycle)
- [x] Files affected list complete (7 files, 0 new)
- [x] Developer type recommended (both backend + frontend)
- [x] Complexity assessed (MEDIUM, 4-6 hours)
- [x] No step-by-step implementation (architecture specification only)
- [x] No over-engineering: no WebviewRegistry routing, no session-to-webview mapping, no RPC context propagation
