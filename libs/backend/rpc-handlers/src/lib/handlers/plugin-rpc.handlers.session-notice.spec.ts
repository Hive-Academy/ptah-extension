import 'reflect-metadata';
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
  CommandDiscoveryService: class CommandDiscoveryServiceStub {},
}));

import { RpcUserError } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { PluginRpcHandlers } from './plugin-rpc.handlers';
import { EXTERNAL_PLUGIN_MCP_TOKEN } from './external-plugin-mcp.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ROOT = '/tmp/ptah-plugin-notice-project';
const FOLDER = `${ROOT}/child`;
const CONFIG = {
  enabledPluginIds: [],
  disabledPluginIds: [],
  disabledSkillIds: [],
  lastUpdated: 0,
};
const NOTICE = {
  sessionRoot: FOLDER,
  inheritsProjectSettings: true,
  overrides: [],
  incomplete: false,
};

function harness(
  options: {
    sessionRoots?: { readSessionPolicyRoots: jest.Mock } | null;
    open?: boolean;
    notice?: typeof NOTICE | null;
    configHome?: object | null;
  } = {},
) {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const sentry = createMockSentryService();
  const loader = {
    hasWorkspaceState: jest.fn().mockReturnValue(true),
    getWorkspacePluginConfig: jest.fn().mockReturnValue(CONFIG),
    getConfigHomeStatus: jest.fn().mockReturnValue(options.configHome ?? null),
    getSessionPluginNotice: jest
      .fn()
      .mockReturnValue(options.notice === undefined ? NOTICE : options.notice),
  };
  const sessionRoots =
    options.sessionRoots === undefined
      ? {
          readSessionPolicyRoots: jest
            .fn()
            .mockResolvedValue({ folder: FOLDER, ancestorRoots: [ROOT] }),
        }
      : options.sessionRoots;
  const workspace = createMockWorkspaceProvider({
    folders: options.open === false ? [] : [ROOT],
  });
  const container = {
    isRegistered: jest.fn(
      (token: unknown) => token === EXTERNAL_PLUGIN_MCP_TOKEN,
    ),
    resolve: jest.fn().mockReturnValue({}),
  };
  const handlers = new PluginRpcHandlers(
    logger as never,
    rpc as never,
    loader as never,
    {} as never,
    workspace as never,
    {} as never,
    sentry as never,
    {} as never,
    {} as never,
    {} as never,
    container as never,
    {} as never,
    {} as never,
    {} as never,
    sessionRoots as never,
  );
  handlers.register();
  const getConfig = rpc.__handlers().get('plugins:get-config');
  if (!getConfig) throw new Error('get-config was not registered');
  return { logger, sentry, loader, sessionRoots, getConfig };
}

describe('plugins:get-config session notice', () => {
  it('preserves the old reply and skips lookup without a session id', async () => {
    const h = harness();
    expect(await h.getConfig({})).toEqual(CONFIG);
    expect(h.sessionRoots?.readSessionPolicyRoots).not.toHaveBeenCalled();
  });

  it('returns a notice from the session folder and ancestors', async () => {
    const h = harness();
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual({
      ...CONFIG,
      sessionNotice: NOTICE,
    });
    expect(h.loader.getSessionPluginNotice).toHaveBeenCalledWith(
      FOLDER,
      [ROOT],
      ROOT,
    );
  });

  it('omits the key when the loader returns null', async () => {
    const h = harness({ notice: null });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual(CONFIG);
  });

  it('keeps config and skips Sentry for a user error', async () => {
    const roots = {
      readSessionPolicyRoots: jest
        .fn()
        .mockRejectedValue(new RpcUserError('missing', 'SESSION_NOT_FOUND')),
    };
    const h = harness({ sessionRoots: roots });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual(CONFIG);
    expect(h.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('session notice unavailable'),
      expect.anything(),
    );
    expect(h.sentry.captureException).not.toHaveBeenCalled();
  });

  it('warns and keeps config for an unexpected lookup error', async () => {
    const roots = {
      readSessionPolicyRoots: jest
        .fn()
        .mockRejectedValue(new Error('read failed')),
    };
    const h = harness({ sessionRoots: roots });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual(CONFIG);
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.sentry.captureException).not.toHaveBeenCalled();
  });

  it.each(['x', 42])(
    'rejects invalid session hints without a lookup: %p',
    async (sessionId) => {
      const h = harness();
      expect(await h.getConfig({ sessionId })).toEqual(CONFIG);
      expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), {
        issuePaths: ['sessionId'],
      });
      expect(h.sessionRoots?.readSessionPolicyRoots).not.toHaveBeenCalled();
    },
  );

  it('omits the notice without a session service', async () => {
    const h = harness({ sessionRoots: null });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual(CONFIG);
  });

  it('omits the notice without an open folder', async () => {
    const h = harness({ open: false });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual(CONFIG);
    expect(h.sessionRoots?.readSessionPolicyRoots).not.toHaveBeenCalled();
  });

  it('returns config home and session notice together', async () => {
    const configHome = { state: 'ready' };
    const h = harness({ configHome });
    expect(await h.getConfig({ sessionId: SESSION_ID })).toEqual({
      ...CONFIG,
      configHome,
      sessionNotice: NOTICE,
    });
  });
});
