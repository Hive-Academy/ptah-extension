# Development Tasks - TASK_2025_119

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- LucideAngularModule is already available in the project (verified from TASK_2025_118 pattern)
- All target files exist at specified paths: Verified
- Icon mapping from inline SVGs to Lucide icons: Verified (standard icons available)

### Risks Identified

| Risk                                                                 | Severity | Mitigation                                               |
| -------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| chat-empty-state.component.ts has custom scanner SVG, not LayoutGrid | LOW      | Use `ScanSearch` or keep existing custom SVG if no match |

### Edge Cases to Handle

- [x] generation-progress.component.ts has 12 repeated SVGs across 4 sections - use class properties for reuse
- [x] premium-upsell.component.ts has SVGs in @for loops - icon reference via class property works
- [x] Some SVGs have aria-hidden="true" - preserve accessibility attributes

---

## Batch 1: Setup Wizard - High Volume Components ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: bb9907c

### Task 1.1: Migrate generation-progress.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts
**Pattern to Follow**: TASK_2025_118 pattern (LucideAngularModule import + class properties)

**Quality Requirements**:

- Replace 12 inline SVGs with Lucide Angular components
- Add LucideAngularModule to imports array
- Create class properties for icon references (CheckCircleIcon, AlertCircleIcon, RotateCwIcon, CheckIcon)
- Preserve all existing CSS classes (h-6 w-6, h-4 w-4, h-5 w-5)
- Preserve color classes (text-success, text-error, stroke-current)

**Implementation Details**:

- Imports: `import { LucideAngularModule, CheckCircle, AlertCircle, RotateCw, Check, CircleCheck } from 'lucide-angular';`
- Icon mapping:
  - Checkmark circle (success indicators) -> `CircleCheck`
  - Alert circle (error indicators) -> `AlertCircle`
  - Refresh arrows (retry buttons) -> `RotateCw`
  - Checkmark (continue button) -> `Check`
- SVG locations to replace:
  - Lines 114-127: success checkmark (agent section)
  - Lines 129-143: error alert circle (agent section)
  - Lines 183-196: retry icon (agent section)
  - Lines 241-255: success checkmark (command section)
  - Lines 256-271: error alert circle (command section)
  - Lines 311-324: retry icon (command section)
  - Lines 369-383: success checkmark (skill section)
  - Lines 384-399: error alert circle (skill section)
  - Lines 439-452: retry icon (skill section)
  - Lines 491-503: completion success checkmark
  - Lines 511-523: completion warning triangle
  - Lines 537-550: continue button checkmark

---

### Task 1.2: Migrate premium-upsell.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts
**Pattern to Follow**: TASK_2025_118 pattern (LucideAngularModule import + class properties)

**Quality Requirements**:

- Replace 5 inline SVGs with Lucide Angular components
- Add LucideAngularModule to imports array
- Create class properties for icon references
- Preserve all existing CSS classes and aria-hidden="true" attributes

**Implementation Details**:

- Imports: `import { LucideAngularModule, Sparkles, AlertTriangle, CircleCheck, Zap, Info } from 'lucide-angular';`
- Icon mapping:
  - Star/sparkles (premium badge) -> `Sparkles`
  - Warning triangle (error message) -> `AlertTriangle`
  - Checkmark circle (feature list items) -> `CircleCheck`
  - Lightning bolt (upgrade button) -> `Zap`
  - Info circle (URL feedback) -> `Info`
- SVG locations to replace:
  - Lines 40-53: Sparkles icon in premium badge
  - Lines 73-86: AlertTriangle in error alert
  - Lines 111-125: CircleCheck in feature list @for loop
  - Lines 143-157: Zap in upgrade button
  - Lines 165-177: Info in URL feedback alert

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- All 17 SVGs migrated to Lucide Angular

---

## Batch 2: Setup Wizard - Remaining Components ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete
**Commit**: 48a5a57

