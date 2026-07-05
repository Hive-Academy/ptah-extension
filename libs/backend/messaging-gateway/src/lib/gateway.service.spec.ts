import 'reflect-metadata';

import { GatewayService, type GatewayInboundEvent } from './gateway.service';
import {
  BindingId,
  ConversationKey,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
  type GatewayPlatform,
} from './types';
import { AttachedSessionRegistry } from './attached-session-registry';
import type { ISessionResumabilityChecker } from './session-resumability';
import type { BindingStore } from './binding.store';
import type { ConversationStore } from './conversation.store';
import type { MessageStore } from './message.store';
import type { ITokenVault } from './token-vault.interface';
import type { OutboundRoute } from './stream-coalescer';
import type { GrammyTelegramAdapter } from './adapters/telegram/grammy.adapter';
import type { DiscordAdapter } from './adapters/discord/discord.adapter';
import type { BoltSlackAdapter } from './adapters/slack/bolt.adapter';
import type { FfmpegDecoder } from './voice/ffmpeg-decoder';
import type { WhisperTranscriber } from './voice/whisper-transcriber';
import type {
  IMessagingAdapter,
  InboundMessage,
  SendResult,
} from './adapters/adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewaySettings } from '@ptah-extension/settings-core';

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function createLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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

interface SuiteCiphers {
  telegram?: string;
  discord?: string;
  slackBot?: string;
  slackApp?: string;
}

function createMockGatewaySettings(
  ciphers?: SuiteCiphers,
): jest.Mocked<GatewaySettings> {
  const handle = (value: string) => ({
    get: jest.fn().mockResolvedValue(value),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  });
  return {
    telegramTokenCipher: handle(ciphers?.telegram ?? ''),
    discordTokenCipher: handle(ciphers?.discord ?? ''),
    slackBotTokenCipher: handle(ciphers?.slackBot ?? ''),
    slackAppTokenCipher: handle(ciphers?.slackApp ?? ''),
  } as unknown as jest.Mocked<GatewaySettings>;
}

interface FakeWorkspace {
  provider: IWorkspaceProvider;
  settings: Map<string, unknown>;
  getConfiguration: jest.Mock;
  setConfiguration: jest.Mock;
}

function createWorkspace(initial?: Record<string, unknown>): FakeWorkspace {
  const settings = new Map<string, unknown>(Object.entries(initial ?? {}));
  const getConfiguration = jest.fn(
    (_section: string, key: string, defaultValue?: unknown) =>
      settings.has(key) ? settings.get(key) : defaultValue,
  );
  const setConfiguration = jest.fn(
    async (_section: string, key: string, value: unknown) => {
      settings.set(key, value);
    },
  );
  return {
    provider: {
      getConfiguration,
      setConfiguration,
    } as unknown as IWorkspaceProvider,
    settings,
    getConfiguration,
    setConfiguration,
  };
}

function createBindingStore(): jest.Mocked<BindingStore> {
  return {
    findById: jest.fn(),
    findByExternal: jest.fn(),
    list: jest.fn(),
    upsertPending: jest.fn(),
    approve: jest.fn(),
    setWorkspaceRoot: jest.fn(),
    setStatus: jest.fn(),
    touch: jest.fn(),
  } as unknown as jest.Mocked<BindingStore>;
}

function createConversationStore(): jest.Mocked<ConversationStore> {
  return {
    findById: jest.fn(),
    findByExternal: jest.fn(),
    listByBinding: jest.fn().mockReturnValue([]),
    resolveOrCreate: jest.fn(),
    resolveOrAdopt: jest.fn(),
    setPtahSessionId: jest.fn(),
    clearPtahSessionId: jest.fn(),
    touch: jest.fn(),
    deleteByBinding: jest.fn(),
  } as unknown as jest.Mocked<ConversationStore>;
}

