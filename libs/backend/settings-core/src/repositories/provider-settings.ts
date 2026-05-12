import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for per-provider settings (model tiers, base URLs, etc.).
 *
 * TODO(Phase 3+): Expose handles for provider.*.modelTier.{opus,sonnet,haiku}
 * and provider.*.baseUrl when the migration of these keys to settings-core is scoped.
 * Reference keys are in libs/backend/platform-core/src/file-settings-keys.ts
 * under the "Provider: *" sections.
 */
export class ProviderSettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
