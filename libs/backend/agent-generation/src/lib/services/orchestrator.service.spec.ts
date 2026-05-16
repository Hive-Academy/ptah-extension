/**
 * AgentGenerationOrchestratorService Unit Tests
 *
 * The orchestrator is the stable surface the `/orchestrate` skill (and the
 * setup wizard) ultimately delegate to for project-adaptive agent
 * generation. Drift in any of its phase boundaries breaks every user-visible
 * generation workflow, so this spec exhaustively covers:
 *
 *   1. Phase-1 input routing (pre-computed analysis vs fresh workspace
 *      analysis vs analysisDir propagation) — equivalent to the task-type
 *      routing surface for the orchestrator's input dispatch.
 *   2. Full phase lifecycle (analyze -> select -> render -> write -> CLI
 *      distribution) with mocked platform abstraction tokens.
 *   3. Selection-gating checkpoints (user overrides vs automatic, empty
 *      selection short-circuit, threshold propagation) — corresponds to
 *      Full / Partial / Minimal workflow depth.
 *   4. Failure propagation through the Result pattern across every phase.
 *   5. Phase-5 (multi-CLI) and content-validation cancellation semantics
 *      — the "stop at the gate" behavior honored at spawn + steer.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// -----------------------------------------------------------------------------
// fs mock — orchestrator calls existsSync to detect package manager. Default
// returns false; individual tests can override per call.
// -----------------------------------------------------------------------------
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
}));

// -----------------------------------------------------------------------------
// workspace-intelligence mock — provides bare enums to avoid pulling the real
// library (and its transitive vscode/import.meta deps) into the test runtime.
// -----------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Angular: 'angular',
    Python: 'python',
    Java: 'java',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    Express: 'express',
    React: 'react',
    Angular: 'angular',
    NextJS: 'nextjs',
    Django: 'django',
    NestJS: 'nestjs',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
  },
  WorkspaceAnalyzerService: jest.fn(),
  ProjectDetectorService: jest.fn(),
  FrameworkDetectorService: jest.fn(),
  MonorepoDetectorService: jest.fn(),
}));

import { existsSync } from 'fs';
import { Result } from '@ptah-extension/shared';
import type { CliGenerationResult } from '@ptah-extension/shared';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';
import type {
  WorkspaceAnalyzerService,
  ProjectDetectorService,
  FrameworkDetectorService,
  MonorepoDetectorService,
} from '@ptah-extension/workspace-intelligence';
import { Logger } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { AgentGenerationOrchestratorService } from './orchestrator.service';
import type { OrchestratorGenerationOptions } from './orchestrator.service';
import type { IAgentSelectionService } from '../interfaces/agent-selection.interface';
import type { ITemplateStorageService } from '../interfaces/template-storage.interface';
import type { IContentGenerationService } from '../interfaces/content-generation.interface';
import type { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import type { IOutputValidationService } from '../interfaces/output-validation.interface';
import type { MultiCliAgentWriterService } from './cli-agent-transforms/multi-cli-agent-writer.service';
import type {
  AgentTemplate,
  AgentProjectContext,
  ValidationResult,
} from '../types/core.types';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const existsSyncMock = existsSync as jest.MockedFunction<typeof existsSync>;

function createMockTemplate(
  overrides: Partial<AgentTemplate> = {},
): AgentTemplate {
  return {
    id: 'backend-developer',
    name: 'Backend Developer',
    version: '1.0.0',
    content: '# Backend Developer\n\nBody content',
    applicabilityRules: {
      projectTypes: [],
      frameworks: [],
      monorepoTypes: [],
      minimumRelevanceScore: 50,
      alwaysInclude: false,
    },
    variables: [],
    llmSections: [],
    ...overrides,
  };
}

function createMockContext(
  overrides: Partial<AgentProjectContext> = {},
): AgentProjectContext {
  return {
    projectType: ProjectType.Node,
    frameworks: [Framework.Express],
    monorepoType: undefined,
    rootPath: '/workspace/test-project',
    relevantFiles: [],
    techStack: {
      languages: ['TypeScript'],
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
    ...overrides,
  };
}

function createValidationResult(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    isValid: true,
    issues: [],
    score: 95,
    ...overrides,
  };
}

interface OrchestratorMocks {
  agentSelector: jest.Mocked<IAgentSelectionService>;
  templateStorage: jest.Mocked<ITemplateStorageService>;
  contentGenerator: jest.Mocked<IContentGenerationService>;
  fileWriter: jest.Mocked<IAgentFileWriterService>;
  logger: jest.Mocked<Logger>;
  workspaceAnalyzer: jest.Mocked<WorkspaceAnalyzerService>;
  projectDetector: jest.Mocked<ProjectDetectorService>;
  frameworkDetector: jest.Mocked<FrameworkDetectorService>;
  monorepoDetector: jest.Mocked<MonorepoDetectorService>;
  multiCliWriter: jest.Mocked<MultiCliAgentWriterService>;
  sentryService: jest.Mocked<SentryService>;
  outputValidation: jest.Mocked<IOutputValidationService>;
}

function createOrchestrator(): {
  service: AgentGenerationOrchestratorService;
  mocks: OrchestratorMocks;
} {
  const agentSelector = {
    selectAgents: jest.fn(),
    calculateRelevance: jest.fn(),
  } as unknown as jest.Mocked<IAgentSelectionService>;

  const templateStorage = {
    loadAllTemplates: jest.fn(),
    loadTemplate: jest.fn(),
    getApplicableTemplates: jest.fn(),
  } as unknown as jest.Mocked<ITemplateStorageService>;

  const contentGenerator = {
    generateContent: jest.fn(),
    generateLlmSections: jest.fn(),
  } as unknown as jest.Mocked<IContentGenerationService>;

  const fileWriter = {
    writeAgent: jest.fn(),
    writeAgentsBatch: jest.fn(),
  } as unknown as jest.Mocked<IAgentFileWriterService>;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  } as unknown as jest.Mocked<Logger>;

  const workspaceAnalyzer = {
    getProjectInfo: jest.fn(),
  } as unknown as jest.Mocked<WorkspaceAnalyzerService>;

  const projectDetector = {} as unknown as jest.Mocked<ProjectDetectorService>;

  const frameworkDetector = {
    detectFramework: jest.fn(),
  } as unknown as jest.Mocked<FrameworkDetectorService>;

  const monorepoDetector = {
    detectMonorepo: jest.fn(),
  } as unknown as jest.Mocked<MonorepoDetectorService>;

  const multiCliWriter = {
    writeForClis: jest.fn(),
  } as unknown as jest.Mocked<MultiCliAgentWriterService>;

  const sentryService = {
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    addBreadcrumb: jest.fn(),
    isInitialized: jest.fn(() => true),
  } as unknown as jest.Mocked<SentryService>;

  const outputValidation = {
    validate: jest.fn(),
    checkHallucinations: jest.fn(),
  } as unknown as jest.Mocked<IOutputValidationService>;

  const service = new AgentGenerationOrchestratorService(
    agentSelector,
    templateStorage,
    contentGenerator,
    fileWriter,
    logger,
    workspaceAnalyzer,
    projectDetector,
    frameworkDetector,
    monorepoDetector,
    multiCliWriter,
    sentryService,
    outputValidation,
  );

  return {
    service,
    mocks: {
      agentSelector,
      templateStorage,
      contentGenerator,
      fileWriter,
      logger,
      workspaceAnalyzer,
      projectDetector,
      frameworkDetector,
      monorepoDetector,
      multiCliWriter,
      sentryService,
      outputValidation,
    },
  };
}

/**
 * Wire up the standard happy-path mock configuration: workspace analysis
 * succeeds, one template is selected, content generates and validates, file
 * writes succeed.
 */
