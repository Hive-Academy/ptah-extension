/**
 * EnhancedPromptsService - comprehensive tests
 */

import 'reflect-metadata';

jest.mock('tsyringe', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

const mockDiscoverPluginSkills = jest.fn();
const mockFormatSkillsForPrompt = jest.fn();
const mockProcess = jest.fn();

class MockSdkStreamProcessor {
  process(stream: unknown): unknown {
    return mockProcess(stream);
  }
}

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol.for('LOGGER'),
    EXTENSION_CONTEXT: Symbol.for('EXTENSION_CONTEXT'),
    WORKSPACE_ANALYZER_SERVICE: Symbol.for('WORKSPACE_ANALYZER_SERVICE'),
  },
  Logger: class {},
}));

jest.mock('@ptah-extension/settings-core', () => ({
  SETTINGS_TOKENS: {
    MODEL_SETTINGS: Symbol.for('MODEL_SETTINGS'),
  },
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  PTAH_CORE_SYSTEM_PROMPT: 'CORE_SYSTEM_PROMPT',
  PTAH_CORE_SYSTEM_PROMPT_TOKENS: 1234,
  SDK_TOKENS: {
    SDK_INTERNAL_QUERY_SERVICE: Symbol.for('SDK_INTERNAL_QUERY_SERVICE'),
  },
  SdkStreamProcessor: MockSdkStreamProcessor,
  discoverPluginSkills: (...args: unknown[]) =>
    mockDiscoverPluginSkills(...args),
  formatSkillsForPrompt: (...args: unknown[]) =>
    mockFormatSkillsForPrompt(...args),
}));

import { EnhancedPromptsService } from './enhanced-prompts.service';
import type {
  PromptDesignerInput,
  PromptDesignerOutput,
} from '../prompt-designer/prompt-designer.types';

interface Mocks {
  logger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  promptDesignerAgent: {
    buildPrompts: jest.Mock;
    parseAndValidateOutput: jest.Mock;
    generateFallbackGuidance: jest.Mock;
  };
  cacheService: {
    computeDependencyHash: jest.Mock;
    set: jest.Mock;
    onInvalidation: jest.Mock;
    invalidate: jest.Mock;
    invalidationCallback:
      | ((event: { reason: string; workspacePath: string }) => void)
      | null;
  };
  context: { globalState: { get: jest.Mock; update: jest.Mock } };
  workspaceIntelligence: {
    getProjectInfo: jest.Mock;
    getCurrentWorkspaceInfo: jest.Mock;
  };
  internalQueryService: { execute: jest.Mock };
  modelSettings: { selectedModel: { get: jest.Mock } };
}

const testWorkspacePath = '/test/workspace';

