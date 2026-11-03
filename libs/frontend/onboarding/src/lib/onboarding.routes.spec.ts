import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { OnboardingFlagService } from './first-run/onboarding-flag.service';
import { ONBOARDING_ROUTES } from './onboarding.routes';
import {
  HARNESS_FLOW_MODE,
  ProposalFlowStore,
} from './proposal/proposal-flow.store';

/* The pages are stubbed: this spec pins the route tree, not the pages. */
function stubPage(selector: string) {
  @Component({
    selector,
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<h1 tabindex="-1">{{ '${selector}' }}</h1>`,
  })
  class StubPage {}
  return StubPage;
}

jest.mock('./home/onboarding-home.component', () => ({
  OnboardingHomeComponent: stubPage('ptah-onboarding-home'),
}));
jest.mock('./ready/ready-claude-step.page', () => ({
  ReadyClaudeStepPage: stubPage('ptah-ready-claude-step'),
}));
jest.mock('./ready/ready-settings-step.page', () => ({
  READY_SETTINGS_PROVIDERS: [],
  ReadySettingsStepPage: stubPage('ptah-ready-settings-step'),
}));
jest.mock('./analyze/analyze-workspace.page', () => ({
  AnalyzeWorkspacePage: stubPage('ptah-analyze-workspace-page'),
}));
jest.mock('./analyze/choose-agents.page', () => ({
  ChooseAgentsPage: stubPage('ptah-choose-agents-page'),
}));
jest.mock('./analyze/generate-agents.page', () => ({
  GenerateAgentsPage: stubPage('ptah-generate-agents-page'),
}));
jest.mock('./analyze/project-guidance.page', () => ({
  ProjectGuidancePage: stubPage('ptah-project-guidance-page'),
}));
jest.mock('./analyze/analyze-done.page', () => ({
  AnalyzeDonePage: stubPage('ptah-analyze-done-page'),
}));
jest.mock('./proposal/proposal-flow.store', () => {
  const { InjectionToken } =
    jest.requireActual<typeof import('@angular/core')>('@angular/core');
  return {
    ProposalFlowStore: class {},
    HARNESS_FLOW_MODE: new InjectionToken('test mode'),
  };
});
jest.mock('./proposal/new-project-intake.page', () => ({
  NewProjectIntakePage: stubPage('ptah-new-project-intake-page'),
}));
jest.mock('./proposal/team-builder-start.page', () => ({
  TeamBuilderStartPage: stubPage('ptah-team-builder-start-page'),
}));
jest.mock('./proposal/proposal-workspace.page', () => ({
  ProposalWorkspacePage: stubPage('ptah-proposal-workspace-page'),
}));
jest.mock('./proposal/review-apply.page', () => ({
  ReviewApplyPage: stubPage('ptah-review-apply-page'),
}));

describe('ONBOARDING_ROUTES', () => {
  it('provides a separate flow store at each proposal parent route', () => {
    const children = (ONBOARDING_ROUTES[0] as Route).children ?? [];
    for (const [path, mode] of [
      ['new-project', 'new-project'],
      ['team-builder', 'configure-harness'],
    ] as const) {
      const route = children.find((entry) => entry.path === path);
      expect(route?.providers).toContain(ProposalFlowStore);
      expect(route?.providers).toContainEqual({
        provide: HARNESS_FLOW_MODE,
        useValue: mode,
      });
      expect(route?.children?.map((entry) => entry.path)).toEqual([
        '',
        'workspace',
        'review',
      ]);
    }
  });
  function configure(isElectron: boolean): Router {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'onboarding', children: ONBOARDING_ROUTES }]),
        { provide: VSCodeService, useValue: { isElectron } },
        {
          provide: OnboardingFlagService,
          useValue: { markDismissed: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    return TestBed.inject(Router);
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each(['/onboarding/ready', '/onboarding/ready/settings?area=cli'])(
    'resolves %s in Electron',
    async (url) => {
      const router = configure(true);
      await router.navigateByUrl(url);
      expect(router.url).toBe(url);
    },
  );

  it.each(['/onboarding/ready', '/onboarding/ready/settings'])(
    'sends %s to Home outside Electron',
    async (url) => {
      const router = configure(false);
      await router.navigateByUrl(url);
      expect(router.url).toBe('/onboarding');
    },
  );

  it('keeps the ** fallback to Home last', async () => {
    const router = configure(true);
    await router.navigateByUrl('/onboarding/nowhere');
    expect(router.url).toBe('/onboarding');
  });
  it.each([
    '/onboarding/analyze',
    '/onboarding/analyze/agents?source=catalog',
    '/onboarding/analyze/generate?tab=t&run=r',
    '/onboarding/analyze/guidance?tab=t&run=r&gen=g',
    '/onboarding/analyze/done?gen=g&tab=t',
    '/onboarding/guidance?tab=t&run=r',
    '/onboarding/new-project',
    '/onboarding/new-project/workspace?tab=t',
    '/onboarding/new-project/review?tab=t&rev=r',
    '/onboarding/team-builder',
    '/onboarding/team-builder/workspace?tab=t',
    '/onboarding/team-builder/review?tab=t&rev=r',
  ])('resolves %s before the fallback', async (url) => {
    const router = configure(true);
    await router.navigateByUrl(url);
    expect(router.url).toBe(url);
  });
});
