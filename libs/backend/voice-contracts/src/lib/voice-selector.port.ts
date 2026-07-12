import type { IVoiceDownloadEventSource } from './voice-events.port';
import type { ISpeechToTextProvider } from './stt-provider.port';
import type { ITextToSpeechProvider } from './tts-provider.port';
import type {
  VoiceDirection,
  VoiceProviderCapability,
  VoiceProviderId,
} from './voice-provider.types';

/**
 * Registry of all constructed provider adapters. Exposes per-provider
 * capability descriptors and resolves a provider port by id.
 */
export interface IVoiceProviderRegistry {
  listProviders(): readonly VoiceProviderCapability[];
  /** @throws VoiceProviderError('provider-error') when the id is unknown. */
  getTts(id: VoiceProviderId): ITextToSpeechProvider;
  /** @throws VoiceProviderError('provider-error') when the id is unknown. */
  getStt(id: VoiceProviderId): ISpeechToTextProvider;
}

/**
 * Resolves the settings-selected provider (`voice.ttsProvider` /
 * `voice.sttProvider`, default `'local'`) to the active port, and persists
 * one-click provider switches (FR-7.2/7.4).
 */
export interface IVoiceProviderSelector {
  /** Resolves settings `voice.ttsProvider` (default 'local') to the active port. */
  activeTts(): ITextToSpeechProvider;
  /** Resolves settings `voice.sttProvider` (default 'local') to the active port. */
  activeStt(): ISpeechToTextProvider;
  activeProviderId(direction: VoiceDirection): VoiceProviderId;
  /** FR-7.2/7.4 one-click switch: persists the setting. */
  setProvider(direction: VoiceDirection, id: VoiceProviderId): Promise<void>;
  /** Download event surface of the local providers (progress bridging). */
  readonly downloadEvents: IVoiceDownloadEventSource;
}
