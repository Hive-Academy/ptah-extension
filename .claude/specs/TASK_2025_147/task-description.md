# Requirements Document - TASK_2025_147

## Setup Wizard UI Enhancement: Markdown Rendering, Stats Dashboard, and DaisyUI Polish

---

## Introduction

The Ptah Extension setup wizard is a 6-step interactive flow that analyzes a user's workspace using an agentic Claude SDK session and generates customized agent rules. While the backend streaming pipeline works correctly (agentic analysis with 4 phases, RPC communication with 1-hour timeout, AnalysisStreamPayload broadcasting), the frontend presentation layer has significant deficiencies that undermine user confidence and professional quality.

The core problem is a rendering gap: the `AnalysisTranscriptComponent` displays raw text and unformatted JSON while the chat library's equivalent components (`markdown-block`, `tool-input-display`, `tool-output-display`) deliver rich markdown rendering with syntax highlighting. This task modernizes the wizard's presentation across three sequential phases -- fixing markdown rendering (critical), adding a real-time stats dashboard (high priority), and applying DaisyUI visual polish (medium priority).

**Business Value**: The setup wizard is the first experience users have with Ptah Extension's premium features. A polished, professional wizard directly impacts user perception of product quality, trust in AI analysis, and conversion from trial to subscription.

---

## Phase 1: Fix Markdown Rendering in Analysis Transcript

### Requirement 1.1: Integrate NGX Markdown into Analysis Transcript

**User Story:** As a user running workspace analysis, I want the agent transcript to render markdown content with syntax highlighting, so that I can read analysis output as clearly as the chat view presents it.

#### Acceptance Criteria

1. WHEN the `AnalysisTranscriptComponent` renders a text message (`kind: 'text'`) THEN the content SHALL be rendered through `ngx-markdown` with `prose prose-sm prose-invert max-w-none` styling, matching the `MarkdownBlockComponent` atom from the chat library.

2. WHEN consecutive text messages are merged into a single `GroupedMessage` THEN the merged content SHALL render as a single markdown block without fragmentation artifacts or double-spacing between merged segments.

3. WHEN the component is initialized THEN `MarkdownModule` from `ngx-markdown` SHALL be present in the `imports` array of the standalone component decorator.

4. WHEN any markdown content contains code blocks (fenced with triple backticks) THEN syntax highlighting SHALL be applied via PrismJS, consistent with the chat library's rendering.

5. WHEN markdown content contains inline code, bold, italic, lists, or headers THEN all markdown formatting SHALL render correctly with appropriate prose styling.

#### Technical Context (from codebase investigation)

- **Current state**: `AnalysisTranscriptComponent` (line 69) imports only `LucideAngularModule`. Text content is rendered as `{{ item.content }}` inside a `<p>` tag with `font-mono whitespace-pre-wrap` classes (lines 109-115).
- **Reference implementation**: `MarkdownBlockComponent` at `libs/frontend/chat/src/lib/components/atoms/markdown-block.component.ts` imports `MarkdownModule` and uses `<markdown [data]="content()" class="prose prose-sm prose-invert max-w-none" />`.
- **Key constraint**: The setup-wizard library currently has zero `MarkdownModule` imports (verified via grep). This is the first NGX Markdown integration in the wizard library.
- **Dependency**: `ngx-markdown` 21.0 is already installed in the workspace (used by chat library). No new dependency installation required.

---

### Requirement 1.2: Implement Formatted Tool Input Display with Language Detection

**User Story:** As a user observing tool calls during analysis, I want tool inputs to display with syntax highlighting and language-appropriate formatting, so that I can understand what files and parameters the agent is examining.

#### Acceptance Criteria

1. WHEN a `tool_input` message is displayed THEN the content SHALL be parsed as JSON and rendered with syntax-highlighted code blocks using `ngx-markdown` fenced code blocks.

2. WHEN the tool input contains a `file_path` or similar path-like parameter THEN the language SHALL be auto-detected from the file extension using a language map consistent with `ToolInputDisplayComponent` (supporting .ts, .tsx, .js, .json, .html, .css, .scss, .py, .java, .go, .rs, .md, .yaml, .xml, .sql, .sh at minimum).