function createMessageStore(): jest.Mocked<MessageStore> {
  return {
    insert: jest.fn(),
    list: jest.fn(),
    listVoicePathsOlderThan: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<MessageStore>;
}

function createAdapter(
  platform: GatewayPlatform,
): jest.Mocked<IMessagingAdapter> {
  return {
    platform,
    ...(platform === 'discord' ? { maxMessageChars: 2000 } : {}),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: jest.fn().mockReturnValue(true),
    sendMessage: jest
      .fn()
      .mockResolvedValue({ externalMsgId: 'msg-1' } as SendResult),
    editMessage: jest.fn(),
    on: jest.fn(),
  } as unknown as jest.Mocked<IMessagingAdapter>;
}

function makeBinding(
  overrides: Partial<Omit<GatewayBinding, 'id'>> & {
    platform: GatewayBinding['platform'];
    externalChatId: string;
    id?: string;
  },
): GatewayBinding {
  const { id: rawId, ...rest } = overrides;
  return {
    id: BindingId.create(rawId ?? 'binding-1'),
    allowListId: null,
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: null,
    workspaceRoot: null,
    pairingCode: null,
    createdAt: 0,
    approvedAt: 0,
    lastActiveAt: null,
    ...rest,
  };
}

function makeConversation(
  overrides?: Partial<GatewayConversation>,
): GatewayConversation {
  return {
    id: 'conv-1' as GatewayConversationId,
    bindingId: BindingId.create('binding-1'),
    externalConversationId: 'default',
    ptahSessionId: null,
    createdAt: 0,
    lastActiveAt: null,
    ...overrides,
  };
}

function makeInbound(
  overrides: Partial<InboundMessage> & {
    platform: GatewayPlatform;
    externalChatId: string;
  },
): InboundMessage {
  return {
    externalMsgId: 'in-1',
    body: 'hello',
    conversationKey: ConversationKey.for(
      overrides.platform,
      overrides.externalChatId,
      overrides.conversationId,
    ),
    ...overrides,
  };
}

async function dispatchInbound(
  service: GatewayService,
  msg: InboundMessage,
): Promise<void> {
  await (
    service as unknown as {
      handleInbound(m: InboundMessage): Promise<void>;
    }
  ).handleInbound(msg);
}

interface Suite {
  service: GatewayService;
  logger: FakeLogger;
  workspace: FakeWorkspace;
  bindings: jest.Mocked<BindingStore>;
  conversations: jest.Mocked<ConversationStore>;
  messages: jest.Mocked<MessageStore>;
  vault: { encrypt: jest.Mock; decrypt: jest.Mock };
  telegramAdapter: jest.Mocked<IMessagingAdapter>;
  discordAdapter: jest.Mocked<IMessagingAdapter>;
  attachedSessionRegistry: AttachedSessionRegistry;
  resumability: { isResumable: jest.Mock };
  events: GatewayInboundEvent[];
}

interface SuiteOptions {
  settings?: Record<string, unknown>;
  ciphers?: SuiteCiphers;
}

function buildSuite(options?: SuiteOptions): Suite {
  const logger = createLogger();
  const workspace = createWorkspace(options?.settings);
  const vault = { encrypt: jest.fn(), decrypt: jest.fn() };
  const bindings = createBindingStore();
  const conversations = createConversationStore();
  const messages = createMessageStore();
  const telegramAdapter = createAdapter('telegram');
  const discordAdapter = createAdapter('discord');

  const placeholderTelegram = {} as unknown as GrammyTelegramAdapter;
  const placeholderDiscord = {} as unknown as DiscordAdapter;
  const placeholderSlack = {} as unknown as BoltSlackAdapter;
  const ffmpeg = {} as unknown as FfmpegDecoder;
  const whisper = {
    configure: jest.fn(),
    on: jest.fn(),
  } as unknown as WhisperTranscriber;

  const attachedSessionRegistry = new AttachedSessionRegistry();
  const resumability = {
    isResumable: jest.fn().mockResolvedValue(true),
  };

  const service = new GatewayService(
    logger as unknown as Logger,
    workspace.provider,
    vault as unknown as ITokenVault,
    bindings,
    conversations,
    messages,
    placeholderTelegram,
    placeholderDiscord,
    placeholderSlack,
    ffmpeg,
    whisper,
    createMockGatewaySettings(options?.ciphers),
    attachedSessionRegistry,
    resumability,
  );
  service.configureForTest({
    telegram: telegramAdapter,
    discord: discordAdapter,
  });

  const events: GatewayInboundEvent[] = [];
  service.on('inbound', (event: GatewayInboundEvent) => events.push(event));

  return {
    service,
    logger,
    workspace,
    bindings,
    conversations,
    messages,
    vault,
    telegramAdapter,
    discordAdapter,
    attachedSessionRegistry,
    resumability,
    events,
  };
}

describe('GatewayService.sendTest', () => {
  it('returns no-approved-binding when no approved binding exists', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([]);

    const result = await service.sendTest({ platform: 'telegram' });

    expect(result).toEqual({ ok: false, error: 'no-approved-binding' });
    expect(bindings.list).toHaveBeenCalledWith({
      platform: 'telegram',
      status: 'approved',
    });
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('routes the canned message through adapter.sendMessage and persists outbound', async () => {
    const { service, bindings, messages, telegramAdapter } = buildSuite();
    const binding = makeBinding({
      platform: 'telegram',
      externalChatId: 'chat-42',
      id: 'binding-7',
    });
    bindings.list.mockReturnValue([binding]);

    const result = await service.sendTest({ platform: 'telegram' });

    expect(telegramAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramAdapter.sendMessage).toHaveBeenCalledWith(
      'chat-42',
      'Ptah test message — gateway is wired up correctly.',
    );
    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: binding.id,
        direction: 'outbound',
        externalMsgId: 'msg-1',
      }),
    );
    expect(bindings.touch).toHaveBeenCalledWith(binding.id);
    expect(result).toEqual({
      ok: true,
      bindingId: 'binding-7',
      externalMsgId: 'msg-1',
    });
  });

  it('returns binding-not-approved when bindingId does not match an approved binding', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([
      makeBinding({
        platform: 'telegram',
        externalChatId: 'chat-1',
        id: 'binding-A',
      }),
    ]);

    const result = await service.sendTest({
      platform: 'telegram',
      bindingId: BindingId.create('binding-Z'),
    });

    expect(result).toEqual({ ok: false, error: 'binding-not-approved' });
    expect(telegramAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('returns adapter-not-running when the platform has no adapter configured', async () => {
    const { service } = buildSuite();

    const result = await service.sendTest({ platform: 'slack' });

    expect(result).toEqual({ ok: false, error: 'adapter-not-running' });
  });

  it('surfaces adapter errors as { ok: false, error } without throwing', async () => {
    const { service, bindings, telegramAdapter } = buildSuite();
    bindings.list.mockReturnValue([
      makeBinding({ platform: 'telegram', externalChatId: 'chat-1' }),
    ]);
    telegramAdapter.sendMessage.mockRejectedValue(new Error('rate-limited'));

    const result = await service.sendTest({ platform: 'telegram' });

    expect(result).toEqual({ ok: false, error: 'rate-limited' });
  });
});

describe('GatewayService.handleInbound — attach gate (AC 1.11)', () => {
  it('drops attach inbound with no binding: no upsertPending, no pairing prompt, debug log', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(null);

    await dispatchInbound(
      suite.service,
      makeInbound({
        platform: 'discord',
        externalChatId: 'chan-1',
        conversationId: 'thread-9',
        conversationMode: 'attach',
      }),
    );

    expect(suite.bindings.upsertPending).not.toHaveBeenCalled();
    expect(suite.discordAdapter.sendMessage).not.toHaveBeenCalled();
    expect(suite.messages.insert).not.toHaveBeenCalled();
    expect(suite.events).toHaveLength(0);
    expect(suite.logger.debug).toHaveBeenCalledWith(
      '[gateway] dropping attach inbound — no approved binding',
      expect.objectContaining({
        platform: 'discord',
        externalChatId: 'chan-1',
        status: 'none',
      }),
    );
  });

  it('drops attach inbound when the binding is pending — never re-prompts pairing', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(
      makeBinding({
        platform: 'discord',
        externalChatId: 'chan-1',
        approvalStatus: 'pending',
        pairingCode: '123456',
      }),
    );

    await dispatchInbound(
      suite.service,
      makeInbound({
        platform: 'discord',
        externalChatId: 'chan-1',
        conversationId: 'thread-9',
        conversationMode: 'attach',
      }),
    );

    expect(suite.bindings.upsertPending).not.toHaveBeenCalled();
    expect(suite.discordAdapter.sendMessage).not.toHaveBeenCalled();
    expect(suite.events).toHaveLength(0);
    expect(suite.logger.debug).toHaveBeenCalledWith(
      '[gateway] dropping attach inbound — no approved binding',
      expect.objectContaining({ status: 'pending' }),
    );
  });
});

