# Requirements Document - TASK_2025_004

## Introduction

### Executive Summary

This requirements document specifies the implementation of **real-time agent visualization** for Ptah's VS Code extension, enabling users to see Claude Code CLI's subagent orchestration system in action. Based on comprehensive technical research (AGENT_SYSTEM_RESEARCH.md), this feature will make Ptah **the first VS Code extension** to provide visibility into Claude's Task tool and subagent delegation patterns.

### Business Context

Claude Code CLI's agent system represents the most powerful capability currently missing from VS Code extensions. When users request complex tasks, Claude Code spawns specialized subagents (frontend-developer, backend-developer, software-architect, etc.) that work in parallel or sequentially. Currently, this orchestration is **completely invisible** to users, creating:

- **Opacity**: Users cannot see what subagents are doing
- **Debugging Challenges**: Difficult to identify which agent caused errors
- **Performance Mystery**: No visibility into parallel execution patterns
- **Learning Gap**: Users don't understand delegation strategies

### Value Proposition

Implementing agent visualization delivers:

1. **Competitive Differentiation**: First-to-market with agent tracking UI
2. **User Transparency**: Complete visibility into agent orchestration
3. **Debugging Capability**: Trace issues to specific subagent execution
4. **Performance Insights**: Understand parallel vs sequential patterns
5. **Educational Value**: Learn how Claude delegates complex work

### Technical Foundation

Research (AGENT_SYSTEM_RESEARCH.md) confirms **Strategy 1 (JSONL Stream Parsing)** as the optimal approach:

- ✅ **Feasibility Validated**: Task tool detection via JSONL stream events
- ✅ **Real-time Tracking**: `parent_tool_use_id` links subagent activity to Task tool
- ✅ **Existing Infrastructure**: Leverage JSONLStreamParser with minimal modification
- ✅ **Event-Driven Architecture**: Integrate with existing EventBus pattern
- ✅ **Zero External Dependencies**: No hooks, no file polling, no CLI modifications

### Scope Boundaries

**In Scope**:

- Type system for agent events (ClaudeAgentEvent types)
- Backend parser enhancement (JSONLStreamParser Task tool detection)
- EventBus integration (claude:agentStarted/Activity/Completed events)
- Frontend visualization (AgentTreeComponent, AgentTimelineComponent, AgentStatusBadge)
- Signal-based state management (agent list, active agent tracking)
- Visual design (16 subagent icons, collapsible tree, timeline animations)
- Testing (unit/integration/E2E with real Task tool scenarios)

**Out of Scope** (future enhancements):

- Agent delegation control/modification by users
- Agent transcript export functionality
- Agent performance metrics dashboard
- Custom agent configuration UI
- Hook-based integration (Strategy 2)
- Transcript file monitoring (Strategy 3)

---

## Requirements

### Requirement 1: Type System Enhancement

**User Story**: As a developer, I want strongly-typed agent event contracts, so that all layers (backend → EventBus → frontend) maintain compile-time safety and runtime validation.

#### Acceptance Criteria

1. **WHEN** Claude CLI invokes Task tool with subagent_type **THEN** type system **SHALL** define ClaudeAgentStartEvent with agentId, subagentType, description, prompt, model, timestamp fields
2. **WHEN** subagent executes tools (Bash, Read, Edit, etc.) **THEN** type system **SHALL** define ClaudeAgentActivityEvent with agentId, toolName, toolInput, timestamp fields
3. **WHEN** Task tool completes (result event received) **THEN** type system **SHALL** define ClaudeAgentCompleteEvent with agentId, duration, result, timestamp fields
4. **WHEN** agent events cross extension/webview boundary **THEN** type system **SHALL** include Zod schemas for runtime validation (ClaudeAgentEventSchema)
5. **WHEN** multiple agent events exist **THEN** type system **SHALL** use discriminated union (ClaudeAgentEvent = Start | Activity | Complete) for type-safe pattern matching
6. **WHEN** MESSAGE_TYPES constants are referenced **THEN** type system **SHALL** define 3 new message types (chat:agentStarted, chat:agentActivity, chat:agentCompleted) following existing MESSAGE_TYPES pattern
7. **WHEN** MessagePayloadMap is accessed **THEN** type system **SHALL** extend MessagePayloadMap with agent event payload types matching webview message protocol

