import type {
  PlanLimitWindow,
  ProviderAccountUsageStatus,
} from '@ptah-extension/shared';
import { snapshotWindowsForStatus } from './plan-snapshot-windows';

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const plain: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  observedAt: T0,
};
const exhausted: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour',
  observedAt: T0,
  exhaustion: { observedAt: T0, source: 'error-derived' },
};
const ledger = [plain, exhausted];

describe('snapshotWindowsForStatus', () => {
  it.each<ProviderAccountUsageStatus>([
    'available',
    'stale',
    'service-unavailable',
  ])('%s keeps every ledger window', (status) => {
    expect(snapshotWindowsForStatus(status, ledger)).toEqual(ledger);
  });

  it.each<ProviderAccountUsageStatus>([
    'no-usage-source',
    'provider-unsupported',
    'cli-unavailable',
    'cli-version-unsupported',
  ])('%s keeps only windows with exhaustion evidence', (status) => {
    expect(snapshotWindowsForStatus(status, ledger)).toEqual([exhausted]);
  });

  it.each<ProviderAccountUsageStatus>([
    'unsupported-auth',
    'unsupported-config',
  ])('%s keeps no windows', (status) => {
    expect(snapshotWindowsForStatus(status, ledger)).toEqual([]);
  });

  it('returns a new array the caller may own', () => {
    const result = snapshotWindowsForStatus('available', ledger);
    expect(result).not.toBe(ledger);
  });
});
