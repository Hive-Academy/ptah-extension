# Requirements Document - TASK_2025_068

## Introduction

### Business Context

The current session management system suffers from **architectural debt** inherited from the Claude Code CLI era. When the extension relied on the CLI, the backend had no control over session creation—the real session ID was only known after the conversation started. This forced us to implement a complex dual-ID system with placeholder IDs, resolution mechanisms, and timeout-based cleanup.

With the **Claude Agent SDK integration** (TASK_2025_044), we now have full control over session lifecycle. The SDK provides immediate session IDs upon creation, eliminating the need for placeholders entirely. However, the legacy dual-ID infrastructure remains, causing:

- ✘ **UUID Validation Errors**: Placeholder IDs (`msg_123456_abc`) fail branded type validation
- ✘ **Memory Leaks**: 60-second timeout cleanup in `PendingSessionManagerService`
- ✘ **Race Conditions**: Tab switching during ID resolution causes message routing errors
- ✘ **Developer Confusion**: Two ID systems (`sessionId` vs `claudeSessionId`) create mental overhead
- ✘ **Code Complexity**: 7+ files dedicated to placeholder logic and resolution

### Value Proposition

Eliminating the dual-ID system will:

- ✅ **Reduce Complexity**: Remove 2 services, 500+ lines of resolution logic
- ✅ **Improve Reliability**: Zero race conditions, no ID translation bugs
- ✅ **Enable Named Sessions**: Users can name sessions for better organization
- ✅ **Enhance UX**: Instant session creation (no async resolution delay)
- ✅ **Simplify Mental Model**: One session = one ID (developer clarity)

---

## Task Classification

- **Type**: REFACTORING (Architecture Cleanup + Feature Addition)
- **Priority**: P1-High (fixes active bugs, enables future features)
- **Complexity**: High (cross-cutting changes across frontend/backend/shared)
- **Estimated Effort**: 16-20 hours (architecture + implementation + testing + migration)

---

## Workflow Dependencies

- **Research Needed**: **Yes** - Investigate Claude Agent SDK named session support
  - **Focus**: Check SDK documentation for session naming capabilities
  - **Decision Point**: Use SDK native names vs custom metadata storage
- **UI/UX Design Needed**: **No** - Minor UI additions (session name input), no visual redesign

---

## Requirements

### Requirement 1: Eliminate Dual Session ID System

**User Story**: As a **developer maintaining the session management code**, I want **a single source of truth for session IDs**, so that **I can reason about session state without ID translation logic**.

#### Acceptance Criteria

1. WHEN the codebase is searched for `placeholderSessionId` THEN zero results SHALL be found
2. WHEN the frontend creates a new session THEN it SHALL receive the real Claude SDK session ID synchronously from the backend
3. WHEN a session is active THEN the `TabState` SHALL contain only `claudeSessionId` (no `placeholderSessionId` field)
4. WHEN `PendingSessionManagerService` is referenced THEN the import SHALL fail (service deleted)
5. WHEN `session:id-resolved` event is searched THEN zero occurrences SHALL be found
6. WHEN session ID validation runs THEN all IDs SHALL pass UUID format validation (no `msg_` prefixes)

---

### Requirement 2: Backend-Controlled Session Creation

**User Story**: As a **frontend developer**, I want **the backend to control all session creation**, so that **I receive real session IDs immediately without placeholder logic**.

#### Acceptance Criteria

1. WHEN the frontend calls `session:create` RPC THEN the backend SHALL create an SDK session and return the real UUID within 500ms (95th percentile)
2. WHEN the `session:create` handler executes THEN it SHALL invoke `SdkAgentAdapter.createSession(name?: string)` method
3. WHEN the SDK session is created THEN the backend SHALL store the session record in `SdkSessionStorage` before returning
4. WHEN the RPC response is received THEN it SHALL include `{ sessionId: SessionId, name: string }` with type safety
5. WHEN session creation fails THEN the error SHALL propagate to frontend with actionable error messages
6. WHEN multiple sessions are created concurrently THEN each SHALL receive a unique session ID with no collisions

---

### Requirement 3: Named Sessions

**User Story**: As a **user managing multiple conversations**, I want **to name my sessions**, so that **I can identify them quickly in the session list**.

#### Acceptance Criteria

1. WHEN the user creates a new session THEN they SHALL have the option to provide a custom name (UI input)
2. WHEN no name is provided THEN the system SHALL generate a default name with format: `Session {timestamp}` (e.g., `Session 12/11/2025, 1:45 PM`)
3. WHEN a session name is provided THEN it SHALL be stored in `StoredSession.name` field
4. WHEN the session list is displayed THEN each session SHALL show its name (not UUID fallback)
5. WHEN a session is renamed THEN the change SHALL persist across extension restarts
6. WHEN a session name exceeds 100 characters THEN it SHALL be truncated with ellipsis
7. WHEN the SDK supports native session naming THEN we SHALL use SDK's `sessionName` option; OTHERWISE we SHALL store names in session metadata

