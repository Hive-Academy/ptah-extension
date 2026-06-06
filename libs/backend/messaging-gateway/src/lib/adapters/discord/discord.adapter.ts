/**
 * Discord adapter — slash `/ptah` plus free-form inbound: @mention the bot in
 * a channel to open a conversation, then type plain messages in its thread.
 *
 * Conversation model: one Discord thread per channel-conversation.
 *
 * On inbound `/ptah <prompt>` interaction the adapter:
 *   1. Calls `interaction.deferReply()` immediately so Discord doesn't
 *      time out the 3-second initial-response window.
 *   2. Resolves-or-creates a public thread for the channel (keyed by
 *      `interaction.channelId`) and `editReply()`s a short pointer to it.
 *      This happens well inside the 15-minute interaction-token window.
 *   3. Emits the inbound message exactly as before.
 *
 * All outbound traffic (`sendMessage` / `editMessage`) targets DURABLE
 * channel/thread messages via the bot REST API (`thread.send`,
 * `channel.send`, `message.edit`). Those have no token-expiry, so
 * multi-turn and unprompted messages work indefinitely — unlike the
 * interaction/webhook token, which expires after 15 minutes.
 *
 * Required bot permissions: "Send Messages", "Create Public Threads",
 * "Send Messages in Threads". Gateway intents: `Guilds`, `GuildMessages`, and
 * the privileged `MessageContent` — the last is required to read free-form
 * replies and must also be enabled on the Developer Portal Bot page.
 *
 * The conversation→thread map is in-memory (v1). Persistence across
 * process restarts is OUT OF SCOPE — on restart the next `/ptah` in a
 * channel simply creates a fresh thread. (Follow-up: persist the map.)
 *
 * Mocking strategy (default 5): the discord.js client is constructed via
 * a factory; tests pass a `FakeDiscordClient` exposing the small surface
 * we touch: `login`, `destroy`, `on('interactionCreate', ...)`,
 * `channels.fetch`, thread create/send, channel send, message edit.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  IMessagingAdapter,
  InboundListener,
  InboundMessage,
  SendResult,
} from '../adapter.interface';
import { ConversationKey } from '../../types';

export interface DiscordInteractionLike {
  /** Slash-command name. */
  commandName: string;
  /** Stable id we use as `externalMsgId`. */
  id: string;
  channelId: string;
  guildId: string | null;
  user: { id: string; username?: string };
  options: { getString(name: string): string | null };
  deferReply(): Promise<unknown>;
  editReply(payload: string | { content: string }): Promise<unknown>;
}

export interface DiscordMessageLike {
  id: string;
  edit(payload: string | { content: string }): Promise<unknown>;
}

export interface DiscordIncomingMessageLike {
  id: string;
  content: string;
  channelId: string;
  guildId: string | null;
  author: { id: string; username?: string; bot: boolean };
  mentions: { has(id: string): boolean };
  channel: { isThread(): boolean; parentId: string | null };
}

export interface DiscordGuildLike {
  id: string;
  name: string;
}

export interface DiscordThreadLike {
  id: string;
  send(payload: string | { content: string }): Promise<DiscordMessageLike>;
  setArchived(archived: boolean): Promise<unknown>;
}

export interface DiscordTextChannelLike {
  threads: {
    create(opts: {
      name: string;
      autoArchiveDuration: number;
      type: number;
    }): Promise<DiscordThreadLike>;
  };
  send(payload: string | { content: string }): Promise<DiscordMessageLike>;
}

export interface DiscordClientLike {
  user: { id: string } | null;
  guilds: { cache: { map<T>(fn: (g: DiscordGuildLike) => T): T[] } };
  channels: {
    fetch(channelId: string): Promise<DiscordTextChannelLike | null>;
  };
  login(token: string): Promise<unknown>;
  destroy(): Promise<unknown> | unknown;
  on(
    event: 'interactionCreate',
    handler: (interaction: DiscordInteractionLike) => void | Promise<void>,
  ): void;
  on(
    event: 'messageCreate',
    handler: (message: DiscordIncomingMessageLike) => void | Promise<void>,
  ): void;
}

export type DiscordClientFactory = () => DiscordClientLike;

