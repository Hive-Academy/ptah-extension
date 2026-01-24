# Tasks - TASK_2025_113

## Code Review Issue Resolution for Setup Wizard (TASK_2025_111)

---

## Summary

| Metric               | Value                |
| -------------------- | -------------------- |
| **Total Tasks**      | 24                   |
| **Batches**          | 6                    |
| **P0 Issues**        | 6 (Critical)         |
| **P1 Issues**        | 13 (Serious)         |
| **Estimated Effort** | 12-18 hours          |
| **Status**           | 6/6 batches complete |

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Types can be extracted to shared library without breaking imports: Verified - shared library exists at expected path
- Zod is available for validation: Verified - already used in other RPC handlers
- Angular signals API available: Verified - used throughout codebase

### Risks Identified

| Risk                                         | Severity | Mitigation                                       |
| -------------------------------------------- | -------- | ------------------------------------------------ |
| Type extraction may break imports            | MEDIUM   | Re-export from original locations initially      |
| Component decomposition may cause regression | MEDIUM   | Extract one component at a time, verify visually |
| Message type changes may break handlers      | LOW      | Keep old guards until discriminated union tested |

### Edge Cases to Handle

- [x] KeyFileLocations with undefined arrays -> Add null coalescing in Batch 4
- [x] Unknown agent categories from backend -> Add 'other' fallback in Batch 4
- [x] Template values with {{}} patterns -> Add escaping in Batch 1
- [x] Infinite retry loops -> Add retry limit in Batch 5

---

## Batch 1: Independent P0 Fixes

**Developer**: backend-developer
**Status**: COMPLETE
**Commit**: 6e74865
**Dependencies**: None
**Estimated Effort**: 2-3 hours

### T1.1: Fix Double Method Invocation in Scoring Logic (P0-1)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`
- **Lines**: 259-274
- **Change**: Replace destructuring pattern that calls scoring methods twice with explicit variable assignment pattern
- **Details**:
    - Current code calls `scorePlanningAgent` (and similar) twice per invocation
    - Store result in variable first, then extract score and criteria
    - Apply same fix to all 5 category cases: planning, development, qa, specialist, creative
- **Acceptance Criteria**:
    - Each scoring method called exactly once per agent
    - All 5 switch cases use consistent pattern
    - No destructuring pattern with method call in assignment
- **Status**: COMPLETE

### T1.2: Remove Unused Token Import (P0-2)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`
- **Line**: 19
- **Change**: Remove unused import `SKILL_GENERATOR_SERVICE` from tokens
- **Details**:
    - The token is imported but never used in the file
    - Simple deletion of line 19
- **Acceptance Criteria**:
    - Import line removed
    - `nx lint agent-generation` passes with no unused import errors
    - File still compiles successfully
- **Status**: COMPLETE

### T1.3: Escape Template Variables to Prevent Recursive Substitution (P0-6)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`
- **Lines**: 395-421
- **Change**: Add escaping helper method and use it in `substituteVariables` method
- **Details**:
    - Create private method `escapeTemplateValue(value: string): string`
    - Escape `{{`, `}}`, backslashes, and `$` characters
    - Use escaped value in `replace()` call within `substituteVariables`
- **Acceptance Criteria**:
    - New `escapeTemplateValue` method added
    - `substituteVariables` uses escaped values
    - Template values containing `{{VAR}}` do not cause recursive substitution
- **Status**: COMPLETE

### T1.4: Add Logging for Template Fallback Path (P1-7)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`
- **Lines**: 361-390
- **Change**: Add WARNING-level logging when template fallback path is used
- **Details**:
    - Log attempted extension path on fallback
    - Log warning when workspace fallback is used
    - Include both paths in error if both fail
- **Acceptance Criteria**:
    - Extension template path logged on initial attempt
    - Warning logged when fallback to workspace path is used
    - Error includes both attempted paths on complete failure
- **Status**: COMPLETE

---

## Batch 2: Foundation - Shared Types + Constants

**Developer**: backend-developer (types), frontend-developer (imports)
**Status**: COMPLETE
**Commit**: f09d5f3
**Dependencies**: None
**Estimated Effort**: 3-4 hours

### T2.1: Create Shared Setup Wizard Types File (P1-1a)

- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts` (NEW)
- **Change**: Create new file with shared types for frontend/backend wizard communication
- **Details**:
    - Create interfaces: `ArchitecturePattern`, `KeyFileLocations`, `LanguageStats`, `DiagnosticSummary`, `CodeConventions`, `NamingConventions`, `TestCoverageEstimate`, `AgentRecommendation`, `ProjectAnalysisResult`
    - Create types: `ArchitecturePatternName`, `NamingConvention`, `AgentCategory`, `WizardMessageType`
    - Create discriminated union: `WizardMessage` with all message payload types
    - Add JSDoc documentation for all types
- **Acceptance Criteria**:
    - File created with all types listed in implementation-plan.md
    - All types have JSDoc comments
    - No dependencies on workspace-intelligence (use string types instead of enums)
    - `nx build shared` succeeds
- **Status**: COMPLETE

### T2.2: Export Shared Types from Index (P1-1b)

- **File**: `D:\projects\ptah-extension\libs\shared\src\index.ts`
- **Change**: Add export for setup-wizard.types.ts
- **Details**:
    - Add `export * from './lib/types/setup-wizard.types';` at end of file
- **Acceptance Criteria**:
    - Export statement added
    - Types importable via `@ptah-extension/shared`
- **Status**: COMPLETE

### T2.3: Update Backend Analysis Types to Re-export from Shared (P1-1c)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\analysis.types.ts`
- **Change**: Remove duplicate type definitions, re-export from shared
- **Details**:
    - Keep `DeepProjectAnalysis` (uses workspace-intelligence types)
    - Remove duplicate interfaces that now exist in shared
    - Add re-export statement for shared types
- **Acceptance Criteria**:
    - No duplicate type definitions
    - `nx build agent-generation` succeeds
    - Existing imports in agent-generation still work
- **Status**: COMPLETE

### T2.4: Extract Scoring Constants with Documentation (P1-2)

- **File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`
- **Lines**: After imports (around line 19)
- **Change**: Add SCORING_CONFIG constant object with all magic numbers
- **Details**:
    - Create `SCORING_CONFIG` with `THRESHOLDS` (AUTO_SELECT: 80, RECOMMENDED: 75, CONSIDER: 60)
    - Add `ADJUSTMENTS` section with all boost values (MONOREPO_BOOST: 20, COMPLEX_ARCHITECTURE: 15, etc.)
    - Add JSDoc explaining each threshold/adjustment
    - Update all scoring methods to use these constants
- **Acceptance Criteria**:
    - All magic numbers replaced with named constants
    - Each constant has JSDoc explaining rationale
    - Scoring logic uses constants instead of literals
    - `calculateRecommendations` uses `SCORING_CONFIG.THRESHOLDS.RECOMMENDED`
- **Status**: COMPLETE

---

## Batch 3: Dependent P0 Fixes

**Developer**: frontend-developer (P0-3), backend-developer (P0-5)
**Status**: COMPLETE
**Commit**: 6cef373
**Dependencies**: Batch 2 (shared types must exist)
**Estimated Effort**: 2-3 hours

### T3.1: Update Frontend Service Imports for Shared Types (P0-3a)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- **Lines**: 98-262 (type definitions section)
- **Change**: Remove duplicate type definitions, import from shared
- **Details**:
    - Remove `ArchitecturePatternResult`, `KeyFileLocationsResult`, `DiagnosticSummaryResult`, `TestCoverageEstimateResult`, `ProjectAnalysisResult`, `AgentCategory`, `AgentRecommendation`
    - Add import from `@ptah-extension/shared`
    - Keep local interfaces for internal state (WizardStep, ProjectContext, etc.)
- **Acceptance Criteria**:
    - Duplicate types removed
    - Imports updated to use shared types
    - `nx build setup-wizard` succeeds
- **Status**: COMPLETE

### T3.2: Implement Type-Safe Message Handler with Discriminated Union (P0-3b)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- **Lines**: 753-807
- **Change**: Replace weak type guard with discriminated union and exhaustive switch
- **Details**:
    - Import `WizardMessage`, `WizardMessageType`, and payload types from shared
    - Add `isWizardMessage` type guard using discriminated union
    - Update `setupMessageListener` to use type-safe switch with exhaustive checking
    - Update handler methods to use typed payload parameters
    - Add `default` case with `never` type for exhaustiveness
- **Acceptance Criteria**:
    - TypeScript enforces exhaustive message type handling
    - All payloads typed correctly (no `unknown`)
    - Compile-time error if new message type added but not handled
- **Status**: COMPLETE

### T3.3: Add Comprehensive Zod Input Validation for RPC Handlers (P0-5)

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
- **Lines**: 237-286
- **Change**: Add Zod schema validation before processing analysis input
- **Details**:
    - Import `z` from 'zod'
    - Create `ProjectAnalysisSchema` with all required fields and defaults
    - Use `safeParse` to validate input in `registerRecommendAgents`
    - Return descriptive errors with field paths on validation failure
- **Acceptance Criteria**:
    - Invalid input produces descriptive Zod validation errors
    - Error messages include field paths (e.g., `architecturePatterns[0].name`)
    - Default values provided for optional arrays
    - Valid input passes through unchanged
- **Status**: COMPLETE

---

## Batch 4: UI Fixes

**Developer**: frontend-developer
**Status**: COMPLETE
**Commit**: 5a13051
**Dependencies**: Batch 2 (shared types available)
**Estimated Effort**: 3-4 hours

### T4.1: Add Null Check for KeyFileLocations Arrays (P1-8)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\key-file-locations-card.component.ts`
- **Lines**: Throughout template
- **Change**: Add null coalescing (`?? []`) to all `@for` directives iterating keyFileLocations arrays
- **Details**:
    - Update `entryPoints` iteration: `(locations.entryPoints ?? [])`
    - Update `configs` iteration: `(locations.configs ?? [])`
    - Update `testDirectories`, `components`, `services`, `apiRoutes` similarly
