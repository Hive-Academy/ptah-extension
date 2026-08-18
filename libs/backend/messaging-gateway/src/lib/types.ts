/**
 * Branded types + shared enums for the messaging gateway.
 * Mirrors the `SessionId`/`MessageId` brand pattern from `@ptah-extension/shared`.
 */

export type GatewayPlatform = 'telegram' | 'discord' | 'slack';

export type BindingId = string & { readonly __brand: 'BindingId' };
export const BindingId = {
  /** Construct a BindingId from a non-empty string. Throws on invalid input. */
  create(value: string): BindingId {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        `BindingId.create: expected non-empty string, received ${typeof value}`,
      );
    }
    return value as BindingId;
  },
  /** Non-throwing variant — returns null on invalid input. */
  safeParse(value: unknown): BindingId | null {
    return typeof value === 'string' && value.length > 0
      ? (value as BindingId)
      : null;
  },
};

export type GatewayMessageId = string & {
  readonly __brand: 'GatewayMessageId';
};
export const GatewayMessageId = {
  /** Construct a GatewayMessageId from a non-empty string. Throws on invalid input. */
  create(value: string): GatewayMessageId {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        `GatewayMessageId.create: expected non-empty string, received ${typeof value}`,
      );
    }
    return value as GatewayMessageId;
  },
};

/**
 * `${platform}:${externalChatId}` — used as p-queue key. Threaded
 * conversations append a third `:${conversationId}` segment; the `'default'`
 * conversation never appears in the key, so non-threaded platforms produce
 * byte-identical keys to the 2-arg form.
 */
export type ConversationKey = string & { readonly __brand: 'ConversationKey' };
export const ConversationKey = {
  for(
    platform: GatewayPlatform,
    externalChatId: string,
    conversationId?: string,
  ): ConversationKey {
    const base = `${platform}:${externalChatId}`;
    return (
      conversationId !== undefined && conversationId !== 'default'
        ? `${base}:${conversationId}`
        : base
    ) as ConversationKey;
  },
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type Direction = 'inbound' | 'outbound';

export interface GatewayBinding {
  id: BindingId;
  platform: GatewayPlatform;
  externalChatId: string;
  /** Allow-list id captured at inbound: Telegram user / Discord guild / Slack team. */
  allowListId: string | null;
  displayName: string | null;
  approvalStatus: ApprovalStatus;
  ptahSessionId: string | null;
  workspaceRoot: string | null;
  /** 6-digit pairing code, hidden once approved. */
  pairingCode: string | null;
  createdAt: number;
  approvedAt: number | null;
  lastActiveAt: number | null;
}

export type GatewayConversationId = string & {
  readonly __brand: 'GatewayConversationId';
};

export interface GatewayConversation {
  id: GatewayConversationId;
  bindingId: BindingId;
  /** Discord thread id, or `'default'` for non-threaded platforms. */
  externalConversationId: string;
  ptahSessionId: string | null;
  /** Conversation-pinned workspace root; NULL = inherit `binding.workspaceRoot`. */
  workspaceRoot: string | null;
  createdAt: number;
  lastActiveAt: number | null;
}

/**
 * Durable lifecycle of the agent turn an INBOUND message drives (TASK_2026_277).
 *
 * `'queued'` is stamped at persist time, `'running'` when the bridge actually
 * starts the turn, and `'done'` / `'failed'` in the turn's `finally`. A row left
 * in `'queued'` or `'running'` can only mean the host process died mid-flight;
 * the next boot moves it to `'interrupted'` and tells the sender to resend.
 *
 * `'interrupted'` is deliberately terminal: a half-finished turn at
 * `auto-edit` / `yolo` may already have run `Write` or `Bash`, so replaying it
 * would repeat side effects with no idempotency guarantee. Notify, never replay.
 */
export type GatewayTurnState =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'interrupted';

export interface GatewayMessage {
  id: GatewayMessageId;
  bindingId: BindingId;
  direction: Direction;
  externalMsgId: string | null;
  ptahMessageId: string | null;
  body: string;
  voicePath: string | null;
  createdAt: number;
  /** Turn lifecycle for inbound rows; NULL for outbound and pre-0038 rows. */
  turnState: GatewayTurnState | null;
  /**
   * Conversation the message belongs to. Carried on the row so the restart
   * notice can be batched per conversation — a binding may serve several
   * Discord threads. NULL for outbound and pre-0038 rows.
   */
  conversationId: GatewayConversationId | null;
}
