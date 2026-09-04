/**
 * ChatSessionService — MCP-status fan-out wiring (TASK_2026_375 B4.3).
 *
 * Surface under test: the constructor subscription that folds the `agent-sdk`
 * `SessionMcpStatusCallbackRegistry` into `SessionMcpStatusRegistry` and pushes
 * `session:mcpStatus` to the webview.
 *
 * Strategy mirrors `chat-session-auth.spec.ts`: instantiate the service
 * directly with minimal stubs, and drive the fan-out by invoking the callback
 * the constructor registered. Nothing else on the service is exercised.
 */

import 'reflect-metadata';

// Same reason as `chat-session-auth.spec.ts`: `ChatSessionService` transitively
// pulls `@ptah-extension/workspace-intelligence`, whose TreeSitter module
// evaluates `import.meta.url` at top level — a construct ts-jest's CJS
// transform cannot parse.
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

import type { SessionMcpStatusEvent } from '@ptah-extension/agent-sdk';
import type {
  ConfigManager,
  Logger,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const NOTICE = {
  code: 'claude-ai-connectors-disabled',
  message:
    'claude.ai connectors are disabled because ANTHROPIC_API_KEY or another ' +
    'auth source is set and takes precedence over your claude.ai login',
} as const;

interface Harness {
  registry: SessionMcpStatusRegistry;
  /** Invokes the callback the constructor registered on the fan-out. */
  emit: (event: SessionMcpStatusEvent) => void;
  broadcast: jest.Mock;
  registered: boolean;
}

function makeHarness(opts: { broadcastRejects?: boolean } = {}): Harness {
  const logger = createMockLogger();
  const noop = jest.fn();
  const stub = { then: undefined } as unknown;
  const broadcast = jest
    .fn()
    .mockImplementation(() =>
      opts.broadcastRejects
        ? Promise.reject(new Error('webview channel disposed'))
        : Promise.resolve(),
    );
  const registry = new SessionMcpStatusRegistry();

  let subscriber: ((event: SessionMcpStatusEvent) => void) | null = null;
  const fanOut = {
    register: jest.fn((cb: (event: SessionMcpStatusEvent) => void) => {
      subscriber = cb;
      return () => undefined;
    }),
  };

  new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: broadcast } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    stub as never,
    { captureException: jest.fn() } as unknown as SentryService,
    stub as never,
    stub as never,
    stub as unknown as SubagentRegistryService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    stub as never,
    createMockWorkspaceProvider({
      folders: ['/c/projects/my-repo'],
    }) as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    stub as never,
    {
      handleStart: jest.fn().mockResolvedValue({ result: { success: false } }),
    } as never,
    stub as never,
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
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    registry,
    fanOut as never,
  );

  return {
    registry,
    emit: (event) => subscriber?.(event),
    broadcast,
    registered: fanOut.register.mock.calls.length === 1,
  };
}

describe('ChatSessionService — MCP status fan-out', () => {
  it('subscribes to the fan-out exactly once, in the constructor', () => {
    // The two producers fire during session START, so a lazy subscription
    // would miss the first session of the process.
    expect(makeHarness().registered).toBe(true);
  });

  it('records the servers from an init event and pushes session:mcpStatus', async () => {
    const h = makeHarness();
    h.emit({
      kind: 'servers',
      sessionId: 's1',
      servers: [{ name: 'smithery', status: 'needs-auth' }],
    });

    expect(h.registry.get('s1')).toMatchObject({
      servers: [{ name: 'smithery', status: 'needs-auth' }],
      notices: [],
    });
    expect(h.broadcast).toHaveBeenCalledWith(MESSAGE_TYPES.SESSION_MCP_STATUS, {
      sessionId: 's1',
      servers: [{ name: 'smithery', status: 'needs-auth' }],
      notices: [],
    });
  });

  it('records a notice event and pushes the merged record', () => {
    const h = makeHarness();
    h.emit({ kind: 'notice', sessionId: 's1', notice: NOTICE });

    expect(h.broadcast).toHaveBeenCalledWith(MESSAGE_TYPES.SESSION_MCP_STATUS, {
      sessionId: 's1',
      servers: [],
      notices: [NOTICE],
    });
  });

  it('pushes the WHOLE record on each event, not just the delta', () => {
    const h = makeHarness();
    h.emit({ kind: 'notice', sessionId: 's1', notice: NOTICE });
    h.emit({
      kind: 'servers',
      sessionId: 's1',
      servers: [{ name: 'a', status: 'connected' }],
    });

    // The webview holds one record per session, so a second push that dropped
    // the notice would erase it from the popover.
    expect(h.broadcast).toHaveBeenLastCalledWith(
      MESSAGE_TYPES.SESSION_MCP_STATUS,
      {
        sessionId: 's1',
        servers: [{ name: 'a', status: 'connected' }],
        notices: [NOTICE],
      },
    );
  });

  it('publishes nothing for an empty session id', () => {
    const h = makeHarness();
    h.emit({ kind: 'servers', sessionId: '', servers: [] });

    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.registry.size).toBe(0);
  });

  it('swallows a broadcast rejection — a disposed channel is not a defect', async () => {
    const h = makeHarness({ broadcastRejects: true });

    expect(() =>
      h.emit({ kind: 'servers', sessionId: 's1', servers: [] }),
    ).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail here.
    await Promise.resolve();
    await Promise.resolve();
    // The record is still written — the push failing does not lose the state a
    // later `session:status` read serves.
    expect(h.registry.get('s1')).not.toBeNull();
  });
});
