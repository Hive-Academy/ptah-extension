import type { AuthOperationContext } from './auth-strategy.types';

export type CodexProxyPolicy = 'native-return' | 'legacy-strategy';

/** Native global auth must leave the shared Claude environment and proxies alone. */
export function resolveCodexProxyPolicy(
  context?: AuthOperationContext,
): CodexProxyPolicy {
  return context?.providerId === 'openai-codex' &&
    context.hostNativeCodex &&
    context.reason !== 'legacy-session-start'
    ? 'native-return'
    : 'legacy-strategy';
}