describe('GatewayService.handleInbound — conversation resolution (AC 1.13/1.14)', () => {
  it('approved discord attach resolves via resolveOrAdopt and attaches the row to the event', async () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
      id: 'binding-d',
    });
    const conversation = makeConversation({
      id: 'conv-adopted' as GatewayConversationId,
      bindingId: binding.id,
      externalConversationId: 'thread-9',
    });
    suite.bindings.findByExternal.mockReturnValue(binding);
    suite.conversations.resolveOrAdopt.mockReturnValue(conversation);
    suite.messages.insert.mockReturnValue({} as never);

    await dispatchInbound(
      suite.service,
      makeInbound({
        platform: 'discord',
        externalChatId: 'chan-1',
        conversationId: 'thread-9',
        conversationMode: 'attach',
      }),
    );

    expect(suite.conversations.resolveOrAdopt).toHaveBeenCalledWith(
      binding.id,
      'thread-9',
    );
    expect(suite.conversations.resolveOrCreate).not.toHaveBeenCalled();
    expect(suite.conversations.touch).toHaveBeenCalledWith(conversation.id);
    expect(suite.events).toHaveLength(1);
    expect(suite.events[0].conversation).toBe(conversation);
    expect(suite.events[0].binding).toBe(binding);
  });

  it('telegram open inbound resolves the default row and keeps the 2-segment key byte-identical', async () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'telegram',
      externalChatId: 'chat-1',
      id: 'binding-t',
    });
    const conversation = makeConversation({
      bindingId: binding.id,
      externalConversationId: 'default',
    });
    suite.bindings.upsertPending.mockReturnValue(binding);
    suite.conversations.resolveOrCreate.mockReturnValue(conversation);
    suite.messages.insert.mockReturnValue({} as never);

    const msg = makeInbound({ platform: 'telegram', externalChatId: 'chat-1' });
    await dispatchInbound(suite.service, msg);

    expect(suite.conversations.resolveOrCreate).toHaveBeenCalledWith(
      binding.id,
      'default',
    );
    expect(suite.conversations.resolveOrAdopt).not.toHaveBeenCalled();
    expect(suite.events).toHaveLength(1);
    expect(suite.events[0].conversation).toBe(conversation);
    expect(suite.events[0].message.conversationKey).toBe('telegram:chat-1');
    expect(ConversationKey.for('telegram', 'chat-1')).toBe('telegram:chat-1');
  });

  it('slack open inbound resolves the default row and keeps the 2-segment key byte-identical', async () => {
    const suite = buildSuite();
    const slackAdapter = createAdapter('slack');
    suite.service.configureForTest({ slack: slackAdapter });
    const binding = makeBinding({
      platform: 'slack',
      externalChatId: 'C123',
      id: 'binding-s',
    });
    const conversation = makeConversation({
      bindingId: binding.id,
      externalConversationId: 'default',
    });
    suite.bindings.upsertPending.mockReturnValue(binding);
    suite.conversations.resolveOrCreate.mockReturnValue(conversation);
    suite.messages.insert.mockReturnValue({} as never);

    const msg = makeInbound({ platform: 'slack', externalChatId: 'C123' });
    await dispatchInbound(suite.service, msg);

    expect(suite.conversations.resolveOrCreate).toHaveBeenCalledWith(
      binding.id,
      'default',
    );
    expect(suite.conversations.resolveOrAdopt).not.toHaveBeenCalled();
    expect(suite.events).toHaveLength(1);
    expect(suite.events[0].conversation).toBe(conversation);
    expect(suite.events[0].message.conversationKey).toBe('slack:C123');
    expect(ConversationKey.for('slack', 'C123')).toBe('slack:C123');
  });

  it('discord open mention with a conversationId resolves via resolveOrCreate — never claims the default row', async () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
      id: 'binding-d',
    });
    const conversation = makeConversation({
      id: 'conv-fresh' as GatewayConversationId,
      bindingId: binding.id,
      externalConversationId: 'thread-new',
    });
    suite.bindings.upsertPending.mockReturnValue(binding);
    suite.conversations.resolveOrCreate.mockReturnValue(conversation);
    suite.messages.insert.mockReturnValue({} as never);

    await dispatchInbound(
      suite.service,
      makeInbound({
        platform: 'discord',
        externalChatId: 'chan-1',
        conversationId: 'thread-new',
        conversationMode: 'open',
      }),
    );

    expect(suite.conversations.resolveOrCreate).toHaveBeenCalledWith(
      binding.id,
      'thread-new',
    );
    expect(suite.conversations.resolveOrAdopt).not.toHaveBeenCalled();
    expect(suite.events[0].conversation).toBe(conversation);
  });
});

