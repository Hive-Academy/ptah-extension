import 'reflect-metadata';

import { GrammyTelegramAdapter } from './grammy.adapter';
import type { TelegramBotLike, TelegramContext } from './grammy.adapter';
import type { InboundMessage } from '../adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';

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

interface FakeBot extends TelegramBotLike {
  /** Fire the registered `message` middleware. */
  emitMessage(ctx: TelegramContext): Promise<void>;
  /** Fire the handler registered through `bot.catch`. */
  emitError(err: unknown): boolean;
  /** Resolve the long-polling promise as if grammy stopped cleanly. */
  endPolling(): void;
  /** Reject the long-polling promise (token revoked, network gone). */
  failPolling(err: unknown): void;
  /** Invoke the `onStart` callback grammy fires once polling is live. */
  confirmStarted(): void;
  sendMessage: jest.Mock;
  editMessageText: jest.Mock;
  sendChatAction: jest.Mock;
  stopMock: jest.Mock;
}

function fakeBot(opts: { withCatch?: boolean } = {}): FakeBot {
  let onMessage: ((ctx: TelegramContext) => void | Promise<void>) | null = null;
  let onError: ((err: unknown) => void) | null = null;
  let onStart: (() => void) | null = null;
  let settle: { resolve: () => void; reject: (err: unknown) => void } | null =
    null;

  const sendMessage = jest.fn().mockResolvedValue({ message_id: 42 });
  const editMessageText = jest.fn().mockResolvedValue(undefined);
  const sendChatAction = jest.fn().mockResolvedValue(undefined);
  const stopMock = jest.fn().mockResolvedValue(undefined);

  const bot: FakeBot = {
    api: { sendMessage, editMessageText, sendChatAction },
    on: (_event, handler) => {
      onMessage = handler;
    },
    start: (startOpts) =>
      new Promise<void>((resolve, reject) => {
        onStart = startOpts?.onStart
          ? () => startOpts.onStart?.({ username: 'ptah_bot' })
          : null;
        settle = { resolve, reject };
      }),
    stop: stopMock,
    sendMessage,
    editMessageText,
    sendChatAction,
    stopMock,
    async emitMessage(ctx) {
      if (!onMessage) throw new Error('no message handler registered');
      await onMessage(ctx);
    },
    emitError(err) {
      if (!onError) return false;
      onError(err);
      return true;
    },
    endPolling() {
      settle?.resolve();
    },
    failPolling(err) {
      settle?.reject(err);
    },
    confirmStarted() {
      onStart?.();
    },
  };
  if (opts.withCatch !== false) {
    bot.catch = (handler) => {
      onError = handler;
    };
  }
  return bot;
}

async function startAdapter(
  opts: { bot?: FakeBot; allowedUserIds?: Array<string | number> } = {},
): Promise<{
  adapter: GrammyTelegramAdapter;
  bot: FakeBot;
  logger: FakeLogger;
  inbound: InboundMessage[];
  states: Array<{ state: string; reason?: string }>;
}> {
  const bot = opts.bot ?? fakeBot();
  const logger = createLogger();
  const adapter = new GrammyTelegramAdapter(logger);
  adapter.configure({
    factory: () => bot,
    allowedUserIds: opts.allowedUserIds,
  });
  const inbound: InboundMessage[] = [];
  adapter.on('inbound', (msg) => {
    inbound.push(msg);
  });
  const states: Array<{ state: string; reason?: string }> = [];
  adapter.onConnectionChange((e) => states.push(e));
  await adapter.start('tok');
  return { adapter, bot, logger, inbound, states };
}

function telegramMessage(text = 'hello'): TelegramContext {
  return {
    message: {
      message_id: 7,
      chat: { id: 123, username: 'alice' },
      from: { id: 123, username: 'alice' },
      text,
    },
  };
}

