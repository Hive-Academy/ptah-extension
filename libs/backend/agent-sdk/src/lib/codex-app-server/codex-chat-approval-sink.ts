import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId } from '@ptah-extension/shared';
import { z } from 'zod';
import type {
  ApprovalSink,
  CodexApprovalCorrelation,
  CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type {
  PermissionPromptCancelledPayload,
  SessionApprovalDecision,
} from '@ptah-extension/shared';

export const CODEX_CHAT_APPROVAL_CHOICES = [
  'deny',
  'allowOnce',
  'allowWithInput',
  'alwaysAllow',
] as const;
const replySchema = z
  .object({
    sessionId: z.string(),
    contextId: z.string(),
    processGeneration: z.number().int(),
    threadId: z.string(),
    turnId: z.string(),
    requestId: z.union([z.string(), z.number()]),
    decision: z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
    reason: z.string().optional(),
    modifiedInput: z.record(z.string(), z.unknown()).optional(),
    editedText: z.string().min(1).optional(),
  })
  .strict();
export interface CodexChatApprovalReply extends CodexApprovalCorrelation {
  readonly sessionId: string;
  readonly decision: SessionApprovalDecision;
  readonly reason?: string;
  readonly modifiedInput?: Readonly<Record<string, unknown>>;
  readonly editedText?: string;
}
export interface CodexChatApprovalPresentation {
  present(
    sessionId: SessionId,
    request: CodexApprovalRequest,
    choices: typeof CODEX_CHAT_APPROVAL_CHOICES,
  ): void;
  dismiss(sessionId: SessionId, request: CodexApprovalRequest): void;
  cancelPrompt(payload: PermissionPromptCancelledPayload): void;
}
export interface CodexChatApprovalFollowUp {
  /** Validate replacement fields against the request and return the user's text. */
  validateReplacement(
    request: CodexApprovalRequest,
    input: Readonly<Record<string, unknown>>,
  ): string | undefined;
  isTurnActive(threadId: string): boolean;
  post(
    text: string,
    mode: 'steer' | 'newTurn',
    request: CodexApprovalRequest,
  ): Promise<void>;
  failed(): void;
}
type Outcome = Awaited<ReturnType<ApprovalSink['request']>>;
interface PendingApproval {
  readonly request: CodexApprovalRequest;
  settle(
    outcome: Outcome,
    reason?: PermissionPromptCancelledPayload['reason'],
  ): void;
}

/** One sink per runtime context, explicitly bound by the composition owner. */
export class CodexChatApprovalSink implements ApprovalSink {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly seen = new Set<string>();
  private disposed = false;

  constructor(
    readonly sessionId: SessionId,
    readonly contextId: string,
    private readonly presentation: CodexChatApprovalPresentation,
    private readonly followUp: CodexChatApprovalFollowUp,
    private readonly logger: Logger,
  ) {}

  request(
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const key = this.key(request);
    if (
      this.disposed ||
      signal.aborted ||
      request.contextId !== this.contextId ||
      this.seen.has(key)
    )
      return Promise.resolve('decline');
    this.seen.add(key);
    return new Promise<Outcome>((resolve) => {
      const abort = () => settle('decline', 'turn-ended');
      const settle = (
        outcome: Outcome,
        reason?: PermissionPromptCancelledPayload['reason'],
      ) => {
        if (!this.pending.delete(key)) return;
        this.seen.delete(key);
        signal.removeEventListener('abort', abort);
        try {
          if (reason)
            this.presentation.cancelPrompt({
              sessionId: this.sessionId,
              requestId: String(request.requestId),
              reason,
            });
        } catch {
          this.logger.error(
            '[CodexChatApprovalSink] runtime-failed: cancellation presentation.',
          );
        }
        try {
          this.presentation.dismiss(this.sessionId, request);
        } catch {
          this.logger.error(
            '[CodexChatApprovalSink] runtime-failed: dismissal.',
          );
        }
        resolve(outcome);
      };
      this.pending.set(key, { request, settle });
      signal.addEventListener('abort', abort, { once: true });
      try {
        if (signal.aborted) abort();
        else
          this.presentation.present(
            this.sessionId,
            request,
            CODEX_CHAT_APPROVAL_CHOICES,
          );
      } catch {
        this.logger.error(
          '[CodexChatApprovalSink] runtime-failed: presentation.',
        );
        settle('decline');
      }
    });
  }

  /** False means malformed, stale, duplicate or owned by another context. */
  respond(value: unknown): boolean {
    const parsed = replySchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.sessionId !== this.sessionId ||
      parsed.data.contextId !== this.contextId
    )
      return false;
    const reply = parsed.data;
    const pending = this.pending.get(this.key(reply));
    if (!pending) return false;
    if (reply.modifiedInput !== undefined || reply.editedText !== undefined) {
      let text: string | undefined;
      try {
        text =
          reply.modifiedInput !== undefined
            ? this.followUp.validateReplacement(
                pending.request,
                reply.modifiedInput,
              )
            : reply.editedText;
      } catch {
        this.logger.error(
          '[CodexChatApprovalSink] runtime-failed: replacement validation.',
        );
        text = undefined;
      }
      pending.settle({ decision: 'decline', editNotSupported: true });
      if (text?.trim()) {
        const editedText = text;
        // Resolve the decline first. The owner chooses steer/new turn at delivery time.
        void Promise.resolve()
          .then(() =>
            this.followUp.post(
              editedText,
              this.followUp.isTurnActive(reply.threadId) ? 'steer' : 'newTurn',
              pending.request,
            ),
          )
          .catch(() => {
            this.logger.error(
              '[CodexChatApprovalSink] runtime-failed: follow-up.',
            );
            try {
              this.followUp.failed();
            } catch {
              this.logger.error(
                '[CodexChatApprovalSink] runtime-failed: follow-up reporting.',
              );
            }
          });
      }
      return true;
    }
    // acceptForSession is scoped and validated by the core rule store, never here.
    pending.settle(reply.decision);
    return true;
  }

  cancel(threadId: string, requestId: string): boolean {
    for (const pending of this.pending.values()) {
      if (
        pending.request.threadId === threadId &&
        String(pending.request.requestId) === requestId
      ) {
        pending.settle('cancel');
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values())
      pending.settle('decline', 'disposed');
    this.seen.clear();
  }

  private key(value: CodexApprovalCorrelation): string {
    return JSON.stringify([
      value.contextId,
      value.processGeneration,
      value.threadId,
      value.turnId,
      value.requestId,
    ]);
  }
}
