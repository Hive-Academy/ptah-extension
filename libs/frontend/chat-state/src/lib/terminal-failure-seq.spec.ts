import type { TabState } from '@ptah-extension/chat-types';
import { withTerminalFailureSeq } from './terminal-failure-seq';

describe('withTerminalFailureSeq', () => {
  const tab = (reason?: TabState['lastTerminalReason'], seq?: number) =>
    ({ lastTerminalReason: reason, terminalFailureSeq: seq }) as TabState;

  it('advances when stamping over a cleared reason', () => {
    expect(withTerminalFailureSeq(tab(undefined), { lastTerminalReason: 'completed' }))
      .toEqual({ lastTerminalReason: 'completed', terminalFailureSeq: 1 });
  });

  it('returns the same update for a duplicate reason', () => {
    const updates = { lastTerminalReason: 'completed' as const };
    expect(withTerminalFailureSeq(tab('completed', 1), updates)).toBe(updates);
  });

  it('advances when the reason changes', () => {
    expect(withTerminalFailureSeq(tab('completed', 1), { lastTerminalReason: 'api_error' }))
      .toEqual({ lastTerminalReason: 'api_error', terminalFailureSeq: 2 });
  });

  it.each([null, undefined])('does not advance for %s', (reason) => {
    const updates = { lastTerminalReason: reason };
    expect(withTerminalFailureSeq(tab('completed', 1), updates)).toBe(updates);
  });

  it('returns the same update when the reason key is absent', () => {
    const updates = { status: 'loaded' as const };
    expect(withTerminalFailureSeq(tab(undefined, 1), updates)).toBe(updates);
  });
});
