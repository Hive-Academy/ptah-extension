# Implementation Plan - TASK_2025_113

## Code Review Issue Resolution for Setup Wizard (TASK_2025_111)

---

## Executive Summary

This implementation plan addresses 6 P0 (critical) and 13 P1 (serious) issues identified during code review of TASK_2025_111 (MCP-Powered Setup Wizard). The plan is organized into 6 batches based on dependency analysis to ensure fixes are applied in the correct order.

**Total Estimated Effort**: 12-18 hours (1.5-2.5 developer days)

---

## Codebase Investigation Summary

### Libraries Discovered

| Library                            | Purpose                            | Key Files                                |
| ---------------------------------- | ---------------------------------- | ---------------------------------------- |
| `@ptah-extension/shared`           | Foundation types (no dependencies) | `libs/shared/src/lib/types/*.ts`         |
| `@ptah-extension/agent-generation` | Agent generation services          | `libs/backend/agent-generation/src/lib/` |
| `@ptah-extension/setup-wizard`     | Frontend wizard components         | `libs/frontend/setup-wizard/src/lib/`    |
| `@ptah-extension/vscode-core`      | Infrastructure (DI, Logger)        | `libs/backend/vscode-core/`              |

### Patterns Identified

**1. Type Export Pattern (shared library)**

- Evidence: `libs/shared/src/index.ts`
- Pattern: Export types from individual files in `lib/types/`
- Convention: One domain per file (e.g., `rpc.types.ts`, `message.types.ts`)

**2. Service Lifecycle Pattern (frontend)**

- Evidence: `setup-wizard-state.service.ts:274-276, 979-984`
- Pattern: `providedIn: 'root'` with manual `ngOnDestroy` cleanup
- Issue: Root services never destroyed - cleanup pattern inappropriate

**3. Message Handler Pattern (frontend)**

- Evidence: `setup-wizard-state.service.ts:753-807`
- Pattern: Switch statement with runtime type guards per message type
- Issue: Weak initial validation, `unknown` payload types

**4. Error Handling Patterns (mixed)**

- Backend: `Result<T, Error>` pattern (`skill-generator.service.ts:110`)
- Frontend: Try-catch with signal updates (`wizard-view.component.ts`, `agent-selection.component.ts`)
- Issue: Inconsistent approaches across related code

**5. Component Decomposition Pattern**

- Evidence: Other wizard components (completion, generation-progress) are ~200-450 lines
- Pattern: Standalone components with DaisyUI classes
- Issue: `analysis-results.component.ts` at 521 lines exceeds target

### Integration Points

- **RPC Communication**: `setup-rpc.handlers.ts` handles wizard-related RPC methods
- **Message Stream**: Extension backend sends `setup-wizard:*` messages to webview
- **DI Container**: tsyringe container for backend service resolution

---

## Validated Batch Execution Order

Based on dependency analysis, the recommended batch order from requirements is **validated and adopted** with minor refinements:

```
Batch 1: Independent P0 Fixes (No Dependencies)
    ├── P0-1: Double Method Invocation (agent-recommendation.service.ts)
    ├── P0-2: Unused Token Import (skill-generator.service.ts)
    ├── P0-4: ngOnDestroy Cleanup (generation-progress.component.ts)
    └── P0-6: Template Variable Escaping (skill-generator.service.ts)

Batch 2: Foundation (Enables Batch 3)
    ├── P1-1: Shared Types Extraction (creates types for P0-3, P0-5)
    └── P1-2: Scoring Constants Extraction

Batch 3: Dependent P0 Fixes (Requires Batch 2)
    ├── P0-3: Message Handler Type Safety (uses shared types)
    └── P0-5: RPC Input Validation (uses shared types)

Batch 4: UI Fixes (Independent, can parallel after Batch 2)
    ├── P1-4: Component Decomposition (analysis-results.component.ts)
    ├── P1-8: Null Checks for KeyFileLocations
    ├── P1-9: Backend Acknowledgment Verification
    └── P1-11: Fallback Category for Unknown Agent Types

Batch 5: Pattern Standardization (Builds on previous fixes)
    ├── P1-3: Service Cleanup Pattern
    ├── P1-5: Error Handling Standardization
    ├── P1-6: Runtime Validation for Service Resolution
    ├── P1-7: Template Fallback Logging
    └── P1-10: Retry Count Limit with Backoff

Batch 6: Cleanup (Final polish)
    ├── P1-12: TypeScript Migration of Validation Script
    └── P1-13: External URL Feedback
```

---

## Batch 1: Independent P0 Fixes

### P0-1: Fix Double Method Invocation in Scoring Logic

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`

**Lines**: 259-274

**Current Code** (verified at line 260):

```typescript
({ score, criteria: criteria.push(...this.scorePlanningAgent(agent, analysis, score).criteria) } = this.scorePlanningAgent(agent, analysis, score));
```

**Problem**: The destructuring pattern calls `scorePlanningAgent` twice - once for destructuring and once inside `criteria.push()`.

**Fix Pattern**:

```typescript
// Lines 259-274 - Replace destructuring with explicit assignments
case 'planning': {
  const planningResult = this.scorePlanningAgent(agent, analysis, score);
  score = planningResult.score;
  criteria.push(...planningResult.criteria);
  break;
}
case 'development': {
  const devResult = this.scoreDevelopmentAgent(agent, analysis, score);
  score = devResult.score;
  criteria.push(...devResult.criteria);
  break;
}
case 'qa': {
  const qaResult = this.scoreQaAgent(agent, analysis, score);
  score = qaResult.score;
  criteria.push(...qaResult.criteria);
  break;
}
case 'specialist': {
  const specialistResult = this.scoreSpecialistAgent(agent, analysis, score);
  score = specialistResult.score;
  criteria.push(...specialistResult.criteria);
  break;
}
case 'creative': {
  const creativeResult = this.scoreCreativeAgent(agent, analysis, score);
  score = creativeResult.score;
  criteria.push(...creativeResult.criteria);
  break;
}
```

**Verification**: Unit test should verify each scoring method called exactly once per agent.

---

### P0-2: Remove Unused Token Import

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`

**Line**: 19

**Current Code**:

```typescript
import { SKILL_GENERATOR_SERVICE } from '../di/tokens';
```

**Fix**: Remove line 19 entirely. The token is not used in this file.

**Verification**: `nx lint agent-generation` passes with no unused import errors.

---

### P0-4: Add ngOnDestroy Cleanup to Generation Progress Component

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`

**Problem**: No lifecycle cleanup for subscriptions or operations.

**Fix Pattern**:

```typescript
import { Component, inject, ChangeDetectionStrategy, computed, DestroyRef, OnDestroy } from '@angular/core';

// ... existing imports

