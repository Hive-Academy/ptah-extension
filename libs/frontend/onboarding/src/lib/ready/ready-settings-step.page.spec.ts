import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
  type WritableSignal,
} from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import {
  OnboardingFlagService,
  type OnboardingFlag,
} from '../first-run/onboarding-flag.service';
import {
  ClaudeReadinessStore,
  type ClaudeReadinessState,
  type ClaudeReadinessView,
} from './claude-readiness.store';
import {
  CliOrchestrationMatrixComponent,
  ProvidersModelsLoader,
  ProvidersSettingsComponent,
  SettingsSaveFeedbackService,
  SettingsToastComponent,
} from '@ptah-extension/chat/settings-embed';
import {
  READY_SETTINGS_PROVIDERS,
  ReadySettingsStepPage,
} from './ready-settings-step.page';

interface ProvidersStub {
  requestedDrawer(): unknown;
  readonly feedback: unknown;
  readonly loader: unknown;
}

/*
 * The real settings components are replaced by stubs with the same selectors
 * and inputs: this spec pins the page contract, not the embeds.
 */
@Component({
  selector: 'ptah-providers-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="providers-stub">providers</p>`,
})
class ProvidersSettingsStubComponent {
  readonly requestedDrawer = input<unknown>(null);
  readonly feedback = inject(SettingsSaveFeedbackService);
  readonly loader = inject(PROVIDER_MODELS_LOADER);
}

@Component({
  selector: 'ptah-cli-orchestration-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="cli-stub">cli</p>`,
})
class CliOrchestrationMatrixStubComponent {}

