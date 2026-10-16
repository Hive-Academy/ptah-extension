import type { VoiceProviderConfigDto } from '@ptah-extension/shared';
import type {
  CommandProviderDirection,
  CommandProviderReadiness,
} from './command-center.store';

/** Same provider, model and status labels as Settings > Voice (`voice-config.component.ts`). */
function providerDirection(
  config: VoiceProviderConfigDto,
  direction: 'stt' | 'tts',
): CommandProviderDirection {
  const configured =
    direction === 'stt' ? config.sttProvider : config.ttsProvider;
  const providerId = configured === 'elevenlabs' ? 'elevenlabs' : 'local';
  const ready =
    providerId === 'elevenlabs'
      ? config.elevenlabs.apiKeyConfigured
      : direction === 'stt'
        ? config.local.sttDownloaded
        : config.local.ttsDownloaded;
  const { modelSource, customModel, whisperModel, ttsVoice } = config.local;
  const localModel =
    modelSource === 'curated'
      ? whisperModel
      : (customModel ??
        (modelSource === 'hf'
          ? 'No Hugging Face model set'
          : 'No model folder set'));
  const modelLabel =
    providerId === 'local'
      ? direction === 'stt'
        ? localModel
        : ttsVoice
      : direction === 'stt'
        ? config.elevenlabs.sttModelId
        : 'ElevenLabs voice';
  return {
    providerId,
    providerLabel: providerId === 'local' ? 'Local' : 'ElevenLabs',
    modelLabel,
    ready,
    status: ready
      ? 'Ready'
      : providerId === 'local'
        ? 'Not downloaded'
        : 'No key',
  };
}

/** Provider state for the page; `null` (no config) means voice is unavailable. */
export function summarizeVoiceProviders(
  config: VoiceProviderConfigDto | null,
): CommandProviderReadiness {
  if (!config)
    return { transcription: false, synthesis: false, stt: null, tts: null };
  const stt = providerDirection(config, 'stt');
  const tts = providerDirection(config, 'tts');
  return { transcription: stt.ready, synthesis: tts.ready, stt, tts };
}
