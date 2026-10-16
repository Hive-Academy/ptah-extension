import 'reflect-metadata';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
}));

import type { SessionId } from '@ptah-extension/shared';
import { ChatSessionService } from './chat-session.service';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const tabId = '22222222-2222-4222-8222-222222222222';
const workspacePath = '/workspace';

function service() {
  const resumeSession = jest.fn().mockResolvedValue({});
  const isSessionActive = jest.fn().mockReturnValue(false);
  const isStreaming = jest.fn().mockReturnValue(false);
  const logger = { info: jest.fn(), warn: jest.fn() };
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
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    },
    outputStyleActivation: {
      resolveSessionFields: jest.fn().mockResolvedValue({}),
    },
    resolveWorkflowsDisabled: jest.fn().mockReturnValue(false),
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
