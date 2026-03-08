# Research Report - TASK_2025_141

## Unified Project Intelligence with Code Quality Assessment

**Research Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 90% (based on comprehensive source code analysis)
**Key Insight**: The Agent Generation system has a well-defined, battle-tested workflow pattern (template + LLM + 3-tier validation + fallback cascade) that can be generalized into a reusable `ReliableGenerationPipeline` interface for adoption by Enhanced Prompts.

---

## 1. Agent Generation Workflow Analysis

### 1.1 Complete Workflow Architecture

The Agent Generation system implements a sophisticated 5-phase workflow orchestrated by `AgentGenerationOrchestratorService` (file: `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`).

```
Phase 1: Analysis (0-20%)      -> WorkspaceAnalyzerService, ProjectDetector, FrameworkDetector
Phase 2: Selection (20-30%)    -> AgentSelectionService (relevance scoring)
Phase 3: Customization (30-80%) -> VsCodeLmService/AgentCustomizationService (LLM + validation)
Phase 4: Rendering (80-95%)    -> ContentGenerationService (template processing)
Phase 5: Writing (95-100%)     -> AgentFileWriterService (atomic writes with rollback)
```

### 1.2 The Reliable Workflow Pattern

**Core Pattern Location**: `AgentCustomizationService` (lines 143-321), `VsCodeLmService` (lines 132-261)

The pattern follows this exact sequence:

```typescript
// 1. BUILD CONTEXT-AWARE PROMPT
const prompt = buildPrompt(sectionTopic, projectContext, fileSamples);

// 2. RETRY LOOP WITH EXPONENTIAL BACKOFF
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  // 3. INVOKE LLM
  const response = await llmProvider.getCompletion(prompt);

  // 4. VALIDATE WITH 3-TIER SCORING
  const validation = await validator.validate(response, projectContext);

  // 5. CHECK VALIDATION THRESHOLD (score >= 70)
  if (validation.isValid && validation.score >= 70) {
    return Result.ok(response);  // SUCCESS
  }

  // 6. RETRY WITH BACKOFF ON FAILURE
  if (attempt < MAX_RETRIES) {
    await delay(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    continue;
  }

  // 7. FALLBACK CASCADE
  return Result.err(new FallbackError(...));
}
```

### 1.3 Retry Logic and Backoff Strategy

**Configuration Constants** (from `AgentCustomizationService`, lines 88-90):

```typescript
private readonly MAX_RETRIES = 2;           // 2 retries = 3 total attempts
private readonly BACKOFF_BASE_MS = 3000;    // 3s -> 6s exponential backoff
private readonly DEFAULT_MODEL = 'gpt-4o-mini';  // Cost-effective model
```

**VsCodeLmService Configuration** (lines 66-67):

```typescript
private readonly MAX_RETRIES = 3;           // 3 retries = 4 total attempts
private readonly BACKOFF_BASE_MS = 5000;    // 5s -> 10s -> 20s exponential
```

**Backoff Formula** (line 530):

```typescript
calculateBackoff(attempt: number): number {
  return BACKOFF_BASE_MS * Math.pow(2, attempt);
}
```

### 1.4 Three-Tier Validation Scoring System

**Location**: `OutputValidationService` (file: `libs/backend/agent-generation/src/lib/services/output-validation.service.ts`)

**Scoring Weights** (lines 62-66):

```typescript
const VALIDATION_WEIGHTS = {
  SCHEMA: 40, // 40 points for structural correctness
  SAFETY: 30, // 30 points for security
  FACTUAL: 30, // 30 points for accuracy
};
```

**Validation Thresholds** (lines 71-76):

```typescript
const THRESHOLDS = {
  VALID_SCORE: 70, // Minimum score for valid content
  REVIEW_THRESHOLD: 60, // Scores below this need human review
  MIN_CONTENT_LENGTH: 100, // Minimum content length
  MAX_CONTENT_LENGTH: 50000, // Maximum content length
};
```

#### Tier 1: Schema Validation (40 points)

**Checks** (lines 321-435):

- Content length constraints (min 100, max 50000 chars)
- YAML frontmatter presence and required fields (id, name, version)
- Template marker closure (`<!-- LLM:id -->` ... `<!-- /LLM -->`)
- Static marker closure (`<!-- STATIC -->` ... `<!-- /STATIC -->`)
- Markdown structure (headers present)

**Scoring Deductions**:

- Empty content: -40 (fail immediately)
- Content too short: -15
- Content too long: -5
- Missing frontmatter: -15
- Missing frontmatter fields: -5
- Mismatched LLM markers: -10
- Mismatched STATIC markers: -5
- No markdown headers: -5

#### Tier 2: Safety Validation (30 points)

**Checks** (lines 449-543):

- Malicious code patterns (script tags, javascript:, eval, Function)
- Sensitive data patterns (API keys, passwords, tokens, private keys)
- External URL validation against whitelist
- Base64 encoded content detection

**Sensitive Patterns** (lines 24-39):

```typescript
const SENSITIVE_PATTERNS = [
  /(?:api[_-]?key|apikey)['":\s]*=?\s*['"]?[a-zA-Z0-9_-]{20,}/gi,
  /(?:password|passwd|pwd)['":\s]*=?\s*['"]?[^\s'"]{8,}/gi,
  /(?:secret|token)['":\s]*=?\s*['"]?[a-zA-Z0-9_-]{20,}/gi,
  /sk-[a-zA-Z0-9]{48}/g, // OpenAI keys
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub PATs
  /AKIA[0-9A-Z]{16}/g, // AWS access keys
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
];
```

**Critical Behavior**: If malicious code is detected, validation returns score 0 immediately (line 466), ensuring no acceptance regardless of other scores.

#### Tier 3: Factual Validation (30 points)

**Checks** (lines 558-683):

- File path references exist in project context
- Framework references match detected tech stack
- Language references match project languages
- Import statements reference known packages

**Scoring Deductions**:

- Invalid file paths: -3 per path (max -10)
- Invalid frameworks: -5 per framework (max -10)
- Invalid languages: -2 per language (max -5)

### 1.5 Fallback Cascade Mechanism

**Custom Error Type** (lines 35-44):

```typescript
export class AgentCustomizationFallbackError extends Error {
  constructor(message: string, public readonly attempts: number, public readonly lastValidationScore?: number) {
    super(message);
    this.name = 'AgentCustomizationFallbackError';
  }
}
```

**Fallback Flow** (orchestrator.service.ts, lines 595-615):

```typescript
if (result.error instanceof LlmValidationFallbackError) {
  // Validation failed -> use generic template content
  agentCustomizations.set(sectionId, ''); // Empty string = use template default
} else {
  // Infrastructure error -> also fallback to generic
  agentCustomizations.set(sectionId, '');
}
```

**Content Generation Fallback** (content-generation.service.ts, lines 93-98):

```typescript
if (customizationsResult.isErr()) {
  this.logger.warn('LLM customization failed, using fallback content');
  // Continue with variables substituted but no LLM customizations
}
```

### 1.6 Template Processing Pipeline

**Location**: `ContentGenerationService` (file: `libs/backend/agent-generation/src/lib/services/content-generation.service.ts`)

**Processing Steps** (lines 72-106):

1. **Extract Static Sections**: Preserve `<!-- STATIC -->` blocks unchanged
2. **Substitute Variables**: Replace `{{variableName}}` with context values
3. **Process Conditionals**: Handle `{{#if CONDITION}}...{{/if}}` blocks
4. **Generate LLM Sections**: Call LLM for `<!-- LLM:id -->` sections
5. **Inject LLM Content**: Replace markers with generated content
6. **Restore Static Sections**: Put preserved static content back

**Variable Substitution Priority** (lines 234-253):

1. Values from `AgentProjectContext`
2. `defaultValue` from `TemplateVariable` definition
3. Empty string (with warning for required variables)

---

## 2. Enhanced Prompts Current Implementation

### 2.1 Architecture Overview

