/**
 * Discord adapter — slash-commands ONLY (architecture §9.7).
 *
 * On inbound `/ptah <prompt>` interaction the adapter:
 *   1. Calls `interaction.deferReply()` immediately so Discord doesn't
 *      time out the 3-second initial-response window.
 *   2. Stores the interaction reference keyed by externalMsgId so a
 *      subsequent `editMessage` can call `editReply()` against the same
 *      interaction (Discord requires this — followups can't be edited
 *      once they've been finalized).
 *
 * Because we run plaintext (architecture §11 default 4) the body is sent
 * as raw text to `editReply` / `followUp`.
 *
 * Mocking strategy (default 5): the discord.js client is constructed via
 * a factory; tests pass a `FakeDiscordClient` exposing the small surface
 * we touch: `login`, `destroy`, `on('interactionCreate', ...)` plus
 * synthetic interaction objects with `deferReply`, `editReply`, `followUp`.
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
  followUp(payload: string | { content: string }): Promise<{ id: string }>;
}

export interface DiscordClientLike {
  login(token: string): Promise<unknown>;
  destroy(): Promise<unknown> | unknown;
  on(
    event: 'interactionCreate',
    handler: (interaction: DiscordInteractionLike) => void | Promise<void>,
  ): void;
}

export type DiscordClientFactory = () => DiscordClientLike;

const defaultFactory: DiscordClientFactory = () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client, GatewayIntentBits } = require('discord.js') as {
    Client: new (opts: { intents: number[] }) => DiscordClientLike;
    GatewayIntentBits: { Guilds: number };
  };
  return new Client({ intents: [GatewayIntentBits.Guilds] });
};

const PER_CHANNEL_EDIT_LIMIT = 5;
const PER_CHANNEL_WINDOW_MS = 5_000;

@injectable()
export class DiscordAdapter implements IMessagingAdapter {
  readonly platform = 'discord' as const;
  private client: DiscordClientLike | null = null;
  private listener: InboundListener | null = null;
  private factory: DiscordClientFactory = defaultFactory;
  private running = false;

  private allowedGuildIds = new Set<string>();
  /** Latest interaction handle keyed by externalMsgId so we can editReply. */
  private interactions = new Map<string, DiscordInteractionLike>();
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
    this.interactions.clear();
    this.channelEdits.clear();
  }

  async sendMessage(externalChatId: string, body: string): Promise<SendResult> {
    // Discord's flow is interaction-driven; sendMessage maps to "followUp on
    // the latest interaction for that channel" since we don't keep an arbitrary
    // channel reference. If no interaction is available, surface a clear error.
    const interaction = this.findInteractionForChannel(externalChatId);
    if (!interaction) {
      throw new Error(
        `Discord adapter: no active interaction for channel ${externalChatId}; ` +
          `Discord requires an interaction context for outbound messages.`,
      );
    }
    await this.respectChannelRateLimit(externalChatId);
    const res = await interaction.followUp({ content: body });
    this.interactions.set(res.id, interaction);
    return { externalMsgId: res.id };
  }

  async editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void> {
    const interaction = this.interactions.get(externalMsgId);
    if (!interaction) {
      throw new Error(
        `Discord adapter: no interaction recorded for message ${externalMsgId}`,
      );
    }
    await this.respectChannelRateLimit(externalChatId);
    await interaction.editReply({ content: body });
  }

  on(event: 'inbound', listener: InboundListener): void {
    if (event !== 'inbound') return;
    this.listener = listener;
  }

  private findInteractionForChannel(
    channelId: string,
  ): DiscordInteractionLike | null {
    for (const interaction of this.interactions.values()) {
      if (interaction.channelId === channelId) return interaction;
    }
    return null;
  }

  private async handleInteraction(
    interaction: DiscordInteractionLike,
  ): Promise<void> {
    if (!this.listener) return;
    if (interaction.commandName !== 'ptah') return;
    if (
      this.allowedGuildIds.size &&
      interaction.guildId &&
      !this.allowedGuildIds.has(interaction.guildId)
    ) {
      this.logger.debug(
        '[gateway] discord interaction rejected by allow-list',
        {
          guildId: interaction.guildId,
        },
      );
      return;
    }
    await interaction.deferReply();
    this.interactions.set(interaction.id, interaction);
    const prompt = interaction.options.getString('prompt') ?? '';
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
