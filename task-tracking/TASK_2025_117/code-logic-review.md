# Code Logic Review - TASK_2025_117: Multi-Webview Panel Support

## Review Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall Score       | 7/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Critical Issues     | 2                                    |
| Serious Issues      | 3                                    |
| Moderate Issues     | 4                                    |
| Failure Modes Found | 8                                    |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Silent broadcast failure during panel disposal.** The `broadcastMessage()` method in `webview-manager.ts` (line 314-340) iterates `this.activeWebviews` and `this.activeWebviewViews`. If a panel is disposed between the start of iteration and the actual `postMessage()` call, `sendMessage()` logs an error and returns `false`, but `Promise.allSettled()` swallows this. The broadcast "succeeds" (no throw) but events are silently lost for that panel. This is acceptable for disposed panels but there is no metric or counter tracking how many broadcasts partially fail, making debugging production issues harder.

**Silent sidebar view broadcast bypasses sendMessage safety.** For sidebar views, `broadcastMessage()` calls `view.webview.postMessage()` directly with a try/catch (lines 327-335). However, if `view.webview` is `undefined` (e.g., the view was disposed but not yet removed from the map due to a race), this will throw a TypeError caught silently as a warning. The warning log does not distinguish between "view was recently disposed" (expected) and "view object is corrupted" (unexpected).

**Panel event queue overflow with no user notification.** `WebviewEventQueue` has a max size of 100. If a panel's webview takes longer than expected to initialize while the backend is broadcasting high-frequency streaming events, older events are silently dropped (FIFO). The user would see a chat session that appears to start mid-stream with missing initial events.

### 2. What user action causes unexpected behavior?

**Rapid panel creation.** If a user triggers `ptah.openFullPanel` multiple times in quick succession (e.g., double-clicking a command), multiple panels are created simultaneously. Each call to `createPanel()` runs `crypto.randomUUID()` independently, so no ID collision occurs. However, all panels share the same `this._disposables` array (line 157 in `angular-webview.provider.ts`). The `onDidDispose` handlers for ALL panels push to this shared array. When `AngularWebviewProvider.dispose()` runs, it calls `this._disposables.forEach(d => d.dispose())` which would attempt to re-dispose already-disposed panels. The `vscode.Disposable` contract typically handles double-dispose safely, but this is fragile.

**Closing a panel while it is streaming.** If the user closes an editor panel tab while an AI response is streaming, the panel's `onDidDispose` handler removes it from `this._panels` and calls `panelEventQueue.dispose()`. However, the backend `streamExecutionNodesToWebview()` loop continues running, broadcasting `CHAT_CHUNK` events. These events reach `broadcastMessage()` which tries to send to the now-removed panel. For `activeWebviewViews` (where panels are registered), the `registerWebviewView()` dispose handler at line 187-191 of `webview-manager.ts` deletes the entry, so the broadcast loop skips it. This is correct, but there is a timing gap between the broadcast loop reading the map and the dispose removing the entry.

### 3. What data makes this produce wrong results?

**Empty string panelId vs undefined panelId ambiguity.** The sidebar gets `panelId: ''` (empty string) and editor panels get `panelId: 'ptah.panel.{uuid}'`. In `tab-manager.service.ts` (line 96), the check is `panelId ? ... : 'ptah.tabs'`. This works because empty string is falsy. However, `WebviewConfig.panelId` is typed as `string | undefined` (optional), meaning `undefined` also goes to `'ptah.tabs'`. If for any reason a panel's `window.ptahConfig` fails to include `panelId`, it would silently fall back to the sidebar's storage key, causing localStorage collision. This is an edge case but worth noting as a data integrity risk.

**Malformed ptahConfig injection.** In `webview-html-generator.ts` (line 471), `panelId` is injected as:
```javascript
panelId: '${this.escapeJsString(panelId || '')}'
```
If `panelId` somehow contained a single quote followed by a script tag, `escapeJsString()` should handle it (it escapes single quotes at line 562). This appears safe. However, `panelId` is constructed from `crypto.randomUUID()` which produces hex + hyphens, so XSS risk is negligible. No issue here.

### 4. What happens when dependencies fail?