**Technical Constraints**:

- All types must be readonly for immutability
- AgentId shall use toolCallId (string) from Task tool, NOT a branded type (to avoid premature optimization)
- Types must align with existing ClaudeToolEvent pattern (similar discriminated union structure)
- Zero loose types (no `any`, `object`, `unknown` without validation)

**Files Affected**:

- `libs/shared/src/lib/types/claude-domain.types.ts` (add ClaudeAgentEvent types)
- `libs/shared/src/lib/constants/message-types.ts` (add CHAT_RESPONSE_TYPES for agent events)
- `libs/shared/src/lib/types/message.types.ts` (extend MessagePayloadMap)
- `libs/shared/src/lib/constants/message-registry.ts` (add to CHAT_RESPONSE category)

---

### Requirement 2: Backend JSONL Parser Enhancement

**User Story**: As the backend system, I want to detect Task tool invocations and track parent_tool_use_id relationships, so that I can emit agent lifecycle events (start/activity/complete) to the EventBus in real-time.

#### Acceptance Criteria

1. **WHEN** JSONLStreamParser processes tool_use message with tool="Task" **THEN** parser **SHALL** emit ClaudeAgentStartEvent with args.subagent_type, args.description, args.prompt, args.model extracted from tool input
2. **WHEN** JSONLStreamParser tracks active agents **THEN** parser **SHALL** maintain Map<string, AgentMetadata> with agentId → {subagentType, description, startTime, parentToolCallId}
3. **WHEN** JSONLStreamParser processes assistant message with parent_tool_use_id matching active agent **THEN** parser **SHALL** emit ClaudeAgentActivityEvent for each tool call (excluding text-only responses)
4. **WHEN** JSONLStreamParser processes tool_result message for Task tool **THEN** parser **SHALL** emit ClaudeAgentCompleteEvent with duration = (now - startTime) and result = tool output
5. **WHEN** agent completes **THEN** parser **SHALL** remove agent from activeAgents map to prevent memory leaks
6. **WHEN** parser encounters malformed agent data **THEN** parser **SHALL** log warning and continue processing (graceful degradation, not fatal error)
7. **WHEN** parser detects nested agents (agent spawns Task tool) **THEN** parser **SHALL** track nested relationships via parentToolCallId chain for future hierarchical visualization

**Performance Requirements**:

- Agent event detection must add <10ms latency to JSONL processing pipeline
- activeAgents map must not exceed 100 concurrent agents (safety limit)
- Memory cleanup must occur within 1 second of agent completion

**Files Affected**:

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (add Task tool detection logic)
- `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts` (wire agent callbacks)

---

### Requirement 3: EventBus Integration

**User Story**: As the event-driven architecture, I want agent events published via EventBus, so that MessageHandlerService and frontend components can subscribe to real-time agent updates without tight coupling.

#### Acceptance Criteria

1. **WHEN** ClaudeAgentStartEvent is detected **THEN** ClaudeDomainEventPublisher **SHALL** publish `claude:agentStarted` event with payload {sessionId, agent: ClaudeAgentStartEvent}
2. **WHEN** ClaudeAgentActivityEvent is detected **THEN** ClaudeDomainEventPublisher **SHALL** publish `claude:agentActivity` event with payload {sessionId, agent: ClaudeAgentActivityEvent}
3. **WHEN** ClaudeAgentCompleteEvent is detected **THEN** ClaudeDomainEventPublisher **SHALL** publish `claude:agentCompleted` event with payload {sessionId, agent: ClaudeAgentCompleteEvent}
4. **WHEN** MessageHandlerService subscribes to agent events **THEN** service **SHALL** transform EventBus events into webview messages (chat:agentStarted, chat:agentActivity, chat:agentCompleted)
5. **WHEN** webview is not active **THEN** MessageHandlerService **SHALL** buffer agent events (max 50 events) and flush when webview becomes ready
6. **WHEN** EventBus publish fails **THEN** system **SHALL** log error with agent context (agentId, subagentType) and continue processing (no cascade failure)

