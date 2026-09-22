/**
 * HarnessWorkflowMessageHandler — cross-mode open requests (TASK_2026_263).
 *
 * `handleOpenWorkflow` used to treat ANY active workflow as a reason to ignore
 * an incoming open request. That is right for a duplicate (a second
 * `new-project` open would claim a second surface and start a second agent
 * against the same workspace) but wrong across modes: a New Project request
 * that arrived while a Configure Harness run happened to be open was dropped
 * silently, taking the user's whole intake with it and leaving them staring at
 * the wrong workflow with no error.
 *
 * Opening the builder is a Router navigation through `SurfaceRouterService`
 * since TASK_2026_524 — a host push, unlike a click, has to report a navigation
 * that does not land, which is why the handler keeps the promise instead of
 * calling the fire-and-forget `AppStateManager.setCurrentView`.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AppStateManager,
  SurfaceRouterService,
  type SurfaceNavigationResult,
} from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessWorkflowService } from './harness-workflow.service';
import { HarnessWorkflowMessageHandler } from './harness-workflow-message.handler';

interface WorkflowStub {
  isActive: ReturnType<typeof signal<boolean>>;
  isProcessing: ReturnType<typeof signal<boolean>>;
  mode: ReturnType<typeof signal<string | null>>;
  abortAndDispose: jest.Mock;
  setError: jest.Mock;
}

describe('HarnessWorkflowMessageHandler — open-workflow routing', () => {
  let handler: HarnessWorkflowMessageHandler;
  let workflow: WorkflowStub;
  let appState: AppStateManager;
  /**
   * The handler navigates through `SurfaceRouterService` rather than
   * `AppStateManager.setCurrentView` (TASK_2026_524): a host push has to report
   * a navigation that does not land, and only `navigateToSurface` returns that
   * answer. `true` is the landed case; the refusal path is pinned separately.
   */
  let surfaceRouter: { navigateToSurface: jest.Mock };
  let state: { reset: jest.Mock; applyConfigUpdates: jest.Mock };

  const NEW_PROJECT_PAYLOAD = {
    mode: 'new-project' as const,
    seedPrompt: 'plan the clinic scheduler',
    intake: { what: 'a clinic scheduler', audience: 'b2b', stack: 'recommend' },
  };

  function open(payload: unknown): void {
    handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload,
    });
  }

  beforeEach(() => {
    workflow = {
      isActive: signal(false),
      isProcessing: signal(false),
      mode: signal<string | null>(null),
      abortAndDispose: jest.fn().mockResolvedValue(undefined),
      setError: jest.fn(),
    };
    surfaceRouter = {
      navigateToSurface: jest.fn().mockResolvedValue('navigated'),
    };
    state = { reset: jest.fn(), applyConfigUpdates: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowMessageHandler,
        { provide: HarnessWorkflowService, useValue: workflow },
        AppStateManager,
        {
          provide: SurfaceRouterService,
          useValue: { ...surfaceRouter, currentSurface: signal('chat') },
        },
        { provide: HarnessBuilderStateService, useValue: state },
      ],
    });

    appState = TestBed.inject(AppStateManager);
    jest.spyOn(appState, 'requestHarnessWorkflow');
    handler = TestBed.inject(HarnessWorkflowMessageHandler);
  });

  it('starts the requested workflow when none is active', () => {
    open(NEW_PROJECT_PAYLOAD);

    expect(appState.requestHarnessWorkflow).toHaveBeenCalledWith({
      mode: 'new-project',
      seedPrompt: 'plan the clinic scheduler',
      intake: NEW_PROJECT_PAYLOAD.intake,
    });
    expect(surfaceRouter.navigateToSurface).toHaveBeenCalledWith(
      'harness-builder',
    );
  });

  it('resumes instead of restarting when the SAME mode is already active', () => {
    workflow.isActive.set(true);
    workflow.mode.set('new-project');

    open(NEW_PROJECT_PAYLOAD);

    // Starting a second run against the same workspace is the thing being
    // prevented — navigating back to the live one is the right answer.
    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
    expect(surfaceRouter.navigateToSurface).toHaveBeenCalledWith(
      'harness-builder',
    );
  });

  it('replaces a DIFFERENT-mode workflow instead of discarding the request', async () => {
    workflow.isActive.set(true);
    workflow.mode.set('configure-harness');

    open(NEW_PROJECT_PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    // Aborted and disposed first — disposing alone would leave the old agent
    // streaming into a surface nobody holds.
    expect(workflow.abortAndDispose).toHaveBeenCalledTimes(1);
    // ...and the config the discarded run produced must not leak into the new one.
    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(appState.requestHarnessWorkflow).toHaveBeenCalledWith({
      mode: 'new-project',
      seedPrompt: 'plan the clinic scheduler',
      intake: NEW_PROJECT_PAYLOAD.intake,
    });
    expect(surfaceRouter.navigateToSurface).toHaveBeenCalledWith(
      'harness-builder',
    );
  });

  it('reports an error and starts nothing when the old workflow cannot be stopped', async () => {
    workflow.isActive.set(true);
    workflow.mode.set('configure-harness');
    workflow.abortAndDispose.mockRejectedValueOnce(new Error('abort failed'));

    open(NEW_PROJECT_PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(workflow.setError).toHaveBeenCalledWith(
      expect.stringContaining('abort failed'),
    );
  });

  it('reports an error when the builder surface cannot be opened', async () => {
    // The host pushed this request, so a navigation that never lands would
    // otherwise leave the user on the wrong surface with a workflow requested
    // and nothing on screen. 'failed' is a real failure — a rejected chunk.
    surfaceRouter.navigateToSurface.mockResolvedValueOnce('failed');
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    open(NEW_PROJECT_PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    expect(workflow.setError).toHaveBeenCalledWith(
      expect.stringContaining('could not be opened'),
    );
    expect(appState.consumeHarnessWorkflowRequest()).toBeNull();
    consoleError.mockRestore();
  });

  it('reports NO error when the builder is already open (F3)', async () => {
    // The most common way into `navigateToBuilder`: a resume arrives for a
    // workflow of the same mode while /harness-builder is displayed. Angular's
    // default `onSameUrlNavigation: 'ignore'` skips that navigation, which the
    // old boolean reported as `false` — so the user got "The harness builder
    // could not be opened" while looking straight at it.
    workflow.isActive.set(true);
    workflow.mode.set('new-project');
    surfaceRouter.navigateToSurface.mockResolvedValue('already-there');
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    open(NEW_PROJECT_PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    expect(surfaceRouter.navigateToSurface).toHaveBeenCalledWith(
      'harness-builder',
    );
    expect(workflow.setError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports NO error when a newer navigation superseded the request', async () => {
    // 'cancelled' means the user asked for something else in the meantime, so
    // an error would be about a request they had already replaced.
    surfaceRouter.navigateToSurface.mockResolvedValueOnce('cancelled');
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    open(NEW_PROJECT_PAYLOAD);
    await Promise.resolve();
    await Promise.resolve();

    expect(workflow.setError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(appState.consumeHarnessWorkflowRequest()).toBeNull();
    consoleError.mockRestore();
  });

  it.each(['failed', 'cancelled'] as const)(
    'preserves a newer request when an older navigation is %s',
    async (result) => {
      let finishOlder!: (result: SurfaceNavigationResult) => void;
      let finishNewer!: (result: SurfaceNavigationResult) => void;
      surfaceRouter.navigateToSurface
        .mockReturnValueOnce(
          new Promise<SurfaceNavigationResult>((resolve) => {
            finishOlder = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise<SurfaceNavigationResult>((resolve) => {
            finishNewer = resolve;
          }),
        );
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      open(NEW_PROJECT_PAYLOAD);
      const older = appState.harnessWorkflowRequest();
      // Equal payloads are still distinct user requests: identity owns cleanup.
      open(NEW_PROJECT_PAYLOAD);
      const newer = appState.harnessWorkflowRequest();
      expect(newer).not.toBe(older);
      finishOlder(result);
      await Promise.resolve();

      expect(appState.harnessWorkflowRequest()).toBe(newer);
      finishNewer('navigated');
      await Promise.resolve();
      expect(appState.consumeHarnessWorkflowRequest()).toBe(newer);
      expect(appState.consumeHarnessWorkflowRequest()).toBeNull();
      if (result === 'cancelled')
        expect(workflow.setError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );

  it.each(['navigated', 'already-there'] as const)(
    'keeps the request consumable when navigation is %s',
    async (result) => {
      surfaceRouter.navigateToSurface.mockResolvedValueOnce(result);
      open(NEW_PROJECT_PAYLOAD);
      const request = appState.harnessWorkflowRequest();
      await Promise.resolve();

      expect(appState.consumeHarnessWorkflowRequest()).toBe(request);
      expect(request).toEqual(NEW_PROJECT_PAYLOAD);
      expect(workflow.setError).not.toHaveBeenCalled();
    },
  );

  it('reports an error rather than dropping a malformed payload in silence', () => {
    open({ mode: 'not-a-mode' });

    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(workflow.setError).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the payload is missing entirely', () => {
    open(undefined);

    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(workflow.setError).toHaveBeenCalledTimes(1);
  });
});