**WebviewEventQueue constructor failure.** In `angular-webview.provider.ts` (line 143), per-panel event queues are created with `new WebviewEventQueue(this.logger as any)`. The `as any` cast bypasses type checking. If `WebviewEventQueue` constructor changes to require additional constructor arguments (e.g., from a DI refactor), this would silently create a broken queue. The `as any` cast is documented as a known risk in the plan.

**registerWebviewView type cast.** At line 137-139, `panel as unknown as vscode.WebviewView` is used. `WebviewPanel` and `WebviewView` share a `.webview` property, but `WebviewView` also has `.visible` and `onDidChangeVisibility()`. The `registerWebviewView()` method at line 182 sets up `view.onDidChangeVisibility()` -- calling this on a cast `WebviewPanel` could work because `WebviewPanel` has `onDidChangeViewState` but NOT `onDidChangeVisibility`. This means the visibility tracking for panels registered this way SILENTLY FAILS -- the callback is registered on a method that does not exist on the actual panel, resulting in a silent no-op (or a runtime error that is swallowed). This is a pre-existing issue but TASK_2025_117 amplifies it by registering MANY panels through this path.

### 5. What's missing that the requirements didn't mention?

**No maximum panel count limit.** The implementation allows unlimited panels. While the plan states "No limit on panel count (resource-bounded by VS Code)", each panel is a full Angular SPA instance consuming 15-20MB. A user could accidentally or intentionally open dozens of panels, causing memory exhaustion. VS Code itself does not limit WebviewPanel creation.

**No panel lifecycle events or telemetry.** The implementation logs panel creation and disposal but does not emit events via EventBus or any telemetry system. This means there is no way for other services to react to panel creation (e.g., to show a "you have 5 panels open" warning).

**No mechanism to find/focus an existing panel.** If a user wants to find a specific panel, there is no command or UI affordance to list or focus panels by their content. The `_panels` Map uses UUIDs that are opaque to the user.

**Orphaned localStorage is never cleaned.** As acknowledged in the plan, `ptah.tabs.ptah.panel.{uuid}` entries accumulate in localStorage. There is no cleanup mechanism on extension activation or deactivation. Over months of usage, this could accumulate hundreds of orphaned entries.

---

## Failure Mode Analysis

### Failure Mode 1: Panel disposal during active broadcast iteration

- **Trigger**: User closes an editor panel while a streaming response is in progress
- **Symptoms**: `broadcastMessage()` attempts to post to a disposed panel. `sendMessage()` logs an error (line 222-228 of `webview-manager.ts`) and returns `false`. `Promise.allSettled()` absorbs the failure.
- **Impact**: LOW -- Events are correctly lost for the disposed panel. Other panels continue receiving. The error log may be noisy during normal operation.
- **Current Handling**: `Promise.allSettled()` absorbs individual failures. `onDidDispose` handler removes panel from maps.
- **Recommendation**: Consider checking `activeWebviews.has(viewType)` before each `sendMessage` call in the broadcast loop, or accept the brief race window and suppress the CRITICAL log to WARN for broadcast scenarios.

### Failure Mode 2: WebviewView.onDidChangeVisibility on a cast WebviewPanel

- **Trigger**: Every panel registered via `registerWebviewView()` at `angular-webview.provider.ts` line 137
- **Symptoms**: `webview-manager.ts` line 182-184 calls `view.onDidChangeVisibility()` on what is actually a `WebviewPanel`. `WebviewPanel` does NOT have `onDidChangeVisibility` -- it has `onDidChangeViewState`. Depending on VS Code's runtime behavior, this either silently fails (undefined function not called) or registers nothing.
- **Impact**: MEDIUM -- Visibility tracking metrics for panels are broken. `webviewMetrics.isVisible` never updates for editor panels. This affects any future features that gate behavior on visibility.
- **Current Handling**: None -- the cast silently breaks the visibility tracking contract.
- **Recommendation**: Either (a) add a `registerWebviewPanel()` method that correctly uses `onDidChangeViewState`, or (b) document this limitation explicitly and ensure no code relies on visibility metrics for editor panels.

### Failure Mode 3: Panel closure before webview ready signal

