# Task Context - TASK_2025_068

**Created**: 2025-12-11T12:40:00+02:00  
**Type**: REFACTORING (Architecture Cleanup)  
**Priority**: High (P1)  
**Complexity**: High

---

## 📋 User Intent

Eliminate the dual session ID system (UI placeholder ID + Claude SDK session ID) that causes architectural complexity, UUID validation errors, and race conditions. Migrate to a single source of truth: Claude Agent SDK session management.

### Original User Request

> "how ui sessionId is contradicting with our claude sessionId and i think its a bad practices to have 2 id systems, i think we made this to start a session in ui without the backend (claude agent sdk) but this was an old approach that was designed to support claude code cli, we didn't have the full control and full features of the agent sdk session management so i want you to evaluate and make codebase evidances on these claims and lets fix propery to eliminate the need for that ui session id if possible"

> **Follow-up**: "lets properly orchestrate this to first eliminate all duplications and rely on claude backend session management, also lately claude agent sdk allowed to create named session or maybe we can do that ourselves, while we fix the session id can we also fix that and allow users to add a session name and streamline the session creation so whenever we add a session on the frontend it gets handled on the backend without any intermediate placeholder logic"

---

## 🎯 Core Objectives

1. **Eliminate Dual Session ID System**

   - Remove `placeholderSessionId` from `TabState`
   - Remove `PendingSessionManagerService` entirely
   - Remove session ID resolution mechanism (`session:id-resolved` events)
   - Use Claude SDK session ID as the single source of truth

2. **Implement Named Sessions**

   - Allow users to name sessions when creating them
   - Investigate Claude Agent SDK's named session support (if available)
   - Implement custom named session logic if SDK doesn't support it
   - Store session names in session metadata

3. **Streamline Session Creation Flow**
   - Frontend initiates session creation → Backend creates session → Backend returns session ID
   - No intermediate placeholder logic
   - No resolution callbacks
   - Direct RPC call: `session:create` → `{ sessionId: string, name: string }`

---

## 🔍 Codebase Evidence (From Investigation)

### Current Dual ID System

**Evidence from `chat.types.ts` (TabState interface):**

```typescript
export interface TabState {
  id: string; // Frontend tab ID
  claudeSessionId: string | null; // Real Claude CLI/SDK session UUID
  placeholderSessionId?: string | null; // TEMPORARY frontend-generated ID
  // ... other fields
}
```

**Evidence from `claude-domain.types.ts`:**

```typescript
export interface ClaudeSessionResume {
  readonly sessionId: SessionId; // Our internal SessionId (branded type)
  readonly claudeSessionId: string; // Claude CLI's internal session ID
  // ...
}
```

**Evidence from `pending-session-manager.service.ts`:**

```typescript
/**
 * When a new conversation starts, we generate a placeholder session ID.
 * The backend will eventually respond with a real Claude CLI session UUID.
 * This service tracks which tab initiated each pending session so we can
 * resolve the correct tab when the backend responds.
 */
```

### Problems Identified

1. **UUID Validation Errors**: Placeholder IDs (`msg_123456_abc7def`) fail UUID validation
2. **Memory Leaks**: `PendingSessionManagerService` has 60-second timeouts for cleanup
3. **Race Conditions**: Tab switching during session ID resolution causes routing errors
4. **Complexity**: Extra mapping layer, resolution callbacks, event handling
5. **Storage Duplication**: Both IDs stored in tabs and session records

---

## 🏗️ Proposed Architecture

### New Session Creation Flow

