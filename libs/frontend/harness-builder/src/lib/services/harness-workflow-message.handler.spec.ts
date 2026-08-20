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
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AppStateManager,
  WebviewNavigationService,
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
  let appState: { requestHarnessWorkflow: jest.Mock };
  let navigation: { navigateToView: jest.Mock };
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
    appState = { requestHarnessWorkflow: jest.fn() };
    navigation = { navigateToView: jest.fn().mockResolvedValue(undefined) };
    state = { reset: jest.fn(), applyConfigUpdates: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowMessageHandler,
        { provide: HarnessWorkflowService, useValue: workflow },
        { provide: AppStateManager, useValue: appState },
        { provide: WebviewNavigationService, useValue: navigation },
        { provide: HarnessBuilderStateService, useValue: state },
      ],
    });

    handler = TestBed.inject(HarnessWorkflowMessageHandler);
  });

  it('starts the requested workflow when none is active', () => {
    open(NEW_PROJECT_PAYLOAD);

    expect(appState.requestHarnessWorkflow).toHaveBeenCalledWith({
      mode: 'new-project',
      seedPrompt: 'plan the clinic scheduler',
      intake: NEW_PROJECT_PAYLOAD.intake,
    });
    expect(navigation.navigateToView).toHaveBeenCalledWith('harness-builder');
  });

  it('resumes instead of restarting when the SAME mode is already active', () => {
    workflow.isActive.set(true);
    workflow.mode.set('new-project');

    open(NEW_PROJECT_PAYLOAD);

    // Starting a second run against the same workspace is the thing being
    // prevented — navigating back to the live one is the right answer.
    expect(appState.requestHarnessWorkflow).not.toHaveBeenCalled();
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
    expect(navigation.navigateToView).toHaveBeenCalledWith('harness-builder');
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
    expect(navigation.navigateToView).toHaveBeenCalledWith('harness-builder');
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
