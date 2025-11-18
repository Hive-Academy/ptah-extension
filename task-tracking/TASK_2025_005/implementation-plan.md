# Implementation Plan - TASK_2025_005

## Overview

Implement 6 phases of rich CLI features from IMPLEMENTATION_PLAN.md to achieve UI parity with Claude Code CLI terminal experience.

## Timeline: 20 Days (4 Weeks)

---

## Phase 1: @ Mention System (Days 1-5)

### Components to Create

1. **MentionInputComponent**

   - Location: `libs/frontend/chat/src/lib/components/mention-input/`
   - Files: `.ts`, `.html`, `.css`, `.spec.ts`
   - Complexity: Medium (autocomplete dropdown, keyboard navigation)
   - Agent: frontend-developer

2. **WorkspaceService**
   - Location: `libs/frontend/core/src/lib/services/workspace.service.ts`
   - Complexity: Low (wrapper around VS Code API)
   - Agent: frontend-developer

### Backend Changes

1. **SessionCapabilities Interface**

   - File: `libs/shared/src/lib/types/claude-domain.types.ts`
   - Add: `SessionCapabilities` interface with agents, slash_commands, mcp_servers, tools fields

2. **Capabilities Extraction**

   - File: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`
   - Modify: `handleSystemMessage()` to extract capabilities from init message
   - Emit: "claude:capabilitiesDetected" event

3. **Capabilities Persistence**
   - File: `libs/backend/claude-domain/src/session/session-manager.ts`
   - Add: `capabilities?: SessionCapabilities` field to `StrictChatSession`

### Frontend Changes

1. **Capabilities State Management**
   - File: `libs/frontend/core/src/lib/services/chat.service.ts`
   - Add: `sessionCapabilities` signal
   - Subscribe: "session:capabilitiesUpdated" message

### Testing

- Unit tests: MentionInputComponent keyboard navigation
- Unit tests: WorkspaceService file search
- Integration test: Capabilities flow (parser → EventBus → frontend)

### Deliverables

- [ ] @ mention autocomplete works for all types (file, agent, command, MCP)
- [ ] File search returns results from workspace
- [ ] Capabilities tracked per session
- [ ] 80%+ test coverage

---

## Phase 2: Model Selection (Days 6-8)

### Components to Create

1. **ModelSelectorComponent**
   - Location: `libs/frontend/chat/src/lib/components/model-selector/`
   - Files: `.ts`, `.html`, `.css`, `.spec.ts`
   - Complexity: Low (dropdown with 3 options)
   - Agent: frontend-developer

### Backend Changes

1. **Session Model Storage**

   - File: `libs/backend/claude-domain/src/session/session-manager.ts`
   - Add: `model?: string` field to `StrictChatSession`
   - Modify: `createSession()` to accept model parameter

2. **Model Validation**
   - Validate: Only "sonnet", "opus", "haiku", or undefined

### Frontend Changes

1. **Model Selector Integration**
   - File: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
   - Add: ModelSelectorComponent to session creation dialog
   - Wire: modelChanged event to SessionService

### Testing

- Unit tests: Model selector dropdown
- Integration test: Model passed to CLI via --model flag
- E2E test: Create session with Opus, verify CLI args

### Deliverables

- [ ] Users can select model during session creation
- [ ] Cost estimates displayed per model
- [ ] Model stored in session and passed to CLI
- [ ] 80%+ test coverage

---

## Phase 3: MCP Server Status (Days 9-11)

### Components to Create

1. **McpStatusComponent**
   - Location: `libs/frontend/session/src/lib/components/mcp-status/`
   - Files: `.ts`, `.html`, `.css`, `.spec.ts`
   - Complexity: Medium (expandable lists, status badges)
   - Agent: frontend-developer

### Backend Changes

- No backend changes (MCP servers already parsed in capabilities)

### Frontend Changes

1. **MCP Status Display**
   - Component: Renders MCP server list with status badges
   - Feature: Expand/collapse tool lists
   - Feature: Retry button for failed servers

### Testing

- Unit tests: MCP status component rendering
- Unit tests: Expand/collapse behavior
- Visual test: Status badges (connected/disabled/failed)

### Deliverables

- [ ] MCP servers displayed with status
- [ ] Tool lists expandable per server
- [ ] Retry functionality (stub for now)
- [ ] 80%+ test coverage

---

## Phase 4: Cost & Token Tracking (Days 12-14)

### Backend Changes

1. **Result Message Parsing**

   - File: `libs/shared/src/lib/types/claude-domain.types.ts`
   - Add: `JSONLResultMessage` interface

2. **Result Message Handling**

   - File: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`
   - Add: `handleResultMessage()` method
   - Emit: "claude:result" event

