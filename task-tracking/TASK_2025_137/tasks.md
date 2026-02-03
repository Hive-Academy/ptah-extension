# TASK_2025_137: Intelligent Prompt Generation System

**Status**: IN PROGRESS
**Type**: FEATURE
**Priority**: HIGH
**Created**: 2025-02-03
**Depends On**: TASK_2025_135 (Prompt Harness System - infrastructure)

---

## Progress

### Batch 1: PTAH_CORE_SYSTEM_PROMPT (Foundation) - ✅ COMPLETE

**Completed**: 2025-02-03

**Files Created:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` - NEW

**Files Modified:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts` - Uses core prompt as foundation layer
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` - Exports core prompt
- `libs/backend/agent-sdk/src/lib/helpers/prompt-constants.ts` - Marked PTAH_BEHAVIORAL_PROMPT as deprecated

**What was implemented:**

1. Created `PTAH_CORE_SYSTEM_PROMPT` (~2,600 tokens) - comprehensive behavioral guidance adapted from Anthropic's `claude_code` preset:
   - Extension environment clarification (VS Code, not CLI)
   - Tone and Style (adapted from Anthropic)
   - Professional Objectivity (kept from Anthropic)
   - No Time Estimates (kept from Anthropic)
   - AskUserQuestion - MANDATORY (enhanced with schema, examples, rules)
   - Doing Tasks (kept from Anthropic - anti-over-engineering)
   - Tool Usage Policy (kept from Anthropic)
   - Git Safety Protocol + Commit Workflow (kept from Anthropic)
   - PR Workflow (kept from Anthropic)
   - Code References (file_path:line_number pattern)
   - Rich Formatting Guidelines (Ptah-specific)
2. Created mapping document: `docs/ptah-prompt-mapping.md`
3. Integrated into PromptHarnessService as the foundation layer (always first)
4. Deprecated `PTAH_BEHAVIORAL_PROMPT` (content merged into core prompt)
5. Typecheck passes

**Architecture Decision:**

- Keep `preset: 'claude_code'` for tool definitions and dynamic sections
- Append PTAH_CORE_SYSTEM_PROMPT for behavioral guidance
- This preserves Anthropic's infrastructure while customizing behavior

---

### Batch 2: Prompt Designer Agent (Intelligence) - ✅ COMPLETE

**Completed**: 2025-02-03

**Files Created:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts` - Main agent class
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer.types.ts` - Type definitions
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/generation-prompts.ts` - LLM prompt templates
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/response-parser.ts` - Response parsing and validation
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/index.ts` - Module exports

**Files Modified:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` - Exports prompt-designer module
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` - Added SDK_PROMPT_DESIGNER_AGENT token
- `libs/backend/agent-sdk/src/lib/di/register.ts` - Registered PromptDesignerAgent
- `libs/backend/agent-sdk/src/index.ts` - Exported all new types and services
- `libs/backend/agent-sdk/package.json` - Added zod and vscode-lm-tools dependencies

**What was implemented:**

1. **PromptDesignerAgent** - Main service that:

   - Takes workspace analysis input (project type, framework, dependencies)
   - Calls LLM with structured completion (Zod schema) to generate guidance
   - Falls back to text completion and parsing for models without structured output
   - Provides fallback guidance when LLM is unavailable
   - Enforces token budgets on each section
   - Validates output quality

2. **Type System** (prompt-designer.types.ts):

   - `PromptDesignerInput` - Project metadata from workspace-intelligence
   - `PromptDesignerOutput` - Generated guidance with token counts
   - `PromptDesignerResponseSchema` - Zod schema for structured LLM output
   - `PromptGenerationProgress` - Progress events for UI feedback
   - `PromptDesignerConfig` - Agent configuration options
   - `CachedPromptDesign` - Cache entry structure (for Batch 3)

3. **Generation Prompts** (generation-prompts.ts):

   - `PROMPT_DESIGNER_SYSTEM_PROMPT` - Instructs LLM to generate project-specific guidance
   - `buildGenerationUserPrompt()` - Builds context-rich user prompt from input
   - `buildFallbackGuidance()` - Template-based fallback when LLM unavailable
   - `FRAMEWORK_PROMPT_ADDITIONS` - Framework-specific prompt enhancements

