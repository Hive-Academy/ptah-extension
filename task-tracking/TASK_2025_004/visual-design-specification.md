# Visual Design Specification - TASK_2025_004

**Project**: Ptah Extension - Agent System Visualization
**Date**: 2025-11-17
**Status**: Design Complete
**Designer**: ui-ux-designer

---

## Design Investigation Summary

### Design System Analysis

**Design System Source**: D:/projects/ptah-extension/libs/frontend/shared-ui/CLAUDE.md
**Key Tokens Extracted**: 35+ VS Code CSS variables (colors, borders, focus states)
**Accessibility Compliance**: WCAG 2.1 AA validated (4.5:1 minimum contrast)
**Responsive Breakpoints**: VS Code webview (adaptive, no fixed breakpoints)

### Requirements Analysis

**User Requirements**: Transparent agent orchestration visualization (16 subagent types, 3 UI components)
**Business Requirements**: First-to-market agent tracking UI for Claude Code CLI
**Technical Constraints**: Angular 20, VS Code webview, signal-based state management

### Design Philosophy

**Chosen Visual Language**: VS Code Native with subtle enhancements
**Rationale**: Seamless integration with VS Code theming while providing clear agent activity visibility
**Evidence**: Design system mandates 100% CSS custom properties, auto-adapts to dark/light/high-contrast themes

---

## Design System Integration

### Color Palette

**VS Code Theme Variables** (all colors use existing variables):

**Background Colors**:

- Primary Background: `var(--vscode-editor-background)` - Main canvas
- Secondary Background: `var(--vscode-sideBar-background)` - Panels and sidebars
- Hover Background: `var(--vscode-list-hoverBackground)` - Interactive element hover
- Selection Background: `var(--vscode-list-activeSelectionBackground)` - Active selections

**Text Colors**:

- Primary Text: `var(--vscode-editor-foreground)` - Default text (auto WCAG AA compliant)
- Secondary Text: `var(--vscode-descriptionForeground)` - Muted labels
- Error Text: `var(--vscode-errorForeground)` - Error messages (red accent)

**Accent Colors**:

- Focus Border: `var(--vscode-focusBorder)` - Keyboard focus (typically blue)
- Button Background: `var(--vscode-button-background)` - Primary actions
- Button Hover: `var(--vscode-button-hoverBackground)` - Button hover state

**Border & Dividers**:

- Widget Border: `var(--vscode-widget-border)` - Component borders
- Input Border: `var(--vscode-input-border)` - Input field borders

**Accessibility Notes**:

- All VS Code variables guarantee WCAG AA contrast in light/dark modes
- No custom color codes needed - theme system ensures accessibility

### Typography Scale

**Font Family**: `var(--vscode-font-family, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)`

**Typography Hierarchy** (using standard font sizes):

| Element           | Size | Weight         | Line Height | Usage                   |
| ----------------- | ---- | -------------- | ----------- | ----------------------- |
| Agent Type Label  | 13px | 600 (semibold) | 1.4         | Agent role identifiers  |
| Agent Description | 12px | 400 (regular)  | 1.5         | Agent task descriptions |
| Tool Activity     | 11px | 400 (regular)  | 1.5         | Tool execution logs     |
| Status Badge Text | 11px | 500 (medium)   | 1.4         | Badge labels            |
| Timeline Label    | 10px | 400 (regular)  | 1.3         | Timeline markers        |
| Timestamp         | 10px | 400 (regular)  | 1.3         | Duration/time labels    |

**Responsive Typography**: No mobile variant (VS Code webview is desktop-only)

### Spacing System

**8px Grid System**:

- Base unit: 8px
- Component padding: 8px (compact), 12px (comfortable), 16px (spacious)
- Element margin: 4px (tight), 8px (standard), 12px (generous)
- Tree node indentation: 16px per level
- Timeline track height: 40px

**Component-Specific Spacing**:

- Agent Tree Node: 8px vertical padding, 12px horizontal padding
- Timeline Track Gap: 8px between swimlanes
- Status Badge: 6px horizontal padding, 4px vertical padding

### Shadows & Elevation

**No Custom Shadows**: VS Code design system avoids shadows for flat UI consistency
**Elevation via Borders**: Use `var(--vscode-widget-border)` for subtle component separation

### Border Radius

**Minimal Rounding** (following VS Code patterns):

- Badges: 3px (subtle rounded)
- Tree Nodes: 0px (sharp edges, VS Code standard)
- Buttons: 2px (very subtle)

---

## Agent Icon System (16 Icons)

### Icon Design Principles

**Consistent Design Language**:

- All icons use lucide-angular icon library (already in project)
- Size: 16px × 16px primary (scalable SVG)
- Color: `var(--vscode-editor-foreground)` with opacity variations
- Visual Weight: Stroke width 2px (consistent with lucide defaults)

**Accessibility**:

- Minimum contrast ratio: 4.5:1 (guaranteed by VS Code variables)
- Always paired with text labels (never icon-only)
- ARIA labels provided for screen readers

### Icon Specifications (16 Subagent Types)

| Subagent Type              | Icon (lucide-angular) | Color                                                    | Semantic Meaning              |
| -------------------------- | --------------------- | -------------------------------------------------------- | ----------------------------- |
| **general-purpose**        | `CircleDot`           | `var(--vscode-editor-foreground)`                        | Flexible, all-purpose agent   |
| **Explore**                | `Search`              | `var(--vscode-symbolIcon-classForeground)`               | Code exploration, discovery   |
| **Plan**                   | `Map`                 | `var(--vscode-symbolIcon-namespaceForeground)`           | Strategic planning, design    |
| **business-analyst**       | `TrendingUp`          | `var(--vscode-charts-blue)`                              | Scope validation, analysis    |
| **backend-developer**      | `Server`              | `var(--vscode-symbolIcon-functionForeground)`            | Server-side implementation    |
| **project-manager**        | `Clipboard`           | `var(--vscode-symbolIcon-constantForeground)`            | Requirements, task management |
| **modernization-detector** | `Sparkles`            | `var(--vscode-symbolIcon-keywordForeground)`             | Tech stack modernization      |
| **frontend-developer**     | `PaintBucket`         | `var(--vscode-symbolIcon-classForeground)`               | UI/UX implementation          |
| **code-reviewer**          | `FileCheck`           | `var(--vscode-testing-iconPassed)`                       | Code quality validation       |
| **software-architect**     | `Building2`           | `var(--vscode-symbolIcon-moduleForeground)`              | System design, architecture   |
| **senior-tester**          | `FlaskConical`        | `var(--vscode-testing-iconQueued)`                       | Quality assurance, testing    |
| **researcher-expert**      | `BookOpen`            | `var(--vscode-symbolIcon-stringForeground)`              | Deep research, knowledge      |
| **ui-ux-designer**         | `Palette`             | `var(--vscode-symbolIcon-colorForeground)`               | Visual design specifications  |
| **team-leader**            | `Users`               | `var(--vscode-symbolIcon-interfaceForeground)`           | Task delegation, coordination |
| **workflow-orchestrator**  | `GitBranch`           | `var(--vscode-gitDecoration-modifiedResourceForeground)` | Git workflows, automation     |
| **statusline-setup**       | `Settings`            | `var(--vscode-symbolIcon-variableForeground)`            | Configuration, setup          |

**Icon Implementation**:

```typescript
// Example: lucide-angular icon usage
import { SearchIcon, ServerIcon, PaletteIcon } from 'lucide-angular';

@Component({
  imports: [SearchIcon, ServerIcon, PaletteIcon],
})
export class AgentTreeComponent {
  // Icon mapping for dynamic rendering
  readonly agentIcons = {
    Explore: SearchIcon,
    'backend-developer': ServerIcon,
    'ui-ux-designer': PaletteIcon,
    // ... 13 more mappings
  };
}
```

**SVG Format Specifications**:

- Format: lucide-angular component imports (no custom SVG files needed)
- Size: 16px × 16px (default lucide size)
- Accessibility: Add `aria-hidden="true"` to icon, use text label for semantics

---

## Component Visual Specifications

### Component 1: AgentTreeComponent

