import 'reflect-metadata';
import { PromptDesignerAgent } from './prompt-designer-agent';
import type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptGenerationProgress,
} from './prompt-designer.types';

jest.mock('./generation-prompts', () => ({
  PROMPT_DESIGNER_SYSTEM_PROMPT: 'mock system prompt',
  buildGenerationUserPrompt: jest.fn().mockReturnValue('mock user prompt'),
  buildFallbackGuidance: jest
    .fn()
    .mockReturnValue(
      '## Project Context\nMock context\n\n## Framework Guidelines\nMock guidelines\n\n## Coding Standards\nMock standards\n\n## Architecture Notes\nMock notes',
    ),
  buildQualityContextPrompt: jest.fn().mockReturnValue('mock quality context'),
}));

jest.mock('./response-parser', () => ({
  parseStructuredResponse: jest.fn().mockResolvedValue({
    projectContext: 'LLM project context',
    frameworkGuidelines: 'LLM guidelines',
    codingStandards: 'LLM standards',
    architectureNotes: 'LLM notes',
    generatedAt: Date.now(),
    totalTokens: 500,
    tokenBreakdown: {
      projectContext: 125,
      frameworkGuidelines: 125,
      codingStandards: 125,
      architectureNotes: 125,
    },
  }),
  parseTextResponse: jest.fn().mockResolvedValue(null),
  validateOutput: jest.fn().mockReturnValue({ valid: true, issues: [] }),
  formatAsPromptSection: jest.fn().mockReturnValue('formatted prompt section'),
  truncateToTokenBudget: jest.fn((text: string) => text),
}));

const generationPrompts = jest.requireMock('./generation-prompts') as {
  buildGenerationUserPrompt: jest.Mock;
  buildFallbackGuidance: jest.Mock;
  buildQualityContextPrompt: jest.Mock;
};

const responseParser = jest.requireMock('./response-parser') as {
  parseStructuredResponse: jest.Mock;
  validateOutput: jest.Mock;
  formatAsPromptSection: jest.Mock;
  truncateToTokenBudget: jest.Mock;
};

