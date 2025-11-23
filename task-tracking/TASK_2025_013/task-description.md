# Requirements Document - TASK_2025_013

## Introduction

### Business Context

Ptah is a VS Code extension that provides a complete visual interface for Claude Code CLI. While the CLI offers powerful features through text-based `@` mentions and slash commands, Ptah has the opportunity to create a **superior user experience** through native VS Code integration and visual controls.

This task unifies two previously separate initiatives into a comprehensive "Context Management & Interaction Platform" that transforms Claude CLI from a terminal-based interface into a first-class VS Code citizen.

### Value Proposition

**Current State**: Claude CLI users type commands in a terminal (`@file:path`, `/context`, `--model opus`)
**Target State**: Ptah users drag-drop files, click agent templates, view real-time context dashboards, and leverage intelligent workspace analysis

**Competitive Advantage**: GUI-first experience that SURPASSES CLI capabilities, not just replicates them.

### Unified Architecture

This platform consists of three integrated layers:

1. **Backend API Layer** - 7 VS Code commands exposing workspace-intelligence and context-manager capabilities
2. **Frontend UI Layer** - Visual controls for file attachment, agent selection, context management, and command execution
3. **Integration Layer** - Event-driven synchronization between UI components and backend services

---

## Requirements

### Requirement 1: Backend Workspace Intelligence API

**User Story**: As Claude Code CLI running within Ptah, I want programmatic access to workspace analysis capabilities via VS Code commands, so that I can make intelligent decisions about code context and file relevance without external MCP servers.

#### Acceptance Criteria

1. **Command Registration**

   - WHEN extension activates THEN 7 workspace intelligence commands SHALL be registered (`ptah.analyzeWorkspace`, `ptah.searchRelevantFiles`, `ptah.getTokenEstimate`, `ptah.optimizeContext`, `ptah.getProjectStructure`, `ptah.getCurrentContext`, `ptah.callVsCodeLM`)
   - WHEN any command is called THEN it SHALL return a standardized JSON response with `success`, `data`, `error`, and `timestamp` fields
   - WHEN command execution fails THEN error SHALL be caught and returned in standardized format (no exceptions thrown)

2. **Workspace Analysis Command** (`ptah.analyzeWorkspace`)

   - WHEN command is executed THEN it SHALL return project type (nx-monorepo, react-app, etc.), total file count, detected languages, frameworks, build system, and test frameworks
   - WHEN analysis completes THEN response time SHALL be under 3 seconds for workspaces up to 1000 files
   - WHEN workspace is empty THEN it SHALL return valid response with zero counts (not error)

3. **File Search Command** (`ptah.searchRelevantFiles`)

   - WHEN query parameter is provided THEN it SHALL search workspace files and return results ranked by relevance score
   - WHEN maxResults parameter is specified THEN it SHALL limit output to that number (default 20, max 100)
   - WHEN includeImages is true THEN it SHALL include image files in results
   - WHEN search completes THEN each result SHALL include path, fileName, fileType, relevanceScore, size, and lastModified
   - WHEN no matches found THEN it SHALL return empty array (not error)

4. **Token Estimation Command** (`ptah.getTokenEstimate`)

   - WHEN files array is provided THEN it SHALL calculate token counts for each file
   - WHEN useAccurateCounting is true THEN it SHALL use TokenCounterService for precise counts
   - WHEN useAccurateCounting is false THEN it SHALL use rough estimation (1 token ≈ 4 characters)
   - WHEN estimation completes THEN response SHALL include totalTokens, per-file breakdown, maxContextTokens (200K), and percentageUsed
   - WHEN file does not exist THEN it SHALL include error in response for that file only (not fail entire command)

5. **Context Optimization Command** (`ptah.optimizeContext`)

   - WHEN command is executed THEN it SHALL analyze current context and return optimization suggestions
   - WHEN suggestions are generated THEN each SHALL specify type, description, estimatedSavings (tokens), autoApplicable flag, and affected files
   - WHEN context is already optimal THEN it SHALL return empty suggestions array with explanation

6. **Project Structure Command** (`ptah.getProjectStructure`)

   - WHEN maxDepth parameter is specified THEN it SHALL limit directory traversal to that depth (default 3)
   - WHEN excludePatterns are provided THEN it SHALL skip matching directories (default: node_modules, dist, .git)
   - WHEN structure is generated THEN it SHALL return hierarchical JSON with name, type (directory/file), and children

7. **Current Context Command** (`ptah.getCurrentContext`)

   - WHEN command is executed THEN it SHALL return currently included files, excluded files, token estimate, and applied optimizations
   - WHEN context is empty THEN it SHALL return valid response with empty arrays

8. **AI Delegation Command** (`ptah.callVsCodeLM`)

   - WHEN prompt parameter is provided THEN it SHALL create ephemeral VS Code LM session and send prompt
   - WHEN model parameter is specified THEN it SHALL use that model (gpt-4o, gpt-4-turbo, gpt-3.5-turbo)
   - WHEN includeContext is true THEN it SHALL enhance prompt with workspace context (max 5 files for token efficiency)
   - WHEN maxTokens is specified THEN it SHALL pass to session configuration
   - WHEN systemPrompt is provided THEN it SHALL set custom system message
   - WHEN VS Code LM is unavailable THEN it SHALL return error with clear message about missing GitHub Copilot
   - WHEN response completes THEN it SHALL return full response text, model, provider, responseTime, tokensUsed (prompt/response/total), and contextIncluded flag
   - WHEN session ends THEN it SHALL cleanup ephemeral session resources

