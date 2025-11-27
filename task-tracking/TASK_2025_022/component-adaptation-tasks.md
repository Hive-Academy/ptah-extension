# Component Adaptation Tasks - TASK_2025_022

**Created**: 2025-11-24
**Task Type**: Frontend Refactoring
**Total Tasks**: 15 tasks
**Total Batches**: 6 batches
**Batching Strategy**: Dependency-based (critical path) + capability-based
**Status**: 0/6 batches complete (0%)
**Estimated Total Effort**: 8 hours (6 hours critical path + 2 hours enhancements)

---

## Overview

This task breakdown addresses frontend component adaptation for RPC Phase 3.5 unified JSONL message streaming. Research identified 42 components, with 11 requiring changes and 3 critical type mismatches blocking compilation.

**Key Metrics**:

- Components scanned: 42
- No changes needed: 31 (74%)
- Changes required: 11 (26%)
- Critical blockers: 3
- EventBus dependencies: 0 (successfully removed)

**Success Criteria**:

- All TypeScript compilation errors resolved
- All 3 critical blockers fixed
- Agent tracking functional
- Permission handling correct
- Real-time UI updates working
- Zero runtime errors

---

## Batch 1: Type System Foundation (Sequential - 1.5h)

**Dependencies**: None (foundation layer)
**Assigned To**: TBD
**Tasks in Batch**: 3
**Estimated Commits**: 3
**Priority**: P0 - CRITICAL PATH

### Task 1.1: Fix AgentTreeNode Interface Type ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts` (lines 16-22)
- MODIFY: `D:\projects\ptah-extension\libs\shared\src\types\agent.types.ts` (if AgentMetadata defined there)

**Specification Reference**: component-adaptation-plan.md:286-333 (BLOCKER 1 - Root Cause Analysis)

**Description**: Fix AgentTreeNode interface to properly type the agent property from `unknown` to `AgentMetadata`. This is the foundation fix for agent-related components.

**Current State**:

```typescript
export interface AgentTreeNode {
  readonly agent: unknown; // TOO GENERIC - CAUSES TYPE ERRORS
  readonly activities: readonly unknown[];
  readonly status: 'running' | 'complete' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;
}
```

**Expected State**:

```typescript
export interface AgentTreeNode {
  readonly agent: AgentMetadata; // FIXED - Properly typed
  readonly activities: readonly unknown[];
  readonly status: 'running' | 'complete' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;
}
```

**Implementation Details**:

- Import AgentMetadata type from chat-state.service.ts or @ptah-extension/shared
- Change `agent: unknown` to `agent: AgentMetadata`
- Verify all consumers of AgentTreeNode can access agent properties

**Quality Requirements**:

- ✅ AgentMetadata import added
- ✅ Interface updated with correct type
- ✅ TypeScript compilation succeeds
- ✅ No breaking changes to existing AgentTreeNode usage

**Expected Commit Pattern**: `refactor(core): fix AgentTreeNode interface to use AgentMetadata type`

**Estimated Time**: 15 minutes

---

### Task 1.2: Create activeAgentNodes Computed Signal ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts`

**Dependencies**: Task 1.1 (requires AgentTreeNode type fix)

**Specification Reference**: component-adaptation-plan.md:302-333 (BLOCKER 1 - Adaptation Strategy Option A)

**Description**: Create computed signal to convert `Map<string, AgentMetadata>` from ChatStateService into `AgentTreeNode[]` array format expected by components.

**Pattern to Follow**: chat.service.ts:61-62 (existing computed signal pattern)

**Implementation Details**:

```typescript
// Add to ChatService class
readonly activeAgentNodes = computed((): readonly AgentTreeNode[] => {
  const agentsMap = this.chatState.activeAgents();
  const nodes: AgentTreeNode[] = [];

  for (const [toolCallId, metadata] of agentsMap.entries()) {
    nodes.push({
      agent: metadata, // Now properly typed after Task 1.1
      activities: [], // Will be populated in Task 1.3
      status: 'running', // Active agents are always running
      duration: Date.now() - metadata.startTime,
      errorMessage: undefined,
    });
  }

  return nodes;
});
```

