import { Result } from '@ptah-extension/shared';
import {
  generateWithPartialSuccess,
  GenerationErrorDetails,
  PartialSuccessResult,
} from './error-accumulation';
import { GenerationPipeline, PipelineResult } from './generation-pipeline';
import { BasePromptBuilder } from './prompt-builder';

describe('Orchestration Patterns', () => {
  describe('generateWithPartialSuccess', () => {
    it('should collect all successful results when no errors occur', async () => {
      const items = ['item1', 'item2', 'item3'];

      const result = await generateWithPartialSuccess(
        items,
        async (item) => Result.ok({ name: item, processed: true }),
        'test-phase'
      );

      expect(result.successful).toHaveLength(3);
      expect(result.successful[0]).toEqual({ name: 'item1', processed: true });
      expect(result.successful[1]).toEqual({ name: 'item2', processed: true });
      expect(result.successful[2]).toEqual({ name: 'item3', processed: true });
      expect(result.errors).toHaveLength(0);
      expect(result.isComplete).toBe(true);
    });

    it('should accumulate errors without failing entire batch', async () => {
      const items = ['item1', 'item2', 'item3'];

      const result = await generateWithPartialSuccess(
        items,
        async (item) => {
          if (item === 'item2') {
            return Result.err(new Error('Item 2 failed'));
          }
          return Result.ok({ name: item, processed: true });
        },
        'test-phase'
      );

      expect(result.successful).toHaveLength(2);
      expect(result.successful[0].name).toBe('item1');
      expect(result.successful[1].name).toBe('item3');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].item).toBe('item2');
      expect(result.errors[0].error.message).toBe('Item 2 failed');
      expect(result.errors[0].phase).toBe('test-phase');
      expect(result.isComplete).toBe(false);
    });

    it('should handle all items failing', async () => {
      const items = ['item1', 'item2'];

      const result = await generateWithPartialSuccess(
        items,
        async (item) => Result.err(new Error(`${item} failed`)),
        'test-phase'
      );

      expect(result.successful).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].item).toBe('item1');
      expect(result.errors[1].item).toBe('item2');
      expect(result.isComplete).toBe(false);
    });

    it('should handle empty items array', async () => {
      const result = await generateWithPartialSuccess(
        [],
        async (item) => Result.ok({ name: item }),
        'test-phase'
      );

      expect(result.successful).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.isComplete).toBe(true);
    });

    it('should correctly mark isComplete based on error presence', async () => {
      const noErrorsResult = await generateWithPartialSuccess(
        ['item1'],
        async (item) => Result.ok({ name: item }),
        'test-phase'
      );
      expect(noErrorsResult.isComplete).toBe(true);

      const withErrorsResult = await generateWithPartialSuccess(
        ['item1'],
        async () => Result.err(new Error('Failed')),
        'test-phase'
      );
      expect(withErrorsResult.isComplete).toBe(false);
    });

    it('should preserve error details with correct phase', async () => {
      type TestPhase = 'template-processing' | 'content-generation';

      const result = await generateWithPartialSuccess<unknown, TestPhase>(
        ['test-item'],
        async () => Result.err(new Error('Generation failed')),
        'content-generation'
      );

      expect(result.errors[0].phase).toBe('content-generation');
    });

    it('should execute async generation function for each item', async () => {
      const executionOrder: string[] = [];

      await generateWithPartialSuccess(
        ['a', 'b', 'c'],
        async (item) => {
          executionOrder.push(item);
          return Result.ok({ item });
        },
        'test-phase'
      );

      expect(executionOrder).toEqual(['a', 'b', 'c']);
    });
  });

  describe('GenerationPipeline', () => {
    it('should execute phases sequentially', async () => {
      const executionOrder: string[] = [];

      const pipeline = new GenerationPipeline<{ value: number }>()
        .addPhase({
          name: 'phase1',
          execute: async (ctx: { value: number }) => {
            executionOrder.push('phase1');
            return Result.ok({ value: ctx.value + 10 });
          },
        })
        .addPhase({
          name: 'phase2',
          execute: async (ctx: { value: number }) => {
            executionOrder.push('phase2');
            return Result.ok({ value: ctx.value * 2 });
          },
        })
        .addPhase({
          name: 'phase3',
          execute: async (ctx: { value: number }) => {
            executionOrder.push('phase3');
            return Result.ok({ value: ctx.value - 5 });
          },
        });

      const result = await pipeline.execute({ value: 5 });

      expect(executionOrder).toEqual(['phase1', 'phase2', 'phase3']);
      expect(result.result?.value).toBe(25); // ((5 + 10) * 2) - 5
      expect(result.error).toBeUndefined();
      expect(result.failedPhase).toBeUndefined();
    });

    it('should stop on first error and report failed phase', async () => {
      const executionOrder: string[] = [];

      const pipeline = new GenerationPipeline<{ value: number }>()
        .addPhase({
          name: 'phase1',
          execute: async (ctx: { value: number }) => {
            executionOrder.push('phase1');
            return Result.ok({ value: ctx.value + 1 });
          },
        })
        .addPhase({
          name: 'phase2',
          execute: async () => {
            executionOrder.push('phase2');
            return Result.err(new Error('Phase 2 failed'));
          },
        })
        .addPhase({
          name: 'phase3',
          execute: async (ctx: { value: number }) => {
            executionOrder.push('phase3');
            return Result.ok({ value: ctx.value * 2 });
          },
        });

      const result = await pipeline.execute({ value: 5 });

      expect(executionOrder).toEqual(['phase1', 'phase2']); // phase3 never executed
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Phase 2 failed');
      expect(result.failedPhase).toBe('phase2');
      expect(result.result).toBeUndefined();
    });

    it('should track execution duration', async () => {
      const pipeline = new GenerationPipeline<{ value: number }>().addPhase({
        name: 'delay-phase',
        execute: async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return Result.ok(ctx);
        },
      });

      const result = await pipeline.execute({ value: 1 });

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
      expect(result.durationMs).toBeLessThan(200); // Reasonable upper bound
    });

    it('should handle empty pipeline', async () => {
      const pipeline = new GenerationPipeline<{ value: number }>();

      const result = await pipeline.execute({ value: 42 });

      expect(result.result).toEqual({ value: 42 });
      expect(result.error).toBeUndefined();
      expect(result.failedPhase).toBeUndefined();
    });

    it('should pass context through phases', async () => {
      interface TestContext {
        value: number;
        multiplier?: number;
        result?: number;
      }

      const pipeline = new GenerationPipeline<TestContext>()
        .addPhase({
          name: 'set-multiplier',
          execute: async (ctx: TestContext) =>
            Result.ok({ ...ctx, multiplier: 3 }),
        })
        .addPhase({
          name: 'calculate',
          execute: async (ctx: TestContext) =>
            Result.ok({
              ...ctx,
              result: ctx.value * ctx.multiplier!,
            }),
        });

      const result = await pipeline.execute({ value: 7 });

      expect(result.result?.multiplier).toBe(3);
      expect(result.result?.result).toBe(21);
    });

    it('should support method chaining', () => {
      const pipeline = new GenerationPipeline<{ value: number }>()
        .addPhase({
          name: 'phase1',
          execute: async (ctx) => Result.ok(ctx),
        })
        .addPhase({
          name: 'phase2',
          execute: async (ctx) => Result.ok(ctx),
        });

      expect(pipeline).toBeInstanceOf(GenerationPipeline);
    });

    it('should handle errors in first phase', async () => {
      const pipeline = new GenerationPipeline<{ value: number }>().addPhase({
        name: 'failing-phase',
        execute: async () => Result.err(new Error('First phase failed')),
      });

      const result = await pipeline.execute({ value: 1 });

      expect(result.error?.message).toBe('First phase failed');
      expect(result.failedPhase).toBe('failing-phase');
    });

    it('should handle errors in last phase', async () => {
      const pipeline = new GenerationPipeline<{ value: number }>()
        .addPhase({
          name: 'phase1',
          execute: async (ctx) => Result.ok(ctx),
        })
        .addPhase({
          name: 'phase2',
          execute: async (ctx) => Result.ok(ctx),
        })
        .addPhase({
          name: 'failing-phase',
          execute: async () => Result.err(new Error('Last phase failed')),
        });

      const result = await pipeline.execute({ value: 1 });

      expect(result.error?.message).toBe('Last phase failed');
      expect(result.failedPhase).toBe('failing-phase');
    });
  });

  describe('BasePromptBuilder', () => {
    interface TestContext {
      name: string;
      id: number;
      tags: string[];
    }

    class TestPromptBuilder extends BasePromptBuilder<TestContext> {
      buildSystemPrompt(context: TestContext): string {
        return `You are a test assistant for ${context.name}`;
      }

      buildUserPrompt(context: TestContext, template?: string): string {
        const contextJson = this.formatContextAsJson(context);
        return template
          ? `Generate content:\n\n${contextJson}\n\nTEMPLATE:\n${template}`
          : `Generate content:\n\n${contextJson}`;
      }
    }

    it('should format context as JSON wrapped in markdown code block', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = { name: 'test', id: 123, tags: ['a', 'b'] };

      const userPrompt = builder.buildUserPrompt(context);

      expect(userPrompt).toContain('```json');
      expect(userPrompt).toContain('"name": "test"');
      expect(userPrompt).toContain('"id": 123');
      expect(userPrompt).toContain('"tags": [');
      expect(userPrompt).toContain('"a"');
      expect(userPrompt).toContain('```');
    });

    it('should build system prompt correctly', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = { name: 'TestBot', id: 1, tags: [] };

      const systemPrompt = builder.buildSystemPrompt(context);

      expect(systemPrompt).toBe('You are a test assistant for TestBot');
    });

    it('should build user prompt without template', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = { name: 'test', id: 1, tags: [] };

      const userPrompt = builder.buildUserPrompt(context);

      expect(userPrompt).toContain('Generate content:');
      expect(userPrompt).toContain('```json');
      expect(userPrompt).not.toContain('TEMPLATE:');
    });

    it('should build user prompt with template', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = { name: 'test', id: 1, tags: [] };
      const template = '# Template Header\n\n{{content}}';

      const userPrompt = builder.buildUserPrompt(context, template);

      expect(userPrompt).toContain('Generate content:');
      expect(userPrompt).toContain('```json');
      expect(userPrompt).toContain('TEMPLATE:');
      expect(userPrompt).toContain('# Template Header');
    });

    it('should build combined prompt with separator', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = { name: 'test', id: 1, tags: [] };
      const template = '# Template';

      const combined = builder.buildCombinedPrompt(context, template);

      expect(combined).toContain('You are a test assistant for test');
      expect(combined).toContain('---');
      expect(combined).toContain('Generate content:');
      expect(combined).toContain('TEMPLATE:');

      // Verify order: system -> separator -> user
      const systemIndex = combined.indexOf('You are a test assistant');
      const separatorIndex = combined.indexOf('---');
      const userIndex = combined.indexOf('Generate content:');
      expect(systemIndex).toBeLessThan(separatorIndex);
      expect(separatorIndex).toBeLessThan(userIndex);
    });

    it('should handle complex nested context', () => {
      interface ComplexContext {
        user: { name: string; email: string };
        settings: { theme: string; notifications: boolean };
      }

      class ComplexPromptBuilder extends BasePromptBuilder<ComplexContext> {
        buildSystemPrompt(): string {
          return 'System prompt';
        }

        buildUserPrompt(context: ComplexContext): string {
          return this.formatContextAsJson(context);
        }
      }

      const builder = new ComplexPromptBuilder();
      const context: ComplexContext = {
        user: { name: 'John', email: 'john@example.com' },
        settings: { theme: 'dark', notifications: true },
      };

      const userPrompt = builder.buildUserPrompt(context);

      expect(userPrompt).toContain('"user": {');
      expect(userPrompt).toContain('"name": "John"');
      expect(userPrompt).toContain('"email": "john@example.com"');
      expect(userPrompt).toContain('"settings": {');
      expect(userPrompt).toContain('"theme": "dark"');
      expect(userPrompt).toContain('"notifications": true');
    });

    it('should pretty-print JSON with indentation', () => {
      const builder = new TestPromptBuilder();
      const context: TestContext = {
        name: 'test',
        id: 1,
        tags: ['tag1', 'tag2'],
      };

      const userPrompt = builder.buildUserPrompt(context);

      // Check for proper indentation (2 spaces)
      expect(userPrompt).toMatch(/"name": "test"/);
      expect(userPrompt).toMatch(/ {2}"id": 1/);
      expect(userPrompt).toMatch(/ {2}"tags": \[/);
    });
  });

  describe('Pattern Integration', () => {
    it('should compose pipeline with prompt builder', async () => {
      interface AgentContext {
        agentName: string;
        systemPrompt?: string;
        userPrompt?: string;
        content?: string;
      }

      class AgentPromptBuilder extends BasePromptBuilder<AgentContext> {
        buildSystemPrompt(context: AgentContext): string {
          return `Generate agent: ${context.agentName}`;
        }

        buildUserPrompt(context: AgentContext): string {
          return `Instructions for ${context.agentName}`;
        }
      }

      const builder = new AgentPromptBuilder();

      const pipeline = new GenerationPipeline<AgentContext>()
        .addPhase({
          name: 'build-prompts',
          execute: async (ctx: AgentContext) => {
            const systemPrompt = builder.buildSystemPrompt(ctx);
            const userPrompt = builder.buildUserPrompt(ctx);
            return Result.ok({ ...ctx, systemPrompt, userPrompt });
          },
        })
        .addPhase({
          name: 'generate-content',
          execute: async (ctx: AgentContext) => {
            // Simulate LLM generation
            const content = `Generated content for ${ctx.agentName}`;
            return Result.ok({ ...ctx, content });
          },
        });

      const result = await pipeline.execute({ agentName: 'test-agent' });

      expect(result.result?.systemPrompt).toContain(
        'Generate agent: test-agent'
      );
      expect(result.result?.userPrompt).toContain(
        'Instructions for test-agent'
      );
      expect(result.result?.content).toContain(
        'Generated content for test-agent'
      );
    });

    it('should compose error accumulation with pipeline', async () => {
      interface ItemContext {
        itemName: string;
        processed?: boolean;
      }

      const itemPipeline = new GenerationPipeline<ItemContext>()
        .addPhase({
          name: 'validate',
          execute: async (ctx: ItemContext) => {
            if (ctx.itemName === 'invalid') {
              return Result.err(new Error('Invalid item'));
            }
            return Result.ok(ctx);
          },
        })
        .addPhase({
          name: 'process',
          execute: async (ctx: ItemContext) =>
            Result.ok({ ...ctx, processed: true }),
        });

      const items = ['item1', 'invalid', 'item3'];

      const result = await generateWithPartialSuccess(
        items,
        async (itemName) => {
          const pipelineResult = await itemPipeline.execute({ itemName });
          return pipelineResult.error
            ? Result.err(pipelineResult.error)
            : Result.ok(pipelineResult.result!);
        },
        'batch-processing'
      );

      expect(result.successful).toHaveLength(2);
      expect(result.successful[0].itemName).toBe('item1');
      expect(result.successful[0].processed).toBe(true);
      expect(result.successful[1].itemName).toBe('item3');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].item).toBe('invalid');
    });
  });
});
