# Requirements Document - TASK_2025_141

## Unified Project Intelligence with Code Quality Assessment

---

## 1. Executive Summary

This task delivers a unified project intelligence system that provides **prescriptive (corrective) guidance** to users based on actual code quality assessment, not just descriptive (framework-based) guidance. The system generalizes Agent Generation's reliable workflow (template + LLM + 3-tier validation) for reuse by Enhanced Prompts, and introduces a new Code Quality Assessment phase that samples actual source code to detect anti-patterns and best practice adherence.

**Business Value:**

- Novice users with anti-patterns receive corrective guidance instead of having bad habits reinforced
- Expert users with clean code receive validation that they're following best practices
- Both Agent Generation and Enhanced Prompts benefit from shared, battle-tested intelligence infrastructure
- Reduced code duplication and maintenance burden across two parallel systems

---

## 2. Problem Statement

### 2.1 Current State

The Ptah extension has two parallel intelligence systems that generate project-specific guidance:

| System               | Architecture                                      | Source of Truth                               | Code Access                          |
| -------------------- | ------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| **Agent Generation** | ~60% hardcoded templates + ~40% LLM customization | Deep workspace analysis, samples actual files | Yes - reads source files for context |
| **Enhanced Prompts** | ~30% hardcoded templates + ~70% LLM               | Package.json metadata, project type detection | No - never sees actual source code   |

### 2.2 Critical Gaps

1. **No Code Quality Assessment**: Neither system detects whether the user follows best practices. Both generate "descriptive" guidance (what frameworks you use) rather than "prescriptive" guidance (what you should improve).

2. **Reinforcement of Bad Habits**: For novice users with anti-patterns (e.g., any-typed code, missing error handling, poor separation of concerns), the systems reinforce bad habits by generating framework-based guidance that ignores actual code quality.

3. **Divergent Architectures**: Agent Generation has a reliable workflow with 3-tier validation (score >= 70 threshold), while Enhanced Prompts has weaker fallbacks and no structured validation.

4. **Code Duplication**: Both systems implement their own workspace analysis, caching, and LLM integration rather than sharing infrastructure.

### 2.3 Impact Analysis

| User Type                     | Current Behavior                 | Desired Behavior                             |
| ----------------------------- | -------------------------------- | -------------------------------------------- |
| **Expert with clean code**    | Good guidance based on framework | Same + validation of best practice adherence |
| **Novice with anti-patterns** | Bad - reinforces mistakes        | Detects gaps, generates corrective guidance  |
| **Mixed codebase**            | Generic framework guidance       | Targeted guidance for specific weak areas    |

---

## 3. Detailed Requirements

### FR-001: Code Quality Assessment Service

**User Story:** As a developer using Ptah, I want the system to analyze my actual source code quality, so that I receive guidance tailored to my specific gaps rather than generic framework advice.

#### Acceptance Criteria

1. WHEN the Code Quality Assessment Service is invoked with a workspace URI THEN it SHALL sample a representative set of source files (configurable, default 10-20 files)
2. WHEN analyzing source files THEN it SHALL detect common anti-patterns including:
   - TypeScript: `any` type usage, missing return types, implicit any parameters
   - Error Handling: unhandled promises, empty catch blocks, swallowed errors
   - Architecture: circular dependencies, god objects, missing abstraction layers
   - Testing: missing test files for services, low assertion density
3. WHEN analyzing source files THEN it SHALL score adherence to framework-specific best practices (0-100 scale)
4. WHEN analysis completes THEN it SHALL output a `QualityAssessment` object containing:
   - `score: number` (0-100 overall quality score)
   - `antiPatterns: AntiPattern[]` (detected issues with severity, location, suggestion)
   - `gaps: QualityGap[]` (missing best practices with priority)
   - `strengths: string[]` (areas where code follows best practices)
5. WHEN file sampling encounters errors THEN it SHALL continue with available files and report partial results
6. WHEN no TypeScript/JavaScript files are found THEN it SHALL return a neutral assessment with appropriate flags

---

### FR-002: Unified ProjectIntelligenceService

**User Story:** As a system consuming project analysis data, I want a single source of truth for project context and quality assessment, so that both Agent Generation and Enhanced Prompts use consistent, comprehensive data.

#### Acceptance Criteria