---

### Requirement 4: Streamlined Session Creation Flow

**User Story**: As a **frontend developer**, I want **synchronous session creation**, so that **I can create tabs with real session IDs immediately without async resolution**.

#### Acceptance Criteria

1. WHEN the user clicks "New Session" THEN the UI SHALL disable the button and show loading state
2. WHEN the frontend calls `session:create` RPC THEN it SHALL wait for the response synchronously (no fire-and-forget)
3. WHEN the backend responds with `sessionId` THEN the frontend SHALL create a `TabState` with `claudeSessionId` set immediately
4. WHEN the tab is created THEN `placeholderSessionId` SHALL be `undefined` (field removed from type)
5. WHEN session creation takes >3 seconds THEN the UI SHALL show an error toast: "Session creation timeout"
6. WHEN the session is ready THEN the chat input SHALL be enabled for user messages

---

### Requirement 5: Backward Compatibility Migration

**User Story**: As a **user with existing sessions**, I want **my old sessions to load correctly**, so that **I don't lose my conversation history after the update**.

#### Acceptance Criteria

1. WHEN an existing session has `placeholderSessionId` THEN the frontend SHALL ignore it and use `claudeSessionId` only
2. WHEN an existing session has `claudeSessionId` === `null` THEN it SHALL be treated as a draft session (no SDK session)
3. WHEN the session loader encounters legacy dual-ID sessions THEN it SHALL log a migration warning (not error)
4. WHEN a legacy session is loaded THEN messages SHALL display correctly without corruption
5. WHEN the user opens a pre-migration session THEN it SHALL function identically to post-migration sessions
6. WHEN the extension updates THEN no data migration script SHALL be required (graceful degradation)

---

### Requirement 6: Cleanup of Legacy Infrastructure

**User Story**: As a **developer**, I want **legacy session resolution code removed**, so that **the codebase is maintainable and the architecture is clear**.

#### Acceptance Criteria

1. WHEN the refactoring is complete THEN the following files SHALL be deleted:

   - `libs/frontend/chat/src/lib/services/pending-session-manager.service.ts`
   - `libs/frontend/chat/src/lib/services/pending-session-manager.service.spec.ts`

2. WHEN the following files are modified THEN they SHALL have zero references to placeholder IDs:

   - `libs/frontend/chat/src/lib/services/chat.types.ts`
   - `libs/frontend/chat/src/lib/services/tab-manager.service.ts`
   - `libs/frontend/chat/src/lib/services/message-sender.service.ts`
   - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
   - `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`

3. WHEN `TabState` interface is inspected THEN it SHALL NOT contain `placeholderSessionId?: string | null` field
4. WHEN `handleSessionIdResolved()` method is searched THEN zero implementations SHALL be found
5. WHEN the `session:id-resolved` event type is searched THEN zero RPC handlers SHALL be found
6. WHEN the backend's `SessionLifecycleManager` is inspected THEN `sessionIdMapping` SHALL be removed (no longer needed)

---

## Non-Functional Requirements

### Performance

- **Session Creation Latency**:

  - 95th percentile: <500ms
  - 99th percentile: <1000ms
  - Timeout threshold: 3000ms (user-facing error)

- **Memory Usage**:

  - Eliminate `PendingSessionManagerService` timeout Map (60-second retention per session)
  - Reduce frontend session state by removing `placeholderSessionId` field (estimated 50 bytes/tab)

- **Resource Efficiency**:
  - Zero ongoing timers for session resolution cleanup
  - No event bus overhead for `session:id-resolved` propagation

### Security

- **Session ID Validation**:

  - All session IDs MUST pass UUID v4 format validation
  - Reject any session IDs not matching `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`

- **Name Sanitization**:
  - Session names MUST be sanitized to prevent XSS (HTML encoding)
  - Maximum length: 100 characters (truncate excess)

### Scalability

- **Concurrent Session Creation**:

  - Support 10+ sessions created simultaneously without ID collisions
  - RPC should handle burst traffic (10 req/sec) without degradation

- **Session Metadata Storage**:
  - `SdkSessionStorage` MUST support session names without schema migration
  - Session names MUST persist in VS Code workspace state (no memory-only storage)

### Reliability

- **Error Handling**:
  - RPC failures MUST propagate actionable errors to frontend (not generic "Server error")
  - SDK session creation failures MUST rollback (no orphaned tabs)
- **Data Integrity**:

  - Session creation MUST be atomic (session record + storage update succeed together or both fail)
  - No partial state: tab with ID but no backend session, or vice versa

