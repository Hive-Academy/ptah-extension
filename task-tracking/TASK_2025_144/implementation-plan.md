# Implementation Plan - TASK_2025_144

## Future Enhancements: Anti-Pattern Rules, Performance, Reporting

---

## 1. Executive Summary

This implementation plan covers three future enhancement phases from TASK_2025_141:

- **Phase E2**: 15 new framework-specific anti-pattern detection rules (Angular, NestJS, React)
- **Phase F**: Performance optimizations with incremental analysis, parallel async execution, and smart sampling improvements
- **Phase G**: Quality dashboard Angular component, export capabilities (Markdown, JSON/CSV), and historical tracking

All three phases extend the existing quality assessment infrastructure built in TASK_2025_141 without modifying its core contracts. The rule engine (`createRegexRule`, `createHeuristicRule` factories), `RuleRegistry`, `AntiPatternDetectionService`, `CodeQualityAssessmentService`, and `ProjectIntelligenceService` remain structurally unchanged -- we only add new rules, new services, and new frontend components.

---

## 2. Current State Analysis

### Existing Infrastructure (from TASK_2025_141)

**Shared Types** (`libs/shared/src/lib/types/quality-assessment.types.ts`):

- `AntiPatternType` union: 15 values across 4 categories (typescript, error, arch, test)
- `AntiPatternSeverity`: `'error' | 'warning' | 'info'`
- `RuleCategory`: `'typescript' | 'error-handling' | 'architecture' | 'testing'`
- `QualityAssessment`, `AntiPattern`, `QualityGap`, `PrescriptiveGuidance`, `ProjectIntelligence`
- `SamplingConfig` with `DEFAULT_SAMPLING_CONFIG`

**Rule Engine** (`libs/backend/workspace-intelligence/src/quality/rules/`):

- `rule-base.ts`: `createRegexRule()` and `createHeuristicRule()` factory functions
- `typescript-rules.ts`: 3 rules (explicit-any, ts-ignore, non-null-assertion)
- `error-handling-rules.ts`: 2 rules (empty-catch, console-only-catch)
- `architecture-rules.ts`: 3 rules (file-too-large, too-many-imports, function-too-large)
- `testing-rules.ts`: 2 rules (no-assertions, all-skipped)
- `index.ts`: `RuleRegistry` class, `ALL_RULES` aggregation, re-exports

**Services** (`libs/backend/workspace-intelligence/src/quality/services/`):

- `AntiPatternDetectionService`: Rule-based detection with scoring (TOKENS.ANTI_PATTERN_DETECTION_SERVICE)
- `CodeQualityAssessmentService`: File sampling + assessment orchestration (TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE)
- `PrescriptiveGuidanceService`: Recommendation generation (TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE)
- `ProjectIntelligenceService`: Unified facade with 5min cache (TOKENS.PROJECT_INTELLIGENCE_SERVICE)

**DI Registration** (`libs/backend/workspace-intelligence/src/quality/di.ts`):

- `registerQualityServices()` registers all 4 services in tsyringe container

**RPC Layer** (`libs/shared/src/lib/types/rpc.types.ts`):

- `RpcMethodRegistry` with type-safe method definitions
- `RPC_METHOD_NAMES` runtime array for handler verification
- Pattern: define types in shared, register handlers in vscode extension app

**Frontend Dashboard** (`libs/frontend/dashboard/`):

- Currently empty (`src/index.ts` is blank)
- CLAUDE.md documents planned architecture with signal-based components, DaisyUI, Chart.js
- Pattern: `DashboardViewComponent` -> child components, `DashboardStateService`, `MetricsAggregatorService`

---

## 3. Codebase Investigation Summary

### Libraries Analyzed

- **workspace-intelligence**: Quality module (rules, services, interfaces, DI) - 12 files read
- **shared**: Type definitions (quality-assessment.types.ts, anti-pattern-rules.types.ts, rpc.types.ts) - 3 files read
- **vscode-core**: DI tokens (tokens.ts) - verified 4 quality tokens exist
- **frontend/dashboard**: CLAUDE.md pattern guide + empty index.ts - 2 files read
- **frontend/core**: ClaudeRpcService, VSCodeService, AppStateManager patterns - CLAUDE.md read

### Patterns Verified

- **Rule factory pattern**: `createRegexRule(config)` and `createHeuristicRule(config)` at rule-base.ts:110,191
- **Rule registration**: `ALL_RULES` array aggregation + `RuleRegistry` constructor auto-registration at index.ts:54,117
- **Rule file pattern**: Each category has `<category>-rules.ts` exporting `<category>Rules` array
- **Service DI pattern**: `@injectable()` + `@inject(TOKENS.*)` constructor injection
- **RPC pattern**: Types in `rpc.types.ts` -> handlers in `apps/ptah-extension-vscode/src/services/rpc/handlers/`
- **Frontend component pattern**: Standalone, signal-based, `inject()`, DaisyUI classes, `input.required<T>()`

### Integration Points Verified

- Quality tokens: `TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE` (tokens.ts:216)
- Quality tokens: `TOKENS.ANTI_PATTERN_DETECTION_SERVICE` (tokens.ts:224)
- Quality tokens: `TOKENS.PROJECT_INTELLIGENCE_SERVICE` (tokens.ts:232)
- Quality tokens: `TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE` (tokens.ts:240)
- RPC registry: `RpcMethodRegistry` interface at rpc.types.ts:936
- Frontend RPC: `ClaudeRpcService.callExtension<P, R>(method, params)` at claude-rpc.service.ts

---

## 4. Phase E2: Additional Anti-Pattern Rules

### 4.1 New RuleCategory Values Needed

The existing `RuleCategory` type only includes `'typescript' | 'error-handling' | 'architecture' | 'testing'`. Phase E2 requires three new categories:

```typescript
// anti-pattern-rules.types.ts - Updated RuleCategory
export type RuleCategory =
  | 'typescript'
  | 'error-handling'
  | 'architecture'
  | 'testing'
  | 'angular' // NEW
  | 'nestjs' // NEW
  | 'react'; // NEW
```

### 4.2 New AntiPatternType Values Needed

Add 15 new values to the `AntiPatternType` union in `quality-assessment.types.ts`:

```typescript
// quality-assessment.types.ts - New AntiPatternType values
export type AntiPatternType =
  // ... existing 15 values ...
  // Angular anti-patterns (Phase E2)
  | 'angular-improper-change-detection'
  | 'angular-subscription-leak'
  | 'angular-circular-dependency'
  | 'angular-large-component'
  | 'angular-missing-trackby'
  // NestJS anti-patterns (Phase E2)
  | 'nestjs-missing-decorator'
  | 'nestjs-controller-logic'
  | 'nestjs-unsafe-repository'
  | 'nestjs-missing-guard'
  | 'nestjs-circular-module'
  // React anti-patterns (Phase E2)
  | 'react-missing-key'
  | 'react-direct-state-mutation'
  | 'react-useeffect-dependencies'
  | 'react-large-component'
  | 'react-inline-function-prop';
```

