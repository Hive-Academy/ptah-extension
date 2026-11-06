import {
  AuthRequiredError,
  CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE,
} from '@ptah-extension/agent-sdk';
import type { AuthOperationContext } from './auth-strategy.types';

export { CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE };

/** Native hosts own Codex authentication except for historical SDK sessions. */
export function isNativeCodexAuthIntent(
  context?: AuthOperationContext,
): boolean {
  return (
    context?.providerId === 'openai-codex' &&
    context.hostNativeCodex &&
    context.reason !== 'legacy-session-start'
  );
}

export function codexNativeRuntimeRequired(
  recoveryHint?: string,
): AuthRequiredError {
  return new AuthRequiredError(CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE, {
    providerId: 'openai-codex',
    ...(recoveryHint !== undefined ? { recoveryHint } : {}),
  });
}
