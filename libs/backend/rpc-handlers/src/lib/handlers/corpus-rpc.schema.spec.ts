/**
 * Zod schema tests for `corpus:` knowledge-corpus RPC params.
 */
import {
  CorpusListParamsSchema,
  CorpusGetParamsSchema,
  CorpusBuildParamsSchema,
  CorpusPrimeParamsSchema,
  CorpusQueryParamsSchema,
  CorpusReprimeParamsSchema,
  CorpusRebuildParamsSchema,
  CorpusDeleteParamsSchema,
} from './corpus-rpc.schema';

describe('CorpusListParamsSchema', () => {
  it('accepts empty input', () => {
    const r = CorpusListParamsSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts workspaceRoot filter', () => {
    const r = CorpusListParamsSchema.safeParse({ workspaceRoot: '/ws' });
    expect(r.success).toBe(true);
  });

  it('rejects empty workspaceRoot', () => {
    const r = CorpusListParamsSchema.safeParse({ workspaceRoot: '' });
    expect(r.success).toBe(false);
  });
});

describe('CorpusGetParamsSchema', () => {
  it('accepts a valid name', () => {
    const r = CorpusGetParamsSchema.safeParse({ name: 'react-hooks' });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    const r = CorpusGetParamsSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects empty name', () => {
    const r = CorpusGetParamsSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('CorpusBuildParamsSchema', () => {
  it('accepts minimal payload (name only)', () => {
    const r = CorpusBuildParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(true);
  });

  it('accepts a full filter blob', () => {
    const r = CorpusBuildParamsSchema.safeParse({
      name: 'react',
      workspaceRoot: '/ws',
      type: ['bugfix', 'feature'],
      concepts: ['hooks'],
      files: ['src/App.tsx'],
      query: 'caching',
      dateRange: { fromMs: 1, toMs: 2 },
      limit: 50,
    });
    expect(r.success).toBe(true);
  });

  it('accepts null workspaceRoot', () => {
    const r = CorpusBuildParamsSchema.safeParse({
      name: 'react',
      workspaceRoot: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid type enum value', () => {
    const r = CorpusBuildParamsSchema.safeParse({
      name: 'react',
      type: ['nope'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects limit over 500', () => {
    const r = CorpusBuildParamsSchema.safeParse({ name: 'r', limit: 501 });
    expect(r.success).toBe(false);
  });

  it('rejects empty name', () => {
    const r = CorpusBuildParamsSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('CorpusPrimeParamsSchema', () => {
  it('accepts a valid name', () => {
    const r = CorpusPrimeParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    const r = CorpusPrimeParamsSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('CorpusQueryParamsSchema', () => {
  it('accepts a valid name + question', () => {
    const r = CorpusQueryParamsSchema.safeParse({
      name: 'react',
      question: 'how do hooks compose?',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty question', () => {
    const r = CorpusQueryParamsSchema.safeParse({
      name: 'react',
      question: '',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing question', () => {
    const r = CorpusQueryParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(false);
  });
});

describe('CorpusReprimeParamsSchema', () => {
  it('accepts a valid name', () => {
    const r = CorpusReprimeParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = CorpusReprimeParamsSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});

describe('CorpusRebuildParamsSchema', () => {
  it('accepts a valid name', () => {
    const r = CorpusRebuildParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    const r = CorpusRebuildParamsSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('CorpusDeleteParamsSchema', () => {
  it('accepts a valid name', () => {
    const r = CorpusDeleteParamsSchema.safeParse({ name: 'react' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = CorpusDeleteParamsSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });
});