Note: The original spec listed `reactUseEffectDependencies` and `reactDirectStateUpdate`. I have normalized them to kebab-case convention matching existing patterns (`typescript-explicit-any`, etc.). Also, the 5th React rule is `react-inline-function-prop` (creating new function in JSX props) as a replacement for the vague "React-specific rules if applicable" note, since `react-large-component` overlaps with the generic `arch-file-too-large` and we should add value.

### 4.3 Angular Rules Specification

**File**: `libs/backend/workspace-intelligence/src/quality/rules/angular-rules.ts`

#### Rule 1: `angular-improper-change-detection`

- **Description**: Detects components using `ChangeDetectionStrategy.Default` or missing `ChangeDetectionStrategy.OnPush`. Also detects manual `ChangeDetectorRef.detectChanges()` calls which indicate OnPush isn't used properly.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Check if file contains `@Component` decorator (confirming it's a component)
  2. If component found, check whether it uses `ChangeDetectionStrategy.OnPush`
  3. Flag if `@Component` is present but `OnPush` is not set
  4. Also flag if `detectChanges()` is called (indicator of improper change detection)
- **Pattern**:
  ```typescript
  // Heuristic check function:
  // 1. Find @Component decorator presence
  const hasComponent = /@Component\s*\(/.test(content);
  if (!hasComponent) return [];
  // 2. Check for OnPush
  const hasOnPush = /ChangeDetectionStrategy\s*\.\s*OnPush/.test(content);
  // 3. Check for manual detectChanges
  const hasDetectChanges = /\.detectChanges\s*\(/.test(content);
  // Flag if component without OnPush, or has manual detectChanges
  ```
- **Suggestion**: "Use `ChangeDetectionStrategy.OnPush` to improve rendering performance. Avoid manual `detectChanges()` calls -- use signals or async pipe instead."

#### Rule 2: `angular-subscription-leak`

- **Description**: Detects `.subscribe()` calls in component files without corresponding `takeUntilDestroyed`, `unsubscribe`, or `DestroyRef` cleanup.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Confirm file is a component (has `@Component`)
  2. Count `.subscribe(` occurrences
  3. Check for cleanup patterns: `takeUntilDestroyed`, `takeUntil`, `unsubscribe`, `DestroyRef`, `ngOnDestroy`
  4. Flag if subscribes exist but no cleanup patterns found
- **Suggestion**: "Use `takeUntilDestroyed(this.destroyRef)` or the `async` pipe to automatically clean up subscriptions. Unmanaged subscriptions cause memory leaks."

#### Rule 3: `angular-circular-dependency`

- **Description**: Detects `forwardRef()` usage which often indicates circular DI dependencies.
- **Method**: Regex
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Pattern**: `/forwardRef\s*\(\s*\(\)\s*=>/g`
- **Suggestion**: "Refactor to eliminate circular dependencies. Consider introducing a shared interface or moving shared logic to a separate service."

#### Rule 4: `angular-large-component`

- **Description**: Detects Angular components exceeding 500 lines, which indicates the component has too many responsibilities.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Confirm file has `@Component` decorator
  2. Count total lines
  3. Flag if > 500 lines (warning), > 1000 lines (error via metadata)
- **Suggestion**: "Split this component into smaller, focused components. Extract logic into services and use composition over inheritance."

#### Rule 5: `angular-missing-trackby`

- **Description**: Detects `*ngFor` usage without `trackBy` function, or `@for` without `track` expression.
- **Method**: Regex
- **Severity**: `info`
- **File Extensions**: `['.ts', '.html']`
- **Pattern**: `/\*ngFor\s*=\s*"[^"]*"(?![\s\S]*trackBy)/g` for inline templates; additionally check for `@for` blocks without `track` keyword using heuristic.
- **Note**: Since this project uses inline templates in `.ts` files, the rule will use a heuristic approach that checks the entire file content.
- **Method (revised)**: Heuristic -- scan for `*ngFor` without `trackBy` in the same directive string, and `@for` blocks to verify `track` is present.
- **Suggestion**: "Add a `trackBy` function to `*ngFor` or `track` expression to `@for` to prevent unnecessary DOM re-rendering."

### 4.4 NestJS Rules Specification

**File**: `libs/backend/workspace-intelligence/src/quality/rules/nestjs-rules.ts`

#### Rule 6: `nestjs-missing-decorator`

- **Description**: Detects classes that appear to be NestJS services (injected or used as providers) but lack `@Injectable()` decorator.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Check if file imports from `@nestjs/common`
  2. Check if file has `export class` declarations
  3. Check if `@Injectable()` decorator is present before the class
  4. Flag if NestJS file has exported class without `@Injectable()`, `@Controller()`, `@Module()`, or `@Guard()` etc.
- **Suggestion**: "Add `@Injectable()` decorator to this service class. NestJS requires explicit decorators for dependency injection to work."

#### Rule 7: `nestjs-controller-logic`

- **Description**: Detects controllers with methods exceeding 20 lines, indicating business logic leaked into controllers.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Check if file has `@Controller` decorator
  2. Find method bodies in the class
  3. Flag methods > 20 lines (controllers should delegate to services)
- **Suggestion**: "Move business logic from controllers to dedicated service classes. Controllers should only handle HTTP concerns (validation, response formatting)."

#### Rule 8: `nestjs-unsafe-repository`

