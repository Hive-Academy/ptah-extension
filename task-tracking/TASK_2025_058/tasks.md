# Development Tasks - TASK_2025_058

**Project**: Intelligent Project-Adaptive Agent Generation System
**Total Batches**: 13 (Batch -1 to 11) | **Status**: 0/13 complete
**Execution Strategy**: Sequential extraction (Batch -1) → Parallel-optimized development (Batches 0-11)
**Estimated Timeline**: 11-15 weeks (Extraction: 0.5-1 week, POC: 2-3 weeks, Full Implementation: 8-11 weeks)

---

## 🚨 CRITICAL: Batch -1 - Pre-Implementation Extraction

**Purpose**: Extract code from roocode-generator to Ptah BEFORE development
**Strategy**: Copy first → Wire later (NOT simultaneously)
**Key Insight**: VS Code LM API is the INITIAL ROLE PLAYER

### Extraction Tasks Overview

| Task | Description                        | Priority    | Est. Time |
| ---- | ---------------------------------- | ----------- | --------- |
| -1.4 | Scaffold agent-generation library  | 🔴 CRITICAL | 0.5 days  |
| -1.1 | Create VS Code LM API Provider     | 🔴 CRITICAL | 1-2 days  |
| -1.2 | Extract ContentProcessor utilities | 🟠 HIGH     | 0.5 days  |
| -1.3 | Extract orchestration patterns     | 🟠 HIGH     | 1 day     |

**Full details**: See `extraction-plan.md`

---

### Task -1.4: Scaffold agent-generation library 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\
**Spec Reference**: extraction-plan.md:249-292
**Priority**: 🔴 CRITICAL - Blocks all other extraction tasks
**Developer**: backend-developer

**Quality Requirements**:

- Generate Nx library with @nx/js:library generator
- esbuild bundler for CommonJS format
- Jest test runner configured
- Proper directory structure: utils/, patterns/, types/

**Implementation Details**:

```bash
npx nx g @nx/js:library agent-generation \
  --directory=libs/backend/agent-generation \
  --importPath=@ptah-extension/agent-generation \
  --bundler=esbuild \
  --unitTestRunner=jest
```

**Directory Structure to Create**:

```
libs/backend/agent-generation/
├── src/
│   ├── index.ts              # Public exports
│   └── lib/
│       ├── utils/            # For Task -1.2
│       ├── patterns/         # For Task -1.3
│       └── types/            # Type definitions
├── project.json
├── tsconfig.json
└── jest.config.ts
```

**Validation**:

- [ ] Library builds successfully: `npx nx build agent-generation`
- [ ] Path alias resolves in tsconfig
- [ ] Jest runs without errors

---

### Task -1.1: Create VS Code LM API Provider ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\providers\vscode-lm.provider.ts
**Dependencies**: Task -1.4 (for llm-abstraction structure)
**Spec Reference**: extraction-plan.md:30-94
**Priority**: 🔴 CRITICAL - INITIAL ROLE PLAYER
**Developer**: backend-developer

**Quality Requirements**:

- Implement `ILlmProvider` interface
- Extend `BaseLlmProvider` base class
- Use VS Code Language Model API (`vscode.lm`)
- Support streaming and non-streaming completions
- Structured output via JSON schema prompting
- Proper error handling with `LlmProviderError`

**Implementation Details**:

```typescript
import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { BaseLlmProvider } from './base-llm.provider';
import { Result } from '@ptah-extension/shared';
import { LlmProviderError } from '../errors/llm-provider.error';

@injectable()
export class VsCodeLmProvider extends BaseLlmProvider {
  readonly name = 'vscode-lm';

  async getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, LlmProviderError>> {
    try {
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4',
      });

      if (models.length === 0) {
        return Result.err(new LlmProviderError('No VS Code LM models available'));
      }

      const model = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userPrompt}`)];

      const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

      let fullResponse = '';
      for await (const chunk of response.text) {
        fullResponse += chunk;
      }

      return Result.ok(fullResponse);
    } catch (error) {
      return Result.err(new LlmProviderError(`VS Code LM request failed: ${error}`));
    }
  }

  async getStructuredCompletion<T extends z.ZodTypeAny>(prompt: BaseLanguageModelInput, schema: T, config?: LlmCompletionConfig): Promise<Result<z.infer<T>, LlmProviderError>> {
    // Implement JSON schema-based structured output
    // Use prompt engineering to request JSON conforming to schema
  }
}
```

**Files to Create**:

1. `vscode-lm.provider.ts` (implementation)
2. `vscode-lm.provider.spec.ts` (unit tests)

**Files to Modify**:

1. `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts` - Register provider
2. `libs/backend/llm-abstraction/src/index.ts` - Export provider

**Validation**:

- [ ] Provider implements ILlmProvider interface
- [ ] Unit tests pass with mocked vscode.lm API
- [ ] Provider registered in registry
- [ ] Exported from library index

---

### Task -1.2: Extract ContentProcessor utilities ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\utils\content-processor.ts
**Dependencies**: Task -1.4
**Spec Reference**: extraction-plan.md:96-168
**Priority**: 🟠 HIGH
**Developer**: backend-developer
**Source**: D:\projects\roocode-generator\src\memory-bank\content-processor.ts

**Quality Requirements**:

- Direct copy with adaptations for Ptah patterns
- Uses Ptah's `Result` pattern from `@ptah-extension/shared`
- Comprehensive unit tests for each utility
- JSDoc documentation

**Utilities to Extract**:

1. **stripMarkdownCodeBlock** - Remove ```markdown wrappers from LLM output
2. **stripHtmlComments** - Remove HTML comments recursively
3. **processTemplate** - Simple {{mustache}} variable substitution
4. **extractFrontmatter** - Parse YAML frontmatter from markdown

**Implementation Pattern**:

````typescript
import { Result } from '@ptah-extension/shared';

/**
 * Strip markdown code block wrappers from LLM response.
 * Handles: ```markdown ... ```, ```json ... ```, etc.
 */
export function stripMarkdownCodeBlock(content: string): Result<string, Error> {
  const processed = content.replace(/```markdown\s*([\s\S]*?)\s*```/im, '$1').replace(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/im, '$1');
  return Result.ok(processed);
}

// ... (other utilities)
````

**Files to Create**:

1. `content-processor.ts` (utilities)
2. `content-processor.spec.ts` (unit tests)

**Validation**:

- [ ] All 4 utilities extracted and typed
- [ ] Uses Result pattern
- [ ] Unit tests pass (>90% coverage)
- [ ] JSDoc comments complete

---

### Task -1.3: Extract orchestration patterns ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\patterns\
**Dependencies**: Task -1.4
**Spec Reference**: extraction-plan.md:171-245
**Priority**: 🟠 HIGH
**Developer**: backend-developer
**Source**: D:\projects\roocode-generator\src\memory-bank\memory-bank-orchestrator.ts

**Quality Requirements**:

- Document patterns in patterns/README.md
- Create reusable base types/interfaces
- NOT direct code copy - reference patterns for developers
- Examples of how to apply each pattern

**Patterns to Document**:

1. **Error Accumulation Pattern** - Partial success handling

   - File: `patterns/error-accumulation.ts`
   - Pattern: Continue processing on individual failures, accumulate errors

2. **Generation Pipeline Pattern** - Multi-phase workflows

   - File: `patterns/generation-pipeline.ts`
   - Pattern: Composable phases with typed input/output

3. **Prompt Builder Pattern** - Structured prompt construction
   - File: `patterns/prompt-builder.ts`
   - Pattern: Template-based prompt generation with context

**Files to Create**:

1. `patterns/README.md` (pattern documentation)
2. `patterns/error-accumulation.ts` (pattern implementation)
3. `patterns/generation-pipeline.ts` (pattern implementation)
4. `patterns/prompt-builder.ts` (pattern implementation)

**Validation**:

- [ ] README.md documents all patterns with examples
- [ ] Type-safe pattern interfaces defined
- [ ] Patterns integrate with Ptah's Result type

---

**Batch -1 Verification Checklist**:

- [ ] `agent-generation` library exists and builds
- [ ] VS Code LM API provider implemented and tested
- [ ] ContentProcessor utilities extracted and tested
- [ ] Orchestration patterns documented
- [ ] All unit tests pass
- [ ] No wiring to existing systems (extraction only)

---

## 🎯 Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

1. ✅ **workspace-intelligence library** has all required detection capabilities (ProjectType, frameworks, monorepo)
2. ✅ **template-generation library** exists with base infrastructure (TemplateGeneratorService, ProjectContext)
3. ✅ **DI pattern** is established across all backend libraries (tsyringe)
4. ✅ **Result pattern** is established for error handling
5. ✅ **YAML frontmatter pattern** exists in agent discovery service

### Risks Identified

| Risk                                                                | Severity | Mitigation                                                                          |
| ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| VS Code LM API integration is NEW (no existing implementation)      | HIGH     | POC phase validates LLM quality and integration patterns before full implementation |
| Template format syntax unproven (HTML comments + Handlebars hybrid) | MEDIUM   | POC converts 2 agents first to validate syntax works                                |
| LLM quality consistency unknown                                     | HIGH     | Three-tier validation (schema, safety, factual) + blind quality testing in POC      |
| Setup wizard UX untested                                            | MEDIUM   | POC builds minimal 3-step wizard for user feedback before 6-step version            |
| Performance at scale unknown (10k+ files)                           | LOW      | Progressive degradation strategy + performance testing in Phase 4                   |

### Edge Cases to Handle

- [ ] Unknown project type detected → Handled in Batch 3A (fallback to core agent set)
- [ ] LLM API failures → Handled in Batch 2B (retry + fallback to generic content)
- [ ] Workspace too large (>10k files) → Handled in Batch 5 (timeout protection + partial success)
- [ ] User cancellation mid-generation → Handled in Batch 6 (save progress, atomic rollback)
- [ ] Template versioning conflicts → Deferred to post-MVP (MigrationService placeholder)

