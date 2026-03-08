# Development Tasks - TASK_2025_144

## Overview

- **Total Tasks**: 28
- **Total Batches**: 5 (Batch 3 split into 3a backend + 3b frontend)
- **Estimated Duration**: 14-20 hours
- **Status**: 4/4 complete (ALL BATCHES COMPLETE)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `createRegexRule` / `createHeuristicRule` factories: Verified in `rule-base.ts:30-40` (RegexRuleConfig, HeuristicRuleConfig)
- `ALL_RULES` array aggregation pattern: Verified in `rules/index.ts:54` -- spread operator pattern
- `RuleCategory` type union: Verified in `anti-pattern-rules.types.ts:40-44` -- currently 4 values
- `AntiPatternType` union: Verified in `quality-assessment.types.ts:20-39` -- currently 15 values
- `CATEGORY_FROM_TYPE` / `DEFAULT_STRENGTHS` maps: Verified in `code-quality-assessment.service.ts:88-103`
- `TOKENS` object: Verified in `tokens.ts:262-406` -- has Project Intelligence section at line 326
- `RpcMethodRegistry` interface: Verified in `rpc.types.ts:936` -- pattern for adding new methods
- `RPC_METHOD_NAMES` array: Verified in `rpc.types.ts:1130-1202` -- must add entries here too
- `registerQualityServices` function: Verified in `quality/di.ts:38-84` -- DependencyContainer + Logger params
- `RpcHandler` pattern: Verified in `setup-rpc.handlers.ts` -- injectable class with registerHandlers method
- Dashboard library `src/index.ts`: Verified EMPTY -- no existing content to conflict with
- Frontend signal-based patterns: Verified in Dashboard CLAUDE.md -- standalone components, inject(), DaisyUI

### Risks Identified

| Risk                                                  | Severity | Mitigation                                                                                        |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Regex false positives in framework rules              | MEDIUM   | Use heuristic rules for complex patterns; conservative regex; info severity for uncertain matches |
| Angular template detection limited to .ts files       | LOW      | Project uses inline templates in .ts; separate .html is bonus, not critical                       |
| Dashboard library has no existing pattern to follow   | MEDIUM   | Dashboard CLAUDE.md provides detailed examples; chat library components as secondary reference    |
| Stale cache patterns if rules change between versions | MEDIUM   | Add version key to cache metadata; clear on extension update; 30min TTL provides natural expiry   |
| VS Code globalState size limits for history           | LOW      | QualityHistoryEntry is compact (~200 bytes); 100 entries = ~20KB; well within limits              |
| crypto module in VS Code extension                    | LOW      | Node.js crypto available in extension host; no bundling issues                                    |

### Edge Cases to Handle

- [ ] Empty workspace (no source files) -> Return neutral assessment (existing handling in Task 2.1)
- [x] Files with no matching framework rules -> Skip gracefully, existing rules still apply (Batch 1)
- [ ] Cache hash collision -> Negligible with 16-char SHA-256 hex for < 10k files
- [ ] All files cached (no changes) -> Return fully cached result with 100% cache hit rate
- [ ] No quality history entries yet -> Return empty array, chart shows "no data" state
- [ ] Export with no assessment data -> Return meaningful empty report
- [ ] RPC call before assessment loaded -> Frontend shows loading state

---

## Batch 1: Phase E2 - Shared Types + Framework Anti-Pattern Rules [COMPLETE]

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: None
**Commit**: 5bbde84 - feat(vscode): add Angular, NestJS, React anti-pattern rules (TASK_2025_144)

### Task 1.1: Extend AntiPatternType and RuleCategory in Shared Types [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\quality-assessment.types.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:96-139 (Section 4.1, 4.2)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\quality-assessment.types.ts:20-39` (existing AntiPatternType union)
**Dependencies**: None

**Description**: Add 15 new values to `AntiPatternType` union (5 Angular, 5 NestJS, 5 React) and 3 new values to `RuleCategory` in `anti-pattern-rules.types.ts`.

**Quality Requirements**:

- All new type values use kebab-case matching existing convention
- JSDoc comments updated to reflect new categories
- Both files (quality-assessment.types.ts and anti-pattern-rules.types.ts) must be updated

**Implementation Details**:

- In `quality-assessment.types.ts`: Add to `AntiPatternType` union:
  - Angular: `'angular-improper-change-detection'`, `'angular-subscription-leak'`, `'angular-circular-dependency'`, `'angular-large-component'`, `'angular-missing-trackby'`
  - NestJS: `'nestjs-missing-decorator'`, `'nestjs-controller-logic'`, `'nestjs-unsafe-repository'`, `'nestjs-missing-guard'`, `'nestjs-circular-module'`
  - React: `'react-missing-key'`, `'react-direct-state-mutation'`, `'react-useeffect-dependencies'`, `'react-large-component'`, `'react-inline-function-prop'`
- In `anti-pattern-rules.types.ts` (`D:\projects\ptah-extension\libs\shared\src\lib\types\anti-pattern-rules.types.ts`): Add to `RuleCategory`:
  - `'angular'`, `'nestjs'`, `'react'`

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~25 (modifications across 2 files)

---

### Task 1.2: Create Angular Anti-Pattern Rules [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\angular-rules.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:143-215 (Section 4.3)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\typescript-rules.ts`
**Dependencies**: Task 1.1

**Description**: Create 5 Angular-specific anti-pattern detection rules using createRegexRule and createHeuristicRule factories.

**Quality Requirements**:

- Each rule has JSDoc documentation with @severity, @example sections
- Rules properly match Angular patterns (inline templates in .ts files)
- File header follows exact pattern from typescript-rules.ts
- Export `angularRules: AntiPatternRule[]` array

**Implementation Details**:

- Import `createRegexRule`, `createHeuristicRule` from `'./rule-base'`
- Import `AntiPatternRule` from `'@ptah-extension/shared'`
- Rule 1: `angular-improper-change-detection` (heuristic) - Detect @Component without OnPush or manual detectChanges()
- Rule 2: `angular-subscription-leak` (heuristic) - Detect .subscribe() in components without cleanup patterns
- Rule 3: `angular-circular-dependency` (regex) - Detect forwardRef() usage: `/forwardRef\s*\(\s*\(\)\s*=>/g`
- Rule 4: `angular-large-component` (heuristic) - Detect @Component files > 500 lines
- Rule 5: `angular-missing-trackby` (heuristic) - Detect \*ngFor without trackBy, @for without track
- All rules use `category: 'angular'`, `fileExtensions: ['.ts']` (except trackBy which includes `['.ts', '.html']`)

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~180

---

### Task 1.3: Create NestJS Anti-Pattern Rules [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\nestjs-rules.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:217-276 (Section 4.4)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\typescript-rules.ts`
**Dependencies**: Task 1.1

**Description**: Create 5 NestJS-specific anti-pattern detection rules.

**Quality Requirements**:

- Each rule has JSDoc documentation with @severity, @example sections
- Rules properly detect NestJS-specific patterns
- Export `nestjsRules: AntiPatternRule[]` array

**Implementation Details**:

- Import `createRegexRule`, `createHeuristicRule` from `'./rule-base'`
- Import `AntiPatternRule` from `'@ptah-extension/shared'`
- Rule 6: `nestjs-missing-decorator` (heuristic) - Detect NestJS classes without @Injectable/@Controller/@Module
- Rule 7: `nestjs-controller-logic` (heuristic) - Detect controller methods > 20 lines
- Rule 8: `nestjs-unsafe-repository` (regex) - Detect template literal/concat in query()/execute() calls
- Rule 9: `nestjs-missing-guard` (heuristic) - Detect @Post/@Put/@Delete/@Patch without @UseGuards
- Rule 10: `nestjs-circular-module` (regex) - Detect forwardRef in module imports: `/imports\s*:\s*\[[^\]]*forwardRef/g`
- All rules use `category: 'nestjs'`, `fileExtensions: ['.ts']`

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~180

---

### Task 1.4: Create React Anti-Pattern Rules [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\react-rules.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:278-337 (Section 4.5)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\typescript-rules.ts`
**Dependencies**: Task 1.1

**Description**: Create 5 React-specific anti-pattern detection rules.

**Quality Requirements**:

- Each rule has JSDoc documentation with @severity, @example sections
- Rules properly detect React/JSX patterns
- Export `reactRules: AntiPatternRule[]` array

**Implementation Details**:

- Import `createRegexRule`, `createHeuristicRule` from `'./rule-base'`
- Import `AntiPatternRule` from `'@ptah-extension/shared'`
- Rule 11: `react-missing-key` (heuristic) - Detect .map() returning JSX without key prop; `fileExtensions: ['.tsx', '.jsx']`
- Rule 12: `react-direct-state-mutation` (regex) - Detect `this.state.prop = value`; pattern: `/this\.state\s*\.\s*\w+\s*=/g`; `fileExtensions: ['.tsx', '.jsx', '.ts', '.js']`
- Rule 13: `react-useeffect-dependencies` (heuristic) - Detect useEffect with [] deps referencing props/state; `fileExtensions: ['.tsx', '.jsx', '.ts', '.js']`
- Rule 14: `react-large-component` (heuristic) - Detect React component files > 300 lines; `fileExtensions: ['.tsx', '.jsx']`
- Rule 15: `react-inline-function-prop` (regex) - Detect `propName={(...) =>`; pattern: `/\w+=\{\s*\([^)]*\)\s*=>/g`; `fileExtensions: ['.tsx', '.jsx']`

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~160

---

### Task 1.5: Update Rules Index with New Rule Modules [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\index.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:369-387 (Section 4.7)
**Pattern to Follow**: Existing imports/exports in `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\index.ts:22-27,54-59,340-362`
**Dependencies**: Tasks 1.2, 1.3, 1.4

**Description**: Import new rule modules, add to ALL_RULES array, add re-exports for new rule modules and individual rules.

**Quality Requirements**:

- Follow exact import pattern from existing rule imports (lines 22-27)
- Add to ALL_RULES spread pattern (lines 54-59)
- Add re-exports matching existing pattern (lines 340-362)

**Implementation Details**:

- Add imports: `import { angularRules } from './angular-rules';`, `import { nestjsRules } from './nestjs-rules';`, `import { reactRules } from './react-rules';`
- Extend ALL_RULES: `...angularRules, ...nestjsRules, ...reactRules`
- Add re-exports: `export { angularRules } from './angular-rules';`, `export { nestjsRules } from './nestjs-rules';`, `export { reactRules } from './react-rules';`
- Add individual rule exports for each of the 15 new rules

**Verification**: `npx nx run workspace-intelligence:typecheck` passes; ALL_RULES.length increases by 15
**Lines**: ~30 (modifications)

---

### Task 1.6: Update CATEGORY_FROM_TYPE and DEFAULT_STRENGTHS Maps [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\code-quality-assessment.service.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:339-367 (Section 4.6)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\code-quality-assessment.service.ts:88-103`
**Dependencies**: Task 1.1

**Description**: Add new entries to CATEGORY_FROM_TYPE and DEFAULT_STRENGTHS maps for angular, nestjs, and react categories.

**Quality Requirements**:

- Follow exact map entry pattern from existing entries
- Category names match implementation plan specification

**Implementation Details**:

- Add to `CATEGORY_FROM_TYPE` (line 88-93):
  - `angular: 'Angular Best Practices'`
  - `nestjs: 'NestJS Best Practices'`
  - `react: 'React Best Practices'`
- Add to `DEFAULT_STRENGTHS` (line 98-103):
  - `angular: 'Angular components follow best practices'`
  - `nestjs: 'NestJS services follow proper patterns'`
  - `react: 'React components follow best practices'`

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~6 (modifications)

---

