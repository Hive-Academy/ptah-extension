# Orchestration Patterns

Reusable patterns for generation workflows, extracted from roocode-generator's memory bank orchestration system.

## Overview

This module provides three core patterns for building robust, composable generation pipelines:

1. **Error Accumulation** - Partial success in batch operations
2. **Generation Pipeline** - Sequential multi-phase execution
3. **Prompt Builder** - Structured LLM prompt construction

All patterns use Ptah's `Result` type for type-safe error handling.

## Pattern 1: Error Accumulation

**Problem**: When generating multiple items (agents, files, documents), you want to maximize successful outputs rather than failing the entire batch on the first error.

**Solution**: `generateWithPartialSuccess()` executes all generation tasks and collects both successes and failures.

### When to Use

- Generating multiple independent items (agents, templates, files)
- Maximizing successful outputs is more important than all-or-nothing execution
- Need detailed error reporting per item
- Want to continue processing even when individual items fail

### When NOT to Use

- Sequential dependencies between items (use Generation Pipeline instead)
- Need transactional all-or-nothing behavior
- Single item generation (no batch to accumulate over)

### Usage Example

```typescript
import { generateWithPartialSuccess } from '@ptah-extension/agent-generation';
import { Result } from '@ptah-extension/shared';

// Generate multiple agents
const agentNames = ['backend-developer', 'frontend-developer', 'tester'];

const result = await generateWithPartialSuccess(
  agentNames,
  async (agentName) => {
    const content = await generateAgentContent(agentName);
    return content.isOk() ? Result.ok({ name: agentName, content: content.value }) : Result.err(content.error);
  },
  'agent-generation'
);

console.log(`Generated ${result.successful.length} agents`);

if (result.errors.length > 0) {
  console.error(`Failed to generate ${result.errors.length} agents:`);
  result.errors.forEach((err) => {
    console.error(`- ${err.item}: ${err.error.message} (phase: ${err.phase})`);
  });
}

// Use successful results
await writeAgentFiles(result.successful);
```

### Real-World Example: Memory Bank Files

```typescript
const fileTypes = ['architecture', 'codebase', 'development', 'product'];

const result = await generateWithPartialSuccess(
  fileTypes,
  async (fileType) => {
    // Multi-phase generation for each file
    const template = await loadTemplate(fileType);
    if (template.isErr()) return template;

    const content = await generateContent(template.value);
    if (content.isErr()) return content;

    const written = await writeFile(fileType, content.value);
    return written;
  },
  'file-generation'
);

// Even if 'codebase' fails, we still get 'architecture', 'development', 'product'
console.log(`Generated ${result.successful.length}/${fileTypes.length} files`);
```

## Pattern 2: Generation Pipeline

**Problem**: Generation workflows often have multiple sequential phases (template loading → content generation → file writing), where each phase depends on the previous phase's output.

**Solution**: `GenerationPipeline` provides a fluent API for composing sequential phases with automatic error propagation.

### When to Use

- Multi-step generation with sequential dependencies
- Need to track which phase failed
- Want composable, testable phases
- Need execution duration tracking
- Fail-fast behavior desired (stop on first error)

### When NOT to Use

- Independent parallel operations (use Promise.all instead)
- Need to continue on error (use Error Accumulation instead)
- Single-phase operation (unnecessary overhead)

### Usage Example

```typescript
import { GenerationPipeline } from '@ptah-extension/agent-generation';
import { Result } from '@ptah-extension/shared';

interface AgentGenerationContext {
  agentName: string;
  template?: string;
  content?: string;
  filePath?: string;
}

const pipeline = new GenerationPipeline<AgentGenerationContext>()
  .addPhase({
    name: 'load-template',
    execute: async (ctx) => {
      const template = await templateLoader.load(ctx.agentName);
      return template.isOk() ? Result.ok({ ...ctx, template: template.value }) : Result.err(template.error);
    },
  })
  .addPhase({
    name: 'generate-content',
    execute: async (ctx) => {
      const content = await llmAgent.generate(ctx.template!, ctx);
      return content.isOk() ? Result.ok({ ...ctx, content: content.value }) : Result.err(content.error);
    },
  })
  .addPhase({
    name: 'write-file',
    execute: async (ctx) => {
      const result = await fs.writeFile(ctx.filePath!, ctx.content!);
      return result.isOk() ? Result.ok(ctx) : Result.err(result.error);
    },
  });

const result = await pipeline.execute({
  agentName: 'backend-developer',
  filePath: '.claude/agents/backend-developer.md',
});

if (result.error) {
  console.error(`Pipeline failed at phase: ${result.failedPhase}`);
  console.error(result.error.message);
} else {
  console.log(`Agent generated in ${result.durationMs}ms`);
}
```

### Combining with Error Accumulation

```typescript
// Use pipeline for each item's multi-phase generation
// Use error accumulation for batch processing

const agentNames = ['backend-developer', 'frontend-developer'];

const result = await generateWithPartialSuccess(
  agentNames,
  async (agentName) => {
    const pipelineResult = await agentPipeline.execute({ agentName });
    return pipelineResult.error ? Result.err(pipelineResult.error) : Result.ok(pipelineResult.result!);
  },
  'agent-generation'
);

// Now you have:
// - Partial success across multiple agents
// - Per-agent error details with failed phase information
// - Detailed execution metrics per agent
```