---

## 📊 Dependency Graph & Parallelization Strategy

```
FOUNDATION (Sequential)
    Batch 0: Library Scaffolding + Type System
        ↓
    ┌───────────────────┴───────────────────┐
    ↓                                       ↓
PARALLEL TRACK A                      PARALLEL TRACK B
(Backend Services)                    (Frontend Components)
    ↓                                       ↓
Batch 1: Core Services                Batch 2A: Template Assets
    ↓                                       ↓
    ├─────┬─────┬─────┬─────┐         Batch 2B: Frontend Setup
    ↓     ↓     ↓     ↓     ↓               ↓
Batch 3A  3B   3C   3D   3E         Batch 2C: Wizard Components (1-3)
(5 parallel service batches)              ↓
    ↓     ↓     ↓     ↓     ↓         Batch 2D: Wizard Components (4-6)
    └─────┴─────┴─────┴─────┘
             ↓
INTEGRATION (Sequential)
    Batch 4: Backend Integration
        ↓
    Batch 5: Frontend-Backend Wiring
        ↓
    Batch 6: End-to-End Testing
        ↓
QUALITY GATES (Sequential)
    Batch 7: POC Validation
        ↓
    [USER DECISION GATE: Continue to Phase 1?]
        ↓
    Batch 8: Template Library Conversion (Phase 1)
        ↓
    Batch 9: LLM Enhancement (Phase 2)
        ↓
    Batch 10: Full Wizard (Phase 3)
        ↓
    Batch 11: Production Hardening (Phase 4)
```

**Key Parallelization Points**:

- Batches 3A-3E can run 100% in parallel (independent services)
- Batches 2A-2D can run in parallel with backend services
- Total parallel execution saves ~4-6 weeks vs sequential approach

---

## Batch 0: Library Scaffolding & Type System ⏸️ PENDING

**Type**: FOUNDATION (Sequential - Blocks Everything)
**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: None
**Can Run In Parallel With**: NOTHING (foundation must complete first)
**Estimated Complexity**: Medium (2-3 days)

### Task 0.1: Create agent-generation library structure ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\
**Spec Reference**: implementation-plan.md:148-275 (Architecture Design)
**Pattern to Follow**: libs/backend/workspace-intelligence/ (library structure)

**Quality Requirements**:

- Nx library with esbuild bundler (CommonJS format)
- Proper tsconfig.json with path mapping
- project.json with build/test/lint targets
- index.ts barrel export file

**Implementation Details**:

```bash
npx nx g @nx/node:library agent-generation \
  --directory=libs/backend/agent-generation \
  --bundler=esbuild \
  --publishable=true \
  --importPath=@ptah-extension/agent-generation
```

**Validation**:

- Library builds successfully: `npx nx build agent-generation`
- Path alias resolves: `@ptah-extension/agent-generation`

---

### Task 0.2: Define core type system ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts
**Dependencies**: Task 0.1
**Spec Reference**: implementation-plan.md:1027-1106 (Data Models)

**Quality Requirements**:

- All types exported from `@ptah-extension/shared` types
- Use branded types for IDs (AgentTemplateId, GenerationSessionId)
- Comprehensive JSDoc comments
- No circular dependencies

**Implementation Details**:

- **AgentTemplate** interface (template definition with metadata)
- **ApplicabilityRules** interface (selection criteria)
- **ProjectContext** interface (workspace analysis results)
- **GeneratedAgent** interface (output artifact)
- **GenerationOptions** interface (user preferences)
- **GenerationSummary** interface (result summary)
- **ValidationResult** interface (LLM output validation)

**Pattern**:

```typescript
// Import foundation types
import { ProjectType, MonorepoType } from '@ptah-extension/shared';
import { SemanticVersion } from '@ptah-extension/shared';

export interface AgentTemplate {
  id: string;
  name: string;
  version: SemanticVersion;
  content: string;
  applicabilityRules: ApplicabilityRules;
  variables: VariableDefinition[];
  llmSections: LLMSectionDefinition[];
}
```

---

### Task 0.3: Define DI tokens ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\tokens.ts
**Dependencies**: Task 0.2
**Spec Reference**: implementation-plan.md:279-500 (Component Specifications)
**Pattern to Follow**: libs/backend/vscode-core/src/lib/di/tokens.ts

**Quality Requirements**:

- All tokens follow naming convention: `AGENT_GENERATION_*`
- Tokens grouped by service category
- Export as const object
- TypeScript const assertions

**Implementation Details**:

```typescript
export const AGENT_GENERATION_TOKENS = {
  // Core Services
  SETUP_WIZARD: Symbol.for('AgentGeneration.SetupWizardService'),
  ORCHESTRATOR: Symbol.for('AgentGeneration.OrchestratorService'),

  // Selection & Analysis
  AGENT_SELECTOR: Symbol.for('AgentGeneration.AgentSelectionService'),

  // Template Management
  TEMPLATE_STORAGE: Symbol.for('AgentGeneration.TemplateStorageService'),
  TEMPLATE_RENDERER: Symbol.for('AgentGeneration.TemplateRendererService'),

  // LLM Integration
  VSCODE_LM_SERVICE: Symbol.for('AgentGeneration.VsCodeLmService'),
  OUTPUT_VALIDATION: Symbol.for('AgentGeneration.OutputValidationService'),

  // File Operations
  AGENT_FILE_WRITER: Symbol.for('AgentGeneration.FileWriterService'),
} as const;
```

---

### Task 0.4: Create service registration module ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\registration.ts
**Dependencies**: Task 0.3
**Spec Reference**: implementation-plan.md:2220-2290 (DI Registration)
**Pattern to Follow**: libs/backend/workspace-intelligence/src/lib/registration.ts

**Quality Requirements**:

- Single `registerAgentGenerationServices()` function
- All services registered as singletons
- Services registered in dependency order
- Import and re-export in main registration.ts

**Implementation Details**:

```typescript
import { container } from 'tsyringe';
import { AGENT_GENERATION_TOKENS } from './tokens';

export function registerAgentGenerationServices(): void {
  // Foundation services (no dependencies)
  container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE, {
    useClass: TemplateStorageService,
  });

  // Services with dependencies
  container.register(AGENT_GENERATION_TOKENS.AGENT_SELECTOR, {
    useClass: AgentSelectionService,
  });

  // ... (continue for all services)
}
```

---

### Task 0.5: Define wizard RPC message types ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts
**Dependencies**: Task 0.2
**Spec Reference**: implementation-plan.md:2383-2476 (RPC API Contracts)

**Quality Requirements**:

- Extend existing RPC message types
- Type-safe message payloads
- Discriminated unions for message types
- Comprehensive JSDoc

**Implementation Details**:
Add to existing RPC types:

```typescript
// Wizard step messages
export interface StartSetupWizardMessage {
  type: 'start-setup-wizard';
  workspaceUri: string;
}

export interface WorkspaceScanProgressMessage {
  type: 'workspace-scan-progress';
  filesScanned: number;
  totalFiles: number;
  detectedCharacteristics: string[];
}

export interface AgentSelectionMessage {
  type: 'agent-selection';
  selectedAgents: AgentSelection[];
}

// ... (complete message set)
```

---

### Task 0.6: Create validation utilities ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\utils\validation.utils.ts
**Dependencies**: Task 0.2
**Spec Reference**: implementation-plan.md:683-855 (Validation Framework)

**Quality Requirements**:

- Pure functions (no side effects)
- Comprehensive error messages
- Use Zod for schema validation
- Export validation schemas

**Implementation Details**:

```typescript
import { z } from 'zod';

// Template YAML frontmatter schema
export const TemplateFrontmatterSchema = z.object({
  templateId: z.string(),
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  applicabilityRules: z.object({
    projectTypes: z.array(z.enum(['Node', 'React', 'Angular', ...])),
    minimumRelevanceScore: z.number().min(0).max(100),
  }),
});

// Agent template content validation
export function validateTemplateContent(content: string): Result<void, Error> {
  // Check for required sections
  // Validate syntax ({{VAR}}, <!-- STATIC -->, etc.)
  // Ensure no malicious patterns
}
```

---

### Task 0.7: Update main library barrel export ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts
**Dependencies**: Tasks 0.1-0.6
**Spec Reference**: implementation-plan.md:2290-2320 (Public API)

**Quality Requirements**:

- Export only public API (services, types, tokens)
- No internal implementation details
- Clear JSDoc for exported items
- Consistent naming conventions

**Implementation Details**:

```typescript
// Services
export { SetupWizardService } from './lib/services/setup-wizard.service';
export { AgentGenerationOrchestratorService } from './lib/services/orchestrator.service';

// Types
export * from './lib/types/core.types';
export * from './lib/types/wizard.types';

// Tokens
export { AGENT_GENERATION_TOKENS } from './lib/tokens';

// Registration
export { registerAgentGenerationServices } from './lib/registration';
```

---

**Batch 0 Verification Checklist**:

- [ ] Library builds without errors: `npx nx build agent-generation`
- [ ] All types exported correctly (no TypeScript errors)
- [ ] DI tokens registered in vscode-core
- [ ] RPC message types compile
- [ ] Unit tests pass (if any initial tests)

---

## PARALLEL TRACK A: Backend Services

---

## Batch 1: Core Infrastructure Services ⏸️ PENDING

**Type**: BACKEND (Sequential - Foundation for other services)
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 0
**Can Run In Parallel With**: Batch 2A, 2B (frontend work)
**Estimated Complexity**: Medium (3-4 days)

### Task 1.1: Implement TemplateStorageService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\template-storage.service.ts
**Dependencies**: Batch 0
**Spec Reference**: implementation-plan.md:857-1023 (Component 4)
**Pattern to Follow**: workspace-intelligence FileIndexerService (file loading patterns)

**Quality Requirements**:

- Load templates from bundled assets (`extension/templates/agents/*.template.md`)
- Parse YAML frontmatter with `gray-matter`
- Cache loaded templates (in-memory)
- Validate template syntax on load
- Return Result<T, E> for all operations

