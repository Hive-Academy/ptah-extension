/**
 * `mem.retention.lifecycle`, `mem.retention.growth` and `mem.ranking.roster`
 * (benchmark-design.md 3.7): the host suite wiring. Each suite runs over one
 * narrow port (`RetentionPort`, `retention-support.ts`); the host entry wires
 * it to the product in `retention-port.ts` (host-only), the specs to an
 * in-memory double. The suites live in `retention-lifecycle.ts`,
 * `retention-growth.ts` and `retention-roster.ts`.
 *
 * One simulated day, in order:
 *   1. `T = epoch + day * 24 h`: one retention run at `T` (processed purge,
 *      stale-row count, lifecycle step, ledger prune, page reclaim), then the
 *      DB size after the reclaim step (`page_count * page_size`);
 *   2. lifecycle: at `T + 12 h` the held-out questions of the day are asked;
 *   3. growth: at `T + 1 h` the day's synthetic sessions enqueue their
 *      observations; at `T + 2 h` each session gets one curation pass.
 *
 * Their retention runs archive and delete every other row in the isolated DB
 * on the simulated clock, so each declares `placement: 'last'`: the plan
 * schemas and the host refuse a plan that runs any other suite after them
 * (`host/suite-placement.ts`).
 *
 * Imports only Node, zod and modules the runner parent may load.
 */

import { join } from 'node:path';

import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import { writeSuiteResult } from '../../runner/suite-result';
import {
  runRetentionGrowth,
  RETENTION_GROWTH_SUITE_ID,
} from './retention-growth';
import {
  runRetentionLifecycle,
  RETENTION_LIFECYCLE_SUITE_ID,
} from './retention-lifecycle';
import { runRankingRoster, RANKING_ROSTER_SUITE_ID } from './retention-roster';
import {
  loadRetentionSeed,
  retentionOptionsSchema,
  type RetentionPort,
  type RetentionSuiteInput,
  type RetentionSuiteOutput,
} from './retention-support';

export type RetentionPortOf = (
  context: MemorySkillsHostSuiteContext,
) => RetentionPort;

type RetentionRun = (
  input: RetentionSuiteInput,
) => Promise<RetentionSuiteOutput>;

function retentionSuite(
  id: string,
  run: RetentionRun,
  portOf: RetentionPortOf,
): MemorySkillsHostSuite {
  return {
    id,
    // Rewrites the shared database: nothing that reads it may follow.
    placement: 'last',
    async run(context) {
      const options = retentionOptionsSchema.parse(context.options ?? {});
      const seed = loadRetentionSeed(context.isolation.home, options);
      const { result, cases } = await run({
        port: portOf(context),
        options,
        seed,
        workspaceRoot: join(context.runDir, 'workspaces', id),
      });
      writeSuiteResult(context.runDir, result, cases);
    },
  };
}

/** The three suites; the host entry passes the host-only product port. */
export function createRetentionSuites(deps: {
  readonly portOf: RetentionPortOf;
}): readonly MemorySkillsHostSuite[] {
  return [
    retentionSuite(
      RETENTION_LIFECYCLE_SUITE_ID,
      runRetentionLifecycle,
      deps.portOf,
    ),
    retentionSuite(RETENTION_GROWTH_SUITE_ID, runRetentionGrowth, deps.portOf),
    retentionSuite(RANKING_ROSTER_SUITE_ID, runRankingRoster, deps.portOf),
  ];
}