9. **Command Accessibility**

   - WHEN command is called from Claude CLI THEN it SHALL execute successfully via `vscode.commands.executeCommand()`
   - WHEN command is called from frontend webview THEN it SHALL execute successfully via message protocol
   - WHEN command is called from VS Code command palette THEN it SHALL execute successfully

10. **Performance Requirements**
    - WHEN file search is executed THEN 95% of requests SHALL complete under 300ms
    - WHEN token estimation is executed THEN 95% of requests SHALL complete under 100ms (rough) or 500ms (accurate)
    - WHEN AI delegation is executed THEN response SHALL stream (not block until completion)

---

### Requirement 2: Frontend File Attachment System

**User Story**: As a Ptah user interacting with Claude through the visual interface, I want multiple intuitive ways to attach files to my chat context, so that I can provide relevant code without typing file paths.

#### Acceptance Criteria

1. **File Picker Button**

   - WHEN user clicks "Attach Files" button in chat input area THEN file picker modal SHALL open
   - WHEN file picker opens THEN it SHALL call `ptah.searchRelevantFiles` with empty query to populate initial list
   - WHEN user types in search box THEN it SHALL debounce 300ms and call `ptah.searchRelevantFiles` with query
   - WHEN search results appear THEN each file SHALL show name, path, relevance score, and size
   - WHEN user selects file THEN it SHALL add to attached files list and close modal
   - WHEN user selects multiple files THEN it SHALL support multi-select (Ctrl+Click, Shift+Click)

2. **Drag-Drop Attachment**

   - WHEN user drags file from VS Code Explorer THEN chat input area SHALL show drop zone overlay
   - WHEN user drops file onto chat input THEN it SHALL add to attached files list
   - WHEN user drops multiple files THEN all SHALL be added
   - WHEN user drops non-text file (binary) THEN it SHALL show warning and skip (configurable)

3. **Explorer Context Menu**

   - WHEN user right-clicks file in VS Code Explorer THEN context menu SHALL include "Attach to Claude Context" option
   - WHEN user selects menu option THEN file SHALL be added to current chat session's attached files
   - WHEN user right-clicks folder THEN context menu SHALL include "Attach Folder to Claude Context" option (attaches all text files in folder)

4. **Attached Files Display**

   - WHEN files are attached THEN they SHALL appear as chips/badges below chat input with file icon, name, and token estimate
   - WHEN user hovers chip THEN it SHALL show full path and detailed token breakdown
   - WHEN user clicks X button on chip THEN file SHALL be removed from attached list
   - WHEN attached files change THEN total token estimate SHALL update in real-time
   - WHEN total tokens exceed 180K (90% of 200K limit) THEN visual warning SHALL appear

5. **Token Estimation Integration**
   - WHEN file is attached THEN system SHALL call `ptah.getTokenEstimate` with rough estimation
   - WHEN user clicks "Get Accurate Count" button THEN system SHALL call `ptah.getTokenEstimate` with useAccurateCounting=true
   - WHEN token counts update THEN UI SHALL reflect changes within 100ms

---

### Requirement 3: Frontend Agent Selection System

**User Story**: As a Ptah user, I want visual controls for selecting Claude agents (built-in and custom), so that I can switch agent personas without typing `@` mentions.

#### Acceptance Criteria

1. **Agent Dropdown in Chat Header**

   - WHEN chat session loads THEN agent dropdown SHALL appear in chat header showing current agent (default: "General Purpose")
   - WHEN user clicks dropdown THEN it SHALL show all available agents (built-in + custom from `.claude/agents/`)
   - WHEN dropdown opens THEN it SHALL call session capabilities API to populate agent list
   - WHEN user selects agent THEN it SHALL update current session agent and show confirmation toast

2. **Built-in Agent Discovery**

   - WHEN session capabilities are loaded THEN built-in agents SHALL be extracted and displayed (filter out: general-purpose, Explore, Plan, statusline-setup)
   - WHEN built-in agents are displayed THEN each SHALL show name, description, and icon

3. **Custom Agent Discovery**

   - WHEN extension activates THEN it SHALL scan `.claude/agents/` directory for custom agents
   - WHEN custom agents are found THEN they SHALL appear in dropdown under "Custom Agents" section
   - WHEN no custom agents exist THEN dropdown SHALL show "No custom agents found" message with link to documentation

4. **Agent Templates**

   - WHEN dropdown opens THEN it SHALL show pre-configured templates: "🐛 Debug", "♻️ Refactor", "🧪 Test", "📚 Document"
   - WHEN user selects template THEN it SHALL load agent configuration with appropriate system prompt
   - WHEN template is applied THEN visual indicator SHALL show active template in chat header

5. **Visual Agent Builder (Future Enhancement Marker)**

   - WHEN user clicks "Create Custom Agent" button THEN it SHALL show coming soon dialog with "Open .claude/agents/ folder" fallback

6. **Agent State Management**
   - WHEN agent is changed THEN UI SHALL update chat header, send agent change message to backend, and clear current input (preserve attached files)
   - WHEN session is resumed THEN it SHALL restore last selected agent

---

### Requirement 4: Frontend Context Dashboard

**User Story**: As a Ptah user, I want real-time visibility into my context usage and optimization opportunities, so that I can make informed decisions about what to include without hitting token limits.