**Implementation Details**:

```typescript
@injectable()
export class TemplateStorageService {
  private templateCache = new Map<string, AgentTemplate>();

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  async loadTemplate(templateId: string): Promise<Result<AgentTemplate, Error>> {
    // Check cache first
    // Load from disk if not cached
    // Parse YAML frontmatter
    // Validate template syntax
    // Cache and return
  }

  async listTemplates(filter?: TemplateFilter): Promise<AgentTemplate[]> {
    // Load all templates from assets directory
    // Apply filters (projectType, alwaysInclude, etc.)
  }
}
```

**Validation Notes**:

- Edge case: Template file not found → Return Result.err with clear message
- Edge case: Invalid YAML → Fail fast with validation error
- Risk: Template syntax errors → Use validation.utils.ts to catch

---

### Task 1.2: Implement AgentFileWriterService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\file-writer.service.ts
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md:1257-1410 (Component 7)

**Quality Requirements**:

- Atomic file writes (all succeed or all rollback)
- Backup existing `.claude/` folder before writing
- Validate file paths (prevent writes outside `.claude/`)
- Handle permission errors gracefully
- Transaction-style rollback on failure

**Implementation Details**:

```typescript
@injectable()
export class AgentFileWriterService {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  async writeAgentsAtomic(agents: GeneratedAgent[], workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    const backupPath = await this.backupExisting(workspaceUri);

    try {
      for (const agent of agents) {
        await this.writeAgentFile(agent, workspaceUri);
      }
      return Result.ok(undefined);
    } catch (error) {
      await this.rollback(backupPath, workspaceUri);
      return Result.err(error as Error);
    }
  }

  private async backupExisting(workspaceUri: vscode.Uri): Promise<string> {
    // Copy .claude/ to .claude.backup-{timestamp}/
  }

  private async rollback(backupPath: string, workspaceUri: vscode.Uri): Promise<void> {
    // Restore from backup, delete partial writes
  }
}
```

**Validation Notes**:

- Edge case: Permission denied → Offer alternative location (user home directory)
- Edge case: Disk full → Detect early with fs.statfs, fail gracefully
- Risk: Partial write failure → Rollback mechanism CRITICAL

---

### Task 1.3: Implement OutputValidationService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\output-validation.service.ts
**Dependencies**: Batch 0
**Spec Reference**: implementation-plan.md:1173-1256 (Component 6)
**Pattern to Follow**: research-report.md:466-490 (Validation Framework)

**Quality Requirements**:

- Three-tier validation: Schema, Safety, Factual Accuracy
- Configurable validation thresholds
- Return validation score (0-100)
- Detailed issue reporting
- No false negatives (better to reject valid than accept invalid)

**Implementation Details**:

```typescript
@injectable()
export class OutputValidationService {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  validateOutput(content: string, rules: ValidationRules, projectContext: ProjectContext): Result<ValidationResult, Error> {
    const schemaResult = this.validateSchema(content, rules);
    if (!schemaResult.isValid) {
      return Result.ok({ isValid: false, score: 0, issues: schemaResult.issues });
    }

    const safetyResult = this.validateSafety(content);
    const factualResult = this.validateFactualAccuracy(content, projectContext);

    // Combine results, calculate score
  }

  private validateSchema(content: string, rules: ValidationRules): ValidationResult {
    // Check: Markdown structure, length constraints, required elements
  }

  private validateSafety(content: string): ValidationResult {
    // Check: No malicious code, no credentials, no external URLs
  }

  private validateFactualAccuracy(content: string, projectContext: ProjectContext): ValidationResult {
    // Check: File references exist, framework versions match
  }
}
```

**Validation Notes**:

- Edge case: Borderline quality (score 40-60) → Use conservative threshold (50+)
- Risk: False positives (rejecting good content) → Tune thresholds in POC phase

---

### Task 1.4: Implement AgentTemplateRenderer ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\template-renderer.service.ts
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md:1024-1172 (Component 5)
**Pattern to Follow**: libs/backend/template-generation (existing renderer)

**Quality Requirements**:

- Variable substitution: `{{VAR_NAME}}` → actual values
- Preserve STATIC sections unchanged
- Inject LLM-customized sections
- Handle conditionals: `{{#if CONDITION}}...{{/if}}`
- Assemble final markdown with YAML frontmatter

**Implementation Details**:

```typescript
@injectable()
export class AgentTemplateRenderer {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE)
    private templateStorage: TemplateStorageService,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  async renderAgent(template: AgentTemplate, variables: Record<string, any>, llmCustomizations: Map<string, string>): Promise<Result<GeneratedAgent, Error>> {
    let content = template.content;

    // Step 1: Substitute variables
    content = this.substituteVariables(content, variables);

    // Step 2: Inject LLM sections
    content = this.injectLLMSections(content, llmCustomizations);

    // Step 3: Process conditionals
    content = this.processConditionals(content, variables);

    // Step 4: Assemble with frontmatter
    const finalContent = this.assembleFinalAgent(template, content, variables);

    return Result.ok({
      id: template.id,
      content: finalContent,
      sourceTemplate: template.id,
      // ... (complete GeneratedAgent object)
    });
  }
}
```

---

**Batch 1 Verification Checklist**:

- [ ] TemplateStorageService loads templates from disk
- [ ] FileWriterService atomic write/rollback tested
- [ ] OutputValidationService detects invalid content
- [ ] TemplateRenderer produces valid markdown
- [ ] All services pass unit tests

---

## Batch 2A: Template Assets Creation ⏸️ PENDING

**Type**: CONTENT (Can run parallel with backend)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 0
**Can Run In Parallel With**: Batch 1, 2B, 2C
**Estimated Complexity**: Medium (2-3 days)

### Task 2A.1: Convert backend-developer to template ⏸️ PENDING

**File**: D:\projects\ptah-extension\extension\templates\agents\backend-developer.template.md
**Dependencies**: Batch 0 (type system defines template syntax)
**Spec Reference**: research-report.md:128-232 (Template Example 1)

**Quality Requirements**:

- Follow hybrid syntax: HTML comments for sections, Handlebars for variables
- Preserve all existing content from `.claude/agents/backend-developer.md`
- Mark STATIC sections that never change
- Mark LLM sections for customization
- Define YAML frontmatter with applicability rules

**Implementation Details**:

```markdown
---
templateId: backend-developer-v2
templateVersion: 2.0.0
applicabilityRules:
  projectTypes: [Node, Python, Java, Go, DotNet, PHP, Ruby]
  requiredPatterns: ['**/controllers/**', '**/services/**', '**/models/**']
  excludePatterns: ['**/components/**', '**/views/**']
  minimumRelevanceScore: 60
dependencies: []
---

---

name: backend-developer
description: Backend Developer focused on {{PROJECT_TYPE}} with {{FRAMEWORK_NAME}}
generated: true
sourceTemplate: backend-developer-v2
sourceTemplateVersion: 2.0.0
generatedAt: {{TIMESTAMP}}
projectType: {{PROJECT_TYPE}}
techStack: {{TECH_STACK}}

---

# Backend Developer Agent - {{PROJECT_TYPE}} Edition

<!-- STATIC:FILE_PATH_WARNING -->

## **IMPORTANT**: Use absolute Windows paths with drive letters

<!-- /STATIC:FILE_PATH_WARNING -->

<!-- STATIC:CORE_PRINCIPLES -->

## CORE PRINCIPLES FOUNDATION

[Full SOLID section - never changes]

<!-- /STATIC:CORE_PRINCIPLES -->

<!-- LLM:FRAMEWORK_SPECIFICS -->

## {{FRAMEWORK_NAME}} Best Practices

{{GENERATED_CONTENT}}

<!-- /LLM:FRAMEWORK_SPECIFICS -->
```

**Validation Notes**:

- Edge case: Existing agent has complex nested sections → Simplify into flat LLM sections
- Risk: Losing important content during conversion → Manual review after conversion

---

### Task 2A.2: Convert orchestrate command to template ⏸️ PENDING

**File**: D:\projects\ptah-extension\extension\templates\commands\orchestrate.template.md
**Dependencies**: Batch 0
**Spec Reference**: research-report.md:234-280 (Template Example 2)

**Quality Requirements**:

- Command-specific template format (different from agents)
- Preserve all orchestration logic (STATIC)
- Add project-specific paths (VARIABLE)
- Add project-specific strategies (LLM)

**Implementation Details**:

```markdown
---
templateId: orchestrate-command-v1
templateVersion: 1.0.0
applicabilityRules:
  projectTypes: [ALL]
  minimumRelevanceScore: 100
  alwaysInclude: true
---

---

name: orchestrate
description: Multi-phase development workflow for {{PROJECT_TYPE}} projects

---

# Orchestrate Development Workflow

<!-- STATIC:CORE_ORCHESTRATION -->

Multi-phase workflow with dynamic strategies...
[All existing orchestration logic]

<!-- /STATIC:CORE_ORCHESTRATION -->

<!-- VAR:PROJECT_PATHS -->

## Project Configuration

- **Task Tracking**: {{TASK_TRACKING_DIR}}
- **Branch Prefix**: {{BRANCH_PREFIX}}
<!-- /VAR:PROJECT_PATHS -->

<!-- LLM:PROJECT_STRATEGIES -->

## Project-Specific Strategies

{{GENERATED_STRATEGIES}}

<!-- /LLM:PROJECT_STRATEGIES -->
```

---

**Batch 2A Verification Checklist**:

- [ ] Both templates parse with YAML validator
- [ ] Templates follow syntax specification
- [ ] TemplateStorageService loads templates successfully
- [ ] No loss of critical content vs original agents

---

## Batch 2B: Frontend Setup (Build Config) ⏸️ PENDING

**Type**: FRONTEND INFRASTRUCTURE
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 0 (RPC types)
**Can Run In Parallel With**: Batch 1, 2A, 2C
**Estimated Complexity**: Low (1-2 days)

