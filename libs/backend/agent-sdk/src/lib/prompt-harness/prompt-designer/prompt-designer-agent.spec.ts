/**
 * PromptDesignerAgent Fallback Tracking Tests
 *
 * TASK_2025_149 Batch 6 (Task 6.1): Verifies fallback tracking behavior
 * added in TASK_2025_149 Batch 1 (Task 1.5).
 *
 * Tests that:
 * - usedFallback and fallbackReason are set when LLM is unavailable
 * - usedFallback and fallbackReason are set when generation throws (outer catch)
 * - Progress callback receives status: 'fallback' (not 'error')
 * - Successful LLM calls do NOT set usedFallback
 * - Returns null when both LLM completion methods fail internally
 */

import 'reflect-metadata';
import { PromptDesignerAgent } from './prompt-designer-agent';
import type {
  PromptDesignerInput,
  PromptGenerationProgress,
} from './prompt-designer.types';

// Mock modules that PromptDesignerAgent depends on
jest.mock('./generation-prompts', () => ({
  PROMPT_DESIGNER_SYSTEM_PROMPT: 'mock system prompt',
  buildGenerationUserPrompt: jest.fn().mockReturnValue('mock user prompt'),
  buildFallbackGuidance: jest
    .fn()
    .mockReturnValue(
      '## Project Context\nMock project context\n\n## Framework Guidelines\nMock guidelines\n\n## Coding Standards\nMock standards\n\n## Architecture Notes\nMock notes',
    ),
  buildQualityContextPrompt: jest.fn().mockReturnValue('mock quality context'),
}));

// Get reference to the mocked buildGenerationUserPrompt for per-test overrides
const generationPrompts = jest.requireMock('./generation-prompts') as {
  buildGenerationUserPrompt: jest.Mock;
};

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
  formatAsPromptSection: jest.fn().mockReturnValue('formatted'),
  truncateToTokenBudget: jest.fn((text: string) => text),
}));

// Tests reference the old `generateGuidance()` method which was removed when
// PromptDesignerAgent was refactored into a pure prompt builder (buildPrompts).
// Quality assessment now comes pre-computed from the agentic analysis (Step 1).
describe.skip('PromptDesignerAgent - Fallback Tracking', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agent: any;
  let mockLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let mockLlmService: {
    hasProvider: jest.Mock;
    getCompletion: jest.Mock;
    getStructuredCompletion: jest.Mock;
    countTokens: jest.Mock;
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

    mockLlmService = {
      hasProvider: jest.fn().mockReturnValue(true),
      getCompletion: jest.fn(),
      getStructuredCompletion: jest.fn(),
      countTokens: jest.fn().mockResolvedValue(100),
    };

    agent = new PromptDesignerAgent(
      ...([mockLogger] as unknown as ConstructorParameters<
        typeof PromptDesignerAgent
      >),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Restore the default mock return value for buildGenerationUserPrompt
    // since per-test overrides via mockImplementation persist after clearAllMocks
    generationPrompts.buildGenerationUserPrompt.mockReturnValue(
      'mock user prompt',
    );
  });

  it('should set usedFallback=true and fallbackReason when LLM provider is unavailable', async () => {
    mockLlmService.hasProvider.mockReturnValue(false);

    const result = await agent.generateGuidance(baseInput);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['usedFallback']).toBe(true);
    expect((result as Record<string, unknown>)['fallbackReason']).toBe(
      'LLM service not available',
    );
  });

  it('should set usedFallback=true with error reason when generation throws', async () => {
    // Trigger the outer catch block in generateGuidance by making
    // buildGenerationUserPrompt throw (errors in tryStructuredCompletion/
    // tryTextCompletion are caught internally and return null)
    generationPrompts.buildGenerationUserPrompt.mockImplementation(() => {
      throw new Error('Rate limit exceeded');
    });

    const result = await agent.generateGuidance(baseInput);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['usedFallback']).toBe(true);
    expect((result as Record<string, unknown>)['fallbackReason']).toBe(
      'Rate limit exceeded',
    );
  });

  it('should emit fallback progress status when LLM provider is unavailable', async () => {
    mockLlmService.hasProvider.mockReturnValue(false);
    const onProgress = jest.fn();

    await agent.generateGuidance(baseInput, onProgress);

    const fallbackCall = onProgress.mock.calls.find(
      ([progress]: [PromptGenerationProgress]) =>
        progress.status === 'fallback',
    );
    expect(fallbackCall).toBeDefined();
    expect((fallbackCall as [PromptGenerationProgress])[0].status).toBe(
      'fallback',
    );
  });

  it('should emit fallback progress status when generation throws', async () => {
    // Trigger the outer catch block to emit 'fallback' progress
    generationPrompts.buildGenerationUserPrompt.mockImplementation(() => {
      throw new Error('Network error');
    });
    const onProgress = jest.fn();

    await agent.generateGuidance(baseInput, onProgress);

    const fallbackCall = onProgress.mock.calls.find(
      ([progress]: [PromptGenerationProgress]) =>
        progress.status === 'fallback',
    );
    expect(fallbackCall).toBeDefined();
    expect((fallbackCall as [PromptGenerationProgress])[0].status).toBe(
      'fallback',
    );
  });

  it('should NOT set usedFallback when LLM succeeds', async () => {
    mockLlmService.hasProvider.mockReturnValue(true);
    mockLlmService.getStructuredCompletion.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        projectContext: 'context',
        frameworkGuidelines: 'guidelines',
        codingStandards: 'standards',
        architectureNotes: 'notes',
      },
    });

    const result = await agent.generateGuidance(baseInput);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['usedFallback']).toBeUndefined();
    expect(
      (result as Record<string, unknown>)['fallbackReason'],
    ).toBeUndefined();
  });

  it('should include the error message in fallbackReason when generation errors', async () => {
    const specificError = 'API key expired for provider anthropic';
    generationPrompts.buildGenerationUserPrompt.mockImplementation(() => {
      throw new Error(specificError);
    });

    const result = await agent.generateGuidance(baseInput);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)['usedFallback']).toBe(true);
    expect((result as Record<string, unknown>)['fallbackReason']).toBe(
      specificError,
    );
  });

  it('should not emit error progress status when falling back due to generation failure', async () => {
    generationPrompts.buildGenerationUserPrompt.mockImplementation(() => {
      throw new Error('Timeout');
    });
    const onProgress = jest.fn();

    await agent.generateGuidance(baseInput, onProgress);

    const errorCalls = onProgress.mock.calls.filter(
      ([progress]: [PromptGenerationProgress]) => progress.status === 'error',
    );
    expect(errorCalls).toHaveLength(0);
  });

  it('should return null when LLM structured and text completions both fail internally', async () => {
    // When both tryStructuredCompletion and tryTextCompletion catch errors
    // internally and return null, generateGuidance returns null (not a fallback)
    mockLlmService.hasProvider.mockReturnValue(true);
    mockLlmService.getStructuredCompletion.mockRejectedValue(
      new Error('Rate limit exceeded'),
    );
    mockLlmService.getCompletion.mockRejectedValue(
      new Error('Rate limit exceeded'),
    );

    const result = await agent.generateGuidance(baseInput);

    expect(result).toBeNull();
  });
});
