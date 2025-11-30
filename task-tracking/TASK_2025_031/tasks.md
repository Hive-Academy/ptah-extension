# Development Tasks - TASK_2025_031

**Total Tasks**: 11 | **Batches**: 4 | **Status**: 2/4 complete

---

## Batch 1: Foundation Services & Atoms - COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None
**Rationale**: Create base service and foundational atoms with zero dependencies
**Commit**: b9f05e8

### Task 1.1: Create TypewriterService - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\typewriter.service.ts
**Spec Reference**: implementation-plan.md:162-254
**Pattern to Follow**: RxJS Observable service pattern

**Quality Requirements**:

- Forward typing: Reveal characters from start to end at configurable speed
- Backward typing (erase): Remove characters from end to start at faster speed
- Type effect cycle: type → pause → erase → pause
- Multiple titles: Cycle through array of strings indefinitely
- Pure RxJS observables (no side effects)
- Tree-shakeable (providedIn: 'root')
- Less than 60 lines total

**Implementation Details**:

- Imports: Injectable, interval, concat, from, concatMap, delay, map, take, repeat, ignoreElements
- Methods: `type({ word, speed, backwards })`, `typeEffect(word)`, `getTypewriterEffect(titles)`
- Pattern: RxJS interval-based character reveal returning Observable<string>

---

### Task 1.2: Create StreamingTextComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\streaming-text.component.ts
**Spec Reference**: implementation-plan.md:257-357
**Dependencies**: Task 1.1 (TypewriterService)
**Pattern to Follow**: typing-cursor.component.ts (existing atom)

**Quality Requirements**:

- Display text character-by-character when animate=true
- Display full text immediately when animate=false
- Show blinking cursor at end of text
- Clean up RxJS subscription on component destroy
- OnPush change detection
- Less than 80 lines total

**Implementation Details**:

- Imports: Component, input, signal, OnInit, OnDestroy, inject, ChangeDetectionStrategy, TypewriterService, TypingCursorComponent
- Inputs: text (required), speed (default: 50), animate (default: true), cursorColor (default: 'text-info')
- State: displayText signal
- Lifecycle: Implement OnInit to start typewriter, OnDestroy to cleanup subscription
- Compose with existing TypingCursorComponent

---

### Task 1.3: Create ToolIconComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\tool-icon.component.ts
**Spec Reference**: implementation-plan.md:360-428
**Pattern to Follow**: duration-badge.component.ts:14-40

**Quality Requirements**:

- Support 6 tool types: Read, Write, Edit, Bash, Grep, Glob
- Default to Terminal icon for unknown tools
- Display at 14px (w-3.5 h-3.5)
- OnPush change detection
- Less than 60 lines total

**Implementation Details**:

- Imports: Component, input, ChangeDetectionStrategy, LucideAngularModule, icons (File, Terminal, Search, FileEdit, FolderSearch)
- Extract icon mapping logic from tool-call-item.component.ts:303-320
- Extract color mapping logic from tool-call-item.component.ts:322-340
- Input: toolName (required)
- Methods: getIcon() returns LucideIcon, getColorClass() returns string

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- TypewriterService exports correct methods
- StreamingTextComponent displays typewriter effect
- ToolIconComponent displays correct icons for all tool types

---

## Batch 2: Reusable Atoms - COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None (independent atoms)
**Rationale**: Create remaining atoms that can be developed in parallel
**Commit**: [pending]

### Task 2.1: Create FilePathLinkComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\file-path-link.component.ts
**Spec Reference**: implementation-plan.md:431-515
**Pattern to Follow**: tool-call-item.component.ts:351-358, 654-660

**Quality Requirements**:

- Shorten paths > 2 segments to ".../last/two"
- Show full path on hover (title attribute)
- Emit click event for parent to handle event propagation
- Open file in VS Code on click via ClaudeRpcService
- OnPush change detection
- Less than 80 lines total

**Implementation Details**:

- Imports: Component, input, inject, output, ChangeDetectionStrategy, LucideAngularModule, ExternalLink, ClaudeRpcService
- Inputs: fullPath (required)
- Outputs: clicked (Event)
- Extract shortenPath logic from tool-call-item.component.ts:654-660
- Extract openFile logic from tool-call-item.component.ts:351-358
- Inject ClaudeRpcService using inject()

---

### Task 2.2: Create ExpandableContentComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\expandable-content.component.ts
**Spec Reference**: implementation-plan.md:667-738
**Pattern to Follow**: tool-call-item.component.ts:154-188

**Quality Requirements**:

- Display line count and character count
- Show "Show content" when collapsed, "Hide content" when expanded
- Rotate chevron icon 90 degrees when expanded
- Emit click event for parent to handle
- OnPush change detection
- Less than 50 lines total

**Implementation Details**:

- Imports: Component, input, output, ChangeDetectionStrategy, LucideAngularModule, ChevronRight
- Inputs: content (required string), isExpanded (required boolean)
- Outputs: toggleClicked (Event)
- Extract content size calculation from tool-call-item.component.ts:462-467
- Use DaisyUI button classes: btn, btn-xs, btn-ghost

---

### Task 2.3: Create ErrorAlertComponent - COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\error-alert.component.ts
**Spec Reference**: implementation-plan.md:1192-1245
**Pattern to Follow**: tool-call-item.component.ts:222-226

**Quality Requirements**:

- Display error message with DaisyUI alert-error styling
- Small text (10px)
- Compact padding (py-1 px-2)
- OnPush change detection
- Less than 30 lines total

**Implementation Details**:

- Imports: Component, input, ChangeDetectionStrategy
- Input: errorMessage (required string)
- Use DaisyUI alert classes: alert, alert-error
- Simple inline template with error message display

---

**Batch 2 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- FilePathLinkComponent opens files when clicked
- ExpandableContentComponent displays correct content size
- ErrorAlertComponent displays error styling

---

## Batch 3: Molecule Components - PENDING

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (atoms), Batch 2 (atoms)
**Rationale**: Compose atoms into molecules following dependency order

### Task 3.1: Create TodoListDisplayComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\todo-list-display.component.ts
**Spec Reference**: implementation-plan.md:895-1032
**Pattern to Follow**: New pattern - specialized for TodoWrite tool

**Quality Requirements**:

- Display all todo items with correct status icons (pending=circle, in_progress=spinner, completed=checkmark)
- Show progress bar with completion percentage
- Active task (in_progress) shows activeForm text with pulse animation
- Completed tasks show faded text
- OnPush change detection
- Less than 120 lines total

**Implementation Details**:

- Imports: Component, input, computed, ChangeDetectionStrategy, LucideAngularModule, Circle, CheckCircle2, Loader2
- Input: toolInput (required TodoWriteInput)
- Computed signals: todos, totalCount, completedCount, progressPercentage
- Use DaisyUI progress bar and semantic icons
- Inline template with progress bar and todo item list

---

### Task 3.2: Create CodeOutputComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\code-output.component.ts
**Spec Reference**: implementation-plan.md:1035-1189
**Pattern to Follow**: tool-call-item.component.ts:539-593

**Quality Requirements**:

- Strip <system-reminder> tags from output
- Strip Claude CLI line number prefixes ( N→content)
- Extract text from MCP content format [{type: "text", text: "..."}]
- Detect language from file extension (Read/Write/Edit tools)
- Use bash for Bash tool output
- Auto-detect JSON if output starts with { or [
- Render markdown files as plain markdown (no code block)
- OnPush change detection
- Less than 200 lines total

**Implementation Details**:

- Imports: Component, input, computed, ChangeDetectionStrategy, MarkdownModule, ExecutionNode
- Input: node (required ExecutionNode)
- Extract processing pipeline from tool-call-item.component.ts:507-631
- Methods: stripSystemReminders, stripLineNumbers, extractMCPContent, detectLanguage
- Language map extracted from tool-call-item.component.ts:276-297
- Computed: formattedOutput wraps in markdown code blocks

---

### Task 3.3: Create ToolOutputDisplayComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-output-display.component.ts
**Spec Reference**: implementation-plan.md:1247-1324
**Dependencies**: Task 3.1 (TodoListDisplayComponent), Task 3.2 (CodeOutputComponent), Task 2.3 (ErrorAlertComponent)
**Pattern to Follow**: tool-call-item.component.ts:205-227

**Quality Requirements**:

- Route TodoWrite tool to TodoListDisplayComponent
- Route all other tools to CodeOutputComponent
- Display error alerts below output section
- Show "Output" header above content
- OnPush change detection
- Less than 70 lines total

**Implementation Details**:

- Imports: Component, input, computed, ChangeDetectionStrategy, TodoListDisplayComponent, CodeOutputComponent, ErrorAlertComponent, ExecutionNode
- Input: node (required ExecutionNode)
- Computed: isTodoWriteTool (checks node.toolName === 'TodoWrite')
- Conditional rendering using @if for tool type routing

---

### Task 3.4: Create ToolInputDisplayComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-input-display.component.ts
**Spec Reference**: implementation-plan.md:741-893
**Dependencies**: Task 2.2 (ExpandableContentComponent)
**Pattern to Follow**: tool-call-item.component.ts:144-202

**Quality Requirements**:

- Hide input section for trivial inputs (e.g., Read tool with only file_path)
- Display all parameters as key-value pairs
- Large content (> 200 chars) gets expand/collapse functionality
- Expanded content shows syntax-highlighted markdown
- For Write tool, detect language from file_path parameter
- OnPush change detection
- Less than 200 lines total

**Implementation Details**:

- Imports: Component, input, signal, ChangeDetectionStrategy, MarkdownModule, ExpandableContentComponent, ExecutionNode
- Input: node (required ExecutionNode)
- Signal: isContentExpanded
- Extract input formatting logic from tool-call-item.component.ts:405-501
- Methods: hasNonTrivialInput, getInputParams, shouldExpandParam, getFormattedParamContent
- Use ExpandableContentComponent for large content

---

**Batch 3 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- TodoListDisplayComponent displays task list with progress bar
- CodeOutputComponent displays syntax-highlighted code
- ToolOutputDisplayComponent routes to correct child component
- ToolInputDisplayComponent displays parameters with expand/collapse

---

## Batch 4: Header & Orchestrator Refactor - PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: All previous batches
**Rationale**: Final composition layer that brings everything together

### Task 4.1: Create ToolCallHeaderComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-header.component.ts
**Spec Reference**: implementation-plan.md:516-665
**Dependencies**: Task 1.3 (ToolIconComponent), Task 2.1 (FilePathLinkComponent), existing DurationBadgeComponent
**Pattern to Follow**: tool-call-item.component.ts:52-135

**Quality Requirements**:

- Toggle collapse state on header click
- File path clicks should NOT toggle collapse (stopPropagation)
- Show appropriate status indicator based on node.status
- Display streaming animation with descriptive text
- Show duration badge if available
- Accessible (aria-expanded attribute)
- OnPush change detection
- Less than 150 lines total

**Implementation Details**:

- Imports: Component, input, output, ChangeDetectionStrategy, LucideAngularModule (ChevronDown, CheckCircle, XCircle, Loader2), ToolIconComponent, FilePathLinkComponent, DurationBadgeComponent, ExecutionNode
- Inputs: node (required ExecutionNode), isCollapsed (required boolean)
- Outputs: toggleClicked (void)
- Extract header logic from tool-call-item.component.ts:52-135
- Methods: hasClickableFilePath, getToolDescription, getFullDescription, getStreamingDescription, getBadgeClass
- Compose ToolIconComponent, FilePathLinkComponent, DurationBadgeComponent

---

### Task 4.2: Refactor ToolCallItemComponent - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-item.component.ts
**Spec Reference**: implementation-plan.md:1327-1412
**Dependencies**: Task 4.1 (ToolCallHeaderComponent), Task 3.4 (ToolInputDisplayComponent), Task 3.3 (ToolOutputDisplayComponent)
**Pattern to Follow**: Composition-based molecule (REWRITE from 702 lines → ~120 lines)

**Quality Requirements**:

- Maintain collapse state (default: collapsed)
- Toggle collapse on header click
- Pass ExecutionNode to all child components
- Preserve <ng-content /> slot for nested execution nodes
- Reduce from 702 lines to less than 120 lines (83% reduction)
- OnPush change detection
- Zero logic duplication

**Implementation Details**:

- Imports: Component, input, signal, ChangeDetectionStrategy, ToolCallHeaderComponent, ToolInputDisplayComponent, ToolOutputDisplayComponent, ExecutionNode
- Input: node (required ExecutionNode)
- Signal: isCollapsed (default: true)
- Method: toggleCollapse (updates isCollapsed signal)
- REWRITE entire component to use composition (delete all extracted logic)
- Simple template: header + collapsible content section with input/output displays

---

**Batch 4 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- ToolCallHeaderComponent displays correct header with all atoms
- ToolCallItemComponent reduced to ~120 lines
- All tool types display correctly (Read, Write, Edit, Bash, Grep, Glob, TodoWrite)
- TodoWrite displays task list (not raw JSON)
- File paths are clickable
- Collapse/expand behavior works
- Syntax highlighting works
- No visual regressions
- TypewriterService integration works during streaming

---

## Summary

**Batching Strategy**: Layer-based (Service → Atoms → Molecules → Orchestrator)

**Batch Breakdown**:

- Batch 1: Foundation (TypewriterService + 2 core atoms) - 3 tasks
- Batch 2: Reusable Atoms (FilePathLink, ExpandableContent, ErrorAlert) - 3 tasks
- Batch 3: Molecule Components (TodoList, CodeOutput, ToolOutput, ToolInput) - 4 tasks
- Batch 4: Header & Orchestrator (ToolCallHeader, ToolCallItem refactor) - 2 tasks

**Total**: 11 tasks across 4 batches

**Key Dependencies**:

- Batch 2 independent of Batch 1 (can run in parallel theoretically, but sequential is safer)
- Batch 3 depends on Batch 1 & 2 (needs atoms)
- Batch 4 depends on all previous batches (final composition)

**Quality Gates**:

- Each batch must build successfully before moving to next
- Final verification includes testing all tool types
- No visual regressions allowed
- TypewriterService integration must work during streaming
