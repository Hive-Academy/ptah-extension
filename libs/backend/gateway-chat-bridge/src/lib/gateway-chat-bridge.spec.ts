import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { GatewayChatBridge } from './gateway-chat-bridge';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  BindingId,
  ConversationKey,
  type ConversationStore,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
  type GatewayInboundEvent,
  type GatewayService,
  type OutboundRoute,
} from '@ptah-extension/messaging-gateway';
import type {
  FlatStreamEventUnion,
  IAgentAdapter,
} from '@ptah-extension/shared';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

class FakeGateway extends EventEmitter {
  appendOutboundChunk = jest.fn<void, [OutboundRoute, string]>();
  drainOutbound = jest.fn<Promise<void>, [ConversationKey]>(async () => {
    /* no-op */
  });
}

function makeBinding(
  overrides: Partial<GatewayBinding> & {
    id?: string;
    platform?: GatewayBinding['platform'];
    externalChatId?: string;
  } = {},
): GatewayBinding {
  return {
    id: BindingId.create(overrides.id ?? 'binding-1'),
    platform: overrides.platform ?? 'telegram',
    externalChatId: overrides.externalChatId ?? 'chat-1',
    allowListId: null,
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: overrides.ptahSessionId ?? null,
    workspaceRoot:
      overrides.workspaceRoot === undefined ? null : overrides.workspaceRoot,
    pairingCode: null,
    createdAt: 1,
    approvedAt: 1,
    lastActiveAt: 1,
  };
}

function makeConversation(
  binding: GatewayBinding,
  overrides: Partial<Omit<GatewayConversation, 'id'>> & { id?: string } = {},
): GatewayConversation {
  return {
    id: (overrides.id ?? 'conv-1') as GatewayConversationId,
    bindingId: binding.id,
    externalConversationId: overrides.externalConversationId ?? 'default',
    ptahSessionId: overrides.ptahSessionId ?? null,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeEvent(
  binding: GatewayBinding,
  body: string,
  opts: { conversation?: GatewayConversation; conversationId?: string } = {},
): GatewayInboundEvent {
  const conversation = opts.conversation ?? makeConversation(binding);
  return {
    binding,
    conversation,
    message: {
      platform: binding.platform,
      externalChatId: binding.externalChatId,
      externalMsgId: 'm-1',
      body,
      conversationId: opts.conversationId,
      conversationKey: ConversationKey.for(
        binding.platform,
        binding.externalChatId,
        opts.conversationId,
      ),
    },
  } as GatewayInboundEvent;
}

const SDK_UUID = '11111111-2222-4333-8444-555555555555';
const SDK_UUID_B = '99999999-8888-4777-8666-555555555555';

function textDelta(sessionId: string, delta: string): FlatStreamEventUnion {
  return {
    id: `t-${delta}`,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId,
    messageId: 'msg-1',
    delta,
    blockIndex: 0,
  } as FlatStreamEventUnion;
}

function messageComplete(sessionId: string): FlatStreamEventUnion {
  return {
    id: 'c-1',
    eventType: 'message_complete',
    timestamp: 2,
    sessionId,
    messageId: 'msg-1',
  } as FlatStreamEventUnion;
}

async function scriptedStream(
  events: FlatStreamEventUnion[],
): Promise<AsyncIterable<FlatStreamEventUnion>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        yield e;
      }
    },
  };
}

function gatedStream(
  gate: Promise<void>,
  events: FlatStreamEventUnion[],
): AsyncIterable<FlatStreamEventUnion> {
  return {
    async *[Symbol.asyncIterator]() {
      await gate;
      for (const e of events) {
        yield e;
      }
    },
  };
}