- **Graceful Degradation**:
  - Legacy sessions with placeholder IDs MUST load without errors (backward compatibility)
  - Missing `claudeSessionId` SHOULD be treated as draft session (not fatal error)

---

## Stakeholder Analysis

### End Users

**Persona**: Developer using Ptah extension for AI pair programming

**Needs**:

- Instantly create new chat sessions without delays
- Organize sessions with meaningful names
- No unexplained errors or UUID validation failures

**Pain Points Addressed**:

- ✅ No more "`invalid UUID format`" errors when creating sessions
- ✅ Session list shows names, not cryptic UUIDs
- ✅ Faster session creation (no resolution delay)

### Development Team

**Persona**: Core contributors maintaining session management code

**Needs**:

- Clear mental model of session lifecycle
- Fewer moving parts (services, events, resolution logic)
- Type-safe session IDs across frontend/backend

**Pain Points Addressed**:

- ✅ Remove `PendingSessionManagerService` complexity
- ✅ Eliminate ID translation mapping
- ✅ Single source of truth for session identity

### Business Owners

**Persona**: Product owners tracking user satisfaction metrics

**Expectations**:

- Improved session creation success rate (fewer errors)
- Better user retention (organized session management)
- Foundation for future features (session sharing, templates)

**ROI**:

- ✅ 500+ lines of code removed (maintenance cost reduction)
- ✅ Zero race conditions (support ticket reduction)
- ✅ Named sessions enable power user workflows

---

## Risk Analysis

### Technical Risks

#### Risk 1: Claude SDK Session Naming Support Unknown

- **Probability**: Medium
- **Impact**: Medium
- **Mitigation**: Research SDK documentation in Phase 2 (research phase)
- **Contingency**: Store session names in `StoredSession.name` metadata (already exists in schema)

#### Risk 2: Backward Compatibility Issues with Legacy Sessions

- **Probability**: Low
- **Impact**: High (data loss)
- **Mitigation**:
  - Load legacy sessions gracefully (ignore `placeholderSessionId`)
  - Extensive regression testing on pre-migration sessions
  - Canary rollout to alpha users first
- **Contingency**: If corruption detected, rollback extension version and add migration script

#### Risk 3: RPC Timeout Increases Session Creation Latency

- **Probability**: Low
- **Impact**: Medium (poor UX)
- **Mitigation**:
  - Set aggressive 3-second timeout with user-facing error
  - Optimize SDK session creation path (remove unnecessary async operations)
  - Add performance monitoring for p95/p99 latency
- **Contingency**: Add retry logic with exponential backoff (max 2 retries)

#### Risk 4: Type System Breaking Changes Across Libraries

- **Probability**: Medium
- **Impact**: Medium (compilation errors)
- **Mitigation**:
  - Update types in `@ptah-extension/shared` first (single source of truth)
  - Use TypeScript compiler to find all type usage (`tsc --noEmit`)
  - Run `nx affected:build` after each change
- **Contingency**: Use type aliases for gradual migration if breaking changes are severe

---

## Dependencies

### Technical Dependencies

- **Libraries**:

  - `@anthropic-ai/claude-agent-sdk`: Session creation API
  - `@ptah-extension/shared`: Branded `SessionId` type
  - `@ptah-extension/vscode-core`: Global state storage

- **Services**:
  - `SdkAgentAdapter`: Backend session creation
  - `SdkSessionStorage`: Session metadata persistence
  - `RpcMethodRegistrationService`: `session:create` handler registration

### Task Dependencies

- **Prerequisite Tasks**:
  - TASK_2025_044 (Claude Agent SDK Integration) - ✅ Planned (needed for SDK control)
- **Blocked Tasks**:
  - Session Templates feature (requires named sessions)
  - Session Sharing feature (requires stable session IDs)

### External Dependencies

- **Claude Agent SDK API Stability**: Session creation must remain stable across SDK versions
- **VS Code Workspace State**: Must support session metadata storage without quota issues

---

## Research Requirements (Phase 2)

### Investigation Focus

1. **Claude SDK Native Session Naming**

   - **Question**: Does the SDK support `sessionName` option in query configuration?
   - **Method**: Read SDK documentation (`@anthropic-ai/claude-agent-sdk` package)
   - **Success Criteria**: Determine if SDK stores names or we need custom storage
   - **Decision Point**: Use SDK native vs custom metadata storage

2. **SDK Session Creation API**

   - **Question**: Can we create SDK sessions WITHOUT starting a conversation immediately?
   - **Method**: Test SDK `query()` API with minimal prompt
   - **Success Criteria**: Verify we can create session, get ID, then queue messages later
   - **Decision Point**: Redesign RPC flow if SDK requires initial message

3. **Migration Impact Assessment**
   - **Question**: How many existing sessions have `placeholderSessionId` set?
   - **Method**: Query VS Code workspace state for session statistics
   - **Success Criteria**: Quantify migration scope (e.g., "80% of sessions need handling")
   - **Decision Point**: Add migration script if >50% of sessions are legacy format

