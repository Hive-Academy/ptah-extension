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

/**
 * All four lanes, matching `SkillLanesDto` (`libs/shared/.../rpc-curator-diagnostics.types.ts`).
 * `synthesis` is pinned to a real registry provider + model — the exact shape
 * that regressed under commit 9e42f9c81 (a lone `[value]` on the `<select>`
 * without `[selected]` on the `@for` options silently renders a pinned lane
 * as "Active provider (default)"). The other three stay on the `''`/`''`
 * inherit sentinel, which is the documented default for every lane
 * (tasks.md B1.8.1: "Every lane default is `provider: ''`, `model: ''`").
 */
const LANES_FIXTURE = {
  archaeologist: {
    id: 'archaeologist',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'required',
    timeoutMs: 60_000,
    maxInputChars: 20_000,
    maxPasses: 3,
  },
  synthesis: {
    id: 'synthesis',
    provider: 'moonshot',
    model: 'kimi-k2',
    defaultTier: 'sonnet',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 60_000,
    maxInputChars: 20_000,
    maxPasses: 1,
  },
  judge: {
    id: 'judge',
    provider: '',
    model: '',
    defaultTier: 'sonnet',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 30_000,
    maxInputChars: 10_000,
    maxPasses: 1,
  },
  replay: {
    id: 'replay',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 30_000,
    maxInputChars: 10_000,
    maxPasses: 1,
  },
};

const LANE_IDS = ['archaeologist', 'synthesis', 'judge', 'replay'] as const;

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

    await page.locator('[data-testid="skills-subview-candidates"]').click();

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

    await page.locator('[data-testid="skills-subview-candidates"]').click();

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

    await page.locator('[data-testid="skills-subview-candidates"]').click();

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

  /**
   * P1-9 part (c) — Electron half. Proves the shared
   * `ProviderModelPickerComponent` (extracted from the deleted
   * `curator-model-picker.component.ts` fork into `libs/frontend/ui`,
   * batches B1.9/B1.10) mounts four times inside
   * `SkillSettingsPanelComponent`'s Lanes section, enumerates the provider
   * registry, and — the exact defect commit 9e42f9c81 fixed — renders a
   * pinned lane's provider AND model as pinned rather than falling back to
   * "Active provider (default)".
   */
  test('Settings lane pickers render, enumerate providers, and a pinned lane renders pinned', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': { candidates: [] },
      'skillSynthesis:stats': {
        totalCandidates: 0,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
      'skillSynthesis:getLanes': { lanes: LANES_FIXTURE },
      'provider:listModels': `(params) => {
        if (params && params.providerId === 'moonshot') {
          return {
            models: [{
              id: 'kimi-k2', name: 'Kimi K2', description: 'Moonshot Kimi K2',
              contextLength: 200000, supportsToolUse: true
            }],
            totalCount: 1, isStatic: true
          };
        }
        return { models: [], totalCount: 0, isStatic: true };
      }`,
    });

    await ui.openTab('skills');
    const page = ui.page;

    await page.locator('[data-testid="skills-subview-settings"]').click();

    const pickers = page.locator('[data-testid="skills-lane-picker"]');
    await expect(pickers).toHaveCount(4);

    for (const laneId of LANE_IDS) {
      const picker = page.locator(
        `[data-testid="skills-lane-picker"][data-lane="${laneId}"]`,
      );
      await expect(picker).toHaveCount(1);
      // Enumeration: the registry's provider list is offered on every lane,
      // not just the pinned one.
      await expect(
        picker
          .locator('[data-testid="provider-model-picker-provider"]')
          .locator('option[value="moonshot"]'),
      ).toHaveText('Moonshot (Kimi)');
    }

    // The regressed case: a pinned lane must show ITS provider/model, not the
    // inherit sentinel.
    const synthesisPicker = page.locator(
      '[data-testid="skills-lane-picker"][data-lane="synthesis"]',
    );
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('moonshot');
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-model"]'),
    ).toHaveValue('kimi-k2');

    // An untouched lane still shows the documented default: inherit.
    const judgePicker = page.locator(
      '[data-testid="skills-lane-picker"][data-lane="judge"]',
    );
    await expect(
      judgePicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('');
  });
});
