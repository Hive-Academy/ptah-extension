# TASK_2025_152: Setup Wizard UI Density Overhaul - Implementation Plan

**Created**: 2026-02-12  
**Architect**: software-architect agent  
**Task Type**: REFACTORING - UI Density Optimization  
**Estimated Effort**: 4-6 hours

---

## 1. Architecture Overview

### 1.1 Core Strategy: Intelligent Multi-Column Layouts

**Problem**: Current wizard uses excessive vertical space (2-3 screen heights per page) with single-column layouts and oversized typography/spacing.

**Solution**: Transform vertical layouts into intelligent horizontal multi-column grids while maintaining visual hierarchy and professional design.

### 1.2 Key Architectural Decisions

#### A. **Agent Selection Page** (Highest Impact)

**Current**: 2-column card grid with vertical stacking (shows 3-4 agents per screen)  
**New**: Horizontal list layout with inline information architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ [☐] │ Agent Name + Badge │ Description (truncated) │ 85% │ [badges] │
│ [☐] │ Agent Name + Badge │ Description (truncated) │ 72% │ [badges] │
│ [☐] │ Agent Name + Badge │ Description (truncated) │ 90% │ [badges] │
└─────────────────────────────────────────────────────────────────────┘
```

**Benefits**:

- **8-10 agents visible per screen** (vs current 3-4)
- **60% scroll reduction** on agent selection page alone
- Horizontal space utilization (~900-1000px webview width)
- Maintains all information (checkbox, name, badge, description, score, criteria badges)

---

#### B. **Analysis Results Page** (Second Highest Impact)

**Current**: All sections stacked vertically (3 screen heights)  
**New**: 2-column layout with intelligent grouping

```
┌──────────────────────────────┬──────────────────────────────┐
│ Project Overview             │ Architecture Patterns         │
│ (type, frameworks, monorepo) │ (confidence scores)           │
├──────────────────────────────┼──────────────────────────────┤
│ Language Distribution        │ Code Health                   │
│ (progress bars)              │ (diagnostics + test coverage) │
└──────────────────────────────┴──────────────────────────────┘
│            Key File Locations (full-width collapsible)        │
└───────────────────────────────────────────────────────────────┘
```

**Benefits**:

- **50% scroll reduction** on analysis page
- Related information grouped logically (overview + patterns, languages + health)
- Full-width for dense file location lists

---

#### C. **Welcome Page**

**Current**: 2x2 feature cards grid  
**New**: 3-column feature cards grid (more compact)

**Benefits**:

- **33% vertical space reduction** on welcome page
- Better horizontal space utilization

---

#### D. **Completion Page**

**Current**: All sections stacked vertically  
**New**: 2-column layout for key sections

```
┌──────────────────────────────┬──────────────────────────────┐
│ Generated Files              │ Quick Start Guide             │
│ (agents, commands, skills)   │ (orchestrate examples)        │
└──────────────────────────────┴──────────────────────────────┘
│            Stats Cards (full-width 4-column)                  │
└───────────────────────────────────────────────────────────────┘
```

---

### 1.3 Typography & Spacing Reduction Strategy

**Global Reductions** (applied consistently across all components):

| Element Type     | Current   | New       | Reduction |
| ---------------- | --------- | --------- | --------- |
| Main Titles      | text-5xl  | text-2xl  | -60%      |
| Section Headings | text-4xl  | text-xl   | -75%      |
| Subsections      | text-3xl  | text-lg   | -67%      |
| Body Text        | text-2xl  | text-base | -50%      |
| Vertical Padding | py-12     | py-6      | -50%      |
| Margins          | mb-8      | mb-4      | -50%      |
| Gaps             | gap-6     | gap-4     | -33%      |
| Card Padding     | p-6       | p-4       | -33%      |
| Icon Sizes       | h-12/h-16 | h-6/h-8   | -50%      |

**Design Principles**:

- Maintain **minimum 44px touch targets** for buttons/checkboxes (accessibility)
- Preserve **visual hierarchy** with relative sizing (headings still larger than body)
- Use **subtle borders and spacing** instead of excessive padding
- Professional appearance (not cramped or tiny)

---

## 2. Component-by-Component Implementation Plan

### 2.1 Batch 1: High-Impact Agent Selection (Priority 1)

#### **Component**: `agent-selection.component.ts`

**Complexity**: Medium (layout restructure)  
**Estimated Time**: 1.5 hours

**Before**:

```html
<!-- 2-column card grid with vertical agent info -->
<div class="grid grid-cols-1 gap-2">
  <div class="card p-2.5">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <input type="checkbox" />
        <div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold">{{ agent.agentName }}</span>
            <span class="badge badge-success badge-xs">Rec</span>
          </div>
          <p class="text-xs text-base-content/60 truncate">{{ agent.description }}</p>
        </div>
      </div>
      <div class="flex flex-col items-end">
        <span class="badge badge-sm font-bold">{{ agent.relevanceScore }}%</span>
      </div>
    </div>
    <div class="mt-1.5 flex flex-wrap gap-1">
      <!-- Matched criteria badges -->
    </div>
  </div>