1. WHEN ProjectIntelligenceService is initialized THEN it SHALL be located in `libs/backend/workspace-intelligence`
2. WHEN analyzing a workspace THEN it SHALL combine:
   - Existing workspace detection (project type, frameworks, dependencies) from current services
   - NEW code quality assessment from FR-001
   - Architecture pattern detection from DeepProjectAnalysisService
3. WHEN returning analysis results THEN it SHALL provide a unified `ProjectIntelligence` interface containing:
   - `workspaceContext: WorkspaceContext` (existing detection results)
   - `qualityAssessment: QualityAssessment` (NEW from FR-001)
   - `prescriptiveGuidance: PrescriptiveGuidance` (generated corrective recommendations)
4. WHEN generating prescriptive guidance THEN it SHALL prioritize issues by:
   - Severity (error > warning > info)
   - Frequency (patterns appearing in multiple files ranked higher)
   - Impact (architectural issues ranked higher than style issues)
5. WHEN caching results THEN it SHALL invalidate on file changes to sampled source files (not just config files)

---

### FR-003: Generalized Reliable Workflow Pattern

**User Story:** As a developer maintaining Ptah, I want the reliable workflow pattern from Agent Generation (template + LLM + validation) extracted and generalized, so that Enhanced Prompts can adopt it without code duplication.

#### Acceptance Criteria

1. WHEN extracting the workflow pattern THEN it SHALL create a `ReliableGenerationPipeline` interface in `libs/backend/workspace-intelligence` containing:
   - `template: TemplateSource` (hardcoded backbone content)
   - `llmCustomization: LlmCustomizationConfig` (sections to customize via LLM)
   - `validation: ValidationConfig` (schema, safety, factual validation weights)
   - `fallback: FallbackStrategy` (graceful degradation when LLM fails)
2. WHEN validating generated content THEN it SHALL implement the 3-tier validation scoring system:
   - Schema validation: 40 points (structure, markers, frontmatter)
   - Safety validation: 30 points (no malicious code, no sensitive data)
   - Factual validation: 30 points (file paths exist, frameworks match reality)
3. WHEN validation score < 70 THEN it SHALL trigger retry with modified prompts (up to 2 retries)
4. WHEN all retries fail THEN it SHALL fall back to template-only content (no LLM customization)
5. WHEN implementing in Enhanced Prompts THEN it SHALL increase hardcoded template ratio from ~30% to ~60%

---

### FR-004: Enhanced Prompts Integration

**User Story:** As a developer using Enhanced Prompts, I want the system to use actual code quality data when generating guidance, so that I receive prescriptive recommendations for my specific gaps.

#### Acceptance Criteria

1. WHEN PromptDesignerAgent generates guidance THEN it SHALL consume ProjectIntelligenceService instead of direct workspace analysis
2. WHEN quality assessment reveals anti-patterns THEN it SHALL include corrective guidance in the output:
   - For each detected anti-pattern: specific improvement recommendation
   - Priority ordering based on severity and impact
3. WHEN quality assessment shows best practice adherence THEN it SHALL include validation in output:
   - Acknowledgment of good practices detected
   - Advanced tips for areas already well-implemented
4. WHEN generating PromptDesignerOutput THEN it SHALL add new section:
   - `qualityGuidance: string` (prescriptive recommendations based on assessment)
5. WHEN LLM is unavailable THEN it SHALL use enhanced fallback that includes quality-based recommendations

---

### FR-005: Agent Generation Integration

**User Story:** As a developer using Agent Generation wizard, I want generated agents to include guidance specific to my codebase quality issues, so that agents help me improve rather than perpetuate anti-patterns.

#### Acceptance Criteria

1. WHEN DeepProjectAnalysisService performs analysis THEN it SHALL consume ProjectIntelligenceService for unified data
2. WHEN generating agent content THEN it SHALL incorporate quality assessment into LLM prompts
3. WHEN quality gaps are detected THEN generated agents SHALL include:
   - Specific instructions to watch for and correct the detected anti-patterns
   - Framework-specific guidance tailored to the user's actual implementation quality
4. WHEN content is generated THEN it SHALL continue using the existing 3-tier validation (no changes to validation logic)
5. WHEN generating agent recommendations THEN it SHALL factor in code quality:
   - Low quality score increases relevance of code-reviewer agent
   - Missing tests increases relevance of senior-tester agent

---

### FR-006: Anti-Pattern Detection Rules

**User Story:** As a developer, I want the system to detect common anti-patterns in my TypeScript/JavaScript code, so that I receive specific, actionable feedback.

