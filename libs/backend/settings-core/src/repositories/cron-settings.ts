import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for cron scheduler settings.
 *
 * TODO(Phase 3+): Expose handles for cron.enabled, cron.maxConcurrentJobs,
 * and cron.catchupWindowMs when the migration of these keys is scoped.
 */
export class CronSettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