**Files Analyzed**:

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-cache.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`

**Current Workflow**:

```
1. EnhancedPromptsService.runWizard() invoked
2. WorkspaceIntelligence.analyzeWorkspace() -> metadata analysis
3. PromptDesignerAgent.generateGuidance() -> LLM generation
4. PromptCacheService.set() -> cache with file watching
5. Combined prompt stored in globalState
```

### 2.2 What Project Data It Currently Uses

**From `EnhancedPromptsService.buildDesignerInput()` (lines 614-630)**:

```typescript
return {
  workspacePath,
  projectType: analysis.projectType, // From package.json/config
  framework: analysis.framework, // From dependency detection
  isMonorepo: analysis.isMonorepo, // From monorepo detection
  monorepoType: analysis.monorepoType, // Nx, Lerna, etc.
  dependencies: analysis.dependencies, // package.json dependencies
  devDependencies: analysis.devDependencies, // devDependencies
  tokenBudget: finalConfig.maxTokens,
};
```

**Critical Gap**: The `WorkspaceAnalysisResult` interface (lines 64-73) contains:

- `projectType`, `framework`, `isMonorepo`, `monorepoType`
- `dependencies`, `devDependencies`, `configFiles`, `languages`

**NOT Included**:

- Actual source code samples
- Code quality metrics
- Anti-pattern detection
- Adherence to best practices

### 2.3 Current LLM Generation Flow

**Location**: `PromptDesignerAgent.generateGuidance()` (lines 105-183)

```typescript
// 1. Check LLM availability
if (!this.llmService.hasProvider()) {
  return this.generateFallbackGuidance(input); // WEAK FALLBACK
}

// 2. Build enhanced system prompt
const systemPrompt = this.buildEnhancedSystemPrompt(input.framework);

// 3. Build user prompt with project details
const userPrompt = buildGenerationUserPrompt(input);

// 4. Try structured completion (Zod schema)
const output = await this.tryStructuredCompletion(systemPrompt, userPrompt);