#### Acceptance Criteria

1. WHEN analyzing TypeScript files THEN it SHALL detect:
   - Explicit `any` type usage (severity: warning)
   - Implicit `any` from missing type annotations (severity: info)
   - `@ts-ignore` comments (severity: warning)
   - Non-null assertions (`!`) overuse (severity: info)
2. WHEN analyzing error handling THEN it SHALL detect:
   - Empty catch blocks (severity: error)
   - catch with only `console.log` (severity: warning)
   - Unhandled promise rejections (severity: warning)
   - Missing try-catch in async functions (severity: info)
3. WHEN analyzing architecture THEN it SHALL detect:
   - Files over 500 lines (severity: warning for >500, error for >1000)
   - Functions over 50 lines (severity: warning)
   - More than 10 imports in a single file (severity: info)
   - Circular dependency indicators (severity: error)
4. WHEN analyzing testing THEN it SHALL detect:
   - Service files without corresponding `.spec.ts` (severity: warning)
   - Test files with no assertions (severity: warning)
   - Test files with only skipped tests (severity: info)
5. WHEN reporting anti-patterns THEN each SHALL include:
   - `type: string` (category of anti-pattern)
   - `severity: 'error' | 'warning' | 'info'`
   - `location: { file: string, line?: number }`
   - `message: string` (human-readable description)
   - `suggestion: string` (how to fix)

---

### FR-007: Prescriptive Guidance Generation

**User Story:** As a developer, I want the system to generate actionable recommendations based on my specific code issues, not just generic framework advice.

#### Acceptance Criteria

1. WHEN generating prescriptive guidance THEN it SHALL prioritize based on:
   - Detection frequency (issues in 5+ files ranked highest)
   - Severity level (errors before warnings before info)
   - Fix complexity (quick fixes before major refactors)
2. WHEN anti-patterns are detected THEN guidance SHALL include:
   - Specific code pattern to avoid (with example)
   - Recommended alternative pattern (with example)
   - Files where the pattern was detected (up to 5 examples)
3. WHEN no significant anti-patterns are detected THEN guidance SHALL:
   - Acknowledge code quality strengths
   - Provide advanced recommendations for further improvement
   - Suggest next-level best practices
4. WHEN generating guidance THEN it SHALL respect token budgets:
   - Maximum 500 tokens for quality guidance section
   - Truncate lower-priority items if budget exceeded

---

## 4. Non-Functional Requirements

### NFR-001: Performance

1. Code Quality Assessment SHALL complete within 5 seconds for workspaces up to 500 source files
2. File sampling SHALL use intelligent selection (entry points, services, components) rather than random sampling
3. Cached results SHALL be returned within 50ms
4. Full analysis with cold cache SHALL complete within 10 seconds

### NFR-002: Reliability

1. Analysis SHALL complete successfully even when individual files fail to parse
2. System SHALL gracefully degrade when LLM service is unavailable
3. Validation pipeline SHALL never accept content that fails safety checks (score 0)
4. All errors SHALL be logged with correlation IDs for debugging

### NFR-003: Maintainability

1. Anti-pattern detection rules SHALL be configurable via separate configuration (not hardcoded)
2. New anti-pattern rules SHALL be addable without modifying core service logic
3. All public interfaces SHALL have JSDoc documentation
4. Test coverage SHALL be >= 80% for new code

### NFR-004: Scalability

1. System SHALL handle monorepos with 50+ libraries
2. File sampling SHALL scale proportionally (larger projects sample more files)
3. Memory usage for analysis SHALL not exceed 100MB

### NFR-005: Compatibility

1. All changes SHALL maintain backward compatibility with existing APIs
2. New features SHALL be opt-in via configuration
3. Existing Agent Generation behavior SHALL not change unless quality assessment is enabled

---

## 5. Success Criteria

### Quantitative Metrics

| Metric                          | Target                        | Measurement Method                    |
| ------------------------------- | ----------------------------- | ------------------------------------- |
| Anti-pattern detection accuracy | >= 85% precision              | Manual review of 50 detected patterns |
| Quality score correlation       | >= 0.7 with manual assessment | Compare automated vs expert review    |
| Analysis completion time        | < 5s for 500 files            | Performance benchmarks                |
| Test coverage                   | >= 80%                        | Jest coverage reports                 |
| Validation pass rate            | >= 90% on first attempt       | Log analysis of production usage      |

### Qualitative Outcomes

