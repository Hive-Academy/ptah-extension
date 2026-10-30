export class CodexChatAdapterError extends Error {
  readonly webviewReported?: true;

  constructor(
    readonly code:
      | 'unsupported'
      | 'unavailable'
      | 'busy'
      | 'runtime-failed'
      | 'resume-profile-changed'
      | 'cancelled'
      | 'identity-mismatch',
    readonly operation: string,
    options?: ErrorOptions & { webviewReported?: true },
  ) {
    super(`Codex chat ${operation}: ${code}`, options);
    this.name = 'CodexChatAdapterError';
    this.webviewReported = options?.webviewReported;
  }
}

export type CodexChatAdapterErrorCode = CodexChatAdapterError['code'];

export function isCodexChatAdapterError(
  error: unknown,
): error is CodexChatAdapterError {
  return error instanceof CodexChatAdapterError;
}

/** A host callback already delivered the visible error for this failure. */
export function isWebviewReportedError(error: unknown): boolean {
  return error instanceof Error &&
    'webviewReported' in error &&
    error.webviewReported === true;
}
