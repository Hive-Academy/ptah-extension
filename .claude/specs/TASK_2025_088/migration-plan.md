# TASK_2025_088: SDK-Native Session Migration Plan

**Date**: 2025-12-18
**Status**: IN PROGRESS
**Priority**: HIGH
**Root Cause**: TASK_2025_086/087 fragmented message issue caused by redundant storage architecture

---

## Problem Statement

The Ptah extension has **THREE parallel storage systems** for session data:

1. **SDK's Native Session Persistence** (`~/.claude/projects/{sessionId}.jsonl`) - **UNUSED**
2. **Custom SdkSessionStorage** (VS Code Memento + in-memory) - **REDUNDANT**
3. **Frontend StreamingState** (ephemeral Maps) - **CORRECT**

This architectural mismatch causes:

- Fragmented message display when loading stored sessions
- 641 lines of redundant code duplicating SDK functionality
- Two sources of truth that can diverge
- Type safety loss from ESM/CommonJS interop workarounds

---

## KEY INSIGHT (Validated 2025-12-18)

**The SDK handles EVERYTHING:**

- Persists messages to `~/.claude/projects/{workspaceDir}/{sessionId}.jsonl`
- On resume with `resume: sessionId`, streams back ALL old messages + new responses
- No need to read JSONL files manually - SDK does it automatically

**We only need:**

1. Store `sessionId -> friendlyName` mapping (for session list UI)
2. Pass `resume: sessionId` to SDK
3. SDK handles all message history, context, and replay

---

## Solution Overview

**Eliminate SdkSessionStorage** and leverage SDK's native session persistence:

1. SDK auto-persists to `~/.claude/projects/{sessionId}.jsonl` (already happening!)
2. SDK resumes via `query({ options: { resume: sessionId } })` - streams back history!
3. Ptah only stores UI metadata (session names, timestamps, cost/tokens)
4. Frontend streaming buffer remains unchanged (correct design)

---

## Migration Phases

### Phase 1: Validation (Current)

**Goal**: Confirm SDK's native persistence works as expected

**Tasks**:

- [ ] Verify sessions are saved to `~/.claude/projects/`
- [ ] Test session resumption with SDK's `resume` option
- [ ] Confirm SDK provides session listing capability (or identify alternative)
- [ ] Document any SDK limitations for session management

### Phase 2: Create Lightweight Metadata Store

**Goal**: Replace SdkSessionStorage with minimal metadata-only storage

**New Interface**:

```typescript
interface SessionMetadata {
  sessionId: string; // Real SDK UUID (NOT internal ID)
  sessionName: string; // User-friendly label
  lastActiveAt: number; // For sorting in session list
  workspaceId: string; // Workspace association
  totalCost: number; // Accumulated from result messages
  totalTokens: {
    // Accumulated from result messages
    input: number;
    output: number;
  };
}
```

**What's REMOVED**:

- `messages: StoredSessionMessage[]` - SDK handles this
- `claudeSessionId` vs `id` mapping - Just use SDK's session ID directly
- Message storage/retrieval methods
- Session compaction logic

**Files to Create**:

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (new, ~100 lines)

**Files to Modify**:

- `libs/backend/agent-sdk/src/lib/types/sdk-session.types.ts` - Simplify types

### Phase 3: Update StreamTransformer

**Goal**: Stop storing messages, only extract claudeSessionId and stats

**Current Behavior** (`stream-transformer.ts:362-456`):

```typescript
// Currently stores EACH complete message
if (sdkMessage.type === 'assistant' || sdkMessage.type === 'user') {
  const storedMessage: StoredSessionMessage = { ... };
  await storage.addMessage(sessionId, storedMessage);
}
```

**New Behavior**:

```typescript
// Only update metadata on result (stats)
if (sdkMessage.type === 'result' && onResultStats) {
  onResultStats({ sessionId, cost, tokens, duration });
}

// Only capture claudeSessionId for resumption
if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
  const realSessionId = sdkMessage.session_id;
  await metadataStore.updateSessionId(placeholderId, realSessionId);
}
```

**Files to Modify**:

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
- Remove ~90 lines of message storage code

### Phase 4: Update Session Resumption Flow

**Goal**: Use SDK's native session resumption

**Current Flow** (complex):

```
1. Load StoredSession from VS Code Memento
2. Extract claudeSessionId from stored session
3. Pass claudeSessionId to SDK's resume option
4. SDK loads from ~/.claude/projects/{claudeSessionId}.jsonl
5. SDK replays context to Claude API
```

**New Flow** (simple):

```
1. Load SessionMetadata from VS Code Memento
2. Pass sessionId directly to SDK's resume option
3. SDK loads from ~/.claude/projects/{sessionId}.jsonl
4. SDK replays context to Claude API
```