3. **Session Cost Accumulation**
   - File: `libs/backend/claude-domain/src/session/session-manager.ts`
   - Add: `totalCost`, `totalTokensInput`, `totalTokensOutput` fields
   - Modify: `updateSessionCost()` method

### Components to Create

1. **MessageFooterComponent**
   - Location: `libs/frontend/chat/src/lib/components/message-footer/`
   - Files: `.ts`, `.html`, `.css`, `.spec.ts`
   - Complexity: Low (simple badges)
   - Agent: frontend-developer

### Frontend Changes

1. **Cost State Management**

   - File: `libs/frontend/core/src/lib/services/chat.service.ts`
   - Add: Result message handler
   - Update: Last message with cost/tokens/duration

2. **Message Footer Integration**
   - File: `libs/frontend/chat/src/lib/components/chat-messages/`
   - Add: MessageFooterComponent to message template

### Testing

- Unit tests: Result message parsing
- Unit tests: Cost accumulation
- Integration test: Cost displayed after message completion

### Deliverables

- [ ] Per-message cost displayed
- [ ] Token counts shown (input/output)
- [ ] Session cumulative cost tracked
- [ ] 80%+ test coverage

---

## Phase 5: Capabilities Panel (Days 15-17)

### Components to Create

1. **CapabilitiesPanelComponent**
   - Location: `libs/frontend/session/src/lib/components/capabilities-panel/`
   - Files: `.ts`, `.html`, `.css`, `.spec.ts`
   - Complexity: High (6 sections, filtering logic)
   - Agent: frontend-developer

### Frontend Changes

1. **Capabilities Panel Integration**

   - File: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
   - Add: CapabilitiesPanelComponent to sidebar
   - Wire: Session capabilities signal

2. **Built-in Filtering**
   - Filter: Remove built-in agents (general-purpose, Explore, Plan, statusline-setup)
   - Filter: Remove built-in commands (/compact, /context, /cost, /help, etc.)

### Testing

- Unit tests: Capabilities panel rendering
- Unit tests: Built-in filtering logic
- Visual test: Collapse/expand behavior

### Deliverables

- [ ] Capabilities panel displays all 6 sections
- [ ] Custom agents/commands filtered correctly
- [ ] Session stats accurate
- [ ] 80%+ test coverage

---

## Phase 6: Integration & Polish (Days 18-20)

### Integration Tasks

1. **Chat Component Layout**

   - File: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
   - Integrate: MentionInputComponent
   - Integrate: MessageFooterComponent
   - Integrate: CapabilitiesPanelComponent
   - Integrate: ModelSelectorComponent

2. **Responsive Design**

   - Test: 320px viewport (mobile)
   - Test: 768px viewport (tablet)
   - Test: 1920px viewport (desktop)

3. **Error Handling**
   - Graceful: File search failures
   - Graceful: Missing capabilities
   - Graceful: MCP server failures

### Testing

- E2E test: Complete user flow (create session, select model, use @ mentions, view costs, check capabilities)
- Regression test: Ensure existing chat functionality unaffected
- Performance test: @ mention <100ms, file search <300ms
- Accessibility test: WCAG 2.1 Level AA compliance

### Documentation

- Update: `libs/frontend/chat/CLAUDE.md` (add new components)
- Update: `libs/frontend/session/CLAUDE.md` (add capabilities panel)
- Update: `libs/frontend/core/CLAUDE.md` (add workspace service)
- Create: User guide with screenshots

### Deliverables