describe('GatewayService.flushOutbound — structured routing (AC 1.5)', () => {
  it('routes a conversationId-bearing route through adapter.sendMessage with opts', async () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
    });
    suite.bindings.findByExternal.mockReturnValue(binding);
    const route: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
    };

    suite.service.appendOutboundChunk(route, 'streamed reply');
    await suite.service.drainOutbound(route.conversationKey);

    expect(suite.discordAdapter.sendMessage).toHaveBeenCalledWith(
      'chan-1',
      'streamed reply',
      { conversationId: 'thread-9' },
    );
    expect(suite.messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: binding.id,
        direction: 'outbound',
        externalMsgId: 'msg-1',
        body: 'streamed reply',
      }),
    );
    await suite.service.stop();
  });

  it('paginates a reply longer than the discord maxMessageChars into multiple sends', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(
      makeBinding({ platform: 'discord', externalChatId: 'chan-1' }),
    );
    suite.discordAdapter.sendMessage
      .mockResolvedValueOnce({ externalMsgId: 'p0' } as SendResult)
      .mockResolvedValueOnce({ externalMsgId: 'p1' } as SendResult);
    const route: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
    };
    const body = 'x'.repeat(2500);

    suite.service.appendOutboundChunk(route, body);
    await suite.service.drainOutbound(route.conversationKey);
    await flushUntil(
      () => suite.discordAdapter.sendMessage.mock.calls.length >= 2,
    );

    const calls = suite.discordAdapter.sendMessage.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][1]).toHaveLength(2000);
    expect(calls[1][1]).toHaveLength(500);
    expect(calls[0][2]).toEqual({ conversationId: 'thread-9' });
    expect(calls[1][2]).toEqual({ conversationId: 'thread-9' });
    await suite.service.stop();
  });

  it('routes a 2-segment route without conversationId opts', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(
      makeBinding({ platform: 'telegram', externalChatId: 'chat-1' }),
    );
    const route: OutboundRoute = {
      conversationKey: ConversationKey.for('telegram', 'chat-1'),
      platform: 'telegram',
      externalChatId: 'chat-1',
    };

    suite.service.appendOutboundChunk(route, 'hi');
    await suite.service.drainOutbound(route.conversationKey);

    expect(suite.telegramAdapter.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      'hi',
      undefined,
    );
    await suite.service.stop();
  });
});

