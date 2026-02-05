# TASK_2025_141 - Implementation Tasks

## Overview

- **Total Tasks**: 32
- **Total Batches**: 8
- **Estimated Duration**: 12-16 days
- **Developer Type**: backend-developer
- **Status**: 7/8 batches complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Symbol.for() DI convention: Verified in `libs/backend/vscode-core/src/di/tokens.ts`
- Service patterns (@injectable, constructor injection): Verified in WorkspaceAnalyzerService
- Type export pattern (export \* from): Verified in `libs/shared/src/index.ts`
- workspace-intelligence structure: Verified - composite folder exists for facades

### Risks Identified

| Risk                                       | Severity | Mitigation                                                                          |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| Result type location unclear               | MEDIUM   | Use standard try/catch patterns with explicit error returns if Result not available |
| quality/ directory doesn't exist           | LOW      | Created in Batch 1                                                                  |
| PromptDesignerAgent integration complexity | MEDIUM   | Phase C verifies existing interface before modifying                                |

### Edge Cases to Handle

- [ ] Empty workspace (no source files) -> Return neutral assessment in Task 2.1
- [ ] Files that fail to parse -> Continue with available files in Task 2.2
- [ ] Large files (>10k lines) -> Skip or sample portions in Task 2.1
- [ ] Binary files mixed with source -> Filter by extension in Task 2.1

---

## Batch 1: Phase A - Foundation Types

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit Message**: "feat(shared): add quality assessment and reliable workflow types (TASK_2025_141)"

### Task 1.1: Create Quality Assessment Types - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\quality-assessment.types.ts` (CREATE)
**Spec Reference**: implementation-plan.md:106-339
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts`

**Description**: Define QualityAssessment, AntiPattern, QualityGap, PrescriptiveGuidance, and related types as specified in implementation plan section 2.1.

**Quality Requirements**:

- All types have JSDoc documentation
- Use proper TypeScript enums/type unions
- Include DEFAULT_SAMPLING_CONFIG constant
- Export all types

**Implementation Details**:

- AntiPatternType union type with 15 pattern types
- AntiPatternSeverity: 'error' | 'warning' | 'info'
- CodeLocation interface with file, line?, column?
- AntiPattern interface with type, severity, location, message, suggestion, frequency
- QualityGap interface with area, priority, description, recommendation
- QualityAssessment interface with score, antiPatterns, gaps, strengths, sampledFiles, analysisTimestamp, analysisDurationMs
- PrescriptiveGuidance interface with summary, recommendations, totalTokens, wasTruncated
- Recommendation interface with priority, category, issue, solution, exampleFiles?
- ProjectIntelligence interface combining workspaceContext, qualityAssessment, prescriptiveGuidance
- WorkspaceContext interface (mirrors existing detection results)
- SamplingConfig interface with maxFiles, entryPointCount, highRelevanceCount, randomCount, priorityPatterns, excludePatterns
- DEFAULT_SAMPLING_CONFIG constant

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~140

---

### Task 1.2: Create Reliable Workflow Types - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\reliable-workflow.types.ts` (CREATE)
**Spec Reference**: implementation-plan.md:341-535
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts`

**Description**: Define ReliableGenerationConfig, ValidationConfig, RetryConfig, and related types for the generalized reliable workflow pattern.

**Quality Requirements**:

- All types have JSDoc documentation
- Include DEFAULT\_ constants for validation weights, config, retry config
- Use proper TypeScript enums for FallbackLevel

**Implementation Details**:

- ValidationWeights interface (schema, safety, factual numbers)
- DEFAULT_VALIDATION_WEIGHTS constant (40, 30, 30)
- ValidationIssue interface with severity, message, suggestion?, tier?
- ValidationResult interface with isValid, issues, score, tierScores?
- ValidationConfig interface with weights, threshold, maxContentLength?, minContentLength?
- DEFAULT_VALIDATION_CONFIG constant (threshold: 70)
- RetryConfig interface with maxRetries, backoffBaseMs, backoffFactor
- DEFAULT_RETRY_CONFIG constant (2 retries, 3000ms base, factor 2)
- FallbackLevel enum (SimplifiedPrompt=1, PartialTemplate=2, TemplateOnly=3, Minimal=4)
- FallbackResult<T> interface with output, level, reason
- ReliableGenerationConfig<TContext> interface
- ReliableGenerationResult<TOutput> interface

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~120

---

### Task 1.3: Create Anti-Pattern Rule Types - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\anti-pattern-rules.types.ts` (CREATE)
**Spec Reference**: implementation-plan.md:537-627
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\ai-provider.types.ts`
**Dependencies**: Task 1.1

**Description**: Define AntiPatternRule, AntiPatternMatch, RuleConfiguration, and AntiPatternRuleRegistry types for the extensible rule engine.

**Quality Requirements**:

- All types have JSDoc documentation
- Import types from quality-assessment.types.ts
- DetectionMethod type for rule categorization

**Implementation Details**:

- Import AntiPatternType, AntiPatternSeverity, CodeLocation from quality-assessment.types
- AntiPatternMatch interface with type, location, matchedText?, metadata?
- DetectionMethod type: 'regex' | 'ast' | 'heuristic'
- AntiPatternRule interface with id, name, description, severity, method, category, fileExtensions, detect function, getSuggestion function, enabledByDefault
- RuleConfiguration interface with ruleId, enabled, severity?, threshold?
- AntiPatternRuleRegistry interface with getRules(), getRulesByCategory(), getRulesForExtension(), registerRule(), configureRule()

**Verification**: `npx nx run shared:typecheck` passes
**Lines**: ~80

---

### Task 1.4: Export Types from Shared Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:1841
**Pattern to Follow**: Existing export pattern in file
**Dependencies**: Tasks 1.1, 1.2, 1.3

**Description**: Add exports for the three new type files to the shared library index.

**Quality Requirements**:

- Maintain alphabetical ordering of exports
- Use export \* from pattern

**Implementation Details**:

- Add: `export * from './lib/types/quality-assessment.types';`
- Add: `export * from './lib/types/reliable-workflow.types';`
- Add: `export * from './lib/types/anti-pattern-rules.types';`

**Verification**: `npx nx run shared:typecheck` passes, `npx nx run shared:build` succeeds
**Lines**: ~3

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] `npx nx run shared:typecheck` passes
- [x] `npx nx run shared:build` succeeds
- [x] code-logic-reviewer approved (team-leader verified: no stubs, placeholders, or TODOs)
- [x] All types properly exported from index

**Commit**: da4e6d8

---

## Batch 2: Phase A - DI Tokens and Service Interfaces

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Commit Message**: "feat(workspace-intelligence): add DI tokens and service interfaces for project intelligence (TASK_2025_141)"

### Task 2.1: Add DI Tokens for Project Intelligence Services - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:631-679
**Pattern to Follow**: Existing tokens in file (lines 74-111 for workspace intelligence tokens)

**Description**: Add four new DI tokens for the project intelligence services following the Symbol.for() convention.

**Quality Requirements**:

- Use Symbol.for() pattern (CRITICAL)
- Add descriptive JSDoc comments
- Add to both individual exports AND TOKENS object
- Place in new section "Project Intelligence Service Tokens"

**Implementation Details**:

- Add section comment: `// ========================================`
- Add section header: `// Project Intelligence Service Tokens (TASK_2025_141)`
- Add: `export const CODE_QUALITY_ASSESSMENT_SERVICE = Symbol.for('CodeQualityAssessmentService');`
- Add: `export const ANTI_PATTERN_DETECTION_SERVICE = Symbol.for('AntiPatternDetectionService');`
- Add: `export const PROJECT_INTELLIGENCE_SERVICE = Symbol.for('ProjectIntelligenceService');`
- Add: `export const PRESCRIPTIVE_GUIDANCE_SERVICE = Symbol.for('PrescriptiveGuidanceService');`
- Add all four to TOKENS object in appropriate section

