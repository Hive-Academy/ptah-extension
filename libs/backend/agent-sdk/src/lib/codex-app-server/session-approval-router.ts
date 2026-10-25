import type {
  ISdkPermissionHandler,
  PermissionPromptCancelledPayload,
  PermissionResponse,
} from '@ptah-extension/shared';
import type { CodexChatApprovalReply } from './codex-chat-approval-sink';

export interface SessionApprovalAddress {
  readonly sessionId: string;
  readonly threadId: string;
  readonly requestId: string;
}
export interface CodexApprovalOwnerSink {
  readonly sessionId: string;
  readonly contextId: string;
  respond(value: unknown): boolean;
  cancel(threadId: string, requestId: string): boolean;
}

export function sessionApprovalKey(address: SessionApprovalAddress): string {
  return JSON.stringify([
    address.sessionId,
    address.threadId,
    address.requestId,
  ]);
}

type Owner =
  | { readonly kind: 'claude' }
  | {
      readonly kind: 'codex';
      readonly sink: CodexApprovalOwnerSink;
    };
export type SessionApprovalReply =
  | { readonly kind: 'claude'; readonly response: PermissionResponse }
  | { readonly kind: 'codex'; readonly response: CodexChatApprovalReply };

/** Ownership is registered when presenting, never inferred from focused provider. */
export class SessionApprovalRouter {
  private readonly owners = new Map<string, Owner>();
  constructor(
    private readonly claude: Pick<ISdkPermissionHandler, 'handleResponse'>,
    private readonly cancelled: (
      payload: PermissionPromptCancelledPayload,
    ) => void,
  ) {}

  register(address: SessionApprovalAddress, owner: Owner): () => void {
    const key = sessionApprovalKey(address);
    if (this.owners.has(key)) throw new Error('Approval already registered');
    if (owner.kind === 'codex' && owner.sink.sessionId !== address.sessionId)
      throw new Error('Approval session mismatch');
    this.owners.set(key, owner);
    return () => {
      if (this.owners.get(key) === owner) this.owners.delete(key);
    };
  }

  respond(
    address: SessionApprovalAddress,
    reply: SessionApprovalReply,
  ): boolean {
    const key = sessionApprovalKey(address);
    const owner = this.owners.get(key);
    if (!owner || owner.kind !== reply.kind) return false;
    if (owner.kind === 'claude' && reply.kind === 'claude') {
      if (reply.response.id !== address.requestId) return false;
      this.owners.delete(key);
      this.claude.handleResponse(address.requestId, reply.response);
      return true;
    }
    if (owner.kind === 'codex' && reply.kind === 'codex') {
      const response = reply.response;
      if (
        response.sessionId !== address.sessionId ||
        response.threadId !== address.threadId ||
        String(response.requestId) !== address.requestId ||
        response.contextId !== owner.sink.contextId
      )
        return false;
      if (!owner.sink.respond(response)) return false;
      this.owners.delete(key);
      return true;
    }
    return false;
  }

  /** Settle native ownership before dismissing the UI; cancellation is not a user reply. */
  cancelPrompt(
    address: SessionApprovalAddress,
    reason: PermissionPromptCancelledPayload['reason'],
  ): void {
    const key = sessionApprovalKey(address);
    const owner = this.owners.get(key);
    if (!owner) return;
    this.owners.delete(key);
    if (owner.kind === 'codex')
      owner.sink.cancel(address.threadId, address.requestId);
    this.cancelled({
      sessionId: address.sessionId,
      requestId: address.requestId,
      reason,
    });
  }
}
