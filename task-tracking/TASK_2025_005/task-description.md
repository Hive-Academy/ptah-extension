# Requirements Document - TASK_2025_005

## Introduction

### Executive Summary

This requirements document specifies the implementation of **Rich Claude CLI Features** for Ptah's VS Code extension, achieving full UI parity with Claude Code CLI terminal capabilities. Building on the successful completion of TASK_2025_004 (Agent Visualization), this task implements the 6-phase plan defined in IMPLEMENTATION_PLAN.md.

### Business Context

Claude Code CLI provides powerful features that are currently only accessible via terminal:

- **@ Mention System**: Context injection via @file:, @agent:, @cmd:, @mcp: syntax
- **Model Selection**: Per-session model switching (Sonnet, Opus, Haiku)
- **MCP Server Status**: Visibility into loaded MCP servers and available tools
- **Cost & Token Tracking**: Per-message and cumulative cost/token usage display
- **Session Capabilities**: Comprehensive view of available tools, agents, commands

Users switching from Claude CLI terminal to Ptah expect these features to be available in the UI.

### Value Proposition

Implementing rich CLI features delivers:

1. **Feature Parity**: Match Claude CLI terminal experience in VS Code
2. **Improved UX**: Visual UI for features currently requiring memorized syntax
3. **Power User Enablement**: Access to advanced features (MCP tools, custom agents)
4. **Cost Transparency**: Real-time visibility into API costs and token usage
5. **Workspace Intelligence**: Autocomplete for files, agents, commands, tools

### Technical Foundation

All backend infrastructure is already in place:

- ✅ **JSONL Parser**: Processes all message types including system, result, capabilities
- ✅ **EventBus**: Real-time event distribution to frontend
- ✅ **Session Manager**: Persistence and CRUD operations
- ✅ **Message Protocol**: Webview ↔ Extension communication

Only frontend UI components and minor backend wiring required.

### Scope Boundaries

**In Scope** (6 Phases):

1. @ Mention System (mention input, autocomplete, file/agent/command/mcp search)
2. Model Selection UI (model selector, cost display, backend wiring)
3. MCP Server Status UI (server list, tool display, connection status)
4. Cost & Token Tracking (per-message footer, session accumulator)
5. Session Capabilities Panel (tools, agents, commands, stats display)
6. Integration & Polish (wire all components, final UX)

**Out of Scope** (Future Enhancements):

- Agent control features (pause, modify, resume agents)
- Custom agent/command creation UI
- MCP server configuration editor
- Cost budgeting/alerts
- Token optimization recommendations
- Export/import session transcripts

---

## Requirements

### Phase 1: @ Mention System

#### Requirement 1.1: Mention Input Component

**User Story**: As a user, I want to type @ in the chat input and see autocomplete suggestions for files, agents, commands, and MCP tools, so that I can easily inject context into my messages.

**Acceptance Criteria**:

1. WHEN user types "@" THEN MentionInputComponent SHALL display dropdown menu with all mention types (files, agents, commands, MCP tools)
2. WHEN user types "@file:" THEN component SHALL filter to file suggestions and call WorkspaceService.searchFiles()
3. WHEN user types "@agent:" THEN component SHALL filter to custom agents from session capabilities
4. WHEN user types "@cmd:" THEN component SHALL filter to slash commands from session capabilities
5. WHEN user types "@mcp:" THEN component SHALL filter to MCP tools from session capabilities
6. WHEN user presses ArrowDown/ArrowUp THEN component SHALL navigate through suggestions with visual highlight
7. WHEN user presses Enter or Tab THEN component SHALL insert selected mention and close dropdown
8. WHEN user presses Escape THEN component SHALL close dropdown without insertion
9. WHEN user clicks outside dropdown THEN component SHALL close dropdown
10. WHEN mention menu is visible THEN component SHALL position dropdown near cursor (below or above based on available space)

**Technical Constraints**:

- Use Angular signal-based state (no BehaviorSubject)
- Debounce file search queries by 300ms
- Limit autocomplete results to 20 items max
- Preserve cursor position after mention insertion

**Files to Create**:

- `libs/frontend/chat/src/lib/components/mention-input/mention-input.component.ts`
- `libs/frontend/chat/src/lib/components/mention-input/mention-input.component.html`
- `libs/frontend/chat/src/lib/components/mention-input/mention-input.component.css`
- `libs/frontend/chat/src/lib/components/mention-input/mention-input.component.spec.ts`

---

#### Requirement 1.2: Workspace File Search

