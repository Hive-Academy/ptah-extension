import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId } from '@ptah-extension/shared';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import type {
  ApprovalSink,
  CodexApprovalCorrelation,
  CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type {
  PermissionPromptCancelledPayload,
  SessionApprovalDecision,
} from '@ptah-extension/shared';
import { classifyReadOnlyCommand, pathWithin, type ReadOnlyCommand } from './codex-read-only-command';

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
    private readonly permissionLevel: () => string | undefined = () => undefined,
    private readonly platform: string = process.platform,
    private readonly threadCwd: string | undefined = undefined,
    private readonly resolvePath: (value: string) => Promise<string> = realpath,
    private readonly systemRoot: string | undefined = process.env['SystemRoot'] ?? process.env['windir'],
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
    const details = request.details;
    let cwd = details['cwd'];
    if (typeof cwd === 'string' && cwd.startsWith('file:')) {
      try {
        cwd = fileURLToPath(cwd, { windows: this.platform === 'win32' });
      } catch {
        // degradation-audit: optional-capability - an invalid cwd URI cannot prove containment; show the card.
        return this.presentRequest(request, signal, key);
      }
    }
    // A proposed exec-policy amendment is ignored: this gate only returns plain accept for this request.
    const classified = this.permissionLevel() === 'ask' && request.kind === 'command' &&
      (details['kind'] === undefined || details['kind'] === 'command') &&
      details['networkApprovalContext'] == null &&
      details['environmentId'] == null &&
      details['proposedNetworkPolicyAmendments'] == null
      ? classifyReadOnlyCommand(details['command'], cwd, this.threadCwd, this.platform, { systemRoot: this.systemRoot })
      : undefined;
    if (classified && typeof cwd === 'string' && this.threadCwd)
      return this.acceptIfRealPathsStayInside(classified, cwd, signal)
        .then((accepted): Outcome | Promise<Outcome> => {
          if (this.disposed || signal.aborted) {
            this.seen.delete(key);
            return 'decline';
          }
          if (accepted) {
            this.seen.delete(key);
            this.logger.info('[CodexChatApprovalSink] accepted read-only command.', {
              commands: classified.names,
              // Boolean only: p8j decides whether a reason (a possible sandbox
              // escalation retry) must send the request to the card instead.
              hasReason: typeof details['reason'] === 'string' &&
                details['reason'].trim().length > 0,
            });
            return 'accept';
          }
          return this.presentRequest(request, signal, key);
        });
    return this.presentRequest(request, signal, key);
  }

  private async acceptIfRealPathsStayInside(
    classified: ReadOnlyCommand,
    cwd: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.threadCwd || signal.aborted) return false;
    const paths = this.platform === 'win32' ? path.win32 : path.posix;
    try {
      const boundary = await this.resolvePath(this.threadCwd);
      const targets = [cwd, ...classified.paths.map((value) => paths.resolve(cwd, value))];
      for (const target of targets) {
        if (signal.aborted || !pathWithin(await this.resolvePath(target), boundary, this.platform))
          return false;
      }
      return true;
    } catch {
      // degradation-audit: optional-capability - auto-accept fails closed: a
      // path that cannot be resolved is not proven inside the thread folder,
      // so the request goes to the normal permission card instead.
      return false;
    }
  }

  private presentRequest(request: CodexApprovalRequest, signal: AbortSignal, key: string): Promise<Outcome> {
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
        } catch (error) {
          this.logger.error(
            '[CodexChatApprovalSink] runtime-failed: cancellation presentation.',
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        try {
          this.presentation.dismiss(this.sessionId, request);
        } catch (error) {
          this.logger.error(
            '[CodexChatApprovalSink] runtime-failed: dismissal.',
            error instanceof Error ? error : new Error(String(error)),
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
      } catch (error) {
        this.logger.error(
          '[CodexChatApprovalSink] runtime-failed: presentation.',
          error instanceof Error ? error : new Error(String(error)),
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
      } catch (error) {
        this.logger.error(
          '[CodexChatApprovalSink] runtime-failed: replacement validation.',
          error instanceof Error ? error : new Error(String(error)),
        );
        text = undefined;
      }
      pending.settle({ decision: 'decline', editNotSupported: true });
      if (text?.trim()) {
        const editedText = text;
        // Resolve the decline first. The owner chooses steer/new turn at delivery time.
        setImmediate(() => {
          // A disposed sink belongs to a closed chat: never start its follow-up.
          if (this.disposed) return;
          void (async () => {
            await this.followUp.post(
              editedText,
              this.followUp.isTurnActive(reply.threadId) ? 'steer' : 'newTurn',
              pending.request,
            );
          })().catch((error) => {
            this.logger.error(
              '[CodexChatApprovalSink] runtime-failed: follow-up.',
              error instanceof Error ? error : new Error(String(error)),
            );
            try {
              this.followUp.failed();
            } catch (error) {
              this.logger.error(
                '[CodexChatApprovalSink] runtime-failed: follow-up reporting.',
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          });
        });
      }
      return true;
    }
    // acceptForSession is scoped and validated by the core rule store, never here.
    // Plain deny (cancel) and Allow drop any reason. A blank reason declines with no extra text.
    pending.settle(this.declineWithReason(reply.decision, reply.reason));
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

  endTurn(threadId: string, turnId: string): void {
    for (const pending of this.pending.values()) {
      if (
        pending.request.threadId === threadId &&
        pending.request.turnId === turnId
      )
        pending.settle('cancel', 'turn-ended');
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values())
      pending.settle('decline', 'disposed');
    this.seen.clear();
  }

  /** Typed deny text. Not an edit, and the reason is not logged. */
  private declineWithReason(
    decision: CodexChatApprovalReply['decision'],
    reason: string | undefined,
  ): Outcome {
    const text = reason?.trim();
    if (decision !== 'decline' || text === undefined || text.length === 0)
      return decision;
    return { decision: 'decline', denialReason: text };
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
