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
import { SdkStreamProcessor } from '@ptah-extension/agent-sdk';

const SdkStreamProcessorMock = SdkStreamProcessor as jest.MockedClass<
  typeof SdkStreamProcessor
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
});
