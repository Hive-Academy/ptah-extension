import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  ClaudeSessionId,
  ConversationRegistry,
  TabId,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import {
  TribunalStateService,
  TRIBUNAL_MAX_VENDOR_TILES,
} from './tribunal-state.service';
import type { VendorLane } from '../types/tribunal-ui.types';

/**
 * Minimal stub of the workspace-partition surface `TribunalStateService`
 * consumes from TabManagerService. Backed by settable signals so tests can
 * drive workspace switches (`activeWorkspacePath$`) and removals
 * (`removedWorkspace$`), plus the non-reactive `activeWorkspacePath` getter the
 * service reads once for its eager bootstrap seed.
 */
interface TabManagerStub {
  tabManager: TabManagerService;
  activeWorkspacePath$: ReturnType<typeof signal<string | null>>;
  removedWorkspace$: ReturnType<typeof signal<string | null>>;
  clearRemovedWorkspace: jest.Mock;
}

function makeTabManagerStub(initialPath: string | null = null): TabManagerStub {
  const activeWorkspacePath$ = signal<string | null>(initialPath);
  const removedWorkspace$ = signal<string | null>(null);
  const clearRemovedWorkspace = jest.fn();
  const tabManager = {
    get activeWorkspacePath() {
      return activeWorkspacePath$();
    },
    activeWorkspacePath$: activeWorkspacePath$.asReadonly(),
    removedWorkspace$: removedWorkspace$.asReadonly(),
    clearRemovedWorkspace,
  } as unknown as TabManagerService;
  return {
    tabManager,
    activeWorkspacePath$,
    removedWorkspace$,
    clearRemovedWorkspace,
  };
}

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
    streamRevision: 0,
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
  let mockTabBinding: jest.Mocked<Pick<TabSessionBinding, 'conversationFor'>>;
  let mockRegistry: jest.Mocked<Pick<ConversationRegistry, 'getRecord'>>;
  let mockClaims: jest.Mocked<Pick<WorkflowSessionClaimService, 'release'>>;
  let tabManagerStub: TabManagerStub;

  beforeEach(() => {
    mockAgentMonitor = {
      agentsForSession: jest.fn().mockReturnValue([]),
    };
    mockTabBinding = {
      conversationFor: jest.fn().mockReturnValue(null),
    };
    mockRegistry = {
      getRecord: jest.fn().mockReturnValue(null),
    };
    mockClaims = {
      release: jest.fn(),
    };
    tabManagerStub = makeTabManagerStub();

    TestBed.configureTestingModule({
      providers: [
        TribunalStateService,
        { provide: AgentMonitorStore, useValue: mockAgentMonitor },
        { provide: TabSessionBinding, useValue: mockTabBinding },
        { provide: ConversationRegistry, useValue: mockRegistry },
        { provide: WorkflowSessionClaimService, useValue: mockClaims },
        { provide: TabManagerService, useValue: tabManagerStub.tabManager },
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
      service.buildTilesForRun(lanes);
      const vendorCount = service
        .tiles()
        .filter((t) => t.kind === 'vendor').length;
      expect(vendorCount).toBe(8);
    });

    it('addTile returns false and does NOT add when vendor count already at 8', () => {
      const lanes = Array.from({ length: 8 }, (_, i) =>
        makeLane({ laneId: `lane-${i}`, displayName: `V${i}` }),
      );
      service.buildTilesForRun(lanes);
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
      service.buildTilesForRun(lanes);

      const tiles = service.tiles();
      expect(tiles).toHaveLength(2);
      expect(tiles.every((t) => t.kind === 'vendor')).toBe(true);
    });
  });

  describe('laneBindings — vendor→lane matching', () => {
    function setup(agents: MonitoredAgent[], lanes: VendorLane[]) {
      mockAgentMonitor.agentsForSession.mockReturnValue(agents);
      mockTabBinding.conversationFor.mockReturnValue(
        'conv-1' as unknown as ReturnType<TabSessionBinding['conversationFor']>,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: ['session-1'],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);

      service.setLanes(lanes);
      service.setCorrelationId(TabId.create());
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
    it('returns null when the tab id is not a valid TabId', () => {
      expect(service.resolveTribunalSessionId('not-a-tab-id')).toBeNull();
    });

    it('returns null when conversationFor returns null', () => {
      mockTabBinding.conversationFor.mockReturnValue(null);
      expect(service.resolveTribunalSessionId(TabId.create())).toBeNull();
    });

    it('returns null when registry has no record', () => {
      mockTabBinding.conversationFor.mockReturnValue(
        'conv-1' as unknown as ReturnType<TabSessionBinding['conversationFor']>,
      );
      mockRegistry.getRecord.mockReturnValue(null);
      expect(service.resolveTribunalSessionId(TabId.create())).toBeNull();
    });

    it('returns null when sessions array is empty', () => {
      mockTabBinding.conversationFor.mockReturnValue(
        'conv-1' as unknown as ReturnType<TabSessionBinding['conversationFor']>,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: [],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);
      expect(service.resolveTribunalSessionId(TabId.create())).toBeNull();
    });

    it('returns the last session id when sessions is non-empty', () => {
      mockTabBinding.conversationFor.mockReturnValue(
        'conv-1' as unknown as ReturnType<TabSessionBinding['conversationFor']>,
      );
      mockRegistry.getRecord.mockReturnValue({
        sessions: ['session-old', 'session-latest'],
      } as unknown as ReturnType<ConversationRegistry['getRecord']>);
      expect(service.resolveTribunalSessionId(TabId.create())).toBe(
        'session-latest',
      );
    });
  });

  describe('reset', () => {
    it('clears all state back to defaults', () => {
      service.buildTilesForRun([makeLane()]);

      service.reset();

      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.surfaceId()).toBeNull();
      expect(service.tribunalSessionId()).toBeNull();
    });
  });

  describe('tribunalSessionId — reactive late-resolved session', () => {
    it('auto-updates when the session resolves after setCorrelationId, with no manual refresh', () => {
      TestBed.resetTestingModule();
      const registry = new ConversationRegistry();
      const binding = new TabSessionBinding();
      TestBed.configureTestingModule({
        providers: [
          TribunalStateService,
          {
            provide: AgentMonitorStore,
            useValue: { agentsForSession: jest.fn().mockReturnValue([]) },
          },
          { provide: TabSessionBinding, useValue: binding },
          { provide: ConversationRegistry, useValue: registry },
          {
            provide: WorkflowSessionClaimService,
            useValue: { release: jest.fn() },
          },
          {
            provide: TabManagerService,
            useValue: makeTabManagerStub().tabManager,
          },
        ],
      });
      const svc = TestBed.inject(TribunalStateService);

      const tabId = TabId.create();
      svc.setCorrelationId(tabId);
      expect(svc.tribunalSessionId()).toBeNull();

      const convId = registry.create();
      binding.bind(tabId, convId);
      registry.appendSession(
        convId,
        'session-late' as unknown as ClaudeSessionId,
      );

      expect(svc.tribunalSessionId()).toBe('session-late');
    });
  });

  describe('endRun — claim release + reset', () => {
    it('resets all run state', () => {
      service.buildTilesForRun([makeLane()]);
      service.setCorrelationId(TabId.create());

      service.endRun();

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

  describe('per-workspace state partitioning', () => {
    function switchWorkspace(path: string | null): void {
      tabManagerStub.activeWorkspacePath$.set(path);
      TestBed.tick();
    }

    it('keeps each workspace run isolated in its own slice', () => {
      switchWorkspace('/ws/a');
      service.setMove('forge');
      service.setLanes([makeLane({ laneId: 'a1' })]);
      service.buildTilesForRun([makeLane({ laneId: 'a1' })]);
      service.setCorrelationId('corr-a');

      // Switching to a workspace with no run shows the empty state.
      switchWorkspace('/ws/b');
      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.correlationId()).toBeNull();
      expect(service.move()).toBe('council');

      // A run staged in B must not leak into A's slice.
      service.setMove('race');
      service.setLanes([
        makeLane({ laneId: 'b1' }),
        makeLane({ laneId: 'b2', displayName: 'B2' }),
      ]);
      service.buildTilesForRun([
        makeLane({ laneId: 'b1' }),
        makeLane({ laneId: 'b2', displayName: 'B2' }),
      ]);
      service.setCorrelationId('corr-b');

      expect(service.tiles()).toHaveLength(2);
      expect(service.move()).toBe('race');
      expect(service.correlationId()).toBe('corr-b');
    });

    it('switching back to a workspace instantly restores its in-flight run', () => {
      switchWorkspace('/ws/a');
      service.setMove('forge');
      service.setLanes([makeLane({ laneId: 'a1' })]);
      service.buildTilesForRun([makeLane({ laneId: 'a1' })]);
      service.setCorrelationId('corr-a');

      switchWorkspace('/ws/b');
      expect(service.tiles()).toHaveLength(0);
      expect(service.correlationId()).toBeNull();

      switchWorkspace('/ws/a');
      expect(service.tiles()).toHaveLength(1);
      expect(service.move()).toBe('forge');
      expect(service.correlationId()).toBe('corr-a');
    });

    it('removedWorkspace$ drops that workspace slice so a later revisit is empty', () => {
      switchWorkspace('/ws/a');
      service.buildTilesForRun([makeLane({ laneId: 'a1' })]);
      service.setCorrelationId('corr-a');

      // Switch away, then remove '/ws/a' from the layout.
      switchWorkspace('/ws/b');
      tabManagerStub.removedWorkspace$.set('/ws/a');
      TestBed.tick();

      // Revisiting the removed workspace shows the empty state (slice gone).
      switchWorkspace('/ws/a');
      expect(service.tiles()).toHaveLength(0);
      expect(service.lanes()).toHaveLength(0);
      expect(service.correlationId()).toBeNull();
    });

    it('reset() clears only the active workspace slice', () => {
      switchWorkspace('/ws/a');
      service.buildTilesForRun([makeLane({ laneId: 'a1' })]);
      service.setCorrelationId('corr-a');

      switchWorkspace('/ws/b');
      service.buildTilesForRun([makeLane({ laneId: 'b1' })]);
      service.setCorrelationId('corr-b');

      service.reset();
      expect(service.tiles()).toHaveLength(0);

      // A's slice is untouched by resetting B.
      switchWorkspace('/ws/a');
      expect(service.tiles()).toHaveLength(1);
      expect(service.correlationId()).toBe('corr-a');
    });

    it('endRun() releases only the active slice claim and leaves other slices intact', () => {
      switchWorkspace('/ws/a');
      service.buildTilesForRun([makeLane({ laneId: 'a1' })]);
      service.setCorrelationId('corr-a');

      switchWorkspace('/ws/b');
      service.buildTilesForRun([makeLane({ laneId: 'b1' })]);
      service.setCorrelationId('corr-b');

      service.endRun();
      expect(mockClaims.release).toHaveBeenCalledWith('corr-b');
      expect(mockClaims.release).not.toHaveBeenCalledWith('corr-a');
      expect(service.tiles()).toHaveLength(0);

      switchWorkspace('/ws/a');
      expect(service.tiles()).toHaveLength(1);
      expect(service.correlationId()).toBe('corr-a');
    });

    it('migrates a run staged before the first workspace path onto that path', () => {
      // beforeEach seeds the active slice at the bootstrap sentinel (null path).
      // A run convened during that window must follow onto the first real path.
      service.buildTilesForRun([makeLane({ laneId: 'boot' })]);
      service.setCorrelationId('corr-boot');
      expect(service.tiles()).toHaveLength(1);

      switchWorkspace('/ws/a');

      expect(service.tiles()).toHaveLength(1);
      expect(service.correlationId()).toBe('corr-boot');

      // The sentinel no longer shadows the real workspace: a second, distinct
      // workspace still starts empty.
      switchWorkspace('/ws/b');
      expect(service.tiles()).toHaveLength(0);
    });
  });
});
