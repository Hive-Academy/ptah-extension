# Task Context - TASK_2025_042

## User Intent

Enhance autocomplete UX with visual improvements and client-side caching:

1. **Visual Enhancement**: Add badge/highlighting to command names in dropdown (e.g., pill badges or special styling for `/command` text)
2. **Client-Side Caching**: Implement client-side caching for commands and agents
   - Load all items once on first trigger
   - Cache locally (similar to Claude Code native extension)
   - Allow frontend to filter cached results without RPC calls
3. **Files Remain Dynamic**: Keep files as dynamic RPC calls (no preloading due to large workspace sizes)
4. **Show All Commands**: Show all available commands (not just 10) and let users filter on client side

## Conversation Summary

User reported that after fixing trigger directives and dropdown positioning, the autocomplete system is now working but needs UX improvements:

- Commands appear in dropdown but lack visual distinction (no badge/highlighting for command text)
- Current implementation makes RPC calls on every trigger, similar to before (inefficient)
- Only shows 10 commands by default, should show all and allow client-side filtering
- Wants behavior similar to Claude Code native extension (load once, filter locally)

## Technical Context

- **Branch**: feature/TASK_2025_042
- **Created**: 2025-12-04
- **Type**: FEATURE (UX Enhancement + Performance Optimization)
- **Complexity**: Medium (Frontend visual changes + caching architecture)

## Prior Work

- TASK_2025_019: Complete Autocomplete System (planned but not started)
- TASK_2025_036: File Suggestions Integration & DaisyUI Styling (planned)
- Recent work: Fixed trigger directives (slash-trigger.directive.ts, at-trigger.directive.ts) and dropdown positioning

## Current Implementation

**Frontend Services**:

- `CommandDiscoveryFacade` (libs/frontend/core/src/lib/services/command-discovery.facade.ts)

  - `fetchCommands()`: Calls RPC `autocomplete:commands` with maxResults=100
  - `searchCommands(query)`: Filters local `_commands` signal, returns top 10 (no query) or 20 (with query)

- `AgentDiscoveryFacade` (libs/frontend/core/src/lib/services/agent-discovery.facade.ts)
  - `fetchAgents()`: Calls RPC `autocomplete:agents` with maxResults=100
  - `searchAgents(query)`: Filters local `_agents` signal, returns top 10 (no query) or 20 (with query)

**Backend RPC Handlers**:

- `autocomplete:commands` (rpc-method-registration.service.ts:622)
- `autocomplete:agents` (similar pattern)

**Components**:

- `ChatInputComponent` (chat-input.component.ts): Main input with trigger directives
- `UnifiedSuggestionsDropdownComponent` (unified-suggestions-dropdown.component.ts): Dropdown UI

## Execution Strategy

**FEATURE Strategy** with conditional agents:

1. Project Manager → Requirements (skip user validation - small UX task)
2. UI/UX Designer → Visual design specification for badge/highlighting
3. Software Architect → Implementation plan for caching + visual changes
4. Team Leader → Development (3-mode workflow)
5. QA Choice → User decides testing approach
6. Modernization Detector → Future enhancements

## Design Constraints

- Must maintain signal-based reactivity (Angular 20+ patterns)
- Must respect existing RxJS debouncing in trigger directives
- Files must remain dynamic (no caching due to workspace size)
- Commands and agents should cache on first load (load once, filter locally)
- Visual changes must use DaisyUI components for consistency