```
┌─────────────┐                  ┌─────────────┐                  ┌─────────────┐
│  Frontend   │                  │   Backend   │                  │ Claude SDK  │
│  (Angular)  │                  │  (VS Code)  │                  │             │
└─────────────┘                  └─────────────┘                  └─────────────┘
      │                                 │                                 │
      │  1. User clicks "New Session"  │                                 │
      │     with optional name          │                                 │
      │                                 │                                 │
      │  2. RPC: session:create         │                                 │
      │     { name: "Bug Fix" }         │                                 │
      ├────────────────────────────────>│                                 │
      │                                 │                                 │
      │                                 │  3. SDK: query.start()          │
      │                                 ├────────────────────────────────>│
      │                                 │                                 │
      │                                 │  4. Returns session UUID        │
      │                                 │<────────────────────────────────┤
      │                                 │                                 │
      │                                 │  5. Store session metadata      │
      │                                 │     { id, name, createdAt }     │
      │                                 │                                 │
      │  6. RPC Response                │                                 │
      │     { sessionId: "uuid",        │                                 │
      │       name: "Bug Fix" }         │                                 │
      │<────────────────────────────────┤                                 │
      │                                 │                                 │
      │  7. Create tab with sessionId   │                                 │
      │     (no placeholder)            │                                 │
      │                                 │                                 │
```

### Key Changes

1. **Backend Controls Session Creation**

   - `SdkAgentAdapter.createSession(name?: string): Promise<SessionId>`
   - Backend immediately returns the real Claude SDK session UUID
   - No placeholder IDs generated

2. **Frontend Waits for Real ID**

   - `session:create` RPC call is synchronous (waits for response)
   - Tab created with actual `claudeSessionId` from start
   - No `placeholderSessionId` field needed

3. **Named Sessions**
   - User can optionally provide session name
   - Name stored in session metadata (`sdk-session-storage.ts`)
   - Name displayed in tab title and session list

---

## 📂 Files to Modify/Remove

### Files to Remove

- `libs/frontend/chat/src/lib/services/pending-session-manager.service.ts`
- `libs/frontend/chat/src/lib/services/pending-session-manager.service.spec.ts`

### Files to Modify (Frontend)

- `libs/frontend/chat/src/lib/services/chat.types.ts` - Remove `placeholderSessionId`
- `libs/frontend/chat/src/lib/services/tab-manager.service.ts` - Remove resolution logic
- `libs/frontend/chat/src/lib/services/message-sender.service.ts` - Update session creation
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` - Remove resolution handling
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` - Streamline session creation

### Files to Modify (Shared Types)

- `libs/shared/src/lib/types/rpc.types.ts` - Add `SessionCreateParams` and `SessionCreateResult`
- `libs/shared/src/lib/types/claude-domain.types.ts` - Remove duplicate sessionId fields

### Files to Modify (Backend)

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Add `createSession()` method
- `libs/backend/agent-sdk/src/lib/sdk-session-storage.ts` - Add name field to session records
- `libs/backend/extension/src/lib/services/rpc-method-registration.service.ts` - Add `session:create` RPC handler

---

## 🔬 Technical Investigation Needed

1. **Claude Agent SDK Named Sessions**

   - Check SDK documentation for named session support
   - Test if `query({ options: { sessionName: string } })` is supported
   - Determine if SDK stores names or we need custom storage

2. **Session Metadata Storage**
   - Verify `sdk-session-storage.ts` can store additional metadata
   - Design schema for session names, descriptions, tags, etc.

---

## ✅ Success Criteria

- [ ] No `placeholderSessionId` references in codebase
- [ ] `PendingSessionManagerService` deleted
- [ ] `session:id-resolved` events removed
- [ ] Session creation is synchronous (frontend waits for backend)
- [ ] Users can name sessions when creating them
- [ ] Session names persist and display correctly
- [ ] All tests pass
- [ ] No UUID validation errors
- [ ] Zero race conditions in session routing

---

## 🚨 Critical Constraints

- **Backward Compatibility**: Existing sessions (with dual IDs) must still load correctly
- **Migration Strategy**: May need migration script for existing session records
- **Zero Downtime**: Frontend must handle backend returning real ID immediately
- **RPC Protocol**: Must maintain RPC type safety and validation

---

## 📊 Estimated Impact

**Complexity**: High (touches 15+ files across frontend/backend/shared)  
**Risk**: Medium (core session management)  
**Time**: 2-3 days (architecture + implementation + testing)  
**Benefits**:

- Eliminate 7 files of complexity
- Fix UUID validation bugs
- Improve session creation performance (no resolution roundtrip)
- Enable future features (session templates, sharing, etc.)