</div>
```

**After** (Horizontal List Layout):

```html
<!-- Horizontal list layout with inline information -->
<div class="space-y-2">
  <div class="card border border-base-300 bg-base-200/50 hover:border-primary/40 transition-colors cursor-pointer" [class.ring-1]="isSelected(agent.agentId)" [class.ring-primary]="isSelected(agent.agentId)">
    <div class="card-body p-2.5">
      <div class="flex items-center gap-3">
        <!-- 1. Checkbox (60px) -->
        <input type="checkbox" class="checkbox checkbox-primary checkbox-sm shrink-0" [checked]="isSelected(agent.agentId)" />

        <!-- 2. Name + Recommended Badge (200px) -->
        <div class="w-48 shrink-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-semibold truncate">{{ agent.agentName }}</span>
            @if (agent.recommended) {
            <span class="badge badge-success badge-xs gap-0.5 shrink-0">
              <lucide-angular [img]="CheckIcon" class="h-2.5 w-2.5" />
              Rec
            </span>
            }
          </div>
        </div>

        <!-- 3. Description (flex-1, grows to fill available space) -->
        <div class="flex-1 min-w-0">
          <p class="text-xs text-base-content/60 truncate" [title]="agent.description">{{ agent.description }}</p>
        </div>

        <!-- 4. Score Badge (80px) -->
        <div class="w-20 shrink-0 flex justify-center">
          <span class="badge badge-sm font-bold" [class]="getScoreBadgeClass(agent.relevanceScore)"> {{ agent.relevanceScore }}% </span>
        </div>

        <!-- 5. Matched Criteria Badges (250px, with truncation) -->
        <div class="w-64 shrink-0 flex gap-1 overflow-hidden">
          @for (criteria of agent.matchedCriteria.slice(0, 2); track criteria) {
          <span class="badge badge-outline badge-xs truncate max-w-[100px]" [title]="criteria"> {{ criteria }} </span>
          } @if (agent.matchedCriteria.length > 2) {
          <span class="badge badge-ghost badge-xs cursor-help" [title]="agent.matchedCriteria.slice(2).join(', ')"> +{{ agent.matchedCriteria.length - 2 }} </span>
          }
        </div>
      </div>
    </div>
  </div>
</div>
```

**Changes**:

1. Remove vertical stacking inside cards
2. Implement horizontal flex layout with fixed widths for key columns
3. Use `flex-1 min-w-0` for description to fill available space
4. Keep truncation for descriptions and criteria badges
5. Remove progress bars (redundant with score badges)
6. Reduce padding: `p-2.5` (already optimized)
7. Remove max-width constraints on container

**Typography Updates**:

- Headers: `text-sm` → already optimized (keep)
- Agent names: `text-xs` (keep)
- Badges: `badge-xs` (keep)

**Expected Impact**: Show 8-10 agents per screen (vs current 3-4)

---

### 2.2 Batch 2: Analysis Results Multi-Column Layout (Priority 2)

#### **Component 1**: `analysis-results.component.ts`

**Complexity**: Low (template restructure only)  
**Estimated Time**: 30 minutes

**Changes**:

1. Wrap tech-stack-summary and architecture-patterns in 2-column grid
2. Wrap code-health and key-file-locations in 2-column grid
3. Reduce spacing: `mb-3` → `mb-2`

**Before**:

```html
<!-- All components stacked vertically -->
<ptah-tech-stack-summary />
<ptah-architecture-patterns-card />
<ptah-key-file-locations-card />
<ptah-code-health-card />
```

**After**:

```html
<!-- 2-column grid layout -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
  <!-- Left column: Project Overview + Language Distribution -->
  <ptah-tech-stack-summary [projectType]="analysis.projectType" [projectTypeDescription]="analysis.projectTypeDescription" [fileCount]="analysis.fileCount" [frameworks]="analysis.frameworks" [monorepoType]="analysis.monorepoType" [languageDistribution]="analysis.languageDistribution" />

  <!-- Right column: Architecture Patterns -->
  <ptah-architecture-patterns-card [patterns]="analysis.architecturePatterns" />
