import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
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

function makeLane(overrides: Partial<VendorLane> = {}): VendorLane {
  return {
    laneId: 'lane-1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    ...overrides,
  };
}

/** Minimal `RpcResult` shape — the two members the run service reads. */
function rpcOk(data: unknown): unknown {
  return { isSuccess: () => true, data, error: undefined };
}

function rpcFailed(message: string): unknown {
  return { isSuccess: () => false, data: undefined, error: message };
}

function createdTask(id: string): unknown {
  return rpcOk({ success: true, task: { id, folderName: id } });
}

// ---------------------------------------------------------------------------
// AC-1.4 / AC-7.2 — the framing is a WIRE CONTRACT with the tribunal skill.
//
// These snapshots are asserted with full-string equality, not `toContain`. The
// conductor reads this text and nothing type-checks it, so a plausible
// paraphrase is a silent break. The council/forge/race snapshots below are the
// framing as it shipped BEFORE relay/crucible existed, character for character.
// ---------------------------------------------------------------------------

const NO_DISCOVERY_PARAGRAPH =
  'This panel is EXPLICITLY defined by the user. Spawn EXACTLY these panelists with EXACTLY these spawn args via ptah_agent_spawn, passing each the objective stated at the end of this message. Do NOT run your own vendor discovery or family-spread selection, do NOT collapse duplicate vendors, and do NOT substitute models. The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task, verbatim.';

const ROLE_AUTHORITY_LINE =
  "Each lane's ROLE is stated below and is authoritative — do not infer it from lane order.";

const TAG_RULE =
  '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.';

const FULL_AUTO_RULE =
  '- Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions; state assumptions inline rather than asking.';

const RELAY_RULE =
  '- Do NOT call `AskUserQuestion` for ordinary implementation decisions — state assumptions inline. You DO own every user gate, because CLI lanes cannot ask: after `task-description.md` and again after `implementation-plan.md`, present the document path and a short summary as a plain message and wait for `APPROVED` before relaying the next phase. If a lane returns a `## Clarifications Needed` block instead of its deliverable, surface those questions to the user, then re-spawn that lane with a `## User Decisions` section.';

const CRUCIBLE_RULE =
  '- Do NOT call `AskUserQuestion` for ordinary decisions. The round cap below is hard: stop at it and present the open defects honestly. A 3rd revise round runs **only if the user explicitly asks for it** — never on your own initiative, and never a 4th.';

/** One codex lane, the fixture every flat snapshot is built from. */
const FLAT_LANE = makeLane({
  laneId: 'codex#0',
  displayName: 'Codex',
  cli: 'codex',
  model: 'gpt-5.1-codex-max',
});

const FLAT_LANE_LINE =
  '  [tribunal:codex#0] Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-max" }) with the objective below as the task.';

const COUNCIL_FRAMING = [
  'Convene a Tribunal Council. You are the Tribunal conductor running FULLY AUTONOMOUSLY.',
  '',
  'Council: each panelist weighs in independently, then synthesize a single cited verdict.',
  '',
  NO_DISCOVERY_PARAGRAPH,
  '',
  FLAT_LANE_LINE,
  '',
  'Rules:',
  FULL_AUTO_RULE,
  TAG_RULE,
  '',
  'Objective:',
].join('\n');

const FORGE_FRAMING = [
  'Convene a Tribunal Forge. You are the Tribunal conductor running FULLY AUTONOMOUSLY.',
  '',
  'Forge: each panelist implements the objective in its own worktree, then cross-review the diffs.',
  '',
  NO_DISCOVERY_PARAGRAPH,
  '',
  FLAT_LANE_LINE,
  '',
  'Rules:',
  FULL_AUTO_RULE,
  TAG_RULE,
  '',
  'Objective:',
].join('\n');

const RACE_FRAMING = [
  'Convene a Tribunal Race. You are the Tribunal conductor running FULLY AUTONOMOUSLY.',
  '',
  'Race: panelists compete on the objective; score the results against a rubric and rank them.',
  '',
  NO_DISCOVERY_PARAGRAPH,
  '',
  FLAT_LANE_LINE,
  '',
  'Rules:',
  FULL_AUTO_RULE,
  TAG_RULE,
  '',
  'Objective:',
].join('\n');

const RELAY_TASK_ID = 'TASK_2026_900';

