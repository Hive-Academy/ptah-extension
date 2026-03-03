# TASK_2025_172: Right Sidebar Resizer

## Task Type: FEATURE

## Complexity: Medium

## Strategy: Partial (Architect -> Team-Leader -> Developer)

## User Request

Implement a draggable resizer for the right sidebar (Agent Monitor Panel) based on the Angular CDK drag-and-drop column resize pattern from https://briantree.se/angular-cdk-drag-and-drop-column-resize/

## Context

- The UI has a main chat area on the left and an "Agents" sidebar panel on the right
- Need a draggable divider/handle between them to resize the sidebar width
- Angular CDK is already installed (`@angular/cdk@^20.2.14`)

## Current Architecture

- **App Shell**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- **Agent Monitor Panel**: `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
- **Agent Monitor Store**: `libs/frontend/chat/src/lib/services/agent-monitor.store.ts`

### Current Panel Widths (fixed responsive):

- Default: 460px
- xl (1280px+): 540px
- 2xl (1536px+): 640px

### CDK Approach (from reference article):

- Uses `cdkDrag` directive on the resize handle
- Uses `(cdkDragMoved)` event to update width signal
- Resets `transform: none` on the drag element to prevent CDK's default translate
- Width bound via `[style.width.px]="currentWidth()"`
- Signal-based state: `currentWidth = signal(defaultWidth)`

## Planned Agent Sequence

1. **software-architect** - Design implementation plan
2. **team-leader** (MODE 1) - Create batched tasks
3. **frontend-developer** - Implement the resize feature
4. **code-logic-reviewer** - Review implementation