- **Description**: Detects raw SQL queries without parameterized inputs (string concatenation in queries).
- **Method**: Regex
- **Severity**: `error`
- **File Extensions**: `['.ts']`
- **Pattern**: `/(?:query|execute)\s*\(\s*`[^`]_\$\{/g`and`/(?:query|execute)\s_\(\s*['"][^'"]*['"]\s\*\+/g`
- **Detection Logic**: Matches template literals or string concatenation inside `query()` or `execute()` calls.
- **Suggestion**: "Use parameterized queries to prevent SQL injection attacks. Use `$1, $2` placeholders or an ORM like Prisma/TypeORM."

#### Rule 9: `nestjs-missing-guard`

- **Description**: Detects controller methods with sensitive route decorators (POST, PUT, DELETE, PATCH) that lack `@UseGuards()` at method or class level.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Detection Logic**:
  1. Check if file has `@Controller` decorator
  2. Check if `@UseGuards` is present at class level (covers all methods)
  3. If no class-level guard, check each `@Post()`, `@Put()`, `@Delete()`, `@Patch()` for method-level `@UseGuards`
  4. Flag mutation endpoints without guards
- **Suggestion**: "Add `@UseGuards(AuthGuard)` to protect sensitive endpoints. Consider using class-level guards for consistent protection."

#### Rule 10: `nestjs-circular-module`

- **Description**: Detects `forwardRef()` usage in NestJS module imports, indicating circular module dependencies.
- **Method**: Regex
- **Severity**: `warning`
- **File Extensions**: `['.ts']`
- **Pattern**: `/imports\s*:\s*\[[^\]]*forwardRef/g`
- **Suggestion**: "Refactor module structure to eliminate circular imports. Extract shared functionality into a common module."

### 4.5 React Rules Specification

**File**: `libs/backend/workspace-intelligence/src/quality/rules/react-rules.ts`

#### Rule 11: `react-missing-key`

- **Description**: Detects `.map()` calls in JSX that return elements without `key` props.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.tsx', '.jsx']`
- **Detection Logic**:
  1. Find `.map(` calls followed by JSX return patterns
  2. Check if the returned JSX element has a `key=` attribute
  3. Flag if `.map()` returns JSX without `key`
- **Pattern Heuristic**: Look for `.map(` followed by `<` (JSX opening) without `key=` or `key={` within the returned element.
- **Suggestion**: "Add a unique `key` prop to elements rendered in `.map()`. Use a stable identifier (e.g., item ID), NOT the array index."

#### Rule 12: `react-direct-state-mutation`

- **Description**: Detects direct mutation of `this.state` or calling state setters with the same reference.
- **Method**: Regex
- **Severity**: `error`
- **File Extensions**: `['.tsx', '.jsx', '.ts', '.js']`
- **Pattern**: `/this\.state\s*\.\s*\w+\s*=/g` -- detects `this.state.property = value`
- **Suggestion**: "Never mutate state directly. Use `this.setState()` for class components or the setter function from `useState()` for functional components."

#### Rule 13: `react-useeffect-dependencies`

- **Description**: Detects `useEffect` calls with empty dependency arrays that reference variables from the component scope (stale closure risk).
- **Method**: Heuristic
- **Severity**: `info`
- **File Extensions**: `['.tsx', '.jsx', '.ts', '.js']`
- **Detection Logic**:
  1. Find `useEffect(` calls
  2. Check if dependency array is `[]` (empty)
  3. Check if the effect body references `props.` or state variables
  4. Flag as potential stale closure issue
- **Note**: This is a heuristic approximation. False positives possible for intentional mount-only effects.
- **Suggestion**: "Review the dependency array for `useEffect`. Include all referenced variables or use `useCallback`/`useMemo` to stabilize dependencies."

#### Rule 14: `react-large-component`

- **Description**: Detects React component files exceeding 300 lines.
- **Method**: Heuristic
- **Severity**: `warning`
- **File Extensions**: `['.tsx', '.jsx']`
- **Detection Logic**:
  1. Check file has React component pattern (function returning JSX, or class extending Component)
  2. Count total lines
  3. Flag if > 300 lines
- **Suggestion**: "Extract sub-components, custom hooks, and utility functions into separate files. Large components are hard to test and maintain."

#### Rule 15: `react-inline-function-prop`

- **Description**: Detects inline arrow functions as JSX props (e.g., `onClick={() => handleClick(id)}`), which cause unnecessary re-renders.
- **Method**: Regex
- **Severity**: `info`
- **File Extensions**: `['.tsx', '.jsx']`
- **Pattern**: `/\w+=\{\s*\([^)]*\)\s*=>/g` -- matches `propName={(...) =>`
- **Suggestion**: "Extract inline functions to named handlers or use `useCallback()` to prevent unnecessary re-renders of child components."

### 4.6 CATEGORY_FROM_TYPE Update

In `code-quality-assessment.service.ts`, the `CATEGORY_FROM_TYPE` map needs updating:

```typescript
const CATEGORY_FROM_TYPE: Record<string, string> = {
  typescript: 'TypeScript Type Safety',
  error: 'Error Handling',
  arch: 'Architecture',
  test: 'Testing',
  angular: 'Angular Best Practices', // NEW
  nestjs: 'NestJS Best Practices', // NEW
  react: 'React Best Practices', // NEW
};
```

Similarly, `DEFAULT_STRENGTHS` needs new entries:

```typescript
const DEFAULT_STRENGTHS: Record<string, string> = {
  typescript: 'Minimal explicit any usage - good type coverage',
  error: 'Proper error handling patterns observed',
  arch: 'Reasonable file sizes and module organization',
  test: 'Test files follow good practices',
  angular: 'Angular components follow best practices', // NEW
  nestjs: 'NestJS services follow proper patterns', // NEW
  react: 'React components follow best practices', // NEW
};
```

### 4.7 Rule Registration

In `rules/index.ts`, add new imports and extend `ALL_RULES`:

```typescript
import { angularRules } from './angular-rules';
import { nestjsRules } from './nestjs-rules';
import { reactRules } from './react-rules';

export const ALL_RULES: AntiPatternRule[] = [
  ...typescriptRules,
  ...errorHandlingRules,
  ...architectureRules,
  ...testingRules,
  ...angularRules, // NEW
  ...nestjsRules, // NEW
  ...reactRules, // NEW
];
```

---

## 5. Phase F: Performance Optimizations

### 5.1 Architecture Overview

Phase F introduces three performance improvements to the quality assessment pipeline:

1. **Incremental Analysis with File Hash Caching** -- avoid re-analyzing unchanged files
2. **Parallel Async Rule Execution** -- run rules concurrently with `Promise.allSettled`
3. **Smart Sampling Improvements** -- adaptive sample size based on project size and historical patterns

**Important Constraint**: Worker threads are complex in VS Code extensions (extension host is single-threaded, webview isolate restrictions). All parallelism will use **async patterns** (`Promise.allSettled`, microtask batching) rather than `worker_threads`.

### 5.2 File Hash Cache Service

**File**: `libs/backend/workspace-intelligence/src/quality/services/file-hash-cache.service.ts`

**Purpose**: Maintains a map of file path -> content hash, enabling incremental analysis by detecting which files have changed since last analysis.

**Pattern**: `@injectable()` with `@inject(TOKENS.LOGGER)`, follows existing service patterns.

**Interface**:

```typescript
export interface IFileHashCacheService {
  /** Get hash for a file path */
  getHash(filePath: string): string | undefined;
  /** Set hash for a file path */
  setHash(filePath: string, hash: string): void;
  /** Check if file content has changed since last hash */
  hasChanged(filePath: string, content: string): boolean;
  /** Update hash after analysis */
  updateHash(filePath: string, content: string): void;
  /** Get all cached hashes for a workspace */
  getCachedFiles(): string[];
  /** Clear cache for workspace (on full re-analysis) */
  clearCache(): void;
  /** Get cache statistics */
  getStats(): { totalCached: number; cacheHitRate: number };
}
```

**Implementation Details**:

- Use `crypto.createHash('sha256')` for content hashing (fast, collision-resistant)
- In-memory `Map<string, { hash: string; analysisTimestamp: number; patterns: AntiPattern[] }>` storage
- Cache key: relative file path
- Cache TTL: 30 minutes (configurable), independent of ProjectIntelligenceService's 5-min cache
- **Cached patterns**: Store detected patterns per-file, enabling incremental merge without re-detection
- Maximum cache size: 10,000 entries (with LRU eviction)

**Hash computation**:

```typescript
import { createHash } from 'crypto';

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
  // 16-char hex = 64 bits, collision probability negligible for < 10k files
}
```

### 5.3 Incremental Analysis Flow

**File**: Modify `CodeQualityAssessmentService` (`code-quality-assessment.service.ts`)

**New Method**: `assessQualityIncremental(workspaceUri, config?)`

**Flow**:

```
1. Index workspace files (existing)
2. For each sampled file:
   a. Compute content hash
   b. Check FileHashCacheService.hasChanged(path, content)
   c. If UNCHANGED: retrieve cached patterns from FileHashCacheService
   d. If CHANGED: run full detection, update cache
3. Merge cached + fresh patterns
4. Calculate score from merged patterns
5. Return QualityAssessment
```

**QualityAssessment Extension**: Add optional field to track incremental analysis:

```typescript
// In quality-assessment.types.ts
export interface QualityAssessment {
  // ... existing fields ...
  /** Number of files analyzed from cache vs fresh (Phase F) */
  incrementalStats?: {
    cachedFiles: number;
    freshFiles: number;
    cacheHitRate: number;
  };
}
```

### 5.4 Parallel Async Rule Execution

**File**: Modify `AntiPatternDetectionService` (`anti-pattern-detection.service.ts`)

**Current**: Rules execute sequentially in a `for...of` loop per file.

**Optimized**: Run rules in parallel per-file using `Promise.allSettled` for fault isolation.

```typescript
// Current (sequential):
for (const rule of applicableRules) {
  const matches = rule.detect(content, filePath);
  // ...
}

// Optimized (parallel async):
async detectPatternsAsync(content: string, filePath: string): Promise<AntiPattern[]> {
  const applicableRules = this.ruleRegistry.getRulesForExtension(extension);

  const results = await Promise.allSettled(
    applicableRules.map(rule =>
      Promise.resolve().then(() => rule.detect(content, filePath))
    )
  );

  // Collect fulfilled results, log rejected ones
  const detectedPatterns: AntiPattern[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      // ... process matches into AntiPattern[]
    } else {
      this.logger.warn('Rule execution failed', {
        ruleId: applicableRules[index].id,
        error: result.reason,
      });
    }
  });

  return detectedPatterns;
}
```

**Multi-file parallel processing**: Process files in batches of 5 concurrently:

```typescript
async detectPatternsInFilesAsync(files: SampledFile[]): Promise<AntiPattern[]> {
  const BATCH_SIZE = 5;
  const allPatterns: AntiPattern[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(file => this.detectPatternsAsync(file.content, file.path))
    );
    // Merge results...
  }

  return aggregatedPatterns;
}
```

**Backward Compatibility**: The existing synchronous `detectPatterns()` and `detectPatternsInFiles()` methods remain unchanged. New async variants are added alongside them. `CodeQualityAssessmentService` will use the async variants when `assessQualityIncremental()` is called.

### 5.5 Smart Sampling Improvements

**File**: Modify `CodeQualityAssessmentService` (`code-quality-assessment.service.ts`)

**Improvement 1 - Adaptive Sample Size**:

Current: Fixed `maxFiles: 15` regardless of project size.

Improved:

```typescript
function calculateAdaptiveSampleSize(totalFiles: number): number {
  if (totalFiles <= 50) return Math.min(totalFiles, 15); // Small project: analyze most
  if (totalFiles <= 200) return 20; // Medium project
  if (totalFiles <= 1000) return 30; // Large project
  if (totalFiles <= 5000) return 40; // Very large project
  return 50; // Massive project
}
```

**Improvement 2 - Priority File Weighting**:

Add framework-aware priority patterns based on detected workspace context:

```typescript
function getFrameworkPriorityPatterns(framework: string | undefined): string[] {
  switch (framework?.toLowerCase()) {
    case 'angular':
      return ['component', 'service', 'module', 'guard', 'interceptor', 'pipe', 'directive'];
    case 'react':
      return ['component', 'hook', 'context', 'provider', 'reducer', 'store'];
    case 'nestjs':
      return ['controller', 'service', 'module', 'guard', 'middleware', 'interceptor', 'repository'];
    default:
      return ['service', 'component', 'controller', 'repository', 'model'];
  }
}
```

**Improvement 3 - Recently Modified Files Priority**:

Prioritize files modified within the last 7 days (using `fs.stat.mtime`):

```typescript
// In selectFilesIntelligently:
// After entry points, before high-relevance, add recently modified files
const recentFiles = await this.getRecentlyModifiedFiles(files, 7 * 24 * 60 * 60 * 1000);
for (const file of recentFiles.slice(0, config.recentCount ?? 3)) {
  selected.add(file);
}
```

### 5.6 Performance Targets

| Metric                             | Target | Strategy                                         |
| ---------------------------------- | ------ | ------------------------------------------------ |
| < 1k files, fresh analysis         | < 3s   | Async parallel rules, batch processing           |
| < 10k files, fresh analysis        | < 10s  | Adaptive sampling (max 50 files), parallel rules |
| Incremental (after first analysis) | < 1s   | File hash cache, only re-analyze changed files   |
| Cache hit rate (typical)           | > 70%  | SHA-256 content hashing, 30min TTL               |

### 5.7 New DI Token

```typescript
// In vscode-core/src/di/tokens.ts
export const FILE_HASH_CACHE_SERVICE = Symbol.for('FileHashCacheService');
```

---

## 6. Phase G: Reporting and Visualization

### 6.1 Architecture Overview

Phase G adds three capabilities:

1. **Quality Dashboard Component** -- Angular component integrated into the existing dashboard library
2. **Export Capabilities** -- Markdown report and JSON/CSV export from assessment data
3. **Historical Tracking** -- Store assessment snapshots for trend analysis

### 6.2 RPC Methods (Backend-to-Frontend Data Flow)

**New RPC Types** (in `libs/shared/src/lib/types/rpc.types.ts`):

```typescript
// ============================================================
// Quality Dashboard RPC Types (TASK_2025_144)
// ============================================================

/** Parameters for quality:getAssessment RPC method */
export interface QualityGetAssessmentParams {
  /** Force fresh analysis (bypass cache) */
  forceRefresh?: boolean;
}

/** Response from quality:getAssessment RPC method */
export interface QualityGetAssessmentResult {
  /** Full project intelligence data */
  intelligence: ProjectIntelligence;
  /** Whether result came from cache */
  fromCache: boolean;
}

/** Parameters for quality:getHistory RPC method */
export interface QualityGetHistoryParams {
  /** Maximum number of history entries to return */
  limit?: number;
}

/** A single quality assessment snapshot for historical tracking */
export interface QualityHistoryEntry {
  /** Assessment timestamp */
  timestamp: number;
  /** Quality score at that time */
  score: number;
  /** Number of anti-patterns detected */
  patternCount: number;
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Anti-pattern counts by category */
  categoryCounts: Record<string, number>;
}

/** Response from quality:getHistory RPC method */
export interface QualityGetHistoryResult {
  /** Historical assessment entries (newest first) */
  entries: QualityHistoryEntry[];
}

/** Parameters for quality:export RPC method */
export interface QualityExportParams {
  /** Export format */
  format: 'markdown' | 'json' | 'csv';
}

/** Response from quality:export RPC method */
export interface QualityExportResult {
  /** Exported content as string */
  content: string;
  /** Suggested filename */
  filename: string;
  /** MIME type */
  mimeType: string;
}
```

**RPC Registry entries** (add to `RpcMethodRegistry`):

```typescript
// ---- Quality Dashboard Methods (TASK_2025_144) ----
'quality:getAssessment': {
  params: QualityGetAssessmentParams;
  result: QualityGetAssessmentResult;
};
'quality:getHistory': {
  params: QualityGetHistoryParams;
  result: QualityGetHistoryResult;
};
'quality:export': {
  params: QualityExportParams;
  result: QualityExportResult;
};
```

### 6.3 Backend: Quality RPC Handlers

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`

**Pattern**: Follow existing handler pattern from `setup-rpc.handlers.ts`.

```typescript
@injectable()
export class QualityRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.PROJECT_INTELLIGENCE_SERVICE)
    private readonly intelligenceService: IProjectIntelligenceService,
    @inject(TOKENS.QUALITY_HISTORY_SERVICE)
    private readonly historyService: IQualityHistoryService,
    @inject(TOKENS.QUALITY_EXPORT_SERVICE)
    private readonly exportService: IQualityExportService,
  ) {}

  registerHandlers(rpcHandler: RpcHandler): void {
    rpcHandler.register('quality:getAssessment', async (params) => { ... });
    rpcHandler.register('quality:getHistory', async (params) => { ... });
    rpcHandler.register('quality:export', async (params) => { ... });
  }
}
```

### 6.4 Backend: Quality History Service

**File**: `libs/backend/workspace-intelligence/src/quality/services/quality-history.service.ts`

**Purpose**: Stores quality assessment snapshots for trend analysis. Uses VS Code `ExtensionContext.globalState` for persistence.

**Interface**:

```typescript
export interface IQualityHistoryService {
  /** Record a new assessment snapshot */
  recordAssessment(assessment: QualityAssessment): void;
  /** Get history entries (newest first) */
  getHistory(limit?: number): QualityHistoryEntry[];
  /** Clear all history */
  clearHistory(): void;
}
```

**Implementation Details**:

- Store as JSON array in `ExtensionContext.globalState` (persists across sessions)
- Key: `ptah.quality.history.<workspacePath-hash>`
- Maximum entries: 100 (oldest evicted first)
- Each entry stores: timestamp, score, patternCount, filesAnalyzed, categoryCounts
- Entries are compact (no full anti-pattern details, just aggregated counts)

**New DI Token**: `TOKENS.QUALITY_HISTORY_SERVICE`

### 6.5 Backend: Quality Export Service

**File**: `libs/backend/workspace-intelligence/src/quality/services/quality-export.service.ts`

**Purpose**: Generates reports in multiple formats from quality assessment data.

**Interface**:

```typescript
export interface IQualityExportService {
  /** Export assessment as Markdown */
  exportMarkdown(intelligence: ProjectIntelligence): string;
  /** Export assessment as JSON */
  exportJson(intelligence: ProjectIntelligence): string;
  /** Export anti-patterns as CSV */
  exportCsv(intelligence: ProjectIntelligence): string;
}
```

**Markdown Report Template**:

```markdown
# Code Quality Report

