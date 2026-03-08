# Batch -1: Pre-Implementation Extraction Plan

**Project**: TASK_2025_058 - Intelligent Project-Adaptive Agent Generation System
**Purpose**: Extract code from roocode-generator to Ptah BEFORE development starts
**Strategy**: Copy first, then wire (NOT simultaneously)

---

## 📋 Executive Summary

**User's Key Instructions**:

1. VS Code LM API integration is the **INITIAL ROLE PLAYER** - must be added first
2. Extract code from roocode to Ptah FIRST, THEN developers wire it up
3. Sequential approach: Copy → Wire (not simultaneously)
4. Developers should focus on ONE task at a time

**Gap Analysis**:
| Component | roocode | Ptah | Action |
|-----------|---------|------|--------|
| VS Code LM API Provider | ❌ N/A | ❌ Missing | **CREATE NEW** |
| ContentProcessor utilities | ✅ Exists | ❌ Missing | Extract to agent-generation |
| LLM orchestration patterns | ✅ LLMAgent | 🟡 Partial (LlmService) | Enhance existing |
| Template processing | ✅ memory-bank | ✅ template-generation | Reference patterns |
| Orchestration patterns | ✅ memory-bank-orchestrator | ❌ Missing | Extract patterns |

---

## 🎯 Extraction Tasks

### Task -1.1: Create VS Code LM API Provider ⏸️ PENDING

**Priority**: 🔴 CRITICAL - Blocks agent generation
**Developer**: backend-developer
**Estimated Complexity**: Medium (1-2 days)
**Location**: `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.ts`

**Description**:
Create a new LLM provider that uses VS Code's built-in Language Model API (`vscode.lm`) instead of external providers.

**Interface Requirements**:

```typescript
// Must implement existing ILlmProvider interface
export class VsCodeLmProvider extends BaseLlmProvider {
  readonly name = 'vscode-lm';

  // VS Code LM API uses different patterns:
  // - vscode.lm.selectChatModels() for model selection
  // - model.sendRequest() for completions
  // - No API key required (uses VS Code's auth)

  getCompletion(systemPrompt: string, userPrompt: string): Promise<Result<string, LlmProviderError>>;
  getStructuredCompletion<T extends z.ZodTypeAny>(prompt, schema, config?): Promise<Result<z.infer<T>, LlmProviderError>>;
}
```

**VS Code LM API Reference**:

```typescript
// Model selection
const models = await vscode.lm.selectChatModels({
  vendor: 'copilot', // or 'anthropic', etc.
  family: 'gpt-4', // or 'claude-3-5-sonnet', etc.
});

// Chat request
const messages = [vscode.LanguageModelChatMessage.User(userPrompt)];
const response = await model.sendRequest(messages, {}, token);

// Streaming response
for await (const chunk of response.text) {
  result += chunk;
}
```

**Acceptance Criteria**:

- [ ] Implements `ILlmProvider` interface
- [ ] Extends `BaseLlmProvider` base class
- [ ] Uses `vscode.lm.selectChatModels()` for model discovery
- [ ] Supports both streaming and non-streaming completions
- [ ] Handles structured output via JSON schema prompting
- [ ] Proper error handling with `LlmProviderError`
- [ ] Registered in `ProviderRegistry`
- [ ] Unit tests with VS Code mocks

**Files to Create**:

1. `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.ts`
2. `libs/backend/llm-abstraction/src/lib/providers/vscode-lm.provider.spec.ts`

**Files to Modify**:

1. `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts` - Register provider
2. `libs/backend/llm-abstraction/src/index.ts` - Export provider

---

### Task -1.2: Extract ContentProcessor Utilities ⏸️ PENDING

**Priority**: 🟠 HIGH - Shared utilities needed across system
**Developer**: backend-developer
**Estimated Complexity**: Low (0.5 days)
**Source**: `D:\projects\roocode-generator\src\memory-bank\content-processor.ts`
**Target**: `libs/backend/agent-generation/src/lib/utils/content-processor.ts`

**Utilities to Extract**:

````typescript
// From roocode content-processor.ts - direct copy with adaptations

/**
 * Strip markdown code block wrappers from LLM response
 * Handles: ```markdown ... ```, ```json ... ```, etc.
 */
export function stripMarkdownCodeBlock(content: string): Result<string, Error> {
  const processed = content.replace(/```markdown\s*([\s\S]*?)\s*```/im, '$1').replace(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/im, '$1');
  return Result.ok(processed);
}

/**
 * Strip HTML comments from content (recursive for nested)
 * Handles: <!-- ... --> including nested comments
 */
export function stripHtmlComments(content: string): Result<string, Error> {
  let previous: string;
  let processed = content;
  do {
    previous = processed;
    processed = processed.replace(/<!--[\s\S]*?-->/g, '');
  } while (processed !== previous);
  return Result.ok(processed);
}

/**
 * Simple mustache-style template processing
 * Replaces {{key}} with values from data object
 */
export function processTemplate(template: string, data: Record<string, unknown>): Result<string, Error> {
  let processed = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    processed = processed.replace(regex, String(value));
  }
  return Result.ok(processed);
}

/**
 * Extract frontmatter from markdown content
 * Returns: { frontmatter: object, content: string }
 */
export function extractFrontmatter(content: string): Result<
  {
    frontmatter: Record<string, unknown>;
    content: string;
  },
  Error
>;
````

**Acceptance Criteria**:

- [ ] All 4 utilities extracted and typed
- [ ] Uses Ptah's `Result` pattern from `@ptah-extension/shared`
- [ ] Unit tests for each utility
- [ ] JSDoc documentation

**Files to Create**:

1. `libs/backend/agent-generation/src/lib/utils/content-processor.ts`
2. `libs/backend/agent-generation/src/lib/utils/content-processor.spec.ts`

---

### Task -1.3: Extract Orchestration Patterns ⏸️ PENDING

**Priority**: 🟠 HIGH - Core generation pattern
**Developer**: backend-developer
**Estimated Complexity**: Medium (1 day)
**Source**: `D:\projects\roocode-generator\src\memory-bank\memory-bank-orchestrator.ts`
**Target**: `libs/backend/agent-generation/src/lib/patterns/` (reference patterns, not direct copy)

**Pattern 1: Error Accumulation for Partial Success**

```typescript
// Pattern from roocode - adapt for agent generation

interface GenerationError {
  item: string; // e.g., agent name
  error: Error;
  phase: 'template' | 'content' | 'file';
}

async function generateWithPartialSuccess<T>(items: string[], generateFn: (item: string) => Promise<Result<T, Error>>): Promise<{ successful: T[]; errors: GenerationError[] }> {
  const errors: GenerationError[] = [];
  const successful: T[] = [];

  for (const item of items) {
    const result = await generateFn(item);
    if (result.isErr()) {
      errors.push({ item, error: result.error, phase: 'content' });
      continue; // Don't fail entire batch
    }
    successful.push(result.value);
  }

  return { successful, errors };
}
```

**Pattern 2: Multi-Phase Generation Pipeline**

```typescript
// Pattern from roocode memory-bank-orchestrator

interface GenerationPhase<TInput, TOutput> {
  name: string;
  execute: (input: TInput) => Promise<Result<TOutput, Error>>;
}

class GenerationPipeline<TContext> {
  private phases: GenerationPhase<any, any>[] = [];

  addPhase<TIn, TOut>(phase: GenerationPhase<TIn, TOut>): this;
  async execute(context: TContext): Promise<Result<void, Error>>;
}
```

**Pattern 3: Prompt Building Pattern**

```typescript
// Pattern from roocode memory-bank-content-generator

interface PromptBuilder<TContext> {
  buildSystemPrompt(context: TContext): string;
  buildUserPrompt(context: TContext, template?: string): string;
}
```

**Acceptance Criteria**:

- [ ] Document patterns in `patterns/README.md`
- [ ] Create reusable base types/interfaces
- [ ] NOT direct code copy - these are reference patterns for developers

**Files to Create**:

1. `libs/backend/agent-generation/src/lib/patterns/README.md` (pattern documentation)
2. `libs/backend/agent-generation/src/lib/patterns/error-accumulation.ts`
3. `libs/backend/agent-generation/src/lib/patterns/generation-pipeline.ts`
4. `libs/backend/agent-generation/src/lib/patterns/prompt-builder.ts`

---

### Task -1.4: Scaffold agent-generation Library ⏸️ PENDING

**Priority**: 🔴 CRITICAL - Required for extractions
**Developer**: backend-developer
**Estimated Complexity**: Low (0.5 days)
**Action**: Create library structure BEFORE extraction tasks

**Commands**:

```bash
# Generate library with Nx
npx nx g @nx/js:library agent-generation --directory=libs/backend/agent-generation --importPath=@ptah-extension/agent-generation --bundler=esbuild --unitTestRunner=jest
```

**Initial Structure**:

```
libs/backend/agent-generation/
├── src/
│   ├── index.ts              # Public exports
│   └── lib/
│       ├── utils/            # ContentProcessor utilities (Task -1.2)
│       │   ├── content-processor.ts
│       │   └── content-processor.spec.ts
│       ├── patterns/         # Orchestration patterns (Task -1.3)
│       │   ├── README.md
│       │   ├── error-accumulation.ts
│       │   ├── generation-pipeline.ts
│       │   └── prompt-builder.ts
│       └── types/            # Type definitions
│           └── index.ts
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
├── tsconfig.spec.json
└── jest.config.ts
```

**Acceptance Criteria**:

- [ ] Library created with Nx
- [ ] Builds successfully
- [ ] Jest configured for tests
- [ ] Exports configured in index.ts
- [ ] Added to tsconfig paths

---

## 📊 Execution Order

```
┌─────────────────────────────────────────────────────────────┐
│  BATCH -1: EXTRACTION PHASE                                  │
│  (Must complete BEFORE Batch 0)                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Task -1.4: Scaffold agent-generation library               │
│      ↓ (blocks all extractions)                             │
│  ┌───────────────────────┬───────────────────────┐          │
│  ↓                       ↓                       │          │
│  Task -1.2: Extract      Task -1.3: Extract      │          │
│  ContentProcessor        Orchestration           │          │
│  (can run parallel)      (can run parallel)      │          │
│  └───────────────────────┴───────────────────────┘          │
│      ↓                                                       │
│  Task -1.1: Create VS Code LM API Provider                  │
│      (depends on library scaffold)                          │
│      ↓                                                       │
│  ✅ EXTRACTION COMPLETE → Ready for Batch 0                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Parallel Execution**:

- Tasks -1.2 and -1.3 can run in parallel (after -1.4)
- Task -1.1 can start after -1.4 (doesn't depend on -1.2/-1.3)

**Critical Path**: -1.4 → -1.1 (VS Code LM API Provider is longest task)

---

## 🔗 Integration with Batch 0

After Batch -1 completes:

1. **Batch 0 Task 0.1** (Library scaffolding) - ALREADY DONE via -1.4
2. **Batch 0 Task 0.2** (Type definitions) - Can use extracted types
3. **Batch 0 Task 0.3** (DI tokens) - Include VS Code LM provider token
4. **Batch 1** (Core services) - Can use ContentProcessor utilities
5. **Batch 2B** (LLM integration) - VS Code LM Provider ready to use

---

## ✅ Definition of Done

Batch -1 is complete when:

- [ ] `agent-generation` library exists and builds
- [ ] VS Code LM API provider implemented and tested
- [ ] ContentProcessor utilities extracted and tested
- [ ] Orchestration patterns documented
- [ ] All unit tests pass
- [ ] Integration test: LlmService can use VsCodeLmProvider

---

## 📝 Notes for Developers

**DO NOT**:

- Wire extracted code to existing systems (that's Batch 0+)
- Modify existing services (only ADD new files)
- Create complex integrations (simple, isolated extractions only)

**DO**:

- Focus on one task at a time
- Write comprehensive unit tests
- Document public APIs with JSDoc
- Follow existing code patterns in Ptah