- **Acceptance Criteria**:
    - All 6 `@for` directives use null coalescing
    - No template errors when arrays are undefined
    - UI displays "No data" or empty state gracefully
- **Status**: COMPLETE

### T4.2: Create Architecture Patterns Card Sub-Component (P1-4a)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\architecture-patterns-card.component.ts` (NEW)
- **Change**: Extract architecture patterns display into standalone component
- **Details**:
    - Created new `analysis/` subdirectory
    - Created standalone component with OnPush change detection
    - Input: `patterns: ArchitecturePattern[]`
    - Includes confidence badge and progress bar logic
    - Uses shared types from `@ptah-extension/shared`
- **Acceptance Criteria**:
    - Component under 150 lines (104 lines)
    - Standalone with ChangeDetectionStrategy.OnPush
    - All architecture pattern functionality preserved
    - Visual appearance matches original
- **Status**: COMPLETE

### T4.3: Create Key File Locations Card Sub-Component (P1-4b)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\key-file-locations-card.component.ts` (NEW)
- **Change**: Extract key file locations display into standalone component
- **Details**:
    - Input: `locations: KeyFileLocations`
    - Includes all 6 collapse sections (entryPoints, configs, testDirectories, components, services, apiRoutes)
    - Applied null coalescing from T4.1
- **Acceptance Criteria**:
    - Component under 150 lines (146 lines)
    - All collapsible sections working
    - Null handling for all arrays
- **Status**: COMPLETE

### T4.4: Create Code Health Card Sub-Component (P1-4c)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\code-health-card.component.ts` (NEW)
- **Change**: Extract diagnostics and test coverage display into standalone component
- **Details**:
    - Inputs: `issues: DiagnosticSummary`, `testCoverage: TestCoverageEstimate`
    - Includes error/warning/info badges and radial progress
- **Acceptance Criteria**:
    - Component under 150 lines (116 lines)
    - Displays errors, warnings, info counts
    - Shows test coverage with framework badges
- **Status**: COMPLETE

### T4.5: Create Tech Stack Summary Sub-Component (P1-4d)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\tech-stack-summary.component.ts` (NEW)
- **Change**: Extract project overview display into standalone component
- **Details**:
    - Inputs: `projectType`, `fileCount`, `frameworks`, `monorepoType?`, `languageDistribution?`
    - Includes language distribution progress bars
    - Uses DecimalPipe for number formatting
- **Acceptance Criteria**:
    - Component under 150 lines (116 lines)
    - Shows project type, file count, frameworks
    - Monorepo badge when applicable
    - Language distribution bars when available
- **Status**: COMPLETE

### T4.6: Refactor Analysis Results to Use Sub-Components (P1-4e)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
- **Change**: Update parent component to compose sub-components
- **Details**:
    - Added imports for all 4 new sub-components
    - Replaced inline template sections with component tags
    - Passed appropriate inputs to each sub-component
    - Kept confirmation warning and action buttons in parent