// 5. If fails, try text completion (fallback)
if (!output) {
  return await this.tryTextCompletion(systemPrompt, userPrompt);
}
```

**Validation** (lines 151-156):

```typescript
const validation = validateOutput(output);
if (!validation.valid) {
  this.logger.warn('Output validation issues', { issues: validation.issues });
}
// BUT: Output is still returned even if validation issues exist!
```

**Critical Difference from Agent Generation**:

- No retry logic on validation failure
- No 3-tier validation scoring
- No threshold-based acceptance
- Weak fallback (template-only without LLM)

### 2.4 Fallback Mechanism

**Current Fallback** (lines 361-388):

```typescript
private generateFallbackGuidance(input: PromptDesignerInput): PromptDesignerOutput {
  const fallbackText = buildFallbackGuidance(input);  // Template-only
  // Returns pre-built guidance sections based on framework
  // NO project-specific customization
}
```

**Fallback is triggered when**:

- LLM service unavailable
- Structured completion fails
- Text completion fails

**Fallback does NOT consider**:

- Code quality issues
- Anti-patterns detected
- Best practice adherence

### 2.5 Cache Invalidation Strategy

**Location**: `PromptCacheService` (lines 129-508)

**Configuration** (lines 94-98):

```typescript
const DEFAULT_CACHE_CONFIG: PromptCacheConfig = {
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  enableFileWatching: true,
  gracePeriodMs: 24 * 60 * 60 * 1000, // 1 day grace
};
```

**Invalidation Triggers** (from `cache-invalidation.ts`):

- `package.json` changes
- `tsconfig.json` changes
- `angular.json` changes
- `nx.json` changes
- `.eslintrc.*` changes

**GAP**: Does NOT invalidate on source file changes (only config files).

### 2.6 Integration Points for Quality Assessment

**Where to inject quality data**:

1. **EnhancedPromptsService.runWizard()** (line 236):

   ```typescript
   // CURRENT: Only metadata analysis
   const analysis = await this.workspaceIntelligence.analyzeWorkspace(workspacePath);

   // NEEDED: Add quality assessment
   const qualityAssessment = await projectIntelligence.assessCodeQuality(workspacePath);
   ```

2. **buildDesignerInput()** (line 614):

   ```typescript
   return {
     ...existingInput,
     qualityAssessment, // NEW: Add quality data
     prescriptiveGuidance, // NEW: Add corrective recommendations
   };
   ```

3. **PromptDesignerAgent.generateGuidance()** (line 137):

   ```typescript
   // Build prompts that include quality context
   const userPrompt = buildGenerationUserPrompt(input, qualityAssessment);
   ```

4. **PromptCacheService.onInvalidation()** (line 332):
   ```typescript
   // Add invalidation for sampled source files
   if (sampledFileChanged(filePath)) {
     this.invalidate(workspacePath, 'source_changed');
   }
   ```

---

## 3. Workspace Intelligence Current State

### 3.1 Existing Analysis Capabilities

**Services Analyzed**:

- `WorkspaceAnalyzerService` (composite/workspace-analyzer.service.ts)
- `WorkspaceIndexerService` (file-indexing/workspace-indexer.service.ts)
- `ProjectDetectorService`, `FrameworkDetectorService`, `MonorepoDetectorService`
- `FileRelevanceScorerService`, `ContextSizeOptimizerService`
- `TreeSitterParserService`, `AstAnalysisService`

**Current Capabilities**:

| Capability               | Service                     | Status                        |
| ------------------------ | --------------------------- | ----------------------------- |
| Project type detection   | ProjectDetectorService      | Mature (13+ types)            |
| Framework detection      | FrameworkDetectorService    | Mature                        |
| Monorepo detection       | MonorepoDetectorService     | Mature (6 types)              |
| File indexing            | WorkspaceIndexerService     | Mature (async generators)     |
| File type classification | FileTypeClassifierService   | Mature                        |
| Relevance scoring        | FileRelevanceScorerService  | Mature (query-based)          |
| Token optimization       | ContextSizeOptimizerService | Mature                        |
| AST parsing              | TreeSitterParserService     | Implemented (Phase 2 stub)    |
| Code insights            | AstAnalysisService          | **Stub only** (returns empty) |

### 3.2 What's Missing for Code Quality Assessment

**Gap Analysis**:

| Required Capability     | Current State                      | Gap                             |
| ----------------------- | ---------------------------------- | ------------------------------- |
| Source file sampling    | Not implemented                    | Need intelligent file selection |
| Anti-pattern detection  | Not implemented                    | Need rule-based detection       |
| TypeScript any usage    | Not implemented                    | Need AST analysis               |
| Error handling patterns | Not implemented                    | Need pattern matching           |
| Architecture smells     | Partially (folder detection)       | Need code analysis              |
| Test coverage gaps      | Exists (CodeHealthAnalysisService) | Can be extended                 |
| Quality scoring         | Not implemented                    | Need scoring algorithm          |

**AstAnalysisService Current State** (lines 386-403 in workspace-analyzer.service.ts):

```typescript
async extractCodeInsights(filePath: string): Promise<CodeInsights | null> {
  // Phase 2: stub returns empty insights
  const insightsResult = await this.astAnalyzer.analyzeAst(astResult.value!, filePath);
  // Currently returns empty arrays for functions, classes, imports
}
```

### 3.3 Best Location for ProjectIntelligenceService

**Recommendation**: `libs/backend/workspace-intelligence/src/composite/`

**Rationale**:

1. `WorkspaceAnalyzerService` already exists as a composite facade in this location
2. Project intelligence is a higher-level abstraction over existing services
3. Maintains separation between analysis (workspace-intelligence) and generation (agent-generation)

**Proposed Architecture**:

```
workspace-intelligence/src/composite/
├── workspace-analyzer.service.ts    # Existing facade
└── project-intelligence.service.ts  # NEW: Unified intelligence facade
```

**ProjectIntelligenceService Dependencies**:

```typescript
@injectable()
export class ProjectIntelligenceService {
  constructor(
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,
    private readonly indexer: WorkspaceIndexerService,
    private readonly fileClassifier: FileTypeClassifierService,
    private readonly relevanceScorer: FileRelevanceScorerService,
    private readonly codeHealthService: CodeHealthAnalysisService, // From agent-generation
    private readonly treeSitterParser: TreeSitterParserService
  ) {}
}
```

---

## 4. Source Code Sampling Patterns

### 4.1 Existing File Reading Patterns

**From WorkspaceIndexerService** (lines 162-168):

```typescript
// Estimate token count if requested
if (options.estimateTokens) {
  try {
    const content = await this.fileSystemService.readFile(fileUri);
    estimatedTokens = await this.tokenCounter.countTokens(content);
  } catch {
    continue; // Skip unreadable files
  }
}
```

**From FileSystemService** (`workspace-intelligence/src/services/file-system.service.ts`):

```typescript
async readFile(uri: vscode.Uri): Promise<string> {
  const content = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(content).toString('utf8');
}
```

### 4.2 Intelligent File Selection Pattern

**From ContextOrchestrationService** (observed in context-analysis):

```typescript
// Relevance scoring for query-based selection
const ranked = this.relevanceScorer.rankFiles(files, query);
const topFiles = this.relevanceScorer.getTopFiles(files, query, limit);
```

**From DeepProjectAnalysisService** (lines 459-474):

```typescript
// Find entry points
const entryPointPatterns = ['**/main.ts', '**/index.ts', '**/app.ts', '**/server.ts'];
const entryPointFiles: string[] = [];
for (const pattern of entryPointPatterns) {
  const files = await vscodeApi.workspace.findFiles(pattern, '**/node_modules/**', 5);
  entryPointFiles.push(...files.map((f) => f.fsPath));
}
```

### 4.3 AST Analysis Pattern (Tree-sitter)

**From TreeSitterParserService**:

```typescript
parse(content: string, language: SupportedLanguage): Result<GenericAstNode, Error> {
  const parser = this.getParser(language);
  const tree = parser.parse(content);
  return Result.ok(this.convertToGenericAst(tree.rootNode));
}
```

### 4.4 Proposed Sampling Strategy

**Intelligent File Selection Algorithm**:

```typescript
async sampleSourceFiles(workspacePath: string, config: SamplingConfig): Promise<SampledFile[]> {
  // 1. Get file index
  const index = await this.indexer.indexWorkspace({ estimateTokens: true });

  // 2. Filter by type (source only, no tests/configs)
  const sourceFiles = index.files.filter(f => f.type === FileType.Source);

  // 3. Score by relevance to key patterns
  const patterns = ['service', 'component', 'controller', 'repository', 'model'];
  const scored = this.relevanceScorer.rankFiles(sourceFiles, patterns.join(' '));

  // 4. Select diverse sample (entry points + high-relevance + random)
  const sample = [
    ...this.selectEntryPoints(sourceFiles, 3),
    ...this.selectHighRelevance(scored, 5),
    ...this.selectRandom(sourceFiles, 2),
  ];

  // 5. Read content for selected files
  return Promise.all(sample.slice(0, config.maxFiles).map(async f => ({
    path: f.path,
    content: await this.fileSystem.readFile(f.path),
    language: f.language,
  })));
}
```

---

## 5. Reusable Pattern Extraction

### 5.1 Proposed ReliableGenerationPipeline Interface

**Location**: `libs/backend/workspace-intelligence/src/composite/reliable-generation.types.ts`

```typescript
/**
 * Configuration for LLM customization within the pipeline
 */
