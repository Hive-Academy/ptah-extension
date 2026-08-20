import 'reflect-metadata';

import { BoltSlackAdapter } from './bolt.adapter';
import type { SlackBoltAppLike, SlackEventHandlerArgs } from './bolt.adapter';
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

interface FakeApp extends SlackBoltAppLike {
  /** Fire the registered `app_mention` handler. */
  emitMention(args: SlackEventHandlerArgs): Promise<void>;
  /** Fire a Socket Mode receiver event; false when nothing listened. */
  emitSocket(event: string, ...args: unknown[]): boolean;
  /** Fire bolt's global error boundary. */
  emitAppError(err: unknown): boolean;
  postMessage: jest.Mock;
  update: jest.Mock;
  startMock: jest.Mock;
  stopMock: jest.Mock;
}

function fakeApp(opts: { withSocket?: boolean } = {}): FakeApp {
  let onMention:
    | ((args: SlackEventHandlerArgs) => void | Promise<void>)
    | null = null;
  let onAppError: ((err: unknown) => void | Promise<void>) | null = null;
  const socketHandlers = new Map<string, (...args: unknown[]) => void>();

  const postMessage = jest.fn().mockResolvedValue({ ts: '1700.0001' });
  const update = jest.fn().mockResolvedValue(undefined);
  const startMock = jest.fn().mockResolvedValue(undefined);
  const stopMock = jest.fn().mockResolvedValue(undefined);

  const app: FakeApp = {
    client: { chat: { postMessage, update } },
    event: (_type, handler) => {
      onMention = handler;
    },
    error: (handler) => {
      onAppError = handler;
    },
    receiver:
      opts.withSocket === false
        ? undefined
        : {
            client: {
              on: (event, handler) => socketHandlers.set(event, handler),
            },
          },
    start: startMock,
    stop: stopMock,
    postMessage,
    update,
    startMock,
    stopMock,
    async emitMention(args) {
      if (!onMention) throw new Error('no app_mention handler registered');
      await onMention(args);
    },
    emitSocket(event, ...args) {
      const handler = socketHandlers.get(event);
      if (!handler) return false;
      handler(...args);
      return true;
    },
    emitAppError(err) {
      if (!onAppError) return false;
      void onAppError(err);
      return true;
    },
  };
  return app;
}

async function startAdapter(
  opts: { app?: FakeApp; allowedTeamIds?: string[] } = {},
): Promise<{
  adapter: BoltSlackAdapter;
  app: FakeApp;
  logger: FakeLogger;
  inbound: InboundMessage[];
  states: Array<{ state: string; reason?: string }>;
}> {
  const app = opts.app ?? fakeApp();
  const logger = createLogger();
  const adapter = new BoltSlackAdapter(logger);
  adapter.configure({
    factory: () => app,
    allowedTeamIds: opts.allowedTeamIds,
  });
  const inbound: InboundMessage[] = [];
  adapter.on('inbound', (msg) => {
    inbound.push(msg);
  });
  const states: Array<{ state: string; reason?: string }> = [];
  adapter.onConnectionChange((e) => states.push(e));
  await adapter.start('xoxb-token', { appToken: 'xapp-token' });
  return { adapter, app, logger, inbound, states };
}