- [ ] All components integrated into ChatComponent
- [ ] End-to-end testing passed
- [ ] Performance benchmarks met
- [ ] Accessibility audit passed
- [ ] Documentation updated

---

## Agent Assignments

### Phase 1 (Days 1-5)

- **frontend-developer**: MentionInputComponent, WorkspaceService
- **backend-developer**: Capabilities extraction, persistence

### Phase 2 (Days 6-8)

- **frontend-developer**: ModelSelectorComponent
- **backend-developer**: Session model storage

### Phase 3 (Days 9-11)

- **frontend-developer**: McpStatusComponent

### Phase 4 (Days 12-14)

- **backend-developer**: Result message parsing, cost accumulation
- **frontend-developer**: MessageFooterComponent

### Phase 5 (Days 15-17)

- **frontend-developer**: CapabilitiesPanelComponent

### Phase 6 (Days 18-20)

- **frontend-developer**: Chat integration, responsive design
- **senior-tester**: E2E testing, performance testing
- **code-reviewer**: Final code review

---

## Success Criteria

### Functional

- ✅ @ Mention system works with all 4 types
- ✅ Model selection functional with cost display
- ✅ MCP status displayed with tool lists
- ✅ Cost tracking shows per-message and cumulative
- ✅ Capabilities panel displays all sections

### Technical

- ✅ 80% test coverage minimum
- ✅ Zero TypeScript errors
- ✅ Zero ESLint violations
- ✅ WCAG 2.1 Level AA compliance

### Performance

- ✅ @ mention autocomplete <100ms
- ✅ File search <300ms
- ✅ No UI lag during typing

### User Experience

- ✅ Intuitive @ mention syntax (matches CLI)
- ✅ Clear model cost indicators
- ✅ MCP status easy to understand
- ✅ Cost data unobtrusive

---

## Orchestration Commands

```bash
# Phase 1: @ Mention System
/orchestrate Implement @ mention autocomplete system with file search, agent/command/MCP tool suggestions, and session capabilities tracking (TASK_2025_005 Phase 1)

# Phase 2: Model Selection
/orchestrate Implement model selector UI with Sonnet/Opus/Haiku options, cost display, and backend wiring to Claude CLI (TASK_2025_005 Phase 2)

# Phase 3: MCP Status
/orchestrate Implement MCP server status panel with connection status, tool lists, and expand/collapse functionality (TASK_2025_005 Phase 3)

# Phase 4: Cost Tracking
/orchestrate Implement cost and token tracking with result message parsing, message footer component, and session cost accumulation (TASK_2025_005 Phase 4)

# Phase 5: Capabilities Panel
/orchestrate Implement capabilities sidebar panel with workspace, model, MCP servers, agents, commands, and session stats sections (TASK_2025_005 Phase 5)

# Phase 6: Integration
/orchestrate Integrate all rich CLI feature components into ChatComponent, perform E2E testing, and finalize UX polish (TASK_2025_005 Phase 6)
```

---

## Risk Mitigation

1. **File Search Performance**

   - Mitigation: Limit to 50 results, debounce 300ms, exclude node_modules
   - Fallback: Cache recent searches, show warning if workspace >10k files

2. **@ Mention Complexity**

   - Mitigation: Reuse existing dropdown patterns from session selector
   - Fallback: Text-based syntax without autocomplete (match CLI exactly)

3. **MCP Server Unreliability**

   - Mitigation: Show stale data indicator if capabilities >1 minute old
   - Fallback: Display "Unknown" status if capability data missing

4. **Cost Tracking Accuracy**

   - Mitigation: Validate cost format matches expected schema
   - Fallback: Display "N/A" if cost data malformed

5. **Integration Breakage**
   - Mitigation: Feature flags for each phase, comprehensive regression tests
   - Fallback: Disable feature via config if critical bugs found

---

## Next Actions

1. **Start Phase 1**: `/orchestrate` @ mention system
2. **Iterative Approach**: Complete each phase fully before moving to next
3. **Continuous Testing**: Run tests after each component completion
4. **User Validation**: Dogfood features in ptah-extension workspace

Ready to begin! 🚀
