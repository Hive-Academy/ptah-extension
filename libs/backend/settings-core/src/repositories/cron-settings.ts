import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for cron scheduler settings.
 */
export class CronSettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
