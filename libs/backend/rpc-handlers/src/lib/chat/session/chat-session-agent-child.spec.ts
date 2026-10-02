/**
 * ChatSessionService — SDK launch identity specs (TASK_2026_584, Task 4.2).
 *
 * Surface under test: the `launchSdkSession` extraction shared by
 * `startSession` (`chat:start`) and `startAgentChildSession`.
 *
 * Contract pinned here:
 *   - `startSession` still passes `workspaceId === projectPath` (the resolved
 *     workspace path), no `permissionLevel`, and resolves prompts / profile /
 *     style for that path — behaviour unchanged for every existing caller.
 *   - the child method passes `workspaceId = workspaceRoot`,
 *     `projectPath = worktreePath`, `permissionLevel = 'auto-edit'`, resolves
 *     prompts / profile / style for the ROOT, and derives `mcpServerRunning`
 *     from the server port alone (no `.mcp.json` downgrade).
 *   - the child method skips the slash-command intercept and the Ptah-CLI
 *     branch, refuses a worktree outside the open folders and an unsafe path,
 *     and never throws.
 */

import 'reflect-metadata';

// Same stub as `chat-session-auth.spec`: `ChatSessionService` imports
// `cli-agent-runtime`, whose barrel reaches `workspace-intelligence`'s
// TreeSitter module (`import.meta.url`, unparseable by ts-jest's CJS transform).
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import type {
  Logger,
  ConfigManager,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import {
  ChatSessionService,
  type AgentChildSessionStartParams,
} from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const ROOT = '/c/projects/my-repo';
const WORKTREE = '/c/projects/my-repo/.ptah/worktrees/child-1';
const APP_PATH = '/c/projects/ptah-app';
const CHILD_TAB = '0f1e2d3c-4b5a-4968-8776-655443322110';

interface Harness {
  service: ChatSessionService;
  startChatSession: jest.Mock;
  streamEventsToWebview: jest.Mock;
  intercept: jest.Mock;
  handleStart: jest.Mock;
  getPort: jest.Mock;
  ensureRegisteredForSubagents: jest.Mock;
  isMcpServerRunning: jest.Mock;
  resolveEnhancedPromptsContent: jest.Mock;
  resolveProviderProfileForWorkspace: jest.Mock;
  resolveSessionFields: jest.Mock;
  captureException: jest.Mock;
}

function makeHarness(
  opts: { folders?: string[]; port?: number | null } = {},
): Harness {
  const stream = { [Symbol.asyncIterator]: jest.fn() };
  const startChatSession = jest.fn().mockResolvedValue(stream);
  const streamEventsToWebview = jest.fn();
  const intercept = jest.fn().mockReturnValue({ action: 'passthrough' });
  const handleStart = jest.fn();
  const getPort = jest
    .fn()
    .mockReturnValue(opts.port === undefined ? 4321 : opts.port);
  const ensureRegisteredForSubagents = jest
    .fn()
    .mockResolvedValue({ registered: true });
  const isMcpServerRunning = jest.fn().mockReturnValue(true);
  const resolveEnhancedPromptsContent = jest
    .fn()
    .mockResolvedValue('enhanced prompt body');
  const resolveProviderProfileForWorkspace = jest
    .fn()
    .mockResolvedValue(undefined);
  const resolveSessionFields = jest.fn().mockResolvedValue({});
  const captureException = jest.fn();
  const stub = { then: undefined } as unknown;

  const workspaceProvider = createMockWorkspaceProvider({
    folders: opts.folders ?? [ROOT],
  }) as unknown as IWorkspaceProvider;

  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    { startChatSession } as never,
    { captureException } as unknown as SentryService,
    { getPort, ensureRegisteredForSubagents } as never,
    stub as never,
    stub as unknown as SubagentRegistryService,
    { intercept } as never,
    stub as never,
    workspaceProvider,
    {
      type: 'cli',
      extensionPath: APP_PATH,
      globalStoragePath: '/c/ptah-storage',
      workspaceStoragePath: '/c/ptah-workspace-storage',
    } as never,
    { isMcpServerRunning, resolveEnhancedPromptsContent } as never,
    { handleStart } as never,
    { streamEventsToWebview } as never,
    stub as never,
    stub as never,
    createMockModelSettings() as unknown as ModelSettings,
    {
      getProviderKey: jest.fn().mockResolvedValue(undefined),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as never,
    { resolveProviderProfileForWorkspace } as never,
    { resolveSessionFields } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
  );

  // The Smithery / OAuth override resolvers read installed manifests from
  // disk; neither is under test here, so the merge contributes nothing.
  jest
    .spyOn(
      service as unknown as {
        buildMcpServersOverride: (caller: unknown) => Promise<unknown>;
      },
      'buildMcpServersOverride',
    )
    .mockImplementation(async (caller: unknown) => caller);

  return {
    service,
    startChatSession,
    streamEventsToWebview,
    intercept,
    handleStart,
    getPort,
    ensureRegisteredForSubagents,
    isMcpServerRunning,
    resolveEnhancedPromptsContent,
    resolveProviderProfileForWorkspace,
    resolveSessionFields,
    captureException,
  };
}

function childParams(
  overrides: Partial<AgentChildSessionStartParams> = {},
): AgentChildSessionStartParams {
  return {
    tabId: CHILD_TAB,
    workspaceRoot: ROOT,
    worktreePath: WORKTREE,
    prompt: '/clear contract and task text',
    sessionName: 'child: fix the parser',
    model: 'claude-child-model',
    ...overrides,
  };
}

function startConfig(h: Harness): Record<string, unknown> {
  expect(h.startChatSession).toHaveBeenCalledTimes(1);
  return h.startChatSession.mock.calls[0][0] as Record<string, unknown>;
}

describe('ChatSessionService — SDK launch identity (TASK_2026_584)', () => {
  describe('startSession (chat:start) — unchanged for existing callers', () => {
    it('passes workspaceId === projectPath === the workspace path, without a permission level', async () => {
      const h = makeHarness();

      const result = await h.service.startSession({
        tabId: 'tab-1',
        prompt: 'Hello',
        workspacePath: ROOT,
        options: { model: 'claude-picked' },
      });

      expect(result).toEqual({ success: true });
      const config = startConfig(h);
      expect(config['workspaceId']).toBe(ROOT);
      expect(config['projectPath']).toBe(ROOT);
      expect(config['tabId']).toBe('tab-1');
      expect(config['prompt']).toBe('Hello');
      expect(config['model']).toBe('claude-picked');
      expect(config['mcpServerRunning']).toBe(true);
      expect(config['enhancedPromptsContent']).toBe('enhanced prompt body');
      expect('permissionLevel' in config).toBe(false);
    });

    it('resolves prompts, provider profile and output style for the workspace path', async () => {
      const h = makeHarness();

      await h.service.startSession({
        tabId: 'tab-1',
        prompt: 'Hello',
        workspacePath: ROOT,
        options: { model: 'claude-picked' },
      });

      expect(h.resolveEnhancedPromptsContent).toHaveBeenCalledWith(ROOT);
      expect(h.resolveProviderProfileForWorkspace).toHaveBeenCalledWith(
        ROOT,
        'claude-picked',
      );
      expect(h.resolveSessionFields).toHaveBeenCalledWith({
        workspaceRoot: ROOT,
      });
    });

    it('still reads the .mcp.json registration and downgrades MCP when it is absent', async () => {
      const h = makeHarness();
      h.ensureRegisteredForSubagents.mockResolvedValueOnce({
        registered: false,
        reason: 'lock contended',
      });

      await h.service.startSession({
        tabId: 'tab-1',
        prompt: 'Hello',
        workspacePath: ROOT,
      });

      expect(h.ensureRegisteredForSubagents).toHaveBeenCalledTimes(1);
      expect(startConfig(h)['mcpServerRunning']).toBe(false);
    });

    it('still runs the slash-command intercept and streams under the tab id with the surface mode', async () => {
      const h = makeHarness();

      await h.service.startSession({
        tabId: 'tab-1',
        prompt: 'Hello',
        workspacePath: ROOT,
        surfaceMode: true,
      });

      expect(h.intercept).toHaveBeenCalledWith('Hello');
      const stream = await h.startChatSession.mock.results[0].value;
      expect(h.streamEventsToWebview).toHaveBeenCalledWith(
        'tab-1',
        stream,
        'tab-1',
        true,
      );
    });
  });

  describe('startAgentChildSession', () => {
    it('passes workspaceId = root, projectPath = worktree, permissionLevel = auto-edit', async () => {
      const h = makeHarness();

      const result = await h.service.startAgentChildSession(childParams());

      expect(result).toEqual({ success: true });
      const config = startConfig(h);
      expect(config['workspaceId']).toBe(ROOT);
      expect(config['projectPath']).toBe(WORKTREE);
      expect(config['permissionLevel']).toBe('auto-edit');
      expect(config['tabId']).toBe(CHILD_TAB);
      expect(config['prompt']).toBe('/clear contract and task text');
      expect(config['name']).toBe('child: fix the parser');
      expect(config['model']).toBe('claude-child-model');
    });

    it('resolves prompts, provider profile and output style for the workspace root, not the worktree', async () => {
      const h = makeHarness();

      await h.service.startAgentChildSession(childParams());

      expect(h.resolveEnhancedPromptsContent).toHaveBeenCalledWith(ROOT);
      expect(h.resolveProviderProfileForWorkspace).toHaveBeenCalledWith(
        ROOT,
        'claude-child-model',
      );
      expect(h.resolveSessionFields).toHaveBeenCalledWith({
        workspaceRoot: ROOT,
      });
    });

    it('derives mcpServerRunning from the server port and never consults the active-root .mcp.json', async () => {
      const h = makeHarness({ port: 4321 });
      h.isMcpServerRunning.mockReturnValue(false);

      await h.service.startAgentChildSession(childParams());

      expect(startConfig(h)['mcpServerRunning']).toBe(true);
      expect(h.ensureRegisteredForSubagents).not.toHaveBeenCalled();
    });

    it('starts without MCP when the server has no port', async () => {
      const h = makeHarness({ port: null });

      await h.service.startAgentChildSession(childParams());

      expect(startConfig(h)['mcpServerRunning']).toBe(false);
    });

    it('skips the slash-command intercept and the Ptah-CLI branch', async () => {
      const h = makeHarness();

      await h.service.startAgentChildSession(childParams());

      expect(h.intercept).not.toHaveBeenCalled();
      expect(h.handleStart).not.toHaveBeenCalled();
    });

    it('streams the child under its own tab id, outside any surface mode', async () => {
      const h = makeHarness();

      await h.service.startAgentChildSession(childParams());

      const stream = await h.startChatSession.mock.results[0].value;
      expect(h.streamEventsToWebview).toHaveBeenCalledWith(
        CHILD_TAB,
        stream,
        CHILD_TAB,
        undefined,
      );
    });

    it('refuses a worktree outside every open folder without starting', async () => {
      const h = makeHarness();

      const result = await h.service.startAgentChildSession(
        childParams({ worktreePath: '/tmp/elsewhere/child-1' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Access denied/);
      expect(h.startChatSession).not.toHaveBeenCalled();
    });

    it('refuses a workspace root outside every open folder before any launch work', async () => {
      const h = makeHarness();

      const result = await h.service.startAgentChildSession(
        childParams({ workspaceRoot: '/tmp/elsewhere' }),
      );

      expect(result).toEqual({
        success: false,
        error: 'Access denied: workspace root is not inside an open folder.',
      });
      expect(h.startChatSession).not.toHaveBeenCalled();
      expect(h.resolveEnhancedPromptsContent).not.toHaveBeenCalled();
      expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
      expect(h.getPort).not.toHaveBeenCalled();
    });

    it('refuses an unsafe worktree path without starting', async () => {
      const h = makeHarness({ folders: ['/c/projects'] });

      const result = await h.service.startAgentChildSession(
        childParams({ workspaceRoot: '/c/projects', worktreePath: APP_PATH }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot start a session in this folder/);
      expect(h.startChatSession).not.toHaveBeenCalled();
    });

    it('result-shapes an SDK start failure instead of throwing', async () => {
      const h = makeHarness();
      h.startChatSession.mockRejectedValueOnce(new Error('sdk exploded'));

      const result = await h.service.startAgentChildSession(childParams());

      expect(result).toEqual({ success: false, error: 'sdk exploded' });
      expect(h.streamEventsToWebview).not.toHaveBeenCalled();
      expect(h.captureException).toHaveBeenCalledWith(expect.any(Error), {
        errorSource: 'ChatSessionService.startAgentChildSession',
      });
    });
  });
});