const defaultFactory: DiscordClientFactory = () => {
  const { Client, GatewayIntentBits } = require('discord.js') as {
    Client: new (opts: { intents: number[] }) => DiscordClientLike;
    GatewayIntentBits: {
      Guilds: number;
      GuildMessages: number;
      MessageContent: number;
    };
    ChannelType: { PublicThread: number };
  };
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
};

function resolvePublicThreadType(): number {
  try {
    const { ChannelType } = require('discord.js') as {
      ChannelType: { PublicThread: number };
    };
    return ChannelType.PublicThread;
  } catch {
    return PUBLIC_THREAD_TYPE_FALLBACK;
  }
}

const PER_CHANNEL_EDIT_LIMIT = 5;
const PER_CHANNEL_WINDOW_MS = 5_000;
const THREAD_AUTO_ARCHIVE_MINUTES = 10_080;
const THREAD_NAME_PROMPT_CHARS = 40;
const PUBLIC_THREAD_TYPE_FALLBACK = 11;

interface ConversationThread {
  threadId: string;
  thread: DiscordThreadLike;
  currentMsgId?: string;
}

@injectable()
export class DiscordAdapter implements IMessagingAdapter {
  readonly platform = 'discord' as const;
  private client: DiscordClientLike | null = null;
  private listener: InboundListener | null = null;
  private factory: DiscordClientFactory = defaultFactory;
  private running = false;