### Task 2.1: Migrate analysis-results.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 2 AlertTriangle inline SVGs with Lucide Angular components
- Add LucideAngularModule to imports array
- Preserve stroke-current and sizing classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, AlertTriangle } from 'lucide-angular';`
- SVG locations to replace:
  - Lines 89-101: AlertTriangle in first confirmation warning
  - Lines 191-202: AlertTriangle in fallback confirmation warning (duplicate section)

---

### Task 2.2: Migrate tech-stack-summary.component.ts SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\tech-stack-summary.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 Code brackets SVG with Lucide Angular Code2 icon
- Add LucideAngularModule to imports array
- Preserve h-5 w-5 sizing class

**Implementation Details**:

- Imports: `import { LucideAngularModule, Code2 } from 'lucide-angular';`
- SVG location to replace:
  - Lines 93-106: Code brackets icon in Language Distribution card title

---

### Task 2.3: Migrate welcome.component.ts SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 XCircle inline SVG with Lucide Angular component
- Add LucideAngularModule to imports array
- Preserve stroke-current shrink-0 h-6 w-6 classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, XCircle } from 'lucide-angular';`
- SVG location to replace:
  - Lines 52-63: XCircle in error alert

---

### Task 2.4: Migrate scan-progress.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 2 inline SVGs with Lucide Angular components
- Add LucideAngularModule to imports array
- Preserve all sizing and color classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, XCircle, Info } from 'lucide-angular';`
- Icon mapping:
  - X circle in error alert -> `XCircle`
  - Info circle in detection alerts -> `Info`
- SVG locations to replace:
  - Lines 43-55: XCircle in error alert
  - Lines 92-104: Info in detection alert (inside @for loop)

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- All 6 SVGs migrated to Lucide Angular

---

## Batch 3: Chat Library + Webview App ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 complete
**Commit**: a5ba60a

### Task 3.1: Migrate chat-view.component.html SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
**Companion TS File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 Bell inline SVG with Lucide Angular component
- Add LucideAngularModule to component imports in chat-view.component.ts
- Add class property for Bell icon reference
- Preserve w-4 h-4 text-primary animate-pulse classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, Bell } from 'lucide-angular';`
- SVG location to replace:
  - Lines 82-89: Bell icon in queued content indicator

---

### Task 3.2: Migrate chat-empty-state.component.ts SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-empty-state.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 custom scanner SVG with Lucide Angular ScanSearch icon
- Add LucideAngularModule to imports array
- Preserve w-5 h-5 md:w-6 md:h-6 sizing classes
- Preserve agent-working animation class on parent div

**Implementation Details**:

- Imports: `import { LucideAngularModule, ScanSearch } from 'lucide-angular';`
- SVG location to replace:
  - Lines 93-117: Custom scanner SVG in Smart Setup CTA Card

---

### Task 3.3: Migrate question-card.component.ts SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\question-card.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 HelpCircle inline SVG with Lucide Angular component
- Add LucideAngularModule to imports array
- Preserve w-4 h-4 text-info classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, HelpCircle } from 'lucide-angular';`
- SVG location to replace:
  - Lines 73-83: HelpCircle icon in header

---

### Task 3.4: Migrate app.html SVG to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.html
**Companion TS File**: D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.component.ts
**Pattern to Follow**: TASK_2025_118 pattern

**Quality Requirements**:

- Replace 1 AlertCircle inline SVG with Lucide Angular component
- Add LucideAngularModule to app.component.ts imports
- Add class property for AlertCircle icon reference
- Preserve w-6 h-6 sizing classes

**Implementation Details**:

- Imports: `import { LucideAngularModule, AlertCircle } from 'lucide-angular';`
- SVG location to replace:
  - Lines 24-35: AlertCircle in error state alert

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes for both projects:
  - `npx nx build chat`
  - `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
- All 4 SVGs migrated to Lucide Angular

---

## Batch 4: Missed Components - Complete Workspace Coverage ✅ COMPLETE

**Developer**: Direct implementation (no orchestration)
**Tasks**: 4 | **Dependencies**: Batch 3 complete

### Task 4.1: Migrate agent-selection.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts

**Implementation Details**:

- Imports: `XCircle, Check, Users, ChevronLeft, Zap`
- Icon mapping:
  - Error alert circle -> `XCircle`
  - Select Recommended button checkmark -> `Check`
  - Selected count badge checkmark -> `Check`
  - No recommendations users icon -> `Users`
  - Recommended badge checkmark -> `Check`
  - Back button chevron -> `ChevronLeft`
  - Generate button lightning -> `Zap`
- 7 SVGs migrated

---

### Task 4.2: Migrate completion.component.ts SVGs to Lucide Angular ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts

**Implementation Details**:

- Imports: `Check, Folder, Zap, Info, MessageCircle`
- Icon mapping:
  - Success header checkmark -> `Check`
  - Generated Files folder -> `Folder`
  - File list checkmarks (3x) -> `Check`
  - Quick Start Guide lightning -> `Zap`
  - Tips card info -> `Info`
  - Open .claude Folder button folder -> `Folder`
  - Test /orchestrate button lightning -> `Zap`
  - Start New Chat button message -> `MessageCircle`
- 10 SVGs migrated

---

### Task 4.3: Migrate analysis card components to Lucide Angular ✅ COMPLETE

**Files**:

- architecture-patterns-card.component.ts: `Building` icon
- code-health-card.component.ts: `CheckCircle` icon
- key-file-locations-card.component.ts: `Folder` icon
- 3 SVGs migrated

---

### Task 4.4: Migrate chat library components to Lucide Angular ✅ COMPLETE

**Files**:

- permission-badge.component.ts: `AlertTriangle, X` icons
- setup-status-widget.component.ts: `XCircle` icon
- 3 SVGs migrated

---

### Task 4.5: Migrate landing page components ✅ COMPLETE

**Files**:

- features-hijacked-scroll.component.ts: Decorative circle SVG moved to external asset file
- pricing-hero.component.ts: `DollarSign` icon
- 2 SVGs migrated (1 to external asset, 1 to Lucide)

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes for both projects:
  - `npx nx build ptah-extension-webview`
  - `npx nx build ptah-landing-page`
- Zero inline SVGs remaining in workspace (verified via grep)
- All 25 SVGs migrated to Lucide Angular or external assets

---

## Icon Reference Summary

| Inline SVG                 | Lucide Icon     | Files Using                                           |
| -------------------------- | --------------- | ----------------------------------------------------- |
| Checkmark circle (success) | `CircleCheck`   | generation-progress, premium-upsell, code-health-card |
| Alert circle (error)       | `AlertCircle`   | generation-progress, scan-progress, app.html          |
| Warning triangle           | `AlertTriangle` | premium-upsell, analysis-results, permission-badge    |
| Refresh/retry arrows       | `RotateCw`      | generation-progress                                   |
| Lightning bolt             | `Zap`           | premium-upsell, agent-selection, completion           |
| Sparkles/star              | `Sparkles`      | premium-upsell                                        |
| Info circle                | `Info`          | premium-upsell, scan-progress, completion             |
| X circle (error)           | `XCircle`       | welcome, scan-progress, agent-selection, setup-status |
| Code brackets              | `Code2`         | tech-stack-summary                                    |
| Checkmark                  | `Check`         | generation-progress, agent-selection, completion      |
| Bell                       | `Bell`          | chat-view                                             |
| Scanner/search             | `ScanSearch`    | chat-empty-state                                      |
| Help circle                | `HelpCircle`    | question-card                                         |
| Folder                     | `Folder`        | key-file-locations-card, completion                   |
| Building                   | `Building`      | architecture-patterns-card                            |
| Users                      | `Users`         | agent-selection                                       |
| Chevron Left               | `ChevronLeft`   | agent-selection                                       |
| Message Circle             | `MessageCircle` | completion                                            |
| X (close)                  | `X`             | permission-badge                                      |
| Dollar Sign                | `DollarSign`    | pricing-hero                                          |
| Decorative Circle          | External Asset  | features-hijacked-scroll                              |
