/**
 * VoiceProviderSelector — resolves the settings-selected provider
 * (`voice.ttsProvider` / `voice.sttProvider`, default `'local'`) to the active
 * port and persists one-click provider switches (FR-7.2/7.4). Selecting an
 * unavailable provider throws `VoiceProviderError` at call time.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VoiceProviderError,
  VOICE_CONTRACT_TOKENS,
  type ISpeechToTextProvider,
  type ITextToSpeechProvider,
  type IVoiceDownloadEventSource,
  type IVoiceProviderRegistry,
  type IVoiceProviderSelector,
  type VoiceDirection,
  type VoiceProviderId,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from './di/tokens';

const TTS_PROVIDER_KEY = 'voice.ttsProvider';
const STT_PROVIDER_KEY = 'voice.sttProvider';
const DEFAULT_PROVIDER: VoiceProviderId = 'local';

@injectable()
export class VoiceProviderSelector implements IVoiceProviderSelector {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_REGISTRY)
    private readonly registry: IVoiceProviderRegistry,
    @inject(VOICE_TOKENS.VOICE_WORKER_CLIENT)
    readonly downloadEvents: IVoiceDownloadEventSource,
  ) {}

  activeProviderId(direction: VoiceDirection): VoiceProviderId {
    const key = direction === 'tts' ? TTS_PROVIDER_KEY : STT_PROVIDER_KEY;
    const value = this.workspace.getConfiguration<string>(
      'ptah',
      key,
      DEFAULT_PROVIDER,
    );
    return value === 'elevenlabs' ? 'elevenlabs' : 'local';
  }

  activeTts(): ITextToSpeechProvider {
    const id = this.activeProviderId('tts');
    const provider = this.registry.getTts(id);
    this.assertAvailable(id, provider.capability.available);
    return provider;
  }

  activeStt(): ISpeechToTextProvider {
    const id = this.activeProviderId('stt');
    const provider = this.registry.getStt(id);
    this.assertAvailable(id, provider.capability.available);
    return provider;
  }

  async setProvider(
    direction: VoiceDirection,
    id: VoiceProviderId,
  ): Promise<void> {
    const key = direction === 'tts' ? TTS_PROVIDER_KEY : STT_PROVIDER_KEY;
    await this.writeConfiguration(key, id);
    this.logger.info('[voice-providers] provider switched', { direction, id });
  }

  private assertAvailable(id: VoiceProviderId, available: boolean): void {
    if (!available) {
      throw new VoiceProviderError(
        'provider-error',
        id,
        `The "${id}" voice provider is not available on this runtime.`,
      );
    }
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
        '[voice-providers] setConfiguration unavailable; skipping backend write',
        { key },
      );
    }
  }
}
