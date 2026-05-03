/**
 * IMessagingAdapter — platform-agnostic contract that every
 * gateway adapter (Telegram, Discord, Slack) implements.
 *
 * Architecture §9 Track 4 requirement 6:
 * "Adapter contract: start(), stop(), sendMessage(), editMessage(), on('inbound', listener)."
 */
import type { GatewayPlatform, ConversationKey } from '../types';

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
}

/** Listener registered by GatewayService on adapter start. */
export type InboundListener = (msg: InboundMessage) => void | Promise<void>;

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
  /** Open long-lived connection (long-polling / websocket / socket-mode). */
  start(token: string, opts?: { appToken?: string }): Promise<void>;
  /** Close all sockets, cancel timers. Idempotent. */
  stop(): Promise<void>;
  /** True between successful start() and stop(). */
  isRunning(): boolean;
  /** Send an outbound message. Rate-limited internally. */
  sendMessage(externalChatId: string, body: string): Promise<SendResult>;
  /**
   * Edit a previously-sent message in place. Used by the StreamCoalescer
   * to update a single chat bubble while the agent streams.
   */
  editMessage(
    externalChatId: string,
    externalMsgId: string,
    body: string,
  ): Promise<void>;
  /** Register the inbound listener — exactly ONE listener per adapter. */
  on(event: 'inbound', listener: InboundListener): void;
}
