import {
  ANTHROPIC_PROVIDERS,
  OUTCOME_TASK_KINDS,
  SUBAGENT_FAMILY,
  SYSTEM_CLI_TYPES,
} from '@ptah-extension/shared';
import { SEED_LABEL_SCORE, STALENESS_AGE_MS } from '../routing-constants';
import {
  CapabilityMatrixSchema,
  MatrixCellSchema,
  MatrixCellsSchema,
} from './matrix.schema';
import { FAMILY_PROFILE_MODEL } from './matrix.types';
import {
  SEED_MATRIX_ROWS,
  SEED_NOTE,
  SEED_SOURCE_REF,
  buildSeedMatrix,
  isStale,
} from './seed-matrix';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function shippedProviderModelIds(providerId: string): string[] | undefined {
  for (const provider of ANTHROPIC_PROVIDERS) {
    if (provider.id !== providerId) continue;
    const staticModels =
      'staticModels' in provider ? provider.staticModels : undefined;
    return (staticModels ?? []).map((model) => model.id);
  }
  return undefined;
}

const unknownCells = {
  plan: { kind: 'unknown' },
  implement: { kind: 'unknown' },
  review: { kind: 'unknown' },
  research: { kind: 'unknown' },
  tests: { kind: 'unknown' },
  docs: { kind: 'unknown' },
};

const seedCell = {
  kind: 'value',
  score: 80,
  source: 'seed',
  sourceRef: SEED_SOURCE_REF,
  asOf: '2026-02-17',
  stale: true,
  note: SEED_NOTE,
};

function matrixWith(...profiles: unknown[]) {
  return { version: 1, profiles };
}

describe('seed matrix', () => {
  it('validates against the matrix schema', () => {
    const result = CapabilityMatrixSchema.safeParse(buildSeedMatrix(NOW));
    expect(result.success).toBe(true);
  });

  it('seeds at least one profile', () => {
    expect(buildSeedMatrix(NOW).profiles.length).toBeGreaterThan(0);
  });

  it('holds unknown in every non-implement cell (Req 6.3)', () => {
    for (const profile of buildSeedMatrix(NOW).profiles) {
      for (const kind of OUTCOME_TASK_KINDS) {
        if (kind === 'implement') continue;
        expect({
          profile: profile.model,
          kind,
          cell: profile.cells[kind],
        }).toEqual({ profile: profile.model, kind, cell: { kind: 'unknown' } });
      }
    }
  });

  it('records source, asOf, note and a seed score on every implement value (Req 6.2)', () => {
    const labelScores: number[] = Object.values(SEED_LABEL_SCORE);
    const profiles = buildSeedMatrix(NOW).profiles;
    profiles.forEach((profile, index) => {
      const row = SEED_MATRIX_ROWS[index];
      const cell = profile.cells.implement;
      expect(cell.kind).toBe('value');
      if (cell.kind !== 'value') return;
      expect(cell.source).toBe('seed');
      expect(cell.sourceRef).toBe(SEED_SOURCE_REF);
      expect(cell.note).toBe(SEED_NOTE);
      expect(cell.asOf).toBe(row.asOf);
      expect(cell.score).toBe(SEED_LABEL_SCORE[row.label]);
      expect(labelScores).toContain(cell.score);
      expect(cell.sampleCount).toBeUndefined();
    });
  });

  it('keys every profile by a lane family and model id the lane lists', () => {
    const systemClis: readonly string[] = SYSTEM_CLI_TYPES;
    for (const row of SEED_MATRIX_ROWS) {
      expect(row.model).not.toBe(FAMILY_PROFILE_MODEL);
      const providerModels = shippedProviderModelIds(row.family);
      const knownFamily =
        providerModels !== undefined ||
        systemClis.includes(row.family) ||
        row.family === SUBAGENT_FAMILY;
      expect({ family: row.family, knownFamily }).toEqual({
        family: row.family,
        knownFamily: true,
      });
      if (providerModels !== undefined) {
        expect(providerModels).toContain(row.model);
      }
    }
  });

  it('marks a seed value stale once asOf is older than the staleness age', () => {
    for (const profile of buildSeedMatrix(NOW).profiles) {
      const cell = profile.cells.implement;
      if (cell.kind !== 'value') throw new Error('implement must be seeded');
      expect(cell.stale).toBe(true);
    }
    const freshNow = Date.parse(SEED_MATRIX_ROWS[0].asOf) + DAY_MS;
    for (const profile of buildSeedMatrix(freshNow).profiles) {
      expect(profile.cells.implement).toMatchObject({ stale: false });
    }
  });

  it('returns fresh objects on every call', () => {
    const first = buildSeedMatrix(NOW);
    const second = buildSeedMatrix(NOW);
    expect(second).toEqual(first);
    expect(second.profiles[0]).not.toBe(first.profiles[0]);
  });
});