#### Acceptance Criteria

1. **Token Usage Widget**

   - WHEN context changes THEN token usage bar SHALL update showing X/200K tokens
   - WHEN usage is under 70% (140K tokens) THEN bar SHALL be green
   - WHEN usage is 70-90% (140K-180K tokens) THEN bar SHALL be yellow
   - WHEN usage exceeds 90% (180K+ tokens) THEN bar SHALL be red with warning icon
   - WHEN user hovers token bar THEN tooltip SHALL show breakdown: system prompt, conversation history, attached files, agent configuration

2. **Included Files Panel**

   - WHEN context dashboard opens THEN it SHALL call `ptah.getCurrentContext` to populate file list
   - WHEN files are listed THEN each SHALL show name, path, token count, and remove button
   - WHEN files are sorted THEN default order SHALL be by token count (descending)
   - WHEN user clicks column header THEN sort order SHALL toggle (name, path, tokens, date modified)

3. **Optimization Suggestions Panel**

   - WHEN dashboard loads THEN it SHALL call `ptah.optimizeContext` to fetch suggestions
   - WHEN suggestions are displayed THEN each SHALL show type badge, description, estimated token savings, and action button
   - WHEN user clicks "Apply" on suggestion THEN it SHALL execute optimization and update context
   - WHEN optimization is applied THEN it SHALL refresh context data and show success toast
   - WHEN no optimizations available THEN panel SHALL show "Context is already optimized ✓" message

4. **Excluded Files/Patterns Display**

   - WHEN exclusions exist THEN panel SHALL show list of excluded patterns (_.test.ts, node_modules/_, etc.)
   - WHEN user clicks excluded pattern THEN it SHALL show affected files count in tooltip
   - WHEN user clicks remove button on pattern THEN it SHALL remove exclusion and update context

5. **Real-time Synchronization**
   - WHEN file is attached via any method THEN dashboard SHALL update within 100ms
   - WHEN optimization is applied THEN all panels SHALL refresh with new data
   - WHEN context exceeds limits THEN dashboard SHALL show actionable error message

---

### Requirement 5: Frontend Command Execution UI

**User Story**: As a Ptah user, I want visual buttons for common Claude CLI commands, so that I can execute operations without memorizing slash command syntax.

#### Acceptance Criteria

1. **Command Toolbar**

   - WHEN chat session is active THEN command toolbar SHALL appear with buttons for: "/cost", "/compact", "/help", "Optimize Context", "View Capabilities"
   - WHEN user clicks "/cost" button THEN it SHALL send `/cost` command to Claude CLI and display result in chat
   - WHEN user clicks "/compact" button THEN it SHALL send `/compact` command and show confirmation dialog
   - WHEN user clicks "/help" button THEN it SHALL open help panel in sidebar

2. **VS Code Command Palette Integration**

   - WHEN user opens VS Code command palette (Ctrl+Shift+P) THEN Ptah commands SHALL appear with "Ptah:" prefix
   - WHEN user searches "Ptah" THEN all extension commands SHALL be discoverable (Analyze Workspace, Search Files, Optimize Context, etc.)
   - WHEN command is executed from palette THEN result SHALL be displayed in appropriate UI location (chat, dashboard, notification)

3. **Message Context Menu**

   - WHEN user right-clicks Claude message THEN context menu SHALL include: "Copy Message", "Copy Code Blocks", "Regenerate Response", "Report Issue"
   - WHEN user selects "Regenerate Response" THEN it SHALL resend last user message and replace Claude's response
   - WHEN user selects "Copy Code Blocks" THEN it SHALL extract all code blocks and copy to clipboard

4. **Keyboard Shortcuts (Future Enhancement)**
   - WHEN user enables keyboard shortcuts in settings THEN common operations SHALL have keybindings: Ctrl+Shift+A (attach files), Ctrl+Shift+O (open context dashboard), Ctrl+Shift+D (change agent)

---

### Requirement 6: Frontend MCP Tool Discovery

**User Story**: As a Ptah user, I want visibility into available MCP tools and their capabilities, so that I can understand what external integrations Claude can use.

#### Acceptance Criteria

1. **MCP Tool Catalog**

   - WHEN capabilities panel opens THEN it SHALL display all MCP servers with their status (connected, disabled, failed)
   - WHEN MCP server is listed THEN it SHALL show server name, status badge (green/yellow/red), and tool count
   - WHEN user clicks server THEN it SHALL expand to show list of available tools

2. **Tool Details Display**

   - WHEN tool list expands THEN each tool SHALL show name, description, and parameter count
   - WHEN user clicks tool name THEN it SHALL open detail panel with full parameter schema
   - WHEN parameters are complex THEN detail panel SHALL render JSON schema as form with field descriptions

3. **Tool Configuration Forms (Future Enhancement)**

   - WHEN user clicks "Configure" on tool THEN it SHALL open form pre-populated with parameter schema
   - WHEN user submits form THEN it SHALL generate proper tool invocation syntax for Claude

4. **Server Status Actions**
   - WHEN MCP server status is "failed" THEN retry button SHALL appear
   - WHEN user clicks retry THEN it SHALL attempt to reconnect server and update status
   - WHEN server cannot connect THEN error message SHALL display with troubleshooting link

---

### Requirement 7: Integration Between Backend and Frontend

**User Story**: As the system, I need seamless integration between backend commands and frontend UI components, so that user interactions trigger appropriate backend operations and state remains synchronized.