describe('GatewayService.completeOutboundTurn — per-turn reset (bugfix)', () => {
  it('seals a turn so the next turn starts a FRESH message with only its own body', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(
      makeBinding({ platform: 'discord', externalChatId: 'chan-1' }),
    );
    suite.discordAdapter.sendMessage
      .mockResolvedValueOnce({ externalMsgId: 'turn1-msg' } as SendResult)
      .mockResolvedValueOnce({ externalMsgId: 'turn2-msg' } as SendResult);
    const route: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
    };

    // Turn 1: stream "alpha", drain, then seal the turn.
    suite.service.appendOutboundChunk(route, 'alpha');
    await suite.service.drainOutbound(route.conversationKey);
    await suite.service.completeOutboundTurn(route.conversationKey);

    // Turn 2: stream "beta", drain.
    suite.service.appendOutboundChunk(route, 'beta');
    await suite.service.drainOutbound(route.conversationKey);

    // Two distinct sendMessage calls — NOT an edit of turn 1's message.
    expect(suite.discordAdapter.sendMessage).toHaveBeenCalledTimes(2);
    expect(suite.discordAdapter.editMessage).not.toHaveBeenCalled();
    expect(suite.discordAdapter.sendMessage.mock.calls[0][1]).toBe('alpha');
    // Turn 2's body is ONLY "beta" — no cumulative "alphabeta".
    expect(suite.discordAdapter.sendMessage.mock.calls[1][1]).toBe('beta');

    await suite.service.stop();
  });

  it('accumulates a whole turn and emits ONE complete sendMessage at seal — no streaming edits', async () => {
    const suite = buildSuite();
    suite.bindings.findByExternal.mockReturnValue(
      makeBinding({ platform: 'discord', externalChatId: 'chan-1' }),
    );
    suite.discordAdapter.sendMessage.mockResolvedValue({
      externalMsgId: 'turn1-msg',
    } as SendResult);
    suite.discordAdapter.editMessage.mockResolvedValue(undefined as never);
    const route: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
    };

    // The coalescer runs in 'complete' mode: appends only accumulate. A large
    // first chunk that would have crossed the old ~200-token streaming
    // threshold must NOT auto-flush. The single send happens only at the
    // end-of-turn seal, carrying the full cumulative body, never an edit.
    const firstChunk = 'a'.repeat(900);
    suite.service.appendOutboundChunk(route, firstChunk);
    // Give any (now-absent) auto-flush a chance to fire — it must not.
    await new Promise((r) => setTimeout(r, 0));
    expect(suite.discordAdapter.sendMessage).not.toHaveBeenCalled();

    suite.service.appendOutboundChunk(route, 'beta');
    await suite.service.completeOutboundTurn(route.conversationKey);

    // Exactly one send with the full turn body; zero edits.
    expect(suite.discordAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(suite.discordAdapter.sendMessage.mock.calls[0][1]).toBe(
      `${firstChunk}beta`,
    );
    expect(suite.discordAdapter.editMessage).not.toHaveBeenCalled();

    await suite.service.stop();
  });
});

