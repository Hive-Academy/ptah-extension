# TASK_2025_152: Setup Wizard UI Density Overhaul

## User Request

Setup wizard webview panel requires excessive vertical scrolling (each page = 2-3 screen heights). Need to optimize vertical density while utilizing available horizontal space (~900-1000px webview panel) with professional, beautiful design.

## Analysis Screenshots

Available at `D:\projects\ptah-extension\docs\current-wizard-designs\`:

- `AGENT-SELECTION-SCROLL.png` - Shows scrolling required
- `AGENT-SELECTION-UI-BROKEN.png` - Badge overflow issues
- `ANALYSIS-VISIBLE-SECTION.png` - Analysis page part 1
- `ANALYSIS-VISIBLE-SECTION-2.png` - Analysis page part 2
- `ANALYSIS-VISIBLE-SECTION-3.png` - Analysis page part 3

## Task Type

REFACTORING - UI density optimization and intelligent multi-column layout architecture

## Complexity

**Medium** (~4-6 hours)

- 11 component templates to modify
- Pure CSS/layout changes (no TypeScript logic)
- Architectural re-layouts for key components

## Strategy

REFACTORING workflow:

1. software-architect → Creates implementation-plan.md
2. team-leader MODE 1/2/3 → Batched implementation
3. QA reviews (code-style-reviewer)

## Key Changes Required

### Typography Reduction (Professional, not tiny)

- text-5xl → text-2xl (main titles)
- text-4xl → text-xl
- text-3xl → text-lg
- text-2xl → text-base

### Vertical Spacing Reduction

- py-12 → py-6
- mb-8 → mb-4
- gap-6 → gap-4
- space-y-6 → space-y-3

### Intelligent Multi-Column Layouts

**Agent Selection** (Most impactful):

- Replace 2-column card grid with horizontal list layout
- Layout: `[checkbox | name+badge | description | score | criteria badges]`
- Show 8-10 agents per screen (vs current 3-4)
- Fix badge overflow with truncation

**Analysis Results**:

- 2-column layout: `[Project Overview + Lang Dist] | [Architecture + Code Health]`
- Full-width Key File Locations (collapsible)

**Welcome Page**:

- 3-column feature cards grid
- Reduce hero spacing

**Completion Page**:

- 2-column: `[Generated Files] | [Quick Start Guide]`

### Cleanup

- Remove progress bars from agent cards (redundant with score badges)
- Limit matched criteria to 2-3 badges with proper truncation
- Reduce card padding: p-6 → p-4
- Icons: h-12/h-16 → h-6/h-8
- Remove max-width constraints (max-w-4xl, max-w-2xl)

## Files to Modify (11 components)

1. `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`
2. `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`
3. `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
4. `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
5. `libs/frontend/setup-wizard/src/lib/components/analysis/tech-stack-summary.component.ts`
6. `libs/frontend/setup-wizard/src/lib/components/analysis/architecture-patterns-card.component.ts`
7. `libs/frontend/setup-wizard/src/lib/components/analysis/key-file-locations-card.component.ts`
8. `libs/frontend/setup-wizard/src/lib/components/analysis/code-health-card.component.ts`
9. `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`
10. `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts`
11. `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`
12. `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`

## Success Criteria

- All 7 wizard steps fit in single viewport without vertical scroll
- Professional, polished appearance maintained
- No horizontal overflow
- Build + typecheck pass
- Visual testing in VS Code confirms layout improvements

## Expected Impact

**60-70% reduction in vertical scroll** while maintaining visual hierarchy and professional design quality.
