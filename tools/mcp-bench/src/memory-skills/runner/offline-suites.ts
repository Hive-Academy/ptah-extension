/**
 * Offline suites: model-free computations (rubric agreement over committed
 * CSVs, pure baseline policies) that run in the runner parent inside the
 * launcher window (619 answer 6). They read only through the read-path guard
 * and write only into the run directory; the runner writes their result
 * files with the same contract host suites use (`suite-result.ts`).
 */

import type { ReadPathGuard } from './read-path-guard';
import { MemorySkillsRunError, type RunnerPlan } from './runner-plan';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from './suite-result';

/** What an offline suite receives. */
export interface OfflineSuiteContext {
  readonly runId: string;
  /** Per-run artefact directory; the suite may write only here. */
  readonly runDir: string;
  /** The plan entry's `options`; the suite validates them. */
  readonly options: unknown;
  readonly ci: boolean;
  /** Every read goes through this guard (committed repo files, bench data folder). */
  readonly read: ReadPathGuard;
  /** Wrap a worker entry so the CI net recorder also covers the worker thread. */
  guardWorkerEntry(workerEntryPath: string): string;
}

export interface OfflineSuiteOutput {
  readonly result: SuiteResultInput;
  readonly cases: readonly CaseRecord[];
}

/** A model-free suite the parent runs inside the launcher window. */
export interface MemorySkillsOfflineSuite {
  readonly id: string;
  run(context: OfflineSuiteContext): Promise<OfflineSuiteOutput>;
}

export type OfflineStatus =
  | { readonly status: 'completed' }
  | { readonly status: 'error'; readonly error: string };

/** The registered suites by id; refuses a duplicate or a plan id with no suite. */
export function offlineRegistry(
  suites: readonly MemorySkillsOfflineSuite[],
  plan: RunnerPlan,
): Map<string, MemorySkillsOfflineSuite> {
  const registry = new Map<string, MemorySkillsOfflineSuite>();
  for (const suite of suites) {
    if (registry.has(suite.id)) {
      throw new MemorySkillsRunError(
        `offline suite ${suite.id} is registered twice`,
      );
    }
    registry.set(suite.id, suite);
  }
  const unknown = plan.offlineSuites
    .map((suite) => suite.id)
    .filter((id) => !registry.has(id));
  if (unknown.length > 0) {
    throw new MemorySkillsRunError(
      `the plan names offline suites the runner does not have: ${unknown.join(', ')}`,
    );
  }
  return registry;
}

/**
 * Run the plan's offline suites one at a time, in plan order. A suite that
 * throws, returns another suite's result or reports model calls is recorded
 * as `error`, and the next suite still runs.
 */
export async function runOfflineSuites(
  plan: RunnerPlan,
  registry: ReadonlyMap<string, MemorySkillsOfflineSuite>,
  base: Omit<OfflineSuiteContext, 'options'>,
): Promise<Map<string, OfflineStatus>> {
  const statuses = new Map<string, OfflineStatus>();
  for (const entry of plan.offlineSuites) {
    try {
      const suite = registry.get(entry.id);
      // Unreachable: the plan was checked against the registry before launch.
      if (suite === undefined) throw new Error(`unknown suite ${entry.id}`);
      const output = await suite.run({ ...base, options: entry.options });
      if (output.result.suiteId !== entry.id) {
        throw new Error(
          `offline suite ${entry.id} returned a result for ${output.result.suiteId}`,
        );
      }
      if (output.result.modelCalls > 0) {
        throw new Error(
          `offline suite ${entry.id} reported ${output.result.modelCalls} model calls; offline suites are model-free`,
        );
      }
      writeSuiteResult(base.runDir, output.result, output.cases);
      statuses.set(entry.id, { status: 'completed' });
    } catch (error: unknown) {
      statuses.set(entry.id, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return statuses;
}