**Verification**: `npx nx run vscode-core:typecheck` passes
**Lines**: ~20

---

### Task 2.2: Create Quality Assessment Service Interfaces - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\interfaces\quality-assessment.interfaces.ts` (CREATE)
**Spec Reference**: implementation-plan.md:681-825
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.interfaces.ts`
**Dependencies**: Batch 1

**Description**: Create interface definitions for ICodeQualityAssessmentService, IAntiPatternDetectionService, IProjectIntelligenceService, and IPrescriptiveGuidanceService.

**Quality Requirements**:

- All interfaces have JSDoc documentation
- Use Result<T, Error> pattern if available, otherwise Promise<T> with explicit error handling
- Import types from @ptah-extension/shared

**Implementation Details**:

- SampledFile interface (path, content, language, estimatedTokens)
- ICodeQualityAssessmentService interface:
  - assessQuality(workspaceUri, config?): Promise<QualityAssessment>
  - sampleFiles(workspaceUri, config): Promise<SampledFile[]>
- IAntiPatternDetectionService interface:
  - detectPatterns(content, filePath): AntiPattern[]
  - detectPatternsInFiles(files): AntiPattern[]
  - calculateScore(antiPatterns, fileCount): number
- IProjectIntelligenceService interface:
  - getIntelligence(workspaceUri): Promise<ProjectIntelligence>
  - getWorkspaceContext(workspaceUri): Promise<WorkspaceContext>
  - invalidateCache(workspaceUri): void
- IPrescriptiveGuidanceService interface:
  - generateGuidance(assessment, context, tokenBudget?): PrescriptiveGuidance

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~120

---

### Task 2.3: Create Quality Module Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\interfaces\index.ts` (CREATE)
**Spec Reference**: implementation-plan.md:1813
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\index.ts` (if exists)
**Dependencies**: Task 2.2

**Description**: Create index file to export all quality-related interfaces.

**Quality Requirements**:

- Export all interfaces from quality-assessment.interfaces.ts

**Implementation Details**:

- Export \* from './quality-assessment.interfaces'

**Verification**: Import works from parent directory
**Lines**: ~3

---

### Task 2.4: Create Quality Module Main Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\index.ts` (CREATE)
**Spec Reference**: implementation-plan.md:1838
**Pattern to Follow**: Module organization in workspace-intelligence
**Dependencies**: Task 2.3

**Description**: Create main index file for quality module that will export interfaces and (later) services.

**Quality Requirements**:

- Export interfaces from interfaces folder
- Leave placeholder comments for future service exports

**Implementation Details**:

- Export \* from './interfaces'
- Add comment: `// Services will be exported here after implementation`

**Verification**: Import works from workspace-intelligence index
**Lines**: ~5

---

**Batch 2 Verification**:

- [x] All files exist at paths
- [x] `npx nx run vscode-core:typecheck` passes
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] code-logic-reviewer approved (team-leader verified: no stubs, placeholders, or TODOs)
- [x] Interfaces properly documented

**Commit**: a1b963e (combined with wizard fix)

---

## Batch 3: Phase A - Anti-Pattern Rules Engine

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2
**Commit Message**: "feat(workspace-intelligence): add anti-pattern rule engine with TypeScript and error handling rules (TASK_2025_141)"

### Task 3.1: Create Rule Base Utilities - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\rule-base.ts` (CREATE)
**Spec Reference**: implementation-plan.md:830-921
**Pattern to Follow**: Factory pattern in implementation plan

**Description**: Create base utilities and factory functions for creating anti-pattern rules (createRegexRule, createHeuristicRule).

**Quality Requirements**:

- Factory functions for regex-based and heuristic-based rules
- Type-safe with proper generics
- Line-by-line detection for regex rules

**Implementation Details**:

- Import AntiPatternRule, AntiPatternMatch, AntiPatternType, AntiPatternSeverity from @ptah-extension/shared
- createRegexRule function that:
  - Takes config object with id, name, description, severity, category, fileExtensions, pattern (RegExp), suggestionTemplate
  - Returns AntiPatternRule
  - detect() splits content into lines, matches each line with pattern, returns AntiPatternMatch[]
  - getSuggestion() returns suggestionTemplate
- createHeuristicRule function that:
  - Takes config object with id, name, description, severity, category, fileExtensions, check function, suggestionTemplate
  - Returns AntiPatternRule
  - detect() calls check function
  - getSuggestion() returns suggestionTemplate

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~160 (includes utility functions)

---

### Task 3.2: Create TypeScript Anti-Pattern Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\typescript-rules.ts` (CREATE)
**Spec Reference**: implementation-plan.md:927-987
**Pattern to Follow**: Task 3.1 rule-base.ts
**Dependencies**: Task 3.1

**Description**: Implement TypeScript-specific anti-pattern detection rules (explicit any, ts-ignore, non-null assertion).

**Quality Requirements**:

- Each rule properly documented
- Regex patterns tested for accuracy
- Appropriate severity levels

**Implementation Details**:

- Import createRegexRule from './rule-base'
- explicitAnyRule: severity warning, pattern `/:\s*any\b(?!\s*\|\s*\w)/g`, detects `: any` usage
- tsIgnoreRule: severity warning, pattern `/@ts-ignore|@ts-nocheck/g`
- nonNullAssertionRule: severity info, pattern `/\b!\./g` (matches !. but not !=)
- Export typescriptRules array containing all three rules

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~100

---

### Task 3.3: Create Error Handling Anti-Pattern Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\error-handling-rules.ts` (CREATE)
**Spec Reference**: implementation-plan.md:989-1056
**Pattern to Follow**: Task 3.2 typescript-rules.ts
**Dependencies**: Task 3.1

**Description**: Implement error handling anti-pattern detection rules (empty catch, console-only catch).

**Quality Requirements**:

- Regex patterns for catch block detection
- Heuristic for console-only detection
- Appropriate severity levels (error for empty catch, warning for console-only)

**Implementation Details**:

- Import createRegexRule, createHeuristicRule from './rule-base'
- emptyCatchRule: severity error, regex pattern `/catch\s*\([^)]*\)\s*{\s*}/g`
- consoleOnlyCatchRule: severity warning, heuristic that:
  - Uses pattern to match catch blocks containing only console.log/warn/error
  - Calculates line number from match position
- Export errorHandlingRules array

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~120

---

### Task 3.4: Create Rule Registry - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\index.ts` (CREATE)
**Spec Reference**: implementation-plan.md:1272-1344
**Pattern to Follow**: implementation-plan.md RuleRegistry class
**Dependencies**: Tasks 3.2, 3.3

**Description**: Create RuleRegistry class and export all built-in rules.

**Quality Requirements**:

- Map-based rule storage for O(1) lookup
- Configuration support for enabling/disabling rules
- Category and extension filtering

**Implementation Details**:

- Import typescriptRules from './typescript-rules'
- Import errorHandlingRules from './error-handling-rules'
- ALL_RULES constant combining all rule arrays
- RuleRegistry class with:
  - private rules: Map<AntiPatternType, AntiPatternRule>
  - private configurations: Map<AntiPatternType, Partial<RuleConfiguration>>
  - constructor() registers all built-in rules
  - registerRule(rule): void
  - configureRule(ruleId, config): void
  - getRules(): AntiPatternRule[] (filters by enabled and enabledByDefault)
  - getRulesByCategory(category): AntiPatternRule[]
  - getRulesForExtension(extension): AntiPatternRule[]
  - getRule(ruleId): AntiPatternRule | undefined
  - getEffectiveSeverity(ruleId): string | undefined
  - isRuleEnabled(ruleId): boolean
  - resetConfigurations(): void
- Re-export rule modules

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~230

---

### Task 3.5: Update Quality Module Index for Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\index.ts` (MODIFY)
**Spec Reference**: N/A
**Pattern to Follow**: Module organization
**Dependencies**: Task 3.4

**Description**: Update quality module index to export rules.

**Quality Requirements**:

- Export rules from rules folder

**Implementation Details**:

- Add: `export * from './rules';`

**Verification**: Rules can be imported from quality module
**Lines**: ~2

