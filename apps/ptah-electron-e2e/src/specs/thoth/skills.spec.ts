import { test, expect } from '../../support/fixtures';

interface CandidateFixture {
  id: string;
  name: string;
  description: string;
  status: 'candidate' | 'promoted' | 'rejected';
  successCount: number;
  failureCount: number;
  createdAt: number;
  promotedAt: number | null;
  rejectedAt: number | null;
  rejectedReason: string | null;
  pinned: boolean;
}

function makeCandidate(
  id: string,
  status: CandidateFixture['status'],
): CandidateFixture {
  return {
    id,
    name: 'skill ' + id,
    description: 'does ' + id,
    status,
    successCount: 3,
    failureCount: 0,
    createdAt: 1_700_000_000_000,
    promotedAt: status === 'promoted' ? 1_700_000_100_000 : null,
    rejectedAt: status === 'rejected' ? 1_700_000_100_000 : null,
    rejectedReason: null,
    pinned: false,
  };
}

const SETTINGS_FIXTURE = {
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
  judgeEnabled: true,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
};

test.describe('Thoth — Skills tab', () => {
  test('candidate table + stats render', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': {
        candidates: [
          makeCandidate('s1', 'candidate'),
          makeCandidate('s2', 'candidate'),
        ],
      },
      'skillSynthesis:stats': {
        totalCandidates: 2,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
    });

    await ui.openTab('skills');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-testid="skills-stat-candidates"]'),
    ).toHaveText('2');
  });

  test('filter switches candidate set', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': `(params) => {
        if (params && params.status === 'promoted') {
          return { candidates: [{
            id: 's-prom', name: 'skill s-prom', description: 'does s-prom',
            status: 'promoted', successCount: 4, failureCount: 0,
            createdAt: 1700000000000, promotedAt: 1700000100000,
            rejectedAt: null, rejectedReason: null, pinned: false
          }] };
        }
        return { candidates: [
          { id: 's1', name: 'skill s1', description: 'does s1',
            status: 'candidate', successCount: 3, failureCount: 0,
            createdAt: 1700000000000, promotedAt: null,
            rejectedAt: null, rejectedReason: null, pinned: false },
          { id: 's2', name: 'skill s2', description: 'does s2',
            status: 'candidate', successCount: 3, failureCount: 0,
            createdAt: 1700000000000, promotedAt: null,
            rejectedAt: null, rejectedReason: null, pinned: false }
        ] };
      }`,
      'skillSynthesis:stats': {
        totalCandidates: 2,
        totalPromoted: 1,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 1,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
    });

    await ui.openTab('skills');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(2);

    await page.locator('[data-testid="skills-filter-promoted"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('promoted');
  });

  test('promote opens modal and confirms', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': `(params) => {
        const g = globalThis;
        const promoted = g.__skillsPromoted === true;
        return { candidates: [{
          id: 's1', name: 'skill s1', description: 'does s1',
          status: promoted ? 'promoted' : 'candidate',
          successCount: 3, failureCount: 0,
          createdAt: 1700000000000,
          promotedAt: promoted ? 1700000100000 : null,
          rejectedAt: null, rejectedReason: null, pinned: false
        }] };
      }`,
      'skillSynthesis:stats': {
        totalCandidates: 1,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
      'skillSynthesis:promote': `(params) => {
        globalThis.__skillsPromoted = true;
        return { promoted: true, reason: null, filePath: 'SKILL.md' };
      }`,
    });

    await ui.openTab('skills');

    const page = ui.page;

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('candidate');

    await page.locator('[data-testid="skills-promote-btn"]').click();
    await expect(
      page.locator('[data-testid="skills-action-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="skills-action-confirm"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('promoted');
  });
});
