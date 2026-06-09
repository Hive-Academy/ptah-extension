import { TestBed } from '@angular/core/testing';
import type { CloneSummary } from '@ptah-extension/shared';

import { SkillClonesStateService } from './skill-clones-state.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 0,
    successRate: 1,
    lastEnhancedAt: null,
    historyCount: 0,
    pendingSourceHash: null,
    ...overrides,
  };
}

function makeRpc(): jest.Mocked<
  Pick<SkillSynthesisRpcService, 'listClones' | 'getClone'>
> {
  return {
    listClones: jest.fn(async () => [
      clone(),
      clone({ slug: 'x', diverged: true }),
    ]),
    getClone: jest.fn(async () => ({
      clone: clone(),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    })),
  } as unknown as jest.Mocked<
    Pick<SkillSynthesisRpcService, 'listClones' | 'getClone'>
  >;
}

describe('SkillClonesStateService', () => {
  function setup(rpc = makeRpc()) {
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillClonesStateService);
    return { svc, rpc };
  }

  it('refreshes clones and computes diverged count', async () => {
    const { svc } = setup();
    await svc.refreshClones();
    expect(svc.clones().length).toBe(2);
    expect(svc.divergedCount()).toBe(1);
    expect(svc.loading()).toBe(false);
  });

  it('records error on refresh failure', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockRejectedValueOnce(new Error('boom'));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.error()).toBe('boom');
  });

  it('loads detail and clears it', async () => {
    const { svc } = setup();
    await svc.loadDetail('deep-research', 'skill');
    expect(svc.selectedSlug()).toBe('deep-research');
    expect(svc.detail()?.history.length).toBe(1);
    svc.clearDetail();
    expect(svc.selectedSlug()).toBeNull();
    expect(svc.detail()).toBeNull();
  });
});
