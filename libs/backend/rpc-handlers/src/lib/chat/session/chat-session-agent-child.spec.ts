import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 *     `projectPath = worktreePath`, the parent's `permissionLevel` (else the
 *     saved autopilot level; `plan` → `ask`, TASK_2026_660), resolves
 *     prompts / profile / style for the ROOT, and derives `mcpServerRunning`
 *     from the server port alone (no `.mcp.json` downgrade).
 *   - the child method skips the slash-command intercept and the Ptah-CLI
 *     branch, refuses a worktree outside the open folders and an unsafe path,
 *     and never throws.
 *   - TASK_2026_655: `startHandoffSession` passes `workspaceId = workspaceRoot`,
 *     `projectPath = cwd` and the caller's permission level (never forced to
 *     `auto-edit`), shares the child's path refusals, and reports a launch
 *     failure by its kind only, so the prompt never reaches a log, Sentry or
 *     the returned error.
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
  type HandoffSessionStartParams,
} from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-session-policy-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
for (const part of [
  'my-repo/.ptah/worktrees/child-1/nested',
  'my-repo/packages/parser',
  'my-repo/parent',
  'my-repo/other',
])
  mkdirSync(join(TEST_ROOT, part), { recursive: true });
const ROOT = `${TEST_ROOT}/my-repo`;
const WORKTREE = `${TEST_ROOT}/my-repo/.ptah/worktrees/child-1`;
const APP_PATH = `${TEST_ROOT}/ptah-app`;
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
  logger: ReturnType<typeof createMockLogger>;
  metadataGet: jest.Mock;
}

function makeHarness(
  opts: {
    folders?: string[];
    port?: number | null;
    /** What `config:autopilot-toggle` saved; absent → autopilot off. */
    autopilot?: { enabled: boolean; permissionLevel: string };
    metadata?: Record<string, unknown> | null;
  } = {},
): Harness {
  const autopilotConfig: Record<string, unknown> = opts.autopilot
    ? {
        'autopilot.enabled': opts.autopilot.enabled,
        'autopilot.permissionLevel': opts.autopilot.permissionLevel,
      }
    : {};
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

  const logger = createMockLogger();
  const metadataGet = jest.fn().mockResolvedValue(opts.metadata ?? null);
  const service = new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn((key: string, fallback: unknown) =>
        key in autopilotConfig
          ? autopilotConfig[key]
          : key.startsWith('autopilot.')
            ? fallback
            : false,
      ),
    } as unknown as ConfigManager,
    { startChatSession } as never,
    { captureException } as unknown as SentryService,
    { getPort, ensureRegisteredForSubagents } as never,
    stub as never,
    stub as unknown as SubagentRegistryService,
    { intercept } as never,
    { get: metadataGet } as never,
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
    {
      resolveStoredModel: (_path: string, model: string) => model || 'default',
      resolveProviderProfileForWorkspace,
    } as never,
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
    logger,
    metadataGet,
  };
}

const HANDOFF_TAB = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const HANDOFF_CWD = `${TEST_ROOT}/my-repo/packages/parser`;
const HANDOFF_PROMPT = 'SECRET-CONTINUATION continue the parser work';