**Generated**: {timestamp}
**Project**: {projectType} ({framework})
**Score**: {score}/100

## Summary

{prescriptiveGuidance.summary}

## Anti-Patterns Detected

| Type | Severity | Frequency | Location |
| ---- | -------- | --------- | -------- |
| ...  |

## Quality Gaps

| Area | Priority | Description | Recommendation |
| ---- | -------- | ----------- | -------------- |
| ...  |

## Strengths

- {strength1}
- {strength2}

## Recommendations

1. [{priority}] {issue}: {solution}
   ...
```

**JSON Export**: Full `ProjectIntelligence` object serialized.

**CSV Export**: Anti-patterns as flat rows:

```
type,severity,file,line,column,frequency,message,suggestion
typescript-explicit-any,warning,src/user.service.ts,45,12,3,"Explicit Any Type",Replace any with specific type
```

**New DI Token**: `TOKENS.QUALITY_EXPORT_SERVICE`

### 6.6 Frontend: Quality Dashboard Components

**Directory**: `libs/frontend/dashboard/src/lib/components/quality/`

Following the dashboard CLAUDE.md patterns: standalone components, signal-based, DaisyUI, `inject()`.

#### Component Hierarchy

```
QualityDashboardViewComponent (main layout)
├── QualityScoreCardComponent (score display with radial gauge)
├── QualityTrendChartComponent (score over time line chart)
├── AntiPatternDistributionComponent (category breakdown bar chart)
├── QualityGapsTableComponent (sortable gaps table)
├── QualityRecommendationsComponent (prioritized recommendations list)
└── QualityExportButtonComponent (export dropdown with format options)
```

#### QualityDashboardViewComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-dashboard-view.component.ts`

