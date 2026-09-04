# Feature Workflow Trace Example

This document shows a complete FEATURE workflow trace from user request to task completion, demonstrating the full PM -> Architect -> Team-Leader -> Developer -> QA flow.

---

## User Command

```
/orchestrate Add real-time collaboration support with WebSocket connections for live cursor sharing
```

---

## Phase 0: Strategy Detection

**Orchestrator Analysis**:

```
Keywords detected: "add", "support" -> FEATURE
Affected areas: Backend (WebSocket), Frontend (cursor display)
Complexity estimate: High (new infrastructure)
Confidence: 85% FEATURE

Decision: Proceed with FEATURE strategy
```

**Orchestrator Output**:

```
TASK INITIALIZED: TASK_2025_045

Strategy: FEATURE (Full Workflow)
Complexity: High
Estimated Phases: 8

Flow: PM -> Architect -> Team-Leader -> Developers -> QA -> Modernization

Proceeding to Phase 1: Requirements gathering...
```

---

## Phase 1: Project Manager

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'project-manager',
  description: 'Create requirements for TASK_2025_045',
  prompt: `You are project-manager for TASK_2025_045.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**User Request**: "Add real-time collaboration support with WebSocket connections for live cursor sharing"

Analyze the request and create comprehensive requirements.
See project-manager.md for detailed instructions.`,
});
```

**PM Output** (task-description.md excerpt):

```markdown
# Task Description - TASK_2025_045

## Title

Real-Time Collaboration with Live Cursor Sharing

## Business Requirements

1. Users shall see other collaborators' cursors in real-time
2. Cursor positions shall update within 100ms latency
3. System shall support up to 10 concurrent collaborators per session
4. Cursor colors shall be unique per collaborator

## Technical Scope

- WebSocket server implementation in backend
- Cursor position broadcasting service
- Frontend cursor rendering component
- Session management for collaborators

## Out of Scope

- Voice/video chat
- File editing conflicts (handled separately)
- Mobile support

## Success Criteria

- Cursors visible within 100ms of movement
- No cursor drift between participants
- Graceful handling of disconnections
```

---

## Checkpoint 1: Requirements Validation

**Orchestrator Presents**:

```
USER VALIDATION CHECKPOINT - TASK_2025_045

PM has created requirements document.

Summary:
- Real-time cursor sharing for up to 10 collaborators
- 100ms latency target
- WebSocket-based architecture
- Out of scope: voice/video, conflict resolution

Document: .ptah/specs/TASK_2025_045/task-description.md

Reply "APPROVED" to proceed OR provide feedback for revision.
```

**User Response**: `APPROVED`

---

## Phase 2: Research (Conditional - Triggered)

**Orchestrator Decision**:

```
Technical unknowns detected:
- WebSocket library selection for VS Code extension
- Cursor synchronization protocol design

Invoking researcher-expert...
```

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'researcher-expert',
  description: 'Research WebSocket options for TASK_2025_045',
  prompt: `You are researcher-expert for TASK_2025_045.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Research Questions**:
1. Best WebSocket library for VS Code extension context
2. Cursor synchronization protocol patterns (CRDT vs OT vs simple broadcast)

Investigate options, create comparison matrix, recommend approach.
See researcher-expert.md for detailed instructions.`,
});
```

**Researcher Output** (research-report.md excerpt):

```markdown
# Research Report - TASK_2025_045

## WebSocket Library Comparison

| Library             | Bundle Size | VS Code Compatible | Features            |
| ------------------- | ----------- | ------------------ | ------------------- |
| ws                  | 23KB        | Yes                | Native, fast        |
| socket.io           | 85KB        | Yes                | Rooms, reconnection |
| @anthropic/realtime | 12KB        | Yes                | Lightweight         |

**Recommendation**: Use `ws` for backend, native WebSocket for frontend

## Cursor Sync Protocol

Simple broadcast sufficient for cursor positions:

- No conflict resolution needed (read-only display)
- Sub-100ms achievable with direct WebSocket messages
- CRDT/OT overkill for cursor positions

**Recommendation**: Simple broadcast with debounced position updates
```

---

## Phase 4: Software Architect

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'software-architect',
  description: 'Design implementation for TASK_2025_045',
  prompt: `You are software-architect for TASK_2025_045.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Requirements**: Read task-description.md
**Research**: Read research-report.md

Design the technical implementation plan.
See software-architect.md for detailed instructions.`,
});
```

**Architect Output** (implementation-plan.md excerpt):

```markdown
# Implementation Plan - TASK_2025_045

