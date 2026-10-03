/**
 * Agent sync chips — the pure rule that turns one harness health report into
 * one chip per provider for one agent card (TASK_2026_609, plan C4).
 *
 * No Angular, no I/O: the card hands in the report it already holds and the
 * agent slug, and gets back what each provider's copy of that agent looks like.
 *
 * ### Evaluation order
 *
 * First match wins, in exactly this order:
 *
 * 1. `unknown`       — no report yet, or the report does not mention the target.
 * 2. `not-detected`  — the provider is not present in this workspace.
 * 3. `source`        — Claude: its agents directory IS the source Ptah reads.
 * 4. `unsupported`   — the provider carries no agents (e.g. Antigravity).
 * 5. `failed`        — the copy's path is in `writeFailed` (carries the reason).
 * 6. `edited`        — the copy's path is in `localEdit` (hand-edited).
 * 7. `missing`       — the copy's path is in `missing` (absent, stale, blocked).
 * 8. `in-sync`       — the copy's path is in `agentsInSync`.
 * 9. `not-synced`    — anything else (e.g. agent sync off, agent disabled).
 *
 * "In sync" is never inferred from the absence of a problem: `agentsInSync` is
 * the only evidence the report offers that a copy matches what Ptah would
 * write, so a report that omits it (an older host) yields `not-synced`.
 */
import {
  HARNESS_AGENT_CHIP_TARGETS,
  harnessAgentRelPath,
  type HarnessHealth,
  type HarnessTargetHealth,
  type HarnessTargetId,
} from '@ptah-extension/shared';

/** The nine chip states, in evaluation order. */
export type AgentSyncChipState =
  | 'unknown'
  | 'not-detected'
  | 'source'
  | 'unsupported'
  | 'failed'
  | 'edited'
  | 'missing'
  | 'in-sync'
  | 'not-synced';

/** One provider's chip on one agent card. */
export interface AgentSyncChip {
  readonly target: HarnessTargetId;
  readonly state: AgentSyncChipState;
  /** Short visible text, e.g. `in sync`. */
  readonly label: string;
  /**
   * Workspace-relative path of this provider's copy of the agent, or `null`
   * when the provider writes none (Claude, Antigravity).
   */
  readonly path: string | null;
  /** The `writeFailed` reason; present only on `failed`. */
  readonly reason?: string;
}

const CHIP_LABELS: Readonly<Record<AgentSyncChipState, string>> = {
  unknown: 'unknown',
  'not-detected': 'not detected',
  source: 'source',
  unsupported: 'unsupported',
  failed: 'failed',
  edited: 'edited',
  missing: 'missing',
  'in-sync': 'in sync',
  'not-synced': 'not synced',
};

/** Chips for one agent, one per {@link HARNESS_AGENT_CHIP_TARGETS} entry, in that order. */
export function agentSyncChips(
  health: HarnessHealth | null,
  slug: string,
): AgentSyncChip[] {
  return HARNESS_AGENT_CHIP_TARGETS.map((target) =>
    agentSyncChip(health, target, slug),
  );
}

/** The chip for one agent on one target. */
export function agentSyncChip(
  health: HarnessHealth | null,
  target: HarnessTargetId,
  slug: string,
): AgentSyncChip {
  const path = harnessAgentRelPath(target, slug);
  const chip = (state: AgentSyncChipState, reason?: string): AgentSyncChip =>
    reason === undefined
      ? { target, state, label: CHIP_LABELS[state], path }
      : { target, state, label: CHIP_LABELS[state], path, reason };

  const report = health?.targets.find((entry) => entry.target === target);
  if (report === undefined) return chip('unknown');
  if (!report.detected) return chip('not-detected');
  if (target === 'claude' || report.facets.agents === 'source-managed') {
    return chip('source');
  }
  if (report.facets.agents === 'unsupported' || path === null) {
    return chip('unsupported');
  }
  return chip(...copyState(report, path));
}

/** States 5-9: what the report says about one concrete copy path. */
function copyState(
  report: HarnessTargetHealth,
  path: string,
): [AgentSyncChipState, string?] {
  const failure = report.writeFailed.find((entry) => entry.relPath === path);
  if (failure !== undefined) return ['failed', failure.reason];
  if ((report.localEdit ?? []).includes(path)) return ['edited'];
  if (report.missing.includes(path)) return ['missing'];
  if ((report.agentsInSync ?? []).includes(path)) return ['in-sync'];
  return ['not-synced'];
}
