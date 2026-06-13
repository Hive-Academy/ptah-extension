import 'reflect-metadata';

import { DiscordAdapter } from './discord.adapter';
import type {
  DiscordClientLike,
  DiscordIncomingMessageLike,
  DiscordInteractionLike,
  DiscordMessageLike,
  DiscordSendableChannelLike,
  DiscordThreadLike,
} from './discord.adapter';
import type { InboundMessage } from '../adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';

const PER_CHANNEL_WINDOW_MS = 5_000;

type FakeLogger = Logger & {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function createLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as FakeLogger;
}

let msgSeq = 0;
function fakeMessage(): DiscordMessageLike & { edit: jest.Mock } {
  msgSeq += 1;
  return {
    id: `msg-${msgSeq}`,
    edit: jest.fn().mockResolvedValue(undefined),
  };
}

type ChannelRegistry = Map<string, DiscordSendableChannelLike>;

interface FakeThread extends DiscordThreadLike {
  send: jest.Mock;
  setArchived: jest.Mock;
}

interface FakeChannel extends DiscordSendableChannelLike {
  id: string;
  send: jest.Mock;
  threadCreate: jest.Mock;
  createdThreads: FakeThread[];
}

let threadSeq = 0;
function fakeThread(byId: ChannelRegistry): FakeThread {
  threadSeq += 1;
  const thread: FakeThread = {
    id: `thread-${threadSeq}`,
    send: jest.fn().mockImplementation(async () => fakeMessage()),
    setArchived: jest.fn().mockResolvedValue(undefined),
  };
  byId.set(thread.id, thread);
  return thread;
}

function fakeChannel(byId: ChannelRegistry, id = 'chan-1'): FakeChannel {
  const createdThreads: FakeThread[] = [];
  const threadCreate = jest.fn().mockImplementation(async () => {
    const t = fakeThread(byId);
    createdThreads.push(t);
    return t;
  });
  const channel: FakeChannel = {
    id,
    send: jest.fn().mockImplementation(async () => fakeMessage()),
    threads: { create: threadCreate },
    threadCreate,
    createdThreads,
  };
  byId.set(id, channel);
  return channel;
}

interface FakeClient extends DiscordClientLike {
  emitInteraction(interaction: DiscordInteractionLike): Promise<void>;
  emitMessage(message: DiscordIncomingMessageLike): Promise<void>;
  channelsFetch: jest.Mock;
}

function fakeClient(
  byId: ChannelRegistry,
  guilds: { id: string; name: string }[] = [],
): FakeClient {
  const handlers: {
    interactionCreate?: (i: DiscordInteractionLike) => void | Promise<void>;
    messageCreate?: (m: DiscordIncomingMessageLike) => void | Promise<void>;
  } = {};
  const channelsFetch = jest
    .fn()
    .mockImplementation(async (id: string) => byId.get(id) ?? null);
  return {
    user: { id: 'bot-1' },
    guilds: {
      cache: {
        map: <T>(fn: (g: { id: string; name: string }) => T): T[] =>
          guilds.map(fn),
      },
    },
    channels: { fetch: channelsFetch },
    channelsFetch,
    login: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    on: ((event: string, h: unknown) => {
      (handlers as Record<string, unknown>)[event] = h;
    }) as DiscordClientLike['on'],
    async emitInteraction(interaction) {
      if (!handlers.interactionCreate)
        throw new Error('no interactionCreate handler registered');
      await handlers.interactionCreate(interaction);
    },
    async emitMessage(message) {
      if (!handlers.messageCreate)
        throw new Error('no messageCreate handler registered');
      await handlers.messageCreate(message);
    },
  };
}

let inMsgSeq = 0;
function fakeIncomingMessage(
  overrides: Partial<{
    id: string;
    content: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    username: string;
    bot: boolean;
    isThread: boolean;
    parentId: string | null;
    mentionsBot: boolean;
  }> = {},
): DiscordIncomingMessageLike {
  inMsgSeq += 1;
  const mentionsBot = overrides.mentionsBot ?? false;
  return {
    id: overrides.id ?? `in-${inMsgSeq}`,
    content: overrides.content ?? 'hello',
    channelId: overrides.channelId ?? 'chan-1',
    guildId: overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
    author: {
      id: overrides.authorId ?? 'u1',
      username: overrides.username ?? 'alice',
      bot: overrides.bot ?? false,
    },
    mentions: { has: (id: string) => mentionsBot && id === 'bot-1' },
    channel: {
      isThread: () => overrides.isThread ?? false,
      parentId: overrides.parentId ?? null,
    },
  };
}