**Integration Requirements**:

- Event payloads must follow existing EventBus patterns (see claude:contentChunk, claude:toolExecution)
- MessageHandlerService subscription must occur during initialization (not lazy)
- Event buffering must prevent memory leaks (LRU eviction after 50 events)

**Files Affected**:

- `libs/backend/claude-domain/src/events/claude-domain.events.ts` (add event publisher methods)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (add EventBus subscriptions)

---

### Requirement 4: Frontend Agent Tree Component

**User Story**: As a user, I want to see a visual tree of active and completed subagents, so that I understand which agents are working on my task and what tools they're using.

#### Acceptance Criteria

1. **WHEN** chat:agentStarted message is received **THEN** AgentTreeComponent **SHALL** add new agent node with icon (based on subagentType), description, status badge ("Running"), and timestamp
2. **WHEN** chat:agentActivity message is received **THEN** AgentTreeComponent **SHALL** append tool execution line under agent node (e.g., "🔧 Bash: npm install", "✏️ Edit: file.ts")
3. **WHEN** chat:agentCompleted message is received **THEN** AgentTreeComponent **SHALL** update agent status badge to "Complete ✅", display duration (e.g., "1m 23s"), and collapse/expand capability
4. **WHEN** user clicks agent node **THEN** component **SHALL** expand/collapse child activities (collapsible tree pattern)
5. **WHEN** user hovers over agent description **THEN** component **SHALL** display tooltip with full prompt text (truncated descriptions)
6. **WHEN** multiple agents run in parallel **THEN** component **SHALL** display agents in chronological start order with visual indentation showing parent-child relationships
7. **WHEN** agent encounters error **THEN** component **SHALL** display error icon (🔴) and error message in red text

**Visual Design Requirements**:

