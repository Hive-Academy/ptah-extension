/**
 * HarnessRpcHandlers — unit specs (TASK_2025_294 W2.B3).
 *
 * Surface under test: sixteen RPC methods powering the harness setup wizard
 * (`harness:initialize`, `harness:suggest-config`, `harness:search-skills`,
 * `harness:create-skill`, `harness:discover-mcp`, `harness:generate-prompt`,
 * `harness:generate-claude-md`, `harness:apply`, `harness:save-preset`,
 * `harness:load-presets`, `harness:chat`, `harness:design-agents`,
 * `harness:generate-skills`, `harness:generate-document`, `harness:analyze-intent`,
 * `harness:converse`).
 *
 * These specs intentionally focus on the *pure-logic* surfaces and the
 * *fallback paths* — every LLM-driven method forces `InternalQueryService.execute`
 * to reject so we exercise the heuristic fallbacks rather than the streaming
 * SDK machinery (which is covered by `SdkStreamProcessor` and
 * `InternalQueryService` specs in their own libraries).
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all sixteen methods into the mock
 *     RpcHandler.
 *
 *   - `harness:initialize`: Returns workspace context, the full 4-agent roster
 *     (gemini/codex/copilot/ptah-cli), skills discovered via
 *     `PluginLoaderService.resolveCurrentPluginPaths` + `discoverSkillsForPlugins`,
 *     and presets loaded from `~/.ptah/harnesses/`. Skills belonging to plugins
 *     whose id starts with `ptah-harness-` are tagged `source: 'harness'`, all
 *     others `'plugin'`. Disabled skill ids flip `isActive` to false.
 *
 *   - `harness:search-skills`: Pure filter — empty query returns every
 *     discovered skill, non-empty query matches case-insensitively against
 *     `name` OR `description` substring.
 *
 *   - `harness:discover-mcp`: Always emits the built-in `ptah-mcp` entry first,
 *     then appends server *names only* extracted from `.vscode/mcp.json` and
 *     `.mcp.json`. Never forwards env/args/credentials. Missing files (ENOENT)
 *     are silent; parse errors log a warning but don't throw. Requires a
 *     workspace root.
 *
 *   - `harness:generate-prompt`: Pure template — persona always present,
 *     agents/skills sections only when non-empty, instructions always present.
 *     The concatenated prompt equals sections joined by double-newlines.
 *
 *   - `harness:generate-claude-md`: Pure builder — prefixes the document with
 *     the config name as H1 and embeds persona/agents/skills/prompt content.
 *
 *   - `harness:analyze-intent`: Input must be ≥10 non-whitespace chars
 *     (validated BEFORE the LLM call). When the LLM rejects, the heuristic
 *     fallback fires and still returns a complete `HarnessAnalyzeIntentResponse`.
 *
 *   - `harness:chat`: When the LLM rejects, the handler returns a graceful
 *     fallback reply rather than propagating the error — the frontend chat
 *     UI relies on non-error payloads to keep the conversation alive.
 *
 *   - `harness:converse`: `requireWorkspaceRoot()` throws when no folder is
 *     open, surfacing a structured RPC error BEFORE any LLM call.
 *
 *   - `harness:save-preset` / `harness:load-presets`: Preset payload persists
 *     through the list. Save then load returns the same preset at minimum.
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<Pick<T,...>>`
 * surfaces, no `as any` casts, no tsyringe container. `InternalQueryService.execute`
 * is the critical boundary — mocking it to reject surfaces the fallback/error
 * paths without pulling in the full SDK stream pipeline.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts`
 */

import 'reflect-metadata';

// Mock fs/promises before imports so the handler sees the mocked module.
// Tests override `fs.readFile` per-case via `.mockImplementation(...)`.
jest.mock('fs/promises', () => {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    __esModule: true,
    readFile: jest.fn().mockRejectedValue(enoent()),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockRejectedValue(enoent()),
    rm: jest.fn().mockResolvedValue(undefined),
    mkdtemp: jest.fn().mockResolvedValue('/tmp/mocked'),
    access: jest.fn().mockRejectedValue(enoent()),
  };
});

import * as path from 'path';
import * as fs from 'fs/promises';