describe('PromptDesignerAgent', () => {
  let agent: PromptDesignerAgent;
  let mockLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  const baseInput: PromptDesignerInput = {
    workspacePath: '/test/workspace',
    projectType: 'Node',
    framework: 'NestJS',
    isMonorepo: false,
    dependencies: ['@nestjs/core'],
    devDependencies: ['jest'],
    includeQualityGuidance: false,
  };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    agent = new PromptDesignerAgent(mockLogger as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
    generationPrompts.buildGenerationUserPrompt.mockReturnValue(
      'mock user prompt',
    );
  });

  describe('buildPrompts', () => {
    it('should return systemPrompt, userPrompt, and outputSchema', async () => {
      const result = await agent.buildPrompts(baseInput);

      expect(result.systemPrompt).toBe('mock system prompt');
      expect(result.userPrompt).toBe('mock user prompt');
      expect(result.outputSchema).toBeDefined();
      expect(typeof result.outputSchema).toBe('object');
    });

    it('should call buildGenerationUserPrompt with input', async () => {
      await agent.buildPrompts(baseInput);

      expect(generationPrompts.buildGenerationUserPrompt).toHaveBeenCalledWith(
        baseInput,
        undefined,
      );
    });

    it('should pass pre-existing qualityContext when provided', async () => {
      const qualityContext = 'pre-built quality context';
      await agent.buildPrompts(baseInput, qualityContext);

      expect(generationPrompts.buildGenerationUserPrompt).toHaveBeenCalledWith(
        baseInput,
        qualityContext,
      );
    });

    it('should build quality context from qualityAssessment and prescriptiveGuidance when present', async () => {
      const qualityAssessment = {
        score: 60,
        antiPatterns: [],
        recommendations: [],
      } as never;
      const prescriptiveGuidance = { rules: [] } as never;
      const inputWithQuality: PromptDesignerInput = {
        ...baseInput,
        qualityAssessment,
        prescriptiveGuidance,
      };

      await agent.buildPrompts(inputWithQuality);

      expect(generationPrompts.buildQualityContextPrompt).toHaveBeenCalledWith(
        qualityAssessment,
        prescriptiveGuidance,
      );
    });

    it('should return qualityAssessment from input if present', async () => {
      const qualityAssessment = {
        score: 80,
        antiPatterns: [],
        recommendations: [],
      } as never;
      const inputWithQuality: PromptDesignerInput = {
        ...baseInput,
        qualityAssessment,
      };

      const result = await agent.buildPrompts(inputWithQuality);

      expect(result.qualityAssessment).toBe(qualityAssessment);
    });

    it('should include outputSchema with required fields', async () => {
      const result = await agent.buildPrompts(baseInput);

      expect(result.outputSchema).toHaveProperty('type', 'object');
      expect(result.outputSchema).toHaveProperty('properties');
      const props = result.outputSchema['properties'] as Record<
        string,
        unknown
      >;
      expect(props).toHaveProperty('projectContext');
      expect(props).toHaveProperty('frameworkGuidelines');
      expect(props).toHaveProperty('codingStandards');
      expect(props).toHaveProperty('architectureNotes');
    });

    it('should log info with project details', async () => {
      await agent.buildPrompts(baseInput);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PromptDesignerAgent: Building prompts',
        expect.objectContaining({
          projectType: 'Node',
          framework: 'NestJS',
          isMonorepo: false,
        }),
      );
    });
  });

  describe('parseAndValidateOutput', () => {
    const validStructuredOutput = {
      projectContext: 'NestJS microservices project',
      frameworkGuidelines: 'Use NestJS modules',
      codingStandards: 'Use TypeScript strict mode',
      architectureNotes: 'Follow hexagonal architecture',
    };

    it('should parse valid structured output and return PromptDesignerOutput', async () => {
      const result = await agent.parseAndValidateOutput(validStructuredOutput);

      expect(result).not.toBeNull();
      expect(result!.projectContext).toBe('LLM project context');
      expect(result!.frameworkGuidelines).toBe('LLM guidelines');
      expect(result!.codingStandards).toBe('LLM standards');
      expect(result!.architectureNotes).toBe('LLM notes');
    });

    it('should call parseStructuredResponse with input', async () => {
      await agent.parseAndValidateOutput(validStructuredOutput);

      expect(responseParser.parseStructuredResponse).toHaveBeenCalledWith(
        validStructuredOutput,
        expect.any(Function),
      );
    });

    it('should call validateOutput on parsed result', async () => {
      await agent.parseAndValidateOutput(validStructuredOutput);

      expect(responseParser.validateOutput).toHaveBeenCalled();
    });

    it('should emit generating and complete progress events', async () => {
      const onProgress = jest.fn<void, [PromptGenerationProgress]>();

      await agent.parseAndValidateOutput(validStructuredOutput, onProgress);

      const statuses = onProgress.mock.calls.map(([p]) => p.status);
      expect(statuses).toContain('generating');
      expect(statuses).toContain('complete');
    });

    it('should return null when parseStructuredResponse throws', async () => {
      responseParser.parseStructuredResponse.mockRejectedValueOnce(
        new Error('Parse failure'),
      );

      const result = await agent.parseAndValidateOutput(validStructuredOutput);

      expect(result).toBeNull();
    });

    it('should log error when parsing fails', async () => {
      responseParser.parseStructuredResponse.mockRejectedValueOnce(
        new Error('Parse failure'),
      );

      await agent.parseAndValidateOutput(validStructuredOutput);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'PromptDesignerAgent: Failed to parse structured output',
        expect.objectContaining({ error: 'Parse failure' }),
      );
    });

    it('should log warning when validation finds issues', async () => {
      responseParser.validateOutput.mockReturnValueOnce({
        valid: false,
        issues: ['Section too short'],
      });

      await agent.parseAndValidateOutput(validStructuredOutput);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'PromptDesignerAgent: Output validation issues',
        expect.objectContaining({ issues: ['Section too short'] }),
      );
    });
  });

  describe('generateFallbackGuidance', () => {
    it('should return PromptDesignerOutput with usedFallback=true', () => {
      const result = agent.generateFallbackGuidance(baseInput);

      expect(result.usedFallback).toBe(true);
    });

    it('should set fallbackReason from parameter when provided', () => {
      const reason = 'LLM service unavailable';
      const result = agent.generateFallbackGuidance(
        baseInput,
        undefined,
        reason,
      );

      expect(result.fallbackReason).toBe(reason);
    });

    it('should use default fallbackReason when not provided', () => {
      const result = agent.generateFallbackGuidance(baseInput);

      expect(result.fallbackReason).toBeDefined();
      expect(typeof result.fallbackReason).toBe('string');
    });

    it('should extract sections from buildFallbackGuidance output', () => {
      const result = agent.generateFallbackGuidance(baseInput);

      expect(result.projectContext).toBeDefined();
      expect(result.frameworkGuidelines).toBeDefined();
      expect(result.codingStandards).toBeDefined();
      expect(result.architectureNotes).toBeDefined();
    });

    it('should call buildFallbackGuidance with input', () => {
      agent.generateFallbackGuidance(baseInput);

      expect(generationPrompts.buildFallbackGuidance).toHaveBeenCalledWith(
        baseInput,
      );
    });

    it('should include qualityGuidance when score < 70', () => {
      const qualityAssessment = {
        score: 50,
        antiPatterns: [
          { message: 'Missing error handling', severity: 'high' },
          { message: 'No tests', severity: 'medium' },
          { message: 'Large functions', severity: 'low' },
          { message: 'Magic numbers', severity: 'low' },
        ],
        recommendations: [],
      } as never;

      const result = agent.generateFallbackGuidance(
        baseInput,
        qualityAssessment,
      );

      expect(result.qualityGuidance).toBeDefined();
      expect(result.qualityGuidance).toContain('50/100');
      expect(result.qualityScore).toBe(50);
    });

    it('should NOT include qualityGuidance text when score >= 70', () => {
      const qualityAssessment = {
        score: 80,
        antiPatterns: [],
        recommendations: [],
      } as never;

      const result = agent.generateFallbackGuidance(
        baseInput,
        qualityAssessment,
      );

      expect(result.qualityGuidance).toBeUndefined();
      expect(result.qualityScore).toBe(80);
    });

    it('should have generatedAt timestamp', () => {
      const before = Date.now();
      const result = agent.generateFallbackGuidance(baseInput);
      const after = Date.now();

      expect(result.generatedAt).toBeGreaterThanOrEqual(before);
      expect(result.generatedAt).toBeLessThanOrEqual(after);
    });

    it('should have totalTokens and tokenBreakdown', () => {
      const result = agent.generateFallbackGuidance(baseInput);

      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.tokenBreakdown).toBeDefined();
      expect(result.tokenBreakdown.projectContext).toBeGreaterThanOrEqual(0);
      expect(result.tokenBreakdown.frameworkGuidelines).toBeGreaterThanOrEqual(
        0,
      );
      expect(result.tokenBreakdown.codingStandards).toBeGreaterThanOrEqual(0);
      expect(result.tokenBreakdown.architectureNotes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatAsPrompt', () => {
    it('should delegate to formatAsPromptSection and return its result', () => {
      const output: PromptDesignerOutput = {
        projectContext: 'context',
        frameworkGuidelines: 'guidelines',
        codingStandards: 'standards',
        architectureNotes: 'notes',
        generatedAt: Date.now(),
        totalTokens: 100,
        tokenBreakdown: {
          projectContext: 25,
          frameworkGuidelines: 25,
          codingStandards: 25,
          architectureNotes: 25,
        },
      };

      const result = agent.formatAsPrompt(output);

      expect(result).toBe('formatted prompt section');
      expect(responseParser.formatAsPromptSection).toHaveBeenCalledWith(output);
    });
  });

  describe('enforceTokenBudgets', () => {
    it('should truncate sections exceeding maxSectionTokens', () => {
      responseParser.truncateToTokenBudget.mockImplementation(
        (_text: string, _budget: number, _current: number) => 'truncated',
      );

      const output: PromptDesignerOutput = {
        projectContext: 'x'.repeat(2000),
        frameworkGuidelines: 'short',
        codingStandards: 'short',
        architectureNotes: 'short',
        generatedAt: Date.now(),
        totalTokens: 2000,
        tokenBreakdown: {
          projectContext: 500,
          frameworkGuidelines: 10,
          codingStandards: 10,
          architectureNotes: 10,
        },
      };

      const result = agent.enforceTokenBudgets(output);

      expect(responseParser.truncateToTokenBudget).toHaveBeenCalled();
      expect(result.projectContext).toBe('truncated');
    });

    it('should not truncate sections within token budget', () => {
      const output: PromptDesignerOutput = {
        projectContext: 'short context',
        frameworkGuidelines: 'short guidelines',
        codingStandards: 'short standards',
        architectureNotes: 'short notes',
        generatedAt: Date.now(),
        totalTokens: 40,
        tokenBreakdown: {
          projectContext: 10,
          frameworkGuidelines: 10,
          codingStandards: 10,
          architectureNotes: 10,
        },
      };

      agent.enforceTokenBudgets(output);

      expect(responseParser.truncateToTokenBudget).not.toHaveBeenCalled();
    });
  });

  describe('configure', () => {
    it('should apply partial config overrides', async () => {
      agent.configure({ maxSectionTokens: 100, maxTotalTokens: 400 });

      const output: PromptDesignerOutput = {
        projectContext: 'x'.repeat(2000),
        frameworkGuidelines: 'short',
        codingStandards: 'short',
        architectureNotes: 'short',
        generatedAt: Date.now(),
        totalTokens: 800,
        tokenBreakdown: {
          projectContext: 200,
          frameworkGuidelines: 10,
          codingStandards: 10,
          architectureNotes: 10,
        },
      };

      responseParser.truncateToTokenBudget.mockReturnValue('truncated to 100');

      const result = agent.enforceTokenBudgets(output);

      expect(responseParser.truncateToTokenBudget).toHaveBeenCalledWith(
        expect.any(String),
        100,
        200,
      );
      expect(result.projectContext).toBe('truncated to 100');
    });
  });
});
