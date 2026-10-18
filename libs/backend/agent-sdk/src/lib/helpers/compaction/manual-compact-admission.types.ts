import type { CompactionCoordinator } from './compaction-coordinator';

/** Port the router injects for manual compact admission. */
export type ManualCompactAdmission = Pick<
  CompactionCoordinator,
  'requestManualCompact' | 'admitManualCompact' | 'releaseManualReservation'
>;
