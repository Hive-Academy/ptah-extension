import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { HarnessProposalHydrationService } from './harness-proposal-hydration.service';
import { HarnessWorkflowMessageHandler } from './harness-workflow-message.handler';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';

describe('HarnessWorkflowMessageHandler', () => {
  let handler: HarnessWorkflowMessageHandler;
  let requests: {
    workspaceRoot: string;
    requestAndNavigate: jest.Mock;
    reportHubError: jest.Mock;
    hasResumableMode: jest.Mock;
  };
  let proposals: { handlePush: jest.Mock };
  let logger: { error: jest.Mock };

  beforeEach(() => {
    requests = {
      workspaceRoot: 'c:/work',
      requestAndNavigate: jest.fn().mockResolvedValue('landed'),
      reportHubError: jest.fn(),
      hasResumableMode: jest.fn().mockReturnValue(false),
    };
    proposals = { handlePush: jest.fn() };
    logger = { error: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowMessageHandler,
        { provide: HarnessWorkflowRequestService, useValue: requests },
        { provide: HarnessProposalHydrationService, useValue: proposals },
        { provide: LoggingService, useValue: logger },
      ],
    });
    handler = TestBed.inject(HarnessWorkflowMessageHandler);
  });

  it('validates and delegates a New Project relay', async () => {
    const payload = {
      mode: 'new-project',
      workspaceRoot: 'C:/work',
      intake: { what: 'Clinic scheduler', audience: 'b2b', stack: 'recommend' },
    };
    await handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload,
    });
    expect(requests.requestAndNavigate).toHaveBeenCalledWith({
      mode: 'new-project',
      intake: payload.intake,
    });
  });

  it.each([
    undefined,
    { mode: 'wrong' },
    { mode: 'configure-harness', workspaceRoot: 'D:/other' },
    {
      mode: 'new-project',
      intake: { what: '', audience: 'b2b', stack: 'recommend' },
    },
  ])(
    'keeps a malformed relay on the Hub with a dismissible error %#',
    async (payload) => {
      await handler.handleMessage({
        type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
        payload,
      });
      expect(requests.requestAndNavigate).not.toHaveBeenCalled();
      expect(requests.reportHubError).toHaveBeenCalledWith(
        expect.stringContaining('invalid builder request'),
      );
      expect(logger.error).toHaveBeenCalledWith(
        'HarnessWorkflowMessageHandler',
        'Invalid workflow request',
        expect.any(Error),
      );
    },
  );

  it('reports navigation failure without exposing the raw error', async () => {
    requests.requestAndNavigate.mockResolvedValueOnce('failed');
    await handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload: { mode: 'configure-harness' },
    });
    await Promise.resolve();
    expect(requests.reportHubError).toHaveBeenCalledWith(
      'The harness builder could not be opened. Try again.',
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('forwards proposal pushes to the tab-scoped hydration store', async () => {
    const payload = { sessionId: 'session-a', configUpdates: { name: 'Mine' } };
    await handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
      payload,
    });
    expect(proposals.handlePush).toHaveBeenCalledWith(payload);
    await handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
      payload: { sessionId: 42 },
    });
    expect(proposals.handlePush).toHaveBeenCalledTimes(1);
  });

  it('preserves arrival order while lazy imports are pending', async () => {
    const first = handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
      payload: { sessionId: 'first', configUpdates: {} },
    });
    const second = handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
      payload: { sessionId: 'second', configUpdates: {} },
    });
    await Promise.all([first, second]);
    expect(
      proposals.handlePush.mock.calls.map(([payload]) => payload.sessionId),
    ).toEqual(['first', 'second']);
  });
});