3. WHEN the tool input JSON exceeds 500 characters THEN it SHALL display a truncated preview with a "Show more"/"Show less" toggle, preserving the existing truncation behavior.

4. WHEN tool input is expanded THEN the full content SHALL render inside a scrollable container with `max-h-40 overflow-y-auto` constraints.

5. WHEN a `getFormattedToolInput()` method is called THEN it SHALL return markdown-formatted content with appropriate language detection and code block wrapping.

#### Technical Context

- **Current state**: Tool inputs display as raw JSON via `<pre>{{ getToolInputContent(item) }}</pre>` (line 153-155). No syntax highlighting, no language detection.
- **Reference implementation**: `ToolInputDisplayComponent` in chat library has a `languageMap` (lines 120-141) and `getFormattedParamContent()` method (lines 217-240) that wraps content in language-specific fenced code blocks.
- **Pattern to follow**: Extract the language detection logic pattern from chat's `ToolInputDisplayComponent` but adapt it for the `GroupedMessage` interface rather than `ExecutionNode` interface.

---

### Requirement 1.3: Implement Formatted Tool Result Display

**User Story:** As a user reviewing analysis results, I want tool results to render with proper markdown formatting rather than truncated plain text, so that I can see the full context of what the agent discovered.

#### Acceptance Criteria

1. WHEN a `tool_result` message is displayed THEN the content SHALL be rendered through `ngx-markdown` with appropriate prose styling.

2. WHEN the tool result contains file content (code, configuration, etc.) THEN it SHALL render with syntax highlighting in a scrollable code block.

3. WHEN the tool result indicates an error (`isError: true`) THEN it SHALL display with error styling (red text, error icon) AND the error content SHALL still be markdown-rendered for readability.

4. WHEN tool result content exceeds a reasonable display height THEN it SHALL be contained within a scrollable area (max-height constraint) to prevent the transcript from becoming excessively long.

5. WHEN the tool result is non-error THEN the success indicator (green icon) SHALL remain alongside the markdown-rendered content.

#### Technical Context

- **Current state**: Tool results display as a single-line `<span class="text-xs">{{ item.toolName || 'tool' }}: {{ item.content }}</span>` (lines 183-185). Long results are simply cut off by the container.
- **Reference implementation**: Chat's `ToolOutputDisplayComponent` routes to specialized display components (`TodoListDisplayComponent`, `DiffDisplayComponent`, `CodeOutputComponent`). For the wizard transcript, a simpler approach using inline markdown rendering is appropriate since the transcript handles a flat message stream rather than structured `ExecutionNode` trees.

---

### Requirement 1.4: Implement Collapsible Tool Call Sections

**User Story:** As a user monitoring a long-running analysis, I want tool call sequences (start, input, result) to be visually grouped with collapsible sections, so that I can focus on the most relevant parts of the transcript.

#### Acceptance Criteria

1. WHEN a `tool_start` message appears followed by `tool_input` and `tool_result` messages with the same `toolCallId` THEN they SHALL be visually grouped as a single tool call block.

2. WHEN a tool call block is rendered THEN it SHALL display a header showing the tool name with a collapse/expand toggle, defaulting to collapsed for completed tool calls.

3. WHEN a tool call is currently in progress (has `tool_start` and `tool_input` but no `tool_result` yet) THEN it SHALL default to expanded so the user can see what is happening.

4. WHEN the user clicks the tool call header THEN the input and result sections SHALL toggle between expanded and collapsed states.

5. WHEN a tool call header is displayed THEN it SHALL include a visual indicator (badge) showing the tool status: "running" (info badge, animated), "completed" (success badge), or "error" (error badge).

#### Technical Context