**Quality Requirements**:

- ✅ Computed signal created with correct signature
- ✅ Handles empty Map gracefully (returns empty array)
- ✅ Converts Map entries to AgentTreeNode array
- ✅ Duration calculated from metadata.startTime
- ✅ TypeScript compilation succeeds
- ✅ Signal reactivity works (updates when activeAgents changes)

**Expected Commit Pattern**: `feat(core): add activeAgentNodes adapter for agent components`

**Estimated Time**: 45 minutes

---

### Task 1.3: Add Agent Activity Tracking to ChatStateService ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat-state.service.ts` (lines 559-582)

**Dependencies**: Task 1.2 (activeAgentNodes signal must exist)

**Specification Reference**: component-adaptation-plan.md:561-609 (Missing State #1 - Agent Activity Tracking)

**Description**: Track agent activities by correlating tool events with parent_tool_use_id. This populates the activities array in AgentTreeNode.

**Implementation Details**:

```typescript
// Add to ChatStateService
private readonly _agentActivities = signal<Map<string, ClaudeToolEvent[]>>(new Map());
readonly agentActivities = this._agentActivities.asReadonly();

// Update handleToolMessage method
handleToolMessage(sessionId: SessionId, message: JSONLToolMessage): void {
  // ... existing logic for toolTimeline ...

  // NEW: Track agent activity
  if (message.parent_tool_use_id) {
    const activities = new Map(this._agentActivities());
    const agentActivities = activities.get(message.parent_tool_use_id) || [];
    agentActivities.push(toolEvent);
    activities.set(message.parent_tool_use_id, agentActivities);
    this._agentActivities.set(activities);
  }
}
```

**Then update Task 1.2's activeAgentNodes**:

```typescript
// In chat.service.ts
readonly activeAgentNodes = computed((): readonly AgentTreeNode[] => {
  const agentsMap = this.chatState.activeAgents();
  const activities = this.chatState.agentActivities(); // NEW
  const nodes: AgentTreeNode[] = [];

  for (const [toolCallId, metadata] of agentsMap.entries()) {
    nodes.push({
      agent: metadata,
      activities: activities.get(toolCallId) || [], // POPULATED NOW
      status: 'running',
      duration: Date.now() - metadata.startTime,
      errorMessage: undefined,
    });
  }

  return nodes;
});
```

**Quality Requirements**:

- ✅ agentActivities signal created
- ✅ handleToolMessage tracks events by parent_tool_use_id
- ✅ Map updates immutably (new Map() created)
- ✅ activeAgentNodes uses agentActivities
- ✅ TypeScript compilation succeeds
- ✅ Activities correctly correlated with agents

**Expected Commit Pattern**: `feat(core): add agent activity tracking for tool events`

**Estimated Time**: 1 hour

---

**Batch 1 Verification Requirements**:

- ✅ All 3 files modified successfully
- ✅ AgentTreeNode interface uses AgentMetadata
- ✅ activeAgentNodes signal exists and compiles
- ✅ agentActivities signal tracks tool events
- ✅ TypeScript compilation: `npm run typecheck:all` passes
- ✅ No breaking changes to existing code

---

## Batch 2: Permission Dialog Type Fix (Sequential - 1h)

**Dependencies**: None (independent from Batch 1)
**Assigned To**: TBD
**Tasks in Batch**: 2
**Estimated Commits**: 2
**Priority**: P0 - CRITICAL PATH

### Task 2.1: Update PermissionDialogComponent Types ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\permission-dialog\permission-dialog.component.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\permission-dialog\permission-dialog.component.html`

**Specification Reference**: component-adaptation-plan.md:377-491 (BLOCKER 2 - Adaptation Strategy Option B)

**Description**: Update PermissionDialogComponent to use ClaudePermissionRequest from shared types instead of local PendingPermission interface.

**Current Type Mismatch**:

```typescript
// Component expects:
interface PendingPermission {
  requestId: string; // WRONG
  type: string; // WRONG
  details: Record<string, unknown>; // WRONG
  timestamp: number;
}

// Service provides:
interface ClaudePermissionRequest {
  toolCallId: string; // CORRECT
  tool: string; // CORRECT
  args: Record<string, unknown>; // CORRECT
  timestamp: number;
}
```

**Implementation Details**:

1. **TypeScript Component Changes**:

```typescript
// Line 1: Add import
import { ClaudePermissionRequest } from '@ptah-extension/shared';

// Line 132: Update input type
permission = input<ClaudePermissionRequest | null>();

// Lines 140-141: Update approval handler
onApprove(): void {
  const permission = this.permission();
  if (permission) {
    this.approve.emit(permission.toolCallId); // CHANGED: requestId → toolCallId
  }
}

// Lines 146-147: Update denial handler
onDeny(): void {
  const permission = this.permission();
  if (permission) {
    this.deny.emit(permission.toolCallId); // CHANGED: requestId → toolCallId
  }
}
```

2. **HTML Template Changes**:

```html
<!-- Line 24: Update tool display -->
<div class="permission-type">{{ permissionData.tool }}</div>

<!-- Lines 27-33: Update args access -->
@if (permissionData.args['path']) {
<div class="permission-detail"><strong>Path:</strong> {{ permissionData.args['path'] }}</div>
} @if (permissionData.args['command']) {
<div class="permission-detail"><strong>Command:</strong> {{ permissionData.args['command'] }}</div>
}
```

**Quality Requirements**:

- ✅ ClaudePermissionRequest imported from @ptah-extension/shared
- ✅ Component input type updated
- ✅ Template uses new property names (tool, args, toolCallId)
- ✅ Event emissions use toolCallId
- ✅ TypeScript compilation succeeds
- ✅ No runtime errors when permission displayed

**Expected Commit Pattern**: `refactor(chat): update PermissionDialogComponent to use ClaudePermissionRequest`

**Estimated Time**: 45 minutes

---

### Task 2.2: Update ChatComponent Permission Handlers ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\containers\chat\chat.component.ts` (lines 625, 630)

**Dependencies**: Task 2.1 (PermissionDialogComponent must emit toolCallId)

**Specification Reference**: component-adaptation-plan.md:487-489 (BLOCKER 2 - Changes Required)

**Description**: Update ChatComponent's permission approval/denial handlers to accept toolCallId instead of requestId.

**Implementation Details**:

```typescript
// Line 625: Update parameter type
handlePermissionApproval(toolCallId: string): void { // CHANGED: requestId → toolCallId
  // Find permission by toolCallId
  const permissions = this.chatService.pendingPermissions();
  const permission = permissions.find(p => p.toolCallId === toolCallId);

  if (permission) {
    this.chatService.approvePermission(permission);
  }
}

// Line 630: Update parameter type
handlePermissionDenial(toolCallId: string): void { // CHANGED: requestId → toolCallId
  const permissions = this.chatService.pendingPermissions();
  const permission = permissions.find(p => p.toolCallId === toolCallId);

  if (permission) {
    this.chatService.denyPermission(permission);
  }
}
```

**Quality Requirements**:

- ✅ Handler parameters use toolCallId
- ✅ Permission lookup uses toolCallId
- ✅ Integration with PermissionDialogComponent works
- ✅ TypeScript compilation succeeds
- ✅ Approve/deny actions function correctly

**Expected Commit Pattern**: `refactor(chat): update permission handlers to use toolCallId`

**Estimated Time**: 15 minutes

---

**Batch 2 Verification Requirements**:

- ✅ All 2 files modified successfully
- ✅ PermissionDialogComponent uses ClaudePermissionRequest
- ✅ ChatComponent handlers accept toolCallId
- ✅ TypeScript compilation: `npm run typecheck:all` passes
- ✅ Permission approval/denial workflow functional

---

## Batch 3: ChatComponent Agent Signal Fix (Depends on Batch 1 - 30min)

**Dependencies**: Batch 1 complete (requires activeAgentNodes)
**Assigned To**: TBD
**Tasks in Batch**: 1
**Estimated Commits**: 1
**Priority**: P0 - CRITICAL PATH

### Task 3.1: Fix ChatComponent agents Signal Usage ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\containers\chat\chat.component.ts` (lines 317-421)
- MODIFY: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts` (lines 45-47)

**Dependencies**: Batch 1 complete (activeAgentNodes must exist)

**Specification Reference**: component-adaptation-plan.md:495-550 (BLOCKER 3)

**Description**: Replace placeholder `_agents` signal in ChatService with activeAgentNodes, update ChatComponent to use new signal.

**Implementation Details**:

1. **Remove Placeholder from ChatService**:

```typescript
// chat.service.ts - DELETE lines 45-47
// REMOVE:
// private readonly _agents = signal<readonly AgentTreeNode[]>([]);
// readonly agents = this._agents.asReadonly();
```

2. **Update ChatComponent**:

```typescript
// chat.component.ts:393-421 - Update computed signal
readonly agentActivitiesForDisplay = computed(() => {
  const agents = this.chatService.activeAgentNodes(); // CHANGED: agents() → activeAgentNodes()
  return agents.map((node) => {
    const metadata = node.agent; // Now properly typed as AgentMetadata
    return {
      agentId: metadata.agentId,
      name: metadata.subagentType ?? 'Unknown Agent',
      status: node.status === 'complete' ? ('completed' as const) : ('running' as const),
      startTime: metadata.startTime,
      endTime: node.status === 'complete' ? metadata.startTime + (node.duration ?? 0) : undefined,
      activity: node.activities.length > 0 ? `Used ${node.activities.length} tools` : undefined,
      result: node.status === 'complete' ? 'Task completed' : undefined,
    };
  });
});
```

**Quality Requirements**:

- ✅ Placeholder \_agents signal removed from ChatService
- ✅ ChatComponent uses activeAgentNodes()
- ✅ agentActivitiesForDisplay properly accesses AgentMetadata properties
- ✅ TypeScript compilation succeeds
- ✅ Agent activities display correctly in UI

**Expected Commit Pattern**: `fix(chat): replace placeholder agents signal with activeAgentNodes`

**Estimated Time**: 30 minutes

---

**Batch 3 Verification Requirements**:

- ✅ Placeholder signals removed
- ✅ ChatComponent uses activeAgentNodes
- ✅ TypeScript compilation: `npm run typecheck:all` passes
- ✅ Agent display functional

---

## Batch 4: Component Integration Updates (Depends on Batch 1 - 45min)

**Dependencies**: Batch 1 complete (requires activeAgentNodes)
**Assigned To**: TBD
**Tasks in Batch**: 2
**Estimated Commits**: 2
**Priority**: P0 - CRITICAL PATH

### Task 4.1: Update AgentStatusBadgeComponent ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\agent-status-badge\agent-status-badge.component.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\containers\chat\chat.component.html` (template line 96)

**Dependencies**: Batch 1 complete (activeAgentNodes must exist)

**Specification Reference**: component-adaptation-plan.md:251-374 (BLOCKER 1 - Component Updates)

**Description**: Verify and update AgentStatusBadgeComponent to use activeAgentNodes signal from ChatService.

**Current State**:

```typescript
// Component line 64
readonly activeAgents = input<readonly AgentTreeNode[]>([]);

// Component lines 119-126
const items = agents.map((node) => {
  const type = node.agent.subagentType; // NOW WORKS (agent is AgentMetadata)
  const duration = node.duration
    ? formatDuration(node.duration)
    : this.getRunningDuration(node.agent.timestamp);
  const status = node.status === 'error' ? ' (error)' : '';
  return `• ${type} (${duration})${status}`;
});
```

**Implementation Details**:

1. **Verify Component Code**: Component should already work after Batch 1 type fix
2. **Update Template Binding**:

```html
<!-- chat.component.html:96 -->
<ptah-agent-status-badge [activeAgents]="chatService.activeAgentNodes()" (togglePanel)="handleAgentPanelToggle()" />
```

**Quality Requirements**:

- ✅ Component receives AgentTreeNode[] with properly typed agent
- ✅ Template binding uses activeAgentNodes()
- ✅ Badge displays agent count correctly
- ✅ Tooltip shows agent details with types and durations
- ✅ TypeScript compilation succeeds
- ✅ No runtime errors

**Expected Commit Pattern**: `fix(chat): connect AgentStatusBadgeComponent to activeAgentNodes`

**Estimated Time**: 30 minutes

---

### Task 4.2: Verify AgentActivityTimelineComponent ⏸️ PENDING

**File(s)**:

- VERIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\agent-activity-timeline\agent-activity-timeline.component.ts`
- VERIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\containers\chat\chat.component.html` (template line 124)

**Dependencies**: Batch 1 complete (activeAgentNodes must exist)

**Specification Reference**: component-adaptation-plan.md:159-204 (Category B - Component 2)

**Description**: Verify AgentActivityTimelineComponent works with agentActivitiesForDisplay from ChatComponent.

**Expected State**: Component already compatible (research found no changes needed)

**Verification Steps**:

1. Read component TypeScript file
2. Confirm input signature matches agentActivitiesForDisplay output
3. Check template binding in chat.component.html
4. Verify no TypeScript errors

**Quality Requirements**:

- ✅ Component input type matches ChatComponent output
- ✅ Template binding correct
- ✅ TypeScript compilation succeeds
- ✅ No changes required (documentation only)

**Expected Commit Pattern**: `docs(chat): verify AgentActivityTimelineComponent compatibility`

**Estimated Time**: 15 minutes

---

**Batch 4 Verification Requirements**:

- ✅ AgentStatusBadgeComponent connected to activeAgentNodes
- ✅ AgentActivityTimelineComponent verified compatible
- ✅ TypeScript compilation: `npm run typecheck:all` passes
- ✅ Both components render without errors

---

## Batch 5: Tool Timeline Enhancement (Optional - Parallel - 20min)

**Dependencies**: None (independent enhancement)
**Assigned To**: TBD
**Tasks in Batch**: 1
**Estimated Commits**: 1
**Priority**: P1 - ENHANCEMENT

### Task 5.1: Create Tool Timeline Adapter ⏸️ PENDING

**File(s)**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\containers\chat\chat.component.ts`

**Specification Reference**: component-adaptation-plan.md:79-155 (Category B - Component 1)

**Description**: Create computed signal to convert ClaudeToolEvent[] from toolTimeline into ToolExecution[] format for ToolTimelineComponent.

**Implementation Details**:

```typescript
// Add to ChatComponent
readonly toolExecutions = computed(() => {
  const timeline = this.chatService.toolTimeline();
  return this.convertToolTimelineToExecutions(timeline);
});

private convertToolTimelineToExecutions(timeline: readonly ClaudeToolEvent[]): ToolExecution[] {
  const execMap = new Map<string, ToolExecution>();

  for (const event of timeline) {
    const existing = execMap.get(event.toolCallId);

    if (event.type === 'start') {
      execMap.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        tool: event.tool || 'unknown',
        args: event.args || {},
        status: 'running',
        startTime: event.timestamp,
      });
    } else if (event.type === 'result' && existing) {
      existing.status = 'success';
      existing.endTime = event.timestamp;
      existing.output = event.output;
      existing.duration = event.duration;
    } else if (event.type === 'error' && existing) {
      existing.status = 'error';
      existing.error = event.error;
      existing.endTime = event.timestamp;
    } else if (event.type === 'progress' && existing) {
      existing.progress = event.message;
    }
  }

  return Array.from(execMap.values());
}
```

**Quality Requirements**:

- ✅ Computed signal aggregates tool events correctly
- ✅ Handles start/result/error/progress event types
- ✅ Returns ToolExecution[] format
- ✅ Status transitions work (running → success/error)
- ✅ TypeScript compilation succeeds

**Expected Commit Pattern**: `feat(chat): add tool timeline adapter for execution display`

**Estimated Time**: 20 minutes

---

**Batch 5 Verification Requirements**:

- ✅ Adapter converts events to executions
- ✅ TypeScript compilation: `npm run typecheck:all` passes
- ✅ Tool timeline displays correctly

---

## Batch 6: Testing & Validation (Sequential - 2h)

**Dependencies**: Batches 1-4 complete (critical path)
**Assigned To**: TBD
**Tasks in Batch**: 3
**Estimated Commits**: 0 (verification only)
**Priority**: P0 - CRITICAL PATH

### Task 6.1: TypeScript Validation ⏸️ PENDING

**File(s)**: All modified files in Batches 1-4

**Specification Reference**: component-adaptation-plan.md:662-676 (Testing Strategy Phase 1)

**Description**: Run TypeScript type checker on all affected files and ensure zero compilation errors.

**Implementation Details**:

```bash
# Run type checker
npm run typecheck:all

