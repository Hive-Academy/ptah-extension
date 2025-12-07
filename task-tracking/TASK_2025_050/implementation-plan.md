# Implementation Plan - TASK_2025_050: Frontend SDK Integration

## Goal

Add stop button UI to chat view, expose `isStopping` signal, and wire model/autopilot changes to sync with active SDK sessions in real-time.

## Codebase Investigation Summary

### SDK Wiring Verification Results

| RPC Method                | Handler Location                       | SDK Integration                   | Status            |
| ------------------------- | -------------------------------------- | --------------------------------- | ----------------- |
| `chat:abort`              | rpc-method-registration.service.ts:220 | `sdkAdapter.interruptSession()`   | ✅ Already wired  |
| `config:model-switch`     | rpc-method-registration.service.ts:555 | ConfigManager only (no live sync) | ⚠️ Needs SDK call |
| `config:autopilot-toggle` | rpc-method-registration.service.ts:612 | ConfigManager only (no live sync) | ⚠️ Needs SDK call |

### Patterns Discovered

**Lucide-Angular Icons** (app-shell.component.ts:15, message-bubble.component.ts:15):

```typescript
import { LucideAngularModule, Square } from 'lucide-angular';
// Template: <lucide-angular [img]="SquareIcon" class="w-4 h-4" />
```

**Model Metadata** (model-autopilot.types.ts:105):

```typescript
export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  { id: 'sonnet', name: 'Sonnet 4.5', ... },
  { id: 'opus', name: 'Opus 4.5', ... },
  { id: 'haiku', name: 'Haiku 4.5', ... },
];
```

---

## Proposed Changes

### Component 1: Stop Button UI

---

#### [MODIFY] [chat.store.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat.store.ts)

**Line Range**: 128-129

**Changes**: Expose `isStopping` signal for UI consumption

**After**:

```typescript
private readonly _isStopping = signal(false);
readonly isStopping = this._isStopping.asReadonly();
```

---

#### [MODIFY] [chat-view.component.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts)

**Changes**: Import lucide-angular and Square icon

```typescript
import { LucideAngularModule, Square } from 'lucide-angular';

@Component({
  // ...
  imports: [
    // ... existing imports
    LucideAngularModule,
  ],
})
export class ChatViewComponent {
  readonly SquareIcon = Square; // Stop icon
  // ...
}
```

---

#### [MODIFY] [chat-view.component.html](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/chat-view.component.html)

**Line Range**: 1-7

**Changes**: Add stop button using lucide-angular icon

```html
<div class="flex flex-col h-full">
  <!-- Stop Button - visible only during streaming -->
  @if (chatStore.isStreaming()) {
  <div class="flex justify-end p-2 border-b border-base-300">
    <button class="btn btn-ghost btn-sm gap-1" [disabled]="chatStore.isStopping()" (click)="chatStore.abortCurrentMessage()" type="button" title="Stop generation" aria-label="Stop generation">
      @if (chatStore.isStopping()) {
      <span class="loading loading-spinner loading-xs"></span>
      Stopping... } @else {
      <lucide-angular [img]="SquareIcon" class="w-4 h-4" />
      Stop }
    </button>
  </div>
  }
</div>
```

---

### Component 2: Model API Name Mapping

> **TODO**: Future enhancement - add `apiName` field to `ModelInfo` interface in `model-autopilot.types.ts` to avoid hardcoded mapping here.

---

#### [MODIFY] [model-autopilot.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/model-autopilot.types.ts)

**Line Range**: 29-38

**Changes**: Add `apiName` field to ModelInfo interface

```typescript
export interface ModelInfo {
  /** Model identifier used for API calls (e.g., 'sonnet', 'opus', 'haiku') */
  id: Exclude<ClaudeModel, 'default'>;
  /** Display name shown in UI (e.g., 'Sonnet 4.5') */
  name: string;
  /** Short description of model capabilities */
  description: string;
  /** Whether this is the recommended/default model */
  isRecommended?: boolean;
  /** SDK API model name (e.g., 'claude-sonnet-4-20250514') */
  apiName: string;
}
```

---

#### [MODIFY] [model-autopilot.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/model-autopilot.types.ts)

**Line Range**: 105-122

**Changes**: Add `apiName` to each model entry

```typescript
export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  {
    id: 'sonnet',
    name: 'Sonnet 4.5',
    description: 'Best for everyday tasks',
    isRecommended: true,
    apiName: 'claude-sonnet-4-20250514',
  },
  {
    id: 'opus',
    name: 'Opus 4.5',
    description: 'Most capable for complex work',
    apiName: 'claude-opus-4-20250514',
  },
  {
    id: 'haiku',
    name: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    apiName: 'claude-haiku-3-20240307',
  },
] as const;
```

---

### Component 3: Live Model Sync to Active Session

---

#### [MODIFY] [rpc-method-registration.service.ts](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts)

**Line Range**: 555-586

**Changes**: Add SDK call using AVAILABLE_MODELS for api name lookup

