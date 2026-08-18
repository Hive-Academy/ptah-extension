/**
 * Slack adapter — `@slack/bolt` Socket Mode receiver (architecture §9.8).
 *
 * - Inbound = `app_mention` events; we strip the leading `<@BOTID>` token.
 * - Outbound first send uses `chat.postMessage`; subsequent edits use
 *   `chat.update`.
 *
 * Rate limit (architecture §9.9): ~50 outbound msgs/min team-wide. We
 * implement a simple sliding-minute throttle here.
 *
 * Mocking strategy (default 5): the bolt App is built by an injectable
 * factory; tests provide a fake whose `event` registration matches the bolt
 * surface and whose `client.chat.postMessage` / `chat.update` return
 * synthetic `ts` values.
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

export interface SlackEvent {
  type: 'app_mention';
  text: string;
  user: string;
  channel: string;
  ts: string;
  team?: string;
}

export interface SlackEventHandlerArgs {
  event: SlackEvent;
  context: { teamId?: string };
}

export interface SlackClientLike {
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
    }): Promise<{ ts: string }>;
    update(args: {
      channel: string;
      ts: string;
      text: string;
    }): Promise<unknown>;
  };
}

/**
 * The Socket Mode client bolt builds inside its receiver. It is a plain
 * EventEmitter — `'connected'`, `'disconnected'`, `'reconnecting'`, `'error'`
 * — and is the only transport-health signal bolt exposes.
 */
export interface SlackSocketClientLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface SlackBoltAppLike {
  client: SlackClientLike;
  event(
    eventType: 'app_mention',
    handler: (args: SlackEventHandlerArgs) => void | Promise<void>,
  ): void;
  /** bolt's global error boundary; optional so fakes stay minimal. */
  error?(handler: (err: unknown) => void | Promise<void>): void;
  /** Present on a Socket Mode app; absent for other receivers. */
  receiver?: { client?: SlackSocketClientLike };
  start(): Promise<unknown>;
  stop(): Promise<unknown> | unknown;
}

export type SlackAppFactory = (opts: {
  botToken: string;
  appToken: string;
}) => SlackBoltAppLike;

const defaultFactory: SlackAppFactory = (opts) => {
  const { App } = require('@slack/bolt') as {
    App: new (cfg: {
      token: string;
      appToken: string;
      socketMode: boolean;
    }) => SlackBoltAppLike;
  };
  return new App({
    token: opts.botToken,
    appToken: opts.appToken,
    socketMode: true,
  });
};

const TEAM_LIMIT_PER_MIN = 50;

@injectable()
export class BoltSlackAdapter implements IMessagingAdapter {
  readonly platform = 'slack' as const;
  private app: SlackBoltAppLike | null = null;
  private listener: InboundListener | null = null;
  private connectionListener: ConnectionListener | null = null;
  private factory: SlackAppFactory = defaultFactory;
  private running = false;
  /**
   * Socket Mode health, separate from the start/stop lifecycle, so a dropped
   * websocket shows red in the Gateway tab instead of a permanent green
   * (TASK_2026_271).
   */
  private connected = false;

  private allowedTeamIds = new Set<string>();
  /** Sliding 60-second window of outbound timestamps (team-wide cap). */
  private recent: number[] = [];

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  configure(opts: {
    factory?: SlackAppFactory;
    allowedTeamIds?: ReadonlyArray<string>;
  }): void {
    if (opts.factory) this.factory = opts.factory;
    if (opts.allowedTeamIds) {
      this.allowedTeamIds = new Set(opts.allowedTeamIds);
    }
  }

  isRunning(): boolean {
    return this.running && this.connected;
  }

  onConnectionChange(listener: ConnectionListener): void {
    this.connectionListener = listener;
  }

