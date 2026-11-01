import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type Route } from '@angular/router';
import { VSCodeService } from '@ptah-extension/core';
import { onboardingReadyHostGuard } from './onboarding-ready-host.guard';

function run(isElectron: boolean): ReturnType<typeof onboardingReadyHostGuard> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: VSCodeService, useValue: { isElectron } },
    ],
  });
  return TestBed.runInInjectionContext(() =>
    onboardingReadyHostGuard({} as Route, []),
  );
}

describe('onboardingReadyHostGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('matches in Electron', () => {
    expect(run(true)).toBe(true);
  });

  it('redirects to onboarding Home elsewhere', () => {
    const result = run(false);
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/onboarding',
    );
  });
});
