/**
 * ElevenLabsTtsProvider — `ITextToSpeechProvider` over the ElevenLabs cloud API.
 * Fetch-based (no worker, no native deps, no process isolation). Availability
 * tracks whether an API key is configured in the vault-backed secret store.
 */
import { inject, injectable } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  type ITextToSpeechProvider,
  type SynthesizeRequest,
  type SynthesizeResult,
  type VoiceInfo,
  type VoiceProviderCapability,
  type VoiceReadiness,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import { ElevenLabsClient } from './elevenlabs-client';
import { VoiceSecretStore } from '../voice-secret-store';

const EL_VOICE_ID_KEY = 'voice.elevenlabs.voiceId';
const EL_TTS_MODEL_KEY = 'voice.elevenlabs.ttsModelId';
const EL_OUTPUT_FORMAT_KEY = 'voice.elevenlabs.outputFormat';

const DEFAULT_TTS_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
/** ElevenLabs' well-known public default voice ("Rachel"). */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

const API_KEY_MISSING_REASON =
  'Add your ElevenLabs API key in Voice settings to use this provider.';

/** MP3 formats → `audio/mpeg`, Opus → `audio/ogg` (v1 curated formats, D6). */
export function mimeTypeForFormat(format: string): string {
  return format.startsWith('opus') ? 'audio/ogg' : 'audio/mpeg';
}

@injectable()
export class ElevenLabsTtsProvider implements ITextToSpeechProvider {
  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(VOICE_TOKENS.ELEVENLABS_CLIENT)
    private readonly client: ElevenLabsClient,
    @inject(VOICE_TOKENS.VOICE_SECRET_STORE)
    private readonly secretStore: VoiceSecretStore,
  ) {}

  get capability(): VoiceProviderCapability {
    const available = this.secretStore.isConfigured('elevenlabs');
    return {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      kind: 'cloud',
      requiresDownload: false,
      requiresApiKey: true,
      supports: { tts: true, stt: true },
      available,
      unavailableReason: available ? undefined : API_KEY_MISSING_REASON,
    };
  }

  async isReady(): Promise<VoiceReadiness> {
    return this.secretStore.isConfigured('elevenlabs')
      ? { ready: true }
      : { ready: false, reason: 'api-key-missing' };
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const voiceId =
      req.voice && req.voice.length > 0
        ? req.voice
        : this.readString(EL_VOICE_ID_KEY, DEFAULT_VOICE_ID);
    const modelId = this.readString(EL_TTS_MODEL_KEY, DEFAULT_TTS_MODEL_ID);
    const outputFormat = this.readString(
      EL_OUTPUT_FORMAT_KEY,
      DEFAULT_OUTPUT_FORMAT,
    );
    const audio = await this.client.synthesize({
      voiceId,
      text: req.text,
      modelId,
      outputFormat,
    });
    return { audio, mimeType: mimeTypeForFormat(outputFormat) };
  }

  async listVoices(): Promise<readonly VoiceInfo[]> {
    const response = await this.client.listVoices();
    return response.voices.map((voice) => ({
      id: voice.voice_id,
      label: voice.name,
      category: voice.category,
    }));
  }

  /** Cloud provider — nothing to download. */
  async downloadModel(): Promise<{ alreadyPresent: boolean }> {
    return { alreadyPresent: true };
  }

  private readString(key: string, fallback: string): string {
    const value = this.workspace.getConfiguration<string>(
      'ptah',
      key,
      fallback,
    );
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : fallback;
  }
}
