import { ReviewPolicyService } from './review-policy.service';
import type { EligibilityInput } from './review-policy.service';

const settings = {
  repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
  maintainerLogins: ['Maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [],
};
const valid: EligibilityInput = {
  owner: 'Hive-Academy', name: 'PtahCode', authorLogin: 'maintainer', state: 'open', draft: false,
  headIsFork: false, headRepoId: 7, baseRepoId: 7, settings, baseConfig: null,
};

describe('ReviewPolicyService', () => {
  const policy = new ReviewPolicyService();
  it.each([
    [{ owner: 'Other' }, 'repository-disabled'],
    [{ settings: { ...settings, maintainerLogins: [] } }, 'empty-allowlist'],
    [{ settings: { ...settings, pollMinutes: 0 } }, 'invalid-settings'],
    [{ settings: { ...settings, repositories: [] } }, 'repository-disabled'],
    [{ baseConfig: { version: 2 } }, 'invalid-config'],
    [{ state: 'closed' }, 'closed-or-merged'],
    [{ draft: true }, 'draft'],
    [{ headIsFork: true }, 'fork'],
    [{ headRepoId: 8 }, 'fork'],
    [{ authorLogin: 'stranger' }, 'untrusted-author'],
  ] as const)('rejects %p as %s', (override, reason) => {
    expect(policy.eligibility({ ...valid, ...override })).toEqual({ eligible: false, reason });
  });
  it('accepts case-insensitive maintainer and applies defaults', () => {
    expect(policy.eligibility(valid)).toEqual({ eligible: true, reason: 'eligible' });
    expect(policy.effectiveSettings(settings, null)).toEqual({
      laneCapPerPr: 6, confidenceFloor: 0.8, maxNewInline: 10, minimumSeverity: 'Minor',
    });
  });
  it.each([
    [{ ...settings, globalPublicationPaused: true }, null, 'global-pause'],
    [{ ...settings, repositories: [{ ...settings.repositories[0], publicationPaused: true }] }, null, 'repository-pause'],
    [settings, null, 'dry-run'],
    [settings, { version: 2 }, 'invalid-config'],
  ] as const)('gates publication: %s', (value, config, reason) => {
    expect(policy.publication(value, config, { owner: 'Hive-Academy', name: 'PtahCode' })).toEqual({ allowed: false, reason });
  });
  it('uses the selected repository for eligibility and publication', () => {
    const second = { owner: 'Other', name: 'Review', enabled: true, dryRun: true, publicationPaused: false };
    const value = { ...settings, repositories: [{ ...settings.repositories[0], dryRun: false }, second] };
    expect(policy.eligibility({ ...valid, owner: 'Other', name: 'Review', settings: value }).eligible).toBe(true);
    expect(policy.publication(value, null, second)).toEqual({ allowed: false, reason: 'dry-run' });
    expect(policy.publication({ ...value, repositories: [{ ...value.repositories[0], dryRun: true }, { ...second, dryRun: false }] }, null, second))
      .toEqual({ allowed: true, reason: 'allowed' });
  });
  it('allows publication after dry run is disabled', () => {
    expect(policy.publication({ ...settings, repositories: [{ ...settings.repositories[0], dryRun: false }] }, null, { owner: 'Hive-Academy', name: 'PtahCode' }))
      .toEqual({ allowed: true, reason: 'allowed' });
  });
});
