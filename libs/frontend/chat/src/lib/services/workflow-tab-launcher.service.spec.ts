import { TestBed } from '@angular/core/testing';
import { AppStateManager, SurfaceRouterService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { WorkflowTabLauncherService } from './workflow-tab-launcher.service';

describe('WorkflowTabLauncherService', () => {
  const navigateToSurface = jest.fn();
  const createTab = jest.fn(() => 'tab-1');
  const setWorkflow = jest.fn();
  const setFirstMessagePreamble = jest.fn();
  const requestCanvasTab = jest.fn();
  const requestComposerPrefill = jest.fn();
  let service: WorkflowTabLauncherService;

  beforeEach(() => {
    jest.clearAllMocks();
    navigateToSurface.mockResolvedValue('navigated');
    TestBed.configureTestingModule({
      providers: [
        WorkflowTabLauncherService,
        { provide: SurfaceRouterService, useValue: { navigateToSurface } },
        {
          provide: TabManagerService,
          useValue: {
            createTab,
            setWorkflow,
            setFirstMessagePreamble,
            activeWorkspacePath: '/work',
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            requestCanvasTab,
            requestComposerPrefill,
          },
        },
      ],
    });
    service = TestBed.inject(WorkflowTabLauncherService);
  });

  it('does not create a tab after cancelled navigation', async () => {
    navigateToSurface.mockResolvedValue('cancelled');
    await expect(
      service.open({ workflow: 'harness-configure', title: 'Harness' }),
    ).resolves.toEqual({ outcome: 'cancelled' });
    expect(createTab).not.toHaveBeenCalled();
  });

  it('tags the tab, requests a canvas tile with its tabId and prefills that tile', async () => {
    await expect(
      service.open({
        workflow: 'harness-configure',
        title: 'Harness',
        visiblePrompt: 'draft',
        firstMessagePreamble: 'frame',
      }),
    ).resolves.toEqual({ outcome: 'landed', tabId: 'tab-1' });
    expect(setWorkflow).toHaveBeenCalledWith('tab-1', 'harness-configure');
    expect(setFirstMessagePreamble).toHaveBeenCalledWith('tab-1', 'frame');
    // A workflow-claimed tab is tiled like any other tab (decision 7).
    expect(requestCanvasTab).toHaveBeenCalledTimes(1);
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', '/work', 'Harness');
    expect(requestComposerPrefill).toHaveBeenCalledWith('draft', 'tab-1');
  });

  it('requests the tile but no prefill without a visible prompt', async () => {
    await service.open({ workflow: 'harness-configure', title: 'Harness' });
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', '/work', 'Harness');
    expect(requestComposerPrefill).not.toHaveBeenCalled();
  });

  it('rejects an unknown workflow kind', async () => {
    await expect(
      service.open({
        workflow: 'unknown' as 'harness-configure',
        title: 'Bad',
      }),
    ).rejects.toThrow('Invalid workflow tab request');
    expect(createTab).not.toHaveBeenCalled();
  });
});