- **Trigger**: User opens a panel and immediately closes it before Angular bootstraps and sends the `WEBVIEW_READY` message
- **Symptoms**: `panelEventQueue` is created and events may start queuing. `onDidDispose` fires, calling `panelEventQueue.dispose()` which clears the queue and sets `_isReady = false`. The `onReady` callback (line 151-155) captures `panelEventQueue` and `panel` in a closure. If the panel is already disposed when `onReady` fires (race condition), `panel.webview.postMessage(event)` will throw.
- **Impact**: LOW -- The panel is already being cleaned up. The throw is caught by VS Code's message handler infrastructure. No user-facing impact.
- **Current Handling**: `panelEventQueue.dispose()` clears the queue. The closure may throw but the panel is gone.
- **Recommendation**: Add a check in the `onReady` callback: `if (this._panels.has(panelId))` before flushing, to avoid posting to a disposed panel.

### Failure Mode 4: Simultaneous broadcast to many panels under load

- **Trigger**: 10+ panels open, high-frequency streaming events (50/sec)
- **Symptoms**: `broadcastMessage()` calls `sendMessage()` for each panel sequentially for panels, and then `postMessage()` sequentially for sidebar views (lines 327-335 use `await` serially). With 10 panels, each streaming event requires 10+ `postMessage` calls. At 50 events/sec, that is 500 postMessage calls/sec.
- **Impact**: MEDIUM -- The serial `await` on sidebar views adds latency. Panel promises are collected and awaited via `Promise.allSettled()`, which is parallel. But sidebar views are processed ONE AT A TIME with `await` in a for-of loop. If there are multiple sidebar views (unlikely but possible via the `activeWebviewViews` map), this becomes sequential.
- **Current Handling**: Panels are parallel via `Promise.allSettled()`. Sidebar views are serial via `await` in a for loop.
- **Recommendation**: For consistency and performance, collect sidebar view promises and include them in `Promise.allSettled()` instead of awaiting each individually.

### Failure Mode 5: Shared _disposables array across all panels

- **Trigger**: Multiple panels created, each adding `onDidDispose` subscriptions to `this._disposables` (line 171-182 and line 147-158)
- **Symptoms**: `AngularWebviewProvider.dispose()` at line 361-384 calls `this._disposables.forEach(d => d.dispose())`. This includes dispose handlers from panels that were already individually disposed. Double-dispose of VS Code disposables is generally safe (no-op) but is not guaranteed by the API contract.
- **Impact**: LOW -- VS Code disposables typically handle double-dispose gracefully. But this accumulates disposed entries in the array, causing unnecessary iteration during provider dispose.
- **Current Handling**: No cleanup of `_disposables` when individual panels dispose.
- **Recommendation**: Consider using a per-panel disposables array, or filtering disposed entries from `_disposables` on panel disposal.

### Failure Mode 6: broadcastMessage sidebar loop awaits sequentially before allSettled

- **Trigger**: Normal operation with panels and sidebar views active
- **Symptoms**: In `broadcastMessage()` (lines 318-340), panel promises are collected first (lines 321-324), then sidebar views are awaited one by one (lines 327-335), and ONLY THEN are panel promises awaited via `allSettled` (line 339). This means if a sidebar view `postMessage` hangs (e.g., webview is unresponsive), ALL panel messages are delayed because `Promise.allSettled(panelPromises)` runs AFTER the sidebar loop.
- **Impact**: MEDIUM -- A hung sidebar view blocks event delivery to all panels. In practice, `postMessage` rarely hangs, but a disposed/corrupted webview could cause a delay.
- **Current Handling**: Sequential await on sidebar views.
- **Recommendation**: Collect all promises (both panel and sidebar) and await them together via `Promise.allSettled()`.

### Failure Mode 7: Tab state loads from wrong localStorage key

- **Trigger**: `window.ptahConfig` fails to load or is delayed, causing `panelId` to be `undefined`
- **Symptoms**: `TabManagerService` constructor (line 95) reads `(window as any).ptahConfig?.panelId`. If `ptahConfig` is not yet set when the Angular app bootstraps (race between script injection and Angular bootstrap), `panelId` is `undefined`, and `storageKey` becomes `'ptah.tabs'` -- the SIDEBAR key. The editor panel would load the sidebar's tab state instead of starting fresh.
- **Impact**: MEDIUM -- The panel would show stale sidebar tabs. User confusion but no data loss.
- **Current Handling**: The plan verifies that `window.ptahConfig` is injected BEFORE Angular bootstraps (via script tag in HTML head). This should be reliable.
- **Recommendation**: Add a defensive check: if `panelId` is `undefined` but the webview is known to be a panel (e.g., check `window.ptahConfig?.isPanel` or a similar flag), log a warning.

