import 'reflect-metadata';
import { container } from 'tsyringe';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  createCodexChatMetadataPort,
  registerCodexChatServices,
  wireAgentAdapterAliases,
  initializeSessionRuntimeIdentityLookup,
} from './register';
import { SDK_TOKENS } from './tokens';
import { SessionMetadataStore } from '../session-metadata-store';
import type { SessionMetadata } from '../session-metadata-store';
import type { SessionRuntimeIdentity } from '@ptah-extension/shared';
import { RoutingAgentAdapter } from '../codex-app-server/routing-agent-adapter';

describe('Codex runtime composition', () => {
  it('keeps name equal to sessionId when the native adapter supplies a title', async () => {
    const store = new SessionMetadataStore(
      createMockStateStorage(),
      createMockLogger() as unknown as Logger,
    );
    const lookup = await initializeSessionRuntimeIdentityLookup(store);
    const sessionId = SessionId.from('44444444-4444-4444-8444-444444444444');
    try {
      await createCodexChatMetadataPort(lookup).save(
        sessionId,
        {
          threadId: sessionId,
          contextId: 'context',
          processGeneration: 1,
          normalizedHome: process.platform === 'win32' ? 'd:\\home' : '/home',
          workspaceId: process.platform === 'win32' ? 'D:/workspace' : '/workspace',
          providerId: 'openai-codex',
          profileFingerprint: 'profile',
        },
        'Requested native title',
      );
      expect((await store.get(sessionId))?.name).toBe(sessionId);
      expect(lookup.lookup(sessionId)?.persisted?.runtime).toBe(
        'codex-app-server',
      );
    } finally {
      lookup.dispose();
    }
  });

  it('keeps the exact SDK adapter with default host bindings', () => {
    const scope = container.createChildContainer();
    const legacy = { initialize: jest.fn() };
    scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, legacy);
    registerCodexChatServices(scope);
    wireAgentAdapterAliases(scope);
    expect(scope.resolve(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES)).toEqual({
      nativeCodex: false,
    });
    expect(scope.resolve(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS)).toBeNull();
    expect(scope.resolve(SDK_TOKENS.CODEX_CHAT_ADAPTER)).toBeNull();
    expect(
      scope.resolve(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP),
    ).toBeNull();
    expect(scope.resolve(SDK_TOKENS.LEGACY_SESSION_CONTROLS)).toBeNull();
    expect(scope.resolve(SDK_TOKENS.SESSION_RUNTIME_ROUTER)).toBeNull();
    expect(scope.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER)).toBe(legacy);
  });

  it('preserves host capability bindings inherited from a parent', () => {
    const parent = container.createChildContainer();
    const capabilities = { nativeCodex: true };
    parent.registerInstance(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, capabilities);
    const scope = parent.createChildContainer();
    registerCodexChatServices(scope);
    expect(scope.resolve(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES)).toBe(
      capabilities,
    );
  });

  it('maps native identity through the sole metadata writer and rejects mismatched IDs', async () => {
    const updateCodexExecution = jest
      .fn<
        ReturnType<SessionMetadataStore['updateCodexExecution']>,
        Parameters<SessionMetadataStore['updateCodexExecution']>
      >()
      .mockResolvedValue(undefined);
    const port = createCodexChatMetadataPort({ updateCodexExecution });
    const sessionId = SessionId.from('33333333-3333-4333-8333-333333333333');
    const identity = {
      threadId: sessionId,
      contextId: 'context',
      processGeneration: 1,
      normalizedHome: '/home',
      workspaceId: '/workspace',
      providerId: 'openai-codex',
      profileFingerprint: 'profile',
    };
    await port.save(sessionId, identity);
    expect(updateCodexExecution).toHaveBeenCalledTimes(1);
    expect(updateCodexExecution.mock.calls[0][1](undefined)).toEqual({
      version: 1,
      sessionId,
      runtime: 'codex-app-server',
      providerId: 'openai-codex',
      workspaceId: '/workspace',
      codex: { normalizedHome: '/home' },
    });
    await expect(
      port.save(sessionId, { ...identity, threadId: 'other' }),
    ).rejects.toThrow('Codex session/thread identity mismatch');
    expect(updateCodexExecution).toHaveBeenCalledTimes(1);
  });
});

