import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AppStateManager } from '@ptah-extension/core';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from './onboarding-announcer.service';
import { OnboardingRunPillService } from './onboarding-run-pill.service';
import { OnboardingShellComponent } from './onboarding-shell.component';

@Component({
  selector: 'ptah-test-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1 tabindex="-1">Home title</h1>`,
})
class HomePageStubComponent {}

@Component({
  selector: 'ptah-test-step-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1 tabindex="-1">Step title</h1>`,
})
class StepPageStubComponent {}

describe('OnboardingShellComponent', () => {
  let markDismissed: jest.Mock<void, []>;
  let setCurrentView: jest.Mock<void, [string]>;

  async function open(url: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    await harness.fixture.whenStable();
    return harness;
  }

  function query<T extends Element>(
    harness: RouterTestingHarness,
    selector: string,
  ): T | null {
    return (harness.fixture.nativeElement as HTMLElement).querySelector<T>(
      selector,
    );
  }

  beforeEach(() => {
    markDismissed = jest.fn<void, []>();
    setCurrentView = jest.fn<void, [string]>();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'onboarding',
            component: OnboardingShellComponent,
            children: [
              { path: '', component: HomePageStubComponent },
              { path: 'analyze', component: StepPageStubComponent },
            ],
          },
        ]),
        { provide: OnboardingFlagService, useValue: { markDismissed } },
        { provide: AppStateManager, useValue: { setCurrentView } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('offers Back to chat on Home, which dismisses onboarding', async () => {
    const harness = await open('/onboarding');
    const back = query<HTMLButtonElement>(
      harness,
      '[data-testid="onboarding-back-to-chat"]',
    );

    expect(back?.textContent?.trim()).toBe('Back to chat');
    expect(query(harness, '[data-testid="onboarding-crumb-home"]')).toBeNull();

    back?.click();
    expect(markDismissed).toHaveBeenCalledTimes(1);
    expect(setCurrentView).toHaveBeenCalledWith('chat');
  });

  it('returns to Home through the first crumb on any other page', async () => {
    const harness = await open('/onboarding/analyze');
    const crumb = query<HTMLAnchorElement>(
      harness,
      '[data-testid="onboarding-crumb-home"]',
    );

    expect(crumb?.getAttribute('href')).toBe('/onboarding');
    expect(query(harness, '[data-testid="onboarding-back-to-chat"]')).toBeNull();
    expect(
      query(harness, 'nav[aria-label="Breadcrumb"]'),
    ).not.toBeNull();
  });

  it('moves focus to the page h1 when a page activates', async () => {
    const harness = await open('/onboarding');
    TestBed.tick();
    expect(document.activeElement?.textContent).toBe('Home title');

    await harness.navigateByUrl('/onboarding/analyze');
    TestBed.tick();
    expect(document.activeElement?.textContent).toBe('Step title');
  });

  it('renders announcements in one polite status region', async () => {
    // Navigate on real timers: fake ones can stall the harness's whenStable.
    const harness = await open('/onboarding');
    jest.useFakeTimers();
    try {
      TestBed.inject(OnboardingAnnouncerService).announce('Revision 4 received');
      jest.runOnlyPendingTimers();
      harness.detectChanges();

      const region = query<HTMLElement>(
        harness,
        '[data-testid="onboarding-announcer"]',
      );
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(region?.textContent?.trim()).toBe('Revision 4 received');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the run pill only while a page sets it', async () => {
    const harness = await open('/onboarding');
    const pill = TestBed.inject(OnboardingRunPillService);
    expect(query(harness, '[data-testid="onboarding-run-pill"]')).toBeNull();

    pill.show('Claude · sonnet');
    harness.detectChanges();
    expect(
      query(harness, '[data-testid="onboarding-run-pill"]')?.textContent?.trim(),
    ).toBe('Claude · sonnet');

    pill.clear();
    harness.detectChanges();
    expect(query(harness, '[data-testid="onboarding-run-pill"]')).toBeNull();
  });
});
