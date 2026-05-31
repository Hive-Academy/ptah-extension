/**
 * Zod schema tests for `mem:` progressive disclosure RPC params.
 */
import {
  MemSearchIndexParamsSchema,
  MemTimelineParamsSchema,
  MemGetObservationsParamsSchema,
} from './mem-rpc.schema';

describe('MemSearchIndexParamsSchema', () => {
  it('accepts empty input (pure-filter default)', () => {
    const r = MemSearchIndexParamsSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts a full filter blob', () => {
    const r = MemSearchIndexParamsSchema.safeParse({
      query: 'caching',
      topK: 25,
      workspaceRoot: '/workspace/project',
      type: ['bugfix', 'feature'],
      concepts: ['react', 'hooks'],
      files: ['src/App.tsx'],
      dateRange: { fromMs: 1, toMs: 2 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid type enum value', () => {
    const r = MemSearchIndexParamsSchema.safeParse({
      type: ['something-else'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects topK over 100', () => {
    const r = MemSearchIndexParamsSchema.safeParse({ topK: 101 });
    expect(r.success).toBe(false);
  });

  it('rejects empty workspaceRoot string', () => {
    const r = MemSearchIndexParamsSchema.safeParse({ workspaceRoot: '' });
    expect(r.success).toBe(false);
  });
});

describe('MemTimelineParamsSchema', () => {
  it('accepts minimum anchorId', () => {
    const r = MemTimelineParamsSchema.safeParse({ anchorId: 'mem-1' });
    expect(r.success).toBe(true);
  });

  it('rejects missing anchorId', () => {
    const r = MemTimelineParamsSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects empty anchorId', () => {
    const r = MemTimelineParamsSchema.safeParse({ anchorId: '' });
    expect(r.success).toBe(false);
  });

  it('clamps before/after at 50', () => {
    const r = MemTimelineParamsSchema.safeParse({
      anchorId: 'mem-1',
      before: 51,
    });
    expect(r.success).toBe(false);
  });
});

describe('MemGetObservationsParamsSchema', () => {
  it('accepts at least one id', () => {
    const r = MemGetObservationsParamsSchema.safeParse({ ids: ['mem-1'] });
    expect(r.success).toBe(true);
  });

  it('rejects empty ids array', () => {
    const r = MemGetObservationsParamsSchema.safeParse({ ids: [] });
    expect(r.success).toBe(false);
  });

  it('rejects more than 200 ids', () => {
    const r = MemGetObservationsParamsSchema.safeParse({
      ids: Array.from({ length: 201 }, (_, i) => `mem-${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('accepts includeQueueRows boolean', () => {
    const r = MemGetObservationsParamsSchema.safeParse({
      ids: ['mem-1'],
      includeQueueRows: false,
    });
    expect(r.success).toBe(true);
  });
});
