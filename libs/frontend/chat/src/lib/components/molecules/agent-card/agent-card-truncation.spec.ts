/**
 * What a user actually SEES on an agent card once its output has been trimmed.
 *
 * The retention specs in `chat-streaming` pin the bounds; this one pins the
 * consequence, on the rendered card, through the real components. That
 * distinction is the whole of TASK_2026_335: `MAX_AGENT_SEGMENTS` was enforced
 * with a bare `slice(-500)` and the existing tests asserted only array length
 * and landmark retention, so a cap that silently deleted a long agent's opening
 * plan passed review. A length assertion cannot tell a fold from a deletion.
 *
 * Covers:
 *   1. the segment cap  — dropped prose is still on the card, and the card says
 *      a trim happened (defect 1);
 *   2. the stdout byte cap — the truncation notice renders as its own block,
 *      not as something the agent said (defect 3).
 */

import { TestBed } from '@angular/core/testing';
import { Component, computed, signal } from '@angular/core';
import { provideMarkdown } from 'ngx-markdown';
import { AgentCardOutputComponent } from '@ptah-extension/chat-ui';
import type { RenderSegment, StderrSegment } from '@ptah-extension/chat-ui';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type {
  AgentOutputDelta,
  AgentProcessInfo,
  CliOutputSegment,
} from '@ptah-extension/shared';
import {
  mergeConsecutiveTextSegments,
  parseAgentOutput,
  parseStderr,
} from './agent-card.utils';

@Component({
  standalone: true,
  imports: [AgentCardOutputComponent],
  template: `<ptah-agent-card-output
    [segments]="segments()"
    [stderrSegments]="stderrSegments()"
  />`,
})
class OutputHostComponent {
  readonly segments = signal<RenderSegment[]>([]);
  readonly stderrSegments = signal<StderrSegment[]>([]);
}

const mockActiveTab = signal<{ claudeSessionId?: string } | null>(null);

describe('agent card — what a trimmed card shows', () => {
  let store: AgentMonitorStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OutputHostComponent],
      providers: [
        // The card renders agent prose through `<markdown>`; the real provider
        // is used rather than a stub so a rendered assertion means the text
        // actually reached the DOM.
        provideMarkdown(),
        AgentMonitorStore,
        {
          provide: TabManagerService,
          useValue: {
            activeTab: mockActiveTab,
            activeTabSessionId: computed(
              () => mockActiveTab()?.claudeSessionId ?? null,
            ),
            tabs: signal([]),
          },
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
      ],
    });
    store = TestBed.inject(AgentMonitorStore);
    mockActiveTab.set(null);
  });

  afterEach(() => TestBed.resetTestingModule());

  function spawn(agentId: string, cli = 'codex'): void {
    store.onAgentSpawned({
      agentId,
      cli,
      task: `task ${agentId}`,
      status: 'running',
      startedAt: new Date().toISOString(),
    } as unknown as AgentProcessInfo);
  }

  function agentOf(agentId: string) {
    const agent = store.agents().find((a) => a.agentId === agentId);
    if (!agent) throw new Error(`missing agent ${agentId}`);
    return agent;
  }

  /**
   * Render exactly what `AgentCardComponent` binds on the default / ptah-cli
   * fallback path: `mergeConsecutiveTextSegments(agent.segments)`, or
   * `parseAgentOutput(agent.stdout)` when there are no structured segments.
   */
  function renderedText(
    segments: RenderSegment[],
    stderrSegments: StderrSegment[] = [],
  ): string {
    const fixture = TestBed.createComponent(OutputHostComponent);
    fixture.componentInstance.segments.set(segments);
    fixture.componentInstance.stderrSegments.set(stderrSegments);
    fixture.detectChanges();
    return fixture.nativeElement.textContent ?? '';
  }

  describe('the segment cap (defect 1)', () => {
    // Interleaved on purpose: `onAgentOutput` merges a run of same-typed
    // prose segments into one, so a stream of nothing but thinking never
    // reaches the 500 cap. Prose between tool calls is what does.
    function pushLongRun(agentId: string, pairs: number): void {
      for (let i = 0; i < pairs; i++) {
        store.onAgentOutput({
          agentId,
          segments: [{ type: 'thinking', content: `plan step ${i}. ` }],
        } as AgentOutputDelta);
        store.onAgentOutput({
          agentId,
          segments: [
            { type: 'tool-call', content: '', toolName: `tool-${i}` },
          ] as CliOutputSegment[],
        } as AgentOutputDelta);
      }
    }

    it("still shows the agent's opening reasoning after 800 segments", () => {
      spawn('long');
      pushLongRun('long', 400);

      const text = renderedText(
        mergeConsecutiveTextSegments(agentOf('long').segments),
      );

      // The first thing this agent ever reasoned about. A bare slice deleted
      // it with no trace; it must still be on the card.
      expect(text).toContain('plan step 0.');
      expect(text).toContain('plan step 1.');
      // ...and so is the newest reasoning, after it.
      expect(text).toContain('plan step 399.');
      expect(text.indexOf('plan step 0.')).toBeLessThan(
        text.indexOf('plan step 399.'),
      );
    });

    it('tells the user, on the card, that earlier output was trimmed', () => {
      spawn('long');
      pushLongRun('long', 400);

      const text = renderedText(
        mergeConsecutiveTextSegments(agentOf('long').segments),
      );

      expect(text).toMatch(
        /… \d+ earlier output segments were trimmed to bound this card \(\d+ preserved below, \d+ dropped\)\./,
      );
    });
  });

  describe('the stdout byte cap (defect 3)', () => {
    function pushStdout(agentId: string, chunks: number): void {
      const chunk = `${'x'.repeat(999)}\n`;
      for (let i = 0; i < chunks; i++) {
        store.onAgentOutput({
          agentId,
          stdoutDelta: i === 0 ? `first line of output\n${chunk}` : chunk,
        } as AgentOutputDelta);
      }
    }

    it('renders a truncation notice at the head of the output', () => {
      spawn('noisy', 'ptah-cli');
      pushStdout('noisy', 80);

      const rendered = parseAgentOutput(agentOf('noisy').stdout);

      // First thing on the card, and an `info` block — not prose the agent
      // wrote, and not an error.
      expect(rendered[0].type).toBe('info');
      expect(rendered[0].content).toMatch(
        /^… \d+ characters of earlier output were dropped to bound this card\.$/,
      );
      expect(renderedText(rendered)).toContain(
        'characters of earlier output were dropped',
      );
    });

    it('the dropped output really is gone — the notice is not decoration', () => {
      spawn('noisy', 'ptah-cli');
      pushStdout('noisy', 80);

      // Proves the notice is reporting a real loss, so a user reading the card
      // knows the head of the transcript is missing rather than empty.
      expect(agentOf('noisy').stdout).not.toContain('first line of output');
    });

    it('the notice on stderr is informational, not an error', () => {
      spawn('noisy', 'ptah-cli');
      const chunk = `${'e'.repeat(999)}\n`;
      for (let i = 0; i < 80; i++) {
        store.onAgentOutput({
          agentId: 'noisy',
          stderrDelta: chunk,
        } as AgentOutputDelta);
      }

      const [first] = parseStderr(agentOf('noisy').stderr);
      expect(first.type).toBe('info');
      expect(first.content).toContain(
        'characters of earlier output were dropped',
      );
    });
  });
});
