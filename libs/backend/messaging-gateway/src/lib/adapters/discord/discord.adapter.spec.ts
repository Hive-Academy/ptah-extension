/**
 * DiscordAdapter — durable thread-per-conversation outbound model.
 *
 * Locks the contracts that replaced the interaction-bound outbound path:
 *
 *   (a) first `/ptah` in a channel creates a public thread, `editReply`s a
 *       pointer to it, and emits inbound unchanged (externalChatId =
 *       channelId, externalMsgId = interaction.id, conversationKey + allowListId);
 *   (b) `sendMessage` posts to the thread and returns the thread message id;
 *   (c) `editMessage` edits the right stored Message by id;
 *   (d) a second `/ptah` in the same channel REUSES the thread (no 2nd create,
 *       unarchives first);
 *   (e) `sendMessage` falls back to `channel.send` when no thread exists
 *       (sendTest / pairing-prompt path);
 *   (f) the per-channel edit rate-limit still waits once the burst window fills.
 *
 * The discord.js client is injected via `configure({ factory })`, so no real
 * client is constructed. Fakes implement only the `*Like` surface the adapter
 * touches.
 */
import 'reflect-metadata';

import { DiscordAdapter } from './discord.adapter';
import type {
  DiscordClientLike,
  DiscordIncomingMessageLike,
  DiscordInteractionLike,
  DiscordMessageLike,
  DiscordTextChannelLike,
  DiscordThreadLike,
} from './discord.adapter';
import type { InboundMessage } from '../adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';

const PER_CHANNEL_WINDOW_MS = 5_000;

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

let msgSeq = 0;
function fakeMessage(): DiscordMessageLike & { edit: jest.Mock } {
  msgSeq += 1;
  return {
    id: `msg-${msgSeq}`,
    edit: jest.fn().mockResolvedValue(undefined),
  };
}

interface FakeThread extends DiscordThreadLike {
  send: jest.Mock;
  setArchived: jest.Mock;
}

interface FakeChannel extends DiscordTextChannelLike {
  send: jest.Mock;
  threadCreate: jest.Mock;
  createdThreads: FakeThread[];
}

