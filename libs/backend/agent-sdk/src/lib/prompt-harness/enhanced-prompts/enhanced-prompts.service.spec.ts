/**
 * EnhancedPromptsService Null-Return Tests
 *
 * TASK_2025_149 Batch 6 (Task 6.2): Verifies the null-return behavior
 * of getEnhancedPromptContent() added in TASK_2025_149 Batch 1 (Task 1.6).
 *
 * Tests that:
 * - Returns null when enabled but no generated prompt exists
 * - Returns the generated prompt when available
 * - Returns null when disabled
 * - Logs when returning null for an enabled workspace
 */

import 'reflect-metadata';
import { EnhancedPromptsService } from './enhanced-prompts.service';

describe('EnhancedPromptsService - getEnhancedPromptContent', () => {
  let service: EnhancedPromptsService;
  let mockLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let mockPromptDesignerAgent: {
    generateGuidance: jest.Mock;
    formatAsPrompt: jest.Mock;
  };
  let mockCacheService: {
    computeDependencyHash: jest.Mock;
    set: jest.Mock;
    onInvalidation: jest.Mock;
    invalidate: jest.Mock;
  };
  let mockContext: { globalState: { get: jest.Mock; update: jest.Mock } };
  let mockWorkspaceIntelligence: { analyzeWorkspace: jest.Mock };
  let mockInternalQueryService: { query: jest.Mock };
  let mockConfig: { get: jest.Mock };

  const testWorkspacePath = '/test/workspace';

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockPromptDesignerAgent = {
      generateGuidance: jest.fn(),
      formatAsPrompt: jest.fn(),
    };

    mockCacheService = {
      computeDependencyHash: jest.fn().mockResolvedValue('hash123'),
      set: jest.fn().mockResolvedValue(undefined),
      onInvalidation: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      globalState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    mockWorkspaceIntelligence = {
      analyzeWorkspace: jest.fn(),
    };

    mockInternalQueryService = {
      query: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new EnhancedPromptsService(
      ...[
        mockLogger,
        mockPromptDesignerAgent,
        mockCacheService,
        mockContext,
        mockWorkspaceIntelligence,
        mockInternalQueryService,
        mockConfig,
      ] as unknown as ConstructorParameters<typeof EnhancedPromptsService>
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return null when enabled but no generated prompt exists', async () => {
    // Seed state with enabled=true but no generatedPrompt
    mockContext.globalState.get.mockReturnValue({
      enabled: true,
      generatedPrompt: null,
      generatedAt: null,
      detectedStack: null,
      configHash: null,
      workspacePath: testWorkspacePath,
    });

    const result = await service.getEnhancedPromptContent(testWorkspacePath);

    expect(result).toBeNull();
  });

  it('should return the generated prompt when available', async () => {
    const generatedPrompt =
      '## Project-Specific Guidance\n\nCustom guidance content';

    // Seed state with a generated prompt via globalState
    mockContext.globalState.get.mockReturnValue({
      enabled: true,
      generatedPrompt,
      generatedAt: new Date().toISOString(),
      detectedStack: null,
      configHash: 'hash123',
      workspacePath: testWorkspacePath,
    });

    const result = await service.getEnhancedPromptContent(testWorkspacePath);

    expect(result).toBe(generatedPrompt);
  });

  it('should return null when disabled', async () => {
    mockContext.globalState.get.mockReturnValue({
      enabled: false,
      generatedPrompt: 'some content',
      generatedAt: new Date().toISOString(),
      detectedStack: null,
      configHash: null,
      workspacePath: testWorkspacePath,
    });

    const result = await service.getEnhancedPromptContent(testWorkspacePath);

    expect(result).toBeNull();
  });

  it('should log info when returning null for enabled workspace with no prompt', async () => {
    // Seed state with enabled=true but no generatedPrompt
    mockContext.globalState.get.mockReturnValue({
      enabled: true,
      generatedPrompt: null,
      generatedAt: null,
      detectedStack: null,
      configHash: null,
      workspacePath: testWorkspacePath,
    });

    await service.getEnhancedPromptContent(testWorkspacePath);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Enhanced prompts enabled but no generated prompt available. Run the setup wizard to generate enhanced prompts.',
      expect.objectContaining({ workspacePath: testWorkspacePath })
    );
  });

  it('should not log info when returning null because feature is disabled', async () => {
    mockContext.globalState.get.mockReturnValue({
      enabled: false,
      generatedPrompt: null,
      generatedAt: null,
      detectedStack: null,
      configHash: null,
      workspacePath: testWorkspacePath,
    });

    await service.getEnhancedPromptContent(testWorkspacePath);

    // Should not have logged the "enabled but no prompt" info message
    const infoCallWithExpectedMessage = mockLogger.info.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' &&
        args[0].includes('Enhanced prompts enabled but no generated prompt')
    );
    expect(infoCallWithExpectedMessage).toBeUndefined();
  });
});
