import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type { CliOutputSegment } from '@ptah-extension/shared';
import { CliAgentOutputComponent } from './cli-agent-output.component';
import { extractCliAgentStats } from './stats-bar.utils';

/** Codex adapter shape: content and typed usage always carry both counts. */
function codexTurn(input: number, output: number): CliOutputSegment {
  return {
    type: 'info',
    content: `Usage: ${input} input, ${output} output tokens`,
    usage: { inputTokens: input, outputTokens: output },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('typed usage accumulation contract', () => {
  it('accumulates adapter-shaped multi-turn token counts', () => {
    const segments = [codexTurn(100, 50), codexTurn(200, 30)];
    const now = extractCliAgentStats(segments);
    expect(now).toEqual({ inputTokens: 300, outputTokens: 80 });
  });

  it('preserves accumulated counts when the next turn reports zero', () => {
    const segments = [codexTurn(100, 50), codexTurn(0, 0)];
    expect(extractCliAgentStats(segments)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it('keeps the latest reported model, cost and duration', () => {
    const segments: CliOutputSegment[] = [
      {
        type: 'info',
        content:
          'Usage: model: first-model, 100 input, 50 output, $0.1000, 1.5s',
        usage: {
          model: 'first-model',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.1,
          durationMs: 1500,
        },
      },
      {
        type: 'info',
        content:
          'Usage: model: latest-model, 10 input, 5 output, $0.0200, 0.5s',
        usage: {
          model: 'latest-model',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.02,
          durationMs: 500,
        },
      },
    ];
    const now = extractCliAgentStats(segments);
    expect(now).toEqual({
      model: 'latest-model',
      inputTokens: 110,
      outputTokens: 55,
      durationMs: 500,
      costUsd: 0.02,
    });
  });

  it('accumulates one-sided turns without inventing missing values', () => {
    // Copilot can emit this shape: data carries outputTokens only, so the
    // adapter's typed usage has inputTokens undefined (copilot-sdk.adapter.ts:708).
    const segments: CliOutputSegment[] = [
      {
        type: 'info',
        content: 'Usage: 100 input, 50 output, $0.1000',
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.1 },
      },
      {
        type: 'info',
        content: 'Usage: 25 output',
        usage: { outputTokens: 25 },
      },
    ];
    expect(extractCliAgentStats(segments)).toEqual({
      inputTokens: 100,
      outputTokens: 75,
      costUsd: 0.1,
    });
  });

  it('renders reported totals separately without adding split counts to them', () => {
    // Turn 1 reports total only; turn 2 reports a split AND its own total.
    const segments: CliOutputSegment[] = [
      {
        type: 'info',
        content: 'Usage: 1000 total tokens',
        usage: { totalTokens: 1000 },
      },
      {
        type: 'info',
        content: 'Usage: 400 input, 100 output tokens',
        usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 },
      },
    ];
    const stats = extractCliAgentStats(segments);
    expect(stats).toEqual({
      totalTokens: 1500,
      inputTokens: 400,
      outputTokens: 100,
    });

    TestBed.configureTestingModule({
      imports: [CliAgentOutputComponent],
      providers: [
        provideMarkdown(),
        { provide: AgentMonitorStore, useValue: { tick: signal(0) } },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(CliAgentOutputComponent);
    fixture.componentRef.setInput('agentId', 'double-count-check');
    fixture.componentRef.setInput('segments', segments);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    // The split is shown once, each side once:
    expect(text).toContain('↑ 400');
    expect(text).toContain('↓ 100');
    expect(text).toContain('Reported total: 1.5k tokens');
    expect(text).not.toContain('2.0k');
  });
});
