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
      ((event: { reason: string; workspacePath: string }) => void) | null;
  };
  context: { globalState: { get: jest.Mock; update: jest.Mock } };
  workspaceIntelligence: {
    getProjectInfo: jest.Mock;
    getCurrentWorkspaceInfo: jest.Mock;
  };
  internalQueryService: { execute: jest.Mock };
  workspaceLlm: { resolveForPath: jest.Mock };
  analysisStorage: {
    writeEnhancedPromptTrace: jest.Mock;
    resolveAuthorizedAnalysisDir: jest.Mock;
  };
  freshness: { getStatus: jest.Mock };
}

const testWorkspacePath = '/test/workspace';

function createMocks(): Mocks {
  const cacheService = {
    computeDependencyHash: jest.fn().mockResolvedValue('basehash'),
    set: jest.fn().mockResolvedValue(undefined),
    onInvalidation: jest.fn(),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidationCallback: null as
      ((event: { reason: string; workspacePath: string }) => void) | null,
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
    workspaceLlm: {
      resolveForPath: jest.fn(
        async (_root: string, opts?: { requestedModel?: string }) => ({
          providerId: 'anthropic',
          model: opts?.requestedModel || 'default',
        }),
      ),
    },
    analysisStorage: {
      resolveAuthorizedAnalysisDir: jest.fn((_root: string, dir: string) =>
        dir.startsWith('.ptah/') ? `${testWorkspacePath}/${dir}` : dir,
      ),
      writeEnhancedPromptTrace: jest.fn().mockResolvedValue({
        markdownPath: '/test/workspace/.ptah/analysis/enhanced-prompt.md',
        metadataPath: '/test/workspace/.ptah/analysis/enhanced-prompt.json',
      }),
    },
    freshness: {
      getStatus: jest
        .fn()
        .mockResolvedValue({ state: 'missing', analysisDir: null }),
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
      mocks.workspaceLlm,
      mocks.analysisStorage,
      mocks.freshness,
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

    // A legacy or hand-edited prompt without the marker used to reach lanes
    // whole; it must never drop to no guidance (TASK_2026_597, R3.4).
    it('returns the whole prompt, trimmed, when the marker is missing', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: '  no marker here\n',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
      expect(await service.getProjectGuidanceContent(testWorkspacePath)).toBe(
        'no marker here',
      );
    });

    it('caps a marker-less prompt at 64 KiB and keeps it non-empty', async () => {
      const generatedPrompt = Array.from(
        { length: 160 },
        (_, n) => `### Legacy ${n}\n\n${'y'.repeat(500)}\n\n`,
      ).join('');
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt,
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });

      const r = await service.getProjectGuidanceContent(testWorkspacePath);

      expect(r).not.toBeNull();
      expect(Buffer.byteLength(r as string, 'utf8')).toBeLessThanOrEqual(64 * 1024);
      expect(r).toContain('### Legacy 0');
      expect(r).toContain('[Project guidance truncated at 64 KiB');
    });

    it('returns null for a whitespace-only prompt', async () => {
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: '   \n ',
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

    // This string is prepended to every CLI spawn and resent on every tool
    // call of that lane, so an unbounded workspace analysis must not reach it.
    it('caps oversized guidance at 64 KiB, cutting on a section boundary', async () => {
      const section = (n: number): string =>
        `### Section ${n}\n\n${'x'.repeat(500)}\n\n`;
      const generatedPrompt =
        'preamble\n## Project-Specific Guidance\n\n' +
        Array.from({ length: 160 }, (_, i) => section(i)).join('');

      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt,
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });

      const r = await service.getProjectGuidanceContent(testWorkspacePath);

      expect(r).not.toBeNull();
      expect(Buffer.byteLength(r as string, 'utf8')).toBeLessThanOrEqual(64 * 1024);
      expect(r).toContain('## Project-Specific Guidance');
      expect(r).toContain(
        '[Project guidance truncated at 64 KiB.]',
      );
      // Cut on a heading, so the retained tail is a whole section.
      expect(r).toMatch(/x{500}\n\n\[Project guidance truncated/);
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

    it('keeps the bound reservation after execution until its caller releases it', async () => {
      primeSuccessfulSdk();
      const reservation = service.acquireBoundGeneration();
      expect(reservation).not.toBeNull();
      expect(service.acquireBoundGeneration()).toBeNull();
      expect(await service.runWizard(testWorkspacePath)).toEqual({
        success: false,
        error: 'Generation already in progress',
      });
      const controller = new AbortController();
      const route = await service.resolveGuidanceRoute(
        testWorkspacePath,
        'requested',
      );
      const result = await service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        },
        undefined,
        undefined,
        { reservation: reservation!, signal: controller.signal, route },
      );
      expect(result.success).toBe(true);
      expect(service.generationInProgress).toBe(true);
      expect(service.acquireBoundGeneration()).toBeNull();
      service.releaseBoundGeneration(reservation!);
      expect(service.generationInProgress).toBe(false);
      expect(mocks.freshness.getStatus).not.toHaveBeenCalled();
      expect(mocks.workspaceLlm.resolveForPath).toHaveBeenCalledWith(
        testWorkspacePath,
        { requestedModel: 'requested' },
      );
    });

    it('stops before trace and state commit when cancelled during preparation', async () => {
      primeSuccessfulSdk();
      const reservation = service.acquireBoundGeneration();
      const controller = new AbortController();
      let releaseHash: (value: string) => void = () => undefined;
      mocks.cacheService.computeDependencyHash.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          releaseHash = resolve;
        }),
      );
      const route = await service.resolveGuidanceRoute(testWorkspacePath);
      const pending = service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        },
        undefined,
        undefined,
        { reservation: reservation!, signal: controller.signal, route },
      );
      for (
        let i = 0;
        i < 10 &&
        mocks.cacheService.computeDependencyHash.mock.calls.length === 0;
        i++
      )
        await Promise.resolve();
      controller.abort();
      releaseHash('hash');
      expect((await pending).success).toBe(false);
      service.releaseBoundGeneration(reservation!);
      expect(
        mocks.analysisStorage.writeEnhancedPromptTrace,
      ).not.toHaveBeenCalled();
      expect(mocks.context.globalState.update).not.toHaveBeenCalled();
    });

    it('stops after an in-flight stream abort without writing a trace', async () => {
      primeSuccessfulSdk();
      let releaseStream: (value: unknown) => void = () => undefined;
      mockProcess.mockReturnValue(
        new Promise((resolve) => {
          releaseStream = resolve;
        }),
      );
      const reservation = service.acquireBoundGeneration();
      const controller = new AbortController();
      const route = await service.resolveGuidanceRoute(testWorkspacePath);
      const pending = service.runWizard(
        testWorkspacePath,
        undefined,
        undefined,
        {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        },
        undefined,
        undefined,
        { reservation: reservation!, signal: controller.signal, route },
      );
      for (let i = 0; i < 10 && mockProcess.mock.calls.length === 0; i++)
        await Promise.resolve();
      controller.abort();
      releaseStream({ structuredOutput: { ok: true } });
      expect((await pending).success).toBe(false);
      service.releaseBoundGeneration(reservation!);
      expect(
        mocks.analysisStorage.writeEnhancedPromptTrace,
      ).not.toHaveBeenCalled();
    });

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

    it('detects monorepo when nx is only in devDependencies', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: ['react', 'onnx'],
        devDependencies: ['nx', 'jest', 'typescript'],
        fileStatistics: { '.ts': 5 },
        totalFiles: 5,
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
    });

    it('detects monorepo from a scoped @nx package', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: ['react'],
        devDependencies: ['@nx/devkit', 'jest'],
        fileStatistics: { '.ts': 5 },
        totalFiles: 5,
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
    });

    it('does not report monorepo when no monorepo tool is present', async () => {
      mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
        name: 'p',
        type: 'app',
        path: '/p',
        dependencies: ['react', 'onnx', 'next'],
        devDependencies: ['jest', 'typescript'],
        fileStatistics: { '.ts': 5 },
        totalFiles: 5,
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
      expect(result.state?.detectedStack?.projectType).toBe('app');
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
        { mcpServerRunning: false, pluginPaths: ['/p1'] },
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
        mcpServerRunning: false,
        pluginPaths: ['/p1'],
      });
      expect(mocks.internalQueryService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPromptAppend: 'base',
        }),
      );
    });

    it('runs on the provider and model of the snapshot for its workspace', async () => {
      mocks.workspaceLlm.resolveForPath.mockResolvedValue({
        providerId: 'moonshot',
        model: 'claude-pinned',
        auth: { env: { ANTHROPIC_AUTH_TOKEN: 'ws-key' } },
      });
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
      expect(mocks.workspaceLlm.resolveForPath).toHaveBeenCalledWith(
        testWorkspacePath,
        { requestedModel: undefined },
      );
      expect(mocks.internalQueryService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-pinned',
          auth: { env: { ANTHROPIC_AUTH_TOKEN: 'ws-key' } },
        }),
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
        mcpServerRunning: false,
        onStreamEvent,
      });
      expect(mockProcess).toHaveBeenCalled();
    });
  });

  describe('multi-phase analysis enrichment', () => {
    it('reads manifest from explicit analysis dir and appends sections', async () => {
      mocks.freshness.getStatus.mockResolvedValue({
        state: 'fresh',
        analysisDir: '/analysis/dir',
      });
      const reader = {
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue({
          slugDir: '/analysis/dir',
          manifest: {
            phases: {
              'project-profile': { status: 'completed', file: 'pp.md' },
              'quality-audit': { status: 'completed', file: 'qa.md' },
            },
          },
        }),
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
      expect(reader.readPhaseFile).not.toHaveBeenCalledWith(
        '/analysis/dir',
        'manifest.json',
      );
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
        expect.stringContaining('Analysis unavailable or stale'),
      );
    });

    it('falls back to findLatestMultiPhaseAnalysis when no explicit dir', async () => {
      mocks.freshness.getStatus.mockResolvedValue({
        state: 'fresh',
        analysisDir: '/slug',
      });
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
      mocks.freshness.getStatus.mockResolvedValue({
        state: 'fresh',
        analysisDir: '/slug',
      });
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
        { errorName: 'Error', errorMessage: 'reader broken' },
      );
    });
  });

  describe('regenerate', () => {
    it('returns discovery error when analysisReader not set', async () => {
      const r = await service.regenerate(testWorkspacePath);
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unable to analyze workspace');
    });

    it('returns discovery error when reader returns null', async () => {
      service.setAnalysisReader({
        findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue(null),
        readPhaseFile: jest.fn(),
      });
      const r = await service.regenerate(testWorkspacePath);
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unable to analyze workspace');
    });

    it('invalidates cache when force=true and forwards analysisDir', async () => {
      mocks.freshness.getStatus.mockResolvedValue({
        state: 'fresh',
        analysisDir: '/slug',
      });
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
      mocks.context.globalState.get.mockReturnValue({
        enabled: true,
        generatedPrompt: 'prior prompt',
        generatedAt: null,
        detectedStack: null,
        configHash: null,
        workspacePath: testWorkspacePath,
      });
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
      expect(await service.getEnhancedPromptContent(testWorkspacePath)).toBe(
        'prior prompt',
      );
      expect(mocks.context.globalState.update).not.toHaveBeenCalled();
      expect(mocks.cacheService.set).not.toHaveBeenCalled();
    });

    it.each(['stale', 'missing'])(
      'discovers workspace with %s analysis and no phase enrichment',
      async (state) => {
        mocks.freshness.getStatus.mockResolvedValue({
          state,
          analysisDir: '.ptah/analysis/old',
        });
        const reader = {
          findLatestMultiPhaseAnalysis: jest.fn(),
          readPhaseFile: jest.fn(),
        };
        service.setAnalysisReader(reader);
        mocks.workspaceIntelligence.getProjectInfo.mockResolvedValue({
          name: 'p',
          type: 'app',
          path: '/p',
          dependencies: [],
          devDependencies: [],
          fileStatistics: {},
          totalFiles: 0,
        });
        mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockResolvedValue(
          undefined,
        );
        mocks.promptDesignerAgent.buildPrompts.mockImplementation(
          async (input: PromptDesignerInput) => {
            expect(input.workspacePath).toBe(testWorkspacePath);
            expect(input.additionalContext).toBeUndefined();
            return { systemPrompt: 's', userPrompt: 'u', outputSchema: {} };
          },
        );
        mocks.internalQueryService.execute.mockResolvedValue({
          stream: (async function* () {})(),
          close: jest.fn(),
        });
        mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
        mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
          fullOutput(),
        );
        const result = await service.regenerate(testWorkspacePath);
        expect(result.success).toBe(true);
        expect(reader.findLatestMultiPhaseAnalysis).not.toHaveBeenCalled();
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).toHaveBeenCalledWith(
          testWorkspacePath,
          null,
          expect.any(String),
          expect.objectContaining({ analysisDirectory: null }),
        );
      },
    );
  });

  describe('generation lock timeout', () => {
    it('checks a force-released stale run abort while a new run is committing', async () => {
      jest.useFakeTimers();
      try {
        mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
          systemPrompt: 's',
          userPrompt: 'u',
          outputSchema: {},
        });
        mocks.internalQueryService.execute.mockResolvedValue({
          stream: (async function* () {})(),
          close: jest.fn(),
        });
        mockProcess.mockResolvedValue({ structuredOutput: { ok: true } });
        mocks.promptDesignerAgent.parseAndValidateOutput.mockResolvedValue(
          fullOutput(),
        );
        let releaseOld: () => void = () => undefined;
        let releaseNew: () => void = () => undefined;
        mocks.analysisStorage.writeEnhancedPromptTrace
          .mockReturnValueOnce(
            new Promise<void>((resolve) => {
              releaseOld = resolve;
            }),
          )
          .mockReturnValueOnce(
            new Promise<void>((resolve) => {
              releaseNew = resolve;
            }),
          );
        const input: PromptDesignerInput = {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        };
        const stale = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          input,
        );
        for (
          let i = 0;
          i < 100 &&
          mocks.analysisStorage.writeEnhancedPromptTrace.mock.calls.length < 1;
          i++
        )
          await Promise.resolve();
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(12 * 60 * 1000 + 30 * 1000 + 1);
        const reservation = service.acquireBoundGeneration();
        expect(reservation).not.toBeNull();
        const route = await service.resolveGuidanceRoute(testWorkspacePath);
        const current = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          input,
          undefined,
          undefined,
          {
            reservation: reservation!,
            signal: new AbortController().signal,
            route,
            beforeCommit: () => true,
          },
        );
        for (
          let i = 0;
          i < 100 &&
          mocks.analysisStorage.writeEnhancedPromptTrace.mock.calls.length < 2;
          i++
        )
          await Promise.resolve();
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).toHaveBeenCalledTimes(2);
        releaseOld();
        expect((await stale).success).toBe(false);
        releaseNew();
        expect((await current).success).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
    it('allows a committing run through the timer and past the designer timeout', async () => {
      jest.useFakeTimers();
      try {
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
        let releaseTrace: () => void = () => undefined;
        mocks.analysisStorage.writeEnhancedPromptTrace.mockReturnValueOnce(
          new Promise<void>((resolve) => {
            releaseTrace = resolve;
          }),
        );
        const reservation = service.acquireBoundGeneration();
        const route = await service.resolveGuidanceRoute(testWorkspacePath);
        const onTimeout = jest.fn();
        const pending = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          {
            workspacePath: testWorkspacePath,
            projectType: 'app',
            isMonorepo: false,
            dependencies: [],
            devDependencies: [],
          },
          undefined,
          undefined,
          {
            reservation: reservation!,
            signal: new AbortController().signal,
            route,
            beforeCommit: () => true,
            onTimeout,
          },
        );
        for (
          let i = 0;
          i < 100 &&
          !mocks.analysisStorage.writeEnhancedPromptTrace.mock.calls.length;
          i++
        )
          await Promise.resolve();
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).toHaveBeenCalled();
        jest.advanceTimersByTime(10 * 60 * 1000 + 1);
        expect(onTimeout).not.toHaveBeenCalled();
        jest.advanceTimersByTime(2 * 60 * 1000);
        expect(onTimeout).not.toHaveBeenCalled();
        releaseTrace();
        expect((await pending).success).toBe(true);
        expect(mocks.context.globalState.update).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('aborts a timed-out tabless run, releases in finally, and never commits', async () => {
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
        for (let i = 0; i < 100 && mockProcess.mock.calls.length === 0; i++)
          await Promise.resolve();
        expect(mockProcess).toHaveBeenCalled();
        expect(service.isGeneratingPrompt()).toBe(true);

        jest.advanceTimersByTime(12 * 60 * 1000 + 1);
        expect(service.isGeneratingPrompt()).toBe(true);
        expect(
          mocks.internalQueryService.execute.mock.calls[0][0].abortController
            .signal.aborted,
        ).toBe(true);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Generation lock timed out'),
          expect.any(Object),
        );

        resolveProcess({ structuredOutput: { ok: true } });
        const result = await wizardPromise;
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out/i);
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).not.toHaveBeenCalled();
        expect(mocks.context.globalState.update).not.toHaveBeenCalled();
        expect(service.isGeneratingPrompt()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('aborts a bound run before commit and reports its timeout callback', async () => {
      jest.useFakeTimers();
      try {
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
        let releaseHash: (value: string) => void = () => undefined;
        mocks.cacheService.computeDependencyHash.mockReturnValueOnce(
          new Promise<string>((resolve) => {
            releaseHash = resolve;
          }),
        );
        const reservation = service.acquireBoundGeneration();
        const controller = new AbortController();
        const onTimeout = jest.fn();
        const onForceRelease = jest.fn();
        const route = await service.resolveGuidanceRoute(testWorkspacePath);
        const pending = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          {
            workspacePath: testWorkspacePath,
            projectType: 'app',
            isMonorepo: false,
            dependencies: [],
            devDependencies: [],
          },
          undefined,
          undefined,
          {
            reservation: reservation!,
            signal: controller.signal,
            route,
            onTimeout,
            onForceRelease,
          },
        );
        for (
          let i = 0;
          i < 100 &&
          mocks.cacheService.computeDependencyHash.mock.calls.length === 0;
          i++
        )
          await Promise.resolve();
        expect(mocks.cacheService.computeDependencyHash).toHaveBeenCalled();
        jest.advanceTimersByTime(12 * 60 * 1000 + 1);
        expect(onTimeout).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(30 * 1000 + 1);
        expect(onForceRelease).toHaveBeenCalledTimes(1);
        releaseHash('hash');
        expect((await pending).error).toMatch(/timed out/i);
        expect(service.isGeneratingPrompt()).toBe(false);
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).not.toHaveBeenCalled();
        expect(mocks.context.globalState.update).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('force releases after grace and a stale tabless finally cannot release a new owner', async () => {
      jest.useFakeTimers();
      try {
        const input: PromptDesignerInput = {
          workspacePath: testWorkspacePath,
          projectType: 'app',
          isMonorepo: false,
          dependencies: [],
          devDependencies: [],
        };
        let resolveFirst: (value: unknown) => void = () => undefined;
        mocks.promptDesignerAgent.buildPrompts.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
        );
        const first = service.runWizard(
          testWorkspacePath,
          undefined,
          undefined,
          input,
        );
        await Promise.resolve();
        jest.advanceTimersByTime(12 * 60 * 1000 + 30 * 1000 + 1);
        expect(service.isGeneratingPrompt()).toBe(false);
        const reservation = service.acquireBoundGeneration();
        expect(reservation).not.toBeNull();
        resolveFirst({ systemPrompt: 's', userPrompt: 'u', outputSchema: {} });
        expect((await first).success).toBe(false);
        expect(service.isGeneratingPrompt()).toBe(true);
        expect(
          mocks.analysisStorage.writeEnhancedPromptTrace,
        ).not.toHaveBeenCalled();
        expect(mocks.context.globalState.update).not.toHaveBeenCalled();
        if (reservation) service.releaseBoundGeneration(reservation);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a stale bound release cannot release a new owner after timeout grace', () => {
      jest.useFakeTimers();
      try {
        const old = service.acquireBoundGeneration();
        expect(old).not.toBeNull();
        jest.advanceTimersByTime(12 * 60 * 1000 + 30 * 1000 + 1);
        const next = service.acquireBoundGeneration();
        expect(next).not.toBeNull();
        if (old) service.releaseBoundGeneration(old);
        expect(service.isGeneratingPrompt()).toBe(true);
        if (next) service.releaseBoundGeneration(next);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

// =============================================================================
// Enhanced-prompt trace (TASK_2026_361)
// =============================================================================

describe('EnhancedPromptsService — enhanced prompt trace', () => {
  let mocks: Mocks;
  let service: EnhancedPromptsService;
  const input: PromptDesignerInput = {
    workspacePath: testWorkspacePath,
    projectType: 'app',
    isMonorepo: false,
    dependencies: [],
    devDependencies: [],
  };
  const slugDir = '/test/workspace/.ptah/analysis/demo';

  function primeSdk(): void {
    mocks.promptDesignerAgent.buildPrompts.mockResolvedValue({
      systemPrompt: 'sys',
      userPrompt: 'user',
      outputSchema: { type: 'object' },
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
  }

  function readerFor(
    phases: Record<string, { status: string; file: string }>,
    contents: Record<string, string | null>,
  ) {
    return {
      findLatestMultiPhaseAnalysis: jest
        .fn()
        .mockResolvedValue({ slugDir, manifest: { phases } }),
      readPhaseFile: jest.fn(async (_dir: string, file: string) => {
        if (file === 'manifest.json') return JSON.stringify({ phases });
        return contents[file] ?? null;
      }),
    };
  }

  beforeEach(() => {
    mockProcess.mockReset();
    mocks = createMocks();
    service = createService(mocks);
    primeSdk();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('writes the trace into the slug directory with only the completed phases it used, before saving state', async () => {
    mocks.freshness.getStatus.mockResolvedValue({
      state: 'fresh',
      analysisDir: '.ptah/analysis/demo',
    });
    service.setAnalysisReader(
      readerFor(
        {
          'project-profile': { status: 'completed', file: 'pp.md' },
          'architecture-assessment': { status: 'failed', file: 'aa.md' },
          'quality-audit': { status: 'completed', file: 'qa.md' },
          'elevation-plan': { status: 'pending', file: 'ep.md' },
        },
        { 'pp.md': 'PROFILE', 'aa.md': 'FAILED TEXT', 'qa.md': 'QA' },
      ),
    );

    const result = await service.runWizard(
      testWorkspacePath,
      undefined,
      undefined,
      input,
      undefined,
      slugDir,
    );

    expect(result.success).toBe(true);
    expect(
      mocks.analysisStorage.writeEnhancedPromptTrace,
    ).toHaveBeenCalledTimes(1);
    const [ws, dir, prompt, metadata] =
      mocks.analysisStorage.writeEnhancedPromptTrace.mock.calls[0];
    expect(ws).toBe(testWorkspacePath);
    expect(dir).toBe(slugDir);
    expect(prompt).toContain('## Project-Specific Guidance');
    expect(prompt).toBe(result.state?.generatedPrompt);
    expect(metadata).toEqual({
      generatedAt: result.state?.generatedAt,
      configHash: 'basehash:pt1234',
      detectedStack: result.state?.detectedStack,
      analysisDirectory: '.ptah/analysis/demo',
      analysisPhaseIds: ['project-profile', 'quality-audit'],
      promptLength: (result.state?.generatedPrompt ?? '').length,
    });
    const traceOrder =
      mocks.analysisStorage.writeEnhancedPromptTrace.mock
        .invocationCallOrder[0];
    const saveOrder =
      mocks.context.globalState.update.mock.invocationCallOrder[0];
    expect(traceOrder).toBeLessThan(saveOrder);
  });

  it('uses the fallback root with a null analysis directory when no analysis exists', async () => {
    const result = await service.runWizard(
      testWorkspacePath,
      undefined,
      undefined,
      input,
    );

    expect(result.success).toBe(true);
    expect(mocks.analysisStorage.writeEnhancedPromptTrace).toHaveBeenCalledWith(
      testWorkspacePath,
      null,
      expect.any(String),
      expect.objectContaining({
        analysisDirectory: null,
        analysisPhaseIds: [],
      }),
    );
  });

  it('returns failure and saves neither state nor cache when the trace write fails', async () => {
    mocks.analysisStorage.writeEnhancedPromptTrace.mockRejectedValue(
      new Error('EACCES'),
    );

    const result = await service.runWizard(
      testWorkspacePath,
      undefined,
      undefined,
      input,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('trace');
    expect(result.error).toContain('EACCES');
    expect(result.state).toBeUndefined();
    expect(mocks.context.globalState.update).not.toHaveBeenCalled();
    expect(mocks.cacheService.set).not.toHaveBeenCalled();
    expect(service.isGeneratingPrompt()).toBe(false);
    expect(
      await service.getEnhancedPromptContent(testWorkspacePath),
    ).toBeNull();
  });

  it('regenerate traces into the latest slug directory', async () => {
    const latestDir = '/test/workspace/.ptah/analysis/latest';
    mocks.freshness.getStatus.mockResolvedValue({
      state: 'fresh',
      analysisDir: '.ptah/analysis/latest',
    });
    service.setAnalysisReader({
      findLatestMultiPhaseAnalysis: jest.fn().mockResolvedValue({
        slugDir: latestDir,
        manifest: {
          phases: { 'project-profile': { status: 'completed', file: 'pp.md' } },
        },
      }),
      readPhaseFile: jest.fn(async (_dir: string, file: string) =>
        file === 'manifest.json'
          ? JSON.stringify({
              phases: {
                'project-profile': { status: 'completed', file: 'pp.md' },
              },
            })
          : 'PROFILE',
      ),
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
    mocks.workspaceIntelligence.getCurrentWorkspaceInfo.mockResolvedValue(
      undefined,
    );

    const result = await service.regenerate(testWorkspacePath);

    expect(result.success).toBe(true);
    expect(mocks.analysisStorage.writeEnhancedPromptTrace).toHaveBeenCalledWith(
      testWorkspacePath,
      latestDir,
      expect.any(String),
      expect.objectContaining({
        analysisDirectory: '.ptah/analysis/latest',
        analysisPhaseIds: ['project-profile'],
      }),
    );
  });
});