#### Acceptance Criteria

1. **File Picker → Backend Search**

   - WHEN user types in file picker search box THEN it SHALL call `ptah.searchRelevantFiles` with query parameter
   - WHEN search results return THEN UI SHALL render files with relevance scores
   - WHEN search fails THEN UI SHALL show error message and fallback to empty state

2. **Token Display → Backend Estimation**

   - WHEN file is attached THEN UI SHALL call `ptah.getTokenEstimate` with rough estimation
   - WHEN estimation returns THEN token badges SHALL update with counts
   - WHEN estimation fails THEN UI SHALL show "~" approximate value

3. **Context Dashboard → Backend Context API**

   - WHEN dashboard opens THEN it SHALL call `ptah.getCurrentContext` to populate file list
   - WHEN context data returns THEN all panels SHALL render with current state
   - WHEN context is empty THEN dashboard SHALL show empty state with "Attach files to begin"

4. **Optimization UI → Backend Optimization**

   - WHEN user clicks "Get Suggestions" THEN UI SHALL call `ptah.optimizeContext`
   - WHEN suggestions return THEN panel SHALL render actionable cards
   - WHEN user applies suggestion THEN UI SHALL update context via backend and refresh dashboard

5. **Event-Driven Updates**

   - WHEN context changes in backend THEN "context:updated" event SHALL be emitted
   - WHEN frontend receives "context:updated" event THEN all context-aware components SHALL refresh (dashboard, token widgets, file list)
   - WHEN agent changes THEN "agent:changed" event SHALL be emitted and UI SHALL update chat header

6. **Shared Type Contracts**
   - WHEN backend command returns data THEN response SHALL conform to defined TypeScript interface
   - WHEN frontend sends message to backend THEN payload SHALL conform to message protocol types
   - WHEN types mismatch THEN TypeScript compiler SHALL fail (no runtime type errors)

---

## Non-Functional Requirements

### Performance Requirements

- **File Search Response Time**: 95% of `ptah.searchRelevantFiles` requests under 300ms, 99% under 500ms
- **Token Estimation Response Time**: 95% of `ptah.getTokenEstimate` (rough) under 100ms, 99% under 200ms
- **Token Estimation Accuracy**: Accurate counting (useAccurateCounting=true) completes under 500ms for files up to 10K tokens
- **UI Responsiveness**: All user interactions (clicks, typing, drag-drop) SHALL have <100ms perceived response time
- **Dashboard Refresh**: Context dashboard updates complete within 200ms of context change
- **Memory Usage**: Extension memory footprint SHALL not exceed 150MB with 10 active chat sessions and 100 attached files
- **Workspace Indexing**: Initial workspace analysis (ptah.analyzeWorkspace) SHALL complete under 3 seconds for workspaces up to 1000 files

### Security Requirements

- **File Access**: Commands SHALL only access files within workspace root (no parent directory traversal)
- **Path Validation**: All file paths SHALL be validated and sanitized before file system operations
- **Command Permissions**: Backend commands SHALL run with same permissions as VS Code extension host (no elevation)
- **Data Privacy**: File content SHALL NOT be sent to external servers (all processing local)
- **AI Delegation Security**: `ptah.callVsCodeLM` SHALL only send user-approved prompts to VS Code LM (no automatic PII extraction)

### Scalability Requirements

- **Large Workspaces**: Support workspaces with up to 10,000 files (with performance degradation warnings beyond 5,000)
- **Concurrent Sessions**: Support up to 10 concurrent chat sessions without performance degradation
- **File Attachment Limits**: Support up to 100 attached files per session (with token limit warnings)
- **Search Result Pagination**: File search results paginated beyond 100 matches (UI shows "Show more")

### Reliability Requirements

- **Uptime**: Extension SHALL remain stable during 8+ hour development sessions (no crashes)
- **Error Handling**: All command failures SHALL be caught and returned as structured errors (no unhandled exceptions)
- **Recovery Time**: If backend command fails, UI SHALL recover gracefully and allow retry within 1 second
- **Data Persistence**: Attached files, agent selection, and context optimizations SHALL persist across VS Code reloads

### Usability Requirements

- **Accessibility**: All UI components SHALL meet WCAG 2.1 Level AA standards (keyboard navigation, screen reader support, sufficient color contrast)
- **VS Code Theming**: All UI components SHALL respect VS Code theme colors (dark/light mode auto-switching)
- **Onboarding**: First-time users SHALL see guided tour highlighting file attachment, agent selection, and context dashboard (dismissible)
- **Error Messages**: All errors SHALL provide actionable guidance (not just "Operation failed")
- **Loading States**: All async operations SHALL show loading indicators (spinners, progress bars, skeleton screens)

---

## Competitive Advantages Over CLI

This platform transforms Claude CLI's text-based interface into a superior visual experience:

| Feature                    | Claude CLI (Terminal)                               | Ptah Extension (GUI)                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File Attachment**        | Type `@file:path/to/file.ts` (requires exact path)  | • Drag-drop from Explorer<br>• File picker with smart search<br>• Explorer context menu "Attach to Claude"<br>• Shows token estimates immediately                                             |
| **Context Visibility**     | Run `/context` command, read text output            | • Real-time dashboard with token usage bar<br>• Visual file list with sorting/filtering<br>• Color-coded warnings (green/yellow/red)<br>• Hover tooltips with detailed breakdowns             |
| **Agent Selection**        | Type `@agent:name` (must know exact name)           | • Dropdown with all agents (built-in + custom)<br>• Pre-configured templates (🐛 Debug, ♻️ Refactor, 🧪 Test)<br>• Visual agent builder (future)<br>• Agent descriptions and icons            |
| **Context Optimization**   | Manually edit attached files, guess token impact    | • AI-powered suggestions with token savings<br>• One-click apply optimization<br>• Before/after preview<br>• Automatic exclusion pattern recommendations                                      |
| **Custom Agents**          | Edit YAML files in `.claude/agents/`                | • Same YAML editing (for now)<br>• Visual agent builder (future)<br>• Agent templates library<br>• Live preview of agent behavior                                                             |
| **Multi-Model Delegation** | Manually switch between Claude CLI sessions         | • Automatic delegation via `ptah.callVsCodeLM`<br>• Cost comparison UI (Claude vs Copilot)<br>• Multi-model consensus workflows<br>• Intelligent routing (simple → Copilot, complex → Claude) |
| **MCP Tool Discovery**     | Read terminal output, memorize tool names           | • Visual catalog with status badges<br>• Tool parameter schemas as forms<br>• Configuration UI (future)<br>• Searchable tool list                                                             |
| **Workspace Analysis**     | Manually explore files, build mental model          | • One-click project analysis<br>• Visual directory tree<br>• Automatic framework detection<br>• Relevance-scored file search                                                                  |
| **Command Execution**      | Memorize slash command syntax (`/cost`, `/compact`) | • Toolbar buttons for common commands<br>• VS Code command palette integration<br>• Context menus in messages<br>• Keyboard shortcuts (future)                                                |

**Key Differentiators**:

1. **Discoverability**: GUI exposes features users didn't know existed
2. **Efficiency**: Drag-drop and one-click operations vs typing exact syntax
3. **Visual Feedback**: Real-time token estimates, status badges, progress indicators
4. **Native Integration**: VS Code Explorer menus, command palette, theming
5. **Error Prevention**: Token limit warnings, optimization suggestions before hitting limits
6. **Intelligence**: Workspace analysis, relevance scoring, automatic delegation

---

## Acceptance Criteria

### Backend API Acceptance Criteria

- ✅ All 7 commands registered and callable (`ptah.analyzeWorkspace`, `ptah.searchRelevantFiles`, `ptah.getTokenEstimate`, `ptah.optimizeContext`, `ptah.getProjectStructure`, `ptah.getCurrentContext`, `ptah.callVsCodeLM`)
- ✅ All commands return JSON-serializable data with standardized structure (`success`, `data`, `error`, `timestamp`)
- ✅ Claude CLI can execute all commands via `vscode.commands.executeCommand()` API
- ✅ Commands work headless (no UI interaction required, no VS Code window focus needed)
- ✅ All commands handle errors gracefully (return structured error, no exceptions thrown)
- ✅ `ptah.searchRelevantFiles` completes in <300ms for 95% of requests
- ✅ `ptah.getTokenEstimate` (rough) completes in <100ms for 95% of requests
- ✅ `ptah.analyzeWorkspace` completes in <3 seconds for workspaces up to 1000 files
- ✅ `ptah.callVsCodeLM` streams responses (does not block until completion)
- ✅ `ptah.callVsCodeLM` returns clear error when VS Code LM unavailable

### Frontend UI Acceptance Criteria

- ✅ File attachment works via 3 methods: file picker modal, drag-drop from Explorer, Explorer context menu
- ✅ File picker search calls `ptah.searchRelevantFiles` with 300ms debounce
- ✅ Attached files display as chips with token estimates
- ✅ Token estimates update in real-time when files added/removed
- ✅ Agent dropdown shows all built-in agents (excluding general-purpose, Explore, Plan, statusline-setup)
- ✅ Agent dropdown shows custom agents from `.claude/agents/` directory
- ✅ Agent templates ("🐛 Debug", "♻️ Refactor", "🧪 Test", "📚 Document") available in dropdown
- ✅ Context dashboard displays token usage bar with color-coded thresholds (green <70%, yellow 70-90%, red >90%)
- ✅ Context dashboard shows included files list with name, path, token count, and remove button
- ✅ Context dashboard shows optimization suggestions with type, description, savings, and apply button
- ✅ Optimization suggestions apply successfully and refresh dashboard
- ✅ Command toolbar shows buttons for `/cost`, `/compact`, `/help`, "Optimize Context", "View Capabilities"
- ✅ Command buttons execute operations and display results
- ✅ MCP tool catalog shows all servers with status badges (connected/disabled/failed)
- ✅ MCP tool list expands to show available tools per server
- ✅ All UI components respect VS Code theme (dark/light mode)

### Integration Acceptance Criteria

- ✅ File picker search results populated from `ptah.searchRelevantFiles` response
- ✅ Token estimates in file chips populated from `ptah.getTokenEstimate` response
- ✅ Context dashboard file list populated from `ptah.getCurrentContext` response
- ✅ Optimization suggestions populated from `ptah.optimizeContext` response
- ✅ All UI controls properly communicate with backend via message protocol
- ✅ EventBus emits "context:updated" event when context changes
- ✅ Frontend components refresh when "context:updated" event received
- ✅ EventBus emits "agent:changed" event when agent selection changes
- ✅ Chat header updates when "agent:changed" event received
- ✅ TypeScript interfaces shared between backend and frontend (no type mismatches)

