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

export interface SlackBoltAppLike {
  client: SlackClientLike;
  event(
    eventType: 'app_mention',
    handler: (args: SlackEventHandlerArgs) => void | Promise<void>,
  ): void;
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
  private factory: SlackAppFactory = defaultFactory;
  private running = false;

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
    return this.running;
  }

  async start(token: string, opts?: { appToken?: string }): Promise<void> {
    if (this.running) return;
    if (!token) throw new Error('Slack bot token is empty');
    if (!opts?.appToken)
      throw new Error('Slack app token is required for Socket Mode');
    // SECURITY: validate token shape so a swapped pair (bot token in the
    // app-token slot) is rejected loudly rather than silently emitting a bot
    // token over the Socket Mode WebSocket handshake. Slack token prefixes:
    //   xoxb-... → bot token (HTTP API)
    //   xapp-... → app-level token (Socket Mode)
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
    await this.app.start();
    this.running = true;
    this.logger.info('[gateway] slack adapter started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
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
      // SECURITY: when an allowlist is configured, drop events where teamId
      // cannot be determined (both context and event fields undefined). A
      // falsy teamId cannot be verified against the allowlist, so it must
      // be rejected rather than passed through by accident.
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
