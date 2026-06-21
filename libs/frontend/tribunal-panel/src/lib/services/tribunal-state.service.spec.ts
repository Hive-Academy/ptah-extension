import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  SurfaceId,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import {
  TribunalStateService,
  TRIBUNAL_MAX_VENDOR_TILES,
} from './tribunal-state.service';
import { TribunalSurfaceService } from './tribunal-surface.service';
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

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: '',
    status: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    permissionQueue: [],
    displayName: 'Codex',
    model: 'gpt-4o',
    ...overrides,
  };
}

describe('TribunalStateService', () => {
  let service: TribunalStateService;
  let mockAgentMonitor: jest.Mocked<
    Pick<AgentMonitorStore, 'agentsForSession'>
  >;
  let mockTabBinding: jest.Mocked<
    Pick<TabSessionBinding, 'conversationForSurface'>
  >;
  let mockRegistry: jest.Mocked<Pick<ConversationRegistry, 'getRecord'>>;
  let mockSurface: jest.Mocked<Pick<TribunalSurfaceService, 'teardown'>>;
  let mockClaims: jest.Mocked<Pick<WorkflowSessionClaimService, 'release'>>;

  beforeEach(() => {
    mockAgentMonitor = {
      agentsForSession: jest.fn().mockReturnValue([]),
    };
    mockTabBinding = {
      conversationForSurface: jest.fn().mockReturnValue(null),
    };
    mockRegistry = {
      getRecord: jest.fn().mockReturnValue(null),
    };
    mockSurface = {
      teardown: jest.fn(),
    };
    mockClaims = {
      release: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        TribunalStateService,
        { provide: AgentMonitorStore, useValue: mockAgentMonitor },
        { provide: TabSessionBinding, useValue: mockTabBinding },
        { provide: ConversationRegistry, useValue: mockRegistry },
        { provide: TribunalSurfaceService, useValue: mockSurface },
        { provide: WorkflowSessionClaimService, useValue: mockClaims },
      ],
    });

    service = TestBed.inject(TribunalStateService);
  });

  describe('initial state', () => {
    it('starts with empty tiles', () => {
      expect(service.tiles()).toHaveLength(0);
    });

    it('starts with empty lanes', () => {
      expect(service.lanes()).toHaveLength(0);
    });

    it('starts with null surfaceId and sessionId', () => {
      expect(service.surfaceId()).toBeNull();
      expect(service.tribunalSessionId()).toBeNull();
    });
  });

  describe('TRIBUNAL_MAX_VENDOR_TILES cap', () => {
    it('constant equals 8', () => {
      expect(TRIBUNAL_MAX_VENDOR_TILES).toBe(8);
    });

    it('setLanes silently caps input at 8', () => {
      const lanes = Array.from({ length: 10 }, (_, i) =>
        makeLane({ laneId: `lane-${i}`, displayName: `V${i}` }),
      );
      service.setLanes(lanes);
      expect(service.lanes()).toHaveLength(8);
    });

    it('buildTilesForRun caps vendor tiles at 8 even when 10 lanes supplied', () => {
      const lanes = Array.from({ length: 10 }, (_, i) =>
        makeLane({ laneId: `lane-${i}`, displayName: `V${i}` }),
      );
      service.buildTilesForRun('council', lanes);
      const vendorCount = service
        .tiles()
        .filter((t) => t.kind === 'vendor').length;
      expect(vendorCount).toBe(8);
    });

    it('addTile returns false and does NOT add when vendor count already at 8', () => {
      const lanes = Array.from({ length: 8 }, (_, i) =>
        makeLane({ laneId: `lane-${i}`, displayName: `V${i}` }),
      );
      service.buildTilesForRun('council', lanes);
      const before = service.tiles().length;

      const added = service.addTile({
        tileId: 'extra',
        kind: 'vendor',
        laneId: 'extra-lane',
        position: { x: 0, y: 0, w: 4, h: 6 },
      });

      expect(added).toBe(false);
      expect(service.tiles()).toHaveLength(before);
    });
  });

  describe('buildTilesForRun', () => {
    it('creates one vendor tile per lane and no other tile kinds', () => {
      const lanes = [
        makeLane({ laneId: 'l1', displayName: 'A' }),
        makeLane({ laneId: 'l2', displayName: 'B' }),
      ];
      service.buildTilesForRun('council', lanes);

      const tiles = service.tiles();
      expect(tiles).toHaveLength(2);
      expect(tiles.every((t) => t.kind === 'vendor')).toBe(true);
    });
  });

  describe('laneBindings — vendor→lane matching', () => {
    function setup(agents: MonitoredAgent[], lanes: VendorLane[]) {
      mockAgentMonitor.agentsForSession.mockReturnValue(agents);
      mockTabBinding.conversationForSurface.mockReturnValue(
        'conv-1' as unknown as ReturnType<
          TabSessionBinding['conversationForSurface']
        >,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: ['session-1'],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);

      service.setLanes(lanes);
      const surfaceId = SurfaceId.create();
      service.setSurfaceId(surfaceId);
    }

    it('no-match lane stays null (does not throw)', () => {
      const lane = makeLane({
        laneId: 'lane-1',
        cli: 'codex',
        displayName: 'Codex',
        model: 'model-x',
      });
      const agent = makeAgent({
        agentId: 'a1',
        cli: 'copilot',
        displayName: 'Copilot',
        model: 'gpt-4o',
      });
      setup([agent], [lane]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-1')).toBeNull();
    });

    it('ambiguous match (two lanes same model) binds the first lane and does not throw', () => {
      const lane1 = makeLane({
        laneId: 'lane-1',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const lane2 = makeLane({
        laneId: 'lane-2',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const agent1 = makeAgent({
        agentId: 'a1',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const agent2 = makeAgent({
        agentId: 'a2',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      setup([agent1, agent2], [lane1, lane2]);

      let bindings!: ReadonlyMap<string, MonitoredAgent | null>;
      expect(() => {
        bindings = TestBed.runInInjectionContext(() => service.laneBindings());
      }).not.toThrow();

      const b1 = bindings.get('lane-1');
      const b2 = bindings.get('lane-2');
      expect(b1?.agentId).toBe('a1');
      expect(b2?.agentId).toBe('a2');
    });

    it('[tribunal:laneId] tag match is used when the tagged lane is the FIRST lane processed', () => {
      const laneBeta = makeLane({
        laneId: 'lane-beta',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const laneAlpha = makeLane({
        laneId: 'lane-alpha',
        cli: 'ptah-cli',
        displayName: 'Ptah',
        model: 'claude-3',
      });
      const agentWithTag = makeAgent({
        agentId: 'tagged-agent',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: 'Do something [tribunal:lane-beta]',
      });
      const otherAgent = makeAgent({
        agentId: 'other-agent',
        cli: 'ptah-cli',
        displayName: 'Ptah',
        model: 'claude-3',
        task: '',
      });
      setup([agentWithTag, otherAgent], [laneBeta, laneAlpha]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-beta')?.agentId).toBe('tagged-agent');
      expect(bindings.get('lane-alpha')?.agentId).toBe('other-agent');
    });

    it('[tribunal:laneId] tag skips agents already claimed', () => {
      const lane1 = makeLane({
        laneId: 'lane-one',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const lane2 = makeLane({
        laneId: 'lane-two',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const agentTaggedForTwo = makeAgent({
        agentId: 'agent-for-two',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: '[tribunal:lane-two]',
      });
      setup([agentTaggedForTwo], [lane1, lane2]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      const lane1Result = bindings.get('lane-one');
      const lane2Result = bindings.get('lane-two');
      const totalBound = [lane1Result, lane2Result].filter(Boolean).length;
      expect(totalBound).toBe(1);
      expect(lane1Result === null || lane2Result === null).toBe(true);
    });

    it('all lanes map to null when sessionId is null', () => {
      service.setLanes([
        makeLane({ laneId: 'lane-1' }),
        makeLane({ laneId: 'lane-2', displayName: 'B' }),
      ]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-1')).toBeNull();
      expect(bindings.get('lane-2')).toBeNull();
    });

    it('tag path binds when agent displayName/model differ from the lane', () => {
      const lane = makeLane({
        laneId: 'lane-x',
        cli: 'ptah-cli',
        displayName: 'Ollama Cloud',
        model: 'glm-5.2',
      });
      const agent = makeAgent({
        agentId: 'tagged-x',
        cli: 'ptah-cli',
        displayName: 'ollama-cloud (opus tier)',
        model: 'opus[1m]',
        task: '[tribunal:lane-x] Vendor: Ollama Cloud. Do the work.',
      });
      setup([agent], [lane]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-x')?.agentId).toBe('tagged-x');
    });

    it('falls back to identity match when no agent carries a tag', () => {
      const lane = makeLane({
        laneId: 'lane-x',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const matching = makeAgent({
        agentId: 'identity-hit',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: 'no tag here',
      });
      setup([matching], [lane]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-x')?.agentId).toBe('identity-hit');
    });

    it('returns null when there is neither a tag nor an identity match', () => {
      const lane = makeLane({
        laneId: 'lane-x',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const stranger = makeAgent({
        agentId: 'stranger',
        cli: 'copilot',
        displayName: 'Copilot',
        model: 'other',
        task: 'no tag here',
      });
      setup([stranger], [lane]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-x')).toBeNull();
    });

    it('two tagged agents each bind to their own lane with no double-binding', () => {
      const laneA = makeLane({
        laneId: 'lane-a',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const laneB = makeLane({
        laneId: 'lane-b',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const agentA = makeAgent({
        agentId: 'agent-a',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: '[tribunal:lane-a] Vendor: Codex.',
      });
      const agentB = makeAgent({
        agentId: 'agent-b',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: '[tribunal:lane-b] Vendor: Codex.',
      });
      setup([agentB, agentA], [laneA, laneB]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-a')?.agentId).toBe('agent-a');
      expect(bindings.get('lane-b')?.agentId).toBe('agent-b');
      const boundIds = [
        bindings.get('lane-a')?.agentId,
        bindings.get('lane-b')?.agentId,
      ];
      expect(new Set(boundIds).size).toBe(2);
    });

    it('heuristic match by cli+displayName+model binds correctly', () => {
      const lane = makeLane({
        laneId: 'lane-1',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
      });
      const agent = makeAgent({
        agentId: 'a1',
        cli: 'codex',
        displayName: 'Codex',
        model: 'gpt-4o',
        task: '',
      });
      setup([agent], [lane]);

      const bindings = TestBed.runInInjectionContext(() =>
        service.laneBindings(),
      );
      expect(bindings.get('lane-1')?.agentId).toBe('a1');
    });
  });

  describe('resolveTribunalSessionId', () => {
    it('returns null when conversationForSurface returns null', () => {
      mockTabBinding.conversationForSurface.mockReturnValue(null);
      const surfaceId = SurfaceId.create();
      expect(service.resolveTribunalSessionId(surfaceId)).toBeNull();
    });

    it('returns null when registry has no record', () => {
      mockTabBinding.conversationForSurface.mockReturnValue(
        'conv-1' as unknown as ReturnType<
          TabSessionBinding['conversationForSurface']
        >,
      );
      mockRegistry.getRecord.mockReturnValue(null);
      const surfaceId = SurfaceId.create();
      expect(service.resolveTribunalSessionId(surfaceId)).toBeNull();
    });

    it('returns null when sessions array is empty', () => {
      mockTabBinding.conversationForSurface.mockReturnValue(
        'conv-1' as unknown as ReturnType<
          TabSessionBinding['conversationForSurface']
        >,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: [],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);
      const surfaceId = SurfaceId.create();
      expect(service.resolveTribunalSessionId(surfaceId)).toBeNull();
    });

    it('returns the last session id when sessions is non-empty', () => {
      mockTabBinding.conversationForSurface.mockReturnValue(
        'conv-1' as unknown as ReturnType<
          TabSessionBinding['conversationForSurface']
        >,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: ['session-old', 'session-latest'],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);
      const surfaceId = SurfaceId.create();
      expect(service.resolveTribunalSessionId(surfaceId)).toBe(
        'session-latest',
      );
    });
  });

  describe('reset', () => {
    it('clears all state back to defaults', () => {
      service.buildTilesForRun('council', [makeLane()]);

      service.reset();

      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.surfaceId()).toBeNull();
      expect(service.tribunalSessionId()).toBeNull();
    });
  });

  describe('refreshSessionId — late-resolved session on re-entry', () => {
    it('picks up a session id that resolves only after setSurfaceId', () => {
      const surfaceId = SurfaceId.create();
      mockTabBinding.conversationForSurface.mockReturnValue(null);
      mockRegistry.getRecord.mockReturnValue(null);

      service.setSurfaceId(surfaceId);
      expect(service.tribunalSessionId()).toBeNull();

      mockTabBinding.conversationForSurface.mockReturnValue(
        'conv-1' as unknown as ReturnType<
          TabSessionBinding['conversationForSurface']
        >,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: ['session-late'],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);

      service.refreshSessionId();

      expect(service.tribunalSessionId()).toBe('session-late');
    });
  });

  describe('endRun — user-initiated teardown', () => {
    it('tears down the surface exactly once and resets state', () => {
      service.buildTilesForRun('council', [makeLane()]);
      service.setSurfaceId(SurfaceId.create());

      service.endRun();

      expect(mockSurface.teardown).toHaveBeenCalledTimes(1);
      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.surfaceId()).toBeNull();
      expect(service.tribunalSessionId()).toBeNull();
    });

    it('releases a held claim by correlationId', () => {
      service.setCorrelationId('corr-123');

      service.endRun();

      expect(mockClaims.release).toHaveBeenCalledTimes(1);
      expect(mockClaims.release).toHaveBeenCalledWith('corr-123');
    });

    it('does not release a claim when none was held', () => {
      service.endRun();

      expect(mockClaims.release).not.toHaveBeenCalled();
    });
  });
});
