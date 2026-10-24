import type { EvidenceCase } from './evidence-harness';

// decisions.md: 18 earlier + 1 failed 7a + 3 in 7a2 = 22 used.
// Prior usage below counts all subsequent attempts, including failures and steers.
const TOTAL_APPROVED_TURNS = 35;
const PREVIOUSLY_USED_TURNS = 22;
export const APPROVED_TURNS = TOTAL_APPROVED_TURNS - PREVIOUSLY_USED_TURNS;
export const ESTIMATE_LIMIT = 85_000;
export const CASE_TOKEN_ESTIMATES: Readonly<Record<string, number>> = {
  'schema-handshake': 0,
  'modified-input-schema': 0,
  'subagent-and-rewind': 0,
  'different-home-isolation': 24_000,
  'always-allow-scope': 24_000 + 16_000 + 24_000,
  'same-home-isolation': 2 * 24_000,
  'resume-history': 2 * 16_000,
  'profile-inputs': 16_000,
};

export function roundPlan(
  cases: readonly EvidenceCase[],
  priorTurnsUsed: number,
) {
  if (
    !Number.isSafeInteger(priorTurnsUsed) ||
    priorTurnsUsed < 0 ||
    priorTurnsUsed > APPROVED_TURNS
  )
    throw new Error(
      `Prior turns used must be an integer from 0 to ${APPROVED_TURNS}`,
    );
  const remaining = APPROVED_TURNS - priorTurnsUsed;
  const plannedTurns = cases.reduce((sum, item) => sum + item.turnCost, 0);
  const cap = plannedTurns + 1;
  const estimatedTokens = cases.reduce((sum, item) => {
    const estimate = CASE_TOKEN_ESTIMATES[item.id];
    if (estimate === undefined) throw new Error('Case token estimate missing');
    return sum + estimate;
  }, 0);
  if (estimatedTokens > ESTIMATE_LIMIT)
    throw new Error('Estimated tokens exceed 85000');
  if (cap > remaining) throw new Error('Cap exceeds remaining approved turns');
  return { plannedTurns, cap, remaining, priorTurnsUsed, estimatedTokens };
}

// Repeat the complete scope proof in one thread. Usage semantics and different-home
// isolation were answered by 7a2; do not spend another turn on them.
export const ROUND_ORDER = {
  '7c': [
    'schema-handshake',
    'modified-input-schema',
    'subagent-and-rewind',
    'always-allow-scope',
  ],
  '7d': [
    'schema-handshake',
    'modified-input-schema',
    'subagent-and-rewind',
    'same-home-isolation',
  ],
  '7e': [
    'schema-handshake',
    'modified-input-schema',
    'subagent-and-rewind',
    'resume-history',
    'profile-inputs',
  ],
  // 7e stopped at the rollback probe after resume; profile inputs run alone.
  '7f': ['schema-handshake', 'modified-input-schema', 'profile-inputs'],
} as const;

export function parseRoundArgs(args: readonly string[]): {
  round: keyof typeof ROUND_ORDER;
  priorTurnsUsed: number;
  args: string[];
} {
  const rest = [...args];
  const take = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    if (index < 0) return undefined;
    const value = rest[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing ${name} value`);
    rest.splice(index, 2);
    if (rest.includes(name)) throw new Error(`Duplicate ${name}`);
    return value;
  };
  const round = take('--round') ?? '7c';
  if (round !== '7c' && round !== '7d' && round !== '7e' && round !== '7f')
    throw new Error('Round must be 7c, 7d, 7e or 7f');
  const used = take('--prior-turns-used');
  if (round !== '7c' && used === undefined)
    throw new Error(
      'Later rounds require --prior-turns-used: sum turnsConsumed from all attempts after 7a2',
    );
  if (used !== undefined && !/^(0|[1-9][0-9]*)$/.test(used))
    throw new Error('Invalid --prior-turns-used');
  const priorTurnsUsed = Number(used ?? 0);
  if (priorTurnsUsed > APPROVED_TURNS)
    throw new Error('Prior turns exceed approval');
  if (rest.some((arg) => arg === '--turn-cap' || arg.startsWith('--turn-cap=')))
    throw new Error('Runner sets --turn-cap itself');
  return { round, priorTurnsUsed, args: rest };
}