- **Current state**: Tool start, input, and result are rendered as separate items in the transcript with no visual grouping (lines 117-185). Each message type has its own rendering block inside the `@switch (item.kind)` control flow.
- **Reference implementation**: Chat's `ToolCallItemComponent` provides a clean composition pattern with `ToolCallHeaderComponent` header and collapsible content below it. The wizard can implement a lighter version that groups by `toolCallId` in the `groupedMessages` computed signal.
- **Implementation note**: The `GroupedMessage` interface already includes `toolCallId` (line 36) for correlation. The grouping logic should be enhanced in the `groupedMessages` computed signal to create tool call groups.

---

### Requirement 1.5: Fix "0 of 0 Files" Display Bug

**User Story:** As a user watching workspace analysis progress, I want to see accurate progress information rather than "0 of 0 files", so that I understand the analysis is making progress.

#### Acceptance Criteria

1. WHEN the `scanProgress` signal contains `currentPhase` (indicating agentic analysis mode) THEN the file count progress bar SHALL NOT be displayed, since agentic analysis does not use file counting.

2. WHEN agentic analysis is active THEN the UI SHALL display the current phase label, phase stepper, and agent transcript instead of the legacy file progress bar.

3. WHEN `scanProgress.totalFiles` is 0 AND `scanProgress.currentPhase` is defined THEN the component SHALL NOT render "Analyzing 0 of 0 files..." text.

4. WHEN neither agentic analysis fields nor file counts are populated THEN a loading spinner with "Initializing analysis..." text SHALL be displayed as fallback.

#### Technical Context

- **Current state**: `ScanProgressComponent` shows the file count progress bar (lines 121-146) when `progressData.currentPhase` is falsy. However, during agentic analysis, the initial messages may arrive before `currentPhase` is set, causing a brief display of "Analyzing 0 of 0 files...".
- **Root cause**: The `@if (progressData.currentPhase)` check (line 85) falls through to the `@else` block (lines 120-146) during the initial phase before the first `scan-progress` message with `currentPhase` arrives.
- **Fix approach**: Add a guard condition that checks both `currentPhase` and whether valid file counts exist before showing the file progress bar.

---

## Phase 2: Add Real-Time Stats Dashboard

### Requirement 2.1: Create Analysis Stats Dashboard Component

**User Story:** As a user running workspace analysis, I want to see real-time statistics about the analysis progress (token usage, cost, phase timing), so that I understand resource consumption and analysis depth.

#### Acceptance Criteria

1. WHEN the analysis is running THEN a stats dashboard SHALL be visible within the `ScanProgressComponent` view, positioned between the phase stepper and the agent transcript.

2. WHEN the dashboard renders THEN it SHALL display the following metric cards using DaisyUI `stat` components:

   - Messages processed (count from `analysisStream` signal length)
   - Tool calls executed (count of `tool_start` kind messages)
   - Current phase name and progress (from `scanProgress` signal)
   - Elapsed time since analysis started

3. WHEN a new `AnalysisStreamPayload` message arrives THEN the dashboard metrics SHALL update reactively through computed signals without manual refresh.

4. WHEN the analysis completes THEN the dashboard SHALL show final totals with a "completed" visual state.

5. WHEN the dashboard is displayed THEN all metric values SHALL be formatted appropriately (numbers with comma separators, time in MM:SS format).

#### Technical Context

- **State service signals available** (from `SetupWizardStateService`):
  - `analysisStream(): AnalysisStreamPayload[]` -- full stream of messages
  - `scanProgress(): ScanProgress | null` -- current phase, completed phases
  - `deepAnalysis(): ProjectAnalysisResult | null` -- available after completion
- **Architecture pattern**: Follow the dashboard library's `MetricsOverviewComponent` pattern using DaisyUI stat cards with computed signals for metric derivation.
- **File location**: New component at `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts`
- **No new services needed**: All data is derivable from existing `SetupWizardStateService` signals via computed signals in the component.

---

### Requirement 2.2: Implement Phase Progress Visualization

**User Story:** As a user watching the analysis stepper, I want each phase to display its completion percentage and timing information, so that I can estimate how long the remaining analysis will take.

#### Acceptance Criteria