function fakeInteraction(
  overrides: Partial<DiscordInteractionLike> & {
    prompt?: string;
    isThread?: boolean;
    parentId?: string | null;
  } = {},
): DiscordInteractionLike & {
  deferReply: jest.Mock;
  editReply: jest.Mock;
} {
  const prompt = overrides.prompt ?? 'do the thing';
  const channel =
    overrides.isThread !== undefined
      ? {
          isThread: () => overrides.isThread ?? false,
          parentId: overrides.parentId ?? null,
        }
      : overrides.channel;
  return {
    commandName: overrides.commandName ?? 'ptah',
    id: overrides.id ?? 'interaction-1',
    channelId: overrides.channelId ?? 'chan-1',
    guildId: overrides.guildId ?? 'guild-1',
    user: overrides.user ?? { id: 'u1', username: 'alice' },
    options: { getString: () => prompt },
    channel,
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

async function startAdapter(
  opts: { allowedGuildIds?: string[] } = {},
): Promise<{
  adapter: DiscordAdapter;
  client: FakeClient;
  channel: FakeChannel;
  byId: ChannelRegistry;
  inbound: InboundMessage[];
  logger: FakeLogger;
}> {
  const byId: ChannelRegistry = new Map();
  const channel = fakeChannel(byId);
  const client = fakeClient(byId);
  const logger = createLogger();
  const adapter = new DiscordAdapter(logger);
  adapter.configure({
    factory: () => client,
    allowedGuildIds: opts.allowedGuildIds,
  });
  const inbound: InboundMessage[] = [];
  adapter.on('inbound', (msg) => {
    inbound.push(msg);
  });
  await adapter.start('token');
  return { adapter, client, channel, byId, inbound, logger };
}

describe('DiscordAdapter — inbound thread lifecycle', () => {
  beforeEach(() => {
    msgSeq = 0;
    threadSeq = 0;
    inMsgSeq = 0;
  });

  it('/ptah creates a thread, editReplies a pointer, emits open-mode inbound with the thread conversationId', async () => {
    const { client, channel, inbound } = await startAdapter();
    const interaction = fakeInteraction({ prompt: 'hello world' });

    await client.emitInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(channel.threadCreate).toHaveBeenCalledTimes(1);
    expect(channel.threadCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ptah: hello world',
        autoArchiveDuration: 10_080,
      }),
    );
    const threadId = channel.createdThreads[0].id;
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `Working in thread <#${threadId}>`,
    });

    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        platform: 'discord',
        externalChatId: 'chan-1',
        externalMsgId: 'interaction-1',
        body: 'hello world',
        conversationId: threadId,
        conversationMode: 'open',
        conversationKey: `discord:chan-1:${threadId}`,
        allowListId: 'guild-1',
        displayName: 'alice',
      }),
    );
  });

  it('every /ptah in the same channel creates a fresh thread and conversationId', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitInteraction(fakeInteraction({ id: 'interaction-1' }));
    await client.emitInteraction(fakeInteraction({ id: 'interaction-2' }));

    expect(channel.threadCreate).toHaveBeenCalledTimes(2);
    expect(inbound).toHaveLength(2);
    expect(inbound[0].conversationId).toBe(channel.createdThreads[0].id);
    expect(inbound[1].conversationId).toBe(channel.createdThreads[1].id);
    expect(inbound[0].conversationId).not.toBe(inbound[1].conversationId);
    expect(channel.createdThreads[0].setArchived).not.toHaveBeenCalled();
  });

  it('/ptah inside an existing thread never creates a nested thread and dispatches attach', async () => {
    const { client, channel, inbound } = await startAdapter();
    const interaction = fakeInteraction({
      id: 'interaction-thread',
      channelId: 'thread-55',
      isThread: true,
      parentId: 'chan-1',
      prompt: 'follow up in thread',
    });

    await client.emitInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(channel.threadCreate).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        externalChatId: 'chan-1',
        externalMsgId: 'interaction-thread',
        body: 'follow up in thread',
        conversationId: 'thread-55',
        conversationMode: 'attach',
        conversationKey: 'discord:chan-1:thread-55',
      }),
    );
  });

  it('/ptah editReplies a user-facing error and emits nothing when thread creation fails (no hanging interaction)', async () => {
    const { client, channel, inbound, logger } = await startAdapter();
    channel.threadCreate.mockRejectedValueOnce(new Error('missing permission'));
    const interaction = fakeInteraction({ id: 'interaction-fail' });

    await client.emitInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Ptah could not open a thread here.',
    });
    expect(inbound).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] discord interaction dispatch failed',
      expect.objectContaining({ error: expect.stringContaining('permission') }),
    );
  });

  it('@mention in a channel creates a thread, posts a pointer, emits open-mode inbound with the mention stripped', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        id: 'in-1',
        content: '<@bot-1> build me a thing',
        channelId: 'chan-1',
        mentionsBot: true,
      }),
    );

    expect(channel.threadCreate).toHaveBeenCalledTimes(1);
    const threadId = channel.createdThreads[0].id;
    expect(channel.send).toHaveBeenCalledWith({
      content: `Working in thread <#${threadId}>`,
    });
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        platform: 'discord',
        externalChatId: 'chan-1',
        externalMsgId: 'in-1',
        body: 'build me a thing',
        conversationId: threadId,
        conversationMode: 'open',
        conversationKey: `discord:chan-1:${threadId}`,
        allowListId: 'guild-1',
        displayName: 'alice',
      }),
    );
  });

  it('every parent-channel mention creates a fresh thread and conversationId', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({ content: '<@bot-1> first', mentionsBot: true }),
    );
    await client.emitMessage(
      fakeIncomingMessage({ content: '<@bot-1> second', mentionsBot: true }),
    );

    expect(channel.threadCreate).toHaveBeenCalledTimes(2);
    expect(inbound).toHaveLength(2);
    expect(inbound[0].conversationId).not.toBe(inbound[1].conversationId);
  });

  it('mention inside a thread never spawns a nested thread and dispatches attach', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        id: 'in-7',
        content: '<@bot-1> follow up',
        channelId: 'thread-77',
        isThread: true,
        parentId: 'chan-1',
        mentionsBot: true,
      }),
    );

    expect(channel.threadCreate).not.toHaveBeenCalled();
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        externalChatId: 'chan-1',
        externalMsgId: 'in-7',
        body: 'follow up',
        conversationId: 'thread-77',
        conversationMode: 'attach',
        conversationKey: 'discord:chan-1:thread-77',
      }),
    );
  });

  it('plain message in a never-seen thread on a fresh adapter emits attach with zero map dependency', async () => {
    const { client, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        id: 'in-9',
        content: 'resumed after restart',
        channelId: 'thread-resumed',
        isThread: true,
        parentId: 'chan-9',
      }),
    );

    expect(client.channelsFetch).not.toHaveBeenCalled();
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        externalChatId: 'chan-9',
        externalMsgId: 'in-9',
        body: 'resumed after restart',
        conversationId: 'thread-resumed',
        conversationMode: 'attach',
        conversationKey: 'discord:chan-9:thread-resumed',
      }),
    );
  });

  it('thread message with a null parent warns and drops', async () => {
    const { client, inbound, logger } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        content: 'orphaned',
        channelId: 'thread-orphan',
        isThread: true,
        parentId: null,
      }),
    );

    expect(inbound).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('parent channel unknown'),
      expect.objectContaining({ threadId: 'thread-orphan' }),
    );
  });

  it('channel fetch failure during mention handling warns without throwing into the message loop', async () => {
    const { client, inbound, logger } = await startAdapter();

    await expect(
      client.emitMessage(
        fakeIncomingMessage({
          content: '<@bot-1> hi',
          channelId: 'chan-missing',
          mentionsBot: true,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(inbound).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] discord message handler failed',
      expect.objectContaining({
        error: expect.stringContaining('chan-missing'),
      }),
    );
  });
});