- 16 unique subagent icons (🎨 frontend-developer, 💻 backend-developer, 🏗️ software-architect, etc.) - **ui-ux-designer to specify**
- Collapsible tree with smooth CSS transitions (300ms expand/collapse animation)
- VS Code theming integration (use CSS variables --vscode-foreground, --vscode-button-background)
- Accessibility: ARIA labels for screen readers, keyboard navigation (Tab, Enter, Arrow keys)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts` (NEW)
- `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.html` (NEW)
- `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.css` (NEW)

---

### Requirement 5: Frontend Agent Timeline Component

**User Story**: As a user, I want to see a horizontal timeline of agent execution, so that I can understand temporal patterns (parallel vs sequential execution).

#### Acceptance Criteria

1. **WHEN** agent starts **THEN** AgentTimelineComponent **SHALL** add timeline marker (●) at current time position with agent icon and start time label
2. **WHEN** agent completes **THEN** component **SHALL** draw horizontal line from start marker to completion marker with duration overlay
3. **WHEN** multiple agents run in parallel **THEN** component **SHALL** display overlapping timelines on separate horizontal tracks (swimlane pattern)
4. **WHEN** user hovers over timeline segment **THEN** component **SHALL** display popover with agent details (subagentType, description, tools used, duration)
5. **WHEN** timeline exceeds viewport width **THEN** component **SHALL** enable horizontal scroll with auto-scroll to latest agent activity
6. **WHEN** user clicks timeline marker **THEN** component **SHALL** scroll chat view to corresponding agent start message

**Visual Design Requirements**:

- Timeline scale: 1 second = 2px width (auto-scaling for long sessions)
- Track height: 40px per agent with 10px spacing
- Animation: Timeline segments grow in real-time (CSS @keyframes for duration line)
- **ui-ux-designer to provide mockup for timeline interactions**

**Files Affected**:

- `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts` (NEW)
- `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.html` (NEW)
- `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.css` (NEW)

---

### Requirement 6: Frontend Agent Status Badge

**User Story**: As a user, I want to see a real-time count of active agents in the chat header, so that I'm always aware of background subagent activity.

#### Acceptance Criteria

1. **WHEN** no agents are active **THEN** AgentStatusBadge **SHALL** display "🤖 No agents" in subtle gray color
2. **WHEN** 1 agent is active **THEN** badge **SHALL** display "🤖 1 agent" with pulsing animation (CSS pulse effect)
3. **WHEN** 2+ agents are active **THEN** badge **SHALL** display "🤖 N agents" with list of agent types on hover (tooltip)
4. **WHEN** all agents complete **THEN** badge **SHALL** fade animation (500ms) back to "No agents" state
5. **WHEN** user clicks badge **THEN** component **SHALL** toggle agent tree panel visibility (expand/collapse sidebar)
6. **WHEN** agent error occurs **THEN** badge **SHALL** display red error indicator (🔴) with error count

**Visual Design Requirements**:

- Compact size: 120px width × 24px height (fits chat header)
- Pulsing animation: 2-second loop, opacity 0.7 → 1.0 → 0.7
- **ui-ux-designer to specify hover tooltip design**

**Files Affected**:

- `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts` (NEW)
- `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.html` (NEW)
- `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.css` (NEW)

---

### Requirement 7: Frontend State Management

**User Story**: As the frontend application, I want signal-based agent state management, so that all components reactively update when agent events arrive without manual subscription management.

#### Acceptance Criteria

1. **WHEN** ChatService receives chat:agentStarted message **THEN** service **SHALL** add agent to `agents` signal (WritableSignal<ClaudeAgentStartEvent[]>)
2. **WHEN** ChatService receives chat:agentActivity message **THEN** service **SHALL** append activity to `agentActivities` signal (WritableSignal<Map<agentId, ClaudeAgentActivityEvent[]>>)
3. **WHEN** ChatService receives chat:agentCompleted message **THEN** service **SHALL** update agent status in `agents` signal and emit completion to `agentCompletions` signal
4. **WHEN** components access agent state **THEN** ChatService **SHALL** provide computed signals for activeAgents (computed(() => agents().filter(a => !completed(a.agentId))))
5. **WHEN** session switches **THEN** ChatService **SHALL** clear agent signals and re-populate from session history (if persisted)
6. **WHEN** agent state updates **THEN** all subscribed components (AgentTreeComponent, AgentTimelineComponent, AgentStatusBadge) **SHALL** automatically re-render via Angular change detection

**State Management Requirements**:

- Zero RxJS BehaviorSubject (use Angular signals exclusively)
- Immutable updates (use signal.update() with spread operators)
- Computed signals for derived state (activeAgents, completedAgents, agentCount)
- Memory management: Clear agent state on session close

**Files Affected**:

- `libs/frontend/core/src/lib/services/chat.service.ts` (add agent signals and update handlers)

---

## Non-Functional Requirements

### Performance Requirements

1. **Agent Event Latency**:

   - 95th percentile: <50ms from JSONL parser detection to frontend UI update
   - 99th percentile: <100ms end-to-end latency
   - Measurement: Add performance.mark() at parser, EventBus, MessageHandler, and component levels

2. **Concurrent Agent Support**:

   - Must support 10 parallel agents without UI degradation
   - Memory usage: <10MB for agent state (100 agents × 100KB average)
   - Test scenario: Parallel Task tool invocations (frontend-developer + backend-developer + 8 others)

3. **UI Responsiveness**:
   - AgentTreeComponent render time: <16ms (60fps) for 50 agent nodes
   - Timeline scroll performance: Maintain 60fps during auto-scroll
   - Status badge update: <5ms for count increment

### Security Requirements

1. **Input Validation**:

   - All agent event payloads MUST pass Zod schema validation before processing
   - Sanitize agent prompt/description for XSS prevention (use DOMPurify or Angular sanitization)
   - Reject malformed JSONL events without crashing parser

2. **Data Protection**:

   - Agent prompts may contain sensitive information (API keys, passwords) - truncate in logs
   - Do not persist agent transcripts to disk (privacy concern)
   - Clear agent state on session close (no residual data)

3. **Compliance**:
   - WCAG 2.1 Level AA accessibility for all agent UI components
   - Keyboard navigation support (no mouse-only interactions)
   - Screen reader compatibility (ARIA labels for all visual elements)

### Scalability Requirements

1. **Load Capacity**:

   - Support 100 agent lifecycle events per minute (high-activity sessions)
   - EventBus throughput: 500 events/second across all event types
   - Buffering: MessageHandlerService must buffer 50 agent events without memory leak

2. **Growth Planning**:

   - Type system extensible for future agent metadata (e.g., cost tracking, token usage per agent)
   - UI components support future features (agent filtering, search, export)

3. **Resource Scaling**:
   - Agent tree component virtualizes rendering for >100 nodes (use Angular CDK virtual scrolling)
   - Timeline auto-scaling for sessions >1 hour duration

### Reliability Requirements

1. **Uptime**:

   - Agent visualization must not crash chat interface (error boundaries)
   - Parser errors must log and continue (no cascade failure to JSONL stream)

2. **Error Handling**:

   - Graceful degradation: If agent detection fails, chat continues normally
   - User-facing errors: Display "Agent tracking unavailable" banner, not technical stack traces
   - Recovery: Auto-resume agent tracking on next Task tool invocation

3. **Recovery Time**:
   - Parser recovery from malformed JSONL: <100ms
   - EventBus recovery from publish failure: <50ms (retry once, then log)

### Maintainability Requirements

1. **Code Quality**:

   - All agent code follows existing Ptah patterns (DI, EventBus, signals)
   - Zero `any` types, zero ESLint violations
   - 100% TSDoc comments on public APIs

2. **Testing**:

   - Unit test coverage: 80% minimum across parser, EventBus, services
   - Integration tests: Full event flow (parser → EventBus → MessageHandler → frontend)
   - E2E tests: Real Claude CLI scenarios (single agent, parallel agents, nested agents)

3. **Documentation**:
   - Update CLAUDE.md files for affected libraries (shared, claude-domain, chat)
   - User guide: Screenshots of agent tree/timeline/badge in action
   - Developer guide: How to extend agent types, add new agent metadata

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder              | Needs                                             | Pain Points                                             | Success Criteria                                                                            |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Ptah Users**           | Transparency into agent orchestration             | Cannot see subagent activity, difficult to debug errors | Agent tree shows all subagents in real-time, errors clearly attributed to specific agents   |
| **Extension Developers** | Clean integration with existing architecture      | Complex multi-layer changes risk regressions            | Zero breaking changes to chat functionality, all tests pass, <5% code coverage drop         |
| **UI/UX Designer**       | Visual specifications for 3 components + 16 icons | Ambiguous requirements lead to rework                   | Clear acceptance criteria, mockups approved before implementation, design tokens documented |

### Secondary Stakeholders

| Stakeholder       | Needs                          | Pain Points                                                | Success Criteria                                                                        |
| ----------------- | ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Backend Team**  | Type-safe EventBus integration | Type mismatches cause runtime errors                       | Full TypeScript compilation with strict mode, Zod validation catches all malformed data |
| **Frontend Team** | Signal-based reactive state    | BehaviorSubject patterns deprecated, need signal migration | Zero RxJS in agent state management, computed signals for derived state                 |
| **QA Team**       | Testable agent scenarios       | Claude CLI requires real sessions                          | Mock JSONL stream for unit tests, docker container for E2E tests with real CLI          |

### Stakeholder Impact Matrix

| Stakeholder          | Impact Level | Involvement                              | Success Criteria                                          |
| -------------------- | ------------ | ---------------------------------------- | --------------------------------------------------------- |
| Ptah Users           | **High**     | Beta testing, feedback                   | >80% user satisfaction with agent visibility              |
| Extension Developers | **High**     | Implementation, code review              | Zero production bugs in first 2 weeks post-launch         |
| UI/UX Designer       | **High**     | Visual design, Canva assets              | All 16 agent icons + 3 component mockups delivered week 1 |
| Backend Team         | **Medium**   | Parser enhancement, EventBus integration | <50ms agent event latency, 80% test coverage              |
| Frontend Team        | **Medium**   | Component development, state management  | 3 components (tree, timeline, badge) completed week 3     |
| QA Team              | **Medium**   | Test plan, E2E scenarios                 | 100% test coverage for agent event flows                  |

---

## Risk Assessment

### Technical Risks

| Risk                                                                               | Probability | Impact   | Score | Mitigation Strategy                                                               | Contingency Plan                                                    |
| ---------------------------------------------------------------------------------- | ----------- | -------- | ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **JSONL parsing complexity** - Task tool detection logic causes parser regressions | Medium      | Critical | 6     | Comprehensive unit tests with real JSONL samples, feature flag for agent tracking | Disable agent tracking via config flag, fall back to chat-only mode |
| **EventBus performance** - High-frequency agent events degrade EventBus throughput | Low         | High     | 3     | Benchmark EventBus with 500 events/sec, implement event batching if needed        | Throttle agent events to 100/min, buffer and debounce updates       |
| **Frontend rendering bottleneck** - 50+ agent nodes cause UI lag                   | Medium      | High     | 6     | Implement virtual scrolling (Angular CDK), lazy render collapsed nodes            | Limit agent tree to last 20 agents, paginate older agents           |
| **Type system coupling** - Shared types create circular dependencies               | Low         | Medium   | 2     | Follow existing shared library patterns, no re-exports across libraries           | Duplicate types if necessary (last resort), document divergence     |
| **Testing real Claude CLI** - E2E tests require Claude CLI installation in CI/CD   | High        | Medium   | 6     | Mock JSONL stream for unit tests, use Docker container with Claude CLI for E2E    | Skip E2E tests in CI, manual E2E testing only                       |

### Business Risks

| Risk                                                                   | Probability | Impact | Score | Mitigation                                                              | Contingency                                                              |
| ---------------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Market timing** - Competitor launches agent visualization first      | Low         | High   | 3     | Prioritize MVP (tree + badge only), defer timeline to v2                | Emphasize superior UX and integration with Ptah features                 |
| **Resource constraints** - UI/UX designer unavailable week 1           | Medium      | Medium | 4     | Use placeholder icons from existing libraries, finalize icons in week 2 | Launch with text-based agent list (no icons), add icons in patch release |
| **Scope creep** - Users request agent control features (pause, modify) | High        | Low    | 3     | Clearly document "out of scope" in user guide, roadmap for v2           | Defer control features to TASK_2025_005 (future task)                    |

### Integration Risks

| Risk                                                                                   | Probability | Impact   | Score | Mitigation                                                         | Contingency                                                     |
| -------------------------------------------------------------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| **MessageHandler complexity** - Adding agent subscriptions breaks existing chat events | Medium      | Critical | 6     | Isolate agent event handlers, comprehensive integration tests      | Roll back to chat-only mode, fix in hotfix release              |
| **Session state pollution** - Agent state leaks across sessions                        | Low         | High     | 3     | Clear agent signals on session switch, unit test session isolation | Add session cleanup hook, persist agent state separately        |
| **VS Code theming conflicts** - Agent icons clash with theme colors                    | Low         | Low      | 1     | Use CSS variables for all colors, test with 5 popular themes       | Provide theme-specific icon variants (light/dark/high-contrast) |

---

## Dependencies

### Internal Dependencies

1. **libs/shared** (Type System Foundation)

   - MUST add ClaudeAgentEvent types before backend implementation
   - MUST extend MESSAGE_TYPES constants for agent events
   - BLOCKING: Backend cannot proceed without type definitions

2. **libs/backend/claude-domain** (Parser Enhancement)

   - MUST complete JSONLStreamParser Task detection logic
   - MUST implement EventBus publisher methods
   - BLOCKING: Frontend cannot test without backend event emission

3. **libs/frontend/core** (Service Layer)

   - MUST add agent signal state to ChatService
   - MUST handle chat:agentStarted/Activity/Completed messages
   - BLOCKING: Components cannot render without state management

4. **libs/frontend/chat** (OR new libs/frontend/agents library - architect to decide)
   - MUST create 3 new components (tree, timeline, badge)
   - MUST integrate with ChatComponent layout
   - BLOCKING: Users cannot see agent visualization without components

### External Dependencies

1. **Claude Code CLI** (v1.0+)

   - Required for E2E testing with real Task tool
   - Fallback: Mock JSONL stream for unit/integration tests
   - Risk: CLI API changes may require parser updates

2. **Angular CDK** (Virtual Scrolling)

   - Required for agent tree performance (>50 nodes)
   - Already included in project (no new dependency)

3. **VS Code Extension API**
   - No new API surface area required
   - Uses existing webview message passing

### Data Dependencies

1. **JSONL Stream Format**

   - Depends on Claude CLI maintaining `parent_tool_use_id` field
   - Depends on Task tool maintaining args schema (subagent_type, description, prompt)
   - Risk: Upstream changes require adapter layer

2. **EventBus Protocol**
   - Depends on existing EventBus infrastructure (vscode-core)
   - Depends on MessageHandlerService message routing
   - Risk: EventBus refactoring may require migration

---

## Success Metrics

### Functional Metrics

| Metric                       | Target                                                | Measurement Method                                                     |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| **Agent Detection Accuracy** | 100% of Task tool invocations detected                | Unit tests with 20 JSONL samples, E2E test with real CLI               |
| **Event Flow Completeness**  | 100% of agent events reach frontend                   | Integration test: Verify chat:agentStarted/Activity/Completed received |
| **UI Component Coverage**    | 3 components (tree, timeline, badge) fully functional | Manual testing checklist, screenshot comparison                        |
| **Error Handling**           | Zero crashes on malformed agent data                  | Fuzz testing with 100 corrupted JSONL samples                          |

### Performance Metrics

| Metric                       | Target                         | Measurement Method                                                     |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| **Agent Event Latency**      | <50ms (95th percentile)        | performance.mark() at 4 checkpoints (parser → EventBus → handler → UI) |
| **Concurrent Agent Support** | 10 parallel agents without lag | Load test: Spawn 10 Task tools simultaneously, measure UI frame rate   |
| **Memory Usage**             | <10MB for agent state          | Chrome DevTools memory profiler during 100-agent session               |
| **Render Performance**       | <16ms for 50 agent nodes       | React DevTools Profiler (Angular equivalent), target 60fps             |

### Quality Metrics

| Metric                  | Target                              | Measurement Method                                              |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------- |
| **Test Coverage**       | 80% line/branch/function            | Jest coverage report, fail CI if below threshold                |
| **Type Safety**         | Zero `any` types in agent code      | TypeScript strict mode compilation, ESLint no-explicit-any rule |
| **Accessibility Score** | WCAG 2.1 Level AA compliance        | Axe DevTools audit, keyboard navigation test                    |
| **Code Review Score**   | 9/10 minimum (code-reviewer rating) | Code review checklist (SOLID, patterns, documentation)          |

### Business Metrics

| Metric                    | Target                                           | Measurement Method                                                            |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| **User Adoption**         | 60% of Ptah users enable agent visualization     | Analytics event tracking (agent tree opened)                                  |
| **User Satisfaction**     | >4.0/5.0 rating for agent features               | In-app survey after 1 week usage                                              |
| **Competitive Advantage** | First VS Code extension with agent visualization | Market research (search GitHub, VS Code marketplace)                          |
| **Time to Value**         | Users see first agent within 30 seconds          | E2E test: Open Ptah → Send message → Task tool invoked → Agent tree populated |

---

## Implementation Phases

Based on AGENT_SYSTEM_RESEARCH.md, implementation follows 5 phases:

### Phase 1: Type System (Week 1)

- Add ClaudeAgentEvent types to shared library
- Extend MESSAGE_TYPES and MessagePayloadMap
- Add Zod schemas for validation
- Update message registry

**Deliverables**: TypeScript types compile, Zod validation tests pass

### Phase 2: Backend Integration (Week 1-2)

- Enhance JSONLStreamParser with Task tool detection
- Implement agent lifecycle tracking (start/activity/complete)
- Add EventBus publisher methods
- Wire agent callbacks in ClaudeCliLauncher
- Add MessageHandlerService subscriptions

**Deliverables**: Agent events flow from parser → EventBus → MessageHandler

### Phase 3: Frontend Components (Week 2-3)

- Create AgentTreeComponent (collapsible tree)
- Create AgentTimelineComponent (temporal visualization)
- Create AgentStatusBadge (active agent count)
- Add agent signals to ChatService
- Integrate components into ChatComponent layout

**Deliverables**: 3 components render agent data from mock events

### Phase 4: UI/UX Polish (Week 3-4)

- Design 16 subagent icons (ui-ux-designer)
- Implement collapsible tree animations
- Add agent duration tracking
- Create agent detail panel (prompt, tools, results)
- Agent highlighting in message stream
- Timeline animations and interactions

**Deliverables**: Production-ready UI matching design specifications

### Phase 5: Testing & Documentation (Week 4)

- Unit tests for parser, EventBus, services (80% coverage)
- Integration tests for event flow
- E2E tests with real Claude CLI Task tool
- Performance benchmarks (latency, concurrency)
- Update CLAUDE.md documentation
- User guide with screenshots

**Deliverables**: All tests pass, documentation complete, ready for launch

---

## Quality Gates

Before delegation to next agent, verify:

- [x] All requirements follow SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
- [x] Acceptance criteria in BDD format (WHEN/THEN/SHALL)
- [x] Stakeholder analysis complete with impact matrix
- [x] Risk assessment with mitigation strategies
- [x] Success metrics clearly defined (functional, performance, quality, business)
- [x] Dependencies identified and documented (internal, external, data)
- [x] Non-functional requirements specified (performance, security, scalability, reliability)
- [x] Compliance requirements addressed (WCAG 2.1 Level AA)
- [x] Performance benchmarks established (<50ms latency, 10 concurrent agents)
- [x] Security requirements documented (input validation, data protection)
- [x] All requirements align with AGENT_SYSTEM_RESEARCH.md Strategy 1 (JSONL Stream Parsing)
- [x] No backward compatibility planning (direct implementation only)
- [x] No alternative strategies proposed (Strategy 1 is approved)

---

## Delegation Recommendation

**SKIP**: researcher-expert (research already complete in AGENT_SYSTEM_RESEARCH.md)

**NEXT AGENT**: ui-ux-designer

**Delegation Rationale**:

- Requirements specify 16 unique subagent icons (🎨 frontend-developer, 💻 backend-developer, etc.)
- 3 new components require visual design specifications (tree layout, timeline interactions, badge styling)
- Collapsible tree animations need interaction design (expand/collapse, hover states)
- Timeline component needs temporal visualization mockup (swimlanes, markers, popover)
- Agent status badge needs compact design fitting chat header (120px × 24px)

**Success Criteria for ui-ux-designer**:

1. Deliver 16 subagent icons (SVG format, VS Code theme-compatible colors)
2. Provide AgentTreeComponent mockup (Figma/Canva) with collapsible nodes, tool activity lines, status badges
3. Provide AgentTimelineComponent mockup (Figma/Canva) with swimlane layout, timeline markers, duration overlay, popover design
4. Provide AgentStatusBadge mockup (Figma/Canva) with active state (pulsing), hover tooltip, error indicator
5. Document design tokens (colors, spacing, typography) using VS Code CSS variables
6. Ensure WCAG 2.1 Level AA compliance (color contrast, keyboard focus indicators)

**Time Budget**: 2-3 days for visual design deliverables

**Quality Bar**:

- All designs must use VS Code theming (CSS variables)
- Icons must be recognizable at 16px × 16px size
- Components must follow Ptah's existing Egyptian-themed aesthetic
- Accessibility checklist complete (color contrast, focus indicators, ARIA labels)
