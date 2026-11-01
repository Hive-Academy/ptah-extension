import {
  LANE_DEFAULT_MODEL,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import { OUTCOME_WINDOW_MS } from '../routing-constants';
import { CapabilityMatrixSchema } from './matrix.schema';
import {
  FAMILY_PROFILE_MODEL,
  type CapabilityMatrix,
  type MatrixCell,
  type ValueMatrixCell,
} from './matrix.types';
import { AUTOMATIC_MATRIX_MODEL, deriveLocalMatrix } from './local-derivation';

const NOW = Date.parse('2026-10-15T00:00:00.000Z');
const SINCE = NOW - OUTCOME_WINDOW_MS;

function summary(
  partial: Pick<
    LaneOutcomeSummary,
    'runId' | 'family' | 'model' | 'taskKind' | 'verdict' | 'endedAt'
  > &
    Partial<LaneOutcomeSummary>,
): LaneOutcomeSummary {
  return {
    runId: partial.runId,
    laneId: partial.laneId ?? 'codex',
    family: partial.family,
    model: partial.model,
    taskKind: partial.taskKind,
    verdict: partial.verdict,
    failureClass: partial.failureClass ?? null,
    finalReview: partial.finalReview ?? null,
    reviseRounds: partial.reviseRounds ?? 0,
    durationMs: partial.durationMs ?? null,
    endedAt: partial.endedAt,
    routingSource: partial.routingSource ?? 'ranking',
    inputTokens: partial.inputTokens ?? null,
    outputTokens: partial.outputTokens ?? null,
    costUsd: partial.costUsd ?? null,
  };
}

function runs(
  count: number,
  fields: {
    family?: string;
    model?: string;
    taskKind?: OutcomeTaskKind | null;
    verdict?: LaneOutcomeSummary['verdict'];
    finalReview?: LaneOutcomeSummary['finalReview'];
    endedAt?: number;
    prefix?: string;
  } = {},
): LaneOutcomeSummary[] {
  const endedAt = fields.endedAt ?? NOW - count * 1000;
  return Array.from({ length: count }, (_, index) =>
    summary({
      runId: `${fields.prefix ?? 'run'}-${index}`,
      family: fields.family ?? 'z-ai',
      model: fields.model ?? 'glm-5',
      taskKind: fields.taskKind === undefined ? 'implement' : fields.taskKind,
      verdict: fields.verdict ?? 'delivered',
      finalReview: fields.finalReview ?? null,
      endedAt: endedAt + index * 1000,
    }),
  );
}

function cellAt(
  matrix: CapabilityMatrix,
  family: string,
  model: string,
  kind: OutcomeTaskKind = 'implement',
): MatrixCell | undefined {
  return matrix.profiles.find(
    (profile) => profile.family === family && profile.model === model,
  )?.cells[kind];
}

function valueAt(
  matrix: CapabilityMatrix,
  family: string,
  model: string,
  kind: OutcomeTaskKind = 'implement',
): ValueMatrixCell {
  const cell = cellAt(matrix, family, model, kind);
  if (cell?.kind !== 'value') {
    throw new Error(`expected a value at ${family}/${model}/${kind}`);
  }
  return cell;
}

describe('deriveLocalMatrix', () => {
  // The blend table from the plan (implementation-plan.md:698-710), one test
  // per row. The seeded prior 80 is the z-ai/glm-5 implement seed; every
  // other key blends with the neutral prior 50.

  it('blends one seeded failure toward the prior 80 (Req 8)', () => {
    const matrix = deriveLocalMatrix(runs(1, { verdict: 'failed' }), NOW);
    expect(CapabilityMatrixSchema.safeParse(matrix).success).toBe(true);
    const cell = valueAt(matrix, 'z-ai', 'glm-5');
    expect(cell).toEqual({
      kind: 'value',
      score: 73,
      source: 'local',
      asOf: new Date(NOW - 1000).toISOString(),
      stale: false,
      sampleCount: 1,
    });
    expect('sourceRef' in cell).toBe(false);
  });

  it('blends five seeded failures toward the prior 80', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(5, { verdict: 'failed' }), NOW),
      'z-ai',
      'glm-5',
    );
    expect(cell.score).toBe(53);
    expect(cell.sampleCount).toBe(5);
  });

  it('blends fifty seeded failures toward the prior 80', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(50, { verdict: 'failed' }), NOW),
      'z-ai',
      'glm-5',
    );
    expect(cell.score).toBe(13);
    expect(cell.sampleCount).toBe(50);
  });

  it('blends one delivered run toward the neutral prior 50', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(1, { family: 'codex' }), NOW),
      'codex',
      'glm-5',
    );
    expect(cell.score).toBe(55);
    expect(cell.sampleCount).toBe(1);
  });

  it('blends five delivered runs toward the neutral prior 50', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(5, { family: 'codex' }), NOW),
      'codex',
      'glm-5',
    );
    expect(cell.score).toBe(67);
    expect(cell.sampleCount).toBe(5);
  });

  it('blends one hundred delivered runs toward the neutral prior 50', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(100, { family: 'codex' }), NOW),
      'codex',
      'glm-5',
    );
    expect(cell.score).toBe(95);
    expect(cell.sampleCount).toBe(100);
  });

  it('blends both rates before their mean (delivery 5/5, review 1/1)', () => {
    const rows = [
      ...runs(4, { family: 'codex', prefix: 'del' }),
      summary({
        runId: 'reviewed',
        family: 'codex',
        model: 'glm-5',
        taskKind: 'implement',
        verdict: 'delivered',
        finalReview: 'approved',
        endedAt: NOW - 500,
      }),
    ];
    const cell = valueAt(deriveLocalMatrix(rows, NOW), 'codex', 'glm-5');
    expect(cell.score).toBe(61);
    expect(cell.sampleCount).toBe(5);
  });

  it('rounds an exact half away from zero (neutral prior, thirty failed)', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(30, { family: 'codex', verdict: 'failed' }), NOW),
      'codex',
      'glm-5',
    );
    expect(cell.score).toBe(13);
    expect(cell.sampleCount).toBe(30);
  });

  it('derives no cell when only unverified rows exist', () => {
    expect(
      deriveLocalMatrix(runs(5, { verdict: 'unverified' }), NOW).profiles,
    ).toEqual([]);
  });

  it('uses the seeded prior only for the seeded task kind', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(1, { taskKind: 'plan', verdict: 'failed' }), NOW),
      'z-ai',
      'glm-5',
      'plan',
    );
    // z-ai/glm-5 seeds only implement, so plan blends with 50: round(500/11).
    expect(cell.score).toBe(45);
  });

  it('uses the neutral prior when no seed profile matches the model', () => {
    const cell = valueAt(
      deriveLocalMatrix(runs(1, { model: 'glm-5-air', verdict: 'failed' }), NOW),
      'z-ai',
      'glm-5-air',
    );
    expect(cell.score).toBe(45);
  });

  it('uses only the blended review rate when no delivery verdict exists', () => {
    const rows = runs(5, { verdict: 'unverified', finalReview: 'approved' });
    const cell = valueAt(deriveLocalMatrix(rows, NOW), 'z-ai', 'glm-5');
    // Review 5/5 with prior 80: round((500 + 800) / 15).
    expect(cell.score).toBe(87);
    expect(cell.sampleCount).toBe(5);
  });

  it('blends both seeded rates before their mean', () => {
    const rows = [0, 1, 2, 3, 4].map((index) =>
      summary({
        runId: `both-${index}`,
        family: 'z-ai',
        model: 'glm-5',
        taskKind: 'implement',
        verdict: index === 4 ? 'failed' : 'delivered',
        finalReview: index < 2 ? 'approved' : 'rejected',
        endedAt: NOW - (5 - index) * 1000,
      }),
    );
    const cell = valueAt(deriveLocalMatrix(rows, NOW), 'z-ai', 'glm-5');
    // Delivery 4/5 and review 2/5, each blended with 80, mean to 73.
    expect(cell.score).toBe(73);
    expect(cell.sampleCount).toBe(5);
  });

  it('sets asOf from the newest record that contributed to the used rate', () => {
    const delivered = runs(5, { prefix: 'del', endedAt: NOW - 10_000 });
    const newestDelivered = NOW - 10_000 + 4 * 1000;
    const newerNoContribution = summary({
      runId: 'unverified-new',
      family: 'z-ai',
      model: 'glm-5',
      taskKind: 'implement',
      verdict: 'unverified',
      endedAt: NOW - 1000,
    });
    const cell = valueAt(
      deriveLocalMatrix([...delivered, newerNoContribution], NOW),
      'z-ai',
      'glm-5',
    );
    expect(cell.asOf).toBe(new Date(newestDelivered).toISOString());
    expect(cell.sampleCount).toBe(5);
  });

  it('ignores a null task kind, unverified delivery and rows outside the window', () => {
    const ignored = [
      ...runs(5, { taskKind: null, prefix: 'kind' }),
      ...runs(5, { verdict: 'unverified', prefix: 'open' }),
      ...runs(5, { prefix: 'old', endedAt: SINCE - 5_000 }),
    ];
    expect(deriveLocalMatrix(ignored, NOW).profiles).toEqual([]);
    const inside = runs(5, { prefix: 'in', endedAt: SINCE });
    expect(valueAt(deriveLocalMatrix(inside, NOW), 'z-ai', 'glm-5').score).toBe(
      87,
    );
  });

  it('does not pool different families, models or task kinds', () => {
    const split = [
      ...runs(3, { family: 'z-ai', prefix: 'a' }),
      ...runs(3, { family: 'codex', prefix: 'b' }),
      ...runs(3, { taskKind: 'plan', prefix: 'c' }),
    ];
    const matrix = deriveLocalMatrix(split, NOW);
    expect(matrix.profiles).toHaveLength(2);
    // z-ai/glm-5 implement, prior 80: round((300 + 800) / 13).
    expect(valueAt(matrix, 'z-ai', 'glm-5').score).toBe(85);
    // codex/glm-5 implement, prior 50: round((300 + 500) / 13).
    expect(valueAt(matrix, 'codex', 'glm-5').score).toBe(62);
    // z-ai/glm-5 plan has no seed: round((300 + 500) / 13).
    expect(valueAt(matrix, 'z-ai', 'glm-5', 'plan').score).toBe(62);
  });

  it('maps lane-default and auto onto the family profile and pools them', () => {
    const rows = [
      ...runs(3, { model: LANE_DEFAULT_MODEL, prefix: 'default' }),
      ...runs(2, { model: AUTOMATIC_MATRIX_MODEL, prefix: 'auto' }),
    ];
    const matrix = deriveLocalMatrix(rows, NOW);
    expect(cellAt(matrix, 'z-ai', LANE_DEFAULT_MODEL)).toBeUndefined();
    expect(cellAt(matrix, 'z-ai', AUTOMATIC_MATRIX_MODEL)).toBeUndefined();
    // The family profile has no seed, so the prior is 50: round(1000/15).
    expect(valueAt(matrix, 'z-ai', FAMILY_PROFILE_MODEL).score).toBe(67);
    expect(valueAt(matrix, 'z-ai', FAMILY_PROFILE_MODEL).sampleCount).toBe(5);
  });

  it('sorts profiles by family and puts the family profile first', () => {
    const rows = [
      ...runs(5, { family: 'codex', model: 'gpt', prefix: 'gpt' }),
      ...runs(5, { family: 'codex', model: LANE_DEFAULT_MODEL, prefix: 'fam' }),
      ...runs(5, { family: 'a-family', model: 'm', prefix: 'a' }),
    ];
    expect(
      deriveLocalMatrix(rows, NOW).profiles.map((profile) => [
        profile.family,
        profile.model,
      ]),
    ).toEqual([
      ['a-family', 'm'],
      ['codex', FAMILY_PROFILE_MODEL],
      ['codex', 'gpt'],
    ]);
  });

  it('is deterministic for shuffled input and duplicate run ids', () => {
    const older = summary({
      runId: 'dup',
      family: 'z-ai',
      model: 'glm-5',
      taskKind: 'implement',
      verdict: 'failed',
      endedAt: NOW - 9_000,
    });
    const newer = summary({
      runId: 'dup',
      family: 'z-ai',
      model: 'glm-5',
      taskKind: 'implement',
      verdict: 'delivered',
      endedAt: NOW - 8_000,
    });
    const rest = runs(4, { prefix: 'rest', endedAt: NOW - 7_000 });
    const forward = deriveLocalMatrix([...rest, older, newer], NOW);
    const backward = deriveLocalMatrix(
      [newer, ...[...rest].reverse(), older],
      NOW,
    );
    expect(backward).toEqual(forward);
    expect(valueAt(forward, 'z-ai', 'glm-5')).toMatchObject({
      score: 87,
      sampleCount: 5,
    });
    expect(deriveLocalMatrix([...rest, older, newer], NOW)).toEqual(forward);
  });

  it('rejects a non-finite clock', () => {
    expect(() => deriveLocalMatrix([], Number.NaN)).toThrow(
      'nowMs must be a finite epoch millisecond',
    );
  });
});