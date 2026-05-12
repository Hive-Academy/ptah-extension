import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for memory curator settings.
 *
 * TODO(Phase 3+): Expose handles for memory.curatorEnabled, memory.tierLimits.*,
 * memory.decayHalflifeDays, memory.embeddingModel, memory.curatorModel,
 * memory.searchTopK, memory.searchAlpha when the migration of these keys is scoped.
 */
export class MemorySettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