**Purpose**: Collapsible tree visualization of active/completed subagents with tool activity logs

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent Tree                                                       │ ← Header (optional)
├─────────────────────────────────────────────────────────────────┤
│ ▼ 🔍 Explore                                           ⏱️ 12s ✅ │ ← Agent Node (expanded)
│     Description: Analyze project structure                      │
│     ├─ 🔧 Bash: npm run build                                  │ ← Tool activity line
│     ├─ 📄 Read: package.json                                   │
│     └─ 🔍 Grep: "dependencies"                                 │
│ ▶ 💻 backend-developer                                 ⏱️ 45s ✅ │ ← Agent Node (collapsed)
│ ▶ 🎨 ui-ux-designer                                       🔴 Error│ ← Error state
└─────────────────────────────────────────────────────────────────┘
```

#### Visual Specifications

**Agent Node Design** (Expanded State):

- Height: Auto (minimum 32px)
- Padding: 8px vertical, 12px horizontal
- Background: `var(--vscode-editor-background)` (default)
- Background (hover): `var(--vscode-list-hoverBackground)`
- Border: None (flat design)
- Border-left: 2px solid `var(--vscode-symbolIcon-classForeground)` (subtle accent)

**Collapse/Expand Icon**:

- Position: Left-aligned, 4px margin-right
- Size: 12px × 12px
- Icon: `ChevronRight` (collapsed), `ChevronDown` (expanded)
- Color: `var(--vscode-descriptionForeground)`
- Transition: 150ms ease-out rotation (90deg)

**Agent Icon**:

- Position: After collapse icon, 8px margin-right
- Size: 16px × 16px
- Color: Semantic color from icon table (see Agent Icon System)

**Agent Type Label**:

- Font: 13px semibold
- Color: `var(--vscode-editor-foreground)`
- Position: Inline after icon

**Agent Description**:

- Font: 12px regular
- Color: `var(--vscode-descriptionForeground)`
- Position: Below agent type label (8px margin-top)
- Max-width: 100%
- Overflow: text-overflow: ellipsis (truncate long descriptions)

**Duration & Status Badge**:

- Position: Right-aligned, absolute positioning
- Font: 11px medium
- Duration: `var(--vscode-descriptionForeground)`
- Status Icon: ✅ (complete), ⏱️ (running), 🔴 (error)
- Gap: 8px between duration and status

#### Tool Activity Lines

**Layout**:

- Indentation: 40px from left (nested under agent node)
- Padding: 4px vertical, 8px horizontal
- Background: Transparent
- Border-left: 1px solid `var(--vscode-widget-border)` (connecting line to parent)

**Tool Icon & Label**:

- Icon: 12px × 12px (e.g., 🔧 Bash, ✏️ Edit, 📄 Read)
- Font: 11px regular
- Color: `var(--vscode-descriptionForeground)`
- Format: `[Icon] [ToolName]: [Truncated Input]`
- Max-length: 60 characters (ellipsis truncation)

**Tool Activity States**:

- Default: Normal opacity (100%)
- Hover: Background `var(--vscode-list-hoverBackground)`, cursor pointer
- Click: Show tooltip with full tool input JSON

#### Collapsed State

**Agent Node (Collapsed)**:

- Height: 32px
- Description: Hidden
- Tool Activities: Hidden
- Chevron: Rotated 0deg (right-pointing)
- Transition: 300ms ease-out (smooth collapse animation)

#### Error State

**Agent Node (Error)**:

- Border-left: 2px solid `var(--vscode-errorForeground)` (red accent)
- Status Badge: 🔴 Error (red color)
- Error Message: Display below description in `var(--vscode-errorForeground)` color
- Error Message Font: 11px regular

#### Hover States

**Agent Node Hover**:

- Background: `var(--vscode-list-hoverBackground)`
- Cursor: pointer
- Transition: 150ms ease-out

**Tooltip (Full Prompt Text)**:

- Trigger: Hover on agent description for 500ms
- Position: Below agent node, 8px offset
- Background: `var(--vscode-editorWidget-background)`
- Border: 1px solid `var(--vscode-widget-border)`
- Padding: 8px
- Font: 11px monospace (for code prompts)
- Max-width: 400px
- Max-height: 200px (scrollable if needed)
- Z-index: 1000

#### Keyboard Navigation

**Focus States**:

- Focus Indicator: 2px solid `var(--vscode-focusBorder)` outline
- Focus Offset: 2px
- Tab Order: Agent nodes in chronological order → Tool activity lines

**Keyboard Actions**:

- Tab: Move focus to next agent node
- Enter/Space: Toggle collapse/expand
- Arrow Right: Expand node (if collapsed)
- Arrow Left: Collapse node (if expanded)
- Arrow Down: Focus next agent
- Arrow Up: Focus previous agent

#### Animation Specifications

**Expand/Collapse Animation**:

```css
@keyframes expandNode {
  from {
    max-height: 32px;
    opacity: 0.7;
  }
  to {
    max-height: 500px; /* Adjust based on content */
    opacity: 1;
  }
}

.agent-node-content {
  animation: expandNode 300ms ease-out;
}
```

**Chevron Rotation**:

```css
.chevron-icon {
  transition: transform 150ms ease-out;
}
.chevron-icon.expanded {
  transform: rotate(90deg);
}
```

#### Responsive Behavior

**No mobile variant** (VS Code webview is desktop-only)

**Adaptive Width**:

- Container: 100% width of parent panel
- Minimum width: 250px
- Maximum width: No limit (fills available space)

---

### Component 2: AgentTimelineComponent

**Purpose**: Horizontal timeline visualizing agent execution with temporal relationships (parallel vs sequential)

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Timeline                                                   [0s────60s]   │ ← Header with scale
├─────────────────────────────────────────────────────────────────────────┤
│ Track 1: ●──────────────────────────────●  🔍 Explore (12s)           │ ← Swimlane 1
│ Track 2:         ●────────────────────────────────────────● 💻 Backend (45s) │ ← Swimlane 2
│ Track 3:                  ●────────● 🎨 UI/UX (8s)                     │ ← Swimlane 3
└─────────────────────────────────────────────────────────────────────────┘
```

