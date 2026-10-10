import {
  ANCHOR_471,
  PROMOTED_SYNTHESIZED_SLUGS,
  RUBRIC_SAMPLE_SIZE,
  STRATUM_TARGETS,
  allocate,
  classifyBodyShape,
  selectRubricSample,
  weekBands,
  type CandidateEntry,
  type RubricSampleInputs,
} from './select-rubric-sample';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 5, 1);

function syntheticInputs(
  overrides: Partial<RubricSampleInputs> = {},
): RubricSampleInputs {
  const tracked = [
    ...Array.from({ length: 23 }, (_, i) => `authored-skill-${i}`),
    ...PROMOTED_SYNTHESIZED_SLUGS,
  ];
  const candidates: CandidateEntry[] = [];
  ANCHOR_471.forEach((a, i) =>
    candidates.push({
      slug: a.slug,
      bodyShape: 'model',
      row: {
        id: a.id,
        createdAt: START + i * DAY,
        judged: true,
        transcriptTurns: 50,
      },
    }),
  );
  for (let i = 0; i < 80; i += 1) {
    candidates.push({
      slug: `model-cand-${i}`,
      bodyShape: 'model',
      row: {
        id: `M${i}`,
        createdAt: START + i * DAY,
        judged: true,
        transcriptTurns: 10 + (i % 20) * 10,
      },
    });
  }
  for (let i = 0; i < 60; i += 1) {
    candidates.push({
      slug: `fallback-cand-${i}`,
      bodyShape: 'fallback',
      row:
        i % 2 === 0
          ? {
              id: `F${i}`,
              createdAt: START + i * DAY,
              judged: false,
              transcriptTurns: null,
            }
          : null,
    });
  }
  // A promoted skill also left a dir in the candidate copy: never sampled as a candidate.
  candidates.push({
    slug: PROMOTED_SYNTHESIZED_SLUGS[1] ?? '',
    bodyShape: 'model',
    row: null,
  });
  const suggestions = Array.from({ length: 18 }, (_, i) => ({
    id: `S${i}`,
    name: `suggested-skill-${i}`,
  }));
  return {
    seed: 'TASK_2026_620',
    trackedSkillSlugs: tracked,
    candidates,
    suggestions,
    ...overrides,
  };
}

describe('classifyBodyShape', () => {
  it('detects the template fallback by its fixed lines', () => {
    const body = [
      '# Do a thing',
      '',
      'This skill was synthesized automatically from a successful session trajectory.',
      'Edit the body below to make it reusable.',
      '',
      '## Trajectory (normalized)',
    ].join('\n');
    expect(classifyBodyShape(body)).toBe('fallback');
    expect(classifyBodyShape('## Steps\n\n1. Do it')).toBe('model');
  });
});

describe('weekBands', () => {
  it('cuts contiguous weeks into four non-empty bands of near-equal size', () => {
    // A heavy week stays one band instead of swallowing a quartile boundary.
    expect(weekBands([1, 8, 11, 12, 1, 46, 3, 1, 1, 14], 4)).toEqual([
      0, 0, 0, 1, 1, 2, 3, 3, 3, 3,
    ]);
  });

  it('uses one band per week when there are fewer weeks than bands', () => {
    expect(weekBands([5, 7], 4)).toEqual([0, 1]);
    expect(weekBands([], 4)).toEqual([]);
  });
});

describe('allocate', () => {
  it('splits evenly and gives the remainder to the largest cells', () => {
    expect(allocate([10, 10, 10, 10, 10, 10, 10, 10], 20)).toEqual([
      3, 3, 3, 3, 2, 2, 2, 2,
    ]);
  });

  it('moves the deficit of a small cell to cells with spare members', () => {
    const picks = allocate([0, 1, 10, 10, 10, 10, 10, 10], 20);
    expect(picks.reduce((s, p) => s + p, 0)).toBe(20);
    expect(picks[0]).toBe(0);
    expect(picks[1]).toBe(1);
  });

  it('never picks more than the pool holds', () => {
    expect(allocate([1, 2], 20)).toEqual([1, 2]);
  });
});

