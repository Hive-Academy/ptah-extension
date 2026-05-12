import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for skill synthesis settings.
 *
 * TODO(Phase 3+): Expose handles for skillSynthesis.enabled,
 * skillSynthesis.successesToPromote, skillSynthesis.dedupCosineThreshold,
 * and the other skill synthesis keys when the migration is scoped.
 */
export class SkillSynthesisSettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
