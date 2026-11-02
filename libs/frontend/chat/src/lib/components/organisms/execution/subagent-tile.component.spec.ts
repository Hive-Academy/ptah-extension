import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  SubagentExecutionStore,
} from '@ptah-extension/chat-streaming';
import type {
  SubagentRecord,
  SubagentExecutionEntry,
} from '@ptah-extension/chat-streaming';
import type { ExecutionNode, PermissionRequest } from '@ptah-extension/shared';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { buildLaneSummary } from '../../molecules/compact-session/compact-lane-rows';
import { SubagentTileComponent } from './subagent-tile.component';
import { BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import { SessionHistoryReplayer } from '../../../services/chat-store/session-history-replayer.service';
import { TabManagerService } from '@ptah-extension/chat-state';

const makeNode = (overrides: Partial<ExecutionNode> = {}): ExecutionNode => ({
  id: 'agent:task-1',
  type: 'agent',
  status: 'streaming',
  content: null,
  toolCallId: 'task-1',
  agentType: 'Explore',
  agentDescription: 'Find files',
  children: [
    {
      id: 'tool-1',
      type: 'tool',
      status: 'pending',
      content: null,
      toolCallId: 'tool-1',
      children: [],
      isCollapsed: false,
    },
  ],
  isCollapsed: false,
  ...overrides,
});

describe('SubagentTileComponent', () => {
  const openLane = jest.fn();
  const records = signal(new Map<string, SubagentRecord>());
  const tree = signal<ExecutionNode[]>([]);
  const entries = signal<ReadonlyMap<string, SubagentExecutionEntry>>(
    new Map(),
  );
  const replayingTabIds = signal<ReadonlySet<string>>(new Set());

  beforeEach(() => {
    openLane.mockClear();
    records.set(new Map());
    tree.set([]);
    replayingTabIds.set(new Set());
    TestBed.configureTestingModule({
      imports: [SubagentTileComponent],
      providers: [
        {
          provide: SESSION_CARD_ACTIONS,
          useValue: { openLane, openSession: jest.fn() },
        },
        { provide: AgentMonitorStore, useValue: { subagents: records } },
        { provide: BackgroundAgentStore, useValue: { isBackgroundAgent: () => false } },
        { provide: SessionHistoryReplayer, useValue: { replayingTabIds } },
        { provide: TabManagerService, useValue: { activeTabId: () => 'tab-1' } },
        {
          provide: SubagentExecutionStore,
          useValue: {
            entries,
            revisionFor: () => entries(),
            treeFor: () => tree(),
          },
        },
      ],
    });
  });

  it('keeps a background placeholder running until its record becomes terminal', () => {
    records.set(new Map([['task-1', { parentToolUseId: 'task-1', status: 'running' } as SubagentRecord]]));
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ status: 'complete', isBackground: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-status"]').textContent).toBe('In background');
    records.set(new Map([['task-1', { parentToolUseId: 'task-1', status: 'completed' } as SubagentRecord]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-status"]').textContent).toBe('Completed');
  });

  it('shows Loading during replay for a nonterminal record without a spinner', () => {
    replayingTabIds.set(new Set(['tab-1']));
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ isBackground: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-status"]').textContent).toBe('Loading');
    expect(fixture.nativeElement.querySelector('.lucide-loader-circle')).toBeNull();
    records.set(new Map([['task-1', { parentToolUseId: 'task-1', status: 'completed' } as SubagentRecord]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="subagent-status"]').textContent).toBe('Completed');
  });

  it('uses store tool count and latest activity, then falls back to the record', () => {
    records.set(
      new Map([
        [
          'task-1',
          {
            parentToolUseId: 'task-1',
            status: 'running',
            toolUses: 4,
            lastToolName: 'Search',
          } as SubagentRecord,
        ],
      ]),
    );
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ children: [] }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('4 tools');
    expect(
      fixture.nativeElement.querySelector('[title="Current known count"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-activity"]')
        .textContent,
    ).toContain('Search');
    tree.set([
      {
        ...makeNode({
          id: 'read-1',
          type: 'tool',
          toolName: 'Read',
          children: [],
        }),
      },
      {
        ...makeNode({
          id: 'write-1',
          type: 'tool',
          toolName: 'Write',
          children: [],
        }),
      },
    ]);
    entries.set(new Map());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('4 tools');
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-activity"]')
        .textContent,
    ).toContain('Write');
  });

  it('shows status, activity, descendant tool count and duration, then opens the sub lane', () => {
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput(
      'node',
      makeNode({
        duration: 62000,
        children: [
          {
            ...makeNode({ type: 'tool', toolCallId: 'outer' }),
            children: [
              makeNode({ type: 'tool', toolCallId: 'inner', children: [] }),
            ],
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Explore');
    expect(fixture.nativeElement.textContent).toContain('Running');
    expect(fixture.nativeElement.textContent).toContain('Find files');
    expect(fixture.nativeElement.textContent).toContain('2 tools');
    expect(fixture.nativeElement.textContent).toContain('1m 2s');
    fixture.nativeElement
      .querySelector('[data-testid="subagent-open"]')
      .click();
    expect(openLane).toHaveBeenCalledWith('sub:task-1');
  });

  it('routes a background agent to the bg lane', () => {
    records.set(
      new Map([
        [
          'task-1',
          { parentToolUseId: 'task-1', status: 'background' } as SubagentRecord,
        ],
      ]),
    );
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ isBackground: true }));
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-testid="subagent-open"]')
      .click();
    expect(openLane).toHaveBeenCalledWith('bg:task-1');
  });

  it('shows a completed background agent as terminal without a spinner and opens its sub lane', () => {
    records.set(
      new Map([
        [
          'task-1',
          { parentToolUseId: 'task-1', status: 'completed' } as SubagentRecord,
        ],
      ]),
    );
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ isBackground: true }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-status"]')
        .textContent,
    ).toBe('Completed');
    expect(
      fixture.nativeElement.querySelector('.lucide-loader-circle'),
    ).toBeNull();
    fixture.nativeElement
      .querySelector('[data-testid="subagent-open"]')
      .click();
    expect(openLane).toHaveBeenCalledWith('sub:task-1');
  });

  it('shows a resumed agent as stopped without a spinner', () => {
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ status: 'resumed' }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-status"]')
        .textContent,
    ).toBe('Stopped');
    expect(
      fixture.nativeElement.querySelector('.lucide-loader-circle'),
    ).toBeNull();
  });

  it.each(['failed', 'stopped', 'killed'] as const)(
    'shows terminal record %s on a background node',
    (status) => {
      records.set(
        new Map([
          ['task-1', { parentToolUseId: 'task-1', status } as SubagentRecord],
        ]),
      );
      const fixture = TestBed.createComponent(SubagentTileComponent);
      fixture.componentRef.setInput('node', makeNode({ isBackground: true }));
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-testid="subagent-status"]')
          .textContent,
      ).toBe(status === 'failed' ? 'Failed' : 'Stopped');
      expect(
        fixture.nativeElement.querySelector('.lucide-loader-circle'),
      ).toBeNull();
    },
  );

  it('keeps a background node in progress until its record settles even if its placeholder errors', () => {
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput(
      'node',
      makeNode({ status: 'error', isBackground: true }),
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-status"]')
        .textContent,
    ).toBe('In background');
  });

  it('shows descendant permission and ignores an expired permission action', () => {
    const permission = {
      id: 'request-1',
      toolName: 'Read',
      toolInput: {},
      timestamp: 1,
    } as PermissionRequest;
    let active = true;
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode());
    fixture.componentRef.setInput('getPermissionForTool', (id: string) =>
      active && id === 'tool-1' ? permission : null,
    );
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="subagent-permission"]',
    );
    expect(button).not.toBeNull();
    active = false;
    button.click();
    expect(openLane).not.toHaveBeenCalled();
  });

  it('opens the exact listed lane when a pending permission badge is clicked', () => {
    const record: SubagentRecord = {
      parentToolUseId: 'task-1',
      status: 'running',
    };
    records.set(new Map([['task-1', record]]));
    const permission = {
      id: 'request-1',
      toolName: 'Read',
      toolInput: {},
      timestamp: 1,
    } as PermissionRequest;
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode({ isBackground: true }));
    fixture.componentRef.setInput('getPermissionForTool', (id: string) =>
      id === 'tool-1' ? permission : null,
    );
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-testid="subagent-permission"]')
      .click();
    const listedKey = buildLaneSummary([], [record], '', 3).rows[0].id;
    expect(listedKey).toBe('sub:task-1');
    expect(openLane).toHaveBeenCalledWith(listedKey);
  });

  it('keeps the action safely unavailable without a lane provider', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SubagentTileComponent],
      providers: [
        { provide: AgentMonitorStore, useValue: { subagents: records } },
        { provide: SessionHistoryReplayer, useValue: { replayingTabIds } },
        { provide: TabManagerService, useValue: { activeTabId: () => 'tab-1' } },
        {
          provide: SubagentExecutionStore,
          useValue: {
            entries,
            revisionFor: () => entries(),
            treeFor: () => tree(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SubagentTileComponent);
    fixture.componentRef.setInput('node', makeNode());
    fixture.componentRef.setInput(
      'getPermissionForTool',
      () => ({ id: 'request-1' }) as PermissionRequest,
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="subagent-open"]')
        .disabled,
    ).toBe(true);
    const permissionButton = fixture.nativeElement.querySelector(
      '[data-testid="subagent-permission"]',
    );
    expect(permissionButton.disabled).toBe(true);
    expect(() => permissionButton.click()).not.toThrow();
    expect(openLane).not.toHaveBeenCalled();
  });
});