### User Experience Acceptance Criteria

- ✅ GUI-first interaction model (visual controls are primary, keyboard shortcuts secondary)
- ✅ Drag-drop file attachment works smoothly (drop zone overlay, visual feedback)
- ✅ File picker search feels instant (<300ms perceived response time)
- ✅ Token estimates update immediately when files attached (<100ms)
- ✅ Context dashboard updates feel real-time (<200ms after context change)
- ✅ Optimization suggestions are actionable (clear descriptions, one-click apply)
- ✅ Error messages provide actionable guidance (not just "failed")
- ✅ Loading states shown for all async operations (spinners, progress bars)
- ✅ Surpasses Claude CLI terminal experience (confirmed via user testing)
- ✅ Native VS Code integration (command palette, Explorer menus, theming)
- ✅ WCAG 2.1 Level AA compliance (keyboard navigation, screen reader support)

---

## Technical Constraints

### Mandatory Constraints

1. **Reuse Existing Libraries**: MUST leverage existing workspace-intelligence and ai-providers-core/context-manager libraries (no reimplementation)
2. **Backward Compatibility**: MUST maintain existing chat functionality (no breaking changes to current user workflows)
3. **Multi-Provider Support**: MUST support both Claude CLI and VS Code LM providers (abstract AI provider interface)
4. **Zoneless Angular**: MUST work in zoneless Angular environment (signals-based state management, no NgZone)
5. **DI Pattern**: All services MUST be injected via DI container (no direct instantiation, testable architecture)
6. **Type Safety**: MUST use TypeScript interfaces for all command contracts (no `any` types, compile-time type checking)

### Technical Stack

- **Backend**: TypeScript, Node.js, VS Code Extension API, esbuild
- **Frontend**: Angular 20+, TypeScript, SCSS, Signals API (no RxJS BehaviorSubject)
- **Build System**: Nx workspace, Nx Cloud CI/CD
- **Testing**: Jest (unit), Playwright (E2E), Jasmine (Angular components)
- **Linting**: ESLint, Prettier, Commitlint

### Architecture Patterns

- **Command Pattern**: All backend operations exposed as VS Code commands
- **Event-Driven**: Cross-boundary communication via EventBus
- **Signal-Based Reactivity**: All frontend state management uses Angular signals
- **Dependency Injection**: All services registered in DI container
- **Message Protocol**: Frontend-backend communication via typed message protocol

---

## Dependencies

### Existing Libraries (MUST Reuse)

1. **workspace-intelligence** (`libs/backend/workspace-intelligence/`)

   - WorkspaceAnalyzerService - Project type detection
   - WorkspaceIndexerService - File indexing
   - TokenCounterService - Accurate token counting
   - FileRelevanceScorerService - Relevance scoring
   - ContextSizeOptimizerService - Context optimization

2. **ai-providers-core** (`libs/backend/ai-providers-core/`)

   - ContextManager - File search, token estimation, optimization suggestions
   - VsCodeLmAdapter - VS Code Language Model integration
   - ClaudeCliAdapter - Claude CLI integration

3. **vscode-core** (`libs/backend/vscode-core/`)

   - CommandManager - Command registration system
   - EventBus - Cross-boundary events
   - Logger - Structured logging
   - DI Container - Dependency injection

4. **Frontend Core Services** (`libs/frontend/core/`)

   - ChatService - Chat state management (signals)
   - VSCodeService - VS Code API wrappers
   - AppStateManager - Global application state

5. **Frontend Chat Components** (`libs/frontend/chat/`)

   - ChatComponent - Main chat container
   - ChatMessagesComponent - Message list
   - ChatInputComponent - Message input
   - ChatSessionSelectorComponent - Session dropdown

6. **Shared Type System** (`libs/shared/`)
   - Message protocol types (94 distinct message types)
   - Branded types (SessionId, MessageId, AgentId)
   - Command result interfaces

### External Dependencies

- VS Code Extension API (vscode module)
- VS Code Language Model API (for `ptah.callVsCodeLM`)
- Node.js File System API (fs, path modules)
- Angular 20+ (signals, zoneless change detection)

### Development Dependencies

- Nx CLI (workspace operations)
- esbuild (backend compilation)
- Angular CLI (frontend compilation)
- Jest (testing framework)
- ESLint + Prettier (code quality)

---

## Risks & Mitigations

### Risk 1: Full-Stack Coordination Complexity

**Description**: Coordinating backend commands, frontend components, and integration layer across 14 libraries with strict dependency rules
**Probability**: High
**Impact**: High
**Score**: 9

**Mitigation Strategy**:

- Incremental development (backend → frontend → integration)
- Complete backend API before starting frontend UI
- Comprehensive contract testing at each layer boundary
- User validation checkpoints after each major milestone

**Contingency Plan**:

- If integration issues arise, fall back to simpler message-passing approach
- Isolate problematic components and develop in feature branches
- Create integration test suite before merging to main

---

### Risk 2: Real-Time State Synchronization Bugs

**Description**: Context changes in backend not reflected in frontend, or vice versa, causing UI inconsistencies
**Probability**: Medium
**Impact**: High
**Score**: 6

**Mitigation Strategy**:

- Event-driven architecture with clear event contracts
- State verification tests (assert backend and frontend state match)
- Comprehensive event testing (mock EventBus, verify all subscribers)
- Dashboard refresh on every context change (no manual sync)