```typescript
@Component({
  selector: 'ptah-quality-dashboard',
  standalone: true,
  imports: [QualityScoreCardComponent, QualityTrendChartComponent, AntiPatternDistributionComponent, QualityGapsTableComponent, QualityRecommendationsComponent, QualityExportButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="quality-dashboard p-4 space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-bold">Code Quality Dashboard</h2>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-outline" (click)="refreshAssessment()" [disabled]="loading()">Refresh</button>
          <ptah-quality-export-button [intelligence]="intelligence()" />
        </div>
      </div>

      @if (loading()) {
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
      } @else if (error()) {
      <div class="alert alert-error">{{ error() }}</div>
      } @else if (intelligence()) {
      <!-- Score + Trend Row -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ptah-quality-score-card [score]="score()" [gaps]="gaps()" />
        <div class="lg:col-span-2">
          <ptah-quality-trend-chart [history]="history()" />
        </div>
      </div>

      <!-- Pattern Distribution -->
      <ptah-anti-pattern-distribution [antiPatterns]="antiPatterns()" />

      <!-- Gaps & Recommendations -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ptah-quality-gaps-table [gaps]="gaps()" />
        <ptah-quality-recommendations [recommendations]="recommendations()" />
      </div>
      }
    </div>
  `,
})
export class QualityDashboardViewComponent {
  private readonly qualityState = inject(QualityDashboardStateService);

