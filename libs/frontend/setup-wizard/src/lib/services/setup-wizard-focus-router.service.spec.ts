import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SurfaceRouterService, WORKSPACE_COORDINATOR } from '@ptah-extension/core';
import { SetupWizardFocusRouter } from './setup-wizard-focus-router.service';

describe('SetupWizardFocusRouter', () => {
  const tab = { id: 'tab-1', workflow: 'setup-agent-generation' };
  const tabs = {
    activeWorkspacePath: '/work',
    findTabBySessionIdAcrossWorkspaces: jest.fn(),
    switchTab: jest.fn(),
  };
  const surface = { navigateToSurface: jest.fn() };
  const workspace = { switchWorkspace: jest.fn() };
  let router: SetupWizardFocusRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.switchWorkspace.mockResolvedValue(undefined);
    tabs.findTabBySessionIdAcrossWorkspaces.mockImplementation((id: string) =>
      id === 'owned' ? { tab, workspacePath: '/work' } :
      id === 'other-workspace' ? { tab, workspacePath: '/elsewhere' } : null);
    surface.navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({ providers: [
      SetupWizardFocusRouter,
      { provide: TabManagerService, useValue: tabs },
      { provide: SurfaceRouterService, useValue: surface },
      { provide: WORKSPACE_COORDINATOR, useValue: workspace },
    ] });
    router = TestBed.inject(SetupWizardFocusRouter);
  });

  it('claims only its bound generation session and focuses the route', async () => {
    expect(router.canFocus('owned')).toBe(true);
    expect(router.canFocus('other')).toBe(false);
    await expect(router.focus('owned')).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(surface.navigateToSurface).toHaveBeenCalledWith('setup-wizard', ['generation', 'setup-agent-generation', 'tab-1']);
    expect(tabs.switchTab).toHaveBeenCalledWith('tab-1');
    await expect(router.focus('other')).resolves.toEqual({ success: false, outcome: 'missing' });
  });

  it('switches to the session workspace before navigating', async () => {
    expect(router.canFocus('other-workspace')).toBe(true);
    workspace.switchWorkspace.mockImplementation(async () => {
      expect(surface.navigateToSurface).not.toHaveBeenCalled();
    });
    await expect(router.focus('other-workspace')).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(workspace.switchWorkspace).toHaveBeenCalledWith('/elsewhere');
    expect(surface.navigateToSurface).toHaveBeenCalledWith('setup-wizard', ['generation', 'setup-agent-generation', 'tab-1']);
  });
});
