import { TestBed } from '@angular/core/testing';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { SurfaceSessionStatsRegistry } from './surface-session-stats.registry';

/** A backend session snapshot (TASK_2026_533); `cost` scales every figure. */
function snapshot(
  sessionId: string,
  revision: number | undefined,
  cost: number,
): SessionStatsEntry {
  return {
    sessionId,
    model: 'claude-opus-5',
    totalCost: cost,
    knownCost: cost,
    tokens: {
      input: cost * 100,
      output: cost * 10,
      cacheRead: cost * 1000,
      cacheCreation: cost,
    },
    tokenCount: cost * 1111,
    messageCount: 0,
    agentSessionCount: 1,
    status: 'ok',
    pricingCoverage: 'full',
    scope: 'session',
    revision,
  };
}

describe('SurfaceSessionStatsRegistry', () => {
  let svc: SurfaceSessionStatsRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SurfaceSessionStatsRegistry],
    });
    svc = TestBed.inject(SurfaceSessionStatsRegistry);
  });

  const live = {
    model: 'claude-opus-5',
    contextUsed: 1000,
    contextWindow: 1_000_000,
    contextPercent: 0.1,
  };

  it('returns null for a session it has never seen', () => {
    expect(svc.peek('nope')).toBeNull();
    expect(svc.stats('nope')()).toBeNull();
  });

  it('installs snapshots 10 then 15 without addition, and a stale 10 cannot regress', () => {
    const s10 = snapshot('s1', 10, 10);
    const s15 = snapshot('s1', 15, 15);

    svc.record('s1', { live, snapshot: s10 });
    svc.record('s1', {
      live: { ...live, contextUsed: 2000, contextPercent: 0.2 },
      snapshot: s15,
    });
    svc.record('s1', { live: null, snapshot: s15 });
    svc.record('s1', { live: null, snapshot: s10 });

    const stats = svc.peek('s1');
    // The backend object itself: assignment, never a running sum.
    expect(stats?.snapshot).toBe(s15);
    expect(stats?.snapshot?.totalCost).toBe(15);
    // Live context REPLACES; a turn with no context keeps the last one.
    expect(stats?.live?.contextUsed).toBe(2000);
  });

  // Revision 1 of the review (Defect 1): the revision floor lives beside the
  // displayed snapshot, so an unrevisioned one can neither win nor erase it.
  it('ignores an unrevisioned snapshot after a revisioned one: 15/$15 then $2 stays $15', () => {
    const live = snapshot('s1', 15, 15);
    svc.record('s1', { live: null, snapshot: live });

    svc.record('s1', { live: null, snapshot: snapshot('s1', undefined, 2) });

    expect(svc.peek('s1')?.snapshot).toBe(live);
  });

  it('installs unrevisioned history first, then the live snapshot: $2 then 1/$3 shows $3', () => {
    svc.record('s1', { live: null, snapshot: snapshot('s1', undefined, 2) });
    const live = snapshot('s1', 1, 3);

    svc.record('s1', { live: null, snapshot: live });

    expect(svc.peek('s1')?.snapshot).toBe(live);
  });

  it('keeps the floor across an unrevisioned snapshot: 10, history, then 5 is rejected', () => {
    const history = snapshot('s1', undefined, 1);
    svc.record('s1', { live: null, snapshot: history });
    const ten = snapshot('s1', 10, 10);
    svc.record('s1', { live: null, snapshot: ten });
    svc.record('s1', { live: null, snapshot: snapshot('s1', undefined, 2) });

    svc.record('s1', { live: null, snapshot: snapshot('s1', 5, 5) });

    expect(svc.peek('s1')?.snapshot).toBe(ten);
  });

  // Revision 1 of the review (Defect 3).
  it('rejects a string revision: 16/$16 then revision "9"/$9 stays $16', () => {
    const accepted = snapshot('s1', 16, 16);
    svc.record('s1', { live: null, snapshot: accepted });

    svc.record('s1', {
      live: null,
      snapshot: {
        ...snapshot('s1', undefined, 9),
        revision: '9',
      } as unknown as SessionStatsEntry,
    });

    expect(svc.peek('s1')?.snapshot).toBe(accepted);
  });

  it('rejects malformed tokens and keeps the accepted snapshot', () => {
    const accepted = snapshot('s1', 2, 2);
    svc.record('s1', { live: null, snapshot: accepted });

    svc.record('s1', {
      live: null,
      snapshot: {
        ...snapshot('s1', 3, 3),
        tokens: { input: -1, output: 1, cacheRead: 0, cacheCreation: 0 },
      },
    });

    expect(svc.peek('s1')?.snapshot).toBe(accepted);
  });

  // Final re-review of the review (new moderate defect): a non-string model
  // reached the model-name formatter and threw.
  it('rejects a non-string model and keeps the accepted snapshot', () => {
    const accepted = snapshot('s1', 2, 2);
    svc.record('s1', { live: null, snapshot: accepted });

    svc.record('s1', {
      live: null,
      snapshot: {
        ...snapshot('s1', 3, 3),
        model: 42,
      } as unknown as SessionStatsEntry,
    });

    expect(svc.peek('s1')?.snapshot).toBe(accepted);
  });

  it('accepts a null model', () => {
    const nullModel = { ...snapshot('s1', 3, 3), model: null };
    svc.record('s1', { live: null, snapshot: nullModel });

    expect(svc.peek('s1')?.snapshot).toBe(nullModel);
  });

  it('keeps the last snapshot when a turn carries none', () => {
    const s3 = snapshot('s1', 3, 3);
    svc.record('s1', { live: null, snapshot: s3 });

    svc.record('s1', { live, snapshot: null });

    expect(svc.peek('s1')?.snapshot).toBe(s3);
    expect(svc.peek('s1')?.live).toBe(live);
  });

  it('never stores a snapshot that names a different session', () => {
    svc.record('s1', { live, snapshot: snapshot('s2', 4, 4) });

    expect(svc.peek('s1')?.snapshot).toBeNull();
    expect(svc.peek('s1')?.live).toBe(live);
  });

  it('keeps sessions independent and clears one at a time', () => {
    svc.record('s1', { live: null, snapshot: snapshot('s1', 1, 1) });
    svc.record('s2', { live: null, snapshot: snapshot('s2', 2, 2) });

    svc.clear('s1');

    expect(svc.peek('s1')).toBeNull();
    expect(svc.peek('s2')?.snapshot?.totalCost).toBe(2);
  });

  it('ignores a blank session id', () => {
    svc.record('', { live: null, snapshot: snapshot('', 1, 1) });
    expect(svc.sessions()).toEqual([]);
  });
});
