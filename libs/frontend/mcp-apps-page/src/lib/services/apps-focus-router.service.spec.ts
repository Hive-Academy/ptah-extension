import { TestBed } from '@angular/core/testing';
import { SurfaceRouterService } from '@ptah-extension/core';
import { AppsFocusTarget } from './apps-focus-target';
import { AppsFocusRouter } from './apps-focus-router.service';

describe('AppsFocusRouter', () => {
  const target = { currentSessionId: jest.fn() };
  const surface = { navigateToSurface: jest.fn() };
  let router: AppsFocusRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    target.currentSessionId.mockReturnValue('owned');
    surface.navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({ providers: [
      AppsFocusRouter,
      { provide: AppsFocusTarget, useValue: target },
      { provide: SurfaceRouterService, useValue: surface },
    ] });
    router = TestBed.inject(AppsFocusRouter);
  });

  it('claims only the active apps session and opens the apps page', async () => {
    expect(router.canFocus('owned')).toBe(true);
    expect(router.canFocus('other')).toBe(false);
    await expect(router.focus('owned')).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(surface.navigateToSurface).toHaveBeenCalledWith('apps');
    await expect(router.focus('other')).resolves.toEqual({ success: false, outcome: 'missing' });
  });

  it('does not claim a null or empty session id', () => {
    target.currentSessionId.mockReturnValue(null);
    expect(router.canFocus('owned')).toBe(false);
    expect(router.canFocus('')).toBe(false);
  });

  it('reports missing when surface navigation does not land', async () => {
    surface.navigateToSurface.mockResolvedValue('cancelled');
    await expect(router.focus('owned')).resolves.toEqual({ success: false, outcome: 'missing' });
  });
});

describe('AppsFocusTarget', () => {
  it('returns null until a session source is registered', () => {
    const target = new AppsFocusTarget();
    expect(target.currentSessionId()).toBeNull();
    target.register(() => 'owned');
    expect(target.currentSessionId()).toBe('owned');
  });
});