**Contingency Plan**:

- Add "Refresh" button to manually sync state
- Implement state reconciliation on focus/blur events
- Add diagnostic panel showing last event timestamps

---

### Risk 3: Performance Degradation with Large Workspaces

**Description**: File search, token estimation, and workspace analysis slow to unusable in large monorepos (10K+ files)
**Probability**: Medium
**Impact**: Medium
**Score**: 4

**Mitigation Strategy**:

- Debouncing on all search inputs (300ms)
- Caching for workspace analysis (invalidate on file changes)
- Pagination for search results (max 100 results per request)
- Progressive loading (load top 20 results immediately, lazy-load remaining)
- Performance budgets enforced in tests (fail if >300ms search)

**Contingency Plan**:

- Display "Large Workspace" warning and recommend exclusion patterns
- Implement background indexing with progress indicator
- Allow users to disable features (file picker, context dashboard) if too slow

---

### Risk 4: VS Code LM Availability and Reliability

**Description**: `ptah.callVsCodeLM` depends on GitHub Copilot or compatible extension being installed and active
**Probability**: Medium
**Impact**: Low
**Score**: 2

**Mitigation Strategy**:

- Clear error messages when VS Code LM unavailable ("Install GitHub Copilot to enable multi-model features")
- Graceful degradation (feature hidden if unavailable, no hard failure)
- Documentation explaining VS Code LM requirements
- Fallback to Claude CLI only if VS Code LM fails

**Contingency Plan**:

- Make `ptah.callVsCodeLM` optional feature (disabled by default, opt-in)
- Provide alternative delegation methods (external API calls, custom providers)

---

### Risk 5: User Adoption and Discoverability

**Description**: Users continue typing `@` mentions in CLI terminal instead of using GUI controls
**Probability**: Medium
**Impact**: Low
**Score**: 2

**Mitigation Strategy**:

- Prominent onboarding tour on first use (highlight file picker, agent dropdown, context dashboard)
- In-chat hints ("💡 Tip: Drag-drop files from Explorer instead of typing paths")
- Command palette integration (users discover features via search)
- Documentation with screenshots and video tutorials

**Contingency Plan**:

- Hybrid approach: Support both GUI controls AND `@` mention parsing
- Add settings toggle to show/hide GUI controls for power users

---

## Stakeholder Analysis

### Primary Stakeholders

#### End Users (Ptah Extension Users)

**Needs**:

- Faster, more intuitive way to attach files to Claude context
- Visibility into token usage to avoid hitting limits
- Easy access to workspace intelligence (project structure, file search)
- Visual controls that surpass CLI terminal experience

**Pain Points**:

- Typing exact file paths is tedious and error-prone
- No way to know token usage until hitting limit
- CLI commands require memorization
- Context optimization is manual and time-consuming

**Success Criteria**:

- File attachment time reduced by 70% (vs typing paths)
- Zero incidents of hitting token limit unexpectedly
- User satisfaction score > 4.5/5 (measured via in-app surveys)
- Feature adoption rate > 80% within 30 days of release

**Impact Level**: High
**Involvement**: Beta testing, feedback surveys

---

#### Business Owners (Extension Development Team)

**Needs**:

- Validate months of workspace-intelligence investment
- Differentiate Ptah from other Claude CLI wrappers
- Increase user engagement and retention
- Reduce support requests related to context management

**ROI Expectations**:

- 50% reduction in context-related support tickets
- 30% increase in daily active users (DAU)
- Positive reviews mentioning "best Claude GUI" within 60 days
- Feature parity with Claude CLI terminal + 5 unique GUI advantages

**Success Criteria**:

- ROI > 150% within 12 months (measured by user growth + reduced churn)
- 90% of users engage with at least 3 new features within first week
- Zero critical bugs in production after 30 days

**Impact Level**: High
**Involvement**: Requirements approval, milestone reviews

---

#### Development Team (Backend & Frontend Developers)

**Needs**:

- Clear architecture with reusable patterns
- Minimal breaking changes to existing code
- Comprehensive tests to prevent regressions
- Well-documented APIs and integration points

**Technical Constraints**:

- Must work within Nx monorepo structure (14 projects, strict dependency rules)
- Must support zoneless Angular (signals-based state)
- Must maintain backward compatibility with existing chat
- Cannot introduce new external dependencies without approval

**Success Criteria**:

- Code quality score > 9/10 (SonarQube or similar)
- Test coverage > 80% (unit + integration)
- Zero TypeScript `any` types (100% type safety)
- Build time increase < 10% (incremental builds still fast)

**Impact Level**: High
**Involvement**: Implementation, code reviews, testing

---

### Secondary Stakeholders

#### Operations Team (DevOps, CI/CD)

**Needs**:

- Zero-downtime deployment
- Rollback capability if critical issues arise
- Monitoring and observability for new features
- Performance metrics for large workspaces

**Deployment Requirements**:

- Automated CI/CD pipeline (Nx Cloud, GitHub Actions)
- Feature flags for gradual rollout
- Telemetry for performance tracking (search latency, token estimation time)
- Error tracking (Sentry or equivalent)

**Success Criteria**:

- Zero-downtime deployment achieved
- Rollback completes within 5 minutes if needed
- Performance metrics dashboard available
- Alerts trigger for 95th percentile latency > 500ms

**Impact Level**: Medium
**Involvement**: Deployment planning, monitoring setup

---

