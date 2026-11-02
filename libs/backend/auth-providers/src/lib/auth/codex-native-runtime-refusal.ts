import { AuthRequiredError } from '@ptah-extension/agent-sdk';

export const CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE =
  'Codex chat requires a host with the native Codex runtime.';

export function codexNativeRuntimeRequired(
  recoveryHint?: string,
): AuthRequiredError {
  return new AuthRequiredError(CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE, {
    providerId: 'openai-codex',
    ...(recoveryHint !== undefined ? { recoveryHint } : {}),
  });
}