describe('persisted runtime identity cache', () => {
  const id = SessionId.from('33333333-3333-4333-8333-333333333333');
  const identity: Extract<
    SessionRuntimeIdentity,
    { runtime: 'codex-app-server' }
  > = {
    version: 1,
    sessionId: id,
    runtime: 'codex-app-server',
    providerId: 'openai-codex',
    workspaceId: 'D:/workspace',
    codex: { normalizedHome: 'd:/home' },
  };
  const row = (providerId = 'openai-codex'): SessionMetadata => ({
    sessionId: id,
    name: 'session',
    providerId,
    workspaceId: 'D:/workspace',
    createdAt: 1,
    lastActiveAt: 1,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    codexExecution: { ...identity, providerId },
  });
  function fixture(rows: SessionMetadata[] = [row()]) {
    let listener: Parameters<SessionMetadataStore['onMetadataChanged']>[0];
    const unsubscribe = jest.fn();
    const get = jest
      .fn<Promise<SessionMetadata | null>, [string]>()
      .mockResolvedValue(row());
    const store = {
      getAll: jest.fn().mockResolvedValue(rows),
      get,
      onMetadataChanged: (callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      },
      updateCodexExecution: jest.fn(
        async (
          _id: string,
          updater: Parameters<SessionMetadataStore['updateCodexExecution']>[1],
        ) => {
          updater(undefined);
        },
      ),
    };
    return {
      store,
      unsubscribe,
      emit: (kind: 'updated' | 'deleted' = 'updated') =>
        listener({ sessionId: id, workspaceId: 'D:/workspace', kind }),
    };
  }
  const drain = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('preloads persisted identities and disposes its subscription', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store);
    expect(lookup.lookup(id)?.persisted).toEqual(identity);
    lookup.dispose();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(lookup.lookup(id)).toBeUndefined();
  });

  it('writes through before metadata.save resolves and supersedes older event reads', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store);
    let resolveRead!: (value: SessionMetadata | null) => void;
    f.store.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    f.emit();
    await createCodexChatMetadataPort(lookup).save(id, {
      threadId: id,
      contextId: 'context',
      processGeneration: 1,
      providerId: identity.providerId,
      normalizedHome: identity.codex.normalizedHome,
      workspaceId: identity.workspaceId,
      profileFingerprint: 'profile',
    });
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('openai-codex');
    resolveRead(row('stale'));
    await drain();
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('openai-codex');
    lookup.dispose();
  });

  it('ignores an out-of-order change event response', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store);
    let first!: (value: SessionMetadata | null) => void;
    let second!: (value: SessionMetadata | null) => void;
    f.store.get
      .mockReturnValueOnce(
        new Promise((resolve) => {
          first = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          second = resolve;
        }),
      );
    f.emit();
    f.emit();
    second(row('newer'));
    await drain();
    first(row('older'));
    await drain();
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('newer');
    lookup.dispose();
  });

  it('release and deletion remove entries without resurrection by pending reads', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store);
    let resolveRead!: (value: SessionMetadata | null) => void;
    f.store.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    f.emit();
    lookup.releaseSession(id);
    resolveRead(row());
    await drain();
    expect(lookup.lookup(id)).toBeUndefined();
    f.emit();
    await drain();
    expect(lookup.lookup(id)).toBeDefined();
    f.emit('deleted');
    expect(lookup.lookup(id)).toBeUndefined();
    lookup.dispose();
  });

  it('routes by persisted identity and never retries a failed native operation on legacy', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store);
    const scope = container.createChildContainer();
    const legacy = { resumeSession: jest.fn() };
    const native = {
      resumeSession: jest.fn().mockRejectedValue(new Error('native failed')),
    };
    scope.registerInstance(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, lookup);
    scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, legacy);
    registerCodexChatServices(scope);
    scope.registerInstance(SDK_TOKENS.CODEX_CHAT_ADAPTER, native);
    wireAgentAdapterAliases(scope);
    const routed = scope.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER);
    expect(routed).toBeInstanceOf(RoutingAgentAdapter);
    await expect(routed.resumeSession(id)).rejects.toThrow('native failed');
    expect(legacy.resumeSession).not.toHaveBeenCalled();
    lookup.dispose();
  });
});