function wireHappyPath(
  mocks: OrchestratorMocks,
  template: AgentTemplate = createMockTemplate(),
): void {
  mocks.workspaceAnalyzer.getProjectInfo.mockResolvedValue({
    name: 'test-project',
    type: ProjectType.Node,
    path: '/workspace/test-project',
    dependencies: ['express'],
    devDependencies: ['jest', 'typescript'],
    fileStatistics: {},
    totalFiles: 100,
    gitRepository: true,
  });
  mocks.monorepoDetector.detectMonorepo.mockResolvedValue({
    isMonorepo: false,
    type: undefined,
  } as unknown as never);
  mocks.frameworkDetector.detectFramework.mockResolvedValue(
    Framework.Express as never,
  );

  mocks.agentSelector.selectAgents.mockResolvedValue(
    Result.ok([
      {
        template,
        relevanceScore: 100,
        matchedCriteria: ['Project type: node'],
      },
    ]),
  );

  mocks.templateStorage.loadTemplate.mockResolvedValue(Result.ok(template));

  mocks.contentGenerator.generateContent.mockResolvedValue(
    Result.ok({
      content: '# Generated\n\nBody',
      description: 'Generated description for test project',
    }),
  );

  mocks.outputValidation.validate.mockResolvedValue(
    Result.ok(createValidationResult()),
  );

  mocks.fileWriter.writeAgent.mockResolvedValue(
    Result.ok('/workspace/test-project/.claude/agents/backend-developer.md'),
  );
}

