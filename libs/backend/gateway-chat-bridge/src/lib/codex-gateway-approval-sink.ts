import type {
  ApprovalSink,
  CodexApprovalDecision,
  CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';

export const CODEX_GATEWAY_APPROVAL_CHOICES: readonly CodexApprovalDecision[] =
  Object.freeze(['accept', 'acceptForSession', 'decline', 'cancel']);

/** Bound to one conversation by composition; notices never carry decisions. */
export interface CodexGatewayApprovalPresentation {
  sendNotice(text: string): Promise<void>;
  /** Absent when no authenticated approval surface can route this request. */
  present?: (
    request: CodexApprovalRequest,
    choices: readonly CodexApprovalDecision[],
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Remove only this correlated prompt, including after a timeout. */
  dismiss(request: CodexApprovalRequest): void;
}

/** Core owns deadlines, correlation validation and session-scoped rules. */
export class CodexGatewayApprovalSink implements ApprovalSink {
  constructor(
    private readonly presentation: CodexGatewayApprovalPresentation,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  async request(
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ): ReturnType<ApprovalSink['request']> {
    if (signal.aborted) return 'cancel';
    if (!this.presentation.present || request.kind === 'userInput') {
      this.notice(
        'Ptah could not route the required Codex interaction and declined it.',
      );
      return 'decline';
    }

    this.notice(
      'Ptah needs Codex approval in the connected approval surface: accept, accept for session, decline, or cancel. To edit, decline and send a follow-up message. Unanswered requests are cancelled.',
    );
    let abort: () => void = () => undefined;
    const cancelled = new Promise<'cancel'>((resolve) => {
      abort = () => resolve('cancel');
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const reply = await Promise.race([
        this.presentation.present(
          request,
          CODEX_GATEWAY_APPROVAL_CHOICES,
          signal,
        ),
        cancelled,
      ]);
      if (signal.aborted) return 'cancel';
      if (
        reply === 'accept' ||
        reply === 'acceptForSession' ||
        reply === 'decline' ||
        reply === 'cancel'
      )
        return reply;
      if (
        typeof reply === 'object' &&
        reply !== null &&
        ('updatedInput' in reply ||
          'modifiedInput' in reply ||
          'editedInput' in reply)
      )
        return { decision: 'decline', editNotSupported: true };
      return 'decline';
    } catch {
      this.logger.warn('[codex-gateway] approval presentation failed');
      return signal.aborted ? 'cancel' : 'decline';
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        this.presentation.dismiss(request);
      } catch {
        this.logger.warn('[codex-gateway] approval dismissal failed');
      }
      if (signal.aborted)
        this.notice(
          'No Codex approval arrived before cancellation; Ptah did not approve the action.',
        );
    }
  }

  private notice(text: string): void {
    // Delivery is best-effort and must not hold the core approval deadline open.
    void Promise.resolve()
      .then(() => this.presentation.sendNotice(text))
      .catch(() => {
        this.logger.warn('[codex-gateway] approval notice not delivered');
      });
  }
}
