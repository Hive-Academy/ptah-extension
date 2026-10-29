import { onboardingStepLink } from './onboarding-step-link';

describe('onboardingStepLink', () => {
  const identity = {
    analysis: 'analysis-1.json',
    source: 'catalog',
    tab: 'tab-1',
    run: 'run-1',
    gen: 'tab-0',
    rev: '3',
    draft: 'd-1',
  };

  it('builds absolute commands for every step', () => {
    expect(onboardingStepLink('analyze', 'analyze', {}).commands).toEqual([
      '/onboarding',
      'analyze',
    ]);
    expect(onboardingStepLink('agents', 'generate', {}).commands).toEqual([
      '/onboarding',
      'analyze',
      'generate',
    ]);
    expect(
      onboardingStepLink('guidance-only', 'guidance-only', {}).commands,
    ).toEqual(['/onboarding', 'guidance']);
    expect(
      onboardingStepLink('team-builder', 'team-builder-review', {}).commands,
    ).toEqual(['/onboarding', 'team-builder', 'review']);
  });

  it('copies the Analyze owner keys between A1, A2 and A3', () => {
    expect(onboardingStepLink('agents', 'generate', identity).queryParams).toEqual(
      { analysis: 'analysis-1.json', source: 'catalog', tab: 'tab-1', run: 'run-1' },
    );
    expect(onboardingStepLink('generate', 'agents', identity).queryParams).toEqual(
      { analysis: 'analysis-1.json', source: 'catalog', tab: 'tab-1', run: 'run-1' },
    );
  });

  it('copies tab and rev within a proposal flow', () => {
    expect(
      onboardingStepLink('new-project-workspace', 'new-project-review', identity)
        .queryParams,
    ).toEqual({ tab: 'tab-1', rev: '3' });
    expect(
      onboardingStepLink('team-builder-review', 'team-builder-workspace', identity)
        .queryParams,
    ).toEqual({ tab: 'tab-1', rev: '3' });
  });

  it.each([
    ['agent generation to guidance', 'generate', 'guidance'],
    ['new project to team builder', 'new-project-review', 'team-builder-review'],
    ['guidance to done', 'guidance', 'done'],
    ['analyze to new project', 'analyze', 'new-project'],
  ] as const)('carries no identity across owners (%s)', (_label, from, to) => {
    // A merged query would carry one owner's `run` into another owner's page.
    expect(onboardingStepLink(from, to, identity).queryParams).toEqual({});
  });

  it('drops empty and non-string values', () => {
    expect(
      onboardingStepLink('agents', 'generate', {
        tab: '',
        run: ['a', 'b'],
        analysis: 3,
      }).queryParams,
    ).toEqual({});
  });
});
