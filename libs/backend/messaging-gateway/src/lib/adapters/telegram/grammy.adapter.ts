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
  AdapterConnectionEvent,
  ConnectionListener,
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
    /** `sendChatAction` — powers the "typing…" indicator. */
    sendChatAction?(chatId: string, action: string): Promise<unknown>;
  };
  on(
    event: string,
    handler: (ctx: TelegramContext) => void | Promise<void>,
  ): void;
  /**
   * grammy's global error boundary. Without it grammy rethrows out of the
   * update handler and the polling loop dies with an unhandled rejection.
   */
  catch?(handler: (err: unknown) => void): void;
  start(opts?: {
    drop_pending_updates?: boolean;
    /** grammy calls this once long-polling is actually live. */
    onStart?: (info: { username?: string }) => void;
  }): Promise<void>;
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
  const { Bot } = require('grammy') as {
    Bot: new (t: string) => TelegramBotLike;
  };
  return new Bot(token);
};

const GLOBAL_LIMIT_PER_SEC = 30;
const PER_CHAT_INTERVAL_MS = 1_000;

/**
 * Reported when Telegram answers the polling loop with `401 Unauthorized`.
 * Deliberately actionable: nothing the gateway can do fixes a rejected token,
 * only the operator can.
 */
export const TELEGRAM_TOKEN_REJECTED_REASON =
  'Telegram rejected the bot token (401) — update the token in the Gateway tab';

/** `401` as a standalone number, or the word Telegram sends alongside it. */
const UNAUTHORIZED_PATTERN = /\b401\b|unauthorized/i;

/**
 * Did the polling loop die because Telegram refuses the token?
 *
 * grammy rejects with a `GrammyError` carrying the API's `error_code` (401 for
 * a revoked, mistyped or regenerated token) or an `HttpError` wrapping the
 * transport failure. We match structurally rather than with `instanceof` — the
 * grammy classes are only reachable through the lazily-`require`d factory, and
 * a test double must be able to reproduce the shape.
 */
function isTokenRejected(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (
    typeof err === 'object' &&
    (err as { error_code?: unknown }).error_code === 401
  ) {
    return true;
  }
  const text = err instanceof Error ? err.message : String(err);
  return UNAUTHORIZED_PATTERN.test(text);
}