1. WHEN a phase is currently active THEN it SHALL display an animated indicator (pulse or spinner) alongside the phase label.

2. WHEN a phase completes THEN it SHALL display a completion checkmark and the time elapsed for that phase.

3. WHEN the `completedPhases` array updates in the `scanProgress` signal THEN the phase stepper SHALL reactively update completed phases with success styling.

4. WHEN all 4 phases (discovery, architecture, health, quality) are complete THEN the stepper SHALL show 100% completion with all phases checked.

5. WHEN a phase transitions from active to complete THEN the transition SHALL include a smooth CSS animation (fade or slide) for visual feedback.

#### Technical Context

- **Current state**: The phase stepper in `ScanProgressComponent` (lines 87-105) uses DaisyUI `steps` classes with `step-primary` toggled by `isPhaseCompleteOrCurrent()` method. No timing or percentage is displayed.
- **Available data**: `scanProgress.currentPhase`, `scanProgress.completedPhases`, `scanProgress.phaseLabel` are all available from the state service.
- **Enhancement approach**: Add timing tracking by recording when each phase starts (timestamp from first message of that phase) and calculating elapsed time. This can be done in a component-local computed signal without modifying the state service.

---

### Requirement 2.3: Implement Message Stream Analytics

**User Story:** As a user, I want to see a breakdown of message types in the analysis stream (text messages vs tool calls vs thinking), so that I understand the agent's analysis behavior.

#### Acceptance Criteria

1. WHEN the analysis is running THEN a message type breakdown SHALL be displayed showing counts for: text messages, tool calls (start+input+result grouped), thinking blocks, and errors.

2. WHEN the counts update THEN the display SHALL use DaisyUI badge components with appropriate color coding: info for text, primary for tools, secondary for thinking, error for errors.

3. WHEN the message breakdown is rendered THEN it SHALL be compact (horizontal layout using flexbox with gap) to not consume excessive vertical space.

4. WHEN the analysis stream is empty THEN the breakdown section SHALL be hidden.

5. WHEN tool calls are counted THEN only `tool_start` messages SHALL be counted (not input+result separately) to represent the actual number of tool invocations.

#### Technical Context

- **Data source**: `analysisStream()` signal from `SetupWizardStateService` contains all `AnalysisStreamPayload` messages with `kind` discriminator.
- **Computation approach**: A computed signal in the dashboard component can derive message counts by filtering the stream by `kind`:
  ```
  textCount = stream.filter(m => m.kind === 'text').length
  toolCount = stream.filter(m => m.kind === 'tool_start').length
  thinkingCount = stream.filter(m => m.kind === 'thinking').length
  errorCount = stream.filter(m => m.kind === 'error').length
  ```

---

### Requirement 2.4: Integrate Dashboard into Scan Progress View

**User Story:** As a user, I want the stats dashboard to integrate seamlessly into the existing scan progress view without disrupting the current layout or causing layout shifts, so that I can see both progress and metrics at a glance.

#### Acceptance Criteria

1. WHEN the `ScanProgressComponent` renders THEN the `AnalysisStatsDashboardComponent` SHALL be imported and placed between the phase stepper section and the agent transcript section.

2. WHEN the dashboard component is integrated THEN it SHALL be wrapped in a conditional block that only renders when `hasStreamMessages()` is true (same condition as the transcript).

3. WHEN the dashboard renders THEN it SHALL maintain a maximum width consistent with the parent container (`max-w-3xl`) and use responsive grid layout for metric cards.

4. WHEN the page loads THEN the dashboard SHALL not cause cumulative layout shift (CLS); it should either be pre-allocated space or smoothly animate in.

5. WHEN the dashboard and transcript are both visible THEN the vertical space allocation SHALL prioritize the transcript (dashboard compact, transcript scrollable with `max-h-64`).

#### Technical Context

