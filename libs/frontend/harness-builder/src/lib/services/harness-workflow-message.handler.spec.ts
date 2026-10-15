import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type HarnessConfigProposedPayload,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessRpcService } from './harness-rpc.service';
import { HarnessWorkflowMessageHandler } from './harness-workflow-message.handler';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';
import { HarnessWorkflowService } from './harness-workflow.service';

describe('HarnessWorkflowMessageHandler', () => {
  const sessionId = signal<string | null>(null);
  const sessionIds = signal<readonly string[]>([]);
  const surfaceId = signal<string | null>(null);
  const mode = signal<'configure-harness' | 'new-project' | null>(
    'configure-harness',
  );
  let handler: HarnessWorkflowMessageHandler;
  let state: {
    reset: jest.Mock;
    applyConfigUpdates: jest.Mock;
    setConfigComplete: jest.Mock;
  };
  let rpc: { getProposal: jest.Mock };
  let requests: { requestAndNavigate: jest.Mock };
  let logger: { debug: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let workflow: { setError: jest.Mock };

  const event = (id: string, name: string): HarnessConfigProposedPayload => ({
    sessionId: id,
    configUpdates: { name },
  });
  const propose = (payload: HarnessConfigProposedPayload): void => {
    handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_CONFIG_PROPOSED,
      payload,
    });
  };
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const bind = (surface: string | null, ids: string[]): void => {
    surfaceId.set(surface);
    sessionIds.set(ids);
    sessionId.set(ids.at(-1) ?? null);
    TestBed.tick();
  };

  beforeEach(() => {
    sessionId.set(null);
    sessionIds.set([]);
    surfaceId.set(null);
    mode.set('configure-harness');
    state = {
      reset: jest.fn(),
      applyConfigUpdates: jest.fn(),
      setConfigComplete: jest.fn(),
    };
    rpc = { getProposal: jest.fn().mockResolvedValue({ proposal: null }) };
    requests = { requestAndNavigate: jest.fn().mockResolvedValue('landed') };
    logger = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    workflow = { setError: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowMessageHandler,
        {
          provide: HarnessWorkflowService,
          useValue: { sessionId, sessionIds, surfaceId, mode, ...workflow },
        },
        { provide: HarnessBuilderStateService, useValue: state },
        { provide: HarnessRpcService, useValue: rpc },
        { provide: HarnessWorkflowRequestService, useValue: requests },
        { provide: LoggingService, useValue: logger },
      ],
    });
    handler = TestBed.inject(HarnessWorkflowMessageHandler);
  });

  it('delegates legacy open-workflow navigation', async () => {
    const payload = { mode: 'new-project' as const, seedPrompt: 'Start' };
    handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload,
    });
    await settle();
    expect(requests.requestAndNavigate).toHaveBeenCalledWith(payload);
  });

  it('does not report landed or cancelled legacy navigation as an error', async () => {
    for (const outcome of ['landed', 'cancelled']) {
      requests.requestAndNavigate.mockResolvedValueOnce(outcome);
      handler.handleMessage({
        type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
        payload: { mode: 'new-project' },
      });
      await settle();
    }
    expect(workflow.setError).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports failed legacy navigation', async () => {
    requests.requestAndNavigate.mockResolvedValueOnce('failed');
    handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload: { mode: 'new-project' },
    });
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      'HarnessWorkflowMessageHandler',
      'Workflow navigation failed',
      expect.any(Error),
    );
    expect(workflow.setError).toHaveBeenCalledWith(
      'The harness builder could not be opened, so the workflow was not shown. Try starting it again.',
    );
  });

  it('reports the specific abort failure from a rejected legacy request', async () => {
    requests.requestAndNavigate.mockRejectedValueOnce(
      new Error(
        'Could not stop the workflow already running, so the new one was not started: abort failed',
      ),
    );
    handler.handleMessage({
      type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
      payload: { mode: 'new-project' },
    });
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      'HarnessWorkflowMessageHandler',
      'Workflow request failed',
      expect.any(Error),
    );
    expect(workflow.setError).toHaveBeenCalledWith(
      'Could not stop the workflow already running, so the new one was not started: abort failed',
    );
  });

  it.each([undefined, { mode: 'unexpected' }])(
    'reports malformed legacy payload %#',
    (payload) => {
      handler.handleMessage({
        type: MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
        payload,
      });
      expect(workflow.setError).toHaveBeenCalledWith(
        'The workspace sent a malformed workflow request, so it was ignored. Try starting it again.',
      );
      expect(requests.requestAndNavigate).not.toHaveBeenCalled();
    },
  );

  it('applies a matching session and ignores another session', async () => {
    bind('surface-a', ['session-a']);
    await settle();
    propose(event('session-b', 'other'));
    propose(event('session-a', 'mine'));
    expect(state.applyConfigUpdates).toHaveBeenCalledTimes(1);
    expect(state.applyConfigUpdates).toHaveBeenCalledWith({ name: 'mine' });
    expect(logger.debug).toHaveBeenCalledWith(
      'HarnessWorkflowMessageHandler',
      'Proposal ignored for unknown session session-b',
    );
  });

  it('stays silent for proposals without a bound configure-harness workflow', () => {
    propose(event('session-b', 'unbound'));
    bind('surface-a', ['session-a']);
    mode.set('new-project');
    propose(event('session-b', 'other-mode'));

    expect(logger.debug).not.toHaveBeenCalled();
    expect(state.applyConfigUpdates).not.toHaveBeenCalled();
  });

  it('hydrates a reloaded matching session before any new tool call', async () => {
    rpc.getProposal.mockResolvedValueOnce({
      proposal: {
        sessionId: 'session-a',
        configUpdates: { name: 'saved' },
        isConfigComplete: true,
      },
    });
    bind('surface-a', ['session-a']);
    await settle();
    expect(rpc.getProposal).toHaveBeenCalledWith('session-a');
    expect(state.applyConfigUpdates).toHaveBeenCalledWith({ name: 'saved' });
    expect(state.setConfigComplete).toHaveBeenCalledWith(true);
    expect(requests.requestAndNavigate).not.toHaveBeenCalled();
  });

  it('replays live events after the snapshot', async () => {
    let resolve!: (value: {
      proposal: {
        sessionId: string;
        configUpdates: { name: string };
        isConfigComplete: boolean;
      };
    }) => void;
    rpc.getProposal.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    bind('surface-a', ['session-a']);
    propose(event('session-a', 'live'));
    expect(state.applyConfigUpdates).not.toHaveBeenCalled();
    resolve({
      proposal: {
        sessionId: 'session-a',
        configUpdates: { name: 'saved' },
        isConfigComplete: false,
      },
    });
    await settle();
    expect(state.applyConfigUpdates.mock.calls).toEqual([
      [{ name: 'saved' }],
      [{ name: 'live' }],
    ]);
  });

  it('keeps live events after hydration fails', async () => {
    let reject!: (error: Error) => void;
    rpc.getProposal.mockReturnValueOnce(
      new Promise((_done, fail) => {
        reject = fail;
      }),
    );
    bind('surface-a', ['session-a']);
    propose(event('session-a', 'live'));
    reject(new Error('offline'));
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      'HarnessWorkflowMessageHandler',
      'Proposal hydration failed',
      expect.any(Error),
    );
    expect(state.applyConfigUpdates).toHaveBeenCalledWith({ name: 'live' });
  });

  it('logs a failed buffered replay and continues with later events', async () => {
    let finish!: (value: { proposal: null }) => void;
    rpc.getProposal.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    bind('surface-a', ['session-a']);
    propose(event('session-a', 'first'));
    propose(event('session-a', 'second'));
    state.applyConfigUpdates.mockImplementationOnce(() => {
      throw new Error('bad update');
    });

    finish({ proposal: null });
    await settle();

    expect(state.applyConfigUpdates.mock.calls).toEqual([
      [{ name: 'first' }],
      [{ name: 'second' }],
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'HarnessWorkflowMessageHandler',
      'Buffered proposal replay failed',
      expect.any(Error),
    );
  });

  it('drops a stale hydration response after the workflow changes', async () => {
    let resolveOld!: (value: {
      proposal: {
        sessionId: string;
        configUpdates: { name: string };
        isConfigComplete: boolean;
      };
    }) => void;
    rpc.getProposal.mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      }),
    );
    bind('surface-a', ['session-a']);
    bind('surface-b', ['session-b']);
    await settle();
    resolveOld({
      proposal: {
        sessionId: 'session-a',
        configUpdates: { name: 'old' },
        isConfigComplete: false,
      },
    });
    await settle();
    expect(state.applyConfigUpdates).not.toHaveBeenCalled();
    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(rpc.getProposal).toHaveBeenCalledWith('session-b');
  });

  it('clears the previous session when its binding disappears', async () => {
    bind('surface-a', ['session-a']);
    await settle();
    bind(null, []);
    expect(state.reset).toHaveBeenCalledTimes(1);
    propose(event('session-a', 'stale'));
    expect(state.applyConfigUpdates).not.toHaveBeenCalled();
  });

  it('keeps state and hydrates only the appended head session', async () => {
    bind('surface-a', ['session-a']);
    await settle();
    propose(event('session-a', 'earlier'));
    bind('surface-a', ['session-a', 'session-b']);
    await settle();
    propose(event('session-a', 'later'));
    expect(state.reset).not.toHaveBeenCalled();
    expect(rpc.getProposal.mock.calls).toEqual([['session-a'], ['session-b']]);
    expect(state.applyConfigUpdates.mock.calls).toEqual([
      [{ name: 'earlier' }],
      [{ name: 'later' }],
    ]);
  });

  it('hydrates all reloaded conversation sessions oldest first', async () => {
    rpc.getProposal
      .mockResolvedValueOnce({
        proposal: {
          sessionId: 'session-a',
          configUpdates: { name: 'old' },
          isConfigComplete: false,
        },
      })
      .mockResolvedValueOnce({
        proposal: {
          sessionId: 'session-b',
          configUpdates: { name: 'new' },
          isConfigComplete: true,
        },
      });
    bind('surface-a', ['session-a', 'session-b']);
    await settle();
    expect(rpc.getProposal.mock.calls).toEqual([['session-a'], ['session-b']]);
    expect(state.applyConfigUpdates.mock.calls).toEqual([
      [{ name: 'old' }],
      [{ name: 'new' }],
    ]);
    expect(state.setConfigComplete).toHaveBeenCalledWith(true);
  });

  it('buffers an earlier session event while new head hydration runs', async () => {
    let finish!: (value: { proposal: null }) => void;
    bind('surface-a', ['session-a']);
    await settle();
    rpc.getProposal.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    bind('surface-a', ['session-a', 'session-b']);
    propose(event('session-a', 'from-earlier'));
    propose(event('elsewhere', 'ignored'));
    expect(state.applyConfigUpdates).not.toHaveBeenCalled();
    finish({ proposal: null });
    await settle();
    expect(state.applyConfigUpdates.mock.calls).toEqual([
      [{ name: 'from-earlier' }],
    ]);
  });
});
