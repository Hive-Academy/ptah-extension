import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { GatewayChatBridge } from './gateway-chat-bridge';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  BindingId,
  ConversationKey,
  type BindingStore,
  type GatewayBinding,
  type GatewayInboundEvent,
  type GatewayService,
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
  appendOutboundChunk = jest.fn<void, [ConversationKey, string]>();
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

function makeEvent(binding: GatewayBinding, body: string): GatewayInboundEvent {
  return {
    binding,
    message: {
      platform: binding.platform,
      externalChatId: binding.externalChatId,
      externalMsgId: 'm-1',
      body,
      conversationKey: ConversationKey.for(
        binding.platform,
        binding.externalChatId,
      ),
    },
  } as GatewayInboundEvent;
}

const SDK_UUID = '11111111-2222-4333-8444-555555555555';

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
  bindings: jest.Mocked<Pick<BindingStore, 'setPtahSessionId' | 'findById'>>;
  adapter: jest.Mocked<
    Pick<
      IAgentAdapter,
      | 'startChatSession'
      | 'resumeSession'
      | 'isSessionActive'
      | 'setSessionPermissionLevel'
    >
  >;
  workspace: jest.Mocked<Pick<IWorkspaceProvider, 'getWorkspaceRoot'>>;
}

function setup(options?: { workspaceRoot?: string | null }): Harness {
  const gateway = new FakeGateway();
  const bindings = {
    setPtahSessionId: jest.fn((id: BindingId) => makeBinding({ id })),
    findById: jest.fn(),
  } as unknown as Harness['bindings'];
  const adapter = {
    startChatSession: jest.fn(),
    resumeSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(false),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
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

  const bridge = new GatewayChatBridge(
    createLogger(),
    gateway as unknown as GatewayService,
    bindings as unknown as BindingStore,
    adapter as unknown as IAgentAdapter,
    workspace as unknown as IWorkspaceProvider,
  );
  return { bridge, gateway, bindings, adapter, workspace };
}

describe('GatewayChatBridge', () => {
  it('starts a new session for the first inbound (no ptahSessionId)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'hello agent'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.prompt).toBe('hello agent');
    expect(config.tabId).toBe(`gw-${binding.id}`);
    expect(config.projectPath).toBe('/ws/proj');
    expect(config.workspaceId).toBe('/ws/proj');
  });

  it('appends a chunk per text_delta and drains exactly once', async () => {
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

    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(key, 'foo');
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(key, 'bar');
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(2);
    expect(h.gateway.drainOutbound).toHaveBeenCalledTimes(1);
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
  });

  it('persists the first non-tabId sessionId exactly once', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.bindings.setPtahSessionId).toHaveBeenCalledTimes(1);
    expect(h.bindings.setPtahSessionId).toHaveBeenCalledWith(
      binding.id,
      SDK_UUID,
    );
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

  it('resumes an active persisted session instead of starting new', async () => {
    const h = setup();
    const binding = makeBinding({
      workspaceRoot: '/ws/proj',
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
    h.gateway.emit('inbound', makeEvent(binding, 'again'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    const [sid, cfg] = h.adapter.resumeSession.mock.calls[0];
    expect(sid).toBe(SDK_UUID);
    expect(cfg?.prompt).toBe('again');
  });

  it('resumes a non-active persisted id; falls back to startChatSession on resume error', async () => {
    const h = setup();
    const binding = makeBinding({
      workspaceRoot: '/ws/proj',
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
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.resumeSession).toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to startChatSession when a resumed stream produces zero events', async () => {
    const h = setup();
    const binding = makeBinding({
      workspaceRoot: '/ws/proj',
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
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
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
    expect(h.gateway.appendOutboundChunk.mock.calls[0][0]).toBe(key);
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
