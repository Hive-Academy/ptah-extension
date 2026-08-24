import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
  EffortStateService,
} from '@ptah-extension/core';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  SurfaceId,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type { AskUserQuestionRequest } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import {
  HARNESS_WORKFLOW_STORAGE_KEY,
  HarnessWorkflowService,
} from './harness-workflow.service';

const REAL_SESSION = 'abababab-abab-4bab-8bab-abababababab' as ClaudeSessionId;

/**
 * `ClaudeRpcService.call` returns an `RpcResult` instance — both the `success`
 * field and the `isSuccess()` narrowing method are part of its contract, and
 * the service reads each of them on a different path. A mock that only carries
 * the field would let a broken `isSuccess()` call pass unnoticed.
 */
function okResult<T extends object>(data: T) {
  return { success: true, data, isSuccess: () => true };
}

type RouterStub = {
  onSurfaceCreated: jest.Mock;
  onSurfaceClosed: jest.Mock;
  routeStreamEventForSurface: jest.Mock;
  routeQuestionPrompt: jest.Mock;
};

let routerStub: RouterStub;

function failedResult(error: string) {
  return { success: false, error, data: undefined, isSuccess: () => false };
}

function makeRpcMock() {
  return {
    call: jest.fn().mockResolvedValue(okResult({ success: true })),
  };
}

/**
 * A mutable workspace root so a test can simulate the user switching the
 * active workspace mid-run, which is what used to re-key the persisted record.
 */
let liveWorkspaceRoot = '/ws';

let permissionHandlerStub: { handleQuestionRequest: jest.Mock };

/**
 * The real `StreamRouter` constructor pulls in `TabManagerService` and the
 * whole streaming-handler graph. Only its surface binding matters here, so
 * `onSurfaceCreated` delegates to the REAL `TabSessionBinding` /
 * `ConversationRegistry` — including the `existingSessionId` rebind that the
 * reload path depends on — and the rest are spies.
 */
function configureWorkflowTestBed(rpc: ReturnType<typeof makeRpcMock>): void {
  routerStub = {
    onSurfaceCreated: jest.fn(),
    onSurfaceClosed: jest.fn(),
    routeStreamEventForSurface: jest.fn(),
    routeQuestionPrompt: jest.fn(),
  };
  permissionHandlerStub = { handleQuestionRequest: jest.fn() };
  liveWorkspaceRoot = '/ws';

  TestBed.configureTestingModule({
    providers: [
      { provide: ClaudeRpcService, useValue: rpc },
      {
        provide: VSCodeService,
        useValue: { config: () => ({ workspaceRoot: liveWorkspaceRoot }) },
      },
      { provide: PermissionHandlerService, useValue: permissionHandlerStub },
      { provide: ModelStateService, useValue: { currentModel: () => '' } },
      {
        provide: EffortStateService,
        useValue: { currentEffort: () => undefined },
      },
      {
        provide: StreamRouter,
        useFactory: (
          b: TabSessionBinding,
          r: ConversationRegistry,
        ): unknown => {
          routerStub.onSurfaceCreated.mockImplementation(
            (surfaceId: SurfaceId, existingSessionId?: ClaudeSessionId) => {
              const bound = b.conversationForSurface(surfaceId);
              if (bound) return bound;
              const convId = r.create();
              b.bindSurface(surfaceId, convId);
              if (existingSessionId) {
                r.appendSession(convId, existingSessionId);
              }
              return convId;
            },
          );
          return routerStub;
        },
        deps: [TabSessionBinding, ConversationRegistry],
      },
    ],
  });
}