function handoffParams(
  overrides: Partial<HandoffSessionStartParams> = {},
): HandoffSessionStartParams {
  return {
    tabId: HANDOFF_TAB,
    workspaceRoot: ROOT,
    cwd: HANDOFF_CWD,
    prompt: HANDOFF_PROMPT,
    sessionName: 'Continued: fix the parser',
    model: 'claude-parent-model',
    permissionLevel: 'yolo',
    ...overrides,
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
    it('deduplicates an ancestor by physical identity', async () => {
      const alias = join(ROOT, 'parent-alias');
      symlinkSync(join(ROOT, 'parent'), alias, 'dir');
      const h = makeHarness({
        metadata: {
          workspaceId: ROOT,
          workingDirectory: ROOT,
          pluginConfigAncestorRoots: [alias, join(ROOT, 'parent')],
        },
      });
      const result = await h.service.startAgentChildSession(
        childParams({ sourceSessionId: 'source' as never }),
      );
      expect(result.success).toBe(true);
      expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([
        ROOT,
        join(ROOT, 'parent'),
      ]);
    });
    it('refuses a removed ancestor before the SDK launch', async () => {
      const h = makeHarness({
        metadata: {
          workspaceId: ROOT,
          workingDirectory: ROOT,
          pluginConfigAncestorRoots: [join(ROOT, 'removed-ancestor')],
        },
      });
      const result = await h.service.startAgentChildSession(
        childParams({ sourceSessionId: 'source' as never }),
      );
      expect(result.success).toBe(false);
      expect(h.startChatSession).not.toHaveBeenCalled();
      expect(h.resolveEnhancedPromptsContent).not.toHaveBeenCalled();
    });
    it('captures the authoritative source root and saved ancestors in order', async () => {
      const h = makeHarness({
        metadata: {
          workspaceId: ROOT,
          workingDirectory: ROOT,
          pluginConfigAncestorRoots: [`${TEST_ROOT}/my-repo/parent`, ROOT],
        },
      });
      const result = await h.service.startAgentChildSession(
        childParams({
          sourceSessionId: 'source' as never,
        }),
      );
      expect(result.success).toBe(true);
      expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([
        ROOT,
        `${TEST_ROOT}/my-repo/parent`,
      ]);
    });

    it('refuses an unresolved or mismatched source before SDK launch', async () => {
      const h = makeHarness();
      expect(
        (
          await h.service.startAgentChildSession(
            childParams({ sourceSessionId: 'missing' as never }),
          )
        ).success,
      ).toBe(false);
      h.metadataGet.mockResolvedValue({
        workspaceId: ROOT,
        workingDirectory: `${TEST_ROOT}/my-repo/other`,
      });
      expect(
        (
          await h.service.startAgentChildSession(
            childParams({ sourceSessionId: 'mismatch' as never }),
          )
        ).success,
      ).toBe(false);
      h.metadataGet.mockResolvedValue({
        workspaceId: '',
        workingDirectory: '',
      });
      expect(
        (
          await h.service.startAgentChildSession(
            childParams({ sourceSessionId: 'missing-root' as never }),
          )
        ).success,
      ).toBe(false);
      expect(h.startChatSession).not.toHaveBeenCalled();
    });

    it('uses only the validated immediate root without a source', async () => {
      const h = makeHarness();
      await h.service.startAgentChildSession(childParams());
      expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([ROOT]);
    });

    it('uses the live pre-bind source chain for a nested child', async () => {
      const h = makeHarness();
      await h.service.startAgentChildSession(childParams());
      await h.service.startAgentChildSession(
        childParams({
          tabId: 'grandchild',
          workspaceRoot: WORKTREE,
          worktreePath: `${WORKTREE}/nested`,
          sourceSessionId: CHILD_TAB as never,
        }),
      );
      expect(
        h.startChatSession.mock.calls[1][0].pluginConfigAncestorRoots,
      ).toEqual([WORKTREE, ROOT]);
    });
    it('passes workspaceId = root, projectPath = worktree and the parent permission level', async () => {
      const h = makeHarness();

      const result = await h.service.startAgentChildSession(
        childParams({ permissionLevel: 'yolo' }),
      );

      expect(result).toEqual({ success: true });
      const config = startConfig(h);
      expect(config['workspaceId']).toBe(ROOT);
      expect(config['projectPath']).toBe(WORKTREE);
      expect(config['permissionLevel']).toBe('yolo');
      expect(config['tabId']).toBe(CHILD_TAB);
      expect(config['prompt']).toBe('/clear contract and task text');
      expect(config['name']).toBe('child: fix the parser');
      expect(config['model']).toBe('claude-child-model');
    });

    describe('permission level (TASK_2026_660)', () => {
      it('starts the child of a full-autopilot parent at yolo, even when the saved level is lower', async () => {
        const h = makeHarness({
          autopilot: { enabled: true, permissionLevel: 'auto-edit' },
        });

        await h.service.startAgentChildSession(
          childParams({ permissionLevel: 'yolo' }),
        );

        expect(startConfig(h)['permissionLevel']).toBe('yolo');
      });

      it.each(['ask', 'auto-edit'] as const)(
        'starts the child of a %s parent at %s, not a fixed default',
        async (level) => {
          const h = makeHarness({
            autopilot: { enabled: true, permissionLevel: 'yolo' },
          });

          await h.service.startAgentChildSession(
            childParams({ permissionLevel: level }),
          );

          expect(startConfig(h)['permissionLevel']).toBe(level);
        },
      );

      it('starts the child of a plan-mode parent at ask: plan mode is unavailable unattended', async () => {
        const h = makeHarness();

        await h.service.startAgentChildSession(
          childParams({ permissionLevel: 'plan' }),
        );

        expect(startConfig(h)['permissionLevel']).toBe('ask');
      });

      it('starts the child at ask when the parent record is missing, even with a saved yolo level', async () => {
        // No parent level reached the service (no lifecycle record, or it
        // vanished between lookups): the saved global level must not escalate.
        const h = makeHarness({
          autopilot: { enabled: true, permissionLevel: 'yolo' },
        });

        await h.service.startAgentChildSession(childParams());

        expect(startConfig(h)['permissionLevel']).toBe('ask');
      });

      it('starts the child at ask when the parent level is unknown and autopilot is off', async () => {
        const h = makeHarness({
          autopilot: { enabled: false, permissionLevel: 'auto-edit' },
        });

        await h.service.startAgentChildSession(childParams());

        expect(startConfig(h)['permissionLevel']).toBe('ask');
      });
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
      const h = makeHarness({ folders: [`${TEST_ROOT}`] });

      const result = await h.service.startAgentChildSession(
        childParams({ workspaceRoot: `${TEST_ROOT}`, worktreePath: APP_PATH }),
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

  it('preserves a source chain on a same-root handoff', async () => {
    const h = makeHarness({
      metadata: {
        workspaceId: ROOT,
        workingDirectory: HANDOFF_CWD,
        pluginConfigAncestorRoots: [ROOT],
      },
    });
    const result = await h.service.startHandoffSession(
      handoffParams({
        workspaceRoot: HANDOFF_CWD,
        sourceSessionId: 'source' as never,
      }),
    );
    expect(result.success).toBe(true);
    expect(startConfig(h)['pluginConfigAncestorRoots']).toEqual([ROOT]);
  });

  describe('startHandoffSession (TASK_2026_655)', () => {
    function loggedText(h: Harness): string {
      return JSON.stringify([
        h.logger.debug.mock.calls,
        h.logger.info.mock.calls,
        h.logger.warn.mock.calls,
        h.logger.error.mock.calls,
      ]);
    }

    it('starts a top-level session in the caller cwd with its permission level and model', async () => {
      const h = makeHarness();

      const result = await h.service.startHandoffSession(handoffParams());

      expect(result).toEqual({ success: true });
      const config = startConfig(h);
      expect(config['tabId']).toBe(HANDOFF_TAB);
      expect(config['workspaceId']).toBe(ROOT);
      expect(config['projectPath']).toBe(HANDOFF_CWD);
      expect(config['permissionLevel']).toBe('yolo');
      expect(config['prompt']).toBe(HANDOFF_PROMPT);
      expect(config['name']).toBe('Continued: fix the parser');
      expect(config['model']).toBe('claude-parent-model');
      expect(config['mcpServerRunning']).toBe(true);
      expect(h.resolveEnhancedPromptsContent).toHaveBeenCalledWith(ROOT);
      expect(h.resolveProviderProfileForWorkspace).toHaveBeenCalledWith(
        ROOT,
        'claude-parent-model',
      );
      expect(h.intercept).not.toHaveBeenCalled();
      expect(h.handleStart).not.toHaveBeenCalled();
      expect(h.ensureRegisteredForSubagents).not.toHaveBeenCalled();
      const stream = await h.startChatSession.mock.results[0].value;
      expect(h.streamEventsToWebview).toHaveBeenCalledWith(
        HANDOFF_TAB,
        stream,
        HANDOFF_TAB,
        undefined,
      );
      expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
    });

    it.each(['yolo', 'plan', 'ask', 'auto-edit'] as const)(
      'starts the new session at the caller level %s',
      async (level) => {
        const h = makeHarness();

        await h.service.startHandoffSession(
          handoffParams({ permissionLevel: level }),
        );

        expect(startConfig(h)['permissionLevel']).toBe(level);
      },
    );

    it('keeps the global default level when the caller had none, never forcing auto-edit', async () => {
      const h = makeHarness();

      await h.service.startHandoffSession(
        handoffParams({ permissionLevel: undefined }),
      );

      expect(startConfig(h)).not.toHaveProperty('permissionLevel');
    });

    it('derives mcpServerRunning from the server port', async () => {
      const h = makeHarness({ port: null });

      await h.service.startHandoffSession(handoffParams());

      expect(startConfig(h)['mcpServerRunning']).toBe(false);
    });

    it('refuses a workspace root outside every open folder before any launch work', async () => {
      const h = makeHarness();

      const result = await h.service.startHandoffSession(
        handoffParams({ workspaceRoot: '/tmp/elsewhere' }),
      );

      expect(result).toEqual({
        success: false,
        error: 'Access denied: workspace root is not inside an open folder.',
      });
      expect(h.startChatSession).not.toHaveBeenCalled();
      expect(h.resolveEnhancedPromptsContent).not.toHaveBeenCalled();
      expect(h.getPort).not.toHaveBeenCalled();
    });

    it('refuses a cwd outside every open folder without starting', async () => {
      const h = makeHarness();

      const result = await h.service.startHandoffSession(
        handoffParams({ cwd: '/tmp/elsewhere/parser' }),
      );

      expect(result).toEqual({
        success: false,
        error: 'Access denied: working directory is not inside an open folder.',
      });
      expect(h.startChatSession).not.toHaveBeenCalled();
    });

    it('refuses an unsafe cwd without starting', async () => {
      const h = makeHarness({ folders: [`${TEST_ROOT}`] });

      const result = await h.service.startHandoffSession(
        handoffParams({ workspaceRoot: `${TEST_ROOT}`, cwd: APP_PATH }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot start a session in this folder/);
      expect(h.startChatSession).not.toHaveBeenCalled();
    });

    it('reports a launch failure by its kind only, never its message', async () => {
      const h = makeHarness();
      const failure = Object.assign(
        new Error(`spawn failed for: ${HANDOFF_PROMPT}`),
        { code: 'ENOENT' },
      );
      h.startChatSession.mockRejectedValueOnce(failure);

      const result = await h.service.startHandoffSession(handoffParams());

      expect(result).toEqual({
        success: false,
        error: 'the session launch failed (Error (ENOENT)).',
      });
      expect(h.streamEventsToWebview).not.toHaveBeenCalled();
      expect(h.captureException).toHaveBeenCalledTimes(1);
      const [captured, context] = h.captureException.mock.calls[0] as [
        Error,
        unknown,
      ];
      expect(context).toEqual({
        errorSource: 'ChatSessionService.startHandoffSession',
      });
      expect(captured.message).not.toContain('SECRET-CONTINUATION');
      expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
    });

    it('never copies an error name or code that quotes the prompt', async () => {
      const h = makeHarness();
      const failure = Object.assign(new Error(`failed: ${HANDOFF_PROMPT}`), {
        code: `E_${HANDOFF_PROMPT}`,
      });
      failure.name = `Quoting ${HANDOFF_PROMPT}`;
      h.startChatSession.mockRejectedValueOnce(failure);

      const result = await h.service.startHandoffSession(handoffParams());

      expect(result).toEqual({
        success: false,
        error: 'the session launch failed (unknown).',
      });
      const [captured] = h.captureException.mock.calls[0] as [Error];
      expect(captured.message).not.toContain('SECRET-CONTINUATION');
      expect(captured.name).not.toContain('SECRET-CONTINUATION');
      expect(loggedText(h)).not.toContain('SECRET-CONTINUATION');
    });
  });
});
