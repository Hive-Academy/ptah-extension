import type {
  ISdkPermissionHandler,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { SessionLogWriter } from './session-log-writer';

export class PermissionAnswerError extends Error {
  readonly code = 'ALREADY_ANSWERED';
  constructor() {
    super('The permission request was already answered or expired.');
  }
}

export function assertManualApproval(
  argv: readonly string[],
  autoApprove: string | undefined,
): void {
  if (argv.includes('--auto-approve') || autoApprove === 'true')
    throw new Error(
      'The worker requires manual approval for remote permission requests.',
    );
}

interface Pending {
  sessionId: string;
  request: PermissionRequest;
}

/** Consumes the request before invoking the SDK, so concurrent replies cannot both win. */
export class PendingPermissionIndex {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly handler: ISdkPermissionHandler) {}

  add(request: PermissionRequest, sessionFromTab?: string): void {
    const sessionId = request.sessionId ?? sessionFromTab;
    if (sessionId) this.pending.set(request.id, { sessionId, request });
  }

  remove(requestId: string): void {
    this.pending.delete(requestId);
  }
  clearSession(sessionId: string): void {
    for (const [id, entry] of this.pending)
      if (entry.sessionId === sessionId) this.pending.delete(id);
  }

  async answer(
    sessionId: string,
    response: PermissionResponse,
    by: string,
    writer: SessionLogWriter,
  ): Promise<void> {
    if (response.decision !== 'allow' && response.decision !== 'deny')
      throw new PermissionAnswerError();
    const entry = this.pending.get(response.id);
    if (!entry || entry.sessionId !== sessionId)
      throw new PermissionAnswerError();
    this.pending.delete(response.id);
    this.handler.handleResponse(response.id, response);
    await writer.enqueue('worker:permission.answered', {
      requestId: response.id,
      decision: response.decision,
      by,
    });
  }
}