</div>

<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
  <!-- Left column: Code Health -->
  <ptah-code-health-card [issues]="analysis.existingIssues" [testCoverage]="analysis.testCoverage" />

  <!-- Right column: Key File Locations (collapsible) -->
  <ptah-key-file-locations-card [locations]="analysis.keyFileLocations" />
</div>

<!-- Confirmation warning (full-width) -->
<div class="alert alert-warning text-xs mb-2">
  <!-- Warning content -->
</div>
```

**Typography Updates**:

- Main heading: `text-sm font-semibold mb-3` → `text-sm font-semibold mb-2`
- Alert text: `text-xs` (already optimized)

---

#### **Component 2**: `tech-stack-summary.component.ts`

**Complexity**: Low  
**Estimated Time**: 20 minutes

**Changes**:

1. Reduce card padding: `p-3` → `p-2`
2. Reduce section spacing: `mb-3` → `mb-2`
3. Reduce heading margin: `mb-2` → `mb-1`
4. Reduce grid gap: `gap-2` → `gap-1`

**Typography Updates**:

- Section heading: `text-xs font-medium uppercase tracking-wide mb-2` → `text-xs font-medium uppercase tracking-wide mb-1`
- Labels: `text-xs` (keep)
- Badges: `badge-sm` (keep)

---

#### **Component 3**: `architecture-patterns-card.component.ts`

**Complexity**: Low  
**Estimated Time**: 20 minutes

**Changes**:

1. Reduce card padding: `p-3` → `p-2`
2. Reduce pattern item padding: `p-2.5` → `p-2`
3. Reduce spacing: `space-y-2` → `space-y-1.5`
4. Remove progress bar (redundant with confidence badge)
5. Reduce heading margin: `mb-2` → `mb-1`

**Before**:

```html
<div class="p-2.5 bg-base-100 rounded-lg">
  <div class="flex justify-between items-center mb-2">
    <span class="font-semibold">{{ pattern.name }}</span>
    <span class="badge">{{ pattern.confidence }}% confidence</span>
  </div>
  <progress class="progress w-full" [value]="pattern.confidence" max="100"></progress>
  <p class="text-sm text-base-content/70 mt-2">{{ pattern.description }}</p>
</div>
```

**After**:

```html
<div class="p-2 bg-base-100 rounded-lg">
  <div class="flex justify-between items-center">
    <span class="text-xs font-semibold">{{ pattern.name }}</span>
    <span class="badge badge-xs">{{ pattern.confidence }}%</span>
  </div>
  @if (pattern.description) {
  <p class="text-xs text-base-content/70 mt-1">{{ pattern.description }}</p>
  }
</div>
```

**Typography Updates**:

- Pattern name: `font-semibold` → `text-xs font-semibold`
- Badge: default → `badge-xs`
- Description: `text-sm` → `text-xs`

---

#### **Component 4**: `key-file-locations-card.component.ts`

**Complexity**: Low  
**Estimated Time**: 15 minutes

**Changes**:

1. Reduce card padding: `p-3` → `p-2`
2. Reduce spacing: `space-y-2` → `space-y-1.5`
3. Make collapsible sections more compact
4. Limit displayed items to 5 (instead of 10) with "+X more" indicator

**Before**:

```html
<div class="collapse collapse-arrow bg-base-100">
  <div class="collapse-title font-medium">
    {{ section.label }}
    <span class="badge badge-sm badge-ghost ml-2">{{ getItems(section.key).length }}</span>
  </div>
  <div class="collapse-content">
    <ul class="text-sm text-base-content/80 space-y-1">
      @for (item of getDisplayItems(section.key); track item) {
      <li class="font-mono text-xs truncate">{{ item }}</li>
      } @if (getItems(section.key).length > 10) {
      <li class="text-xs text-base-content/60">+{{ getItems(section.key).length - 10 }} more</li>
      }
    </ul>
  </div>
