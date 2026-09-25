import type { ClaudeRpcService } from '@ptah-extension/core';
import type { SessionId } from '@ptah-extension/shared';

/**
 * The `chat:abort` call shared by the three stop paths of
 * `AppsSessionService`: Stop, "New conversation" and a start that completed
 * after its conversation was released. Each path decides what a failure
 * means for its own slice; this module only reports it.
 */

/** The error's message, or `fallback` for a non-Error or an empty message. */
export function failureText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

const ABORT_FAILED = 'Failed to stop the agent.';

/**
 * Send `chat:abort` for `sessionId`. Resolves null when the host stopped the
 * agent, or the user-facing reason when it did not (a failed result or a
 * transport error). Never throws.
 */
export async function abortAppsSession(
  rpc: ClaudeRpcService,
  sessionId: SessionId,
): Promise<string | null> {
  try {
    const result = await rpc.call('chat:abort', { sessionId });
    if (!result.success || result.data?.success === false)
      return result.data?.error ?? result.error ?? ABORT_FAILED;
    return null;
  } catch (error: unknown) {
    return failureText(error, ABORT_FAILED);
  }
}