### Task 1.7: Add Unit Tests for 15 New Rules [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\framework-rules.spec.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md NFR-003, NFR-004
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\rules.spec.ts`
**Dependencies**: Tasks 1.2, 1.3, 1.4, 1.5

**Description**: Create comprehensive unit tests for all 15 new framework-specific rules. Test each rule with positive matches (code containing the anti-pattern) and negative matches (clean code). Test RuleRegistry integration with new categories.

**Quality Requirements**:

- Each rule has at least 2 positive and 2 negative test cases
- Test RuleRegistry.getRulesByCategory for 'angular', 'nestjs', 'react'
- Test RuleRegistry.getRulesForExtension for '.tsx', '.jsx', '.html'
- Tests are self-documenting with descriptive names

**Implementation Details**:

- Import all rules from respective modules
- Import RuleRegistry from index
- Test suites:
  - `describe('Angular Rules')` - 5 rules x 4+ tests each
  - `describe('NestJS Rules')` - 5 rules x 4+ tests each
  - `describe('React Rules')` - 5 rules x 4+ tests each
  - `describe('RuleRegistry Integration')` - category/extension filtering for new rules

**Verification**: `npx nx test workspace-intelligence --testPathPattern=framework-rules.spec` passes
**Lines**: ~400

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] `npx nx run shared:typecheck` passes
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Unit tests pass for all 15 new rules (550 passed, 19 suites)
- [x] code-logic-reviewer: APPROVED (no stubs/placeholders/TODOs)
- [x] ALL_RULES.length is 25 (10 existing + 15 new)
- [x] RuleRegistry correctly filters by new categories

---

## Batch 2: Phase F - Performance Optimizations [COMPLETE]

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: Batch 1 (COMPLETE)
**Commit**: 3a0baf5 - feat(vscode): add incremental analysis and perf opts (TASK_2025_144)

### Task 2.1: Add incrementalStats to QualityAssessment Type [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\quality-assessment.types.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:472-485 (Section 5.3)
**Pattern to Follow**: Existing optional fields in `QualityAssessment` interface at line 106-121
**Dependencies**: Batch 1

**Description**: Add optional `incrementalStats` field to `QualityAssessment` interface for tracking incremental analysis cache statistics.

**Quality Requirements**:

- Field is optional (backward compatible)
- JSDoc documentation on interface and fields
- Follow existing naming conventions

**Implementation Details**:

- Add to `QualityAssessment` interface (after `analysisDurationMs`):
  ```typescript
  /** Statistics from incremental analysis (Phase F - TASK_2025_144) */
  incrementalStats?: {
    /** Number of files retrieved from cache */
    cachedFiles: number;
    /** Number of files analyzed fresh */
    freshFiles: number;
    /** Cache hit rate (0-1) */
    cacheHitRate: number;
  };
  ```

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~8

---

### Task 2.2: Add FILE_HASH_CACHE_SERVICE DI Token [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:613-616 (Section 5.7)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts:216-242` (existing Project Intelligence tokens)
**Dependencies**: None

**Description**: Add `FILE_HASH_CACHE_SERVICE` DI token and add it to the TOKENS object.

**Quality Requirements**:

- Use `Symbol.for()` pattern matching existing tokens
- Add JSDoc comment describing service purpose
- Add to TOKENS object in the "Project Intelligence" section

**Implementation Details**:

- Add after `PRESCRIPTIVE_GUIDANCE_SERVICE` (line 242):
  ```typescript
  /** FileHashCacheService - SHA-256 content hashing for incremental analysis (TASK_2025_144) */
  export const FILE_HASH_CACHE_SERVICE = Symbol.for('FileHashCacheService');
  ```
- Add to TOKENS object after `PRESCRIPTIVE_GUIDANCE_SERVICE` entry (line 330):
  ```typescript
  FILE_HASH_CACHE_SERVICE,
  ```

**Verification**: `npx nx run vscode-core:typecheck` passes
**Lines**: ~8

---

### Task 2.3: Create FileHashCacheService [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\file-hash-cache.service.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:401-449 (Section 5.2)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\anti-pattern-detection.service.ts`
**Dependencies**: Task 2.2

**Description**: Create service that maintains a map of file path to content hash for incremental analysis. Uses SHA-256 for content hashing and stores cached anti-pattern results per file.

**Quality Requirements**:

- Use `@injectable()` decorator
- Inject `TOKENS.LOGGER`
- Implement IFileHashCacheService interface (define in quality-assessment.interfaces.ts)
- LRU eviction at 10,000 entries
- 30-minute cache TTL
- Store detected patterns per-file for incremental merge

**Implementation Details**:

- Import `createHash` from `'crypto'`
- Private `Map<string, { hash: string; analysisTimestamp: number; patterns: AntiPattern[] }>` storage
- `computeHash(content: string): string` -- `createHash('sha256').update(content).digest('hex').substring(0, 16)`
- Methods: `getHash`, `setHash`, `hasChanged`, `updateHash`, `getCachedPatterns`, `setCachedPatterns`, `getCachedFiles`, `clearCache`, `getStats`
- LRU eviction: when map size > 10000, remove oldest entries by analysisTimestamp
- TTL check: entries older than 30 minutes are treated as stale

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~150

---

### Task 2.4: Add IFileHashCacheService Interface [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\interfaces\quality-assessment.interfaces.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:413-429 (Section 5.2)
**Pattern to Follow**: Existing interfaces in `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\interfaces\quality-assessment.interfaces.ts`
**Dependencies**: Task 2.1

**Description**: Add `IFileHashCacheService` interface definition to the quality assessment interfaces file.

**Quality Requirements**:

- JSDoc documentation on interface and all methods
- Import AntiPattern from @ptah-extension/shared
- Follow existing interface patterns in the file

**Implementation Details**:

- Add interface `IFileHashCacheService`:
  - `getHash(filePath: string): string | undefined`
  - `setHash(filePath: string, hash: string): void`
  - `hasChanged(filePath: string, content: string): boolean`
  - `updateHash(filePath: string, content: string): void`
  - `getCachedPatterns(filePath: string): AntiPattern[] | undefined`
  - `setCachedPatterns(filePath: string, patterns: AntiPattern[]): void`
  - `getCachedFiles(): string[]`
  - `clearCache(): void`
  - `getStats(): { totalCached: number; cacheHitRate: number }`

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~25

---

