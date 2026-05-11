import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for messaging gateway settings.
 *
 * TODO(Phase 3+): Expose handles for gateway.telegram.*, gateway.discord.*,
 * gateway.slack.*, gateway.voice.*, and gateway.enabled when the migration of
 * these keys is scoped. Token cipher handles should use the secret scope
 * (readSecret/writeSecret) rather than readGlobal.
 */
export class GatewaySettings extends BaseSettingsRepository {
  constructor(store: ISettingsStore) {
    super(store);
  }
}
