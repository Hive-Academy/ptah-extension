# Requirements Document - TASK_2025_113

## Code Review Issue Resolution for Setup Wizard (TASK_2025_111)

---

## Introduction

**Business Context**: TASK_2025_111 (MCP-Powered Setup Wizard) completed implementation but QA reviews revealed significant code quality and reliability issues that must be addressed before the feature can be considered production-ready.

**Value Proposition**: Resolving these issues will:

- Prevent runtime errors and silent failures in production
- Improve code maintainability and developer experience
- Ensure consistent UX during edge cases and error scenarios
- Reduce technical debt introduced by the feature

**Review Scores**:

- Code Style Review: 6.5/10 (3 blocking, 8 serious, 11 minor issues)
- Code Logic Review: 6.5/10 (3 critical, 7 serious, 8 moderate issues)

---

## Executive Summary

### Issue Inventory

| Priority | Category          | Count | Must Fix Before  |
| -------- | ----------------- | ----- | ---------------- |
| P0       | Blocking/Critical | 6     | Merge to main    |
| P1       | Serious           | 13    | Release          |
| P2       | Moderate/Minor    | 19    | Future iteration |

### Affected Files (16 total)

| File                               | P0 Issues | P1 Issues | P2 Issues |
| ---------------------------------- | --------- | --------- | --------- |
| `agent-recommendation.service.ts`  | 1         | 2         | 1         |
| `skill-generator.service.ts`       | 2         | 2         | 1         |
| `setup-wizard-state.service.ts`    | 1         | 2         | 2         |
| `generation-progress.component.ts` | 1         | 1         | 2         |
| `setup-rpc.handlers.ts`            | 1         | 1         | 0         |
| `analysis-results.component.ts`    | 0         | 2         | 2         |
| `agent-selection.component.ts`     | 0         | 3         | 2         |
| `wizard-view.component.ts`         | 0         | 1         | 1         |
| `premium-upsell.component.ts`      | 0         | 1         | 1         |
| `completion.component.ts`          | 0         | 0         | 1         |
| `validate-orchestration-skill.js`  | 0         | 1         | 0         |
| Other files                        | 0         | 0         | 6         |

---

## Requirements

### P0 - Blocking/Critical Issues (Must Fix Before Merge)

---

#### Requirement P0-1: Fix Double Method Invocation in Scoring Logic

**User Story:** As a developer using the setup wizard, I want agent recommendations calculated correctly, so that I receive accurate relevance scores without redundant computation.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts:259-274`

**Problem**: The destructuring pattern calls scoring methods twice per invocation - once for the assignment and once inside `criteria.push()`. This doubles computation cost and can produce inconsistent results.

**Current Code**:

```typescript
({ score, criteria: criteria.push(...this.scorePlanningAgent(agent, analysis, score).criteria) } = this.scorePlanningAgent(agent, analysis, score));
```

#### Acceptance Criteria

1. WHEN agent scoring is performed THEN each scoring method SHALL be called exactly once per agent
2. WHEN scoring logic executes THEN the result SHALL be stored in a variable before destructuring
3. WHEN scoring completes THEN criteria array SHALL contain exactly one set of criteria per scoring method
4. WHEN unit tests run THEN scoring method call count SHALL be verified as exactly 1 per agent

**Implementation Pattern**:

```typescript
const result = this.scorePlanningAgent(agent, analysis, score);
score = result.score;
criteria.push(...result.criteria);
```

---

#### Requirement P0-2: Remove Unused Token Import

**User Story:** As a developer maintaining the codebase, I want clean imports, so that dead code does not confuse readers or increase bundle size.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts:19`

**Problem**: `SKILL_GENERATOR_SERVICE` token is imported but never used.

#### Acceptance Criteria

1. WHEN skill-generator.service.ts is compiled THEN no unused imports SHALL exist
2. WHEN ESLint runs THEN no `@typescript-eslint/no-unused-vars` errors SHALL be reported for this file

---

#### Requirement P0-3: Strengthen Message Handler Type Safety

