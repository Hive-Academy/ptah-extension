# Task Context for TASK_2025_013

## User Intent

Combine TASK_2025_005 (Rich Claude CLI Features) and TASK_2025_010 (Workspace Intelligence Commands) into a unified "Context Management & Interaction Platform" that provides a GUI-first experience surpassing Claude Code CLI.

## Conversation Summary

**Critical Insight from User**:

- Ptah is a GUI wrapper for Claude Code CLI
- Users don't directly type `@` mentions like in CLI terminal
- We have better control through VS Code native capabilities
- Goal: Create a SUPERIOR experience to CLI, not just replicate it

**Deep Thinking Analysis Revealed**:

1. **Current Misalignment**:

   - TASK_2025_005: Trying to replicate CLI's text-based `@` mention system
   - TASK_2025_010: Backend-only workspace intelligence commands
   - Neither leverages GUI advantages fully

2. **Revised Architecture** (GUI-First):

   - **Visual Controls as Primary Interface**: File picker buttons, agent dropdowns, command palette integration
   - **Backend API Layer**: VS Code commands (ptah.\*) callable by both Claude CLI and frontend
   - **Context Visualization**: Real-time dashboard showing token usage, included files, optimization suggestions
   - **@ Mentions as Secondary**: Optional keyboard shortcuts for power users (Phase 2 enhancement)

3. **Integration Points**:

   - File picker uses `ptah.searchRelevantFiles` backend
   - Token estimates use `ptah.getTokenEstimate` backend
   - Context dashboard uses `ptah.getCurrentContext` backend
   - Optimization UI uses `ptah.optimizeContext` backend

4. **Competitive Advantages**:
   - Drag-drop file attachment (vs typing paths)
   - Visual agent templates ("Debug", "Test", "Refactor")
   - Real-time context dashboard (vs `/context` command)
   - One-click optimization suggestions (vs manual editing)
   - Visual custom agent builder (vs YAML editing)
   - Multi-model delegation UI (Claude ↔ Copilot)

## Technical Context

- **Branch**: feature/TASK_2025_013
- **Created**: 2025-11-23
- **Task Type**: FEATURE (New capability platform)
- **Complexity**: Complex (Multi-phase, full-stack, 40-50 hours)
- **Supersedes**: TASK_2025_005, TASK_2025_010 (both will be marked as "📦 Merged into TASK_2025_013")

## Unified Scope

### Backend: Workspace Intelligence API

- 7 VS Code commands exposing workspace-intelligence and context-manager capabilities
- Commands callable by Claude CLI internally AND frontend webview
- JSON-serializable responses for cross-boundary communication

### Frontend: Context Management & Interaction UI

- Visual file attachment system (picker, drag-drop, Explorer integration)
- Agent selection UI (dropdown, templates, custom agent discovery)
- Context dashboard (token usage, file list, optimization suggestions)
- Command execution UI (buttons, command palette integration)
- MCP tool discovery panel

### Integration Layer

- Frontend components consume backend commands
- Shared TypeScript interfaces for command contracts
- Event-driven updates for real-time context changes

## Execution Strategy

**FEATURE_IMPLEMENTATION** (Comprehensive multi-phase)

**Planned Agent Sequence**:

1. project-manager → Creates unified task-description.md
2. USER VALIDATION ✋
3. software-architect → Creates implementation-plan.md (backend + frontend + integration)
4. USER VALIDATION ✋
5. team-leader MODE 1 → Decomposes into atomic tasks
6. team-leader MODE 2 → Iterative development (backend commands → frontend components → integration)
7. team-leader MODE 3 → Final verification
8. USER CHOICE → QA (tester/reviewer/both/skip)
9. modernization-detector → Future enhancements analysis

## Success Criteria

**Backend API**:

- ✅ 7 commands registered and callable (`ptah.analyzeWorkspace`, `ptah.searchRelevantFiles`, etc.)
- ✅ All commands return JSON-serializable data
- ✅ Claude CLI can execute all commands successfully
- ✅ Commands work headless (no UI dependency)

**Frontend UI**:

- ✅ File attachment works via picker, drag-drop, Explorer menu
- ✅ Agent dropdown shows built-in + custom agents
- ✅ Context dashboard displays real-time token usage
- ✅ Optimization suggestions apply with one click
- ✅ Command buttons execute common operations
- ✅ MCP tool catalog shows available tools

**Integration**:

- ✅ File picker uses `ptah.searchRelevantFiles` for smart search
- ✅ Token estimates update in real-time via `ptah.getTokenEstimate`
- ✅ Context dashboard syncs with `ptah.getCurrentContext`
- ✅ All UI controls properly communicate with backend

**User Experience**:

- ✅ GUI-first interaction (visual controls are primary)
- ✅ Keyboard shortcuts available (@ mentions optional)
- ✅ Surpasses Claude CLI terminal experience
- ✅ Native VS Code integration (command palette, context menus)

## Related Work

- TASK_2025_004: Agent Visualization (✅ Complete) - provides agent tracking foundation
- TASK_2025_005: Rich Claude CLI Features (📦 Merged into this task)
- TASK_2025_010: Workspace Intelligence Commands (📦 Merged into this task)

## Risk Assessment

**Medium Risk**:

- Full-stack coordination (backend + frontend + integration)
- New UI patterns (file picker, agent dropdown, context dashboard)
- Real-time state synchronization
- Multi-provider integration (Claude CLI + VS Code LM)

**Mitigation**:

- Incremental development (backend → frontend → integration)
- Reuse existing workspace-intelligence libraries (battle-tested)
- Comprehensive testing at each phase
- User validation at PM and Architect checkpoints