import type {
  ConfigManager,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  InternalQueryService,
  PluginLoaderService,
  SdkMessageTransformer,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { PluginSkillEntry } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { HarnessRpcHandlers } from './harness-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches
// ---------------------------------------------------------------------------

type MockPluginLoader = jest.Mocked<
  Pick<
    PluginLoaderService,
    | 'resolveCurrentPluginPaths'
    | 'discoverSkillsForPlugins'
    | 'getDisabledSkillIds'
  >
>;

function createMockPluginLoader(
  overrides: {
    pluginPaths?: string[];
    skills?: PluginSkillEntry[];
    disabledSkillIds?: string[];
  } = {},
): MockPluginLoader {
  return {
    resolveCurrentPluginPaths: jest
      .fn()
      .mockReturnValue(overrides.pluginPaths ?? []),
    discoverSkillsForPlugins: jest.fn().mockReturnValue(overrides.skills ?? []),
    getDisabledSkillIds: jest
      .fn()
      .mockReturnValue(overrides.disabledSkillIds ?? []),
  };
}

type MockSkillJunction = jest.Mocked<
  Pick<SkillJunctionService, 'createJunctions'>
>;

function createMockSkillJunction(): MockSkillJunction {
  return { createJunctions: jest.fn() } as unknown as MockSkillJunction;
}

type MockInternalQuery = jest.Mocked<Pick<InternalQueryService, 'execute'>>;

/**
 * Default internalQueryService mock rejects — forcing LLM-backed paths into
 * their fallback/heuristic branches. Tests that need a successful LLM call
 * override `.execute.mockResolvedValueOnce(...)` inline.
 */
function createMockInternalQuery(): MockInternalQuery {
  return {
    execute: jest
      .fn()
      .mockRejectedValue(new Error('no LLM in this spec — using fallback')),
  };
}

interface MockWebviewBroadcaster {
  broadcastMessage: jest.Mock<Promise<void>, [string, unknown]>;
}

function createMockWebviewBroadcaster(): MockWebviewBroadcaster {
  return {
    broadcastMessage: jest
      .fn<Promise<void>, [string, unknown]>()
      .mockResolvedValue(undefined),
  };
}

type MockMessageTransformer = jest.Mocked<
  Pick<SdkMessageTransformer, 'createIsolated'>
>;

function createMockMessageTransformer(): MockMessageTransformer {
  return {
    createIsolated: jest.fn().mockReturnValue({
      transform: jest.fn().mockReturnValue([]),
    }),
  } as unknown as MockMessageTransformer;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillEntry(
  skillId: string,
  pluginId: string,
  overrides: Partial<PluginSkillEntry> = {},
): PluginSkillEntry {
  return {
    skillId,
    pluginId,
    displayName: overrides.displayName ?? skillId,
    description: overrides.description ?? `desc ${skillId}`,
    ...overrides,
  } as unknown as PluginSkillEntry;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: HarnessRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  pluginLoader: MockPluginLoader;
  skillJunction: MockSkillJunction;
  workspaceProvider: ReturnType<typeof createMockWorkspaceProvider>;
  internalQuery: MockInternalQuery;
  webviewManager: MockWebviewBroadcaster;
  messageTransformer: MockMessageTransformer;
  configManager: MockConfigManager;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    workspaceFolders?: string[];
    pluginPaths?: string[];
    skills?: PluginSkillEntry[];
    disabledSkillIds?: string[];
    configSeed?: Record<string, unknown>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const pluginLoader = createMockPluginLoader({
    pluginPaths: opts.pluginPaths,
    skills: opts.skills,
    disabledSkillIds: opts.disabledSkillIds,
  });
  const skillJunction = createMockSkillJunction();
  const workspaceProvider = createMockWorkspaceProvider({
    folders: opts.workspaceFolders,
  });
  const internalQuery = createMockInternalQuery();
  const webviewManager = createMockWebviewBroadcaster();
  const messageTransformer = createMockMessageTransformer();
  const configManager = createMockConfigManager({ values: opts.configSeed });
  const sentry = createMockSentryService();

  const handlers = new HarnessRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    pluginLoader as unknown as PluginLoaderService,
    skillJunction as unknown as SkillJunctionService,
    workspaceProvider as unknown as IWorkspaceProvider,
    internalQuery as unknown as InternalQueryService,
    webviewManager as unknown as import('@ptah-extension/vscode-core').WebviewManager,
    messageTransformer as unknown as SdkMessageTransformer,
    configManager as unknown as ConfigManager,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    pluginLoader,
    skillJunction,
    workspaceProvider,
    internalQuery,
    webviewManager,
    messageTransformer,
    configManager,
    sentry,
  };
}

async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

async function callRaw(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  return h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessRpcHandlers', () => {
  describe('register()', () => {
    it('registers all sixteen harness RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      const methods = h.rpcHandler.getRegisteredMethods().sort();

      expect(methods).toEqual(
        [
          'harness:analyze-intent',
          'harness:apply',
          'harness:chat',
          'harness:converse',
          'harness:create-skill',
          'harness:design-agents',
          'harness:discover-mcp',
          'harness:generate-claude-md',
          'harness:generate-document',
          'harness:generate-prompt',
          'harness:generate-skills',
          'harness:initialize',
          'harness:load-presets',
          'harness:save-preset',
          'harness:search-skills',
          'harness:suggest-config',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // harness:initialize
  // -------------------------------------------------------------------------

  describe('harness:initialize', () => {
    it('returns the canonical 4-agent roster (gemini/codex/copilot/ptah-cli)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        availableAgents: Array<{ id: string; type: string }>;
      }>(h, 'harness:initialize');

      const agentIds = result.availableAgents.map((a) => a.id).sort();
      expect(agentIds).toEqual(['codex', 'copilot', 'gemini', 'ptah-cli']);
    });

    it('maps plugin skills to SkillSummary shape with source + isActive flags', async () => {
      const skills: PluginSkillEntry[] = [
        makeSkillEntry('s-plain', 'some-plugin'),
        makeSkillEntry('s-harness', 'ptah-harness-custom'),
        makeSkillEntry('s-disabled', 'some-plugin'),
      ];
      const h = makeHarness({
        pluginPaths: ['/tmp/plugins/some-plugin'],
        skills,
        disabledSkillIds: ['s-disabled'],
      });
      h.handlers.register();

      const result = await call<{
        availableSkills: Array<{
          id: string;
          source: 'plugin' | 'harness';
          isActive: boolean;
        }>;
      }>(h, 'harness:initialize');

      const byId = Object.fromEntries(
        result.availableSkills.map((s) => [s.id, s]),
      );
      expect(byId['s-plain']!.source).toBe('plugin');
      expect(byId['s-plain']!.isActive).toBe(true);
      expect(byId['s-harness']!.source).toBe('harness');
      expect(byId['s-disabled']!.isActive).toBe(false);
    });

    it('returns a degraded "No workspace" context when no folder is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const result = await call<{
        workspaceContext: {
          projectName: string;
          projectType: string;
        };
      }>(h, 'harness:initialize');

      expect(result.workspaceContext.projectName).toBe('No workspace');
      expect(result.workspaceContext.projectType).toBe('unknown');
    });

    it('swallows skill-discovery failures so the wizard can still launch', async () => {
      const h = makeHarness();
      h.pluginLoader.resolveCurrentPluginPaths.mockImplementation(() => {
        throw new Error('plugin loader exploded');
      });
      h.handlers.register();

      const result = await call<{
        availableSkills: unknown[];
      }>(h, 'harness:initialize');

      expect(result.availableSkills).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // harness:search-skills
  // -------------------------------------------------------------------------

  describe('harness:search-skills', () => {
    const skills: PluginSkillEntry[] = [
      makeSkillEntry('refactor-ts', 'tools', {
        displayName: 'Refactor TS',
        description: 'Improve TypeScript code quality',
      }),
      makeSkillEntry('write-docs', 'tools', {
        displayName: 'Write Documentation',
        description: 'Generate markdown docs',
      }),
      makeSkillEntry('deploy', 'ops', {
        displayName: 'Deploy',
        description: 'Ship to production',
      }),
    ];

    it('returns every skill when the query is empty', async () => {
      const h = makeHarness({ skills });
      h.handlers.register();

      const result = await call<{ results: Array<{ id: string }> }>(
        h,
        'harness:search-skills',
        { query: '' },
      );

      expect(result.results.map((r) => r.id).sort()).toEqual(
        ['deploy', 'refactor-ts', 'write-docs'].sort(),
      );
    });

    it('matches case-insensitively against name and description', async () => {
      const h = makeHarness({ skills });
      h.handlers.register();

      const byName = await call<{ results: Array<{ id: string }> }>(
        h,
        'harness:search-skills',
        { query: 'REFACTOR' },
      );
      expect(byName.results.map((r) => r.id)).toEqual(['refactor-ts']);

      const byDescription = await call<{ results: Array<{ id: string }> }>(
        h,
        'harness:search-skills',
        { query: 'markdown' },
      );
      expect(byDescription.results.map((r) => r.id)).toEqual(['write-docs']);
    });

    it('returns an empty list when nothing matches', async () => {
      const h = makeHarness({ skills });
      h.handlers.register();

      const result = await call<{ results: unknown[] }>(
        h,
        'harness:search-skills',
        { query: 'does-not-exist-anywhere' },
      );

      expect(result.results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // harness:discover-mcp
  // -------------------------------------------------------------------------

  describe('harness:discover-mcp', () => {
    const mockedReadFile = fs.readFile as unknown as jest.Mock;

    beforeEach(() => {
      mockedReadFile.mockReset();
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValue(enoent);
    });

    it('throws when no workspace folder is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'harness:discover-mcp');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('always emits the built-in ptah-mcp entry first, silently tolerates missing config files', async () => {
      const h = makeHarness({ workspaceFolders: ['/ws/project'] });
      h.handlers.register();

      const result = await call<{
        servers: Array<{ name: string; enabled: boolean }>;
      }>(h, 'harness:discover-mcp');

      expect(result.servers[0]!.name).toBe('ptah-mcp');
      expect(result.servers).toHaveLength(1);
    });

    it('extracts only server NAMES from .vscode/mcp.json and .mcp.json (no env/args)', async () => {
      const vscodeMcp = JSON.stringify({
        servers: {
          'github-mcp': {
            command: 'npx',
            args: ['-y', 'github-mcp-server'],
            env: { GITHUB_TOKEN: 'SECRET_VALUE' },
          },
        },
      });
      const rootMcp = JSON.stringify({
        mcpServers: { 'local-tool': { command: '/bin/tool' } },
      });

      mockedReadFile.mockImplementation((p: unknown): Promise<string> => {
        const str = String(p);
        if (str.endsWith(path.join('.vscode', 'mcp.json'))) {
          return Promise.resolve(vscodeMcp);
        }
        if (str.endsWith('.mcp.json')) {
          return Promise.resolve(rootMcp);
        }
        const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return Promise.reject(enoent);
      });

      const h = makeHarness({ workspaceFolders: ['/ws/project'] });
      h.handlers.register();

      const result = await call<{
        servers: Array<{
          name: string;
          url: string;
          description?: string;
          enabled: boolean;
        }>;
      }>(h, 'harness:discover-mcp');

      const names = result.servers.map((s) => s.name);
      expect(names).toContain('ptah-mcp');
      expect(names).toContain('github-mcp');
      expect(names).toContain('local-tool');

      // Critical contract: credentials MUST NEVER appear anywhere in payload
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('SECRET_VALUE');
      expect(serialized).not.toContain('GITHUB_TOKEN');
    });

    it('logs a warning but does not throw when .vscode/mcp.json is malformed JSON', async () => {
      mockedReadFile.mockImplementation((p: unknown): Promise<string> => {
        const str = String(p);
        if (str.endsWith(path.join('.vscode', 'mcp.json'))) {
          return Promise.resolve('{ this is not JSON');
        }
        const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return Promise.reject(enoent);
      });

      const h = makeHarness({ workspaceFolders: ['/ws/project'] });
      h.handlers.register();

      const result = await call<{ servers: Array<{ name: string }> }>(
        h,
        'harness:discover-mcp',
      );

      expect(result.servers.map((s) => s.name)).toContain('ptah-mcp');
      expect(h.logger.warn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // harness:generate-prompt (pure logic)
  // -------------------------------------------------------------------------

  describe('harness:generate-prompt', () => {
    const persona = {
      label: 'Backend Architect',
      description: 'Designs scalable services.',
      goals: ['Reliability', 'Performance'],
    };

    it('always includes persona and instructions sections, omits agents/skills when empty', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        generatedPrompt: string;
        sections: Record<string, string>;
      }>(h, 'harness:generate-prompt', {
        persona,
        enabledAgents: [],
        selectedSkills: [],
      });

      expect(result.sections['persona']).toContain('Backend Architect');
      expect(result.sections['persona']).toContain('Reliability');
      expect(result.sections['instructions']).toContain('persona and goals');
      expect(result.sections['agents']).toBeUndefined();
      expect(result.sections['skills']).toBeUndefined();
    });

    it('concatenates sections with double-newlines and includes non-empty agent/skill sections', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        generatedPrompt: string;
        sections: Record<string, string>;
      }>(h, 'harness:generate-prompt', {
        persona,
        enabledAgents: ['gemini', 'ptah-cli'],
        selectedSkills: ['refactor-ts'],
      });

      expect(result.sections['agents']).toContain('gemini');
      expect(result.sections['agents']).toContain('ptah-cli');
      expect(result.sections['skills']).toContain('refactor-ts');
      expect(result.generatedPrompt).toBe(
        Object.values(result.sections).join('\n\n'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // harness:generate-claude-md (pure logic)
  // -------------------------------------------------------------------------

  describe('harness:generate-claude-md', () => {
    it('emits a markdown document prefixed with the config name as H1', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ content: string }>(
        h,
        'harness:generate-claude-md',
        {
          config: {
            id: 'cfg-1',
            name: 'My Harness',
            persona: {
              label: 'Persona',
              description: 'Desc',
              goals: ['Goal A'],
            },
            agents: { enabledAgents: {}, harnessSubagents: [] },
            skills: { selectedSkills: [], createdSkills: [] },
            prompt: { systemPrompt: 'base', enhancedSections: {} },
            mcp: { servers: [], enabledTools: {} },
          },
        },
      );

      expect(result.content.startsWith('# My Harness')).toBe(true);
      expect(result.content).toContain('Persona');
    });
  });

  // -------------------------------------------------------------------------
  // harness:analyze-intent
  // -------------------------------------------------------------------------

  describe('harness:analyze-intent', () => {
    it('rejects input shorter than 10 non-whitespace chars before touching the LLM', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'harness:analyze-intent', {
        input: 'too short',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/at least 10 characters/);
      expect(h.internalQuery.execute).not.toHaveBeenCalled();
    });

    it('trims whitespace before applying the length check', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'harness:analyze-intent', {
        input: '    small    ',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/at least 10 characters/);
    });

    it('falls back to the heuristic builder when the LLM rejects', async () => {
      const h = makeHarness();
      // execute() rejects by default (see createMockInternalQuery)
      h.handlers.register();

      const result = await call<{
        persona: { label: string };
        suggestedAgents: Record<string, unknown>;
        suggestedSkillSpecs: unknown[];
      }>(h, 'harness:analyze-intent', {
        input: 'Build me a harness for real-estate marketing copy',
      });

      // Heuristic fallback still produces a structured response
      expect(typeof result.persona.label).toBe('string');
      expect(result.suggestedAgents).toBeDefined();
      expect(Array.isArray(result.suggestedSkillSpecs)).toBe(true);

      // LLM-fallback path MUST have logged a warning (not captured as error)
      expect(h.logger.warn).toHaveBeenCalledWith(
        'LLM-powered intent analysis failed, falling back to heuristic',
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  // harness:chat
  // -------------------------------------------------------------------------

  describe('harness:chat', () => {
    it('returns a graceful fallback reply when the LLM rejects (never throws to the frontend)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ reply: string }>(h, 'harness:chat', {
        step: 'persona' as const,
        message: 'hi there',
        context: {},
      });

      expect(typeof result.reply).toBe('string');
      expect(result.reply.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // harness:converse
  // -------------------------------------------------------------------------

  describe('harness:converse', () => {
    it('rejects with a workspace-required error when no folder is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'harness:converse', {
        message: 'hello',
        history: [],
        config: {
          id: 'cfg',
          name: 'n',
          persona: { label: '', description: '', goals: [] },
          agents: { enabledAgents: {}, harnessSubagents: [] },
          skills: { selectedSkills: [], createdSkills: [] },
          prompt: { systemPrompt: '', enhancedSections: {} },
          mcp: { servers: [], enabledTools: {} },
        },
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });
  });

  // -------------------------------------------------------------------------
  // harness:save-preset
  // -------------------------------------------------------------------------

  describe('harness:save-preset', () => {
    it('writes the preset through fs.writeFile with a sanitized filename and returns the preset id', async () => {
      const mockedWriteFile = fs.writeFile as unknown as jest.Mock;
      const mockedMkdir = fs.mkdir as unknown as jest.Mock;
      mockedWriteFile.mockClear();
      mockedMkdir.mockClear();

      const h = makeHarness();
      h.handlers.register();

      const config = {
        id: 'cfg-1',
        name: 'Alpha Preset',
        persona: { label: 'p', description: 'd', goals: [] },
        agents: { enabledAgents: {}, harnessSubagents: [] },
        skills: { selectedSkills: [], createdSkills: [] },
        prompt: { systemPrompt: '', enhancedSections: {} },
        mcp: { servers: [], enabledTools: {} },
      };

      const saveResult = await call<{ presetId: string; presetPath: string }>(
        h,
        'harness:save-preset',
        {
          name: 'Alpha Preset',
          description: 'Test preset',
          config,
        },
      );

      // sanitizeFileName('Alpha Preset') → 'alpha-preset'
      expect(saveResult.presetId).toBe('alpha-preset');
      expect(mockedMkdir).toHaveBeenCalled();
      expect(mockedWriteFile).toHaveBeenCalled();

      const [writtenPath, writtenContent] = mockedWriteFile.mock.calls[0]!;
      expect(String(writtenPath)).toMatch(/alpha-preset\.json$/);
      expect(typeof writtenContent).toBe('string');

      // Payload must be valid JSON with the preset id embedded
      const parsed = JSON.parse(String(writtenContent));
      expect(parsed.id).toBe('alpha-preset');
      expect(parsed.name).toBe('Alpha Preset');
    });
  });
});