- **Integration point**: `ScanProgressComponent` template (lines 148-162) currently has a conditional block `@if (hasStreamMessages())` that shows the transcript. The dashboard should be placed before the transcript within this conditional block.
- **Import addition**: Add `AnalysisStatsDashboardComponent` to the `imports` array of `ScanProgressComponent` (line 63).
- **Layout constraint**: The parent container is `max-w-3xl` (line 70). Dashboard metric cards should use a responsive grid: `grid grid-cols-2 md:grid-cols-4 gap-3`.

---

## Phase 3: DaisyUI Visual Enhancements

### Requirement 3.1: Add Hero Section with Gradient Background to Welcome

**User Story:** As a user arriving at the setup wizard, I want a visually striking welcome screen with gradient backgrounds and modern styling, so that the wizard feels premium and professional.

#### Acceptance Criteria

1. WHEN the welcome screen renders THEN the hero section SHALL have a gradient background using CSS gradients applied via Tailwind classes (e.g., `bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10`).

2. WHEN the hero content renders THEN the title SHALL use a gradient text effect using `bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent` classes.

3. WHEN the "Start Setup" button renders THEN it SHALL have enhanced styling with a shadow and hover animation: `btn btn-primary btn-lg shadow-lg hover:shadow-xl transition-all duration-300`.

4. WHEN the welcome screen loads THEN a subtle fade-in animation SHALL be applied to the hero content using CSS animation or Tailwind's `animate-` classes.

5. WHEN the welcome screen is displayed THEN feature bullets SHALL be presented in DaisyUI card components with icons, arranged in a responsive grid.

#### Technical Context

- **Current state**: `WelcomeComponent` (line 30) uses `hero min-h-screen bg-base-200` with plain text styling. No gradients, no animations, no feature cards.
- **DaisyUI available classes**: hero, card, card-body, btn with variants, badge, shadow utilities.
- **Tailwind gradient utilities**: `bg-gradient-to-*`, `from-*`, `via-*`, `to-*` with color opacity modifiers.
- **Icon library**: Lucide Angular is available (used throughout the wizard) for feature bullet icons.

---

### Requirement 3.2: Add Gradient Cards for Analysis Phase Display

**User Story:** As a user viewing the phase stepper during analysis, I want each phase to be displayed in visually distinct gradient cards, so that the analysis progress feels dynamic and engaging.

#### Acceptance Criteria

1. WHEN the phase stepper renders THEN each phase step SHALL be displayed as a card with a gradient border effect using DaisyUI card and Tailwind gradient utilities.

2. WHEN a phase is active THEN its card SHALL have a highlighted gradient border (primary to secondary), an animated pulse indicator, and elevated shadow.

3. WHEN a phase is completed THEN its card SHALL show a success gradient (from-success/10 to-success/5) with a checkmark overlay.

4. WHEN a phase is pending THEN its card SHALL display in muted/desaturated styling with reduced opacity.

5. WHEN the phase transitions from active to completed THEN the card SHALL animate the transition using CSS transitions (color shift + checkmark appear).

#### Technical Context

- **Current state**: Phase stepper uses DaisyUI `steps steps-horizontal` with `step-primary` toggling (lines 87-105). This is functional but visually basic.
- **Enhancement approach**: Replace the `<ul class="steps">` list with a responsive card grid (`grid grid-cols-2 md:grid-cols-4 gap-4`). Each phase becomes a mini-card with gradient styling.
- **Animation approach**: Use Tailwind `transition-all duration-500` for state changes and `animate-pulse` for active phase indicator.

---

### Requirement 3.3: Add Badge System for Status Indicators

**User Story:** As a user monitoring the wizard, I want consistent badge-based status indicators across all wizard components, so that I can quickly understand the state of each element.

#### Acceptance Criteria

1. WHEN a phase status is displayed THEN it SHALL use a DaisyUI badge with appropriate variant: `badge-info` for active, `badge-success` for completed, `badge-ghost` for pending, `badge-error` for failed.

2. WHEN the agent transcript header shows message count THEN it SHALL use `badge badge-primary badge-sm` styling for the count indicator.

3. WHEN tool call status is displayed in the transcript THEN badges SHALL indicate: `badge-info badge-outline` for running, `badge-success badge-outline` for completed, `badge-error badge-outline` for error.