const RELAY_LANES: readonly VendorLane[] = [
  {
    laneId: 'codex#0',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    model: 'gpt-5.1-codex-max',
    role: 'plan',
  },
  {
    laneId: 'codex#1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    model: 'gpt-5.1-codex-mini',
    role: 'architect',
  },
  {
    laneId: 'copilot#2',
    family: 'copilot',
    displayName: 'Copilot',
    cli: 'copilot',
    model: 'claude-opus-4-8',
    role: 'implement',
  },
  {
    laneId: 'cursor#3',
    family: 'cursor',
    displayName: 'Cursor',
    cli: 'cursor',
    role: 'review',
  },
];

const RELAY_FRAMING = [
  'Convene a Tribunal Relay. You are the Tribunal conductor. You own every user gate.',
  '',
  'Relay: one task through a sequential plan → architect → implement → review pipeline, one CLI lane per phase.',
  '',
  "Read the tribunal skill's references/relay.md before spawning anything; it is the authority for this move.",
  '',
  `Spec folder: ${RELAY_TASK_ID} (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.`,
  '',
  NO_DISCOVERY_PARAGRAPH,
  ROLE_AUTHORITY_LINE,
  '',
  `  [tribunal:codex#0] (plan) Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-max" }). Phase: plan. Deliverable: .ptah/specs/${RELAY_TASK_ID}/task-description.md`,
  `  [tribunal:codex#1] (architect) Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-mini" }). Phase: architect. Deliverable: .ptah/specs/${RELAY_TASK_ID}/implementation-plan.md`,
  `  [tribunal:copilot#2] (implement) Copilot — ptah_agent_spawn({ cli: "copilot", model: "claude-opus-4-8" }). Phase: implement. Deliverable: .ptah/specs/${RELAY_TASK_ID}/batches.md`,
  `  [tribunal:cursor#3] (review) Cursor — ptah_agent_spawn({ cli: "cursor" }). Phase: review. Deliverable: .ptah/specs/${RELAY_TASK_ID}/code-logic-review.md`,
  '',
  'Rules:',
  RELAY_RULE,
  TAG_RULE,
  '',
  'Objective:',
].join('\n');

const CRUCIBLE_TASK_ID = 'TASK_2026_901';

const CRUCIBLE_LANES: readonly VendorLane[] = [
  {
    laneId: 'codex#0',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    model: 'gpt-5.1-codex-mini',
    role: 'executor',
  },
  {
    laneId: 'copilot#1',
    family: 'copilot',
    displayName: 'Copilot',
    cli: 'copilot',
    model: 'claude-opus-4-8',
    role: 'judge',
  },
];

const RUBRIC = '| 1 | Type safety | No `any` | Judge reads the diff |';

const CRUCIBLE_FRAMING = [
  'Convene a Tribunal Crucible. You are the Tribunal conductor. You own every user gate.',
  '',
  'Crucible: a cheap executor lane writes the code and a stronger judge lane from a different family scores it against a frozen rubric, looping until PASS or the round cap.',
  '',
  "Read the tribunal skill's references/crucible.md before spawning anything; it is the authority for this move.",
  '',
  `Spec folder: ${CRUCIBLE_TASK_ID} (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.`,
  '',
  NO_DISCOVERY_PARAGRAPH,
  ROLE_AUTHORITY_LINE,
  '',
  '  [tribunal:codex#0] (executor) Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5.1-codex-mini" }) with the objective below as the task.',
  '  [tribunal:copilot#1] (judge) Copilot — ptah_agent_spawn({ cli: "copilot", model: "claude-opus-4-8" }) with the objective below as the task.',
  '',
  'Round cap: 2 revise rounds. Stop at the cap and report open defects honestly.',
  `Rubric — write this VERBATIM to .ptah/specs/${CRUCIBLE_TASK_ID}/rubric.md before the first spawn, then freeze it after round 1:`,
  RUBRIC,
  '',
  `Each judge round writes .ptah/specs/${CRUCIBLE_TASK_ID}/round-N-judge.md under the ## VERDICT / ## SCORES / ## DEFECTS / ## MENTOR NOTE headings, with every defect carrying a file:line citation. The Tribunal panel reads those files to show progress.`,
  '',
  'Rules:',
  CRUCIBLE_RULE,
  TAG_RULE,
  '',
  'Objective:',
].join('\n');

