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

  it('never emits the agent run on generate → guidance and always sets gen', () => {
    const query = onboardingStepLink('generate', 'guidance', identity).queryParams;
    expect(query).toEqual({ tab: 'tab-1', gen: 'tab-0' });
    expect(query).not.toHaveProperty('run');
  });

  it('sets gen from the agent tab when gen is absent on generate → guidance', () => {
    expect(
      onboardingStepLink('generate', 'guidance', {
        tab: 'agent-tab',
        run: 'agent-run',
      }).queryParams,
    ).toEqual({ tab: 'agent-tab', gen: 'agent-tab' });
  });

  it('keeps a prepared guidance tab and drops the agent run on generate → guidance', () => {
    expect(
      onboardingStepLink('generate', 'guidance', {
        tab: 'guidance-tab',
        run: 'agent-run',
        gen: 'agent-tab',
      }).queryParams,
    ).toEqual({ tab: 'guidance-tab', gen: 'agent-tab' });
  });

  it('keeps gen and the guidance tab on guidance → done and drops run', () => {
    expect(onboardingStepLink('guidance', 'done', identity).queryParams).toEqual({
      tab: 'tab-1',
      gen: 'tab-0',
    });
  });

  it('restores the agent tab from gen on backward guidance → generate and omits run', () => {
    expect(
      onboardingStepLink('guidance', 'generate', identity).queryParams,
    ).toEqual({ tab: 'tab-0' });
  });

  it.each([
    ['new project to team builder', 'new-project-review', 'team-builder-review'],
    ['analyze to new project', 'analyze', 'new-project'],
  ] as const)('carries no identity across unrelated owners (%s)', (_label, from, to) => {
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