**Files to Modify**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Simplify resumeSession()
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts` - Minor updates

### Phase 5: Session List & History Loading

**Goal**: Handle session listing and history display

**Challenge**: SDK doesn't provide a session listing API

**Options**:

1. **Read `~/.claude/projects/` directory** - List JSONL files
2. **Store session list in Ptah metadata** - Keep list of session IDs
3. **Both** - Use metadata for fast list, verify against SDK files

**Recommendation**: Option 3 (both)

- Metadata store provides fast session list
- SDK files provide message history
- On extension startup, reconcile list with actual SDK files

**Session History Loading**:

- Read JSONL file from `~/.claude/projects/{sessionId}.jsonl`
- Parse SDK message format → FlatStreamEventUnion
- Let frontend build ExecutionNode tree at render time

**Files to Create**:

- `libs/backend/agent-sdk/src/lib/sdk-session-reader.ts` - Read SDK JSONL files

### Phase 6: Remove Redundant Code

**Goal**: Delete deprecated code

**Files to DELETE**:

- `libs/backend/agent-sdk/src/lib/sdk-session-storage.ts` (450 lines)

**Types to SIMPLIFY**:

- `libs/backend/agent-sdk/src/lib/types/sdk-session.types.ts`
  - Remove `StoredSession`, `StoredSessionMessage`
  - Keep only `SessionMetadata`

**Code to REMOVE**:

- StreamTransformer message storage (~90 lines)
- SessionLifecycleManager session record management

**Estimated Reduction**: 641 lines → ~100 lines

---

## Implementation Order

1. **Phase 1**: Validation - Must confirm SDK behavior first
2. **Phase 2**: Create SessionMetadataStore - New foundation
3. **Phase 4**: Update resumption flow - Core functionality
4. **Phase 3**: Update StreamTransformer - Stop redundant storage
5. **Phase 5**: Session list & history - UI support
6. **Phase 6**: Remove code - Cleanup

---

## Risks & Mitigations

### Risk 1: SDK Files Not Readable

**Risk**: SDK's JSONL format might be internal/undocumented
**Mitigation**: Test JSONL parsing, create fallback if format changes
**Impact**: Medium - could require keeping message storage as backup

### Risk 2: Session List Sync Issues

**Risk**: Metadata list and SDK files could diverge
**Mitigation**: Reconcile on extension startup, prefer SDK files as source of truth
**Impact**: Low - worst case is stale session in list

### Risk 3: Breaking Change for Existing Sessions

**Risk**: Users have sessions stored in old format
**Mitigation**: Migration logic to read old sessions, reconcile with SDK files
**Impact**: Medium - requires backward compatibility for one release

### Risk 4: SDK Version Changes

**Risk**: SDK persistence format could change
**Mitigation**: Version check in JSONL reader, graceful degradation
**Impact**: Low - SDK is versioned, changes documented

---

## Success Criteria

1. **Functional**: Session creation, streaming, resumption all work
2. **No Fragmentation**: Loaded sessions display correctly
3. **Single Source of Truth**: Only SDK owns message persistence
4. **Code Reduction**: Remove 500+ lines of redundant code
5. **Type Safety**: No new `any` casts introduced

---

## Testing Plan

### Unit Tests

- SessionMetadataStore CRUD operations
- JSONL parsing for SDK format
- StreamTransformer without message storage

### Integration Tests

- Create session → stream → close → resume
- Session list reflects actual SDK files
- Metadata survives extension reload

### Manual Tests

- Create multiple sessions, verify in session list
- Resume old session, verify conversation context
- Check `~/.claude/projects/` directory structure

---

## Timeline Estimate

| Phase                      | Estimated Time  |
| -------------------------- | --------------- |
| Phase 1: Validation        | 1-2 hours       |
| Phase 2: Metadata Store    | 2-3 hours       |
| Phase 3: StreamTransformer | 2 hours         |
| Phase 4: Resumption Flow   | 2-3 hours       |
| Phase 5: Session List      | 3-4 hours       |
| Phase 6: Cleanup           | 1-2 hours       |
| **Total**                  | **11-16 hours** |

---

## Appendix: Files Reference

### Files to Create

- `session-metadata-store.ts` - Lightweight metadata storage
- `sdk-session-reader.ts` - Read SDK JSONL files

### Files to Modify

- `stream-transformer.ts` - Remove message storage
- `sdk-agent-adapter.ts` - Simplify resumption
- `sdk-query-builder.ts` - Minor updates
- `sdk-session.types.ts` - Simplify types
- DI tokens and registration

### Files to Delete

- `sdk-session-storage.ts` - Entire file redundant

### SDK Files Reference

- Session location: `~/.claude/projects/{sessionId}.jsonl`
- SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`