---

**Batch 3 Verification**:

- [x] All files exist at paths
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Rules can be instantiated and detect patterns
- [x] code-logic-reviewer approved (team-leader verified: no stubs, placeholders, or TODOs)
- [x] RuleRegistry properly manages rules

**Commit**: 0240a8e

---

## Batch 4: Phase A - Core Assessment Services

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3
**Commit Message**: "feat(workspace-intelligence): add AntiPatternDetection and CodeQualityAssessment services (TASK_2025_141)"

### Task 4.1: Create AntiPatternDetectionService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\anti-pattern-detection.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (IAntiPatternDetectionService)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts`
**Dependencies**: Batch 3

**Description**: Implement the anti-pattern detection service that uses the rule engine to detect patterns in source files.

**Quality Requirements**:

- Use @injectable() decorator
- Inject TOKENS.LOGGER
- Aggregate patterns with frequency counts
- Calculate quality score from patterns

**Implementation Details**:

- @injectable() class AntiPatternDetectionService implements IAntiPatternDetectionService
- Constructor injects Logger via TOKENS.LOGGER
- Private ruleRegistry: RuleRegistry instance
- detectPatterns(content, filePath):
  - Get file extension
  - Get rules for extension
  - Run each rule's detect() on content
  - Map matches to AntiPattern with suggestion from rule
  - Return AntiPattern[]
- detectPatternsInFiles(files: SampledFile[]):
  - Call detectPatterns for each file
  - Aggregate by type, increment frequency
  - Return deduplicated AntiPattern[] with frequencies
- calculateScore(antiPatterns, fileCount):
  - Start at 100
  - Deduct based on severity: error=-10, warning=-5, info=-2
  - Cap frequency impact (max 3x deduction per type)
  - Minimum score 0
  - Return score 0-100

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~120

---

### Task 4.2: Create CodeQualityAssessmentService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\code-quality-assessment.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:4.3-4.4, ICodeQualityAssessmentService
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.ts`
**Dependencies**: Task 4.1

**Description**: Implement the code quality assessment service that samples files and orchestrates anti-pattern detection.

**Quality Requirements**:

- Use @injectable() decorator
- Inject required services via constructor
- Implement intelligent file sampling
- Handle edge cases (empty workspace, parse failures)

**Implementation Details**:

- @injectable() class CodeQualityAssessmentService implements ICodeQualityAssessmentService
- Constructor injects:
  - @inject(TOKENS.LOGGER) logger: Logger
  - @inject(TOKENS.WORKSPACE_INDEXER_SERVICE) indexer: WorkspaceIndexerService
  - @inject(TOKENS.FILE_SYSTEM_SERVICE) fileSystem: FileSystemService
  - @inject(TOKENS.FILE_RELEVANCE_SCORER) relevanceScorer: FileRelevanceScorerService
  - @inject(TOKENS.ANTI_PATTERN_DETECTION_SERVICE) antiPatternDetector: IAntiPatternDetectionService
- sampleFiles(workspaceUri, config):
  - Index workspace with estimateTokens: true
  - Filter to source files (.ts, .tsx, .js, .jsx)
  - Filter out test files, d.ts files
  - Select entry points (main.ts, index.ts, app.ts) up to config.entryPointCount
  - Score remaining files with relevance scorer using config.priorityPatterns
  - Select top config.highRelevanceCount
  - Random sample config.randomCount from remaining
  - Combine, dedupe, limit to config.maxFiles
  - Read file contents, skip files that fail
  - Return SampledFile[]
- assessQuality(workspaceUri, config?):
  - Merge config with DEFAULT_SAMPLING_CONFIG
  - Start timer
  - Call sampleFiles
  - If no files, return neutral assessment (score: 50, empty arrays)
  - Call antiPatternDetector.detectPatternsInFiles
  - Call antiPatternDetector.calculateScore
  - Identify gaps from anti-patterns (group by category, priority by frequency)
  - Identify strengths (categories with no/few issues)
  - Return QualityAssessment with all data

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~180

---

### Task 4.3: Create Services Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\index.ts` (CREATE)
**Spec Reference**: N/A
**Pattern to Follow**: Module organization
**Dependencies**: Tasks 4.1, 4.2

**Description**: Create index file to export quality services.

**Quality Requirements**:

- Export all services

**Implementation Details**:

- Export AntiPatternDetectionService from './anti-pattern-detection.service'
- Export CodeQualityAssessmentService from './code-quality-assessment.service'

**Verification**: Services can be imported from services folder
**Lines**: ~5

---

### Task 4.4: Update Quality Module Index for Services - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\index.ts` (MODIFY)
**Spec Reference**: N/A
**Pattern to Follow**: Module organization
**Dependencies**: Task 4.3

**Description**: Update quality module index to export services.

**Quality Requirements**:

- Export services from services folder

**Implementation Details**:

- Add: `export * from './services';`

**Verification**: Services can be imported from quality module
**Lines**: ~2

---

**Batch 4 Verification**:

- [x] All files exist at paths
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Services can be instantiated
- [x] code-logic-reviewer approved (team-leader verified: no stubs, placeholders, or TODOs)
- [x] File sampling works with intelligent selection

---

**Commit**: 34b438c

---

## Batch 5: Phase B - Unified Intelligence Service

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 4
**Commit Message**: "feat(workspace-intelligence): add ProjectIntelligenceService unified facade (TASK_2025_141)"

