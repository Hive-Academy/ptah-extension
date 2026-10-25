import 'reflect-metadata';
import { container } from 'tsyringe';
import { SessionId, type IAgentAdapter } from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { registerCodexChatServices, wireAgentAdapterAliases } from './register';
import { initializeSessionRuntimeIdentityLookup } from '../wiring/session-runtime-identity-cache';
import { createCodexChatMetadataPort } from '../wiring/codex-chat-metadata-port';
import { SDK_TOKENS } from './tokens';
import { SessionMetadataStore } from '../session-metadata-store';
import { RoutingAgentAdapter } from '../codex-app-server/routing-agent-adapter';

function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}
const workspace = process.platform === 'win32' ? 'D:/workspace' : '/workspace';
const home = process.platform === 'win32' ? 'd:\\home' : '/home';

describe('Codex runtime composition', () => {
  it('keeps name equal to sessionId when the native adapter supplies a title', async () => {
    const store = new SessionMetadataStore(
      createMockStateStorage(),
      mockLogger(),
    );
    const lookup = await initializeSessionRuntimeIdentityLookup(
      store,
      mockLogger(),
    );
    const sessionId = SessionId.from('44444444-4444-4444-8444-444444444444');
    try {
      await createCodexChatMetadataPort(lookup).save(
        sessionId,
        {
          threadId: sessionId,
          contextId: 'context',
          processGeneration: 1,
          normalizedHome: process.platform === 'win32' ? 'd:\\home' : '/home',
          workspaceId:
            process.platform === 'win32' ? 'D:/workspace' : '/workspace',
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
});

describe('native adapter routing', () => {
  it('routes by persisted identity and never retries a failed native operation on legacy', async () => {
    const id = SessionId.from('33333333-3333-4333-8333-333333333333');
    const lookup = {
      lookup: () => ({
        persisted: {
          version: 1,
          sessionId: id,
          runtime: 'codex-app-server',
          providerId: 'openai-codex',
          workspaceId: workspace,
          codex: { normalizedHome: home },
        },
      }),
    };
    const scope = container.createChildContainer();
    const legacy = { resumeSession: jest.fn() };
    const native = {
      resumeSession: jest.fn().mockRejectedValue(new Error('native failed')),
    };
    scope.registerInstance(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, lookup);
    scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, legacy);
    registerCodexChatServices(scope);
    scope.registerInstance(SDK_TOKENS.CODEX_CHAT_ADAPTER, native);
    scope.registerInstance(SDK_TOKENS.RUNTIME_ADMISSION_PORT, {
      servingProviderId: async () => 'openai-codex',
    });
    wireAgentAdapterAliases(scope);
    const routed = scope.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER);
    expect(routed).toBeInstanceOf(RoutingAgentAdapter);
    await expect(routed.resumeSession(id)).rejects.toThrow('native failed');
    expect(legacy.resumeSession).not.toHaveBeenCalled();
  });
});
