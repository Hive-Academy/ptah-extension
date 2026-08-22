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

/**
 * `probeStackToolchain` lives behind the `workspace-intelligence` barrel, and
 * that barrel also re-exports the tree-sitter loader, which reads
 * `import.meta.url` — legal in the bundled hosts, unparseable under Jest's CJS
 * transform. Mocking the module keeps this spec loadable AND makes the probe
 * observable, which is what the two "who gets probed" cases below need.
 */
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  probeStackToolchain: jest.fn(),
}));

import { probeStackToolchain } from '@ptah-extension/workspace-intelligence';
import type { ToolchainProbeResult } from '@ptah-extension/shared';

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
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type { HarnessPropagationService } from '@ptah-extension/harness-sync';
import type { HarnessHealth, SkillSummary } from '@ptah-extension/shared';
import { summarizeHarnessHealth } from '@ptah-extension/shared';
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
import type { HarnessHealthRpcService } from '../harness/health/harness-health-rpc.service';
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
import type { HarnessMcpInstallService } from '../harness/io/harness-mcp-install.service';
import type { HarnessSkillInstallService } from '../harness/io/harness-skill-install.service';

type Mocked<T> = jest.Mocked<T>;

/** `discoverAvailableSkills()` output for skills that are present and enabled. */
function installedSkills(...ids: string[]): SkillSummary[] {
  return ids.map((id) => ({
    id,
    descriptorId: `ptah-nx-saas:${id}`,
    invocationName: id,
    name: id,
    description: id,
    source: 'plugin' as const,
    provenance: 'bundled' as const,
    sourceId: 'ptah-nx-saas',
    invocability: 'invocable' as const,
    isActive: true,
  }));
}

/** What discovery reports once `ptah-nx-saas` is enabled — the Node/TS default. */
const NODE_TS_SKILLS = [
  'saas-workspace-initializer',
  'nx-workspace-architect',
  'ddd-architecture',
];

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
    >
  >;
  harnessPropagation: jest.Mocked<Pick<HarnessPropagationService, 'propagate'>>;
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
  mcpInstall: Mocked<HarnessMcpInstallService>;
  skillInstall: Mocked<HarnessSkillInstallService>;
}

/**
 * What a reconcile of an untouched fixture workspace reports. The facade only
 * reads `targets` (to log counts) and treats any resolved value as success, so
 * an empty-but-well-formed health payload is the honest default here.
 */