1. **User Validation**: 3 test users report that guidance is more actionable than before
2. **Code Quality**: Generated agents include specific, relevant recommendations
3. **System Unification**: Both Agent Generation and Enhanced Prompts use shared ProjectIntelligenceService
4. **Maintainability**: Adding new anti-pattern rules requires < 1 hour of work

---

## 6. Scope Boundaries

### In Scope

- Code Quality Assessment Service with anti-pattern detection
- Unified ProjectIntelligenceService in workspace-intelligence library
- Generalized ReliableGenerationPipeline pattern
- Integration with Enhanced Prompts (PromptDesignerAgent, PromptCacheService)
- Integration with Agent Generation (DeepProjectAnalysisService, ContentGenerationService)
- TypeScript/JavaScript anti-pattern detection rules
- Prescriptive guidance generation based on detected issues

### Out of Scope

- Support for languages other than TypeScript/JavaScript (future enhancement)
- Real-time analysis (file watcher for continuous assessment)
- IDE integration (inline warnings/suggestions)
- Machine learning-based pattern detection (using rule-based approach)
- Fixing detected issues automatically (only reporting and recommendations)
- Breaking changes to existing public APIs

---

## 7. Risk Assessment

### Technical Risks

| Risk                                        | Probability | Impact | Mitigation                             | Contingency                                 |
| ------------------------------------------- | ----------- | ------ | -------------------------------------- | ------------------------------------------- |
| AST parsing failures on complex syntax      | Medium      | Low    | Use try-catch, skip unparseable files  | Fall back to regex-based detection          |
| LLM hallucinations in prescriptive guidance | Medium      | Medium | 3-tier validation, factual checking    | Template-only fallback for quality guidance |
| Performance degradation on large codebases  | Low         | High   | Intelligent sampling, caching          | Configurable sample size limits             |
| False positive anti-patterns                | Medium      | Medium | Conservative detection rules           | User feedback mechanism for refinement      |
| Integration complexity with two systems     | Medium      | Medium | Phased delivery, comprehensive testing | Feature flags for gradual rollout           |

### Business Risks

| Risk                                    | Probability | Impact | Mitigation                                    |
| --------------------------------------- | ----------- | ------ | --------------------------------------------- |
| Scope creep from feature requests       | Medium      | Medium | Clear scope boundaries, defer to future tasks |
| User confusion from new guidance format | Low         | Low    | Clear documentation, gradual introduction     |

---

## 8. Phased Delivery Plan

### Phase A: Foundation (Estimated: 3-4 days)

**Deliverables:**

1. `QualityAssessment` and related type definitions in `@ptah-extension/shared`
2. Basic `CodeQualityAssessmentService` in `workspace-intelligence` with:
   - File sampling logic (intelligent selection)
   - Basic anti-pattern detection (TypeScript any types, empty catch blocks)
   - Quality scoring algorithm
3. Unit tests for new service

**Exit Criteria:**

- Service can analyze a workspace and return QualityAssessment
- Basic anti-patterns detected with >= 80% accuracy on test fixtures
- All unit tests passing

### Phase B: Unified Intelligence (Estimated: 3-4 days)

**Deliverables:**

1. `ProjectIntelligenceService` facade in `workspace-intelligence` combining:
   - Existing workspace detection services
   - New CodeQualityAssessmentService
2. `PrescriptiveGuidance` generation from quality assessment
3. `ReliableGenerationPipeline` interface extracted from Agent Generation
4. Integration tests for unified service

**Exit Criteria:**

- ProjectIntelligenceService provides complete unified data
- Prescriptive guidance generated for detected anti-patterns
- Pipeline interface documented and tested

### Phase C: Enhanced Prompts Integration (Estimated: 2-3 days)

**Deliverables:**

1. Update `PromptDesignerAgent` to consume `ProjectIntelligenceService`
2. Add `qualityGuidance` section to `PromptDesignerOutput`
3. Implement `ReliableGenerationPipeline` in Enhanced Prompts
4. Update `PromptCacheService` invalidation for source file changes
5. Enhanced fallback guidance including quality recommendations

**Exit Criteria:**

- PromptDesignerAgent generates quality-aware guidance
- Validation score >= 70 required for acceptance
- Cache invalidates when sampled source files change

### Phase D: Agent Generation Integration (Estimated: 2-3 days)

**Deliverables:**

