import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for per-provider settings (model tiers, base URLs, etc.).
 */
export class ProviderSettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
