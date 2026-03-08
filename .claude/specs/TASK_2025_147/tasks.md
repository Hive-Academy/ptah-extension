# Development Tasks - TASK_2025_147

**Total Tasks**: 10 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- **MarkdownModule per-component import pattern**: Verified. Chat library's `markdown-block.component.ts:2,15` imports `MarkdownModule` at the component level. App-level `provideMarkdown()` at `app.config.ts:62` provides the service globally. No app config changes needed.
- **Prose styling classes**: Verified. `prose prose-sm prose-invert max-w-none` used at `markdown-block.component.ts:19`.
- **AnalysisStreamPayload structure**: Verified. `kind` discriminator with 7 values (`text`, `tool_start`, `tool_input`, `tool_result`, `thinking`, `error`, `status`). Has `toolCallId`, `toolName`, `isError`, `timestamp`, `content` fields. Defined at `setup-wizard.types.ts:742-762`.
- **ScanProgress interface**: Verified at `setup-wizard-state.service.ts:93-105`. Has `currentPhase`, `completedPhases`, `totalFiles`, `filesScanned`, `phaseLabel`, `agentReasoning`.
- **AnalysisPhase type**: Verified at `setup-wizard.types.ts:711`. Union of `'discovery' | 'architecture' | 'health' | 'quality'`.
- **Signal-based state access**: Verified. `analysisStream()`, `scanProgress()`, `deepAnalysis()` are all public readonly signals on `SetupWizardStateService`.
- **Lucide icons availability**: Verified. All icons referenced in the plan (`CheckCircle`, `MessageSquare`, `Activity`, `Clock`, `Hash`, `Zap`, `Sparkles`, `Shield`, `Bot`, `Search`) are available in lucide-angular 0.542.
- **DaisyUI classes**: Verified. `stat`, `card`, `badge`, `skeleton`, `hero`, `steps`, `btn`, `alert`, `progress` are all standard DaisyUI 4.12 classes.
- **No new npm dependencies**: Verified. All libraries already installed.

### Risks Identified

| Risk                                                                                                                                                                                                                                       | Severity | Mitigation                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analysis-results.component.ts` has nested `@if/@else` structure (line 57-214) where the `@else` at line 208 is the fallback for `projectContext()`, not `deepAnalysis()`. The skeleton replacement must target the correct `@else` block. | MEDIUM   | Task 3.3 explicitly notes the correct target: lines 208-213 (the final `@else` block, the fallback when NEITHER `deepAnalysis` NOR `projectContext` is available). Developer must verify by reading the file. |
| Timer in `AnalysisStatsDashboardComponent` uses `setInterval` without cleanup. If the component is destroyed, the interval keeps running.                                                                                                  | MEDIUM   | Task 2.1 notes that `DestroyRef` must be injected and `onDestroy` must clear the interval. The plan's code omits this -- developer must add it.                                                               |
| `WizardViewComponent` currently has no `styles` array. Adding `styles` requires care with component metadata.                                                                                                                              | LOW      | Task 3.5 is explicit about adding the `styles` array to the `@Component` decorator.                                                                                                                           |

### Edge Cases to Handle

- [x] Empty `analysisStream()` -- all computed signals must return safe defaults -> Handled in Tasks 1.1, 2.1
- [x] `toolCallId` being undefined for some tool messages -- grouping must fall through gracefully -> Handled in Task 1.2 (ungrouped tool messages remain as individual items)
- [x] Timer cleanup on component destroy -> Handled in Task 2.1 (DestroyRef + clearInterval)
- [x] `prefers-reduced-motion` accessibility -> Handled in Task 3.5

---

## Batch 1: Phase 1 -- Markdown Rendering and Bug Fix [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 448f0a6

### Task 1.1: Rewrite AnalysisTranscriptComponent with Markdown Rendering [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` (REWRITE)
**Spec Reference**: implementation-plan.md Phase 1, Component 1.1, Sections 1.1.1 through 1.1.6
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\markdown-block.component.ts` (MarkdownModule import and prose styling)

**What to implement**:

1. Add `MarkdownModule` import from `ngx-markdown` to the component's `imports` array and add the import statement at top of file
2. Add `CheckCircle` to the lucide-angular imports and add `CheckCircleIcon` property
3. Replace raw `{{ item.content }}` text rendering with `<markdown [data]="item.content">` using `prose prose-sm prose-invert max-w-none` and bracket-notation overrides (see plan Section 1.1.2)
4. Add `languageMap` private property for file extension to language detection (see plan Section 1.1.3)
5. Add `getLanguageFromPath()` private method (see plan Section 1.1.3)
6. Add `getFormattedToolInput()` protected method that wraps tool input in language-detected fenced code blocks (see plan Section 1.1.3)
7. Add `getFormattedToolResult()` protected method for tool result markdown formatting (see plan Section 1.1.4)
8. Update `tool_input` template to use `<markdown>` instead of `<pre>` for rendering (see plan Section 1.1.3)
9. Update `tool_result` template to use `<markdown>` with error/success icons and badges (see plan Section 1.1.4)

**Quality Requirements**:

- `MarkdownModule` imported per-component (NOT via shared module)
- Prose classes match chat library exactly: `prose prose-sm prose-invert max-w-none`
- Language detection supports at minimum: .ts, .tsx, .js, .jsx, .json, .html, .css, .scss, .py, .java, .go, .rs, .md, .yaml, .yml, .xml, .sql, .sh, .bash, .zsh
- All existing functionality preserved: expand/collapse, auto-scroll, tool input truncation, message counting
- `ChangeDetectionStrategy.OnPush` and `standalone: true` preserved

**Acceptance Criteria**:

- Text messages render markdown with syntax highlighting
- Tool inputs display with language-detected fenced code blocks via ngx-markdown
- Tool results render through markdown with error/success styling
- All existing signals and methods preserved (isExpanded, scrollContainer, etc.)
- No `{{ item.content }}` raw interpolation for text, tool_input, or tool_result messages

---

### Task 1.2: Add Collapsible Tool Call Groups to AnalysisTranscriptComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` (MODIFY -- builds on Task 1.1)
**Spec Reference**: implementation-plan.md Phase 1, Component 1.1, Section 1.1.5
**Dependencies**: Task 1.1 (same file, builds on markdown rendering)