describe('HarnessWorkflowService', () => {
  let service: HarnessWorkflowService;
  let rpc: ReturnType<typeof makeRpcMock>;
  let claims: WorkflowSessionClaimService;
  let binding: TabSessionBinding;
  let registry: ConversationRegistry;
  let surfaceRegistry: StreamingSurfaceRegistry;
  let onSurfaceClosed: jest.Mock;

  beforeEach(() => {
    rpc = makeRpcMock();
    configureWorkflowTestBed(rpc);
    onSurfaceClosed = routerStub.onSurfaceClosed;

    service = TestBed.inject(HarnessWorkflowService);
    claims = TestBed.inject(WorkflowSessionClaimService);
    binding = TestBed.inject(TabSessionBinding);
    registry = TestBed.inject(ConversationRegistry);
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    TestBed.inject(HarnessBuilderStateService);
    TestBed.inject(SessionLivenessRegistry);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('startWorkflow claims a correlation, registers an interactive surface, and issues chat:start with surfaceMode', async () => {
    await service.startWorkflow('new-project', 'do the thing');

    expect(claims.hasClaims()).toBe(true);
    expect(service.isActive()).toBe(true);
    expect(service.mode()).toBe('new-project');

    const surfaceId = surfaceRegistry.surfaces()[0];
    expect(surfaceId).toBeDefined();
    expect(surfaceRegistry.isInteractive(surfaceId)).toBe(true);

    expect(rpc.call).toHaveBeenCalledWith(
      'chat:start',
      expect.objectContaining({
        prompt: 'do the thing',
        name: 'New Project Setup',
        surfaceMode: true,
        workspacePath: '/ws',
      }),
    );
  });

  it('configure-harness uses the Harness Configuration name', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    expect(rpc.call).toHaveBeenCalledWith(
      'chat:start',
      expect.objectContaining({ name: 'Harness Configuration' }),
    );
  });

  it('startWorkflow is a no-op when already active', async () => {
    await service.startWorkflow('new-project', 'first');
    rpc.call.mockClear();
    await service.startWorkflow('new-project', 'second');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('sendMessage resolves the head session and issues chat:continue with surfaceMode', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    const convId = binding.conversationForSurface(surfaceId)!;
    registry.appendSession(convId, REAL_SESSION);

    rpc.call.mockClear();
    await service.sendMessage('next turn');

    expect(rpc.call).toHaveBeenCalledWith(
      'chat:continue',
      expect.objectContaining({
        sessionId: REAL_SESSION,
        prompt: 'next turn',
        surfaceMode: true,
      }),
    );
  });

  it('sendMessage drops when no session is resolved yet', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    rpc.call.mockClear();
    await service.sendMessage('next turn');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('abort issues chat:abort with the resolved session', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    const convId = binding.conversationForSurface(surfaceId)!;
    registry.appendSession(convId, REAL_SESSION);

    rpc.call.mockClear();
    await service.abort();
    expect(rpc.call).toHaveBeenCalledWith('chat:abort', {
      sessionId: REAL_SESSION,
    });
  });

  it('abort marks the session idle so the spinner actually stops', async () => {
    const liveness = TestBed.inject(SessionLivenessRegistry);
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    const convId = binding.conversationForSurface(surfaceId)!;
    registry.appendSession(convId, REAL_SESSION);
    liveness.markStreaming(REAL_SESSION);
    expect(service.isProcessing()).toBe(true);

    await service.abort();

    // `session:turnEnded` — the only thing that normally flips liveness — is
    // raised from the SDK's Stop hook, which an interrupt tears down before it
    // can run. Without this the Stop button and the disabled composer stayed
    // stuck for the rest of the session.
    expect(service.isProcessing()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('a failed abort reports the error and leaves the session marked live', async () => {
    const liveness = TestBed.inject(SessionLivenessRegistry);
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    const convId = binding.conversationForSurface(surfaceId)!;
    registry.appendSession(convId, REAL_SESSION);
    liveness.markStreaming(REAL_SESSION);

    rpc.call.mockResolvedValueOnce(failedResult('interrupt refused'));
    await service.abort();

    // The agent is very likely still running — claiming idle would hand back a
    // composer that interleaves with a live turn.
    expect(service.isProcessing()).toBe(true);
    expect(service.error()).toBe('interrupt refused');
  });

  it('dispose releases the claim and closes the surface', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];

    service.dispose();

    expect(claims.hasClaims()).toBe(false);
    expect(service.isActive()).toBe(false);
    expect(onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
  });

  it('isProcessing reflects liveness once a session exists', async () => {
    const liveness = TestBed.inject(SessionLivenessRegistry);
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    const convId = binding.conversationForSurface(surfaceId)!;
    registry.appendSession(convId, REAL_SESSION);

    liveness.markStreaming(REAL_SESSION);
    expect(service.isProcessing()).toBe(true);

    liveness.markIdle(REAL_SESSION);
    expect(service.isProcessing()).toBe(false);
  });

  it('mirrors the live workflow into storage, and clears it on dispose', async () => {
    await service.startWorkflow('new-project', 'seed prompt');
    service.addUserBubble('A booking tool for physiotherapy clinics');
    TestBed.tick();

    const raw = localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      mode: 'new-project',
      sessionId: null,
      workspaceRoot: '/ws',
      bubbles: [{ text: 'A booking tool for physiotherapy clinics' }],
    });

    service.dispose();
    TestBed.tick();
    expect(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  it('persists the session id once the backend resolves one', async () => {
    await service.startWorkflow('new-project', 'seed prompt');
    const surfaceId = surfaceRegistry.surfaces()[0];
    registry.appendSession(
      binding.conversationForSurface(surfaceId)!,
      REAL_SESSION,
    );
    TestBed.tick();

    const stored: unknown = JSON.parse(
      localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY) as string,
    );
    expect(stored).toMatchObject({ sessionId: REAL_SESSION });
  });

  it('writes nothing while no workflow has started', () => {
    TestBed.tick();
    expect(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  /**
   * The record is keyed on its workspace and `rehydrate` refuses one whose root
   * doesn't match. Persisting the LIVE root meant a mid-run workspace switch
   * silently re-keyed the record to a workspace the run never belonged to.
   */
  it('keeps persisting the pinned root after the active workspace switches', async () => {
    await service.startWorkflow('new-project', 'seed prompt');
    TestBed.tick();

    liveWorkspaceRoot = '/some/other/workspace';
    service.addUserBubble('still the original workspace');
    TestBed.tick();

    const stored: unknown = JSON.parse(
      localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY) as string,
    );
    expect(stored).toMatchObject({ workspaceRoot: '/ws' });
    expect(service.workspaceRoot()).toBe('/ws');
  });

  // ---- start / turn failure paths -----------------------------------------

  describe('startWorkflow failure', () => {
    /**
     * Every rollback assertion, applied to both shapes of failure. A half
     * started workflow holds the claim and the surface while `isActive()`
     * reports true — which leaves the Setup Hub card stuck on "Resume" for a
     * session that was never created.
     */
    function expectFullRollback(surfaceId: SurfaceId | undefined): void {
      expect(service.isActive()).toBe(false);
      expect(service.mode()).toBeNull();
      expect(claims.hasClaims()).toBe(false);
      expect(onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(service.error()).not.toBeNull();
      expect(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY)).toBeNull();
    }

    it('rolls the whole start back when the RPC reports success:false', async () => {
      rpc.call.mockResolvedValueOnce(
        okResult({ success: false, error: 'no provider configured' }),
      );

      await service.startWorkflow('new-project', 'seed prompt');
      TestBed.tick();

      expectFullRollback(surfaceRegistry.surfaces()[0]);
      expect(service.error()).toBe('no provider configured');
    });

    it('rolls the whole start back when the RPC envelope fails', async () => {
      rpc.call.mockResolvedValueOnce(failedResult('transport exploded'));

      await service.startWorkflow('new-project', 'seed prompt');
      TestBed.tick();

      expectFullRollback(surfaceRegistry.surfaces()[0]);
      expect(service.error()).toBe('transport exploded');
    });

    it('rolls the whole start back when the RPC throws', async () => {
      rpc.call.mockRejectedValueOnce(new Error('socket closed'));

      await service.startWorkflow('new-project', 'seed prompt');
      TestBed.tick();

      expectFullRollback(surfaceRegistry.surfaces()[0]);
      expect(service.error()).toBe('socket closed');
    });

    it('leaves the workflow startable again after a failure', async () => {
      rpc.call.mockRejectedValueOnce(new Error('socket closed'));
      await service.startWorkflow('new-project', 'seed prompt');

      await service.startWorkflow('new-project', 'second attempt');

      expect(service.isActive()).toBe(true);
      expect(service.error()).toBeNull();
      expect(rpc.call).toHaveBeenLastCalledWith(
        'chat:start',
        expect.objectContaining({ prompt: 'second attempt' }),
      );
    });
  });

  describe('sendMessage failure', () => {
    async function startWithSession(): Promise<void> {
      await service.startWorkflow('configure-harness', 'configure');
      const surfaceId = surfaceRegistry.surfaces()[0];
      registry.appendSession(
        binding.conversationForSurface(surfaceId)!,
        REAL_SESSION,
      );
      rpc.call.mockClear();
    }

    it('surfaces an error and clears the started flag on success:false', async () => {
      await startWithSession();
      rpc.call.mockResolvedValueOnce(
        okResult({ success: false, error: 'session gone' }),
      );

      await service.sendMessage('next turn');

      expect(service.error()).toBe('session gone');
      // The workflow itself survives — only the turn failed.
      expect(service.isActive()).toBe(true);
      expect(service.isProcessing()).toBe(false);
    });

    it('surfaces an error and clears the started flag when the RPC throws', async () => {
      await startWithSession();
      rpc.call.mockRejectedValueOnce(new Error('socket closed'));

      await service.sendMessage('next turn');

      expect(service.error()).toBe('socket closed');
      expect(service.isActive()).toBe(true);
      expect(service.isProcessing()).toBe(false);
    });
  });

  it('abortAndDispose aborts the live session before tearing down', async () => {
    const liveness = TestBed.inject(SessionLivenessRegistry);
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    registry.appendSession(
      binding.conversationForSurface(surfaceId)!,
      REAL_SESSION,
    );
    liveness.markStreaming(REAL_SESSION);

    rpc.call.mockClear();
    await service.abortAndDispose();

    expect(rpc.call).toHaveBeenCalledWith('chat:abort', {
      sessionId: REAL_SESSION,
    });
    expect(service.isActive()).toBe(false);
    expect(claims.hasClaims()).toBe(false);
    expect(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY)).toBeNull();
  });

  it('abortAndDispose skips the abort RPC when nothing is running', async () => {
    await service.startWorkflow('configure-harness', 'configure');
    const surfaceId = surfaceRegistry.surfaces()[0];
    registry.appendSession(
      binding.conversationForSurface(surfaceId)!,
      REAL_SESSION,
    );
    TestBed.inject(SessionLivenessRegistry).markIdle(REAL_SESSION);

    rpc.call.mockClear();
    await service.abortAndDispose();

    expect(rpc.call).not.toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
  });

  it('setError and clearError drive the user-visible alert', () => {
    service.setError('something went wrong');
    expect(service.error()).toBe('something went wrong');
    service.clearError();
    expect(service.error()).toBeNull();
  });
});

/**
 * Reload path. Every test here seeds `localStorage` BEFORE the service is
 * constructed, which is the real ordering: the record outlives the page and
 * the service reads it on its first injection.
 */
describe('HarnessWorkflowService — resume after reload', () => {
  let rpc: ReturnType<typeof makeRpcMock>;

  const PERSISTED = {
    mode: 'new-project',
    sessionId: REAL_SESSION,
    workspaceRoot: '/ws',
    bubbles: [{ text: 'A booking tool for physiotherapy clinics' }],
  };

  function seed(record: unknown): void {
    localStorage.setItem(
      HARNESS_WORKFLOW_STORAGE_KEY,
      typeof record === 'string' ? record : JSON.stringify(record),
    );
  }

  /**
   * Construct the service and let the one-shot rehydrate effect run to
   * completion — it is triggered by an effect (hence `tick`) and finishes in a
   * promise (hence the flush).
   */
  async function bootWorkflow(
    pendingQuestions: readonly AskUserQuestionRequest[] = [],
  ): Promise<HarnessWorkflowService> {
    rpc = makeRpcMock();
    rpc.call.mockImplementation((method: string) => {
      if (method === 'chat:resume') {
        return Promise.resolve(
          okResult({
            success: true,
            events: [
              { type: 'text_delta', sessionId: REAL_SESSION, text: 'hi' },
            ],
          }),
        );
      }
      if (method === 'chat:pending-questions') {
        return Promise.resolve(
          okResult({ success: true, questions: [...pendingQuestions] }),
        );
      }
      return Promise.resolve(okResult({ success: true }));
    });
    configureWorkflowTestBed(rpc);
    const service = TestBed.inject(HarnessWorkflowService);
    TestBed.inject(HarnessBuilderStateService);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    return service;
  }

  function makeQuestion(id: string): AskUserQuestionRequest {
    return {
      id,
      toolName: 'AskUserQuestion',
      questions: [
        {
          question: 'Which stack?',
          header: 'Stack',
          multiSelect: false,
          options: [{ label: 'Nx + NestJS', description: 'recommended' }],
        },
      ],
      timestamp: 1,
      timeoutAt: 0,
      sessionId: REAL_SESSION,
    };
  }

  afterEach(() => {
    localStorage.clear();
  });

  it('restores the mode, the transcript and an interactive surface', async () => {
    seed(PERSISTED);
    const service = await bootWorkflow();

    expect(service.isActive()).toBe(true);
    expect(service.viewMode()).toBe('new-project');
    expect(service.userBubbles()).toEqual(PERSISTED.bubbles);
    expect(service.resumedFromReload()).toBe(true);
    expect(TestBed.inject(WorkflowSessionClaimService).hasClaims()).toBe(true);

    const surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    const surfaceId = surfaceRegistry.surfaces()[0];
    expect(surfaceId).toBeDefined();
    expect(surfaceRegistry.isInteractive(surfaceId)).toBe(true);
  });

  it('rebinds the persisted session so the next turn is a chat:continue', async () => {
    seed(PERSISTED);
    const service = await bootWorkflow();

    rpc.call.mockClear();
    await service.sendMessage('and add billing');

    expect(rpc.call).toHaveBeenCalledWith(
      'chat:continue',
      expect.objectContaining({
        sessionId: REAL_SESSION,
        prompt: 'and add billing',
        surfaceMode: true,
      }),
    );
  });

  it('replays the session history onto the surface without restarting the agent', async () => {
    seed(PERSISTED);
    await bootWorkflow();

    expect(rpc.call).toHaveBeenCalledWith(
      'chat:resume',
      expect.objectContaining({
        sessionId: REAL_SESSION,
        workspacePath: '/ws',
      }),
    );
    // `chat:resume` without `activate` is history-load only. A `chat:start`
    // here would spawn a SECOND agent run against the same workspace.
    expect(rpc.call).not.toHaveBeenCalledWith('chat:start', expect.anything());
    expect(routerStub.routeStreamEventForSurface).toHaveBeenCalledTimes(1);
  });

  it('discards a record belonging to a different workspace', async () => {
    seed({ ...PERSISTED, workspaceRoot: '/some/other/workspace' });
    const service = await bootWorkflow();

    expect(service.isActive()).toBe(false);
    expect(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY)).toBeNull();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('ignores a malformed record rather than resuming into a broken state', async () => {
    seed('{ not json');
    expect((await bootWorkflow()).isActive()).toBe(false);
  });

  it('ignores a record whose shape no longer matches', async () => {
    seed({ ...PERSISTED, mode: 'something-else' });
    expect((await bootWorkflow()).isActive()).toBe(false);
  });

  it('resumes the transcript even when no session had resolved before the reload', async () => {
    seed({ ...PERSISTED, sessionId: null });
    const service = await bootWorkflow();

    expect(service.isActive()).toBe(true);
    expect(service.userBubbles()).toEqual(PERSISTED.bubbles);
    // Nothing to replay and nothing to continue — but the transcript is back.
    expect(rpc.call).not.toHaveBeenCalled();
  });

  /**
   * A question the agent is still blocked on outlives the page; the card that
   * would answer it does not. Without re-showing it the agent waits invisibly
   * until the 5-minute idle timeout auto-picks option #1.
   */
  it('re-shows a pending question after the reload', async () => {
    seed(PERSISTED);
    const question = makeQuestion('q-1');
    await bootWorkflow([question]);

    expect(rpc.call).toHaveBeenCalledWith('chat:pending-questions', {
      sessionId: REAL_SESSION,
    });
    expect(permissionHandlerStub.handleQuestionRequest).toHaveBeenCalledWith(
      question,
    );
    expect(routerStub.routeQuestionPrompt).toHaveBeenCalledWith(question);
  });

  it('re-shows every pending question, not just the first', async () => {
    seed(PERSISTED);
    await bootWorkflow([makeQuestion('q-1'), makeQuestion('q-2')]);

    expect(permissionHandlerStub.handleQuestionRequest).toHaveBeenCalledTimes(
      2,
    );
    expect(routerStub.routeQuestionPrompt).toHaveBeenCalledTimes(2);
  });

  it('dispatches nothing when the backend reports no pending questions', async () => {
    seed(PERSISTED);
    await bootWorkflow();

    expect(rpc.call).toHaveBeenCalledWith('chat:pending-questions', {
      sessionId: REAL_SESSION,
    });
    expect(permissionHandlerStub.handleQuestionRequest).not.toHaveBeenCalled();
    expect(routerStub.routeQuestionPrompt).not.toHaveBeenCalled();
  });

  it('resumes normally when the pending-questions lookup fails', async () => {
    seed(PERSISTED);
    rpc = makeRpcMock();
    rpc.call.mockImplementation((method: string) =>
      method === 'chat:pending-questions'
        ? Promise.reject(new Error('backend unavailable'))
        : Promise.resolve(okResult({ success: true, events: [] })),
    );
    configureWorkflowTestBed(rpc);
    const service = TestBed.inject(HarnessWorkflowService);
    TestBed.inject(HarnessBuilderStateService);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // A question that can't be fetched must not cost the user the transcript.
    expect(service.isActive()).toBe(true);
    expect(service.userBubbles()).toEqual(PERSISTED.bubbles);
    expect(permissionHandlerStub.handleQuestionRequest).not.toHaveBeenCalled();
  });

  it('pins the persisted root rather than re-reading the live one', async () => {
    seed(PERSISTED);
    const service = await bootWorkflow();

    liveWorkspaceRoot = '/some/other/workspace';
    service.addUserBubble('after a workspace switch');
    TestBed.tick();

    expect(
      JSON.parse(localStorage.getItem(HARNESS_WORKFLOW_STORAGE_KEY) as string),
    ).toMatchObject({ workspaceRoot: '/ws' });
  });
});