@injectable()
export class GrammyTelegramAdapter implements IMessagingAdapter {
  readonly platform = 'telegram' as const;
  private bot: TelegramBotLike | null = null;
  private listener: InboundListener | null = null;
  private connectionListener: ConnectionListener | null = null;
  private factory: TelegramBotFactory = defaultFactory;
  private running = false;
  /**
   * Long-polling health, separate from the start/stop lifecycle. grammy has no
   * shard events, so the signal is narrower than Discord's: `bot.start()`
   * settling means the polling loop ended, and `bot.catch` fires for update
   * failures grammy will keep retrying (TASK_2026_271).
   */
  private connected = false;

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
    return this.running && this.connected;
  }

  onConnectionChange(listener: ConnectionListener): void {
    this.connectionListener = listener;
  }

  async start(token: string): Promise<void> {
    if (this.running) return;
    if (!token) throw new Error('Telegram token is empty');
    const bot = this.factory(token);
    this.bot = bot;
    bot.on('message', async (ctx) => {
      try {
        await this.handleInbound(ctx);
      } catch (err) {
        this.logger.warn('[gateway] telegram inbound handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    this.wireTransportEvents(bot);
    this.running = true;
    // Polling is live from grammy's point of view the moment `start()` is
    // called; `onStart` confirms it and the loop's own rejection revokes it.
    this.connected = true;
    this.logger.info('[gateway] telegram adapter started');
  }

  /**
   * grammy surfaces two things: errors inside update handling (`bot.catch`,
   * which it recovers from on its own) and the end of the polling loop (the
   * promise returned by `start()`). Both were previously unlistened — a
   * rejected polling loop became an unhandled rejection and `isRunning()`
   * stayed green for the rest of the process.
   */
  private wireTransportEvents(bot: TelegramBotLike): void {
    bot.catch?.((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn('[gateway] telegram bot error', { error: reason });
      // grammy recovers from handler errors on its own — report the reason
      // but do not flip a live connection to "reconnecting" and leave it there.
      this.emitConnection({
        state: this.connected ? 'connected' : 'reconnecting',
        reason,
      });
    });
    const started = bot.start({
      drop_pending_updates: true,
      onStart: () => {
        if (this.bot !== bot) return;
        this.connected = true;
        this.emitConnection({ state: 'connected' });
      },
    });
    void Promise.resolve(started).then(
      () => this.handlePollingEnded(bot, null),
      (err: unknown) => this.handlePollingEnded(bot, err),
    );
  }

  /**
   * The polling loop settled. If we did not ask for it (`stop()` clears
   * `this.bot`), the transport is gone for good — grammy does not restart the
   * loop on its own. Either way the start/stop lifecycle is released so a later
   * `start()` (the gateway's backoff reconnect, or the operator's Start button)
   * is not short-circuited by a stale `running`.
   *
   * Which state we report decides whether the gateway retries:
   *
   *   - `'invalidated'` — recoverable (network drop, `ECONNRESET`, a clean
   *     stop we did not ask for). `GatewayService` arms its bounded backoff.
   *   - `'disconnected'` — Telegram rejected the token (401). Retrying re-sends
   *     the same rejected token every few minutes forever and can only end in
   *     the same 401, so we stop here and let the reason tell the operator what
   *     to fix (TASK_2026_271).
   */
  private handlePollingEnded(bot: TelegramBotLike, err: unknown): void {
    if (this.bot !== bot || !this.running) return;
    this.connected = false;
    this.running = false;
    this.bot = null;
    const tokenRejected = isTokenRejected(err);
    const reason = tokenRejected
      ? TELEGRAM_TOKEN_REJECTED_REASON
      : err === null
        ? 'Telegram long-polling stopped'
        : `Telegram long-polling failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
    this.logger.warn('[gateway] telegram polling ended', {
      reason,
      willReconnect: !tokenRejected,
    });
    this.emitConnection({
      state: tokenRejected ? 'disconnected' : 'invalidated',
      reason,
    });
  }

  private emitConnection(event: AdapterConnectionEvent): void {
    try {
      this.connectionListener?.(event);
    } catch (error: unknown) {
      this.logger.warn('[gateway] telegram connection listener threw', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.connected = false;
    const bot = this.bot;
    this.bot = null;
    try {
      await bot?.stop();
    } catch (err) {
      this.logger.warn('[gateway] telegram bot stop failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  /**
   * Best-effort "typing…" chat action (TASK_2026_271). Telegram clears it
   * after ~5s, so the bridge re-arms it while a turn runs. Cosmetic — a
   * failure is logged and swallowed, never raised to the caller.
   */
  async sendTyping(externalChatId: string): Promise<void> {
    try {
      await this.bot?.api.sendChatAction?.(externalChatId, 'typing');
    } catch (error: unknown) {
      this.logger.debug('[gateway] telegram sendChatAction failed', {
        chatId: externalChatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  on(event: 'inbound', listener: InboundListener): void {
    if (event !== 'inbound') return;
    this.listener = listener;
  }

  private async handleInbound(ctx: TelegramContext): Promise<void> {
    const message = ctx.message;
    if (!message || !this.listener) return;
    const fromId = message.from?.id ? String(message.from.id) : '';
    if (this.allowedUserIds.size) {
      if (!fromId || !this.allowedUserIds.has(fromId)) {
        this.logger.debug('[gateway] telegram inbound rejected by allow-list', {
          fromId: fromId || '(empty)',
        });
        return;
      }
    }
    const chatIdNum =
      typeof message.chat.id === 'number'
        ? message.chat.id
        : Number(message.chat.id);
    const isPrivateChat = Number.isFinite(chatIdNum) && chatIdNum > 0;
    if (this.allowedUserIds.size && !isPrivateChat) {
      const chatIdStr = String(message.chat.id);
      if (!this.allowedUserIds.has(chatIdStr)) {
        this.logger.debug(
          '[gateway] telegram inbound rejected — non-private chat not on allow-list',
          { chatId: chatIdStr, fromId },
        );
        return;
      }
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
    const cutoff = now - 1_000;
    this.globalRecent = this.globalRecent.filter((ts) => ts > cutoff);
    if (this.globalRecent.length >= GLOBAL_LIMIT_PER_SEC) {
      const oldest = this.globalRecent[0];
      const wait = Math.max(1, oldest + 1_000 - now);
      await new Promise((r) => setTimeout(r, wait));
    }
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