#### Visual Specifications

**Timeline Container**:

- Height: Auto (40px per track + 16px padding)
- Padding: 16px all sides
- Background: `var(--vscode-sideBar-background)`
- Border: 1px solid `var(--vscode-widget-border)`
- Overflow-x: auto (horizontal scroll)
- Overflow-y: hidden

**Timeline Scale** (Top Header):

- Height: 20px
- Background: `var(--vscode-editor-background)`
- Border-bottom: 1px solid `var(--vscode-widget-border)`
- Scale Markers: Every 10 seconds (e.g., "0s", "10s", "20s", "30s")
- Marker Font: 10px regular
- Marker Color: `var(--vscode-descriptionForeground)`

**Timeline Scaling**:

- Base Scale: 1 second = 2px width
- Auto-scaling: If total duration > 300s, scale down to fit viewport (min 0.5px/second)
- Maximum width: No limit (horizontal scroll enabled)

#### Swimlane Track Design

**Track Container**:

- Height: 40px
- Margin-bottom: 8px (gap between tracks)
- Background: Transparent
- Border-bottom: 1px solid `var(--vscode-widget-border)` (subtle separation)

**Timeline Segment** (Agent Duration Line):

- Height: 24px (centered in 40px track)
- Background: Gradient based on agent type:
  - Start: `var(--vscode-symbolIcon-classForeground)` at 70% opacity
  - End: `var(--vscode-symbolIcon-classForeground)` at 40% opacity
- Border: 1px solid `var(--vscode-symbolIcon-classForeground)`
- Border-radius: 3px
- Position: Absolute (left = startTime _ scale, width = duration _ scale)

**Start Marker** (● dot):

- Shape: Circle (8px diameter)
- Fill: `var(--vscode-symbolIcon-classForeground)`
- Border: 2px solid `var(--vscode-editor-background)` (white outline for visibility)
- Position: Left edge of timeline segment

**End Marker** (● dot):

- Shape: Circle (8px diameter)
- Fill: `var(--vscode-testing-iconPassed)` (green for completion)
- Border: 2px solid `var(--vscode-editor-background)`
- Position: Right edge of timeline segment

**Agent Label Overlay**:

- Position: Inside timeline segment (centered vertically, 8px left margin)
- Icon: 14px × 14px (agent icon from icon system)
- Text: Agent type + duration (e.g., "🔍 Explore (12s)")
- Font: 11px medium
- Color: `var(--vscode-editor-background)` (white text on colored background for contrast)
- Max-width: 90% of segment width (ellipsis truncation)

#### Popover (Hover Details)

**Trigger**: Hover on timeline segment for 300ms

**Popover Design**:

- Position: Above timeline segment, 8px offset
- Background: `var(--vscode-editorWidget-background)`
- Border: 1px solid `var(--vscode-widget-border)`
- Border-radius: 4px
- Padding: 12px
- Box-shadow: None (flat design)
- Z-index: 1000

**Popover Content**:

```
🔍 Explore
────────────────
Start: 0.5s
Duration: 12s
Tools Used:
  • Bash: npm run build
  • Read: package.json
  • Grep: "dependencies"
Status: ✅ Complete
```

**Popover Layout**:

- Agent Icon + Type: 14px icon + 13px semibold text
- Divider: 1px solid `var(--vscode-widget-border)`, 8px margin
- Metadata: 11px regular text, 4px line spacing
- Tools List: Indented 16px, bullet points

#### Parallel Execution Visualization

**Overlapping Timelines**:

- Multiple agents running simultaneously appear on separate tracks
- Tracks auto-assigned based on start time collision detection
- Maximum 10 parallel tracks (safety limit, scroll if exceeded)

**Track Assignment Logic**:

1. Sort agents by start time (ascending)
2. Assign track 1 to first agent
3. For each subsequent agent:
   - Find earliest available track (no time overlap)
   - If all tracks overlap, create new track

#### Scroll Behavior

**Auto-Scroll**:

- When new agent starts: Scroll timeline to show latest activity
- Smooth scroll: 300ms ease-out animation
- Only auto-scroll if user hasn't manually scrolled (preserve user control)

**Manual Scroll**:

- Horizontal scrollbar: Native VS Code scrollbar styling (see styles.css)
- Scroll sensitivity: Standard (no custom acceleration)

#### Animation Specifications

**Timeline Segment Growth** (Real-time):

```css
@keyframes growSegment {
  from {
    width: 0%;
  }
  to {
    width: 100%; /* Final width = duration * scale */
  }
}

.timeline-segment.active {
  animation: growSegment linear; /* Duration = agent execution time */
}
```

**Marker Fade-In**:

```css
@keyframes fadeInMarker {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.timeline-marker {
  animation: fadeInMarker 200ms ease-out;
}
```

#### Click Interaction

**Segment Click**:

- Action: Scroll chat view to corresponding agent start message
- Visual Feedback: 150ms pulse animation (scale 1.02 → 1.0)
- Cursor: pointer on hover

#### Accessibility

**ARIA Labels**:

- Timeline container: `role="region"`, `aria-label="Agent Execution Timeline"`
- Timeline segment: `role="listitem"`, `aria-label="Explore agent, 12 seconds duration, status complete"`
- Popover: `role="tooltip"`

**Keyboard Navigation**:

- Tab: Focus next timeline segment
- Enter: Show popover details
- Arrow Left/Right: Navigate between segments
- Escape: Close popover

---

### Component 3: AgentStatusBadge

**Purpose**: Compact real-time indicator of active agent count in chat header

#### Layout Structure

```
┌─────────────────────────────┐
│  🤖 2 agent(s)  ⚡          │ ← Badge with pulsing animation
└─────────────────────────────┘
```

#### Visual Specifications

**Badge Container**:

- Width: 120px (fixed)
- Height: 24px (fixed)
- Padding: 4px horizontal, 6px vertical
- Background: `var(--vscode-button-background)` (active state)
- Background: `var(--vscode-sideBar-background)` (no agents state)
- Border: 1px solid `var(--vscode-widget-border)`
- Border-radius: 3px
- Cursor: pointer
- Display: inline-flex (center-aligned content)

**Badge States**:

**State 1: No Agents**:

- Icon: 🤖 (16px)
- Text: "No agents"
- Font: 11px medium
- Color: `var(--vscode-descriptionForeground)` (subtle gray)
- Animation: None

**State 2: Active Agents (1)**:

- Icon: 🤖 (16px)
- Text: "1 agent"
- Font: 11px medium
- Color: `var(--vscode-button-foreground)` (white text on blue background)
- Animation: Pulsing (see animation section)

**State 3: Active Agents (2+)**:

- Icon: 🤖 (16px)
- Text: "N agent(s)" (e.g., "3 agent(s)")
- Font: 11px medium
- Color: `var(--vscode-button-foreground)`
- Animation: Pulsing

**State 4: Error State**:

- Icon: 🤖 (16px)
- Error Indicator: 🔴 (10px, positioned top-right as badge overlay)
- Text: "N agent(s)" (e.g., "2 agent(s)")
- Font: 11px medium
- Color: `var(--vscode-errorForeground)` (red text)
- Background: `var(--vscode-sideBar-background)` (no blue, error is prominent)
- Animation: None (no pulsing on error)

#### Pulsing Animation

**Animation Specification**:

```css
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

.agent-status-badge.active {
  animation: pulseAgent 2s ease-in-out infinite;
}
```

**Animation Trigger**:

- Start pulsing when first agent becomes active
- Stop pulsing when all agents complete (fade to "No agents" state)

#### Hover Tooltip

**Trigger**: Hover on badge for 300ms

**Tooltip Design**:

- Position: Below badge, 8px offset
- Background: `var(--vscode-editorWidget-background)`
- Border: 1px solid `var(--vscode-widget-border)`
- Border-radius: 4px
- Padding: 8px
- Max-width: 200px
- Z-index: 1000

**Tooltip Content** (Active Agents List):

```
Active Agents:
• 🔍 Explore (12s)
• 💻 backend-developer (45s)
```

**Tooltip Layout**:

- Header: "Active Agents:" (11px semibold)
- List: Bullet points (11px regular), 4px line spacing
- Agent Icon: 14px
- Agent Type: 11px text
- Duration: `var(--vscode-descriptionForeground)` color in parentheses

**Tooltip for No Agents**:

- Text: "No agents currently active"
- Font: 11px regular
- Color: `var(--vscode-descriptionForeground)`

#### Click Interaction

**Action**: Toggle agent tree panel visibility (expand/collapse sidebar)

**Visual Feedback**:

- Hover: Background `var(--vscode-button-hoverBackground)`
- Active (clicked): 100ms scale pulse (scale 0.95 → 1.0)

