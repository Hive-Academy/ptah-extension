import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
}));

import type { SessionId } from '@ptah-extension/shared';
import { ChatSessionService } from './chat-session.service';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const tabId = '22222222-2222-4222-8222-222222222222';
const workspacePath = mkdtempSync(join(tmpdir(), 'ptah-persona-resume-'));
afterAll(() => rmSync(workspacePath, { recursive: true, force: true }));

function service() {
  const resumeSession = jest.fn().mockResolvedValue({});
  const isSessionActive = jest.fn().mockReturnValue(false);
  const isStreaming = jest.fn().mockReturnValue(false);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const subject = Object.assign(Object.create(ChatSessionService.prototype), {
    sdkAdapter: { isSessionActive, resumeSession },
    streamBroadcaster: { isStreaming, streamEventsToWebview: jest.fn() },
    historyRead: {
      resolveSessionFolder: jest.fn().mockResolvedValue(workspacePath),
    },
    sdkContext: {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    },
    codeExecutionMcp: { getPort: jest.fn().mockReturnValue(0) },
    modelSettings: {
      selectedModel: { get: jest.fn().mockReturnValue('default') },
    },
    workspaceProviderProfileResolver: {
      resolveStoredModel: jest.fn(
        (_path: string, model: string) => model || 'default',
      ),
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    },
    outputStyleActivation: {
      resolveSessionFields: jest.fn().mockResolvedValue({}),
    },
    resolveWorkflowsDisabled: jest.fn().mockReturnValue(false),
    // Ambient host (no account service): the gate reads local metadata only,
    // and a session without an account binding is admitted.
    sessionMetadataStore: { get: jest.fn().mockResolvedValue(undefined) },
    workspaceProvider: createMockWorkspaceProvider({
      folders: [workspacePath],
    }),
    platformInfo: {
      type: 'cli',
      extensionPath: join(tmpdir(), 'ptah-app'),
      globalStoragePath: join(tmpdir(), 'ptah-storage'),
    },
    logger,
  }) as ChatSessionService;
  return { subject, resumeSession, logger, isSessionActive, isStreaming };
}

describe('inactive SDK persona resume', () => {
  it('activates with a persona and keeps history-only resume unchanged', async () => {
    const { subject } = service();
    const autoResume = jest.fn().mockResolvedValue({ justResumed: true });
    Object.assign(subject, {
      sessionMetadataStore: {
        get: jest.fn().mockResolvedValue({}),
        getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
      },
      historyRead: {
        readForResume: jest.fn().mockResolvedValue({
          resolvedWorkspacePath: workspacePath,
          events: [],
          stats: null,
        }),
      },
      subagentRegistry: {
        restoreResumableBySession: jest.fn().mockReturnValue(0),
        hydrateResumeState: jest.fn().mockReturnValue(0),
        isResumeStateHydrated: jest.fn().mockReturnValue(true),
        getInterruptedBySession: jest.fn().mockReturnValue([]),
        registerFromHistoryEvents: jest.fn().mockReturnValue(0),
        getResumableBySession: jest.fn().mockReturnValue([]),
      },
      autoResumeIfInactive: autoResume,
    });
    const params = { sessionId, tabId, systemPrompt: 'Persona text' };
    expect((await subject.resumeSession(params)).success).toBe(true);
    expect(autoResume).not.toHaveBeenCalled();
    expect(
      (await subject.resumeSession({ ...params, activate: true })).activated,
    ).toBe(true);
    expect(autoResume).toHaveBeenCalledWith(
      sessionId,
      tabId,
      '',
      expect.objectContaining({
        systemPrompt: 'Persona text',
      }),
    );
  });
  it.each([
    ['with persona', 'Persona text'],
    ['ordinary chat', undefined],
  ])('passes %s only on inactive resume', async (_label, systemPrompt) => {
    const { subject, resumeSession, logger } = service();
    await subject['autoResumeIfInactive'](sessionId, tabId, 'continue', {
      sessionId,
      tabId,
      workspacePath,
      systemPrompt,
    });
    const config = resumeSession.mock.calls[0][1];
    if (systemPrompt) expect(config.systemPrompt).toBe(systemPrompt);
    else expect(config).not.toHaveProperty('systemPrompt');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'Persona text',
    );
  });

  it('forwards persona through rewind activation and ignores it for an active stream', async () => {
    const { subject, resumeSession, isSessionActive, isStreaming } = service();
    await subject.ensureSessionActiveForRewind(
      sessionId,
      tabId,
      workspacePath,
      'Persona text',
    );
    expect(resumeSession.mock.calls[0][1].systemPrompt).toBe('Persona text');
    resumeSession.mockClear();
    isSessionActive.mockReturnValue(true);
    isStreaming.mockReturnValue(true);
    await subject.ensureSessionActiveForRewind(
      sessionId,
      tabId,
      workspacePath,
      'Persona text',
    );
    expect(resumeSession).not.toHaveBeenCalled();
  });
});
