import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, SurfaceRouterService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { WorkflowTabLauncherService } from './workflow-tab-launcher.service';

describe('WorkflowTabLauncherService', () => {
  const layout = signal<'single' | 'grid'>('single');
  const navigateToSurface = jest.fn();
  const createTab = jest.fn(() => 'tab-1');
  const setWorkflow = jest.fn();
  const setFirstMessagePreamble = jest.fn();
  const requestCanvasTab = jest.fn();
  const requestComposerPrefill = jest.fn();
  let service: WorkflowTabLauncherService;

  beforeEach(() => {
    jest.clearAllMocks();
    layout.set('single');
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
            layoutMode: layout,
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

  it.each([
    ['single', null],
    ['grid', 'tab-1'],
  ] as const)(
    'prefills the %s layout and tags the tab',
    async (mode, scope) => {
      layout.set(mode);
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
      expect(requestComposerPrefill).toHaveBeenCalledWith('draft', scope);
      expect(requestCanvasTab).toHaveBeenCalledTimes(mode === 'grid' ? 1 : 0);
    },
  );

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