### Task 5.1: Create PrescriptiveGuidanceService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\prescriptive-guidance.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (IPrescriptiveGuidanceService), FR-007
**Pattern to Follow**: implementation-plan.md
**Dependencies**: Batch 4

**Description**: Implement service that generates prioritized recommendations from quality assessment.

**Quality Requirements**:

- Prioritize by frequency, severity, fix complexity
- Respect token budget (default 500)
- Include example files for each recommendation

**Implementation Details**:

- @injectable() class PrescriptiveGuidanceService implements IPrescriptiveGuidanceService
- Constructor injects @inject(TOKENS.LOGGER) logger: Logger
- generateGuidance(assessment, context, tokenBudget = 500):
  - If no antiPatterns, return positive summary with advanced recommendations
  - Group anti-patterns by type, sort by frequency \* severity weight
  - Create Recommendation for each group:
    - priority: index
    - category: from anti-pattern type (extract from type string)
    - issue: message from first occurrence
    - solution: suggestion from rule
    - exampleFiles: up to 5 file paths from occurrences
  - Estimate tokens per recommendation (~50 tokens each)
  - Truncate to fit budget
  - Generate summary from top 3 recommendations
  - Return PrescriptiveGuidance with wasTruncated flag

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~100

---

### Task 5.2: Create ProjectIntelligenceService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\project-intelligence.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md (IProjectIntelligenceService), FR-002
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.ts`
**Dependencies**: Task 5.1

**Description**: Implement the unified facade service that combines workspace context with quality assessment.

**Quality Requirements**:

- Implement caching with invalidation
- Combine existing workspace detection with new quality assessment
- Handle partial failures gracefully

**Implementation Details**:

- @injectable() class ProjectIntelligenceService implements IProjectIntelligenceService
- Constructor injects:
  - @inject(TOKENS.LOGGER) logger: Logger
  - @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE) workspaceAnalyzer: WorkspaceAnalyzerService
  - @inject(TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE) qualityAssessment: ICodeQualityAssessmentService
  - @inject(TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE) guidanceService: IPrescriptiveGuidanceService
  - @inject(TOKENS.PROJECT_DETECTOR_SERVICE) projectDetector: ProjectDetectorService
  - @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE) frameworkDetector: FrameworkDetectorService
  - @inject(TOKENS.MONOREPO_DETECTOR_SERVICE) monorepoDetector: MonorepoDetectorService
- Private cache: Map<string, { intelligence: ProjectIntelligence, timestamp: number }>
- Private CACHE*TTL = 5 * 60 \_ 1000 (5 minutes)
- getWorkspaceContext(workspaceUri):
  - Get project type from projectDetector
  - Get frameworks from frameworkDetector
  - Get monorepo info from monorepoDetector
  - Build WorkspaceContext object
- getIntelligence(workspaceUri):
  - Check cache, return if valid
  - Call getWorkspaceContext
  - Call qualityAssessment.assessQuality
  - Call guidanceService.generateGuidance
  - Build ProjectIntelligence
  - Cache result
  - Return ProjectIntelligence
- invalidateCache(workspaceUri):
  - Remove from cache map

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~150

---

### Task 5.3: Update Services Index for New Services - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\index.ts` (MODIFY)
**Spec Reference**: N/A
**Pattern to Follow**: Module organization
**Dependencies**: Tasks 5.1, 5.2

**Description**: Add exports for PrescriptiveGuidanceService and ProjectIntelligenceService.

**Quality Requirements**:

- Export new services

**Implementation Details**:

- Add: `export { PrescriptiveGuidanceService } from './prescriptive-guidance.service';`
- Add: `export { ProjectIntelligenceService } from './project-intelligence.service';`

**Verification**: Services can be imported
**Lines**: ~4

---

### Task 5.4: Update workspace-intelligence Main Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:1811
**Pattern to Follow**: Existing exports in file

**Description**: Add exports for quality module to main workspace-intelligence index.

**Quality Requirements**:

- Export quality module
- Maintain existing exports

**Implementation Details**:

- Add: `// Quality Assessment (TASK_2025_141)`
- Add: `export * from './quality';`

**Verification**: Quality services can be imported from @ptah-extension/workspace-intelligence
**Lines**: ~3

---

**Batch 5 Verification**:

- [x] All files exist at paths
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] `npx nx run workspace-intelligence:build` succeeds
- [x] code-logic-reviewer approved (team-leader verified: no stubs, placeholders, or TODOs)
- [x] Services properly cached and orchestrated

**Commit**: 5c84dc1

---

## Batch 6: Phase B - DI Registration

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 5
**Commit**: c8e39d1

### Task 6.1: Create Quality Services DI Registration - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\di.ts` (CREATE)
**Spec Reference**: implementation-plan.md:6.3
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di.ts`
**Dependencies**: Batch 5

**Description**: Create DI registration function for quality assessment services.

**Quality Requirements**:

- Use tsyringe container
- Register services with proper tokens
- Follow existing DI patterns

**Implementation Details**:

- Import container from 'tsyringe'
- Import TOKENS from '@ptah-extension/vscode-core'
- Import all services from './services'
- Export function registerQualityServices():
  - container.register(TOKENS.ANTI_PATTERN_DETECTION_SERVICE, { useClass: AntiPatternDetectionService })
  - container.register(TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE, { useClass: CodeQualityAssessmentService })
  - container.register(TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE, { useClass: PrescriptiveGuidanceService })
  - container.register(TOKENS.PROJECT_INTELLIGENCE_SERVICE, { useClass: ProjectIntelligenceService })

**Verification**: Registration function can be called without errors
**Lines**: ~25

---

### Task 6.2: Integrate Quality DI with Workspace Intelligence DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts` (MODIFY)
**Spec Reference**: N/A
**Pattern to Follow**: Existing DI registration in file
**Dependencies**: Task 6.1