describe('GatewayService.setBindingStatus — revoke cascade (AC 1.15)', () => {
  it('discards coalescer state + handles for every conversation key, then deletes the rows', async () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
      id: 'binding-d',
      approvalStatus: 'revoked',
    });
    suite.bindings.setStatus.mockReturnValue(binding);
    suite.conversations.listByBinding.mockReturnValue([
      makeConversation({
        bindingId: binding.id,
        externalConversationId: 'default',
      }),
      makeConversation({
        id: 'conv-2' as GatewayConversationId,
        bindingId: binding.id,
        externalConversationId: 'thread-9',
      }),
    ]);
    const threadRoute: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
    };
    const baseRoute: OutboundRoute = {
      conversationKey: ConversationKey.for('discord', 'chan-1'),
      platform: 'discord',
      externalChatId: 'chan-1',
    };
    suite.service.appendOutboundChunk(threadRoute, 'in flight');
    suite.service.appendOutboundChunk(baseRoute, 'also in flight');

    suite.service.setBindingStatus(binding.id, 'revoked');

    await suite.service.drainOutbound(threadRoute.conversationKey);
    await suite.service.drainOutbound(baseRoute.conversationKey);
    expect(suite.discordAdapter.sendMessage).not.toHaveBeenCalled();
    expect(suite.conversations.listByBinding).toHaveBeenCalledWith(binding.id);
    expect(suite.conversations.deleteByBinding).toHaveBeenCalledWith(
      binding.id,
    );
  });

  it('enumerates conversations BEFORE deleting the rows', () => {
    const suite = buildSuite();
    const binding = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
      approvalStatus: 'revoked',
    });
    suite.bindings.setStatus.mockReturnValue(binding);
    suite.conversations.listByBinding.mockReturnValue([]);

    suite.service.setBindingStatus(binding.id, 'revoked');

    const listOrder =
      suite.conversations.listByBinding.mock.invocationCallOrder[0];
    const deleteOrder =
      suite.conversations.deleteByBinding.mock.invocationCallOrder[0];
    expect(listOrder).toBeLessThan(deleteOrder);
  });
});

