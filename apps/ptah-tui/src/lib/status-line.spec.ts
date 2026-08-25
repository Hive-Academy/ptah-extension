import {
  deriveStatusLine,
  formatElapsed,
  formatTokenCount,
  type StatusLineInput,
} from './status-line.js';

const base: StatusLineInput = {
  activeSessionId: null,
  hasConversation: false,
  isStreaming: false,
  mode: 'build',
};

describe('deriveStatusLine — session label', () => {
  it('says "No session" only on a genuine cold start', () => {
    expect(deriveStatusLine(base).session).toEqual({
      label: 'No session',
      active: false,
    });
  });

  it('never says "No session" once a conversation exists', () => {
    const model = deriveStatusLine({ ...base, hasConversation: true });
    expect(model.session.label).not.toBe('No session');
    expect(model.session).toEqual({ label: 'New session', active: true });
  });

  it('never says "No session" while streaming', () => {
    const model = deriveStatusLine({ ...base, isStreaming: true });
    expect(model.session.label).not.toBe('No session');
  });

  it('falls back to a shortened id when the session has no name yet', () => {
    const model = deriveStatusLine({
      ...base,
      activeSessionId: 'abcdef01-2345-6789-abcd-ef0123456789',
      hasConversation: true,
    });
    expect(model.session.label).toBe('Session abcdef01');
  });

  it('prefers a real session name', () => {
    const model = deriveStatusLine({
      ...base,
      activeSessionId: 'abcdef01',
      sessionName: 'Refactor the parser',
    });
    expect(model.session.label).toBe('Refactor the parser');
  });

  it('ignores a blank session name rather than rendering an empty field', () => {
    const model = deriveStatusLine({
      ...base,
      activeSessionId: 'abcdef01',
      sessionName: '   ',
    });
    expect(model.session.label).toBe('Session abcdef01');
  });
});

describe('deriveStatusLine — derived fields', () => {
  const stats = {
    inputTokens: 12_400,
    outputTokens: 800,
    costUSD: 1.5,
    contextUsagePercent: 65,
    model: 'claude-opus-4',
  };

  it('reports tokens, cost tone and context tone together', () => {
    const model = deriveStatusLine({
      ...base,
      activeSessionId: 's1',
      hasConversation: true,
      stats,
    });
    expect(model.tokens).toBe('12.4k/800');
    expect(model.cost).toEqual({ label: '$1.50', tone: 'warn' });
    expect(model.context).toEqual({ percent: 65, tone: 'warn', full: false });
    expect(model.model).toBe('claude-opus-4');
  });

  it('escalates the context tone past 80% and flags 90%+ as full', () => {
    const high = deriveStatusLine({
      ...base,
      stats: { ...stats, contextUsagePercent: 95 },
    });
    expect(high.context).toEqual({ percent: 95, tone: 'error', full: true });
  });

  it('hides cost and context entirely when there is nothing to report', () => {
    const model = deriveStatusLine({
      ...base,
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
        contextUsagePercent: 0,
      },
    });
    expect(model.tokens).toBeNull();
    expect(model.cost).toBeNull();
    expect(model.context).toBeNull();
  });

  it('uses the fallback model only when stats carry none', () => {
    expect(deriveStatusLine({ ...base, fallbackModel: 'sonnet' }).model).toBe(
      'sonnet',
    );
    expect(
      deriveStatusLine({ ...base, fallbackModel: 'sonnet', stats }).model,
    ).toBe('claude-opus-4');
  });

  it('reports activity with elapsed time only while streaming', () => {
    expect(deriveStatusLine(base).activity).toBeNull();
    expect(
      deriveStatusLine({ ...base, isStreaming: true, elapsedMs: 75_000 })
        .activity,
    ).toEqual({ label: 'working', elapsed: '1m 15s' });
  });

  it('carries the mode through', () => {
    expect(deriveStatusLine({ ...base, mode: 'plan' }).mode).toEqual({
      label: 'plan',
      plan: true,
    });
  });
});

describe('formatters', () => {
  it('abbreviates token counts', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1500)).toBe('1.5k');
    expect(formatTokenCount(2_400_000)).toBe('2.4M');
  });

  it('formats elapsed time in escalating units', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9_400)).toBe('9s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(3_723_000)).toBe('1h 02m');
  });
});
