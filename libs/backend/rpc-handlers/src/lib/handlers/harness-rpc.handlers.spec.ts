/**
 * HarnessRpcHandlers — thin facade specs (Wave C7d). Locks four invariants:
 *   1. `register()` wires exactly the sixteen `METHODS` entries, in order.
 *   2. Each method delegates to the expected service on the happy path.
 *   3. `runRpc` funnels thrown errors into Sentry + re-throws (via design-agents).
 *   4. `harness:chat` swallows service errors and returns the fallback reply.
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
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { HarnessRpcHandlers } from './harness-rpc.handlers';
import type { HarnessWorkspaceContextService } from '../harness/workspace/harness-workspace-context.service';
import type { HarnessSuggestionService } from '../harness/ai/harness-suggestion.service';
import type { HarnessSubagentDesignService } from '../harness/ai/harness-subagent-design.service';
import type { HarnessSkillGenerationService } from '../harness/ai/harness-skill-generation.service';
import type { HarnessDocumentGenerationService } from '../harness/ai/harness-document-generation.service';
import type { HarnessPromptBuilderService } from '../harness/config/harness-prompt-builder.service';
import type { HarnessConfigStore } from '../harness/config/harness-config-store.service';
import type { HarnessChatService } from '../harness/ai/harness-chat.service';
import type { HarnessFsService } from '../harness/io/harness-fs.service';

type Mocked<T> = jest.Mocked<T>;

interface Suite {
  handlers: HarnessRpcHandlers;
  rpc: MockRpcHandler;
  sentry: ReturnType<typeof createMockSentryService>;
  logger: ReturnType<typeof createMockLogger>;
  workspaceContext: Mocked<HarnessWorkspaceContextService>;
  suggestion: Mocked<HarnessSuggestionService>;
  subagentDesign: Mocked<HarnessSubagentDesignService>;
  skillGeneration: Mocked<HarnessSkillGenerationService>;
  documentGeneration: Mocked<HarnessDocumentGenerationService>;
  promptBuilder: Mocked<HarnessPromptBuilderService>;
  configStore: Mocked<HarnessConfigStore>;
  chat: Mocked<HarnessChatService>;
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
  } as unknown as PluginLoaderService;
  const skillJunction = {
    createJunctions: jest.fn(),
  } as unknown as SkillJunctionService;
  const workspaceProvider = createMockWorkspaceProvider({
    folders: ['/ws'],
  }) as unknown as IWorkspaceProvider;

  const workspaceContext = {
    requireWorkspaceRoot: jest.fn().mockReturnValue('/ws'),
    resolveWorkspaceContext: jest
      .fn()
      .mockResolvedValue({
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

  const chat = {
    buildIntelligentChatReply: jest.fn().mockResolvedValue({ reply: 'hi' }),
    converseWithUser: jest.fn().mockResolvedValue({ reply: 'ok' }),
    buildChatReplyFallback: jest.fn().mockReturnValue('fallback reply'),
  } as unknown as Mocked<HarnessChatService>;

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

  const handlers = new HarnessRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    sentry as unknown as SentryService,
    pluginLoader,
    skillJunction,
    workspaceProvider,
    workspaceContext,
    suggestion,
    subagentDesign,
    skillGeneration,
    documentGeneration,
    promptBuilder,
    configStore,
    chat,
    fsService,
  );

  return {
    handlers,
    rpc,
    sentry,
    logger,
    workspaceContext,
    suggestion,
    subagentDesign,
    skillGeneration,
    documentGeneration,
    promptBuilder,
    configStore,
    chat,
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

describe('HarnessRpcHandlers (Wave C7d thin facade)', () => {
  it('register() wires exactly the sixteen METHODS tuple entries, in order', () => {
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
        method: 'harness:converse',
        params: { message: 'hi', history: [], config: {} },
        assert: (s) =>
          expect(s.chat.converseWithUser).toHaveBeenCalledWith({
            message: 'hi',
            history: [],
            config: {},
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

  it('harness:chat returns the fallback reply when the chat service rejects', async () => {
    const suite = buildSuite();
    const err = new Error('llm unavailable');
    suite.chat.buildIntelligentChatReply.mockRejectedValueOnce(err);
    suite.handlers.register();

    const result = await getHandler(
      suite.rpc,
      'harness:chat',
    )({ step: 'persona', message: 'hello', context: {} });

    expect(result).toEqual({ reply: 'fallback reply' });
    expect(suite.chat.buildChatReplyFallback).toHaveBeenCalledWith(
      'persona',
      'hello',
    );
    expect(suite.sentry.captureException).toHaveBeenCalledWith(err, {
      errorSource: 'HarnessRpcHandlers.registerChat',
    });
  });
});