describe('isStale', () => {
  const asOf = '2026-02-17';
  const asOfMs = Date.parse(asOf);

  it('is not stale at exactly the staleness age', () => {
    expect(isStale(asOf, asOfMs + STALENESS_AGE_MS)).toBe(false);
  });

  it('is stale one millisecond past the staleness age', () => {
    expect(isStale(asOf, asOfMs + STALENESS_AGE_MS + 1)).toBe(true);
  });

  it('accepts an ISO date-time', () => {
    expect(isStale('2026-10-01T12:00:00.000Z', NOW)).toBe(false);
  });

  it('treats an unparseable date as stale', () => {
    expect(isStale('not a date', NOW)).toBe(true);
  });
});

describe('matrix schema', () => {
  it('has exactly one cell key per outcome task kind', () => {
    expect(Object.keys(MatrixCellsSchema.shape).sort()).toEqual(
      [...OUTCOME_TASK_KINDS].sort(),
    );
  });

  it('accepts a family-level profile with user and local cells', () => {
    const result = CapabilityMatrixSchema.safeParse(
      matrixWith({
        family: 'codex',
        model: FAMILY_PROFILE_MODEL,
        cells: {
          ...unknownCells,
          review: {
            kind: 'value',
            score: 70,
            source: 'user',
            asOf: '2026-10-01',
            stale: false,
          },
          tests: {
            kind: 'value',
            score: 60,
            source: 'local',
            asOf: '2026-10-10T08:30:00.000Z',
            stale: false,
            sampleCount: 5,
          },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a missing task kind and names the entry', () => {
    const withoutDocs = Object.fromEntries(
      Object.entries(unknownCells).filter(([kind]) => kind !== 'docs'),
    );
    const result = CapabilityMatrixSchema.safeParse(
      matrixWith({ family: 'codex', model: '*', cells: withoutDocs }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      'profiles',
      0,
      'cells',
      'docs',
    ]);
  });

  it('rejects an unknown task kind', () => {
    const result = CapabilityMatrixSchema.safeParse(
      matrixWith({
        family: 'codex',
        model: '*',
        cells: { ...unknownCells, architecture: { kind: 'unknown' } },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate profile key and names the entry', () => {
    const profile = {
      family: 'codex',
      model: 'gpt-6-sol',
      cells: unknownCells,
    };
    const result = CapabilityMatrixSchema.safeParse(
      matrixWith(profile, profile),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['profiles', 1, 'model']);
  });

  it('keeps profiles with the same model in different families apart', () => {
    const result = CapabilityMatrixSchema.safeParse(
      matrixWith(
        { family: 'z-ai', model: 'glm-5', cells: unknownCells },
        { family: 'ollama-cloud', model: 'glm-5', cells: unknownCells },
      ),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a blank family or model', () => {
    expect(
      CapabilityMatrixSchema.safeParse(
        matrixWith({ family: ' ', model: '*', cells: unknownCells }),
      ).success,
    ).toBe(false);
    expect(
      CapabilityMatrixSchema.safeParse(
        matrixWith({ family: 'codex', model: '', cells: unknownCells }),
      ).success,
    ).toBe(false);
  });

  it('rejects an unsupported version', () => {
    expect(
      CapabilityMatrixSchema.safeParse({ version: 2, profiles: [] }).success,
    ).toBe(false);
  });

  it.each([
    ['a fractional score', { ...seedCell, score: 72.5 }],
    ['a score above the scale', { ...seedCell, score: 101 }],
    ['a negative score', { ...seedCell, score: -1 }],
    ['a seed value without a source', { ...seedCell, sourceRef: undefined }],
    ['a seed value without a note', { ...seedCell, note: undefined }],
    ['a seed value with a sample count', { ...seedCell, sampleCount: 9 }],
    [
      'a user value with a sample count',
      { ...seedCell, source: 'user', sampleCount: 9 },
    ],
    [
      'a local value without a sample count',
      { ...seedCell, source: 'local', sourceRef: undefined },
    ],
    [
      'a local value below the minimum sample count',
      {
        ...seedCell,
        source: 'local',
        sourceRef: undefined,
        sampleCount: 0,
      },
    ],
    [
      'a local value with an external source',
      { ...seedCell, source: 'local', sampleCount: 5 },
    ],
    ['an unknown source', { ...seedCell, source: 'vendor' }],
    ['a malformed asOf', { ...seedCell, asOf: '17/02/2026' }],
    ['a missing stale flag', { ...seedCell, stale: undefined }],
    ['an extra field', { ...seedCell, label: 'strong' }],
    ['an unknown cell with a score', { kind: 'unknown', score: 50 }],
    ['an unknown kind', { kind: 'guess' }],
  ])('rejects %s', (_name, cell) => {
    expect(MatrixCellSchema.safeParse(cell).success).toBe(false);
  });

  it('accepts a well-formed seed cell', () => {
    expect(MatrixCellSchema.safeParse(seedCell).success).toBe(true);
  });
});