interface LlmCustomizationConfig<TInput> {
  /** Build prompt from input */
  buildPrompt: (input: TInput) => string;

  /** Sections to customize (for template-based generation) */
  sections?: string[];

  /** Model preference */
  model?: string;

  /** Temperature (0-1) */
  temperature?: number;
}

/**
 * Configuration for validation within the pipeline
 */
interface ValidationConfig {
  /** Schema validation weight (default: 40) */
  schemaWeight?: number;

  /** Safety validation weight (default: 30) */
  safetyWeight?: number;

  /** Factual validation weight (default: 30) */
  factualWeight?: number;

  /** Minimum score threshold (default: 70) */
  threshold?: number;

  /** Custom validators */
  customValidators?: Validator[];
}

/**
 * Fallback strategy when generation fails
 */
interface FallbackStrategy<TOutput> {
  /** Fallback generator function */
  generate: (input: unknown) => TOutput;

  /** Whether to retry before fallback */
  retryBeforeFallback?: boolean;
}

/**
 * Retry configuration
 */
interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number;

  /** Base backoff in milliseconds */
  backoffBaseMs: number;

  /** Exponential factor (default: 2) */
  backoffFactor?: number;
}

/**
 * ReliableGenerationPipeline - Generalized pattern for reliable LLM generation
 */
interface ReliableGenerationPipeline<TInput, TOutput> {
  /** Template backbone content (hardcoded portion) */
  template: TemplateSource;

  /** LLM customization configuration */
  llmCustomization: LlmCustomizationConfig<TInput>;

  /** Validation configuration */
  validation: ValidationConfig;

  /** Fallback strategy */
  fallback: FallbackStrategy<TOutput>;

  /** Retry configuration */
  retry: RetryConfig;

  /** Execute the pipeline */
  generate(input: TInput): Promise<Result<TOutput, Error>>;
}
```

### 5.2 Concrete Implementation Example

```typescript
@injectable()
export class ReliableGenerationService<TInput, TOutput> implements ReliableGenerationPipeline<TInput, TOutput> {
  constructor(private readonly llmProvider: ILlmProvider, private readonly validator: IValidator, private readonly logger: Logger) {}