4. WHEN the stats dashboard displays metric categories THEN each category SHALL have a labeled badge for clear identification.

5. WHEN badges are used THEN they SHALL maintain consistent sizing (`badge-sm` for inline, `badge-md` for standalone) across all wizard components.

#### Technical Context

- **Current usage**: The transcript already uses some badges (line 88 `badge badge-sm badge-ghost` for count, line 123 `badge badge-sm badge-info badge-outline` for tool names). The enhancement standardizes and expands badge usage.
- **DaisyUI badge variants**: `badge-primary`, `badge-secondary`, `badge-accent`, `badge-info`, `badge-success`, `badge-warning`, `badge-error`, `badge-ghost`, `badge-outline`.

---

### Requirement 3.4: Add Loading Skeleton States

**User Story:** As a user waiting for data to load in the wizard, I want to see skeleton loading placeholders instead of empty space or spinners, so that I understand the layout that will appear and perceive faster loading.

#### Acceptance Criteria

1. WHEN the analysis results are loading (deepAnalysis signal is null) THEN the analysis-results page SHALL display skeleton card placeholders matching the final layout structure.

2. WHEN the stats dashboard is loading its initial data THEN metric cards SHALL display skeleton text placeholders with DaisyUI's `skeleton` class.

3. WHEN the agent transcript is waiting for first message THEN it SHALL display 3-4 skeleton text lines inside the transcript container instead of "Waiting for agent messages..." text.

4. WHEN skeleton states render THEN they SHALL use DaisyUI skeleton utilities: `skeleton h-4 w-full`, `skeleton h-4 w-3/4`, `skeleton h-8 w-32` for varied visual interest.

5. WHEN data arrives THEN the skeleton SHALL be replaced by actual content with a smooth transition (no layout jump).

#### Technical Context

- **DaisyUI skeleton**: `<div class="skeleton h-4 w-full"></div>` provides animated placeholder bars.
- **Current loading state**: Transcript shows "Waiting for agent messages..." (line 215-217). Analysis results shows a spinner (lines 209-213). These should be replaced with skeleton layouts.
- **Implementation pattern**: Use Angular's `@if` / `@else` control flow with skeleton templates in the else block.

---

### Requirement 3.5: Add Smooth Transitions and Animations

**User Story:** As a user navigating through wizard steps, I want smooth transitions between steps and animated element appearances, so that the wizard feels responsive and polished.

#### Acceptance Criteria

1. WHEN a wizard step changes THEN the content area SHALL animate with a fade or slide transition (CSS `transition` or `@angular/animations`).

2. WHEN new tool calls appear in the transcript THEN they SHALL slide in from the bottom with a subtle animation rather than appearing instantly.

3. WHEN the stats dashboard metrics update THEN the number changes SHALL animate (counter increment effect or fade transition).

4. WHEN the analysis completes and transitions to the results step THEN a success animation SHALL play (e.g., checkmark animation or confetti-like celebration).

5. WHEN interactive elements are hovered THEN they SHALL have consistent hover transitions: `transition-colors duration-200` for color changes, `transition-transform duration-200` for scale effects.

#### Technical Context

- **Available animation tooling**:
  - Tailwind `transition-*` utilities (preferred for simple state changes)
  - CSS `@keyframes` for custom animations
  - GSAP 3.14 is installed in the workspace (`@hive-academy/angular-gsap 1.1`) but may be heavy for the wizard; Tailwind transitions are preferred for simplicity
- **Zoneless Angular consideration**: Animations must work with zoneless change detection. CSS-based animations (Tailwind) are inherently compatible since they don't require Zone.js. Angular `@angular/animations` also works with zoneless.
- **Current state**: No animations exist in any wizard component currently.

---

## Non-Functional Requirements

### Performance Requirements

