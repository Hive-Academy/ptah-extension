import { agentRunDurationMs, agentRunLabel } from './agent-duration';

describe('agent run duration', () => {
  it('uses the current clock only for running runs', () => {
    const run = { running: true, startedAt: 1_000 };
    expect(agentRunDurationMs(run, 3_500)).toBe(2_500);
    expect(agentRunLabel(run, 3_500)).toBe('Working · 2s');
    expect(agentRunLabel(run, 1_500)).toBe('Working');
  });

  it('uses both endpoints for a finished run', () => {
    const run = { running: false, startedAt: 1_000, endedAt: 4_500, reportedMs: 9_000 };
    expect(agentRunDurationMs(run, 1_000_000)).toBe(3_500);
    expect(agentRunLabel(run, 1_000_000)).toBe('Worked for 3s');
  });

  it('uses reported duration when the finish time is absent', () => {
    expect(agentRunLabel({ running: false, startedAt: 1, reportedMs: 2_000 }, 1_000_000)).toBe('Worked for 2s');
    expect(agentRunLabel({ running: false, startedAt: 1 }, 1_000_000)).toBe('Worked');
  });

  it('hides subsecond, negative and non-finite values', () => {
    expect(agentRunDurationMs({ running: false, reportedMs: 999 }, 0)).toBe(999);
    expect(agentRunLabel({ running: false, reportedMs: 999 }, 0)).toBe('Worked');
    expect(agentRunDurationMs({ running: true, startedAt: 2_000 }, 1_000)).toBeNull();
    expect(agentRunDurationMs({ running: false, reportedMs: Infinity }, 0)).toBeNull();
    expect(agentRunDurationMs({ running: false, startedAt: NaN, endedAt: 2_000 }, 0)).toBeNull();
  });
});