**Description**: Call quality services registration from main workspace-intelligence DI registration.

**Quality Requirements**:

- Maintain existing registrations
- Call registerQualityServices

**Implementation Details**:

- Import registerQualityServices from './quality/di'
- In registerWorkspaceIntelligenceServices function, add call to registerQualityServices()

**Verification**: Services registered when workspace-intelligence DI is initialized
**Lines**: ~5

---

### Task 6.3: Export DI from Quality Module - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\index.ts` (MODIFY)
**Spec Reference**: N/A
**Pattern to Follow**: Module organization
**Dependencies**: Task 6.1

**Description**: Export DI registration from quality module.

**Quality Requirements**:

- Export registerQualityServices function

**Implementation Details**:

- Add: `export { registerQualityServices } from './di';`

**Verification**: DI function can be imported from quality module
**Lines**: ~2

---

**Batch 6 Verification**:

- [x] All files exist at paths
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Services can be resolved from container
- [x] code-logic-reviewer approved
- [x] No circular dependencies

---

## Batch 7: Phase E - Architecture and Testing Rules

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 6
**Commit**: 338a62f

### Task 7.1: Create Architecture Anti-Pattern Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\architecture-rules.ts` (CREATE)
**Spec Reference**: implementation-plan.md:1058-1196
**Pattern to Follow**: Task 3.2 typescript-rules.ts
**Dependencies**: Batch 6

**Description**: Implement architecture anti-pattern detection rules (file too large, too many imports, function too large).

**Quality Requirements**:

- Heuristic-based rules for size/count checks
- Configurable thresholds
- Dynamic severity based on threshold exceeded

**Implementation Details**:

- Import createHeuristicRule from './rule-base'
- fileTooLargeRule: severity warning, check function:
  - Count lines in content
  - > 1000 lines: return match with severity 'error' in metadata
  - > 500 lines: return match with severity 'warning' in metadata
  - else: return empty array
- tooManyImportsRule: severity info, check function:
  - Count lines starting with 'import '
  - > 15 imports: return match with importCount in metadata
  - else: return empty array
- functionTooLargeRule: severity warning, check function:
  - Match function declarations
  - Count lines until balanced braces
  - > 50 lines: add match with lineCount in metadata
- Export architectureRules array

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~120

---

### Task 7.2: Create Testing Anti-Pattern Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\testing-rules.ts` (CREATE)
**Spec Reference**: implementation-plan.md:1200-1270
**Pattern to Follow**: Task 3.2 typescript-rules.ts
**Dependencies**: Batch 6

**Description**: Implement testing anti-pattern detection rules (no assertions, all skipped).

**Quality Requirements**:

- Only apply to test files (.spec.ts, .test.ts)
- Detect test blocks and assertions

**Implementation Details**:

- Import createHeuristicRule from './rule-base'
- noAssertionsRule: severity warning, fileExtensions ['.spec.ts', '.test.ts', '.spec.js', '.test.js']:
  - Check if file has it()/test() blocks
  - Check if file has expect()/assert() calls
  - If tests but no assertions: return match
- allSkippedRule: severity info:
  - Count it.skip/test.skip occurrences
  - Count total it/test occurrences
  - If skipped == total and > 0: return match
- Export testingRules array

**Verification**: `npx nx run workspace-intelligence:typecheck` passes
**Lines**: ~70

---

### Task 7.3: Update Rule Registry with New Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:1272-1344
**Pattern to Follow**: Existing imports in file
**Dependencies**: Tasks 7.1, 7.2

**Description**: Add architecture and testing rules to the rule registry.

**Quality Requirements**:

- Import new rule modules
- Add to ALL_RULES array

**Implementation Details**:

- Import architectureRules from './architecture-rules'
- Import testingRules from './testing-rules'
- Update ALL_RULES to include ...architectureRules, ...testingRules
- Add re-exports for architectureRules and testingRules

**Verification**: ALL_RULES contains all rule categories
**Lines**: ~10

---

### Task 7.4: Add Unit Tests for Rules - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\rules\rules.spec.ts` (CREATE)
**Spec Reference**: NFR-003, NFR-004
**Pattern to Follow**: Existing test files in workspace-intelligence

**Description**: Create unit tests for anti-pattern detection rules.

**Quality Requirements**:

- Test each rule with positive and negative cases
- Test RuleRegistry filtering

**Implementation Details**:

- Import all rules and RuleRegistry
- Test typescriptRules:
  - explicitAnyRule detects `: any` but not `: any | null`
  - tsIgnoreRule detects @ts-ignore and @ts-nocheck
  - nonNullAssertionRule detects !. but not !=
- Test errorHandlingRules:
  - emptyCatchRule detects empty catch blocks
  - consoleOnlyCatchRule detects catch with only console.log
- Test architectureRules:
  - fileTooLargeRule detects files >500 lines
  - tooManyImportsRule detects >15 imports
