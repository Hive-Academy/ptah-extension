/**
 * The pre-spawn limit gate both `ptah_agent_spawn` transports run before
 * `agent.spawn` (cli-lane-limits, Components 8 and 10).
 *
 * A spawn that names a lane (`ptahCliId` wins over `cli`) is refused when the
 * lane is at its plan limit, in an active cooldown, or reads a fresh 100 %
 * window. An unknown lane spawns with a one-line note. An auto-detected spawn,
 * an unlisted lane and an uninstalled or disabled lane are never gated: the
 * spawn's own error stays the answer. Pure; no static string names a vendor.
 */
import {
  formatToolInstant,
  type CliDetectionResult,
} from '@ptah-extension/shared';
import {
  findAgentLimit,
  formatAlternatives,
  laneBlock,
  rowName,
  targetRowKey,
  unknownCause,
  type AgentLimit,
  type AgentLimitTarget,
  type LaneBlock,
} from './agent-limit.formatter';

export type SpawnGateVerdict =
  | { readonly kind: 'clear' }
  | { readonly kind: 'unknown'; readonly reason: string }
  | {
      readonly kind: 'blocked';
      readonly limit: AgentLimit;
      readonly block: LaneBlock;
    };

const CLEAR: SpawnGateVerdict = { kind: 'clear' };

/** The gate's decision for the lane a spawn request names. */
export function spawnGateVerdict(
  limits: readonly AgentLimit[],
  target: AgentLimitTarget | undefined,
  now: number,
): SpawnGateVerdict {
  if (!target) return CLEAR;
  const limit = findAgentLimit(limits, target);
  if (!limit || !limit.row.installed || limit.row.disabled) return CLEAR;
  const block = laneBlock(limit, now);
  if (block) return { kind: 'blocked', limit, block };
  return limit.state.state === 'unknown'
    ? { kind: 'unknown', reason: unknownCause(limit) }
    : CLEAR;
}

/** The refusal text of a blocked spawn, followed by the alternatives. */
export function formatSpawnRefusal(
  limits: readonly AgentLimit[],
  verdict: Extract<SpawnGateVerdict, { kind: 'blocked' }>,
  now: number,
): string {
  const { limit, block } = verdict;
  const reset =
    block.resetsAt === undefined
      ? 'Reset time unknown'
      : `Free again ${formatToolInstant(block.resetsAt, now)}`;
  const refusal =
    `agent_spawn refused: ${rowName(limit)} is at its plan limit (${block.detail}). ` +
    `${reset}. Nothing was spawned. ` +
    'Pass "force": true to spawn anyway, or pick a lane with room below.';
  const alternatives = formatAlternatives(limits, {
    targetRowKey: targetRowKey(limit.row),
    now,
  });
  return `${refusal}\n\n${alternatives}`;
}

/**
 * The roster rows for a named spawn's lookup: the requested model is set on
 * the target row only, so the lookup resolves the owner that model runs on.
 */
export function rowsWithSpawnModel(
  rows: readonly CliDetectionResult[],
  target: AgentLimitTarget,
  model: string | undefined,
): readonly CliDetectionResult[] {
  if (model === undefined) return rows;
  const key = targetRowKey(target);
  const withModel = rows.map((row) =>
    targetRowKey(row) === key ? { ...row, model } : row,
  );
  return withModel;
}
