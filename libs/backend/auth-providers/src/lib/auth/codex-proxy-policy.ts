import type { AuthOperationContext } from './auth-strategy.types';

export type CodexProxyPolicy = 'native-return' | 'legacy-strategy';

/** Native intent skips proxy configuration; AuthManager tears down its previous strategy. */
export function resolveCodexProxyPolicy(
  context?: AuthOperationContext,
): CodexProxyPolicy {
  return context?.providerId === 'openai-codex' &&
    context.hostNativeCodex &&
    context.reason !== 'legacy-session-start'
    ? 'native-return'
    : 'legacy-strategy';
}
