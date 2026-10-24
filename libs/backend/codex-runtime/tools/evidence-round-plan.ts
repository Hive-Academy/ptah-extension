import type { EvidenceCase } from './evidence-harness';

// decisions.md: total approval 35; 18 earlier turns + 1 failed first 7a = 19 used.
// --7a-turns-used accounts only for the subsequent rerun, never that failed turn.
const TOTAL_APPROVED_TURNS = 35;
const PREVIOUSLY_USED_TURNS = 18 + 1;
export const APPROVED_TURNS = TOTAL_APPROVED_TURNS - PREVIOUSLY_USED_TURNS;
export const ESTIMATE_LIMIT = 85_000;
export const CASE_TOKEN_ESTIMATES: Readonly<Record<string, number>> = {
  'schema-handshake': 0,
  'modified-input-schema': 0,
  'subagent-and-rewind': 0,
  'different-home-isolation': 12_000,
  'always-allow-scope': 3 * 12_000,
  'same-home-isolation': 24_000,
  'resume-history': 24_000,
  'profile-inputs': 15_000,
  'usage-semantics': 25_000,
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

// Proposed split: moving resume to 7b is necessary to fit the 85k estimate limit.
export const ROUND_ORDER = {
  '7a': [
    'schema-handshake',
    'modified-input-schema',
    'subagent-and-rewind',
    'different-home-isolation',
    'always-allow-scope',
    'same-home-isolation',
  ],
  '7b': [
    'schema-handshake',
    'modified-input-schema',
    'subagent-and-rewind',
    'resume-history',
    'profile-inputs',
    'usage-semantics',
  ],
} as const;

export function parseRoundArgs(args: readonly string[]): {
  round: '7a' | '7b';
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
  const round = take('--round') ?? '7a';
  if (round !== '7a' && round !== '7b')
    throw new Error('Round must be 7a or 7b');
  const used = take('--7a-turns-used');
  if (round === '7b' && used === undefined)
    throw new Error(
      '7b requires --7a-turns-used from the 7a artifact turnsConsumed',
    );
  if (round === '7a' && used !== undefined)
    throw new Error('7a cannot override prior turns');
  if (used !== undefined && !/^(0|[1-9][0-9]*)$/.test(used))
    throw new Error('Invalid --7a-turns-used');
  const priorTurnsUsed = Number(used ?? 0);
  if (priorTurnsUsed > APPROVED_TURNS)
    throw new Error('Prior turns exceed approval');
  if (rest.some((arg) => arg === '--turn-cap' || arg.startsWith('--turn-cap=')))
    throw new Error('Runner sets --turn-cap itself');
  return { round, priorTurnsUsed, args: rest };
}