# Expected output: 0 errors

# If errors found:
# - Review error messages
# - Identify source file and line
# - Fix type mismatches
# - Re-run typecheck
```

**Files to Verify**:

- libs/frontend/core/src/lib/services/chat.service.ts
- libs/frontend/core/src/lib/services/chat-state.service.ts
- libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts
- libs/frontend/chat/src/lib/components/permission-dialog/permission-dialog.component.ts
- libs/frontend/chat/src/lib/containers/chat/chat.component.ts
- libs/shared/src/types/agent.types.ts (if modified)

**Quality Requirements**:

- ✅ Zero TypeScript errors
- ✅ All libraries compile successfully
- ✅ No type safety regressions
- ✅ Import statements resolve correctly

**Estimated Time**: 30 minutes

---

### Task 6.2: Component Integration Testing ⏸️ PENDING

**File(s)**: Test files for critical components

**Specification Reference**: component-adaptation-plan.md:680-755 (Testing Strategy Phase 2)

**Description**: Manual integration testing of critical components with mock data to verify correct behavior.

**Test Scenarios**:

#### 1. Agent Status Badge

**Test Data**:

```typescript
const mockAgentsMap = new Map([
  [
    'tool-1',
    {
      agentId: 'tool-1',
      subagentType: 'researcher-expert',
      startTime: Date.now() - 30000,
    },
  ],
  [
    'tool-2',
    {
      agentId: 'tool-2',
      subagentType: 'backend-developer',
      startTime: Date.now() - 15000,
    },
  ],
]);
```

**Verification**:

- [ ] Badge displays agent count (2)
- [ ] Badge pulsing animation when active
- [ ] Tooltip shows agent types and durations
- [ ] Click toggles agent panel

#### 2. Permission Dialog

**Test Data**:

```typescript
const mockPermission: ClaudePermissionRequest = {
  toolCallId: 'perm-1',
  tool: 'Bash',
  args: { command: 'npm install' },
  description: 'Execute shell command',
  timestamp: Date.now(),
};
```

**Verification**:

- [ ] Dialog displays when permission set
- [ ] Tool name "Bash" displayed
- [ ] Command argument shown
- [ ] Approve emits toolCallId
- [ ] Deny emits toolCallId

#### 3. Agent Activity Timeline

**Verification**:

- [ ] Timeline displays agent nodes
- [ ] Status badges correct
- [ ] Duration updates in real-time
- [ ] Activities show tool usage

**Quality Requirements**:

- ✅ All critical components render without errors
- ✅ Component inputs/outputs function correctly
- ✅ Real-time updates work
- ✅ User interactions functional
- ✅ No console errors

**Estimated Time**: 1 hour

---

### Task 6.3: Manual UI Smoke Testing ⏸️ PENDING

**File(s)**: Full application (VS Code extension)

**Specification Reference**: component-adaptation-plan.md:766-782 (Testing Strategy Phase 3)

**Description**: Full workflow smoke test to ensure end-to-end functionality.

**Test Cases**:

1. **Extension Load**

   - [ ] Extension activates without errors
   - [ ] Webview opens successfully
   - [ ] No TypeScript errors in console

2. **Start Session**

   - [ ] Session creation works
   - [ ] Empty state displays correctly
   - [ ] No console errors

3. **Send Message**

   - [ ] Message input functional
   - [ ] Message appears in chat
   - [ ] Streaming works in real-time

4. **Tool Execution**

   - [ ] Tool timeline appears
   - [ ] Tool status updates (running → success)
   - [ ] Tool results displayed

5. **Agent Invocation**

   - [ ] Agent badge appears
   - [ ] Agent count increases
   - [ ] Tooltip shows agent details

6. **Permission Request**

   - [ ] Permission dialog appears
   - [ ] Approval/denial functional
   - [ ] Dialog closes after action

7. **Session Switch**
   - [ ] Session switching works
   - [ ] State resets correctly
   - [ ] No state leakage

**Quality Requirements**:

- ✅ No TypeScript errors
- ✅ No runtime errors in console
- ✅ All UI elements render correctly
- ✅ Real-time updates functional
- ✅ User interactions work
- ✅ Session management functional

**Estimated Time**: 30 minutes

---

**Batch 6 Verification Requirements**:

- ✅ TypeScript validation passes
- ✅ Component integration tests pass
- ✅ Manual smoke testing complete
- ✅ Zero critical issues found
- ✅ All acceptance criteria met

---

## Batch Execution Protocol

### Commit Strategy

- **ONE commit per task** (not per batch)
- Each task has clear acceptance criteria
- Commit messages follow conventional commit format
- All commits pushed progressively

### For Each Batch:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer creates commits per task as they complete
4. Developer updates tasks.md after completing batch
5. Developer returns with batch completion report
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

### Completion Criteria:

- All batch statuses are "✅ COMPLETE"
- All task git commits verified
- All files exist and compile
- TypeScript validation passes
- Integration tests pass
- Manual testing complete

---

## Critical Path Summary

**Must Complete for Functional System** (4.5 hours):

1. Batch 1: Type System Foundation (1.5h)
2. Batch 2: Permission Dialog Fix (1h)
3. Batch 3: ChatComponent Agent Fix (30min)
4. Batch 4: Component Integration (45min)
5. Batch 6: Testing & Validation (2h) - subset

**Optional Enhancements** (20 minutes):

- Batch 5: Tool Timeline Adapter (20min)

**Total Estimated Time**: 8 hours (6 hours minimum)

---

## Dependencies Graph

```
Batch 1 (Type Foundation)
  ├─> Batch 3 (ChatComponent - needs activeAgentNodes)
  └─> Batch 4 (Component Integration - needs activeAgentNodes)

