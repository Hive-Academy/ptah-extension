/**
 * VoiceSecretStore — vault-backed API-key store for cloud providers. Persists
 * ciphertext only (`voice.elevenlabs.apiKeyCipher`) in `~/.ptah/settings.json`
 * via `IWorkspaceProvider` + `IVoiceTokenVault`.
 *
 * SECURITY: plaintext is NEVER logged and NEVER returned by any getter reachable
 * from RPC. A decrypt failure returns `null` so callers surface an `auth`
 * "re-enter your API key" remediation rather than crashing.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VOICE_CONTRACT_TOKENS,
  type IVoiceTokenVault,
  type VoiceProviderId,
} from '@ptah-extension/voice-contracts';

/** Settings key holding the ciphertext for each cloud provider's API key. */
const CIPHER_KEYS: Partial<Record<VoiceProviderId, string>> = {
  elevenlabs: 'voice.elevenlabs.apiKeyCipher',
};

@injectable()
export class VoiceSecretStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT, { isOptional: true })
    private readonly vault: IVoiceTokenVault | null = null,
  ) {}

  /** Whether a ciphertext is stored for the provider (does not decrypt). */
  isConfigured(providerId: VoiceProviderId): boolean {
    return this.readCipher(providerId).length > 0;
  }

  /**
   * Decrypted plaintext key, or `null` when unconfigured, when no vault is
   * available, or when decryption fails (surface as `auth`/re-enter-key).
   * Never logged.
   */
  getKey(providerId: VoiceProviderId): string | null {
    const cipher = this.readCipher(providerId);
    if (cipher.length === 0) return null;
    if (!this.vault) return null;
    try {
      return this.vault.decrypt(cipher);
    } catch (error: unknown) {
      this.logger.warn('[voice-providers] secret decrypt failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Encrypt + persist. An empty plaintext clears the stored key. */
  async setKey(providerId: VoiceProviderId, plaintext: string): Promise<void> {
    if (plaintext.length === 0) {
      await this.clearKey(providerId);
      return;
    }
    const key = CIPHER_KEYS[providerId];
    if (!key) {
      throw new Error(`Provider "${providerId}" does not store an API key.`);
    }
    if (!this.vault) {
      throw new Error(
        'Secret storage is unavailable on this runtime (no token vault).',
      );
    }
    const cipher = this.vault.encrypt(plaintext);
    await this.writeConfiguration(key, cipher);
    this.logger.info('[voice-providers] api key stored', { providerId });
  }

  async clearKey(providerId: VoiceProviderId): Promise<void> {
    const key = CIPHER_KEYS[providerId];
    if (!key) return;
    await this.writeConfiguration(key, '');
    this.logger.info('[voice-providers] api key cleared', { providerId });
  }

  private readCipher(providerId: VoiceProviderId): string {
    const key = CIPHER_KEYS[providerId];
    if (!key) return '';
    const value = this.workspace.getConfiguration<string>('ptah', key, '');
    return typeof value === 'string' ? value : '';
  }

  private async writeConfiguration(key: string, value: unknown): Promise<void> {
    const provider = this.workspace as unknown as {
      setConfiguration?: (
        section: string,
        key: string,
        value: unknown,
      ) => Promise<void>;
    };
    if (typeof provider.setConfiguration === 'function') {
      await provider.setConfiguration('ptah', key, value);
    } else {
      this.logger.debug(
        '[voice-providers] setConfiguration unavailable; skipping secret write',
        { key },
      );
    }
  }
}