function cleanHealth(): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full',
    reason: 'test',
    sources: 'ok',
    targets: [],
    collisions: [],
  };
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const sentry = createMockSentryService();

  const pluginLoader = {
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
    saveWorkspacePluginConfig: jest.fn().mockResolvedValue(undefined),
  } as unknown as Suite['pluginLoader'];
  const harnessPropagation = {
    propagate: jest.fn().mockResolvedValue(cleanHealth()),
  } as unknown as Suite['harnessPropagation'];
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

  const mcpInstall = {
    installServers: jest
      .fn()
      .mockResolvedValue({ installedPaths: [], warnings: [] }),
  } as unknown as Mocked<HarnessMcpInstallService>;

  const skillInstall = {
    installSkills: jest
      .fn()
      .mockResolvedValue({ installedPaths: [], warnings: [] }),
  } as unknown as Mocked<HarnessSkillInstallService>;

  const fsService = {
    createSkillPlugin: jest.fn().mockResolvedValue({
      skillId: 'demo-skill',
      skillPath:
        '/home/user/.ptah/plugins/ptah-harness-demo-skill/skills/demo-skill/SKILL.md',
    }),
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

  // The reconciler surface is a collaborator with its own spec; here it only
  // has to exist so the facade's three delegates are registered and callable.
  const healthService = {
    health: jest.fn().mockResolvedValue({
      health: null,
      summary: summarizeHarnessHealth(null),
      cached: false,
    }),
    reconcile: jest.fn().mockResolvedValue({
      health: null,
      summary: summarizeHarnessHealth(null),
    }),
    remove: jest.fn().mockResolvedValue({
      health: null,
      summary: summarizeHarnessHealth(null),
      removed: 0,
    }),
  } as unknown as HarnessHealthRpcService;

  const handlers = new HarnessRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    sentry as unknown as SentryService,
    pluginLoader as unknown as PluginLoaderService,
    harnessPropagation as unknown as HarnessPropagationService,
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
    mcpInstall,
    skillInstall,
    healthService,
  );

  return {
    handlers,
    rpc,
    sentry,
    logger,
    pluginLoader,
    harnessPropagation,
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
    mcpInstall,
    skillInstall,
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
        params: { persona, enabledAgents: ['codex'], selectedSkills: ['s1'] },
        assert: (s) =>
          expect(s.promptBuilder.buildPromptSections).toHaveBeenCalledWith(
            persona,
            ['codex'],
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
        params: { persona, existingAgents: ['codex'] },
        assert: (s) =>
          expect(s.subagentDesign.designSubagentFleet).toHaveBeenCalledWith(
            persona,
            ['codex'],
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

    // TASK_2026_278 Batch 3. `createSkillPlugin` writes the skill into
    // `~/.ptah/plugins/ptah-harness-*` and mirrors that ONE directory into the
    // user layer, then stopped. Nothing carried it the last step into
    // `{ws}/.claude/skills`, so a skill the user (or the model, through
    // `ptah_harness_create_skill`) had just authored did not exist for any tool
    // until the next host activation — which for `ptah tui` or the gateway
    // could be never.
    it('harness:create-skill propagates the new skill to every target', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:create-skill',
      )({
        name: 'Demo Skill',
        description: 'demo',
        content: 'body',
      });

      expect(suite.harnessPropagation.propagate).toHaveBeenCalledWith(
        '/ws',
        'harness:create-skill',
      );
    });

    it('harness:create-skill writes the skill BEFORE it propagates', async () => {
      // The reconciler copies OUT of the user layer, so a SKILL.md that landed
      // after the pass would be invisible to it.
      const suite = buildSuite();
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:create-skill',
      )({
        name: 'Demo Skill',
        description: 'demo',
        content: 'body',
      });

      expect(
        suite.fsService.createSkillPlugin.mock.invocationCallOrder[0],
      ).toBeLessThan(
        suite.harnessPropagation.propagate.mock.invocationCallOrder[0],
      );
    });

    it('harness:initialize fans out to workspaceContext + configStore', async () => {
      const suite = buildSuite();
      suite.handlers.register();
      const result = await getHandler(suite.rpc, 'harness:initialize')({});
      expect(suite.workspaceContext.resolveWorkspaceContext).toHaveBeenCalled();
      expect(suite.configStore.loadPresetsFromDisk).toHaveBeenCalled();
      expect(result).toMatchObject({
        workspaceContext: { projectName: 'demo' },
        existingPresets: [],
        workspaceRoot: '/ws',
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
    const VALID_INTAKE = {
      what: 'A booking tool for physiotherapy clinics',
      audience: 'b2b',
      constraints: 'Must run on-premise',
      stack: 'recommend',
    };
    const WEBVIEW_MANAGER = Symbol.for('WebviewManager');
    const WIZARD_WEBVIEW_LIFECYCLE = Symbol.for(
      'WizardWebviewLifecycleService',
    );

    it('enables the SaaS plugin, reconciles the harness, focuses chat, broadcasts, and disposes the wizard panel', async () => {
      const suite = buildSuite();
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      const disposeWebview = jest.fn();
      suite.container.__register(WEBVIEW_MANAGER, { broadcastMessage });
      suite.container.__register(WIZARD_WEBVIEW_LIFECYCLE, { disposeWebview });
      // Enabling `ptah-nx-saas` above is what makes these discoverable, and the
      // prompt names a Stage A skill only once discovery has seen it.
      suite.workspaceContext.discoverAvailableSkills.mockReturnValue(
        installedSkills(...NODE_TS_SKILLS),
      );
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      expect(result).toEqual({ success: true });
      expect(suite.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalledWith(
        {
          enabledPluginIds: ['ptah-nx-saas'],
          disabledSkillIds: [],
        },
      );
      // Enabling a plugin changes the desired state, so the copies in
      // {ws}/.claude have to be rebuilt before the agent's first turn. The
      // reconciler resolves the sources itself — including the harness-authored
      // `ptah-harness-*` dirs — so this handler passes it nothing but the root.
      expect(suite.harnessPropagation.propagate).toHaveBeenCalledWith(
        '/ws',
        'harness:start-new-project',
      );
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

    it('skips plugin enablement + harness reconcile when ptah-nx-saas is already enabled', async () => {
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
      )({ intake: VALID_INTAKE });

      expect(result).toEqual({ success: true });
      expect(
        suite.pluginLoader.saveWorkspacePluginConfig,
      ).not.toHaveBeenCalled();
      expect(suite.harnessPropagation.propagate).not.toHaveBeenCalled();
    });

    it('returns success even when broadcast / dispose services are missing (best-effort)', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

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
      )({ intake: VALID_INTAKE });

      expect(result).toEqual({ success: false, error: 'save failed' });
      expect(suite.sentry.captureException).toHaveBeenCalledWith(boom, {
        errorSource: 'HarnessRpcHandlers.registerStartNewProject',
      });
    });

    it('broadcasts the intake alongside a seed prompt built from it', async () => {
      const suite = buildSuite();
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      suite.container.__register(WEBVIEW_MANAGER, { broadcastMessage });
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({
        intake: {
          what: 'A booking tool for physiotherapy clinics',
          audience: 'b2b',
          stack: 'other',
          stackOther: 'Remix + Go',
        },
      });

      const [, payload] = broadcastMessage.mock.calls[0];
      // The user's own words must survive into the agent's first turn …
      expect(payload.seedPrompt).toContain(
        'A booking tool for physiotherapy clinics',
      );
      expect(payload.seedPrompt).toContain('Remix + Go');
      // … and the raw answers ride along so the surface can render them
      // instead of the instruction block.
      expect(payload.intake).toEqual({
        what: 'A booking tool for physiotherapy clinics',
        audience: 'b2b',
        stack: 'other',
        stackOther: 'Remix + Go',
      });
    });

    // ---- platform routing (TASK_2026_270 Batch 4) --------------------------

    // The probe mock is module-level, so its call log survives `buildSuite()`.
    beforeEach(() => {
      (probeStackToolchain as jest.Mock).mockReset();
    });

    const DOTNET_INTAKE = {
      what: 'A claims processing service',
      audience: 'b2b',
      platform: 'dotnet',
      stack: 'aspnetcore-api',
    };

    const DOTNET_NOT_INSTALLED: ToolchainProbeResult = {
      profileId: 'dotnet',
      command: 'dotnet --version',
      installed: false,
      satisfiesMin: false,
      minVersion: '8.0.0',
      installHint: 'Install the .NET SDK 8.0 or newer.',
    };

    /** Register the two optional services and return the broadcast spy. */
    function withBroadcast(suite: Suite): jest.Mock {
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      suite.container.__register(WEBVIEW_MANAGER, { broadcastMessage });
      suite.container.__register(WIZARD_WEBVIEW_LIFECYCLE, {
        disposeWebview: jest.fn(),
      });
      return broadcastMessage;
    }

    it('enables the profile’s BUNDLED plugin, not the hardcoded SaaS one', async () => {
      const suite = buildSuite();
      withBroadcast(suite);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: DOTNET_INTAKE });

      expect(suite.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalledWith(
        { enabledPluginIds: ['ptah-dotnet'], disabledSkillIds: [] },
      );
    });

    it('never enables or installs an external plugin — it reports it missing', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: DOTNET_INTAKE });

      // The consent record is unreachable here (no marketplace store in the
      // container), so both external refs count as missing — fail closed.
      const [saved] =
        suite.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(saved.enabledPluginIds).not.toContain('dotnet');
      expect(saved.enabledPluginIds).not.toContain(
        'external:dotnet/skills/dotnet',
      );

      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).toContain('`dotnet-template-engine`');
      expect(payload.seedPrompt).toContain('do not try to install or invoke');
    });

    it('treats an external plugin with a consent record as present', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.container.__register(Symbol.for('PluginMarketplaceStateStore'), {
        isInstalled: (id: string) =>
          id === 'external:dotnet/skills/dotnet' ||
          id === 'external:dotnet/skills/dotnet-template-engine',
      });
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: DOTNET_INTAKE });

      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).not.toContain('are NOT installed');
    });

    it('carries a missing toolchain and its hint into the seed prompt', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      (probeStackToolchain as jest.Mock).mockResolvedValueOnce(
        DOTNET_NOT_INSTALLED,
      );
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: DOTNET_INTAKE });

      expect(probeStackToolchain).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dotnet' }),
      );
      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).toContain('is NOT installed');
      expect(payload.seedPrompt).toContain(
        'Install the .NET SDK 8.0 or newer.',
      );
    });

    it('does NOT probe for Node/TypeScript, whose runtime is already running', async () => {
      const suite = buildSuite();
      withBroadcast(suite);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      // Probing PATH for `node` would print a false "not installed" on every
      // Electron machine without a system Node.
      expect(probeStackToolchain).not.toHaveBeenCalled();
    });

    it('rejects a platform that is not in the registry', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      const result = (await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({
        intake: { ...VALID_INTAKE, platform: 'rust' },
      })) as { success: boolean };

      expect(result.success).toBe(false);
      expect(
        suite.pluginLoader.saveWorkspacePluginConfig,
      ).not.toHaveBeenCalled();
    });

    it('enables nothing when the platform has no profile behind it', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({
        intake: {
          ...VALID_INTAKE,
          platform: 'other',
          stack: 'other',
          stackOther: 'Elixir + Phoenix',
        },
      });

      expect(
        suite.pluginLoader.saveWorkspacePluginConfig,
      ).not.toHaveBeenCalled();
      expect(probeStackToolchain).not.toHaveBeenCalled();
      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).toContain('Elixir + Phoenix');
    });

    // ---- Stage A skills the machine does not have (TASK_2026_283) ----------

    it('reads the skill set AFTER the profile plugin is enabled and reconciled', async () => {
      // Order matters: a plugin turned on by this very call has to count as
      // present, or the first project on a fresh machine always falls back.
      const suite = buildSuite();
      withBroadcast(suite);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      const discoveredAt =
        suite.workspaceContext.discoverAvailableSkills.mock
          .invocationCallOrder[0];
      const savedAt =
        suite.pluginLoader.saveWorkspacePluginConfig.mock
          .invocationCallOrder[0];
      const propagatedAt =
        suite.harnessPropagation.propagate.mock.invocationCallOrder[0];
      expect(discoveredAt).toBeGreaterThan(savedAt);
      expect(discoveredAt).toBeGreaterThan(propagatedAt);
    });

    it('falls back to the generic contract when the profile skill is absent', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.workspaceContext.discoverAvailableSkills.mockReturnValue(
        installedSkills('some-unrelated-skill'),
      );
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).not.toContain('saas-workspace-initializer');
      expect(payload.seedPrompt).toContain(
        'No preset Stage A skill is installed',
      );
    });

    it('counts a disabled skill as absent — it never reaches the harness dirs', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.workspaceContext.discoverAvailableSkills.mockReturnValue(
        installedSkills(...NODE_TS_SKILLS).map((skill) =>
          skill.id === 'saas-workspace-initializer'
            ? { ...skill, isActive: false }
            : skill,
        ),
      );
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).not.toContain('saas-workspace-initializer');
      // The architect is still enabled, so it is still named — the two skills
      // are gated independently.
      expect(payload.seedPrompt).toContain('`nx-workspace-architect`');
    });

    it('still produces a prompt when skill discovery throws', async () => {
      const suite = buildSuite();
      const broadcastMessage = withBroadcast(suite);
      suite.workspaceContext.discoverAvailableSkills.mockImplementation(() => {
        throw new Error('plugin dir unreadable');
      });
      suite.handlers.register();

      const result = await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: VALID_INTAKE });

      expect(result).toEqual({ success: true });
      const [, payload] = broadcastMessage.mock.calls[0];
      expect(payload.seedPrompt).toContain(
        'No preset Stage A skill is installed',
      );
      expect(payload.seedPrompt).not.toContain('saas-workspace-initializer');
    });

    it('rejects an intake with no brief without touching plugin config', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      const result = (await getHandler(
        suite.rpc,
        'harness:start-new-project',
      )({ intake: { what: '  ', audience: 'b2b', stack: 'recommend' } })) as {
        success: boolean;
      };

      expect(result.success).toBe(false);
      expect(
        suite.pluginLoader.saveWorkspacePluginConfig,
      ).not.toHaveBeenCalled();
      expect(suite.platformCommands.focusChat).not.toHaveBeenCalled();
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

    it('explicit pinned workspaceRoot wins over the active workspace', async () => {
      const suite = buildSuite();
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
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();

      await getHandler(
        suite.rpc,
        'harness:apply',
      )({ config, outputFormat: 'json', workspaceRoot: '/pinned/workspace' });

      // Both file-writing paths must target the pinned root, NOT the active
      // workspace ('/ws' from the mock provider).
      expect(suite.configStore.writeClaudeMdToWorkspace).toHaveBeenCalledWith(
        '/pinned/workspace',
        config,
      );
      expect(suite.agentFileWriter.writeSubagentFiles).toHaveBeenCalledWith(
        '/pinned/workspace',
        subagents,
      );
    });

    it('rejects an empty-string workspaceRoot at the boundary', async () => {
      const suite = buildSuite();
      const config = normalizedConfig();
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();

      await expect(
        getHandler(
          suite.rpc,
          'harness:apply',
        )({ config, outputFormat: 'json', workspaceRoot: '' }),
      ).rejects.toThrow();
    });

    it('rejects a relative workspaceRoot at the boundary', async () => {
      const suite = buildSuite();
      const config = normalizedConfig();
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();

      await expect(
        getHandler(
          suite.rpc,
          'harness:apply',
        )({ config, outputFormat: 'json', workspaceRoot: 'relative/dir' }),
      ).rejects.toThrow(/absolute/i);
      // Parse fails before any file-write path is touched.
      expect(suite.configStore.writeClaudeMdToWorkspace).not.toHaveBeenCalled();
    });

    it("rejects a workspaceRoot containing '..' traversal segments", async () => {
      const suite = buildSuite();
      const config = normalizedConfig();
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();

      await expect(
        getHandler(
          suite.rpc,
          'harness:apply',
        )({ config, outputFormat: 'json', workspaceRoot: '/ws/../etc' }),
      ).rejects.toThrow(/\.\./);
      expect(suite.configStore.writeClaudeMdToWorkspace).not.toHaveBeenCalled();
    });

    it('accepts a clean absolute workspaceRoot', async () => {
      const suite = buildSuite();
      const config = normalizedConfig();
      suite.configStore.normalizeHarnessConfig.mockReturnValue(config as never);
      suite.handlers.register();

      await expect(
        getHandler(
          suite.rpc,
          'harness:apply',
        )({
          config,
          outputFormat: 'json',
          workspaceRoot: '/pinned/workspace',
        }),
      ).resolves.toBeDefined();
      expect(suite.configStore.writeClaudeMdToWorkspace).toHaveBeenCalledWith(
        '/pinned/workspace',
        config,
      );
    });

    it('reconciles the harness when created skills exist', async () => {
      const suite = buildSuite();
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [
            { name: 'demo-skill', description: 'd', content: 'c' },
          ],
        },
      });

      await applyWith(suite, config);

      expect(suite.harnessPropagation.propagate).toHaveBeenCalledWith(
        '/ws',
        'harness:apply',
      );
      // The reconciler owns source resolution — its PluginConfigSourceResolver
      // already appends the `ptah-harness-*` dirs the skills above were written
      // into. A path list computed here could only ever be narrower, which is
      // how harness-authored artifacts used to get pruned as stale.
      expect(suite.pluginLoader.resolvePluginPaths).not.toHaveBeenCalled();
    });

    // Was "does NOT reconcile when nothing was selected or created".
    // TASK_2026_278 Batch 3 made the pass unconditional: the old gate meant an
    // apply that wrote only subagents (or only CLAUDE.md, or only MCP entries)
    // left `{ws}/.claude/agents` mirrored into the user layer with nothing
    // fanning it out to Codex, Copilot or Cursor. Reconcile is idempotent, so
    // the gate bought a directory walk and cost a whole artifact family.
    it('propagates even when no skills were selected or created', async () => {
      const suite = buildSuite();

      await applyWith(suite, normalizedConfig());

      expect(suite.harnessPropagation.propagate).toHaveBeenCalledWith(
        '/ws',
        'harness:apply',
      );
    });

    it('surfaces a failed reconcile as a warning instead of failing the apply', async () => {
      const suite = buildSuite();
      suite.harnessPropagation.propagate.mockRejectedValueOnce(
        new Error('EBUSY'),
      );
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [{ name: 'alpha', description: 'a', content: 'c' }],
        },
      });

      const result = (await applyWith(suite, config)) as { warnings: string[] };

      expect(result.warnings).toContain('Failed to sync harness skills: EBUSY');
    });

    it('installs recorded MCP servers and reports the written config paths', async () => {
      const suite = buildSuite();
      const servers = [
        {
          name: 'github',
          url: '',
          enabled: true,
          config: { type: 'stdio', command: 'npx', args: ['-y', 'srv'] },
        },
      ];
      suite.mcpInstall.installServers.mockResolvedValue({
        installedPaths: ['/ws/.mcp.json', '/ws/.vscode/mcp.json'],
        warnings: [],
      });
      const config = normalizedConfig({
        mcp: { servers, enabledTools: {} },
      });

      const result = (await applyWith(suite, config)) as {
        appliedPaths: string[];
        warnings: string[];
      };

      expect(suite.mcpInstall.installServers).toHaveBeenCalledWith(
        servers,
        '/ws',
      );
      expect(result.appliedPaths).toEqual(
        expect.arrayContaining(['/ws/.mcp.json', '/ws/.vscode/mcp.json']),
      );
      expect(result.warnings).toEqual([]);
    });

    it('propagates MCP install warnings into the apply response', async () => {
      const suite = buildSuite();
      suite.mcpInstall.installServers.mockResolvedValue({
        installedPaths: [],
        warnings: [
          'MCP server "legacy" has no transport config and was not installed. Add it to the workspace manually.',
        ],
      });
      const config = normalizedConfig({
        mcp: {
          servers: [{ name: 'legacy', url: 'https://x', enabled: true }],
          enabledTools: {},
        },
      });

      const result = (await applyWith(suite, config)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain(
        'MCP server "legacy" has no transport config and was not installed. Add it to the workspace manually.',
      );
    });

    it('installs recorded skills.sh skills and reports the written paths', async () => {
      const suite = buildSuite();
      const selectedSkillRefs = [
        {
          skillId: 'frontend-design',
          source: 'skills.sh' as const,
          installSource: 'anthropics/skills',
        },
      ];
      suite.skillInstall.installSkills.mockResolvedValue({
        installedPaths: ['/ws/.claude/skills/frontend-design'],
        warnings: [],
      });
      const config = normalizedConfig({
        skills: {
          selectedSkills: ['frontend-design'],
          selectedSkillRefs,
          createdSkills: [],
        },
      });

      const result = (await applyWith(suite, config)) as {
        appliedPaths: string[];
        warnings: string[];
      };

      expect(suite.skillInstall.installSkills).toHaveBeenCalledWith(
        selectedSkillRefs,
        '/ws',
      );
      expect(result.appliedPaths).toContain(
        '/ws/.claude/skills/frontend-design',
      );
      expect(result.warnings).toEqual([]);
    });

    it('propagates skill install warnings into the apply response', async () => {
      const suite = buildSuite();
      suite.skillInstall.installSkills.mockResolvedValue({
        installedPaths: [],
        warnings: ['Skill "orphan" came from skills.sh but no installSource'],
      });
      const config = normalizedConfig({
        skills: { selectedSkills: ['orphan'], createdSkills: [] },
      });

      const result = (await applyWith(suite, config)) as { warnings: string[] };

      expect(result.warnings).toContain(
        'Skill "orphan" came from skills.sh but no installSource',
      );
    });

    it('materializes createdSkills to disk and reports their SKILL.md paths', async () => {
      const suite = buildSuite();
      suite.fsService.createSkillPlugin
        .mockResolvedValueOnce({
          skillId: 'alpha',
          skillPath:
            '/home/user/.ptah/plugins/ptah-harness-alpha/skills/alpha/SKILL.md',
        })
        .mockResolvedValueOnce({
          skillId: 'beta',
          skillPath:
            '/home/user/.ptah/plugins/ptah-harness-beta/skills/beta/SKILL.md',
        });
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [
            { name: 'alpha', description: 'a', content: 'ca' },
            { name: 'beta', description: 'b', content: 'cb' },
          ],
        },
      });

      const result = (await applyWith(suite, config)) as {
        appliedPaths: string[];
        warnings: string[];
      };

      expect(suite.fsService.createSkillPlugin).toHaveBeenCalledTimes(2);
      expect(suite.fsService.createSkillPlugin).toHaveBeenNthCalledWith(1, {
        name: 'alpha',
        description: 'a',
        content: 'ca',
      });
      expect(result.appliedPaths).toEqual(
        expect.arrayContaining([
          '/home/user/.ptah/plugins/ptah-harness-alpha/skills/alpha/SKILL.md',
          '/home/user/.ptah/plugins/ptah-harness-beta/skills/beta/SKILL.md',
        ]),
      );
      expect(result.warnings).toEqual([]);
    });

    it('writes created skills before the harness is reconciled', async () => {
      // The reconciler copies OUT of the user layer, so a SKILL.md written
      // after the pass would not reach {ws}/.claude until the next activation.
      const suite = buildSuite();
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [{ name: 'alpha', description: 'a', content: 'c' }],
        },
      });

      await applyWith(suite, config);

      const wroteAt =
        suite.fsService.createSkillPlugin.mock.invocationCallOrder[0];
      const reconciledAt =
        suite.harnessPropagation.propagate.mock.invocationCallOrder[0];
      expect(wroteAt).toBeLessThan(reconciledAt);
    });

    it('surfaces a failed skill write as a warning without aborting apply', async () => {
      const suite = buildSuite();
      suite.fsService.createSkillPlugin.mockRejectedValueOnce(
        new Error('disk full'),
      );
      const config = normalizedConfig({
        skills: {
          selectedSkills: [],
          createdSkills: [{ name: 'alpha', description: 'a', content: 'c' }],
        },
      });

      const result = (await applyWith(suite, config)) as {
        warnings: string[];
      };

      expect(result.warnings).toContain(
        'Failed to create skill "alpha": disk full',
      );
      expect(suite.harnessPropagation.propagate).toHaveBeenCalled();
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