- Test testingRules:
  - noAssertionsRule detects tests without expect
  - allSkippedRule detects all-skipped test files
- Test RuleRegistry:
  - getRules returns enabled rules
  - getRulesByCategory filters correctly
  - getRulesForExtension filters by file extension

**Verification**: `npx nx test workspace-intelligence --testPathPattern=rules.spec` passes
**Lines**: ~200

---

**Batch 7 Verification**:

- [x] All files exist at paths
- [x] `npx nx run workspace-intelligence:typecheck` passes
- [x] Unit tests pass (76 tests in rules.spec.ts)
- [x] code-logic-reviewer approved (team-leader verified)
- [x] All FR-006 rules implemented

---

## Batch 8: Phase E - Integration Tests and Documentation

**Status**: COMPLETE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 7
**Commit**: 4e8e6c0

### Task 8.1: Add Unit Tests for Services - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\services\services.spec.ts` (CREATE)
**Spec Reference**: NFR-003
**Pattern to Follow**: Existing test files in workspace-intelligence

**Description**: Create unit tests for quality assessment services.

**Quality Requirements**:

- Mock dependencies
- Test key methods
- Test edge cases

**Implementation Details**:

- Mock Logger, WorkspaceIndexerService, FileSystemService, FileRelevanceScorerService
- Test AntiPatternDetectionService:
  - detectPatterns returns patterns for file with issues
  - detectPatterns returns empty for clean file
  - detectPatternsInFiles aggregates frequencies
  - calculateScore returns 100 for no patterns
  - calculateScore deducts for patterns
- Test CodeQualityAssessmentService:
  - sampleFiles selects diverse files
  - assessQuality returns neutral for empty workspace
  - assessQuality returns assessment with antiPatterns
- Test PrescriptiveGuidanceService:
  - generateGuidance creates recommendations from patterns
  - generateGuidance respects token budget
- Test ProjectIntelligenceService:
  - getIntelligence combines all data
  - invalidateCache clears cache
  - Uses cached data within TTL

**Verification**: `npx nx test workspace-intelligence --testPathPattern=services.spec` passes
**Lines**: ~250

---

### Task 8.2: Add Integration Test - IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\quality\quality.integration.spec.ts` (CREATE)
**Spec Reference**: NFR-001, NFR-002
**Pattern to Follow**: Integration test patterns

**Description**: Create integration test that runs the full quality assessment pipeline.

**Quality Requirements**:

- Test with sample fixtures
- Verify end-to-end flow
- Test performance requirements

**Implementation Details**:

- Create test fixtures with known anti-patterns
- Test full pipeline:
  - Create CodeQualityAssessmentService with real dependencies
  - Call assessQuality on test fixture directory
  - Verify correct anti-patterns detected
  - Verify score calculation
  - Verify prescriptive guidance generated
- Test performance:
  - Assessment completes in <5s for fixture
- Test edge cases:
  - Empty directory returns neutral assessment
  - Directory with only config files handles gracefully

**Verification**: `npx nx test workspace-intelligence --testPathPattern=quality.integration` passes
**Lines**: ~150

---

### Task 8.3: Verify Library Exports - IMPLEMENTED

**File**: N/A (verification only)
**Spec Reference**: N/A
**Pattern to Follow**: N/A
**Dependencies**: All previous batches

**Description**: Verify all exports are accessible from the library entry point.

**Quality Requirements**:

- All types importable from @ptah-extension/shared
- All services importable from @ptah-extension/workspace-intelligence
- All tokens defined in @ptah-extension/vscode-core

**Verification Steps**:

1. Run `npx nx run shared:build`
2. Run `npx nx run vscode-core:build`
3. Run `npx nx run workspace-intelligence:build`
4. Create test import file that imports:
   - QualityAssessment, AntiPattern, PrescriptiveGuidance from @ptah-extension/shared
   - ProjectIntelligenceService, CodeQualityAssessmentService from @ptah-extension/workspace-intelligence
   - TOKENS.PROJECT_INTELLIGENCE_SERVICE from @ptah-extension/vscode-core
5. Run typecheck on test file

**Verification**: All imports resolve correctly
**Lines**: N/A

---

### Task 8.4: Final Verification and Build Test - IMPLEMENTED

**File**: N/A (verification only)
**Spec Reference**: NFR-001-005
**Pattern to Follow**: N/A
**Dependencies**: All previous batches

**Description**: Run full build and test suite to verify implementation.

**Quality Requirements**:

- All libraries build successfully
- All tests pass
- No circular dependencies

**Verification Steps**:

1. Run `npx nx run-many --target=build --projects=shared,vscode-core,workspace-intelligence`
2. Run `npx nx run-many --target=test --projects=shared,workspace-intelligence`
3. Run `npx nx run-many --target=typecheck --projects=shared,vscode-core,workspace-intelligence`
4. Verify no errors in any step

**Verification**: All builds and tests pass
**Lines**: N/A

---

**Batch 8 Verification**:

- [x] All test files created
- [x] All tests pass (quality module: services.spec.ts, quality.integration.spec.ts, rules.spec.ts)
- [x] All libraries build (shared, vscode-core, workspace-intelligence)
- [x] code-logic-reviewer approved (team-leader verified)
- [x] Phase A & E complete (foundation + expanded rules)

---

## Notes for Phase C and D

