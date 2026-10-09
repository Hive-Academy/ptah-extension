import { z } from 'zod';

import { questionEnvelopeSchema, toSet } from './question-sets';

const envelope = {
  id: 'memory-skills',
  version: '1' as const,
  method: 'seeded' as const,
  frozenAt: '2026-10-07T00:00:00.000Z',
  corpusCommit: 'abc',
  generator: 'test',
  seed: null,
  counts: { questions: 0 },
  questions: [],
};

const messages = (result: { error?: z.ZodError }): string[] =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('question envelope ground truth', () => {
  it('loads model-panel with panel onto the ground-truth ref', () => {
    const parsed = questionEnvelopeSchema.parse({
      ...envelope,
      method: 'model-panel',
      panel: 'memory-skills-panel',
    });
    const set = toSet(
      {
        envelope: parsed,
        path: 'questions/memory.json',
        sha256: 'aa',
        raw: parsed,
      },
      [],
    );

    expect(set.groundTruth).toEqual({
      id: 'memory-skills',
      version: '1',
      method: 'model-panel',
      panel: 'memory-skills-panel',
      frozenAt: '2026-10-07T00:00:00.000Z',
    });
  });

  it('rejects model-panel without panel and panel on another method', () => {
    expect(
      messages(
        questionEnvelopeSchema.safeParse({
          ...envelope,
          method: 'model-panel',
        }),
      ),
    ).toEqual(['model-panel ground truth requires panel']);
    expect(
      messages(
        questionEnvelopeSchema.safeParse({
          ...envelope,
          panel: 'memory-skills-panel',
        }),
      ),
    ).toEqual(['panel is only valid for model-panel ground truth']);
  });
});
