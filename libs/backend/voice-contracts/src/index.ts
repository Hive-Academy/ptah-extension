export type {
  VoiceProviderId,
  VoiceDirection,
  VoiceProviderCapability,
  VoiceModelSpec,
  SynthesizeRequest,
  SynthesizeResult,
  TranscribeRequest,
  TranscribeResult,
  VoiceInfo,
  VoiceReadiness,
} from './lib/voice-provider.types';
export type { ITextToSpeechProvider } from './lib/tts-provider.port';
export type { ISpeechToTextProvider } from './lib/stt-provider.port';
export type {
  VoiceDownloadEvent,
  VoiceEventDisposable,
  IVoiceDownloadEventSource,
} from './lib/voice-events.port';
export type {
  IVoiceProviderRegistry,
  IVoiceProviderSelector,
} from './lib/voice-selector.port';
export type { IVoiceTokenVault } from './lib/voice-token-vault.port';
export {
  VoiceProviderError,
  isVoiceProviderError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
} from './lib/voice-provider-error';
export type { VoiceErrorCategory } from './lib/voice-provider-error';
export { VOICE_CONTRACT_TOKENS } from './lib/tokens';
