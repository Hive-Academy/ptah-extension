import { outcomeRow, heldReport } from '../store/store.test-support';
import { deliverablesVerdictOf, reportEffectOf } from './report-effect';

describe('reportEffectOf', () => {
  const check = { exists: true, bytes: 1, mtimeMs: 100 };
  it.each([
    ['no checks', [], 100, 'unverified'],
    ['all delivered', [check], 100, 'delivered'],
    ['zero bytes', [{ ...check, bytes: 0 }], 100, 'no-deliverable'],
    ['missing file', [{ ...check, exists: false }], 100, 'no-deliverable'],
    ['old mtime', [{ ...check, mtimeMs: 99 }], 100, 'no-deliverable'],
    ['null mtime', [{ ...check, mtimeMs: null }], 100, 'delivered'],
    ['null start', [{ ...check, mtimeMs: 99 }], null, 'delivered'],
  ] as const)('%s verdict parity', (_name, checks, startedAt, expected) => {
    expect(deliverablesVerdictOf(checks, startedAt)).toBe(expected);
  });

  it('rejects bad JSON and extra paths without throwing', () => {
    const row = { ...outcomeRow('subagent:a'), budgetStopped: false };
    const report = heldReport(1, 100);
    expect(reportEffectOf(row, { ...report, payload: '{' })).toBeNull();
    expect(
      reportEffectOf(row, {
        ...report,
        payload: JSON.stringify({ checks: [], paths: ['/secret'] }),
      }),
    ).toBeNull();
    expect(
      reportEffectOf(row, {
        ...report,
        payload: JSON.stringify({
          checks: [{ exists: true, bytes: -1, mtimeMs: 100 }],
        }),
      }),
    ).toBeNull();
  });
});
