export const CODEX_RESUME_PROFILE_CHANGED_CODE = 'resume-profile-changed' as const;
export const CODEX_RESUME_PROFILE_CHANGED_MESSAGE = 'Codex cannot resume this chat because its execution profile has changed. Start a new chat to use the current permission policy.';

/** A stored thread must not silently adopt a different execution policy. */
export class CodexResumeProfileChangedError extends Error {
  readonly code = CODEX_RESUME_PROFILE_CHANGED_CODE;

  constructor() {
    super(CODEX_RESUME_PROFILE_CHANGED_MESSAGE);
    this.name = 'CodexResumeProfileChangedError';
  }
}

export function isCodexResumeProfileChangedError(
  error: unknown,
): error is CodexResumeProfileChangedError {
  return error instanceof CodexResumeProfileChangedError;
}
