import type { ClaudeAccountRoute } from '@ptah-extension/auth-providers-tokens';
import { ClaudeCertifiedLaunchRefusal } from './claude-certified-launch';

/**
 * Ambient-only env pass-through. A named route never derives its child env
 * from a parent env: named callers build it with `certifiedNamedEnv` from a
 * certified launch, so a named route reaching this function refuses.
 */
export function applyClaudeAccountRouteEnv(
  baseEnv: Record<string, string | undefined>,
  route?: ClaudeAccountRoute,
): Record<string, string | undefined> {
  if (route?.kind !== 'named') return baseEnv;
  throw new ClaudeCertifiedLaunchRefusal('identity-unproved');
}