  async generate(input: TInput): Promise<Result<TOutput, Error>> {
    const { retry, validation, fallback, llmCustomization } = this.config;

    // Build prompt
    const prompt = llmCustomization.buildPrompt(input);

    // Retry loop
    for (let attempt = 1; attempt <= retry.maxRetries; attempt++) {
      try {
        // LLM invocation
        const response = await this.llmProvider.getCompletion(prompt);

        // Validation
        const validationResult = await this.validator.validate(response, validation);

        if (validationResult.score >= validation.threshold) {
          return Result.ok(this.transform(response));
        }

        // Retry with backoff
        if (attempt < retry.maxRetries) {
          await this.backoff(attempt, retry);
        }
      } catch (error) {
        if (attempt >= retry.maxRetries) {
          break;
        }
        await this.backoff(attempt, retry);
      }
    }

    // Fallback
    if (fallback.generate) {
      return Result.ok(fallback.generate(input));
    }

    return Result.err(new GenerationFailedError('All attempts exhausted'));
  }
}
```

---

## 6. Integration Strategy

### 6.1 High-Level Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 0: Code Quality Assessment (NEW)                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  CodeQualityAssessmentService (workspace-intelligence)       │    │
│  │  - Sample source files (intelligent selection)               │    │
│  │  - Detect anti-patterns (rule-based + LLM-assisted)         │    │
│  │  - Score best practice adherence                            │    │
│  │  - Output: QualityAssessment { score, antiPatterns, gaps }  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ProjectIntelligenceService (workspace-intelligence)                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Unified facade combining:                                   │    │
│  │  - WorkspaceContext (existing detection services)            │    │
│  │  - QualityAssessment (NEW from Phase 0)                     │    │
│  │  - PrescriptiveGuidance (generated from assessment)         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
┌────────────────────────────┐    ┌────────────────────────────────────┐
│  Agent Generation          │    │  Enhanced Prompts                   │
│  (existing + consume       │    │  (adopt ReliableGenerationPipeline) │
│   ProjectIntelligence)     │    │                                     │
│                            │    │  CHANGES:                           │
│  CHANGES:                  │    │  - Consume ProjectIntelligenceService│
│  - DeepProjectAnalysis     │    │  - Add 3-tier validation            │
│    uses unified service    │    │  - Add retry logic with backoff     │
│  - Include quality context │    │  - Add qualityGuidance section      │
│    in LLM prompts          │    │  - Increase template ratio to 60%   │
│  - Adjust agent relevance  │    │  - Cache invalidation for source    │
│    based on quality score  │    │    file changes                     │
└────────────────────────────┘    └────────────────────────────────────┘
```

### 6.2 Integration Sequence

**Phase A: Foundation**

1. Define `QualityAssessment`, `AntiPattern`, `QualityGap` types in `@ptah-extension/shared`
2. Create `CodeQualityAssessmentService` in `workspace-intelligence`
3. Implement basic anti-pattern detection (TypeScript `any`, empty catch blocks)

**Phase B: Unified Intelligence**

1. Create `ProjectIntelligenceService` facade in `workspace-intelligence`
2. Extract `ReliableGenerationPipeline` interface
3. Integrate with existing workspace detection services

**Phase C: Enhanced Prompts Integration**

1. Update `PromptDesignerAgent` to consume `ProjectIntelligenceService`
2. Add `qualityGuidance` section to `PromptDesignerOutput`
3. Implement validation with retry logic
4. Update cache invalidation for source file changes

**Phase D: Agent Generation Integration**

1. Update `DeepProjectAnalysisService` to use `ProjectIntelligenceService`
2. Incorporate quality context into LLM prompts
3. Adjust agent recommendation scoring based on code quality

### 6.3 Dependency Injection Configuration

**New DI Tokens** (in `@ptah-extension/vscode-core`):

```typescript
export const TOKENS = {
  // ... existing
  CODE_QUALITY_ASSESSMENT_SERVICE: Symbol.for('CodeQualityAssessmentService'),
  PROJECT_INTELLIGENCE_SERVICE: Symbol.for('ProjectIntelligenceService'),
  RELIABLE_GENERATION_PIPELINE: Symbol.for('ReliableGenerationPipeline'),
};
```

**Service Registration Order**:

1. `CodeQualityAssessmentService` (depends on: FileSystemService, WorkspaceIndexerService)
2. `ProjectIntelligenceService` (depends on: WorkspaceAnalyzerService, CodeQualityAssessmentService)
3. `ReliableGenerationService` (depends on: LlmProvider, Validator)

