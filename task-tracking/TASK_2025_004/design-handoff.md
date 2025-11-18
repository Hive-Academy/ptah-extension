# Design Handoff - TASK_2025_004

**Project**: Ptah Extension - Agent System Visualization
**Date**: 2025-11-17
**From**: ui-ux-designer
**To**: frontend-developer
**Complexity**: MEDIUM
**Estimated Time**: 8-12 hours

---

## Overview

This handoff provides complete implementation specifications for 3 new Angular components (AgentTreeComponent, AgentTimelineComponent, AgentStatusBadge) and integration with existing ChatComponent. All designs follow VS Code theming and WCAG 2.1 AA accessibility standards.

**Documents Included**:

1. D:/projects/ptah-extension/task-tracking/TASK_2025_004/visual-design-specification.md (Complete visual blueprint)
2. D:/projects/ptah-extension/task-tracking/TASK_2025_004/design-assets-inventory.md (Icon library and asset specifications)
3. This document (Implementation guide)

---

## Component Hierarchy & File Structure

### New Files to Create

**Shared Constants** (Icon Mappings):

```
libs/frontend/chat/src/lib/constants/
  ├── agent-icons.constants.ts          # Icon and color mappings for 16 agent types
  └── index.ts                           # Export constants
```

**Shared Service** (Icon Resolution):

```
libs/frontend/chat/src/lib/services/
  ├── agent-icon.service.ts              # Icon resolution and color utilities
  └── index.ts                           # Export service
```

**Component 1: AgentTreeComponent**:

```
libs/frontend/chat/src/lib/components/agent-tree/
  ├── agent-tree.component.ts            # Component logic (standalone, signals)
  ├── agent-tree.component.html          # Template (collapsible tree structure)
  ├── agent-tree.component.css           # Styles (VS Code theming)
  └── agent-tree.component.spec.ts       # Unit tests
```

**Component 2: AgentTimelineComponent**:

```
libs/frontend/chat/src/lib/components/agent-timeline/
  ├── agent-timeline.component.ts        # Component logic (swimlane rendering)
  ├── agent-timeline.component.html      # Template (horizontal timeline)
  ├── agent-timeline.component.css       # Styles (timeline animations)
  └── agent-timeline.component.spec.ts   # Unit tests
```

**Component 3: AgentStatusBadge**:

```
libs/frontend/chat/src/lib/components/agent-status-badge/
  ├── agent-status-badge.component.ts    # Component logic (active agent count)
  ├── agent-status-badge.component.html  # Template (compact badge)
  ├── agent-status-badge.component.css   # Styles (pulsing animation)
  └── agent-status-badge.component.spec.ts # Unit tests
```

**Export Updates**:

```
libs/frontend/chat/src/index.ts         # Export all 3 new components
```

---

## Implementation Guide

### Step 1: Create Icon Mapping Constants

**File**: `libs/frontend/chat/src/lib/constants/agent-icons.constants.ts`