**User Story:** As a developer, I want strong type validation on incoming messages, so that malformed payloads from the backend cause clear errors rather than silent failures.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:754-759`

**Problem**: Message handler uses weak type guard that passes `message.payload` as `unknown` without full validation per message type.

#### Acceptance Criteria

1. WHEN a message is received THEN the handler SHALL validate message type against a discriminated union type
2. WHEN payload validation fails THEN the handler SHALL log a descriptive error with message type and received payload structure
3. WHEN a valid message is received THEN the payload SHALL be typed correctly for that specific message type (not `unknown`)
4. WHEN all wizard message types are enumerated THEN TypeScript SHALL enforce exhaustive handling via switch statement

**Implementation Pattern**:

```typescript
type WizardMessage = { type: 'setup-wizard:scan-progress'; payload: ScanProgress } | { type: 'setup-wizard:analysis-complete'; payload: AnalysisResults } | { type: 'setup-wizard:generation-update'; payload: GenerationUpdate };
// ... all message types

function handleMessage(message: WizardMessage): void {
  switch (message.type) {
    case 'setup-wizard:scan-progress':
      // message.payload is typed as ScanProgress
      break;
    // ... exhaustive switch
  }
}
```

---

#### Requirement P0-4: Add ngOnDestroy Cleanup to Generation Progress Component

**User Story:** As a user of the setup wizard, I want the wizard to clean up properly when I navigate away, so that orphaned operations do not cause memory leaks or state corruption.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`

**Problem**: Component has no lifecycle cleanup for subscriptions or in-flight operations.

#### Acceptance Criteria

1. WHEN the component is destroyed THEN all active subscriptions SHALL be unsubscribed
2. WHEN the component is destroyed during generation THEN in-flight operations SHALL be cancelled or tracked for cleanup
3. WHEN using DestroyRef pattern THEN takeUntilDestroyed() SHALL be used for all observables
4. WHEN component unmounts THEN no memory leaks SHALL be detectable via heap snapshot

**Implementation Pattern**:

```typescript
private readonly destroyRef = inject(DestroyRef);

// For RxJS observables:
someObservable$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

// For manual cleanup:
ngOnDestroy(): void {
  // Cancel pending operations
}
```

---

#### Requirement P0-5: Add Comprehensive Input Validation for RPC Handlers

**User Story:** As a backend developer, I want comprehensive input validation on RPC handlers, so that malformed requests from the frontend cause clear validation errors rather than undefined access crashes.

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts:82-100`

**Problem**: Only validates `projectType` exists but `calculateRecommendations` accesses nested fields like `analysis.techStack.frameworks`.

#### Acceptance Criteria

1. WHEN an RPC request is received THEN all required fields SHALL be validated before processing
2. WHEN validation fails THEN the error message SHALL specify which field is missing or malformed
3. WHEN nested fields are accessed THEN their parent objects SHALL be validated first
4. WHEN Zod schemas are used THEN they SHALL match the expected `ProjectAnalysisResult` structure

**Required Validations**:

- `analysis.projectType` - string
- `analysis.techStack` - object with `languages`, `frameworks`, `buildTools` arrays
- `analysis.architecturePatterns` - array
- `analysis.keyFileLocations` - object

---

#### Requirement P0-6: Escape Template Variables to Prevent Recursive Substitution

**User Story:** As a user generating agent configurations, I want template processing to handle special characters safely, so that values containing template syntax do not corrupt the output.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts:395-421`

**Problem**: Variable values containing `{{...}}` patterns could cause recursive substitution or malformed output.

#### Acceptance Criteria

1. WHEN a template variable value contains `{{` or `}}` THEN those characters SHALL be escaped before substitution
2. WHEN a variable value contains regex special characters THEN pattern matching SHALL not fail
3. WHEN template processing completes THEN no unsubstituted `{{VAR}}` patterns SHALL remain (except intentional ones)
4. WHEN unit tests run THEN edge cases with special characters SHALL be verified

---

### P1 - Serious Issues (Must Fix Before Release)

---

#### Requirement P1-1: Extract Shared Types to Prevent Frontend/Backend Drift

**User Story:** As a developer, I want shared types defined in one location, so that frontend and backend type definitions cannot drift apart causing serialization issues.

**Files**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:106-262`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\analysis.types.ts:17-150`

**Problem**: `ArchitecturePatternResult`, `KeyFileLocationsResult`, `AgentRecommendation`, etc. are defined in both locations.

#### Acceptance Criteria

1. WHEN shared types are defined THEN they SHALL exist only in `@ptah-extension/shared`
2. WHEN frontend needs analysis types THEN it SHALL import from `@ptah-extension/shared`
3. WHEN backend needs analysis types THEN it SHALL import from `@ptah-extension/shared`
4. WHEN types are moved THEN all imports SHALL be updated across the codebase

**Types to Move**:

- `ArchitecturePatternResult`
- `KeyFileLocationsResult`
- `AgentRecommendation`
- `ProjectAnalysisResult` (if not already shared)
- Related interfaces and enums

---

#### Requirement P1-2: Extract Scoring Constants with Documentation

**User Story:** As a developer tuning agent recommendations, I want scoring thresholds defined as named constants with documentation, so that I understand why specific values were chosen.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts:168-170, 205, 217, 223`

**Problem**: Hardcoded thresholds (75, 80) and adjustments (25, 15, 10, 5) without constants or documentation.

#### Acceptance Criteria

1. WHEN scoring thresholds are used THEN they SHALL be defined in a `SCORING_CONFIG` constant
2. WHEN scoring adjustments are applied THEN they SHALL reference named constants
3. WHEN constants are defined THEN JSDoc comments SHALL explain the rationale for each value
4. WHEN scoring logic is modified THEN only the constants file needs updating

**Implementation Pattern**:

```typescript
/**
 * Scoring configuration for agent recommendations.
 * Values determined through testing with representative projects.
 */
export const SCORING_CONFIG = {
  THRESHOLDS: {
    /** Score >= 80 triggers auto-selection */
    AUTO_SELECT: 80,
    /** Score >= 75 shows "Highly Recommended" badge */
    HIGHLY_RECOMMENDED: 75,
  },
  ADJUSTMENTS: {
    /** Boost for monorepo detection (complex project structure) */
    MONOREPO_BOOST: 20,
    /** Boost for complex architecture patterns */
    COMPLEX_ARCHITECTURE: 15,
    // ... documented values
  },
} as const;
```

---

#### Requirement P1-3: Refactor Root-Level Service Cleanup Pattern

**User Story:** As a developer, I want services to use safe cleanup patterns, so that root-level services do not accumulate memory leaks over the application lifetime.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:274-276, 979-984`

**Problem**: Service is `providedIn: 'root'` but implements manual `ngOnDestroy` cleanup. Root services are never destroyed.

#### Acceptance Criteria

1. WHEN the service manages event listeners THEN it SHALL use `DestroyRef` injection pattern
2. WHEN event listeners are registered THEN they SHALL be automatically cleaned up via Angular's lifecycle
3. WHEN the service is provided at root THEN cleanup logic SHALL account for root service lifecycle
4. WHEN message listeners are added THEN duplicate registration SHALL be prevented

**Options**:

- Use `takeUntilDestroyed()` with component-level `DestroyRef`
- Change to component-level provided service if appropriate
- Implement manual listener management with deduplication

---

#### Requirement P1-4: Decompose Large Analysis Results Component

**User Story:** As a developer maintaining the setup wizard, I want manageable component sizes, so that templates are easy to test, debug, and maintain.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts:42-521`

**Problem**: 479-line inline template with 4-5 levels of nesting.

#### Acceptance Criteria

1. WHEN analysis results are displayed THEN they SHALL use dedicated sub-components
2. WHEN sub-components are created THEN each SHALL be under 150 lines
3. WHEN sub-components are created THEN they SHALL be standalone components
4. WHEN the parent component is refactored THEN it SHALL primarily compose sub-components

**Suggested Decomposition**:

- `ArchitecturePatternsCardComponent`
- `KeyFileLocationsCardComponent`
- `CodeHealthCardComponent`
- `TechStackSummaryComponent`

---

#### Requirement P1-5: Standardize Error Handling Pattern

**User Story:** As a user of the setup wizard, I want consistent error feedback, so that I understand what went wrong regardless of which step fails.

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts` - Uses `Result<T, Error>`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts:175-199` - try-catch with signal
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts:466-510` - Different try-catch pattern

**Problem**: Three different error handling approaches across related code.

#### Acceptance Criteria

1. WHEN an error occurs in any wizard component THEN error feedback SHALL follow the same pattern
2. WHEN backend returns an error THEN the frontend SHALL display it consistently
3. WHEN an operation fails THEN the user SHALL see actionable error messages
4. WHEN error handling is implemented THEN it SHALL include retry capability where appropriate

---

#### Requirement P1-6: Add Runtime Validation for Dynamic Service Resolution

