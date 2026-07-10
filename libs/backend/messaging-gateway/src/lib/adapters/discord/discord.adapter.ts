import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  IMessagingAdapter,
  InboundListener,
  InboundMessage,
  SendResult,
} from '../adapter.interface';
import type { IGatewayCommandHandler } from '../../commands/gateway-command.types';
import { ConversationKey } from '../../types';
import {
  DISCORD_CONTROL_COMMAND_NAMES,
  parseDiscordAutocomplete,
  parseDiscordControlCommand,
} from './discord-command.schema';

export interface DiscordInteractionLike {
  commandName: string;
  id: string;
  channelId: string;
  guildId: string | null;
  user: { id: string; username?: string };
  options: {
    getString(name: string): string | null;
    getSubcommand?(required?: boolean): string | null;
    getFocused?(): string;
  };
  channel?: { isThread(): boolean; parentId: string | null } | null;
  deferReply(opts?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(payload: string | { content: string }): Promise<unknown>;
  isAutocomplete?(): boolean;
  respond?(
    choices: ReadonlyArray<{ name: string; value: string }>,
  ): Promise<unknown>;
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
  channel: {
    isThread(): boolean;
    parentId: string | null;
    ownerId: string | null;
  };
}

export interface DiscordGuildLike {
  id: string;
  name: string;
}

export interface DiscordThreadLike {
  id: string;
  send(payload: string | { content: string }): Promise<DiscordMessageLike>;
}

export interface DiscordSendableChannelLike {
  send(payload: string | { content: string }): Promise<DiscordMessageLike>;
  threads?: {
    create(opts: {
      name: string;
      autoArchiveDuration: number;
      type: number;
    }): Promise<DiscordThreadLike>;
  };
}

export interface DiscordClientLike {
  user: { id: string } | null;
  guilds: { cache: { map<T>(fn: (g: DiscordGuildLike) => T): T[] } };
  channels: {
    fetch(channelId: string): Promise<DiscordSendableChannelLike | null>;
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
/** Discord caps autocomplete responses at 25 choices. */
const MAX_AUTOCOMPLETE_CHOICES = 25;
/** Fixed ephemeral reply for malformed/failed control commands (SEC-6/SEC-8). */
const CONTROL_COMMAND_ERROR_REPLY = 'Ptah could not process that command.';
const CONTROL_COMMANDS: ReadonlySet<string> = new Set(
  DISCORD_CONTROL_COMMAND_NAMES,
);

@injectable()
export class DiscordAdapter implements IMessagingAdapter {
  readonly platform = 'discord' as const;
  readonly maxMessageChars = 2000;
  private client: DiscordClientLike | null = null;
  private listener: InboundListener | null = null;
  private commandHandler: IGatewayCommandHandler | null = null;
  private factory: DiscordClientFactory = defaultFactory;
  private running = false;

  private allowedGuildIds = new Set<string>();
  private messagesById = new Map<string, DiscordMessageLike>();
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
      } catch (error: unknown) {
        this.logger.warn('[gateway] discord interaction handler failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.client.on('messageCreate', async (message) => {
      try {
        await this.handleIncomingMessage(message);
      } catch (error: unknown) {
        this.logger.warn('[gateway] discord message handler failed', {
          error: error instanceof Error ? error.message : String(error),
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
    } catch (error: unknown) {
      this.logger.warn('[gateway] discord client destroy failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.client = null;
    this.messagesById.clear();
    this.channelEdits.clear();
  }

  async sendMessage(
    externalChatId: string,
    body: string,
    opts?: { conversationId?: string },
  ): Promise<SendResult> {
    const targetId = opts?.conversationId ?? externalChatId;
    await this.respectChannelRateLimit(targetId);
    const channel = await this.requireChannel(targetId);
    const message = await channel.send({ content: body });
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

  setCommandHandler(handler: IGatewayCommandHandler): void {
    this.commandHandler = handler;
  }

  private async requireChannel(
    channelId: string,
  ): Promise<DiscordSendableChannelLike> {
    if (!this.client) {
      throw new Error('Discord adapter: client not started');
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Discord adapter: channel ${channelId} not found`);
    }
    return channel;
  }

  private async createThread(
    channelId: string,
    prompt: string,
  ): Promise<DiscordThreadLike> {
    const channel = await this.requireChannel(channelId);
    if (!channel.threads) {
      throw new Error(
        `Discord adapter: channel ${channelId} does not support threads`,
      );
    }
    return channel.threads.create({
      name: this.threadName(prompt),
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
      type: resolvePublicThreadType(),
    });
  }

  private threadName(prompt: string): string {
    const trimmed = prompt.trim();
    const slice = trimmed.slice(0, THREAD_NAME_PROMPT_CHARS).trim();
    return slice.length ? `Ptah: ${slice}` : 'Ptah';
  }

  private async handleInteraction(
    interaction: DiscordInteractionLike,
  ): Promise<void> {
    if (interaction.isAutocomplete?.() === true) {
      await this.handleAutocompleteInteraction(interaction);
      return;
    }
    if (CONTROL_COMMANDS.has(interaction.commandName)) {
      await this.handleControlInteraction(interaction);
      return;
    }
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
    try {
      if (interaction.channel?.isThread()) {
        const parentId = interaction.channel.parentId;
        if (parentId === null) {
          await interaction.editReply({
            content: 'Ptah could not open a thread here.',
          });
          this.logger.warn(
            '[gateway] discord interaction dropped: thread parent unknown',
            { threadId: interaction.channelId },
          );
          return;
        }
        const threadId = interaction.channelId;
        await interaction.editReply({ content: 'On it.' });
        const inbound: InboundMessage = {
          platform: 'discord',
          externalChatId: parentId,
          displayName: interaction.user.username,
          externalMsgId: interaction.id,
          body: prompt,
          conversationKey: ConversationKey.for('discord', parentId, threadId),
          allowListId: interaction.guildId ?? undefined,
          conversationId: threadId,
          conversationMode: 'attach',
        };
        await this.listener(inbound);
        return;
      }

      const externalChatId = interaction.channelId;
      const thread = await this.createThread(externalChatId, prompt);
      await interaction.editReply({
        content: `Working in thread <#${thread.id}>`,
      });
      const inbound: InboundMessage = {
        platform: 'discord',
        externalChatId,
        displayName: interaction.user.username,
        externalMsgId: interaction.id,
        body: prompt,
        conversationKey: ConversationKey.for(
          'discord',
          externalChatId,
          thread.id,
        ),
        allowListId: interaction.guildId ?? undefined,
        conversationId: thread.id,
        conversationMode: 'open',
      };
      await this.listener(inbound);
    } catch (error: unknown) {
      this.logger.warn('[gateway] discord interaction dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await interaction.editReply({
          content: 'Ptah could not open a thread here.',
        });
      } catch (editError: unknown) {
        this.logger.warn('[gateway] discord editReply after failure failed', {
          error:
            editError instanceof Error ? editError.message : String(editError),
        });
      }
    }
  }

  /**
   * Control-plane branch (TASK_2026_156): the five commands terminate at the
   * command handler — they are NEVER forwarded to the inbound listener, so a
   * command can structurally not become an agent turn (AC-1.3). Every command
   * defers ephemerally within Discord's 3-second window (NFR-1); lists,
   * errors and confirmations stay ephemeral (SEC-6) and a successful
   * mutation additionally posts one public audit line into the thread
   * (NFR-3).
   */
  private async handleControlInteraction(
    interaction: DiscordInteractionLike,
  ): Promise<void> {
    const handler = this.commandHandler;
    if (!handler) {
      this.logger.debug(
        '[gateway] discord control command ignored: no command handler wired',
        { commandName: interaction.commandName },
      );
      return;
    }
    if (!this.isGuildAllowed(interaction.guildId)) {
      this.logger.debug(
        '[gateway] discord interaction rejected by allow-list',
        { guildId: interaction.guildId ?? 'null(DM)' },
      );
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const parsed = parseDiscordControlCommand({
      commandName: interaction.commandName,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      userId: interaction.user?.id,
      isThread: interaction.channel?.isThread() ?? false,
      parentId: interaction.channel?.parentId ?? null,
      subcommand: interaction.options.getSubcommand?.(false) ?? null,
      pick: interaction.options.getString('pick'),
    });
    if (!parsed) {
      this.logger.warn('[gateway] discord control command failed validation', {
        commandName: interaction.commandName,
      });
      await this.safeEditReply(interaction, CONTROL_COMMAND_ERROR_REPLY);
      return;
    }
    try {
      const outcome = await handler.handleCommand({
        platform: 'discord',
        externalChatId: parsed.externalChatId,
        threadId: parsed.threadId,
        allowListId: parsed.allowListId,
        command: parsed.command,
      });
      await interaction.editReply({ content: outcome.ephemeralText });
      if (outcome.publicText !== undefined && parsed.threadId !== undefined) {
        await this.sendMessage(parsed.externalChatId, outcome.publicText, {
          conversationId: parsed.threadId,
        });
      }
    } catch (error: unknown) {
      this.logger.warn('[gateway] discord control command failed', {
        commandName: interaction.commandName,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.safeEditReply(interaction, CONTROL_COMMAND_ERROR_REPLY);
    }
  }

  /**
   * Autocomplete branch: respond (never defer) within the 3-second window.
   * Non-allowlisted guilds, unwired handlers and malformed payloads all get
   * an empty choice list — autocomplete is advisory UX only; submitted values
   * are re-validated server-side (SEC-1).
   */
  private async handleAutocompleteInteraction(
    interaction: DiscordInteractionLike,
  ): Promise<void> {
    const respond = interaction.respond?.bind(interaction);
    if (!respond) return;
    try {
      if (!this.commandHandler || !this.isGuildAllowed(interaction.guildId)) {
        await respond([]);
        return;
      }
      const parsed = parseDiscordAutocomplete({
        commandName: interaction.commandName,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        userId: interaction.user?.id,
        isThread: interaction.channel?.isThread() ?? false,
        parentId: interaction.channel?.parentId ?? null,
        focused: interaction.options.getFocused?.() ?? '',
      });
      if (!parsed) {
        await respond([]);
        return;
      }
      const choices = await this.commandHandler.handleAutocomplete({
        platform: 'discord',
        externalChatId: parsed.externalChatId,
        threadId: parsed.threadId,
        allowListId: parsed.allowListId,
        target: parsed.target,
        query: parsed.query,
      });
      await respond(choices.slice(0, MAX_AUTOCOMPLETE_CHOICES));
    } catch (error: unknown) {
      this.logger.warn('[gateway] discord autocomplete failed', {
        commandName: interaction.commandName,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await respond([]);
      } catch {
        // interaction already responded to or expired — nothing to salvage
      }
    }
  }

  private isGuildAllowed(guildId: string | null): boolean {
    if (!this.allowedGuildIds.size) return true;
    return guildId !== null && this.allowedGuildIds.has(guildId);
  }

  private async safeEditReply(
    interaction: DiscordInteractionLike,
    content: string,
  ): Promise<void> {
    try {
      await interaction.editReply({ content });
    } catch (error: unknown) {
      this.logger.warn('[gateway] discord editReply after failure failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

    if (message.channel.isThread()) {
      const parentId = message.channel.parentId;
      if (parentId === null) {
        this.logger.warn(
          '[gateway] discord thread message dropped: parent channel unknown',
          { threadId: message.channelId },
        );
        return;
      }
      const ptahOwnsThread = !!botId && message.channel.ownerId === botId;
      const mentionsBot = !!botId && message.mentions.has(botId);
      if (!ptahOwnsThread && !mentionsBot) {
        this.logger.debug(
          '[gateway] discord thread message ignored: not a Ptah thread and bot not mentioned',
          { threadId: message.channelId },
        );
        return;
      }
      if (botId) body = this.stripMention(body, botId);
      if (!body) return;
      const inbound: InboundMessage = {
        platform: 'discord',
        externalChatId: parentId,
        displayName: message.author.username,
        externalMsgId: message.id,
        body,
        conversationKey: ConversationKey.for(
          'discord',
          parentId,
          message.channelId,
        ),
        allowListId: message.guildId ?? undefined,
        conversationId: message.channelId,
        conversationMode: 'attach',
      };
      await this.listener(inbound);
      return;
    }

    if (!botId || !message.mentions.has(botId)) return;
    body = this.stripMention(body, botId);
    if (!body) return;
    const externalChatId = message.channelId;
    const thread = await this.createThread(externalChatId, body);
    const channel = await this.requireChannel(externalChatId);
    await channel.send({
      content: `Working in thread <#${thread.id}>`,
    });
    const inbound: InboundMessage = {
      platform: 'discord',
      externalChatId,
      displayName: message.author.username,
      externalMsgId: message.id,
      body,
      conversationKey: ConversationKey.for(
        'discord',
        externalChatId,
        thread.id,
      ),
      allowListId: message.guildId ?? undefined,
      conversationId: thread.id,
      conversationMode: 'open',
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
