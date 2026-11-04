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
import { CodexRuntimeCompositionError } from '../wiring/codex-runtime-composition-error';
import { SessionMetadataStore } from '../session-metadata-store';
import { RoutingAgentAdapter } from '../codex-app-server/routing-agent-adapter';
import {
  CodexChatAdapter,
  type CodexChatAdapterPorts,
} from '../codex-app-server/codex-chat-adapter';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';

function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}
const workspace = process.platform === 'win32' ? 'D:/workspace' : '/workspace';
const home = process.platform === 'win32' ? 'd:\\home' : '/home';

describe('Codex runtime composition', () => {
  it('passes host checkpoint read and write through the registered adapter', async () => {
    const scope = container.createChildContainer();
    const sessionId = SessionId.from('55555555-5555-4555-8555-555555555555');
    const readUsage = jest.fn(async () => ({ messageCount: 3 }));
    const persistUsage = jest.fn(async () => undefined);
    const metadata = {
      save: jest.fn(async () => undefined),
      readUsage,
      persistUsage,
    };
    scope.registerInstance(TOKENS.LOGGER, mockLogger());
    scope.registerInstance(SDK_TOKENS.SDK_PERMISSION_HANDLER, {});
    scope.registerInstance(
      SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
      new SessionTurnStateRegistry(),
    );
    scope.registerInstance(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, {
      updateCodexExecution: jest.fn(async () => undefined),
      incrementCodexMessageCount: jest.fn(async () => undefined),
    });
    const unused = (): never => {
      throw new Error('Unexpected call to an unused Codex adapter port');
    };
    const ports: CodexChatAdapterPorts = {
      driver: { admit: jest.fn(async () => ({ release: jest.fn() })) },
      logger: mockLogger(),
      info: {
        id: 'ptah-cli',
        name: 'Codex',
        vendor: 'OpenAI',
        version: '1',
        description: 'Native chat',
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
      checkOptions: unused,
      profile: unused,
      createScope: unused,
      metadata,
      approvals: {
        register: unused,
        respond: unused,
        cancelPrompt: unused,
      },
      presentation: {
        present: unused,
        dismiss: unused,
        cancelPrompt: unused,
      },
      replacement: {
        validateReplacement: unused,
        failed: unused,
      },
      callbacks: unused,
      publish: unused,
    };
    scope.registerInstance(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, ports);
    registerCodexChatServices(scope);
    const adapter = scope.resolve<CodexChatAdapter>(
      SDK_TOKENS.CODEX_CHAT_ADAPTER,
    );
    expect(adapter).toBeInstanceOf(CodexChatAdapter);
    expect(adapter).toHaveProperty('ports.metadata.readUsage', readUsage);
    expect(adapter).toHaveProperty('ports.metadata.persistUsage', persistUsage);
    const registeredPorts: unknown = Reflect.get(adapter, 'ports');
    if (
      !registeredPorts ||
      typeof registeredPorts !== 'object' ||
      !('metadata' in registeredPorts)
    ) {
      throw new Error('Registered adapter has no metadata port');
    }
    const wired: unknown = registeredPorts.metadata;
    if (
      !wired ||
      typeof wired !== 'object' ||
      !('readUsage' in wired) ||
      typeof wired.readUsage !== 'function' ||
      !('persistUsage' in wired) ||
      typeof wired.persistUsage !== 'function'
    ) {
      throw new Error('Registered adapter has no usage persistence');
    }
    await wired.readUsage(sessionId);
    await wired.persistUsage(sessionId, {});
    expect(readUsage).toHaveBeenCalledWith(sessionId);
    expect(persistUsage).toHaveBeenCalledWith(sessionId, {});
  });

  it('persists the native adapter title through the initialized lookup', async () => {
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
      expect((await store.get(sessionId))?.name).toBe('Requested native title');
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

  it.each([
    SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
    SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
  ])(
    'rejects %s without admission before resolving either adapter alias',
    (token) => {
      const scope = container.createChildContainer();
      scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, {});
      registerCodexChatServices(scope);
      scope.registerInstance(token, {});
      wireAgentAdapterAliases(scope);
      for (const alias of [
        TOKENS.AGENT_ADAPTER,
        SDK_TOKENS.ROUTING_AGENT_ADAPTER,
      ]) {
        expect(() => scope.resolve(alias)).toThrow(
          CodexRuntimeCompositionError,
        );
        expect(() => scope.resolve(alias)).toThrow(
          expect.objectContaining({
            code: 'partial-native-binding',
            message: expect.stringContaining('RUNTIME_ADMISSION_PORT'),
          }),
        );
      }
    },
  );

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
      owns: (_sessionId: SessionId): boolean => false,
      canSendFollowUp: (_sessionId: SessionId): boolean => false,
      listSessionModels: async (_sessionId: SessionId) => [],
      resumeSession: jest.fn().mockRejectedValue(new Error('native failed')),
    };
    scope.registerInstance(SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP, lookup);
    scope.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, legacy);
    registerCodexChatServices(scope);
    scope.registerInstance(SDK_TOKENS.CODEX_CHAT_ADAPTER, native);
    scope.registerInstance(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {});
    scope.registerInstance(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, {
      nativeCodex: true,
    });
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
