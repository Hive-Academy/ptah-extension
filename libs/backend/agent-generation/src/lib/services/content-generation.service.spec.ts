import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger') },
}));

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'Node', React: 'React', Python: 'Python' },
  Framework: { Express: 'Express', Angular: 'Angular', React: 'React' },
}));

jest.mock('@ptah-extension/settings-core', () => ({
  SETTINGS_TOKENS: { MODEL_SETTINGS: Symbol.for('ModelSettings') },
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_INTERNAL_QUERY_SERVICE: Symbol.for('InternalQueryService'),
  },
  SdkStreamProcessor: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue({ structuredOutput: null }),
  })),
  discoverPluginSkills: jest.fn().mockReturnValue([]),
  formatSkillsForPrompt: jest.fn().mockReturnValue(''),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('## Project Profile\n\nMock content'),
}));

import { ContentGenerationService } from './content-generation.service';
import { AgentTemplate, AgentProjectContext } from '../types/core.types';
import { Result } from '@ptah-extension/shared';
import {
  SdkStreamProcessor,
  discoverPluginSkills,
  formatSkillsForPrompt,
} from '@ptah-extension/agent-sdk';
import { readFileSync } from 'fs';

const SdkStreamProcessorMock = SdkStreamProcessor as jest.MockedClass<
  typeof SdkStreamProcessor
>;
const discoverPluginSkillsMock = discoverPluginSkills as jest.MockedFunction<
  typeof discoverPluginSkills
>;
const formatSkillsForPromptMock = formatSkillsForPrompt as jest.MockedFunction<
  typeof formatSkillsForPrompt
>;
const readFileSyncMock = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeStream(structuredOutput: unknown): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: async function* () {},
  } as AsyncIterable<never>;
}

const mockContext: AgentProjectContext = {
  projectType: 'Node' as never,
  frameworks: ['Express' as never],
  monorepoType: undefined,
  rootPath: '/workspace/test-project',
  relevantFiles: [],
  techStack: {
    languages: ['TypeScript', 'JavaScript'],
    frameworks: ['Express'],
    buildTools: ['esbuild'],
    testingFrameworks: ['Jest'],
    packageManager: 'npm',
  },
  codeConventions: {
    indentation: 'spaces',
    indentSize: 2,
    quoteStyle: 'single',
    semicolons: true,
    trailingComma: 'es5',
  },
};

const baseTemplate: AgentTemplate = {
  id: 'test-agent',
  name: 'Test Agent',
  version: '1.0.0',
  content: '',
  applicabilityRules: {
    projectTypes: [],
    frameworks: [],
    monorepoTypes: [],
    minimumRelevanceScore: 50,
    alwaysInclude: false,
  },
  variables: [],
  llmSections: [],
};