  async start(token: string, opts?: { appToken?: string }): Promise<void> {
    if (this.running) {
      if (this.connected) return;
      // Started but the socket died and never came back (bolt's own
      // auto-reconnect gave up). A Start from the UI or the gateway's backoff
      // must rebuild the app rather than no-op on the stale `running` flag.
      await this.stop();
    }
    if (!token) throw new Error('Slack bot token is empty');
    if (!opts?.appToken)
      throw new Error('Slack app token is required for Socket Mode');
    if (!token.startsWith('xoxb-')) {
      throw new Error(
        'Slack adapter: bot token must start with "xoxb-" (got a different prefix — did you swap bot/app tokens?)',
      );
    }
    if (!opts.appToken.startsWith('xapp-')) {
      throw new Error(
        'Slack adapter: app-level token must start with "xapp-" (got a different prefix — did you swap bot/app tokens?)',
      );
    }
    this.app = this.factory({ botToken: token, appToken: opts.appToken });
    this.app.event('app_mention', async (args) => {
      try {
        await this.handleEvent(args);
      } catch (err) {
        this.logger.warn('[gateway] slack event handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    this.wireTransportEvents(this.app);
    await this.app.start();
    this.running = true;
    // `start()` resolves once Socket Mode is connected; the receiver's events
    // take over from here.
    this.connected = true;
    this.logger.info('[gateway] slack adapter started');
  }

  /**
   * bolt's transport signals. The receiver's `error` MUST be listened to — an
   * unlistened `error` on a Node EventEmitter throws and takes the host down.
   */
  private wireTransportEvents(app: SlackBoltAppLike): void {
    const reasonOf = (value: unknown): string =>
      value instanceof Error ? value.message : String(value);
    app.error?.((err: unknown) => {
      // A bolt-level error is a failed listener, not a dead socket; report the
      // cause and keep the current state (mirrors DiscordAdapter's `error`).
      this.logger.warn('[gateway] slack app error', { error: reasonOf(err) });
      this.emitConnection({
        state: this.connected ? 'connected' : 'reconnecting',
        reason: reasonOf(err),
      });
    });
    const socket = app.receiver?.client;
    if (!socket) return;
    socket.on('error', (err: unknown) => {
      this.logger.warn('[gateway] slack socket error', {
        error: reasonOf(err),
      });
      this.connected = false;
      this.emitConnection({ state: 'reconnecting', reason: reasonOf(err) });
    });
    socket.on('connected', () => {
      this.connected = true;
      this.emitConnection({ state: 'connected' });
    });
    socket.on('reconnecting', () => {
      this.connected = false;
      this.emitConnection({ state: 'reconnecting' });
    });
    socket.on('disconnected', (err: unknown) => {
      // bolt also emits this during our own stop(); only an unasked-for
      // disconnect is worth reporting.
      if (!this.running) return;
      this.connected = false;
      const reason =
        err === undefined
          ? 'Slack Socket Mode disconnected'
          : `Slack Socket Mode disconnected: ${reasonOf(err)}`;
      this.logger.warn('[gateway] slack socket disconnected', { reason });
      this.emitConnection({ state: 'disconnected', reason });
    });
  }

  private emitConnection(event: AdapterConnectionEvent): void {
    try {
      this.connectionListener?.(event);
    } catch (error: unknown) {
      this.logger.warn('[gateway] slack connection listener threw', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.connected = false;
    try {
      await this.app?.stop();
    } catch (err) {
      this.logger.warn('[gateway] slack app stop failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.app = null;
    this.recent = [];
  }

  async sendMessage(externalChatId: string, body: string): Promise<SendResult> {
    if (!this.app) throw new Error('Slack adapter not running');
    await this.respectTeamRateLimit();
    const res = await this.app.client.chat.postMessage({
      channel: externalChatId,
      text: body,
    });
    return { externalMsgId: res.ts };
  }

  async editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void> {
    if (!this.app) throw new Error('Slack adapter not running');
    await this.respectTeamRateLimit();
    await this.app.client.chat.update({
      channel: externalChatId,
      ts: externalMsgId,
      text: body,
    });
  }

  on(event: 'inbound', listener: InboundListener): void {
    if (event !== 'inbound') return;
    this.listener = listener;
  }

  private async handleEvent(args: SlackEventHandlerArgs): Promise<void> {
    if (!this.listener) return;
    const teamId = args.context.teamId ?? args.event.team;
    if (this.allowedTeamIds.size) {
      if (!teamId || !this.allowedTeamIds.has(teamId)) {
        this.logger.debug('[gateway] slack event rejected by allow-list', {
          teamId: teamId ?? '(undefined)',
        });
        return;
      }
    }
    const stripped = args.event.text.replace(/^<@[^>]+>\s*/, '').trim();
    const inbound: InboundMessage = {
      platform: 'slack',
      externalChatId: args.event.channel,
      displayName: undefined,
      externalMsgId: args.event.ts,
      body: stripped,
      conversationKey: ConversationKey.for('slack', args.event.channel),
      allowListId: teamId,
    };
    await this.listener(inbound);
  }

  private async respectTeamRateLimit(): Promise<void> {
    const now = Date.now();
    this.recent = this.recent.filter((ts) => ts > now - 60_000);
    if (this.recent.length >= TEAM_LIMIT_PER_MIN) {
      const wait = Math.max(50, this.recent[0] + 60_000 - now);
      await new Promise((r) => setTimeout(r, wait));
    }
    this.recent.push(Date.now());
  }
}
