/**
 * TASK_2026_158 Batch 7 (QA) — Library render perf/NFR.
 *
 * `skill-clones-state.service.spec.ts` already proves ONE `getScorecards` call
 * happens for a 3-clone list (1 agent slug). That is a correctness proof, not
 * a scale proof: a bug that chunks the batched call (e.g. "one RPC per 50
 * clones") would still pass a 1-agent-slug assertion. This file drives the
 * same state service with ~200 synthetic agent clones — the NFR explicitly
 * called out in `implementation-plan.md` D5 ("200-clone Library render = 1
 * RPC + 1 GROUP-BY") and `task-description.md` NFR — and asserts the RPC call
 * count stays exactly 1 regardless of clone count.
 */
import { TestBed } from '@angular/core/testing';
import type { AgentScorecard, CloneSummary } from '@ptah-extension/shared';

import { SkillClonesStateService } from './skill-clones-state.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

const CLONE_COUNT = 200;

function clone(slug: string, kind: CloneSummary['kind']): CloneSummary {
  return {
    slug,
    kind,
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 3,
    successRate: 1,
    lastEnhancedAt: null,
    historyCount: 0,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
  };
}

function scorecard(slug: string): AgentScorecard {
  return {
    slug,
    totalInvocations: 3,
    gradedCount: 2,
    gradedSuccessRate: 0.5,
    avgInputTokens: 100,
    avgOutputTokens: 40,
    avgCacheReadTokens: null,
    totalInputTokens: 300,
    totalOutputTokens: 120,
    avgCostUsd: 0.012,
    avgDurationMs: 4200,
    avgToolCount: 5,
    recentVerdicts: [],
  };
}

type RpcSlice = Pick<
  SkillSynthesisRpcService,
  'listClones' | 'getClone' | 'getScorecards' | 'getScorecardDetail'
>;

describe('SkillClonesStateService — 200-clone Library render perf (NFR)', () => {
  it('issues exactly ONE batched getScorecards RPC for 200 synthetic agent clones', async () => {
    // 200 clones: 150 agent-kind (scorecard-eligible) + 50 skill-kind (not).
    const clones: CloneSummary[] = [];
    for (let i = 0; i < CLONE_COUNT; i++) {
      const kind: CloneSummary['kind'] = i % 4 === 0 ? 'skill' : 'agent';
      clones.push(clone(`agent-${i}`, kind));
    }
    const agentSlugs = clones
      .filter((c) => c.kind === 'agent')
      .map((c) => c.slug);
    expect(agentSlugs.length).toBeGreaterThan(100); // sanity: real 200-scale fixture

    const scorecardsBySlug = Object.fromEntries(
      agentSlugs.map((slug) => [slug, scorecard(slug)]),
    );

    const rpc: jest.Mocked<RpcSlice> = {
      listClones: jest.fn(async () => clones),
      getClone: jest.fn(),
      getScorecards: jest.fn(async () => scorecardsBySlug),
      getScorecardDetail: jest.fn(),
    } as unknown as jest.Mocked<RpcSlice>;

    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillClonesStateService);

    await svc.refreshClones();

    // The one and only assertion that matters for this NFR: call COUNT, not
    // call shape — a per-card fetch strategy would call this N times.
    expect(rpc.getScorecards).toHaveBeenCalledTimes(1);
    expect(rpc.getScorecards.mock.calls[0][0]).toHaveLength(agentSlugs.length);
    expect(Object.keys(svc.scorecards())).toHaveLength(agentSlugs.length);
  });
});
