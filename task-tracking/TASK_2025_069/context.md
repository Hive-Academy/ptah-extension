# Task Context - TASK_2025_069

## User Intent

Design and implement integration between the Agent Generation Setup Wizard and the Chat Empty State, providing users with a clear entry point to configure Claude agents.

## Core Objective

Create a seamless integration that:

1. **Adds VS Code Command** - `ptah.setupAgents` command for Command Palette access
2. **Creates Status Widget** - SetupStatusWidgetComponent showing agent configuration status
3. **Integrates with Empty State** - Display widget in ChatViewComponent when no messages exist
4. **Implements Backend Status Service** - SetupStatusService for agent configuration detection
5. **Wires RPC Communication** - Connect frontend widget to backend services via RPC messages

## Technical Context

- **Branch**: feature/sdk-only-migration
- **Created**: 2025-12-11
- **Type**: FEATURE (Integration + UI Component + Backend Service)
- **Complexity**: Medium (coordinated frontend + backend work)
- **Parent Task**: TASK_2025_065 (Agent Generation System - Frontend Track)

## Current State

**Completed Work (TASK_2025_065)**:

- Setup wizard backend complete (SetupWizardService with 6-step flow)
- Wizard webview panel implementation ready
- RPC message handlers for wizard steps exist
- Wizard can be launched programmatically via `SetupWizardService.launchWizard()`

**Missing Integration**:

- No trigger mechanism to launch wizard from UI
- No VS Code command registered for Command Palette
- No awareness in chat UI of agent configuration status
- Chat empty state is static - doesn't show setup status

## Problem Statement

Users have no way to:

1. Discover the agent generation wizard
2. Know if agents are already configured
3. Launch the wizard from the main chat interface
4. Access wizard via Command Palette

The wizard exists but is "hidden" - no entry points for users.