4. **Response Parser** (response-parser.ts):

   - `parseStructuredResponse()` - Processes Zod-validated LLM response
   - `parseTextResponse()` - Extracts sections from markdown text
   - `validateOutput()` - Checks quality (minimum length, generic phrases)
   - `truncateToTokenBudget()` - Truncates sections to fit budget
   - `formatAsPromptSection()` - Formats output for prompt appending

5. **DI Integration**:
   - Added `SDK_PROMPT_DESIGNER_AGENT` token
   - Registered as singleton in DI container
   - Depends on `Logger` and `LlmService` (from llm-abstraction)

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                  Prompt Designer Agent                       │
├─────────────────────────────────────────────────────────────┤
│  Input: PromptDesignerInput                                 │
│  ├─ projectType, framework, isMonorepo                      │
│  ├─ dependencies, devDependencies                           │
│  └─ sampleFilePaths (optional)                              │
├─────────────────────────────────────────────────────────────┤
│  Processing:                                                │
│  1. Check LLM availability (fallback if unavailable)        │
│  2. Build enhanced system prompt (+ framework additions)    │
│  3. Try structured completion with Zod schema               │
│  4. Fall back to text completion + parsing                  │
│  5. Validate output quality                                 │
│  6. Enforce token budgets per section                       │
├─────────────────────────────────────────────────────────────┤
│  Output: PromptDesignerOutput                               │
│  ├─ projectContext (~400 tokens max)                        │
│  ├─ frameworkGuidelines (~400 tokens max)                   │
│  ├─ codingStandards (~400 tokens max)                       │
│  ├─ architectureNotes (~400 tokens max)                     │
│  └─ tokenBreakdown, totalTokens, generatedAt                │
└─────────────────────────────────────────────────────────────┘
```

**Token Budget:** ~1600 tokens total for generated guidance

---

## Executive Summary

Replace the static power-up toggle system (TASK_2025_135) with an **intelligent, agent-driven prompt generation system** that analyzes each workspace and dynamically creates project-specific guidance. This creates a **clean slate system prompt** owned entirely by Ptah, removing dependency on Anthropic's `claude_code` preset.

---

## Vision Statement

> "Instead of users toggling static power-ups, an intelligent Prompt Designer Agent analyzes the workspace, understands the project's architecture, frameworks, and patterns, then generates tailored guidance that makes the AI assistant project-aware from the first message."

---

## Current State Analysis

### What TASK_2025_135 Built (Prompt Harness System)

```
┌─────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│  SDK Query                                                   │
│  ├─ preset: 'claude_code'  ← Anthropic's foundation          │
│  ├─ systemPrompt: assembled from:                            │
│  │   ├─ PTAH_BEHAVIORAL_PROMPT (extension-specific)          │
│  │   ├─ Static Power-Ups (user toggles on/off)               │
│  │   └─ Custom User Sections                                 │
│  └─ appendedSystemPrompt: custom additions                   │
├─────────────────────────────────────────────────────────────┤
│  LIMITATIONS:                                                │
│  • Power-ups are generic, not project-aware                  │
│  • Relies on Anthropic's preset (CLI-focused, not extension) │
│  • Static definitions can't adapt to workspace context       │
│  • User must manually choose relevant power-ups              │
│  • No intelligence in prompt customization                   │
└─────────────────────────────────────────────────────────────┘
```

### Target State (Intelligent Generation)

```
┌─────────────────────────────────────────────────────────────┐
│                    TARGET ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────┤
│  SDK Query                                                   │
│  ├─ preset: undefined (NO Anthropic preset)                  │
│  ├─ systemPrompt: PTAH_CORE_SYSTEM_PROMPT (Ptah-owned)       │
│  └─ appendedSystemPrompt: assembled from:                    │
│      ├─ Prompt Designer Agent Output                         │
│      │   ├─ Project Analysis (frameworks, patterns, style)   │
│      │   ├─ Generated Guidelines (SOLID, naming, arch)       │
│      │   └─ Framework-Specific Best Practices                │
│      └─ User Customizations (preferences, additions)         │
├─────────────────────────────────────────────────────────────┤
│  BENEFITS:                                                   │
│  • Full control over base system prompt                      │
│  • Project-aware guidance from first message                 │
│  • Intelligent adaptation to each workspace                  │
│  • No manual power-up toggling needed                        │
│  • Extension-focused (not CLI-focused)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Design