```typescript
import { CircleDotIcon, SearchIcon, MapIcon, TrendingUpIcon, ServerIcon, ClipboardIcon, SparklesIcon, PaintBucketIcon, FileCheckIcon, Building2Icon, FlaskConicalIcon, BookOpenIcon, PaletteIcon, UsersIcon, GitBranchIcon, SettingsIcon, TerminalIcon, FileTextIcon, Edit3Icon, FileEditIcon, SearchIcon as GrepIcon, FolderSearchIcon, HelpCircleIcon } from 'lucide-angular';

/**
 * Maps agent types to lucide-angular icon components
 */
export const AGENT_ICON_MAP: Record<string, typeof SearchIcon> = {
  'general-purpose': CircleDotIcon,
  Explore: SearchIcon,
  Plan: MapIcon,
  'business-analyst': TrendingUpIcon,
  'backend-developer': ServerIcon,
  'project-manager': ClipboardIcon,
  'modernization-detector': SparklesIcon,
  'frontend-developer': PaintBucketIcon,
  'code-reviewer': FileCheckIcon,
  'software-architect': Building2Icon,
  'senior-tester': FlaskConicalIcon,
  'researcher-expert': BookOpenIcon,
  'ui-ux-designer': PaletteIcon,
  'team-leader': UsersIcon,
  'workflow-orchestrator': GitBranchIcon,
  'statusline-setup': SettingsIcon,
};

/**
 * Maps agent types to VS Code semantic color variables
 */
export const AGENT_COLOR_MAP: Record<string, string> = {
  'general-purpose': 'var(--vscode-editor-foreground)',
  Explore: 'var(--vscode-symbolIcon-classForeground)',
  Plan: 'var(--vscode-symbolIcon-namespaceForeground)',
  'business-analyst': 'var(--vscode-charts-blue)',
  'backend-developer': 'var(--vscode-symbolIcon-functionForeground)',
  'project-manager': 'var(--vscode-symbolIcon-constantForeground)',
  'modernization-detector': 'var(--vscode-symbolIcon-keywordForeground)',
  'frontend-developer': 'var(--vscode-symbolIcon-classForeground)',
  'code-reviewer': 'var(--vscode-testing-iconPassed)',
  'software-architect': 'var(--vscode-symbolIcon-moduleForeground)',
  'senior-tester': 'var(--vscode-testing-iconQueued)',
  'researcher-expert': 'var(--vscode-symbolIcon-stringForeground)',
  'ui-ux-designer': 'var(--vscode-symbolIcon-colorForeground)',
  'team-leader': 'var(--vscode-symbolIcon-interfaceForeground)',
  'workflow-orchestrator': 'var(--vscode-gitDecoration-modifiedResourceForeground)',
  'statusline-setup': 'var(--vscode-symbolIcon-variableForeground)',
};

/**
 * Maps tool names to lucide-angular icon components
 */
export const TOOL_ICON_MAP: Record<string, typeof TerminalIcon> = {
  Bash: TerminalIcon,
  Read: FileTextIcon,
  Edit: Edit3Icon,
  Write: FileEditIcon,
  Grep: GrepIcon,
  Glob: FolderSearchIcon,
  Task: GitBranchIcon,
};

/**
 * Default fallback icon for unknown types
 */
export const DEFAULT_ICON = CircleDotIcon;
export const DEFAULT_TOOL_ICON = HelpCircleIcon;
```

### Step 2: Create Icon Service

**File**: `libs/frontend/chat/src/lib/services/agent-icon.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { AGENT_ICON_MAP, AGENT_COLOR_MAP, TOOL_ICON_MAP, DEFAULT_ICON, DEFAULT_TOOL_ICON } from '../constants/agent-icons.constants';

/**
 * Service for resolving agent and tool icons with semantic colors
 */
@Injectable({
  providedIn: 'root',
})
export class AgentIconService {
  /**
   * Get lucide-angular icon component for agent type
   * @param agentType - Agent type string (e.g., "backend-developer")
   * @returns Icon component class
   */
  getAgentIcon(agentType: string) {
    return AGENT_ICON_MAP[agentType] ?? DEFAULT_ICON;
  }

  /**
   * Get VS Code semantic color variable for agent type
   * @param agentType - Agent type string
   * @returns CSS variable string (e.g., "var(--vscode-symbolIcon-functionForeground)")
   */
  getAgentColor(agentType: string): string {
    return AGENT_COLOR_MAP[agentType] ?? 'var(--vscode-editor-foreground)';
  }

  /**
   * Get lucide-angular icon component for tool name
   * @param toolName - Tool name string (e.g., "Bash", "Read")
   * @returns Icon component class
   */
  getToolIcon(toolName: string) {
    return TOOL_ICON_MAP[toolName] ?? DEFAULT_TOOL_ICON;
  }
}
```

### Step 3: Implement AgentTreeComponent

**File**: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts`

```typescript
import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClaudeAgentStartEvent, ClaudeAgentActivityEvent } from '@ptah-extension/shared';
import { AgentIconService } from '../../services/agent-icon.service';
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-angular';

export interface AgentTreeNode {
  agent: ClaudeAgentStartEvent;
  activities: ClaudeAgentActivityEvent[];
  expanded: boolean;
  status: 'running' | 'complete' | 'error';
  duration?: number;
  errorMessage?: string;
}

@Component({
  selector: 'ptah-agent-tree',
  standalone: true,
  imports: [
    CommonModule,
    ChevronRightIcon,
    ChevronDownIcon,
    // Import all agent icons (see design-assets-inventory.md for full list)
    // ...lucide-angular icon imports
  ],
  templateUrl: './agent-tree.component.html',
  styleUrls: ['./agent-tree.component.css'],
})
export class AgentTreeComponent {
  // Input signals
  readonly agents = input.required<AgentTreeNode[]>();