- **Markdown Rendering**: 95% of markdown blocks SHALL render within 50ms, 99% within 100ms. The `ngx-markdown` library with PrismJS is already proven performant in the chat library.
- **Signal Computation**: All computed signals (message grouping, metric derivation) SHALL complete within 16ms (single animation frame) to maintain 60fps UI updates.
- **Memory**: The analysis stream accumulator SHALL not cause memory pressure for transcripts up to 2,000 messages. Beyond this, a rolling window or virtualization strategy should be considered.
- **Bundle Impact**: Phase 1 changes SHALL add no more than 5KB to the wizard chunk (MarkdownModule is already tree-shaken into the chat chunk; shared chunking should apply).

### Accessibility Requirements

- **ARIA Labels**: All interactive elements (collapse toggles, buttons, badges) SHALL have descriptive `aria-label` attributes.
- **Keyboard Navigation**: All collapsible sections SHALL be operable via keyboard (Enter/Space to toggle).
- **Screen Reader**: Markdown content SHALL be accessible to screen readers (ngx-markdown renders semantic HTML).
- **Color Contrast**: All gradient text and badge colors SHALL meet WCAG 2.1 AA contrast ratios (4.5:1 for normal text, 3:1 for large text).
- **Motion Sensitivity**: CSS animations SHALL respect `prefers-reduced-motion` media query by disabling or reducing animations.

### Scalability Requirements

- **Message Volume**: The transcript and dashboard SHALL handle analysis sessions producing up to 2,000 stream messages without UI degradation.
- **Phase Extensibility**: The phase stepper and dashboard SHALL support adding new analysis phases (beyond the current 4) without code changes to the display components.

### Reliability Requirements

- **Error Recovery**: If markdown rendering fails for a specific message, the component SHALL fall back to plain text display rather than crashing.
- **Signal Safety**: All computed signals SHALL handle null/undefined state gracefully (empty arrays, null objects) without throwing.
- **Backend Contract**: No changes to `AnalysisStreamPayload`, `ScanProgressPayload`, or any shared types SHALL be required. All enhancements are purely frontend.

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder         | Impact Level | Involvement             | Success Criteria                                                           |
| ------------------- | ------------ | ----------------------- | -------------------------------------------------------------------------- |
| End Users (Premium) | High         | Testing/Feedback        | Wizard feels professional; transcript is readable; metrics are informative |
| Product Owner       | High         | Requirements Validation | All 3 phases delivered; user confidence measurably improved                |
| Frontend Developer  | High         | Implementation          | Clear requirements; existing patterns to follow; no backend changes needed |

### Secondary Stakeholders

| Stakeholder  | Impact Level | Involvement               | Success Criteria                                                           |
| ------------ | ------------ | ------------------------- | -------------------------------------------------------------------------- |
| Backend Team | Low          | None (no backend changes) | No shared type modifications; no API contract changes                      |
| QA/Tester    | Medium       | Validation                | All acceptance criteria verifiable; no regressions in existing wizard flow |
| UX Designer  | Medium       | Review                    | Visual consistency with chat library; DaisyUI usage follows design system  |

---

## Risk Assessment

| Risk                                                          | Probability | Impact | Score | Mitigation Strategy                                                                                                                       |
| ------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| NGX Markdown import increases bundle size for wizard chunk    | Medium      | Medium | 6     | Verify shared chunking with chat library; measure bundle before/after; use lazy loading if needed                                         |
| Markdown rendering performance degrades with long transcripts | Low         | High   | 4     | Use OnPush change detection (already in place); test with 1000+ message transcripts; implement virtual scrolling if needed                |
| Tool call grouping logic complexity in computed signal        | Medium      | Medium | 6     | Keep grouping logic simple (correlate by toolCallId); write unit tests for grouping edge cases (orphaned tool_start, missing tool_result) |
| Phase 3 animations cause layout shift (CLS)                   | Medium      | Low    | 3     | Use CSS transforms and opacity (GPU-accelerated); avoid height/width animations that cause reflow; test with Lighthouse                   |
| DaisyUI gradient classes unavailable in VS Code webview       | Low         | Medium | 3     | Tailwind gradients are utility-based and compile to standard CSS; verify in webview rendering context                                     |
| Breaking existing wizard flow during refactoring              | Medium      | High   | 8     | Implement each phase incrementally; run existing wizard spec tests after each change; maintain all existing API contracts                 |

