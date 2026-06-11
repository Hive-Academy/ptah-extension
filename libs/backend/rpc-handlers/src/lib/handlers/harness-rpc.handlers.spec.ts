/**
 * HarnessRpcHandlers — thin facade specs. Locks these invariants:
 *   1. `register()` wires exactly the `METHODS` entries, in order.
 *   2. Each method delegates to the expected service on the happy path.
 *   3. `runRpc` funnels thrown errors into Sentry + re-throws (via design-agents).
 *   4. `harness:start-new-project` enables the SaaS plugin, focuses chat,
 *      broadcasts the workflow-open message, and is best-effort on soft fails.
 *   5. `harness:workflow-prompt` delegates to HarnessWorkflowPromptService.
 * Service-level behaviour (LLM, streams, fs I/O) lives in per-service specs.
 */

import 'reflect-metadata';

import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type {
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import type {
  IWorkspaceProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  createMockPlatformCommands,
  type MockPlatformCommands,
} from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { DependencyContainer } from 'tsyringe';

import { HarnessRpcHandlers } from './harness-rpc.handlers';
import type { HarnessWorkspaceContextService } from '../harness/workspace/harness-workspace-context.service';
import type { HarnessSuggestionService } from '../harness/ai/harness-suggestion.service';
import type { HarnessSubagentDesignService } from '../harness/ai/harness-subagent-design.service';
import type { HarnessSkillGenerationService } from '../harness/ai/harness-skill-generation.service';
import type { HarnessDocumentGenerationService } from '../harness/ai/harness-document-generation.service';
import type { HarnessPromptBuilderService } from '../harness/config/harness-prompt-builder.service';
import type { HarnessConfigStore } from '../harness/config/harness-config-store.service';
import type { HarnessAgentFileWriterService } from '../harness/config/harness-agent-file-writer.service';
import type { HarnessWorkflowPromptService } from '../harness/ai/harness-workflow-prompt.service';
import type { HarnessFsService } from '../harness/io/harness-fs.service';

type Mocked<T> = jest.Mocked<T>;

interface MockContainer extends jest.Mocked<
  Pick<DependencyContainer, 'resolve'>
> {
  __register(token: symbol | string, service: unknown): void;
}

function createMockContainer(): MockContainer {
  const services = new Map<symbol | string, unknown>();
  const mock = {
    resolve: jest.fn((token: symbol | string): unknown => {
      if (services.has(token)) {
        return services.get(token);
      }
      throw new Error(
        `MockContainer: no service registered for token ${String(token)}`,
      );
    }),
    __register(token: symbol | string, service: unknown): void {
      services.set(token, service);
    },
  } as unknown as MockContainer;
  return mock;
}

interface Suite {
  handlers: HarnessRpcHandlers;
  rpc: MockRpcHandler;
  sentry: ReturnType<typeof createMockSentryService>;
  logger: ReturnType<typeof createMockLogger>;
  pluginLoader: jest.Mocked<
    Pick<
      PluginLoaderService,
      | 'getWorkspacePluginConfig'
      | 'resolvePluginPaths'
      | 'saveWorkspacePluginConfig'
      | 'resolveCurrentPluginPaths'
      | 'discoverSkillsForPlugins'
      | 'getDisabledSkillIds'
    >
  >;
  skillJunction: Mocked<SkillJunctionService>;
  platformCommands: MockPlatformCommands;
  container: MockContainer;
  workspaceContext: Mocked<HarnessWorkspaceContextService>;
  suggestion: Mocked<HarnessSuggestionService>;
  subagentDesign: Mocked<HarnessSubagentDesignService>;
  skillGeneration: Mocked<HarnessSkillGenerationService>;
  documentGeneration: Mocked<HarnessDocumentGenerationService>;
  promptBuilder: Mocked<HarnessPromptBuilderService>;
  configStore: Mocked<HarnessConfigStore>;
  agentFileWriter: Mocked<HarnessAgentFileWriterService>;
  workflowPrompt: Mocked<HarnessWorkflowPromptService>;
  fsService: Mocked<HarnessFsService>;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const sentry = createMockSentryService();

  const pluginLoader = {
    resolveCurrentPluginPaths: jest.fn().mockReturnValue([]),
    discoverSkillsForPlugins: jest.fn().mockReturnValue([]),
    getDisabledSkillIds: jest.fn().mockReturnValue([]),
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
    saveWorkspacePluginConfig: jest.fn().mockResolvedValue(undefined),
  } as unknown as Suite['pluginLoader'];
  const skillJunction = {
    createJunctions: jest
      .fn()
      .mockReturnValue({ created: 0, skipped: 0, removed: 0, errors: [] }),
  } as unknown as Mocked<SkillJunctionService>;
  const workspaceProvider = createMockWorkspaceProvider({
    folders: ['/ws'],
  }) as unknown as IWorkspaceProvider;
  const platformCommands = createMockPlatformCommands();
  const container = createMockContainer();

  const workspaceContext = {
    requireWorkspaceRoot: jest.fn().mockReturnValue('/ws'),
    resolveWorkspaceContext: jest.fn().mockResolvedValue({
      projectName: 'demo',
      projectType: 'node',
      frameworks: [],
      languages: ['TypeScript'],
    }),
    getAvailableAgents: jest.fn().mockReturnValue([]),
    discoverAvailableSkills: jest.fn().mockReturnValue([]),
  } as unknown as Mocked<HarnessWorkspaceContextService>;

  const suggestion = {
    buildSuggestionFromPersona: jest.fn().mockResolvedValue({
      suggestedAgents: {},
      suggestedSkills: [],
      suggestedMcpServers: [],
      generatedPrompt: '',
      reasoning: '',
    }),
    analyzeIntent: jest.fn().mockResolvedValue({
      persona: { label: '', description: '', goals: [] },
      suggestedAgents: {},
      suggestedSubagents: [],
      suggestedSkillIds: [],
      suggestedSkillSpecs: [],
      generatedPrompt: '',
      suggestedMcpServers: [],
      summary: '',
      reasoning: '',
    }),
  } as unknown as Mocked<HarnessSuggestionService>;

  const subagentDesign = {
    designSubagentFleet: jest
      .fn()
      .mockResolvedValue({ subagents: [], reasoning: '' }),
  } as unknown as Mocked<HarnessSubagentDesignService>;
  const skillGeneration = {
    generateSkillSpecs: jest
      .fn()
      .mockResolvedValue({ skills: [], reasoning: '' }),
  } as unknown as Mocked<HarnessSkillGenerationService>;
  const documentGeneration = {
    generateComprehensiveDocument: jest
      .fn()
      .mockResolvedValue({ document: '# doc', sections: {} }),
  } as unknown as Mocked<HarnessDocumentGenerationService>;

  const promptBuilder = {
    buildPromptSections: jest.fn().mockReturnValue({ persona: 'P' }),
    buildClaudeMdContent: jest.fn().mockReturnValue('# CLAUDE'),
  } as unknown as Mocked<HarnessPromptBuilderService>;

  const configStore = Object.assign(
    {
      writeClaudeMdToWorkspace: jest
        .fn()
        .mockResolvedValue({ claudeMdPath: '/ws/.claude/CLAUDE.md' }),
      updatePtahSettings: jest.fn().mockResolvedValue(undefined),
      normalizeHarnessConfig: jest.fn().mockImplementation((c) => c),
      writePresetToDisk: jest.fn().mockResolvedValue('/ptah/presets/p.json'),
      loadPresetsFromDisk: jest.fn().mockResolvedValue([]),
      sanitizeFileName: jest.fn().mockImplementation((s) => s),
    },
    { settingsPath: '/ptah/settings.json' },
  ) as unknown as Mocked<HarnessConfigStore>;

  const agentFileWriter = {
    writeSubagentFiles: jest
      .fn()
      .mockResolvedValue({ writtenPaths: [], warnings: [] }),
  } as unknown as Mocked<HarnessAgentFileWriterService>;

  const workflowPrompt = {
    composePrompt: jest.fn().mockResolvedValue({ prompt: 'WORKFLOW PROMPT' }),
  } as unknown as Mocked<HarnessWorkflowPromptService>;

  const fsService = {
    createSkillPlugin: jest.fn().mockResolvedValue({
      skillId: 'demo-skill',
      skillPath:
        '/home/user/.ptah/plugins/ptah-harness-demo-skill/skills/demo-skill/SKILL.md',
    }),
    discoverHarnessPluginPaths: jest.fn().mockResolvedValue([]),
    discoverMcpServers: jest.fn().mockResolvedValue({
      servers: [
        {
          name: 'ptah-mcp',
          url: 'http://localhost:0',
          description: 'Built-in Ptah MCP server',
          enabled: true,
        },
      ],
    }),
  } as unknown as Mocked<HarnessFsService>;

  const handlers = new HarnessRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    sentry as unknown as SentryService,
    pluginLoader as unknown as PluginLoaderService,
    skillJunction,
    workspaceProvider,
    platformCommands as unknown as IPlatformCommands,
    container as unknown as DependencyContainer,
    workspaceContext,
    suggestion,
    subagentDesign,
    skillGeneration,
    documentGeneration,
    promptBuilder,
    configStore,
    agentFileWriter,
    workflowPrompt,
    fsService,
  );

  return {
    handlers,
    rpc,
    sentry,
    logger,
    pluginLoader,
    skillJunction,
    platformCommands,
    container,
    workspaceContext,
    suggestion,
    subagentDesign,
    skillGeneration,
    documentGeneration,
    promptBuilder,
    configStore,
    agentFileWriter,
    workflowPrompt,
    fsService,
  };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (p: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method ${method} not registered`);
  return match[1];
}

const persona = { label: 'L', description: 'D', goals: [] };
const config = { name: 'x' } as unknown as Record<string, unknown>;

describe('HarnessRpcHandlers (thin facade)', () => {
  it('register() wires exactly the METHODS tuple entries, in order', () => {
    const { handlers, rpc } = buildSuite();
    handlers.register();
    const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name,
    );
    expect(registered).toEqual([...HarnessRpcHandlers.METHODS]);
  });

  it.each([...HarnessRpcHandlers.METHODS])(
    'registers %s with a function handler',
    (method) => {
      const { handlers, rpc } = buildSuite();
      handlers.register();
      const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
        [string, unknown]
      >;
      const match = calls.find(([name]) => name === method);
      expect(match).toBeDefined();
      expect(typeof match?.[1]).toBe('function');
    },
  );

  describe('delegation — happy paths', () => {
    interface Case {
      method: string;
      params: Record<string, unknown>;
      assert: (s: Suite) => void;
    }
    const cases: Case[] = [
      {
        method: 'harness:suggest-config',
        params: { personaDescription: 'backend dev', goals: ['ship'] },
        assert: (s) =>
          expect(s.suggestion.buildSuggestionFromPersona).toHaveBeenCalledWith(
            'backend dev',
            ['ship'],
            [],
            [],
          ),
      },
      {
        method: 'harness:generate-prompt',
        params: { persona, enabledAgents: ['gemini'], selectedSkills: ['s1'] },
        assert: (s) =>
          expect(s.promptBuilder.buildPromptSections).toHaveBeenCalledWith(
            persona,
            ['gemini'],
            ['s1'],
          ),
      },
      {
        method: 'harness:generate-claude-md',
        params: { config },
        assert: (s) =>
          expect(s.promptBuilder.buildClaudeMdContent).toHaveBeenCalledWith(
            config,
          ),
      },
      {
        method: 'harness:design-agents',
        params: { persona, existingAgents: ['gemini'] },
        assert: (s) =>
          expect(s.subagentDesign.designSubagentFleet).toHaveBeenCalledWith(
            persona,
            ['gemini'],
            undefined,
          ),
      },
      {
        method: 'harness:generate-skills',
        params: { persona, existingSkills: [] },
        assert: (s) =>
          expect(s.skillGeneration.generateSkillSpecs).toHaveBeenCalledWith(
            persona,
            [],
            undefined,
          ),
      },
      {
        method: 'harness:generate-document',
        params: { config },
        assert: (s) =>
          expect(
            s.documentGeneration.generateComprehensiveDocument,
          ).toHaveBeenCalledWith(config, undefined),
      },
      {
        method: 'harness:save-preset',
        params: { name: 'cfg', config, description: 'd' },
        assert: (s) => {
          expect(s.configStore.writePresetToDisk).toHaveBeenCalledWith(
            'cfg',
            config,
            'd',
          );
          expect(s.configStore.sanitizeFileName).toHaveBeenCalledWith('cfg');
        },
      },
      {
        method: 'harness:load-presets',
        params: {},
        assert: (s) =>
          expect(s.configStore.loadPresetsFromDisk).toHaveBeenCalled(),
      },
      {
        method: 'harness:workflow-prompt',
        params: { mode: 'configure-harness', intent: 'build a CRM harness' },
        assert: (s) =>
          expect(s.workflowPrompt.composePrompt).toHaveBeenCalledWith({
            mode: 'configure-harness',
            intent: 'build a CRM harness',
          }),
      },
      {
        method: 'harness:analyze-intent',
        params: { input: 'build me a real estate harness' },
        assert: (s) =>
          expect(s.suggestion.analyzeIntent).toHaveBeenCalledWith({
            input: 'build me a real estate harness',
            availableSkills: [],
            availableAgents: [],
            workspaceContext: undefined,
          }),
      },
      {
        method: 'harness:create-skill',
        params: { name: 'Demo Skill', description: 'demo', content: 'body' },
        assert: (s) =>
          expect(s.fsService.createSkillPlugin).toHaveBeenCalledWith({
            name: 'Demo Skill',
            description: 'demo',
            content: 'body',
          }),
      },
      {
        method: 'harness:discover-mcp',
        params: {},
        assert: (s) =>
          expect(s.fsService.discoverMcpServers).toHaveBeenCalled(),
      },
    ];

    it.each(cases)(
      '$method delegates to the expected service',
      async ({ method, params, assert }) => {
        const suite = buildSuite();
        suite.handlers.register();
        await getHandler(suite.rpc, method)(params);
        assert(suite);
      },
    );

    it('harness:initialize fans out to workspaceContext + configStore', async () => {
      const suite = buildSuite();
      suite.handlers.register();
      const result = await getHandler(suite.rpc, 'harness:initialize')({});
      expect(suite.workspaceContext.resolveWorkspaceContext).toHaveBeenCalled();
      expect(suite.configStore.loadPresetsFromDisk).toHaveBeenCalled();
      expect(result).toMatchObject({
        workspaceContext: { projectName: 'demo' },
        existingPresets: [],
      });
    });

    it('harness:analyze-intent rejects inputs shorter than 10 chars', async () => {
      const suite = buildSuite();
      suite.handlers.register();
      await expect(
        getHandler(suite.rpc, 'harness:analyze-intent')({ input: 'short' }),
      ).rejects.toThrow('at least 10 characters');
      expect(suite.suggestion.analyzeIntent).not.toHaveBeenCalled();
    });
  });

  it('runRpc captures thrown errors in Sentry with the errorSource tag and re-throws', async () => {
    const suite = buildSuite();
    const boom = new Error('design failed');
    suite.subagentDesign.designSubagentFleet.mockRejectedValueOnce(boom);
    suite.handlers.register();

    await expect(
      getHandler(
        suite.rpc,
        'harness:design-agents',
      )({ persona, existingAgents: [] }),
    ).rejects.toBe(boom);

    expect(suite.sentry.captureException).toHaveBeenCalledWith(boom, {
      errorSource: 'HarnessRpcHandlers.registerDesignAgents',
    });
    expect(suite.logger.error).toHaveBeenCalledWith(
      'RPC: harness:design-agents failed',
      boom,
    );
  });

  describe('harness:start-new-project', () => {
    const WEBVIEW_MANAGER = Symbol.for('WebviewManager');
    const WIZARD_WEBVIEW_LIFECYCLE = Symbol.for(
      'WizardWebviewLifecycleService',
    );

    it('enables the SaaS plugin, refreshes junctions, focuses chat, broadcasts, and disposes the wizard panel', async () => {
      const suite = buildSuite();
      suite.pluginLoader.resolvePluginPaths.mockReturnValue([
        '/plugins/ptah-nx-saas',
      ]);
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      const disposeWebview = jest.fn();
      suite.container.__register(WEBVIEW_MANAGER, { broadcastMessage });
      suite.container.__register(WIZARD_WEBVIEW_LIFECYCLE, { disposeWebview });
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({});

      expect(result).toEqual({ success: true });
      expect(suite.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalledWith(
        {
          enabledPluginIds: ['ptah-nx-saas'],
          disabledSkillIds: [],
        },
      );
      expect(suite.skillJunction.createJunctions).toHaveBeenCalled();
      expect(suite.platformCommands.focusChat).toHaveBeenCalled();
      expect(broadcastMessage).toHaveBeenCalledWith(
        'harness:open-workflow',
        expect.objectContaining({
          mode: 'new-project',
          seedPrompt: expect.stringContaining('saas-workspace-initializer'),
        }),
      );
      expect(disposeWebview).toHaveBeenCalledWith('ptah.setupWizard');
    });

    it('skips plugin enablement + junction refresh when ptah-nx-saas is already enabled', async () => {
      const suite = buildSuite();
      suite.pluginLoader.getWorkspacePluginConfig.mockReturnValue({
        enabledPluginIds: ['ptah-nx-saas'],
        disabledSkillIds: [],
      });
      suite.container.__register(WEBVIEW_MANAGER, {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      });
      suite.container.__register(WIZARD_WEBVIEW_LIFECYCLE, {
        disposeWebview: jest.fn(),
      });
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({});

      expect(result).toEqual({ success: true });
      expect(
        suite.pluginLoader.saveWorkspacePluginConfig,
      ).not.toHaveBeenCalled();
      expect(suite.skillJunction.createJunctions).not.toHaveBeenCalled();
    });

    it('returns success even when broadcast / dispose services are missing (best-effort)', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({});

      expect(result).toEqual({ success: true });
      expect(suite.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalled();
    });

    it('returns a structured error + captures Sentry when plugin save throws', async () => {
      const suite = buildSuite();
      const boom = new Error('save failed');
      suite.pluginLoader.saveWorkspacePluginConfig.mockRejectedValueOnce(boom);
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({});

      expect(result).toEqual({ success: false, error: 'save failed' });
      expect(suite.sentry.captureException).toHaveBeenCalledWith(boom, {
        errorSource: 'HarnessRpcHandlers.registerStartNewProject',
      });
    });
  });

  describe('harness:apply', () => {
    function normalizedConfig(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        name: 'demo-harness',
        persona: { label: '', description: '', goals: [] },
        agents: { enabledAgents: {}, harnessSubagents: [] },
        skills: { selectedSkills: [], createdSkills: [] },
        prompt: { systemPrompt: '', enhancedSections: {} },
        mcp: { servers: [], enabledTools: {} },
        claudeMd: {
          generateProjectClaudeMd: true,
          customSections: {},
          previewContent: '',
        },
        createdAt: 'now',
        updatedAt: 'now',
        ...overrides,
      };
    }

    function applyWith(
      suite: Suite,
      config: Record<string, unknown>,
    ): Promise<unknown> {
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();
      return getHandler(
        suite.rpc,
        'harness:apply',
      )({ config, outputFormat: 'json' });
    }

    it('materializes subagent files and includes written paths in appliedPaths', async () => {
      const suite = buildSuite();
      suite.agentFileWriter.writeSubagentFiles.mockResolvedValue({
        writtenPaths: ['/ws/.claude/agents/sentiment-watchdog.md'],
        warnings: [],
      });
      const subagents = [
        {
          id: 'sentiment-watchdog',
          name: 'Sentiment Watchdog',
          description: 'watches sentiment',
          role: 'monitor',
          tools: ['Read'],
          executionMode: 'background',
          instructions: 'do the thing',
        },
      ];
      const config = normalizedConfig({
        agents: { enabledAgents: {}, harnessSubagents: subagents },
      });

      const result = (await applyWith(suite, config)) as {
        appliedPaths: string[];
        warnings: string[];
      };

      expect(suite.agentFileWriter.writeSubagentFiles).toHaveBeenCalledWith(
        '/ws',
        subagents,
      );
      expect(result.appliedPaths).toContain(
        '/ws/.claude/agents/sentiment-watchdog.md',
      );
      expect(result.warnings).toEqual([]);
    });

    it('surfaces per-agent failures as warnings', async () => {
      const suite = buildSuite();
      suite.agentFileWriter.writeSubagentFiles.mockResolvedValue({
        writtenPaths: [],
        warnings: ['Failed to write agent broken.md: disk full'],
      });
      const config = normalizedConfig({
        agents: {
          enabledAgents: {},
          harnessSubagents: [
            {
              id: 'broken',
              name: 'Broken',
              description: 'd',
              role: 'r',
              tools: [],
              executionMode: 'on-demand',
              instructions: 'i',
            },
          ],
        },
      });

      const result = (await applyWith(suite, config)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain(
        'Failed to write agent broken.md: disk full',
      );
    });

    it('skips subagent materialization with a warning when no workspace is open', async () => {
      const suite = buildSuite();
      (
        suite.handlers as unknown as {
          workspaceProvider: { getWorkspaceRoot: jest.Mock };
        }
      ).workspaceProvider = {
        getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
      };
      const config = normalizedConfig({
        claudeMd: {
          generateProjectClaudeMd: false,
          customSections: {},
          previewContent: '',
        },
        agents: {
          enabledAgents: {},
          harnessSubagents: [
            {
              id: 'a',
              name: 'A',
              description: 'd',
              role: 'r',
              tools: [],
              executionMode: 'on-demand',
              instructions: 'i',
            },
          ],
        },
      });

      const result = (await applyWith(suite, config)) as {
        warnings: string[];
      };

      expect(suite.agentFileWriter.writeSubagentFiles).not.toHaveBeenCalled();
      expect(result.warnings).toContain(
        'No workspace folder open. Subagent files were not generated.',
      );
    });

    it('junctions harness plugin skills when created skills exist', async () => {
      const suite = buildSuite();
      suite.pluginLoader.resolveCurrentPluginPaths.mockReturnValue([
        '/plugins/ptah-core',
      ]);
      suite.fsService.discoverHarnessPluginPaths.mockResolvedValue([
        '/home/user/.ptah/plugins/ptah-harness-demo-skill',
      ]);
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [
            { name: 'demo-skill', description: 'd', content: 'c' },
          ],
        },
      });

      await applyWith(suite, config);

      expect(suite.fsService.discoverHarnessPluginPaths).toHaveBeenCalled();
      expect(suite.skillJunction.createJunctions).toHaveBeenCalledWith(
        [
          '/plugins/ptah-core',
          '/home/user/.ptah/plugins/ptah-harness-demo-skill',
        ],
        [],
      );
    });
  });

  describe('harness:workflow-prompt', () => {
    it('returns the prompt composed by HarnessWorkflowPromptService', async () => {
      const suite = buildSuite();
      suite.workflowPrompt.composePrompt.mockResolvedValueOnce({
        prompt: 'Project: demo (node)\nproposeConfig\nbuild a CRM harness',
      });
      suite.handlers.register();

      const result = (await getHandler(
        suite.rpc,
        'harness:workflow-prompt',
      )({ mode: 'configure-harness', intent: 'build a CRM harness' })) as {
        prompt: string;
      };

      expect(result.prompt).toContain('proposeConfig');
      expect(result.prompt).toContain('build a CRM harness');
      expect(suite.workflowPrompt.composePrompt).toHaveBeenCalledWith({
        mode: 'configure-harness',
        intent: 'build a CRM harness',
      });
    });
  });
});