1. Update `DeepProjectAnalysisService` to use `ProjectIntelligenceService`
2. Update `ContentGenerationService` to incorporate quality context
3. Update agent recommendation scoring based on code quality
4. Integration tests for full workflow

**Exit Criteria:**

- Generated agents include quality-specific guidance
- Code reviewer agent relevance increases for low-quality codebases
- Full end-to-end tests passing

### Phase E: Expanded Detection & Polish (Estimated: 2-3 days)

**Deliverables:**

1. Complete anti-pattern detection rules (FR-006)
2. Performance optimization (caching, parallel analysis)
3. Documentation updates
4. Edge case handling and error recovery

**Exit Criteria:**

- All anti-pattern categories from FR-006 implemented
- Performance targets from NFR-001 met
- Documentation complete

---

## 9. Dependencies

### Internal Dependencies

| Dependency               | Library                | Status          |
| ------------------------ | ---------------------- | --------------- |
| WorkspaceIndexerService  | workspace-intelligence | Existing, ready |
| FrameworkDetectorService | workspace-intelligence | Existing, ready |
| ProjectDetectorService   | workspace-intelligence | Existing, ready |
| OutputValidationService  | agent-generation       | Existing, ready |
| ContentGenerationService | agent-generation       | Existing, ready |
| PromptDesignerAgent      | agent-sdk              | Existing, ready |
| PromptCacheService       | agent-sdk              | Existing, ready |

### External Dependencies

| Dependency              | Version | Purpose                                |
| ----------------------- | ------- | -------------------------------------- |
| TypeScript compiler API | 5.8+    | AST parsing for anti-pattern detection |
| tsyringe                | 4.10+   | Dependency injection                   |
| zod                     | 3.23+   | Schema validation                      |

---

## 10. Glossary

| Term                             | Definition                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| **Descriptive Guidance**         | Framework-based guidance that describes what technologies are used (current state)          |
| **Prescriptive Guidance**        | Quality-based guidance that prescribes what should be improved (corrective recommendations) |
| **Anti-Pattern**                 | A common but ineffective or counterproductive coding practice                               |
| **Quality Assessment**           | Analysis of actual source code to determine adherence to best practices                     |
| **Reliable Generation Pipeline** | The pattern of template + LLM customization + 3-tier validation with fallback               |
| **3-Tier Validation**            | Schema (40pts) + Safety (30pts) + Factual (30pts) validation scoring system                 |

---

## 11. Appendix: Type Definitions (Draft)

```typescript
// @ptah-extension/shared - New types

interface QualityAssessment {
  score: number; // 0-100 overall quality score
  antiPatterns: AntiPattern[];
  gaps: QualityGap[];
  strengths: string[];
  sampledFiles: string[];
  analysisTimestamp: number;
}

interface AntiPattern {
  type: AntiPatternType;
  severity: 'error' | 'warning' | 'info';
  location: CodeLocation;
  message: string;
  suggestion: string;
  frequency: number; // How many times detected
}

type AntiPatternType = 'typescript-any' | 'typescript-implicit-any' | 'typescript-ts-ignore' | 'error-empty-catch' | 'error-console-only-catch' | 'error-unhandled-promise' | 'arch-file-too-large' | 'arch-function-too-large' | 'arch-too-many-imports' | 'arch-circular-dependency' | 'test-missing-spec' | 'test-no-assertions' | 'test-all-skipped';

interface QualityGap {
  area: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

interface CodeLocation {
  file: string;
  line?: number;
  column?: number;
}

interface PrescriptiveGuidance {
  summary: string;
  recommendations: Recommendation[];
  totalTokens: number;
}

interface Recommendation {
  priority: number;
  category: string;
  issue: string;
  solution: string;
  examples?: string[];
}

// @ptah-extension/workspace-intelligence - New types

interface ProjectIntelligence {
  workspaceContext: WorkspaceContext;
  qualityAssessment: QualityAssessment;
  prescriptiveGuidance: PrescriptiveGuidance;
  timestamp: number;
}

interface ReliableGenerationPipeline<TInput, TOutput> {
  template: TemplateSource;
  llmCustomization: LlmCustomizationConfig;
  validation: ValidationConfig;
  fallback: FallbackStrategy<TOutput>;
  generate(input: TInput): Promise<Result<TOutput, Error>>;
}
```

---

**Document Version:** 1.0
**Created:** 2026-02-05
**Author:** Project Manager Agent
**Status:** Ready for Review
