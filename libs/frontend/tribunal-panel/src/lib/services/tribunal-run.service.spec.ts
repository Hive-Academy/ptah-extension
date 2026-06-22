import { TestBed } from '@angular/core/testing';
import { ModelStateService, EffortStateService } from '@ptah-extension/core';
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
  let mockTabManager: jest.Mocked<
    Pick<
      TabManagerService,
      | 'createTab'
      | 'closeTab'
      | 'forceCloseTab'
      | 'tabs'
      | 'setFirstMessagePreamble'
      | 'setOverrideEffort'
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
    mockTabManager = {
      createTab: jest.fn().mockReturnValue('conductor-tab-1'),
      closeTab: jest.fn().mockResolvedValue(undefined),
      forceCloseTab: jest.fn(),
      tabs: jest.fn().mockReturnValue([]),
      setFirstMessagePreamble: jest.fn(),
      setOverrideEffort: jest.fn(),
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

  /** Read the framing preamble stamped onto the conductor tab. */
  function preamble(): string {
    return mockTabManager.setFirstMessagePreamble.mock.calls[0][1] as string;
  }

  describe('prepare — draft conductor + framing preamble (no chat:start)', () => {
    it('does NOT start a session — the normal chat send path owns the run', () => {
      service.prepare('council', [makeLane()]);
      // No rpc/chat:start dependency exists on the service any more.
      expect(mockTabManager.createTab).toHaveBeenCalledWith(
        'Tribunal: council',
      );
    });

    it('creates a conductor tab and uses its id as the correlation id', () => {
      service.prepare('council', [makeLane()]);

      expect(mockTabManager.createTab).toHaveBeenCalledWith(
        'Tribunal: council',
      );
      expect(mockState.setCorrelationId).toHaveBeenCalledWith(
        'conductor-tab-1',
      );
    });

    it('claims the conductor tab id so the tab bar can hide it', () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      service.prepare('council', [makeLane()]);

      expect(claims.surfaceFor('conductor-tab-1')).not.toBeNull();
    });

    it('stamps the framing as the conductor tab first-message preamble', () => {
      service.prepare('council', [makeLane()]);

      expect(mockTabManager.setFirstMessagePreamble).toHaveBeenCalledWith(
        'conductor-tab-1',
        expect.any(String),
      );
    });

    it('freezes the wizard effort onto the conductor tab override', () => {
      service.prepare('council', [makeLane()]);

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'conductor-tab-1',
        'medium',
      );
    });

    it('includes the move phrase in the framing (council/forge/race)', () => {
      service.prepare('council', [makeLane()]);
      expect(preamble()).toContain('Convene a Tribunal Council');
    });

    it('includes the move phrase for forge', () => {
      service.prepare('forge', [makeLane()]);
      expect(preamble()).toContain('Convene a Tribunal Forge');
    });

    it('includes the move phrase for race', () => {
      service.prepare('race', [makeLane({ cli: 'copilot' })]);
      expect(preamble()).toContain('Convene a Tribunal Race');
    });

    it('ends with an "Objective:" trailer so the user message reads as the objective', () => {
      service.prepare('council', [makeLane()]);
      expect(preamble().trimEnd().endsWith('Objective:')).toBe(true);
    });

    it('includes the full-auto "do not call AskUserQuestion" directive', () => {
      service.prepare('council', [makeLane()]);
      expect(preamble()).toContain('Do NOT call AskUserQuestion');
      expect(preamble()).toContain(
        'state assumptions inline rather than asking',
      );
    });

    it('emits exactly one [tribunal:<laneId>] line per lane in lane order', () => {
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
      service.prepare('council', lanes);

      const tagLines = preamble()
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

    it('emits explicit ptah_agent_spawn directives with per-lane model and the no-discovery rule', () => {
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
      ];
      service.prepare('council', lanes);

      const text = preamble();
      expect(text).toContain('This panel is EXPLICITLY defined by the user.');
      expect(text).toContain('do NOT substitute models');
      expect(text).toContain(
        '[tribunal:codex#0] Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-max" })',
      );
      expect(text).toContain(
        '[tribunal:ptah-cli|ollama-cloud#0] Ollama Cloud — ptah_agent_spawn({ ptahCliId: "oc-1", model: "glm-5.2" })',
      );
    });

    it('omits the model key for a cursor lane (no model)', () => {
      service.prepare('council', [
        makeLane({ laneId: 'cursor#0', displayName: 'Cursor', cli: 'cursor' }),
      ]);

      expect(preamble()).toContain(
        '[tribunal:cursor#0] Cursor — ptah_agent_spawn({ cli: "cursor" })',
      );
      expect(preamble()).not.toContain('cursor", model:');
    });

    it('returns false and creates nothing when no lanes are provided', () => {
      const result = service.prepare('council', []);

      expect(result).toBe(false);
      expect(mockTabManager.createTab).not.toHaveBeenCalled();
      expect(mockTabManager.setFirstMessagePreamble).not.toHaveBeenCalled();
    });

    it('returns true on success', () => {
      expect(service.prepare('council', [makeLane()])).toBe(true);
    });

    it('builds tiles before stamping the preamble', () => {
      const callOrder: string[] = [];
      (mockState.buildTilesForRun as jest.Mock).mockImplementation(() =>
        callOrder.push('buildTilesForRun'),
      );
      mockTabManager.setFirstMessagePreamble.mockImplementation(() =>
        callOrder.push('setFirstMessagePreamble'),
      );

      service.prepare('council', [makeLane()]);

      expect(callOrder.indexOf('buildTilesForRun')).toBeLessThan(
        callOrder.indexOf('setFirstMessagePreamble'),
      );
    });

    it('does NOT tear down a prior tab when none is live (first run)', () => {
      (mockState.correlationId as jest.Mock).mockReturnValue(null);

      service.prepare('council', [makeLane()]);

      expect(mockTabManager.forceCloseTab).not.toHaveBeenCalled();
      expect(mockState.reset).not.toHaveBeenCalled();
    });

    it('tears down the prior tab before creating a new one when a run is already live', () => {
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

      service.prepare('council', [makeLane()]);

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
            setFirstMessagePreamble: jest.fn(),
            setOverrideEffort: jest.fn(),
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

  it('tiles built by prepare are observable through the page-resolved TribunalStateService', () => {
    expect(pageState.tiles()).toHaveLength(0);

    runService.prepare('council', [
      makeLane({ laneId: 'l1', displayName: 'Codex' }),
    ]);

    expect(pageState.tiles().length).toBeGreaterThan(0);
  });
});