**User Story**: As a user, I want to search for workspace files by typing partial file names, so that I can quickly attach relevant files to my message context.

**Acceptance Criteria**:

1. WHEN WorkspaceService.searchFiles(query) is called THEN service SHALL use vscode.workspace.findFiles() API
2. WHEN searching THEN service SHALL exclude node_modules, .git, dist, build directories
3. WHEN results are returned THEN service SHALL provide file name, relative path, and absolute path
4. WHEN query is empty THEN service SHALL return recently opened files (max 10)
5. WHEN search fails THEN service SHALL return empty array (no error throw)

**Technical Constraints**:

- Search limited to current workspace only
- Maximum 50 results to prevent performance issues
- Use VS Code native search API (no custom file traversal)

**Files to Create**:

- `libs/frontend/core/src/lib/services/workspace.service.ts`
- `libs/frontend/core/src/lib/services/workspace.service.spec.ts`

---

#### Requirement 1.3: Session Capabilities Tracking

**User Story**: As the system, I want to track session capabilities (agents, commands, MCP servers) from Claude CLI initialization, so that autocomplete suggestions reflect what's available in the current session.

**Acceptance Criteria**:

1. WHEN JSONLStreamParser receives system message with subtype="init" THEN parser SHALL extract capabilities (agents, slash_commands, mcp_servers, tools)
2. WHEN capabilities are detected THEN ClaudeDomainEventPublisher SHALL publish "claude:capabilitiesDetected" event
3. WHEN MessageHandlerService receives capabilities event THEN service SHALL forward to webview as "session:capabilitiesUpdated" message
4. WHEN ChatService receives capabilities message THEN service SHALL update sessionCapabilities signal
5. WHEN session switches THEN ChatService SHALL clear capabilities and wait for new init message

**Technical Constraints**:

- Capabilities must be persisted with session for resume
- Add to StrictChatSession interface as optional field
- Handle missing capabilities gracefully (empty arrays)

**Files to Modify**:

- `libs/shared/src/lib/types/claude-domain.types.ts` (add SessionCapabilities interface)
- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (extract capabilities)
- `libs/backend/claude-domain/src/session/session-manager.ts` (persist capabilities)
- `libs/frontend/core/src/lib/services/chat.service.ts` (add capabilities signal)

---

### Phase 2: Model Selection UI

#### Requirement 2.1: Model Selector Component

**User Story**: As a user, I want to select which Claude model to use (Sonnet, Opus, Haiku) before starting a session, so that I can choose the right balance of performance, cost, and capability.

**Acceptance Criteria**:

1. WHEN user creates new session THEN ModelSelectorComponent SHALL display dropdown with 3 models (Sonnet 4.5, Opus 3, Haiku 4.5)
2. WHEN user selects model THEN component SHALL emit modelChanged event with model ID
3. WHEN model is selected THEN component SHALL display estimated cost per 1M tokens
4. WHEN session is resumed THEN component SHALL pre-select the session's saved model
5. WHEN model selection changes mid-session THEN component SHALL show warning dialog (model cannot change after session start)

**Visual Requirements**:

- Dropdown with model name, description, and cost indicator
- Use VS Code theming (select element with native styling)
- Display model icon/badge (🎯 Sonnet, 🚀 Opus, ⚡ Haiku)

**Files to Create**:

- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.ts`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.html`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.css`
- `libs/frontend/chat/src/lib/components/model-selector/model-selector.component.spec.ts`

---

#### Requirement 2.2: Backend Model Passing

**User Story**: As the backend, I want to pass the selected model to Claude CLI via --model flag, so that users get the model they requested.

**Acceptance Criteria**:

1. WHEN ClaudeCliLauncher.launch() is called with model parameter THEN launcher SHALL add "--model <model>" to CLI args
2. WHEN model is "default" or undefined THEN launcher SHALL omit --model flag (use CLI default)
3. WHEN SessionManager.createSession() is called THEN manager SHALL store model in session.model field
4. WHEN session is resumed THEN SessionManager SHALL pass session.model to launcher

**Technical Constraints**:

- Model validation: Only accept "sonnet", "opus", "haiku", or undefined
- Store full model ID (e.g., "claude-sonnet-4-5-20250929") in session
- CLI launcher already supports --model flag (no code changes needed)

**Files to Modify**:

- `libs/backend/claude-domain/src/session/session-manager.ts` (add model to StrictChatSession)
- `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts` (already supports --model)

---

### Phase 3: MCP Server Status UI

#### Requirement 3.1: MCP Status Component

**User Story**: As a user, I want to see which MCP servers are loaded, their connection status, and available tools, so that I know what capabilities are available for @ mentions.

**Acceptance Criteria**:

1. WHEN session capabilities include mcp_servers THEN McpStatusComponent SHALL display server list with name and status (connected/disabled/failed)
2. WHEN server status is "connected" THEN component SHALL show tool count and expandable tool list
3. WHEN server status is "failed" THEN component SHALL display error indicator and "Retry" button
4. WHEN user clicks server name THEN component SHALL expand/collapse tool list
5. WHEN no MCP servers are configured THEN component SHALL display "No MCP servers configured" empty state

**Visual Requirements**:

- Server cards with status badge (🟢 connected, 🟡 disabled, 🔴 failed)
- Collapsible tool list with icons (🔧 for each tool)
- Retry button for failed servers

**Files to Create**:

- `libs/frontend/session/src/lib/components/mcp-status/mcp-status.component.ts`
- `libs/frontend/session/src/lib/components/mcp-status/mcp-status.component.html`
- `libs/frontend/session/src/lib/components/mcp-status/mcp-status.component.css`
- `libs/frontend/session/src/lib/components/mcp-status/mcp-status.component.spec.ts`

---

### Phase 4: Cost & Token Tracking

#### Requirement 4.1: Result Message Parsing

**User Story**: As the backend, I want to parse result messages from Claude CLI containing cost and token usage, so that I can display this information to users.

**Acceptance Criteria**:

1. WHEN JSONLStreamParser receives message with type="result" THEN parser SHALL extract total_cost_usd, duration_ms, and usage fields
2. WHEN result message is parsed THEN parser SHALL emit "claude:result" event with cost/token data
3. WHEN MessageHandlerService receives result event THEN service SHALL forward to webview as "message:result"
4. WHEN ChatService receives result message THEN service SHALL update last message with cost/tokens/duration
5. WHEN session accumulates costs THEN SessionManager SHALL update session.totalCost, totalTokensInput, totalTokensOutput

**Technical Constraints**:

- Handle missing cost/usage fields gracefully (display N/A)
- Store costs in USD cents to avoid floating-point precision issues
- Parse modelUsage map for multi-model sessions

**Files to Modify**:

- `libs/shared/src/lib/types/claude-domain.types.ts` (add JSONLResultMessage interface)
- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (parse result messages)
- `libs/backend/claude-domain/src/session/session-manager.ts` (accumulate costs)

---

#### Requirement 4.2: Message Footer Component

**User Story**: As a user, I want to see per-message cost, token usage, and duration, so that I understand the API costs of my conversations.

**Acceptance Criteria**:

1. WHEN message has cost data THEN MessageFooterComponent SHALL display cost badge (💰 $0.0042)
2. WHEN message has token data THEN component SHALL display token counts (📊 1234↑ 567↓)
3. WHEN tokens used cache THEN component SHALL display "cached" badge
4. WHEN message has duration THEN component SHALL display timing (⏱️ 1.2s)
5. WHEN no cost/token data available THEN component SHALL not render (empty)

**Visual Requirements**:

- Compact footer below message content
- Subtle gray color for low visual noise
- Icons for cost (💰), tokens (📊), duration (⏱️)

**Files to Create**:

- `libs/frontend/chat/src/lib/components/message-footer/message-footer.component.ts`
- `libs/frontend/chat/src/lib/components/message-footer/message-footer.component.html`
- `libs/frontend/chat/src/lib/components/message-footer/message-footer.component.css`
- `libs/frontend/chat/src/lib/components/message-footer/message-footer.component.spec.ts`

---

### Phase 5: Session Capabilities Panel

#### Requirement 5.1: Capabilities Panel Component

**User Story**: As a user, I want to see all session capabilities (workspace, model, MCP servers, agents, commands, stats) in a sidebar panel, so that I have a complete overview of what's available.

**Acceptance Criteria**:

1. WHEN session has capabilities THEN CapabilitiesPanelComponent SHALL display 6 sections (Workspace, Model, MCP Servers, Custom Agents, Custom Commands, Session Stats)
2. WHEN panel header is clicked THEN component SHALL collapse/expand panel
3. WHEN workspace section is displayed THEN component SHALL show current working directory
4. WHEN model section is displayed THEN component SHALL show active model name
5. WHEN custom agents section is displayed THEN component SHALL filter out built-in agents (general-purpose, Explore, Plan)
6. WHEN custom commands section is displayed THEN component SHALL filter out built-in slash commands (/help, /clear, /compact, etc.)
7. WHEN session stats section is displayed THEN component SHALL show total cost, message count, token count

**Visual Requirements**:

- Collapsible sections with expand/collapse icons
- Clear section headers (h4)
- Stat grid layout for session stats
- Emoji icons for visual distinction

**Files to Create**:

- `libs/frontend/session/src/lib/components/capabilities-panel/capabilities-panel.component.ts`
- `libs/frontend/session/src/lib/components/capabilities-panel/capabilities-panel.component.html`
- `libs/frontend/session/src/lib/components/capabilities-panel/capabilities-panel.component.css`
- `libs/frontend/session/src/lib/components/capabilities-panel/capabilities-panel.component.spec.ts`

---

### Phase 6: Integration & Polish

#### Requirement 6.1: Chat Component Integration

**User Story**: As the system, I want all new components integrated into ChatComponent layout, so that users have a cohesive UI experience.

**Acceptance Criteria**:

1. WHEN ChatComponent renders THEN component SHALL include MentionInputComponent in place of current text input
2. WHEN new session is created THEN component SHALL display ModelSelectorComponent in session creation dialog
3. WHEN session is active THEN component SHALL display CapabilitiesPanelComponent in left sidebar
4. WHEN message has cost/token data THEN component SHALL render MessageFooterComponent below message content
5. WHEN layout adapts THEN all components SHALL maintain responsive design (320px - 1920px viewport)

**Technical Constraints**:

- Use Angular standalone components (no NgModules)
- Signal-based data flow (no RxJS subscriptions in templates)
- OnPush change detection for all new components

**Files to Modify**:

- `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
- `libs/frontend/chat/src/lib/containers/chat/chat.component.html`
- `libs/frontend/chat/src/lib/containers/chat/chat.component.css`