### Task 2B.1: Create setup-wizard Angular library ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\
**Dependencies**: Batch 0 (RPC types)
**Spec Reference**: implementation-plan.md:169-272 (Architecture Diagram)
**Pattern to Follow**: libs/frontend/chat/ (Angular library structure)

**Quality Requirements**:

- Standalone Angular library (no NgModule)
- Signal-based state management (no RxJS)
- Zoneless change detection
- Lazy-loadable components

**Implementation Details**:

```bash
npx nx g @nx/angular:library setup-wizard \
  --directory=libs/frontend/setup-wizard \
  --standalone=true \
  --style=scss \
  --changeDetection=OnPush
```

---

### Task 2B.2: Create setup wizard state service ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts
**Dependencies**: Task 2B.1
**Spec Reference**: implementation-plan.md:2476-2583 (Frontend State)

**Quality Requirements**:

- Signal-based state (WritableSignal, computed)
- Immutable state updates
- Type-safe wizard step tracking
- Progress calculation logic

**Implementation Details**:

```typescript
@Injectable({ providedIn: 'root' })
export class SetupWizardStateService {
  // State signals
  currentStep = signal<WizardStep>('welcome');
  projectContext = signal<ProjectContext | null>(null);
  selectedAgents = signal<AgentSelection[]>([]);
  generationProgress = signal<GenerationProgress | null>(null);

  // Computed signals
  canProceed = computed(() => {
    // Logic: Can user proceed to next step?
  });

  percentComplete = computed(() => {
    // Logic: Overall wizard completion %
  });

  // State mutations
  setCurrentStep(step: WizardStep): void {
    this.currentStep.set(step);
  }
}
```

---

### Task 2B.3: Create wizard RPC service ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts
**Dependencies**: Task 2B.1
**Spec Reference**: implementation-plan.md:2383-2476 (RPC Contracts)
**Pattern to Follow**: libs/frontend/core VSCodeService (RPC communication)

**Quality Requirements**:

- Type-safe RPC message sending
- Response promise handling
- Error handling for RPC failures
- Timeout protection (30s default)

**Implementation Details**:

```typescript
@Injectable({ providedIn: 'root' })
export class WizardRpcService {
  constructor(private vscodeService: VSCodeService) {}

  startSetupWizard(): Promise<void> {
    return this.vscodeService.sendMessage<void>({
      type: 'start-setup-wizard',
      workspaceUri: workspace.uri,
    });
  }

  submitAgentSelection(selections: AgentSelection[]): Promise<void> {
    return this.vscodeService.sendMessage<void>({
      type: 'agent-selection',
      selectedAgents: selections,
    });
  }
}
```

---

**Batch 2B Verification Checklist**:

- [ ] setup-wizard library builds
- [ ] State service compiles with signals
- [ ] RPC service integrates with VSCodeService
- [ ] No circular dependencies

---

## Batch 2C: Wizard Components (Steps 1-3) ⏸️ PENDING

**Type**: FRONTEND COMPONENTS
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2B
**Can Run In Parallel With**: Batch 1, 2A, 2D
**Estimated Complexity**: Medium (3-4 days)

### Task 2C.1: Build WelcomeComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts
**Dependencies**: Batch 2B
**Spec Reference**: research-report.md:632-637 (Step 1: Welcome Screen)

**Quality Requirements**:

- Standalone component
- DaisyUI styling
- Clear headline and explanation
- "Start Setup" button triggers RPC

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  template: `
    <div class="hero min-h-screen">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <h1 class="text-5xl font-bold">Let's Personalize Your Ptah Experience</h1>
          <p class="py-6">Ptah will analyze your project and generate AI agents tailored to your tech stack.</p>
          <p class="text-sm text-base-content/70">Estimated time: 2-4 minutes</p>
          <button class="btn btn-primary mt-6" (click)="startSetup()">Start Setup</button>
        </div>
      </div>
    </div>
  `,
})
export class WelcomeComponent {
  constructor(private wizardRpc: WizardRpcService, private wizardState: SetupWizardStateService) {}

  startSetup(): void {
    this.wizardRpc.startSetupWizard();
    this.wizardState.setCurrentStep('scan');
  }
}
```

---

### Task 2C.2: Build ScanProgressComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
**Dependencies**: Batch 2B
**Spec Reference**: research-report.md:639-644 (Step 2: Workspace Scan)

**Quality Requirements**:

- Real-time progress updates from RPC messages
- File count display (X / Y analyzed)
- Live detection updates ("Detected Angular 20...")
- Cancel button with confirmation

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-scan-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto p-8">
      <h2 class="text-3xl font-bold mb-6">Scanning Your Workspace</h2>

      <progress class="progress progress-primary w-full" [value]="scanProgress().filesScanned" [max]="scanProgress().totalFiles"></progress>

      <p class="mt-4">Analyzing {{ scanProgress().filesScanned }} of {{ scanProgress().totalFiles }} files...</p>

      <div class="mt-6 space-y-2">
        @for (detection of scanProgress().detections; track detection) {
        <div class="alert alert-info">{{ detection }}</div>
        }
      </div>

      <button class="btn btn-ghost mt-8" (click)="cancelScan()">Cancel Setup</button>
    </div>
  `,
})
export class ScanProgressComponent {
  scanProgress = computed(() => this.wizardState.generationProgress());

  constructor(private wizardState: SetupWizardStateService) {}

  cancelScan(): void {
    if (confirm('Cancel setup? Progress will be saved for later.')) {
      // Emit cancel event
    }
  }
}
```

---

### Task 2C.3: Build AnalysisResultsComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts
**Dependencies**: Batch 2B
**Spec Reference**: research-report.md:646-651 (Step 3: Analysis Results)

**Quality Requirements**:

- Display detected project characteristics
- User confirmation: "Does this look correct?"
- Manual adjustment link (future enhancement)
- Proceed to agent selection

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-analysis-results',
  standalone: true,
  template: `
    <div class="container mx-auto p-8">
      <h2 class="text-3xl font-bold mb-6">Analysis Results</h2>

      <div class="card bg-base-200 shadow-xl mb-6">
        <div class="card-body">
          <h3 class="card-title">Detected Characteristics</h3>
          <ul class="list-disc list-inside space-y-2">
            <li><strong>Project Type:</strong> {{ projectContext().type }}</li>
            <li><strong>Tech Stack:</strong> {{ projectContext().techStack.join(', ') }}</li>
            <li><strong>Architecture:</strong> {{ projectContext().architecture }}</li>
            @if (projectContext().isMonorepo) {
            <li><strong>Monorepo:</strong> {{ projectContext().monorepoType }} ({{ projectContext().packageCount }} packages)</li>
            }
          </ul>
        </div>
      </div>

      <div class="alert alert-warning mb-6">
        <span>Does this look correct?</span>
      </div>

      <div class="flex gap-4">
        <button class="btn btn-primary" (click)="proceed()">Yes, Continue</button>
        <button class="btn btn-ghost" (click)="adjust()">No, Let Me Adjust</button>
      </div>
    </div>
  `,
})
export class AnalysisResultsComponent {
  projectContext = computed(() => this.wizardState.projectContext());

  constructor(private wizardState: SetupWizardStateService) {}

  proceed(): void {
    this.wizardState.setCurrentStep('selection');
  }

  adjust(): void {
    // Future: Manual adjustment modal
    alert('Manual adjustment coming in Phase 3');
  }
}
```

---

**Batch 2C Verification Checklist**:

- [ ] All 3 components render correctly
- [ ] Progress updates work (mock data)
- [ ] State transitions work
- [ ] DaisyUI styling applied

---

## Batch 2D: Wizard Components (Steps 4-6) ⏸️ PENDING

**Type**: FRONTEND COMPONENTS
**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2C
**Can Run In Parallel With**: Batch 1, 3A-3E
**Estimated Complexity**: Medium (3-4 days)

### Task 2D.1: Build AgentSelectionComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
**Dependencies**: Batch 2C
**Spec Reference**: research-report.md:653-663 (Step 4: Agent Selection)

**Quality Requirements**:

- Table with checkboxes for each agent
- Display relevance score and reason
- User can check/uncheck agents
- Total count display
- Generate button triggers RPC

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-agent-selection',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container mx-auto p-8">
      <h2 class="text-3xl font-bold mb-6">Select Agents to Generate</h2>

      <div class="overflow-x-auto">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th></th>
              <th>Agent</th>
              <th>Relevance</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            @for (agent of availableAgents(); track agent.id) {
            <tr>
              <td>
                <input type="checkbox" class="checkbox checkbox-primary" [checked]="agent.selected" (change)="toggleAgent(agent.id)" />
              </td>
              <td>{{ agent.name }}</td>
              <td>
                <div class="badge" [class.badge-success]="agent.score >= 80">{{ agent.score }}%</div>
              </td>
              <td class="text-sm">{{ agent.reason }}</td>
            </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex justify-between items-center">
        <p>Total: {{ selectedCount() }} agents selected</p>
        <button class="btn btn-primary" (click)="generateAgents()">Generate Agents</button>
      </div>
    </div>
  `,
})
export class AgentSelectionComponent {
  availableAgents = computed(() => this.wizardState.availableAgents());
  selectedCount = computed(() => this.availableAgents().filter((a) => a.selected).length);

  constructor(private wizardState: SetupWizardStateService, private wizardRpc: WizardRpcService) {}

  toggleAgent(agentId: string): void {
    // Update selection state
  }

  generateAgents(): void {
    const selected = this.availableAgents().filter((a) => a.selected);
    this.wizardRpc.submitAgentSelection(selected);
    this.wizardState.setCurrentStep('generation');
  }
}
```

---

### Task 2D.2: Build GenerationProgressComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts
**Dependencies**: Batch 2C
**Spec Reference**: research-report.md:665-672 (Step 5: Generation Progress)

**Quality Requirements**:

- Per-agent progress display
- Live customization preview
- No cancel once started (atomic operation)
- Real-time updates via RPC

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-generation-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto p-8">
      <h2 class="text-3xl font-bold mb-6">Generating Your Agents</h2>

      <div class="space-y-4">
        @for (agent of agentProgress(); track agent.id) {
        <div class="card bg-base-200">
          <div class="card-body">
            <div class="flex justify-between items-center">
              <h3 class="font-bold">{{ agent.name }}</h3>
              @if (agent.status === 'complete') {
              <span class="badge badge-success">✓ Complete</span>
              } @else if (agent.status === 'in-progress') {
              <span class="loading loading-spinner loading-sm"></span>
              } @else {
              <span class="badge badge-ghost">Pending</span>
              }
            </div>

            @if (agent.status === 'complete') {
            <p class="text-sm text-base-content/70">Generated in {{ agent.duration }}s - {{ agent.customizationSummary }}</p>
            } @else if (agent.status === 'in-progress') {
            <p class="text-sm text-base-content/70">
              {{ agent.currentTask }}
            </p>
            }
          </div>
        </div>
        }
      </div>

      <progress class="progress progress-primary w-full mt-6" [value]="overallProgress()" max="100"></progress>
    </div>
  `,
})
export class GenerationProgressComponent {
  agentProgress = computed(() => this.wizardState.generationProgress().agents);
  overallProgress = computed(() => this.wizardState.percentComplete());

  constructor(private wizardState: SetupWizardStateService) {}
}
```

---

### Task 2D.3: Build CompletionComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts
**Dependencies**: Batch 2C
**Spec Reference**: research-report.md:674-687 (Step 6: Completion)

**Quality Requirements**:

- Success message with summary
- Preview of `.claude/` folder structure
- Action buttons: Start Chatting, View Agents, Close
- Tip about `/orchestrate` command

**Implementation Details**:

```typescript
@Component({
  selector: 'ptah-completion',
  standalone: true,
  template: `
    <div class="container mx-auto p-8">
      <div class="hero">
        <div class="hero-content text-center">
          <div class="max-w-md">
            <h1 class="text-5xl font-bold">🎉 Your Agents Are Ready!</h1>

            <div class="stats shadow mt-8">
              <div class="stat">
                <div class="stat-title">Agents Generated</div>
                <div class="stat-value">{{ summary().agentCount }}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Commands</div>
                <div class="stat-value">{{ summary().commandCount }}</div>
              </div>
            </div>

            <div class="card bg-base-200 mt-6">
              <div class="card-body">
                <h3 class="font-bold">Generated Files</h3>
                <div class="text-left text-sm">
                  <code>.claude/agents/</code>
                  <ul class="list-disc list-inside ml-4">
                    @for (agent of summary().agents; track agent) {
                    <li>{{ agent }}.md</li>
                    }
                  </ul>
                </div>
              </div>
            </div>

            <div class="alert alert-info mt-6">
              <span>💡 Try <code>/orchestrate</code> to start your first task with agent assistance</span>
            </div>

            <div class="flex gap-4 mt-8 justify-center">
              <button class="btn btn-primary" (click)="startChatting()">Start Chatting</button>
              <button class="btn btn-ghost" (click)="viewAgents()">View Agents</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  summary = computed(() => this.wizardState.generationSummary());

  constructor(private wizardState: SetupWizardStateService, private wizardRpc: WizardRpcService) {}

  startChatting(): void {
    // Close wizard, open chat
  }

  viewAgents(): void {
    // Open .claude/agents/ folder in VS Code
  }
}
```

---

**Batch 2D Verification Checklist**:

- [ ] All 3 components render correctly
- [ ] Agent selection/deselection works
- [ ] Progress updates display correctly
- [ ] Completion summary shows correctly

---

## PARALLEL TRACK A: Advanced Backend Services (5 batches can run 100% in parallel)

---

## Batch 3A: Agent Selection Service ⏸️ PENDING

**Type**: BACKEND SERVICE (Can run parallel with 3B-3E)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Can Run In Parallel With**: Batch 3B, 3C, 3D, 3E (ALL 5 parallel)
**Estimated Complexity**: Medium (2-3 days)

### Task 3A.1: Implement AgentSelectionService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-selection.service.ts
**Dependencies**: Batch 1 (TemplateStorageService)
**Spec Reference**: implementation-plan.md:477-682 (Component 3)
**Pattern to Follow**: workspace-intelligence FileRelevanceScorerService

**Quality Requirements**:

- Relevance scoring algorithm (0-100 scale)
- Configurable threshold (default: 50)
- User override support
- Detailed reasoning logged for audit
- Edge case handling (unknown project, no matches)

**Implementation Details**:

```typescript
@injectable()
export class AgentSelectionService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE)
    private templateStorage: TemplateStorageService,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  async scoreAgents(projectContext: ProjectContext): Promise<Map<string, AgentRelevanceScore>> {
    const templates = await this.templateStorage.listTemplates();
    const scores = new Map<string, AgentRelevanceScore>();

    for (const template of templates) {
      const score = this.scoreAgentRelevance(template, projectContext);
      scores.set(template.id, score);
    }

    return scores;
  }

  private scoreAgentRelevance(template: AgentTemplate, projectContext: ProjectContext): AgentRelevanceScore {
    let score = 0;
    const reasons: string[] = [];

    // Base score: Project type match (0-40 points)
    if (template.applicabilityRules.projectTypes.includes(projectContext.type)) {
      score += 40;
      reasons.push(`Matches project type: ${projectContext.type}`);
    }

    // Tech stack match (0-30 points)
    const techMatches = template.applicabilityRules.techStack?.filter((tech) => projectContext.techStack.includes(tech)) ?? [];
    score += Math.min(30, techMatches.length * 10);
    if (techMatches.length > 0) {
      reasons.push(`Tech stack match: ${techMatches.join(', ')}`);
    }

    // File pattern match (0-20 points)
    const patternMatches = this.countPatternMatches(template.applicabilityRules.requiredPatterns, projectContext.fileIndex);
    score += Math.min(20, patternMatches * 5);

    // Exclusion penalty (-50 points)
    const exclusionMatches = this.countPatternMatches(template.applicabilityRules.excludePatterns ?? [], projectContext.fileIndex);
    if (exclusionMatches > 0) {
      score -= 50;
      reasons.push(`Exclusion patterns found: ${exclusionMatches}`);
    }

    // Auto-include override
    if (template.applicabilityRules.alwaysInclude) {
      score = 100;
      reasons.push('Always included (core agent)');
    }

    return {
      agentId: template.id,
      score: Math.max(0, Math.min(100, score)),
      reasons,
      autoInclude: template.applicabilityRules.alwaysInclude ?? false,
    };
  }

  selectAgents(scores: Map<string, AgentRelevanceScore>, threshold: number = 50, userOverrides?: AgentSelection[]): string[] {
    // Apply threshold + user overrides
  }
}
```

**Validation Notes**:

- Edge case: Unknown project type → Fallback to core agent set (orchestrate, team-leader, backend-developer)
- Edge case: All agents score below threshold → Include top 3 agents by score
- Risk: Exclusion too aggressive → Tune exclusion penalty in POC testing

---

### Task 3A.2: Write AgentSelectionService unit tests ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-selection.service.spec.ts
**Dependencies**: Task 3A.1
**Spec Reference**: implementation-plan.md:1996-2162 (Testing Strategy)

**Quality Requirements**:

- Test all scoring rules (project type, tech stack, patterns, exclusions)
- Test edge cases (unknown project, empty file index, no matches)
- Test user overrides
- Mock dependencies (TemplateStorageService)

**Implementation Details**:

```typescript
describe('AgentSelectionService', () => {
  let service: AgentSelectionService;
  let mockTemplateStorage: jest.Mocked<TemplateStorageService>;

  beforeEach(() => {
    mockTemplateStorage = createMock<TemplateStorageService>();
    service = new AgentSelectionService(mockTemplateStorage, mockLogger);
  });

  describe('scoreAgentRelevance', () => {
    it('should score 100 for always-include agents', () => {
      const template = createMockTemplate({ alwaysInclude: true });
      const projectContext = createMockProjectContext();

      const score = service['scoreAgentRelevance'](template, projectContext);

      expect(score.score).toBe(100);
      expect(score.reasons).toContain('Always included (core agent)');
    });

    it('should apply exclusion penalty for UI agents in backend project', () => {
      const template = createMockTemplate({
        excludePatterns: ['**/components/**', '**/views/**'],
      });
      const projectContext = createMockProjectContext({
        type: ProjectType.Node,
        fileIndex: ['src/controllers/user.ts', 'src/services/auth.ts'],
      });

      const score = service['scoreAgentRelevance'](template, projectContext);

      expect(score.score).toBeLessThan(50); // Below threshold
    });
  });
});
```

---

**Batch 3A Verification Checklist**:

- [ ] AgentSelectionService compiles and runs
- [ ] Unit tests pass (>80% coverage)
- [ ] Scoring algorithm produces expected results for test cases
- [ ] Logging provides clear reasoning for audit

---

## Batch 3B: VS Code LM Integration Service ⏸️ PENDING

**Type**: BACKEND SERVICE (Can run parallel with 3A, 3C-3E)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Can Run In Parallel With**: Batch 3A, 3C, 3D, 3E
**Estimated Complexity**: High (4-5 days) - NEW integration

### Task 3B.1: Implement VsCodeLmService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\vscode-lm.service.ts
**Dependencies**: Batch 1 (OutputValidationService)
**Spec Reference**: implementation-plan.md:1024-1172 (Component 5)
**Pattern to Follow**: research-report.md:299-376 (Prompt Library)

**Quality Requirements**:

- VS Code LM API integration (`vscode.lm.sendRequest()`)
- Retry logic with exponential backoff (3 attempts, 5s → 10s → 20s)
- Timeout protection (30s per request)
- Batch processing support (5 concurrent requests)
- Fallback to generic content on failure
- Comprehensive error logging

**Validation Notes**:

- Risk: VS Code LM API is NEW (no existing implementation) → POC validates integration
- Edge case: Rate limit hit → Queue requests, retry after cooldown
- Edge case: Invalid API response → Validation catches, uses fallback

**Implementation Details**:

```typescript
@injectable()
export class VsCodeLmService {
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 30000;
  private readonly BACKOFF_BASE = 5000; // 5s, 10s, 20s

