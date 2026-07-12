/**
 * VoiceProviderRegistry — collects the constructed provider adapters and
 * resolves a provider port by id. ElevenLabs adapters are optional (wired in a
 * later batch); until then only `local` resolves.
 */
import { inject, injectable } from 'tsyringe';
import {
  VoiceProviderError,
  type ISpeechToTextProvider,
  type ITextToSpeechProvider,
  type IVoiceProviderRegistry,
  type VoiceProviderCapability,
  type VoiceProviderId,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from './di/tokens';

@injectable()
export class VoiceProviderRegistry implements IVoiceProviderRegistry {
  constructor(
    @inject(VOICE_TOKENS.LOCAL_TTS_PROVIDER)
    private readonly localTts: ITextToSpeechProvider,
    @inject(VOICE_TOKENS.LOCAL_STT_PROVIDER)
    private readonly localStt: ISpeechToTextProvider,
    @inject(VOICE_TOKENS.ELEVENLABS_TTS_PROVIDER, { isOptional: true })
    private readonly elevenTts: ITextToSpeechProvider | null = null,
    @inject(VOICE_TOKENS.ELEVENLABS_STT_PROVIDER, { isOptional: true })
    private readonly elevenStt: ISpeechToTextProvider | null = null,
  ) {}

  listProviders(): readonly VoiceProviderCapability[] {
    const providers: VoiceProviderCapability[] = [
      this.mergeCapability(this.localTts.capability, this.localStt.capability),
    ];
    if (this.elevenTts && this.elevenStt) {
      providers.push(
        this.mergeCapability(
          this.elevenTts.capability,
          this.elevenStt.capability,
        ),
      );
    }
    return providers;
  }

  getTts(id: VoiceProviderId): ITextToSpeechProvider {
    if (id === 'local') return this.localTts;
    if (id === 'elevenlabs' && this.elevenTts) return this.elevenTts;
    throw new VoiceProviderError(
      'provider-error',
      id,
      `Unknown or unavailable TTS provider "${id}".`,
    );
  }

  getStt(id: VoiceProviderId): ISpeechToTextProvider {
    if (id === 'local') return this.localStt;
    if (id === 'elevenlabs' && this.elevenStt) return this.elevenStt;
    throw new VoiceProviderError(
      'provider-error',
      id,
      `Unknown or unavailable STT provider "${id}".`,
    );
  }

  /** Merge the tts + stt capability of one provider into a single descriptor. */
  private mergeCapability(
    tts: VoiceProviderCapability,
    stt: VoiceProviderCapability,
  ): VoiceProviderCapability {
    return {
      id: tts.id,
      label: tts.label,
      kind: tts.kind,
      requiresDownload: tts.requiresDownload || stt.requiresDownload,
      requiresApiKey: tts.requiresApiKey || stt.requiresApiKey,
      supports: {
        tts: tts.supports.tts,
        stt: stt.supports.stt,
      },
      available: tts.available || stt.available,
      unavailableReason: tts.unavailableReason ?? stt.unavailableReason,
    };
  }
}
