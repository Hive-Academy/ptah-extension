import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import {
  AgentMonitorStore,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { ContextCapacity } from '@ptah-extension/shared';
import {
  compilePtahUiBlock,
  resolveCompiledPtahUiBlock,
  type TurnAgentFacts,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { PtahUiLiveWindow } from '../../../services/ptah-ui-live-window';
import {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from '../../../services/ptah-ui-host-sources';
import { PtahUiBlockComponent } from '../ptah-ui-block.component';
import { PtahUiAgentsSource } from './ptah-ui-agents.source';

/** R5.1 sentinel: text that must never leave the store. */
const SENTINEL = 'SENTINEL-R5-1-do-not-render';
const SESSION = 'session-1';

const SUBAGENT_FACT_KEYS = [
  'agentId',
  'agentType',
  'contextTokens',
  'cost',
  'durationMs',
  'inputTokens',
  'model',
  'outputTokens',
  'parentToolUseId',
  'status',
  'teammateName',
  'totalTokens',
];
const LANE_FACT_KEYS = [
  'agentId',
  'cli',
  'cost',
  'displayName',
  'durationMs',
  'startedAt',
  'status',
  'tokens',
];

function subagent(
  parentToolUseId: string,
  overrides: Partial<SubagentRecord> = {},
): SubagentRecord {
  return {
    parentToolUseId,
    agentId: `agent-${parentToolUseId}`,
    teammateName: 'reviewer',
    agentType: 'code-reviewer',
    status: 'running',
    totalTokens: 900,
    durationMs: 4_000,
    parentSessionId: SESSION,
    usage: {
      input: 300,
      output: 200,
      lastRequestContextTokens: 1_200,
      model: 'claude-sonnet-4-5',
      estimatedCostUsd: 0.25,
    },
    // Prompt, summary, output and error text: never copied.
    description: SENTINEL,
    latestSummary: SENTINEL,
    errorMessage: SENTINEL,
    outputFile: `/tmp/${SENTINEL}.md`,
    ...({ agentPrompt: SENTINEL } as object),
    ...overrides,
  } as SubagentRecord;
}

function lane(
  agentId: string,
  overrides: Partial<MonitoredAgent> = {},
): MonitoredAgent {
  return {
    agentId,
    cli: 'codex',
    displayName: 'Codex lane',
    task: SENTINEL,
    status: 'completed',
    startedAt: 1_000,
    completedAt: 6_000,
    stdout: SENTINEL,
    stderr: SENTINEL,
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    parentSessionId: SESSION,
    usageTotals: { inputTokens: 40, outputTokens: 60, costUsd: 0.5 },
    ...overrides,
  } as unknown as MonitoredAgent;
}

const BODY =
  'stats\n  Agents | $agents.total\n  Tokens | $agents.tokens\ntable $agents\n  cols name | status | tokens | cost | duration | context\n';

/** One `$agents` block under the default (root) live-sources token. */
@Component({
  selector: 'ptah-test-agents-block-host',
  standalone: true,
  imports: [PtahUiBlockComponent],
  providers: [PtahUiLiveWindow],
  template: `
    <ptah-ui-block
      [raw]="raw"
      [body]="body"
      [ordinal]="0"
      messageId="m1"
      nodeId="node-1"
      [orderKey]="1"
    />
  `,
})
class AgentsBlockHostComponent {
  readonly body = BODY;
  readonly raw = '```ptah-ui\n' + BODY + '```\n';
}

const TURN: TurnAgentFacts = {
  startedAt: 0,
  nodes: [],
  spawnToolCallIds: ['tool-1'],
};

describe('PtahUiAgentsSource', () => {
  let subagents: WritableSignal<ReadonlyMap<string, SubagentRecord>>;
  let lanes: WritableSignal<readonly MonitoredAgent[]>;
  let host: PtahUiHostSources;
  let sessionId: WritableSignal<string | null>;
  let capacities: WritableSignal<readonly ContextCapacity[]>;

  beforeEach(() => {
    subagents = signal(
      new Map([
        ['tool-1', subagent('tool-1')],
        ['other', subagent('other', { parentSessionId: 'session-2' })],
        ['unresolved', subagent('unresolved', { parentSessionId: undefined })],
      ]),
    );
    lanes = signal([
      lane('lane-1'),
      lane('lane-2', { parentSessionId: 'session-2' }),
    ]);
    sessionId = signal<string | null>(SESSION);
    capacities = signal<readonly ContextCapacity[]>([]);
    host = {
      tabId: signal('tab-1'),
      sessionId,
      turnFacts: signal([TURN]),
      turnIndexOf: () => 0,
      capacities,
    };
    const store: Pick<AgentMonitorStore, 'subagents' | 'agentsOwnedBySession'> =
      {
        subagents: subagents.asReadonly(),
        agentsOwnedBySession: (id: string) =>
          lanes().filter((agent) => agent.parentSessionId === id),
      };
    TestBed.configureTestingModule({
      providers: [
        provideMarkdown(),
        { provide: AgentMonitorStore, useValue: store },
        { provide: PTAH_UI_HOST_SOURCES, useValue: host },
      ],
    });
  });

  const input = () =>
    TestBed.inject(PtahUiAgentsSource).agentsInput(host, 0)();

  it('projects only this session’s subagents, field by field from the allow-list', () => {
    const { records, turnIndex, turns } = input();

    expect(turnIndex).toBe(0);
    expect(turns).toEqual([TURN]);
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]).sort()).toEqual(SUBAGENT_FACT_KEYS);
    expect(records[0]).toEqual({
      parentToolUseId: 'tool-1',
      agentId: 'agent-tool-1',
      teammateName: 'reviewer',
      agentType: 'code-reviewer',
      status: 'running',
      totalTokens: 900,
      inputTokens: 300,
      outputTokens: 200,
      cost: 0.25,
      durationMs: 4_000,
      contextTokens: 1_200,
      model: 'claude-sonnet-4-5',
    });
  });

  it('leaves usage-derived fields unset for a subagent with no usage', () => {
    subagents.set(new Map([['tool-1', subagent('tool-1', { usage: undefined })]]));
    const [record] = input().records;

    expect(record.inputTokens).toBeUndefined();
    expect(record.outputTokens).toBeUndefined();
    expect(record.cost).toBeUndefined();
    expect(record.contextTokens).toBeUndefined();
    expect(record.totalTokens).toBe(900);
  });

  it('projects the session’s CLI lanes with tokens and cost from the usage totals', () => {
    const { lanes: facts } = input();

    expect(facts).toHaveLength(1);
    expect(Object.keys(facts[0]).sort()).toEqual(LANE_FACT_KEYS);
    expect(facts[0]).toEqual({
      agentId: 'lane-1',
      cli: 'codex',
      displayName: 'Codex lane',
      status: 'completed',
      startedAt: 1_000,
      tokens: 100,
      cost: 0.5,
      durationMs: 5_000,
    });
  });

  it('marks unknown lane usage unavailable (null), never 0', () => {
    lanes.set([
      lane('restored', { usageTotals: null }),
      lane('partial', {
        usageTotals: { inputTokens: 40 },
        status: 'running',
        completedAt: undefined,
      }),
      lane('total', { usageTotals: { totalTokens: 77 } }),
    ]);
    const [restored, partial, total] = input().lanes;

    expect([restored.tokens, restored.cost]).toEqual([null, null]);
    expect([partial.tokens, partial.cost, partial.durationMs]).toEqual([
      null,
      null,
      undefined,
    ]);
    expect(total.tokens).toBe(77);
  });

  it('has no records or lanes before the session exists', () => {
    sessionId.set(null);
    const { records, lanes: facts } = input();

    expect(records).toEqual([]);
    expect(facts).toEqual([]);
  });

  it('follows the store and the host while the turn runs (R5.4)', () => {
    const agents = TestBed.inject(PtahUiAgentsSource).agentsInput(host, 0);
    expect(agents().records[0].status).toBe('running');

    const capacity: ContextCapacity = {
      tokens: 200_000,
      source: 'sdk-native',
      providerId: null,
      model: 'claude-sonnet-4-5',
    };
    subagents.set(
      new Map([['tool-1', subagent('tool-1', { status: 'completed' })]]),
    );
    capacities.set([capacity]);

    expect(agents().records[0].status).toBe('completed');
    expect(agents().capacities).toEqual([capacity]);
  });

  describe('R5.1 sentinel', () => {
    it('appears in no fact field and no resolved value', () => {
      const facts = input();
      expect(JSON.stringify(facts)).not.toContain(SENTINEL);

      const compiled = compilePtahUiBlock(BODY, 'ptah-ui-sentinel');
      if (!compiled.ok) throw new Error(compiled.reason);
      const resolved = resolveCompiledPtahUiBlock(compiled, {
        snapshot: null,
        agents: facts,
        limits: null,
        countBytes: (value) => JSON.stringify(value).length,
      });
      expect(resolved.ok).toBe(true);
      expect(JSON.stringify(resolved)).toContain('reviewer');
      expect(JSON.stringify(resolved)).not.toContain(SENTINEL);
    });

    it('appears in no rendered text and no accessible name of a block read through the root token', async () => {
      const fixture = TestBed.createComponent(AgentsBlockHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('ptah-surface-renderer')).not.toBeNull();
      expect(root.textContent).toContain('reviewer');
      expect(root.textContent).toContain('Codex lane');
      expect(root.textContent).not.toContain(SENTINEL);
      // Attributes carry every accessible name (aria-label, title, alt).
      expect(root.innerHTML).not.toContain(SENTINEL);
    });
  });
});