let threadSeq = 0;
function fakeThread(): FakeThread {
  threadSeq += 1;
  return {
    id: `thread-${threadSeq}`,
    send: jest.fn().mockImplementation(async () => fakeMessage()),
    setArchived: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeChannel(): FakeChannel {
  const createdThreads: FakeThread[] = [];
  const threadCreate = jest.fn().mockImplementation(async () => {
    const t = fakeThread();
    createdThreads.push(t);
    return t;
  });
  return {
    send: jest.fn().mockImplementation(async () => fakeMessage()),
    threads: { create: threadCreate },
    threadCreate,
    createdThreads,
  };
}

interface FakeClient extends DiscordClientLike {
  emitInteraction(interaction: DiscordInteractionLike): Promise<void>;
  emitMessage(message: DiscordIncomingMessageLike): Promise<void>;
  channelsFetch: jest.Mock;
}

function fakeClient(
  channel: FakeChannel,
  guilds: { id: string; name: string }[] = [],
): FakeClient {
  const handlers: {
    interactionCreate?: (i: DiscordInteractionLike) => void | Promise<void>;
    messageCreate?: (m: DiscordIncomingMessageLike) => void | Promise<void>;
  } = {};
  const channelsFetch = jest.fn().mockResolvedValue(channel);
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
  } = {},
): DiscordInteractionLike & {
  deferReply: jest.Mock;
  editReply: jest.Mock;
} {
  const prompt = overrides.prompt ?? 'do the thing';
  return {
    commandName: overrides.commandName ?? 'ptah',
    id: overrides.id ?? 'interaction-1',
    channelId: overrides.channelId ?? 'chan-1',
    guildId: overrides.guildId ?? 'guild-1',
    user: overrides.user ?? { id: 'u1', username: 'alice' },
    options: { getString: () => prompt },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

async function startAdapter(): Promise<{
  adapter: DiscordAdapter;
  client: FakeClient;
  channel: FakeChannel;
  inbound: InboundMessage[];
}> {
  const channel = fakeChannel();
  const client = fakeClient(channel);
  const adapter = new DiscordAdapter(createLogger());
  adapter.configure({ factory: () => client });
  const inbound: InboundMessage[] = [];
  adapter.on('inbound', (msg) => {
    inbound.push(msg);
  });
  await adapter.start('token');
  return { adapter, client, channel, inbound };
}

describe('DiscordAdapter — thread-per-conversation', () => {
  beforeEach(() => {
    msgSeq = 0;
    threadSeq = 0;
  });

  it('(a) first /ptah creates a thread, editReplies a pointer, emits inbound unchanged', async () => {
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
        conversationKey: 'discord:chan-1',
        allowListId: 'guild-1',
        displayName: 'alice',
      }),
    );
  });

  it('(b) sendMessage posts to the thread and returns the thread message id', async () => {
    const { adapter, client, channel } = await startAdapter();
    await client.emitInteraction(fakeInteraction());

    const res = await adapter.sendMessage('chan-1', 'streamed body');

    const thread = channel.createdThreads[0];
    expect(thread.send).toHaveBeenCalledWith({ content: 'streamed body' });
    expect(channel.send).not.toHaveBeenCalled();
    expect(res.externalMsgId).toMatch(/^msg-/);
  });

  it('(c) editMessage edits the right stored message by id', async () => {
    const { adapter, client, channel } = await startAdapter();
    await client.emitInteraction(fakeInteraction());

    const first = await adapter.sendMessage('chan-1', 'one');
    const second = await adapter.sendMessage('chan-1', 'two');
    expect(first.externalMsgId).not.toBe(second.externalMsgId);

    await adapter.editMessage('chan-1', second.externalMsgId, 'two-edited');

    const thread = channel.createdThreads[0];
    const sentMessages = thread.send.mock.results.map(
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

  it('(d) second /ptah in the same channel reuses the thread and unarchives it', async () => {
    const { client, channel } = await startAdapter();
    await client.emitInteraction(fakeInteraction({ id: 'interaction-1' }));
    await client.emitInteraction(fakeInteraction({ id: 'interaction-2' }));

    expect(channel.threadCreate).toHaveBeenCalledTimes(1);
    const thread = channel.createdThreads[0];
    expect(thread.setArchived).toHaveBeenCalledWith(false);
  });

  it('(e) sendMessage falls back to channel.send when no thread exists (sendTest path)', async () => {
    const { adapter, channel } = await startAdapter();

    const res = await adapter.sendMessage('chan-1', 'pairing prompt');

    expect(channel.send).toHaveBeenCalledWith({ content: 'pairing prompt' });
    expect(channel.threadCreate).not.toHaveBeenCalled();
    expect(res.externalMsgId).toMatch(/^msg-/);

    await adapter.editMessage('chan-1', res.externalMsgId, 'edited');
  });

  it('(f) per-channel edit rate-limit waits once the burst window fills', async () => {
    jest.useFakeTimers();
    try {
      const { adapter, client } = await startAdapter();
      await client.emitInteraction(fakeInteraction());

      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const r = await adapter.sendMessage('chan-1', `b${i}`);
        ids.push(r.externalMsgId);
      }

      const sixth = adapter.sendMessage('chan-1', 'b5');
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

  it('stop() clears thread + message maps', async () => {
    const { adapter, client, channel } = await startAdapter();
    await client.emitInteraction(fakeInteraction());
    const sent = await adapter.sendMessage('chan-1', 'x');

    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);

    await adapter.start('token');
    await expect(
      adapter.editMessage('chan-1', sent.externalMsgId, 'y'),
    ).rejects.toThrow(/no message recorded/);
    void channel;
  });
});

describe('DiscordAdapter — free-form inbound', () => {
  beforeEach(() => {
    msgSeq = 0;
    threadSeq = 0;
    inMsgSeq = 0;
  });

  it('@mention in a channel opens a thread, posts a pointer, and emits inbound with the mention stripped', async () => {
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
        conversationKey: 'discord:chan-1',
        allowListId: 'guild-1',
        displayName: 'alice',
      }),
    );
  });

  it('ignores a plain channel message that does not mention the bot', async () => {
    const { client, channel, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({ content: 'just chatting', mentionsBot: false }),
    );

    expect(inbound).toHaveLength(0);
    expect(channel.threadCreate).not.toHaveBeenCalled();
  });

  it('continues the conversation when a user types in the Ptah thread (no mention needed)', async () => {
    const { client, channel, inbound } = await startAdapter();
    await client.emitInteraction(fakeInteraction({ prompt: 'start' }));
    const threadId = channel.createdThreads[0].id;
    inbound.length = 0;

    await client.emitMessage(
      fakeIncomingMessage({
        id: 'in-2',
        content: 'and now the follow-up',
        channelId: threadId,
        isThread: true,
        parentId: 'chan-1',
        mentionsBot: false,
      }),
    );

    expect(channel.threadCreate).toHaveBeenCalledTimes(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        externalChatId: 'chan-1',
        externalMsgId: 'in-2',
        body: 'and now the follow-up',
        conversationKey: 'discord:chan-1',
      }),
    );
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

  it('ignores messages in a thread the adapter does not own', async () => {
    const { client, inbound } = await startAdapter();

    await client.emitMessage(
      fakeIncomingMessage({
        content: 'hi',
        channelId: 'thread-unknown',
        isThread: true,
        parentId: 'chan-unknown',
      }),
    );

    expect(inbound).toHaveLength(0);
  });

  it('rejects mention messages from a guild not on the allow-list', async () => {
    const channel = fakeChannel();
    const client = fakeClient(channel);
    const adapter = new DiscordAdapter(createLogger());
    adapter.configure({
      factory: () => client,
      allowedGuildIds: ['guild-allowed'],
    });
    const inbound: InboundMessage[] = [];
    adapter.on('inbound', (m) => {
      inbound.push(m);
    });
    await adapter.start('token');

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
});

describe('DiscordAdapter — listGuilds', () => {
  it('returns [] before start and the mapped guilds once connected', async () => {
    const channel = fakeChannel();
    const client = fakeClient(channel, [
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