---

## 7. Technical Recommendations

### 7.1 For the Architect

1. **Type Definitions First**: Define all new types (`QualityAssessment`, `AntiPattern`, `QualityGap`, `PrescriptiveGuidance`, `ProjectIntelligence`) in `@ptah-extension/shared` before implementation.

2. **Interface Extraction**: Extract `IValidationService` and `IReliableGenerator<TInput, TOutput>` interfaces to allow different implementations.

3. **Validation Composability**: Design the validation system to be composable:

   ```typescript
   interface IValidator<TContext> {
     validate(content: string, context: TContext): Promise<ValidationResult>;
     weight: number;
   }

   class CompositeValidator<TContext> {
     constructor(private validators: IValidator<TContext>[]) {}
     async validate(content: string, context: TContext): Promise<ValidationResult>;
   }
   ```

4. **Anti-Pattern Rule Engine**: Design a rule-based anti-pattern detection system:

   ```typescript
   interface AntiPatternRule {
     id: AntiPatternType;
     severity: 'error' | 'warning' | 'info';
     detect: (fileContent: string, filePath: string) => AntiPatternMatch[];
   }
   ```

5. **Sampling Strategy Interface**: Define pluggable sampling strategies:
   ```typescript
   interface ISamplingStrategy {
     select(files: IndexedFile[], config: SamplingConfig): IndexedFile[];
   }
   ```

### 7.2 Critical Design Decisions

1. **Quality Assessment Location**: Keep in `workspace-intelligence` (not `agent-generation`) to enable reuse across multiple consumers.

2. **Cache Invalidation Scope**: Extend Enhanced Prompts cache to invalidate on sampled source file changes, not just config files.

3. **Fallback Hierarchy**:

   - Level 1: Retry with simplified prompt
   - Level 2: Use template with partial LLM customization
   - Level 3: Use template-only (no LLM)
   - Level 4: Return minimal guidance (core rules only)

4. **Performance Considerations**:

   - File sampling should complete in < 2 seconds
   - Quality assessment should cache results
   - Anti-pattern detection should be rule-based first, LLM-assisted optional

5. **Token Budget Allocation**:
   - Quality guidance section: max 500 tokens
   - Truncate lower-priority items if budget exceeded
   - Preserve critical anti-pattern warnings

### 7.3 Risk Mitigation

| Risk                                   | Mitigation                                            |
| -------------------------------------- | ----------------------------------------------------- |
| AST parsing failures                   | Fallback to regex-based detection                     |
| LLM hallucinations in quality guidance | 3-tier validation with factual checking               |
| Performance on large codebases         | Intelligent sampling, caching                         |
| False positive anti-patterns           | Conservative detection rules, user feedback mechanism |

---

## 8. Summary

### Key Findings

1. **Agent Generation Pattern is Proven**: The template + LLM + 3-tier validation + fallback cascade pattern has been battle-tested in Agent Generation.

2. **Enhanced Prompts Gap**: Currently uses only metadata (no source code), has weak fallback, and lacks validation scoring.

3. **Workspace Intelligence Ready**: Has all required infrastructure (indexing, scoring, detection) but lacks code quality assessment capability.

4. **Reusable Abstraction Possible**: The reliable workflow pattern can be extracted into a `ReliableGenerationPipeline` interface.

### Recommended Architecture

```
ProjectIntelligenceService (facade)
├── WorkspaceContext (existing services)
├── QualityAssessment (NEW)
│   └── CodeQualityAssessmentService
│       ├── FileSamplingService
│       └── AntiPatternDetectionService
└── PrescriptiveGuidance (generated from assessment)

ReliableGenerationPipeline<TInput, TOutput>
├── Template backbone
├── LLM customization (with retry + backoff)
├── 3-tier validation (schema 40 + safety 30 + factual 30)
└── Fallback cascade
```

### Next Steps for Architect

1. Design type contracts in `@ptah-extension/shared`
2. Define `ReliableGenerationPipeline` interface with full type parameters
3. Plan the anti-pattern detection rule engine
4. Design cache invalidation strategy for source files
5. Create component interaction diagrams

---

**Document Version**: 1.0
**Research Date**: 2026-02-05
**Agent**: researcher-expert
**Next Agent**: software-architect
**Architect Focus**: Interface contracts, anti-pattern rule engine, cache invalidation strategy