  readonly loading = this.qualityState.loading;
  readonly error = this.qualityState.error;
  readonly intelligence = this.qualityState.intelligence;
  readonly score = computed(() => this.intelligence()?.qualityAssessment.score ?? 0);
  readonly antiPatterns = computed(() => this.intelligence()?.qualityAssessment.antiPatterns ?? []);
  readonly gaps = computed(() => this.intelligence()?.qualityAssessment.gaps ?? []);
  readonly recommendations = computed(() => this.intelligence()?.prescriptiveGuidance.recommendations ?? []);
  readonly history = this.qualityState.history;

  refreshAssessment(): void {
    this.qualityState.loadAssessment(true);
  }
}
```

#### QualityDashboardStateService

**File**: `libs/frontend/dashboard/src/lib/services/quality-dashboard-state.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class QualityDashboardStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private state
  private readonly _intelligence = signal<ProjectIntelligence | null>(null);
  private readonly _history = signal<QualityHistoryEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly intelligence = this._intelligence.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Load quality assessment from backend */
  async loadAssessment(forceRefresh = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    const result = await this.rpc.callExtension<QualityGetAssessmentParams, QualityGetAssessmentResult>('quality:getAssessment', { forceRefresh });

    this._loading.set(false);

    if (result.isSuccess()) {
      this._intelligence.set(result.data.intelligence);
    } else {
      this._error.set(result.error ?? 'Failed to load assessment');
    }
  }

  /** Load quality history from backend */
  async loadHistory(limit = 30): Promise<void> {
    const result = await this.rpc.callExtension<QualityGetHistoryParams, QualityGetHistoryResult>('quality:getHistory', { limit });

    if (result.isSuccess()) {
      this._history.set(result.data.entries);
    }
  }

  /** Export quality report */
  async exportReport(format: 'markdown' | 'json' | 'csv'): Promise<string | null> {
    const result = await this.rpc.callExtension<QualityExportParams, QualityExportResult>('quality:export', { format });

    if (result.isSuccess()) {
      return result.data.content;
    }
    return null;
  }
}
```

#### QualityScoreCardComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-score-card.component.ts`

Displays the quality score as a large number with color coding and gap summary:

- Score >= 80: green (`text-success`)
- Score >= 60: yellow (`text-warning`)
- Score < 60: red (`text-error`)

Uses DaisyUI `stat` classes for card layout.

#### QualityTrendChartComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-trend-chart.component.ts`

Line chart showing score history over time. Uses either a simple inline SVG chart (no external charting library dependency needed for simple line charts) or Chart.js if already available in the dashboard library. Input: `QualityHistoryEntry[]`.

#### AntiPatternDistributionComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/anti-pattern-distribution.component.ts`

Horizontal bar chart showing anti-pattern counts grouped by category. Uses DaisyUI `progress` bars for visual representation (no Chart.js needed). Color coded by severity.

#### QualityGapsTableComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-gaps-table.component.ts`

DaisyUI `table` showing quality gaps with priority badges. Sortable by priority.

#### QualityRecommendationsComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-recommendations.component.ts`

Numbered list of recommendations with priority indicators. Uses DaisyUI `card` and `badge` components.

#### QualityExportButtonComponent

**File**: `libs/frontend/dashboard/src/lib/components/quality/quality-export-button.component.ts`

Dropdown button with format options (Markdown, JSON, CSV). Triggers download via blob URL.

### 6.7 Navigation Integration

The quality dashboard must be accessible from the existing navigation. Two approaches depending on current routing:

**Option A** (Preferred): Add as a tab within the existing dashboard view.

Since `libs/frontend/dashboard/` is currently empty, `QualityDashboardViewComponent` can be the initial dashboard content. When performance metrics dashboard (Phase 2) is built, both can coexist as tabs.

**Option B**: Add as a new `ViewType` in the navigation system.

Add `'quality'` to the `ViewType` union in `AppStateManager` and integrate into `WebviewNavigationService`.

**Recommendation**: Option A -- keep it within the dashboard library, accessible via the existing dashboard view route/navigation.

### 6.8 Historical Tracking Data Model

Stored in VS Code `globalState`:

```typescript
interface QualityHistoryStore {
  version: 1;
  entries: QualityHistoryEntry[];
}
```

Key: `ptah.quality.history` (workspace-scoped via workspace folder name hash)

Maximum: 100 entries, each ~200 bytes = ~20KB total (well within globalState limits).

---

## 7. Type Changes Summary

### `libs/shared/src/lib/types/quality-assessment.types.ts`

| Change                                        | Detail                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| Extend `AntiPatternType` union                | Add 15 new values for angular, nestjs, react categories |
| Add `incrementalStats` to `QualityAssessment` | Optional field for Phase F cache statistics             |
| Add `QualityHistoryEntry` interface           | For Phase G historical tracking                         |

### `libs/shared/src/lib/types/anti-pattern-rules.types.ts`

| Change                      | Detail                                        |
| --------------------------- | --------------------------------------------- |
| Extend `RuleCategory` union | Add `'angular' \| 'nestjs' \| 'react'` values |

### `libs/shared/src/lib/types/rpc.types.ts`

| Change                                  | Detail                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| Add `QualityGetAssessmentParams/Result` | RPC types for quality:getAssessment                       |
| Add `QualityGetHistoryParams/Result`    | RPC types for quality:getHistory                          |
| Add `QualityHistoryEntry`               | Re-export from quality-assessment.types or define here    |
| Add `QualityExportParams/Result`        | RPC types for quality:export                              |
| Add 3 entries to `RpcMethodRegistry`    | quality:getAssessment, quality:getHistory, quality:export |
| Add 3 entries to `RPC_METHOD_NAMES`     | Runtime array for handler verification                    |

---

## 8. DI Changes Summary

### New DI Tokens (in `libs/backend/vscode-core/src/di/tokens.ts`)

| Token                     | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `FILE_HASH_CACHE_SERVICE` | File content hash caching for incremental analysis |
| `QUALITY_HISTORY_SERVICE` | Quality assessment history storage                 |
| `QUALITY_EXPORT_SERVICE`  | Quality report export (Markdown/JSON/CSV)          |

