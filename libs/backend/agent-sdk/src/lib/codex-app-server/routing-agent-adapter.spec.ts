import { SessionId, type SessionRuntimeIdentity } from '@ptah-extension/shared';
import {
  RoutingAgentAdapter,
  type NativeChatAdapter,
} from './routing-agent-adapter';
import { SessionRuntimeRoutingError } from './session-runtime-identity';

function adapter(): jest.Mocked<NativeChatAdapter> {
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
    owns: jest.fn().mockReturnValue(false),
    initialize: jest.fn(),
    dispose: jest.fn(),
    preloadSdk: jest.fn(),
    getCliJsPath: jest.fn(),
    verifyInstallation: jest.fn(),
    getHealth: jest.fn(),
    reset: jest.fn(),
    getSupportedModels: jest.fn(),
    listSessionModels: jest.fn(),
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
  it('close the tab during a native open', async () => {
    const legacy = adapter();
    const native = adapter();
    const lookup = jest.fn();
    let cancelOpen: (() => void) | undefined;
    const cancelled = new Error('Open cancelled');
    native.startChatSession.mockImplementation(() => {
      native.owns.mockImplementation((sessionId) => sessionId === id);
      return new Promise((resolve, reject) => {
        cancelOpen = () => reject(cancelled);
      });
    });
    native.endSession.mockImplementation(() => {
      cancelOpen?.();
      native.owns.mockReturnValue(false);
    });
    const router = new RoutingAgentAdapter(
      { lookup },
      legacy,
      native,
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
      { nativeCodex: true },
    );
    const opening = router.startChatSession({ tabId: id });
    const rejected = expect(opening).rejects.toBe(cancelled);
    await Promise.resolve();
    expect(native.startChatSession).toHaveBeenCalledWith({ tabId: id });
    router.endSession(id);
    await rejected;
    expect(native.endSession).toHaveBeenCalledWith(id);
    expect(lookup).not.toHaveBeenCalled();
    expect(legacy.endSession).not.toHaveBeenCalled();
  });

  it('prefers native ownership to persisted identity for session controls', async () => {
    const legacy = adapter();
    const native = adapter();
    native.owns.mockReturnValue(true);
    const lookup = jest.fn(() => ({ persisted: legacyIdentity }));
    const router = new RoutingAgentAdapter({ lookup }, legacy, native, {
      servingProviderId: jest.fn(),
    });
    await router.resumeSession(id);
    await router.interruptSession(id);
    await router.setSessionModel(id, 'model');
    router.isSessionActive(id);
    router.getSessionToken(id);
    await router.listSessionModels(id);
    for (const method of [
      'resumeSession',
      'interruptSession',
      'isSessionActive',
      'getSessionToken',
      'listSessionModels',
    ] as const) {
      expect(native[method]).toHaveBeenCalledWith(id);
      expect(legacy[method]).not.toHaveBeenCalled();
    }
    expect(native.setSessionModel).toHaveBeenCalledWith(id, 'model');
    expect(legacy.setSessionModel).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('defaults new and existing legacy sessions to SDK with no override/capability', async () => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ persisted: legacyIdentity }) },
      legacy,
      native,
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
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
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
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
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
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
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
      { nativeCodex: true },
    );
    await expect(router.startChatSession({ tabId: 'tab' })).rejects.toBe(error);
    await expect(router.resumeSession(id)).rejects.toBe(error);
    expect(legacy.startChatSession).not.toHaveBeenCalled();
    expect(legacy.resumeSession).not.toHaveBeenCalled();
  });
  it.each([
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
      { servingProviderId: jest.fn().mockResolvedValue('openai-codex') },
    );
    expect(() => router.resumeSession(id)).toThrow(SessionRuntimeRoutingError);
    expect(legacy.resumeSession).not.toHaveBeenCalled();
    expect(native.resumeSession).not.toHaveBeenCalled();
  });

  it.each(['tab', 'pre-metadata-claude'])(
    'routes unknown %s to legacy',
    async (value) => {
      const sessionId = value as SessionId;
      const legacy = adapter();
      const native = adapter();
      const router = new RoutingAgentAdapter(
        { lookup: () => undefined },
        legacy,
        native,
        { servingProviderId: jest.fn() },
      );
      legacy.isSessionActive.mockReturnValue(false);
      expect(router.isSessionActive(sessionId)).toBe(false);
      await router.resumeSession(sessionId);
      expect(legacy.isSessionActive).toHaveBeenCalledWith(sessionId);
      expect(legacy.resumeSession).toHaveBeenCalledWith(sessionId);
      expect(native.isSessionActive).not.toHaveBeenCalled();
      expect(native.resumeSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    [false, 'openai-codex', false],
    [true, 'openai-codex', true],
    [true, 'anthropic', false],
    [true, undefined, false],
  ] as const)(
    'admits by capability %s and serving provider %s',
    async (nativeCodex, provider, useNative) => {
      const legacy = adapter();
      const native = adapter();
      const admission = {
        servingProviderId: jest.fn().mockResolvedValue(provider),
      };
      const router = new RoutingAgentAdapter(
        { lookup: () => undefined },
        legacy,
        native,
        admission,
        { nativeCodex },
      );
      const config = { tabId: 'tab', cwd: '/workspace' };
      await router.startChatSession(config);
      expect(
        (useNative ? native : legacy).startChatSession,
      ).toHaveBeenCalledWith(config);
      expect(
        (useNative ? legacy : native).startChatSession,
      ).not.toHaveBeenCalled();
      if (nativeCodex)
        expect(admission.servingProviderId).toHaveBeenCalledWith(config);
      else expect(admission.servingProviderId).not.toHaveBeenCalled();
    },
  );

  it('propagates admission errors without starting either runtime', async () => {
    const legacy = adapter();
    const native = adapter();
    const error = new Error('workspace lookup failed');
    const router = new RoutingAgentAdapter(
      { lookup: () => undefined },
      legacy,
      native,
      { servingProviderId: jest.fn().mockRejectedValue(error) },
      { nativeCodex: true },
    );
    await expect(router.startChatSession({ tabId: 'tab' })).rejects.toBe(error);
    expect(legacy.startChatSession).not.toHaveBeenCalled();
    expect(native.startChatSession).not.toHaveBeenCalled();
  });

  it.each([undefined, legacyIdentity, nativeIdentity])(
    'queries models using the session binding %s',
    async (identity) => {
      const legacy = adapter();
      const native = adapter();
      legacy.getSupportedModels.mockResolvedValue([]);
      native.listSessionModels.mockResolvedValue([]);
      const router = new RoutingAgentAdapter(
        { lookup: () => (identity ? { persisted: identity } : undefined) },
        legacy,
        native,
        { servingProviderId: jest.fn() },
      );
      await expect(router.listSessionModels(id)).resolves.toEqual([]);
      if (identity?.runtime === 'codex-app-server') {
        expect(native.listSessionModels).toHaveBeenCalledWith(id);
        expect(legacy.getSupportedModels).not.toHaveBeenCalled();
      } else {
        expect(legacy.getSupportedModels).toHaveBeenCalledTimes(1);
        expect(native.listSessionModels).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps global models on legacy and propagates native session model failures', async () => {
    const legacy = adapter();
    const native = adapter();
    const error = new Error('model/list failed');
    native.listSessionModels.mockRejectedValue(error);
    const router = new RoutingAgentAdapter(
      { lookup: () => ({ live: nativeIdentity }) },
      legacy,
      native,
      { servingProviderId: jest.fn() },
    );
    await expect(router.listSessionModels(id)).rejects.toBe(error);
    expect(legacy.getSupportedModels).not.toHaveBeenCalled();
    await router.getSupportedModels();
    await router.getDefaultModel();
    await router.getApiModels();
    expect(legacy.getSupportedModels).toHaveBeenCalledTimes(1);
    expect(legacy.getDefaultModel).toHaveBeenCalledTimes(1);
    expect(legacy.getApiModels).toHaveBeenCalledTimes(1);
    expect(native.getSupportedModels).not.toHaveBeenCalled();
    expect(native.getDefaultModel).not.toHaveBeenCalled();
    expect(native.getApiModels).not.toHaveBeenCalled();
  });
  it.each(['claude-sdk', 'codex-app-server'] as const)(
    'uses the prepared %s runtime when admission has no provider',
    async (runtime) => {
      const legacy = adapter();
      const native = adapter();
      const router = new RoutingAgentAdapter(
        { lookup: () => undefined }, legacy, native,
        { servingProviderId: jest.fn().mockResolvedValue(undefined) },
        { nativeCodex: true },
      );
      const config = { tabId: 'tab', runtime };
      await router.startChatSession(config);
      expect((runtime === 'claude-sdk' ? legacy : native).startChatSession).toHaveBeenCalledWith(config);
      expect((runtime === 'claude-sdk' ? native : legacy).startChatSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['claude-sdk', 'openai-codex'],
    ['codex-app-server', 'anthropic'],
  ] as const)('rejects prepared %s conflicting with %s admission', async (runtime, provider) => {
    const legacy = adapter();
    const native = adapter();
    const router = new RoutingAgentAdapter(
      { lookup: () => undefined }, legacy, native,
      { servingProviderId: jest.fn().mockResolvedValue(provider) },
      { nativeCodex: true },
    );
    await expect(router.startChatSession({ tabId: 'tab', runtime })).rejects.toMatchObject({
      name: 'ChatRuntimeAdmissionError', code: 'runtime-admission-mismatch',
    });
    expect(legacy.startChatSession).not.toHaveBeenCalled();
    expect(native.startChatSession).not.toHaveBeenCalled();
  });

});
