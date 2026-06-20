import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ConversationRegistry,
  SurfaceId,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
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
    Pick<AgentMonitorStore, 'tick' | 'agentsForSession'>
  >;
  let mockTabBinding: jest.Mocked<
    Pick<TabSessionBinding, 'conversationForSurface'>
  >;
  let mockRegistry: jest.Mocked<Pick<ConversationRegistry, 'getRecord'>>;
  let mockSurface: jest.Mocked<Pick<TribunalSurfaceService, 'streamingState'>>;
  let mockTreeBuilder: jest.Mocked<
    Pick<ExecutionTreeBuilderService, 'buildTree'>
  >;

  beforeEach(() => {
    mockAgentMonitor = {
      tick: jest.fn(),
      agentsForSession: jest.fn().mockReturnValue([]),
    };
    mockTabBinding = {
      conversationForSurface: jest.fn().mockReturnValue(null),
    };
    mockRegistry = {
      getRecord: jest.fn().mockReturnValue(null),
    };
    mockSurface = {
      streamingState: jest.fn().mockReturnValue({ events: new Map() }),
    };
    mockTreeBuilder = {
      buildTree: jest.fn().mockReturnValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        TribunalStateService,
        { provide: AgentMonitorStore, useValue: mockAgentMonitor },
        { provide: TabSessionBinding, useValue: mockTabBinding },
        { provide: ConversationRegistry, useValue: mockRegistry },
        { provide: TribunalSurfaceService, useValue: mockSurface },
        { provide: ExecutionTreeBuilderService, useValue: mockTreeBuilder },
      ],
    });

    service = TestBed.inject(TribunalStateService);
  });

  describe('initial state', () => {
    it('starts with empty tiles and idle phase', () => {
      expect(service.tiles()).toHaveLength(0);
      expect(service.phase()).toBe('idle');
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

    it('addTile returns true for non-vendor tiles regardless of vendor count', () => {
      const lanes = Array.from({ length: 8 }, (_, i) =>
        makeLane({ laneId: `lane-${i}`, displayName: `V${i}` }),
      );
      service.buildTilesForRun('council', lanes);

      const added = service.addTile({
        tileId: 'extra-verdict',
        kind: 'verdict',
        position: { x: 0, y: 0, w: 4, h: 6 },
      });

      expect(added).toBe(true);
    });
  });

  describe('buildTilesForRun', () => {
    it('creates vendor tiles plus one verdict tile for council move', () => {
      const lanes = [
        makeLane({ laneId: 'l1', displayName: 'A' }),
        makeLane({ laneId: 'l2', displayName: 'B' }),
      ];
      service.buildTilesForRun('council', lanes);

      const tiles = service.tiles();
      expect(tiles.filter((t) => t.kind === 'vendor')).toHaveLength(2);
      expect(tiles.find((t) => t.kind === 'verdict')).toBeDefined();
    });

    it('creates a scorecard reserved tile for race move', () => {
      const lanes = [makeLane({ laneId: 'l1' })];
      service.buildTilesForRun('race', lanes);
      expect(service.tiles().find((t) => t.kind === 'scorecard')).toBeDefined();
    });
  });

  describe('markLaneDiffReady', () => {
    it('upgrades a vendor tile to diff kind for the given laneId', () => {
      service.buildTilesForRun('forge', [makeLane({ laneId: 'lane-1' })]);
      expect(service.tiles().find((t) => t.laneId === 'lane-1')?.kind).toBe(
        'vendor',
      );

      service.markLaneDiffReady('lane-1');

      expect(service.tiles().find((t) => t.laneId === 'lane-1')?.kind).toBe(
        'diff',
      );
    });

    it('does not affect tiles with a different laneId', () => {
      service.buildTilesForRun('forge', [
        makeLane({ laneId: 'lane-1' }),
        makeLane({ laneId: 'lane-2', displayName: 'B' }),
      ]);
      service.markLaneDiffReady('lane-1');

      expect(service.tiles().find((t) => t.laneId === 'lane-2')?.kind).toBe(
        'vendor',
      );
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

  describe('forgeDiffs parsing', () => {
    it('returns empty map when conductor text is empty', () => {
      mockSurface.streamingState.mockReturnValue({
        events: new Map(),
      } as ReturnType<TribunalSurfaceService['streamingState']>);
      service.setLanes([makeLane({ laneId: 'l1', displayName: 'Codex' })]);
      expect(
        TestBed.runInInjectionContext(() => service.forgeDiffs()).size,
      ).toBe(0);
    });

    it('parses a vendor section from conductor text into a ForgeDiff', () => {
      const conductorText = `## Codex\nSummary text.\n\`\`\`diff\n+ added line\n\`\`\`\nReview notes here.`;
      mockSurface.streamingState.mockReturnValue({
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<TribunalSurfaceService['streamingState']>);
      mockTreeBuilder.buildTree.mockReturnValue([
        {
          type: 'text',
          content: conductorText,
          children: [],
        } as unknown as ReturnType<
          ExecutionTreeBuilderService['buildTree']
        >[number],
      ]);
      service.setLanes([makeLane({ laneId: 'l1', displayName: 'Codex' })]);

      const diffs = TestBed.runInInjectionContext(() => service.forgeDiffs());
      expect(diffs.has('l1')).toBe(true);
      expect(diffs.get('l1')?.summary).toBe('Summary text.');
      expect(diffs.get('l1')?.diff).toBe('+ added line');
    });
  });

  describe('raceScores parsing', () => {
    it('returns empty array when conductor text is empty', () => {
      mockSurface.streamingState.mockReturnValue({
        events: new Map(),
      } as ReturnType<TribunalSurfaceService['streamingState']>);
      expect(
        TestBed.runInInjectionContext(() => service.raceScores()),
      ).toHaveLength(0);
    });

    it('parses a markdown table into RaceScore[]', () => {
      const table = [
        '| Vendor | Correctness | Verify | Rank |',
        '|--------|-------------|--------|------|',
        '| Codex  | Good        | ✅     | 1    |',
        '| Copilot| Fair        | ❌     | 2    |',
      ].join('\n');

      mockSurface.streamingState.mockReturnValue({
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<TribunalSurfaceService['streamingState']>);
      mockTreeBuilder.buildTree.mockReturnValue([
        { type: 'text', content: table, children: [] } as unknown as ReturnType<
          ExecutionTreeBuilderService['buildTree']
        >[number],
      ]);

      const scores = TestBed.runInInjectionContext(() => service.raceScores());
      expect(scores).toHaveLength(2);
      expect(scores[0].vendor).toBe('Codex');
      expect(scores[0].verifyPassed).toBe(true);
      expect(scores[0].rank).toBe(1);
      expect(scores[1].vendor).toBe('Copilot');
      expect(scores[1].verifyPassed).toBe(false);
      expect(scores[1].rank).toBe(2);
    });

    it('parses the LAST markdown table when multiple tables are emitted', () => {
      const intermediate = [
        '| Vendor | Rank |',
        '|--------|------|',
        '| Codex  | ?    |',
      ].join('\n');
      const final = [
        '| Vendor | Verify | Rank |',
        '|--------|--------|------|',
        '| Codex  | ✅     | 2    |',
        '| Copilot| ✅     | 1    |',
      ].join('\n');
      const combined = `${intermediate}\n\nProgress update.\n\n${final}`;

      mockSurface.streamingState.mockReturnValue({
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<TribunalSurfaceService['streamingState']>);
      mockTreeBuilder.buildTree.mockReturnValue([
        {
          type: 'text',
          content: combined,
          children: [],
        } as unknown as ReturnType<
          ExecutionTreeBuilderService['buildTree']
        >[number],
      ]);

      const scores = TestBed.runInInjectionContext(() => service.raceScores());
      expect(scores).toHaveLength(2);
      expect(scores[0].vendor).toBe('Codex');
      expect(scores[0].rank).toBe(2);
      expect(scores[1].vendor).toBe('Copilot');
      expect(scores[1].rank).toBe(1);
    });

    it('partial/absent score data produces loading row without crashing', () => {
      const partial = '| Vendor | Rank |\n|--------|------|\n| Codex  |      |';
      mockSurface.streamingState.mockReturnValue({
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<TribunalSurfaceService['streamingState']>);
      mockTreeBuilder.buildTree.mockReturnValue([
        {
          type: 'text',
          content: partial,
          children: [],
        } as unknown as ReturnType<
          ExecutionTreeBuilderService['buildTree']
        >[number],
      ]);

      let scores!: readonly ReturnType<typeof service.raceScores>[number][];
      expect(() => {
        scores = TestBed.runInInjectionContext(() => service.raceScores());
      }).not.toThrow();
      expect(scores[0].vendor).toBe('Codex');
      expect(scores[0].rank).toBeNull();
    });
  });

  describe('phase progression — derivedPhase / advancePhaseFromStream', () => {
    function withConductorText(text: string): void {
      mockSurface.streamingState.mockReturnValue({
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<TribunalSurfaceService['streamingState']>);
      mockTreeBuilder.buildTree.mockReturnValue([
        { type: 'text', content: text, children: [] } as unknown as ReturnType<
          ExecutionTreeBuilderService['buildTree']
        >[number],
      ]);
    }

    it('stays idle when phase is idle regardless of stream content', () => {
      withConductorText('## Verdict\nDone.');
      expect(TestBed.runInInjectionContext(() => service.derivedPhase())).toBe(
        'idle',
      );
    });

    it('advances from fan to critique when a critique marker appears', () => {
      service.setPhase('fan');
      withConductorText('## Critique\nPeer review notes.');
      service.advancePhaseFromStream();
      expect(service.phase()).toBe('critique');
    });

    it('advances to verdict when a verdict marker appears', () => {
      service.setPhase('fan');
      withConductorText('## Verdict\nFinal recommendation: option A.');
      service.advancePhaseFromStream();
      expect(service.phase()).toBe('verdict');
    });

    it('never regresses to an earlier phase (verdict stays verdict for fan-only text)', () => {
      service.setPhase('verdict');
      withConductorText('Fan-out output with no critique or verdict markers.');
      service.advancePhaseFromStream();
      expect(service.phase()).toBe('verdict');
    });

    it('stays on the current phase for unrecognized content', () => {
      service.setPhase('fan');
      withConductorText('Some arbitrary streaming text.');
      service.advancePhaseFromStream();
      expect(service.phase()).toBe('fan');
    });
  });

  describe('reset', () => {
    it('clears all state back to idle defaults', () => {
      service.buildTilesForRun('council', [makeLane()]);
      service.setPhase('fan');

      service.reset();

      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.phase()).toBe('idle');
      expect(service.surfaceId()).toBeNull();
      expect(service.tribunalSessionId()).toBeNull();
    });
  });
});
