import type { SessionStatsEntry } from '@ptah-extension/shared';
import {
  SessionStatsRevisionFloor,
  isValidSessionStatsSnapshot,
} from './session-stats-snapshot';

/** A well-formed backend session snapshot at `revision`. */
function snapshot(
  revision: number | undefined,
  overrides: Partial<SessionStatsEntry> = {},
): SessionStatsEntry {
  return {
    sessionId: 's1',
    model: 'claude-opus-5',
    totalCost: 1,
    tokens: { input: 100, output: 10, cacheRead: 1000, cacheCreation: 1 },
    messageCount: 1,
    status: 'ok',
    revision,
    ...overrides,
  };
}

describe('isValidSessionStatsSnapshot', () => {
  it('accepts a snapshot without turnCount from an older host', () => {
    expect(isValidSessionStatsSnapshot(snapshot(1))).toBe(true);
  });

  it.each([0, 2])('accepts turnCount: %p', (turnCount) => {
    expect(isValidSessionStatsSnapshot(snapshot(1, { turnCount }))).toBe(true);
  });

  it.each([-1, 1.5, Infinity, NaN, '2'])(
    'rejects turnCount: %p',
    (turnCount) => {
      expect(isValidSessionStatsSnapshot({ ...snapshot(1), turnCount })).toBe(
        false,
      );
    },
  );

  it('accepts a snapshot without a provisional flag', () => {
    expect(isValidSessionStatsSnapshot(snapshot(1))).toBe(true);
  });

  it.each([true, false])('accepts provisional: %p', (provisional) => {
    expect(isValidSessionStatsSnapshot(snapshot(1, { provisional }))).toBe(
      true,
    );
  });

  it.each(['yes', 1, null, {}])('rejects provisional: %p', (provisional) => {
    expect(
      isValidSessionStatsSnapshot({ ...snapshot(1), provisional }),
    ).toBe(false);
  });
});

describe('SessionStatsRevisionFloor with live snapshots', () => {
  it('admits a live revision, then after authoritative r+1 rejects a later live r-1', () => {
    const floor = new SessionStatsRevisionFloor();

    expect(floor.admit(snapshot(5, { provisional: true }))).toBe(true);
    expect(floor.admit(snapshot(6))).toBe(true);
    expect(floor.admit(snapshot(4, { provisional: true }))).toBe(false);
  });
});