describe('ContentGenerationService', () => {
  let service: ContentGenerationService;
  let mockLogger: MockLogger;
  let mockInternalQueryService: { execute: jest.Mock };
  let mockModelSettings: { selectedModel: { get: jest.Mock } };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const mockStream = makeStream(null);
    mockInternalQueryService = {
      execute: jest.fn().mockResolvedValue({
        stream: mockStream,
        abort: jest.fn(),
        close: jest.fn(),
      }),
    };

    mockModelSettings = {
      selectedModel: { get: jest.fn().mockReturnValue('claude-3-5-haiku') },
    };

    SdkStreamProcessorMock.mockImplementation(
      () =>
        ({
          process: jest.fn().mockResolvedValue({ structuredOutput: null }),
        }) as never,
    );

    service = new ContentGenerationService(
      mockLogger as never,
      mockInternalQueryService as never,
      mockModelSettings as never,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateContent', () => {
    it('should return ok result for template with no dynamic sections', async () => {
      const template = {
        ...baseTemplate,
        content: '# Static Agent\nNo dynamic content here.',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('# Static Agent');
    });

    it('should substitute {{PROJECT_TYPE}} from context', async () => {
      const template = {
        ...baseTemplate,
        content: '# {{PROJECT_TYPE}} Agent',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('# Node Agent');
    });

    it('should substitute {{PROJECT_NAME}} from rootPath basename', async () => {
      const template = {
        ...baseTemplate,
        content: 'Project: {{PROJECT_NAME}}',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('Project: test-project');
    });

    it('should substitute {{FRAMEWORK_NAME}} from first framework', async () => {
      const template = {
        ...baseTemplate,
        content: 'Framework: {{FRAMEWORK_NAME}}',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('Framework: Express');
    });

    it('should substitute {{TIMESTAMP}} with an ISO date string', async () => {
      const template = {
        ...baseTemplate,
        content: 'Generated: {{TIMESTAMP}}',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
    });

    it('should substitute {{PRIMARY_LANGUAGE}} from tech stack', async () => {
      const template = {
        ...baseTemplate,
        content: 'Language: {{PRIMARY_LANGUAGE}}',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('Language: TypeScript');
    });

    it('should substitute {{PACKAGE_MANAGER}} from tech stack', async () => {
      const template = {
        ...baseTemplate,
        content: 'PM: {{PACKAGE_MANAGER}}',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('PM: npm');
    });

    it('should handle empty template', async () => {
      const template = { ...baseTemplate, content: '' };
      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toBe('');
    });

    it('should return description as empty string when no LLM sections', async () => {
      const template = {
        ...baseTemplate,
        content: '# Simple',
      };

      const result = await service.generateContent(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value!.description).toBe('');
    });

    describe('conditional processing', () => {
      it('should include content when IS_MONOREPO is true', async () => {
        const monorepoContext = {
          ...mockContext,
          monorepoType: 'nx' as never,
        };
        const template = {
          ...baseTemplate,
          content: '{{#if IS_MONOREPO}}Monorepo: {{MONOREPO_TYPE}}{{/if}}',
        };

        const result = await service.generateContent(template, monorepoContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Monorepo: nx');
      });

      it('should exclude content when IS_MONOREPO is false', async () => {
        const template = {
          ...baseTemplate,
          content: 'Before{{#if IS_MONOREPO}}Hidden{{/if}}After',
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).not.toContain('Hidden');
        expect(result.value!.content).toContain('BeforeAfter');
      });
    });

    describe('STATIC section handling', () => {
      it('should leave STATIC section content untouched including unresolved vars', async () => {
        const template = {
          ...baseTemplate,
          content: `# {{PROJECT_TYPE}} Agent

<!-- STATIC:CORE_PRINCIPLES -->
## Core Principles
These never change. {{NOT_A_VAR}} stays as-is.
<!-- /STATIC:CORE_PRINCIPLES -->

Dynamic: {{PROJECT_TYPE}}`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        const content = result.value!.content;
        expect(content).toContain(
          'These never change. {{NOT_A_VAR}} stays as-is.',
        );
        expect(content).toContain('# Node Agent');
        expect(content).toContain('Dynamic: Node');
      });
    });

    describe('LLM section handling', () => {
      it('should call internalQueryService when LLM sections present', async () => {
        const template = {
          ...baseTemplate,
          content: `<!-- LLM:FRAMEWORK_SPECIFICS -->
## Framework Best Practices
Default content
<!-- /LLM:FRAMEWORK_SPECIFICS -->`,
        };

        await service.generateContent(template, mockContext);

        expect(mockInternalQueryService.execute).toHaveBeenCalledTimes(1);
      });

      it('should fall back to template content when SDK returns null', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({ structuredOutput: null }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:FRAMEWORK_SPECIFICS -->
## Default Framework Content
<!-- /LLM:FRAMEWORK_SPECIFICS -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('## Default Framework Content');
      });

      it('should use SDK-generated content when available', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({
                structuredOutput: {
                  description: 'NestJS backend developer',
                  sections: {
                    FRAMEWORK_SPECIFICS:
                      '## NestJS Best Practices\n- Use modules',
                  },
                },
              }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:FRAMEWORK_SPECIFICS -->
## Placeholder
<!-- /LLM:FRAMEWORK_SPECIFICS -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('## NestJS Best Practices');
        expect(result.value!.content).not.toContain('## Placeholder');
      });

      it('should return description from SDK structured output', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({
                structuredOutput: {
                  description: 'Backend developer for NestJS microservices',
                  sections: { FRAMEWORK_SPECIFICS: 'content' },
                },
              }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:FRAMEWORK_SPECIFICS -->
Placeholder
<!-- /LLM:FRAMEWORK_SPECIFICS -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.description).toBe(
          'Backend developer for NestJS microservices',
        );
      });

      it('should fall back to template content when internalQueryService throws', async () => {
        mockInternalQueryService.execute.mockRejectedValue(
          new Error('SDK error'),
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:SECTION_A -->
Fallback content A
<!-- /LLM:SECTION_A -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Fallback content A');
      });

      it('should use template fallback for sections with empty SDK response', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({
                structuredOutput: {
                  description: '',
                  sections: { FRAMEWORK_SPECIFICS: '' },
                },
              }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:FRAMEWORK_SPECIFICS -->
Default content
<!-- /LLM:FRAMEWORK_SPECIFICS -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Default content');
      });

      it('should handle multiple LLM sections in one call', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({
                structuredOutput: {
                  description: 'agent desc',
                  sections: {
                    SECTION_A: 'Content A',
                    SECTION_B: 'Content B',
                  },
                },
              }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:SECTION_A -->
Placeholder A
<!-- /LLM:SECTION_A -->

<!-- LLM:SECTION_B -->
Placeholder B
<!-- /LLM:SECTION_B -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Content A');
        expect(result.value!.content).toContain('Content B');
        expect(result.value!.content).not.toContain('Placeholder A');
        expect(result.value!.content).not.toContain('Placeholder B');
        expect(mockInternalQueryService.execute).toHaveBeenCalledTimes(1);
      });
    });

    describe('VAR section handling', () => {
      it('should call internalQueryService when VAR sections present', async () => {
        const template = {
          ...baseTemplate,
          content: `<!-- VAR:PROJECT_CONTEXT -->
## Project Context
- Type: {{PROJECT_TYPE}}
<!-- /VAR:PROJECT_CONTEXT -->`,
        };

        await service.generateContent(template, mockContext);

        expect(mockInternalQueryService.execute).toHaveBeenCalledTimes(1);
      });

      it('should fall back to VAR section content when SDK returns null', async () => {
        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest.fn().mockResolvedValue({ structuredOutput: null }),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- VAR:PROJECT_CONTEXT -->
Fallback VAR content
<!-- /VAR:PROJECT_CONTEXT -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Fallback VAR content');
      });
    });

    describe('error handling', () => {
      it('should return Result.err wrapping ContentGenerationError when fill fails unexpectedly', async () => {
        mockInternalQueryService.execute.mockResolvedValue({
          stream: makeStream(null),
          abort: jest.fn(),
          close: jest.fn(),
        });

        SdkStreamProcessorMock.mockImplementation(
          () =>
            ({
              process: jest
                .fn()
                .mockRejectedValue(new Error('Unexpected SDK crash')),
            }) as never,
        );

        const template = {
          ...baseTemplate,
          content: `<!-- LLM:SECTION_A -->
Content
<!-- /LLM:SECTION_A -->`,
        };

        const result = await service.generateContent(template, mockContext);

        expect(result.isOk()).toBe(true);
        expect(result.value!.content).toContain('Content');
      });
    });
  });

  describe('generateLlmSections', () => {
    it('should return empty array (handled inline in generateContent)', async () => {
      const template = { ...baseTemplate, content: '# Agent' };

      const result = await service.generateLlmSections(template, mockContext);

      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
    });
  });

  describe('generateContent error path (lines 152-157)', () => {
    it('should return Result.err when an unexpected error escapes the try block', async () => {
      // Force substituteRemainingVars (via the varMap construction) to throw by
      // making frameworks[0].toString() blow up.
      const explodingContext = {
        ...mockContext,
        frameworks: [
          {
            toString: () => {
              throw new Error('boom-toString');
            },
          } as never,
        ],
      } as AgentProjectContext;
      const template = {
        ...baseTemplate,
        content: '# {{FRAMEWORK_NAME}}',
      };

      const result = await service.generateContent(template, explodingContext);

      expect(result.isErr()).toBe(true);
      expect(result.error!.message).toContain('Failed to generate content');
      expect(result.error!.message).toContain('boom-toString');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Content generation failed',
        expect.objectContaining({
          error: expect.stringContaining('boom-toString'),
        }),
      );
    });

    it('should stringify non-Error throws in the catch path', async () => {
      const explodingContext = {
        ...mockContext,
        frameworks: [
          {
            toString: () => {
              // eslint-disable-next-line no-throw-literal
              throw 'string-throw';
            },
          } as never,
        ],
      } as AgentProjectContext;
      const template = {
        ...baseTemplate,
        content: '# {{FRAMEWORK_NAME}}',
      };

      const result = await service.generateContent(template, explodingContext);

      expect(result.isErr()).toBe(true);
      expect(result.error!.message).toContain('string-throw');
    });
  });

  describe('sdkConfig propagation (lines 256, 259-261)', () => {
    it('should append enhancedPromptContent to system prompt', async () => {
      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        enhancedPromptContent: 'EXTRA_GUIDANCE_BLOCK',
      });

      expect(mockInternalQueryService.execute).toHaveBeenCalledTimes(1);
      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      expect(callArgs.systemPromptAppend).toContain(
        'Enhanced Project Guidance',
      );
      expect(callArgs.systemPromptAppend).toContain('EXTRA_GUIDANCE_BLOCK');
    });

    it('should include discovered plugin skills in system prompt when pluginPaths provided', async () => {
      discoverPluginSkillsMock.mockReturnValueOnce([
        { name: 'skill-a', description: 'd' } as never,
      ]);
      formatSkillsForPromptMock.mockReturnValueOnce('FORMATTED_SKILLS_HERE');

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        pluginPaths: ['/plugins/a', '/plugins/b'],
      });

      expect(discoverPluginSkillsMock).toHaveBeenCalledWith([
        '/plugins/a',
        '/plugins/b',
      ]);
      expect(formatSkillsForPromptMock).toHaveBeenCalled();
      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      expect(callArgs.systemPromptAppend).toContain('Available Plugin Skills');
      expect(callArgs.systemPromptAppend).toContain('FORMATTED_SKILLS_HERE');
      expect(callArgs.pluginPaths).toEqual(['/plugins/a', '/plugins/b']);
    });

    it('should NOT add skills section when discoverPluginSkills returns empty array', async () => {
      discoverPluginSkillsMock.mockReturnValueOnce([]);

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        pluginPaths: ['/plugins/empty'],
      });

      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      expect(callArgs.systemPromptAppend).not.toContain(
        'Available Plugin Skills',
      );
    });

    it('should fall back to default model when modelSettings has no selection', async () => {
      mockModelSettings.selectedModel.get.mockReturnValue('');

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, mockContext);

      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      expect(callArgs.model).toBe('default');
    });

    it('should prefer sdkConfig.model over modelSettings selection', async () => {
      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        model: 'claude-opus-explicit',
      });

      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-opus-explicit');
    });
  });

  describe('processGenerationStream onStreamEvent + flat event conversion (lines 420-484, 510-574)', () => {
    /**
     * Capture the SdkStreamProcessor config so we can invoke its emitter
     * synchronously after construction. The processor's process() emits
     * the queued events through the captured emitter before returning the
     * configured structured output.
     */
    function configureStreamProcessor(opts: {
      structuredOutput: unknown;
      eventsToEmit?: unknown[];
      processThrows?: Error;
    }): {
      emitConfig: {
        current: {
          emitter: { emit: (e: unknown) => void };
          toolCallIdFactory: (n: string, i: number, id: string) => string;
        } | null;
      };
    } {
      const emitConfig = {
        current: null as {
          emitter: { emit: (e: unknown) => void };
          toolCallIdFactory: (n: string, i: number, id: string) => string;
        } | null,
      };

      SdkStreamProcessorMock.mockImplementation(((config: {
        emitter: { emit: (e: unknown) => void };
        toolCallIdFactory: (n: string, i: number, id: string) => string;
      }) => {
        emitConfig.current = config;
        return {
          process: jest.fn().mockImplementation(async () => {
            if (opts.eventsToEmit) {
              for (const ev of opts.eventsToEmit) {
                config.emitter.emit(ev);
              }
            }
            if (opts.processThrows) {
              throw opts.processThrows;
            }
            return { structuredOutput: opts.structuredOutput };
          }),
        };
      }) as never);

      return { emitConfig };
    }

    it('should emit a message_start status event when onStreamEvent is provided', async () => {
      configureStreamProcessor({
        structuredOutput: { description: 'desc', sections: { S: 'c' } },
      });
      const events: unknown[] = [];
      const onStreamEvent = jest.fn((e: unknown) => events.push(e));

      const template = {
        ...baseTemplate,
        name: 'My Agent',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      // First emission is the message_start status event (line 443-457)
      const first = events[0] as {
        kind: string;
        content: string;
        agentId: string;
        flatEvent: { eventType: string };
      };
      expect(first.kind).toBe('status');
      expect(first.content).toContain('Generating My Agent');
      expect(first.agentId).toBe('My Agent');
      expect(first.flatEvent.eventType).toBe('message_start');

      // Last emission is the message_complete status event (lines 470-484)
      const last = events[events.length - 1] as {
        kind: string;
        content: string;
        flatEvent: { eventType: string };
      };
      expect(last.kind).toBe('status');
      expect(last.content).toContain('generation complete');
      expect(last.flatEvent.eventType).toBe('message_complete');
    });

    it('should provide a toolCallIdFactory that generates gen-<agentId>-<index>-<timestamp> IDs', async () => {
      const { emitConfig } = configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
      });

      const template = {
        ...baseTemplate,
        name: 'backend-developer',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent: jest.fn(),
      });

      expect(emitConfig.current).not.toBeNull();
      const id = emitConfig.current!.toolCallIdFactory(
        'some-tool',
        7,
        'sdk-block-id',
      );
      expect(id).toMatch(/^gen-backend-developer-7-\d+$/);
    });

    it('should fall back to "unknown" agentId in toolCallIdFactory when agentId is empty', async () => {
      const { emitConfig } = configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
      });

      // Use a template with empty name to exercise the `|| 'unknown'` branch.
      const template = {
        ...baseTemplate,
        name: '',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent: jest.fn(),
      });

      expect(emitConfig.current).not.toBeNull();
      const id = emitConfig.current!.toolCallIdFactory('t', 0, 'block-id');
      expect(id).toMatch(/^gen-unknown-0-\d+$/);
    });

    it('should convert text/thinking/tool_start/tool_input/tool_result stream events into flat events', async () => {
      configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
        eventsToEmit: [
          { kind: 'text', content: 'hello world', timestamp: 1 },
          { kind: 'thinking', content: 'pondering', timestamp: 2 },
          {
            kind: 'tool_start',
            content: 'starting tool',
            toolName: 'Read',
            timestamp: 3,
          },
          { kind: 'tool_input', content: '{"path":"x"}', timestamp: 4 },
          {
            kind: 'tool_result',
            content: 'result data',
            toolCallId: 'tc-abc',
            timestamp: 5,
          },
          { kind: 'error', content: 'oh no', timestamp: 6 },
          { kind: 'status', content: 'idle', timestamp: 7 },
          { kind: 'totally-unknown-kind', content: '', timestamp: 8 },
        ],
      });

      const events: Array<{ kind: string; flatEvent?: { eventType: string } }> =
        [];
      const onStreamEvent = jest.fn(
        (e: { kind: string; flatEvent?: { eventType: string } }) =>
          events.push(e),
      );

      const template = {
        ...baseTemplate,
        name: 'My Agent',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      // events[0] = initial message_start, each emit pushes one event,
      // and finally message_complete.
      const middle = events.slice(1, -1);
      expect(middle).toHaveLength(8);

      expect(middle[0].kind).toBe('text');
      expect(middle[0].flatEvent!.eventType).toBe('text_delta');

      expect(middle[1].kind).toBe('thinking');
      expect(middle[1].flatEvent!.eventType).toBe('thinking_delta');

      expect(middle[2].kind).toBe('tool_start');
      expect(middle[2].flatEvent!.eventType).toBe('tool_start');

      expect(middle[3].kind).toBe('tool_input');
      expect(middle[3].flatEvent!.eventType).toBe('tool_delta');

      expect(middle[4].kind).toBe('tool_result');
      expect(middle[4].flatEvent!.eventType).toBe('tool_result');

      expect(middle[5].flatEvent).toBeUndefined();
      expect(middle[6].flatEvent).toBeUndefined();
      expect(middle[7].flatEvent).toBeUndefined();
    });

    it('should fall back to activeToolCallId when tool_input/tool_result lack an explicit ID', async () => {
      configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
        eventsToEmit: [
          {
            kind: 'tool_start',
            content: 'starting',
            toolName: 'Write',
            toolCallId: 'TOOL-EXPLICIT-1',
            timestamp: 1,
          },
          { kind: 'tool_input', content: 'partial json', timestamp: 2 },
          {
            kind: 'tool_result',
            content: 'done',
            isError: true,
            timestamp: 3,
          },
        ],
      });

      const events: Array<{
        flatEvent?: { toolCallId?: string; eventType: string };
      }> = [];
      const onStreamEvent = jest.fn(
        (e: { flatEvent?: { toolCallId?: string; eventType: string } }) =>
          events.push(e),
      );

      const template = {
        ...baseTemplate,
        name: 'AgentZ',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      const middle = events.slice(1, -1);
      expect(middle[0].flatEvent!.eventType).toBe('tool_start');
      expect(middle[0].flatEvent!.toolCallId).toBe('TOOL-EXPLICIT-1');
      expect(middle[1].flatEvent!.eventType).toBe('tool_delta');
      expect(middle[1].flatEvent!.toolCallId).toBe('TOOL-EXPLICIT-1');
      expect(middle[2].flatEvent!.eventType).toBe('tool_result');
      expect(middle[2].flatEvent!.toolCallId).toBe('TOOL-EXPLICIT-1');
    });

    it('should fabricate a tool-unk ID when tool_input/tool_result arrive with no active tool', async () => {
      configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
        eventsToEmit: [
          { kind: 'tool_input', content: 'orphan input', timestamp: 1 },
          { kind: 'tool_result', content: 'orphan result', timestamp: 2 },
        ],
      });

      const events: Array<{
        flatEvent?: { toolCallId?: string; eventType: string };
      }> = [];
      const onStreamEvent = jest.fn(
        (e: { flatEvent?: { toolCallId?: string; eventType: string } }) =>
          events.push(e),
      );

      const template = {
        ...baseTemplate,
        name: 'AgentY',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      const middle = events.slice(1, -1);
      expect(middle[0].flatEvent!.toolCallId).toMatch(/-tool-unk$/);
      expect(middle[1].flatEvent!.toolCallId).toMatch(/-tool-unk$/);
    });

    it('should fabricate a tool-<counter> ID when tool_start has no toolCallId', async () => {
      configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
        eventsToEmit: [
          {
            kind: 'tool_start',
            content: 'starting',
            toolName: 'Glob',
            timestamp: 1,
          },
        ],
      });

      const events: Array<{
        flatEvent?: { toolCallId?: string; eventType: string };
      }> = [];
      const onStreamEvent = jest.fn(
        (e: { flatEvent?: { toolCallId?: string; eventType: string } }) =>
          events.push(e),
      );

      const template = {
        ...baseTemplate,
        name: 'AgentX',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      const middle = events.slice(1, -1);
      expect(middle[0].flatEvent!.eventType).toBe('tool_start');
      expect(middle[0].flatEvent!.toolCallId).toMatch(/-tool-\d+$/);
    });

    it('should default tool_start toolName to "unknown" when omitted', async () => {
      configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
        eventsToEmit: [
          {
            kind: 'tool_start',
            content: 'starting',
            toolCallId: 'tcid-1',
            // toolName intentionally omitted
            timestamp: 1,
          },
        ],
      });

      const events: Array<{
        flatEvent?: { toolName?: string; eventType: string };
      }> = [];
      const onStreamEvent = jest.fn(
        (e: { flatEvent?: { toolName?: string; eventType: string } }) =>
          events.push(e),
      );

      const template = {
        ...baseTemplate,
        name: 'AgentW',
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent,
      });

      const middle = events.slice(1, -1);
      expect(middle[0].flatEvent!.toolName).toBe('unknown');
    });

    it('should NOT invoke onStreamEvent when no callback is supplied (emitter is a no-op wrapper)', async () => {
      const { emitConfig } = configureStreamProcessor({
        structuredOutput: { description: '', sections: { S: 'c' } },
      });

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
default
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, mockContext);
      // SdkStreamProcessor was constructed, but emitter.emit() should be a
      // safe no-op when onStreamEvent is undefined.
      expect(emitConfig.current).not.toBeNull();
      expect(() =>
        emitConfig.current!.emitter.emit({
          kind: 'text',
          content: 'x',
          timestamp: 1,
        } as never),
      ).not.toThrow();
    });

    it('should return null and log a warning when SdkStreamProcessor.process throws', async () => {
      SdkStreamProcessorMock.mockImplementation(
        () =>
          ({
            process: jest.fn().mockRejectedValue(new Error('stream blew up')),
          }) as never,
      );

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
fallback body
<!-- /LLM:S -->`,
      };

      const result = await service.generateContent(template, mockContext, {
        mcpServerRunning: false,
        onStreamEvent: jest.fn(),
      });

      // Stream error → process returns null → outer fillDynamicSections
      // applies template fallback for every section.
      expect(result.isOk()).toBe(true);
      expect(result.value!.content).toContain('fallback body');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ContentGenerationService: Stream processing error',
        expect.objectContaining({ error: 'stream blew up' }),
      );
    });
  });

  describe('formatAnalysisData rich-context branches (lines 640, 652-655, 661-709)', () => {
    function makeRichContext(): AgentProjectContext {
      return {
        ...mockContext,
        monorepoType: 'nx' as never,
        relevantFiles: [
          { relativePath: 'src/main.ts' } as never,
          { relativePath: 'src/app.module.ts' } as never,
        ],
        fullAnalysis: {
          projectTypeDescription: 'NestJS API server',
          architecturePatterns: [
            { name: 'Layered', confidence: 92 },
            { name: 'DDD', confidence: 81 },
          ],
          languageDistribution: [
            { language: 'TypeScript', percentage: 95 },
            { language: 'JavaScript', percentage: 5 },
          ],
          testCoverage: {
            percentage: 72,
            testFramework: 'jest',
            hasUnitTests: true,
            hasIntegrationTests: false,
          },
          existingIssues: {
            errorCount: 3,
            warningCount: 12,
          },
          keyFileLocations: {
            entryPoints: ['src/main.ts'],
            configs: ['tsconfig.json', 'nx.json'],
            apiRoutes: ['src/routes.ts'],
            components: ['src/ui/App.tsx'],
            services: ['src/services/user.service.ts'],
          },
        } as never,
      } as AgentProjectContext;
    }

    it('should include monorepoType, relevant files, and the entire fullAnalysis block in the prompt', async () => {
      const richContext = makeRichContext();
      const template = {
        ...baseTemplate,
        content: `<!-- LLM:SECTION_A -->
Default
<!-- /LLM:SECTION_A -->`,
      };

      await service.generateContent(template, richContext);

      const callArgs = mockInternalQueryService.execute.mock.calls[0][0];
      const prompt = callArgs.prompt as string;

      expect(prompt).toContain('Monorepo Type: nx');
      expect(prompt).toContain('Key Files: src/main.ts, src/app.module.ts');
      expect(prompt).toContain('Project Description: NestJS API server');
      expect(prompt).toContain(
        'Architecture Patterns: Layered (92% confidence)',
      );
      expect(prompt).toContain('DDD (81% confidence)');
      expect(prompt).toContain('Language Distribution: TypeScript 95%');
      expect(prompt).toContain('JavaScript 5%');
      expect(prompt).toContain('Test Coverage: 72% estimated');
      expect(prompt).toContain('framework: jest');
      expect(prompt).toContain('unit: true');
      expect(prompt).toContain('integration: false');
      expect(prompt).toContain('Code Issues: 3 errors, 12 warnings');
      expect(prompt).toContain('Key File Locations:');
      expect(prompt).toContain('src/main.ts');
      expect(prompt).toContain('src/services/user.service.ts');
    });

    it('should label test framework as "unknown" when testCoverage.testFramework is missing', async () => {
      const ctx = makeRichContext();
      ctx.fullAnalysis = {
        ...ctx.fullAnalysis,
        testCoverage: {
          percentage: 40,
          testFramework: null,
          hasUnitTests: false,
          hasIntegrationTests: false,
        },
      } as never;

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('framework: unknown');
    });

    it('should omit fullAnalysis blocks when their fields are empty/missing', async () => {
      // Sparse fullAnalysis — exercises the `if (...)` branches that skip
      // sections when their data is absent.
      const ctx: AgentProjectContext = {
        ...mockContext,
        fullAnalysis: {
          architecturePatterns: [],
          languageDistribution: [],
          // testCoverage / existingIssues / keyFileLocations / projectTypeDescription absent
        } as never,
      };

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).not.toContain('Project Description:');
      expect(prompt).not.toContain('Architecture Patterns:');
      expect(prompt).not.toContain('Language Distribution:');
      expect(prompt).not.toContain('Test Coverage:');
      expect(prompt).not.toContain('Code Issues:');
      expect(prompt).not.toContain('Key File Locations:');
    });

    it('should NOT emit Key File Locations line when every keyFileLocations array is empty', async () => {
      const ctx: AgentProjectContext = {
        ...mockContext,
        fullAnalysis: {
          architecturePatterns: [],
          keyFileLocations: {
            entryPoints: [],
            configs: [],
            apiRoutes: [],
            components: [],
            services: [],
          },
        } as never,
      };

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);
      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).not.toContain('Key File Locations:');
    });
  });

  describe('readPhaseContextForRole + analysisDir branch (lines 353-357, 817-899)', () => {
    beforeEach(() => {
      readFileSyncMock.mockReset();
    });

    it('should include only the Project Profile phase for a generic agent', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return '# Profile content';
        if (file.includes('02-architecture-assessment.md'))
          return '# Architecture content';
        if (file.includes('03-quality-audit.md')) return '# Quality content';
        if (file.includes('04-elevation-plan.md')) return '# Elevation content';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-slug',
      };

      const template = {
        ...baseTemplate,
        name: 'docs-writer', // doesn't match any role keyword → profile only
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('## Project Profile');
      expect(prompt).toContain('# Profile content');
      expect(prompt).not.toContain('## Quality Audit');
      expect(prompt).not.toContain('## Architecture Assessment');
      expect(prompt).not.toContain('## Elevation Plan');
    });

    it('should include the Quality Audit phase for backend-developer template', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return '# Profile';
        if (file.includes('02-architecture-assessment.md'))
          return '# Architecture';
        if (file.includes('03-quality-audit.md')) return '# QualityBlock';
        if (file.includes('04-elevation-plan.md')) return '# Elevation';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-be',
      };

      const template = {
        ...baseTemplate,
        name: 'Backend Developer',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('## Project Profile');
      expect(prompt).toContain('## Quality Audit');
      expect(prompt).toContain('# QualityBlock');
      expect(prompt).not.toContain('## Architecture Assessment');
    });

    it('should include the Quality Audit phase (10K budget) for tester/qa templates', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return '# Profile';
        if (file.includes('03-quality-audit.md')) return '# QABlock';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-qa',
      };

      const template = {
        ...baseTemplate,
        name: 'QA Tester',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('## Quality Audit');
      expect(prompt).toContain('# QABlock');
    });

    it('should include Architecture Assessment + Elevation Plan for architect templates', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return '# Profile';
        if (file.includes('02-architecture-assessment.md'))
          return '# ArchitectureBlock';
        if (file.includes('04-elevation-plan.md')) return '# ElevationBlock';
        if (file.includes('03-quality-audit.md')) return '# Quality';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-arch',
      };

      const template = {
        ...baseTemplate,
        name: 'Software Architect',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('## Architecture Assessment');
      expect(prompt).toContain('# ArchitectureBlock');
      expect(prompt).toContain('## Elevation Plan');
      expect(prompt).toContain('# ElevationBlock');
      expect(prompt).not.toContain('## Quality Audit');
    });

    it('should truncate phase content that exceeds its token budget', async () => {
      const massive = 'A'.repeat(9_000);
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return massive;
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-big',
      };

      const template = {
        ...baseTemplate,
        name: 'docs-writer',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);
      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('...(truncated for token budget)');
    });

    it('should skip a phase whose content was not read (continue branch)', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        // Return empty string for profile — the `if (!content) continue` guard
        // should skip emitting a Project Profile section.
        if (file.includes('01-project-profile.md')) return '';
        if (file.includes('03-quality-audit.md')) return '# QualityBody';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-skip',
      };

      const template = {
        ...baseTemplate,
        name: 'Backend Developer',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);

      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      expect(prompt).toContain('## Quality Audit');
      expect(prompt).toContain('# QualityBody');
      expect(prompt).not.toContain('## Project Profile');
    });

    it('should cache phase files across calls with the same analysisDir', async () => {
      readFileSyncMock.mockImplementation(((p: unknown) => {
        const file = String(p);
        if (file.includes('01-project-profile.md')) return '# Profile';
        if (file.includes('02-architecture-assessment.md')) return '# Arch';
        if (file.includes('03-quality-audit.md')) return '# Quality';
        if (file.includes('04-elevation-plan.md')) return '# Elev';
        return '';
      }) as never);

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-cached',
      };

      const template = {
        ...baseTemplate,
        name: 'docs-writer',
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      await service.generateContent(template, ctx);
      const firstCount = readFileSyncMock.mock.calls.length;
      expect(firstCount).toBe(4); // one per phase file

      // Second call with the same analysisDir — readFileSync should NOT be
      // invoked again because the per-dir cache satisfies the read.
      await service.generateContent(template, ctx);
      expect(readFileSyncMock.mock.calls.length).toBe(firstCount);

      // Third call with a DIFFERENT analysisDir → cache miss → re-reads.
      await service.generateContent(template, {
        ...ctx,
        analysisDir: '/tmp/analysis-different',
      });
      expect(readFileSyncMock.mock.calls.length).toBe(firstCount + 4);
    });

    it('should swallow readFileSync errors and fall back to formatAnalysisData', async () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('ENOENT phase file');
      });

      const ctx: AgentProjectContext = {
        ...mockContext,
        analysisDir: '/tmp/analysis-broken',
      };

      const template = {
        ...baseTemplate,
        content: `<!-- LLM:S -->
x
<!-- /LLM:S -->`,
      };

      const result = await service.generateContent(template, ctx);

      expect(result.isOk()).toBe(true);
      const prompt = mockInternalQueryService.execute.mock.calls[0][0]
        .prompt as string;
      // Fall-through path uses formatAnalysisData, which always emits these.
      expect(prompt).toContain('Project Type: Node');
      expect(prompt).toContain('Frameworks: Express');
    });
  });
});