---

## Success Metrics

### Quantitative Metrics

1. **Code Reduction**: Remove 500+ lines of resolution logic (measured via `git diff --stat`)
2. **File Deletion**: Delete 2 service files (`pending-session-manager.service.ts` + spec)
3. **Error Rate**: Zero UUID validation errors in production logs (monitor for 1 week post-release)
4. **Performance**: Session creation p95 latency <500ms (monitor RPC `session:create` timing)
5. **Type Safety**: Zero TypeScript compilation errors across all libraries

### Qualitative Metrics

1. **Developer Experience**: Code reviewers confirm mental model clarity (survey after PR review)
2. **User Satisfaction**: Session naming feature adopted by >30% of users within 1 month
3. **Maintainability**: New contributors understand session flow without dual-ID explanation

---

## Timeline & Milestones

| Phase                  | Duration        | Deliverable                                             |
| ---------------------- | --------------- | ------------------------------------------------------- |
| Phase 2: Research      | 2-4 hours       | research-findings.md (SDK naming, migration assessment) |
| Phase 4: Architecture  | 2-3 hours       | implementation-plan.md (file-level changes, RPC types)  |
| Phase 5: Decomposition | 1 hour          | tasks.md (atomic task breakdown)                        |
| Phase 6: Execution     | 8-12 hours      | Code implementation (backend + frontend + shared types) |
| Phase 7: Testing       | 2-3 hours       | test-report.md (unit/integration/regression tests)      |
| **Total**              | **16-24 hours** | Production-ready refactoring + named sessions feature   |

---

## Out of Scope

The following are **explicitly excluded** from this task:

- ❌ Session sharing between users
- ❌ Session templates system
- ❌ Session branching/forking
- ❌ Session export/import functionality
- ❌ Session analytics dashboard
- ❌ Multi-workspace session synchronization

These features may be added in future tasks building on this foundation.

---

## Acceptance Testing

### Manual Test Scenarios

#### Scenario 1: Create Named Session

1. User clicks "New Session" button
2. User enters name "API Integration Work"
3. User clicks "Create"
4. **Expected**: Tab opens with title "API Integration Work", session ID is valid UUID

#### Scenario 2: Create Anonymous Session

1. User clicks "New Session" without entering name
2. **Expected**: Tab opens with default name "Session {timestamp}", session ID is valid UUID

#### Scenario 3: Load Legacy Session

1. User has existing session with `placeholderSessionId` set
2. User clicks the session in session list
3. **Expected**: Session loads successfully, messages display correctly, no errors in logs

#### Scenario 4: Session Creation Failure

1. Backend SDK is unavailable (simulate by disabling auth)
2. User clicks "New Session"
3. **Expected**: Error toast "Failed to create session: Authentication required", no zombie tab created

### Automated Test Coverage

- ✅ Unit tests for `TabState` type (no `placeholderSessionId` field)
- ✅ Integration tests for `session:create` RPC (success + error cases)
- ✅ Regression tests for legacy session loading
- ✅ E2E tests for named session creation flow

---

## Appendix: Current System Analysis

### Current Session Creation Flow (Legacy)

```
User clicks "New Session"
  ↓
Frontend generates placeholder ID: msg_1234567_abc (NOT a UUID)
  ↓
Frontend creates tab with placeholderSessionId
  ↓
Frontend sends RPC: chat:start { sessionId: "msg_1234567_abc" }
  ↓
Backend: "Wait, this isn't a valid UUID!" → Confusion
  ↓
Backend starts SDK session → SDK returns real UUID: abc-123-def
  ↓
Backend sends event: session:id-resolved { placeholder: "msg_1234567_abc", real: "abc-123-def" }
  ↓
Frontend: "Let me find which tab has this placeholder..."
  ↓
Frontend resolves tab's claudeSessionId ← RACE CONDITION IF USER SWITCHED TABS
  ↓
PendingSessionManagerService cleans up after 60 seconds
```

### Proposed Session Creation Flow (New)

```
User clicks "New Session" (optional name input)
  ↓
Frontend sends RPC: session:create { name: "Bug Fix" }
  ↓
Backend creates SDK session immediately
  ↓
SDK returns real UUID: abc-123-def-456
  ↓
Backend stores session metadata { id: abc-123-def-456, name: "Bug Fix" }
  ↓
Backend responds: { sessionId: "abc-123-def-456", name: "Bug Fix" }
  ↓
Frontend creates tab with claudeSessionId: "abc-123-def-456"
  ↓
Done. No resolution. No placeholder. No race condition.
```

---

**Document Version**: 1.0  
**Last Updated**: 2025-12-11T12:43:00+02:00  
**Status**: ✅ Ready for User Validation