Batch 2 (Permission Dialog)
  └─> [Independent - no blockers]

Batch 5 (Tool Timeline)
  └─> [Independent - optional enhancement]

Batch 6 (Testing)
  └─> Requires Batches 1-4 complete
```

---

## Success Metrics

**Definition of Done**:

- [ ] All TypeScript errors resolved (0 errors)
- [ ] All 3 critical blockers fixed
- [ ] Agent status badge displays correctly
- [ ] Permission dialog works with correct types
- [ ] Tool timeline displays execution data
- [ ] Agent activity timeline shows running agents
- [ ] No runtime errors in browser console
- [ ] All computed signals update in real-time
- [ ] Component integration tests pass
- [ ] Manual UI testing complete
- [ ] All 15 tasks completed
- [ ] All 6 batches verified

---

## References

**Architecture Documents**:

- component-adaptation-plan.md - Research findings
- implementation-plan-revised.md - Unified JSONL architecture
- streaming-architecture-philosophy.md - Message-centric philosophy

**Key Files**:

- libs/frontend/core/src/lib/services/chat.service.ts
- libs/frontend/core/src/lib/services/chat-state.service.ts
- libs/frontend/chat/src/lib/containers/chat/chat.component.ts
- libs/shared/src/types/agent.types.ts

**Type Definitions**:

- AgentTreeNode: chat.service.ts:16-22
- AgentMetadata: chat-state.service.ts:123-131
- ClaudeToolEvent: @ptah-extension/shared
- ClaudePermissionRequest: @ptah-extension/shared