### Failure Mode 8: stale `sendMessage` reference in broadcastMessage return type mismatch

- **Trigger**: `broadcastMessage` returns `Promise<void>` but the local interfaces in `rpc-method-registration.service.ts` (line 52) and `chat-rpc.handlers.ts` (line 44) declare it as `broadcastMessage(type: string, payload: unknown): Promise<void>`.
- **Symptoms**: The actual `WebviewManager.broadcastMessage` is typed as `<T extends StrictMessageType>(type: T, payload: any): Promise<void>`. The local interfaces use `string` instead of `StrictMessageType`. This means the local interfaces are LESS strict than the actual implementation. A caller could pass a non-message-type string through the local interface that would be rejected by TypeScript only at the WebviewManager level (if generic constraints are enforced).
- **Impact**: LOW -- TypeScript generics with `extends` still accept `string` at call sites because `string` satisfies `extends StrictMessageType` in practice (StrictMessageType is likely a string union). No runtime impact, but type safety is weaker than intended.
- **Current Handling**: The local interfaces use `string` type.
- **Recommendation**: Update local interfaces to use `StrictMessageType` for full type safety. This is a minor typesafety improvement.

---

## Critical Issues

### Issue 1: broadcastMessage processes sidebar views SEQUENTIALLY, delaying panel delivery

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\webview-manager.ts`, lines 326-339
- **Scenario**: When broadcasting, sidebar views are awaited one by one in a for-of loop BEFORE `Promise.allSettled(panelPromises)` is called. If a sidebar view's `postMessage` is slow or hangs, ALL panel broadcasts are delayed.
- **Impact**: Under normal conditions, this adds minimal latency. But if a sidebar view becomes unresponsive (e.g., hidden VS Code sidebar, memory pressure), panel event delivery stalls. During streaming, this causes visible stuttering in all editor panels.
- **Evidence**:
```typescript
// Lines 326-339 in webview-manager.ts
// Sidebar views awaited SEQUENTIALLY:
for (const [viewType, view] of this.activeWebviewViews) {
  try {
    await view.webview.postMessage({ type, payload }); // BLOCKING
  } catch (error) { ... }
}

// Panel promises awaited ONLY AFTER sidebar loop:
await Promise.allSettled(panelPromises); // DELAYED
```
- **Fix**: Collect sidebar view promises into an array and include them in `Promise.allSettled()`:
```typescript
const allPromises: Promise<any>[] = [...panelPromises];
for (const [viewType, view] of this.activeWebviewViews) {
  allPromises.push(
    view.webview.postMessage({ type, payload }).catch((error) => {
      this.logger.warn(`Broadcast failed for view ${viewType}`, ...);
    })
  );
}
await Promise.allSettled(allPromises);
```

### Issue 2: registerWebviewView cast breaks onDidChangeVisibility for panels

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\webview-manager.ts`, lines 169-198 (registerWebviewView) + `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`, lines 137-140
- **Scenario**: Editor panels are registered via `registerWebviewView(panelId, panel as unknown as vscode.WebviewView)`. Inside `registerWebviewView()`, line 182-184 calls `view.onDidChangeVisibility()`. `WebviewPanel` does NOT have this method. `WebviewPanel` has `onDidChangeViewState` instead.
- **Impact**: Panel visibility tracking silently fails. `webviewMetrics.isVisible` is never updated for panels. If any future logic depends on visibility (e.g., pause broadcasts to hidden panels for performance), it will be broken.
- **Evidence**:
```typescript
// angular-webview.provider.ts:137-139
this.webviewManager.registerWebviewView(
  panelId,
  panel as unknown as vscode.WebviewView // UNSAFE CAST
);

// webview-manager.ts:182-184
view.onDidChangeVisibility(() => {  // WebviewPanel does NOT have this!
  this.updateWebviewVisibility(viewType, view.visible);
});
```
- **Fix**: Add a `registerWebviewPanel()` method to `WebviewManager` that correctly handles `WebviewPanel` lifecycle including `onDidChangeViewState`. OR at minimum, add a runtime check:
```typescript
if (typeof view.onDidChangeVisibility === 'function') {
  view.onDidChangeVisibility(() => { ... });
}
```