### New Service Registrations (in `libs/backend/workspace-intelligence/src/quality/di.ts`)

```typescript
// Tier 1.5: File hash cache (Phase F)
container.registerSingleton(TOKENS.FILE_HASH_CACHE_SERVICE, FileHashCacheService);

// Tier 5: History and export services (Phase G)
container.registerSingleton(TOKENS.QUALITY_HISTORY_SERVICE, QualityHistoryService);
container.registerSingleton(TOKENS.QUALITY_EXPORT_SERVICE, QualityExportService);
```

### RPC Handler Registration (in `apps/ptah-extension-vscode/src/services/rpc/`)

Register `QualityRpcHandlers` in the RPC method registration service, following the existing pattern of handler files in `handlers/` directory.

---

## 9. File Manifest

### Phase E2: Anti-Pattern Rules (~480 lines new, ~40 lines modified)

| File                                                                                          | Action | Lines Est.                                  |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +15 (new AntiPatternType values)            |
| `libs/shared/src/lib/types/anti-pattern-rules.types.ts`                                       | MODIFY | +3 (new RuleCategory values)                |
| `libs/backend/workspace-intelligence/src/quality/rules/angular-rules.ts`                      | CREATE | ~180                                        |
| `libs/backend/workspace-intelligence/src/quality/rules/nestjs-rules.ts`                       | CREATE | ~180                                        |
| `libs/backend/workspace-intelligence/src/quality/rules/react-rules.ts`                        | CREATE | ~160                                        |
| `libs/backend/workspace-intelligence/src/quality/rules/index.ts`                              | MODIFY | +12 (imports, ALL_RULES spread, re-exports) |
| `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts` | MODIFY | +6 (CATEGORY_FROM_TYPE, DEFAULT_STRENGTHS)  |

### Phase F: Performance Optimizations (~350 lines new, ~80 lines modified)

| File                                                                                          | Action | Lines Est.                                  |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| `libs/backend/workspace-intelligence/src/quality/services/file-hash-cache.service.ts`         | CREATE | ~150                                        |
| `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` | MODIFY | +25 (new interfaces)                        |
| `libs/backend/workspace-intelligence/src/quality/services/anti-pattern-detection.service.ts`  | MODIFY | +60 (async methods)                         |
| `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts` | MODIFY | +80 (incremental method, adaptive sampling) |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +8 (incrementalStats field)                 |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                   | MODIFY | +8 (FILE_HASH_CACHE_SERVICE token)          |
| `libs/backend/workspace-intelligence/src/quality/di.ts`                                       | MODIFY | +5 (register FileHashCacheService)          |
| `libs/backend/workspace-intelligence/src/quality/services/index.ts`                           | MODIFY | +2 (export FileHashCacheService)            |

### Phase G: Reporting and Visualization (~850 lines new, ~60 lines modified)

