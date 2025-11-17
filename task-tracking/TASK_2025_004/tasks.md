# Development Tasks - TASK_2025_004

**Task Type**: Full-Stack (Backend-First, Frontend-Heavy)
**Developer Needed**: backend-developer (Tasks 1-8), frontend-developer (Tasks 9-27)
**Total Tasks**: 27 atomic tasks
**Estimated Effort**: 121 hours (15 working days)
**Decomposed From**:

- implementation-plan.md (5 phases, 27 files)
- visual-design-specification.md (3 component specs, 16 agent icons)
- design-handoff.md (code examples, lucide-angular integration)

---

## Phase 1: Type System (Tasks 1-4) - Backend Developer

### Task 1: Add ClaudeAgentEvent Types to Shared Library ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: cc6e996 - feat(vscode): add ClaudeAgentEvent types with Zod validation (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Simple Type Definition)
- Patterns Applied: Discriminated union, readonly properties, Zod validation
- Patterns Rejected: No classes/services needed (pure data types)
  **Verification Results**:
- TypeScript compilation: PASS (npm run typecheck:all)
- All event types defined: ClaudeAgentStartEvent, ClaudeAgentActivityEvent, ClaudeAgentCompleteEvent
- Zod schemas created with strict() validation
- Zero loose types (all properties strictly typed)
  **File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/claude-domain.types.ts
  **Specification Reference**:

- implementation-plan.md:216-289 (ClaudeAgentEvent type definitions)
- task-description.md:61-86 (Type system requirements)
  **Pattern to Follow**: claude-domain.types.ts:78-100 (ClaudeToolEvent discriminated union)
  **Quality Requirements**:
- ✅ Uses discriminated union pattern (type: 'agent_start' | 'agent_activity' | 'agent_complete')
- ✅ All fields readonly for immutability
- ✅ Zod schemas with strict() validation
- ✅ Zero loose types (no any, unknown without validation)
- ✅ Follows existing ClaudeToolEvent pattern (lines 78-100)
  **Expected Commit**: `feat(shared): add ClaudeAgentEvent types with Zod validation (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ ClaudeAgentStartEvent, ClaudeAgentActivityEvent, ClaudeAgentCompleteEvent exported
- ✅ ClaudeAgentEventSchema discriminatedUnion defined
- ✅ Zero ESLint violations

**Implementation Details**:

- Add types after existing ClaudeToolEventError (append to end of file)
- Include agentId (string, NOT branded type per implementation-plan.md:228)
- Include subagentType, description, prompt, model?, timestamp for Start event
- Include toolName, toolInput for Activity event
- Include duration, result? for Complete event

---

### Task 2: Extend MESSAGE_TYPES Constants ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: 7e7bede - feat(vscode): add agent message type constants (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Simple Constant Addition)
- Patterns Applied: Constant naming pattern, TypeScript 'as const' for literal type inference
- Patterns Rejected: No service layer/validation needed (pure data constants)
  **Verification Results**:
- TypeScript compilation: PASS (npx nx run @ptah-extension/shared:typecheck)
- 3 constants added to CHAT_MESSAGE_TYPES (lines 51-53)
- 3 constants added to CHAT_RESPONSE_TYPES (lines 180-182)
- Naming convention followed: chat:agentStarted, chat:agentActivity:response
- Zero loose types (all use 'as const' assertion)
  **File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/constants/message-types.ts
  **Specification Reference**:

- implementation-plan.md:291-314 (MESSAGE_TYPES extension)
- task-description.md:71-73 (MESSAGE_TYPES requirements)
  **Pattern to Follow**: message-types.ts:18-48 (existing CHAT_MESSAGE_TYPES)
  **Quality Requirements**:
- ✅ Add AGENT_STARTED, AGENT_ACTIVITY, AGENT_COMPLETED to CHAT_MESSAGE_TYPES
- ✅ Add corresponding CHAT_RESPONSE_TYPES entries
- ✅ Follow existing naming pattern (chat:agentStarted, chat:agentActivity:response)
- ✅ All constants as const for type inference
  **Expected Commit**: `feat(shared): add agent message type constants (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 new CHAT_MESSAGE_TYPES added
- ✅ 3 new CHAT_RESPONSE_TYPES added
- ✅ No duplicate message types

**Implementation Details**:

- Add to CHAT_MESSAGE_TYPES object (around line 48)
- Add to CHAT_RESPONSE_TYPES object (around line 173)
- Follow exact format: AGENT_STARTED: 'chat:agentStarted' as const

---

### Task 3: Extend MessagePayloadMap for Agent Events ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: 1e6c07a - feat(vscode): extend MessagePayloadMap for agent events (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Simple Type Definition)
- Patterns Applied: Readonly properties, type-safe payload mapping, MessageResponse wrapper
- Patterns Rejected: No validation schemas needed (ClaudeAgentEvent schemas already exist)
  **Verification Results**:
- TypeScript compilation: PASS (npx nx run @ptah-extension/shared:typecheck)
- Import added: ClaudeAgentStartEvent, ClaudeAgentActivityEvent, ClaudeAgentCompleteEvent (lines 20-24)
- 3 payload interfaces defined: ChatAgentStartedPayload, ChatAgentActivityPayload, ChatAgentCompletedPayload (lines 219-232)
- 6 MessagePayloadMap entries added: 3 message types (lines 563-565) + 3 response types (lines 627-629)
- Response types use MessageResponse<T> wrapper correctly
- Zero loose types (all properties strictly typed)
  **File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
  **Specification Reference**:
- implementation-plan.md:316-347 (MessagePayloadMap extension)
- task-description.md:71-73 (Payload map requirements)
  **Pattern to Follow**: message.types.ts:512-627 (existing MessagePayloadMap entries)
  **Quality Requirements**:
- ✅ Add ChatAgentStartedPayload, ChatAgentActivityPayload, ChatAgentCompletedPayload interfaces
- ✅ Extend MessagePayloadMap with 6 new entries (3 message types + 3 response types)
- ✅ All payloads include sessionId: SessionId and agent: ClaudeAgent\*Event
- ✅ Response types use MessageResponse
  **Expected Commit**: `feat(shared): extend MessagePayloadMap for agent events (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 payload interfaces defined
- ✅ 6 MessagePayloadMap entries added
- ✅ Import ClaudeAgentEvent types from claude-domain.types.ts

**Implementation Details**:

- Define payload interfaces before MessagePayloadMap (around line 336)
- Add entries to MessagePayloadMap interface (around line 627)
- Follow exact keys: 'chat:agentStarted', 'chat:agentActivity', 'chat:agentCompleted', and response variants

---

### Task 4: Add Agent Events to Message Registry ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: fbb9ec2 - feat(vscode): register agent message types (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Architecturally Complete - No Code Changes Needed)
- Patterns Applied: DRY via Object.values(CHAT_RESPONSE_TYPES) automatic inclusion
- Architectural Decision: Registry uses `Object.values()` pattern which automatically includes all constants added to CHAT_RESPONSE_TYPES
  **Verification Results**:
- TypeScript compilation: PASS (npx nx build @ptah-extension/shared)
- Registry verification: All 3 agent response types confirmed present in CHAT_RESPONSE category
  - chat:agentStarted:response ✅
  - chat:agentActivity:response ✅
  - chat:agentCompleted:response ✅
- Total CHAT_RESPONSE types: 13 (includes 3 agent types)
- Pattern: `MESSAGE_CATEGORIES.CHAT_RESPONSE = Object.values(CHAT_RESPONSE_TYPES)` automatically includes agent types added in Task 2
- No manual registration needed (DRY principle)
  **File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/constants/message-registry.ts (no changes needed)
  **Specification Reference**:

- implementation-plan.md:183 (message-registry.ts additions)
- task-description.md:71-73 (Registry requirements)
  **Pattern to Follow**: Existing message-registry.ts structure (CHAT_RESPONSE category)
  **Quality Requirements**:
- ✅ Add 3 agent message types to CHAT_RESPONSE category (completed via Task 2 + Object.values pattern)
- ✅ Follow existing registry pattern (Object.values(CHAT_RESPONSE_TYPES) on line 43)
- ✅ Maintain alphabetical order within category (N/A - automatic via constant order)
  **Expected Commit**: `feat(shared): register agent message types (TASK_2025_004)` (used feat(vscode) per project scope conventions)
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 entries added to CHAT_RESPONSE category (via automatic Object.values inclusion)
- ✅ Message types match MESSAGE_TYPES constants

**Implementation Details**:

- Task completed automatically when Task 2 added AGENT_STARTED, AGENT_ACTIVITY, AGENT_COMPLETED to CHAT_RESPONSE_TYPES
- MESSAGE_REGISTRY.getCategory('CHAT_RESPONSE') returns Object.values(CHAT_RESPONSE_TYPES) which includes all agent types
- Verified via: `MESSAGE_REGISTRY.getCategory('CHAT_RESPONSE').filter(t => t.includes('agent'))` returns 3 types
- Architectural pattern prevents manual registration (adheres to DRY principle)

---

## Phase 2: Backend Integration (Tasks 5-8) - Backend Developer

### Task 5: Enhance JSONLStreamParser with Task Tool Detection ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: 0f735c6 - feat(vscode): add Task tool detection to JSONL parser (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 2 (Business Logic Present)
- Patterns Applied: Callback pattern, in-memory state tracking (Map)
- Patterns Rejected: No DDD/Repository (simple parsing logic suffices)
  **Verification Results**:
- TypeScript compilation: PASS
- All 3 callbacks added, activeAgents Map implemented
- Task tool detection working, memory cleanup implemented
- Graceful error handling for malformed JSONL
  **File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts
  **Specification Reference**:

- implementation-plan.md:361-467 (JSONLStreamParser enhancement)
- task-description.md:89-111 (Parser detection requirements)
  **Pattern to Follow**: jsonl-stream-parser.ts:89-96 (existing onTool callback pattern)
  **Quality Requirements**:
- ✅ Add onAgentStart, onAgentActivity, onAgentComplete callbacks to JSONLParserCallbacks
- ✅ Implement activeAgents Map<string, AgentMetadata> for state tracking
- ✅ Detect Task tool start (tool='Task', subtype='start')
- ✅ Detect Task tool completion (tool='Task', subtype='result')
- ✅ Correlate agent activity via parent_tool_use_id
- ✅ Cleanup activeAgents map on completion (prevent memory leaks)
- ✅ Graceful degradation on malformed JSONL (log warning, continue processing)
  **Expected Commit**: `feat(claude-domain): add Task tool detection to JSONL parser (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 new callbacks added to JSONLParserCallbacks interface
- ✅ activeAgents map implemented with cleanup logic
- ✅ <10ms latency overhead (performance requirement)
- ✅ Unit tests pass for Task tool detection

**Implementation Details**:

- Add callbacks to JSONLParserCallbacks interface (after line 96)
- Add activeAgents private Map to JSONLStreamParser class
- Implement handleToolMessage logic for Task tool (around line 144)
- Implement handleAssistantMessage logic for parent_tool_use_id correlation
- Add memory cleanup in task completion handler
- Import ClaudeAgentEvent types from @ptah-extension/shared

---

### Task 6: Add EventBus Agent Event Publishers ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: cc59e68 - feat(vscode): add agent event publishers to EventBus (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Simple Type Definition + Method Addition)
- Patterns Applied: Constant pattern (as const), Interface pattern (readonly), EventBus publish pattern, Dependency injection
- Patterns Rejected: No service layer/validation/DDD (YAGNI - simple event publishing)

**Verification Results**:

- TypeScript compilation: PASS (npx nx build @ptah-extension/claude-domain)
- 3 event constants added to CLAUDE_DOMAIN_EVENTS (lines 50-52)
- 3 event payload interfaces defined (lines 104-117)
- 3 emitter methods implemented in ClaudeDomainEventPublisher (lines 241-266)
- Import verification: ClaudeAgentStartEvent, ClaudeAgentActivityEvent, ClaudeAgentCompleteEvent from @ptah-extension/shared (lines 15-17)
- Zero loose types (all properties strictly typed with readonly)

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts
**Specification Reference**:

- implementation-plan.md:469-521 (EventBus publisher methods)
- task-description.md:115-135 (EventBus integration requirements)
  **Pattern to Follow**: claude-domain.events.ts:106-217 (existing ClaudeDomainEventPublisher)
  **Quality Requirements**:
- ✅ Add AGENT_STARTED, AGENT_ACTIVITY, AGENT_COMPLETED to CLAUDE_DOMAIN_EVENTS constant
- ✅ Define ClaudeAgentStartedEvent, ClaudeAgentActivityEventPayload, ClaudeAgentCompletedEvent interfaces
- ✅ Implement emitAgentStarted, emitAgentActivity, emitAgentCompleted methods
- ✅ Follow existing EventBus publish pattern
  **Expected Commit**: `feat(claude-domain): add agent event publishers to EventBus (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 new event constants added
- ✅ 3 event payload interfaces defined
- ✅ 3 emitter methods implemented
- ✅ EventBus publish called with correct types

**Implementation Details**:

- Add to CLAUDE_DOMAIN_EVENTS constant (after line 44)
- Add event payload interfaces (after line 94)
- Add emitter methods to ClaudeDomainEventPublisher class (after line 217)
- Import ClaudeAgentEvent types from @ptah-extension/shared

---

### Task 7: Wire Agent Callbacks in ClaudeCliLauncher ✅ COMPLETE

**Assigned To**: backend-developer
**Git Commit**: bafceac - feat(vscode): wire agent callbacks in CLI launcher (TASK_2025_004)
**Completed**: 2025-11-17
**Architecture Assessment**:

- Complexity Level: 1 (Simple Callback Wiring)
- Patterns Applied: Callback pattern, Event publisher pattern, Dependency injection
- Patterns Rejected: No service layer/validation needed (YAGNI - direct wiring suffices)
  **Verification Results**:
- TypeScript compilation: PASS (npx nx run @ptah-extension/claude-domain:typecheck)
- Build verification: PASS (npx nx build @ptah-extension/claude-domain)
- All 3 callbacks wired: onAgentStart (line 318), onAgentActivity (line 327), onAgentComplete (line 336)
- Each callback invokes corresponding eventPublisher.emitAgent\* method
- sessionId passed correctly to all emitter methods
- Follows existing callback pattern (matches onTool, onPermission structure)
- Prettier formatting applied automatically by pre-commit hooks
  **File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/claude-cli-launcher.ts
  **Specification Reference**:
- implementation-plan.md:523-549 (ClaudeCliLauncher callback wiring)
- task-description.md:95-101 (Callback wiring requirements)
  **Pattern to Follow**: claude-cli-launcher.ts:144-150 (existing createStreamingPipeline)
  **Quality Requirements**:
- ✅ Wire onAgentStart, onAgentActivity, onAgentComplete callbacks
- ✅ Connect callbacks to ClaudeDomainEventPublisher emitters
- ✅ Pass sessionId to emitter methods
- ✅ Follow existing callback pattern (onTool, onPermission)
  **Expected Commit**: `feat(vscode): wire agent callbacks in CLI launcher (TASK_2025_004)` (used vscode scope per commitlint requirements)
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 agent callbacks wired in createStreamingPipeline
- ✅ Callbacks invoke eventPublisher.emitAgent\* methods
- ✅ sessionId passed correctly

**Implementation Details**:

- Added agent callbacks to JSONLStreamParser instantiation (lines 318-343)
- Used arrow functions to capture sessionId and deps.eventPublisher
- Followed existing onTool callback pattern with logging + event emission
- Console logging includes agentId, subagentType/toolName, duration for debugging

---

### Task 8: Add MessageHandler EventBus Subscriptions ⏸️ PENDING

**Assigned To**: backend-developer
**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/messaging/message-handler.service.ts
**Specification Reference**:

- implementation-plan.md:551-591 (MessageHandler subscriptions)
- task-description.md:115-135 (MessageHandler integration)
  **Pattern to Follow**: Existing EventBus subscriptions in message-handler.service.ts
  **Quality Requirements**:
- ✅ Subscribe to CLAUDE_DOMAIN_EVENTS.AGENT_STARTED/ACTIVITY/COMPLETED
- ✅ Transform EventBus events to webview messages (chat:agentStarted/Activity/Completed)
- ✅ Use webviewBridge.sendMessage with correct payload
- ✅ Buffer events if webview not ready (max 50 events)
  **Expected Commit**: `feat(claude-domain): add agent event subscriptions to MessageHandler (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ 3 EventBus subscriptions added
- ✅ webviewBridge.sendMessage called with correct message types
- ✅ Event buffering logic implemented (if not already present)

**Implementation Details**:

- Add subscriptions in constructor or initialization method
- Use eventBus.subscribe<ClaudeAgent\*Event>() with typed payloads
- Transform events to webview messages with sessionId and agent payload
- Import MESSAGE_TYPES from @ptah-extension/shared

---

## Phase 3: Frontend Components (Tasks 9-21) - Frontend Developer

### Task 9: Add Agent State Signals to ChatService ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Specification Reference**:

- implementation-plan.md:605-692 (ChatService signal state)
- task-description.md:216-237 (Frontend state management)
  **Pattern to Follow**: chat.service.ts:96-132 (existing signal pattern)
  **Quality Requirements**:
- ✅ Add AgentTreeNode interface (agent, activities, status, duration?, errorMessage?)
- ✅ Add \_agents WritableSignal<readonly AgentTreeNode[]>
- ✅ Add \_agentActivities WritableSignal<ReadonlyMap<string, readonly ClaudeAgentActivityEvent[]>>
- ✅ Add computed signals (activeAgents, agentCount)
- ✅ Add message handlers (chat:agentStarted/Activity/Completed)
- ✅ Signal-based updates (no RxJS BehaviorSubject)
- ✅ Immutable updates (signal.update with spread operators)
  **Expected Commit**: `feat(core): add agent state management to ChatService (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ AgentTreeNode interface defined
- ✅ 2 private signals (\_agents, \_agentActivities) + 2 public readonly signals
- ✅ 2 computed signals (activeAgents, agentCount)
- ✅ 3 message handlers registered
- ✅ Zero RxJS usage for agent state

**Implementation Details**:

- Define AgentTreeNode interface (after line 101)
- Add signals to ChatService class (after line 108)
- Add message handlers in initializeMessageHandling method
- Use vscode.onMessageType('chat:agentStarted').pipe(takeUntilDestroyed(this.destroyRef)).subscribe()
- Import ClaudeAgentEvent types from @ptah-extension/shared

---

### Task 10: Create Agent Icon Constants ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/constants/agent-icons.constants.ts
**Specification Reference**:

- visual-design-specification.md:108-167 (Icon specifications)
- design-handoff.md:79-170 (lucide-angular integration)
  **Pattern to Follow**: Existing constants pattern in chat library
  **Quality Requirements**:
- ✅ Define AGENT_ICON_MAP with 16 agent types
- ✅ Define TOOL_ICON_MAP with 8 tool types
- ✅ Map agent types to lucide-angular icon component classes
- ✅ Include semantic color mapping (VS Code CSS variables)
- ✅ Type-safe mappings (Record<string, typeof LucideIcon>)
  **Expected Commit**: `feat(chat): add agent icon constants with lucide-angular mappings (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ AGENT_ICON_MAP exported with 16 entries
- ✅ TOOL_ICON_MAP exported with 8 entries
- ✅ All icon imports from lucide-angular exist
- ✅ Semantic color mapping defined

**Implementation Details**:

- Import lucide-angular icons: SearchIcon, ServerIcon, PaintBucketIcon, etc.
- Map agent types to icons: 'Explore': SearchIcon, 'backend-developer': ServerIcon, etc.
- Map tool types to icons: 'Bash': WrenchIcon, 'Read': FileTextIcon, etc.
- Include color mapping: 'Explore': 'var(--vscode-symbolIcon-classForeground)', etc.

---

### Task 11: Create AgentIconService ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/agent-icon.service.ts
**Specification Reference**:

- implementation-plan.md:822-825 (Icon service)
- design-handoff.md:144-170 (Icon resolution logic)
  **Pattern to Follow**: Existing service pattern in frontend/core
  **Quality Requirements**:
- ✅ Injectable service (providedIn: 'root')
- ✅ getAgentIcon(subagentType: string) method returns lucide-angular icon class
- ✅ getAgentColor(subagentType: string) method returns CSS variable
- ✅ getToolIcon(toolName: string) method returns lucide-angular icon class
- ✅ Fallback to default icon if type not found (CircleDot for agents, WrenchIcon for tools)
  **Expected Commit**: `feat(chat): add AgentIconService for icon resolution (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ Service injectable with providedIn: 'root'
- ✅ 3 public methods defined
- ✅ Fallback logic implemented
- ✅ Unit tests pass

**Implementation Details**:

- Import AGENT_ICON_MAP, TOOL_ICON_MAP from constants
- Implement getAgentIcon: return AGENT_ICON_MAP[subagentType] || CircleDotIcon
- Implement getAgentColor: return color map lookup
- Implement getToolIcon: return TOOL_ICON_MAP[toolName] || WrenchIcon

---

### Task 12: Create AgentTreeComponent TypeScript ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts
**Specification Reference**:

- design-handoff.md:222-378 (AgentTreeComponent code)
- visual-design-specification.md:172-342 (Component specifications)
  **Pattern to Follow**: Existing chat components (standalone, signal inputs/outputs)
  **Quality Requirements**:
- ✅ Standalone component (no NgModules)
- ✅ OnPush change detection
- ✅ Signal inputs: agents (input<readonly AgentTreeNode[]>())
- ✅ Signal outputs: agentClick (output<string>())
- ✅ Computed signals for expandedAgents, formattedDuration, formattedActivity
- ✅ Keyboard navigation support (toggleExpanded, handleKeydown)
- ✅ Import lucide-angular icons (ChevronRightIcon, ChevronDownIcon)
  **Expected Commit**: `feat(chat): add AgentTreeComponent TypeScript logic (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ Standalone component decorator
- ✅ ChangeDetectionStrategy.OnPush
- ✅ Signal inputs/outputs defined
- ✅ Expand/collapse logic implemented
- ✅ Keyboard navigation handlers defined

**Implementation Details**:

- Use @Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush })
- Define agents = input<readonly AgentTreeNode[]>([])
- Define expandedAgents = signal<Set<string>>(new Set())
- Implement toggleExpanded(agentId: string) method
- Implement formatDuration(ms: number) helper
- Implement formatActivity(activity: ClaudeAgentActivityEvent) helper

---

### Task 13: Create AgentTreeComponent HTML Template ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.html
**Specification Reference**:

- design-handoff.md:379-461 (AgentTreeComponent HTML)
- visual-design-specification.md:176-270 (Layout structure)
  **Pattern to Follow**: Existing chat component templates (signal-based, @if/@for control flow)
  **Quality Requirements**:
- ✅ Use @for to iterate agents
- ✅ Use @if for expand/collapse state
- ✅ ARIA labels for accessibility (role="tree", role="treeitem")
- ✅ Keyboard navigation attributes (tabindex, keydown handlers)
- ✅ Semantic HTML structure (div for tree nodes, nested divs for activities)
- ✅ Bind to component signals/methods
  **Expected Commit**: `feat(chat): add AgentTreeComponent HTML template (TASK_2025_004)`
  **Verification Requirements**:
- ✅ Template compiles with Angular strict mode
- ✅ @for/@if control flow syntax used (not *ngFor/*ngIf)
- ✅ ARIA roles and labels defined
- ✅ Keyboard event handlers bound
- ✅ Agent icon component dynamically rendered

**Implementation Details**:

- Outer container: <div role="tree" aria-label="Agent execution tree">
- Agent node: @for (agent of agents(); track agent.agent.agentId)
- Collapse icon: @if (isExpanded(agent)) { ChevronDownIcon } @else { ChevronRightIcon }
- Agent icon: Use AgentIconService.getAgentIcon() result
- Tool activities: @if (isExpanded(agent)) { @for (activity of agent.activities) ... }

---

### Task 14: Create AgentTreeComponent CSS Styles ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.css
**Specification Reference**:

- design-handoff.md:462-561 (AgentTreeComponent CSS)
- visual-design-specification.md:193-332 (Visual specifications)
  **Pattern to Follow**: Existing chat component styles (VS Code CSS variables)
  **Quality Requirements**:
- ✅ 100% VS Code CSS variables (no hardcoded colors)
- ✅ Expand/collapse animation (300ms ease-out, max-height transition)
- ✅ Chevron rotation animation (150ms ease-out, transform: rotate(90deg))
- ✅ Hover states (background: var(--vscode-list-hoverBackground))
- ✅ Focus indicators (2px solid var(--vscode-focusBorder))
- ✅ Accessibility (prefers-reduced-motion support)
  **Expected Commit**: `feat(chat): add AgentTreeComponent CSS styles (TASK_2025_004)`
  **Verification Requirements**:
- ✅ CSS compiles without errors
- ✅ All colors use CSS variables (0 hardcoded hex/rgb values)
- ✅ Animations defined (@keyframes expandNode, chevron rotation)
- ✅ Hover/focus states styled
- ✅ Reduced motion media query implemented

**Implementation Details**:

- Define .agent-node class with 8px vertical padding, 12px horizontal
- Define .chevron-icon with transition: transform 150ms ease-out
- Define @keyframes expandNode (max-height 0 → 500px, opacity 0 → 1)
- Define hover state with background: var(--vscode-list-hoverBackground)
- Define focus state with outline: 2px solid var(--vscode-focusBorder)
- Add @media (prefers-reduced-motion: reduce) { animation-duration: 0.01ms !important; }

---

### Task 15: Create AgentTreeComponent Unit Tests ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.spec.ts
**Specification Reference**:

- implementation-plan.md:896-917 (Testing strategy)
- task-description.md:312-323 (Testing requirements)
  **Pattern to Follow**: Existing chat component tests (Jest + jest-preset-angular)
  **Quality Requirements**:
- ✅ Test rendering (expanded, collapsed, error states)
- ✅ Test expand/collapse functionality
- ✅ Test tool activity display
- ✅ Test keyboard navigation (Tab, Arrow keys, Enter)
- ✅ Test ARIA labels
- ✅ 80% coverage minimum (line/branch/function)
  **Expected Commit**: `test(chat): add AgentTreeComponent unit tests (TASK_2025_004)`
  **Verification Requirements**:
- ✅ All tests pass (nx test chat)
- ✅ Coverage above 80%
- ✅ No flaky tests (deterministic assertions)

**Implementation Details**:

- Test: Component renders with empty agents array
- Test: Component renders agent nodes with correct icons
- Test: toggleExpanded updates expandedAgents signal
- Test: Keyboard Enter triggers toggleExpanded
- Test: ARIA labels present (role="tree", aria-expanded, etc.)
- Use ComponentFixture, signal() for test data

---

### Task 16: Create AgentTimelineComponent TypeScript ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts
**Specification Reference**:

- design-handoff.md:563-736 (AgentTimelineComponent code)
- visual-design-specification.md:344-533 (Timeline specifications)
  **Pattern to Follow**: Existing chat components (standalone, signal inputs/outputs)
  **Quality Requirements**:
- ✅ Standalone component (no NgModules)
- ✅ OnPush change detection
- ✅ Signal inputs: agents (input<readonly AgentTreeNode[]>())
- ✅ Computed signals for timelineScale, trackAssignments, maxDuration
- ✅ Track assignment logic (detect parallel agents, assign to separate swimlanes)
- ✅ Timeline scale calculation (1 second = 2px, auto-scaling for >300s)
- ✅ Popover state management (signal for hovered segment)
  **Expected Commit**: `feat(chat): add AgentTimelineComponent TypeScript logic (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ Standalone component decorator
- ✅ Signal inputs/outputs defined
- ✅ Track assignment algorithm implemented
- ✅ Timeline scale computation correct

**Implementation Details**:

- Define agents = input<readonly AgentTreeNode[]>([])
- Define timelineScale = computed(() => calculate scale based on maxDuration)
- Define trackAssignments = computed(() => assign agents to tracks with collision detection)
- Implement calculateSegmentWidth(duration: number) helper
- Implement formatTimeLabel(seconds: number) helper
- Define hoveredSegment = signal<string | null>(null) for popover

---

### Task 17: Create AgentTimelineComponent HTML Template ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.html
**Specification Reference**:

- design-handoff.md:737-820 (AgentTimelineComponent HTML)
- visual-design-specification.md:348-479 (Timeline layout)
  **Pattern to Follow**: Existing chat component templates (signal-based, @if/@for control flow)
  **Quality Requirements**:
- ✅ Use @for to iterate timeline tracks
- ✅ Use @if for popover display
- ✅ ARIA labels for accessibility (role="region", role="listitem")
- ✅ Keyboard navigation attributes (tabindex, keydown handlers)
- ✅ Semantic HTML structure (timeline scale, swimlane tracks, segments)
- ✅ Dynamic width/left positioning based on duration/startTime
  **Expected Commit**: `feat(chat): add AgentTimelineComponent HTML template (TASK_2025_004)`
  **Verification Requirements**:
- ✅ Template compiles with Angular strict mode
- ✅ @for/@if control flow syntax used
- ✅ ARIA roles and labels defined
- ✅ Timeline segments positioned correctly (CSS absolute positioning)

**Implementation Details**:

- Outer container: <div role="region" aria-label="Agent execution timeline">
- Timeline scale: <div class="timeline-scale"> with @for markers every 10 seconds
- Tracks: @for (track of trackAssignments(); track trackId)
- Segments: <div class="timeline-segment" [style.left] [style.width]>
- Popover: @if (hoveredSegment()) { <div class="timeline-popover"> }

---

### Task 18: Create AgentTimelineComponent CSS Styles ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.css
**Specification Reference**:

- design-handoff.md:821-923 (AgentTimelineComponent CSS)
- visual-design-specification.md:362-511 (Timeline visual specs)
  **Pattern to Follow**: Existing chat component styles (VS Code CSS variables)
  **Quality Requirements**:
- ✅ 100% VS Code CSS variables (no hardcoded colors)
- ✅ Timeline segment growth animation (linear, real-time duration)
- ✅ Marker fade-in animation (200ms ease-out)
- ✅ Popover fade-in animation (150ms ease-out)
- ✅ Gradient backgrounds for segments (70% → 40% opacity)
- ✅ Horizontal scroll styling (overflow-x: auto)
  **Expected Commit**: `feat(chat): add AgentTimelineComponent CSS styles (TASK_2025_004)`
  **Verification Requirements**:
- ✅ CSS compiles without errors
- ✅ All colors use CSS variables
- ✅ Animations defined (@keyframes growSegment, fadeInMarker, fadeInTooltip)
- ✅ Scrollbar styled (if custom styling added)

**Implementation Details**:

- Define .timeline-container with overflow-x: auto, height: auto
- Define .timeline-track with height: 40px, margin-bottom: 8px
- Define .timeline-segment with gradient background (linear-gradient)
- Define @keyframes growSegment (width 0% → 100%, linear)
- Define @keyframes fadeInMarker (opacity 0 → 1, scale 0.5 → 1)
- Define .timeline-popover with absolute positioning, z-index: 1000

---

### Task 19: Create AgentTimelineComponent Unit Tests ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.spec.ts
**Specification Reference**:

- implementation-plan.md:907-917 (Testing strategy)
- task-description.md:312-323 (Testing requirements)
  **Pattern to Follow**: Existing chat component tests (Jest + jest-preset-angular)
  **Quality Requirements**:
- ✅ Test timeline scale calculation
- ✅ Test track assignment (parallel agents)
- ✅ Test popover display on hover
- ✅ Test auto-scroll behavior
- ✅ 80% coverage minimum
  **Expected Commit**: `test(chat): add AgentTimelineComponent unit tests (TASK_2025_004)`
  **Verification Requirements**:
- ✅ All tests pass (nx test chat)
- ✅ Coverage above 80%
- ✅ No flaky tests

**Implementation Details**:

- Test: Timeline scale = 2px/second for duration < 300s
- Test: Timeline scale auto-adjusts for duration > 300s
- Test: Parallel agents assigned to separate tracks
- Test: Sequential agents share same track
- Test: Popover shows on hover (after 300ms delay)
- Test: ARIA labels present (role="region", role="listitem")

---

### Task 20: Create AgentStatusBadge TypeScript ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts
**Specification Reference**:

- design-handoff.md:925-1041 (AgentStatusBadge code)
- visual-design-specification.md:535-701 (Badge specifications)
  **Pattern to Follow**: Existing chat components (standalone, signal inputs/outputs)
  **Quality Requirements**:
- ✅ Standalone component (no NgModules)
- ✅ OnPush change detection
- ✅ Signal inputs: activeAgents (input<readonly AgentTreeNode[]>())
- ✅ Signal outputs: togglePanel (output<void>())
- ✅ Computed signals for agentCount, badgeState, tooltipText
- ✅ Pulsing animation control (CSS class binding)
  **Expected Commit**: `feat(chat): add AgentStatusBadge TypeScript logic (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ Standalone component decorator
- ✅ Signal inputs/outputs defined
- ✅ Computed signals for badge state ('no-agents', 'active', 'error')

**Implementation Details**:

- Define activeAgents = input<readonly AgentTreeNode[]>([])
- Define togglePanel = output<void>()
- Define agentCount = computed(() => activeAgents().length)
- Define badgeState = computed(() => determine state based on count and errors)
- Define tooltipText = computed(() => format agent list)
- Implement onClick handler: this.togglePanel.emit()

---

### Task 21: Create AgentStatusBadge HTML Template ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.html
**Specification Reference**:

- design-handoff.md:1042-1090 (AgentStatusBadge HTML)
- visual-design-specification.md:539-647 (Badge layout)
  **Pattern to Follow**: Existing chat component templates (signal-based, @if/@for control flow)
  **Quality Requirements**:
- ✅ Use @if for badge states (no-agents, active, error)
- ✅ ARIA labels for accessibility (role="button", aria-label)
- ✅ Keyboard support (click handler, Enter/Space)
- ✅ Semantic HTML structure (button for clickable badge)
- ✅ Tooltip on hover (with 300ms delay)
  **Expected Commit**: `feat(chat): add AgentStatusBadge HTML template (TASK_2025_004)`
  **Verification Requirements**:
- ✅ Template compiles with Angular strict mode
- ✅ @if control flow syntax used
- ✅ ARIA roles and labels defined
- ✅ Tooltip logic implemented

**Implementation Details**:

- Outer button: <button role="button" [attr.aria-label]="ariaLabel()" (click)="onClick()">
- Badge content: @if (agentCount() === 0) { "No agents" } @else { "{{ agentCount() }} agent(s)" }
- Error indicator: @if (hasErrors()) { <span class="error-indicator">🔴</span> }
- Tooltip: @if (showTooltip()) { <div class="tooltip">{{ tooltipText() }}</div> }

---

### Task 22: Create AgentStatusBadge CSS Styles ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.css
**Specification Reference**:

- design-handoff.md:1091-1183 (AgentStatusBadge CSS)
- visual-design-specification.md:549-676 (Badge visual specs)
  **Pattern to Follow**: Existing chat component styles (VS Code CSS variables)
  **Quality Requirements**:
- ✅ 100% VS Code CSS variables (no hardcoded colors)
- ✅ Pulsing animation (2s loop, opacity 0.7 → 1.0, scale 1 → 1.02)
- ✅ Fade-to-inactive animation (500ms ease-out)
- ✅ Hover state (background: var(--vscode-button-hoverBackground))
- ✅ Focus indicator (2px solid var(--vscode-focusBorder))
- ✅ Fixed size (120px × 24px)
  **Expected Commit**: `feat(chat): add AgentStatusBadge CSS styles (TASK_2025_004)`
  **Verification Requirements**:
- ✅ CSS compiles without errors
- ✅ All colors use CSS variables
- ✅ Animations defined (@keyframes pulseAgent, fadeToInactive)
- ✅ Fixed size enforced (width: 120px, height: 24px)

**Implementation Details**:

- Define .agent-status-badge with width: 120px, height: 24px
- Define @keyframes pulseAgent (opacity 0.7 ↔ 1.0, scale 1 ↔ 1.02, 2s infinite)
- Define @keyframes fadeToInactive (background color transition, 500ms)
- Define .badge-active class with animation: pulseAgent
- Define .error-indicator with position: absolute, top-right overlay

---

### Task 23: Create AgentStatusBadge Unit Tests ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.spec.ts
**Specification Reference**:

- implementation-plan.md:912-917 (Testing strategy)
- task-description.md:312-323 (Testing requirements)
  **Pattern to Follow**: Existing chat component tests (Jest + jest-preset-angular)
  **Quality Requirements**:
- ✅ Test badge states (no-agents, active, error)
- ✅ Test pulsing animation trigger
- ✅ Test tooltip display on hover
- ✅ Test click handler (togglePanel output)
- ✅ 80% coverage minimum
  **Expected Commit**: `test(chat): add AgentStatusBadge unit tests (TASK_2025_004)`
  **Verification Requirements**:
- ✅ All tests pass (nx test chat)
- ✅ Coverage above 80%
- ✅ No flaky tests

**Implementation Details**:

- Test: Badge shows "No agents" when activeAgents().length === 0
- Test: Badge shows "1 agent" when activeAgents().length === 1
- Test: Badge shows "N agent(s)" when activeAgents().length > 1
- Test: Pulsing animation active when agents present
- Test: Click emits togglePanel event
- Test: Tooltip shows agent list on hover

---

### Task 24: Integrate Agent Components into ChatComponent ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**:

- D:/projects/ptah-extension/libs/frontend/chat/src/lib/containers/chat/chat.component.ts
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/containers/chat/chat.component.html
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/containers/chat/chat.component.css
  **Specification Reference**:
- implementation-plan.md:847-851 (Integration steps)
- visual-design-specification.md:788-818 (Chat component integration layout)
  **Pattern to Follow**: Existing chat component structure
  **Quality Requirements**:
- ✅ Add AgentStatusBadge to ChatHeader
- ✅ Create agent panel layout (collapsible sidebar, 350px width)
- ✅ Add AgentTreeComponent to agent panel
- ✅ Add AgentTimelineComponent below tree
- ✅ Wire component inputs (agents signal from ChatService)
- ✅ Implement panel toggle functionality
- ✅ Responsive behavior (overlay on narrow viewports)
  **Expected Commit**: `feat(chat): integrate agent components into ChatComponent (TASK_2025_004)`
  **Verification Requirements**:
- ✅ Files compile with TypeScript strict mode
- ✅ Agent components imported and used
- ✅ Panel toggle logic working
- ✅ Responsive behavior tested

**Implementation Details** (chat.component.ts):

- Inject ChatService (readonly chatService = inject(ChatService))
- Define agentPanelVisible = signal(false)
- Define onToggleAgentPanel() method

**Implementation Details** (chat.component.html):

- Add <agent-status-badge> to header with [activeAgents]="chatService.activeAgents()"
- Add agent panel: @if (agentPanelVisible()) { <div class="agent-panel"> }
- Add <agent-tree> inside panel with [agents]="chatService.agents()"
- Add <agent-timeline> below tree with [agents]="chatService.agents()"

**Implementation Details** (chat.component.css):

- Define .agent-panel with width: 350px, position: absolute/relative
- Define responsive breakpoint: @media (max-width: 800px) { .agent-panel overlay modal }
- Define panel slide-in animation (250ms ease-out)

---

### Task 25: Export Agent Components from Chat Library ⏸️ PENDING

**Assigned To**: frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/frontend/chat/src/index.ts
**Specification Reference**: implementation-plan.md:1150 (Export updates)
**Pattern to Follow**: Existing index.ts exports
**Quality Requirements**:

- ✅ Export AgentTreeComponent
- ✅ Export AgentTimelineComponent
- ✅ Export AgentStatusBadge
- ✅ Export AgentIconService
- ✅ Export AGENT_ICON_MAP, TOOL_ICON_MAP constants
  **Expected Commit**: `feat(chat): export agent components and services (TASK_2025_004)`
  **Verification Requirements**:
- ✅ File compiles with TypeScript strict mode
- ✅ All 5 exports added
- ✅ No circular dependencies

**Implementation Details**:

- Add: export \* from './lib/components/agent-tree/agent-tree.component';
- Add: export \* from './lib/components/agent-timeline/agent-timeline.component';
- Add: export \* from './lib/components/agent-status-badge/agent-status-badge.component';
- Add: export \* from './lib/services/agent-icon.service';
- Add: export \* from './lib/constants/agent-icons.constants';

---

## Phase 4: Integration Testing (Tasks 26-27) - Either Developer

### Task 26: Integration Tests for Backend Event Flow ⏸️ PENDING

**Assigned To**: backend-developer OR frontend-developer
**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.integration.spec.ts (CREATE)
**Specification Reference**:

- implementation-plan.md:797-801 (Integration testing strategy)
- task-description.md:312-323 (Testing requirements)
  **Pattern to Follow**: Existing integration test pattern
  **Quality Requirements**:
- ✅ Test full event flow: Parser → EventBus → MessageHandler → Webview
- ✅ Test multi-agent scenarios (parallel, sequential, nested)
- ✅ Test session switching (state cleanup verification)
- ✅ Mock JSONL stream with real Task tool events
- ✅ Verify events arrive at webview with correct payloads
  **Expected Commit**: `test(claude-domain): add agent event flow integration tests (TASK_2025_004)`
  **Verification Requirements**:
- ✅ All tests pass (nx test claude-domain)
- ✅ 3+ integration test scenarios
- ✅ Events verified end-to-end

**Implementation Details**:

- Create mock JSONL stream with Task tool start/activity/result events
- Instantiate JSONLStreamParser with callbacks
- Verify callbacks invoked with correct ClaudeAgentEvent payloads
- Verify EventBus publish called
- Verify MessageHandler transforms to webview messages

---

### Task 27: E2E Tests with Real Claude CLI (Optional) ⏸️ PENDING

**Assigned To**: backend-developer OR frontend-developer
**File(s)**: D:/projects/ptah-extension/e2e/agent-visualization.e2e.spec.ts (CREATE)
**Specification Reference**:

- implementation-plan.md:1049-1056 (E2E testing strategy)
- task-description.md:312-323 (Testing requirements)
  **Pattern to Follow**: Existing E2E test pattern (if exists)
  **Quality Requirements**:
- ✅ Test with real Claude CLI Task tool invocation
- ✅ Test single subagent scenario ("Use Explore subagent to analyze this codebase")
- ✅ Test parallel subagents (frontend + backend simultaneously)
- ✅ Verify agent tree UI updates in real-time
- ✅ Measure performance (<50ms latency)
  **Expected Commit**: `test(e2e): add agent visualization E2E tests (TASK_2025_004)`
  **Verification Requirements**:
- ✅ E2E tests pass (skip in CI if Claude CLI not available)
- ✅ Performance metrics captured
- ✅ Real-time UI updates verified

**Implementation Details**:

- Setup: Docker container with Claude CLI installed (or skip if unavailable)
- Test 1: Invoke Task tool via Claude CLI, verify agent tree renders
- Test 2: Parallel Task tools, verify separate tracks in timeline
- Test 3: Measure latency (performance.mark) from parser to UI update
- Use Playwright or existing E2E framework

---

## Verification Protocol

**After Each Task Completion**:

1. Developer updates task status to "✅ COMPLETE"
2. Developer adds git commit SHA
3. Team-leader verifies:
   - `git log --oneline -1` matches expected commit pattern
   - `Read([file-path])` confirms file exists and contains expected changes
   - Build passes (nx build [affected-lib])
4. If verification passes: Assign next task
5. If verification fails: Mark task as "❌ FAILED", escalate to user

---

## Completion Criteria

**All tasks complete when**:

- All 27 task statuses are "✅ COMPLETE"
- All git commits verified (27 commits expected)
- All files exist (16 CREATE, 11 MODIFY)
- Build passes: `nx run-many --target=build --all`
- Tests pass: `nx run-many --target=test --all`

**Return to orchestrator with**: "All 27 tasks completed and verified ✅"

---

## Task Summary

**Phase 1 (Type System)**: 4 tasks - backend-developer
**Phase 2 (Backend Integration)**: 4 tasks - backend-developer
**Phase 3 (Frontend Components)**: 17 tasks - frontend-developer
**Phase 4 (Integration Testing)**: 2 tasks - either developer

**Total**: 27 atomic tasks, 121 hours, 15 working days

**Critical Path**: Tasks must be executed in order (Phase 1 → Phase 2 → Phase 3 → Phase 4)
