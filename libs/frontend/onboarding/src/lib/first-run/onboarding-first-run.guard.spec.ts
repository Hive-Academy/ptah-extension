import { TestBed } from '@angular/core/testing';
import {
  NavigationStart,
  Router,
  UrlTree,
  provideRouter,
  type ActivatedRouteSnapshot,
  type Navigation,
  type RouterStateSnapshot,
} from '@angular/router';
import { LoggingService, VSCodeService } from '@ptah-extension/core';
import { filter, take } from 'rxjs';
import { ONBOARDING_FLAG_KEY, OnboardingFlagService } from './onboarding-flag.service';
import { onboardingFirstRunGuard } from './onboarding-first-run.guard';
import { OnboardingFirstRunTracker } from './onboarding-first-run.tracker';

const logger = { warn: jest.fn(), error: jest.fn() };

function stored(): Record<string, string> | null {
  const raw = localStorage.getItem(ONBOARDING_FLAG_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('onboardingFirstRunGuard', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  describe('decision', () => {
    let recordRedirect: jest.Mock<void, [number]>;
    let isFirstRunEligible: jest.Mock<boolean, []>;

    function runGuard(
      isElectron: boolean,
      navigation: Navigation | null = { id: 42 } as Navigation,
    ): boolean | UrlTree {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: VSCodeService, useValue: { isElectron } },
          { provide: OnboardingFlagService, useValue: { isFirstRunEligible } },
          { provide: OnboardingFirstRunTracker, useValue: { recordRedirect } },
        ],
      });
      jest
        .spyOn(TestBed.inject(Router), 'currentNavigation')
        .mockReturnValue(navigation);
      const result = TestBed.runInInjectionContext(() =>
        onboardingFirstRunGuard(
          {} as ActivatedRouteSnapshot,
          {} as RouterStateSnapshot,
        ),
      );
      if (typeof result !== 'boolean' && !(result instanceof UrlTree)) {
        throw new Error('the guard is synchronous');
      }
      return result;
    }

    beforeEach(() => {
      recordRedirect = jest.fn<void, [number]>();
      isFirstRunEligible = jest.fn<boolean, []>().mockReturnValue(true);
    });

    it('redirects an eligible Electron boot to /onboarding and records the navigation', () => {
      const result = runGuard(true);

      expect(result).toBeInstanceOf(UrlTree);
      expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
        '/onboarding',
      );
      expect(recordRedirect).toHaveBeenCalledWith(42);
    });

    it('returns true without recording when no navigation is in flight', () => {
      expect(runGuard(true, null)).toBe(true);
      expect(recordRedirect).not.toHaveBeenCalled();
    });

    it('returns true on VS Code without reading the flag', () => {
      expect(runGuard(false)).toBe(true);
      expect(isFirstRunEligible).not.toHaveBeenCalled();
      expect(recordRedirect).not.toHaveBeenCalled();
    });

    it('returns true on Electron when the flag is not eligible (shown, suppressed, unreadable)', () => {
      isFirstRunEligible.mockReturnValue(false);
      expect(runGuard(true)).toBe(true);
      expect(recordRedirect).not.toHaveBeenCalled();
    });
  });

  /**
   * The guard, tracker and flag against the real Router, which is where the
   * redirect-cancel sequence (`NavigationCancel` code `Redirect`, then the
   * replacement navigation) actually comes from.
   */
  describe('with the real Router', () => {
    function configure(isElectron: boolean): Router {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            {
              path: 'chat',
              canActivate: [onboardingFirstRunGuard],
              children: [
                { path: '', children: [] },
                { path: ':tabId', children: [] },
              ],
            },
            { path: 'onboarding', children: [] },
            { path: 'settings', children: [] },
          ]),
          { provide: VSCodeService, useValue: { isElectron } },
          { provide: LoggingService, useValue: logger },
        ],
      });
      TestBed.inject(OnboardingFirstRunTracker).start();
      return TestBed.inject(Router);
    }

    it('lands the first Electron boot on /onboarding and writes shownAt once, after arrival', async () => {
      const router = configure(true);
      const markShown = jest.spyOn(TestBed.inject(OnboardingFlagService), 'markShown');

      expect(await router.navigateByUrl('/chat')).toBe(true);

      expect(router.url).toBe('/onboarding');
      expect(markShown).toHaveBeenCalledTimes(1);
      expect(stored()?.['shownAt']).toEqual(expect.any(String));
    });

    it('redirects a restored /chat/<tabId> the same way', async () => {
      const router = configure(true);
      await router.navigateByUrl('/chat/tab-1');
      expect(router.url).toBe('/onboarding');
    });

    it('lands the second boot on chat', async () => {
      await configure(true).navigateByUrl('/chat');
      TestBed.resetTestingModule();

      const router = configure(true);
      expect(await router.navigateByUrl('/chat')).toBe(true);
      expect(router.url).toBe('/chat');
    });

    it('lets chat through within the same session after the redirect', async () => {
      const router = configure(true);
      await router.navigateByUrl('/chat');
      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/chat');
    });

    it('leaves shownAt unset when a newer navigation supersedes the redirect', async () => {
      const router = configure(true);
      // A host SWITCH_VIEW arrives while the redirect is in flight.
      router.events
        .pipe(
          filter(
            (event): event is NavigationStart =>
              event instanceof NavigationStart &&
              event.url.startsWith('/onboarding'),
          ),
          take(1),
        )
        .subscribe(() => void router.navigateByUrl('/settings'));

      await router.navigateByUrl('/chat');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(router.url).toBe('/settings');
      expect(stored()).toBeNull();
      // Still eligible: the next way to chat shows onboarding.
      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/onboarding');
    });

    it('never redirects on VS Code', async () => {
      const router = configure(false);
      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/chat');
      expect(stored()).toBeNull();
    });

    it('does not run for a deep link to another surface', async () => {
      const router = configure(true);
      const eligible = jest.spyOn(
        TestBed.inject(OnboardingFlagService),
        'isFirstRunEligible',
      );

      await router.navigateByUrl('/settings');

      expect(router.url).toBe('/settings');
      expect(eligible).not.toHaveBeenCalled();
      expect(stored()).toBeNull();
    });

    it('does not commit a manual visit to /onboarding', async () => {
      const router = configure(true);
      await router.navigateByUrl('/onboarding');
      expect(stored()).toBeNull();
    });

    it('keeps chat reachable when storage is unavailable', async () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const router = configure(true);
      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/chat');
    });

    it('keeps chat reachable after a late markShown write failure', async () => {
      const router = configure(true);
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/onboarding');

      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/chat');
    });

    it('keeps chat reachable with an unreadable record', async () => {
      localStorage.setItem(ONBOARDING_FLAG_KEY, '{oops');
      const router = configure(true);
      await router.navigateByUrl('/chat');
      expect(router.url).toBe('/chat');
    });
  });
});
