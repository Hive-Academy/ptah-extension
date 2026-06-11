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
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessWorkflowService } from './harness-workflow.service';

const REAL_SESSION = 'abababab-abab-4bab-8bab-abababababab' as ClaudeSessionId;

function makeRpcMock() {
  return {
    call: jest.fn().mockResolvedValue({
      success: true,
      data: { success: true },
    }),
  };
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

    // The real StreamRouter constructor pulls in TabManagerService and the
    // streaming-handler graph. We only need its surface-binding behavior, so
    // delegate onSurfaceCreated to the real TabSessionBinding/ConversationRegistry
    // and spy on onSurfaceClosed.
    onSurfaceClosed = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/ws' }) },
        },
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
          ): unknown => ({
            onSurfaceCreated: jest.fn((surfaceId) => {
              const convId = r.create();
              b.bindSurface(surfaceId, convId);
              return convId;
            }),
            onSurfaceClosed,
          }),
          deps: [TabSessionBinding, ConversationRegistry],
        },
      ],
    });

    service = TestBed.inject(HarnessWorkflowService);
    claims = TestBed.inject(WorkflowSessionClaimService);
    binding = TestBed.inject(TabSessionBinding);
    registry = TestBed.inject(ConversationRegistry);
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    TestBed.inject(HarnessBuilderStateService);
    TestBed.inject(SessionLivenessRegistry);
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
});
