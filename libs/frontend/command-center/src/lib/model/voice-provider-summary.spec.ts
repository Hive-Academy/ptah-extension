import type { VoiceProviderConfigDto } from '@ptah-extension/shared';
import { summarizeVoiceProviders } from './voice-provider-summary';

describe('summarizeVoiceProviders', () => {
  const config: VoiceProviderConfigDto = {
    sttProvider: 'local',
    ttsProvider: 'elevenlabs',
    local: {
      modelSource: 'curated',
      whisperModel: 'whisper-base',
      sttDownloaded: true,
      ttsDownloaded: true,
      ttsVoice: 'af_heart',
    },
    elevenlabs: {
      apiKeyConfigured: true,
      voiceId: '',
      sttModelId: 'scribe_v1',
      ttsModelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3',
    },
  };

  it('shows no voice chosen when the ElevenLabs voice id is empty', () => {
    const summary = summarizeVoiceProviders(config);
    expect(summary.tts?.modelLabel).toBe('No voice chosen');
    expect(summary.tts?.status).toBe('Ready');
    expect(summary.stt?.providerLabel).toBe('Local');
  });

  it('keeps the short voice label when an ElevenLabs voice is chosen', () => {
    expect(
      summarizeVoiceProviders({
        ...config,
        elevenlabs: { ...config.elevenlabs, voiceId: 'voice-1' },
      }).tts?.modelLabel,
    ).toBe('ElevenLabs voice');
  });

  it('clears both directions when config is unavailable', () => {
    expect(summarizeVoiceProviders(null)).toEqual({
      transcription: false,
      synthesis: false,
      stt: null,
      tts: null,
    });
  });
});