---

## Non-Functional Requirements

### Performance Requirements

1. **Autocomplete Response Time**:

   - @ mention dropdown SHALL appear <100ms after @ key press
   - File search SHALL complete <300ms for workspace with <10,000 files
   - Autocomplete filtering SHALL maintain 60fps typing responsiveness

2. **Cost Calculation Overhead**:

   - Session cost accumulation SHALL add <5ms latency to message processing
   - Cost display SHALL not block message rendering

3. **Capabilities Panel Rendering**:
   - Panel SHALL render <50ms for sessions with 20 MCP servers, 50 agents, 100 commands

### Security Requirements

1. **Input Sanitization**:

   - All @ mention inputs SHALL sanitize for XSS (use Angular DomSanitizer)
   - File paths SHALL validate against path traversal attacks (../../etc/passwd)

2. **Data Privacy**:
   - File search SHALL not log sensitive file paths
   - Cost data SHALL not include API keys or tokens in logs

### Accessibility Requirements

1. **WCAG 2.1 Level AA**:
   - All dropdowns SHALL support keyboard navigation
   - All icons SHALL have ARIA labels
   - Color contrast SHALL meet 4.5:1 ratio

### Usability Requirements

1. **Learnability**:

   - @ mention syntax SHALL match Claude CLI terminal exactly
   - Model selector SHALL explain differences between models (tooltip or description)

2. **Error Handling**:
   - File search failures SHALL display user-friendly message ("Unable to search files")
   - Invalid @ mentions SHALL show warning without blocking message send

---

## Implementation Phases

### Phase 1: @ Mention System (Days 1-5)

- Day 1-2: MentionInputComponent with basic @ detection and keyboard navigation
- Day 3: WorkspaceService file search integration
- Day 4: Session capabilities tracking (agents, commands, MCP tools)
- Day 5: Testing, bug fixes, UX polish

**Deliverables**: @ mention autocomplete works with all 4 types (file, agent, command, MCP)

### Phase 2: Model Selection (Days 6-8)

- Day 6: ModelSelectorComponent UI with dropdown
- Day 7: Backend wiring (SessionManager, ClaudeCliLauncher)
- Day 8: Testing, model validation, cost display

**Deliverables**: Users can select model and see cost estimates

### Phase 3: MCP Status (Days 9-11)

- Day 9: McpStatusComponent with server list
- Day 10: Tool expansion, status badges, retry functionality
- Day 11: Testing, empty states, error handling

**Deliverables**: MCP server status visible with tool lists

### Phase 4: Cost Tracking (Days 12-14)

