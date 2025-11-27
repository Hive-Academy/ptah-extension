# TASK_2025_027: Proper Session Lifecycle (Phase 1 of Multi-Session Support)

## User Request

Fix the session continuation bug where sending a second message fails with:

```
Error: --resume requires a valid session ID when used with --print
Session IDs must be in UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000)
Provided value "msg_1764279427956_gc71bua" is not a valid UUID
```

The user wants this implemented as **Phase 1 of proper multi-session/tab support**, not as a temporary fix.

## Root Cause Analysis

### Current (Broken) Flow

1. User types message in chat
2. Frontend generates **fake placeholder ID** (`msg_${timestamp}_${random}`)
3. Frontend sends `chat:start` with this fake ID
4. Backend spawns Claude CLI � CLI creates **real UUID session** (e.g., `f17cc20a-...`)
5. User sends second message
6. Frontend calls `chat:continue` with the **fake ID**
7. Backend passes fake ID to `--resume` flag � **Claude CLI rejects it**

### Why It Fails

- Claude CLI expects UUID format for `--resume`
- We're sending `msg_1764279427956_gc71bua` instead of `f17cc20a-1234-...`
- The real session UUID is in Claude's JSONL response but we never extract it

## Solution: Draft � Active Session Lifecycle

### New Flow

1. User types message � Session starts in **"draft" state** (no UUID yet)
2. Frontend sends `chat:start` (no session ID needed for new session)
3. Backend spawns Claude CLI � CLI streams JSONL with `session_id` field
4. Backend extracts real UUID from JSONL � sends to frontend via message
5. Frontend updates state with **real Claude UUID**
6. User sends second message � `chat:continue` with **real UUID** � Works!

### Session States

```typescript
type SessionStatus = 'draft' | 'streaming' | 'ready' | 'error';

interface SessionState {
  status: SessionStatus;
  claudeSessionId: string | null; // Real UUID from CLI, null when draft
  messages: ExecutionChatMessage[];
}
```

## Why This Is Phase 1 (Not a Temp Fix)

| This Phase                      | Future Tab System             |
| ------------------------------- | ----------------------------- |
| `claudeSessionId: null` (draft) | Tab with `state: 'draft'`     |
| Extract UUID from JSONL         | Same mechanism per tab        |
| Single session state            | Array of session states       |
| SessionManager tracks lifecycle | Same, just multiple instances |

The data model and lifecycle we build now is **exactly what tabs need** - just wrapped in an array later.

## Related Issues Fixed

1. **Session continuation fails** - Primary bug
2. **New sessions don't show in sidebar** - Because we use fake ID that doesn't match Claude's files
3. **Session list refresh issues** - Fake IDs don't correlate with `.jsonl` files

## Related Tasks

- TASK_2025_011: Session Management Simplification (uses Claude's storage as source of truth)
- TASK_2025_014: Session Storage Migration (eliminated duplicate storage)
- TASK_2025_023: Streaming Architecture (established JSONL processing)

## Success Criteria

1. [ ] New conversation starts without pre-generated session ID
2. [ ] Real Claude UUID extracted from JSONL `session_id` field
3. [ ] Frontend state updated with real UUID
4. [ ] Session continuation works with `--resume` using real UUID
5. [ ] New sessions appear in sidebar correctly
6. [ ] Session switching loads correct messages
7. [ ] No regression in existing streaming functionality

## Out of Scope (Phase 2+)

- Tab UI components
- Multiple simultaneous sessions
- Tab drag-to-reorder
- Session close/cleanup UI