async function flushUntil(
  predicate: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Harness {
  bridge: GatewayChatBridge;
  gateway: FakeGateway;
  conversations: jest.Mocked<Pick<ConversationStore, 'setPtahSessionId'>>;
  adapter: jest.Mocked<
    Pick<
      IAgentAdapter,
      | 'startChatSession'
      | 'resumeSession'
      | 'isSessionActive'
      | 'setSessionPermissionLevel'
      | 'endSession'
    >
  >;
  workspace: jest.Mocked<Pick<IWorkspaceProvider, 'getWorkspaceRoot'>>;
  selectedModelGet: jest.Mock<string, []>;
}

function setup(options?: {
  workspaceRoot?: string | null;
  selectedModel?: string;
}): Harness {
  const gateway = new FakeGateway();
  const conversations = {
    setPtahSessionId: jest.fn(),
  } as unknown as Harness['conversations'];
  const adapter = {
    startChatSession: jest.fn(),
    resumeSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(false),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
  } as unknown as Harness['adapter'];
  const workspace = {
    getWorkspaceRoot: jest
      .fn()
      .mockReturnValue(
        options?.workspaceRoot === undefined
          ? '/ws/global'
          : options.workspaceRoot,
      ),
  } as unknown as Harness['workspace'];
  const selectedModelGet = jest
    .fn<string, []>()
    .mockReturnValue(options?.selectedModel ?? '');
  const modelSettings = {
    selectedModel: { get: selectedModelGet },
  };

  const bridge = new GatewayChatBridge(
    createLogger(),
    gateway as unknown as GatewayService,
    conversations as unknown as ConversationStore,
    adapter as unknown as IAgentAdapter,
    workspace as unknown as IWorkspaceProvider,
    modelSettings as unknown as ConstructorParameters<
      typeof GatewayChatBridge
    >[5],
  );
  return {
    bridge,
    gateway,
    conversations,
    adapter,
    workspace,
    selectedModelGet,
  };
}

describe('GatewayChatBridge', () => {
  it('starts a new session keyed on the conversation row id (gw-<conversationId>)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-42' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hello agent', { conversation }),
    );
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.prompt).toBe('hello agent');
    expect(config.tabId).toBe('gw-conv-42');
    expect(config.projectPath).toBe('/ws/proj');
    expect(config.workspaceId).toBe('/ws/proj');
  });

  it('appends a route-bearing chunk per text_delta and drains exactly once', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'foo'),
        textDelta(SDK_UUID, 'bar'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    const expectedRoute = {
      conversationKey: key,
      platform: binding.platform,
      externalChatId: binding.externalChatId,
    };
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expectedRoute,
      'foo',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expectedRoute,
      'bar',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(2);
    expect(h.gateway.drainOutbound).toHaveBeenCalledTimes(1);
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
  });

  it('includes conversationId in the outbound route for threaded inbound', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const conversation = makeConversation(binding, {
      id: 'conv-thread',
      externalConversationId: 'thread-9',
    });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'reply'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'go', { conversation, conversationId: 'thread-9' }),
    );
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    const key = ConversationKey.for(
      binding.platform,
      binding.externalChatId,
      'thread-9',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      {
        conversationKey: key,
        platform: 'discord',
        externalChatId: binding.externalChatId,
        conversationId: 'thread-9',
      },
      'reply',
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
  });

  it('persists the first non-tabId sessionId to the conversation row exactly once', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-7' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.conversations.setPtahSessionId).toHaveBeenCalledTimes(1);
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      conversation.id,
      SDK_UUID,
    );
  });

  it('ends the SDK session after the turn drains so the next message resumes cleanly', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);
    await flushUntil(() => h.adapter.endSession.mock.calls.length > 0);

    expect(h.adapter.endSession).toHaveBeenCalledWith(SDK_UUID);
  });

  it('auto-approves by setting bypass permission for the resolved session', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.setSessionPermissionLevel).toHaveBeenCalledWith(
      SDK_UUID,
      'bypassPermissions',
    );
  });

  it('resumes an active persisted session from conversation.ptahSessionId', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'r'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'again', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    const [sid, cfg] = h.adapter.resumeSession.mock.calls[0];
    expect(sid).toBe(SDK_UUID);
    expect(cfg?.prompt).toBe('again');
  });

  it('passes the user-selected model (not a hardcoded default) to new + resumed sessions', async () => {
    const h = setup({ selectedModel: 'gpt-5-codex' });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const fresh = makeConversation(binding, { ptahSessionId: null });
    const resumable = makeConversation(binding, { ptahSessionId: SDK_UUID });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        messageComplete(SDK_UUID),
      ]),
    );
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'first', { conversation: fresh }),
    );
    await flushUntil(() => h.adapter.startChatSession.mock.calls.length > 0);
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'again', { conversation: resumable }),
    );
    await flushUntil(() => h.adapter.resumeSession.mock.calls.length > 0);

    expect(h.adapter.startChatSession.mock.calls[0][0].model).toBe(
      'gpt-5-codex',
    );
    expect(h.adapter.resumeSession.mock.calls[0][1]?.model).toBe('gpt-5-codex');
  });

  it('ignores a stale binding.ptahSessionId when the conversation row has none', async () => {
    const h = setup();
    const binding = makeBinding({
      workspaceRoot: '/ws/proj',
      ptahSessionId: SDK_UUID,
    });
    const conversation = makeConversation(binding, { ptahSessionId: null });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID_B, 'fresh'),
        messageComplete(SDK_UUID_B),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('runs two conversations on one binding concurrently without prompt bleed', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const convA = makeConversation(binding, {
      id: 'conv-a',
      externalConversationId: 'thread-a',
    });
    const convB = makeConversation(binding, {
      id: 'conv-b',
      externalConversationId: 'thread-b',
    });
    const release: Record<string, () => void> = {};
    h.adapter.startChatSession.mockImplementation(async (config) => {
      const gate = new Promise<void>((r) => {
        release[config.tabId] = r;
      });
      const uuid = config.tabId === 'gw-conv-a' ? SDK_UUID : SDK_UUID_B;
      const delta = config.tabId === 'gw-conv-a' ? 'answer-a' : 'answer-b';
      return gatedStream(gate, [textDelta(uuid, delta), messageComplete(uuid)]);
    });

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'prompt A', {
        conversation: convA,
        conversationId: 'thread-a',
      }),
    );
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'prompt B', {
        conversation: convB,
        conversationId: 'thread-b',
      }),
    );
    await flushUntil(() => h.adapter.startChatSession.mock.calls.length === 2);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(2);
    const byTab = new Map(
      h.adapter.startChatSession.mock.calls.map(([cfg]) => [cfg.tabId, cfg]),
    );
    expect(byTab.get('gw-conv-a')?.prompt).toBe('prompt A');
    expect(byTab.get('gw-conv-b')?.prompt).toBe('prompt B');

    release['gw-conv-a']();
    release['gw-conv-b']();
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length === 2);

    const keyA = ConversationKey.for(
      'discord',
      binding.externalChatId,
      'thread-a',
    );
    const keyB = ConversationKey.for(
      'discord',
      binding.externalChatId,
      'thread-b',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: keyA,
        conversationId: 'thread-a',
      }),
      'answer-a',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: keyB,
        conversationId: 'thread-b',
      }),
      'answer-b',
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(keyA);
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(keyB);
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      convA.id,
      SDK_UUID,
    );
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      convB.id,
      SDK_UUID_B,
    );
  });

  it('serializes turns for the same conversation key', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const conversation = makeConversation(binding, {
      id: 'conv-a',
      externalConversationId: 'thread-a',
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let calls = 0;
    h.adapter.startChatSession.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return gatedStream(firstGate, [
          textDelta(SDK_UUID, 'one'),
          messageComplete(SDK_UUID),
        ]);
      }
      return scriptedStream([
        textDelta(SDK_UUID_B, 'two'),
        messageComplete(SDK_UUID_B),
      ]);
    });

    h.bridge.start();
    const event = (body: string): GatewayInboundEvent =>
      makeEvent(binding, body, { conversation, conversationId: 'thread-a' });
    h.gateway.emit('inbound', event('first'));
    h.gateway.emit('inbound', event('second'));
    await flushUntil(() => false, 5);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length === 2);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(2);
    expect(h.adapter.startChatSession.mock.calls[0][0].prompt).toBe('first');
    expect(h.adapter.startChatSession.mock.calls[1][0].prompt).toBe('second');
  });

  it('resumes a persisted conversation session on a fresh bridge after restart', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      id: 'conv-restored',
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(false);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'restored'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.resumeSession.mock.calls[0][0]).toBe(SDK_UUID);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
  });

  it('resumes a non-active persisted id; falls back to startChatSession on resume error', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(false);
    h.adapter.resumeSession.mockRejectedValue(new Error('no such session'));
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'fresh'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to startChatSession when a resumed stream produces zero events', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(await scriptedStream([]));
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'recovered'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('sends an error reply and never starts a session when no workspace is resolvable', async () => {
    const h = setup({ workspaceRoot: null });
    const binding = makeBinding({ workspaceRoot: null });

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk.mock.calls[0][0].conversationKey).toBe(
      key,
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
  });

  it('drains and sends an error message when the adapter throws mid-stream', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield textDelta(SDK_UUID, 'partial');
        throw new Error('mid-stream boom');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    await expect(
      (async () => {
        h.gateway.emit('inbound', makeEvent(binding, 'go'));
        await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);
      })(),
    ).resolves.toBeUndefined();

    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    expect(
      h.gateway.appendOutboundChunk.mock.calls.some(
        ([, msg]) => typeof msg === 'string' && msg.length > 0,
      ),
    ).toBe(true);
  });

  it('stop() removes the listener so no further turns run', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.bridge.stop();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => false, 5);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
  });
});