@Component({
  selector: 'ptah-settings-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
class SettingsToastStubComponent {}

const ACCOUNTS = { connection: 'claude-cli', tab: 'accounts' };

describe('ReadySettingsStepPage', () => {
  let view: WritableSignal<ClaudeReadinessView>;
  let refresh: jest.Mock;
  let open: jest.Mock;
  let markReady: jest.Mock;
  let harness: RouterTestingHarness;

  async function render(
    url = '/onboarding/ready/settings',
    state: ClaudeReadinessState = 'ready',
  ): Promise<HTMLElement> {
    view = signal({ state, errorCause: null, path: null, version: null });
    refresh = jest.fn().mockResolvedValue(state);
    open = jest.fn().mockResolvedValue(undefined);
    markReady = jest.fn();
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
      providers: [
        provideRouter([
          {
            path: 'onboarding/ready/settings',
            component: ReadySettingsStepPage,
            providers: READY_SETTINGS_PROVIDERS,
          },
          { path: 'onboarding/ready', children: [] },
          { path: 'onboarding', children: [] },
        ]),
        {
          provide: ClaudeReadinessStore,
          useValue: {
            view,
            rechecking: signal(false),
            refresh,
            available: true,
          },
        },
        { provide: ProvidersSettingsStateService, useValue: { open } },
        {
          provide: OnboardingFlagService,
          useValue: { flag: signal<OnboardingFlag>({}), markReady },
        },
      ],
    });
    TestBed.overrideComponent(ReadySettingsStepPage, {
      remove: {
        imports: [
          ProvidersSettingsComponent,
          CliOrchestrationMatrixComponent,
          SettingsToastComponent,
        ],
      },
      add: {
        imports: [
          ProvidersSettingsStubComponent,
          CliOrchestrationMatrixStubComponent,
          SettingsToastStubComponent,
        ],
      },
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return harness.routeNativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const q = (el: HTMLElement, id: string): HTMLElement | null =>
    el.querySelector(`[data-testid="${id}"]`);

  function providersStub(): ProvidersStub {
    const debug = harness.fixture.debugElement.query(
      (node) => node.name === 'ptah-providers-settings',
    );
    return debug.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('has one h1 and the strip on step 2, and reads readiness on mount', async () => {
    const el = await render();
    expect(el.querySelectorAll('h1')).toHaveLength(1);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe(
      'Connect providers and tools',
    );
    expect(
      el.querySelector('li[aria-current="step"]')?.getAttribute('data-step'),
    ).toBe('2');
    expect(refresh).toHaveBeenCalledWith(false);
    expect(el.querySelector('ptah-settings-toast')).not.toBeNull();
    expect(el.textContent).toContain(
      'More options (voice, search, lane guards) are in Settings after setup.',
    );
  });

  it.each([
    ['/onboarding/ready/settings', 'providers'],
    ['/onboarding/ready/settings?area=providers', 'providers'],
    ['/onboarding/ready/settings?area=cli', 'cli'],
    ['/onboarding/ready/settings?area=junk', 'providers'],
  ])('parses %s to the %s tab', async (url, area) => {
    const el = await render(url);
    const selected = el.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.id).toBe(`ready-area-tab-${area}`);
    expect(q(el, `ready-area-panel-${area}`)?.getAttribute('tabindex')).toBe(
      '0',
    );
  });

  it('embeds the real Providers component in its tabpanel, deferred', async () => {
    const el = await render();
    expect(
      q(el, 'ready-area-panel-providers')?.querySelector(
        'ptah-providers-settings',
      ),
    ).not.toBeNull();
  });

  it('resolves the page-scope providers from the tabpanel element injector (R19)', async () => {
    await render();
    const stub = providersStub();
    expect(stub.feedback).toBeInstanceOf(SettingsSaveFeedbackService);
    expect(stub.loader).toBeInstanceOf(ProvidersModelsLoader);
  });

  it('requests the Claude Accounts drawer only for area=providers&open=claude-accounts', async () => {
    await render(
      '/onboarding/ready/settings?area=providers&open=claude-accounts',
    );
    expect(providersStub().requestedDrawer()).toEqual(ACCOUNTS);
  });

  it.each([
    '/onboarding/ready/settings',
    '/onboarding/ready/settings?open=claude-accounts',
    '/onboarding/ready/settings?area=junk&open=claude-accounts',
    '/onboarding/ready/settings?area=providers&open=junk',
    '/onboarding/ready/settings?area=providers',
  ])('requests no drawer for %s', async (url) => {
    await render(url);
    expect(providersStub().requestedDrawer()).toBeNull();
  });

  it('clears the drawer request on a tab change, so a remount never reopens it', async () => {
    const el = await render(
      '/onboarding/ready/settings?area=providers&open=claude-accounts',
    );
    (el.querySelector('#ready-area-tab-cli') as HTMLElement).click();
    await settle();
    (el.querySelector('#ready-area-tab-providers') as HTMLElement).click();
    await settle();
    expect(providersStub().requestedDrawer()).toBeNull();
  });

  it('opens the settings state once per CLI panel mount and shows the matrix', async () => {
    const el = await render();
    expect(open).not.toHaveBeenCalled();
    (el.querySelector('#ready-area-tab-cli') as HTMLElement).click();
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      q(el, 'ready-area-panel-cli')?.querySelector(
        'ptah-cli-orchestration-matrix',
      ),
    ).not.toBeNull();
    expect(q(el, 'ready-area-panel-providers')).toBeNull();
  });

  it('opens the settings state when entering on the CLI tab', async () => {
    await render('/onboarding/ready/settings?area=cli');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('wraps the tablist with the arrow keys', async () => {
    const el = await render();
    const tab = (id: string) =>
      el.querySelector(`#ready-area-tab-${id}`) as HTMLElement;
    tab('providers').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft' }),
    );
    await settle();
    expect(tab('cli').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('cli'));
    tab('cli').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    await settle();
    expect(tab('providers').getAttribute('aria-selected')).toBe('true');
  });

  it.each([
    ['ready-settings-skip', 'skippedAt'],
    ['ready-settings-continue', 'settingsAt'],
  ])('%s writes %s and goes to Home', async (id, key) => {
    const el = await render();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');
    q(el, id)?.click();
    expect(markReady).toHaveBeenCalledWith(key);
    expect(navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  it('Back links to stage 1', async () => {
    const el = await render();
    expect(q(el, 'ready-settings-back')?.getAttribute('href')).toBe(
      '/onboarding/ready',
    );
  });

  it.each<[ClaudeReadinessState, boolean]>([
    ['missing', true],
    ['signed-out', true],
    ['error', true],
    ['checking', false],
    ['ready', false],
  ])('shows the banner for %s: %s', async (state, shown) => {
    const el = await render('/onboarding/ready/settings', state);
    const banner = q(el, 'claude-readiness-banner');
    expect(banner !== null).toBe(shown);
    if (banner) expect(banner.textContent).toContain('Fix Claude Code');
  });
});