describe('BoltSlackAdapter — transport lifecycle (TASK_2026_271)', () => {
  it('is running once Socket Mode start() resolves', async () => {
    const { adapter, app } = await startAdapter();

    expect(adapter.isRunning()).toBe(true);
    expect(app.startMock).toHaveBeenCalled();
  });

  it('listens to the socket error event so it can never be unhandled', async () => {
    const { adapter, app, logger, states } = await startAdapter();

    expect(app.emitSocket('error', new Error('ws reset'))).toBe(true);

    expect(adapter.isRunning()).toBe(false);
    expect(states).toEqual([{ state: 'reconnecting', reason: 'ws reset' }]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] slack socket error',
      expect.objectContaining({ error: 'ws reset' }),
    );
  });

  it('goes red on disconnect and green again on the next connected event', async () => {
    const { adapter, app, states } = await startAdapter();

    app.emitSocket('disconnected');
    expect(adapter.isRunning()).toBe(false);

    app.emitSocket('reconnecting');
    expect(adapter.isRunning()).toBe(false);

    app.emitSocket('connected');
    expect(adapter.isRunning()).toBe(true);

    expect(states.map((s) => s.state)).toEqual([
      'disconnected',
      'reconnecting',
      'connected',
    ]);
  });

  it('start() on a started-but-dead socket rebuilds the app instead of no-op-ing', async () => {
    const { adapter, app } = await startAdapter();
    app.emitSocket('disconnected');
    expect(adapter.isRunning()).toBe(false);

    await adapter.start('xoxb-1', { appToken: 'xapp-1' });

    expect(app.stopMock).toHaveBeenCalledTimes(1);
    expect(app.startMock).toHaveBeenCalledTimes(2);
    expect(adapter.isRunning()).toBe(true);
  });

  it('start() while healthy stays a no-op', async () => {
    const { adapter, app } = await startAdapter();
    await adapter.start('xoxb-1', { appToken: 'xapp-1' });
    expect(app.startMock).toHaveBeenCalledTimes(1);
    expect(app.stopMock).not.toHaveBeenCalled();
    expect(adapter.isRunning()).toBe(true);
  });

  it('carries the disconnect cause when Slack supplies one', async () => {
    const { states, app } = await startAdapter();

    app.emitSocket('disconnected', new Error('server explicit disconnect'));

    expect(states[0]).toEqual({
      state: 'disconnected',
      reason: 'Slack Socket Mode disconnected: server explicit disconnect',
    });
  });

  it('ignores the disconnect bolt emits during our own stop()', async () => {
    const { adapter, app, states } = await startAdapter();

    await adapter.stop();
    app.emitSocket('disconnected');

    expect(adapter.isRunning()).toBe(false);
    expect(states).toEqual([]);
  });

  it('reports a bolt-level listener error without dropping the connection', async () => {
    const { adapter, app, logger, states } = await startAdapter();

    expect(app.emitAppError(new Error('handler blew up'))).toBe(true);

    expect(adapter.isRunning()).toBe(true);
    expect(states).toEqual([{ state: 'connected', reason: 'handler blew up' }]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[gateway] slack app error',
      expect.objectContaining({ error: 'handler blew up' }),
    );
  });

  it('starts fine against a receiver with no socket client', async () => {
    const app = fakeApp({ withSocket: false });
    const { adapter } = await startAdapter({ app });

    expect(adapter.isRunning()).toBe(true);
    expect(app.emitSocket('connected')).toBe(false);
  });

  it('rejects swapped bot/app tokens before touching the factory', async () => {
    const logger = createLogger();
    const adapter = new BoltSlackAdapter(logger);
    const app = fakeApp();
    adapter.configure({ factory: () => app });

    await expect(
      adapter.start('xapp-wrong', { appToken: 'xapp-token' }),
    ).rejects.toThrow(/must start with "xoxb-"/);
    await expect(
      adapter.start('xoxb-token', { appToken: 'xoxb-wrong' }),
    ).rejects.toThrow(/must start with "xapp-"/);
    expect(app.startMock).not.toHaveBeenCalled();
    expect(adapter.isRunning()).toBe(false);
  });
});

describe('BoltSlackAdapter — inbound', () => {
  it('strips the leading bot mention and emits an InboundMessage', async () => {
    const { app, inbound } = await startAdapter();

    await app.emitMention({
      event: {
        type: 'app_mention',
        text: '<@U0BOT> ship it',
        user: 'U1',
        channel: 'C123',
        ts: '1700.0002',
      },
      context: { teamId: 'T1' },
    });

    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        platform: 'slack',
        externalChatId: 'C123',
        externalMsgId: '1700.0002',
        body: 'ship it',
        conversationKey: 'slack:C123',
        allowListId: 'T1',
      }),
    );
  });

  it('drops a team that is not on the allow-list', async () => {
    const { app, inbound } = await startAdapter({
      allowedTeamIds: ['T-other'],
    });

    await app.emitMention({
      event: {
        type: 'app_mention',
        text: '<@U0BOT> ship it',
        user: 'U1',
        channel: 'C123',
        ts: '1700.0003',
      },
      context: { teamId: 'T1' },
    });

    expect(inbound).toHaveLength(0);
  });
});
