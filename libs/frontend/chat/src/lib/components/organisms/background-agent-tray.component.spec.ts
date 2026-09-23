/**
 * BackgroundAgentTrayComponent — row mapping from the stores to the strip
 * view-model: labels, tidy summaries, stats fields and the effective status of
 * a background agent whose subagent record already finished.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  type BackgroundAgentEntry,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';
import { BackgroundAgentTrayComponent } from './background-agent-tray.component';

function record(
  parentToolUseId: string,
  overrides: Partial<SubagentRecord> = {},
): SubagentRecord {
  return { parentToolUseId, status: 'running', ...overrides };
}

function background(
  toolCallId: string,
  overrides: Partial<BackgroundAgentEntry> = {},
): BackgroundAgentEntry {
  return {
    toolCallId,
    agentId: `agent-${toolCallId}`,
    hasRealAgentId: true,
    agentType: 'reviewer',
    status: 'running',
    startedAt: 1,
    ...overrides,
  } as BackgroundAgentEntry;
}

describe('BackgroundAgentTrayComponent — entry mapping', () => {
  function entriesFor(
    records: SubagentRecord[],
    backgrounds: BackgroundAgentEntry[] = [],
  ) {
    TestBed.configureTestingModule({
      imports: [BackgroundAgentTrayComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            subagents: signal(
              new Map(records.map((r) => [r.parentToolUseId, r])),
            ),
            sendMessageToAgent: jest.fn(),
            stopAgent: jest.fn(),
            backgroundAgent: jest.fn(),
          },
        },
        {
          provide: BackgroundAgentStore,
          useValue: { agents: signal(backgrounds) },
        },
        {
          provide: TabManagerService,
          useValue: { findTabBySessionId: jest.fn(), switchTab: jest.fn() },
        },
        {
          provide: SubagentTranscriptViewerService,
          useValue: { openFor: jest.fn() },
        },
      ],
    });
    return TestBed.createComponent(
      BackgroundAgentTrayComponent,
    ).componentInstance.entries();
  }

  afterEach(() => TestBed.resetTestingModule());

  describe('name', () => {
    it('leads with the agent type and keeps a meaningful teammate name as a hint', () => {
      const [e] = entriesFor([
        record('t1', { agentType: 'software-architect', teammateName: 'lead' }),
      ]);
      expect(e.name).toBe('software-architect');
      expect(e.hint).toBe('lead');
      expect(e.agentType).toBe('software-architect');
    });

    it('drops a short teammate name instead of using it as the label', () => {
      const [e] = entriesFor([
        record('t1', {
          teammateName: 'r',
          description: 'Review code logic',
        }),
      ]);
      expect(e.name).toBe('Review code logic');
      expect(e.hint).toBeUndefined();
    });

    it('omits a hint that repeats the agent type', () => {
      const [e] = entriesFor([
        record('t1', { agentType: 'tester', teammateName: 'Tester' }),
      ]);
      expect(e.hint).toBeUndefined();
    });

    it('uses the background entry agent type over a short teammate name', () => {
      const [e] = entriesFor(
        [],
        [background('b1', { agentType: 'reviewer', teammateName: 'r' })],
      );
      expect(e.name).toBe('reviewer');
      expect(e.hint).toBeUndefined();
    });
  });

  describe('summary', () => {
    it('renders a WROTE reply as "Wrote <basename>" for a Windows path', () => {
      const [e] = entriesFor([
        record('t1', {
          agentType: 'reviewer',
          latestSummary:
            'WROTE: D:\\projects\\ptah-extension\\.ptah\\specs\\TASK_1\\code-logic-review.md',
        }),
      ]);
      expect(e.description).toBe('Wrote code-logic-review.md');
    });

    it('is case-insensitive and handles posix paths', () => {
      const [e] = entriesFor([
        record('t1', {
          agentType: 'reviewer',
          latestSummary: 'wrote: /home/me/repo/report.md',
        }),
      ]);
      expect(e.description).toBe('Wrote report.md');
    });

    it('strips directories from paths inside a free-form summary', () => {
      const [e] = entriesFor([
        record('t1', {
          agentType: 'tester',
          latestSummary:
            'Running jest on libs/frontend/chat/src/app.spec.ts now\nsecond line',
        }),
      ]);
      expect(e.description).toBe('Running jest on app.spec.ts now');
    });

    it('falls back to the last tool name, then the description', () => {
      const [withTool] = entriesFor([
        record('t1', { agentType: 'architect', lastToolName: 'Bash' }),
      ]);
      expect(withTool.description).toBe('Bash');
      TestBed.resetTestingModule();

      const [withDescription] = entriesFor([
        record('t2', { agentType: 'architect', description: 'Design the API' }),
      ]);
      expect(withDescription.description).toBe('Design the API');
    });

    it('carries duration and token stats from the subagent record', () => {
      const [e] = entriesFor([
        record('t1', {
          agentType: 'tester',
          durationMs: 58_000,
          totalTokens: 41_000,
        }),
      ]);
      expect(e.durationMs).toBe(58_000);
      expect(e.totalTokens).toBe(41_000);
    });
  });

  describe('origin (TASK_2026_533)', () => {
    it('marks active subagents foreground and background records background', () => {
      const entries = entriesFor(
        [
          record('fg1', { agentType: 'tester' }),
          record('b1', { taskId: 'task-1' }),
        ],
        [background('b1'), background('b2', { status: 'completed' })],
      );
      const origins = Object.fromEntries(entries.map((e) => [e.id, e.origin]));

      expect(origins).toEqual({
        fg1: 'foreground',
        // A backgrounded subagent is its background record, not both.
        b1: 'background',
        b2: 'background',
      });
    });
  });

  describe('background status', () => {
    it('shows a running background entry as background', () => {
      const [e] = entriesFor(
        [record('b1', { taskId: 'task-1' })],
        [background('b1')],
      );
      expect(e.status).toBe('background');
      expect(e.steerable).toBe(true);
      expect(e.stoppable).toBe(true);
    });

    it('reports completed when the subagent record finished before the background entry', () => {
      const [e] = entriesFor(
        [
          record('b1', {
            status: 'completed',
            taskId: 'task-1',
            latestSummary: 'WROTE: D:\\out\\review.md',
          }),
        ],
        [background('b1')],
      );
      expect(e.status).toBe('completed');
      expect(e.description).toBe('Wrote review.md');
      expect(e.steerable).toBe(false);
      expect(e.stoppable).toBe(false);
    });

    it.each([
      ['failed', 'error'],
      ['killed', 'stopped'],
      ['stopped', 'stopped'],
    ] as const)('maps a %s subagent record to %s', (recStatus, expected) => {
      const [e] = entriesFor(
        [record('b1', { status: recStatus })],
        [background('b1')],
      );
      expect(e.status).toBe(expected);
    });
  });
});