describe('TribunalRunService', () => {
  let service: TribunalRunService;
  let mockRpc: { call: jest.Mock };
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
  > & { activeWorkspacePath: string | null };
  let mockState: jest.Mocked<
    Pick<
      TribunalStateService,
      | 'setMove'
      | 'setLanes'
      | 'buildTilesForRun'
      | 'setSurfaceId'
      | 'setCorrelationId'
      | 'setSpecTaskId'
      | 'setRoundCap'
      | 'setRubric'
      | 'reset'
      | 'tiles'
      | 'move'
      | 'lanes'
      | 'surfaceId'
      | 'tribunalSessionId'
      | 'correlationId'
      | 'specTaskId'
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
      activeWorkspacePath: '/repo',
    };

    mockState = {
      setMove: jest.fn(),
      setLanes: jest.fn(),
      buildTilesForRun: jest.fn(),
      setSurfaceId: jest.fn(),
      setCorrelationId: jest.fn(),
      setSpecTaskId: jest.fn(),
      setRoundCap: jest.fn(),
      setRubric: jest.fn(),
      reset: jest.fn(),
      tiles: jest.fn().mockReturnValue([]),
      move: jest.fn().mockReturnValue('council'),
      lanes: jest.fn().mockReturnValue([]),
      surfaceId: jest.fn().mockReturnValue(null),
      tribunalSessionId: jest.fn().mockReturnValue(null),
      correlationId: jest.fn().mockReturnValue(null),
      specTaskId: jest.fn().mockReturnValue(null),
      vendorTileCount: jest.fn().mockReturnValue(0),
      laneBindings: jest.fn().mockReturnValue(new Map()),
    };

    mockRpc = {
      call: jest.fn().mockResolvedValue(createdTask('TASK_2026_999')),
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
        { provide: ClaudeRpcService, useValue: mockRpc },
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
    it('does NOT start a session — the normal chat send path owns the run', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });
      // No rpc/chat:start dependency exists on the service any more.
      expect(mockTabManager.createTab).toHaveBeenCalledWith(
        'Tribunal: council',
      );
    });

    it('creates a conductor tab and uses its id as the correlation id', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(mockTabManager.createTab).toHaveBeenCalledWith(
        'Tribunal: council',
      );
      expect(mockState.setCorrelationId).toHaveBeenCalledWith(
        'conductor-tab-1',
      );
    });

    it('claims the conductor tab id so the tab bar can hide it', async () => {
      const claims = TestBed.inject(WorkflowSessionClaimService);
      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(claims.surfaceFor('conductor-tab-1')).not.toBeNull();
    });

    it('stamps the framing as the conductor tab first-message preamble', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(mockTabManager.setFirstMessagePreamble).toHaveBeenCalledWith(
        'conductor-tab-1',
        expect.any(String),
      );
    });

    it('freezes the wizard effort onto the conductor tab override', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(mockTabManager.setOverrideEffort).toHaveBeenCalledWith(
        'conductor-tab-1',
        'medium',
      );
    });

    it('includes the move phrase in the framing (council/forge/race)', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });
      expect(preamble()).toContain('Convene a Tribunal Council');
    });

    it('includes the move phrase for forge', async () => {
      await service.prepare({ move: 'forge', lanes: [makeLane()] });
      expect(preamble()).toContain('Convene a Tribunal Forge');
    });

    it('includes the move phrase for race', async () => {
      await service.prepare({
        move: 'race',
        lanes: [makeLane({ cli: 'copilot' })],
      });
      expect(preamble()).toContain('Convene a Tribunal Race');
    });

    it('ends with an "Objective:" trailer so the user message reads as the objective', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });
      expect(preamble().trimEnd().endsWith('Objective:')).toBe(true);
    });

    it('includes the full-auto "do not call AskUserQuestion" directive', async () => {
      await service.prepare({ move: 'council', lanes: [makeLane()] });
      expect(preamble()).toContain('Do NOT call AskUserQuestion');
      expect(preamble()).toContain(
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
      await service.prepare({ move: 'council', lanes });

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
      ];
      await service.prepare({ move: 'council', lanes });

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

    it('omits the model key for a cursor lane (no model)', async () => {
      await service.prepare({
        move: 'council',
        lanes: [
          makeLane({
            laneId: 'cursor#0',
            displayName: 'Cursor',
            cli: 'cursor',
          }),
        ],
      });

      expect(preamble()).toContain(
        '[tribunal:cursor#0] Cursor — ptah_agent_spawn({ cli: "cursor" })',
      );
      expect(preamble()).not.toContain('cursor", model:');
    });

    it('returns false and creates nothing when no lanes are provided', async () => {
      const result = await service.prepare({ move: 'council', lanes: [] });

      expect(result).toBe(false);
      expect(mockTabManager.createTab).not.toHaveBeenCalled();
      expect(mockTabManager.setFirstMessagePreamble).not.toHaveBeenCalled();
    });

    it('returns true on success', async () => {
      await expect(
        service.prepare({ move: 'council', lanes: [makeLane()] }),
      ).resolves.toBe(true);
    });

    it('builds tiles before stamping the preamble', async () => {
      const callOrder: string[] = [];
      (mockState.buildTilesForRun as jest.Mock).mockImplementation(() =>
        callOrder.push('buildTilesForRun'),
      );
      mockTabManager.setFirstMessagePreamble.mockImplementation(() =>
        callOrder.push('setFirstMessagePreamble'),
      );

      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(callOrder.indexOf('buildTilesForRun')).toBeLessThan(
        callOrder.indexOf('setFirstMessagePreamble'),
      );
    });

    it('does NOT tear down a prior tab when none is live (first run)', async () => {
      (mockState.correlationId as jest.Mock).mockReturnValue(null);

      await service.prepare({ move: 'council', lanes: [makeLane()] });

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

      await service.prepare({ move: 'council', lanes: [makeLane()] });

      expect(mockTabManager.forceCloseTab).toHaveBeenCalledWith('prior-tab');
      expect(callOrder.indexOf('forceCloseTab')).toBeLessThan(
        callOrder.indexOf('createTab'),
      );
      expect(callOrder.indexOf('reset')).toBeLessThan(
        callOrder.indexOf('createTab'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-1.4 / AC-7.2
  // -------------------------------------------------------------------------

  describe('framing snapshots — the wire contract with the skill', () => {
    it('council framing is byte-identical to the shipped text', async () => {
      await service.prepare({ move: 'council', lanes: [FLAT_LANE] });
      expect(preamble()).toBe(COUNCIL_FRAMING);
    });

    it('forge framing is byte-identical to the shipped text', async () => {
      await service.prepare({ move: 'forge', lanes: [FLAT_LANE] });
      expect(preamble()).toBe(FORGE_FRAMING);
    });

    it('race framing is byte-identical to the shipped text', async () => {
      await service.prepare({ move: 'race', lanes: [FLAT_LANE] });
      expect(preamble()).toBe(RACE_FRAMING);
    });

    it('relay framing carries role tokens, the spec folder and per-phase deliverables', async () => {
      mockRpc.call.mockResolvedValue(createdTask(RELAY_TASK_ID));

      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(preamble()).toBe(RELAY_FRAMING);
    });

    it('crucible framing carries the round cap, the verbatim rubric and the judge contract', async () => {
      mockRpc.call.mockResolvedValue(createdTask(CRUCIBLE_TASK_ID));

      await service.prepare({
        move: 'crucible',
        lanes: CRUCIBLE_LANES,
        rubric: RUBRIC,
        roundCap: 2,
      });

      expect(preamble()).toBe(CRUCIBLE_FRAMING);
    });

    it('never tells a role move to run fully autonomously', async () => {
      mockRpc.call.mockResolvedValue(createdTask(RELAY_TASK_ID));
      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(preamble()).not.toContain('FULLY AUTONOMOUSLY');
      expect(preamble()).toContain('You own every user gate');
    });

    it('keeps the [tribunal:<laneId>] tag grammar unchanged on role moves (AC-6.2)', async () => {
      mockRpc.call.mockResolvedValue(createdTask(RELAY_TASK_ID));
      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      const tags = preamble()
        .split('\n')
        .filter((line) => line.startsWith('  [tribunal:'))
        .map((line) => line.slice('  [tribunal:'.length, line.indexOf(']')));
      // The role is an additive `(role)` token in the human-readable remainder;
      // it never enters the tag, which is why lane matching needs no migration.
      expect(tags).toEqual(['codex#0', 'codex#1', 'copilot#2', 'cursor#3']);
    });

    it('keeps two same-family relay lanes as two distinct lanes (AC-2.2)', async () => {
      mockRpc.call.mockResolvedValue(createdTask(RELAY_TASK_ID));
      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      const tagLines = preamble()
        .split('\n')
        .filter((line) => line.trim().startsWith('[tribunal:'));
      expect(tagLines).toHaveLength(4);
      expect(tagLines[0]).toContain('[tribunal:codex#0] (plan)');
      expect(tagLines[1]).toContain('[tribunal:codex#1] (architect)');
    });
  });

  // -------------------------------------------------------------------------
  // Q3 — spec folder allocation
  // -------------------------------------------------------------------------

  describe('spec folder allocation', () => {
    it('allocates a task folder for relay and stores its id', async () => {
      mockRpc.call.mockResolvedValue(createdTask(RELAY_TASK_ID));

      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(mockRpc.call).toHaveBeenCalledWith(
        'tasks:create',
        expect.objectContaining({
          type: 'FEATURE',
          status: 'in_progress',
          workspaceRoot: '/repo',
        }),
      );
      expect(mockState.setSpecTaskId).toHaveBeenCalledWith(RELAY_TASK_ID);
    });

    it('does NOT allocate anything for a flat move', async () => {
      await service.prepare({ move: 'council', lanes: [FLAT_LANE] });

      expect(mockRpc.call).not.toHaveBeenCalled();
      expect(mockState.setSpecTaskId).toHaveBeenCalledWith(null);
    });

    it('launches anyway when allocation fails, omitting the Spec folder line', async () => {
      mockRpc.call.mockResolvedValue(rpcFailed('no workspace'));

      const ok = await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(ok).toBe(true);
      expect(mockState.setSpecTaskId).toHaveBeenCalledWith(null);
      expect(preamble()).not.toContain('Spec folder:');
      expect(preamble()).toContain('Deliverable: <spec folder>/');
    });

    it('launches anyway when the allocation RPC throws', async () => {
      mockRpc.call.mockRejectedValue(new Error('transport closed'));

      const ok = await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(ok).toBe(true);
      expect(mockState.setSpecTaskId).toHaveBeenCalledWith(null);
    });

    it('allocates BEFORE creating the conductor tab, so a failed run leaves no tab', async () => {
      const order: string[] = [];
      mockRpc.call.mockImplementation(async () => {
        order.push('tasks:create');
        return createdTask(RELAY_TASK_ID);
      });
      mockTabManager.createTab.mockImplementation(() => {
        order.push('createTab');
        return 'conductor-tab-1';
      });

      await service.prepare({ move: 'relay', lanes: RELAY_LANES });

      expect(order).toEqual(['tasks:create', 'createTab']);
    });
  });

  // -------------------------------------------------------------------------
  // Roster rules are enforced at the launch boundary too, not only in the UI
  // -------------------------------------------------------------------------

  describe('roster gate', () => {
    it('refuses a relay roster with an unfilled phase (AC-2.3)', async () => {
      const ok = await service.prepare({
        move: 'relay',
        lanes: RELAY_LANES.slice(0, 3),
      });

      expect(ok).toBe(false);
      expect(mockTabManager.createTab).not.toHaveBeenCalled();
      expect(mockRpc.call).not.toHaveBeenCalled();
    });

    it('refuses a same-family crucible judge with no override (AC-2.5)', async () => {
      const ok = await service.prepare({
        move: 'crucible',
        lanes: [
          { ...CRUCIBLE_LANES[0] },
          {
            ...CRUCIBLE_LANES[1],
            family: 'codex',
            cli: 'codex',
            displayName: 'Codex',
          },
        ],
        rubric: RUBRIC,
      });

      expect(ok).toBe(false);
      expect(mockTabManager.createTab).not.toHaveBeenCalled();
    });

    it('clamps a Crucible round cap above the launch maximum', async () => {
      mockRpc.call.mockResolvedValue(createdTask(CRUCIBLE_TASK_ID));

      await service.prepare({
        move: 'crucible',
        lanes: CRUCIBLE_LANES,
        rubric: RUBRIC,
        roundCap: 9,
      });

      expect(mockState.setRoundCap).toHaveBeenCalledWith(2);
      expect(preamble()).toContain('Round cap: 2 revise rounds.');
    });

    it('carries no round cap or rubric on a flat move', async () => {
      await service.prepare({ move: 'council', lanes: [FLAT_LANE] });

      expect(mockState.setRoundCap).toHaveBeenCalledWith(null);
      expect(mockState.setRubric).toHaveBeenCalledWith(null);
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
          provide: ClaudeRpcService,
          useValue: { call: jest.fn().mockResolvedValue(rpcFailed('no rpc')) },
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
            activeWorkspacePath: null,
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

  it('tiles built by prepare are observable through the page-resolved TribunalStateService', async () => {
    expect(pageState.tiles()).toHaveLength(0);

    await runService.prepare({
      move: 'council',
      lanes: [makeLane({ laneId: 'l1', displayName: 'Codex' })],
    });

    expect(pageState.tiles().length).toBeGreaterThan(0);
  });
});
