import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';
import type { SecretHandle } from './secret-handle';

/**
 * Typed accessor for messaging gateway settings.
 *
 * Token ciphers are accessed via SecretHandle, which routes through the
 * ISettingsStore secret methods (readSecret / writeSecret / deleteSecret).
 * The ISettingsStore adapter performs AES-256-GCM encryption transparently.
 *
 * Note on naming: the gateway service stores the vault cipher
 * (an application-layer-encrypted string) using these keys. The adapter
 * layer adds envelope encryption on top, so the values stored via
 * these handles are the vault ciphers (the caller is still responsible for
 * ITokenVault.encrypt/decrypt). Two-layer encryption is intentional.
 */
export class GatewaySettings extends BaseSettingsRepository {
  /** Encrypted Telegram bot token (vault cipher wrapped in AES-256-GCM envelope). */
  readonly telegramTokenCipher: SecretHandle;

  /** Encrypted Discord bot token (vault cipher wrapped in AES-256-GCM envelope). */
  readonly discordTokenCipher: SecretHandle;

  /**
   * Encrypted Slack bot token.
   * Slack uses two tokens: a bot token for API calls and an app token for Socket Mode.
   */
  readonly slackBotTokenCipher: SecretHandle;

  /** Encrypted Slack app token (Socket Mode). */
  readonly slackAppTokenCipher: SecretHandle;

  constructor(store: ISettingsStore) {
    super(store);
    this.telegramTokenCipher = this.secretHandleFor(
      'gateway.telegram.tokenCipher',
    );
    this.discordTokenCipher = this.secretHandleFor(
      'gateway.discord.tokenCipher',
    );
    this.slackBotTokenCipher = this.secretHandleFor(
      'gateway.slack.botTokenCipher',
    );
    this.slackAppTokenCipher = this.secretHandleFor(
      'gateway.slack.appTokenCipher',
    );
  }

  // ---------------------------------------------------------------------------
  // Internal factory
  // ---------------------------------------------------------------------------

  private secretHandleFor(key: string): SecretHandle {
    const store = this.store;
    return {
      get(): Promise<string | undefined> {
        return store.readSecret(key);
      },
      set(value: string): Promise<void> {
        return store.writeSecret(key, value);
      },
      delete(): Promise<void> {
        return store.deleteSecret(key);
      },
    };
  }
}