---

## Serious Issues

### Issue 3: Shared _disposables array accumulates stale entries

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`, lines 157, 171-182
- **Scenario**: Every call to `createPanel()` adds message listener disposables (line 157) and `onDidDispose` subscriptions (line 171-182) to `this._disposables`. When panels dispose individually, their entries remain in the array. The `dispose()` method at line 361-384 iterates ALL entries including stale ones.
- **Impact**: No functional breakage (double-dispose is safe), but the array grows monotonically over the extension session lifetime. With many panel create/dispose cycles, this wastes memory and adds unnecessary iteration.
- **Fix**: Use per-panel disposable arrays: `const panelDisposables: vscode.Disposable[] = []` scoped to each `createPanel()` call, and clean them up in `onDidDispose`.

### Issue 4: Panel event queue flush closure captures disposed panel

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`, lines 151-155
- **Scenario**: The `onReady` callback captures `panel` and `panelEventQueue` in a closure. If the panel is disposed before the webview sends `WEBVIEW_READY`, the `onReady` callback could still fire (because the message listener was registered before disposal). The flush would try `panel.webview.postMessage(event)` on a disposed panel.
- **Impact**: Runtime error thrown inside the message handler. Not user-visible but pollutes logs.
- **Evidence**:
```typescript
onReady: () => {
  this.logger.info(`Panel ${panelId} webview ready`);
  panelEventQueue.markReady();
  panelEventQueue.flush((event) => panel.webview.postMessage(event)); // panel may be disposed
},
```
- **Fix**: Guard with: `if (this._panels.has(panelId)) { panelEventQueue.flush(...); }`

### Issue 5: No guard against event queue operations on disposed queue

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-event-queue.ts`
- **Scenario**: After `dispose()` is called (line 220-224), `_isReady` is set to `false` and `_queue` is cleared. However, nothing prevents subsequent calls to `enqueue()` or `flush()`. If a broadcast arrives after disposal but before the panel is removed from the WebviewManager map, `enqueue()` would add to the dead queue.
- **Impact**: LOW -- The enqueued events go nowhere and the queue object will be garbage collected. But it is a defensive programming gap.
- **Fix**: Add a `_disposed` flag and check it in `enqueue()`, `flush()`, `markReady()`.

---

## Moderate Issues

### Issue 6: broadcastMessage return type inconsistency

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\api-wrappers\webview-manager.ts`, line 318
- **Scenario**: `broadcastMessage()` returns `Promise<void>`. The callers in `rpc-method-registration.service.ts` and `chat-rpc.handlers.ts` call it with `.catch()` or `await`. But `broadcastMessage` internally uses `Promise.allSettled()` which never rejects. So the `.catch()` handlers on the caller side are dead code -- they will never trigger.
- **Impact**: LOW -- Dead code gives false sense of error handling. If `broadcastMessage` is later changed to throw, the catch handlers would work. Currently, errors are logged inside `broadcastMessage` but never propagate to callers.
- **Fix**: Document that `broadcastMessage` never throws (by design). OR change to `Promise.all()` if caller error handling is desired.

### Issue 7: localStorage orphan accumulation

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts`
- **Scenario**: Each editor panel creates a localStorage key `ptah.tabs.ptah.panel.{uuid}`. When the panel closes, the key remains. Over time, dozens or hundreds of orphaned entries accumulate.
- **Impact**: LOW -- Each entry is 2-10KB. After months of heavy use, this could reach a few MB. localStorage quota is typically 5-10MB per origin, so extreme usage could theoretically hit the limit.
- **Fix**: Consider adding cleanup in `AngularWebviewProvider.dispose()` or on extension activation that scans for `ptah.tabs.ptah.panel.*` keys and removes ones that don't correspond to active panels.

### Issue 8: _panelEventQueues Map maintained separately from _panels Map

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`, lines 40-41
- **Scenario**: Two separate Maps (`_panels` and `_panelEventQueues`) track panel state. They must be kept in sync manually. In `onDidDispose` (line 172-175), both maps are cleaned up. But if an error occurs between `_panels.delete` (line 173) and `_panelEventQueues.delete` (line 175), the queue map leaks.
- **Impact**: LOW -- An unhandled error between two delete calls is extremely unlikely in synchronous code. Both deletes are in the same synchronous block.
- **Fix**: Consider using a single Map with a composite value `{ panel, eventQueue }` to ensure atomic cleanup.

