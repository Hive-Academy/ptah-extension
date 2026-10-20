import { TestBed } from '@angular/core/testing';
import { SurfaceRouterService } from '@ptah-extension/core';
import { AppsSessionService } from './apps-session.service';
import { AppsFocusRouter } from './apps-focus-router.service';

describe('AppsFocusRouter', () => {
  const sessions = { sessionId: jest.fn() };
  const surface = { navigateToSurface: jest.fn() };
  let router: AppsFocusRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.sessionId.mockReturnValue('owned');
    surface.navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({ providers: [
      AppsFocusRouter,
      { provide: AppsSessionService, useValue: sessions },
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
});