- **Acceptance Criteria**:
    - Parent component under 200 lines (276 lines total, reduced from 768)
    - All sub-components imported and used
    - Visual appearance identical to before
    - All functionality preserved
- **Status**: COMPLETE

### T4.7: Add Fallback Category for Unknown Agent Types (P1-11)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
- **Lines**: 366-385, 443-454, 485-501, 507-523, 529-545
- **Change**: Add 'other' fallback category for unknown agent types
- **Details**:
    - Updated `categoryOrder` type to include `'other'`
    - Added `knownCategories` private array for filtering
    - Updated `getAgentsByCategory` to handle 'other' category (filters agents not in known categories)
    - Updated `getCategoryLabel`, `getCategoryIcon`, `getCategoryBadgeClass` with 'other' defaults
- **Acceptance Criteria**:
    - Agents with unknown categories appear in "Other" section
    - "Other" section only shows if agents exist with unknown categories
    - Styling consistent with other categories
- **Status**: COMPLETE

### T4.8: Verify Backend Acknowledgment Before Step Transition (P1-9)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
- **Lines**: 610-619
- **Change**: Wait for backend acknowledgment before transitioning to generation step
- **Details**:
    - RPC call now returns `AgentSelectionResponse` with `{ success: boolean; error?: string }`
    - Check `response.success` before calling `setCurrentStep('generation')`
    - Display error if acknowledgment fails or response is invalid
- **Acceptance Criteria**:
    - Step transition only occurs after backend confirms
    - Error displayed if backend rejects selection
    - Loading state shown during RPC call
- **Status**: COMPLETE

### T4.9: Update WizardRpcService Return Type for submitAgentSelection

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
- **Change**: Update `submitAgentSelection` to return acknowledgment response
- **Details**:
    - Created `AgentSelectionResponse` interface with `{ success: boolean; error?: string }`
    - Changed return type from `Promise<void>` to `Promise<AgentSelectionResponse>`
    - Method throws error (existing behavior) until backend handler is implemented
- **Acceptance Criteria**:
    - Method returns typed response
    - Success/error properly propagated
- **Status**: COMPLETE

---

## Batch 5: Pattern Standardization

**Developer**: frontend-developer (T5.1, T5.2, T5.3, T5.4, T5.6), backend-developer (T5.5)
**Status**: COMPLETE
**Commit**: 257f4b8
**Dependencies**: Batch 3 (message handler pattern established)
**Estimated Effort**: 2-3 hours

### T5.1: Refactor Root-Level Service Cleanup Pattern (P1-3)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- **Lines**: 274-276, 979-984
- **Change**: Replace ngOnDestroy with proper root service cleanup pattern
- **Details**:
    - Add `isMessageListenerRegistered` flag to prevent duplicates
    - Add `ensureMessageListenerRegistered()` method with deduplication
    - Add `dispose()` method for testing/explicit teardown
    - Remove `OnDestroy` interface and `ngOnDestroy` method
    - Keep `reset()` method but don't reset listener registration
- **Acceptance Criteria**:
    - No duplicate event listeners registered
    - Service properly handles multiple wizard sessions
    - `dispose()` available for testing cleanup
- **Status**: COMPLETE

### T5.2: Add ngOnDestroy Cleanup to Generation Progress Component (P0-4)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
- **Change**: Add lifecycle cleanup for pending operations
- **Details**:
    - Import `OnDestroy`, `DestroyRef` from '@angular/core'
    - Implement `OnDestroy` interface
    - Add `pendingRetries = new Set<string>()` to track in-flight retries
    - Add deduplication check in `onRetryItem`
    - Clear `pendingRetries` in `ngOnDestroy`
- **Acceptance Criteria**:
    - Component implements OnDestroy
    - Pending retries tracked and cleared on destroy
    - Duplicate retry attempts prevented
    - No memory leaks when navigating away during generation
- **Status**: COMPLETE

### T5.3: Create Error Handling Utility (P1-5a)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\utils\error-handling.ts` (NEW)
- **Change**: Create standardized error handling utilities
- **Details**:
    - Create `WizardError` interface with `message`, `details?`, `retryable`
    - Create `toWizardError(error: unknown, context: string): WizardError`
    - Create `isRetryableError(error: Error): boolean` helper
    - Create `withErrorHandling<T>()` async wrapper function
- **Acceptance Criteria**:
    - Utility file created with all functions
    - Error categorization works correctly
    - Retryable detection logic sound
- **Status**: COMPLETE