#### Fade Animation (Completion)

**When all agents complete**:

```css
@keyframes fadeToInactive {
  from {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    opacity: 1;
  }
  to {
    background: var(--vscode-sideBar-background);
    color: var(--vscode-descriptionForeground);
    opacity: 1;
  }
}

.agent-status-badge.completing {
  animation: fadeToInactive 500ms ease-out forwards;
}
```

#### Error Indicator (Overlay Badge)

**Design**:

- Shape: Circle (10px diameter)
- Position: Absolute, top-right corner of badge (-4px top, -4px right)
- Background: `var(--vscode-errorForeground)` (red)
- Border: 2px solid `var(--vscode-editor-background)` (white outline)
- Content: Text "!" or error count (e.g., "2" for 2 errors)
- Font: 8px bold
- Color: White

#### Accessibility

**ARIA Labels**:

- Badge container: `role="button"`, `aria-label="Agent status: 2 agents active"`
- Badge (no agents): `aria-label="Agent status: No agents active"`
- Badge (error): `aria-label="Agent status: 2 agents active, 1 error"`

**Keyboard Navigation**:

- Tab: Focus badge
- Enter/Space: Toggle agent tree panel
- Focus Indicator: 2px solid `var(--vscode-focusBorder)` outline

---

## Interaction Patterns

### Expand/Collapse Tree Nodes

**Trigger**: Click on agent node or chevron icon

**Animation**:

- Duration: 300ms
- Easing: ease-out
- Property: max-height (0 → auto for expand, auto → 0 for collapse)

**Visual Feedback**:

- Chevron rotation: 0deg → 90deg (150ms)
- Content fade: opacity 0 → 1 (300ms)

### Hover Tooltips

**Delay**: 500ms hover before tooltip appears
**Fade-in**: 150ms opacity 0 → 1
**Positioning**: Auto-adjust if near viewport edge (flip above/below)

**Tooltip Triggers**:

- Agent description (full prompt text)
- Tool activity line (full tool input JSON)
- Timeline segment (agent details)
- Status badge (active agent list)

### Timeline Popover

**Trigger**: Hover on timeline segment for 300ms
**Dismiss**: Mouse leave or Escape key
**Animation**: 200ms fade-in

### Status Badge Click

**Action**: Toggle agent tree panel visibility

**Panel Animation**:

- Slide-in from right: 250ms ease-out
- Width: 350px (or 30% of viewport width)
- Overlay: Semi-transparent backdrop `rgba(0,0,0,0.3)` (click to dismiss)

### Keyboard Navigation

**Global Keyboard Shortcuts**:

- `Ctrl/Cmd + Shift + A`: Toggle agent tree panel
- `Ctrl/Cmd + Shift + T`: Toggle timeline view

**Focus Management**:

- Trap focus within modal tooltips/popovers
- Return focus to trigger element on dismiss
- Sequential tab order: Agent nodes → Tool activities → Timeline segments → Badge

### Loading States

**Agent Starting**:

- Show agent node with animated ellipsis in description ("Starting...")
- Duration badge: Empty (no duration yet)
- Animation: 1.5s ellipsis pulse

**Agent Running**:

- Duration updates every second (live timer)
- Tool activities appear incrementally (fade-in animation)

**Agent Completing**:

- Final duration freezes
- Status badge changes to ✅
- 500ms fade animation if all agents complete

### Error Handling UI

**Error Messages**:

- Display below agent description in agent tree
- Font: 11px regular
- Color: `var(--vscode-errorForeground)`
- Icon: 🔴 (10px)
- Max-width: 100% (wrap long error messages)

**Retry UI** (future enhancement):

- Show "Retry" button below error message
- Button: 11px, `var(--vscode-button-background)`

---

## Component Integration Layout

