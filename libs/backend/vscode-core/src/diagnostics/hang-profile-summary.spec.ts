import { CpuProfileSchema, summarizeSelfTime } from './hang-profile-summary';
import { syntheticProfile } from '../testing/inspector-session.mock';

describe('summarizeSelfTime', () => {
  const profile = syntheticProfile(50, 10_000_000);

  it('ranks frames by self time with a 1-based url:line, skipping (root)', () => {
    const summary = summarizeSelfTime(profile);

    expect(summary.windowed).toBe(false);
    expect(summary.entries).toEqual([
      { fn: 'hotLoop', at: 'file:///app/main.js:42', selfMs: 490 },
      { fn: 'idleish', at: 'file:///app/other.js:10', selfMs: 10 },
    ]);
    expect(summary.sampledMs).toBe(500);
  });

  it('counts only samples inside the hang window', () => {
    const summary = summarizeSelfTime(profile, {
      startUs: 9_500_000,
      endUs: 9_505_000,
    });

    expect(summary.windowed).toBe(true);
    expect(summary.entries.map((e) => e.fn)).toEqual(['idleish']);
  });

  it('falls back to the whole profile when the window holds no sample', () => {
    const summary = summarizeSelfTime(profile, { startUs: 0, endUs: 1 });

    expect(summary.windowed).toBe(false);
    expect(summary.entries[0].fn).toBe('hotLoop');
  });

  it('honours the limit and names anonymous and native frames', () => {
    const summary = summarizeSelfTime(
      {
        nodes: [
          { id: 1, callFrame: { functionName: '', url: '', lineNumber: 0 } },
          {
            id: 2,
            callFrame: { functionName: 'b', url: 'x.js', lineNumber: 0 },
          },
        ],
        startTime: 0,
        endTime: 30_000,
        samples: [1, 1, 2],
        timeDeltas: [0, 10_000, 10_000],
      },
      undefined,
      1,
    );

    expect(summary.entries).toEqual([
      { fn: '(anonymous)', at: '(native):1', selfMs: 20 },
    ]);
  });

  it('parses a V8-shaped profile and rejects a malformed one', () => {
    expect(CpuProfileSchema.safeParse(profile).success).toBe(true);
    expect(CpuProfileSchema.safeParse({ nodes: 'nope' }).success).toBe(false);
  });
});