function createMocks(): Mocks {
  const cacheService = {
    computeDependencyHash: jest.fn().mockResolvedValue('basehash'),
    set: jest.fn().mockResolvedValue(undefined),
    onInvalidation: jest.fn(),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidationCallback: null as
      | ((event: { reason: string; workspacePath: string }) => void)
      | null,
  };
  cacheService.onInvalidation.mockImplementation(
    (cb: (event: { reason: string; workspacePath: string }) => void) => {
      cacheService.invalidationCallback = cb;
    },
  );

  return {
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    promptDesignerAgent: {
      buildPrompts: jest.fn(),
      parseAndValidateOutput: jest.fn(),
      generateFallbackGuidance: jest.fn(),
    },
    cacheService,
    context: {
      globalState: {
        get: jest.fn().mockReturnValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    },
    workspaceIntelligence: {
      getProjectInfo: jest.fn(),
      getCurrentWorkspaceInfo: jest.fn(),
    },
    internalQueryService: {
      execute: jest.fn(),
    },
    modelSettings: {
      selectedModel: { get: jest.fn().mockReturnValue(undefined) },
    },
  };
}

function createService(mocks: Mocks): EnhancedPromptsService {
  return new EnhancedPromptsService(
    ...([
      mocks.logger,
      mocks.promptDesignerAgent,
      mocks.cacheService,
      mocks.context,
      mocks.workspaceIntelligence,
      mocks.internalQueryService,
      mocks.modelSettings,
    ] as unknown as ConstructorParameters<typeof EnhancedPromptsService>),
  );
}

function fullOutput(
  overrides: Partial<PromptDesignerOutput> = {},
): PromptDesignerOutput {
  return {
    projectContext: 'project ctx content',
    frameworkGuidelines: 'framework gd content',
    codingStandards: 'coding std content',
    architectureNotes: 'architecture notes content',
    generatedAt: 1,
    totalTokens: 100,
    tokenBreakdown: {
      projectContext: 25,
      frameworkGuidelines: 25,
      codingStandards: 25,
      architectureNotes: 25,
    },
    ...overrides,
  };
}

describe('EnhancedPromptsService', () => {
  let mocks: Mocks;
  let service: EnhancedPromptsService;

  beforeEach(() => {
    mockDiscoverPluginSkills.mockReset();
    mockFormatSkillsForPrompt.mockReset();
    mockProcess.mockReset();
    mocks = createMocks();
    service = createService(mocks);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor + cache invalidation listener', () => {
    it('registers an onInvalidation callback that clears configHash when state is cached', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'p',
        generatedAt: null,
        detectedStack: null,
        configHash: 'somehash',
        workspacePath: testWorkspacePath,
      });
      await service.isEnabled(testWorkspacePath);
      expect(mocks.cacheService.invalidationCallback).toBeTruthy();
      mocks.cacheService.invalidationCallback?.({
        reason: 'manual',
        workspacePath: testWorkspacePath,
      });

      const state = await service.getStatus(testWorkspacePath);
      expect(state.cacheValid).toBe(false);
      expect(state.invalidationReason).toBe('Project configuration changed');
    });

    it('safely no-ops when invalidation fires for a workspace with no cached state', () => {
      expect(() =>
        mocks.cacheService.invalidationCallback?.({
          reason: 'manual',
          workspacePath: '/unknown/workspace',
        }),
      ).not.toThrow();
    });
  });

  describe('setAnalysisReader', () => {
    it('stores the reader and logs', () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn(),
        readPhaseFile: jest.fn(),
      };
      service.setAnalysisReader(reader);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Multi-phase analysis reader configured'),
      );
    });
  });

  describe('getStatus', () => {
    it('returns enabled=false when no state present', async () => {
      const status = await service.getStatus(testWorkspacePath);
      expect(status.enabled).toBe(false);
      expect(status.hasGeneratedPrompt).toBe(false);
      expect(status.cacheValid).toBe(false);
    });

    it('returns cacheValid=true when hashes match', async () => {
      const matchingHash = `basehash:pt1234`;
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'p',
        generatedAt: null,
        detectedStack: null,
        configHash: matchingHash,
        workspacePath: testWorkspacePath,
      });
      const status = await service.getStatus(testWorkspacePath);
      expect(status.cacheValid).toBe(true);
      expect(status.invalidationReason).toBeUndefined();
    });

    it('returns invalidation reason when hashes differ', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'p',
        generatedAt: null,
        detectedStack: null,
        configHash: 'old-hash',
        workspacePath: testWorkspacePath,
      });
      const status = await service.getStatus(testWorkspacePath);
      expect(status.cacheValid).toBe(false);
      expect(status.invalidationReason).toBe('Project configuration changed');
    });

    it('reports invalidation when base dependency hash is null', async () => {
      mocks.cacheService.computeDependencyHash.mockResolvedValueOnce(null);
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'p',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      const status = await service.getStatus(testWorkspacePath);
      expect(status.cacheValid).toBe(false);
      expect(status.invalidationReason).toBe('Project configuration changed');
    });

    it('skips hash check when enabled but no generated prompt', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: null,
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      const status = await service.getStatus(testWorkspacePath);
      expect(status.cacheValid).toBe(false);
      expect(status.invalidationReason).toBeUndefined();
      expect(mocks.cacheService.computeDependencyHash).not.toHaveBeenCalled();
    });
  });

  describe('isEnabled / setEnabled', () => {
    it('returns false initially', async () => {
      expect(await service.isEnabled(testWorkspacePath)).toBe(false);
    });

    it('toggles enabled and persists', async () => {
      await service.setEnabled(testWorkspacePath, true);
      expect(mocks.context.globalState.update).toHaveBeenCalled();
      expect(await service.isEnabled(testWorkspacePath)).toBe(true);

      await service.setEnabled(testWorkspacePath, false);
      expect(await service.isEnabled(testWorkspacePath)).toBe(false);
    });
  });

  describe('isGeneratingPrompt', () => {
    it('returns false initially', () => {
      expect(service.isGeneratingPrompt()).toBe(false);
    });

    it('returns true while wizard is in flight', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: [],
        devDependencies: [],
        fileStatistics: {},
        totalFiles: 0,
      });
      mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockReturnValue(
        undefined,
      );
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      let resolveExecute: (v: unknown) => void = () => undefined;
      const pendingHandle = new Promise((res) => {
        resolveExecute = res;
      });
      mocks.internalQueryService.execute.mockReturnValue(pendingHandle);

      const wizardPromise = service.runWizard(testWorkspacePath);
      await Promise.resolve();
      await Promise.resolve();
      expect(service.isGeneratingPrompt()).toBe(true);

      resolveExecute({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValueOnce({ structuredOutput: null });
      mocks.promptDesignerAgent.generateFallbackGuidance.mockResolvedValue(
        fullOutput(),
      );
      await wizardPromise;
      expect(service.isGeneratingPrompt()).toBe(false);
    });
  });

  describe('getFullCombinedPromptContent', () => {
    it('returns null when enhanced content is null', async () => {
      const result =
        await service.getFullCombinedPromptContent(testWorkspacePath);
      expect(result).toBeNull();
    });

    it('prepends core system prompt when enhanced content exists', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'enhanced!',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      const result =
        await service.getFullCombinedPromptContent(testWorkspacePath);
      expect(result).toBe('CORE_SYSTEM_PROMPT\n\nenhanced!');
    });
  });

  describe('getEnhancedPromptContent (regression set)', () => {
    it('returns null when enabled but no generated prompt', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: null,
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(
        await service.getEnhancedPromptContent(testWorkspacePath),
      ).toBeNull();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Enhanced prompts enabled but no generated prompt',
        ),
        expect.objectContaining({ workspacePath: testWorkspacePath }),
      );
    });

    it('returns generated prompt when available', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'generated!',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(await service.getEnhancedPromptContent(testWorkspacePath)).toBe(
        'generated!',
      );
    });

    it('returns null when disabled', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: false,
        generatedPrompt: 'x',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(
        await service.getEnhancedPromptContent(testWorkspacePath),
      ).toBeNull();
    });
  });

  describe('getProjectGuidanceContent', () => {
    it('returns null when state disabled', async () => {
      expect(
        await service.getProjectGuidanceContent(testWorkspacePath),
      ).toBeNull();
    });

    it('returns null when no generatedPrompt', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: null,
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(
        await service.getProjectGuidanceContent(testWorkspacePath),
      ).toBeNull();
    });

    it('returns null when marker is missing', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'no marker here',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(
        await service.getProjectGuidanceContent(testWorkspacePath),
      ).toBeNull();
    });

    it('returns substring from marker, trimmed', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'preamble\n## Project-Specific Guidance\n\nbody  ',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      const r = await service.getProjectGuidanceContent(testWorkspacePath);
      expect(r).toBe('## Project-Specific Guidance\n\nbody');
    });
  });

  describe('runWizard', () => {
    function primeSuccessfulSdk(qualityAssessment?: unknown) {
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 'sys',
        userPrompt: 'user',
        outputSchema: { type: 'object' },
        qualityAssessment,
      });
      const closeFn = jest.fn();
      const stream = (async function* () {
        /* empty */
      })();
      mocks.internalQueryService.execute.mockResolvedValue({
        stream,
        close: closeFn,
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );
    }

    it('returns failure when generation lock is already held', async () => {
      primeSuccessfulSdk();
      let resolveProcess: (v: unknown) => void = () => undefined;
      mockProcess.mockReturnValue(
        new Promise((res) => {
          resolveProcess = res;
        }),
      );

      const first = service.runWizard(testWorkspacePath, undefined, undefined, {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      });
      await Promise.resolve();
      const second = await service.runWizard(testWorkspacePath);
      expect(second.success).toBe(false);
      expect(second.error).toBe('Generation already in progress');

      resolveProcess({ structuredOutput: { ok: true } });
      await first;
    });

    it('uses pre-computed input and reports progress', async () => {
      primeSuccessfulSdk();
      const onProgress = jest.fn();
      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        framework: 'angular',
        isMonorepo: true,
        monorepoType: 'nx',
        dependencies: ['rxjs', 'webpack'],
        devDependencies: ['jest', '@types/node', 'typescript'],
        languages: ['TypeScript'],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        onProgress,
        input,
      );
      expect(result.success).toBe(true);
      expect(result.state?.detectedStack?.frameworks).toContain('angular');
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'analyzing', progress: 0.3 }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'complete', progress: 1.0 }),
      );
    });

    it('runs workspace analysis path and saves state', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: ['rxjs', 'nx', 'react'],
        devDependencies: ['jest', '@types/node'],
        fileStatistics: { '.ts': 5, '.py': 2, '.unknown': 1 },
        totalFiles: 8,
      });
      mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockReturnValue({
        name: 'p',
        path: '/p',
        projectType: 'app',
        frameworks: ['react'],
      });
      primeSuccessfulSdk();

      const result = await service.runWizard(testWorkspacePath);
      expect(result.success).toBe(true);
      expect(result.state?.detectedStack?.projectType).toBe('monorepo');
      expect(mocks.cacheService.set).toHaveBeenCalled();
    });

    it('returns failure when workspace analysis throws', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockRejectedValue(
        new Error('analysis blew up'),
      );
      const result = await service.runWizard(testWorkspacePath);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to analyze workspace');
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Workspace analysis failed'),
        expect.any(Object),
      );
    });

    it('returns failure when generateGuidanceViaSdk returns null', async () => {
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: null });
      mocks.promptDesignerAgent.generateFallbackGuidance.mockResolvedValue(
        null,
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate guidance');
    });

    it('catches generic errors thrown during wizard', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: [],
        devDependencies: [],
        fileStatistics: {},
        totalFiles: 0,
      });
      mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockReturnValue(
        undefined,
      );
      mocks.cacheService.computeDependencyHash.mockRejectedValueOnce(
        new Error('hash blew up'),
      );
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const result = await service.runWizard(testWorkspacePath);
      expect(result.success).toBe(false);
      expect(result.error).toBe('hash blew up');
    });

    it('releases the lock in finally so subsequent runs succeed', async () => {
      primeSuccessfulSdk();
      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const first = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(first.success).toBe(true);
      expect(service.isGeneratingPrompt()).toBe(false);
      const second = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(second.success).toBe(true);
    });

    it('attaches qualityAssessment values when present', async () => {
      const qa = { score: 88, summary: 'ok' };
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
        qualityAssessment: qa,
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput({ qualityGuidance: 'guidance!' }),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(result.success).toBe(true);
      expect(
        result.summary?.sections.some((s) => s.name === 'Quality Guidance'),
      ).toBe(true);
    });

    it('falls back when SDK throws inside generateGuidance', async () => {
      mocks.promptDesignerAgent.buildPrompts.mockRejectedValue(
        new Error('sdk error'),
      );
      mocks.promptDesignerAgent.generateFallbackGuidance.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(result.success).toBe(true);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('SDK guidance generation failed'),
        expect.any(Object),
      );
    });

    it('falls back to template guidance when parseAndValidateOutput returns null', async () => {
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(null);
      mocks.promptDesignerAgent.generateFallbackGuidance.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(result.success).toBe(true);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no structured output, using fallback'),
      );
    });

    it('falls back when stream processor throws non-abort error', async () => {
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockRejectedValue(new Error('stream broken'));
      mocks.promptDesignerAgent.generateFallbackGuidance.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(result.success).toBe(true);
    });

    it('appends plugin skills when pluginPaths and skills are present', async () => {
      mockDiscoverPluginSkills.mockReturnValue([{ name: 'skill1' }]);
      mockFormatSkillsForPrompt.mockReturnValue('SKILL FORMATTED');
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 'base',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
        { isPremium: true, mcpServerRunning: false, pluginPaths: ['/p1'] },
      );
      expect(result.success).toBe(true);
      expect(mocks.internalQueryService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPromptAppend: expect.stringContaining('SKILL FORMATTED'),
        }),
      );
    });

    it('does not append skills section when discoverPluginSkills returns empty', async () => {
      mockDiscoverPluginSkills.mockReturnValue([]);
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 'base',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      await service.runWizard(testWorkspacePath, undefined, undefined, input, {
        isPremium: false,
        mcpServerRunning: false,
        pluginPaths: ['/p1'],
      });
      expect(mocks.internalQueryService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPromptAppend: 'base',
        }),
      );
    });

    it('uses configured model when sdkConfig model not supplied', async () => {
      mocks.modelSettings.selectedModel.get.mockReturnValue('claude-pinned');
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      await service.runWizard(testWorkspacePath, undefined, undefined, input);
      expect(mocks.internalQueryService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-pinned' }),
      );
    });

    it('forwards onStreamEvent through to the stream processor', async () => {
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      const onStreamEvent = jest.fn();
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      await service.runWizard(testWorkspacePath, undefined, undefined, input, {
        isPremium: true,
        mcpServerRunning: false,
        onStreamEvent,
      });
      expect(mockProcess).toHaveBeenCalled();
    });
  });

  describe('multi-phase analysis enrichment', () => {
    it('reads manifest from explicit analysis dir and appends sections', async () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn(),
        readPhaseFile: jest.fn(async (slug: string, file: string) => {
          if (file === 'manifest.json') {
            return JSON.stringify({
              phases: {
                'project-profile': { status: 'completed', file: 'pp.md' },
                'architecture-assessment': { status: 'pending', file: 'aa.md' },
                'quality-audit': { status: 'completed', file: 'qa.md' },
              },
            });
          }
          if (file === 'pp.md') return 'PROFILE CONTENT';
          if (file === 'qa.md') return 'QA CONTENT';
          return null;
        }),
      };
      service.setAnalysisReader(reader);

      mocks.promptDesignerAgent.buildPrompts.mockImplementation(
        async (inp: PromptDesignerInput) => {
          expect(inp.additionalContext).toContain('PROFILE CONTENT');
          expect(inp.additionalContext).toContain('QA CONTENT');
          return { systemPrompt: 's', userPrompt: 'u', outputSchema: {} };
        },
      );
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
        additionalContext: 'PREEXISTING',
      };
      const r = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
        undefined,
        '/analysis/dir',
      );
      expect(r.success).toBe(true);
    });

    it('warns when manifest cannot be read from explicit dir', async () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn(),
        readPhaseFile: jest.fn().mockResolvedValue(null),
      };
      service.setAnalysisReader(reader);

      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const r = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
        undefined,
        '/explicit/dir',
      );
      expect(r.success).toBe(true);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No manifest found in explicit analysis dir'),
        expect.any(Object),
      );
    });

    it('falls back to findLatestMultiPhaseAnalysis when no explicit dir', async () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue({
          slugDir: '/slug',
          manifest: {
            phases: {
              'elevation-plan': { status: 'completed', file: 'ep.md' },
            },
          },
        }),
        readPhaseFile: jest.fn().mockResolvedValue('PLAN CONTENT'),
      };
      service.setAnalysisReader(reader);

      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const r = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(r.success).toBe(true);
      expect(reader.findLatestMultiPhaseAnalysis).toHaveBeenCalledWith(
        testWorkspacePath,
      );
    });

    it('no-ops gracefully when findLatestMultiPhaseAnalysis returns null', async () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue(null),
        readPhaseFile: jest.fn(),
      };
      service.setAnalysisReader(reader);

      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const r = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(r.success).toBe(true);
      expect(reader.readPhaseFile).not.toHaveBeenCalled();
    });

    it('logs warning if reader throws but wizard still completes', async () => {
      const reader = {
        findLatestMultiPhaseAnalysis: jest
          .fn()
          .mockRejectedValue(new Error('reader broken')),
        readPhaseFile: jest.fn(),
      };
      service.setAnalysisReader(reader);

      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const input: PromptDesignerInput = {
        workspacePath: testWorkspacePath,
        projectType: 'app',
        isMonorepo: false,
        dependencies: [],
        devDependencies: [],
      };
      const r = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        input,
      );
      expect(r.success).toBe(true);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read multi-phase analysis'),
        expect.any(Object),
      );
    });
  });

  describe('regenerate', () => {
    it('returns error when analysisReader not set', async () => {
      const r = await service.regenerate(testWorkspacePath);
      expect(r.success).toBe(false);
      expect(r.error).toContain('No existing workspace analysis');
    });

    it('returns error when reader returns null', async () => {
      service.setAnalysisReader({
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue(null),
        readPhaseFile: jest.fn(),
      });
      const r = await service.regenerate(testWorkspacePath);
      expect(r.success).toBe(false);
      expect(r.error).toContain('No existing workspace analysis');
    });

    it('invalidates cache when force=true and forwards analysisDir', async () => {
      service.setAnalysisReader({
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue({
          slugDir: '/slug',
          manifest: { phases: {} },
        }),
        readPhaseFile: jest.fn().mockResolvedValue(null),
      });
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: [],
        devDependencies: [],
        fileStatistics: {},
        totalFiles: 0,
      });
      mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockReturnValue(
        undefined,
      );
      mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
        systemPrompt: 's',
        userPrompt: 'u',
        outputSchema: {},
      });
      mocks.internalQueryService.execute.mockResolvedValue({
        stream: (async function* () {
          /* empty */
        })(),
        close: jest.fn(),
      });
      mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
      mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
        fullOutput(),
      );

      const r = await service.regenerate(testWorkspacePath, { force: true });
      expect(r.success).toBe(true);
      expect(r.status).toBeDefined();
      expect(mocks.cacheService.invalidate).toHaveBeenCalledWith(
        testWorkspacePath,
        'manual',
      );
    });

    it('propagates runWizard failure', async () => {
      service.setAnalysisReader({
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue({
          slugDir: '/slug',
          manifest: { phases: {} },
        }),
        readPhaseFile: jest.fn().mockResolvedValue(null),
      });
      mocks.workspaceIntelligence.getProjectInfo.mockRejectedValue(
        new Error('boom'),
      );

      const r = await service.regenerate(testWorkspacePath);
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unable to analyze workspace');
    });
  });

  describe('generation lock timeout', () => {
    it('releases lock when timeout fires', async () => {
      jest.useFakeTimers();
      try {
        mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
          systemPrompt: 's',
          userPrompt: 'u',
          outputSchema: {},
        });
        let resolveProcess: (v: unknown) => void = () => undefined;
        mocks.internalQueryService.execute.mockResolvedValue({
          stream: (async function* () {
            /* empty */
          })(),
          close: jest.fn(),
        });
        mockProcess.mockReturnValue(
          new Promise((res) => {
            resolveProcess = res;
          }),
        );
        mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
          fullOutput(),
        );

        const input: PromptDesignerInput = {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        };
        const wizardPromise = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          input,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(service.isGeneratingPrompt()).toBe(true);

        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        expect(service.isGeneratingPrompt()).toBe(false);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Generation lock timed out'),
          expect.any(Object),
        );

        resolveProcess({ structuredOutput: { ok: true } });
        jest.useRealTimers();
        await wizardPromise;
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