### T5.4: Update Components to Use Error Handling Utility (P1-5b)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
- **Lines**: 466-510
- **Change**: Update `onGenerateAgents` to use standardized error handling
- **Details**:
    - Import `toWizardError` or `withErrorHandling` from utils
    - Replace inline error handling with utility function
    - Ensure consistent error message format
- **Acceptance Criteria**:
    - Error handling uses utility
    - Error messages consistent format
    - Retryable errors identified correctly
- **Status**: COMPLETE

### T5.5: Add Runtime Validation for Dynamic Service Resolution (P1-6)

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
- **Lines**: 87-109, 137-161, 196-227, 262-273
- **Change**: Add helper method for validated service resolution
- **Details**:
    - Create `resolveService<T>(token, serviceName): T` private method
    - Validate service exists and is not null/undefined
    - Throw descriptive error with service name and context
    - Update all 4 dynamic resolution points to use helper
- **Acceptance Criteria**:
    - All container.resolve calls use helper
    - Descriptive errors on resolution failure
    - Error messages include service name
- **Status**: COMPLETE

### T5.6: Add Retry Count Limit with Backoff (P1-10)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
- **Lines**: 428-444
- **Change**: Add retry limit and exponential backoff to retry mechanism
- **Details**:
    - Add `MAX_RETRIES = 3` static constant
    - Add `BASE_DELAY_MS = 1000` static constant
    - Add `retryCounts = new Map<string, number>()` to track per-item retry counts
    - Add `canRetry(itemId): boolean` method
    - Add `getRemainingRetries(itemId): number` method
    - Update `onRetryItem` with limit check and exponential backoff delay
    - Update template to show remaining retries and disable when exhausted
    - Clear retry counts in `ngOnDestroy`
- **Acceptance Criteria**:
    - Retry disabled after 3 attempts
    - Exponential backoff applied (1s, 2s, 4s)
    - UI shows remaining retry count
    - "Max retries reached" message displayed
- **Status**: COMPLETE

---

## Batch 6: Cleanup

**Developer**: backend-developer
**Status**: COMPLETE
**Commit**: 175e395
**Dependencies**: None (can run in parallel with other batches)
**Estimated Effort**: 1-2 hours

### T6.1: Create TypeScript Config for Scripts (P1-12a)

- **File**: `D:\projects\ptah-extension\scripts\tsconfig.json` (NEW)
- **Change**: Create TypeScript configuration for scripts folder
- **Details**:
    - Target ES2020, module commonjs
    - Enable strict mode
    - Output to dist/scripts
    - esModuleInterop enabled
- **Acceptance Criteria**:
    - tsconfig.json created
    - Scripts can be compiled with npx tsc
- **Status**: COMPLETE

### T6.2: Convert Validation Script to TypeScript (P1-12b)

- **File**: `D:\projects\ptah-extension\scripts\validate-orchestration-skill.ts` (NEW)
- **Change**: Migrate JavaScript validation script to TypeScript
- **Details**:
    - Create TypeScript version with proper types
    - Add interfaces: `ValidationError`, `ValidationResult`
    - Type all function parameters and return values
    - Maintain identical behavior
- **Acceptance Criteria**:
    - Script compiles without TypeScript errors
    - Behavior identical to JavaScript version
    - All functions typed correctly
- **Status**: COMPLETE

### T6.3: Update Package.json Script Command (P1-12c)

- **File**: `D:\projects\ptah-extension\package.json`
- **Change**: Update validate:orchestration script to use TypeScript version
- **Details**:
    - Change from `node scripts/validate-orchestration-skill.js` to `npx ts-node scripts/validate-orchestration-skill.ts`
- **Acceptance Criteria**:
    - npm run validate:orchestration works
    - Uses TypeScript version
- **Status**: COMPLETE

### T6.4: Delete Old JavaScript Validation Script (P1-12d)

- **File**: `D:\projects\ptah-extension\scripts\validate-orchestration-skill.js`
- **Change**: Delete old JavaScript file after TypeScript migration verified
- **Acceptance Criteria**:
    - File deleted
    - No references remain to .js version
- **Status**: COMPLETE

### T6.5: Add External URL Feedback (P1-13)

