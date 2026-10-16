import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager, SurfaceRouterService } from '@ptah-extension/core';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessWorkflowService } from './harness-workflow.service';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';

describe('HarnessWorkflowRequestService', () => {
  const payload = {
    mode: 'new-project' as const,
    seedPrompt: 'Plan a clinic scheduler',
    intake: {
      what: 'clinic scheduler',
      audience: 'b2b' as const,
      stack: 'recommend' as const,
    },
  };
  const active = signal(false);
  const mode = signal<'new-project' | 'configure-harness' | null>(null);
  let service: HarnessWorkflowRequestService;
  let appState: {
    requestHarnessWorkflow: jest.Mock;
    clearHarnessWorkflowRequest: jest.Mock;
  };
  let router: { navigateToSurface: jest.Mock };
  let workflow: { abortAndDispose: jest.Mock };
  let state: { reset: jest.Mock };

  beforeEach(() => {
    active.set(false);
    mode.set(null);
    appState = {
      requestHarnessWorkflow: jest.fn(),
      clearHarnessWorkflowRequest: jest.fn(),
    };
    router = { navigateToSurface: jest.fn().mockResolvedValue('navigated') };
    workflow = { abortAndDispose: jest.fn().mockResolvedValue(undefined) };
    state = { reset: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowRequestService,
        { provide: AppStateManager, useValue: appState },
        { provide: SurfaceRouterService, useValue: router },
        {
          provide: HarnessWorkflowService,
          useValue: { isActive: active, mode, ...workflow },
        },
        { provide: HarnessBuilderStateService, useValue: state },
      ],
    });
    service = TestBed.inject(HarnessWorkflowRequestService);
  });

  it('requests a new workflow and waits for navigation', async () => {
    expect(await service.requestAndNavigate(payload)).toBe('landed');
    expect(appState.requestHarnessWorkflow).toHaveBeenCalledWith(payload);
    expect(router.navigateToSurface).toHaveBeenCalledWith('harness-builder');
  });

  it('resumes an active workflow in the same mode without requesting another', async () => {
    active.set(true);
    mode.set('new-project');
    expect(await service.requestAndNavigate(payload)).toBe('landed');
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(router.navigateToSurface).toHaveBeenCalledWith('harness-builder');
  });

  it('aborts and resets a workflow in the other mode before replacing it', async () => {
    active.set(true);
    mode.set('configure-harness');
    expect(await service.requestAndNavigate(payload)).toBe('landed');
    expect(workflow.abortAndDispose).toHaveBeenCalledTimes(1);
    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(appState.requestHarnessWorkflow).toHaveBeenCalledWith(payload);
    expect(workflow.abortAndDispose.mock.invocationCallOrder[0]).toBeLessThan(
      appState.requestHarnessWorkflow.mock.invocationCallOrder[0],
    );
  });

  it('clears the pending request and reports failed navigation', async () => {
    router.navigateToSurface.mockResolvedValueOnce('failed');
    expect(await service.requestAndNavigate(payload)).toBe('failed');
    const request = appState.requestHarnessWorkflow.mock.calls[0][0];
    expect(appState.clearHarnessWorkflowRequest).toHaveBeenCalledWith(request);
  });

  it('treats already-there as landed', async () => {
    router.navigateToSurface.mockResolvedValueOnce('already-there');
    expect(await service.requestAndNavigate(payload)).toBe('landed');
    expect(appState.clearHarnessWorkflowRequest).not.toHaveBeenCalled();
  });

  it('clears the pending request without reporting failure when superseded', async () => {
    router.navigateToSurface.mockResolvedValueOnce('cancelled');
    expect(await service.requestAndNavigate(payload)).toBe('cancelled');
    expect(appState.clearHarnessWorkflowRequest).toHaveBeenCalledWith(payload);
  });

  it('preserves abort failure and leaves the active workflow untouched', async () => {
    active.set(true);
    mode.set('configure-harness');
    const cause = new Error('abort failed');
    workflow.abortAndDispose.mockRejectedValueOnce(cause);
    await expect(service.requestAndNavigate(payload)).rejects.toThrow(
      'Could not stop the workflow already running, so the new one was not started: abort failed',
    );
    expect(state.reset).not.toHaveBeenCalled();
    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(router.navigateToSurface).not.toHaveBeenCalled();
  });
});