### Chat Component Layout with Agent Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│ Chat Header                                   [🤖 2 agent(s) ⚡] │ ← Status badge in header
├─────────────────────────────────────────────────────────────────┤
│ Messages                                    │ Agent Tree        │
│ • User: "Build auth system"                │ ▼ 🔍 Explore      │
│ • Assistant: "I'll delegate to..."         │    ├─ Bash: ls    │
│                                             │    └─ Read: pkg   │
│                                             │ ▶ 💻 Backend      │
│                                             │                   │
│                                             │ Timeline          │
│                                             │ ●────────● 🔍     │
│                                             │    ●──────● 💻    │
├─────────────────────────────────────────────┴───────────────────┤
│ Input Area: Type your message...                                │
└─────────────────────────────────────────────────────────────────┘
```

**Layout Specifications**:

- Agent Tree Panel: 350px width (30% of viewport), collapsible
- Timeline View: Below agent tree, 200px height (expandable)
- Splitter: Draggable resize handle between messages and agent panel

**Responsive Behavior**:

- If viewport < 800px width: Agent panel becomes overlay modal (click badge to show)
- If viewport > 1200px width: Agent panel always visible

---

## Design Assets Export Specifications

### Asset File Naming Convention

**Agent Icons** (16 files):

- Format: `agent-icon-[agent-type].svg` (using lucide-angular, no custom SVG needed)
- Example: `agent-icon-frontend-developer.svg`

**Component Screenshots** (for documentation):

- `agent-tree-expanded.png` (1200x800, 2x resolution)
- `agent-tree-collapsed.png` (1200x800)
- `agent-timeline-parallel.png` (1200x400)
- `agent-status-badge-active.png` (120x24, 4x resolution for clarity)
- `agent-status-badge-error.png` (120x24)

### Technical Specifications

**SVG Export** (not needed, using lucide-angular library):

- ViewBox: 0 0 16 16
- Stroke Width: 2px
- Fill: None (stroke-only icons)
- Color: CurrentColor (inherits from CSS)

**PNG Export** (for mockups/documentation):

- Format: PNG with transparency
- Resolution: 2x (Retina)
- Color Profile: sRGB

---

## Accessibility Requirements

### WCAG 2.1 AA Compliance

**Color Contrast Validation**:

- All text on background: 4.5:1 minimum (guaranteed by VS Code variables)
- Status badge active text: 4.5:1 (white on blue)
- Error text: 4.5:1 (red on background)

**Minimum Touch Targets**:

- Agent tree node: 32px height (exceeds 24px minimum)
- Status badge: 24px height (meets minimum)
- Timeline segment: 24px height (meets minimum)
- Chevron icon: 16px click target (acceptable for desktop, not mobile)

**Typography Minimum Sizes**:

- Body text: 11px (below 16px ideal, but acceptable for dense UI)
- Labels: 11px (acceptable for secondary information)

### Keyboard Navigation Support

**Tab Order**:

1. Status badge (header)
2. Agent tree nodes (chronological order)
3. Tool activity lines (nested under parent agent)
4. Timeline segments (left to right)

**Focus Indicators**:

- All interactive elements: 2px solid `var(--vscode-focusBorder)` outline
- Focus offset: 2px (clear separation from element)

**Keyboard Shortcuts**:

- Enter/Space: Activate focused element (expand/collapse, show tooltip)
- Arrow keys: Navigate tree hierarchy, timeline segments
- Escape: Close tooltips/popovers
- Tab: Sequential navigation
- Shift+Tab: Reverse navigation

### Screen Reader Compatibility

**ARIA Roles**:

- Agent tree: `role="tree"`, `aria-label="Agent execution tree"`
- Agent node: `role="treeitem"`, `aria-expanded="true|false"`, `aria-level="1"`
- Tool activity: `role="treeitem"`, `aria-level="2"`
- Timeline: `role="region"`, `aria-label="Agent execution timeline"`
- Timeline segment: `role="listitem"`
- Status badge: `role="button"`

**ARIA Labels**:

- Agent node: "Explore agent, status running, duration 12 seconds"
- Tool activity: "Bash tool executed: npm run build"
- Timeline segment: "Explore agent, started at 0 seconds, duration 12 seconds, status complete"
- Status badge: "2 agents active, click to toggle agent tree panel"

**Live Regions** (for real-time updates):

- Agent tree: `aria-live="polite"`, `aria-atomic="false"` (announce new agents)
- Status badge: `aria-live="polite"` (announce agent count changes)

---

## Animation & Transition Specifications

### Animation Principles

**Performance First**:

- GPU-accelerated properties only (transform, opacity)
- Avoid animating width/height (use max-height with overflow:hidden)
- 60fps target (16.67ms frame budget)

**Accessibility**:

- Respect `prefers-reduced-motion` media query (disable/reduce animations)
- Maximum duration: 500ms (shorter durations for frequent actions)

### Animation Catalog

**1. Tree Node Expand/Collapse**:

```css
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
/* Duration: 300ms, Easing: ease-out */
```

**2. Chevron Rotation**:

```css
.chevron {
  transition: transform 150ms ease-out;
}
.chevron.expanded {
  transform: rotate(90deg);
}
```

**3. Agent Status Badge Pulse**:

```css
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
/* Duration: 2000ms, Easing: ease-in-out, Iteration: infinite */
```

**4. Badge Fade to Inactive**:

```css
@keyframes fadeToInactive {
  from {
    background: var(--vscode-button-background);
  }
  to {
    background: var(--vscode-sideBar-background);
  }
}
/* Duration: 500ms, Easing: ease-out */
```

**5. Timeline Segment Growth**:

```css
@keyframes growSegment {
  from {
    width: 0%;
  }
  to {
    width: 100%;
  }
}
/* Duration: Variable (agent execution time), Easing: linear */
```

**6. Tooltip Fade-In**:

```css
@keyframes fadeInTooltip {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* Duration: 150ms, Easing: ease-out */
```

**7. Agent Tree Panel Slide-In**:

```css
@keyframes slideInPanel {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
/* Duration: 250ms, Easing: ease-out */
```

**8. Loading Ellipsis**:

```css
@keyframes ellipsis {
  0% {
    content: '';
  }
  33% {
    content: '.';
  }
  66% {
    content: '..';
  }
  100% {
    content: '...';
  }
}
/* Duration: 1500ms, Easing: steps(4), Iteration: infinite */
```

### Reduced Motion Override

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Developer Handoff Summary

### Implementation Checklist

**Phase 1: Icon System**:

- [ ] Import lucide-angular icons (16 types from icon table)
- [ ] Create `agentIconMap` in shared constants
- [ ] Test icon rendering at 16px × 16px size
- [ ] Verify semantic colors for each agent type

**Phase 2: AgentTreeComponent**:

- [ ] Create component with signal-based state
- [ ] Implement collapsible tree nodes (chevron + animation)
- [ ] Add tool activity lines with indentation
- [ ] Implement hover tooltips (full prompt text)
- [ ] Add keyboard navigation (Tab, Arrow keys, Enter)
- [ ] Test expand/collapse animation (300ms ease-out)

**Phase 3: AgentTimelineComponent**:

- [ ] Create swimlane layout (40px tracks, 8px gap)
- [ ] Implement timeline scale (2px per second)
- [ ] Add timeline segment rendering (gradient background)
- [ ] Implement popover on hover (agent details)
- [ ] Add auto-scroll to latest activity
- [ ] Test timeline segment growth animation

**Phase 4: AgentStatusBadge**:

- [ ] Create compact badge (120px × 24px)
- [ ] Implement pulsing animation (2s loop)
- [ ] Add hover tooltip (active agent list)
- [ ] Implement click to toggle agent tree panel
- [ ] Add error indicator overlay (red badge)
- [ ] Test fade animation on completion (500ms)

**Phase 5: Integration**:

- [ ] Add status badge to ChatHeaderComponent
- [ ] Create agent tree panel (collapsible sidebar)
- [ ] Add timeline view below agent tree
- [ ] Implement panel resize handle
- [ ] Test responsive behavior (overlay on narrow viewports)

**Phase 6: Accessibility**:

- [ ] Add ARIA labels to all interactive elements
- [ ] Implement keyboard shortcuts (Ctrl+Shift+A, etc.)
- [ ] Test screen reader compatibility (NVDA/JAWS)
- [ ] Verify focus indicators (2px blue outline)
- [ ] Test with `prefers-reduced-motion` enabled

### Testing Criteria

**Visual Regression Testing**:

- [ ] Screenshot comparison for all component states
- [ ] Test light/dark/high-contrast themes
- [ ] Verify animations run at 60fps (Chrome DevTools Performance)

**Accessibility Testing**:

- [ ] Axe DevTools audit (0 violations)
- [ ] Keyboard navigation test (Tab, Arrow keys, Enter, Escape)
- [ ] Screen reader test (announce agent state changes)
- [ ] Color contrast test (4.5:1 minimum)

**Functional Testing**:

- [ ] Agent tree expands/collapses correctly
- [ ] Tool activities appear incrementally
- [ ] Timeline segments grow in real-time
- [ ] Status badge pulses when agents active
- [ ] Tooltips/popovers display correct data
- [ ] Error states render correctly

---

## Conclusion

This visual design specification provides complete implementation details for all 3 agent visualization components (AgentTreeComponent, AgentTimelineComponent, AgentStatusBadge) and 16 agent icons. All designs:

- **Follow VS Code design system** (100% CSS variables, no custom colors)
- **Meet WCAG 2.1 AA standards** (4.5:1 contrast ratios guaranteed)
- **Support keyboard navigation** (Tab, Arrow keys, Enter, Escape)
- **Include screen reader labels** (ARIA roles and labels)
- **Provide smooth animations** (60fps, GPU-accelerated, respects prefers-reduced-motion)
- **Integrate seamlessly** with existing Ptah chat interface

All specifications are implementation-ready for frontend-developer without additional design decisions required.

---

**Next Steps**: Delegate to **frontend-developer** with this specification document + design-assets-inventory.md + design-handoff.md for implementation.
