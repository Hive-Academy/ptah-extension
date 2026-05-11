import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
} from '../schema/auth-schema';
import type { SettingHandle } from './setting-handle';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for authentication settings.
 *
 * Usage:
 *   const auth = container.resolve<AuthSettings>(SETTINGS_TOKENS.AUTH_SETTINGS);
 *   const method = auth.authMethod.get();           // 'apiKey' | 'claudeCli' | 'thirdParty'
 *   await auth.authMethod.set('thirdParty');
 */
export class AuthSettings extends BaseSettingsRepository {
  /** Which authentication method is active. */
  readonly authMethod: SettingHandle<'apiKey' | 'claudeCli' | 'thirdParty'>;

  /** Selected Anthropic-compatible provider id (relevant when authMethod = 'thirdParty'). */
  readonly anthropicProviderId: SettingHandle<string>;

  constructor(store: ISettingsStore) {
    super(store);
    this.authMethod = this.handleFor(AUTH_METHOD_DEF);
    this.anthropicProviderId = this.handleFor(ANTHROPIC_PROVIDER_ID_DEF);
  }
}