Phases C (Enhanced Prompts Integration) and D (Agent Generation Integration) are planned for future batches after the foundation is complete and verified. These phases will:

**Phase C** (Batches 9-10):

- Modify `PromptDesignerAgent` to consume `ProjectIntelligenceService`
- Add `qualityGuidance` section to `PromptDesignerOutput`
- Implement reliable workflow with validation and retry
- Update `PromptCacheService` for source file invalidation

**Phase D** (Batches 11-12):

- Update `DeepProjectAnalysisService` to use `ProjectIntelligenceService`
- Update `ContentGenerationService` for quality context
- Update agent recommendation scoring

These phases will be decomposed after Batches 1-8 are verified working.

---

## Summary

| Batch | Phase | Focus                        | Tasks | Status   |
| ----- | ----- | ---------------------------- | ----- | -------- |
| 1     | A     | Foundation Types             | 4     | COMPLETE |
| 2     | A     | DI Tokens & Interfaces       | 4     | COMPLETE |
| 3     | A     | Anti-Pattern Rules Engine    | 5     | COMPLETE |
| 4     | A     | Core Assessment Services     | 4     | COMPLETE |
| 5     | B     | Unified Intelligence Service | 4     | COMPLETE |
| 6     | B     | DI Registration              | 3     | COMPLETE |
| 7     | E     | Architecture & Testing Rules | 4     | COMPLETE |
| 8     | E     | Integration Tests            | 4     | COMPLETE |

**Total**: 32 tasks in 8 batches covering Phase A, B, and E

---

## Final Implementation Summary

**Task Completed**: 2026-02-05

### Commits (8 total)

| Batch | Commit  | Description                                      |
| ----- | ------- | ------------------------------------------------ |
| 1     | da4e6d8 | Quality assessment and reliable workflow types   |
| 2     | a1b963e | DI tokens and service interfaces                 |
| 3     | 0240a8e | Anti-pattern rule engine with TS and error rules |
| 4     | 34b438c | Quality assessment services                      |
| 5     | 5c84dc1 | ProjectIntelligenceService unified facade        |
| 6     | c8e39d1 | DI registration for quality services             |
| 7     | 338a62f | Architecture and testing anti-pattern rules      |
| 8     | 4e8e6c0 | Integration tests for quality assessment         |

### Files Created/Modified

**New Files (21)**:

- `libs/shared/src/lib/types/quality-assessment.types.ts` (237 lines)
- `libs/shared/src/lib/types/reliable-workflow.types.ts` (198 lines)
- `libs/shared/src/lib/types/anti-pattern-rules.types.ts` (134 lines)
- `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts` (290 lines)
- `libs/backend/workspace-intelligence/src/quality/interfaces/index.ts` (9 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/rule-base.ts` (274 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/typescript-rules.ts` (148 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/error-handling-rules.ts` (190 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/architecture-rules.ts` (282 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/testing-rules.ts` (229 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/index.ts` (372 lines)
- `libs/backend/workspace-intelligence/src/quality/rules/rules.spec.ts` (917 lines)
- `libs/backend/workspace-intelligence/src/quality/services/anti-pattern-detection.service.ts` (415 lines)
- `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts` (610 lines)
- `libs/backend/workspace-intelligence/src/quality/services/prescriptive-guidance.service.ts` (518 lines)
- `libs/backend/workspace-intelligence/src/quality/services/project-intelligence.service.ts` (535 lines)
- `libs/backend/workspace-intelligence/src/quality/services/index.ts` (23 lines)
- `libs/backend/workspace-intelligence/src/quality/services/services.spec.ts` (1191 lines)
- `libs/backend/workspace-intelligence/src/quality/quality.integration.spec.ts` (700 lines)
- `libs/backend/workspace-intelligence/src/quality/di.ts` (new)
- `libs/backend/workspace-intelligence/src/quality/index.ts` (new)

**Modified Files (4)**:

- `libs/shared/src/index.ts` - Added type exports
- `libs/backend/vscode-core/src/di/tokens.ts` - Added 4 new DI tokens
- `libs/backend/workspace-intelligence/src/index.ts` - Added quality module export
- `libs/backend/workspace-intelligence/src/di/register.ts` - Added quality DI registration

### Code Statistics

- **Total New Lines**: ~6,572 lines (quality module: 6,003 + shared types: 569)
- **Test Coverage**: 136 tests (76 rule + 43 service + 17 integration)
- **Anti-Pattern Rules**: 12 built-in rules across 4 categories
- **Services**: 4 new injectable services
- **DI Tokens**: 4 new Symbol.for() tokens

### Delivered Components

1. **Quality Assessment Types** (Batch 1) - Foundation type definitions
2. **DI Tokens and Interfaces** (Batch 2) - Service contracts and DI infrastructure
3. **Anti-Pattern Rule Engine** (Batch 3) - Extensible rule system with factories
4. **Core Assessment Services** (Batch 4) - Detection and scoring services
5. **Unified ProjectIntelligenceService** (Batch 5) - Facade combining all services
6. **DI Registration** (Batch 6) - tsyringe container integration
7. **Architecture & Testing Rules** (Batch 7) - Additional rule categories
8. **Integration Tests** (Batch 8) - Full pipeline testing

### Test Results

All 136 tests passing:

- rules.spec.ts: 76 tests
- services.spec.ts: 43 tests
- quality.integration.spec.ts: 17 tests
