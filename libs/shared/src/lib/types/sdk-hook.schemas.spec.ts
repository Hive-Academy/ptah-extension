import { SessionTurnStateSchema } from './sdk-hook.schemas';

describe('SessionTurnStateSchema', () => {
  const valid = {
    phase: 'awaiting-background',
    revision: 3,
    backgroundTasks: [
      { id: 'bg-1', type: 'agent', status: 'running', description: 'x' },
    ],
    sessionCrons: [],
    terminalReason: 'completed',
    timestamp: 1_700_000_000_000,
  };

  it('accepts a valid turn state', () => {
    const result = SessionTurnStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts an optional error for a failed turn', () => {
    const result = SessionTurnStateSchema.safeParse({
      ...valid,
      phase: 'failed',
      error: 'rate_limit',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown phase', () => {
    const result = SessionTurnStateSchema.safeParse({
      ...valid,
      phase: 'bogus',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative revision', () => {
    const result = SessionTurnStateSchema.safeParse({
      ...valid,
      revision: -1,
    });
    expect(result.success).toBe(false);
  });
});