## Solution Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interactions                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Chat Empty State                2. Command Palette           │
│     [Setup Status Widget]              "Setup Claude Agents"     │
│     "Configure"/"Update" button        ptah.setupAgents          │
│           │                                     │                │
│           └──────────────┬──────────────────────┘                │
│                          │                                       │
│                          ▼                                       │
│              ┌───────────────────────┐                           │
│              │  SetupWizardService   │                           │
│              │  .launchWizard()      │                           │
│              └───────────────────────┘                           │
│                          │                                       │
│                          ▼                                       │
│              ┌───────────────────────┐                           │
│              │  Wizard Webview Panel │                           │
│              │  (6-step flow)        │                           │
│              └───────────────────────┘                           │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                      Status Detection                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SetupStatusWidgetComponent (Frontend)                           │
│           │                                                      │
│           ▼ RPC: setup-status:get-status                         │
│  SetupStatusService (Backend)                                    │
│           │                                                      │
│           ▼                                                      │
│  AgentDiscoveryService                                           │
│  - Scan .claude/agents/*.md                                      │
│  - Return agent count + timestamps                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Widget Placement**: Above Vibe/Spec mode cards in empty state

   - Rationale: Users should see agent status before choosing chat mode
   - Evidence: Empty state has natural card layout (chat-view.component.html:67-101)

2. **Status Detection Strategy**: Use AgentDiscoveryService

   - Rationale: Existing service already scans .claude/agents/ directories
   - Evidence: workspace-intelligence library has agent discovery (verified)

3. **RPC Communication Pattern**: Follow existing RPC patterns

   - Rationale: Consistent with ChatInputComponent and other components
   - Evidence: VSCodeService.postMessage() already established (vscode.service.ts:161-169)

4. **Command Registration**: Use CommandManager pattern
   - Rationale: Matches existing command registration approach
   - Evidence: ptah.openFullPanel command already exists (package.json:60-64)

## Requirements Summary

### Functional Requirements

- **FR1**: Display agent configuration status in chat empty state
- **FR2**: Show accurate agent count and last modified timestamp
- **FR3**: Provide "Configure" button when no agents exist
- **FR4**: Provide "Update" button when agents already exist
- **FR5**: Launch wizard on button click
- **FR6**: Register `ptah.setupAgents` command in Command Palette
- **FR7**: Launch wizard via command
- **FR8**: Handle loading and error states gracefully

### Non-Functional Requirements

- **NFR1**: Status check completes in < 100ms
- **NFR2**: Widget rendering doesn't block chat UI
- **NFR3**: DaisyUI styling matches existing design system
- **NFR4**: Error messages are clear and actionable
- **NFR5**: Works in workspaces without .claude/agents/ directory

### User Experience Goals

- **UX1**: Users discover agent configuration feature naturally
- **UX2**: Status is immediately visible when chat opens
- **UX3**: Button text clearly indicates action (Configure vs Update)
- **UX4**: Command Palette provides alternative access method
- **UX5**: Loading states provide feedback during async operations

## Integration Points

**Backend Dependencies**:

- SetupWizardService (agent-generation library) - Already exists
- AgentDiscoveryService (workspace-intelligence library) - Already exists
- CommandManager (vscode-core library) - Already exists

**Frontend Dependencies**:

- ChatViewComponent (chat library) - Modify to include widget
- VSCodeService (core library) - Use for RPC communication

**New Components**:

- SetupStatusService (backend) - Status detection logic
- SetupStatusWidgetComponent (frontend) - UI display
- ptah.setupAgents command - Command Palette entry

## Success Criteria

### Implementation Complete When:

- [x] Architecture plan created (this task)
- [ ] SetupStatusService implemented and tested
- [ ] ptah.setupAgents command registered in package.json
- [ ] Command handler launches wizard correctly
- [ ] SetupStatusWidgetComponent created with all states (loading/error/success)
- [ ] Widget integrated into ChatViewComponent empty state
- [ ] RPC handlers registered for setup-status messages
- [ ] End-to-end flow tested (widget → RPC → service → wizard)
- [ ] Command Palette flow tested

### Quality Gates

- Widget displays within 100ms of chat view opening
- Status reflects actual .claude/agents/ directory state
- Button click launches wizard in new webview panel
- Command Palette command appears and works
- Error states show helpful messages
- Loading states provide visual feedback

## File Locations Reference

**Backend Services**:

- libs/backend/agent-generation/src/lib/services/setup-status.service.ts (CREATE)
- libs/backend/agent-generation/src/lib/di/tokens.ts (MODIFY)

**Frontend Components**:

- libs/frontend/chat/src/lib/components/molecules/setup-status-widget.component.ts (CREATE)
- libs/frontend/chat/src/lib/components/templates/chat-view.component.ts (MODIFY)
- libs/frontend/chat/src/lib/components/templates/chat-view.component.html (MODIFY)

**Integration**:

- apps/ptah-extension-vscode/package.json (MODIFY - add command)
- apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts (MODIFY - add handlers)

**Library Exports**:

- libs/backend/agent-generation/src/index.ts (MODIFY - export SetupStatusService)
- libs/frontend/chat/src/index.ts (MODIFY - export SetupStatusWidgetComponent)

## Related Tasks

- **TASK_2025_058**: Parent task - Intelligent Project-Adaptive Agent Generation System
- **TASK_2025_064**: Backend Track - Agent generation orchestration services
- **TASK_2025_065**: Frontend Track - Setup wizard UI components (2A-2D batches)
- **TASK_2025_065_FIXES**: QA fixes for agent generation frontend

## Notes

**Design Considerations**:

- Widget should be subtle - not distract from main chat purpose
- DaisyUI card styling ensures consistency with existing UI
- Loading skeleton pattern matches other chat components
- Button states (disabled during launch) prevent double-clicks

**Technical Constraints**:

- Must work in workspaces without .claude/agents/ directory
- Must handle missing workspace scenario (show error, don't crash)
- RPC messages must be async (don't block UI)
- Status should be cached briefly (5 seconds) to avoid file system churn

**Future Enhancements** (Out of Scope):

- Real-time status updates via file system watcher
- Agent list preview in widget (expand/collapse UI)
- Quick action: "Open .claude/agents/ folder" link
- Onboarding tooltip for first-time users
- Analytics tracking for wizard launches