</div>
```

**After**:

```html
<div class="collapse collapse-arrow bg-base-100">
  <div class="collapse-title text-xs font-medium py-2">
    {{ section.label }}
    <span class="badge badge-xs badge-ghost ml-2">{{ getItems(section.key).length }}</span>
  </div>
  <div class="collapse-content">
    <ul class="text-xs text-base-content/80 space-y-0.5">
      @for (item of getDisplayItems(section.key); track item) {
      <li class="font-mono truncate">{{ item }}</li>
      } @if (getItems(section.key).length > 5) {
      <li class="text-base-content/60">+{{ getItems(section.key).length - 5 }} more</li>
      }
    </ul>
  </div>
</div>
```

**Changes to TypeScript**:

```typescript
protected getDisplayItems(key: keyof KeyFileLocations): string[] {
  return this.getItems(key).slice(0, 5); // Changed from 10 to 5
}
```

---

#### **Component 5**: `code-health-card.component.ts`

**Complexity**: Low  
**Estimated Time**: 15 minutes

**Changes**:

1. Reduce card padding: `p-3` → `p-2`
2. Reduce section spacing: `mb-3` → `mb-2`
3. Reduce radial progress size: `--size:3rem` → `--size:2.5rem`
4. Reduce badge gaps: `gap-2` → `gap-1`

**Typography Updates**:

- Section heading: `text-xs font-medium uppercase tracking-wide mb-2` → `text-xs font-medium uppercase tracking-wide mb-1`
- Badge text: already `badge-error`, `badge-warning` (keep sizes)

---

### 2.3 Batch 3: Welcome & Completion Pages (Priority 3)

#### **Component 1**: `welcome.component.ts`

**Complexity**: Low  
**Estimated Time**: 30 minutes

**Changes**:

1. Change feature cards grid from 2-column to 3-column
2. Reduce padding: `px-3 py-4` → `px-3 py-3`
3. Reduce card padding: `p-2.5` → `p-2`
4. Reduce title margin: `mb-3` → `mb-2`
5. Reduce icon size: `w-4 h-4` → `w-3.5 h-3.5`

**Before**:

```html
<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 text-left">
  <!-- 4 feature cards in 2x2 grid -->
</div>
```

**After**:

```html
<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-left">
  <!-- 4 feature cards in 3-column layout (2 in first row, 2 in second row) -->
  <div class="border border-base-300 rounded-md bg-base-200/50">
    <div class="p-2 flex flex-row items-center gap-2">
      <div class="bg-primary/10 rounded p-1">
        <lucide-angular [img]="SearchIcon" class="w-3.5 h-3.5 text-primary" />
      </div>
      <div>
        <h3 class="font-medium text-xs">Deep Analysis</h3>
        <p class="text-xs text-base-content/60">4-phase AI-powered scan</p>
      </div>
    </div>
  </div>
  <!-- Repeat for other 3 cards -->
</div>
```

**Typography Updates**:

- Main title: `text-base font-semibold mb-3` → `text-base font-semibold mb-2`
- Paragraphs: `text-xs` (already optimized)
- Time estimate: `mb-4` → `mb-3`

---

#### **Component 2**: `completion.component.ts`

**Complexity**: Medium (multi-section restructure)  
**Estimated Time**: 1 hour

**Changes**:

1. Reduce header padding: `py-8` → `py-4`
2. Reduce success icon size: `h-20 w-20` → `h-12 w-12`, padding `p-6` → `p-4`
3. Stats cards: keep 4-column layout (already optimal)
4. **NEW**: 2-column layout for "Generated Files" and "Quick Start Guide"
5. Reduce card body padding: `.card-body` default → `p-4`
6. Reduce section margins: `mb-8` → `mb-4`

**Before** (all sections stacked):

```html
<div class="container mx-auto px-4 py-8">
  <!-- Success header -->
  <!-- Stats cards (4-column) -->
  <!-- Generated Files card (full-width) -->
  <!-- Quick Start Guide card (full-width) -->
  <!-- Tips card (full-width) -->
  <!-- Action buttons -->