  private allowedGuildIds = new Set<string>();
  /** channelId → resolved thread for that conversation. */
  private threadsByChannel = new Map<string, ConversationThread>();
  /** outbound message id → its live Message handle (for editMessage). */
  private messagesById = new Map<string, DiscordMessageLike>();
  /** Per-channel sliding window for edit rate limit. */
  private channelEdits = new Map<string, number[]>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  configure(opts: {
    factory?: DiscordClientFactory;
    allowedGuildIds?: ReadonlyArray<string>;
  }): void {
    if (opts.factory) this.factory = opts.factory;
    if (opts.allowedGuildIds) {
      this.allowedGuildIds = new Set(opts.allowedGuildIds);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Servers the bot is currently a member of — empty until connected. */
  listGuilds(): DiscordGuildLike[] {
    if (!this.client) return [];
    return this.client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
  }

  async start(token: string): Promise<void> {
    if (this.running) return;
    if (!token) throw new Error('Discord token is empty');
    this.client = this.factory();
    this.client.on('interactionCreate', async (interaction) => {
      try {
        await this.handleInteraction(interaction);
      } catch (err) {
        this.logger.warn('[gateway] discord interaction handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    this.client.on('messageCreate', async (message) => {
      try {
        await this.handleIncomingMessage(message);
      } catch (err) {
        this.logger.warn('[gateway] discord message handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    await this.client.login(token);
    this.running = true;
    this.logger.info('[gateway] discord adapter started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      await this.client?.destroy();
    } catch (err) {
      this.logger.warn('[gateway] discord client destroy failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.client = null;
    this.threadsByChannel.clear();
    this.messagesById.clear();
    this.channelEdits.clear();
  }

  async sendMessage(externalChatId: string, body: string): Promise<SendResult> {
    await this.respectChannelRateLimit(externalChatId);
    const conversation = this.threadsByChannel.get(externalChatId);
    let message: DiscordMessageLike;
    if (conversation) {
      message = await conversation.thread.send({ content: body });
      conversation.currentMsgId = message.id;
    } else {
      const channel = await this.requireChannel(externalChatId);
      message = await channel.send({ content: body });
    }
    this.messagesById.set(message.id, message);
    return { externalMsgId: message.id };
  }

  async editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void> {
    const message = this.messagesById.get(externalMsgId);
    if (!message) {
      throw new Error(
        `Discord adapter: no message recorded for ${externalMsgId}`,
      );
    }
    await this.respectChannelRateLimit(externalChatId);
    await message.edit({ content: body });
  }

  on(event: 'inbound', listener: InboundListener): void {
    if (event !== 'inbound') return;
    this.listener = listener;
  }

  private async requireChannel(
    channelId: string,
  ): Promise<DiscordTextChannelLike> {
    if (!this.client) {
      throw new Error('Discord adapter: client not started');
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Discord adapter: channel ${channelId} not found`);
    }
    return channel;
  }

  private async resolveThread(
    channelId: string,
    prompt: string,
  ): Promise<ConversationThread> {
    const existing = this.threadsByChannel.get(channelId);
    if (existing) {
      await existing.thread.setArchived(false);
      return existing;
    }
    const channel = await this.requireChannel(channelId);
    const name = this.threadName(prompt);
    const thread = await channel.threads.create({
      name,
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
      type: resolvePublicThreadType(),
    });
    const conversation: ConversationThread = {
      threadId: thread.id,
      thread,
    };
    this.threadsByChannel.set(channelId, conversation);
    return conversation;
  }

  private threadName(prompt: string): string {
    const trimmed = prompt.trim();
    const slice = trimmed.slice(0, THREAD_NAME_PROMPT_CHARS).trim();
    return slice.length ? `Ptah: ${slice}` : 'Ptah';
  }

  private async handleInteraction(
    interaction: DiscordInteractionLike,
  ): Promise<void> {
    if (!this.listener) return;
    if (interaction.commandName !== 'ptah') return;
    if (this.allowedGuildIds.size) {
      if (
        !interaction.guildId ||
        !this.allowedGuildIds.has(interaction.guildId)
      ) {
        this.logger.debug(
          '[gateway] discord interaction rejected by allow-list',
          { guildId: interaction.guildId ?? 'null(DM)' },
        );
        return;
      }
    }
    await interaction.deferReply();
    const prompt = interaction.options.getString('prompt') ?? '';
    const conversation = await this.resolveThread(
      interaction.channelId,
      prompt,
    );
    await interaction.editReply({
      content: `Working in thread <#${conversation.threadId}>`,
    });
    const externalChatId = interaction.channelId;
    const inbound: InboundMessage = {
      platform: 'discord',
      externalChatId,
      displayName: interaction.user.username,
      externalMsgId: interaction.id,
      body: prompt,
      conversationKey: ConversationKey.for('discord', externalChatId),
      allowListId: interaction.guildId ?? undefined,
    };
    await this.listener(inbound);
  }

  private async handleIncomingMessage(
    message: DiscordIncomingMessageLike,
  ): Promise<void> {
    if (!this.listener) return;
    if (message.author.bot) return;
    let body = message.content?.trim() ?? '';
    if (!body) return;
    if (this.allowedGuildIds.size) {
      if (!message.guildId || !this.allowedGuildIds.has(message.guildId)) {
        this.logger.debug('[gateway] discord message rejected by allow-list', {
          guildId: message.guildId ?? 'null(DM)',
        });
        return;
      }
    }

    const botId = this.client?.user?.id;
    let externalChatId: string;

    if (message.channel.isThread()) {
      const parentId = message.channel.parentId;
      const conversation = parentId
        ? this.threadsByChannel.get(parentId)
        : undefined;
      if (!conversation || conversation.threadId !== message.channelId) return;
      externalChatId = parentId as string;
      if (botId) body = this.stripMention(body, botId);
    } else {
      if (!botId || !message.mentions.has(botId)) return;
      body = this.stripMention(body, botId);
      if (!body) return;
      externalChatId = message.channelId;
      const conversation = await this.resolveThread(externalChatId, body);
      const channel = await this.requireChannel(externalChatId);
      await channel.send({
        content: `Working in thread <#${conversation.threadId}>`,
      });
    }
    if (!body) return;

    const inbound: InboundMessage = {
      platform: 'discord',
      externalChatId,
      displayName: message.author.username,
      externalMsgId: message.id,
      body,
      conversationKey: ConversationKey.for('discord', externalChatId),
      allowListId: message.guildId ?? undefined,
    };
    await this.listener(inbound);
  }

  private stripMention(text: string, botId: string): string {
    return text
      .replace(new RegExp(`<@!?${botId}>`, 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async respectChannelRateLimit(channelId: string): Promise<void> {
    const now = Date.now();
    const recent = (this.channelEdits.get(channelId) ?? []).filter(
      (ts) => ts > now - PER_CHANNEL_WINDOW_MS,
    );
    if (recent.length >= PER_CHANNEL_EDIT_LIMIT) {
      const wait = Math.max(50, recent[0] + PER_CHANNEL_WINDOW_MS - now);
      await new Promise((r) => setTimeout(r, wait));
    }
    recent.push(Date.now());
    this.channelEdits.set(channelId, recent);
  }
}