  // Output signals
  readonly agentClicked = output<string>(); // agentId

  // Service injection
  constructor(readonly iconService: AgentIconService) {}

  // Expanded state tracking
  private readonly expandedNodes = signal<Set<string>>(new Set());

  // Toggle node expansion
  toggleNode(agentId: string): void {
    const expanded = this.expandedNodes();
    if (expanded.has(agentId)) {
      expanded.delete(agentId);
    } else {
      expanded.add(agentId);
    }
    this.expandedNodes.set(new Set(expanded)); // Trigger signal update
  }

  // Check if node is expanded
  isExpanded(agentId: string): boolean {
    return this.expandedNodes().has(agentId);
  }

  // Format duration (seconds to "Xm Ys" or "Xs")
  formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Format tool activity line
  formatToolActivity(activity: ClaudeAgentActivityEvent): string {
    const inputStr = JSON.stringify(activity.toolInput);
    const truncated = inputStr.length > 60 ? inputStr.slice(0, 60) + '...' : inputStr;
    return `${activity.toolName}: ${truncated}`;
  }
}
```

**File**: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.html`

```html
<div class="agent-tree" role="tree" aria-label="Agent execution tree">
  @for (node of agents(); track node.agent.agentId) {
  <div class="agent-node" [class.expanded]="isExpanded(node.agent.agentId)" [class.error]="node.status === 'error'" role="treeitem" [attr.aria-expanded]="isExpanded(node.agent.agentId)" [attr.aria-level]="1" tabindex="0" (click)="toggleNode(node.agent.agentId)" (keydown.enter)="toggleNode(node.agent.agentId)" (keydown.space)="toggleNode(node.agent.agentId); $event.preventDefault()">
    <!-- Collapse/Expand Chevron -->
    <lucide-icon [img]="isExpanded(node.agent.agentId) ? ChevronDownIcon : ChevronRightIcon" [size]="12" class="chevron-icon" [class.expanded]="isExpanded(node.agent.agentId)" aria-hidden="true" />

    <!-- Agent Icon -->
    <lucide-icon [img]="iconService.getAgentIcon(node.agent.subagentType)" [size]="16" [style.color]="iconService.getAgentColor(node.agent.subagentType)" class="agent-icon" aria-hidden="true" />

    <!-- Agent Type Label -->
    <span class="agent-type">{{ node.agent.subagentType }}</span>

    <!-- Duration & Status Badge -->
    <div class="agent-status">
      @if (node.duration) {
      <span class="agent-duration">{{ formatDuration(node.duration) }}</span>
      } @if (node.status === 'complete') {
      <span class="status-badge complete" aria-label="Complete">✅</span>
      } @else if (node.status === 'running') {
      <span class="status-badge running" aria-label="Running">⏱️</span>
      } @else if (node.status === 'error') {
      <span class="status-badge error" aria-label="Error">🔴</span>
      }
    </div>

    <!-- Expanded Content -->
    @if (isExpanded(node.agent.agentId)) {
    <div class="agent-node-content">
      <!-- Agent Description -->
      <div class="agent-description" [title]="node.agent.prompt">{{ node.agent.description }}</div>

      <!-- Error Message (if any) -->
      @if (node.errorMessage) {
      <div class="error-message">
        <lucide-icon [img]="AlertCircleIcon" [size]="10" aria-hidden="true" />
        {{ node.errorMessage }}
      </div>
      }

      <!-- Tool Activity Lines -->
      @if (node.activities.length > 0) {
      <div class="tool-activities" role="group" aria-label="Tool executions">
        @for (activity of node.activities; track activity.timestamp) {
        <div class="tool-activity-line" role="treeitem" [attr.aria-level]="2" [title]="JSON.stringify(activity.toolInput)">
          <lucide-icon [img]="iconService.getToolIcon(activity.toolName)" [size]="12" class="tool-icon" aria-hidden="true" />
          <span class="tool-activity-text">{{ formatToolActivity(activity) }}</span>
        </div>
        }
      </div>
      }
    </div>
    }
  </div>
  }
</div>
```

**File**: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.css`

```css
/* Agent Tree Container */
.agent-tree {
  width: 100%;
  padding: 8px;
  background-color: var(--vscode-sideBar-background);
  overflow-y: auto;
  max-height: 600px; /* Adjust based on layout */
}