describe('DiscordAdapter — guards', () => {
  beforeEach(() => {
    msgSeq = 0;
    threadSeq = 0;
    inMsgSeq = 0;
  });

  it('ignores a plain channel message that does not mention the bot', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({ content: 'just chatting', mentionsBot: false }),
    );

    expect(inbound).toHaveLength(0);
    expect(channel.threadCreate).not.toHaveBeenCalled();
  });

  it('ignores messages authored by bots (no self-trigger loop)', async () => {
    const { client, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        content: '<@bot-1> hi',
        mentionsBot: true,
        bot: true,
      }),
    );

    expect(inbound).toHaveLength(0);
  });

  it('rejects mention messages from a guild not on the allow-list', async () => {
    const { client, channel, inbound } = await startAdapter({
      allowedGuildIds: ['guild-allowed'],
    });

    await client.emitMessage(
      fakeIncomingMessage({
        content: '<@bot-1> hi',
        mentionsBot: true,
        guildId: 'guild-other',
      }),
    );

    expect(inbound).toHaveLength(0);
    expect(channel.threadCreate).not.toHaveBeenCalled();
  });

  it('rejects /ptah interactions from a guild not on the allow-list', async () => {
    const { client, channel, inbound } = await startAdapter({
      allowedGuildIds: ['guild-allowed'],
    });
    const interaction = fakeInteraction({ guildId: 'guild-other' });

    await client.emitInteraction(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(inbound).toHaveLength(0);
    expect(channel.threadCreate).not.toHaveBeenCalled();
  });
});