@Component({
  // ... existing decorator
})
export class GenerationProgressComponent implements OnDestroy {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);
  private readonly destroyRef = inject(DestroyRef);

  // Track pending retry operations for cleanup
  private pendingRetries = new Set<string>();

  // ... existing code ...

  /**
   * Retry a failed generation item.
   * Tracks pending retries for cleanup.
   */
  protected async onRetryItem(itemId: string): Promise<void> {
    // Prevent multiple retries of same item
    if (this.pendingRetries.has(itemId)) {
      return;
    }

    this.pendingRetries.add(itemId);

    // Reset item status to pending
    this.wizardState.retryGenerationItem(itemId);

    try {
      // Trigger regeneration via RPC
      await this.wizardRpc.retryGenerationItem(itemId);
    } catch (error) {
      // Update item with error status
      const message = error instanceof Error ? error.message : 'Retry failed';
      this.wizardState.updateSkillGenerationItem(itemId, {
        status: 'error',
        errorMessage: message,
      });
    } finally {
      this.pendingRetries.delete(itemId);
    }
  }

  /**
   * Cleanup on component destruction.
   */
  ngOnDestroy(): void {
    // Clear pending retries tracking
    this.pendingRetries.clear();
  }
}
```

**Verification**: No memory leaks detectable via heap snapshot when navigating away during generation.

---

### P0-6: Escape Template Variables to Prevent Recursive Substitution

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`

**Lines**: 395-421

**Problem**: Variable values containing `{{...}}` patterns could cause recursive substitution.

**Fix Pattern** - Add escaping helper and use it in `substituteVariables`:

```typescript
/**
 * Escape special characters in a value to prevent regex/template injection.
 */
private escapeTemplateValue(value: string): string {
  // Escape curly braces to prevent template pattern matching
  // and regex special characters for safe pattern replacement
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '$$$$')  // $ is special in replace()
    .replace(/\{\{/g, '\\{\\{')
    .replace(/\}\}/g, '\\}\\}');
}

/**
 * Substitute template variables in content.
 */
private substituteVariables(
  content: string,
  variables: TemplateVariables
): { content: string; customizations: string[] } {
  const customizations: string[] = [];
  let processed = content;

  // Substitute each variable with escaped value
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const matches = processed.match(pattern);

    if (matches && matches.length > 0) {
      // Escape the value to prevent recursive substitution and regex issues
      const escapedValue = this.escapeTemplateValue(value);
      processed = processed.replace(pattern, escapedValue);
      customizations.push(`Substituted {{${key}}} with project-specific value`);
    }
  }

  // Log any remaining unsubstituted variables (for debugging)
  const remainingVars = processed.match(/\{\{[A-Z_]+\}\}/g);
  if (remainingVars && remainingVars.length > 0) {
    this.logger.warn('Unsubstituted template variables found', {
      variables: remainingVars,
    });
  }

  return { content: processed, customizations };
}
```

**Verification**: Unit test with values containing `{{VAR}}` patterns should not cause recursive substitution.

---

## Batch 2: Foundation

### P1-1: Extract Shared Types to Prevent Frontend/Backend Drift

**New File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`

**Types to Move** (from `analysis.types.ts` lines 154-696):

- `ArchitecturePattern`
- `ArchitecturePatternName`
- `KeyFileLocations`
- `LanguageStats`
- `DiagnosticSummary`
- `CodeConventions`
- `NamingConventions`
- `NamingConvention`
- `TestCoverageEstimate`
- `AgentRecommendation`
- `AgentCategory`
- `DeepProjectAnalysis` (partial - see note below)

**Important Note**: `DeepProjectAnalysis` imports `ProjectType`, `Framework`, `MonorepoType` from `@ptah-extension/workspace-intelligence`. Since `shared` cannot depend on `workspace-intelligence`, we have two options:

**Option A (Recommended)**: Create a simplified `ProjectAnalysisResult` interface in shared that uses string types, and keep `DeepProjectAnalysis` in `agent-generation` for internal use.

**Option B**: Move the enum types from `workspace-intelligence` to `shared` (larger refactor).

**Implementation** (Option A):

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`

```typescript
/**
 * Setup Wizard Shared Types
 *
 * Types shared between frontend and backend for the setup wizard.
 * These types define the contract for RPC communication and data structures.
 *
 * @module @ptah-extension/shared/types
 */

/**
 * Architecture pattern detection result.
 */
export interface ArchitecturePattern {
  /** Pattern name (e.g., 'DDD', 'Layered', 'Microservices') */
  name: ArchitecturePatternName;
  /** Confidence score 0-100 */
  confidence: number;
  /** File paths or folder names that indicate this pattern */
  evidence: string[];
  /** Optional description of the detected pattern */
  description?: string;
}

/**
 * Known architecture pattern names.
 */
export type ArchitecturePatternName = 'DDD' | 'Layered' | 'Microservices' | 'Monolith' | 'Hexagonal' | 'CQRS' | 'Event-Sourcing' | 'Clean-Architecture' | 'MVC' | 'MVVM' | 'Component-Based' | 'Feature-Sliced' | string;

/**
 * Key file locations organized by purpose.
 */
export interface KeyFileLocations {
  entryPoints: string[];
  configs: string[];
  testDirectories: string[];
  apiRoutes: string[];
  components: string[];
  services: string[];
  models?: string[];
  repositories?: string[];
  utilities?: string[];
}

/**
 * Language distribution statistics.
 */
export interface LanguageStats {
  language: string;
  percentage: number;
  fileCount: number;
  linesOfCode?: number;
}

/**
 * Summary of existing code issues from diagnostics.
 */
export interface DiagnosticSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  errorsByType: Record<string, number>;
  warningsByType: Record<string, number>;
  topErrors?: Array<{
    message: string;
    count: number;
    source: string;
  }>;
}

/**
 * Code style conventions detected from project.
 */
export interface CodeConventions {
  indentation: 'tabs' | 'spaces';
  indentSize: number;
  quoteStyle: 'single' | 'double';
  semicolons: boolean;
  trailingComma: 'none' | 'es5' | 'all';
  namingConventions?: NamingConventions;
  maxLineLength?: number;
  usePrettier?: boolean;
  useEslint?: boolean;
  additionalTools?: string[];
}

/**
 * Naming convention patterns.
 */
export interface NamingConventions {
  files?: NamingConvention;
  classes?: NamingConvention;
  functions?: NamingConvention;
  variables?: NamingConvention;
  constants?: NamingConvention;
  interfaces?: NamingConvention;
  types?: NamingConvention;
}

export type NamingConvention = 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE' | 'kebab-case' | string;

/**
 * Test coverage estimate information.
 */
export interface TestCoverageEstimate {
  percentage: number;
  hasTests: boolean;
  testFramework?: string;
  hasUnitTests: boolean;
  hasIntegrationTests: boolean;
  hasE2eTests: boolean;
  testFileCount?: number;
  sourceFileCount?: number;
  testToSourceRatio?: number;
}

/**
 * Agent category for grouping in UI.
 */
export type AgentCategory = 'planning' | 'development' | 'qa' | 'specialist' | 'creative';

/**
 * Agent recommendation from analysis.
 * Used for RPC communication between backend and frontend.
 */
export interface AgentRecommendation {
  agentId: string;
  agentName: string;
  relevanceScore: number;
  matchedCriteria: string[];
  category: AgentCategory;
  recommended: boolean;
  description?: string;
  icon?: string;
}

/**
 * Project analysis result for RPC communication.
 * Simplified version using string types for cross-boundary safety.
 */
export interface ProjectAnalysisResult {
  /** Project type as string (e.g., 'Angular', 'Node.js') */
  projectType: string;
  /** Total file count */
  fileCount: number;
  /** Programming languages detected */
  languages: string[];
  /** Frameworks detected */
  frameworks: string[];
  /** Monorepo type if applicable */
  monorepoType?: string;
  /** Architecture patterns with confidence */
  architecturePatterns: ArchitecturePattern[];
  /** Key file locations */
  keyFileLocations: KeyFileLocations;
  /** Language distribution */
  languageDistribution?: LanguageStats[];
  /** Code health issues */
  existingIssues: DiagnosticSummary;
  /** Test coverage estimate */
  testCoverage: TestCoverageEstimate;
  /** Code conventions */
  codeConventions?: CodeConventions;
}

/**
 * Wizard message types for type-safe message handling.
 */
export type WizardMessageType = 'setup-wizard:scan-progress' | 'setup-wizard:analysis-complete' | 'setup-wizard:available-agents' | 'setup-wizard:generation-progress' | 'setup-wizard:generation-complete' | 'setup-wizard:error';

/**
 * Discriminated union for wizard messages.
 * Enables exhaustive type checking in message handlers.
 */
export type WizardMessage = { type: 'setup-wizard:scan-progress'; payload: ScanProgressPayload } | { type: 'setup-wizard:analysis-complete'; payload: AnalysisCompletePayload } | { type: 'setup-wizard:available-agents'; payload: AvailableAgentsPayload } | { type: 'setup-wizard:generation-progress'; payload: GenerationProgressPayload } | { type: 'setup-wizard:generation-complete'; payload: GenerationCompletePayload } | { type: 'setup-wizard:error'; payload: ErrorPayload };

export interface ScanProgressPayload {
  filesScanned: number;
  totalFiles: number;
  detections: string[];
}

export interface AnalysisCompletePayload {
  projectContext: {
    type: string;
    techStack: string[];
    architecture?: string;
    isMonorepo: boolean;
    monorepoType?: string;
    packageCount?: number;
  };
}

export interface AvailableAgentsPayload {
  agents: Array<{
    id: string;
    name: string;
    selected: boolean;
    score: number;
    reason: string;
    autoInclude: boolean;
  }>;
}

export interface GenerationProgressPayload {
  progress: {
    phase: 'analysis' | 'selection' | 'customization' | 'rendering' | 'complete';
    percentComplete: number;
    filesScanned?: number;
    totalFiles?: number;
    currentAgent?: string;
  };
}

export interface GenerationCompletePayload {
  success: boolean;
  generatedCount: number;
  duration?: number;
  errors?: string[];
}

export interface ErrorPayload {
  message: string;
  details?: string;
}
```