### Issue 9: No fallback panelId generation in webview-html-generator

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-html-generator.ts`, line 471
- **Scenario**: If `panelId` is `undefined` (which is the case for sidebar), the injected value is `''`. This is correct. But if a caller passes `null` instead of `undefined`, `panelId || ''` evaluates to `''`, which is correct. No issue, but worth noting the `||` operator correctly handles null, undefined, and empty string.
- **Impact**: None -- the implementation is correct.

---

## Data Flow Analysis

```
SDK streaming event generated
    |
    v
ChatRpcHandlers.streamExecutionNodesToWebview() [chat-rpc.handlers.ts:502]
    |
    v  this.webviewManager.broadcastMessage(CHAT_CHUNK, {tabId, sessionId, event})
    |
    v
WebviewManager.broadcastMessage() [webview-manager.ts:314]
    |
    +---> [PARALLEL] sendMessage(viewType, type, payload) for each activeWebviews entry
    |     |
    |     v
    |     panel.webview.postMessage({type, payload})
    |     GAP POINT: Panel may be disposed between map read and postMessage
    |
    +---> [SEQUENTIAL] view.webview.postMessage({type, payload}) for each activeWebviewViews
    |     GAP POINT: Sidebar view may be disposed; sequential await blocks panel allSettled
    |
    +---> await Promise.allSettled(panelPromises)
    |     GAP POINT: Only panel promises settled here; sidebar errors caught individually
    |
    v  (each Angular instance independently receives via window message event)
    |
VSCodeService.setupMessageListener() [vscode.service.ts:252]
    |
    v  Extract tabId, sessionId, event from payload
    |
ChatStore.processStreamEvent(event, tabId, sessionId)
    |
    v
StreamingHandlerService.processStreamEvent() [streaming-handler.service.ts:73]
    |
    v  Find targetTab by tabId (primary) or sessionId (fallback)
    |  GAP POINT: If tab not found, event is discarded (returns null) -- CORRECT for multi-webview
    |
    v  Store event in StreamingState maps; queue batched UI update
