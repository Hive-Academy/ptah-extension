import {
  LANE_DEFAULT_MODEL,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import { MINIMUM_SAMPLE_COUNT, OUTCOME_WINDOW_MS } from '../routing-constants';
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
  it('derives round(100 * delivered rate) from five verified runs (Req 6.6)', () => {
    const rows = [
      ...runs(4, { verdict: 'delivered', prefix: 'ok' }),
      ...runs(1, { verdict: 'failed', prefix: 'bad', endedAt: NOW - 500 }),
    ];
    const matrix = deriveLocalMatrix(rows, NOW);
    expect(CapabilityMatrixSchema.safeParse(matrix).success).toBe(true);
    const cell = valueAt(matrix, 'z-ai', 'glm-5');
    expect(cell).toEqual({
      kind: 'value',
      score: 80,
      source: 'local',
      asOf: new Date(NOW - 500).toISOString(),
      stale: false,
      sampleCount: MINIMUM_SAMPLE_COUNT,
    });
    expect('sourceRef' in cell).toBe(false);
  });

  it('uses 100 when every verified run was delivered', () => {
    const cell = valueAt(deriveLocalMatrix(runs(5), NOW), 'z-ai', 'glm-5');
    expect(cell.score).toBe(100);
    expect(cell.sampleCount).toBe(5);
  });

  it('does not derive below the minimum sample count', () => {
    expect(deriveLocalMatrix(runs(4), NOW).profiles).toEqual([]);
  });

  it('uses only the review pass rate when delivery is below the minimum', () => {
    const rows = runs(5, { verdict: 'unverified', finalReview: 'approved' });
    const cell = valueAt(deriveLocalMatrix(rows, NOW), 'z-ai', 'glm-5');
    expect(cell.score).toBe(100);
    expect(cell.sampleCount).toBe(5);
  });

  it('uses the mean when both rates reach the minimum', () => {
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
    expect(cell.score).toBe(60);
    expect(cell.sampleCount).toBe(5);
  });

  it('rounds a half up away from zero', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
      summary({
        runId: `half-${index}`,
        family: 'z-ai',
        model: 'glm-5',
        taskKind: 'implement',
        verdict: index === 0 ? 'delivered' : 'failed',
        endedAt: NOW - (8 - index) * 1000,
      }),
    );
    expect(valueAt(deriveLocalMatrix(rows, NOW), 'z-ai', 'glm-5').score).toBe(
      13,
    );
  });

  it('rounds the mean of two one-eighth rates to 13', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
      summary({
        runId: `mean-half-${index}`,
        family: 'z-ai',
        model: 'glm-5',
        taskKind: 'implement',
        verdict: index === 0 ? 'delivered' : 'failed',
        finalReview: index === 0 ? 'approved' : 'rejected',
        endedAt: NOW - (8 - index) * 1000,
      }),
    );
    const cell = valueAt(deriveLocalMatrix(rows, NOW), 'z-ai', 'glm-5');
    expect(cell.score).toBe(13);
    expect(cell.sampleCount).toBe(8);
  });

  it('sets asOf from the newest record that contributed to the used rate', () => {
    const delivered = runs(5, { prefix: 'del', endedAt: NOW - 10_000 });
    const newestDelivered = NOW - 10_000 + 4 * 1000;
    const newerReview = summary({
      runId: 'review-only',
      family: 'z-ai',
      model: 'glm-5',
      taskKind: 'implement',
      verdict: 'unverified',
      finalReview: 'approved',
      endedAt: NOW - 1000,
    });
    const cell = valueAt(
      deriveLocalMatrix([...delivered, newerReview], NOW),
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
      100,
    );
  });

  it('does not pool different families, models or task kinds', () => {
    const split = [
      ...runs(3, { family: 'z-ai', prefix: 'a' }),
      ...runs(3, { family: 'codex', prefix: 'b' }),
      ...runs(3, { taskKind: 'plan', prefix: 'c' }),
    ];
    expect(deriveLocalMatrix(split, NOW).profiles).toEqual([]);
  });

  it('maps lane-default and auto onto the family profile and pools them', () => {
    const rows = [
      ...runs(3, { model: LANE_DEFAULT_MODEL, prefix: 'default' }),
      ...runs(2, { model: AUTOMATIC_MATRIX_MODEL, prefix: 'auto' }),
    ];
    const matrix = deriveLocalMatrix(rows, NOW);
    expect(cellAt(matrix, 'z-ai', LANE_DEFAULT_MODEL)).toBeUndefined();
    expect(cellAt(matrix, 'z-ai', AUTOMATIC_MATRIX_MODEL)).toBeUndefined();
    expect(valueAt(matrix, 'z-ai', FAMILY_PROFILE_MODEL).score).toBe(100);
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
      score: 100,
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