</div>
```

**After** (2-column for main content):

```html
<div class="container mx-auto px-4 py-4">
  <div class="max-w-4xl mx-auto">
    <!-- Success Header (compact) -->
    <div class="text-center mb-4">
      <div class="flex justify-center mb-3">
        <div class="rounded-full bg-success/20 p-4">
          <lucide-angular [img]="CheckIcon" class="h-12 w-12 text-success" />
        </div>
      </div>
      <h1 class="text-2xl font-bold mb-2">Setup Complete!</h1>
      <p class="text-sm text-base-content/70 max-w-2xl mx-auto">Your personalized agents and orchestration skill have been generated.</p>
    </div>

    <!-- Stats Cards (4-column, full-width) -->
    <div class="stats shadow-xl w-full mb-4">
      <!-- 4 stat cards (keep existing) -->
    </div>

    <!-- 2-Column Layout: Generated Files + Quick Start -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <!-- Left: Generated Files Card -->
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body p-4">
          <h2 class="card-title text-base mb-3">
            <lucide-angular [img]="FolderIcon" class="h-5 w-5" />
            Generated Files
          </h2>
          <!-- 3-column grid for agents/commands/skills -->
          <div class="grid grid-cols-1 gap-3">
            <!-- Agents -->
            <div>
              <h3 class="font-semibold text-primary mb-2 flex items-center gap-2 text-sm"><span>🤖</span> Agents</h3>
              <ul class="space-y-1 text-xs">
                @for (file of agentFiles(); track file.id) {
                <li class="flex items-center gap-2">
                  <lucide-angular [img]="CheckIcon" class="h-3 w-3 text-success" />
                  <span class="font-mono truncate">{{ file.name }}</span>
                </li>
                }
              </ul>
            </div>
            <!-- Commands -->
            <!-- Skill Files -->
          </div>
        </div>
      </div>

      <!-- Right: Quick Start Guide Card -->
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body p-4">
          <h2 class="card-title text-base mb-3">
            <lucide-angular [img]="ZapIcon" class="h-5 w-5" />
            Quick Start Guide
          </h2>
          <!-- Compact orchestrate examples -->
        </div>
      </div>
    </div>

    <!-- Tips Card (full-width) -->
    <div class="alert alert-info mb-4">
      <!-- Compact tips -->
    </div>

    <!-- Action Buttons -->
  </div>