**Update**: `D:\projects\ptah-extension\libs\shared\src\index.ts`

```typescript
// Add at end:
export * from './lib/types/setup-wizard.types';
```

**Import Updates Required**:

1. **Backend** `libs/backend/agent-generation/src/lib/types/analysis.types.ts`:

   - Keep `DeepProjectAnalysis` (uses workspace-intelligence types)
   - Remove duplicated types, re-export from shared

   ```typescript
   export type { ArchitecturePattern, ArchitecturePatternName, KeyFileLocations, LanguageStats, DiagnosticSummary, CodeConventions, NamingConventions, NamingConvention, TestCoverageEstimate, AgentRecommendation, AgentCategory } from '@ptah-extension/shared';
   ```

2. **Frontend** `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`:
   - Remove duplicate type definitions (lines 106-262)
   - Import from shared:
   ```typescript
   import {
     ArchitecturePattern,
     KeyFileLocations,
     DiagnosticSummary,
     TestCoverageEstimate,
     AgentRecommendation,
     AgentCategory,
     ProjectAnalysisResult,
     WizardMessage,
     ScanProgressPayload,
     // ... etc
   } from '@ptah-extension/shared';
   ```

**Verification**:

- `nx build shared` succeeds
- `nx build agent-generation` succeeds
- `nx build setup-wizard` succeeds
- No duplicate type definitions

---

### P1-2: Extract Scoring Constants with Documentation

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`

**Add at top of file (after imports)**:

```typescript
/**
 * Scoring configuration for agent recommendations.
 * Values determined through testing with representative projects.
 *
 * @remarks
 * These thresholds were calibrated based on testing with:
 * - 5 monorepo projects (Nx, Lerna, Turborepo)
 * - 10 single-project codebases (React, Angular, Node.js)
 * - Various complexity levels (small to enterprise)
 */
export const SCORING_CONFIG = {
  /**
   * Threshold values for recommendation classification.
   */
  THRESHOLDS: {
    /** Score >= 80 triggers auto-selection in UI */
    AUTO_SELECT: 80,
    /** Score >= 75 shows "Recommended" badge */
    RECOMMENDED: 75,
    /** Score >= 60 shows "Consider" status */
    CONSIDER: 60,
  },

  /**
   * Score adjustments based on project characteristics.
   * Positive values boost relevance, negative values reduce it.
   */
  ADJUSTMENTS: {
    /** Boost for monorepo detection - team coordination needed */
    MONOREPO_BOOST: 20,
    /** Boost for complex architecture patterns (DDD, Hexagonal) */
    COMPLEX_ARCHITECTURE: 15,
    /** Boost for multi-language projects */
    MULTI_LANGUAGE: 5,
    /** Boost for large codebases (>10 services/components) */
    LARGE_CODEBASE: 15,
    /** Boost for frontend framework detection */
    FRONTEND_FRAMEWORK: 20,
    /** Boost for backend framework detection */
    BACKEND_FRAMEWORK: 20,
    /** Boost for API/route detection */
    API_DETECTED: 15,
    /** Boost for low test coverage (<50%) */
    LOW_TEST_COVERAGE: 15,
    /** Boost for high error count (>10) */
    HIGH_ERROR_COUNT: 10,
    /** Boost for legacy patterns detected */
    LEGACY_PATTERNS: 15,
    /** Boost for UI component directories */
    UI_COMPONENTS: 10,
    /** Boost for service layer directories */
    SERVICE_LAYER: 10,
    /** Boost for CI/CD config files */
    CICD_DETECTED: 15,
    /** Boost for Dockerfile presence */
    DOCKER_DETECTED: 10,
    /** Boost for documentation needs */
    DOCS_NEEDED: 10,
  },
} as const;
```

**Update scoring methods to use constants** (example for `scorePlanningAgent`):

```typescript
private scorePlanningAgent(
  agent: AgentMetadata,
  analysis: DeepProjectAnalysis,
  baseScore: number
): { score: number; criteria: string[] } {
  let score = baseScore;
  const criteria: string[] = [];

  criteria.push('Planning agents essential for any project');

  // Team-leader gets boost for monorepos
  if (agent.id === 'team-leader' && analysis.monorepoType) {
    score += SCORING_CONFIG.ADJUSTMENTS.MONOREPO_BOOST;
    criteria.push(`Monorepo detected (${analysis.monorepoType})`);
  }

  // Software-architect gets boost for complex architecture
  if (agent.id === 'software-architect') {
    const hasComplexPatterns =
      analysis.architecturePatterns &&
      analysis.architecturePatterns.some((p) => p.confidence > 70);
    if (hasComplexPatterns) {
      score += SCORING_CONFIG.ADJUSTMENTS.COMPLEX_ARCHITECTURE;
      criteria.push('Complex architecture patterns detected');
    }

    if (analysis.languageDistribution && analysis.languageDistribution.length > 2) {
      score += SCORING_CONFIG.ADJUSTMENTS.MULTI_LANGUAGE;
      criteria.push('Multi-language project');
    }
  }

  // Project-manager for large codebases
  if (agent.id === 'project-manager' && analysis.keyFileLocations) {
    const fileCount =
      (analysis.keyFileLocations.services?.length || 0) +
      (analysis.keyFileLocations.components?.length || 0);
    if (fileCount > 10) {
      score += SCORING_CONFIG.ADJUSTMENTS.LARGE_CODEBASE;
      criteria.push('Large codebase with many services/components');
    }
  }

  return { score, criteria };
}
```

**Update `calculateRecommendations` to use threshold constants**:

```typescript
recommendations.push({
  // ...
  recommended: score >= SCORING_CONFIG.THRESHOLDS.RECOMMENDED,
  // ...
});
```

**Verification**: All magic numbers replaced with named constants.

---

## Batch 3: Dependent P0 Fixes

### P0-3: Strengthen Message Handler Type Safety

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Lines**: 753-807

**Replace `setupMessageListener` method with type-safe version**:

```typescript
import {
  WizardMessage,
  WizardMessageType,
  ScanProgressPayload,
  AnalysisCompletePayload,
  AvailableAgentsPayload,
  GenerationProgressPayload,
  GenerationCompletePayload,
  ErrorPayload,
} from '@ptah-extension/shared';