**User Story:** As a developer, I want dynamic service resolution to fail loudly, so that DI container misconfigurations are caught immediately rather than causing silent failures.

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts:97-104`

**Problem**: Type assertion without runtime validation; container registration not verified.

#### Acceptance Criteria

1. WHEN a service is resolved from the container THEN its existence SHALL be verified before use
2. WHEN resolution fails THEN a descriptive error SHALL be thrown with service name and context
3. WHEN type assertions are used THEN they SHALL be preceded by runtime checks
4. WHEN services are lazily imported THEN import failures SHALL be caught and logged

**Implementation Pattern**:

```typescript
const service = container.resolve(SetupWizardService);
if (!service) {
  throw new Error('SetupWizardService not registered in DI container');
}
```

---

#### Requirement P1-7: Add Logging for Template Fallback Path

**User Story:** As a developer debugging template issues, I want clear logs when fallback paths are used, so that I know whether templates are loading from the correct location.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts:362-389`

**Problem**: Fallback to workspace templates silently masks extension deployment issues.

#### Acceptance Criteria

1. WHEN extension template path fails THEN the fallback SHALL be logged with WARNING level
2. WHEN fallback is used THEN the log SHALL include both attempted path and fallback path
3. WHEN in production mode THEN fallback usage SHALL trigger additional alerting
4. WHEN template loading succeeds THEN DEBUG level SHALL log which path was used

---

#### Requirement P1-8: Add Null Check for KeyFileLocations Arrays