  constructor(
    @inject(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION)
    private validation: OutputValidationService,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  async customizeSection(sectionTopic: string, projectContext: ProjectContext, fileSamples: string[]): Promise<Result<string, Error>> {
    const prompt = this.buildPrompt(sectionTopic, projectContext, fileSamples);

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await this.sendLmRequest(prompt);

        // Validate response
        const validationResult = this.validation.validateOutput(response, this.getValidationRules(sectionTopic), projectContext);

        if (validationResult.isOk() && validationResult.value!.isValid) {
          return Result.ok(response);
        } else {
          this.logger.warn(`Validation failed (attempt ${attempt})`, validationResult.value!.issues);

          if (attempt < this.MAX_RETRIES) {
            // Retry with simplified prompt
            continue;
          } else {
            // Max retries exhausted, use fallback
            return Result.ok(''); // Empty string triggers generic content fallback
          }
        }
      } catch (error) {
        this.logger.error(`LM request failed (attempt ${attempt})`, error);

        if (attempt < this.MAX_RETRIES) {
          const backoffMs = this.BACKOFF_BASE * Math.pow(2, attempt - 1);
          await this.delay(backoffMs);
        } else {
          return Result.err(error as Error);
        }
      }
    }

    return Result.ok(''); // Fallback
  }

  private async sendLmRequest(prompt: string): Promise<string> {
    const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
    if (models.length === 0) {
      throw new Error('No LM models available');
    }

    const model = models[0];
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];

    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let fullResponse = '';
    for await (const chunk of response.text) {
      fullResponse += chunk;
    }

    return fullResponse;
  }

  private buildPrompt(sectionTopic: string, projectContext: ProjectContext, fileSamples: string[]): string {
    // Use prompt templates from research-report.md:299-465
    return `You are an expert software development coach specializing in ${projectContext.frameworks[0]?.name}.

CONTEXT:
- Project Type: ${projectContext.type}
- Framework: ${projectContext.frameworks[0]?.name} ${projectContext.frameworks[0]?.version}
- Architecture: ${projectContext.architecture}

FILE SAMPLES:
${fileSamples.join('\n\n')}

TASK:
Generate best practice guidance for the "${sectionTopic}" section.

REQUIREMENTS:
1. Use concrete examples from the file samples
2. Reference actual patterns detected in this codebase
3. Be specific to the framework
4. Keep under 500 words
5. Use bullet points

OUTPUT FORMAT:
Return ONLY markdown content. No section headers.`;
  }

  async batchCustomize(sections: SectionRequest[], concurrency: number = 5): Promise<Map<string, Result<string, Error>>> {
    // Parallel processing with concurrency limit
    const results = new Map<string, Result<string, Error>>();

    // Use p-limit or similar for concurrency control
    const chunks = this.chunk(sections, concurrency);
    for (const chunk of chunks) {
      const promises = chunk.map((section) => this.customizeSection(section.topic, section.projectContext, section.fileSamples).then((result) => ({ id: section.id, result })));

      const chunkResults = await Promise.all(promises);
      for (const { id, result } of chunkResults) {
        results.set(id, result);
      }
    }

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

---

### Task 3B.2: Write VsCodeLmService integration tests ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\vscode-lm.service.spec.ts
**Dependencies**: Task 3B.1
**Spec Reference**: implementation-plan.md:2027-2044 (LLM Testing)

**Quality Requirements**:

- Mock VS Code LM API (`vscode.lm.sendRequest`)
- Test retry logic (fail 2x, succeed 3rd)
- Test timeout handling
- Test validation failure → retry → fallback
- Test batch processing concurrency

**Implementation Details**:

```typescript
describe('VsCodeLmService', () => {
  let service: VsCodeLmService;
  let mockValidation: jest.Mocked<OutputValidationService>;

  beforeEach(() => {
    mockValidation = createMock<OutputValidationService>();
    service = new VsCodeLmService(mockValidation, mockLogger);
  });

  describe('customizeSection with retry', () => {
    it('should retry failed requests with exponential backoff', async () => {
      // Mock vscode.lm.sendRequest to fail 2x, succeed 3rd
      let callCount = 0;
      jest.spyOn(vscode.lm, 'sendRequest').mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Rate limit');
        }
        return mockSuccessResponse();
      });

      const result = await service.customizeSection('TECH_STACK', mockProjectContext, []);

      expect(callCount).toBe(3);
      expect(result.isOk()).toBe(true);
    });

    it('should fallback to generic content after max retries', async () => {
      jest.spyOn(vscode.lm, 'sendRequest').mockRejectedValue(new Error('Service down'));

      const result = await service.customizeSection('TECH_STACK', mockProjectContext, []);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(''); // Empty = fallback trigger
    });
  });

  describe('batchCustomize', () => {
    it('should process sections with concurrency limit', async () => {
      const sections = Array.from({ length: 12 }, (_, i) => ({
        id: `section-${i}`,
        topic: `TOPIC_${i}`,
        projectContext: mockProjectContext,
        fileSamples: [],
      }));

      const results = await service.batchCustomize(sections, 5);

      expect(results.size).toBe(12);
      // Verify concurrency via timing or spy on sendLmRequest
    });
  });
});
```

---

**Batch 3B Verification Checklist**:

- [ ] VsCodeLmService compiles and integrates with VS Code LM API
- [ ] Retry logic works (tested with mocked failures)
- [ ] Validation integration works
- [ ] Batch processing respects concurrency limit
- [ ] Unit/integration tests pass

---

## Batch 3C: Setup Wizard Backend Service ⏸️ PENDING

**Type**: BACKEND SERVICE (Can run parallel with 3A, 3B, 3D, 3E)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Can Run In Parallel With**: Batch 3A, 3B, 3D, 3E
**Estimated Complexity**: Medium (3-4 days)

### Task 3C.1: Implement SetupWizardService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts
**Dependencies**: Batch 1
**Spec Reference**: implementation-plan.md:279-365 (Component 1)
**Pattern to Follow**: apps/ptah-extension-vscode/src/webview/ (webview patterns)

**Quality Requirements**:

- Webview panel creation and management
- RPC message handler registration
- Wizard step state tracking
- Cancellation and resume support
- Progress event emission via EventBus

**Implementation Details**:

```typescript
@injectable()
export class SetupWizardService {
  private currentSession: WizardSession | null = null;

  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER) private webviewManager: WebviewManager,
    @inject(AGENT_GENERATION_TOKENS.ORCHESTRATOR)
    private orchestrator: AgentGenerationOrchestratorService,
    @inject(TOKENS.EVENT_BUS) private eventBus: EventBus,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  async launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    try {
      // Create wizard session
      this.currentSession = {
        id: generateUuid(),
        workspaceUri,
        currentStep: 'welcome',
        startedAt: new Date(),
      };

      // Create webview panel
      const panel = await this.webviewManager.createWebview({
        viewType: 'ptah.setupWizard',
        title: 'Ptah Setup Wizard',
        preserveFocus: false,
      });

      // Register RPC handlers
      this.registerRpcHandlers(panel);

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  private registerRpcHandlers(panel: vscode.WebviewPanel): void {
    // Handler: start-workspace-scan
    this.webviewManager.onMessage('start-workspace-scan', async () => {
      if (!this.currentSession) return;

      // Trigger workspace analysis
      this.currentSession.currentStep = 'scan';

      // Start analysis (async)
      this.orchestrator.analyzeWorkspace(this.currentSession.workspaceUri, (progress) => {
        // Emit progress to webview
        this.webviewManager.postMessage({
          type: 'workspace-scan-progress',
          filesScanned: progress.filesScanned,
          totalFiles: progress.totalFiles,
          detections: progress.detectedCharacteristics,
        });
      });
    });

    // Handler: agent-selection
    this.webviewManager.onMessage('agent-selection', async (message) => {
      if (!this.currentSession) return;

      this.currentSession.selectedAgents = message.selectedAgents;
      this.currentSession.currentStep = 'generation';

      // Start generation
      const result = await this.orchestrator.generateAgents(
        {
          workspaceUri: this.currentSession.workspaceUri,
          userOverrides: message.selectedAgents,
        },
        (progress) => {
          // Emit progress
          this.webviewManager.postMessage({
            type: 'generation-progress',
            agents: progress.agents,
            percentComplete: progress.percentComplete,
          });
        }
      );

      if (result.isOk()) {
        this.currentSession.currentStep = 'complete';
        this.webviewManager.postMessage({
          type: 'generation-complete',
          summary: result.value,
        });
      } else {
        this.webviewManager.postMessage({
          type: 'generation-error',
          error: result.error!.message,
        });
      }
    });

    // Handler: cancel-wizard
    this.webviewManager.onMessage('cancel-wizard', async () => {
      await this.cancelWizard();
    });
  }

  async cancelWizard(): Promise<Result<void, Error>> {
    if (!this.currentSession) {
      return Result.err(new Error('No active wizard session'));
    }

    // Save progress for resume
    await this.saveSessionState(this.currentSession);

    // Clean up
    this.currentSession = null;

    return Result.ok(undefined);
  }

  async resumeWizard(sessionId: string): Promise<Result<void, Error>> {
    // Load saved session state
    // Restore wizard to saved step
    // Re-launch webview
  }

  private async saveSessionState(session: WizardSession): Promise<void> {
    // Persist to workspace storage
  }
}
```

---

### Task 3C.2: Write SetupWizardService tests ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.spec.ts
**Dependencies**: Task 3C.1

**Quality Requirements**:

- Test webview creation
- Test RPC message handling
- Test cancellation and resume
- Mock WebviewManager and OrchestratorService

---

**Batch 3C Verification Checklist**:

- [ ] SetupWizardService compiles
- [ ] Webview panel creates successfully
- [ ] RPC handlers registered
- [ ] State transitions work
- [ ] Tests pass

---

## Batch 3D: Agent Generation Orchestrator Service ⏸️ PENDING

**Type**: BACKEND SERVICE (Can run parallel with 3A-3C, 3E)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Can Run In Parallel With**: Batch 3A, 3B, 3C, 3E
**Estimated Complexity**: High (4-5 days) - Core orchestration logic

### Task 3D.1: Implement AgentGenerationOrchestratorService ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts
**Dependencies**: Batch 1 (all infrastructure services)
**Spec Reference**: implementation-plan.md:369-475 (Component 2)
**Pattern to Follow**: libs/backend/template-generation TemplateGeneratorService

**Quality Requirements**:

- Coordinate 5-phase workflow (Analysis → Selection → Customization → Rendering → Writing)
- Transaction-style atomicity (all succeed or all rollback)
- Progress reporting (percentComplete, current phase)
- Partial failure support (some agents succeed, others fail)
- Comprehensive error logging

**Implementation Details**:

```typescript
@injectable()
export class AgentGenerationOrchestratorService {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER)
    private workspaceAnalyzer: WorkspaceAnalyzerService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_SELECTOR)
    private agentSelector: AgentSelectionService,
    @inject(AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE)
    private llmService: VsCodeLmService,
    @inject(AGENT_GENERATION_TOKENS.TEMPLATE_RENDERER)
    private templateRenderer: AgentTemplateRenderer,
    @inject(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER)
    private fileWriter: AgentFileWriterService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  async generateAgents(options: GenerationOptions, progressCallback?: (progress: GenerationProgress) => void): Promise<Result<GenerationSummary, Error>> {
    const startTime = Date.now();

    try {
      // Phase 1: Workspace Analysis (30s target)
      this.logger.info('Phase 1: Analyzing workspace');
      progressCallback?.({ phase: 'analysis', percentComplete: 10 });

      const projectContextResult = await this.analyzeWorkspace(options.workspaceUri, progressCallback);
      if (projectContextResult.isErr()) {
        return Result.err(projectContextResult.error!);
      }
      const projectContext = projectContextResult.value!;

      // Phase 2: Agent Selection (5s target)
      this.logger.info('Phase 2: Selecting agents');
      progressCallback?.({ phase: 'selection', percentComplete: 30 });

      const agentScores = await this.agentSelector.scoreAgents(projectContext);
      const selectedAgentIds = this.agentSelector.selectAgents(agentScores, 50, options.userOverrides);

      // Phase 3: LLM Customization (10s per agent target)
      this.logger.info(`Phase 3: Customizing ${selectedAgentIds.length} agents`);
      progressCallback?.({ phase: 'customization', percentComplete: 40 });

      const customizations = await this.customizeAgents(selectedAgentIds, projectContext, progressCallback);

      // Phase 4: Template Rendering (<1s per agent)
      this.logger.info('Phase 4: Rendering templates');
      progressCallback?.({ phase: 'rendering', percentComplete: 90 });

      const renderedAgents = await this.renderAgents(selectedAgentIds, projectContext, customizations);

      // Phase 5: Atomic File Writing
      this.logger.info('Phase 5: Writing agent files');
      progressCallback?.({ phase: 'writing', percentComplete: 95 });

      const writeResult = await this.fileWriter.writeAgentsAtomic(renderedAgents, options.workspaceUri);

      if (writeResult.isErr()) {
        this.logger.error('File write failed, rolling back');
        // Rollback handled by FileWriterService
        return Result.err(writeResult.error!);
      }

      // Success
      progressCallback?.({ phase: 'complete', percentComplete: 100 });

      const duration = Date.now() - startTime;
      const summary: GenerationSummary = {
        successCount: renderedAgents.length,
        failureCount: 0,
        agents: renderedAgents,
        errors: [],
        duration,
      };

      this.logger.info(`Generation complete in ${duration}ms`);
      return Result.ok(summary);
    } catch (error) {
      this.logger.error('Generation failed', error);
      return Result.err(error as Error);
    }
  }

  async analyzeWorkspace(workspaceUri: vscode.Uri, progressCallback?: (progress: GenerationProgress) => void): Promise<Result<ProjectContext, Error>> {
    try {
      // Use workspace-intelligence services
      const projectType = await this.workspaceAnalyzer.detectProjectType(workspaceUri);
      const frameworks = await this.workspaceAnalyzer.detectFrameworks(workspaceUri);
      const monorepoInfo = await this.workspaceAnalyzer.detectMonorepo(workspaceUri);
      const projectInfo = await this.workspaceAnalyzer.getProjectInfo(workspaceUri);
      const fileIndex = await this.workspaceAnalyzer.indexFiles(workspaceUri);

      // Emit progress
      progressCallback?.({
        phase: 'analysis',
        percentComplete: 20,
        detectedCharacteristics: [`Detected ${projectType}`, `Found ${frameworks.length} frameworks`, monorepoInfo.isMonorepo ? `Monorepo: ${monorepoInfo.type}` : 'Single project'],
      });

      const projectContext: ProjectContext = {
        type: projectType,
        techStack: frameworks.map((f) => `${f.name} ${f.version}`),
        frameworks,
        architecture: this.detectArchitecture(fileIndex, monorepoInfo),
        isMonorepo: monorepoInfo.isMonorepo,
        monorepoType: monorepoInfo.type,
        fileIndex: fileIndex.map((f) => f.path),
        primaryLanguage: projectInfo.primaryLanguage,
        sourceDir: projectInfo.sourceDir,
        testDir: projectInfo.testDir,
        packageCount: monorepoInfo.packageCount,
      };

      return Result.ok(projectContext);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  private async customizeAgents(agentIds: string[], projectContext: ProjectContext, progressCallback?: (progress: GenerationProgress) => void): Promise<Map<string, Map<string, string>>> {
    const customizations = new Map<string, Map<string, string>>();

    for (let i = 0; i < agentIds.length; i++) {
      const agentId = agentIds[i];

      // Get LLM sections for this agent
      const template = await this.templateStorage.loadTemplate(agentId);
      const llmSections = template.value!.llmSections;

      // Batch customize all sections for this agent
      const sectionRequests = llmSections.map((section) => ({
        id: section.id,
        topic: section.topic,
        projectContext,
        fileSamples: this.selectFileSamples(projectContext, section.topic),
      }));

      const sectionResults = await this.llmService.batchCustomize(sectionRequests);

      // Store customizations
      const agentCustomizations = new Map<string, string>();
      for (const [sectionId, result] of sectionResults.entries()) {
        if (result.isOk()) {
          agentCustomizations.set(sectionId, result.value!);
        } else {
          // Fallback to empty (generic content)
          agentCustomizations.set(sectionId, '');
        }
      }

      customizations.set(agentId, agentCustomizations);

      // Progress update
      const percentComplete = 40 + Math.floor(((i + 1) / agentIds.length) * 50);
      progressCallback?.({
        phase: 'customization',
        percentComplete,
        currentAgent: agentId,
      });
    }

    return customizations;
  }

  private async renderAgents(agentIds: string[], projectContext: ProjectContext, customizations: Map<string, Map<string, string>>): Promise<GeneratedAgent[]> {
    const rendered: GeneratedAgent[] = [];

    for (const agentId of agentIds) {
      const template = await this.templateStorage.loadTemplate(agentId);
      const agentCustomizations = customizations.get(agentId) ?? new Map();

      const variables = this.buildVariables(projectContext);

      const result = await this.templateRenderer.renderAgent(template.value!, variables, agentCustomizations);

      if (result.isOk()) {
        rendered.push(result.value!);
      }
    }

    return rendered;
  }

  private buildVariables(projectContext: ProjectContext): Record<string, any> {
    return {
      PROJECT_TYPE: projectContext.type,
      PROJECT_NAME: 'My Project', // From projectInfo
      FRAMEWORK_NAME: projectContext.frameworks[0]?.name ?? 'Unknown',
      FRAMEWORK_VERSION: projectContext.frameworks[0]?.version ?? '',
      TECH_STACK: projectContext.techStack.join(', '),
      ARCHITECTURE_PATTERN: projectContext.architecture,
      IS_MONOREPO: projectContext.isMonorepo,
      MONOREPO_TYPE: projectContext.monorepoType ?? '',
      PACKAGE_COUNT: projectContext.packageCount ?? 0,
      PRIMARY_LANGUAGE: projectContext.primaryLanguage,
      SOURCE_DIR: projectContext.sourceDir,
      TEST_DIR: projectContext.testDir ?? '',
      TIMESTAMP: new Date().toISOString(),
    };
  }

  private selectFileSamples(projectContext: ProjectContext, topic: string): string[] {
    // Select relevant files from fileIndex based on topic
    // E.g., for "TECH_STACK_SPECIFICS", pick representative files
    return [];
  }

  private detectArchitecture(fileIndex: any[], monorepoInfo: any): string {
    if (monorepoInfo.isMonorepo) {
      return `${monorepoInfo.type} Monorepo`;
    }
    // Simple heuristics
    const hasLayers = fileIndex.some((f) => f.path.includes('controllers')) && fileIndex.some((f) => f.path.includes('services'));
    return hasLayers ? 'Layered Architecture' : 'Simple Architecture';
  }
}
```

---

### Task 3D.2: Write OrchestratorService integration tests ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts
**Dependencies**: Task 3D.1

**Quality Requirements**:

- Test end-to-end workflow (mock all dependencies)
- Test error handling and rollback
- Test progress reporting
- Test partial failure scenarios

---

**Batch 3D Verification Checklist**:

- [ ] OrchestratorService compiles
- [ ] End-to-end workflow executes successfully (with mocks)
- [ ] Progress reporting works
- [ ] Rollback works on failure
- [ ] Tests pass

---

## Batch 3E: Prompt Library & Validation Rules ⏸️ PENDING

**Type**: BACKEND CONFIGURATION (Can run parallel with 3A-3D)
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 0
**Can Run In Parallel With**: Batch 3A, 3B, 3C, 3D
**Estimated Complexity**: Medium (2-3 days)

### Task 3E.1: Create prompt templates library ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\prompts\prompt-library.ts
**Dependencies**: Batch 0
**Spec Reference**: research-report.md:298-465 (Prompt Engineering)

**Quality Requirements**:

- Type-safe prompt templates
- Configurable prompt parameters
- Validation rules for each prompt
- Export prompt registry

**Implementation Details**:

```typescript
export interface PromptTemplate {
  id: string;
  name: string;
  template: (context: PromptContext) => string;
  validationRules: ValidationRules;
  maxTokens: number;
  expectedOutputFormat: 'markdown' | 'json';
}

export const PROMPT_LIBRARY: Record<string, PromptTemplate> = {
  AGENT_CUSTOMIZATION: {
    id: 'agent-customization',
    name: 'Agent Customization',
    template: (context) => `You are an expert software development coach specializing in ${context.framework}.

CONTEXT:
- Project Type: ${context.projectType}
- Framework: ${context.framework} ${context.frameworkVersion}
- Architecture: ${context.architecture}

FILE SAMPLES:
${context.fileSamples.join('\n\n')}

TASK:
Generate best practice guidance for the "${context.sectionTopic}" section.

REQUIREMENTS:
1. Use concrete examples from file samples
2. Reference actual patterns detected
3. Be specific to ${context.framework}
4. Keep under 500 words
5. Use bullet points

OUTPUT FORMAT:
Return ONLY markdown content.`,
    validationRules: {
      minLength: 100,
      maxLength: 1000,
      requiredPatterns: [/^-\s/m], // Bullet points required
      forbiddenPatterns: [/https?:\/\//], // No URLs
    },
    maxTokens: 1500,
    expectedOutputFormat: 'markdown',
  },

  TECH_STACK_INJECTION: {
    id: 'tech-stack-injection',
    name: 'Tech Stack Overview',
    template: (context) => `Generate a concise tech stack overview table.

DETECTED TECHNOLOGIES:
${JSON.stringify(context.techStack, null, 2)}

OUTPUT FORMAT (markdown table):
| Category | Technologies | Notes |
|----------|--------------|-------|
| Backend | ... | ... |`,
    validationRules: {
      minLength: 50,
      maxLength: 500,
      requiredPatterns: [/\|.*\|.*\|/], // Table format
    },
    maxTokens: 800,
    expectedOutputFormat: 'markdown',
  },

  // ... (add remaining prompts from research-report.md)
};
```

---

### Task 3E.2: Create validation rules registry ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\validation\validation-rules.ts
**Dependencies**: Batch 0
**Spec Reference**: research-report.md:466-490 (Validation Framework)

**Quality Requirements**:

- Configurable validation thresholds
- Reusable validation rule sets
- Export rule registry

**Implementation Details**:

```typescript
export interface ValidationRules {
  minLength?: number;
  maxLength?: number;
  requiredPatterns?: RegExp[];
  forbiddenPatterns?: RegExp[];
  minScore?: number; // 0-100
}

export const VALIDATION_RULES: Record<string, ValidationRules> = {
  SCHEMA: {
    minLength: 50,
    maxLength: 2000,
    requiredPatterns: [/^[#-*]/m], // Markdown structure
  },

  SAFETY: {
    forbiddenPatterns: [/api[_-]?key/i, /password/i, /secret/i, /<script>/i, /eval\(/],
  },

  FACTUAL_ACCURACY: {
    minScore: 70, // Threshold for acceptance
  },
};
```

---

**Batch 3E Verification Checklist**:

- [ ] Prompt templates compile
- [ ] Validation rules export correctly
- [ ] VsCodeLmService can use prompt library
- [ ] OutputValidationService can use validation rules

---

## INTEGRATION PHASE (Sequential after parallel tracks)

---

## Batch 4: Backend Integration & Testing ⏸️ PENDING

**Type**: INTEGRATION (Sequential)
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batches 1, 3A-3E
**Can Run In Parallel With**: NOTHING (integration must be sequential)
**Estimated Complexity**: Medium (2-3 days)

### Task 4.1: Register agent-generation services in main DI container ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\service-registration.ts
**Dependencies**: Batches 1, 3A-3E
**Spec Reference**: implementation-plan.md:2220-2290 (DI Registration)

**Quality Requirements**:

- Import and call `registerAgentGenerationServices()`
- Verify all services register correctly
- No circular dependencies

**Implementation Details**:

```typescript
import { registerAgentGenerationServices } from '@ptah-extension/agent-generation';

export function registerAllServices(): void {
  // Existing registrations
  registerVscoreCoreServices();
  registerWorkspaceIntelligenceServices();
  registerClaudeDomainServices();
  // ... other services

  // NEW: Register agent-generation services
  registerAgentGenerationServices();
}
```

---

### Task 4.2: Create setup wizard command ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\setup-wizard.command.ts
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:279-365 (SetupWizardService)

**Quality Requirements**:

- VS Code command registration
- Error handling and user feedback
- Activation event

**Implementation Details**:

```typescript
import { AGENT_GENERATION_TOKENS, SetupWizardService } from '@ptah-extension/agent-generation';

export function registerSetupWizardCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('ptah.setupWizard', async () => {
    const wizardService = container.resolve<SetupWizardService>(AGENT_GENERATION_TOKENS.SETUP_WIZARD);

    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) {
      vscode.window.showErrorMessage('No workspace open');
      return;
    }

    const result = await wizardService.launchWizard(workspaceUri);
    if (result.isErr()) {
      vscode.window.showErrorMessage(`Setup wizard failed: ${result.error!.message}`);
    }
  });

  context.subscriptions.push(command);
}
```

---

### Task 4.3: Add activation event for first-time setup ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json
**Dependencies**: Task 4.2
**Spec Reference**: implementation-plan.md:2583-2660 (Activation Events)

**Quality Requirements**:

- Trigger setup wizard on first activation
- Don't re-trigger if `.claude/agents/` already exists
- Add command palette entry

**Implementation Details**:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "ptah.setupWizard",
        "title": "Ptah: Setup Agent Generation Wizard"
      }
    ]
  },
  "activationEvents": ["onStartupFinished"]
}
```

In extension.ts:

```typescript
export async function activate(context: vscode.ExtensionContext) {
  // Existing activation...

  // Check if first-time setup needed
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceUri) {
    const claudeAgentsPath = vscode.Uri.joinPath(workspaceUri, '.claude', 'agents');
    try {
      await vscode.workspace.fs.stat(claudeAgentsPath);
      // .claude/agents exists, skip setup
    } catch {
      // First-time setup needed
      const result = await vscode.window.showInformationMessage('Welcome to Ptah! Would you like to generate personalized agents for your project?', 'Yes, Setup Now', 'Maybe Later');

      if (result === 'Yes, Setup Now') {
        vscode.commands.executeCommand('ptah.setupWizard');
      }
    }
  }
}
```

---

### Task 4.4: Write end-to-end integration test ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\integration-tests\e2e.spec.ts
**Dependencies**: Tasks 4.1-4.3
**Spec Reference**: implementation-plan.md:2118-2162 (Integration Tests)

**Quality Requirements**:

- Test complete workflow (mock workspaces)
- Verify all services integrate correctly
- Test happy path + error paths

**Implementation Details**:

```typescript
describe('Agent Generation E2E', () => {
  let orchestrator: AgentGenerationOrchestratorService;
  let testWorkspaceUri: vscode.Uri;

  beforeAll(async () => {
    // Setup test workspace with sample files
    testWorkspaceUri = await createTestWorkspace({
      type: ProjectType.Angular,
      files: ['apps/web/src/app/app.component.ts', 'apps/api/src/main.ts', 'nx.json', 'package.json'],
    });

    // Resolve orchestrator from DI
    orchestrator = container.resolve<AgentGenerationOrchestratorService>(AGENT_GENERATION_TOKENS.ORCHESTRATOR);
  });

  it('should generate agents for Angular Nx monorepo', async () => {
    const result = await orchestrator.generateAgents({
      workspaceUri: testWorkspaceUri,
    });

    expect(result.isOk()).toBe(true);
    expect(result.value!.successCount).toBeGreaterThan(0);

    // Verify files written
    const agentsDir = vscode.Uri.joinPath(testWorkspaceUri, '.claude', 'agents');
    const files = await vscode.workspace.fs.readDirectory(agentsDir);
    expect(files.length).toBeGreaterThan(0);

    // Verify content
    const backendAgent = vscode.Uri.joinPath(agentsDir, 'backend-developer.md');
    const content = await vscode.workspace.fs.readFile(backendAgent);
    const contentStr = Buffer.from(content).toString('utf8');

    // Verify YAML frontmatter
    expect(contentStr).toContain('generated: true');
    expect(contentStr).toContain('sourceTemplate: backend-developer-v2');

    // Verify project-specific content
    expect(contentStr).toContain('Angular'); // Tech stack
    expect(contentStr).toContain('Nx Monorepo'); // Architecture
  });

  it('should handle LLM API failure gracefully', async () => {
    // Mock VS Code LM to fail
    jest.spyOn(vscode.lm, 'sendRequest').mockRejectedValue(new Error('Service down'));

    const result = await orchestrator.generateAgents({
      workspaceUri: testWorkspaceUri,
    });

    // Should still succeed with fallback content
    expect(result.isOk()).toBe(true);
  });
});
```

---

**Batch 4 Verification Checklist**:

- [ ] All services registered in DI
- [ ] Setup wizard command works
- [ ] First-time activation triggers wizard
- [ ] E2E test passes

---
