import type {
  TranscribeRequest,
  TranscribeResult,
  VoiceProviderCapability,
  VoiceReadiness,
} from './voice-provider.types';

/**
 * Speech-to-text provider port. Implemented by the local Whisper adapter and
 * the ElevenLabs (Scribe) cloud adapter (both in `voice-providers`).
 */
export interface ISpeechToTextProvider {
  readonly capability: VoiceProviderCapability;
  isReady(): Promise<VoiceReadiness>;
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
  /** Local only: eagerly pull model assets. No-op (`{alreadyPresent:true}`) for cloud. */
  downloadModel(model?: string): Promise<{ alreadyPresent: boolean }>;
}
