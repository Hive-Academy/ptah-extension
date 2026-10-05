/**
 * Subagent prompt-cache state.
 *
 * A subagent's prompt cache stays warm while the time since its last activity
 * is below the effective subagent prompt-cache TTL. Resuming a warm subagent
 * reads its cached prefix; resuming a cold one pays the full prefix again.
 */

import type { SubagentPromptCacheTtl } from '../types/rpc/rpc-agents.types';
import type { SubagentCacheInfo } from '../types/subagent-registry.types';

const TTL_MS: Readonly<Record<SubagentPromptCacheTtl, number>> = {
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

/**
 * Derive warm/cold from the last activity timestamp.
 *
 * - No (or a non-finite) timestamp: `'cold'`, `idleMs` 0 (idle time unknown).
 * - Timestamp in the future: `'warm'`, `idleMs` 0.
 * - Otherwise `'warm'` only while `idleMs` is strictly below the TTL; an idle
 *   time exactly equal to the TTL is `'cold'`.
 */
export function computeSubagentCacheState(
  lastActivityAt: number | undefined,
  effectiveTtl: SubagentPromptCacheTtl,
  now: number,
): SubagentCacheInfo {
  if (lastActivityAt === undefined || !Number.isFinite(lastActivityAt)) {
    return { cacheState: 'cold', effectiveTtl, idleMs: 0 };
  }
  const idleMs = Math.max(0, now - lastActivityAt);
  return {
    cacheState: idleMs < TTL_MS[effectiveTtl] ? 'warm' : 'cold',
    effectiveTtl,
    idleMs,
  };
}