## Architecture Overview
```

+-------------------+ WebSocket +-------------------+
| VS Code Client | <----------------> | Collaboration |
| (Cursor Display) | | Service (ws) |
+-------------------+ +-------------------+
| |
v v
+-------------------+ +-------------------+
| Cursor Renderer | | Session Manager |
| (Frontend) | | (Backend) |
+-------------------+ +-------------------+

```

## Implementation Tasks

### Backend Tasks (Batch 1)
1. Create WebSocket server service
2. Implement session manager
3. Create cursor broadcast handler

### Frontend Tasks (Batch 2)
4. Create cursor position tracker
5. Implement cursor renderer component
6. Add collaborator list display

### Integration Tasks (Batch 3)
7. Connect frontend to WebSocket service
8. Add reconnection handling
9. Implement graceful disconnection

## Technical Decisions
- Use `ws` library for WebSocket server
- Debounce cursor updates at 50ms
- Use collaborator UUID for cursor identification
```

---

## Checkpoint 1.5: Architecture Validation

**Orchestrator Presents**:

```
USER VALIDATION CHECKPOINT - TASK_2025_045

Architect has created implementation plan.

Summary:
- 3 batches: Backend (3 tasks), Frontend (3 tasks), Integration (3 tasks)
- WebSocket-based architecture using `ws` library
- 50ms debounce for cursor updates

Document: .ptah/specs/TASK_2025_045/implementation-plan.md

Reply "APPROVED" to proceed OR provide feedback for revision.
```

**User Response**: `APPROVED`

---

## Phase 5: Team-Leader MODE 1

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Decompose tasks for TASK_2025_045',
  prompt: `You are team-leader for TASK_2025_045.

**MODE**: 1 - DECOMPOSITION
**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Implementation Plan**: Read implementation-plan.md

Break down the implementation into atomic, batchable tasks.
See team-leader.md for MODE 1 instructions.`,
});
```

**Team-Leader Output**:

```
TASKS.MD CREATED - TASK_2025_045

Created 9 tasks in 3 batches:

Batch 1 - Backend WebSocket (backend-developer):
  1.1 Create WebSocketService class
  1.2 Implement SessionManager
  1.3 Create CursorBroadcastHandler

Batch 2 - Frontend Cursors (frontend-developer):
  2.1 Create CursorPositionTracker service
  2.2 Implement CursorRenderer component
  2.3 Add CollaboratorList component

Batch 3 - Integration (backend-developer):
  3.1 WebSocket client integration
  3.2 Reconnection handling
  3.3 Graceful disconnection

NEXT BATCH ASSIGNED: Batch 1 to backend-developer

[Developer prompt provided]
```

---

## Phase 5: Team-Leader MODE 2 (Loop)

### Batch 1 Execution

**Orchestrator Invokes Backend Developer**:

```typescript
Task({
  subagent_type: 'backend-developer',
  description: 'Implement Batch 1 for TASK_2025_045',
  prompt: `You are backend-developer for TASK_2025_045.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Tasks**: Read tasks.md, find Batch 1 (IN PROGRESS)

Implement all tasks in Batch 1. Update status to IMPLEMENTED when done.
See backend-developer.md for detailed instructions.`,
});
```

**Backend Developer Output**:

```
BATCH 1 IMPLEMENTATION COMPLETE

Files Created:
- libs/backend/collaboration/src/lib/services/websocket.service.ts
- libs/backend/collaboration/src/lib/services/session-manager.service.ts
- libs/backend/collaboration/src/lib/handlers/cursor-broadcast.handler.ts

Build: PASSING
Tasks: 1.1, 1.2, 1.3 marked IMPLEMENTED
```

**Orchestrator Returns to Team-Leader MODE 2**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Verify Batch 1 for TASK_2025_045',
  prompt: `You are team-leader for TASK_2025_045.

**MODE**: 2 - VERIFY + ASSIGN
**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Developer Report**: Backend developer completed Batch 1

Verify implementation, create commit, assign next batch.
See team-leader.md for MODE 2 instructions.`,
});
```

**Team-Leader MODE 2 Output**:

```
BATCH 1 VERIFIED AND COMMITTED

Commit: abc1234 - feat(collaboration): add WebSocket service with session management

Files verified:
- websocket.service.ts: Real implementation, proper error handling
- session-manager.service.ts: Complete session lifecycle
- cursor-broadcast.handler.ts: Efficient broadcasting

NEXT BATCH ASSIGNED: Batch 2 to frontend-developer

