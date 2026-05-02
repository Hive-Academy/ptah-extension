/**
 * Telegram adapter — built on `grammy` (long polling).
 *
 * Rate limiting (architecture §9.9): 30 outbound msgs/sec global +
 * 1 outbound/sec per chat. Implemented inline via timestamp accounting
 * so we don't take a hard `bottleneck` constructor dep here (the package
 * is in `apps/ptah-electron/package.json` and would be loaded lazily
 * through the constructor-injected factory).
 *
 * Mocking strategy (per task default 5): the grammy bot is constructed via
 * a factory the constructor accepts. Tests pass a fake factory that returns
 * a thin `MockBot` exposing the four surface methods we touch (`api.sendMessage`,
 * `api.editMessageText`, `start`, `stop`, `on`).
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

/** Minimal grammy surface we depend on — keeps the adapter testable. */
export interface TelegramBotLike {
  api: {
    sendMessage(chatId: string, text: string): Promise<{ message_id: number }>;
    editMessageText(
      chatId: string,
      messageId: number,
      text: string,
    ): Promise<unknown>;
    /** Best-effort download of a Telegram file id to a local path. */
    getFileUrl?(fileId: string): Promise<string>;
  };
  on(
    event: string,
    handler: (ctx: TelegramContext) => void | Promise<void>,
  ): void;
  start(opts?: { drop_pending_updates?: boolean }): Promise<void>;
  stop(): Promise<void>;
}

export interface TelegramContext {
  message?: {
    message_id: number;
    chat: { id: number | string; title?: string; username?: string };
    from?: { id: number; username?: string };
    text?: string;
    voice?: { file_id: string; duration?: number };
  };
}

export type TelegramBotFactory = (token: string) => TelegramBotLike;

const defaultFactory: TelegramBotFactory = (token) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Bot } = require('grammy') as {
    Bot: new (t: string) => TelegramBotLike;
  };
  return new Bot(token);
};

const GLOBAL_LIMIT_PER_SEC = 30;
const PER_CHAT_INTERVAL_MS = 1_000;

@injectable()
export class GrammyTelegramAdapter implements IMessagingAdapter {
  readonly platform = 'telegram' as const;
  private bot: TelegramBotLike | null = null;
  private listener: InboundListener | null = null;
  private factory: TelegramBotFactory = defaultFactory;
  private running = false;

  /** Sliding 1-second window of outbound timestamps (global cap). */
  private globalRecent: number[] = [];
  /** Per-chat last-send timestamp (per-chat cap). */
  private perChatLast = new Map<string, number>();
  /** Allow-list — empty array == allow all. */
  private allowedUserIds = new Set<string>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  configure(opts: {
    factory?: TelegramBotFactory;
    allowedUserIds?: ReadonlyArray<string | number>;
  }): void {
    if (opts.factory) this.factory = opts.factory;
    if (opts.allowedUserIds) {
      this.allowedUserIds = new Set(
        opts.allowedUserIds.map((id) => String(id)),
      );
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(token: string): Promise<void> {
    if (this.running) return;
    if (!token) throw new Error('Telegram token is empty');
    this.bot = this.factory(token);
    this.bot.on('message', async (ctx) => {
      try {
        await this.handleInbound(ctx);
      } catch (err) {
        this.logger.warn('[gateway] telegram inbound handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    // grammy.start() returns a long-running promise; do not await it.
    void this.bot.start({ drop_pending_updates: true });
    this.running = true;
    this.logger.info('[gateway] telegram adapter started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      await this.bot?.stop();
    } catch (err) {
      this.logger.warn('[gateway] telegram bot stop failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.bot = null;
    this.globalRecent = [];
    this.perChatLast.clear();
  }

  async sendMessage(externalChatId: string, body: string): Promise<SendResult> {
    if (!this.bot) throw new Error('Telegram adapter not running');
    await this.awaitRateLimit(externalChatId);
    const res = await this.bot.api.sendMessage(externalChatId, body);
    return { externalMsgId: String(res.message_id) };
  }

  async editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void> {
    if (!this.bot) throw new Error('Telegram adapter not running');
    await this.awaitRateLimit(externalChatId);
    const id = Number(externalMsgId);
    if (!Number.isFinite(id))
      throw new Error(`invalid telegram message id: ${externalMsgId}`);
    await this.bot.api.editMessageText(externalChatId, id, body);
  }

  on(event: 'inbound', listener: InboundListener): void {
    if (event !== 'inbound') return;
    this.listener = listener;
  }

  private async handleInbound(ctx: TelegramContext): Promise<void> {
    const message = ctx.message;
    if (!message || !this.listener) return;
    const fromId = message.from?.id ? String(message.from.id) : '';
    if (
      this.allowedUserIds.size &&
      fromId &&
      !this.allowedUserIds.has(fromId)
    ) {
      this.logger.debug('[gateway] telegram inbound rejected by allow-list', {
        fromId,
      });
      return;
    }
    const externalChatId = String(message.chat.id);
    const displayName = message.chat.title ?? message.chat.username;
    const text = message.text ?? '';
    if (!text && !message.voice) return; // no text & no voice — nothing to do
    const inbound: InboundMessage = {
      platform: 'telegram',
      externalChatId,
      displayName,
      externalMsgId: String(message.message_id),
      body: text,
      voicePath: undefined,
      conversationKey: ConversationKey.for('telegram', externalChatId),
      allowListId: fromId || undefined,
    };
    await this.listener(inbound);
  }

  private async awaitRateLimit(chatId: string): Promise<void> {
    const now = Date.now();
    // Prune global window.
    const cutoff = now - 1_000;
    this.globalRecent = this.globalRecent.filter((ts) => ts > cutoff);
    if (this.globalRecent.length >= GLOBAL_LIMIT_PER_SEC) {
      const oldest = this.globalRecent[0];
      const wait = Math.max(1, oldest + 1_000 - now);
      await new Promise((r) => setTimeout(r, wait));
    }
    // Per-chat throttle.
    const last = this.perChatLast.get(chatId) ?? 0;
    const sinceLast = now - last;
    if (sinceLast < PER_CHAT_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, PER_CHAT_INTERVAL_MS - sinceLast));
    }
    const stamp = Date.now();
    this.globalRecent.push(stamp);
    this.perChatLast.set(chatId, stamp);
  }
}