**What to implement**:

1. Add `ToolCallGroup` interface and `TranscriptItem` union type (see plan Section 1.1.5)
2. Add `collapsedToolGroups` signal and `toggleToolGroup()` method
3. Add `isToolGroupCollapsed()` method with smart defaults (completed = collapsed, in-progress = expanded)
4. Add `isToolGroup()` type guard
5. Replace `groupedMessages` computed signal with enhanced `transcriptItems` computed signal that:
   - Step 1: Merges consecutive text messages (existing logic)
   - Step 2: Groups tool messages by `toolCallId` into `ToolCallGroup` objects
6. Update template `@for` loop to iterate `transcriptItems()` instead of `groupedMessages()`
7. Add tool group template with collapsible header showing tool name, status badge (running/done/error), and chevron
8. Inside collapsed group content, render sub-items (tool_input and tool_result) with markdown
9. Non-grouped messages (text, thinking, error, status, ungrouped tools without toolCallId) render with existing `@switch` pattern

**Quality Requirements**:

- Tool messages with same `toolCallId` are grouped into a single collapsible unit
- Completed groups default to collapsed; in-progress groups default to expanded
- User toggle overrides default state
- Messages without `toolCallId` remain as ungrouped individual items
- Status badges: `badge-info badge-outline animate-pulse` for running, `badge-success badge-outline` for done, `badge-error badge-outline` for error

**Acceptance Criteria**:

- Tool call sequences (start + input + result) with same `toolCallId` are visually grouped
- Click on group header toggles collapse/expand
- Running tool calls show animated "running" badge and are expanded
- Completed tool calls show "done" badge and are collapsed
- Error tool calls show "error" badge
- Non-tool messages (text, thinking, error, status) render identically to Task 1.1

---

### Task 1.3: Fix "0 of 0 Files" Bug in ScanProgressComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 1, Component 1.2
**Pattern to Follow**: Current template at lines 82-146 (modify the `@else` branch at line 119)

**What to implement**:

1. Change `} @else {` at line 119 to `} @else if (progressData.totalFiles > 0) {`
2. Add a new final `@else` block after the progress bar section with an initializing state:
   - DaisyUI loading spinner (`loading loading-spinner loading-sm text-primary`)
   - "Initializing analysis..." text
3. This ensures:
   - If `currentPhase` exists: show phase stepper (agentic analysis path)
   - If `totalFiles > 0`: show file progress bar (legacy path)
   - Otherwise: show "Initializing analysis..." (brief loading state before data arrives)

**Quality Requirements**:

- No changes to the phase stepper section (lines 85-118)
- No changes to the transcript/detection sections (lines 148+)
- Only the `@else` block at line 119-146 is modified

**Acceptance Criteria**:

- "Analyzing 0 of 0 files..." is NEVER displayed during agentic analysis
- The progress bar only shows when `totalFiles > 0`
- An "Initializing analysis..." state briefly appears when neither phase nor file counts are available
- All existing functionality (phase stepper, transcript, detections, cancel) is preserved

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- Text messages render as markdown
- Tool calls are grouped and collapsible
- "0 of 0 files" bug is eliminated
- No regressions in wizard flow

---

## Batch 2: Phase 2 -- Stats Dashboard and Phase Stepper Enhancement [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete
**Commit**: 503bba8

### Task 2.1: Create AnalysisStatsDashboardComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` (CREATE)
**Spec Reference**: implementation-plan.md Phase 2, Component 2.1
**Pattern to Follow**: DaisyUI stat cards + computed signals pattern from `setup-wizard-state.service.ts:409-538`

**What to implement**:

1. Create new standalone component with `ptah-analysis-stats-dashboard` selector
2. Inject `SetupWizardStateService`
3. Add computed signals for metrics:
   - `messageCount` -- total messages from `analysisStream().length`
   - `toolCallCount` -- count of `tool_start` kind messages
   - `textCount` -- count of `text` kind messages
   - `thinkingCount` -- count of `thinking` kind messages
   - `errorCount` -- count of `error` kind messages
   - `currentPhaseName` -- from `scanProgress().phaseLabel` or "Starting..."
   - `phaseProgress` -- "X/4 complete" from `scanProgress().completedPhases`
4. Add elapsed time tracking:
   - `analysisStartTime` signal (set once when first message arrives, using `effect()`)
   - `elapsedTimeValue` signal (updated every second via `setInterval`)
   - `elapsedTime` readonly signal exposing formatted "M:SS" string
   - Timer cleanup via `DestroyRef.onDestroy()` + `clearInterval()` (CRITICAL: plan code omits this, developer MUST add it)
5. Template with DaisyUI stat cards in a 2x2/4-column responsive grid
6. Message type breakdown section with colored badges (info, primary, secondary, error)
7. Import icons: `MessageSquare`, `Terminal`, `Activity`, `Clock`, `Brain`, `AlertTriangle` from lucide-angular

**Quality Requirements**:

- `standalone: true`, `ChangeDetectionStrategy.OnPush`
- All state derived from existing signals -- no new service modifications
- Timer interval MUST be cleaned up on component destroy via `DestroyRef`
- Grid must be responsive: `grid-cols-2 md:grid-cols-4`
- Badge section hidden when `messageCount() === 0`

**Acceptance Criteria**:

- Stats grid shows 4 cards: Messages, Tool Calls, Phase, Elapsed
- Message breakdown shows colored badges for text, tools, thinking, errors
- Elapsed time counts up in real-time (M:SS format)
- All metrics update reactively as new stream messages arrive
- Timer is properly cleaned up on component destruction

---

### Task 2.2: Enhance Phase Stepper in ScanProgressComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 2, Component 2.2
**Dependencies**: None (independent of Task 2.1)

**What to implement**:

1. Add `CheckCircle` to lucide-angular imports and `CheckCircleIcon` property
2. Add `isPhaseComplete()` helper method -- checks if phaseId is in `completedPhases` array
3. Add `isCurrentPhase()` helper method -- checks if phaseId equals `currentPhase`
4. Update the phase stepper template (lines 87-104) to:
   - Show `CheckCircleIcon` with `text-success` for completed phases
   - Show phase icon with `animate-pulse` for the active phase
   - Show phase icon with `opacity-40` for pending phases
   - Add proper `aria-label` with phase state description

**Quality Requirements**:

- Must use the existing `phases` array (Search, Building2, HeartPulse, ShieldCheck icons)
- `isPhaseCompleteOrCurrent()` method must remain (used elsewhere)
- No changes to non-stepper sections of the template

**Acceptance Criteria**:

- Completed phases show green checkmark icon
- Active phase shows pulsing animation on its icon
- Pending phases show dimmed icon (opacity-40)
- Phase step labels include accessibility descriptions

---

### Task 2.3: Integrate Dashboard into ScanProgressComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 2, Component 2.3
**Dependencies**: Task 2.1 (dashboard component must exist)

**What to implement**:

1. Add import statement: `import { AnalysisStatsDashboardComponent } from './analysis-stats-dashboard.component';`
2. Add `AnalysisStatsDashboardComponent` to the component's `imports` array
3. Insert dashboard template between the current phase label section (after line ~118) and the agent transcript section (before line ~148):
   ```html
   @if (hasStreamMessages()) {
   <div class="mb-4">
     <ptah-analysis-stats-dashboard />
   </div>
   }
   ```

**Quality Requirements**:

- Dashboard only renders when stream messages exist (same condition as transcript)
- Dashboard is placed BETWEEN phase stepper and transcript, not replacing either
- No changes to existing template sections

**Acceptance Criteria**:

- Dashboard appears above the transcript when analysis is running
- Dashboard is hidden when no stream messages exist
- Existing layout (phase stepper, transcript, detections, cancel buttons) is preserved

---

**Batch 2 Verification**:

- New `analysis-stats-dashboard.component.ts` file exists with real implementation
- `scan-progress.component.ts` has dashboard integration and enhanced stepper
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- Dashboard shows live metrics during analysis
- Phase stepper shows completion/active/pending states with icons
- Timer cleans up on destroy (no memory leaks)

---

## Batch 3: Phase 3 -- DaisyUI Visual Enhancements [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 complete
**Commit**: fa296c5

### Task 3.1: Rewrite WelcomeComponent with Hero Section and Feature Cards [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts` (REWRITE)
**Spec Reference**: implementation-plan.md Phase 3, Component 3.1

**What to implement**:

1. Add `LucideAngularModule` and icon imports (`Search`, `Bot`, `Zap`, `Shield`, `Sparkles`) from lucide-angular
2. Add `LucideAngularModule` to component `imports` array
3. Add icon properties: `SearchIcon`, `BotIcon`, `ZapIcon`, `ShieldIcon`, `SparklesIcon`
4. Replace template with gradient hero layout:
   - Hero section with `bg-gradient-to-br from-primary/10 via-base-200 to-secondary/10`
   - Gradient text title using `bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent`
   - 2x2 responsive feature cards grid (`card bg-base-100 shadow-md hover:shadow-lg transition-shadow`)
   - Four feature cards: Deep Analysis, Smart Agents, Quick Setup, Project-Specific
   - Enhanced CTA button: `btn btn-primary btn-lg shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105`
   - Sparkles icon in CTA button
5. Add `styles` array with `@keyframes fadeIn` animation and `.animate-fadeIn` class
6. Preserve existing `onStartSetup()` method and `SetupWizardStateService` injection

**Quality Requirements**:

- All existing behavior preserved (onStartSetup transitions to 'scan' step)
- Feature card content matches plan exactly (Deep Analysis, Smart Agents, Quick Setup, Project-Specific)
- `standalone: true` and `ChangeDetectionStrategy.OnPush` preserved
- All interactive elements have appropriate `aria-label` attributes

**Acceptance Criteria**:

- Welcome screen shows gradient background hero
- Title text has gradient color effect
- Four feature cards are displayed in responsive grid
- Start Setup button has shadow, hover animation, and Sparkles icon
- Fade-in animation plays on load
- Clicking "Start Setup" still navigates to scan step

---

### Task 3.2: Add Gradient Phase Cards to ScanProgressComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 3, Component 3.2
**Dependencies**: Batch 2 must be complete (Task 2.2 added isPhaseComplete/isCurrentPhase helpers)

**What to implement**:

1. Replace the `<ul class="steps">` phase stepper (from Batch 2's Task 2.2 output) with a card-based grid layout:
   - `grid grid-cols-2 md:grid-cols-4 gap-3 mb-8`
   - Each phase is a `<div class="card">` with state-based styling
2. Add `getPhaseCardClasses()` method that returns classes based on phase state:
   - Complete: `bg-success/10 border border-success/30 shadow-sm`
   - Active: `bg-primary/10 border border-primary/30 shadow-md`
   - Pending: `bg-base-200 border border-base-300/50 opacity-60`
3. Each card shows:
   - CheckCircle icon (success) for completed phases
   - Phase icon with `animate-pulse` and `text-primary` for active phase
   - Phase icon with `text-base-content/30` for pending phases
   - Badge: `badge-success` for done, `badge-info animate-pulse` for active
4. Apply `transition-all duration-500` for smooth state transitions

**Quality Requirements**:

- Uses existing `phases` array, `isPhaseComplete()`, `isCurrentPhase()`, `isPhaseCompleteOrCurrent()` from Batch 2
- Card layout must be responsive (2 columns mobile, 4 columns desktop)
- Transitions must be smooth (CSS `transition-all duration-500`)

**Acceptance Criteria**:

- Phase stepper displays as gradient cards instead of DaisyUI steps list
- Active phase card has primary gradient border and pulsing icon
- Completed phase cards have success gradient and checkmark
- Pending phase cards are dimmed
- Smooth transitions when phases change state

---

### Task 3.3: Add Skeleton Loading States to Transcript, Results, and Dashboard [COMPLETE]

**File 1**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` (MODIFY)
**File 2**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts` (MODIFY)
**File 3**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 3, Component 3.4

**What to implement**:

**File 1 -- analysis-transcript.component.ts**:

1. Replace the `@empty` block's "Waiting for agent messages..." text with skeleton loading layout:
   - 3-4 skeleton lines with varied widths mimicking message structure
   - Use DaisyUI `skeleton` class: `skeleton w-4 h-4 rounded-full`, `skeleton h-3 w-3/4`, `skeleton h-12 w-full rounded-md`, etc.

**File 2 -- analysis-results.component.ts**:

1. Replace the final `@else` block (lines 208-213, the "Loading analysis results..." spinner) with skeleton card placeholders:
   - Skeleton tech stack summary card (skeleton title + badge placeholders + text lines)
   - Skeleton architecture patterns card (skeleton title + bar placeholders)
   - Skeleton action buttons (two skeleton button shapes)
2. IMPORTANT: This is the FINAL `@else` block at lines 208-213, NOT the `@if (deepAnalysis())` or `@if (projectContext())` blocks

**File 3 -- analysis-stats-dashboard.component.ts**:

1. Wrap the stats grid in an `@if (messageCount() > 0)` conditional
2. Add `@else` with skeleton stat cards (4 skeleton cards matching the grid layout)

**Quality Requirements**:

- Skeleton layouts must structurally match the final content layout to prevent layout shift
- All skeletons use DaisyUI `skeleton` utility class
- Smooth transition from skeleton to real content (no jump)

**Acceptance Criteria**:

- Transcript shows skeleton lines before first message arrives
- Analysis results show skeleton cards while loading
- Dashboard shows skeleton stat cards before first metric arrives
- Skeleton shapes approximate the final content layout

---

### Task 3.5: Add Step Transition Animation to WizardViewComponent [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md Phase 3, Component 3.5

**What to implement**:

1. Wrap the `@switch` block's content area (lines 108-122) in a `<div class="animate-fadeIn">` wrapper
2. Add `styles` array to the `@Component` decorator with:
   - `@keyframes fadeIn` animation (opacity 0->1, translateY 8px->0)
   - `.animate-fadeIn` class with `animation: fadeIn 0.3s ease-out`
   - `@media (prefers-reduced-motion: reduce)` media query that disables both `animate-fadeIn` and `animate-pulse`

**Quality Requirements**:

- `prefers-reduced-motion` MUST be respected (accessibility requirement)
- Animation duration is short (0.3s) to feel snappy, not sluggish
- The `styles` array is added alongside existing component metadata (no existing styles to preserve)

**Acceptance Criteria**:

- Step content fades in when wizard navigates between steps
- Animation is subtle (0.3s, slight upward slide)
- Users with `prefers-reduced-motion` setting see no animations
- All existing step rendering behavior preserved

---

**Batch 3 Verification**:

- All modified files compile successfully
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- Welcome screen has gradient hero and feature cards
- Phase stepper uses gradient cards
- Skeleton loading states appear in transcript, results, and dashboard
- Step transitions are animated
- `prefers-reduced-motion` disables animations
- No regressions in wizard flow

---

## Files Affected Summary

### CREATE (1 file)

| File                                                                                                             | Batch | Task |
| ---------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-stats-dashboard.component.ts` | 2     | 2.1  |

### REWRITE (2 files)

| File                                                                                                        | Batch | Task     |
| ----------------------------------------------------------------------------------------------------------- | ----- | -------- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts` | 1     | 1.1, 1.2 |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`             | 3     | 3.1      |

### MODIFY (3 files)

| File                                                                                                     | Batch   | Tasks              |
| -------------------------------------------------------------------------------------------------------- | ------- | ------------------ |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`    | 1, 2, 3 | 1.3, 2.2, 2.3, 3.2 |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts` | 3       | 3.3                |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`      | 3       | 3.5                |
