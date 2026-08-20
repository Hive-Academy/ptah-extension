/**
 * TASK_2026_278 batch 1b — promotion and demotion emit repropagation.
 *
 * Defect 4: promoting a synthesized skill wrote `<skillsRoot>/<slug>/SKILL.md`
 * and fired NOTHING, so the skill reached `.claude/skills` and the rival CLIs
 * only at the next host activation. The residency-cap demotion had the mirror
 * image of the problem — the dormant skill kept occupying the prompt budget
 * until a restart.
 *
 * What this file pins is the EMIT, not what the port does with it. The port's
 * implementations (Electron / cli-engine) are being rewired to call the harness
 * reconciler; this service's contract is "one repropagate per changed slug,
 * after the last write, and never at the cost of the promotion itself".
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillPromotionService } from './skill-promotion.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type {
  SkillRepropagationKind,
  SkillRepropagationPort,
} from './skill-repropagation.port';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';
import { unjudgedVerdictFields, unmeasuredGateFields } from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillPromotionService>[0];

const SETTINGS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
  judgeEnabled: false,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: false,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 2,
  suggestionMaxCandidates: 200,
};

function row(overrides: Partial<SkillCandidateRow> = {}): SkillCandidateRow {
  return {
    id: 'cand_test' as CandidateId,
    name: 'do-thing',
    description: 'do a thing',
    bodyPath: '/tmp/x/SKILL.md',
    sourceSessionIds: ['s1'],
    trajectoryHash: 'h',
    embeddingRowid: null,
    status: 'candidate',
    successCount: 3,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
    residency: 'resident',
    ...unjudgedVerdictFields(),
    ...unmeasuredGateFields(),
    ...overrides,
  };
}

function makeStore(
  initial: SkillCandidateRow,
  residents: SkillCandidateRow[] = [],
): jest.Mocked<SkillCandidateStore> {
  let current = initial;
  return {
    findById: jest.fn((id: CandidateId) =>
      id === current.id ? current : null,
    ),
    listActiveOrderedByDecayScore: jest.fn(() => residents),
    getWinRates: jest.fn(() => []),
    updateStatus: jest.fn((id, next, opts) => {
      current = {
        ...current,
        status: next,
        promotedAt: opts?.promotedAt ?? current.promotedAt,
        bodyPath: opts?.bodyPath ?? current.bodyPath,
      };
      return current;
    }),
    getEmbedding: jest.fn(() => null),
    searchActiveByEmbedding: jest.fn(() => []),
    listByStatus: jest.fn(() => []),
    countDistinctContexts: jest.fn(() => 0),
    setResidency: jest.fn((id: CandidateId, residency) => ({
      ...current,
      id,
      residency,
    })),
  } as unknown as jest.Mocked<SkillCandidateStore>;
}

function makeMdGenerator(): jest.Mocked<SkillMdGenerator> {
  return {
    promoteToActive: jest.fn(() => ({
      slug: 'do-thing',
      dir: '/tmp/active/do-thing',
      filePath: '/tmp/active/do-thing/SKILL.md',
    })),
    candidatesRoot: jest.fn(() => '/tmp/cands'),
    activeRoot: jest.fn(() => '/tmp/active'),
    writeCandidate: jest.fn(),
  } as unknown as jest.Mocked<SkillMdGenerator>;
}

function makeWorkspace(root: string | undefined): IWorkspaceProvider {
  return {
    getWorkspaceRoot: () => root,
    getConfiguration: <T>(_s: string, _k: string, fallback?: T) => fallback,
  } as unknown as IWorkspaceProvider;
}

function makeRepropagation(): jest.Mocked<SkillRepropagationPort> {
  return {
    repropagate: jest.fn<
      Promise<void>,
      [SkillRepropagationKind, string, string]
    >(async () => undefined),
  };
}

describe('SkillPromotionService — repropagation emit', () => {
  it('emits repropagate("skill", slug, ws) after a successful promotion', async () => {
    const store = makeStore(row());
    const repropagation = makeRepropagation();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      repropagation,
    );

    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);

    expect(decision.promoted).toBe(true);
    expect(repropagation.repropagate).toHaveBeenCalledTimes(1);
    expect(repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'do-thing',
      'D:/ws',
    );
  });

  it('emits for BOTH slugs when the residency cap demoted a resident', async () => {
    const weakest = row({
      id: 'cand_weak' as CandidateId,
      name: 'weak-skill',
    });
    const store = makeStore(row(), [weakest]);
    const repropagation = makeRepropagation();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      repropagation,
    );

    const decision = await svc.evaluate('cand_test' as CandidateId, {
      ...SETTINGS,
      maxActiveSkills: 1,
    });

    expect(decision.evictedSkillId).toBe('cand_weak');
    expect(store.setResidency).toHaveBeenCalledWith('cand_weak', 'dormant');
    const slugs = repropagation.repropagate.mock.calls.map((c) => c[1]);
    expect(slugs.sort()).toEqual(['do-thing', 'weak-skill']);
  });

  it('emits ONCE when the demoted resident is the candidate itself', async () => {
    const self = row({ id: 'cand_self' as CandidateId, name: 'do-thing' });
    const store = makeStore(row(), [self]);
    const repropagation = makeRepropagation();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      repropagation,
    );

    await svc.evaluate('cand_test' as CandidateId, {
      ...SETTINGS,
      maxActiveSkills: 1,
    });

    expect(repropagation.repropagate).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when the candidate was not promoted', async () => {
    const store = makeStore(row({ successCount: 1 }));
    const repropagation = makeRepropagation();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      repropagation,
    );

    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);

    expect(decision.reason).toBe('below-threshold');
    expect(repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('passes "" for a headless host with no workspace open', async () => {
    const store = makeStore(row());
    const repropagation = makeRepropagation();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace(undefined),
      repropagation,
    );

    await svc.evaluate('cand_test' as CandidateId, SETTINGS);

    expect(repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'do-thing',
      '',
    );
  });

  it('a throwing port never un-promotes the candidate', async () => {
    const store = makeStore(row());
    const repropagation = makeRepropagation();
    repropagation.repropagate.mockRejectedValue(new Error('reconciler down'));
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      repropagation,
    );

    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);

    expect(decision.promoted).toBe(true);
    expect(decision.reason).toBe('promoted');
  });

  it('promotes normally in a host that bound no repropagation port', async () => {
    const store = makeStore(row());
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      makeMdGenerator(),
      null,
      null,
      null,
      makeWorkspace('D:/ws'),
      null,
    );

    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
  });
});