- Day 12: Result message parsing in JSONLStreamParser
- Day 13: MessageFooterComponent with cost/token display
- Day 14: Session cost accumulation, testing

**Deliverables**: Per-message and cumulative costs displayed

### Phase 5: Capabilities Panel (Days 15-17)

- Day 15: CapabilitiesPanelComponent structure
- Day 16: Section rendering (workspace, model, MCP, agents, commands, stats)
- Day 17: Collapse/expand, filtering, testing

**Deliverables**: Comprehensive capabilities sidebar

### Phase 6: Integration (Days 18-20)

- Day 18: Integrate all components into ChatComponent
- Day 19: End-to-end testing with real Claude CLI
- Day 20: Bug fixes, UX refinements, documentation

**Deliverables**: All features working together, production-ready

---

## Success Criteria

### Functional Metrics

| Feature            | Success Criteria                                                                    |
| ------------------ | ----------------------------------------------------------------------------------- |
| @ Mention System   | 100% of mention types work (file, agent, command, MCP)                              |
| Model Selection    | Users can select all 3 models and see cost estimates                                |
| MCP Status         | All MCP servers display with correct status and tool counts                         |
| Cost Tracking      | Per-message and cumulative costs display correctly                                  |
| Capabilities Panel | All 6 sections render with correct data                                             |
| End-to-End Flow    | User can create session, select model, use @ mentions, see costs, view capabilities |

### Quality Metrics

| Metric            | Target                                         |
| ----------------- | ---------------------------------------------- |
| Test Coverage     | 80% minimum (unit + integration)               |
| TypeScript Strict | Zero `any` types, full strict mode compilation |
| Accessibility     | WCAG 2.1 Level AA (Axe DevTools audit pass)    |
| Performance       | @ mention <100ms, file search <300ms           |

### Business Metrics

| Metric                   | Target                                      |
| ------------------------ | ------------------------------------------- |
| Feature Parity           | 100% of IMPLEMENTATION_PLAN phases complete |
| User Adoption            | 70% of users use @ mentions within 1 week   |
| User Satisfaction        | >4.0/5.0 rating for rich CLI features       |
| Support Ticket Reduction | 30% fewer "how do I..." questions           |

---

## Dependencies

### Internal Dependencies

1. **TASK_2025_004** (Agent Visualization) - COMPLETED ✅

   - Provides pattern for signal-based components
   - Establishes EventBus integration patterns

2. **libs/shared** (Type System)

   - MUST add SessionCapabilities interface
   - MUST add JSONLResultMessage interface

3. **libs/backend/claude-domain** (JSONL Parser)
   - MUST parse result messages
   - MUST extract session capabilities

### External Dependencies

1. **Claude Code CLI** (v1.0+)

   - Required for testing @ mentions, model selection, MCP servers
   - Fallback: Mock capabilities for unit tests

2. **VS Code Extension API**
   - vscode.workspace.findFiles() for file search
   - No new API surface area required

---

## Risk Assessment

| Risk                                                            | Probability | Impact   | Mitigation                                                      |
| --------------------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------- |
| @ mention autocomplete causes input lag                         | Medium      | High     | Debounce search queries, limit results to 20, virtual scrolling |
| File search fails in large workspaces (>100k files)             | Medium      | Medium   | Add file count limit, exclude common large dirs (node_modules)  |
| MCP server status unreliable (servers change state mid-session) | Low         | Medium   | Poll capabilities every 30s, show stale data indicator          |
| Cost tracking inaccurate (Claude CLI cost API changes)          | Low         | High     | Add version detection, warn if cost format unrecognized         |
| Integration complexity breaks existing chat                     | Medium      | Critical | Feature flags for each phase, comprehensive regression testing  |

---

## Quality Gates

Before marking task complete:

- [ ] All 6 phases implemented and tested
- [ ] 80% test coverage across all new components
- [ ] Zero TypeScript errors, zero ESLint violations
- [ ] WCAG 2.1 Level AA compliance verified
- [ ] Performance benchmarks met (@ mention <100ms, file search <300ms)
- [ ] End-to-end testing with real Claude CLI passed
- [ ] Documentation updated (CLAUDE.md files)
- [ ] User guide with screenshots created

---

## Next Steps

1. **Review this plan** - Confirm approach and priorities
2. **Start with Phase 1** - @ Mention System (highest user value)
3. **Iterate quickly** - Get each phase working end-to-end before moving on
4. **Use /orchestrate** - Invoke workflow orchestration for each phase

Ready to implement! 🚀