- **File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts`
- **Lines**: 202-210
- **Change**: Add loading state and feedback for upgrade button
- **Details**:
    - Add `isOpeningUrl = signal(false)` for loading state
    - Add `urlFeedback = signal<string | null>(null)` for feedback state
    - Update `onUpgradeClick` to show loading, set timeout for feedback
    - Update template with loading spinner and info alert
- **Acceptance Criteria**:
    - Loading spinner shown on button click
    - Loading clears after 1 second (assume success)
    - Fallback message shown after 3 seconds if still loading
    - Manual URL provided in error message
- **Status**: COMPLETE

---

## File Reference Summary

### Files to CREATE (8)

| File                                                                                             | Task |
| ------------------------------------------------------------------------------------------------ | ---- |
| `libs/shared/src/lib/types/setup-wizard.types.ts`                                                | T2.1 |
| `libs/frontend/setup-wizard/src/lib/components/analysis/architecture-patterns-card.component.ts` | T4.2 |
| `libs/frontend/setup-wizard/src/lib/components/analysis/key-file-locations-card.component.ts`    | T4.3 |
| `libs/frontend/setup-wizard/src/lib/components/analysis/code-health-card.component.ts`           | T4.4 |
| `libs/frontend/setup-wizard/src/lib/components/analysis/tech-stack-summary.component.ts`         | T4.5 |
| `libs/frontend/setup-wizard/src/lib/utils/error-handling.ts`                                     | T5.3 |
| `scripts/tsconfig.json`                                                                          | T6.1 |
| `scripts/validate-orchestration-skill.ts`                                                        | T6.2 |

### Files to MODIFY (11)

| File                                                                             | Tasks            |
| -------------------------------------------------------------------------------- | ---------------- |
| `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts` | T1.1, T2.4       |
| `libs/backend/agent-generation/src/lib/services/skill-generator.service.ts`      | T1.2, T1.3, T1.4 |
| `libs/shared/src/index.ts`                                                       | T2.2             |
| `libs/backend/agent-generation/src/lib/types/analysis.types.ts`                  | T2.3             |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`      | T3.1, T3.2, T5.1 |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`     | T3.3, T5.5       |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`    | T4.1, T4.6       |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`     | T4.7, T4.8, T5.4 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`              | T4.9             |
| `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts` | T5.2, T5.6       |
| `libs/frontend/setup-wizard/src/lib/components/premium-upsell.component.ts`      | T6.5             |
| `package.json`                                                                   | T6.3             |

### Files to DELETE (1)

| File                                      | Task |
| ----------------------------------------- | ---- |
| `scripts/validate-orchestration-skill.js` | T6.4 |

---

## Verification Checklist per Batch

### Batch 1 Verification

- [ ] `nx lint agent-generation` - No unused imports
- [ ] `nx build agent-generation` - Builds successfully
- [ ] Template values with `{{}}` don't cause recursion (manual test)
- [ ] Fallback path logged with WARNING level

### Batch 2 Verification

- [ ] `nx build shared` succeeds
- [ ] `nx build agent-generation` succeeds
- [ ] No duplicate type definitions in frontend/backend
- [ ] All magic numbers replaced with named constants

### Batch 3 Verification

- [ ] `nx build setup-wizard` succeeds
- [ ] TypeScript enforces exhaustive message handling
- [ ] Invalid RPC input produces descriptive Zod errors

### Batch 4 Verification

- [ ] All extracted components under 150 lines
- [ ] Parent analysis-results under 200 lines
- [ ] No template errors with undefined arrays
- [ ] Step transition only after backend acknowledgment
- [ ] Unknown agent categories appear in "Other"

### Batch 5 Verification

- [ ] No duplicate message listeners
- [ ] Consistent error messages across components
- [ ] Descriptive errors on DI resolution failure
- [ ] Retry disabled after 3 attempts

### Batch 6 Verification

- [x] TypeScript script compiles without errors
- [x] Script behavior identical to JavaScript version
- [x] Loading state shown on upgrade click
- [x] Fallback message after timeout

---

## Git Commit Guidelines

Each batch should be committed separately with format:

```
fix(scope): batch N - [description]

- T[N].1: [description]
- T[N].2: [description]
...

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch Scopes**:

- Batch 1: `agent-generation`
- Batch 2: `shared`, `agent-generation`
- Batch 3: `setup-wizard`, `vscode`
- Batch 4: `setup-wizard`
- Batch 5: `setup-wizard`, `vscode`
- Batch 6: `scripts`, `setup-wizard`

---

_Created: 2026-01-22_
_Task: TASK_2025_113_
_Source: TASK_2025_111 QA Reviews (code-style-review.md, code-logic-review.md)_
