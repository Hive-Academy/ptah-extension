import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
  EffortStateService,
} from '@ptah-extension/core';
import {
  TabSessionBinding,
  ConversationRegistry,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { TribunalRunService } from './tribunal-run.service';
import { TribunalSurfaceService } from './tribunal-surface.service';
import { TribunalStateService } from './tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';
import { rpcSuccess, rpcError } from '@ptah-extension/core/testing';

function makeLane(overrides: Partial<VendorLane> = {}): VendorLane {
  return {
    laneId: 'lane-1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    ...overrides,
  };
}

describe('TribunalRunService', () => {
  let service: TribunalRunService;
  let rpc: { call: jest.Mock };
  let mockSurface: jest.Mocked<
    Pick<
      TribunalSurfaceService,
      'registerSurface' | 'teardown' | 'streamingState'
    >
  >;
  let mockState: jest.Mocked<
    Pick<
      TribunalStateService,
      | 'setMove'
      | 'setLanes'
      | 'buildTilesForRun'
      | 'setSurfaceId'
      | 'setCorrelationId'
      | 'refreshSessionId'
      | 'reset'
      | 'endRun'
      | 'tiles'
      | 'move'
      | 'lanes'
      | 'surfaceId'
      | 'tribunalSessionId'
      | 'vendorTileCount'
      | 'laneBindings'
    >
  >;
  let mockStreamRouter: jest.Mocked<
    Pick<StreamRouter, 'onSurfaceCreated' | 'onSurfaceClosed'>
  >;

  beforeEach(() => {
    rpc = { call: jest.fn().mockResolvedValue(rpcSuccess({ success: true })) };

    mockSurface = {
      registerSurface: jest.fn(),
      teardown: jest.fn(),
      streamingState: jest.fn().mockReturnValue({ events: new Map() }),
    };

    mockState = {
      setMove: jest.fn(),
      setLanes: jest.fn(),
      buildTilesForRun: jest.fn(),
      setSurfaceId: jest.fn(),
      setCorrelationId: jest.fn(),
      refreshSessionId: jest.fn(),
      reset: jest.fn(),
      endRun: jest.fn(),
      tiles: jest.fn().mockReturnValue([]),
      move: jest.fn().mockReturnValue('council'),
      lanes: jest.fn().mockReturnValue([]),
      surfaceId: jest.fn().mockReturnValue(null),
      tribunalSessionId: jest.fn().mockReturnValue(null),
      vendorTileCount: jest.fn().mockReturnValue(0),
      laneBindings: jest.fn().mockReturnValue(new Map()),
    };

    mockStreamRouter = {
      onSurfaceCreated: jest.fn(),
      onSurfaceClosed: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        TribunalRunService,
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/workspace' }) },
        },
        {
          provide: ModelStateService,
          useValue: { currentModel: () => 'claude-3-5-sonnet' },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: () => 'medium' },
        },
        { provide: TribunalSurfaceService, useValue: mockSurface },
        { provide: TribunalStateService, useValue: mockState },
        { provide: StreamRouter, useValue: mockStreamRouter },
        WorkflowSessionClaimService,
        StreamingSurfaceRegistry,
        TabSessionBinding,
        ConversationRegistry,
        AgentMonitorStore,
        ExecutionTreeBuilderService,
      ],
    });

    service = TestBed.inject(TribunalRunService);
  });

  const OBJECTIVE = 'Refactor the auth guard to enforce route protection.';

  describe('launch — structured prompt + surfaceMode:true', () => {
    it('calls chat:start with surfaceMode:true', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      expect(rpc.call).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({ surfaceMode: true }),
      );
    });

    it('includes the move phrase in the prompt for council', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain('Convene a Tribunal Council');
    });

    it('includes the move phrase for forge', async () => {
      await service.launch('forge', [makeLane({ family: 'codex' })], OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain('Convene a Tribunal Forge');
    });

    it('includes the move phrase for race', async () => {
      await service.launch(
        'race',
        [makeLane({ family: 'copilot' })],
        OBJECTIVE,
      );

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain('Convene a Tribunal Race');
    });

    it('includes the objective verbatim in the prompt', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain(`Objective: ${OBJECTIVE}`);
    });

    it('includes the full-auto "do not call AskUserQuestion" directive', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain('Do NOT call AskUserQuestion');
      expect(args.prompt).toContain(
        'state assumptions inline rather than asking',
      );
    });

    it('emits exactly one [tribunal:<laneId>] line per lane in lane order', async () => {
      const lanes = [
        makeLane({ laneId: 'lane-a', displayName: 'Codex', model: 'gpt-5' }),
        makeLane({
          laneId: 'lane-b',
          displayName: 'Ollama Cloud',
          model: 'glm-5.2',
          cli: 'ptah-cli',
        }),
        makeLane({ laneId: 'lane-c', displayName: 'Copilot', cli: 'copilot' }),
      ];
      await service.launch('council', lanes, OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      const tagLines = args.prompt
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('[tribunal:'));

      expect(tagLines).toHaveLength(3);
      expect(tagLines[0]).toContain('[tribunal:lane-a]');
      expect(tagLines[1]).toContain('[tribunal:lane-b]');
      expect(tagLines[2]).toContain('[tribunal:lane-c]');
      expect(tagLines[0]).toContain('Codex');
      expect(tagLines[1]).toContain('Ollama Cloud');
    });

    it('returns false and does not call rpc when objective is empty', async () => {
      const result = await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        '   ',
      );

      expect(result).toBe(false);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it('returns false and does not call rpc when no lanes are provided', async () => {
      const result = await service.launch('council', [], OBJECTIVE);

      expect(result).toBe(false);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it('passes tabId and name to chat:start', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect(typeof args.tabId).toBe('string');
      expect(args.name).toBe('Tribunal: council');
    });

    it('builds tiles before calling chat:start', async () => {
      const callOrder: string[] = [];
      (mockState.buildTilesForRun as jest.Mock).mockImplementation(() =>
        callOrder.push('buildTilesForRun'),
      );
      rpc.call.mockImplementation(async () => {
        callOrder.push('chat:start');
        return rpcSuccess({ success: true });
      });

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(callOrder.indexOf('buildTilesForRun')).toBeLessThan(
        callOrder.indexOf('chat:start'),
      );
    });

    it('returns true on success and calls state.refreshSessionId', async () => {
      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(true);
      expect(mockState.refreshSessionId).toHaveBeenCalled();
    });

    it('returns false and rolls back state when chat:start fails (no ghost tiles)', async () => {
      rpc.call.mockResolvedValue(rpcError('RPC failure'));

      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(false);
      expect(mockState.reset).toHaveBeenCalledTimes(1);
      expect(mockSurface.teardown).toHaveBeenCalledTimes(1);
      expect(mockState.refreshSessionId).not.toHaveBeenCalled();
    });

    it('returns false and rolls back state when chat:start throws (no ghost tiles)', async () => {
      rpc.call.mockRejectedValue(new Error('Network error'));

      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(false);
      expect(mockState.reset).toHaveBeenCalledTimes(1);
      expect(mockSurface.teardown).toHaveBeenCalledTimes(1);
    });

    it('does NOT reset or teardown on a successful launch', async () => {
      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(true);
      expect(mockState.reset).not.toHaveBeenCalled();
      expect(mockSurface.teardown).not.toHaveBeenCalled();
    });

    it('includes workspacePath when vscode config provides it', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect(args.workspacePath).toBe('/workspace');
    });

    it('stores the correlationId on state for later claim release', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockState.setCorrelationId).toHaveBeenCalledTimes(1);
      expect(
        (mockState.setCorrelationId as jest.Mock).mock.calls[0][0],
      ).toEqual(expect.any(String));
    });

    it('does NOT tear down a prior surface when none is live (first run)', async () => {
      (mockState.surfaceId as jest.Mock).mockReturnValue(null);

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockSurface.teardown).not.toHaveBeenCalled();
      expect(mockState.reset).not.toHaveBeenCalled();
    });

    it('tears down the prior surface before claiming a new one when a run is already live (no leak)', async () => {
      const callOrder: string[] = [];
      (mockState.surfaceId as jest.Mock).mockReturnValue('prior-surface');
      mockSurface.teardown.mockImplementation(() => callOrder.push('teardown'));
      (mockState.reset as jest.Mock).mockImplementation(() =>
        callOrder.push('reset'),
      );
      mockSurface.registerSurface.mockImplementation(() =>
        callOrder.push('registerSurface'),
      );

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockSurface.teardown).toHaveBeenCalledTimes(1);
      expect(callOrder.indexOf('teardown')).toBeLessThan(
        callOrder.indexOf('registerSurface'),
      );
      expect(callOrder.indexOf('reset')).toBeLessThan(
        callOrder.indexOf('registerSurface'),
      );
    });

    it('registers the surface via TribunalSurfaceService before calling RPC', async () => {
      const callOrder: string[] = [];
      mockSurface.registerSurface.mockImplementation(() =>
        callOrder.push('registerSurface'),
      );
      rpc.call.mockImplementation(async () => {
        callOrder.push('rpc.call');
        return rpcSuccess({ success: true });
      });

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(callOrder.indexOf('registerSurface')).toBeLessThan(
        callOrder.indexOf('rpc.call'),
      );
    });
  });
});