#### Support Team (User Support, Documentation)

**Needs**:

- User guides with screenshots and examples
- Troubleshooting guides for common issues
- FAQ for new features
- Training materials for support staff

**Documentation Requirements**:

- User guide: File attachment methods, agent selection, context dashboard
- Developer guide: Command contracts, integration patterns, testing approach
- Troubleshooting: Large workspace performance, VS Code LM setup, token limit warnings
- Video tutorials: 5-minute quickstart, advanced workflows

**Success Criteria**:

- User documentation coverage > 90% of features
- Support ticket resolution time reduced by 40%
- Self-service resolution rate > 70% (users find answers in docs)

**Impact Level**: Medium
**Involvement**: Documentation review, user training

---

#### Compliance/Security Team

**Needs**:

- No data exfiltration (all processing local)
- No PII sent to external services
- Secure file access (no directory traversal vulnerabilities)
- Audit trail for AI delegation

**Security Requirements**:

- File paths validated and sandboxed to workspace root
- `ptah.callVsCodeLM` only sends user-approved prompts (no automatic data extraction)
- No telemetry containing file content or user messages
- Compliance with VS Code extension security guidelines

**Success Criteria**:

- Security audit passed (no critical or high vulnerabilities)
- Privacy policy updated (disclose VS Code LM usage)
- User consent for AI delegation (opt-in for `ptah.callVsCodeLM`)

**Impact Level**: Medium
**Involvement**: Security review, compliance approval

---

## Stakeholder Impact Matrix

| Stakeholder         | Impact Level | Involvement              | Success Criteria                                  |
| ------------------- | ------------ | ------------------------ | ------------------------------------------------- |
| End Users           | High         | Beta testing, feedback   | User satisfaction > 4.5/5, feature adoption > 80% |
| Business Owners     | High         | Requirements, milestones | ROI > 150% in 12 months, 90% feature engagement   |
| Dev Team            | High         | Implementation, testing  | Code quality > 9/10, test coverage > 80%          |
| Operations          | Medium       | Deployment, monitoring   | Zero-downtime deploy, rollback < 5 min            |
| Support Team        | Medium       | Docs, training           | Self-service resolution > 70%                     |
| Security/Compliance | Medium       | Security review          | Audit passed, no critical vulnerabilities         |

---

## Quality Gates

Before proceeding to implementation (software-architect phase), these quality gates MUST be validated:

### Requirements Quality Gates

- [x] All requirements follow SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
- [x] All acceptance criteria in WHEN/THEN/SHALL format (BDD style)
- [x] All stakeholders identified with clear success metrics
- [x] All risks assessed with mitigation strategies
- [x] All dependencies documented (existing libraries, external APIs)
- [x] Non-functional requirements specified (performance, security, scalability, reliability)
- [x] Competitive advantages clearly articulated (GUI vs CLI comparison table)
- [x] Technical constraints documented (must reuse existing code, zoneless Angular, DI pattern)
- [x] Backward compatibility confirmed (no breaking changes to existing chat)
- [x] Success metrics defined (measurable outcomes, not just feature completion)

### User Experience Quality Gates

- [x] GUI-first interaction model validated (visual controls are primary)
- [x] Native VS Code integration patterns confirmed (Explorer menus, command palette, theming)
- [x] Accessibility requirements specified (WCAG 2.1 Level AA)
- [x] Error messages are actionable (not just "failed")
- [x] Loading states defined for all async operations
- [x] Onboarding experience planned (guided tour for first-time users)

### Technical Quality Gates

- [x] All backend command contracts defined (TypeScript interfaces)
- [x] All frontend component inputs/outputs specified
- [x] Integration points documented (EventBus events, message protocol)
- [x] Performance budgets established (file search <300ms, token estimation <100ms)
- [x] Error handling strategy defined (graceful degradation, fallbacks)
- [x] Testing strategy outlined (unit, integration, E2E)

---

## Summary

This requirements document defines a comprehensive "Context Management & Interaction Platform" that transforms Ptah from a basic Claude CLI wrapper into a powerful, GUI-first VS Code extension.

**Key Innovations**:

1. **Backend Workspace Intelligence API** - 7 VS Code commands exposing months of architectural investment as callable tools
2. **Frontend Visual Controls** - Drag-drop file attachment, agent templates, real-time context dashboard
3. **Multi-Model Delegation** - `ptah.callVsCodeLM` enables Claude ↔ Copilot workflows for cost optimization
4. **Superior User Experience** - GUI controls that surpass CLI terminal capabilities (not just replicate them)

**Measurable Outcomes**:

- File attachment time reduced by 70% (drag-drop vs typing paths)
- Zero unexpected token limit errors (real-time dashboard with warnings)
- User satisfaction > 4.5/5 (measured via in-app surveys)
- Feature adoption > 80% within 30 days of release

**Next Steps**:

1. **USER VALIDATION** ✋ - Review and approve requirements
2. **Software Architect** - Design implementation plan (backend + frontend + integration)
3. **USER VALIDATION** ✋ - Approve architecture
4. **Team Leader** - Decompose into atomic tasks
5. **Iterative Development** - Backend commands → Frontend components → Integration
6. **Quality Assurance** - Testing and code review
7. **Deployment** - Feature flag rollout with monitoring

This platform validates Ptah's architectural investment and establishes a clear competitive advantage over other Claude CLI wrappers through native VS Code integration and intelligent workspace analysis.