```typescript
import { AVAILABLE_MODELS } from '@ptah-extension/shared';

// In config:model-switch handler:
this.rpcHandler.registerMethod<ConfigModelSwitchParams, ConfigModelSwitchResult>('config:model-switch', async (params) => {
  const { model, sessionId } = params;
  // ... existing validation and config save

  // Sync to active SDK session if provided
  if (sessionId) {
    try {
      const modelInfo = AVAILABLE_MODELS.find((m) => m.id === model);
      if (modelInfo) {
        await this.sdkAdapter.setSessionModel(sessionId, modelInfo.apiName);
        this.logger.debug('Model synced to active session', { sessionId, model, apiName: modelInfo.apiName });
      }
    } catch (error) {
      this.logger.warn('Failed to sync model to active session', { error, sessionId });
      // Continue - config was saved, just live sync failed
    }
  }

  return { model };
});
```

---

#### [MODIFY] [rpc-method-registration.service.ts](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts)

**Line Range**: 612-668

**Changes**: Add SDK call for permission mode sync

```typescript
// In config:autopilot-toggle handler:
// ... existing validation and config save

// Sync to active SDK session if provided
if (sessionId && enabled) {
  try {
    const sdkMode = this.mapPermissionToSdkMode(permissionLevel);
    await this.sdkAdapter.setSessionPermissionMode(sessionId, sdkMode);
    this.logger.debug('Permission mode synced to active session', { sessionId, sdkMode });
  } catch (error) {
    this.logger.warn('Failed to sync permission mode to active session', { error, sessionId });
  }
}

// New helper method:
private mapPermissionToSdkMode(level: PermissionLevel): 'default' | 'acceptEdits' | 'bypassPermissions' {
  const modeMap: Record<PermissionLevel, 'default' | 'acceptEdits' | 'bypassPermissions'> = {
    'ask': 'default',
    'auto-edit': 'acceptEdits',
    'yolo': 'bypassPermissions',
  };
  return modeMap[level];
}
```

---

### Component 4: Frontend - Pass SessionId to Config RPC

---

#### [MODIFY] [model-state.service.ts](file:///d:/projects/ptah-extension/libs/frontend/core/src/lib/services/model-state.service.ts)

**Changes**: Add sessionId to RPC call

```typescript
const sessionId = this.chatStore?.currentSessionId() ?? null;
const result = await this.rpc.call<{ model: ClaudeModel }>('config:model-switch', { model, sessionId });
```

---

#### [MODIFY] [autopilot-state.service.ts](file:///d:/projects/ptah-extension/libs/frontend/core/src/lib/services/autopilot-state.service.ts)

**Changes**: Add sessionId to RPC calls

```typescript
const sessionId = this.chatStore?.currentSessionId() ?? null;
const result = await this.rpc.call<void>('config:autopilot-toggle', { enabled, permissionLevel, sessionId });
```

---

### Component 5: RPC Types Update

---

#### [MODIFY] [rpc.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts)

**Changes**: Add optional sessionId to config params

```typescript
export interface ConfigModelSwitchParams {
  model: ClaudeModel;
  sessionId?: SessionId | null; // For live sync
}

export interface ConfigAutopilotToggleParams {
  enabled: boolean;
  permissionLevel: PermissionLevel;
  sessionId?: SessionId | null; // For live sync
}
```

---

## Files Summary

| File                                 | Action | Lines Changed      |
| ------------------------------------ | ------ | ------------------ |
| `chat.store.ts`                      | MODIFY | +1 (expose signal) |
| `chat-view.component.ts`             | MODIFY | +3 (lucide import) |
| `chat-view.component.html`           | MODIFY | +20 (stop button)  |
| `model-autopilot.types.ts`           | MODIFY | +6 (apiName field) |
| `rpc-method-registration.service.ts` | MODIFY | +25 (SDK sync)     |
| `model-state.service.ts`             | MODIFY | +2 (add sessionId) |
| `autopilot-state.service.ts`         | MODIFY | +2 (add sessionId) |
| `rpc.types.ts`                       | MODIFY | +2 (add sessionId) |

**Total**: ~61 new lines across 8 files

---

## Team-Leader Handoff

**Developer Type**: both (frontend + backend)
**Complexity**: Medium
**Estimated Tasks**: 4 batches
**Batch Strategy**:

1. Shared types (model-autopilot.types.ts, rpc.types.ts)
2. Backend SDK sync (rpc-method-registration.service.ts)
3. Frontend stop button (chat.store.ts, chat-view.component.\*)
4. Frontend sessionId passing (model-state.service.ts, autopilot-state.service.ts)

---

## Verification Plan

### Build Verification

```bash
npx nx typecheck ptah-extension-webview
npx nx lint chat core shared
npx nx build ptah-extension-webview
```

### Manual Verification

**Test 1: Stop Button**

1. Start VS Code with Ptah extension
2. Start chat, send message that triggers long response
3. VERIFY: Stop button appears in top-right during streaming
4. VERIFY: Button shows lucide Square icon + "Stop" text
5. Click stop → VERIFY: Shows spinner + "Stopping..."
6. VERIFY: Streaming stops, button disappears

**Test 2: Live Model Switch**

1. Start streaming session
2. Switch model via dropdown (e.g., Sonnet → Opus)
3. VERIFY: Config saved (check VS Code settings)
4. VERIFY: Next response uses new model (check logs for apiName)

**Test 3: Live Permission Mode**

1. Start streaming session
2. Toggle autopilot to YOLO mode
3. VERIFY: Permission prompts auto-approve