</div>
```

**Typography Updates**:

- Main title: `text-4xl` → `text-2xl`
- Section headings: `text-xl` → `text-base`
- Body text: `text-sm` → `text-xs` (in lists)
- Card titles: `text-xl` → `text-base`
- Margins: `mb-8` → `mb-4`

---

### 2.4 Batch 4: Progress & Enhancement Components (Priority 4)

#### **Component 1**: `scan-progress.component.ts`

**Complexity**: Low  
**Estimated Time**: 30 minutes

**Changes**:

1. Reduce phase card padding: `p-2` → `p-1.5`
2. Reduce icon sizes: `w-4 h-4` → `w-3.5 h-3.5`
3. Reduce grid gap: `gap-2` → `gap-1.5`
4. Reduce section margins: `mb-3` → `mb-2`
5. Compact phase grid: `grid-cols-2 md:grid-cols-4` (already optimal)

**Typography Updates**:

- Phase labels: `text-xs` (keep)
- Badge text: `badge-xs` (keep)
- Header: `text-sm font-semibold` (keep)

---

#### **Component 2**: `prompt-enhancement.component.ts`

**Complexity**: Low  
**Estimated Time**: 20 minutes

**Changes**:

1. Reduce padding: `px-3 py-3` → `px-3 py-2`
2. Reduce card padding: `p-3` → `p-2`
3. Reduce vertical gaps: `gap-2` → `gap-1.5`
4. Reduce margins: `mb-3` → `mb-2`

**Typography Updates**:

- Main heading: `text-sm font-semibold mb-1` (keep)
- Paragraphs: `text-xs` (keep)

---

#### **Component 3**: `generation-progress.component.ts`

**Complexity**: Low  
**Estimated Time**: 30 minutes

**Changes**:

1. Reduce main padding: `px-4 py-8` → `px-4 py-4`
2. Reduce card body padding: default → `p-4`
3. Reduce section margins: `mb-8` → `mb-4`
4. Reduce item spacing: `space-y-3` → `space-y-2`
5. Compact card padding: `card-compact` already used (keep)

**Typography Updates**:

- Main title: `text-3xl` → `text-2xl`
- Section headings: `text-xl` → `text-base`
- Overall progress label: `text-lg` → `text-base`
- Item names: `font-semibold` → `text-sm font-semibold`

---

#### **Component 4**: `wizard-view.component.ts`

**Complexity**: Low  
**Estimated Time**: 15 minutes

**Changes**:

1. Reduce progress indicator padding: `px-3 py-2` → `px-3 py-1.5`
2. Reduce content padding: `p-3` → `p-2`
3. Keep step labels compact (already optimized)

**Typography Updates**:

- Step labels: default size (keep)
- No major typography changes needed

---

### 2.5 Summary Table: All 12 Components

| Component                                      | Complexity | Time   | Key Changes                                  |
| ---------------------------------------------- | ---------- | ------ | -------------------------------------------- |
| **Batch 1: Agent Selection (Priority 1)**      |
| `agent-selection.component.ts`                 | Medium     | 1.5h   | Horizontal list layout, remove progress bars |
| **Batch 2: Analysis Results (Priority 2)**     |
| `analysis-results.component.ts`                | Low        | 0.5h   | 2-column grid wrapper                        |
| `tech-stack-summary.component.ts`              | Low        | 0.3h   | Reduce padding/spacing                       |
| `architecture-patterns-card.component.ts`      | Low        | 0.3h   | Remove progress bars, compact layout         |
| `key-file-locations-card.component.ts`         | Low        | 0.25h  | Limit to 5 items, compact collapsibles       |
| `code-health-card.component.ts`                | Low        | 0.25h  | Reduce radial progress size                  |
| **Batch 3: Welcome & Completion (Priority 3)** |
| `welcome.component.ts`                         | Low        | 0.5h   | 3-column feature grid                        |
| `completion.component.ts`                      | Medium     | 1h     | 2-column layout, compact stats               |
| **Batch 4: Progress Components (Priority 4)**  |
| `scan-progress.component.ts`                   | Low        | 0.5h   | Compact phase cards                          |
| `prompt-enhancement.component.ts`              | Low        | 0.3h   | Reduce padding/spacing                       |
| `generation-progress.component.ts`             | Low        | 0.5h   | Compact progress items                       |
| `wizard-view.component.ts`                     | Low        | 0.25h  | Compact stepper                              |
| **TOTAL**                                      |            | **6h** | 12 components                                |

---

## 3. Batching Strategy for team-leader

### Batch 1: Agent Selection Overhaul (90 minutes)

**Assign to**: frontend-developer  
**Mode**: MODE_3 (Single specialized agent)

**Files**:

- `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`

**Scope**:

- Convert vertical card layout to horizontal list layout
- Remove progress bars
- Implement fixed-width columns for checkbox, name, description, score, badges
- Add proper truncation and tooltips
- Test with 10+ agents to verify scroll reduction

**Acceptance Criteria**:

- 8-10 agents visible per screen (measured at 1080p resolution)
- All information remains accessible (name, description, score, criteria badges)
- Keyboard navigation and accessibility preserved
- No horizontal overflow on narrow screens (responsive breakpoints)

---

### Batch 2: Analysis Results Multi-Column Layout (90 minutes)

**Assign to**: frontend-developer  
**Mode**: MODE_3 (Single specialized agent)

**Files**:

- `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis/tech-stack-summary.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis/architecture-patterns-card.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis/key-file-locations-card.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/analysis/code-health-card.component.ts`

**Scope**:

- Wrap analysis-results template with 2-column grid layout
- Reduce padding/spacing in all 4 sub-components
- Remove progress bars from architecture-patterns
- Limit key-file-locations to 5 items per section
- Reduce radial progress size in code-health-card

**Acceptance Criteria**:

- 2-column layout displays correctly on desktop (>=768px)
- Collapses to single column on mobile (<768px)
- 50% scroll reduction on analysis page
- All text remains readable (not cramped)

---

### Batch 3: Welcome & Completion Pages (90 minutes)

**Assign to**: frontend-developer  
**Mode**: MODE_3 (Single specialized agent)

**Files**:

- `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`

**Scope**:

- Convert welcome feature cards to 3-column grid
- Implement 2-column layout for completion page (Generated Files | Quick Start)
- Reduce all title sizes (text-4xl → text-2xl, text-xl → text-base)
- Reduce card padding and margins across both components
- Compact success icon and stats cards

**Acceptance Criteria**:

- Welcome page fits in single viewport on 1080p
- Completion page shows main content without scrolling
- 3-column grid displays properly (responsive)
- Stats cards remain readable in 4-column layout

---

### Batch 4: Progress & Enhancement Components (90 minutes)

**Assign to**: frontend-developer  
**Mode**: MODE_3 (Single specialized agent)

**Files**:

- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`

**Scope**:

- Reduce padding, spacing, and margins across all 4 components
- Compact phase cards in scan-progress
- Reduce icon sizes and card padding
- Compact generation progress items (space-y-3 → space-y-2)
- Reduce wizard stepper padding

