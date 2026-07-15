import type {
  SynthesizeRequest,
  SynthesizeResult,
  VoiceInfo,
  VoiceProviderCapability,
  VoiceReadiness,
} from './voice-provider.types';

/**
 * Text-to-speech provider port. Implemented by the local Kokoro adapter and
 * the ElevenLabs cloud adapter (both in `voice-providers`).
 */
export interface ITextToSpeechProvider {
  readonly capability: VoiceProviderCapability;
  isReady(): Promise<VoiceReadiness>;
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>;
  /** Cloud providers list account voices; local providers return the curated set. */
  listVoices(): Promise<readonly VoiceInfo[]>;
  /** Local only: eagerly pull model assets. No-op (`{alreadyPresent:true}`) for cloud. */
  downloadModel(): Promise<{ alreadyPresent: boolean }>;
}