// -----------------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------------

describe('AgentGenerationOrchestratorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
  });

  // ===========================================================================
  // 1. PHASE-1 INPUT ROUTING
  //    (Equivalent to "task-type routing" — orchestrator dispatches Phase 1
  //    based on the shape of the input options.)
  // ===========================================================================
  describe('Phase 1 input routing (analysis dispatch)', () => {
    it('uses pre-computed analysis when preComputedAnalysis is provided', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        preComputedAnalysis: {
          projectType: 'node',
          projectTypeDescription: 'Node.js Server',
          frameworks: ['Express'],
          languages: ['TypeScript'],
          languageDistribution: [
            { language: 'TypeScript', percentage: 80 },
            { language: 'JavaScript', percentage: 20 },
          ],
        } as never,
      };

      const result = await service.generateAgents(options);

      expect(result.isOk()).toBe(true);
      // Pre-computed path skips fresh framework + monorepo detection
      expect(mocks.frameworkDetector.detectFramework).not.toHaveBeenCalled();
      expect(mocks.monorepoDetector.detectMonorepo).not.toHaveBeenCalled();
      expect(mocks.workspaceAnalyzer.getProjectInfo).toHaveBeenCalled();
    });

    it('falls back to fresh workspace analysis when preComputedAnalysis is absent', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
      };

      const result = await service.generateAgents(options);

      expect(result.isOk()).toBe(true);
      expect(mocks.frameworkDetector.detectFramework).toHaveBeenCalledWith(
        '/workspace/test-project',
        ProjectType.Node,
      );
      expect(mocks.monorepoDetector.detectMonorepo).toHaveBeenCalledWith(
        '/workspace/test-project',
      );
    });

    it('orders languages by percentage when languageDistribution is provided', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        preComputedAnalysis: {
          projectType: 'node',
          frameworks: ['Express'],
          languages: ['TypeScript'],
          languageDistribution: [
            { language: 'JavaScript', percentage: 30 },
            { language: 'TypeScript', percentage: 70 },
          ],
        } as never,
      };

      await service.generateAgents(options);

      // The first call to selectAgents receives the constructed context.
      const callArgs = mocks.agentSelector.selectAgents.mock.calls[0];
      const passedContext = callArgs![0] as AgentProjectContext;
      expect(passedContext.techStack.languages[0]).toBe('TypeScript');
      expect(passedContext.techStack.languages[1]).toBe('JavaScript');
    });

    it('falls back to analysis.languages when languageDistribution is empty', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        preComputedAnalysis: {
          projectType: 'node',
          frameworks: [],
          languages: ['TypeScript', 'JavaScript'],
          languageDistribution: [],
        } as never,
      };

      await service.generateAgents(options);

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.techStack.languages).toEqual([
        'TypeScript',
        'JavaScript',
      ]);
    });

    it('propagates analysisDir into the project context for fresh analysis', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        analysisDir: '/workspace/test-project/.ptah/analysis',
      };

      await service.generateAgents(options);

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.analysisDir).toBe(
        '/workspace/test-project/.ptah/analysis',
      );
    });

    it('propagates analysisDir into the project context for pre-computed analysis', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        analysisDir: '/workspace/test-project/.ptah/analysis',
        preComputedAnalysis: {
          projectType: 'node',
          frameworks: ['Express'],
          languages: ['TypeScript'],
          languageDistribution: [],
        } as never,
      };

      await service.generateAgents(options);

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.analysisDir).toBe(
        '/workspace/test-project/.ptah/analysis',
      );
    });

    it('tolerates workspaceAnalyzer.getProjectInfo failure during pre-computed path', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.workspaceAnalyzer.getProjectInfo.mockRejectedValueOnce(
        new Error('FS unavailable'),
      );

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
        preComputedAnalysis: {
          projectType: 'node',
          frameworks: [],
          languages: ['TypeScript'],
          languageDistribution: [],
        } as never,
      };

      const result = await service.generateAgents(options);

      // Pre-computed path treats projectInfo as best-effort; failure is logged.
      expect(result.isOk()).toBe(true);
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Could not get projectInfo'),
      );
    });

    it('returns an error Result when fresh workspace analysis returns null projectInfo', async () => {
      const { service, mocks } = createOrchestrator();
      mocks.workspaceAnalyzer.getProjectInfo.mockResolvedValue(null as never);

      const options: OrchestratorGenerationOptions = {
        workspacePath: '/workspace/test-project',
      };

      const result = await service.generateAgents(options);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Could not analyze workspace');
    });
  });

  // ===========================================================================
  // 2. AGENT GENERATION LIFECYCLE
  //    (Phase pipeline: dispatch -> monitor -> cleanup with mocked platform
  //    abstraction tokens.)
  // ===========================================================================
  describe('Generation lifecycle (4-phase pipeline)', () => {
    it('completes all phases on the happy path', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.workspaceAnalyzer.getProjectInfo).toHaveBeenCalledTimes(1);
      expect(mocks.agentSelector.selectAgents).toHaveBeenCalledTimes(1);
      expect(mocks.templateStorage.loadTemplate).toHaveBeenCalledTimes(1);
      expect(mocks.contentGenerator.generateContent).toHaveBeenCalledTimes(1);
      expect(mocks.outputValidation.validate).toHaveBeenCalledTimes(1);
      expect(mocks.fileWriter.writeAgent).toHaveBeenCalledTimes(1);
    });

    it('reports progress through every phase boundary', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const phases: string[] = [];
      const progressCallback = jest.fn((p: { phase: string }) => {
        phases.push(p.phase);
      });

      await service.generateAgents(
        { workspacePath: '/workspace/test-project' },
        progressCallback,
      );

      expect(phases).toContain('analysis');
      expect(phases).toContain('selection');
      expect(phases).toContain('rendering');
      expect(phases).toContain('writing');
      expect(phases).toContain('complete');
    });

    it('produces a summary that reports successful, failed, and durationMs', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      const summary = result.value!;
      expect(summary.totalAgents).toBe(1);
      expect(summary.successful).toBe(1);
      expect(summary.failed).toBe(0);
      expect(typeof summary.durationMs).toBe('number');
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.agents).toHaveLength(1);
      expect(summary.agents[0].sourceTemplateId).toBe('backend-developer');
    });

    it('writes generated agents to context.rootPath/.claude/agents/<id>.md', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const writtenAgent = mocks.fileWriter.writeAgent.mock.calls[0]![0];
      expect(writtenAgent.filePath.replace(/\\/g, '/')).toContain(
        '.claude/agents/backend-developer.md',
      );
    });

    it('marks enhancedPromptsUsed=true when enhancedPromptContent is supplied', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        enhancedPromptContent: 'Use ports & adapters pattern',
      });

      expect(result.value!.enhancedPromptsUsed).toBe(true);
    });

    it('runs Phase 5 multi-CLI distribution when targetClis is supplied', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const cliResults: CliGenerationResult[] = [
        {
          cli: 'gemini',
          agentsWritten: 1,
          agentsFailed: 0,
          paths: ['/home/user/.gemini/agents/backend-developer.md'],
          errors: [],
        },
      ];
      mocks.multiCliWriter.writeForClis.mockResolvedValue(cliResults);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        targetClis: ['gemini'],
      });

      expect(mocks.multiCliWriter.writeForClis).toHaveBeenCalledTimes(1);
      expect(result.value!.cliResults).toEqual(cliResults);
    });

    it('detects build tools and testing frameworks from devDependencies', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.workspaceAnalyzer.getProjectInfo.mockResolvedValue({
        name: 'test',
        type: ProjectType.Node,
        path: '/workspace/test-project',
        dependencies: [],
        devDependencies: ['jest', 'webpack', 'vitest', 'turbo'],
        fileStatistics: {},
        totalFiles: 1,
        gitRepository: true,
      });

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.techStack.buildTools).toEqual(
        expect.arrayContaining(['webpack', 'turbo']),
      );
      expect(passedContext.techStack.testingFrameworks).toEqual(
        expect.arrayContaining(['jest', 'vitest']),
      );
    });

    it('detects package manager from lock files', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      existsSyncMock.mockImplementation((p) => {
        return String(p).endsWith('pnpm-lock.yaml');
      });

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.techStack.packageManager).toBe('pnpm');
    });

    it('falls back to npm when no lock file is present', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      existsSyncMock.mockReturnValue(false);

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const passedContext = mocks.agentSelector.selectAgents.mock
        .calls[0]![0] as AgentProjectContext;
      expect(passedContext.techStack.packageManager).toBe('npm');
    });

    it('strips the second YAML frontmatter block from generated content', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.contentGenerator.generateContent.mockResolvedValue(
        Result.ok({
          content:
            '\n---\nname: stale\ndescription: stale\n---\n\nReal body content',
          description: 'Fresh description',
        }),
      );

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const writtenAgent = mocks.fileWriter.writeAgent.mock.calls[0]![0];
      // Final content should keep exactly one frontmatter block (the
      // orchestrator-built one), not the stale templated block.
      expect(writtenAgent.content).toContain(
        'description: "Fresh description"',
      );
      expect(writtenAgent.content).not.toContain('description: stale');
    });

    it('caps description at 120 characters with ellipsis', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const longDesc = 'A'.repeat(200);
      mocks.contentGenerator.generateContent.mockResolvedValue(
        Result.ok({
          content: 'body',
          description: longDesc,
        }),
      );

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      const writtenAgent = mocks.fileWriter.writeAgent.mock.calls[0]![0];
      expect(writtenAgent.content).toMatch(/A{117}\.\.\./);
    });
  });

  // ===========================================================================
  // 3. SELECTION-GATING CHECKPOINTS
  //    (User overrides vs automatic selection, threshold gating, empty-set
  //    short-circuit — corresponds to Full / Partial / Minimal workflow depth.)
  // ===========================================================================
  describe('Selection gating (workflow depth)', () => {
    it('Full mode: applies automatic selection with default threshold of 50', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(mocks.agentSelector.selectAgents).toHaveBeenCalledWith(
        expect.any(Object),
        50,
      );
    });

    it('Full mode: applies automatic selection with custom threshold', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
        threshold: 80,
      });

      expect(mocks.agentSelector.selectAgents).toHaveBeenCalledWith(
        expect.any(Object),
        80,
      );
    });

    it('Partial mode: skips automatic selection when userOverrides is set', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const tplA = createMockTemplate({ id: 'agent-a', name: 'Agent A' });
      const tplB = createMockTemplate({ id: 'agent-b', name: 'Agent B' });
      mocks.templateStorage.loadTemplate.mockImplementation(async (id) => {
        if (id === 'agent-a') return Result.ok(tplA);
        if (id === 'agent-b') return Result.ok(tplB);
        return Result.err(new Error('not found'));
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        userOverrides: ['agent-a', 'agent-b'],
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.agentSelector.selectAgents).not.toHaveBeenCalled();
      expect(mocks.templateStorage.loadTemplate).toHaveBeenCalledWith(
        'agent-a',
      );
      expect(mocks.templateStorage.loadTemplate).toHaveBeenCalledWith(
        'agent-b',
      );
    });

    it('Partial mode: continues with subset when some user overrides fail to load', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const tplA = createMockTemplate({ id: 'agent-a' });
      mocks.templateStorage.loadTemplate.mockImplementation(async (id) => {
        if (id === 'agent-a') return Result.ok(tplA);
        return Result.err(new Error('missing'));
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        userOverrides: ['agent-a', 'agent-b-missing'],
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('Partial mode: errors when all user overrides fail to load', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.templateStorage.loadTemplate.mockResolvedValue(
        Result.err(new Error('not found')),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        userOverrides: ['missing-1', 'missing-2'],
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Failed to load any agent templates',
      );
    });

    it('Minimal mode: short-circuits with empty summary when selection returns 0 templates', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.agentSelector.selectAgents.mockResolvedValue(Result.ok([]));

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(result.value!.totalAgents).toBe(0);
      expect(result.value!.successful).toBe(0);
      expect(result.value!.failed).toBe(0);
      expect(result.value!.warnings).toContain(
        'No agents matched selection criteria',
      );
      expect(mocks.contentGenerator.generateContent).not.toHaveBeenCalled();
      expect(mocks.fileWriter.writeAgent).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. FAILURE PROPAGATION (Result pattern)
  //    Every phase must surface its failures via Result.err so the caller can
  //    react. Unhandled exceptions are captured by Sentry.
  // ===========================================================================
  describe('Failure propagation', () => {
    it('returns Result.err when Phase 2 (selection) fails', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.agentSelector.selectAgents.mockResolvedValue(
        Result.err(new Error('Selection blew up')),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toBe('Selection blew up');
      // Downstream phases must not run
      expect(mocks.contentGenerator.generateContent).not.toHaveBeenCalled();
      expect(mocks.fileWriter.writeAgent).not.toHaveBeenCalled();
    });

    it('returns Result.err when ALL Phase 3 renders fail', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.contentGenerator.generateContent.mockResolvedValue(
        Result.err(new Error('LLM offline')),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'No agents were successfully rendered',
      );
    });

    it('skips an agent (warning, not failure) when its template fails to load mid-render', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const tplOk = createMockTemplate({ id: 'ok-agent' });

      mocks.agentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: createMockTemplate({ id: 'ok-agent' }),
            relevanceScore: 100,
            matchedCriteria: [],
          },
          {
            template: createMockTemplate({ id: 'broken-agent' }),
            relevanceScore: 100,
            matchedCriteria: [],
          },
        ]),
      );
      mocks.templateStorage.loadTemplate.mockImplementation(async (id) => {
        if (id === 'ok-agent') return Result.ok(tplOk);
        return Result.err(new Error('I/O error'));
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(
        result.value!.warnings.some((w) => w.includes('broken-agent')),
      ).toBe(true);
      expect(result.value!.successful).toBe(1);
    });

    it('returns Result.err when ALL Phase 4 file writes fail', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.fileWriter.writeAgent.mockResolvedValue(
        Result.err(new Error('Disk full')),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('All agent file writes failed');
    });

    it('records partial write failure as warning, not a hard error', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const tplA = createMockTemplate({ id: 'agent-a' });
      const tplB = createMockTemplate({ id: 'agent-b' });
      mocks.agentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          { template: tplA, relevanceScore: 100, matchedCriteria: [] },
          { template: tplB, relevanceScore: 100, matchedCriteria: [] },
        ]),
      );
      mocks.templateStorage.loadTemplate.mockImplementation(async (id) =>
        Result.ok(id === 'agent-a' ? tplA : tplB),
      );
      let writeCalls = 0;
      mocks.fileWriter.writeAgent.mockImplementation(async () => {
        writeCalls++;
        if (writeCalls === 1) return Result.ok('/path/agent-a.md');
        return Result.err(new Error('Permission denied'));
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(result.value!.successful).toBe(1);
      expect(result.value!.failed).toBe(1);
      expect(
        result.value!.warnings.some((w) => w.includes('Permission denied')),
      ).toBe(true);
    });

    it('captures unhandled exceptions through SentryService and returns Result.err', async () => {
      const { service, mocks } = createOrchestrator();
      mocks.workspaceAnalyzer.getProjectInfo.mockImplementation(() => {
        throw new Error('Catastrophic init failure');
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isErr()).toBe(true);
      expect(mocks.sentryService.captureException).toHaveBeenCalled();
      expect(result.error?.message).toContain('Catastrophic init failure');
    });

    it('treats Phase 5 failure as non-fatal (warning only)', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.multiCliWriter.writeForClis.mockRejectedValue(
        new Error('Phase 5 crashed'),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        targetClis: ['gemini'],
      });

      expect(result.isOk()).toBe(true);
      expect(
        result.value!.warnings.some((w) =>
          w.includes('Multi-CLI distribution failed'),
        ),
      ).toBe(true);
    });

    it('appends per-CLI errors as warnings even when Phase 5 itself succeeded', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.multiCliWriter.writeForClis.mockResolvedValue([
        {
          cli: 'codex',
          agentsWritten: 0,
          agentsFailed: 1,
          paths: [],
          errors: ['No transformer registered for codex'],
        },
      ]);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        targetClis: ['codex'],
      });

      expect(result.isOk()).toBe(true);
      expect(
        result.value!.warnings.some((w) =>
          w.includes('No transformer registered for codex'),
        ),
      ).toBe(true);
    });
  });

  // ===========================================================================
  // 5. CANCELLATION SEMANTICS (gating + steer)
  //    The orchestrator's cancellation surface is its set of deterministic
  //    "stop the pipeline" gates: validation gating, conditional Phase 5
  //    dispatch, and content-generation refusal. Each gate must short-circuit
  //    a single agent or the entire pipeline without leaking partial output.
  // ===========================================================================
  describe('Cancellation semantics (validation gates)', () => {
    it('skips Phase 5 entirely when targetClis is undefined', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.multiCliWriter.writeForClis).not.toHaveBeenCalled();
      expect(result.value!.cliResults).toBeUndefined();
    });

    it('skips Phase 5 when targetClis is an empty array', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
        targetClis: [],
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.multiCliWriter.writeForClis).not.toHaveBeenCalled();
    });

    it('cancels writing a single agent when validation reports a critical issue', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.outputValidation.validate.mockResolvedValue(
        Result.ok(
          createValidationResult({
            isValid: false,
            score: 30,
            issues: [
              {
                severity: 'error',
                message: 'Contains sensitive credential pattern',
              },
            ],
          }),
        ),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      // Single agent skipped at the gate -> nothing rendered -> Result.err
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'No agents were successfully rendered',
      );
      expect(mocks.fileWriter.writeAgent).not.toHaveBeenCalled();
    });

    it('cancels writing a single agent when validation itself errors', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.outputValidation.validate.mockResolvedValue(
        Result.err(new Error('Validator unavailable')),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isErr()).toBe(true);
      expect(mocks.fileWriter.writeAgent).not.toHaveBeenCalled();
    });

    it('records validation warnings but still writes the agent (steer, not cancel)', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.outputValidation.validate.mockResolvedValue(
        Result.ok(
          createValidationResult({
            isValid: true,
            score: 75,
            issues: [
              {
                severity: 'warning',
                message: 'Potentially outdated import path',
              },
            ],
          }),
        ),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.fileWriter.writeAgent).toHaveBeenCalledTimes(1);
      expect(
        result.value!.warnings.some((w) =>
          w.includes('Potentially outdated import path'),
        ),
      ).toBe(true);
    });

    it('records validation info-severity issues without warning or cancellation', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      mocks.outputValidation.validate.mockResolvedValue(
        Result.ok(
          createValidationResult({
            isValid: true,
            score: 90,
            issues: [
              {
                severity: 'info',
                message: 'Consider adding more examples',
              },
            ],
          }),
        ),
      );

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(mocks.fileWriter.writeAgent).toHaveBeenCalledTimes(1);
      // info severity is not appended as a warning
      expect(
        result.value!.warnings.some((w) =>
          w.includes('Consider adding more examples'),
        ),
      ).toBe(false);
    });

    it('cancels per-agent rendering on contentGenerator failure but continues with siblings', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const tplA = createMockTemplate({ id: 'agent-a' });
      const tplB = createMockTemplate({ id: 'agent-b' });
      mocks.agentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          { template: tplA, relevanceScore: 100, matchedCriteria: [] },
          { template: tplB, relevanceScore: 100, matchedCriteria: [] },
        ]),
      );
      mocks.templateStorage.loadTemplate.mockImplementation(async (id) =>
        Result.ok(id === 'agent-a' ? tplA : tplB),
      );
      let calls = 0;
      mocks.contentGenerator.generateContent.mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          return Result.err(new Error('Rate limited'));
        }
        return Result.ok({
          content: '# B',
          description: 'desc',
        });
      });

      const result = await service.generateAgents({
        workspacePath: '/workspace/test-project',
      });

      expect(result.isOk()).toBe(true);
      expect(result.value!.successful).toBe(1);
      expect(result.value!.warnings.some((w) => w.includes('agent-a'))).toBe(
        true,
      );
    });

    it('passes the onStreamEvent callback through to the content generator SDK config', async () => {
      const { service, mocks } = createOrchestrator();
      wireHappyPath(mocks);
      const onStreamEvent = jest.fn();

      await service.generateAgents({
        workspacePath: '/workspace/test-project',
        onStreamEvent,
        isPremium: true,
        mcpServerRunning: true,
        mcpPort: 4242,
        model: 'claude-sonnet-4-7',
        pluginPaths: ['/abs/plugin/a'],
      });

      const sdkConfig =
        mocks.contentGenerator.generateContent.mock.calls[0]![2];
      expect(sdkConfig).toMatchObject({
        isPremium: true,
        mcpServerRunning: true,
        mcpPort: 4242,
        model: 'claude-sonnet-4-7',
        pluginPaths: ['/abs/plugin/a'],
        onStreamEvent,
      });
    });
  });
});
