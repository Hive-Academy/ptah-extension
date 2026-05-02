/**
 * Branded types + shared enums for the messaging gateway.
 * Mirrors the `SessionId`/`MessageId` brand pattern from `@ptah-extension/shared`.
 */

export type GatewayPlatform = 'telegram' | 'discord' | 'slack';

export type BindingId = string & { readonly __brand: 'BindingId' };
export const BindingId = {
  create(value: string): BindingId {
    return value as BindingId;
  },
};

export type GatewayMessageId = string & {
  readonly __brand: 'GatewayMessageId';
};
export const GatewayMessageId = {
  create(value: string): GatewayMessageId {
    return value as GatewayMessageId;
  },
};

/** `${platform}:${externalChatId}` — used as p-queue key. */
export type ConversationKey = string & { readonly __brand: 'ConversationKey' };
export const ConversationKey = {
  for(platform: GatewayPlatform, externalChatId: string): ConversationKey {
    return `${platform}:${externalChatId}` as ConversationKey;
  },
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type Direction = 'inbound' | 'outbound';

export interface GatewayBinding {
  id: BindingId;
  platform: GatewayPlatform;
  externalChatId: string;
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

export interface GatewayMessage {
  id: GatewayMessageId;
  bindingId: BindingId;
  direction: Direction;
  externalMsgId: string | null;
  ptahMessageId: string | null;
  body: string;
  voicePath: string | null;
  createdAt: number;
}