### Phase 1: Ptah Core System Prompt (Foundation)

Create `PTAH_CORE_SYSTEM_PROMPT` - Ptah's own base system prompt that replaces Anthropic's `claude_code` preset.

**What it includes:**

- Extension environment description (VS Code, not CLI)
- Tool availability (AskUserQuestion, file operations, etc.)
- Rich formatting guidelines (markdown, callouts, code blocks)
- Behavioral rules (no emojis, concise output)
- Security guidelines (no secrets, safe commands)

**What it does NOT include:**

- Project-specific patterns (AI-generated)
- Framework best practices (AI-generated)
- Coding standards (AI-generated from workspace analysis)

```typescript
// libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts
export const PTAH_CORE_SYSTEM_PROMPT = `
# Ptah Extension - AI Assistant for VS Code

## Environment

You are running as an AI assistant within the Ptah VS Code extension.
Your responses are rendered in a webview with enhanced markdown support.

## Available Tools

- **AskUserQuestion**: Present choices and gather user input with structured UI
- **Read/Write/Edit**: File operations with VS Code integration
- **Bash**: Execute terminal commands (sandboxed)
- **Glob/Grep**: Search files and content
- **WebFetch/WebSearch**: Access web resources

## Output Guidelines

- Use Github-flavored markdown for formatting
- Specify language in code blocks (e.g., \`\`\`typescript)
- Use callout syntax for important information:
  - \`> [!NOTE]\` for general notes
  - \`> [!TIP]\` for helpful tips
  - \`> [!WARNING]\` for warnings
- Keep responses concise and actionable
- No emojis unless explicitly requested

## Interaction Rules

1. ALWAYS use AskUserQuestion for presenting choices (never plain text options)
2. Read files before modifying them
3. Prefer editing existing files over creating new ones
4. Never commit sensitive data (.env, credentials)
5. Ask for clarification when requirements are ambiguous

## Security

- Never expose API keys, tokens, or credentials
- Validate user input before executing commands
- Avoid destructive operations without confirmation
`;
```

### Phase 2: Prompt Designer Agent

An intelligent agent that analyzes the workspace and generates tailored guidance.

```typescript
// libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer-agent.ts
export interface PromptDesignerInput {
  workspaceAnalysis: WorkspaceAnalysis; // From workspace-intelligence lib
  userPreferences?: UserPromptConfig; // Optional user overrides
}

export interface PromptDesignerOutput {
  projectContext: string; // "This is an Angular 20 monorepo with NestJS backend..."
  frameworkGuidelines: string; // "Follow Angular signal patterns, use standalone components..."
  codingStandards: string; // "Use SOLID principles, prefer composition over inheritance..."
  architectureNotes: string; // "Respect library boundaries, use DI tokens..."
  tokenCount: number; // Total tokens for budget tracking
}

export class PromptDesignerAgent {
  constructor(private readonly llmProvider: ILLMProvider, private readonly workspaceIntelligence: WorkspaceIntelligenceService) {}

  async generateProjectPrompt(workspacePath: string): Promise<PromptDesignerOutput> {
    // 1. Analyze workspace using existing infrastructure
    const analysis = await this.workspaceIntelligence.analyzeWorkspace(workspacePath);

    // 2. Use LLM to generate tailored guidance
    const generationPrompt = this.buildGenerationPrompt(analysis);
    const response = await this.llmProvider.generate(generationPrompt);

    // 3. Parse and structure the output
    return this.parseResponse(response);
  }

  private buildGenerationPrompt(analysis: WorkspaceAnalysis): string {
    return `
You are a Prompt Designer Agent. Your task is to generate concise, actionable guidance
for an AI assistant that will help developers in this specific project.

## Project Analysis

${JSON.stringify(analysis, null, 2)}

## Your Output

Generate guidance in these categories (keep each section under 500 tokens):

### 1. Project Context
A brief description of what this project is and its key technologies.

### 2. Framework Guidelines
Specific patterns and best practices for the detected frameworks.
Focus on: component patterns, state management, testing approaches.

### 3. Coding Standards
SOLID principles application, naming conventions, error handling.
Derive from existing code patterns when possible.

### 4. Architecture Notes
Library boundaries, dependency rules, import patterns.
Key abstractions and their purposes.

Be specific to THIS project. Avoid generic advice that applies to all projects.
`;
  }
}
```

### Phase 3: Dynamic Assembly Pipeline

Orchestrates the complete prompt assembly process.

```typescript
// libs/backend/agent-sdk/src/lib/prompt-harness/intelligent-prompt-assembler.ts
export class IntelligentPromptAssembler {
  constructor(private readonly promptDesigner: PromptDesignerAgent, private readonly userPromptStore: UserPromptStore, private readonly cache: PromptCacheService) {}

  async assemblePrompt(workspacePath: string): Promise<AssembledPrompt> {
    // 1. Check cache (regenerate if workspace changed)
    const cached = await this.cache.get(workspacePath);
    if (cached && !this.isStale(cached)) {
      return this.mergeWithUserPrefs(cached);
    }

    // 2. Generate new project-specific prompt
    const generated = await this.promptDesigner.generateProjectPrompt(workspacePath);

    // 3. Assemble final prompt
    const assembled: AssembledPrompt = {
      systemPrompt: PTAH_CORE_SYSTEM_PROMPT,
      appendedPrompt: this.buildAppendedPrompt(generated),
      totalTokens: this.countTokens(generated),
      generatedAt: Date.now(),
    };

    // 4. Cache for future use
    await this.cache.set(workspacePath, assembled);

    return assembled;
  }

  private buildAppendedPrompt(generated: PromptDesignerOutput): string {
    return `
## Project-Specific Guidance

${generated.projectContext}

### Framework Best Practices

${generated.frameworkGuidelines}

### Coding Standards

${generated.codingStandards}

### Architecture Guidelines

${generated.architectureNotes}
`;
  }
}
```

### Phase 4: Agent-Generation Library Alignment

Update the agent-generation library to follow the same intelligent, adaptive philosophy.

**Current Problem:**

- Templates are 50% static, 50% dynamic
- Selection is rule-based (hardcoded scoring)
- LLM can only fill pre-marked slots, not restructure content

**Target:**

- Templates provide minimal scaffolding (agent type, purpose)
- LLM generates rules based on workspace analysis
- Framework-agnostic base templates

```typescript
// libs/backend/agent-generation/src/lib/templates/base-agent-template.ts
export const BASE_AGENT_TEMPLATE = `
# {{AGENT_TYPE}} Agent

## Purpose
{{AGENT_PURPOSE}}

## Capabilities
{{CAPABILITIES}}

## Project Context
{{PROJECT_CONTEXT_SLOT}}  <!-- Filled by Prompt Designer -->

## Guidelines
{{GUIDELINES_SLOT}}  <!-- Filled by Prompt Designer based on agent type -->

## Output Format
{{OUTPUT_FORMAT}}
`;

// LLM fills slots based on:
// 1. Agent type (frontend-developer, backend-developer, etc.)
// 2. Workspace analysis (frameworks, patterns, tech stack)
// 3. Task context (what the agent is trying to accomplish)
```

---

## Implementation Batches

### Batch 1: PTAH_CORE_SYSTEM_PROMPT (Foundation) - ✅ COMPLETE

**Scope**: Create Ptah's own base system prompt

**Files:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` - NEW ✅
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-harness.service.ts` - Updated ✅
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` - Updated ✅
- `libs/backend/agent-sdk/src/lib/helpers/prompt-constants.ts` - Deprecated old prompt ✅

**Tasks:**

1. [x] Design PTAH_CORE_SYSTEM_PROMPT content (~900 tokens)
2. [x] Create comprehensive tool availability documentation
3. [x] Define behavioral rules and security guidelines
4. [x] Integrate into PromptHarnessService as foundation layer

**Note**: Kept `preset: 'claude_code'` for now (Phase 1 approach) - provides tool definitions.
The core prompt is appended via PromptHarnessService.

**Actual tokens:** ~900 tokens for core prompt

### Batch 2: Prompt Designer Agent (Intelligence) - ✅ COMPLETE

**Scope**: Create the intelligent agent that generates project-specific guidance

**Files:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/` - NEW directory ✅
  - `prompt-designer-agent.ts` ✅
  - `prompt-designer.types.ts` ✅
  - `generation-prompts.ts` ✅
  - `response-parser.ts` ✅
  - `index.ts` ✅

**Tasks:**

1. [x] Define PromptDesignerInput/Output interfaces
2. [x] Implement LLM integration (structured and text completion)
3. [x] Create generation prompt templates
4. [x] Build response parser with validation
5. [x] Add token counting and budget enforcement
6. [x] Add fallback guidance when LLM unavailable
7. [x] DI registration and exports

**Dependencies:**

- `@ptah-extension/workspace-intelligence` for project detection (input)
- `@ptah-extension/llm-abstraction` for LLM calls (LlmService)

### Batch 3: Caching & Invalidation (Performance)

**Scope**: Implement smart caching to avoid regenerating prompts unnecessarily

**Files:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-cache.service.ts` - NEW
- `libs/backend/agent-sdk/src/lib/prompt-harness/cache-invalidation.ts` - NEW

**Tasks:**

1. [ ] Design cache key structure (workspace hash + config version)
2. [ ] Implement file watcher for invalidation triggers
3. [ ] Add manual regeneration option for users
4. [ ] Set up cache persistence (VS Code globalState)

**Cache Invalidation Triggers:**

- Package.json changes (dependencies)
- Config file changes (tsconfig, angular.json, etc.)
- User-initiated "Regenerate" action
- Time-based (>7 days old)

### Batch 4: Intelligent Assembly Pipeline (Integration)

**Scope**: Orchestrate the complete prompt assembly process

**Files:**

- `libs/backend/agent-sdk/src/lib/prompt-harness/intelligent-prompt-assembler.ts` - NEW
- `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` - Update exports
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` - Add new tokens
- `libs/backend/agent-sdk/src/lib/di/register.ts` - Register services

**Tasks:**

1. [ ] Implement IntelligentPromptAssembler service
2. [ ] Integrate with PromptHarnessService (or replace it)
3. [ ] Add DI tokens and registration
4. [ ] Update SdkAgentAdapter to use new assembler

### Batch 5: Frontend - Generation Status UI

**Scope**: Show users when prompts are being generated and what was detected

**Files:**

- `libs/frontend/chat/src/lib/settings/prompt-generation-status/` - NEW
  - `prompt-generation-status.component.ts`
  - `prompt-generation-status.component.html`
- `libs/frontend/chat/src/lib/settings/settings.component.ts` - Integration

**Tasks:**

1. [ ] Create status component showing generation state
2. [ ] Display detected frameworks and patterns
3. [ ] Add "Regenerate" button for manual refresh
4. [ ] Show token budget usage
5. [ ] Preview generated guidance

### Batch 6: Agent-Generation Alignment

**Scope**: Update agent-generation library to use intelligent prompt patterns

**Files:**

- `libs/backend/agent-generation/src/lib/templates/` - Refactor templates
- `libs/backend/agent-generation/src/lib/services/intelligent-agent-builder.ts` - NEW
- `libs/backend/agent-generation/src/lib/services/template-slot-filler.ts` - NEW

**Tasks:**

1. [ ] Extract framework-specific content from templates
2. [ ] Create minimal base templates with slots
3. [ ] Implement IntelligentAgentBuilder using PromptDesignerAgent
4. [ ] Integrate with existing agent selection flow

---

## Token Budget Analysis

### Current Costs (TASK_2025_135)

| Component                        | Tokens                   |
| -------------------------------- | ------------------------ |
| `claude_code` preset (Anthropic) | ~3,000-5,000 (estimated) |
| PTAH_BEHAVIORAL_PROMPT           | ~600                     |
| Enabled power-ups (avg 2-3)      | ~400-800                 |
| Custom sections                  | Variable                 |
| **Total**                        | **~4,000-6,000**         |

### Target Costs (TASK_2025_137)

| Component                      | Tokens           |
| ------------------------------ | ---------------- |
| PTAH_CORE_SYSTEM_PROMPT        | ~600-800         |
| Generated Project Context      | ~300-400         |
| Generated Framework Guidelines | ~400-500         |
| Generated Coding Standards     | ~300-400         |
| Generated Architecture Notes   | ~300-400         |
| User Customizations            | Variable         |
| **Total**                      | **~2,000-3,000** |

**Result:** ~50% reduction in context usage while providing more relevant, project-specific guidance.

---

## Business Model Considerations

### Free Tier

- Basic workspace detection (framework, language)
- Generic guidelines (SOLID, clean code)
- Manual regeneration only
- 7-day cache retention

### Premium Tier

- Deep workspace analysis (patterns, abstractions)
- Project-specific naming conventions
- Architecture boundary enforcement
- Auto-regeneration on significant changes
- Priority LLM model for generation
- Export/import generated prompts

---

## Risk Analysis

### Technical Risks

| Risk                              | Impact | Mitigation                                 |
| --------------------------------- | ------ | ------------------------------------------ |
| LLM generates poor guidance       | Medium | Validation layer, user feedback loop       |
| Token budget exceeded             | High   | Hard budget limits, section prioritization |
| Cache invalidation too aggressive | Low    | Configurable sensitivity levels            |
| Breaking change in SDK behavior   | High   | Feature flag for gradual rollout           |

### Business Risks

| Risk                                | Impact | Mitigation                           |
| ----------------------------------- | ------ | ------------------------------------ |
| Users prefer static power-ups       | Medium | Keep power-ups as "enhancement mode" |
| Generation latency frustrates users | Medium | Background generation, progress UI   |
| Increased LLM costs                 | Medium | Caching, free tier limits            |

---

## Success Metrics

1. **Prompt Relevance**: User satisfaction with generated guidance (survey)
2. **Token Efficiency**: 40-60% reduction in system prompt tokens
3. **Generation Quality**: <5% user override/customization rate
4. **Performance**: <3s generation time for new workspaces
5. **Cache Hit Rate**: >90% for repeated sessions

---

## Dependencies

**Requires:**

- TASK_2025_135: Prompt Harness System (infrastructure)
- `@ptah-extension/workspace-intelligence`: Project detection
- `@ptah-extension/llm-abstraction`: LLM provider for generation

**Enables:**

- Dynamic sub-agent customization
- Project-aware code suggestions
- Intelligent agent selection

---

## Open Questions

1. **Hybrid Mode**: Should we keep static power-ups as an "enhancement layer" on top of generated prompts?
2. **User Control**: How much should users be able to edit/override generated guidance?
3. **Multi-Workspace**: How to handle monorepos with different projects?
4. **Generation Trigger**: When exactly should regeneration happen? (session start, workspace change, manual)

---

## References

- TASK_2025_135: Prompt Harness System (predecessor)
- `libs/backend/workspace-intelligence/CLAUDE.md`: Project detection capabilities
- `libs/backend/agent-generation/CLAUDE.md`: Current agent template system
- `libs/backend/llm-abstraction/CLAUDE.md`: LLM provider abstraction

---

## Changelog

| Date       | Author | Change                |
| ---------- | ------ | --------------------- |
| 2025-02-03 | AI     | Initial task creation |
