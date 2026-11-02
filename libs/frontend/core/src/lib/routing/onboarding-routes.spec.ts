import {
  ONBOARDING_QUERY,
  isOnboardingIdentityValue,
  onboardingGenerationBinding,
  onboardingGenerationTarget,
  onboardingHarnessTarget,
  onboardingReadyTarget,
  parseOnboardingReadyArea,
  parseOnboardingReadyOpen,
} from './onboarding-routes';

describe('onboarding routes', () => {
  describe('isOnboardingIdentityValue', () => {
    it.each([
      ['a plain id', 'tab-1'],
      ['a uuid', '3f2b5c1e-7a4d-4c8e-9b1f-2d6a0e5c7b9a'],
      ['the longest allowed value', 'x'.repeat(256)],
    ])('accepts %s', (_label, value) => {
      expect(isOnboardingIdentityValue(value)).toBe(true);
    });

    it.each([
      ['the empty string', ''],
      ['a value over 256 characters', 'x'.repeat(257)],
      ['a slash', 'a/b'],
      ['a backslash', 'a\\b'],
      ['a colon', 'a:b'],
      ['a repeated query key (array)', ['a', 'b']],
      ['a number', 3],
      ['undefined', undefined],
      ['null', null],
    ])('rejects %s', (_label, value) => {
      expect(isOnboardingIdentityValue(value)).toBe(false);
    });
  });

  describe('onboardingGenerationTarget', () => {
    it('sends agent generation to Choose agents with the tab', () => {
      expect(
        onboardingGenerationTarget('setup-agent-generation', 'tab-1'),
      ).toEqual({ subPath: ['analyze', 'agents'], queryParams: { tab: 'tab-1' } });
    });

    it('sends project guidance to the guidance-only entry with the tab', () => {
      expect(onboardingGenerationTarget('setup-project-prompt', 'tab-2')).toEqual(
        { subPath: ['guidance'], queryParams: { tab: 'tab-2' } },
      );
    });
  });

  describe('onboardingHarnessTarget', () => {
    it.each([
      ['new-project', undefined, ['new-project']],
      ['new-project', 'workspace', ['new-project', 'workspace']],
      ['new-project', 'review', ['new-project', 'review']],
      ['configure-harness', undefined, ['team-builder']],
      ['configure-harness', 'workspace', ['team-builder', 'workspace']],
      ['configure-harness', 'review', ['team-builder', 'review']],
    ] as const)('maps %s / %s to %j', (mode, step, subPath) => {
      expect(onboardingHarnessTarget(mode, 'tab-9', step)).toEqual({
        subPath,
        queryParams: { tab: 'tab-9' },
      });
    });
  });

  describe('onboardingGenerationBinding', () => {
    const tab = { [ONBOARDING_QUERY.tab]: 'tab-1' };

    it.each([
      [['onboarding', 'analyze', 'agents'], 'setup-agent-generation'],
      [['onboarding', 'analyze', 'generate'], 'setup-agent-generation'],
      [['onboarding', 'analyze', 'guidance'], 'setup-project-prompt'],
      [['onboarding', 'guidance'], 'setup-project-prompt'],
    ] as const)('binds %j to %s', (segments, workflow) => {
      expect(onboardingGenerationBinding(segments, tab)).toEqual({
        tabId: 'tab-1',
        workflow,
      });
    });

    it.each([
      ['Home', ['onboarding']],
      ['Analyze workspace', ['onboarding', 'analyze']],
      ['Done', ['onboarding', 'analyze', 'done']],
      ['an unknown analyze step', ['onboarding', 'analyze', 'nope']],
      ['an extra segment', ['onboarding', 'analyze', 'agents', 'x']],
      ['a harness page', ['onboarding', 'new-project', 'workspace']],
      ['another surface', ['settings', 'guidance']],
      ['the legacy generation URL', ['setup-wizard', 'generation']],
      ['no segments', []],
    ])('returns null for %s', (_label, segments) => {
      expect(onboardingGenerationBinding(segments, tab)).toBeNull();
    });

    it.each([
      ['no tab', {}],
      ['an empty tab', { tab: '' }],
      ['a tab with a colon', { tab: 'a:b' }],
      ['a tab with a slash', { tab: 'a/b' }],
      ['a repeated tab key', { tab: ['a', 'b'] }],
    ])('returns null for %s', (_label, queryParams) => {
      expect(
        onboardingGenerationBinding(['onboarding', 'guidance'], queryParams),
      ).toBeNull();
    });
  });

  describe('onboardingReadyTarget', () => {
    it('defaults to the Claude Code check with an empty query', () => {
      expect(onboardingReadyTarget()).toEqual({
        subPath: ['ready'],
        queryParams: {},
      });
      expect(onboardingReadyTarget('claude')).toEqual({
        subPath: ['ready'],
        queryParams: {},
      });
    });

    it('sends settings without area or open to an empty query', () => {
      expect(onboardingReadyTarget('settings')).toEqual({
        subPath: ['ready', 'settings'],
        queryParams: {},
      });
    });

    it.each(['providers', 'cli'] as const)('carries area %s', (area) => {
      expect(onboardingReadyTarget('settings', area)).toEqual({
        subPath: ['ready', 'settings'],
        queryParams: { area },
      });
    });

    it('carries open with area for the named-account link', () => {
      expect(
        onboardingReadyTarget('settings', 'providers', 'claude-accounts'),
      ).toEqual({
        subPath: ['ready', 'settings'],
        queryParams: { area: 'providers', open: 'claude-accounts' },
      });
    });

    it('carries open alone when no area is given', () => {
      expect(
        onboardingReadyTarget('settings', undefined, 'claude-accounts'),
      ).toEqual({
        subPath: ['ready', 'settings'],
        queryParams: { open: 'claude-accounts' },
      });
    });
  });

  describe('parseOnboardingReadyArea', () => {
    it.each(['providers', 'cli'] as const)('reads %s', (area) => {
      expect(parseOnboardingReadyArea(area)).toBe(area);
    });

    it.each([
      ['an unknown area', 'billing'],
      ['undefined', undefined],
      ['an array', ['cli']],
      ['a number', 1],
    ])('reads %s as providers', (_label, value) => {
      expect(parseOnboardingReadyArea(value)).toBe('providers');
    });
  });

  describe('parseOnboardingReadyOpen', () => {
    it('reads claude-accounts', () => {
      expect(parseOnboardingReadyOpen('claude-accounts')).toBe(
        'claude-accounts',
      );
    });

    it.each([
      ['an unknown drawer', 'codex-accounts'],
      ['undefined', undefined],
      ['an array', ['claude-accounts']],
      ['the empty string', ''],
    ])('reads %s as null', (_label, value) => {
      expect(parseOnboardingReadyOpen(value)).toBeNull();
    });
  });
});