## Pattern 3: Prompt Builder

**Problem**: Building LLM prompts requires consistent structure (system prompt + user prompt), context serialization, and template integration. Duplication and inconsistency are common.

**Solution**: `BasePromptBuilder` provides abstract base class with common utilities and enforces consistent prompt structure.

### When to Use

- Building prompts for LLM-based generation
- Need separation between system instructions (role/behavior) and user instructions (task/data)
- Want reusable context formatting
- Multiple prompt types in same system (agents, memory banks, docs)

### When NOT to Use

- Simple static prompts (no abstraction needed)
- No context data to serialize
- Single prompt type (inheritance not needed)

### Usage Example

```typescript
import { BasePromptBuilder } from '@ptah-extension/agent-generation';

interface AgentContext {
  agentName: string;
  role: string;
  capabilities: string[];
  projectType: string;
}

class AgentPromptBuilder extends BasePromptBuilder<AgentContext> {
  buildSystemPrompt(context: AgentContext): string {
    return `You are an expert AI agent designer specializing in ${context.projectType} projects.
Your task is to create a comprehensive agent definition that follows best practices for
agent architecture and capabilities.

Format the output as valid Markdown with YAML frontmatter.`;
  }

  buildUserPrompt(context: AgentContext, template?: string): string {
    const instructions = `Generate an agent definition for: ${context.agentName}

Role: ${context.role}

Capabilities:
${context.capabilities.map((c) => `- ${c}`).join('\n')}

PROJECT CONTEXT:
${this.formatContextAsJson(context)}`;

    return template ? `${instructions}\n\nTEMPLATE:\n${template}` : instructions;
  }
}

// Usage
const builder = new AgentPromptBuilder();
const systemPrompt = builder.buildSystemPrompt(agentContext);
const userPrompt = builder.buildUserPrompt(agentContext, templateContent);

// Send to LLM
const response = await llmAgent.getCompletion(systemPrompt, userPrompt);
```

### Real-World Example: Memory Bank Generation

```typescript
class MemoryBankPromptBuilder extends BasePromptBuilder<ProjectContext> {
  constructor(private fileType: string) {
    super();
  }

  buildSystemPrompt(context: ProjectContext): string {
    return `You are an expert technical writer specializing in software documentation.
Your task is to populate the provided Markdown template using the structured PROJECT CONTEXT data.
You MUST strictly follow the instructions embedded in HTML comments (\`<!-- LLM: ... -->\`) within
the template to guide content generation and data selection.
Adhere precisely to the template's structure and formatting.`;
  }

  buildUserPrompt(context: ProjectContext, template?: string): string {
    const instructions = `Generate the content for the ${this.fileType} document.
You have been provided with the full structured PROJECT CONTEXT DATA for the project.
Use this data as directed by the \`<!-- LLM: ... -->\` instructions embedded within
the TEMPLATE section.`;

    const contextData = `PROJECT CONTEXT DATA:\n\n${this.formatContextAsJson(context)}`;

    return `${instructions}\n\n${contextData}\n\nTEMPLATE:\n${template}`;
  }
}

// Usage for different file types
const architectureBuilder = new MemoryBankPromptBuilder('architecture');
const codebaseBuilder = new MemoryBankPromptBuilder('codebase');

// Each builder creates specialized prompts for its file type
const archPrompts = {
  system: architectureBuilder.buildSystemPrompt(projectContext),
  user: architectureBuilder.buildUserPrompt(projectContext, archTemplate),
};
```

## Pattern Composition

These patterns are designed to be composed together:

```typescript
// 1. Define pipeline for single agent
const agentPipeline = new GenerationPipeline<AgentContext>()
  .addPhase({
    name: 'build-prompts',
    execute: async (ctx) => {
      const builder = new AgentPromptBuilder();
      const systemPrompt = builder.buildSystemPrompt(ctx);
      const userPrompt = builder.buildUserPrompt(ctx, ctx.template);
      return Result.ok({ ...ctx, systemPrompt, userPrompt });
    },
  })
  .addPhase({
    name: 'generate-content',
    execute: async (ctx) => {
      const content = await llm.generate(ctx.systemPrompt!, ctx.userPrompt!);
      return content.isOk() ? Result.ok({ ...ctx, content: content.value }) : Result.err(content.error);
    },
  })
  .addPhase({
    name: 'write-file',
    execute: async (ctx) => {
      const result = await fs.writeFile(ctx.filePath!, ctx.content!);
      return result.isOk() ? Result.ok(ctx) : Result.err(result.error);
    },
  });

// 2. Use error accumulation for batch
const agentNames = ['backend-developer', 'frontend-developer', 'tester'];