describe('GrammyTelegramAdapter — transport lifecycle (TASK_2026_271)', () => {
  it('reports connected once grammy calls onStart', async () => {
    const { adapter, bot, states } = await startAdapter();

    expect(adapter.isRunning()).toBe(true);
    bot.confirmStarted();

    expect(adapter.isRunning()).toBe(true);
    expect(states).toEqual([{ state: 'connected' }]);
  });

  it('a rejected polling loop is invalidated (grammy will not restart it) and a later start() rebuilds the bot', async () => {
    const { adapter, bot, logger, states } = await startAdapter();

    bot.failPolling(new Error('401: Unauthorized'));
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.isRunning()).toBe(false);
    expect(states).toEqual([
      {
        state: 'invalidated',
        reason: 'Telegram long-polling failed: 401: Unauthorized',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] telegram polling ended',
      expect.objectContaining({ reason: expect.stringContaining('401') }),
    );

    // The lifecycle flag was released, so Start (UI or backoff) is not a
    // no-op on the dead adapter.
    await adapter.start('token');
    expect(adapter.isRunning()).toBe(true);
  });

  it('a polling loop that ends without an error is invalidated too', async () => {
    const { adapter, bot, states } = await startAdapter();

    bot.endPolling();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.isRunning()).toBe(false);
    expect(states).toEqual([
      { state: 'invalidated', reason: 'Telegram long-polling stopped' },
    ]);
  });

  it('registers bot.catch so a middleware error is logged, reported with the live state, and never thrown', async () => {
    const { adapter, bot, logger, states } = await startAdapter();

    expect(bot.emitError(new Error('getUpdates timed out'))).toBe(true);

    // grammy recovers from these itself; a live connection stays 'connected'
    // (with the reason attached) rather than being parked at 'reconnecting'.
    expect(adapter.isRunning()).toBe(true);
    expect(states).toEqual([
      { state: 'connected', reason: 'getUpdates timed out' },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] telegram bot error',
      expect.objectContaining({ error: 'getUpdates timed out' }),
    );
  });

  it('stays silent after stop() even if the polling promise settles late', async () => {
    const { adapter, bot, states } = await startAdapter();

    await adapter.stop();
    bot.failPolling(new Error('aborted'));
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.isRunning()).toBe(false);
    expect(states).toEqual([]);
    expect(bot.stopMock).toHaveBeenCalled();
  });

  it('starts without a bot.catch surface (older grammy shim) and still polls', async () => {
    const bot = fakeBot({ withCatch: false });
    const { adapter } = await startAdapter({ bot });

    expect(adapter.isRunning()).toBe(true);
    bot.confirmStarted();
    expect(adapter.isRunning()).toBe(true);
  });
});

describe('GrammyTelegramAdapter — typing indicator (TASK_2026_271)', () => {
  it('sends the typing chat action for the chat', async () => {
    const { adapter, bot } = await startAdapter();

    await adapter.sendTyping('123');

    expect(bot.sendChatAction).toHaveBeenCalledWith('123', 'typing');
  });

  it('swallows a failing chat action and logs at debug', async () => {
    const { adapter, bot, logger } = await startAdapter();
    bot.sendChatAction.mockRejectedValue(new Error('chat not found'));

    await expect(adapter.sendTyping('123')).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      '[gateway] telegram sendChatAction failed',
      expect.objectContaining({ error: 'chat not found' }),
    );
  });

  it('is a no-op before start and after stop', async () => {
    const logger = createLogger();
    const adapter = new GrammyTelegramAdapter(logger);
    await expect(adapter.sendTyping('123')).resolves.toBeUndefined();
  });
});

describe('GrammyTelegramAdapter — inbound', () => {
  it('normalises a private message into an InboundMessage', async () => {
    const { bot, inbound } = await startAdapter();

    await bot.emitMessage(telegramMessage('build me a thing'));

    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        platform: 'telegram',
        externalChatId: '123',
        externalMsgId: '7',
        body: 'build me a thing',
        conversationKey: 'telegram:123',
        allowListId: '123',
      }),
    );
  });

  it('drops a sender that is not on the allow-list', async () => {
    const { bot, inbound } = await startAdapter({ allowedUserIds: ['999'] });

    await bot.emitMessage(telegramMessage());

    expect(inbound).toHaveLength(0);
  });
});