describe('selectRubricSample', () => {
  it('selects 105 documents with the design stratum counts', () => {
    const sample = selectRubricSample(syntheticInputs());
    expect(sample.documents).toHaveLength(RUBRIC_SAMPLE_SIZE);
    expect(sample.counts).toEqual(STRATUM_TARGETS);
    expect(sample.shortfalls).toEqual([]);
    expect(sample.fallbackIdentifiable).toBe(true);
    expect(new Set(sample.documents.map((d) => d.key)).size).toBe(
      RUBRIC_SAMPLE_SIZE,
    );
  });

  it('is deterministic for a seed and changes with the seed', () => {
    const a = selectRubricSample(syntheticInputs());
    const b = selectRubricSample(syntheticInputs());
    const c = selectRubricSample(syntheticInputs({ seed: 'another-seed' }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const keys = (s: typeof a): string[] =>
      s.documents.filter((d) => d.stratum === 'random').map((d) => d.key);
    expect(keys(c)).not.toEqual(keys(a));
  });

  it('keeps promoted skills out of every candidate stratum and carries anchor totals', () => {
    const sample = selectRubricSample(syntheticInputs());
    const promoted = sample.documents.filter(
      (d) => d.stratum === 'promoted-synthesized',
    );
    expect(promoted.map((d) => d.source.kind)).toEqual([
      'repo-skill',
      'repo-skill',
    ]);
    const candidateSlugs = sample.documents
      .filter((d) => d.source.kind === 'candidate')
      .map((d) => d.slug);
    for (const slug of PROMOTED_SYNTHESIZED_SLUGS)
      expect(candidateSlugs).not.toContain(slug);
    const anchors = sample.documents.filter((d) => d.stratum === 'anchor-471');
    expect(anchors.map((d) => d.anchor471Total)).toEqual(
      ANCHOR_471.map((a) => a.total471),
    );
  });

  it('spreads judged-model picks over the eight week x size cells', () => {
    const sample = selectRubricSample(syntheticInputs());
    expect(sample.judgedModelCells).toHaveLength(8);
    expect(sample.judgedModelCells.reduce((s, c) => s + c.selected, 0)).toBe(
      20,
    );
    for (const cell of sample.judgedModelCells) {
      if (cell.pool >= 2) expect(cell.selected).toBeGreaterThanOrEqual(2);
    }
    const judged = sample.documents.filter((d) => d.stratum === 'judged-model');
    expect(judged.every((d) => d.slug.startsWith('model-cand-'))).toBe(true);
  });

  it('merges fallback into random when no fallback body is identifiable, keeping n = 105', () => {
    const inputs = syntheticInputs();
    const noFallback = inputs.candidates.map((c) => ({
      ...c,
      bodyShape: 'model' as const,
    }));
    const sample = selectRubricSample({ ...inputs, candidates: noFallback });
    expect(sample.fallbackIdentifiable).toBe(false);
    expect(sample.counts.fallback).toBe(0);
    expect(sample.counts.random).toBe(
      STRATUM_TARGETS.random + STRATUM_TARGETS.fallback,
    );
    expect(sample.documents).toHaveLength(RUBRIC_SAMPLE_SIZE);
    expect(sample.notes.join(' ')).toContain('fallback merges into random');
  });

  it('records a missing anchor as a shortfall carried by random', () => {
    const inputs = syntheticInputs();
    const missing = ANCHOR_471[0]?.slug;
    const sample = selectRubricSample({
      ...inputs,
      candidates: inputs.candidates.filter((c) => c.slug !== missing),
    });
    expect(sample.shortfalls).toContainEqual({
      stratum: 'anchor-471',
      target: 10,
      selected: 9,
    });
    expect(sample.counts.random).toBe(STRATUM_TARGETS.random + 1);
    expect(sample.documents).toHaveLength(RUBRIC_SAMPLE_SIZE);
  });

  it('leaves judged candidates without a transcript size out of judged-model', () => {
    const inputs = syntheticInputs();
    const candidates = inputs.candidates.map((c) =>
      c.slug === 'model-cand-0' && c.row
        ? { ...c, row: { ...c.row, transcriptTurns: null } }
        : c,
    );
    const sample = selectRubricSample({ ...inputs, candidates });
    expect(
      sample.documents.find((d) => d.slug === 'model-cand-0')?.stratum,
    ).not.toBe('judged-model');
    expect(sample.notes.join(' ')).toContain('without a transcript size');
  });
});