**Acceptance Criteria**:

- All progress screens show more content per viewport
- Phase cards and progress items are compact but readable
- Animations and transitions remain smooth
- No layout shifts during progress updates

---

## 4. Testing Strategy

### 4.1 Build Verification

**Run after each batch**:

```bash
# Typecheck entire workspace
npm run typecheck:all

# Lint frontend libraries
nx lint setup-wizard

# Build webview application
nx build ptah-extension-webview

# Verify no TypeScript errors
```

**Expected**: All commands pass with zero errors.

---

### 4.2 Visual Testing Protocol

#### Test Environment Setup

1. **Launch VS Code with extension**
2. **Open test workspace** (Nx monorepo with 10+ agents recommended)
3. **Open Setup Wizard**: `Cmd/Ctrl+Shift+P` → "Ptah: Setup Wizard"

---

#### Test Cases

**Test Case 1: Agent Selection Page (Batch 1)**

1. Navigate to Agent Selection step
2. **Measure visible agents**: Count agents visible without scrolling at 1920x1080
3. **Expected**: 8-10 agents visible (vs current 3-4)
4. **Verify**:
   - All agent information visible (name, description, score, criteria badges)
   - Horizontal list layout with proper alignment
   - No horizontal overflow on narrow screens (test at 1024px width)
   - Checkbox, badge, and score remain clickable (44px touch targets)

**Test Case 2: Analysis Results Page (Batch 2)**

1. Navigate to Analysis Results step
2. **Measure scroll height**: Compare before/after scroll distance to bottom
3. **Expected**: 50% scroll reduction
4. **Verify**:
   - 2-column layout displays correctly on desktop
   - Single column on mobile (<768px)
   - All cards remain readable with reduced padding
   - Collapsible file locations work correctly
   - Architecture pattern badges display correctly

**Test Case 3: Welcome Page (Batch 3)**

1. Navigate to Welcome step
2. **Verify**:
   - 3-column feature grid displays correctly
   - Page fits in single viewport (no scroll)
   - All icons and text remain readable
   - Responsive breakpoints work (test at 768px, 1024px, 1920px)

**Test Case 4: Completion Page (Batch 3)**

1. Complete wizard and navigate to Completion step
2. **Verify**:
   - 2-column layout (Generated Files | Quick Start Guide)
   - Stats cards display in 4-column layout
   - Page shows main content without scrolling
   - Buttons remain accessible

**Test Case 5: Progress Components (Batch 4)**

1. Navigate through Scan Progress, Enhance, Generation Progress steps
2. **Verify**:
   - Phase cards are compact but readable
   - Progress bars and spinners remain visible
   - Transcript/stream messages display correctly
   - No layout shifts during progress updates

---

### 4.3 Accessibility Testing

**Run after all batches complete**:

1. **Keyboard Navigation**:

   - Tab through all wizard steps
   - Verify focus indicators visible
   - Verify Enter/Space activate buttons and checkboxes

2. **Screen Reader Testing** (optional):

   - Enable VoiceOver (macOS) or NVDA (Windows)
   - Verify all interactive elements have proper labels
   - Verify progress updates announce correctly

3. **Touch Target Sizes**:

   - Measure checkbox and button sizes (should be ≥44px)
   - Verify clickable areas are accessible

4. **Color Contrast**:
   - Verify text remains readable against backgrounds
   - Check badge colors meet WCAG AA standards

---

### 4.4 Regression Testing

**Critical Functionality**:

1. **Agent Selection**:

   - Select/deselect agents
   - "Select Recommended" button works
   - Category filtering works
   - Generate button enables/disables correctly

2. **Analysis Results**:

   - "Continue" button transitions to next step
   - "No, Let Me Adjust" shows modal
   - Collapsible sections expand/collapse

3. **Wizard Navigation**:

   - Step indicators update correctly
   - Back/Continue buttons work
   - Step skipping prevented (future steps disabled)

4. **Progress Tracking**:
   - Real-time updates display correctly
   - Error states show retry buttons
   - Completion triggers next step transition

---

### 4.5 Performance Testing

**Measure**:

1. **Render time**: Use Chrome DevTools Performance tab
2. **Memory usage**: Monitor for memory leaks during wizard flow
3. **Animation smoothness**: Verify 60fps during transitions

**Expected**:

