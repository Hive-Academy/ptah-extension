/**
 * chat:continue delivers a Codex follow-up once (GAP-I).
 *
 * Codex thread resume starts the turn from config.prompt. Claude resume
 * ignores prompt, files, and images. An inactive Codex session must not call
 * sendMessageToSession again. A live Codex thread and an inactive Claude
 * session keep the second send.
 */

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
}));

import type { ChatContinueParams, SessionId } from '@ptah-extension/shared';
import { ChatSessionService } from './chat-session.service';

const OPEN_FOLDER = '/c/projects/qa3elhamor';
const SESSION_ID = 'b5399ba8-e06d-417c-bac4-aba5add0555c' as SessionId;
const TAB_ID = 'f69cb197-0798-40bc-ac0c-6f7591e0a894';
const FILES = ['src/main.ts'];
const IMAGES = [{ data: 'aGVsbG8=', mediaType: 'image/png' }];

interface Harness {
  service: ChatSessionService;
  resumeSession: jest.Mock;
  sendMessageToSession: jest.Mock;
  routeFollowUpSlashCommand: jest.Mock;
}

function emptyStream() {
  return (async function* () {
    /* no events */
  })();
}

function harness(runtime: 'codex-app-server' | 'claude-sdk', live: boolean): Harness {
  const resumeSession = jest.fn().mockResolvedValue(emptyStream());
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const routeFollowUpSlashCommand = jest.fn().mockResolvedValue(null);
  const prepare = jest.fn(async (config: object) => ({
    runtime: 'codex-app-server' as const,
    seed: { model: 'gpt-5.4' },
    workspacePath: OPEN_FOLDER,
    cwd: OPEN_FOLDER,
    config,
  }));
  const service: ChatSessionService = Object.assign(
    Object.create(ChatSessionService.prototype),
    {
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      ptahCli: {
        handleContinue: async () => ({ error: '__NOT_PTAH_CLI__' }),
      },
      sessionMetadataStore: { get: async () => null },
      historyRead: { resolveSessionFolder: async () => OPEN_FOLDER },
      sdkContext: {
        isMcpServerRunning: () => false,
        resolveEnhancedPromptsContent: async () => undefined,
      },
      codeExecutionMcp: { getPort: () => 0 },
      sdkAdapter: {
        isSessionActive: () => live,
        resumeSession,
        sendMessageToSession,
        interruptSession: jest.fn().mockResolvedValue(undefined),
        interruptCurrentTurn: jest.fn().mockResolvedValue(true),
      },
      streamBroadcaster: {
        isStreaming: () => live,
        streamEventsToWebview: jest.fn(),
      },
      sessionRuntimeRouter: null,
      runtimeProfile:
        runtime === 'codex-app-server'
          ? {
              prepare,
              publishRuntimeNotices: jest.fn().mockResolvedValue(undefined),
            }
          : undefined,
      workspaceProviderProfileResolver: {
        resolveStoredModel: (_workspace: string, model: string) => model || 'default',
        resolveProviderProfileForWorkspace: async () => undefined,
      },
      outputStyleActivation: { resolveSessionFields: async () => ({}) },
      modelSettings: { selectedModel: { get: () => 'default' } },
      workspaceProvider: { getConfiguration: () => false },
      slashCommandRouter: { routeFollowUpSlashCommand },
      subagentContextInjector: {
        injectInterruptedAgentsContext: async (prompt: string) => ({ prompt }),
      },
      sentryService: { captureException: jest.fn() },
    },
  );
  return { service, resumeSession, sendMessageToSession, routeFollowUpSlashCommand };
}

function params(prompt: string): ChatContinueParams {
  return {
    prompt,
    sessionId: SESSION_ID,
    tabId: TAB_ID,
    workspacePath: OPEN_FOLDER,
    files: FILES,
    images: IMAGES,
  };
}

describe('chat:continue Codex resume delivers the follow-up once', () => {
  it('(a) resumes an inactive Codex session once with prompt, files, and images', async () => {
    const h = harness('codex-app-server', false);

    const result = await h.service.continueSession(params('follow up'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        prompt: 'follow up',
        files: FILES,
        images: IMAGES,
      }),
    );
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
    expect(h.resumeSession.mock.invocationCallOrder[0]).toBeLessThan(
      h.routeFollowUpSlashCommand.mock.invocationCallOrder[0],
    );
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('resumes an attachment-only Codex follow-up as exactly one turn', async () => {
    const h = harness('codex-app-server', false);

    const result = await h.service.continueSession(params(''));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ prompt: '', files: FILES, images: IMAGES }),
    );
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('(b) keeps the Claude resume free of attachments and still sends once', async () => {
    const h = harness('claude-sdk', false);

    const result = await h.service.continueSession(params('follow up'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID, enqueued: true });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    const resumeConfig: object = h.resumeSession.mock.calls[0][1];
    expect(resumeConfig).toEqual(expect.objectContaining({ prompt: 'follow up' }));
    expect(resumeConfig).not.toHaveProperty('files');
    expect(resumeConfig).not.toHaveProperty('images');
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(h.sendMessageToSession).toHaveBeenCalledWith(SESSION_ID, 'follow up', {
      files: FILES,
      images: IMAGES,
    });
  });

  it('(c) sends once into a live Codex session and does not resume', async () => {
    const h = harness('codex-app-server', true);

    const result = await h.service.continueSession(params('follow up'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID, enqueued: true });
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(h.sendMessageToSession).toHaveBeenCalledWith(SESSION_ID, 'follow up', {
      files: FILES,
      images: IMAGES,
    });
  });
});