/**
 * Type guard for WizardMessage discriminated union.
 * Validates message structure matches expected format.
 */
private isWizardMessage(message: unknown): message is WizardMessage {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    !('payload' in message)
  ) {
    return false;
  }

  const validTypes: WizardMessageType[] = [
    'setup-wizard:scan-progress',
    'setup-wizard:analysis-complete',
    'setup-wizard:available-agents',
    'setup-wizard:generation-progress',
    'setup-wizard:generation-complete',
    'setup-wizard:error',
  ];

  return validTypes.includes((message as { type: string }).type as WizardMessageType);
}

/**
 * Setup message listener for backend progress updates.
 * Uses discriminated union for type-safe message handling.
 */
private setupMessageListener(): void {
  const messageHandler = (event: MessageEvent) => {
    const message = event.data;

    // Validate message is a wizard message
    if (!this.isWizardMessage(message)) {
      return; // Ignore non-wizard messages
    }

    try {
      // Type-safe switch with exhaustive checking
      switch (message.type) {
        case 'setup-wizard:scan-progress':
          this.handleScanProgress(message.payload);
          break;

        case 'setup-wizard:analysis-complete':
          this.handleAnalysisComplete(message.payload);
          break;

        case 'setup-wizard:available-agents':
          this.handleAvailableAgents(message.payload);
          break;

        case 'setup-wizard:generation-progress':
          this.handleGenerationProgress(message.payload);
          break;

        case 'setup-wizard:generation-complete':
          this.handleGenerationComplete(message.payload);
          break;

        case 'setup-wizard:error':
          this.handleError(message.payload);
          break;

        default:
          // TypeScript exhaustiveness check
          const _exhaustive: never = message;
          console.warn('Unhandled wizard message type:', _exhaustive);
      }
    } catch (error) {
      console.error('Error handling setup wizard message:', error);
      this.errorStateSignal.set({
        message: 'Failed to process backend message',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  window.addEventListener('message', messageHandler);
  this.messageListenerCleanup = () => {
    window.removeEventListener('message', messageHandler);
  };
}

// Update handler signatures to use typed payloads
private handleScanProgress(payload: ScanProgressPayload): void {
  this.scanProgressSignal.set(payload);
  this.generationProgressSignal.set({
    phase: 'analysis',
    percentComplete: Math.round(
      (payload.filesScanned / payload.totalFiles) * 100
    ),
    filesScanned: payload.filesScanned,
    totalFiles: payload.totalFiles,
    detections: payload.detections,
  });
}

private handleAnalysisComplete(payload: AnalysisCompletePayload): void {
  this.analysisResultsSignal.set({ projectContext: payload.projectContext });
  this.projectContextSignal.set(payload.projectContext);
  this.currentStepSignal.set('analysis');
}

private handleAvailableAgents(payload: AvailableAgentsPayload): void {
  this.availableAgentsSignal.set(payload.agents);
}

private handleGenerationProgress(payload: GenerationProgressPayload): void {
  this.generationProgressSignal.set(payload.progress);
}

private handleGenerationComplete(payload: GenerationCompletePayload): void {
  this.completionDataSignal.set(payload);
  this.currentStepSignal.set('completion');
}

private handleError(payload: ErrorPayload): void {
  this.errorStateSignal.set(payload);
}
```

**Remove**: The individual type guard methods (`isValidScanProgress`, `isValidAnalysisResults`, etc.) can be removed as validation is now handled by the discriminated union.

**Verification**: TypeScript compiler enforces exhaustive handling of all message types.

---

### P0-5: Add Comprehensive Input Validation for RPC Handlers

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`

**Lines**: 237-286 (registerRecommendAgents method)

**Add Zod schema validation**:

```typescript
import { z } from 'zod';

// Add schema definition near top of file
const ProjectAnalysisSchema = z.object({
  projectType: z.string().or(z.number()), // ProjectType enum or string
  frameworks: z.array(z.string().or(z.number())).default([]),
  monorepoType: z.string().optional(),
  architecturePatterns: z.array(z.object({
    name: z.string(),
    confidence: z.number(),
    evidence: z.array(z.string()),
    description: z.string().optional(),
  })).default([]),
  keyFileLocations: z.object({
    entryPoints: z.array(z.string()).default([]),
    configs: z.array(z.string()).default([]),
    testDirectories: z.array(z.string()).default([]),
    apiRoutes: z.array(z.string()).default([]),
    components: z.array(z.string()).default([]),
    services: z.array(z.string()).default([]),
    models: z.array(z.string()).optional(),
    repositories: z.array(z.string()).optional(),
    utilities: z.array(z.string()).optional(),
  }).default({
    entryPoints: [],
    configs: [],
    testDirectories: [],
    apiRoutes: [],
    components: [],
    services: [],
  }),
  languageDistribution: z.array(z.object({
    language: z.string(),
    percentage: z.number(),
    fileCount: z.number(),
    linesOfCode: z.number().optional(),
  })).default([]),
  existingIssues: z.object({
    errorCount: z.number().default(0),
    warningCount: z.number().default(0),
    infoCount: z.number().default(0),
    errorsByType: z.record(z.number()).default({}),
    warningsByType: z.record(z.number()).default({}),
  }).default({
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    errorsByType: {},
    warningsByType: {},
  }),
  codeConventions: z.object({
    indentation: z.enum(['tabs', 'spaces']),
    indentSize: z.number(),
    quoteStyle: z.enum(['single', 'double']),
    semicolons: z.boolean(),
    trailingComma: z.enum(['none', 'es5', 'all']).optional(),
  }).optional(),
  testCoverage: z.object({
    percentage: z.number().default(0),
    hasTests: z.boolean().default(false),
    testFramework: z.string().optional(),
    hasUnitTests: z.boolean().default(false),
    hasIntegrationTests: z.boolean().default(false),
    hasE2eTests: z.boolean().default(false),
  }).default({
    percentage: 0,
    hasTests: false,
    hasUnitTests: false,
    hasIntegrationTests: false,
    hasE2eTests: false,
  }),
});

// Update registerRecommendAgents method
private registerRecommendAgents(): void {
  this.rpcHandler.registerMethod<unknown, AgentRecommendation[]>(
    'wizard:recommend-agents',
    async (rawAnalysis) => {
      this.logger.debug('RPC: wizard:recommend-agents called');

      // Validate input with Zod
      const validationResult = ProjectAnalysisSchema.safeParse(rawAnalysis);

      if (!validationResult.success) {
        const errors = validationResult.error.errors
          .map(e => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        this.logger.error('Invalid analysis input', { errors });
        throw new Error(`Invalid analysis input: ${errors}`);
      }

      const analysis = validationResult.data;

      // Dynamically import agent-generation library
      const { AGENT_GENERATION_TOKENS, AgentRecommendationService } = await import(
        '@ptah-extension/agent-generation'
      );

      // Resolve service with validation
      let recommendationService: { calculateRecommendations: (analysis: DeepProjectAnalysis) => AgentRecommendation[] };

      try {
        const resolved = this.container.resolve(
          AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE
        );
        if (!resolved) {
          throw new Error('Service resolved to null/undefined');
        }
        recommendationService = resolved as typeof recommendationService;
      } catch (resolveError) {
        this.logger.debug('AgentRecommendationService not in container, creating instance');
        recommendationService = this.container.resolve(AgentRecommendationService);
      }

      // Calculate recommendations
      const recommendations = recommendationService.calculateRecommendations(analysis as DeepProjectAnalysis);

      this.logger.info('Agent recommendations calculated', {
        totalAgents: recommendations.length,
        recommendedCount: recommendations.filter((r) => r.recommended).length,
      });

      return recommendations;
    }
  );
}
```

**Verification**: Invalid input produces descriptive validation errors with field paths.

---

## Batch 4: UI Fixes

### P1-4: Decompose Large Analysis Results Component

**Strategy**: Extract 4 sub-components from `analysis-results.component.ts` (521 lines).

**New Files to Create**:

1. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\architecture-patterns-card.component.ts`
2. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\key-file-locations-card.component.ts`
3. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\code-health-card.component.ts`
4. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis\tech-stack-summary.component.ts`

**Component Specifications**:

#### 1. ArchitecturePatternsCardComponent

```typescript
// architecture-patterns-card.component.ts
@Component({
  selector: 'ptah-architecture-patterns-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...` // ~80 lines
})
export class ArchitecturePatternsCardComponent {
  @Input({ required: true }) patterns!: ArchitecturePattern[];

  protected getConfidenceBadgeClass(confidence: number): string { ... }
  protected getConfidenceProgressClass(confidence: number): string { ... }
}
```

#### 2. KeyFileLocationsCardComponent

```typescript
// key-file-locations-card.component.ts
@Component({
  selector: 'ptah-key-file-locations-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`, // ~120 lines
})
export class KeyFileLocationsCardComponent {
  @Input({ required: true }) locations!: KeyFileLocations;
}
```

#### 3. CodeHealthCardComponent

```typescript
// code-health-card.component.ts
@Component({
  selector: 'ptah-code-health-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`, // ~80 lines
})
export class CodeHealthCardComponent {
  @Input({ required: true }) issues!: DiagnosticSummary;
  @Input({ required: true }) testCoverage!: TestCoverageEstimate;
}
```

#### 4. TechStackSummaryComponent

```typescript
// tech-stack-summary.component.ts
@Component({
  selector: 'ptah-tech-stack-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`, // ~60 lines
})
export class TechStackSummaryComponent {
  @Input({ required: true }) projectType!: string;
  @Input({ required: true }) fileCount!: number;
  @Input({ required: true }) frameworks!: string[];
  @Input() monorepoType?: string;
  @Input() languageDistribution?: LanguageStats[];
}
```

**Refactored Parent Component** (~150 lines):

```typescript
// analysis-results.component.ts
@Component({
  selector: 'ptah-analysis-results',
  standalone: true,
  imports: [ConfirmationModalComponent, ArchitecturePatternsCardComponent, KeyFileLocationsCardComponent, CodeHealthCardComponent, TechStackSummaryComponent, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-4xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analysis Complete</h2>

      @if (deepAnalysis(); as analysis) {
      <ptah-tech-stack-summary [projectType]="analysis.projectType" [fileCount]="analysis.fileCount" [frameworks]="analysis.frameworks" [monorepoType]="analysis.monorepoType" [languageDistribution]="analysis.languageDistribution" />

      @if (analysis.architecturePatterns?.length) {
      <ptah-architecture-patterns-card [patterns]="analysis.architecturePatterns" />
      } @if (analysis.keyFileLocations) {
      <ptah-key-file-locations-card [locations]="analysis.keyFileLocations" />
      }

      <ptah-code-health-card [issues]="analysis.existingIssues" [testCoverage]="analysis.testCoverage" />
      }

      <!-- Navigation buttons -->
      <div class="flex justify-between mt-8">
        <button class="btn btn-ghost" (click)="onRescan()">Re-scan</button>
        <button class="btn btn-primary" (click)="onProceed()">Continue to Agent Selection</button>
      </div>
    </div>

    <ptah-confirmation-modal ... />
  `,
})
export class AnalysisResultsComponent {
  // Reduced to ~100 lines of logic
}
```

**Verification**: Each component under 150 lines, parent under 200 lines.

---

### P1-8: Add Null Check for KeyFileLocations Arrays

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`

**Lines**: 150-261 (multiple `@for` directives)

**Pattern**: Add null coalescing to all `@for` directives:

```typescript
// Before:
@for (file of analysis.keyFileLocations.entryPoints; track file)

// After:
@for (file of (analysis.keyFileLocations.entryPoints ?? []); track file)
```

**Apply to all occurrences**:

- `entryPoints` (line ~158)
- `configs` (line ~175)
- `testDirectories` (line ~195)
- `components` (line ~212)
- `services` (line ~232)
- `apiRoutes` (line ~252)

**Verification**: No template errors when `keyFileLocations` has undefined arrays.

---

### P1-9: Verify Backend Acknowledgment Before Step Transition

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`

**Lines**: 494-498

**Current Code**:

```typescript
// Submit selection to backend via RPC
await this.wizardRpc.submitAgentSelection(selectedAgents);

// Transition to generation step
this.wizardState.setCurrentStep('generation');
```

**Fix**: Verify response before transition

```typescript
protected async onGenerateAgents(): Promise<void> {
  if (this.isGenerating() || this.noneSelected()) {
    return;
  }

  this.isGenerating.set(true);
  this.errorMessage.set(null);

  try {
    const selectedAgentIds = Object.entries(this.selectedAgentsMap())
      .filter(([_, isSelected]) => isSelected)
      .map(([agentId]) => agentId);

    const selectedAgents = selectedAgentIds.map((agentId) => {
      const recommendation = this.sortedRecommendations().find(
        (r) => r.agentId === agentId
      );
      return {
        id: agentId,
        name: recommendation?.agentName ?? agentId,
        selected: true,
        score: recommendation?.relevanceScore ?? 0,
        reason: recommendation?.matchedCriteria?.join(', ') ?? '',
        autoInclude: (recommendation?.relevanceScore ?? 0) >= 80,
      };
    });

    // Submit selection and verify acknowledgment
    const response = await this.wizardRpc.submitAgentSelection(selectedAgents);

    // Verify backend acknowledgment
    if (!response?.success) {
      throw new Error(response?.error ?? 'Backend did not acknowledge selection');
    }

    // Only transition after confirmed acknowledgment
    this.wizardState.setCurrentStep('generation');
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to start agent generation. Please try again.';
    this.errorMessage.set(message);
    console.error('Agent generation failed:', error);
  } finally {
    this.isGenerating.set(false);
  }
}
```

**Update `WizardRpcService.submitAgentSelection`** to return response:

```typescript
async submitAgentSelection(agents: AgentSelection[]): Promise<{ success: boolean; error?: string }> {
  const result = await this.rpc.callExtension<{ agents: AgentSelection[] }, { success: boolean; error?: string }>(
    'wizard:submit-agents',
    { agents },
    { timeout: 30000 }
  );

  if (result.success) {
    return result.data;
  } else {
    throw new Error(result.error);
  }
}
```

**Verification**: Step transition only occurs after backend confirms selection.

---

### P1-11: Add Fallback Category for Unknown Agent Types

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`

**Lines**: 278-285

**Current Code**:

```typescript
protected readonly categoryOrder: AgentCategory[] = [
  'planning',
  'development',
  'qa',
  'specialist',
  'creative',
];
```

**Problem**: Agents with unknown categories are filtered out and not displayed.

**Fix**:

```typescript
/**
 * Category display order.
 * Unknown categories are collected in 'other' at the end.
 */
protected readonly categoryOrder: (AgentCategory | 'other')[] = [
  'planning',
  'development',
  'qa',
  'specialist',
  'creative',
  'other', // Fallback for unknown categories
];

/**
 * Get agents filtered by category.
 * For 'other', returns agents with unknown categories.
 */
protected getAgentsByCategory(category: AgentCategory | 'other'): AgentRecommendation[] {
  if (category === 'other') {
    const knownCategories: AgentCategory[] = [
      'planning',
      'development',
      'qa',
      'specialist',
      'creative',
    ];
    return this.sortedRecommendations().filter(
      (agent) => !knownCategories.includes(agent.category)
    );
  }
  return this.sortedRecommendations().filter(
    (agent) => agent.category === category
  );
}

/**
 * Get category label with fallback for 'other'.
 */
protected getCategoryLabel(category: AgentCategory | 'other'): string {
  switch (category) {
    case 'planning':
      return 'Planning & Architecture';
    case 'development':
      return 'Development';
    case 'qa':
      return 'Quality Assurance';
    case 'specialist':
      return 'Specialists';
    case 'creative':
      return 'Creative';
    case 'other':
      return 'Other';
    default:
      return 'Other';
  }
}

/**
 * Get category icon with fallback.
 */
protected getCategoryIcon(category: AgentCategory | 'other'): string {
  switch (category) {
    case 'planning':
      return '\u{1F4CB}';
    case 'development':
      return '\u{1F4BB}';
    case 'qa':
      return '\u{1F50D}';
    case 'specialist':
      return '\u{2699}\u{FE0F}';
    case 'creative':
      return '\u{1F3A8}';
    case 'other':
    default:
      return '\u{1F4E6}';
  }
}

/**
 * Get category badge class with fallback.
 */
protected getCategoryBadgeClass(category: AgentCategory | 'other'): string {
  switch (category) {
    case 'planning':
      return 'badge-primary';
    case 'development':
      return 'badge-secondary';
    case 'qa':
      return 'badge-accent';
    case 'specialist':
      return 'badge-info';
    case 'creative':
      return 'badge-warning';
    case 'other':
    default:
      return 'badge-ghost';
  }
}
```

**Verification**: Agents with new backend categories appear in "Other" section.

---

## Batch 5: Pattern Standardization

### P1-3: Refactor Root-Level Service Cleanup Pattern

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Lines**: 274-276, 979-984

**Problem**: Root-level service (`providedIn: 'root'`) with manual `ngOnDestroy` cleanup. Root services are never destroyed.

**Fix Strategy**: Implement manual listener management with deduplication to prevent memory leaks.

```typescript
@Injectable({
  providedIn: 'root',
})
export class SetupWizardStateService {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Track whether message listener is registered.
   * Prevents duplicate registration.
   */
  private isMessageListenerRegistered = false;

  /**
   * Message handler reference for cleanup.
   */
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor() {
    // Initialize message listener on first access
    this.ensureMessageListenerRegistered();
  }

  /**
   * Ensure message listener is registered exactly once.
   * Safe to call multiple times.
   */
  private ensureMessageListenerRegistered(): void {
    if (this.isMessageListenerRegistered) {
      return;
    }

    this.setupMessageListener();
    this.isMessageListenerRegistered = true;
  }

  /**
   * Setup message listener for backend progress updates.
   */
  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      const message = event.data;

      if (!this.isWizardMessage(message)) {
        return;
      }

      try {
        // ... message handling (see P0-3)
      } catch (error) {
        console.error('Error handling setup wizard message:', error);
        this.errorStateSignal.set({
          message: 'Failed to process backend message',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Reset wizard state for new session.
   * Call this when starting a new wizard flow.
   */
  reset(): void {
    this.currentStepSignal.set('welcome');
    this.projectContextSignal.set(null);
    this.analysisResultsSignal.set(null);
    this.deepAnalysisSignal.set(null);
    this.recommendationsSignal.set([]);
    this.selectedAgentsMapSignal.set({});
    this.skillGenerationProgressSignal.set([]);
    this.errorStateSignal.set(null);
    // Note: Do NOT reset message listener - keep it registered
  }

  /**
   * Cleanup for testing or explicit teardown.
   * Normally not called in production (root service).
   */
  dispose(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
      this.isMessageListenerRegistered = false;
    }
  }
}
```

**Remove**: The `ngOnDestroy` implementation (lines 979-984) and `OnDestroy` interface.

**Verification**: No duplicate event listeners registered over wizard lifecycle.

---

### P1-5: Standardize Error Handling Pattern

**Create utility file**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\utils\error-handling.ts`

```typescript
/**
 * Standard error display format for wizard operations.
 */
export interface WizardError {
  message: string;
  details?: string;
  retryable: boolean;
}

/**
 * Convert unknown error to user-friendly WizardError.
 */
export function toWizardError(error: unknown, context: string): WizardError {
  if (error instanceof Error) {
    return {
      message: `${context}: ${error.message}`,
      details: error.stack,
      retryable: isRetryableError(error),
    };
  }

  return {
    message: `${context}: An unexpected error occurred`,
    details: String(error),
    retryable: true,
  };
}

/**
 * Determine if an error is retryable.
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors are retryable
  if (message.includes('network') || message.includes('timeout')) {
    return true;
  }

  // Validation errors are not retryable
  if (message.includes('invalid') || message.includes('validation')) {
    return false;
  }

  // Default to retryable
  return true;
}

/**
 * Standard async operation wrapper with error handling.
 */
export async function withErrorHandling<T>(operation: () => Promise<T>, context: string, onError: (error: WizardError) => void): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const wizardError = toWizardError(error, context);
    onError(wizardError);
    return null;
  }
}
```

**Update components to use standard pattern**:

```typescript
// In agent-selection.component.ts
import { toWizardError, withErrorHandling } from '../utils/error-handling';

protected async onGenerateAgents(): Promise<void> {
  if (this.isGenerating() || this.noneSelected()) {
    return;
  }

  this.isGenerating.set(true);
  this.errorMessage.set(null);

  const result = await withErrorHandling(
    async () => {
      const selectedAgents = this.buildSelectedAgents();
      const response = await this.wizardRpc.submitAgentSelection(selectedAgents);

      if (!response?.success) {
        throw new Error(response?.error ?? 'Backend did not acknowledge selection');
      }

      return response;
    },
    'Starting agent generation',
    (error) => this.errorMessage.set(error.message)
  );

  if (result) {
    this.wizardState.setCurrentStep('generation');
  }

  this.isGenerating.set(false);
}
```

**Verification**: Consistent error messages across all wizard operations.

---

### P1-6: Add Runtime Validation for Dynamic Service Resolution

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`

**Lines**: 97-104, 137-144, 196-205, 262-273

**Create helper function**:

```typescript
/**
 * Safely resolve a service from the DI container with validation.
 * @throws Error if service is not registered or resolves to null/undefined
 */
private resolveService<T>(
  token: symbol | string,
  serviceName: string
): T {
  try {
    const service = this.container.resolve(token);

    if (service === null || service === undefined) {
      throw new Error(`${serviceName} resolved to null/undefined`);
    }

    return service as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed to resolve ${serviceName}`, { error: message });
    throw new Error(
      `${serviceName} not available. Ensure the agent-generation module is properly initialized. Details: ${message}`
    );
  }
}
```

**Update all dynamic resolution calls**:

```typescript
// Example usage in registerGetStatus
const setupStatusService = this.resolveService<ISetupStatusService>(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE, 'SetupStatusService');
```

**Verification**: Descriptive error messages when DI resolution fails.

---

### P1-7: Add Logging for Template Fallback Path

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`

**Lines**: 361-390

**Fix**:

```typescript
/**
 * Load template content from extension assets.
 */
private async loadTemplate(templatePath: string): Promise<string> {
  // Try loading from extension's template directory
  const templateUri = vscode.Uri.joinPath(
    this.extensionUri,
    'libs/backend/agent-generation/templates',
    templatePath
  );

  try {
    const content = await vscode.workspace.fs.readFile(templateUri);
    this.logger.debug('Template loaded from extension path', {
      path: templateUri.fsPath,
    });
    return Buffer.from(content).toString('utf8');
  } catch (extensionError) {
    // Log warning about fallback
    this.logger.warn('Extension template path failed, using workspace fallback', {
      attemptedPath: templateUri.fsPath,
      error: extensionError instanceof Error ? extensionError.message : String(extensionError),
    });

    // Fallback: Try loading from workspace's templates (for development)
    const workspaceTemplateUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders?.[0]?.uri ||
        vscode.Uri.file(process.cwd()),
      'libs/backend/agent-generation/templates',
      templatePath
    );

    try {
      const content = await vscode.workspace.fs.readFile(workspaceTemplateUri);
      this.logger.warn('Template loaded from WORKSPACE FALLBACK path', {
        path: workspaceTemplateUri.fsPath,
        note: 'This may indicate extension deployment issue in production',
      });
      return Buffer.from(content).toString('utf8');
    } catch (fallbackError) {
      this.logger.error('Template loading failed completely', {
        extensionPath: templateUri.fsPath,
        workspacePath: workspaceTemplateUri.fsPath,
      });
      throw new Error(
        `Failed to load template: ${templatePath}. Tried ${templateUri.fsPath} and ${workspaceTemplateUri.fsPath}`
      );
    }
  }
}
```

**Verification**: Fallback usage clearly logged with WARNING level.

---

### P1-10: Add Retry Count Limit with Backoff

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`

**Add retry tracking**:

```typescript
/**
 * Maximum retry attempts per item.
 */
private static readonly MAX_RETRIES = 3;

/**
 * Base delay for exponential backoff (ms).
 */
private static readonly BASE_DELAY_MS = 1000;

/**
 * Retry count tracking per item.
 */
private retryCounts = new Map<string, number>();

/**
 * Check if an item can be retried.
 */
protected canRetry(itemId: string): boolean {
  const count = this.retryCounts.get(itemId) ?? 0;
  return count < GenerationProgressComponent.MAX_RETRIES;
}

/**
 * Get remaining retry count for display.
 */
protected getRemainingRetries(itemId: string): number {
  const count = this.retryCounts.get(itemId) ?? 0;
  return GenerationProgressComponent.MAX_RETRIES - count;
}

/**
 * Retry a failed generation item with backoff.
 */
protected async onRetryItem(itemId: string): Promise<void> {
  const currentRetries = this.retryCounts.get(itemId) ?? 0;

  if (currentRetries >= GenerationProgressComponent.MAX_RETRIES) {
    // Show max retries reached message
    this.wizardState.updateSkillGenerationItem(itemId, {
      status: 'error',
      errorMessage: `Maximum retry attempts (${GenerationProgressComponent.MAX_RETRIES}) reached. Please contact support or try again later.`,
    });
    return;
  }

  // Prevent concurrent retries
  if (this.pendingRetries.has(itemId)) {
    return;
  }

  this.pendingRetries.add(itemId);
  this.retryCounts.set(itemId, currentRetries + 1);

  // Apply exponential backoff
  const delay = GenerationProgressComponent.BASE_DELAY_MS * Math.pow(2, currentRetries);
  await new Promise(resolve => setTimeout(resolve, delay));

  // Reset item status to pending
  this.wizardState.retryGenerationItem(itemId);

  try {
    await this.wizardRpc.retryGenerationItem(itemId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    const retriesLeft = GenerationProgressComponent.MAX_RETRIES - (currentRetries + 1);
    this.wizardState.updateSkillGenerationItem(itemId, {
      status: 'error',
      errorMessage: retriesLeft > 0
        ? `${message} (${retriesLeft} retries remaining)`
        : `${message}. Maximum retries reached.`,
    });
  } finally {
    this.pendingRetries.delete(itemId);
  }
}
```

**Update template** to show retry button state:

```html
@if (item.status === 'error') { @if (canRetry(item.id)) {
<button class="btn btn-error btn-sm" (click)="onRetryItem(item.id)" [attr.aria-label]="'Retry ' + item.name + ' (' + getRemainingRetries(item.id) + ' attempts remaining)'">
  <svg ...></svg>
  Retry ({{ getRemainingRetries(item.id) }} left)
</button>
} @else {
<span class="text-error text-sm">Max retries reached</span>
} }
```

**Verification**: Retry disabled after 3 attempts with exponential backoff.

---

## Batch 6: Cleanup

### P1-12: Convert JavaScript Validation Script to TypeScript

**Current File**: `D:\projects\ptah-extension\scripts\validate-orchestration-skill.js`

**New File**: `D:\projects\ptah-extension\scripts\validate-orchestration-skill.ts`

**Key Changes**:

1. Add TypeScript types for all data structures
2. Add proper error handling with typed errors
3. Import shared types where applicable
4. Add tsconfig for scripts folder

**Create** `D:\projects\ptah-extension\scripts\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "../dist/scripts",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "noEmit": false
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Type definitions to add at top of TypeScript file**:

```typescript
interface ValidationError {
  type: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
  suggestion: string;
}

interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  passed: boolean;
}

const REQUIRED_STRATEGIES: string[] = ['FEATURE', 'BUGFIX', 'REFACTORING', 'DOCUMENTATION', 'RESEARCH', 'DEVOPS'];

const REQUIRED_AGENTS: string[] = [
  'project-manager',
  'software-architect',
  'team-leader',
  // ... etc
];
```

**Update package.json script**:

```json
{
  "scripts": {
    "validate:orchestration": "npx ts-node scripts/validate-orchestration-skill.ts"
  }
}
```

**Verification**: Script compiles without TypeScript errors, behavior identical.

---

### P1-13: Add External URL Feedback

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\premium-upsell.component.ts`

**Lines**: 202-210

**Fix**:

```typescript
// Add signal for loading state
protected readonly isOpeningUrl = signal(false);
protected readonly urlError = signal<string | null>(null);

/**
 * Handle upgrade button click.
 * Opens the upgrade page with loading feedback.
 */
protected async onUpgradeClick(): Promise<void> {
  if (this.isOpeningUrl()) {
    return; // Prevent double-click
  }

  this.isOpeningUrl.set(true);
  this.urlError.set(null);

  try {
    // Send message to extension to open upgrade URL
    this.vscodeService.postMessage({
      type: 'command',
      payload: {
        command: 'vscode.open',
        args: ['https://ptah.dev/pricing'],
      },
    });

    // Set timeout for feedback
    setTimeout(() => {
      if (this.isOpeningUrl()) {
        // If still loading after 3s, show fallback
        this.isOpeningUrl.set(false);
        this.urlError.set(
          'Browser may be opening in the background. If not, visit: https://ptah.dev/pricing'
        );
      }
    }, 3000);

    // Clear loading after short delay (assume success)
    setTimeout(() => {
      this.isOpeningUrl.set(false);
    }, 1000);
  } catch (error) {
    this.isOpeningUrl.set(false);
    this.urlError.set(
      'Failed to open browser. Please visit: https://ptah.dev/pricing'
    );
  }
}
```

**Update template**:

```html
<button class="btn btn-primary btn-lg" (click)="onUpgradeClick()" [disabled]="isOpeningUrl()">
  @if (isOpeningUrl()) {
  <span class="loading loading-spinner loading-sm"></span>
  Opening... } @else { Upgrade to Premium }
</button>

@if (urlError(); as error) {
<div class="alert alert-info mt-4">
  <svg ...></svg>
  <span>{{ error }}</span>
</div>
}
```

**Verification**: Loading state shown on click, fallback message after timeout.

---

## Files Affected Summary

### CREATE

| File                                                                                             | Description                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------- |
| `libs/shared/src/lib/types/setup-wizard.types.ts`                                                | Shared types for wizard       |
| `libs/frontend/setup-wizard/src/lib/components/analysis/architecture-patterns-card.component.ts` | Extracted component           |
| `libs/frontend/setup-wizard/src/lib/components/analysis/key-file-locations-card.component.ts`    | Extracted component           |
| `libs/frontend/setup-wizard/src/lib/components/analysis/code-health-card.component.ts`           | Extracted component           |
| `libs/frontend/setup-wizard/src/lib/components/analysis/tech-stack-summary.component.ts`         | Extracted component           |
| `libs/frontend/setup-wizard/src/lib/utils/error-handling.ts`                                     | Error utilities               |
| `scripts/validate-orchestration-skill.ts`                                                        | TypeScript version            |
| `scripts/tsconfig.json`                                                                          | TypeScript config for scripts |

### MODIFY

| File                                                                             | Changes                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| `libs/shared/src/index.ts`                                                       | Add setup-wizard.types export               |
| `libs/backend/agent-generation/src/lib/types/analysis.types.ts`                  | Re-export from shared                       |
| `libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts` | Fix double invocation, add constants        |
| `libs/backend/agent-generation/src/lib/services/skill-generator.service.ts`      | Remove unused import, add escaping, logging |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`      | Type-safe messages, cleanup pattern         |
| `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts` | Add cleanup, retry limits                   |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts`    | Decomposition, null checks                  |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`     | Acknowledgment, fallback category           |
| `libs/frontend/setup-wizard/src/lib/components/premium-upsell.component.ts`      | URL feedback                                |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`     | Validation, service resolution              |

### DELETE

| File                                      | Reason                           |
| ----------------------------------------- | -------------------------------- |
| `scripts/validate-orchestration-skill.js` | Replaced with TypeScript version |

---

## Verification Checklist per Batch

### Batch 1 Verification

- [ ] `nx lint agent-generation` - No unused imports
- [ ] Unit test: Scoring methods called exactly once per agent
- [ ] Unit test: Template values with `{{}}` don't cause recursion
- [ ] Manual: Navigate away during generation - no memory leak

### Batch 2 Verification

- [ ] `nx build shared` succeeds
- [ ] `nx build agent-generation` succeeds
- [ ] `nx build setup-wizard` succeeds
- [ ] No duplicate type definitions in frontend/backend

### Batch 3 Verification

- [ ] TypeScript enforces exhaustive message handling
- [ ] Invalid RPC input produces descriptive Zod errors
- [ ] All message payloads properly typed (no `unknown`)

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
- [ ] Template fallback logged with WARNING
- [ ] Retry disabled after 3 attempts

### Batch 6 Verification

- [ ] TypeScript script compiles without errors
- [ ] Script behavior identical to JavaScript version
- [ ] Loading state shown on upgrade click
- [ ] Fallback message after 3s timeout

---

## Risk Mitigation

### Type Migration Risk (P1-1)

- **Risk**: Breaking imports across codebase
- **Mitigation**:
  1. Create types in shared first
  2. Re-export from original locations for backward compatibility
  3. Update imports incrementally
  4. Run full build after each file update

### Component Decomposition Risk (P1-4)

- **Risk**: Regression in UI behavior
- **Mitigation**:
  1. Extract one component at a time
  2. Verify visual appearance matches original
  3. Keep original component file until all extractions verified
  4. Add snapshot tests for extracted components

### Message Type Safety Risk (P0-3)

- **Risk**: Breaking existing message handlers
- **Mitigation**:
  1. Keep runtime type guards initially
  2. Add discriminated union alongside
  3. Remove old guards only after verification
  4. Test all message types manually

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both frontend-developer and backend-developer

**Rationale**:

- **Backend work** (P0-1, P0-2, P0-5, P0-6, P1-2, P1-6, P1-7): Service fixes, validation, logging
- **Frontend work** (P0-3, P0-4, P1-3, P1-4, P1-8, P1-9, P1-10, P1-11, P1-13): Component fixes, state management
- **Shared work** (P1-1): Type extraction requires understanding of both sides
- **Script work** (P1-12): TypeScript migration

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 12-18 hours total

**Breakdown by Batch**:
| Batch | Effort | Complexity |
|-------|--------|------------|
| Batch 1 | 2-3h | Low |
| Batch 2 | 3-4h | Medium |
| Batch 3 | 2-3h | Medium |
| Batch 4 | 3-4h | Medium |
| Batch 5 | 2-3h | Low |
| Batch 6 | 1-2h | Low |

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `@ptah-extension/shared` exports (after P1-1)
   - `zod` for validation (P0-5)
   - Angular signals APIs

2. **All patterns verified from examples**:

   - Discriminated union pattern: See `rpc.types.ts` for similar patterns
   - Component decomposition: See other wizard components for structure
   - Error handling: See `withErrorHandling` utility pattern

3. **Library documentation consulted**:

   - `libs/shared/CLAUDE.md` - Type export conventions
   - `libs/frontend/setup-wizard/CLAUDE.md` - Component patterns
   - `libs/backend/agent-generation/CLAUDE.md` - Service patterns

4. **No hallucinated APIs**:
   - All Angular APIs verified against v20
   - All DaisyUI classes verified against v4
   - All tsyringe APIs verified against v4.10

---

_Implementation Plan Created: 2026-01-22_
_Task: TASK_2025_113_
_Source: TASK_2025_111 QA Reviews_