| File                                                                                          | Action | Lines Est.                                       |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| **Backend Services**                                                                          |        |                                                  |
| `libs/backend/workspace-intelligence/src/quality/services/quality-history.service.ts`         | CREATE | ~100                                             |
| `libs/backend/workspace-intelligence/src/quality/services/quality-export.service.ts`          | CREATE | ~200                                             |
| `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` | MODIFY | +20 (new interfaces)                             |
| `libs/backend/workspace-intelligence/src/quality/services/index.ts`                           | MODIFY | +2 (new exports)                                 |
| `libs/backend/workspace-intelligence/src/quality/di.ts`                                       | MODIFY | +10 (register new services)                      |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                   | MODIFY | +16 (2 new tokens)                               |
| **RPC Layer**                                                                                 |        |                                                  |
| `libs/shared/src/lib/types/rpc.types.ts`                                                      | MODIFY | +60 (new types, registry entries, array entries) |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +10 (QualityHistoryEntry)                        |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`                | CREATE | ~120                                             |
| `apps/ptah-extension-vscode/src/services/rpc/index.ts`                                        | MODIFY | +2 (export new handlers)                         |
| **Frontend Components**                                                                       |        |                                                  |
| `libs/frontend/dashboard/src/lib/services/quality-dashboard-state.service.ts`                 | CREATE | ~80                                              |
| `libs/frontend/dashboard/src/lib/components/quality/quality-dashboard-view.component.ts`      | CREATE | ~100                                             |
| `libs/frontend/dashboard/src/lib/components/quality/quality-score-card.component.ts`          | CREATE | ~60                                              |
| `libs/frontend/dashboard/src/lib/components/quality/quality-trend-chart.component.ts`         | CREATE | ~80                                              |
| `libs/frontend/dashboard/src/lib/components/quality/anti-pattern-distribution.component.ts`   | CREATE | ~80                                              |
| `libs/frontend/dashboard/src/lib/components/quality/quality-gaps-table.component.ts`          | CREATE | ~70                                              |
| `libs/frontend/dashboard/src/lib/components/quality/quality-recommendations.component.ts`     | CREATE | ~60                                              |
| `libs/frontend/dashboard/src/lib/components/quality/quality-export-button.component.ts`       | CREATE | ~60                                              |
| `libs/frontend/dashboard/src/index.ts`                                                        | MODIFY | +10 (exports)                                    |

**Total**: ~1,680 lines new code, ~180 lines modified across 25+ files.

---

## 10. Risk Analysis

### Technical Risks

| Risk                                                    | Severity | Mitigation                                                                                                                                                     |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Regex false positives** (Phase E2)                    | MEDIUM   | Design conservative patterns; prefer heuristic rules over brittle regex; document known false positive scenarios; mark rules as `info` severity when uncertain |
| **Angular template detection** (Phase E2)               | LOW      | Angular rules target `.ts` files with inline templates; separate `.html` template detection is bonus, not critical                                             |
| **VS Code globalState size limits** (Phase G)           | LOW      | QualityHistoryEntry is compact (~200 bytes); 100 entries = ~20KB; well within limits. Add eviction logic.                                                      |
| **Chart.js dependency** (Phase G)                       | LOW      | Dashboard CLAUDE.md already lists Chart.js as a dependency. Use DaisyUI progress bars as fallback for simple visualizations.                                   |
| **Performance regression from more rules** (Phase E2+F) | LOW      | 15 additional rules are lightweight (regex/heuristic). Phase F parallelism offsets any added overhead.                                                         |
| **Crypto module in VS Code extension** (Phase F)        | LOW      | Node.js `crypto` module is available in VS Code extension host; no bundling issues.                                                                            |
| **Stale cache patterns** (Phase F)                      | MEDIUM   | File hash cache may serve stale results if rules change between versions. Mitigation: clear cache on extension update (version check in cache metadata).       |

### Architecture Risks

| Risk                                                         | Severity | Mitigation                                                                                                                                    |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **RuleCategory type expansion** affects existing consumers   | LOW      | Adding union members is backward-compatible; existing code handles unknown categories gracefully (falls through category mapping).            |
| **Dashboard library empty** -- no existing pattern to follow | MEDIUM   | Dashboard CLAUDE.md provides detailed patterns. Follow signal-based, standalone component patterns from chat library as additional reference. |
| **RPC method count growth**                                  | LOW      | 3 new methods is minimal. RPC registry pattern handles this cleanly.                                                                          |

---

## 11. Batch Estimation

### Batch 1: Phase E2 -- Framework-Specific Rules

**Developer**: backend-developer
**Estimated Effort**: 4-6 hours
**Scope**:

- Extend `AntiPatternType` and `RuleCategory` in shared types
- Create `angular-rules.ts` (5 rules)
- Create `nestjs-rules.ts` (5 rules)
- Create `react-rules.ts` (5 rules)
- Update `rules/index.ts` (ALL_RULES, exports)
- Update `CATEGORY_FROM_TYPE` and `DEFAULT_STRENGTHS` in code-quality-assessment.service.ts
- Unit tests for all 15 rules

### Batch 2: Phase F -- Performance Optimizations

**Developer**: backend-developer
**Estimated Effort**: 4-6 hours
**Scope**:

- Create `FileHashCacheService` with SHA-256 hashing
- Add async detection methods to `AntiPatternDetectionService`
- Add `assessQualityIncremental()` to `CodeQualityAssessmentService`
- Implement adaptive sampling and framework-aware priority patterns
- Add `FILE_HASH_CACHE_SERVICE` DI token and registration
- Update shared types (`incrementalStats`)
- Unit tests for cache, incremental flow, and adaptive sampling

### Batch 3: Phase G -- Reporting and Visualization

**Developer**: backend-developer + frontend-developer (split)
**Estimated Effort**: 6-8 hours
**Scope (Backend -- 3-4h)**:

- Create `QualityHistoryService` (globalState persistence)
- Create `QualityExportService` (Markdown, JSON, CSV)
- Add RPC types to shared (params, results, registry)
- Create `quality-rpc.handlers.ts`
- Add DI tokens and registrations
- Unit tests for history, export, handlers

**Scope (Frontend -- 3-4h)**:

- Create `QualityDashboardStateService`
- Create 7 quality dashboard components
- Integrate into dashboard library exports
- Wire up to navigation/view system
- Visual verification with DaisyUI classes

---

## 12. Team-Leader Handoff

### Developer Type Recommendation

**Phase E2 + Phase F**: backend-developer

- Pure backend work: rule engine, services, DI, type system
- No frontend components involved
- Requires understanding of regex patterns and Node.js crypto

**Phase G**: Both backend-developer AND frontend-developer

- Backend: RPC handlers, services, persistence
- Frontend: Angular components, DaisyUI styling, signal-based state

### Complexity Assessment

**Overall Complexity**: MEDIUM
**Total Estimated Effort**: 14-20 hours across 3 batches

**Breakdown**:

- Phase E2: MEDIUM (repetitive pattern, but 15 rules with unique regex/heuristic logic each)
- Phase F: MEDIUM (cache design, async patterns, adaptive algorithms)
- Phase G: MEDIUM-HIGH (full stack: types -> RPC -> handlers -> services -> components)

### Files Affected Summary

**CREATE (18 files)**:

- `libs/backend/workspace-intelligence/src/quality/rules/angular-rules.ts`
- `libs/backend/workspace-intelligence/src/quality/rules/nestjs-rules.ts`
- `libs/backend/workspace-intelligence/src/quality/rules/react-rules.ts`
- `libs/backend/workspace-intelligence/src/quality/services/file-hash-cache.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/quality-history.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/quality-export.service.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`
- `libs/frontend/dashboard/src/lib/services/quality-dashboard-state.service.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-dashboard-view.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-score-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-trend-chart.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/anti-pattern-distribution.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-gaps-table.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-recommendations.component.ts`
- `libs/frontend/dashboard/src/lib/components/quality/quality-export-button.component.ts`

**MODIFY (10+ files)**:

- `libs/shared/src/lib/types/quality-assessment.types.ts`
- `libs/shared/src/lib/types/anti-pattern-rules.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/workspace-intelligence/src/quality/rules/index.ts`
- `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/anti-pattern-detection.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/index.ts`
- `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts`
- `libs/backend/workspace-intelligence/src/quality/di.ts`
- `libs/frontend/dashboard/src/index.ts`
- `apps/ptah-extension-vscode/src/services/rpc/index.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `createRegexRule` from `./rule-base` (rule-base.ts:110)
   - `createHeuristicRule` from `./rule-base` (rule-base.ts:191)
   - `AntiPatternRule`, `AntiPatternMatch` from `@ptah-extension/shared` (anti-pattern-rules.types.ts:49,21)
   - `TOKENS` from `@ptah-extension/vscode-core` (tokens.ts)
   - `injectable`, `inject` from `tsyringe`
   - `ClaudeRpcService`, `RpcResult` from `@ptah-extension/core`

2. **All patterns verified from examples**:

   - Rule file pattern: `typescript-rules.ts` (3 rules), `architecture-rules.ts` (3 rules)
   - Service pattern: `anti-pattern-detection.service.ts`, `code-quality-assessment.service.ts`
   - DI registration pattern: `quality/di.ts`
   - RPC handler pattern: `handlers/setup-rpc.handlers.ts`
   - Frontend component pattern: Dashboard CLAUDE.md component examples

3. **Library documentation consulted**:

   - `libs/backend/workspace-intelligence/CLAUDE.md`
   - `libs/shared/CLAUDE.md`
   - `libs/frontend/dashboard/CLAUDE.md`
   - `libs/frontend/core/CLAUDE.md`

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()` (tsyringe), `@inject()` (tsyringe), `@Component()` (Angular)
   - All base patterns verified from existing rule files
   - All DI tokens verified in `vscode-core/src/di/tokens.ts`
   - RPC registry pattern verified in `rpc.types.ts:936`

### Architecture Delivery Checklist

- [x] All components specified with codebase evidence
- [x] All patterns verified from existing rule files (4 rule files examined)
- [x] All imports/decorators verified as existing in codebase
- [x] Quality requirements defined (performance targets, severity levels)
- [x] Integration points documented (RPC, DI, navigation)
- [x] Files affected list complete (18 CREATE, 10+ MODIFY)
- [x] Developer type recommended (backend + frontend for Phase G)
- [x] Complexity assessed (MEDIUM overall, 14-20 hours, 3 batches)
- [x] No step-by-step implementation details (team-leader's responsibility)