const result = await generateWithPartialSuccess(
  agentNames,
  async (agentName) => {
    const pipelineResult = await agentPipeline.execute({
      agentName,
      role: getRoleForAgent(agentName),
      capabilities: getCapabilitiesForAgent(agentName),
      projectType: 'vscode-extension',
      template: await loadTemplate(agentName),
      filePath: `.claude/agents/${agentName}.md`,
    });

    return pipelineResult.error ? Result.err(pipelineResult.error) : Result.ok(pipelineResult.result!);
  },
  'agent-generation'
);

// 3. Handle results
console.log(`Generated ${result.successful.length}/${agentNames.length} agents`);

if (result.errors.length > 0) {
  console.error('Failed agents:');
  result.errors.forEach((err) => {
    console.error(`- ${err.item}: ${err.error.message}`);
  });
}
```

## Testing Patterns

### Testing Error Accumulation

```typescript
describe('generateWithPartialSuccess', () => {
  it('should collect successful results', async () => {
    const result = await generateWithPartialSuccess(['item1', 'item2'], async (item) => Result.ok({ name: item }), 'test-phase');

    expect(result.successful).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.isComplete).toBe(true);
  });

  it('should accumulate errors without failing', async () => {
    const result = await generateWithPartialSuccess(
      ['item1', 'item2', 'item3'],
      async (item) => {
        if (item === 'item2') {
          return Result.err(new Error('Item 2 failed'));
        }
        return Result.ok({ name: item });
      },
      'test-phase'
    );

    expect(result.successful).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].item).toBe('item2');
    expect(result.isComplete).toBe(false);
  });
});
```

### Testing Generation Pipeline

```typescript
describe('GenerationPipeline', () => {
  it('should execute phases sequentially', async () => {
    const executionOrder: string[] = [];

    const pipeline = new GenerationPipeline<{ value: number }>()
      .addPhase({
        name: 'phase1',
        execute: async (ctx) => {
          executionOrder.push('phase1');
          return Result.ok({ value: ctx.value + 1 });
        },
      })
      .addPhase({
        name: 'phase2',
        execute: async (ctx) => {
          executionOrder.push('phase2');
          return Result.ok({ value: ctx.value * 2 });
        },
      });

    const result = await pipeline.execute({ value: 5 });

    expect(result.result?.value).toBe(12); // (5 + 1) * 2
    expect(executionOrder).toEqual(['phase1', 'phase2']);
  });

  it('should stop on first error', async () => {
    const pipeline = new GenerationPipeline<{ value: number }>()
      .addPhase({
        name: 'phase1',
        execute: async (ctx) => Result.ok({ value: ctx.value + 1 }),
      })
      .addPhase({
        name: 'phase2',
        execute: async () => Result.err(new Error('Phase 2 failed')),
      })
      .addPhase({
        name: 'phase3',
        execute: async (ctx) => Result.ok({ value: ctx.value * 2 }),
      });

    const result = await pipeline.execute({ value: 5 });

    expect(result.error).toBeDefined();
    expect(result.failedPhase).toBe('phase2');
    expect(result.result).toBeUndefined();
  });
});
```

### Testing Prompt Builder

````typescript
describe('BasePromptBuilder', () => {
  class TestPromptBuilder extends BasePromptBuilder<{ name: string }> {
    buildSystemPrompt(context: { name: string }): string {
      return `System prompt for ${context.name}`;
    }

    buildUserPrompt(context: { name: string }, template?: string): string {
      return `User prompt: ${this.formatContextAsJson(context)}${template ? `\n${template}` : ''}`;
    }
  }

  it('should format context as JSON', () => {
    const builder = new TestPromptBuilder();
    const userPrompt = builder.buildUserPrompt({ name: 'test' });

    expect(userPrompt).toContain('```json');
    expect(userPrompt).toContain('"name": "test"');
  });

  it('should build combined prompt', () => {
    const builder = new TestPromptBuilder();
    const combined = builder.buildCombinedPrompt({ name: 'test' });

    expect(combined).toContain('System prompt for test');
    expect(combined).toContain('---');
    expect(combined).toContain('User prompt:');
  });
});
````

## Design Principles

### Composability

All patterns are designed to work together:

- Error Accumulation handles batch-level failures
- Generation Pipeline handles item-level phases
- Prompt Builder handles phase-level content generation

### Type Safety

All patterns use TypeScript generics for type safety:

- Generic context types flow through pipelines
- Error types are constrained to `Error` subclasses
- Phase types enforce input/output compatibility

### Explicit Error Handling

All patterns use `Result` type from `@ptah-extension/shared`:

- No thrown exceptions in normal operation
- Errors are values to be handled
- Forces explicit error handling

### Testability

All patterns are pure and testable:

- No hidden dependencies
- Clear input/output contracts
- Easy to mock dependencies

## Origin

These patterns were extracted from the [roocode-generator](D:\projects\roocode-generator\) project's memory bank orchestration system:

- **Error Accumulation**: `memory-bank-orchestrator.ts` lines 76-223
- **Generation Pipeline**: Implicit in orchestrator's sequential phase execution
- **Prompt Builder**: `memory-bank-content-generator.ts` lines 154-183

The patterns have been generalized and adapted to Ptah's architecture and type system.