describe('GatewayService — enabled-flag persistence (Item 2)', () => {
  it('persists per-platform + master flags when startPlatform leaves the adapter running (AC 2.1)', async () => {
    const suite = buildSuite({ ciphers: { telegram: 'cipher-t' } });
    suite.vault.decrypt.mockReturnValue('tok-t');
    suite.telegramAdapter.isRunning.mockReturnValue(true);

    await suite.service.startPlatform('telegram');

    expect(suite.telegramAdapter.start).toHaveBeenCalledWith('tok-t');
    expect(suite.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'gateway.telegram.enabled',
      true,
    );
    expect(suite.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'gateway.enabled',
      true,
    );
  });

  it('does NOT persist flags when the adapter fails to run (AC 2.6)', async () => {
    const suite = buildSuite({ ciphers: { telegram: 'cipher-t' } });
    suite.vault.decrypt.mockReturnValue('tok-t');
    suite.telegramAdapter.start.mockRejectedValue(new Error('bad token'));
    suite.telegramAdapter.isRunning.mockReturnValue(false);

    await suite.service.startPlatform('telegram');

    expect(suite.workspace.setConfiguration).not.toHaveBeenCalled();
  });

  it('stopPlatform clears the per-platform flag and keeps master while a sibling stays enabled (AC 2.2)', async () => {
    const suite = buildSuite({
      settings: {
        'gateway.enabled': true,
        'gateway.telegram.enabled': true,
        'gateway.discord.enabled': true,
      },
    });

    await suite.service.stopPlatform('telegram');

    expect(suite.telegramAdapter.stop).toHaveBeenCalled();
    expect(suite.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'gateway.telegram.enabled',
      false,
    );
    expect(suite.workspace.setConfiguration).not.toHaveBeenCalledWith(
      'ptah',
      'gateway.enabled',
      false,
    );
    expect(suite.workspace.settings.get('gateway.enabled')).toBe(true);
  });

  it('stopPlatform clears the master flag only when no sibling platform stays enabled (AC 2.2)', async () => {
    const suite = buildSuite({
      settings: {
        'gateway.enabled': true,
        'gateway.telegram.enabled': true,
        'gateway.discord.enabled': false,
        'gateway.slack.enabled': false,
      },
    });

    await suite.service.stopPlatform('telegram');

    expect(suite.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'gateway.telegram.enabled',
      false,
    );
    expect(suite.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'gateway.enabled',
      false,
    );
  });

  it('boot auto-start: start() with persisted flags starts the enabled adapters (AC 2.3)', async () => {
    const suite = buildSuite({
      settings: {
        'gateway.enabled': true,
        'gateway.telegram.enabled': true,
        'gateway.discord.enabled': false,
        'gateway.slack.enabled': false,
      },
      ciphers: { telegram: 'cipher-t' },
    });
    suite.vault.decrypt.mockReturnValue('tok-t');

    await suite.service.start();

    expect(suite.telegramAdapter.start).toHaveBeenCalledWith('tok-t');
    expect(suite.discordAdapter.start).not.toHaveBeenCalled();
  });

  it('undecryptable token degrades: lastError surfaced, sibling platform still starts (AC 2.4)', async () => {
    const suite = buildSuite({
      settings: {
        'gateway.enabled': true,
        'gateway.telegram.enabled': true,
        'gateway.discord.enabled': true,
        'gateway.slack.enabled': false,
      },
      ciphers: { telegram: 'cipher-t', discord: 'cipher-d' },
    });
    suite.vault.decrypt.mockImplementation((cipher: string) =>
      cipher === 'cipher-d' ? 'tok-d' : null,
    );
    suite.telegramAdapter.isRunning.mockReturnValue(false);

    await suite.service.start();

    expect(suite.telegramAdapter.start).not.toHaveBeenCalled();
    expect(suite.discordAdapter.start).toHaveBeenCalledWith('tok-d');
    const status = suite.service.status();
    const telegramStatus = status.adapters.find(
      (a) => a.platform === 'telegram',
    );
    expect(telegramStatus?.lastError).toContain('decrypt failed');
  });

  it('startPlatform preserves sibling discord settings keys and writes only the enabled flags (AC 2.5)', async () => {
    const suite = buildSuite({
      settings: {
        'gateway.discord.allowedGuildIds': ['guild-1'],
        'gateway.discord.applicationId': '999',
      },
      ciphers: { discord: 'cipher-d' },
    });
    suite.vault.decrypt.mockReturnValue('tok-d');
    suite.discordAdapter.isRunning.mockReturnValue(true);

    await suite.service.startPlatform('discord');

    expect(
      suite.workspace.settings.get('gateway.discord.allowedGuildIds'),
    ).toEqual(['guild-1']);
    expect(suite.workspace.settings.get('gateway.discord.applicationId')).toBe(
      '999',
    );
    const writtenKeys = suite.workspace.setConfiguration.mock.calls.map(
      (call) => call[1],
    );
    expect(writtenKeys).toEqual(['gateway.discord.enabled', 'gateway.enabled']);
  });
});

