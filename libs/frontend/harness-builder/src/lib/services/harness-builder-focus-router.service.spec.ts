import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SurfaceRouterService } from '@ptah-extension/core';
import { HarnessBuilderFocusRouter } from './harness-builder-focus-router.service';

describe('HarnessBuilderFocusRouter', () => {
  const tab = { id: 'tab-2', workflow: 'harness-configure' };
  const tabs = {
    activeWorkspacePath: '/work',
    findTabBySessionIdAcrossWorkspaces: jest.fn(),
    switchTab: jest.fn(),
  };
  const surface = { navigateToSurface: jest.fn() };
  let router: HarnessBuilderFocusRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    tabs.findTabBySessionIdAcrossWorkspaces.mockImplementation((id: string) =>
      id === 'owned' ? { tab, workspacePath: '/work' } : null);
    surface.navigateToSurface.mockResolvedValue('already-there');
    TestBed.configureTestingModule({ providers: [
      HarnessBuilderFocusRouter,
      { provide: TabManagerService, useValue: tabs },
      { provide: SurfaceRouterService, useValue: surface },
    ] });
    router = TestBed.inject(HarnessBuilderFocusRouter);
  });

  it('claims only its builder session and focuses the existing route', async () => {
    expect(router.canFocus('owned')).toBe(true);
    expect(router.canFocus('other')).toBe(false);
    await expect(router.focus('owned')).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(surface.navigateToSurface).toHaveBeenCalledWith('harness-builder', ['configure-harness', 'tab-2']);
    expect(tabs.switchTab).toHaveBeenCalledWith('tab-2');
    await expect(router.focus('other')).resolves.toEqual({ success: false, outcome: 'missing' });
  });
});
