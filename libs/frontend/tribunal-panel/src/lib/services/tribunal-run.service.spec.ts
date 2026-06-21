import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
  EffortStateService,
} from '@ptah-extension/core';
import {
  TabManagerService,
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
  let mockTabManager: jest.Mocked<
    Pick<TabManagerService, 'createTab' | 'closeTab' | 'forceCloseTab' | 'tabs'>
  >;
  let mockState: jest.Mocked<
    Pick<
      TribunalStateService,
      | 'setMove'
      | 'setLanes'
      | 'buildTilesForRun'
      | 'setSurfaceId'
      | 'setCorrelationId'
      | 'reset'
      | 'tiles'
      | 'move'
      | 'lanes'
      | 'surfaceId'
      | 'tribunalSessionId'
      | 'correlationId'
      | 'vendorTileCount'
      | 'laneBindings'
    >
  >;

  beforeEach(() => {
    rpc = { call: jest.fn().mockResolvedValue(rpcSuccess({ success: true })) };

    mockTabManager = {
      createTab: jest.fn().mockReturnValue('conductor-tab-1'),
      closeTab: jest.fn().mockResolvedValue(undefined),
      forceCloseTab: jest.fn(),
      tabs: jest.fn().mockReturnValue([]),
    };

    mockState = {
      setMove: jest.fn(),
      setLanes: jest.fn(),
      buildTilesForRun: jest.fn(),
      setSurfaceId: jest.fn(),
      setCorrelationId: jest.fn(),
      reset: jest.fn(),
      tiles: jest.fn().mockReturnValue([]),
      move: jest.fn().mockReturnValue('council'),
      lanes: jest.fn().mockReturnValue([]),
      surfaceId: jest.fn().mockReturnValue(null),
      tribunalSessionId: jest.fn().mockReturnValue(null),
      correlationId: jest.fn().mockReturnValue(null),
      vendorTileCount: jest.fn().mockReturnValue(0),
      laneBindings: jest.fn().mockReturnValue(new Map()),
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
        { provide: TribunalStateService, useValue: mockState },
        { provide: TabManagerService, useValue: mockTabManager },
        WorkflowSessionClaimService,
        StreamRouter,
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

  describe('launch — conductor as a real chat tab', () => {
    it('calls chat:start WITHOUT surfaceMode (normal tab streaming)', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect(rpc.call.mock.calls[0][0]).toBe('chat:start');
      expect(args.surfaceMode).toBeUndefined();
    });

    it('creates a conductor tab and uses its id as the chat:start tabId', async () => {
      await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        OBJECTIVE,
      );

      expect(mockTabManager.createTab).toHaveBeenCalledWith(
        'Tribunal: council',
      );
      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect(args.tabId).toBe('conductor-tab-1');
    });

    it('claims the conductor tab id so the tab bar can hide it', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(claims.surfaceFor('conductor-tab-1')).not.toBeNull();
    });

    it('uses the conductor tab id as the SESSION_CONTEXT / correlation id', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockState.setCorrelationId).toHaveBeenCalledWith(
        'conductor-tab-1',
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

    it('emits explicit ptah_agent_spawn directives with per-lane model and the no-discovery rule', async () => {
      const lanes = [
        makeLane({
          laneId: 'codex#0',
          displayName: 'Codex',
          cli: 'codex',
          model: 'gpt-5.1-codex-max',
        }),
        makeLane({
          laneId: 'ptah-cli|ollama-cloud#0',
          displayName: 'Ollama Cloud',
          cli: 'ptah-cli',
          providerId: 'ollama-cloud',
          ptahCliId: 'oc-1',
          model: 'glm-5.2',
        }),
        makeLane({
          laneId: 'ptah-cli|ollama-cloud#1',
          displayName: 'Ollama Cloud',
          cli: 'ptah-cli',
          providerId: 'ollama-cloud',
          ptahCliId: 'oc-1',
          model: 'kimi-k2.7-code',
        }),
      ];
      await service.launch('council', lanes, OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as { prompt: string };

      expect(args.prompt).toContain(
        'This panel is EXPLICITLY defined by the user.',
      );
      expect(args.prompt).toContain('do NOT substitute models');
      expect(args.prompt).toContain(
        '[tribunal:codex#0] Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-max" }).',
      );
      expect(args.prompt).toContain(
        '[tribunal:ptah-cli|ollama-cloud#0] Ollama Cloud — ptah_agent_spawn({ ptahCliId: "oc-1", model: "glm-5.2" }).',
      );
      expect(args.prompt).toContain(
        '[tribunal:ptah-cli|ollama-cloud#1] Ollama Cloud — ptah_agent_spawn({ ptahCliId: "oc-1", model: "kimi-k2.7-code" }).',
      );
    });

    it('omits the model key for a cursor lane (no model)', async () => {
      const lanes = [
        makeLane({ laneId: 'cursor#0', displayName: 'Cursor', cli: 'cursor' }),
      ];
      await service.launch('council', lanes, OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as { prompt: string };
      expect(args.prompt).toContain(
        '[tribunal:cursor#0] Cursor — ptah_agent_spawn({ cli: "cursor" }).',
      );
      expect(args.prompt).not.toContain('cursor", model:');
    });

    it('returns false and does not call rpc when objective is empty', async () => {
      const result = await service.launch(
        'council',
        [makeLane({ family: 'codex' })],
        '   ',
      );

      expect(result).toBe(false);
      expect(rpc.call).not.toHaveBeenCalled();
      expect(mockTabManager.createTab).not.toHaveBeenCalled();
    });

    it('returns false and does not call rpc when no lanes are provided', async () => {
      const result = await service.launch('council', [], OBJECTIVE);

      expect(result).toBe(false);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it('passes name to chat:start', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
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

    it('returns true on success', async () => {
      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(true);
    });

    it('returns false and rolls back (closes tab + resets) when chat:start fails', async () => {
      rpc.call.mockResolvedValue(rpcError('RPC failure'));

      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(false);
      expect(mockState.reset).toHaveBeenCalledTimes(1);
      expect(mockTabManager.forceCloseTab).toHaveBeenCalledWith(
        'conductor-tab-1',
      );
    });

    it('returns false and rolls back when chat:start throws', async () => {
      rpc.call.mockRejectedValue(new Error('Network error'));

      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(false);
      expect(mockState.reset).toHaveBeenCalledTimes(1);
      expect(mockTabManager.forceCloseTab).toHaveBeenCalledWith(
        'conductor-tab-1',
      );
    });

    it('releases the workflow claim on a failed launch (no permanent leak)', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      rpc.call.mockResolvedValue(rpcError('RPC failure'));

      const result = await service.launch('council', [makeLane()], OBJECTIVE);

      expect(result).toBe(false);
      expect(claims.hasClaims()).toBe(false);
    });

    it('releases the workflow claim when chat:start throws', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      rpc.call.mockRejectedValue(new Error('Network error'));

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(claims.hasClaims()).toBe(false);
    });

    it('does NOT reset on a successful launch', async () => {
      const result = await service.launch('council', [makeLane()], OBJECTIVE);
      expect(result).toBe(true);
      expect(mockState.reset).not.toHaveBeenCalled();
    });

    it('includes workspacePath when vscode config provides it', async () => {
      await service.launch('council', [makeLane()], OBJECTIVE);

      const args = rpc.call.mock.calls[0][1] as Record<string, unknown>;
      expect(args.workspacePath).toBe('/workspace');
    });

    it('does NOT tear down a prior tab when none is live (first run)', async () => {
      (mockState.correlationId as jest.Mock).mockReturnValue(null);

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockTabManager.forceCloseTab).not.toHaveBeenCalled();
      expect(mockState.reset).not.toHaveBeenCalled();
    });

    it('tears down the prior tab before creating a new one when a run is already live', async () => {
      const callOrder: string[] = [];
      (mockState.correlationId as jest.Mock).mockReturnValue('prior-tab');
      mockTabManager.forceCloseTab.mockImplementation(() =>
        callOrder.push('forceCloseTab'),
      );
      (mockState.reset as jest.Mock).mockImplementation(() =>
        callOrder.push('reset'),
      );
      mockTabManager.createTab.mockImplementation(() => {
        callOrder.push('createTab');
        return 'conductor-tab-1';
      });

      await service.launch('council', [makeLane()], OBJECTIVE);

      expect(mockTabManager.forceCloseTab).toHaveBeenCalledWith('prior-tab');
      expect(callOrder.indexOf('forceCloseTab')).toBeLessThan(
        callOrder.indexOf('createTab'),
      );
      expect(callOrder.indexOf('reset')).toBeLessThan(
        callOrder.indexOf('createTab'),
      );
    });
  });

  describe('endRun — teardown closes the conductor tab', () => {
    it('closes the conductor tab, releases the claim and resets state', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      (mockState.correlationId as jest.Mock).mockReturnValue('conductor-tab-1');
      mockTabManager.tabs.mockReturnValue([]);
      claims.claim('conductor-tab-1', 'surface-1' as never);

      const closed = await service.endRun();

      expect(closed).toBe(true);
      expect(mockTabManager.closeTab).toHaveBeenCalledWith('conductor-tab-1');
      expect(claims.hasClaims()).toBe(false);
      expect(mockState.reset).toHaveBeenCalledTimes(1);
    });

    it('does NOT release the claim or reset when the user cancels the close prompt', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      (mockState.correlationId as jest.Mock).mockReturnValue('conductor-tab-1');
      claims.claim('conductor-tab-1', 'surface-1' as never);
      mockTabManager.tabs.mockReturnValue([{ id: 'conductor-tab-1' } as never]);

      const closed = await service.endRun();

      expect(closed).toBe(false);
      expect(claims.hasClaims()).toBe(true);
      expect(mockState.reset).not.toHaveBeenCalled();
    });

    it('resets state when there is no conductor tab', async () => {
      (mockState.correlationId as jest.Mock).mockReturnValue(null);

      const closed = await service.endRun();

      expect(closed).toBe(true);
      expect(mockTabManager.closeTab).not.toHaveBeenCalled();
      expect(mockState.reset).toHaveBeenCalledTimes(1);
    });
  });
});

describe('TribunalRunService — page-scoped DI shares one TribunalStateService', () => {
  let runService: TribunalRunService;
  let pageState: TribunalStateService;

  beforeEach(() => {
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
        {
          provide: TabManagerService,
          useValue: {
            createTab: jest.fn().mockReturnValue('conductor-tab-1'),
            closeTab: jest.fn().mockResolvedValue(undefined),
            forceCloseTab: jest.fn(),
            tabs: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            tick: jest.fn(),
            agentsForSession: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: TabSessionBinding,
          useValue: { conversationFor: jest.fn().mockReturnValue(null) },
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