describe('GatewayService.attachSession', () => {
  it('returns binding-not-found when the binding does not exist', async () => {
    const { service, bindings } = buildSuite();
    bindings.findById.mockReturnValue(null);

    const result = await service.attachSession(
      BindingId.create('binding-x'),
      'uuid-1',
      '/repo',
    );

    expect(result).toEqual({ ok: false, error: 'binding-not-found' });
  });

  it('returns binding-not-approved when the binding is pending', async () => {
    const { service, bindings } = buildSuite();
    bindings.findById.mockReturnValue(
      makeBinding({
        platform: 'telegram',
        externalChatId: 'chat-1',
        approvalStatus: 'pending',
      }),
    );

    const result = await service.attachSession(
      BindingId.create('binding-1'),
      'uuid-1',
      '/repo',
    );

    expect(result).toEqual({ ok: false, error: 'binding-not-approved' });
  });

  it('returns session-not-resumable when the session JSONL is missing', async () => {
    const { service, bindings, resumability } = buildSuite();
    bindings.findById.mockReturnValue(
      makeBinding({ platform: 'telegram', externalChatId: 'chat-1' }),
    );
    resumability.isResumable.mockResolvedValue(false);

    const result = await service.attachSession(
      BindingId.create('binding-1'),
      'uuid-1',
      '/repo',
    );

    expect(result).toEqual({ ok: false, error: 'session-not-resumable' });
  });

  it('attaches: sets workspace root, links session, registers, and emits events', async () => {
    const { service, bindings, conversations, attachedSessionRegistry } =
      buildSuite();
    const approved = makeBinding({
      platform: 'telegram',
      externalChatId: 'chat-1',
      approvalStatus: 'approved',
    });
    bindings.findById.mockReturnValue(approved);
    bindings.setWorkspaceRoot.mockReturnValue({
      ...approved,
      workspaceRoot: '/repo',
    });
    conversations.resolveOrCreate.mockReturnValue(makeConversation());

    const attached: Array<unknown> = [];
    const changed: Array<unknown> = [];
    service.on('session-attached', (p) => attached.push(p));
    service.on('bindings-changed', () => changed.push(true));

    const result = await service.attachSession(
      BindingId.create('binding-1'),
      'uuid-1',
      '/repo',
    );

    expect(result.ok).toBe(true);
    expect(bindings.setWorkspaceRoot).toHaveBeenCalledWith(
      approved.id,
      '/repo',
    );
    expect(conversations.resolveOrCreate).toHaveBeenCalledWith(
      approved.id,
      'default',
    );
    expect(conversations.setPtahSessionId).toHaveBeenCalledWith(
      'conv-1',
      'uuid-1',
    );
    expect(attachedSessionRegistry.isAttached('uuid-1')).toBe(true);
    expect(attachedSessionRegistry.bindingFor('uuid-1')).toBe('binding-1');
    expect(attached).toEqual([
      { bindingId: 'binding-1', sessionUuid: 'uuid-1', platform: 'telegram' },
    ]);
    expect(changed).toHaveLength(1);
  });

  it('honors a custom externalConversationId', async () => {
    const { service, bindings, conversations } = buildSuite();
    const approved = makeBinding({
      platform: 'discord',
      externalChatId: 'chan-1',
      approvalStatus: 'approved',
    });
    bindings.findById.mockReturnValue(approved);
    bindings.setWorkspaceRoot.mockReturnValue(approved);
    conversations.resolveOrCreate.mockReturnValue(
      makeConversation({ externalConversationId: 'thread-9' }),
    );

    await service.attachSession(
      BindingId.create('binding-1'),
      'uuid-1',
      '/repo',
      'thread-9',
    );

    expect(conversations.resolveOrCreate).toHaveBeenCalledWith(
      approved.id,
      'thread-9',
    );
  });
});

describe('GatewayService.detachSession', () => {
  it('returns binding-not-found when the binding does not exist', () => {
    const { service, bindings } = buildSuite();
    bindings.findById.mockReturnValue(null);

    const result = service.detachSession(BindingId.create('binding-x'));

    expect(result).toEqual({ ok: false, error: 'binding-not-found' });
  });

  it('clears ptahSessionId on linked conversations, detaches registry, emits events', () => {
    const { service, bindings, conversations, attachedSessionRegistry } =
      buildSuite();
    const binding = makeBinding({
      platform: 'telegram',
      externalChatId: 'chat-1',
      approvalStatus: 'approved',
    });
    bindings.findById.mockReturnValue(binding);
    conversations.listByBinding.mockReturnValue([
      makeConversation({ ptahSessionId: 'uuid-1' }),
    ]);
    attachedSessionRegistry.attach('uuid-1', 'binding-1');

    const detached: Array<unknown> = [];
    service.on('session-detached', (p) => detached.push(p));

    const result = service.detachSession(BindingId.create('binding-1'));

    expect(result.ok).toBe(true);
    expect(conversations.clearPtahSessionId).toHaveBeenCalledWith('conv-1');
    expect(attachedSessionRegistry.isAttached('uuid-1')).toBe(false);
    expect(detached).toEqual([
      { bindingId: 'binding-1', sessionUuid: 'uuid-1' },
    ]);
  });

  it('succeeds with empty sessionUuid when no conversation is linked', () => {
    const { service, bindings, conversations } = buildSuite();
    bindings.findById.mockReturnValue(
      makeBinding({
        platform: 'telegram',
        externalChatId: 'chat-1',
        approvalStatus: 'approved',
      }),
    );
    conversations.listByBinding.mockReturnValue([
      makeConversation({ ptahSessionId: null }),
    ]);

    const detached: Array<unknown> = [];
    service.on('session-detached', (p) => detached.push(p));

    const result = service.detachSession(BindingId.create('binding-1'));

    expect(result.ok).toBe(true);
    expect(conversations.clearPtahSessionId).not.toHaveBeenCalled();
    expect(detached).toEqual([{ bindingId: 'binding-1', sessionUuid: '' }]);
  });
});
