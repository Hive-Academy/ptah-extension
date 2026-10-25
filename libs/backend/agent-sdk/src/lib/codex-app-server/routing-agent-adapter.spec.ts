import {
  SessionId,
  type IAgentAdapter,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import { RoutingAgentAdapter } from './routing-agent-adapter';
import { SessionRuntimeRoutingError } from './session-runtime-router';

function adapter(): jest.Mocked<IAgentAdapter> {
  return {
    providerId: 'claude-cli',
    info: {
      id: 'claude-cli',
      name: 'Claude',
      version: '1',
      description: '',
      vendor: '',
      capabilities: {
        streaming: true,
        fileAttachments: true,
        contextManagement: true,
        sessionPersistence: true,
        multiTurn: true,
        codeGeneration: true,
        imageAnalysis: true,
        functionCalling: true,
      },
    },
    initialize: jest.fn(),
    dispose: jest.fn(),
    preloadSdk: jest.fn(),
    getCliJsPath: jest.fn(),
    verifyInstallation: jest.fn(),
    getHealth: jest.fn(),
    reset: jest.fn(),
    getSupportedModels: jest.fn(),
    getDefaultModel: jest.fn(),
    getApiModels: jest.fn(),
    startChatSession: jest.fn(),
    resumeSession: jest.fn(),
    endSession: jest.fn(),
    sendMessageToSession: jest.fn(),
    isSessionActive: jest.fn(),
    getSessionToken: jest.fn(),
    endSessionIfTokenMatches: jest.fn(),
    executeSlashCommand: jest.fn(),
    interruptCurrentTurn: jest.fn(),
    interruptSession: jest.fn(),
    setSessionPermissionLevel: jest.fn(),
    setSessionModel: jest.fn(),
    setSessionEffort: jest.fn(),
    setSessionIdResolvedCallback: jest.fn(),
    setResultStatsCallback: jest.fn(),
    setCompactionStartCallback: jest.fn(),
    setLiveStatsCallback: jest.fn(),
    setWorktreeCreatedCallback: jest.fn(),
    setWorktreeRemovedCallback: jest.fn(),
  };
}
const id = SessionId.from('33333333-3333-4333-8333-333333333333');
const legacyIdentity: SessionRuntimeIdentity = {
  version: 1,
  sessionId: id,
  providerId: 'anthropic',
  workspaceId: '/workspace',
  runtime: 'claude-sdk',
};
const nativeIdentity: SessionRuntimeIdentity = {
  ...legacyIdentity,
  providerId: 'openai-codex',
  runtime: 'codex-app-server',
  codex: { normalizedHome: '/home' },
};

describe('RoutingAgentAdapter', () => {
  it('defaults new and existing legacy sessions to SDK with no override/capability', async () => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ persisted: legacyIdentity }) },
      legacy,
      native,
    );
    await router.startChatSession({ tabId: 'tab' });
    await router.resumeSession(id);
    expect(legacy.startChatSession).toHaveBeenCalledTimes(1);
    expect(legacy.resumeSession).toHaveBeenCalledWith(id);
    expect(native.startChatSession).not.toHaveBeenCalled();
    expect(native.resumeSession).not.toHaveBeenCalled();
  });
  it('admits new native chats with host DS1 capability without migrating old history', async () => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ persisted: legacyIdentity }) },
      legacy,
      native,
      { nativeCodex: true },
    );
    await router.startChatSession({ tabId: 'tab' });
    await router.resumeSession(id);
    expect(native.startChatSession).toHaveBeenCalledWith({ tabId: 'tab' });
    expect(legacy.resumeSession).toHaveBeenCalledWith(id);
  });
  it('uses persisted native identity even when provider metadata says Claude and new routing is disabled', async () => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ persisted: nativeIdentity }) },
      legacy,
      native,
    );
    await router.resumeSession(id);
    await router.setSessionModel(id, 'model');
    expect(router.providerId).toBe('claude-cli');
    expect(native.resumeSession).toHaveBeenCalledWith(id);
    expect(native.setSessionModel).toHaveBeenCalledWith(id, 'model');
    expect(legacy.resumeSession).not.toHaveBeenCalled();
  });
  it('never falls back after native selection fails', async () => {
    const legacy = adapter();
    const native = adapter();
    const error = new Error('native failed');
    native.startChatSession.mockRejectedValue(error);
    native.resumeSession.mockRejectedValue(error);
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ persisted: nativeIdentity }) },
      legacy,
      native,
      { nativeCodex: true },
    );
    await expect(router.startChatSession({ tabId: 'tab' })).rejects.toBe(error);
    await expect(router.resumeSession(id)).rejects.toBe(error);
    expect(legacy.startChatSession).not.toHaveBeenCalled();
    expect(legacy.resumeSession).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    {},
    { live: legacyIdentity, persisted: nativeIdentity },
    {
      persisted: {
        ...nativeIdentity,
        sessionId: SessionId.from('44444444-4444-4444-8444-444444444444'),
      },
    },
  ])('rejects absent or conflicting identities', (binding) => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => binding },
      legacy,
      native,
    );
    expect(() => router.resumeSession(id)).toThrow(SessionRuntimeRoutingError);
    expect(legacy.resumeSession).not.toHaveBeenCalled();
    expect(native.resumeSession).not.toHaveBeenCalled();
  });
});
