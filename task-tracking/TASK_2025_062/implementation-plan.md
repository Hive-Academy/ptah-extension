# TASK_2025_062: Fix RPC Parameter Flow (Model, Files, Images)

## Problem Description

Critical disconnect between frontend UI state and backend SDK calls across 3 areas:

| Area       | Frontend Has                                 | RPC Sends          | Backend Receives              |
| ---------- | -------------------------------------------- | ------------------ | ----------------------------- |
| **Model**  | `ModelStateService.currentModel()`           | ❌ Nothing         | Falls back to config          |
| **Files**  | `FilePickerService.getFilePathsForMessage()` | ❌ Wrong structure | Not processed                 |
| **Images** | `ChatFile.type === 'image'`                  | ❌ Nothing         | SDK supports `ContentBlock[]` |

---

## Data Flow Analysis

### Current Frontend Flow

```
User types "@file.ts" → AtTriggerDirective → FilePickerService → ChatInputComponent
                                                                        ↓
                                              selectedFiles signal → MessageSenderService
                                                                        ↓
                                              send(content, files) → RPC call
```

### Gap 1: Model Not Passed

```typescript
// message-sender.service.ts:252-260 (chat:start)
options: files ? { files } : undefined; // NO MODEL!

// message-sender.service.ts:379-386 (chat:continue)
{
  prompt, sessionId, workspacePath;
} // NO MODEL, NO FILES!
```

### Gap 2: Files Structure Wrong

```typescript
// Frontend sends (when files exist):
{ options: { files: ['path1', 'path2'] } }

// But chat:start expects:
options?: { model?: string; systemPrompt?: string; }  // NO files field!
```

### Gap 3: Images Not Converted

```typescript
// SDK expects ContentBlock[] for images:
message.content = [
  { type: 'text', text: 'prompt' },
  {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: '...' },
  },
];

// But backend just passes string:
content: content; // Plain text only!
```

---

## SDK Capabilities (from `session-lifecycle-manager.ts`)

```typescript
export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

export type SDKUserMessage = {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] }; // ← Supports both!
  parent_tool_use_id: string | null;
};
```

---

## Proposed Changes (Phased)

### Phase 1: Model Flow (Priority - Immediate Fix)

#### [MODIFY] [rpc.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts)

Add `model` to `ChatContinueParams`:

```typescript
export interface ChatContinueParams {
  prompt: string;
  sessionId: SessionId;
  workspacePath?: string;
  model?: string; // ADD
}
```

#### [MODIFY] [message-sender.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/message-sender.service.ts)

Inject `ModelStateService` and pass model in both RPC calls.

#### [MODIFY] [rpc-method-registration.service.ts](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts)

Read model from params first, fall back to config.

---

### Phase 2: Files/Folders Flow

#### [MODIFY] [rpc.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts)

Add files to both params:

```typescript
export interface ChatStartParams {
  options?: { model?: string; systemPrompt?: string; files?: string[] };
}
export interface ChatContinueParams {
  files?: string[];
}
```

#### [MODIFY] [message-sender.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/message-sender.service.ts)

Always pass files in correct structure.

#### [MODIFY] [rpc-method-registration.service.ts](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts)

Pass files to SDK session config.

---

### Phase 3: Image Support

#### [NEW] [image-converter.service.ts](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/image-converter.service.ts)

Convert image paths to base64 `ContentBlock[]`:

```typescript
async convertToContentBlocks(text: string, files: string[]): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  for (const file of files) {
    if (isImage(file)) {
      const data = await fs.readFile(file);
      blocks.push({ type: 'image', source: { type: 'base64', media_type: getMimeType(file), data: data.toString('base64') } });
    }
  }
  return blocks;
}
```

#### [MODIFY] [sdk-agent-adapter.ts](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts)

Use `ContentBlock[]` in `sendMessageToSession()` when files include images.

---

## Verification Plan

### Phase 1 Verification

```bash
# Build and test
npx nx build ptah-extension-vscode
npx nx test chat --testPathPattern=message-sender

# Manual: Select model, send message, check logs for model in RPC params
```

### Phase 2 Verification

```bash
# Manual: Add @file.ts, send message, verify file path in backend logs
```

### Phase 3 Verification

```bash
# Manual: Add @image.png, send message, verify base64 in SDK message
```