/* Agent Node */
.agent-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 4px;
  background-color: var(--vscode-editor-background);
  border-left: 2px solid var(--vscode-symbolIcon-classForeground);
  cursor: pointer;
  transition: background-color 150ms ease-out;
}

.agent-node:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.agent-node:focus {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.agent-node.error {
  border-left-color: var(--vscode-errorForeground);
}

/* Chevron Icon */
.chevron-icon {
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
  transition: transform 150ms ease-out;
}

.chevron-icon.expanded {
  transform: rotate(90deg);
}

/* Agent Icon */
.agent-icon {
  flex-shrink: 0;
}

/* Agent Type Label */
.agent-type {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
}

/* Agent Status (right-aligned) */
.agent-status {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-duration {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
}

.status-badge {
  font-size: 14px;
}

/* Expanded Content */
.agent-node-content {
  width: 100%;
  margin-top: 8px;
  animation: expandNode 300ms ease-out;
}

@keyframes expandNode {
  from {
    max-height: 0;
    opacity: 0;
  }
  to {
    max-height: 500px;
    opacity: 1;
  }
}

/* Agent Description */
.agent-description {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Error Message */
.error-message {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-errorForeground);
  margin-bottom: 8px;
}

/* Tool Activities */
.tool-activities {
  margin-left: 40px;
  border-left: 1px solid var(--vscode-widget-border);
  padding-left: 8px;
}

.tool-activity-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  transition: background-color 150ms ease-out;
}

.tool-activity-line:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tool-icon {
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
}

.tool-activity-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Accessibility: Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .agent-node,
  .chevron-icon,
  .agent-node-content {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Step 4: Implement AgentTimelineComponent

**File**: `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts`

```typescript
import { Component, input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClaudeAgentStartEvent } from '@ptah-extension/shared';
import { AgentIconService } from '../../services/agent-icon.service';

export interface TimelineAgent {
  agent: ClaudeAgentStartEvent;
  startTime: number; // milliseconds from timeline start
  duration: number; // milliseconds
  status: 'running' | 'complete';
  track: number; // swimlane track number
}

@Component({
  selector: 'ptah-agent-timeline',
  standalone: true,
  imports: [
    CommonModule,
    // Import lucide-angular icons as needed
  ],
  templateUrl: './agent-timeline.component.html',
  styleUrls: ['./agent-timeline.component.css'],
})
export class AgentTimelineComponent {
  // Input signals
  readonly agents = input.required<TimelineAgent[]>();

  // Computed signals
  readonly maxDuration = computed(() => {
    const agents = this.agents();
    if (agents.length === 0) return 60000; // Default 60s
    return Math.max(...agents.map((a) => a.startTime + a.duration));
  });

  readonly timelineScale = computed(() => {
    const maxDuration = this.maxDuration();
    const seconds = maxDuration / 1000;
    // Base scale: 2px per second, auto-scale if > 300s
    return seconds > 300 ? 600 / seconds : 2; // px per second
  });

  readonly maxTrack = computed(() => {
    const agents = this.agents();
    if (agents.length === 0) return 1;
    return Math.max(...agents.map((a) => a.track));
  });

  readonly scaleMarkers = computed(() => {
    const maxDuration = this.maxDuration();
    const seconds = Math.ceil(maxDuration / 1000);
    const markers: number[] = [];
    for (let i = 0; i <= seconds; i += 10) {
      markers.push(i);
    }
    return markers;
  });

  // Popover state
  readonly hoveredAgent = signal<TimelineAgent | null>(null);

  constructor(readonly iconService: AgentIconService) {}

  // Calculate segment position and width
  getSegmentStyle(agent: TimelineAgent) {
    const scale = this.timelineScale();
    const left = (agent.startTime / 1000) * scale;
    const width = (agent.duration / 1000) * scale;
    return {
      left: `${left}px`,
      width: `${width}px`,
      top: `${agent.track * 48}px`, // 40px track height + 8px gap
    };
  }

  // Format duration for display
  formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Show popover
  showPopover(agent: TimelineAgent, event: MouseEvent): void {
    setTimeout(() => {
      if ((event.target as HTMLElement).matches(':hover')) {
        this.hoveredAgent.set(agent);
      }
    }, 300); // 300ms delay
  }

  // Hide popover
  hidePopover(): void {
    this.hoveredAgent.set(null);
  }
}
```

**File**: `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.html`

```html
<div class="timeline-container" role="region" aria-label="Agent execution timeline">
  <!-- Timeline Scale -->
  <div class="timeline-scale">
    @for (marker of scaleMarkers(); track marker) {
    <div class="scale-marker" [style.left.px]="marker * timelineScale()">{{ marker }}s</div>
    }
  </div>

  <!-- Timeline Tracks -->
  <div class="timeline-tracks" [style.height.px]="(maxTrack() + 1) * 48">
    @for (agent of agents(); track agent.agent.agentId) {
    <div class="timeline-segment" [class.running]="agent.status === 'running'" [class.complete]="agent.status === 'complete'" [style.left]="getSegmentStyle(agent).left" [style.width]="getSegmentStyle(agent).width" [style.top]="getSegmentStyle(agent).top" role="listitem" [attr.aria-label]="agent.agent.subagentType + ' agent, ' + formatDuration(agent.duration) + ' duration'" (mouseenter)="showPopover(agent, $event)" (mouseleave)="hidePopover()">
      <!-- Start Marker -->
      <div class="timeline-marker start"></div>

      <!-- Segment Label -->
      <div class="segment-label">
        <lucide-icon [img]="iconService.getAgentIcon(agent.agent.subagentType)" [size]="14" aria-hidden="true" />
        <span>{{ agent.agent.subagentType }} ({{ formatDuration(agent.duration) }})</span>
      </div>

      <!-- End Marker -->
      <div class="timeline-marker end"></div>
    </div>
    }
  </div>

  <!-- Popover -->
  @if (hoveredAgent()) {
  <div class="timeline-popover" role="tooltip">
    <div class="popover-header">
      <lucide-icon [img]="iconService.getAgentIcon(hoveredAgent()!.agent.subagentType)" [size]="14" aria-hidden="true" />
      <span class="popover-title">{{ hoveredAgent()!.agent.subagentType }}</span>
    </div>
    <div class="popover-divider"></div>
    <div class="popover-content">
      <div class="popover-row">
        <span class="popover-label">Start:</span>
        <span>{{ formatDuration(hoveredAgent()!.startTime) }}</span>
      </div>
      <div class="popover-row">
        <span class="popover-label">Duration:</span>
        <span>{{ formatDuration(hoveredAgent()!.duration) }}</span>
      </div>
      <div class="popover-row">
        <span class="popover-label">Status:</span>
        <span>{{ hoveredAgent()!.status === 'complete' ? '✅ Complete' : '⏱️ Running' }}</span>
      </div>
    </div>
  </div>
  }
</div>
```

**File**: `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.css`

```css
/* Timeline Container */
.timeline-container {
  position: relative;
  width: 100%;
  height: 250px;
  padding: 16px;
  background-color: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-widget-border);
  overflow-x: auto;
  overflow-y: hidden;
}

/* Timeline Scale */
.timeline-scale {
  position: relative;
  height: 20px;
  background-color: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  margin-bottom: 16px;
}

.scale-marker {
  position: absolute;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  top: 4px;
}

/* Timeline Tracks */
.timeline-tracks {
  position: relative;
  width: 100%;
}

/* Timeline Segment */
.timeline-segment {
  position: absolute;
  height: 24px;
  background: linear-gradient(to right, var(--vscode-symbolIcon-classForeground) 0%, rgba(var(--vscode-symbolIcon-classForeground), 0.4) 100%);
  border: 1px solid var(--vscode-symbolIcon-classForeground);
  border-radius: 3px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  cursor: pointer;
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
}

.timeline-segment:hover {
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.timeline-segment.running {
  animation: growSegment linear;
}

@keyframes growSegment {
  from {
    width: 0;
  }
  to {
    width: 100%;
  }
}

/* Timeline Markers */
.timeline-marker {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--vscode-editor-background);
}

.timeline-marker.start {
  left: -4px;
  background-color: var(--vscode-symbolIcon-classForeground);
}

.timeline-marker.end {
  right: -4px;
  background-color: var(--vscode-testing-iconPassed);
}

/* Segment Label */
.segment-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-editor-background);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Popover */
.timeline-popover {
  position: absolute;
  top: 120px; /* Adjust based on hover position */
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  padding: 12px;
  max-width: 300px;
  z-index: 1000;
  animation: fadeInTooltip 150ms ease-out;
}

@keyframes fadeInTooltip {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.popover-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
}

.popover-divider {
  height: 1px;
  background-color: var(--vscode-widget-border);
  margin-bottom: 8px;
}

.popover-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popover-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--vscode-editor-foreground);
}

.popover-label {
  color: var(--vscode-descriptionForeground);
}

/* Accessibility */
@media (prefers-reduced-motion: reduce) {
  .timeline-segment,
  .timeline-popover {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Step 5: Implement AgentStatusBadge

**File**: `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts`

```typescript
import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface AgentStatusInfo {
  agentId: string;
  subagentType: string;
  duration: number;
}

@Component({
  selector: 'ptah-agent-status-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './agent-status-badge.component.html',
  styleUrls: ['./agent-status-badge.component.css'],
})
export class AgentStatusBadgeComponent {
  // Input signals
  readonly activeAgents = input.required<AgentStatusInfo[]>();
  readonly errorCount = input<number>(0);

  // Output signals
  readonly badgeClicked = output<void>();

  // Computed signals
  readonly agentCount = computed(() => this.activeAgents().length);
  readonly hasErrors = computed(() => this.errorCount() > 0);
  readonly badgeText = computed(() => {
    const count = this.agentCount();
    if (count === 0) return 'No agents';
    return count === 1 ? '1 agent' : `${count} agent(s)`;
  });

  // Format duration
  formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}
```

**File**: `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.html`

```html
<div class="agent-status-badge" [class.active]="agentCount() > 0" [class.error]="hasErrors()" role="button" [attr.aria-label]="agentCount() > 0 ? badgeText() + ', click to toggle agent tree panel' : 'No agents active'" tabindex="0" (click)="badgeClicked.emit()" (keydown.enter)="badgeClicked.emit()" (keydown.space)="badgeClicked.emit(); $event.preventDefault()">
  <!-- Robot Icon -->
  <span class="badge-icon">🤖</span>

  <!-- Badge Text -->
  <span class="badge-text">{{ badgeText() }}</span>

  <!-- Error Indicator Overlay -->
  @if (hasErrors()) {
  <div class="error-indicator" aria-label="{{ errorCount() }} error(s)">{{ errorCount() }}</div>
  }

  <!-- Hover Tooltip -->
  @if (agentCount() > 0) {
  <div class="badge-tooltip" role="tooltip">
    <div class="tooltip-header">Active Agents:</div>
    <ul class="tooltip-list">
      @for (agent of activeAgents(); track agent.agentId) {
      <li class="tooltip-item">
        <span>{{ agent.subagentType }}</span>
        <span class="tooltip-duration">({{ formatDuration(agent.duration) }})</span>
      </li>
      }
    </ul>
  </div>
  } @else {
  <div class="badge-tooltip" role="tooltip">No agents currently active</div>
  }
</div>
```

**File**: `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.css`

```css
/* Badge Container */
.agent-status-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 120px;
  height: 24px;
  padding: 4px 6px;
  background-color: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 3px;
  cursor: pointer;
  transition: background-color 150ms ease-out;
}

.agent-status-badge:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.agent-status-badge:focus {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

/* Active State */
.agent-status-badge.active {
  background-color: var(--vscode-button-background);
  animation: pulseAgent 2s ease-in-out infinite;
}

@keyframes pulseAgent {
  0%,
  100% {
    opacity: 0.7;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.02);
  }
}

.agent-status-badge.active:hover {
  background-color: var(--vscode-button-hoverBackground);
}

/* Error State */
.agent-status-badge.error {
  background-color: var(--vscode-sideBar-background);
  animation: none; /* No pulsing on error */
}

/* Badge Icon */
.badge-icon {
  font-size: 16px;
}

/* Badge Text */
.badge-text {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
}

.agent-status-badge.active .badge-text {
  color: var(--vscode-button-foreground);
}

.agent-status-badge.error .badge-text {
  color: var(--vscode-errorForeground);
}

/* Error Indicator Overlay */
.error-indicator {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  background-color: var(--vscode-errorForeground);
  border: 2px solid var(--vscode-editor-background);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: white;
}

/* Hover Tooltip */
.badge-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  padding: 8px;
  max-width: 200px;
  z-index: 1000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease-out;
}