```

### Gap Points Identified:
1. Panel disposal during broadcast iteration (race between Map read and postMessage)
2. Sequential sidebar await delays panel delivery
3. Disposed panel onReady closure captures stale panel reference
4. No metric tracking for partial broadcast failures

---

## Requirements Fulfillment

| Requirement | Status | Concern |
|-------------|--------|---------|
| Sidebar keeps existing webview (`ptah.main`) | COMPLETE | No changes to `resolveWebviewView()` |
| Editor panels get independent Angular instances | COMPLETE | Each panel creates full webview with own HTML |
| Unique `panelId` per panel | COMPLETE | `crypto.randomUUID()` generates UUID v4 |
| Push events broadcast to ALL webviews | COMPLETE | `broadcastMessage()` iterates both maps |
| Frontend filters by tabId | COMPLETE (no changes needed) | `StreamingHandlerService` already filters |
| localStorage namespaced by panelId | COMPLETE | `storageKey` computed from panelId |
| Panel disposal cleans up resources | COMPLETE | `onDidDispose` removes from maps, disposes queue |
| Backward compatibility for sidebar | COMPLETE | Empty panelId falls back to `'ptah.tabs'` |
| Per-panel event queues | COMPLETE | Manually instantiated `WebviewEventQueue` per panel |
| All 9 hardcoded `'ptah.main'` sites replaced | COMPLETE | 5 in rpc-method-registration, 4 in chat-rpc-handlers |
| Both local WebviewManager interfaces updated | COMPLETE | `broadcastMessage` added to both |
| `panelId` in `window.ptahConfig` | COMPLETE | Injected via `getVSCodeIntegrationScript()` |
| `WebviewConfig` interface updated | COMPLETE | `panelId?: string` added with default `''` |

### Implicit Requirements NOT Addressed:
1. Maximum panel count limit (resource protection)
2. Panel visibility-based broadcast optimization (skip hidden panels)
3. localStorage orphan cleanup mechanism
4. Proper `registerWebviewPanel()` method in WebviewManager (avoids unsafe cast)
5. Panel focus/find/list command for user discoverability

---

## Edge Case Analysis

| Edge Case | Handled | How | Concern |
|-----------|---------|-----|---------|
| Empty panelId for sidebar | YES | Falsy check in TabManagerService (line 96) | None |
| Panel disposed during streaming | PARTIAL | onDidDispose cleans maps; broadcast may race | Timing gap between dispose and map removal |
| Multiple panels opened rapidly | YES | Each gets unique UUID, independent queue | Shared _disposables grows |
| Panel closed before ready signal | PARTIAL | onDidDispose disposes queue | onReady closure may fire after dispose |
| Network/webview failure during broadcast | YES | Promise.allSettled absorbs failures | Sequential sidebar await blocks panels |
| ptahConfig not available at constructor | YES | Optional chaining: `ptahConfig?.panelId` | Falls back to sidebar key (wrong for panel) |
| Disposed WebviewEventQueue receives events | NO | No _disposed flag check | Events queued to dead queue |
| Very long panelId in localStorage key | YES | UUID is fixed 36 chars | No concern |
| Panel reload (dev hot reload) | YES | reloadWebview() iterates _panels | Panel event queues reset correctly |

---

## Integration Risk Assessment

| Integration | Failure Probability | Impact | Mitigation |
|-------------|---------------------|--------|------------|
| WebviewPanel to WebviewView cast | HIGH (always active) | MEDIUM (broken visibility) | Pre-existing; amplified by multi-panel |
| broadcastMessage to disposed panel | MEDIUM (during disposal) | LOW (events lost for dead panel) | Promise.allSettled absorbs |
| Per-panel event queue instantiation | LOW | LOW (logger cast) | `as any` cast works for current Logger |
| localStorage key computation | LOW | MEDIUM (wrong key = data collision) | ptahConfig injection is synchronous before bootstrap |
| Frontend tabId filtering | LOW | NONE (pre-existing, verified) | StreamingHandlerService discards unmatched events |

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: `broadcastMessage()` sequential sidebar processing blocks panel delivery (Critical Issue 1) and the `WebviewPanel`-to-`WebviewView` cast breaks visibility tracking for all panels (Critical Issue 2).

The core architecture is sound. The multi-panel Map approach, per-panel event queues, panelId plumbing, localStorage namespacing, and broadcast replacement are all correctly implemented. The frontend filtering via `StreamingHandlerService` already handles multi-webview isolation without any changes, which validates the architecture choice.

However, two critical issues and three serious issues need attention before this is production-ready:

1. **Critical**: `broadcastMessage()` should process all webviews in parallel, not sidebar views sequentially followed by panels.
2. **Critical**: The `WebviewPanel`-to-`WebviewView` cast silently breaks visibility tracking. A proper `registerWebviewPanel()` method or runtime check should be added.
3. **Serious**: The `onReady` closure should guard against posting to a disposed panel.
4. **Serious**: Consider a `_disposed` flag in `WebviewEventQueue` for defensive programming.
5. **Serious**: The shared `_disposables` array accumulates stale entries from disposed panels.

## What Robust Implementation Would Include

A bulletproof implementation would additionally have:

- **registerWebviewPanel()** method in WebviewManager that correctly handles `onDidChangeViewState` instead of relying on unsafe cast
- **Parallel broadcast** for ALL webviews (panels AND sidebar views) via a single `Promise.allSettled()` call
- **Per-panel disposable arrays** instead of a shared `_disposables` list
- **Disposed guard** in WebviewEventQueue (check `_disposed` flag before enqueueing)
- **Panel count limit** (e.g., max 10 panels) with user notification
- **Broadcast failure metrics** (counter for partial failures per broadcast)
- **localStorage orphan cleanup** on extension activation
- **Panel closure guard** in onReady callback to prevent posting to disposed panels
- **Integration test** that opens 5 panels, streams events, closes 3 panels mid-stream, and verifies remaining panels receive all events correctly
