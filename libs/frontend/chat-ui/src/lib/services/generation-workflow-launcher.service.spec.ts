import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SurfaceRouterService, VSCodeService } from '@ptah-extension/core';
import { GenerationWorkflowLauncherService } from './generation-workflow-launcher.service';

describe('GenerationWorkflowLauncherService', () => {
  const tabs = {
    activeWorkspacePath: '/ws' as string | null,
    findWorkflowTab: jest.fn(),
    getWorkspaceTabs: jest.fn(),
    createWorkflowTabForWorkspace: jest.fn(),
    switchTab: jest.fn(),
  };
  const router = { navigateToSurface: jest.fn() };
  const vscode = { config: () => ({ workspaceRoot: '/ws', isVSCode: true }) };
  let launcher: GenerationWorkflowLauncherService;

  beforeEach(() => {
    jest.clearAllMocks();
    tabs.findWorkflowTab.mockReturnValue(null);
    tabs.getWorkspaceTabs.mockReturnValue([{ id: 'anchor' }]);
    tabs.createWorkflowTabForWorkspace.mockReturnValue('new-tab');
    router.navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({
      providers: [
        GenerationWorkflowLauncherService,
        { provide: TabManagerService, useValue: tabs },
        { provide: SurfaceRouterService, useValue: router },
        { provide: VSCodeService, useValue: vscode },
      ],
    });
    launcher = TestBed.inject(GenerationWorkflowLauncherService);
  });

  const request = {
    workspacePath: '/ws',
    workflow: 'setup-agent-generation' as const,
    origin: 'analysis-result-continue' as const,
  };

  it('focuses an existing same-workspace workflow owner', async () => {
    tabs.findWorkflowTab.mockReturnValue({ id: 'owner' });
    await expect(launcher.open(request)).resolves.toEqual({
      outcome: 'landed',
      tabId: 'owner',
    });
    expect(tabs.createWorkflowTabForWorkspace).not.toHaveBeenCalled();
    expect(router.navigateToSurface).toHaveBeenCalledWith(
      'onboarding',
      ['analyze', 'agents'],
      {
        queryParams: { tab: 'owner' },
      },
    );
    expect(tabs.switchTab).toHaveBeenCalledWith('owner');
    expect(launcher.consumeOrigin('owner')).toBe('analysis-result-continue');
    expect(launcher.consumeOrigin('owner')).toBeNull();
  });

  it('creates in the background without changing focus', async () => {
    await expect(launcher.open({ ...request, focus: false })).resolves.toEqual({
      outcome: 'landed',
      tabId: 'new-tab',
    });
    expect(router.navigateToSurface).not.toHaveBeenCalled();
    expect(tabs.switchTab).not.toHaveBeenCalled();
  });

  it('returns failed if the requested background partition or anchor cannot create', async () => {
    tabs.activeWorkspacePath = '/other';
    tabs.createWorkflowTabForWorkspace.mockReturnValue(null);
    await expect(launcher.open({ ...request, focus: false })).resolves.toEqual({
      outcome: 'failed',
    });
    expect(tabs.switchTab).not.toHaveBeenCalled();
    tabs.activeWorkspacePath = '/ws';
  });

  it('distinguishes cancelled and failed navigation', async () => {
    router.navigateToSurface
      .mockResolvedValueOnce('cancelled')
      .mockResolvedValueOnce('failed');
    await expect(launcher.open(request)).resolves.toEqual({
      outcome: 'cancelled',
    });
    await expect(launcher.open(request)).resolves.toEqual({
      outcome: 'failed',
    });
    expect(tabs.switchTab).not.toHaveBeenCalled();
  });

  it('fails if the active workspace changes while navigation is pending', async () => {
    router.navigateToSurface.mockImplementationOnce(async () => {
      tabs.activeWorkspacePath = '/other';
      return 'navigated';
    });
    await expect(launcher.open(request)).resolves.toEqual({
      outcome: 'failed',
    });
    expect(tabs.switchTab).not.toHaveBeenCalled();
    expect(launcher.consumeOrigin('new-tab')).toBeNull();
    tabs.activeWorkspacePath = '/ws';
  });

  it('opens a VS Code root in the unpartitioned tab set', async () => {
    tabs.activeWorkspacePath = null;
    await expect(
      launcher.open({ ...request, workspacePath: '/ws/' }),
    ).resolves.toEqual({
      outcome: 'landed',
      tabId: 'new-tab',
    });
    expect(tabs.switchTab).toHaveBeenCalledWith('new-tab');
    tabs.activeWorkspacePath = '/ws';
  });

  it('rejects another root while the panel is unpartitioned', async () => {
    tabs.activeWorkspacePath = null;
    await expect(
      launcher.open({ ...request, workspacePath: '/other' }),
    ).resolves.toEqual({ outcome: 'failed' });
    expect(tabs.createWorkflowTabForWorkspace).not.toHaveBeenCalled();
    tabs.activeWorkspacePath = '/ws';
  });
});