**User Story:** As a user viewing analysis results, I want the UI to handle missing data gracefully, so that undefined arrays do not crash the component.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts:150-261`

**Problem**: `@for` directive does not use optional chaining, causing crash if array is undefined.

#### Acceptance Criteria

1. WHEN iterating over keyFileLocations arrays THEN null coalescing SHALL provide empty array default
2. WHEN any analysis sub-property is undefined THEN the UI SHALL display "No data available" state
3. WHEN template guards are used THEN both `@if` and `@for` SHALL handle undefined consistently
4. WHEN edge case tests run THEN undefined arrays SHALL not cause template errors

**Implementation Pattern**:

```typescript
@for (file of (analysis.keyFileLocations.entryPoints ?? []); track file) {
```

---

#### Requirement P1-9: Verify Backend Acknowledgment Before Step Transition

**User Story:** As a user, I want confirmation that my selections were saved before proceeding, so that I do not advance to generation with unconfirmed data.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts:494-498`

**Problem**: Step transition happens immediately without verifying backend acknowledgment.

#### Acceptance Criteria

1. WHEN agent selection is submitted THEN the frontend SHALL wait for backend acknowledgment
2. WHEN acknowledgment is received THEN the step transition SHALL proceed
3. WHEN acknowledgment fails THEN an error SHALL be displayed and step SHALL NOT change
4. WHEN RPC response includes success status THEN it SHALL be verified before proceeding

---

#### Requirement P1-10: Add Retry Count Limit with Backoff

**User Story:** As a user retrying failed generation items, I want a reasonable retry limit, so that I am not stuck in an infinite retry loop.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts:428-444`

**Problem**: User can retry indefinitely with no backoff.

#### Acceptance Criteria

1. WHEN an item is retried THEN the retry count SHALL be tracked per item
2. WHEN retry count exceeds maximum (e.g., 3) THEN further retries SHALL be disabled with explanation
3. WHEN multiple retries occur THEN exponential backoff SHALL be applied
4. WHEN max retries is reached THEN a "Contact support" or alternative action SHALL be offered

---

#### Requirement P1-11: Add Fallback Category for Unknown Agent Types

**User Story:** As a user viewing agent recommendations, I want all agents displayed, so that new categories added by the backend are not silently hidden.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts:278-285`

**Problem**: Hardcoded `categoryOrder` array hides agents with unknown categories.

#### Acceptance Criteria

1. WHEN agents are grouped by category THEN unknown categories SHALL be displayed in an "Other" section
2. WHEN new categories are added to backend THEN frontend SHALL not require code changes to display them
3. WHEN categoryOrder is used THEN it SHALL only affect ordering, not filtering
4. WHEN agents exist in unknown categories THEN they SHALL appear after known categories

---

#### Requirement P1-12: Convert JavaScript Validation Script to TypeScript

**User Story:** As a developer, I want all scripts in TypeScript, so that the codebase has consistent type safety.

**File**: `D:\projects\ptah-extension\scripts\validate-orchestration-skill.js`

**Problem**: 520-line JavaScript file in TypeScript codebase loses type safety benefits.

#### Acceptance Criteria

1. WHEN the validation script is migrated THEN it SHALL be TypeScript (.ts extension)
2. WHEN TypeScript is used THEN shared types SHALL be imported from the codebase
3. WHEN the script is compiled THEN it SHALL produce no TypeScript errors
4. WHEN the script executes THEN behavior SHALL be identical to the JavaScript version

---

#### Requirement P1-13: Add External URL Feedback

**User Story:** As a user clicking the upgrade button, I want visual feedback, so that I know my action was registered even if the browser takes time to open.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts:202-210`

**Problem**: No success/failure feedback when clicking upgrade button.

#### Acceptance Criteria

1. WHEN the upgrade button is clicked THEN a loading state SHALL be shown
2. WHEN the URL opens successfully THEN the loading state SHALL clear
3. WHEN the URL fails to open THEN an error message SHALL be displayed
4. WHEN a timeout occurs (e.g., 3 seconds) THEN fallback instructions SHALL be shown

---

### P2 - Moderate/Minor Issues (Can Address Later)

These issues are documented but not required for initial release:

| ID    | Issue                                 | File                                       | Effort |
| ----- | ------------------------------------- | ------------------------------------------ | ------ | -------------- | --- |
| P2-1  | Unused `signal` import                | generation-progress.component.ts:1         | XS     |
| P2-2  | Missing explicit return types         | orchestration-namespace.builder.ts:158-172 | XS     |
| P2-3  | Inconsistent JSDoc style              | Multiple files                             | S      |
| P2-4  | Empty imports array                   | generation-progress.component.ts:41        | XS     |
| P2-5  | Console.error instead of logger       | agent-selection.component.ts:506           | XS     |
| P2-6  | Hardcoded pricing URL                 | premium-upsell.component.ts:209            | XS     |
| P2-7  | Inconsistent null handling (`??` vs ` |                                            | `)     | Multiple files | S   |
| P2-8  | Missing aria-describedby              | generation-progress.component.ts           | S      |
| P2-9  | Long computed signal chains           | setup-wizard-state.service.ts:540-548      | M      |
| P2-10 | Complex template expressions          | analysis-results.component.ts:116-117      | XS     |
| P2-11 | Inconsistent method visibility        | Multiple files                             | S      |
| P2-12 | Category icons use emoji              | agent-selection.component.ts:395-410       | S      |
| P2-13 | Score has no minimum check            | agent-recommendation.service.ts:510        | XS     |
| P2-14 | Missing ARIA live region              | generation-progress.component.ts           | S      |
| P2-15 | No debounce on collapse/expand        | analysis-results.component.ts              | S      |
| P2-16 | Stale data shown after re-scan        | analysis-results.component.ts              | M      |
| P2-17 | No loading state in completion        | completion.component.ts                    | S      |
| P2-18 | Extension URI fallback logging        | skill-generator.service.ts:92-103          | XS     |
| P2-19 | Import organization inconsistency     | Multiple files                             | S      |

---

## Non-Functional Requirements

### Performance Requirements

- **Response Time**: Template processing shall complete within 500ms for typical configurations
- **Memory**: No memory leaks after wizard lifecycle (validated via heap snapshot comparison)
- **Bundle Size**: Type consolidation shall not increase bundle size by more than 1KB

### Reliability Requirements

- **Error Recovery**: All async operations shall have timeout and retry mechanisms
- **Graceful Degradation**: Missing optional data shall display placeholder UI, not crash
- **Cleanup**: All subscriptions and listeners shall be cleaned up on component destruction

### Maintainability Requirements

- **Component Size**: No component shall exceed 300 lines (template + logic combined)
- **Type Safety**: No `unknown` or `any` types in message payload handling
- **Constants**: All magic numbers shall be named constants with documentation

---

## Dependencies Between Fixes

```
P0-3 (Message Type Safety)
    └── Depends on: P1-1 (Shared Types) for consistent type definitions

P1-1 (Shared Types)
    └── Enables: P0-5 (RPC Validation), P0-3 (Message Types)
    └── No blockers

P1-4 (Component Decomposition)
    └── Depends on: P1-8 (Null Checks) - fix data issues before extracting components
    └── Can parallel with other P1 items

P1-5 (Error Handling Standardization)
    └── Should complete before: P1-9 (Backend Acknowledgment), P1-10 (Retry Limits)
    └── Establishes pattern for others to follow

P0-1 (Double Invocation), P0-2 (Unused Import), P0-4 (ngOnDestroy), P0-6 (Template Escape)
    └── Independent - can be done in parallel
```

**Recommended Execution Order**:

1. **Batch 1** (Independent P0): P0-1, P0-2, P0-4, P0-6
2. **Batch 2** (Foundation): P1-1 (Shared Types), P1-2 (Scoring Constants)
3. **Batch 3** (Dependent P0): P0-3, P0-5
4. **Batch 4** (UI Fixes): P1-4, P1-8, P1-9, P1-11
5. **Batch 5** (Patterns): P1-3, P1-5, P1-6, P1-7, P1-10
6. **Batch 6** (Cleanup): P1-12, P1-13

---

## Effort Estimate

| Priority | Issue Count | Estimated Effort     | Confidence |
| -------- | ----------- | -------------------- | ---------- |
| P0       | 6           | 4-6 hours            | High       |
| P1       | 13          | 8-12 hours           | Medium     |
| P2       | 19          | 6-8 hours (deferred) | Low        |

**Total for P0+P1**: 12-18 hours (1.5-2.5 developer days)

**Breakdown by Category**:
| Category | Issues | Effort |
|----------|--------|--------|
| Type System (P1-1, P0-3) | 2 | 3-4h |
| Error Handling (P1-5, P1-6, P1-7, P1-13) | 4 | 3-4h |
| Cleanup/Lifecycle (P0-4, P1-3) | 2 | 2-3h |
| Validation (P0-5, P0-6, P1-8) | 3 | 2-3h |
| Code Quality (P0-1, P0-2, P1-2, P1-4) | 4 | 3-4h |
| UI/UX (P1-9, P1-10, P1-11) | 3 | 2-3h |

---

## Out of Scope

The following items are explicitly **NOT** part of this task:

1. **New Features**: No new wizard functionality will be added
2. **Architecture Changes**: No fundamental restructuring of the wizard flow
3. **P2 Issues**: Minor/moderate issues deferred to future task
4. **Implicit Requirements**: Items like offline handling, concurrent session prevention, operation cancellation, and progress persistence are valid concerns but out of scope for this bugfix task
5. **Test Coverage**: While fixes should include tests, comprehensive test suite expansion is a separate task
6. **Performance Optimization**: Beyond fixing the double-invocation bug, no performance work
7. **Backward Compatibility**: Direct fixes only, no compatibility layer for existing behavior

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder      | Impact | Needs                                                         |
| ---------------- | ------ | ------------------------------------------------------------- |
| End Users        | High   | Reliable wizard experience without crashes or silent failures |
| Development Team | High   | Maintainable code with clear patterns                         |
| QA Team          | Medium | Testable components with predictable behavior                 |

### Success Metrics

| Metric              | Target                | Measurement                  |
| ------------------- | --------------------- | ---------------------------- |
| Code Style Score    | >= 8/10               | Re-review after fixes        |
| Code Logic Score    | >= 8/10               | Re-review after fixes        |
| Zero Runtime Errors | 0 P0/P1 bugs          | Manual testing of edge cases |
| Type Safety         | No `unknown` payloads | TypeScript compilation       |

---

## Risk Assessment

| Risk                                           | Probability | Impact | Mitigation                                             |
| ---------------------------------------------- | ----------- | ------ | ------------------------------------------------------ |
| Type extraction breaks existing code           | Medium      | High   | Comprehensive import updates, incremental migration    |
| Component decomposition introduces regressions | Medium      | Medium | Maintain existing behavior, add component tests        |
| Error handling changes affect UX               | Low         | Medium | Preserve existing error messages, only add consistency |
| Shared types cause circular dependencies       | Low         | High   | Follow existing library dependency rules               |

---

## Quality Gates

Before marking this task complete:

- [ ] All P0 issues resolved and verified
- [ ] All P1 issues resolved and verified
- [ ] No new TypeScript errors introduced
- [ ] No new ESLint errors introduced
- [ ] Existing tests pass
- [ ] New tests added for critical fixes (P0-1, P0-5, P0-6)
- [ ] Manual smoke test of wizard flow
- [ ] Re-review scores >= 8/10

---

## Files Reference

### Files Requiring P0 Fixes

1. `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`
2. `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`
3. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
4. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
5. `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`

### Files Requiring P1 Fixes

6. `D:\projects\ptah-extension\libs\shared\src\lib\types\` (new shared types location)
7. `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\analysis.types.ts`
8. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
9. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
10. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`
11. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts`
12. `D:\projects\ptah-extension\scripts\validate-orchestration-skill.js` -> `.ts`

---

_Document created: 2026-01-22_
_Task: TASK_2025_113_
_Source: TASK_2025_111 QA Reviews_