.agent-status-badge:hover .badge-tooltip {
  opacity: 1;
}

.tooltip-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
  margin-bottom: 4px;
}

.tooltip-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tooltip-item {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--vscode-editor-foreground);
  padding: 2px 0;
}

.tooltip-duration {
  color: var(--vscode-descriptionForeground);
}

/* Fade to Inactive Animation */
.agent-status-badge.completing {
  animation: fadeToInactive 500ms ease-out forwards;
}

@keyframes fadeToInactive {
  from {
    background-color: var(--vscode-button-background);
  }
  to {
    background-color: var(--vscode-sideBar-background);
  }
}

/* Accessibility */
@media (prefers-reduced-motion: reduce) {
  .agent-status-badge,
  .badge-tooltip {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Integration with ChatComponent

### Step 6: Add Components to Chat Layout

**File**: `libs/frontend/chat/src/lib/containers/chat/chat.component.html` (modifications)

```html
<!-- Existing chat header -->
<ptah-chat-header>
  <!-- Add status badge to header -->
  <ptah-agent-status-badge [activeAgents]="activeAgentsList()" [errorCount]="agentErrorCount()" (badgeClicked)="toggleAgentPanel()" />
</ptah-chat-header>

<!-- Chat messages and agent panel layout -->
<div class="chat-body">
  <!-- Main messages area -->
  <div class="messages-container">
    <!-- Existing messages component -->
    <ptah-chat-messages-container />
  </div>

  <!-- Agent panel (collapsible sidebar) -->
  @if (isAgentPanelVisible()) {
  <div class="agent-panel">
    <!-- Agent tree -->
    <ptah-agent-tree [agents]="agentTreeNodes()" (agentClicked)="scrollToAgent($event)" />

    <!-- Agent timeline (below tree) -->
    <ptah-agent-timeline [agents]="timelineAgents()" />
  </div>
  }
</div>
```

**File**: `libs/frontend/chat/src/lib/containers/chat/chat.component.css` (additions)

```css
/* Chat body with agent panel */
.chat-body {
  display: flex;
  height: calc(100vh - 120px); /* Adjust based on header/footer heights */
}

.messages-container {
  flex: 1;
  overflow-y: auto;
}

.agent-panel {
  width: 350px;
  border-left: 1px solid var(--vscode-widget-border);
  background-color: var(--vscode-sideBar-background);
  overflow-y: auto;
  animation: slideInPanel 250ms ease-out;
}

@keyframes slideInPanel {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Responsive: Overlay on narrow viewports */
@media (max-width: 800px) {
  .agent-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100vh;
    z-index: 100;
    box-shadow: -4px 0 8px rgba(0, 0, 0, 0.2);
  }
}
```

---

## Testing Criteria

### Visual Regression Testing

**Light/Dark/High-Contrast Themes**:

- [ ] Test all components in VS Code light theme
- [ ] Test all components in VS Code dark theme (default)
- [ ] Test all components in high-contrast theme
- [ ] Verify icon colors adapt correctly to theme
- [ ] Verify text contrast meets 4.5:1 minimum

**Component States**:

- [ ] Agent tree: expanded, collapsed, error states
- [ ] Timeline: single agent, parallel agents, long durations (auto-scaling)
- [ ] Status badge: no agents, active, error states

**Animations**:

- [ ] Expand/collapse animation runs at 60fps (Chrome DevTools Performance)
- [ ] Pulsing animation loops smoothly (2s duration)
- [ ] Timeline segment growth animation is linear
- [ ] Reduced motion disables all animations

### Accessibility Testing

**Keyboard Navigation**:

- [ ] Tab through all interactive elements in correct order
- [ ] Enter/Space activates focused elements (expand/collapse, badge click)
- [ ] Arrow keys navigate tree hierarchy and timeline segments
- [ ] Escape closes tooltips/popovers
- [ ] Focus indicators visible (2px blue outline)

**Screen Reader Testing** (NVDA/JAWS):

- [ ] Agent tree announces as "Agent execution tree"
- [ ] Agent nodes announce with status and duration
- [ ] Tool activities announce with tool name and action
- [ ] Timeline segments announce with agent type and duration
- [ ] Status badge announces active agent count

**ARIA Validation**:

- [ ] Axe DevTools reports 0 violations
- [ ] All interactive elements have appropriate ARIA roles
- [ ] All icons have `aria-hidden="true"` (semantics from text labels)
- [ ] Live regions announce agent state changes

### Functional Testing

**Agent Tree**:

- [ ] Clicking chevron/node toggles expansion
- [ ] Tool activities display under expanded agent
- [ ] Error state shows red border and error message
- [ ] Hover tooltip displays full prompt text after 500ms delay
- [ ] Duration updates in real-time for running agents

**Timeline**:

- [ ] Timeline segments positioned correctly based on start time
- [ ] Timeline scale adjusts for long durations (> 300s)
- [ ] Parallel agents appear on separate tracks (no overlap)
- [ ] Hover popover displays agent details after 300ms delay
- [ ] Auto-scroll to latest activity works

**Status Badge**:

- [ ] Badge pulses when agents active
- [ ] Badge text updates in real-time (agent count)
- [ ] Hover tooltip lists active agents with durations
- [ ] Clicking badge toggles agent panel visibility
- [ ] Error indicator appears when errors occur
- [ ] Badge fades to inactive state after all agents complete (500ms animation)

---

## Quality Requirements

### Code Quality Standards

**TypeScript Compliance**:

- Zero `any` types (use proper type definitions)
- All public methods have TSDoc comments
- Signal-based reactivity (no RxJS BehaviorSubject)
- OnPush change detection strategy enforced

**Angular Best Practices**:

- Standalone components (no NgModules)
- Signal-based inputs/outputs (no decorators)
- Control flow syntax (`@if`, `@for`, `@switch`)
- Proper dependency injection (inject() or constructor)

**CSS Standards**:

- 100% VS Code CSS variables (no hardcoded colors)
- BEM naming convention for classes (block\_\_element--modifier)
- Mobile-first approach (if responsive needed, but VS Code is desktop-only)
- Accessibility considerations (focus indicators, reduced motion)

### Performance Requirements

**Render Performance**:

- Agent tree with 50 nodes renders in < 16ms (60fps)
- Timeline with 10 parallel agents renders in < 16ms
- Status badge updates in < 5ms

**Memory Usage**:

- Agent state < 10MB for 100 agents
- No memory leaks on component destroy
- Proper cleanup in ngOnDestroy lifecycle hook

---

## Developer Checklist

**Before Starting**:

- [ ] Read visual-design-specification.md completely
- [ ] Review design-assets-inventory.md for icon mappings
- [ ] Understand existing ChatComponent structure
- [ ] Verify lucide-angular is installed (check package.json)

**During Implementation**:

- [ ] Create icon mapping constants and service first
- [ ] Implement components in order: AgentTree → Timeline → Badge
- [ ] Test each component in isolation before integration
- [ ] Write unit tests alongside component code
- [ ] Commit frequently with clear messages

**Before Completion**:

- [ ] All 3 components render correctly with mock data
- [ ] All animations run smoothly (60fps)
- [ ] Keyboard navigation works for all interactive elements
- [ ] Screen reader announces agent state changes
- [ ] Axe DevTools reports 0 accessibility violations
- [ ] Light/dark themes both tested
- [ ] Code review checklist completed (see code-reviewer quality gates)

---

## Next Steps

**After Implementation**:

1. Create pull request with all 3 components
2. Request code review from **code-reviewer** agent
3. Address review feedback
4. Run E2E tests with real Claude CLI Task tool scenarios
5. Update CLAUDE.md documentation for `libs/frontend/chat`
6. Capture screenshots for user documentation

**Dependencies**:

- Backend must emit `chat:agentStarted`, `chat:agentActivity`, `chat:agentCompleted` events
- ChatService must handle agent events and update signals
- MessageHandlerService must subscribe to EventBus agent events

**Integration Testing**:

- Test with real Claude CLI session (invoke Task tool)
- Verify agent events flow from backend → EventBus → frontend
- Confirm UI updates in real-time as agents execute

---

## Conclusion

All visual specifications, component architectures, and implementation details are provided in this handoff. No additional design decisions are required. All designs follow VS Code theming, WCAG 2.1 AA accessibility standards, and Angular 20+ best practices.

**Estimated Implementation Time**: 8-12 hours (2-3 hours per component + 2-3 hours integration/testing)

**Questions or Clarifications**: Reference visual-design-specification.md for detailed mockups and design-assets-inventory.md for icon specifications.

**Ready for Implementation**: frontend-developer can begin immediately with Step 1 (icon mapping constants).
