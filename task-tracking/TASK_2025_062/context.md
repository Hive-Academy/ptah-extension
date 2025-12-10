# TASK_2025_062: RPC Parameter Flow Fix (Model, Files, Images)

## User Intent

Fix critical disconnect between frontend UI state and backend SDK calls where:

1. **Model**: Dropdown shows selected model but backend receives nothing → "Model not provided" error
2. **Files/Folders**: @ syntax file picker works but files are not passed correctly in RPC
3. **Images**: SDK supports `ContentBlock[]` with base64 images but we only send plain text

## Creation Date

2025-12-10

## Task Type

BUGFIX + FEATURE (fixing broken parameter flow + adding proper image support)

## Priority

P0 - Critical (blocking chat functionality)

## Context

- User reported "Model not provided - ensure SDK is initialized" error in logs
- Investigation revealed frontend never sends model/files in RPC calls
- SDK already supports multi-modal content (`ContentBlock[]`) but we don't use it

## Key Discovery

```typescript
// Frontend chat:continue sends:
{ prompt, sessionId, workspacePath }  // NO MODEL, NO FILES!

// SDK expects:
SDKUserMessage.message.content = string | ContentBlock[]  // Supports images!
```

## Related Tasks

- TASK_2025_060: Model Selection Mismatch Fix (partial - didn't fix RPC flow)
- TASK_2025_051: SDK Backend Wiring