[Developer prompt provided]
```

### Batch 2 Execution (Similar flow...)

### Batch 3 Execution (Similar flow...)

---

## Phase 5: Team-Leader MODE 3

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Complete implementation for TASK_2025_045',
  prompt: `You are team-leader for TASK_2025_045.

**MODE**: 3 - COMPLETION
**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045

All batches complete. Perform final verification.
See team-leader.md for MODE 3 instructions.`,
});
```

**Team-Leader MODE 3 Output**:

```
ALL BATCHES COMPLETE - TASK_2025_045

Implementation Summary:
- 3 batches completed
- 9 tasks implemented
- 3 commits created

Commits:
1. abc1234 - feat(collaboration): add WebSocket service with session management
2. def5678 - feat(collaboration): add cursor rendering components
3. ghi9012 - feat(collaboration): integrate WebSocket with reconnection

Build Status: PASSING
All Files: Production-ready

Ready for QA phase.
```

---

## Checkpoint 2: QA Selection

**Orchestrator Presents**:

```
USER CHECKPOINT - QA SELECTION - TASK_2025_045

Implementation complete. Select QA approach:

Options:
- "tester" - Run senior-tester for test creation
- "style" - Run code-style-reviewer
- "logic" - Run code-logic-reviewer
- "reviewers" - Run both reviewers (parallel)
- "all" - Run tester + both reviewers (parallel)
- "skip" - Skip QA, proceed to completion

Reply with your choice.
```

**User Response**: `all`

---

## Phase 6: QA Agents (Parallel)

**Orchestrator Invokes All QA Agents**:

```typescript
// Run in parallel
Promise.all([
  Task({
    subagent_type: 'senior-tester',
    description: 'Test implementation for TASK_2025_045',
    prompt: `You are senior-tester for TASK_2025_045...`,
  }),
  Task({
    subagent_type: 'code-style-reviewer',
    description: 'Review code style for TASK_2025_045',
    prompt: `You are code-style-reviewer for TASK_2025_045...`,
  }),
  Task({
    subagent_type: 'code-logic-reviewer',
    description: 'Review code logic for TASK_2025_045',
    prompt: `You are code-logic-reviewer for TASK_2025_045...`,
  }),
]);
```

**QA Outputs**:

_senior-tester_:

```
TEST REPORT - TASK_2025_045

Tests Created: 15
- WebSocket service: 5 tests
- Session manager: 4 tests
- Cursor renderer: 6 tests

Coverage: 87%
All tests: PASSING
```

_code-style-reviewer_:

```
STYLE REVIEW - TASK_2025_045

Issues Found: 2 (minor)
1. Missing JSDoc on CursorRenderer.render() method
2. Inconsistent import ordering in session-manager.service.ts

Recommendation: Minor fixes, non-blocking
```

_code-logic-reviewer_:

```
LOGIC REVIEW - TASK_2025_045

Issues Found: 0

Completeness: VERIFIED
- All error paths handled
- Reconnection logic covers edge cases
- Memory cleanup on disconnect confirmed
```

---

## Phase 8: Modernization Detector

**Orchestrator Invocation**:

```typescript
Task({
  subagent_type: 'modernization-detector',
  description: 'Analyze future improvements for TASK_2025_045',
  prompt: `You are modernization-detector for TASK_2025_045.

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_2025_045
**Changes**: Review tasks.md for what was implemented

Identify opportunities for future improvements.
See modernization-detector.md for detailed instructions.`,
});
```

**Modernization Detector Output** (future-enhancements.md):

```markdown
# Future Enhancements - TASK_2025_045

## Potential Improvements

### High Priority

1. **Presence Indicators**: Show online/away status for collaborators
2. **Cursor Labels**: Display collaborator names near cursors

### Medium Priority

3. **Cursor Trails**: Optional visual trail for cursor movement
4. **Selection Sharing**: Share text selections, not just cursor position

### Low Priority

5. **Cursor Prediction**: Predict cursor position for smoother display
6. **Bandwidth Optimization**: Binary protocol for cursor updates
```

---

## Workflow Complete

**Orchestrator Final Output**:

```
WORKFLOW COMPLETE - TASK_2025_045

Real-Time Collaboration with Live Cursor Sharing

Summary:
- Strategy: FEATURE (Full Workflow)
- Phases Completed: 8/8
- Tasks: 9/9 complete
- Commits: 3
- Tests: 15 passing (87% coverage)
- Reviews: Style (2 minor), Logic (0 issues)

Documents Created:
- task-description.md
- research-report.md
- implementation-plan.md
- tasks.md
- test-report.md
- code-review.md
- future-enhancements.md

Time Elapsed: ~4 hours
Status: SUCCESS
```