- Initial render < 500ms
- Step transitions < 200ms
- No memory leaks after completing wizard 3 times

---

## 5. Success Criteria

### 5.1 Quantitative Metrics

| Metric                              | Current         | Target  | Measurement               |
| ----------------------------------- | --------------- | ------- | ------------------------- |
| **Agent Selection Visible Agents**  | 3-4             | 8-10    | Count at 1080p            |
| **Analysis Page Scroll Reduction**  | 100% (baseline) | 50%     | Scroll distance to bottom |
| **Welcome Page Scroll**             | Required        | None    | Fits in viewport          |
| **Completion Page Scroll**          | Required        | Minimal | Main content visible      |
| **Overall Wizard Scroll Reduction** | 100% (baseline) | 60-70%  | Average across all steps  |

---

### 5.2 Qualitative Criteria

- [ ] Professional, polished appearance maintained (not cramped)
- [ ] Visual hierarchy preserved (headings > body text)
- [ ] No horizontal overflow on any screen size
- [ ] All text remains readable (contrast, size)
- [ ] Touch targets ≥44px (accessibility)
- [ ] Keyboard navigation works
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] No layout shifts during async updates
- [ ] Build + typecheck pass

---

### 5.3 User Experience Goals

- **Reduced Cognitive Load**: Users see more relevant information at once
- **Faster Decision Making**: Agent selection visible without scrolling
- **Professional Confidence**: Compact but not cramped design
- **Maintained Functionality**: All features work identically to before

---

## 6. Rollback Plan

If any batch introduces regressions:

1. **Revert Git Commit**:

   ```bash
   git revert <commit-hash>
   ```

2. **Restore Original Layout**:

   - Restore vertical layouts
   - Restore original typography sizes
   - Restore original padding/spacing

3. **Re-test**:
   - Verify wizard functionality restored
   - Confirm build passes

---

## 7. Future Enhancements (Out of Scope)

**Not included in this task** (defer to future tickets):

- Agent selection filters (search, category tabs)
- Analysis results customization (edit detected values)
- Wizard step persistence (resume wizard after closing)
- Dark mode optimizations
- Animation performance optimizations

---

## 8. Dependencies & Prerequisites

### Build Dependencies

- Angular 20+ (already installed)
- DaisyUI (already configured)
- Tailwind CSS (already configured)
- Lucide Angular (already installed)

### Testing Prerequisites

- VS Code 1.85+
- Test workspace with 10+ recommended agents
- Multiple screen sizes for responsive testing (1024px, 1440px, 1920px)

### Team Coordination

- **frontend-developer**: Primary implementer (4 batches)
- **code-style-reviewer**: QA after each batch
- **senior-tester**: Final integration testing

---

## 9. Appendix: Design Reference

### Color Palette (DaisyUI)

- **Primary**: Agent recommendations, active states
- **Secondary**: Secondary actions, frameworks
- **Accent**: Highlights, special features
- **Success**: Completed items, high scores
- **Warning**: Medium scores, alerts
- **Error**: Low scores, failures
- **Ghost**: Disabled, inactive states

### Typography Scale

- **text-2xl**: Main page titles (16px → 24px)
- **text-xl**: Section headings (14px → 20px)
- **text-base**: Body text, buttons (14px → 16px)
- **text-sm**: Secondary text (12px → 14px)
- **text-xs**: Labels, badges (11px → 12px)

### Spacing Scale (Tailwind)

- **py-6**: Large vertical padding (1.5rem)
- **py-4**: Medium vertical padding (1rem)
- **py-2**: Small vertical padding (0.5rem)
- **mb-4**: Medium bottom margin (1rem)
- **mb-2**: Small bottom margin (0.5rem)
- **gap-4**: Medium grid gap (1rem)
- **gap-2**: Small grid gap (0.5rem)

---

## 10. Communication Plan

### Status Updates

- **After each batch**: Post summary to team channel
- **Blockers**: Report immediately to orchestrator
- **Completion**: Notify team-leader for final review

### Documentation

- **Screenshots**: Before/after for each major component
- **Metrics**: Record scroll reduction percentages
- **Issues**: Log any regressions or unexpected behavior

---

**END OF IMPLEMENTATION PLAN**

---

**Next Steps**:

1. Review this plan with team-leader
2. Assign Batch 1 to frontend-developer (MODE_3)
3. Execute batches sequentially with QA after each
4. Final integration testing by senior-tester
5. Deploy to production after all batches pass
