import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for memory curator settings.
 */
export class MemorySettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