describe('TribunalRunService — page-scoped DI shares one TribunalStateService', () => {
  let runService: TribunalRunService;
  let pageState: TribunalStateService;
  let mockSurface: jest.Mocked<
    Pick<TribunalSurfaceService, 'registerSurface' | 'teardown'>
  >;

  beforeEach(() => {
    mockSurface = {
      registerSurface: jest.fn(),
      teardown: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn().mockResolvedValue(rpcSuccess({ success: true })),
          },
        },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/workspace' }) },
        },
        { provide: ModelStateService, useValue: { currentModel: () => null } },
        {
          provide: EffortStateService,
          useValue: { currentEffort: () => null },
        },
        { provide: TribunalSurfaceService, useValue: mockSurface },
        {
          provide: AgentMonitorStore,
          useValue: {
            tick: jest.fn(),
            agentsForSession: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: TabSessionBinding,
          useValue: { conversationForSurface: jest.fn().mockReturnValue(null) },
        },
        {
          provide: ConversationRegistry,
          useValue: { getRecord: jest.fn().mockReturnValue(null) },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn().mockReturnValue([]) },
        },
        WorkflowSessionClaimService,
        StreamRouter,
        StreamingSurfaceRegistry,
        TribunalStateService,
        TribunalRunService,
      ],
    });

    runService = TestBed.inject(TribunalRunService);
    pageState = TestBed.inject(TribunalStateService);
  });

  it('tiles built by launch are observable through the page-resolved TribunalStateService', async () => {
    expect(pageState.tiles()).toHaveLength(0);

    await runService.launch(
      'council',
      [makeLane({ laneId: 'l1', displayName: 'Codex' })],
      'Refactor the auth guard to enforce route protection.',
    );

    expect(pageState.tiles().length).toBeGreaterThan(0);
  });
});