### Task 2.5: Add Async Detection Methods to AntiPatternDetectionService [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\anti-pattern-detection.service.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:487-546 (Section 5.4)
**Pattern to Follow**: Existing `detectPatterns` and `detectPatternsInFiles` methods in the same file
**Dependencies**: None

**Description**: Add parallel async variants of detection methods using `Promise.allSettled`. Existing sync methods remain unchanged for backward compatibility.

**Quality Requirements**:

- Existing sync methods remain untouched
- New async methods run rules in parallel per-file
- Multi-file processing in batches of 5
- Failed rules log warnings but don't block other rules
- Method names: `detectPatternsAsync`, `detectPatternsInFilesAsync`

**Implementation Details**:

- Add `async detectPatternsAsync(content: string, filePath: string): Promise<AntiPattern[]>`:
  - Get applicable rules for extension
  - `Promise.allSettled(rules.map(rule => Promise.resolve().then(() => rule.detect(content, filePath))))`
  - Collect fulfilled results, log rejected
  - Process matches into AntiPattern[] same as sync version
- Add `async detectPatternsInFilesAsync(files: SampledFile[]): Promise<AntiPattern[]>`:
  - Process files in batches of 5 using `Promise.allSettled`
  - Aggregate patterns with frequency tracking
  - Return aggregated AntiPattern[]

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~60

---

### Task 2.6: Add assessQualityIncremental and Adaptive Sampling to CodeQualityAssessmentService [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\code-quality-assessment.service.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:452-600 (Sections 5.3, 5.5)
**Pattern to Follow**: Existing `assessQuality` method in same file (lines 190-256)
**Dependencies**: Tasks 2.3, 2.4, 2.5

**Description**: Add `assessQualityIncremental()` method that uses FileHashCacheService for incremental analysis. Add adaptive sample size calculation and framework-aware priority patterns.

**Quality Requirements**:

- New method uses FileHashCacheService for cache-aware analysis
- Inject FileHashCacheService via constructor (add new @inject parameter)
- Adaptive sample size based on project file count
- Framework-aware priority patterns
- Returns QualityAssessment with incrementalStats populated
- Existing `assessQuality` method remains unchanged

**Implementation Details**:

- Add constructor parameter: `@inject(TOKENS.FILE_HASH_CACHE_SERVICE) private readonly fileHashCache: IFileHashCacheService`
- Add `assessQualityIncremental(workspaceUri, config?)`:
  1. Sample files
  2. For each file: check fileHashCache.hasChanged(path, content)
  3. If unchanged: retrieve cached patterns
  4. If changed: run detectPatternsAsync, update cache
  5. Merge cached + fresh patterns
  6. Calculate score, gaps, strengths
  7. Return QualityAssessment with incrementalStats
- Add `calculateAdaptiveSampleSize(totalFiles: number): number`:
  - <= 50: min(totalFiles, 15)
  - <= 200: 20
  - <= 1000: 30
  - <= 5000: 40
  - else: 50
- Add `getFrameworkPriorityPatterns(framework: string | undefined): string[]`:
  - Angular: ['component', 'service', 'module', 'guard', 'interceptor', 'pipe', 'directive']
  - React: ['component', 'hook', 'context', 'provider', 'reducer', 'store']
  - NestJS: ['controller', 'service', 'module', 'guard', 'middleware', 'interceptor', 'repository']
  - Default: ['service', 'component', 'controller', 'repository', 'model']

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~80

---

### Task 2.7: Register FileHashCacheService in DI and Add Unit Tests [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\di.ts` (MODIFY) + `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\index.ts` (MODIFY) + `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\performance.spec.ts` (CREATE)
**Action**: MODIFY + CREATE
**Spec Reference**: implementation-plan.md:1093-1098 (Section 8)
**Pattern to Follow**: Existing DI registration in `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\di.ts:44-74`
**Dependencies**: Tasks 2.3, 2.6

**Description**: Register FileHashCacheService in DI container, export from services index, and create unit tests for the performance optimization features.

**Quality Requirements**:

- Register as singleton in di.ts (Tier 1.5, between AntiPatternDetection and CodeQualityAssessment)
- Export from services/index.ts
- Unit tests for FileHashCacheService, async detection, adaptive sampling

**Implementation Details**:

- In `di.ts`: Add import for `FileHashCacheService`, register with `TOKENS.FILE_HASH_CACHE_SERVICE`
- In `services/index.ts`: Add `export { FileHashCacheService } from './file-hash-cache.service';`
- In `performance.spec.ts`:
  - Test FileHashCacheService: hash computation, cache hit/miss, TTL expiry, LRU eviction, stats
  - Test async detection: parallel execution, fault isolation (one rule failing doesn't block others)
  - Test adaptive sampling: correct sizes for different project scales
  - Test framework priority patterns: correct patterns for each framework

**Verification**: `npx nx test workspace-intelligence --testPathPattern=performance.spec` passes; `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~300 (test file) + ~15 (modifications)

---

**Batch 2 Verification**:

- [x] All files exist at paths
- [x] `npx nx run shared:typecheck` passes
- [x] `npx nx run vscode-core:typecheck` passes (token added correctly)
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Unit tests pass for cache, async detection, adaptive sampling (performance.spec.ts PASS)
- [x] code-logic-reviewer approved (no stubs/TODOs/placeholders found)
- [x] FileHashCacheService registered in DI (Tier 1.5 in di.ts)
- [x] Existing sync methods unchanged (backward compatible)

---

## Batch 3a: Phase G - Backend Services (RPC, History, Export) [COMPLETE]

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: Batch 2 (COMPLETE)
**Commit**: d5c8442 - feat(vscode): add quality history, export services, and RPC handlers (TASK_2025_144)

### Task 3a.1: Add Quality RPC Types to Shared [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY) + `D:\projects\ptah-extension\libs\shared\src\lib\types\quality-assessment.types.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:632-712 (Section 6.2)
**Pattern to Follow**: Existing RPC types in `rpc.types.ts:860-908` and RpcMethodRegistry pattern at line 936
**Dependencies**: Batch 2

**Description**: Add Quality Dashboard RPC parameter/result types, QualityHistoryEntry interface, RpcMethodRegistry entries, and RPC_METHOD_NAMES entries.

**Quality Requirements**:

- Types follow exact naming convention from existing RPC types
- QualityHistoryEntry defined in quality-assessment.types.ts, re-imported in rpc.types.ts
- 3 new registry entries: quality:getAssessment, quality:getHistory, quality:export
- 3 new RPC_METHOD_NAMES entries

**Implementation Details**:

- In `quality-assessment.types.ts`: Add `QualityHistoryEntry` interface:
  - `timestamp: number`, `score: number`, `patternCount: number`, `filesAnalyzed: number`, `categoryCounts: Record<string, number>`
- In `rpc.types.ts`: Add section comment `// ---- Quality Dashboard Methods (TASK_2025_144) ----`
- Add types: `QualityGetAssessmentParams`, `QualityGetAssessmentResult`, `QualityGetHistoryParams`, `QualityGetHistoryResult`, `QualityExportParams`, `QualityExportResult`
- Add to `RpcMethodRegistry`: 3 new entries
- Add to `RPC_METHOD_NAMES` array: `'quality:getAssessment'`, `'quality:getHistory'`, `'quality:export'`
- Import `ProjectIntelligence`, `QualityHistoryEntry` from quality-assessment.types.ts

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~70

---

### Task 3a.2: Add QUALITY_HISTORY_SERVICE and QUALITY_EXPORT_SERVICE DI Tokens [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:1082-1089 (Section 8)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts:216-242`
**Dependencies**: None

**Description**: Add 2 new DI tokens for QualityHistoryService and QualityExportService, add to TOKENS object.

**Quality Requirements**:

- Use Symbol.for() pattern
- JSDoc comments
- Add to TOKENS object in Project Intelligence section

**Implementation Details**:

- Add after `FILE_HASH_CACHE_SERVICE`:
  ```typescript
  /** QualityHistoryService - Assessment history persistence via globalState (TASK_2025_144) */
  export const QUALITY_HISTORY_SERVICE = Symbol.for('QualityHistoryService');
  /** QualityExportService - Quality report export (Markdown/JSON/CSV) (TASK_2025_144) */
  export const QUALITY_EXPORT_SERVICE = Symbol.for('QualityExportService');
  ```
- Add to TOKENS object: `QUALITY_HISTORY_SERVICE,` and `QUALITY_EXPORT_SERVICE,`

**Verification**: `npx nx run vscode-core:typecheck` passes
**Lines**: ~12

---

### Task 3a.3: Add IQualityHistoryService and IQualityExportService Interfaces [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\interfaces\quality-assessment.interfaces.ts` (MODIFY)
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:746-787 (Sections 6.4, 6.5)
**Pattern to Follow**: Existing interfaces in same file
**Dependencies**: Task 3a.1

**Description**: Add service interface definitions for quality history persistence and quality report export.

**Quality Requirements**:

- JSDoc documentation on interfaces and all methods
- Import QualityHistoryEntry, ProjectIntelligence from @ptah-extension/shared

**Implementation Details**:

- Add `IQualityHistoryService` interface:
  - `recordAssessment(assessment: QualityAssessment): void`
  - `getHistory(limit?: number): QualityHistoryEntry[]`
  - `clearHistory(): void`
- Add `IQualityExportService` interface:
  - `exportMarkdown(intelligence: ProjectIntelligence): string`
  - `exportJson(intelligence: ProjectIntelligence): string`
  - `exportCsv(intelligence: ProjectIntelligence): string`

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~40

---

### Task 3a.4: Create QualityHistoryService [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\quality-history.service.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:746-768 (Section 6.4)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\prescriptive-guidance.service.ts`
**Dependencies**: Task 3a.3

**Description**: Create service for storing quality assessment snapshots using VS Code globalState for persistence.

**Quality Requirements**:

- Use @injectable() decorator
- Inject TOKENS.LOGGER and TOKENS.GLOBAL_STATE
- Maximum 100 entries (oldest evicted)
- Compact storage (no full anti-pattern details, just aggregated counts)
- Key: `ptah.quality.history`

**Implementation Details**:

- Private `STORAGE_KEY = 'ptah.quality.history'`
- Private `MAX_ENTRIES = 100`
- `recordAssessment(assessment: QualityAssessment)`:
  - Create QualityHistoryEntry from assessment: timestamp, score, patternCount, filesAnalyzed, categoryCounts
  - Read existing entries from globalState
  - Prepend new entry (newest first)
  - Trim to MAX_ENTRIES
  - Write back to globalState
- `getHistory(limit = 30)`: Read from globalState, slice to limit
- `clearHistory()`: Write empty array to globalState

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~100

---

### Task 3a.5: Create QualityExportService [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\quality-export.service.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:770-833 (Section 6.5)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\prescriptive-guidance.service.ts`
**Dependencies**: Task 3a.3

**Description**: Create service for generating quality reports in Markdown, JSON, and CSV formats.

**Quality Requirements**:

- Use @injectable() decorator
- Inject TOKENS.LOGGER
- Markdown report follows template from implementation plan
- JSON export is full ProjectIntelligence serialization
- CSV export is flat anti-pattern rows

**Implementation Details**:

- `exportMarkdown(intelligence: ProjectIntelligence): string`:
  - Generate report with: header, summary, anti-patterns table, quality gaps table, strengths list, recommendations list
  - Use template from implementation-plan.md:791-823
- `exportJson(intelligence: ProjectIntelligence): string`:
  - `JSON.stringify(intelligence, null, 2)`
- `exportCsv(intelligence: ProjectIntelligence): string`:
  - Header row: `type,severity,file,line,column,frequency,message,suggestion`
  - One row per anti-pattern
  - Proper CSV escaping for fields with commas/quotes

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~200

---

### Task 3a.6: Create Quality RPC Handlers [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\quality-rpc.handlers.ts` (CREATE) + `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts` (MODIFY)
**Action**: CREATE + MODIFY
**Spec Reference**: implementation-plan.md:714-739 (Section 6.3)
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Dependencies**: Tasks 3a.4, 3a.5

**Description**: Create RPC handler class that bridges frontend RPC calls to backend services. Register in handlers index.

**Quality Requirements**:

- Use @injectable() decorator with constructor injection
- Register 3 handlers: quality:getAssessment, quality:getHistory, quality:export
- Error handling with try/catch in each handler
- Follow exact handler pattern from setup-rpc.handlers.ts

**Implementation Details**:

- `@injectable()` class `QualityRpcHandlers` with constructor:
  - `@inject(TOKENS.LOGGER) logger: Logger`
  - `@inject(TOKENS.PROJECT_INTELLIGENCE_SERVICE) intelligenceService: IProjectIntelligenceService`
  - `@inject(TOKENS.QUALITY_HISTORY_SERVICE) historyService: IQualityHistoryService`
  - `@inject(TOKENS.QUALITY_EXPORT_SERVICE) exportService: IQualityExportService`
- `registerHandlers(rpcHandler: RpcHandler): void`:
  - `quality:getAssessment`: Call intelligenceService.getIntelligence, optionally invalidate cache first, record in history
  - `quality:getHistory`: Call historyService.getHistory
  - `quality:export`: Call exportService based on format param
- In `handlers/index.ts`: Add `export { QualityRpcHandlers } from './quality-rpc.handlers';`

**Verification**: `npx nx run ptah-extension-vscode:typecheck` passes (if available) or file compiles without errors
**Lines**: ~120 + ~2

---

### Task 3a.7: Register Phase G Services in DI and Add Unit Tests [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\di.ts` (MODIFY) + `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\index.ts` (MODIFY) + `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\reporting.spec.ts` (CREATE)
**Action**: MODIFY + CREATE
**Spec Reference**: implementation-plan.md:1092-1103 (Section 8)
**Pattern to Follow**: Existing DI registration in `quality/di.ts`
**Dependencies**: Tasks 3a.4, 3a.5

**Description**: Register QualityHistoryService and QualityExportService in DI, export from services index, create unit tests.

**Quality Requirements**:

- Register both as singletons in di.ts (Tier 5, after ProjectIntelligenceService)
- Export from services/index.ts
- Unit tests for history (record, retrieve, limit, eviction), export (markdown format, JSON, CSV escaping)

**Implementation Details**:

- In `di.ts`: Import and register `QualityHistoryService` with `TOKENS.QUALITY_HISTORY_SERVICE`, `QualityExportService` with `TOKENS.QUALITY_EXPORT_SERVICE`
- In `services/index.ts`: Add exports for both new services
- In `reporting.spec.ts`:
  - Test QualityHistoryService: recordAssessment, getHistory with limit, MAX_ENTRIES eviction, clearHistory
  - Test QualityExportService: exportMarkdown (structure validation), exportJson (valid JSON), exportCsv (header + rows, escaping)
  - Mock globalState for history tests

**Verification**: `npx nx test workspace-intelligence --testPathPattern=reporting.spec` passes; `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~250 (test file) + ~15 (modifications)

---

**Batch 3a Verification**:

- [x] All files exist at paths (11 files: 4 created, 7 modified)
- [x] `npx nx run shared:typecheck` passes
- [x] `npx nx run vscode-core:typecheck` passes
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Unit tests pass for history and export services (reporting.spec.ts PASS, 21 suites, 632 passed)
- [x] code-logic-reviewer approved (no stubs/TODOs/placeholders found)
- [x] RPC types added to registry (3 methods: quality:getAssessment, quality:getHistory, quality:export)
- [x] RPC handlers created and exported (QualityRpcHandlers in handlers/index.ts)
- [x] DI registrations complete for all Phase G backend services (Tier 5 in di.ts)

---

## Batch 3b: Phase G - Frontend Quality Dashboard Components [COMPLETE]

**Status**: COMPLETE
**Developer**: frontend-developer
**Tasks**: 7 | **Dependencies**: Batch 3a (COMPLETE)
**Commit**: fd1b8c0 - feat(vscode): add quality dashboard components (TASK_2025_144)

### Task 3b.1: Create QualityDashboardStateService [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\quality-dashboard-state.service.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:920-975 (Section 6.6 - QualityDashboardStateService)
**Pattern to Follow**: Dashboard CLAUDE.md `DashboardStateService` pattern
**Dependencies**: Batch 3a (RPC types must exist)

**Description**: Create signal-based state service for quality dashboard. Manages loading/error states and communicates with backend via RPC.

**Quality Requirements**:

- `@Injectable({ providedIn: 'root' })`
- All state via Angular signals (no RxJS BehaviorSubject)
- Public readonly signals, private writeable signals
- Error handling for RPC failures

**Implementation Details**:

- Inject `ClaudeRpcService` from `@ptah-extension/core`
- Private signals: `_intelligence`, `_history`, `_loading`, `_error`
- Public readonly signals: `intelligence`, `history`, `loading`, `error`
- Methods:
  - `async loadAssessment(forceRefresh = false)`: Call `quality:getAssessment` RPC
  - `async loadHistory(limit = 30)`: Call `quality:getHistory` RPC
  - `async exportReport(format)`: Call `quality:export` RPC, return content string

**Verification**: `npx nx run dashboard:typecheck` passes (or manual inspection)
**Lines**: ~80

---

### Task 3b.2: Create QualityScoreCardComponent [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-score-card.component.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:980-989 (Section 6.6 - QualityScoreCardComponent)
**Pattern to Follow**: Dashboard CLAUDE.md MetricsOverviewComponent pattern
**Dependencies**: Task 3b.1

**Description**: Display quality score as a large number with DaisyUI stat classes and color coding based on score threshold.

**Quality Requirements**:

- Standalone component with ChangeDetectionStrategy.OnPush
- Use `input.required<number>()` for score
- Use `input.required<QualityGap[]>()` for gaps
- DaisyUI stat classes for card layout
- Color: >= 80 green (text-success), >= 60 yellow (text-warning), < 60 red (text-error)

**Implementation Details**:

- `@Component({ selector: 'ptah-quality-score-card', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush })`
- Computed signal for color class based on score threshold
- Display: score /100, gap count summary, severity breakdown

**Verification**: Component compiles, template renders with test data
**Lines**: ~60

---

### Task 3b.3: Create QualityTrendChartComponent [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-trend-chart.component.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:991-994 (Section 6.6 - QualityTrendChartComponent)
**Pattern to Follow**: Dashboard CLAUDE.md CostChartComponent pattern
**Dependencies**: Task 3b.1

**Description**: Display quality score history as inline SVG line chart. Uses simple SVG path rendering to avoid Chart.js dependency for this simple use case.

**Quality Requirements**:

- Standalone component with ChangeDetectionStrategy.OnPush
- Use `input.required<QualityHistoryEntry[]>()` for history
- SVG-based line chart (no external library needed)
- Responsive container
- Show "No history data" when empty

**Implementation Details**:

- Computed signals for: SVG path data, min/max score range, axis labels
- SVG viewBox with responsive container
- Line path from QualityHistoryEntry[] (timestamp on x-axis, score on y-axis)
- Color coding: line color based on latest score threshold
- Tooltip showing score/date on hover (optional - basic version acceptable)

**Verification**: Component compiles, SVG renders with test data
**Lines**: ~80

---

### Task 3b.4: Create AntiPatternDistributionComponent [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\anti-pattern-distribution.component.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:996-1000 (Section 6.6 - AntiPatternDistributionComponent)
**Pattern to Follow**: Dashboard CLAUDE.md patterns
**Dependencies**: Task 3b.1

**Description**: Display anti-pattern counts grouped by category as horizontal DaisyUI progress bars. Color coded by severity.

**Quality Requirements**:

- Standalone component with ChangeDetectionStrategy.OnPush
- Use `input.required<AntiPattern[]>()` for antiPatterns
- DaisyUI progress bars
- Group by category, show count per category
- Color: error = red, warning = yellow, info = blue

**Implementation Details**:

- Computed signal to group anti-patterns by category (extract from type prefix)
- Each category shows: category name, count, DaisyUI progress bar with percentage
- Max width = highest category count
- DaisyUI classes: `progress progress-error`, `progress-warning`, `progress-info`

**Verification**: Component compiles, progress bars render with test data
**Lines**: ~80

---

### Task 3b.5: Create QualityGapsTableComponent and QualityRecommendationsComponent [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-gaps-table.component.ts` (CREATE) + `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-recommendations.component.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1002-1010 (Sections 6.6)
**Pattern to Follow**: Dashboard CLAUDE.md AgentPerformanceTableComponent pattern
**Dependencies**: Task 3b.1

**Description**: Create quality gaps table (sortable by priority) and recommendations list (numbered with priority badges).

**Quality Requirements**:

- Both standalone components with ChangeDetectionStrategy.OnPush
- Gaps table: DaisyUI table with priority badges, sortable by priority
- Recommendations: numbered list with DaisyUI card and badge components
- Use input.required for data inputs

**Implementation Details**:

- QualityGapsTableComponent:
  - Input: `QualityGap[]`
  - DaisyUI `table table-zebra` classes
  - Columns: Area, Priority (badge), Description, Recommendation
  - Priority badges: high = `badge-error`, medium = `badge-warning`, low = `badge-info`
  - Sortable by clicking priority column header
- QualityRecommendationsComponent:
  - Input: `Recommendation[]`
  - Numbered list with priority indicators
  - DaisyUI `card` for each recommendation
  - Show category, issue, solution, example files (if any)

**Verification**: Both components compile, render with test data
**Lines**: ~70 + ~60

---

### Task 3b.6: Create QualityExportButtonComponent [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-export-button.component.ts` (CREATE)
**Action**: CREATE
**Spec Reference**: implementation-plan.md:1014-1018 (Section 6.6 - QualityExportButtonComponent)
**Pattern to Follow**: Dashboard CLAUDE.md patterns
**Dependencies**: Task 3b.1

**Description**: Dropdown button with format options (Markdown, JSON, CSV) that triggers download via blob URL.

**Quality Requirements**:

- Standalone component with ChangeDetectionStrategy.OnPush
- DaisyUI dropdown button
- Input: `ProjectIntelligence | null`
- Calls QualityDashboardStateService.exportReport on click
- Creates blob URL and triggers download

**Implementation Details**:

- DaisyUI `dropdown` with `btn btn-sm btn-outline` trigger
- Menu items: "Export Markdown", "Export JSON", "Export CSV"
- On format selection:
  - Call stateService.exportReport(format)
  - Create Blob from content
  - Create download link and trigger click
  - Revoke blob URL after download
- Disabled when no intelligence data

**Verification**: Component compiles, dropdown renders
**Lines**: ~60

---

### Task 3b.7: Create QualityDashboardViewComponent and Update Dashboard Index [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-dashboard-view.component.ts` (CREATE) + `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts` (MODIFY)
**Action**: CREATE + MODIFY
**Spec Reference**: implementation-plan.md:856-917 (Section 6.6 - QualityDashboardViewComponent)
**Pattern to Follow**: Dashboard CLAUDE.md DashboardViewComponent pattern
**Dependencies**: Tasks 3b.2 through 3b.6

**Description**: Create main quality dashboard layout component that composes all child components. Update dashboard library index.ts to export all quality components and services.

**Quality Requirements**:

- Standalone component with ChangeDetectionStrategy.OnPush
- Imports all 6 child components
- Inject QualityDashboardStateService
- Loading/error/data states with @if control flow
- Responsive grid layout with DaisyUI classes
- Dashboard index.ts exports all components and service

**Implementation Details**:

- Template from implementation-plan.md:862-917
- Computed signals: score, antiPatterns, gaps, recommendations, history
- `refreshAssessment()` method calling stateService.loadAssessment(true)
- OnInit: call loadAssessment() and loadHistory()
- In `libs/frontend/dashboard/src/index.ts`: Export all 7 components + QualityDashboardStateService:
  ```typescript
  export { QualityDashboardViewComponent } from './lib/components/quality/quality-dashboard-view.component';
  export { QualityScoreCardComponent } from './lib/components/quality/quality-score-card.component';
  export { QualityTrendChartComponent } from './lib/components/quality/quality-trend-chart.component';
  export { AntiPatternDistributionComponent } from './lib/components/quality/anti-pattern-distribution.component';
  export { QualityGapsTableComponent } from './lib/components/quality/quality-gaps-table.component';
  export { QualityRecommendationsComponent } from './lib/components/quality/quality-recommendations.component';
  export { QualityExportButtonComponent } from './lib/components/quality/quality-export-button.component';
  export { QualityDashboardStateService } from './lib/services/quality-dashboard-state.service';
  ```

**Verification**: All components compile; dashboard library exports resolve; `npx nx run dashboard:typecheck` passes
**Lines**: ~100 + ~10

---

**Batch 3b Verification**:

- [x] All component files exist at paths (7 components + 1 service)
- [x] All components are standalone with OnPush change detection
- [x] Dashboard index.ts exports all components and service
- [x] Lint passes (fixed ARIA roles, removed unused imports)
- [x] No external Chart.js dependency (SVG-based charts)
- [x] DaisyUI classes used throughout

---

## Summary

| Batch | Phase | Focus                         | Tasks | Status   | Developer          |
| ----- | ----- | ----------------------------- | ----- | -------- | ------------------ |
| 1     | E2    | Framework Anti-Pattern Rules  | 7     | COMPLETE | backend-developer  |
| 2     | F     | Performance Optimizations     | 7     | COMPLETE | backend-developer  |
| 3a    | G     | Backend: History, Export, RPC | 7     | COMPLETE | backend-developer  |
| 3b    | G     | Frontend: Quality Dashboard   | 7     | COMPLETE | frontend-developer |

**Total**: 28 tasks in 4 batches (5 developer invocations including 3a/3b split)

---

## File Manifest

### Phase E2: Files Created/Modified

| File                                                                                          | Action | Lines Est. |
| --------------------------------------------------------------------------------------------- | ------ | ---------- |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +15        |
| `libs/shared/src/lib/types/anti-pattern-rules.types.ts`                                       | MODIFY | +3         |
| `libs/backend/workspace-intelligence/src/quality/rules/angular-rules.ts`                      | CREATE | ~180       |
| `libs/backend/workspace-intelligence/src/quality/rules/nestjs-rules.ts`                       | CREATE | ~180       |
| `libs/backend/workspace-intelligence/src/quality/rules/react-rules.ts`                        | CREATE | ~160       |
| `libs/backend/workspace-intelligence/src/quality/rules/index.ts`                              | MODIFY | +30        |
| `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts` | MODIFY | +6         |
| `libs/backend/workspace-intelligence/src/quality/rules/framework-rules.spec.ts`               | CREATE | ~400       |

### Phase F: Files Created/Modified

| File                                                                                          | Action | Lines Est. |
| --------------------------------------------------------------------------------------------- | ------ | ---------- |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +8         |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                   | MODIFY | +8         |
| `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` | MODIFY | +25        |
| `libs/backend/workspace-intelligence/src/quality/services/file-hash-cache.service.ts`         | CREATE | ~150       |
| `libs/backend/workspace-intelligence/src/quality/services/anti-pattern-detection.service.ts`  | MODIFY | +60        |
| `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts` | MODIFY | +80        |
| `libs/backend/workspace-intelligence/src/quality/di.ts`                                       | MODIFY | +5         |
| `libs/backend/workspace-intelligence/src/quality/services/index.ts`                           | MODIFY | +2         |
| `libs/backend/workspace-intelligence/src/quality/services/performance.spec.ts`                | CREATE | ~300       |

### Phase G Backend: Files Created/Modified

| File                                                                                          | Action | Lines Est. |
| --------------------------------------------------------------------------------------------- | ------ | ---------- |
| `libs/shared/src/lib/types/quality-assessment.types.ts`                                       | MODIFY | +10        |
| `libs/shared/src/lib/types/rpc.types.ts`                                                      | MODIFY | +60        |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                   | MODIFY | +12        |
| `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` | MODIFY | +40        |
| `libs/backend/workspace-intelligence/src/quality/services/quality-history.service.ts`         | CREATE | ~100       |
| `libs/backend/workspace-intelligence/src/quality/services/quality-export.service.ts`          | CREATE | ~200       |
| `libs/backend/workspace-intelligence/src/quality/di.ts`                                       | MODIFY | +10        |
| `libs/backend/workspace-intelligence/src/quality/services/index.ts`                           | MODIFY | +2         |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`                | CREATE | ~120       |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts`                               | MODIFY | +2         |
| `libs/backend/workspace-intelligence/src/quality/services/reporting.spec.ts`                  | CREATE | ~250       |

### Phase G Frontend: Files Created/Modified

| File                                                                                        | Action | Lines Est. |
| ------------------------------------------------------------------------------------------- | ------ | ---------- |
| `libs/frontend/dashboard/src/lib/services/quality-dashboard-state.service.ts`               | CREATE | ~80        |
| `libs/frontend/dashboard/src/lib/components/quality/quality-dashboard-view.component.ts`    | CREATE | ~100       |
| `libs/frontend/dashboard/src/lib/components/quality/quality-score-card.component.ts`        | CREATE | ~60        |
| `libs/frontend/dashboard/src/lib/components/quality/quality-trend-chart.component.ts`       | CREATE | ~80        |
| `libs/frontend/dashboard/src/lib/components/quality/anti-pattern-distribution.component.ts` | CREATE | ~80        |
| `libs/frontend/dashboard/src/lib/components/quality/quality-gaps-table.component.ts`        | CREATE | ~70        |
| `libs/frontend/dashboard/src/lib/components/quality/quality-recommendations.component.ts`   | CREATE | ~60        |
| `libs/frontend/dashboard/src/lib/components/quality/quality-export-button.component.ts`     | CREATE | ~60        |
| `libs/frontend/dashboard/src/index.ts`                                                      | MODIFY | +10        |

**Total**: ~2,700 lines new code, ~380 lines modified across 30+ files