describe('DiscordAdapter — outbound', () => {
  beforeEach(() => {
    msgSeq = 0;
    threadSeq = 0;
    inMsgSeq = 0;
  });

  it('sendMessage with conversationId fetches the thread by id and sends there', async () => {
    const { adapter, client, channel, byId } = await startAdapter();
    const thread = fakeThread(byId);

    const res = await adapter.sendMessage('chan-1', 'streamed body', {
      conversationId: thread.id,
    });

    expect(client.channelsFetch).toHaveBeenCalledWith(thread.id);
    expect(thread.send).toHaveBeenCalledWith({ content: 'streamed body' });
    expect(channel.send).not.toHaveBeenCalled();
    expect(res.externalMsgId).toMatch(/^msg-/);
  });

  it('sendMessage without conversationId sends to the channel (pairing-prompt / sendTest path)', async () => {
    const { adapter, channel } = await startAdapter();

    const res = await adapter.sendMessage('chan-1', 'pairing prompt');

    expect(channel.send).toHaveBeenCalledWith({ content: 'pairing prompt' });
    expect(channel.threadCreate).not.toHaveBeenCalled();
    expect(res.externalMsgId).toMatch(/^msg-/);

    await adapter.editMessage('chan-1', res.externalMsgId, 'edited');
  });

  it('sendMessage throws when the routing target cannot be fetched', async () => {
    const { adapter } = await startAdapter();

    await expect(
      adapter.sendMessage('chan-1', 'x', { conversationId: 'thread-gone' }),
    ).rejects.toThrow(/thread-gone not found/);
    await expect(adapter.sendMessage('chan-gone', 'x')).rejects.toThrow(
      /chan-gone not found/,
    );
  });

  it('editMessage edits the right stored message by id', async () => {
    const { adapter, channel } = await startAdapter();

    const first = await adapter.sendMessage('chan-1', 'one');
    const second = await adapter.sendMessage('chan-1', 'two');
    expect(first.externalMsgId).not.toBe(second.externalMsgId);

    await adapter.editMessage('chan-1', second.externalMsgId, 'two-edited');

    const sentMessages = channel.send.mock.results.map(
      (r) => r.value as Promise<DiscordMessageLike>,
    );
    const resolved = await Promise.all(sentMessages);
    const editedHandle = resolved.find((m) => m.id === second.externalMsgId);
    const otherHandle = resolved.find((m) => m.id === first.externalMsgId);
    expect(
      (editedHandle as DiscordMessageLike & { edit: jest.Mock }).edit,
    ).toHaveBeenCalledWith({ content: 'two-edited' });
    expect(
      (otherHandle as DiscordMessageLike & { edit: jest.Mock }).edit,
    ).not.toHaveBeenCalled();
  });

  it('editMessage throws when message id is unknown', async () => {
    const { adapter } = await startAdapter();
    await expect(adapter.editMessage('chan-1', 'nope', 'x')).rejects.toThrow(
      /no message recorded/,
    );
  });

  it('per-target rate-limit window keys on conversationId and waits once the burst fills', async () => {
    jest.useFakeTimers();
    try {
      const { adapter, byId } = await startAdapter();
      const thread = fakeThread(byId);

      for (let i = 0; i < 5; i += 1) {
        await adapter.sendMessage('chan-1', `b${i}`, {
          conversationId: thread.id,
        });
      }

      const sixth = adapter.sendMessage('chan-1', 'b5', {
        conversationId: thread.id,
      });
      let settled = false;
      void sixth.then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(PER_CHANNEL_WINDOW_MS);
      await sixth;
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stop() clears the message map', async () => {
    const { adapter } = await startAdapter();
    const sent = await adapter.sendMessage('chan-1', 'x');

    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);

    await adapter.start('token');
    await expect(
      adapter.editMessage('chan-1', sent.externalMsgId, 'y'),
    ).rejects.toThrow(/no message recorded/);
  });
});

describe('DiscordAdapter — listGuilds', () => {
  it('returns [] before start and the mapped guilds once connected', async () => {
    const byId: ChannelRegistry = new Map();
    fakeChannel(byId);
    const client = fakeClient(byId, [
      { id: 'g1', name: 'Alpha' },
      { id: 'g2', name: 'Beta' },
    ]);
    const adapter = new DiscordAdapter(createLogger());
    adapter.configure({ factory: () => client });

    expect(adapter.listGuilds()).toEqual([]);

    await adapter.start('token');

    expect(adapter.listGuilds()).toEqual([
      { id: 'g1', name: 'Alpha' },
      { id: 'g2', name: 'Beta' },
    ]);
  });
});