---

## Dependencies and Constraints

### Technical Dependencies

1. **ngx-markdown 21.0** -- Already installed, used by chat library. No version change needed.
2. **PrismJS** -- Already configured for syntax highlighting in chat. Verify same Prism languages are available in wizard webview bundle.
3. **DaisyUI 4.12** -- Already configured with Tailwind 3.4. All required utility classes available.
4. **Lucide Angular 0.542** -- Already imported in wizard components. Additional icons may be needed.

### Constraints

1. **Sequential Phase Execution**: Phase 1 must be completed and validated before starting Phase 2. Phase 2 must be completed before Phase 3.
2. **No Backend Changes**: All enhancements are purely frontend. No modifications to shared types, backend services, or RPC contracts.
3. **Signal-Based State**: All new reactive state must use Angular signals. No RxJS BehaviorSubject, no manual change detection triggers.
4. **Standalone Components**: All new/modified components must remain standalone with explicit imports.
5. **OnPush Change Detection**: All components must use `ChangeDetectionStrategy.OnPush`.
6. **Zoneless Compatibility**: All changes must work with Angular's zoneless change detection (no Zone.js dependencies).
7. **Windows File Paths**: All file operations during implementation must use absolute Windows paths with drive letters.

---

## Phase Execution Order and Success Criteria Summary

### Phase 1: Markdown Rendering (CRITICAL -- Must Complete First)

**Requirements**: 1.1, 1.2, 1.3, 1.4, 1.5

**Success Criteria**:

- Analysis transcript renders markdown content with syntax highlighting
- Tool inputs display with language-detected code blocks
- Tool results render as formatted markdown
- Tool calls are visually grouped by toolCallId with collapse/expand
- "0 of 0 files" bug is eliminated
- Quality matches chat view's tool display components
- All existing wizard tests pass

**Affected Files**:

- `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts` (major refactor)
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts` (bug fix)

### Phase 2: Stats Dashboard (HIGH -- Add After Phase 1)

**Requirements**: 2.1, 2.2, 2.3, 2.4

**Success Criteria**:

- Real-time metrics update during analysis
- Phase timing and progress visualization
- Message type breakdown displayed
- Dashboard integrates into scan-progress without layout disruption
- All metrics derive from existing signals (no new services)

**Affected Files**:

- NEW: `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts` (integration)

### Phase 3: DaisyUI Visual Enhancements (MEDIUM -- Polish After Phase 2)

**Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5

**Success Criteria**:

- Welcome screen has gradient hero and feature cards
- Phase stepper uses gradient cards with animations
- Badge system is consistent across all components
- Skeleton loading states replace spinners/empty text
- Smooth transitions between wizard steps
- Professional, polished appearance

**Affected Files**:

- `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts` (step transitions)

---

## Estimated Effort

| Phase                         | Complexity      | Estimated Hours | Agent Assignment   |
| ----------------------------- | --------------- | --------------- | ------------------ |
| Phase 1: Markdown Rendering   | Medium-High     | 4-6 hours       | Frontend Developer |
| Phase 2: Stats Dashboard      | Medium          | 3-4 hours       | Frontend Developer |
| Phase 3: DaisyUI Enhancements | Medium          | 3-4 hours       | Frontend Developer |
| Testing and Validation        | Low-Medium      | 2-3 hours       | QA / Senior Tester |
| **Total**                     | **Medium-High** | **12-17 hours** |                    |

---

## Next Steps

1. **User Validation Checkpoint**: Review and approve this requirements document
2. **Software Architect**: Create implementation plan with technical specifications for each phase
3. **Team Leader**: Decompose into batched developer tasks
4. **Development**: Sequential phase execution (Phase 1 -> 2 -> 3)
5. **QA Validation**: Verify all acceptance criteria after each phase
