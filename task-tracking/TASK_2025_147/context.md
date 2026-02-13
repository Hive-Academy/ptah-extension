# TASK_2025_147 - Setup Wizard UI Enhancement (3 Phases)

**Status**: INITIALIZED
**Type**: FEATURE
**Strategy**: Full (PM → Architect → Team-Leader → QA)
**Started**: 2026-02-09
**Estimated Complexity**: Medium-High (8-16 hours)

---

## User Request

> "Let's orchestrate a new task to target all of the enhancements phase by phase to properly add the first NGX Markdown enhancement and then we also should be planning for adding the dashboard stats and all the daisy enhancements you mentioned earlier."

---

## Phased Objectives

### Phase 1: Fix Markdown Rendering in Analysis Transcript

**Priority**: CRITICAL (fix existing broken UX)

Current Issues:

- Analysis transcript shows raw text instead of markdown
- Tool inputs display as plain JSON without syntax highlighting
- Tool results are truncated and unformatted
- Output looks unprofessional compared to chat view

Required Changes:

- Add `MarkdownModule` to `analysis-transcript.component.ts`
- Replace raw text display with markdown rendering
- Implement `getFormattedToolInput()` with language detection
- Format tool results with proper markdown
- Match chat view's quality (uses tool-call-item, tool-input-display, tool-output-display)

**Affected Files**:

- `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts`
- Potentially shared markdown config in `libs/frontend/chat/`

### Phase 2: Add Real-Time Stats Dashboard

**Priority**: HIGH (enhance user understanding)

Requirements:

- Display real-time analysis progress metrics
- Show token usage, cost tracking
- Display phase completion stats (Discovery, Architecture, Health, Quality)
- File counts, detection summaries
- Integrate with existing `SetupWizardStateService` signals

**Affected Files**:

- New component: `libs/frontend/setup-wizard/src/lib/components/analysis-stats-dashboard.component.ts`
- Update: `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts` (integrate dashboard)
- State service already has scanProgress signal with phase data

### Phase 3: DaisyUI Visual Enhancements

**Priority**: MEDIUM (polish and showcase)

Enhancements:

- Hero sections with gradient backgrounds
- Gradient cards for phase display
- Badge system for phase status indicators
- Loading skeleton states
- Smooth transitions and animations
- Showcase Angular 20 + DaisyUI 4.12 integration

**Affected Files**:

- Multiple wizard components (welcome, scan-progress, analysis-result)
- Potentially shared styles in setup-wizard library

---

## Architectural Context

### Current State (from conversation context)

**Working Components**:

- `SetupWizardStateService` - Signal-based reactive state
- `AnalysisStreamPayload` message types (text, tool_start, tool_input, tool_result)
- Agentic analysis with 4 phases working
- RPC communication (timeout fixed to 1 hour)
- Backend streaming analysis messages correctly

**Broken Components**:

- `AnalysisTranscriptComponent` - No markdown rendering, poor formatting
- `ScanProgressComponent` - Shows "0 of 0 files" incorrectly

**Reference Implementation** (working correctly):

- Chat library components: `tool-call-item.component.ts`, `tool-input-display.component.ts`, `tool-output-display.component.ts`, `markdown-block.component.ts`
- These use `MarkdownModule` with proper prose styling and syntax highlighting

### Tech Stack

- **Frontend**: Angular 20.1.0 (zoneless, signals, standalone)
- **UI**: DaisyUI 4.12, TailwindCSS 3.4
- **Markdown**: ngx-markdown 21.0, prismjs
- **State**: Signal-based (no RxJS BehaviorSubject)
- **Icons**: Lucide Angular 0.542

### Design Patterns

- **Atomic Design**: Components organized as Atoms → Molecules → Organisms
- **Signal-Based State**: All reactive state uses Angular signals
- **No Angular Router**: Signal-based navigation via `SetupWizardStateService`

---

## Success Criteria

### Phase 1 (Markdown Rendering)

- ✅ Analysis transcript matches chat view quality
- ✅ Tool calls display with proper headers and collapsible sections
- ✅ Tool inputs show syntax-highlighted code blocks
- ✅ Tool results render markdown correctly
- ✅ No fragmented text or formatting issues
- ✅ "0 of 0 files" bug fixed

### Phase 2 (Stats Dashboard)

- ✅ Real-time metrics update during analysis
- ✅ Token usage and cost tracking displayed
- ✅ Phase completion visualized clearly
- ✅ File counts and detections summarized
- ✅ Dashboard integrates smoothly into scan-progress view

### Phase 3 (DaisyUI Enhancements)

- ✅ Hero sections with gradient backgrounds
- ✅ Gradient cards for phase display
- ✅ Badge system for status indicators
- ✅ Loading skeleton states
- ✅ Smooth transitions between steps
- ✅ Professional, polished appearance showcasing Angular + DaisyUI

---

## Constraints

1. **No Breaking Changes**: Maintain existing API contracts with backend
2. **Preserve Signals**: Continue using signal-based state (no RxJS migration)
3. **Match Chat Quality**: Phase 1 must achieve parity with chat view components
4. **Sequential Phases**: Complete Phase 1 before starting Phase 2, etc.
5. **Windows Paths**: Always use absolute paths with drive letters for file operations

---

## Related Files

**State Management**:

- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`

**Current Components**:

- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts` (router)
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts` (main view)
- `libs/frontend/setup-wizard/src/lib/components/analysis-transcript.component.ts` (needs fix)

**Reference Implementation**:

- `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-input-display.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-output-display.component.ts`
- `libs/frontend/chat/src/lib/components/atoms/markdown-block.component.ts`

**Markdown Configuration**:

- Likely in `libs/frontend/chat/` module setup

---

## Next Steps

1. **Invoke Project Manager** to create comprehensive task-description.md
2. **User Validation Checkpoint** after PM delivers task description
3. **Invoke Software Architect** to create implementation-plan.md with technical specs
4. **User Validation Checkpoint** after architect delivers implementation plan
5. **Invoke Team-Leader (MODE 1)** to decompose into batched tasks
6. **Development Cycle** (Team-Leader MODE 2/3)
7. **Invoke QA** for final quality verification

---

## Notes

- User explicitly wants "fix what we have first" before adding new features
- Priority is on making transcript look professional with proper markdown rendering
- Dashboard and DaisyUI enhancements come after core functionality works
- Previous timeout issues resolved (1-hour timeout now set)
- Conversation context shows detailed analysis of root causes and reference implementation patterns
