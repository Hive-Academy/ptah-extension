/**
 * Unit Tests for VsCodeLmService
 *
 * Tests retry logic, batch processing, validation integration, and prompt building.
 * Mocks VsCodeLmProvider to isolate service logic from VS Code LM API.
 */

import 'reflect-metadata';
import {
  VsCodeLmService,
  SectionCustomizationRequest,
} from './vscode-lm.service';
import { IOutputValidationService } from '../interfaces/output-validation.interface';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import {
  VsCodeLmProvider,
  LlmProviderError,
} from '@ptah-extension/llm-abstraction';
import { ProjectType, Framework } from '@ptah-extension/workspace-intelligence';
import { AgentProjectContext } from '../types/core.types';

// Mock VsCodeLmProvider
jest.mock('@ptah-extension/llm-abstraction', () => ({
  VsCodeLmProvider: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    getCompletion: jest.fn(),
  })),
}));

describe('VsCodeLmService', () => {
  let service: VsCodeLmService;
  let mockValidation: jest.Mocked<IOutputValidationService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockProvider: jest.Mocked<VsCodeLmProvider>;

  beforeEach(() => {
    // Create mocks
    mockValidation = {
      validate: jest.fn(),
      checkHallucinations: jest.fn(),
    } as unknown as jest.Mocked<IOutputValidationService>;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create service (VsCodeLmProvider will be mocked)
    service = new VsCodeLmService(mockValidation, mockLogger);

    // Get reference to mocked provider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProvider = (service as any).provider as jest.Mocked<VsCodeLmProvider>;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize VsCodeLmProvider successfully', async () => {
      mockProvider.initialize.mockResolvedValue(Result.ok(undefined));

      const result = await service.initialize();

      expect(result.isOk()).toBe(true);
      expect(mockProvider.initialize).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'VsCodeLmService initialized successfully'
      );
    });

    it('should return error if provider initialization fails', async () => {
      const error = new LlmProviderError(
        'Provider init failed',
        'PROVIDER_NOT_FOUND',
        'vscode-lm'
      );
      mockProvider.initialize.mockResolvedValue(Result.err(error));

      const result = await service.initialize();

      expect(result.isErr()).toBe(true);
      if (result.error) {
        expect(result.error.message).toContain(
          'VS Code LM initialization failed'
        );
      }
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('customizeSection', () => {
    const mockContext = createMockProjectContext();

    it('should succeed on first attempt with valid response', async () => {
      // Mock successful completion
      mockProvider.getCompletion.mockResolvedValue(
        Result.ok('Valid customized content')
      );

      // Mock validation success
      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 90, issues: [] })
      );

      const result = await service.customizeSection('TECH_STACK', mockContext, [
        'sample.ts',
      ]);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Valid customized content');
      expect(mockProvider.getCompletion).toHaveBeenCalledTimes(1);
      expect(mockValidation.validate).toHaveBeenCalledTimes(1);
    });

    it('should retry 2 times then succeed on 3rd attempt', async () => {
      let callCount = 0;

      // Mock provider to fail 2x, succeed 3rd
      mockProvider.getCompletion.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return Result.err(
            new LlmProviderError(
              'Rate limit exceeded',
              'RATE_LIMIT_EXCEEDED',
              'vscode-lm'
            )
          );
        }
        return Result.ok('Success after retries');
      });

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 85, issues: [] })
      );

      const result = await service.customizeSection(
        'TECH_STACK',
        mockContext,
        []
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Success after retries');
      expect(callCount).toBe(3);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Retrying after')
      );
    });

    it('should return error after max retries exhausted', async () => {
      // Mock all attempts to fail
      mockProvider.getCompletion.mockResolvedValue(
        Result.err(
          new LlmProviderError(
            'Service unavailable',
            'NETWORK_ERROR',
            'vscode-lm'
          )
        )
      );

      const result = await service.customizeSection(
        'TECH_STACK',
        mockContext,
        []
      );

      expect(result.isErr()).toBe(true);
      expect(mockProvider.getCompletion).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('LM request failed'),
        expect.any(Error)
      );
    });

    it('should retry when validation fails, then succeed', async () => {
      let validationCallCount = 0;

      mockProvider.getCompletion.mockResolvedValue(
        Result.ok('Generated content')
      );

      // Mock validation to fail 2x, succeed 3rd
      mockValidation.validate.mockImplementation(async () => {
        validationCallCount++;
        if (validationCallCount < 3) {
          return Result.ok({ isValid: false, score: 50, issues: [] });
        }
        return Result.ok({ isValid: true, score: 90, issues: [] });
      });

      const result = await service.customizeSection(
        'TECH_STACK',
        mockContext,
        []
      );

      expect(result.isOk()).toBe(true);
      expect(validationCallCount).toBe(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed'),
        expect.any(Object)
      );
    });

    it('should return empty string when validation fails all retries', async () => {
      mockProvider.getCompletion.mockResolvedValue(
        Result.ok('Low quality content')
      );

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: false, score: 30, issues: [] })
      );

      const result = await service.customizeSection(
        'TECH_STACK',
        mockContext,
        []
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(''); // Empty string = fallback
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max retries exhausted')
      );
    });

    it('should use exponential backoff timing', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      mockProvider.getCompletion.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return Result.err(
            new LlmProviderError(
              'Temporary failure',
              'NETWORK_ERROR',
              'vscode-lm'
            )
          );
        }
        return Result.ok('Success');
      });

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 80, issues: [] })
      );

      const promise = service.customizeSection('TECH_STACK', mockContext, []);

      // First attempt fails immediately
      await jest.advanceTimersByTimeAsync(0);

      // Second attempt after 5s backoff
      await jest.advanceTimersByTimeAsync(5000);

      // Third attempt after 10s backoff (5 * 2^1)
      await jest.advanceTimersByTimeAsync(10000);

      const result = await promise;

      expect(result.isOk()).toBe(true);
      expect(callCount).toBe(3);

      jest.useRealTimers();
    });
  });

  describe('batchCustomize', () => {
    it('should process sections with concurrency limit of 5', async () => {
      mockProvider.getCompletion.mockResolvedValue(Result.ok('Batch response'));

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 80, issues: [] })
      );

      const sections: SectionCustomizationRequest[] = Array.from(
        { length: 12 },
        (_, i) => ({
          id: `section-${i}`,
          topic: `TOPIC_${i}`,
          projectContext: createMockProjectContext(),
          fileSamples: [],
        })
      );

      const results = await service.batchCustomize(sections, 5);

      expect(results.size).toBe(12);
      expect(Array.from(results.values()).every((r) => r.isOk())).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Batch customization complete'),
        expect.objectContaining({ total: 12, successful: 12 })
      );
    });

    it('should handle partial failures in batch', async () => {
      let callCount = 0;

      mockProvider.getCompletion.mockImplementation(async () => {
        callCount++;
        // Fail every 3rd request
        if (callCount % 3 === 0) {
          return Result.err(
            new LlmProviderError(
              'Intermittent failure',
              'NETWORK_ERROR',
              'vscode-lm'
            )
          );
        }
        return Result.ok('Success');
      });

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 75, issues: [] })
      );

      const sections: SectionCustomizationRequest[] = Array.from(
        { length: 6 },
        (_, i) => ({
          id: `section-${i}`,
          topic: `TOPIC_${i}`,
          projectContext: createMockProjectContext(),
          fileSamples: [],
        })
      );

      const results = await service.batchCustomize(sections, 3);

      expect(results.size).toBe(6);
      const successCount = Array.from(results.values()).filter((r) =>
        r.isOk()
      ).length;
      expect(successCount).toBeGreaterThan(0);
      expect(successCount).toBeLessThan(6); // Some failures expected
    });

    it('should process in chunks respecting concurrency', async () => {
      const processingTimes: number[] = [];
      let activeCalls = 0;
      let maxConcurrentCalls = 0;

      mockProvider.getCompletion.mockImplementation(async () => {
        activeCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        processingTimes.push(Date.now());

        // Simulate 100ms processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        activeCalls--;
        return Result.ok('Response');
      });

      mockValidation.validate.mockResolvedValue(
        Result.ok({ isValid: true, score: 85, issues: [] })
      );

      const sections: SectionCustomizationRequest[] = Array.from(
        { length: 15 },
        (_, i) => ({
          id: `section-${i}`,
          topic: `TOPIC_${i}`,
          projectContext: createMockProjectContext(),
          fileSamples: [],
        })
      );

      await service.batchCustomize(sections, 5);

      // Max concurrent calls should not exceed concurrency limit
      expect(maxConcurrentCalls).toBeLessThanOrEqual(5);
    });
  });

  describe('buildPrompt', () => {
    it('should include project context in prompt', () => {
      const context = createMockProjectContext();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (service as any).buildPrompt('TECH_STACK', context, [
        'sample code',
      ]);

      expect(prompt).toContain(context.projectType);
      expect(prompt).toContain('express'); // Framework enum values are lowercase
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('TECH_STACK');
      expect(prompt).toContain('sample code');
    });

    it('should limit file samples to 3', () => {
      const context = createMockProjectContext();
      const fileSamples = ['file1', 'file2', 'file3', 'file4', 'file5'];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (service as any).buildPrompt(
        'TECH_STACK',
        context,
        fileSamples
      );

      expect(prompt).toContain('file1');
      expect(prompt).toContain('file2');
      expect(prompt).toContain('file3');
      expect(prompt).not.toContain('file4');
      expect(prompt).not.toContain('file5');
    });

    it('should use default framework name when no frameworks present', () => {
      const context = {
        ...createMockProjectContext(),
        frameworks: [],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (service as any).buildPrompt('TECH_STACK', context, []);

      expect(prompt).toContain('this framework');
    });
  });
});

// Helper function
function createMockProjectContext(): AgentProjectContext {
  return {
    projectType: ProjectType.Node,
    frameworks: [Framework.Express],
    monorepoType: undefined,
    rootPath: '/workspace/test',
    relevantFiles: [],
    techStack: {
      languages: ['TypeScript'],
      frameworks: ['Express'],
      buildTools: ['npm'],
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
}
