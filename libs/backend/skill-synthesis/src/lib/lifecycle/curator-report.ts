/**
 * The curator pass's stats and its markdown report (TASK_2026_578).
 *
 * The report lists the lifecycle actions one pass applied. It is
 * informational: every action is already committed when it is written.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PurgeSkippedReason } from './skill-umbrella-merge.service';

/** What one curator pass did, per lifecycle step. */
export interface CuratorPassStats {
  /** Umbrella suggestions + singleton suggestions written this pass. */
  readonly suggestionsCreated: number;
  readonly umbrellasCreated: number;
  readonly umbrellasRejected: number;
  readonly judgeRejectedMembers: number;
  readonly singletonsSurfaced: number;
  /** Candidates rejected `merged-into:<umbrella>`. */
  readonly merged: number;
  /** Pending suggestions dismissed into an umbrella. */
  readonly suggestionsMerged: number;
  readonly dormant: number;
  readonly retired: number;
  readonly purged: number;
  /** `null` when the purge ran; `'failed'` also when the umbrella pass did not run. */
  readonly purgeSkippedReason: PurgeSkippedReason | null;
  readonly clustersRemaining: number;
  readonly rateLimited: boolean;
  /** Pinned skills the retirement sweep left alone. */
  readonly skippedPinned: number;
  /** Retirement rows whose directory is not `<activeRoot>/<slug>`. */
  readonly skippedUncontained: number;
  /** Set when the retirement sweep did not run. */
  readonly retirementSkippedReason: 'registry-unavailable' | 'failed' | null;
  /** Set when the umbrella pass did not run. */
  readonly umbrellaSkippedReason: 'registry-unavailable' | 'failed' | null;
}

/**
 * Write `~/.ptah/curator-reports/<ISO-timestamp>.md` and return its path.
 * Throws on a filesystem failure; the caller logs and reports `''`.
 */
export function writeCuratorReport(
  stats: CuratorPassStats,
  changesApplied: number,
  now: Date = new Date(),
): string {
  const reportsDir = path.join(os.homedir(), '.ptah', 'curator-reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(
    reportsDir,
    `${now.toISOString().replace(/[:.]/g, '-')}.md`,
  );
  const skipped = (reason: string | null) => `- Skipped: ${reason ?? 'no'}`;
  const lines = [
    `# Curator Report — ${now.toISOString()}`,
    ``,
    `**Changes applied**: ${changesApplied}  `,
    `**Skipped (pinned)**: ${stats.skippedPinned}`,
    ``,
    `## Retirement`,
    ``,
    `- Turned dormant: ${stats.dormant}`,
    `- Retired: ${stats.retired}`,
    `- Directory not under the skills root (kept): ${stats.skippedUncontained}`,
    skipped(stats.retirementSkippedReason),
    ``,
    `## Umbrella merge`,
    ``,
    `- Umbrella suggestions: ${stats.umbrellasCreated}`,
    `- Umbrellas rejected by the judge: ${stats.umbrellasRejected} (members rejected: ${stats.judgeRejectedMembers})`,
    `- Singleton suggestions: ${stats.singletonsSurfaced}`,
    `- Candidates merged: ${stats.merged}`,
    `- Suggestions merged: ${stats.suggestionsMerged}`,
    `- Clusters left for later: ${stats.clustersRemaining}${stats.rateLimited ? ' (rate-limited)' : ''}`,
    skipped(stats.umbrellaSkippedReason),
    ``,
    `## Backlog purge`,
    ``,
    `- Purged: ${stats.purged}`,
    skipped(stats.purgeSkippedReason),
    ``,
    `> Dismissing an umbrella suggestion does not restore its merged members.`,
    ``,
  ];
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}
