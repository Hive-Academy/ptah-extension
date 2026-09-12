import { TestBed } from '@angular/core/testing';
import type {
  CloneSummary,
  SkillCloneKind,
  SkillSynthesisRebaseCloneResult,
} from '@ptah-extension/shared';

import { CloneBulkRebaseService } from './clone-bulk-rebase.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

function clone(slug: string, kind: SkillCloneKind = 'skill'): CloneSummary {
  return {
    slug,
    kind,
    cloneStatus: 'diverged',
    diverged: true,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
  };
}

function ok(
  slug: string,
  kind: SkillCloneKind = 'skill',
): SkillSynthesisRebaseCloneResult {
  return {
    kind,
    slug,
    sourceHash: 'hash',
    snapshotPath: '/history/1',
    failed: false,
    reason: null,
  };
}

function softFailure(
  slug: string,
  reason: string,
): SkillSynthesisRebaseCloneResult {
  return {
    kind: 'skill',
    slug,
    sourceHash: '',
    snapshotPath: null,
    failed: true,
    reason,
  };
}

interface Harness {
  readonly service: CloneBulkRebaseService;
  readonly rebaseClone: jest.Mock;
}

function setup(): Harness {
  const rebaseClone = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      CloneBulkRebaseService,
      { provide: SkillSynthesisRpcService, useValue: { rebaseClone } },
    ],
  });
  return { service: TestBed.inject(CloneBulkRebaseService), rebaseClone };
}

describe('CloneBulkRebaseService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('calls the existing per-clone rebase once per entry, with kind and slug', async () => {
    const { service, rebaseClone } = setup();
    rebaseClone.mockImplementation((kind: SkillCloneKind, slug: string) =>
      Promise.resolve(ok(slug, kind)),
    );

    await service.run([clone('a'), clone('b', 'agent')]);

    expect(rebaseClone).toHaveBeenCalledTimes(2);
    expect(rebaseClone).toHaveBeenNthCalledWith(1, 'skill', 'a');
    expect(rebaseClone).toHaveBeenNthCalledWith(2, 'agent', 'b');
  });

  it('runs sequentially — the next call starts only after the previous settles', async () => {
    const { service, rebaseClone } = setup();
    const inFlight: string[] = [];
    let concurrent = 0;
    let peak = 0;
    rebaseClone.mockImplementation(async (_kind: SkillCloneKind, slug: string) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      inFlight.push(slug);
      await Promise.resolve();
      concurrent -= 1;
      return ok(slug);
    });

    await service.run([clone('a'), clone('b'), clone('c')]);

    expect(peak).toBe(1);
    expect(inFlight).toEqual(['a', 'b', 'c']);
  });

  it('attempts every clone when one throws and another soft-fails, naming both slugs', async () => {
    const { service, rebaseClone } = setup();
    rebaseClone.mockImplementation((_kind: SkillCloneKind, slug: string) => {
      if (slug === 'b') return Promise.reject(new Error('transport exploded'));
      if (slug === 'c') {
        return Promise.resolve(softFailure('c', 'Cannot resolve upstream'));
      }
      return Promise.resolve(ok(slug));
    });

    const outcomes = await service.run([clone('a'), clone('b'), clone('c')]);

    // R1.4: the batch never aborts early.
    expect(rebaseClone).toHaveBeenCalledTimes(3);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toEqual({ slug: 'a', ok: true, reason: null });
    expect(outcomes[1]).toEqual({
      slug: 'b',
      ok: false,
      reason: 'transport exploded',
    });
    expect(outcomes[2]).toEqual({
      slug: 'c',
      ok: false,
      reason: 'Cannot resolve upstream',
    });
    expect(service.failedSlugs()).toEqual(['b', 'c']);
    expect(service.outcomes()).toEqual(outcomes);
  });

  it('clears `running` after a batch containing failures', async () => {
    const { service, rebaseClone } = setup();
    rebaseClone.mockRejectedValue(new Error('nope'));

    expect(service.running()).toBe(false);
    const pending = service.run([clone('a')]);
    expect(service.running()).toBe(true);
    await pending;

    expect(service.running()).toBe(false);
  });

  it('clears `running` even when the loop throws unexpectedly', async () => {
    const { service, rebaseClone } = setup();
    // A non-Error, non-Promise return makes `await` fine but the outcome path
    // must still not strand the surface; force a synchronous throw instead.
    rebaseClone.mockImplementation(() => {
      throw new Error('sync throw');
    });

    await service.run([clone('a')]);

    expect(service.running()).toBe(false);
  });

  it('reports progress as done/total and ends at the full count', async () => {
    const { service, rebaseClone } = setup();
    const seen: Array<{ done: number; total: number }> = [];
    rebaseClone.mockImplementation((_kind: SkillCloneKind, slug: string) => {
      const p = service.progress();
      if (p) seen.push({ ...p });
      return Promise.resolve(ok(slug));
    });

    await service.run([clone('a'), clone('b')]);

    expect(seen).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
    ]);
    expect(service.progress()).toEqual({ done: 2, total: 2 });
  });

  it('makes no call and reports an empty batch for an empty set', async () => {
    const { service, rebaseClone } = setup();

    const outcomes = await service.run([]);

    expect(rebaseClone).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(service.running()).toBe(false);
  });
});
