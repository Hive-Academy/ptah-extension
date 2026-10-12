/**
 * `mem.update.seed` (benchmark-design.md 3.3): the setup-wizard path
 * (`MemoryWriterAdapter.upsert`, `memory-writer.adapter.ts:53-100`) seeds v1,
 * then reseeds v2 under the same subject and fingerprint. Invariant: only v2
 * is retrievable, on every case. Baselines: append-only seed, no memory.
 * Model-free. Registered through `createUpdateSuites` in `update.suite.ts`.
 */

import { z } from 'zod';

import { appendOnlySeed } from '../../baselines/write-side-baselines';
import { updateCaseSchema } from '../../ground-truth/label-schemas';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import {
  classifyUpdate,
  updateOutcomeRate,
} from '../../metrics/curation-metrics';
import { writeSuiteResult, type CaseRecord } from '../../runner/suite-result';
import {
  caseScope,
  deltaOf,
  naReasonOf,
  readGroundTruth,
  recordCase,
  sha256Of,
  type CaseStatus,
} from './merge-update-pass';
import {
  blockLines,
  GROUND_TRUTH,
  hitRow,
  NO_MEMORY,
  outcomeMetrics,
  presenceIn,
  READ_TOP_K,
  UPDATE_OUTCOMES,
  type UpdatePresence,
  type UpdateSuiteDeps,
} from './update-reading';

export const SEED_SUITE_ID = 'mem.update.seed';

const seedOptionsSchema = z.strictObject({
  updateCases: z.string().min(1),
});

/** A per-case 16-hex workspace fingerprint (`memory-writer.adapter.ts:27-28`). */
function seedFingerprint(caseId: string, attempt: number): string {
  return sha256Of({ suite: SEED_SUITE_ID, caseId, attempt }).slice(0, 16);
}

interface SeedOutcome {
  readonly read: UpdatePresence;
  readonly block: UpdatePresence;
  readonly statuses: string;
}

async function runSeed(
  context: MemorySkillsHostSuiteContext,
  deps: UpdateSuiteDeps,
): Promise<void> {
  const options = seedOptionsSchema.parse(context.options ?? {});
  const cases = readGroundTruth(
    context.isolation.home,
    options.updateCases,
    updateCaseSchema,
  );
  const ports = deps.resolvePorts(context);
  const now = deps.now ?? (() => performance.now());
  let calls = 0;
  const appendOnly = new Map(
    cases.map((updateCase) => [
      updateCase.id,
      presenceIn(
        { ...updateCase, bait: null },
        appendOnlySeed(
          [{ subject: updateCase.slot, content: updateCase.v1.value }],
          [{ subject: updateCase.slot, content: updateCase.v2.value }],
        ),
      ),
    ]),
  );

  const records: CaseRecord[] = [];
  const statuses: CaseStatus[] = [];
  const done: SeedOutcome[] = [];
  for (const updateCase of cases) {
    const seeded = { v1: updateCase.v1, v2: updateCase.v2, bait: null };
    const baseline = appendOnly.get(updateCase.id) ?? NO_MEMORY;
    const recorded = await recordCase<SeedOutcome>(
      updateCase.id,
      { slot: updateCase.slot, v1: updateCase.v1, v2: updateCase.v2 },
      'correct',
      async (_signal, attempt) => {
        const workspaceRoot = caseScope(
          context.workspaceRoot,
          SEED_SUITE_ID,
          updateCase.id,
          attempt,
        );
        // The wizard's core seed shape (`setup-rpc.handlers.ts:960-970`).
        const request = {
          workspaceFingerprint: seedFingerprint(updateCase.id, attempt),
          workspaceRoot,
          subject: updateCase.slot,
          tier: 'core',
          kind: 'preference',
          pinned: true,
          salience: 1.0,
          decayRate: 0,
        } as const;
        const first = await ports.seed({
          ...request,
          content: updateCase.v1.value,
        });
        const second = await ports.seed({
          ...request,
          content: updateCase.v2.value,
        });
        calls += 2;
        const { hits } = await ports.searchRich(
          updateCase.question,
          READ_TOP_K,
          workspaceRoot,
        );
        const block = await ports.buildBlock(
          updateCase.question,
          workspaceRoot,
        );
        calls += 2;
        return {
          read: presenceIn(seeded, hits.map(hitRow)),
          block: presenceIn(
            seeded,
            blockLines(block).map((line) => ({ chunk: line })),
          ),
          statuses: `${first.status},${second.status}`,
        };
      },
      (outcome) => {
        const read = classifyUpdate(outcome.read);
        return {
          expected: 'correct',
          observed: `searchRich=${read}; buildBlock=${classifyUpdate(outcome.block)}; seed=${outcome.statuses}`,
          outcome: read === 'correct' ? 'pass' : 'fail',
          baselineOutcomes: {
            'append-only':
              classifyUpdate(baseline) === 'correct' ? 'pass' : 'fail',
            'no-memory': 'fail',
          },
        };
      },
      { now, capMs: deps.capMs },
    );
    records.push(recorded.record);
    statuses.push(recorded.status);
    if (recorded.value !== null) done.push(recorded.value);
  }

  const product = {
    ...outcomeMetrics(
      '',
      done.map((o) => o.read),
    ),
    ...outcomeMetrics(
      'buildBlock.',
      done.map((o) => o.block),
    ),
  };
  const baselines = [
    {
      id: 'append-only',
      label: 'Append-only seed (no supersede)',
      metrics: outcomeMetrics('', [...appendOnly.values()]),
    },
    {
      id: 'no-memory',
      label: 'No memory',
      metrics: outcomeMetrics(
        '',
        cases.map(() => NO_MEMORY),
      ),
    },
  ];
  const correct = updateOutcomeRate(
    done.map((o) => o.read),
    'correct',
  );
  const naReason = naReasonOf(statuses, false);

  writeSuiteResult(
    context.runDir,
    {
      suiteId: SEED_SUITE_ID,
      kind: 'curation',
      arm: 'memory',
      details: {
        operation: 'update',
        cases: done.length,
        correct: correct.value,
        stale: product['stale'],
        omission: product['omission'],
        hallucination: product['hallucination'],
        readPath: 'searchRich',
      },
      claim: {
        source: 'code',
        ref: 'libs/backend/memory-curator/src/lib/memory-writer.adapter.ts:53-100',
        text: 'A reseed supersedes the previous seed for the same subject and workspace',
      },
      groundTruth: GROUND_TRUTH,
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(product, baseline.metrics, UPDATE_OUTCOMES),
        ]),
      ),
      cost: {
        calls,
        latency_ms: { p50: null, p95: null },
        error_rate: null,
        tokens: {},
      },
      modelCalls: 0,
      verdict:
        naReason !== undefined
          ? 'na'
          : correct.den > 0 && correct.num === correct.den
            ? 'pass'
            : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: product,
      cassetteVersion: null,
    },
    records,
  );
}

/** The suite, for the host's `HOST_SUITES` (via `createUpdateSuites`). */
export function createSeedSuite(deps: UpdateSuiteDeps): MemorySkillsHostSuite {
  return { id: SEED_SUITE_ID, run: (context) => runSeed(context, deps) };
}
