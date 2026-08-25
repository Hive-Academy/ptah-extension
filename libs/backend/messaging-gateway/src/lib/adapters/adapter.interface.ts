/**
 * IMessagingAdapter — platform-agnostic contract that every
 * gateway adapter (Telegram, Discord, Slack) implements.
 *
 * Architecture §9 Track 4 requirement 6:
 * "Adapter contract: start(), stop(), sendMessage(), editMessage(), on('inbound', listener)."
 */
import type { GatewayPlatform, ConversationKey } from '../types';
import type { IGatewayCommandHandler } from '../commands/gateway-command.types';

/**
 * An inbound message normalised across providers. The adapter is
 * responsible for translating provider-specific payloads into this shape
 * before calling the listener.
 */
export interface InboundMessage {
  readonly platform: GatewayPlatform;
  /** Provider-specific stable conversation id (chat id / channel id). */
  readonly externalChatId: string;
  /** Display name for the chat (group title or DM username). */
  readonly displayName?: string;
  /** Provider-specific monotonic message id (used for dedup via UNIQUE). */
  readonly externalMsgId: string;
  /** Original textual body (transcribed text already substituted for voice). */
  readonly body: string;
  /** Absolute path to a voice file if the message was voice-only. */
  readonly voicePath?: string;
  /** Convenience composite: `${platform}:${externalChatId}`. */
  readonly conversationKey: ConversationKey;
  /** Allow-list filter id (Telegram user id / Discord guild / Slack team). */
  readonly allowListId?: string;
  /** External sub-conversation id (Discord thread id). Absent for non-threaded platforms. */
  readonly conversationId?: string;
  /**
   * `'open'` (default when absent) = today's pairing behavior; `'attach'` =
   * dispatch only into an existing APPROVED binding — never upsertPending,
   * never pairing-prompt.
   */
  readonly conversationMode?: 'open' | 'attach';
}

/** Listener registered by GatewayService on adapter start. */
export type InboundListener = (msg: InboundMessage) => void | Promise<void>;

/**
 * Live connection state of an adapter's transport, as opposed to the
 * start/stop lifecycle. `'connected'` = messages flow; `'reconnecting'` = the
 * client library is retrying on its own; `'invalidated'` = the platform
 * revoked the session and the library will NOT retry — the gateway must
 * destroy and re-login (TASK_2026_271 #3/#4).
 */
export type AdapterConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'invalidated';

export interface AdapterConnectionEvent {
  readonly state: AdapterConnectionState;
  /** Human-readable cause when the transition was an error. */
  readonly reason?: string;
}

export type ConnectionListener = (event: AdapterConnectionEvent) => void;

/**
 * Outbound send result — `externalMsgId` is the provider's id for the
 * outbound message. `editMessage` requires this id to make in-place
 * edits work (Discord followup, Slack chat.update, Telegram editMessageText).
 */
export interface SendResult {
  readonly externalMsgId: string;
}

export interface IMessagingAdapter {
  readonly platform: GatewayPlatform;
  /**
   * Maximum characters the platform accepts in a single message body. When
   * set, the gateway paginates longer cumulative replies across multiple
   * messages instead of letting the platform reject the whole edit. Discord =
   * 2000. Omit for platforms with no practical limit.
   */
  readonly maxMessageChars?: number;
  /** Open long-lived connection (long-polling / websocket / socket-mode). */
  start(token: string, opts?: { appToken?: string }): Promise<void>;
  /** Close all sockets, cancel timers. Idempotent. */
  stop(): Promise<void>;
  /**
   * True between successful start() and stop() AND while the transport is
   * usable. An adapter whose client library reports a disconnect or a
   * revoked session must return false here even though stop() was never
   * called — the Gateway tab renders this flag as the green/red dot.
   */
  isRunning(): boolean;
  /**
   * Optional connection-state hook. Adapters whose client library surfaces
   * transport events (discord.js shard events) forward them here so
   * `GatewayService` can update status, record the error, and — on
   * `'invalidated'` — restart the adapter. Exactly ONE listener per adapter.
   */
  onConnectionChange?(listener: ConnectionListener): void;
  /**
   * Send an outbound message. Rate-limited internally. When
   * `opts.conversationId` is provided the adapter routes into that
   * sub-conversation (Discord thread) instead of the parent channel.
   */
  sendMessage(
    externalChatId: string,
    body: string,
    opts?: { conversationId?: string },
  ): Promise<SendResult>;
  /**
   * Edit a previously-sent message in place. Used by the StreamCoalescer
   * to update a single chat bubble while the agent streams.
   */
  editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void>;
  /**
   * Optional "bot is working" signal (Discord `sendTyping`, Telegram
   * `sendChatAction('typing')`, Slack has no equivalent → omit). Best-effort:
   * failures are the adapter's to swallow and log; never throws to the caller.
   * The bridge calls it when a turn starts and re-arms it while the turn runs
   * so a long tool call or an approval wait does not look like a dead bot.
   */
  sendTyping?(
    externalChatId: string,
    opts?: { conversationId?: string },
  ): Promise<void>;
  /** Register the inbound listener — exactly ONE listener per adapter. */
  on(event: 'inbound', listener: InboundListener): void;
  /**
   * Optional control-plane hook (TASK_2026_156). Adapters with a native
   * command surface (Discord slash commands) route control commands and
   * autocomplete requests to this handler instead of the inbound listener —
   * a command never becomes an agent turn (AC-1.3). Adapters without a
   * command surface simply omit this member.
   */
  setCommandHandler?(handler: IGatewayCommandHandler): void;
}
