/**
 * ElevenLabsSttProvider — `ISpeechToTextProvider` over ElevenLabs Scribe.
 * Fetch-based multipart upload; the encoded recording is uploaded as-is (no
 * ffmpeg, no worker). Availability tracks whether an API key is configured.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VoiceProviderError,
  type ISpeechToTextProvider,
  type TranscribeRequest,
  type TranscribeResult,
  type VoiceProviderCapability,
  type VoiceReadiness,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import { ElevenLabsClient } from './elevenlabs-client';
import { VoiceSecretStore } from '../voice-secret-store';

const EL_STT_MODEL_KEY = 'voice.elevenlabs.sttModelId';
const DEFAULT_STT_MODEL_ID = 'scribe_v1';

const API_KEY_MISSING_REASON =
  'Add your ElevenLabs API key in Voice settings to use this provider.';

@injectable()
export class ElevenLabsSttProvider implements ISpeechToTextProvider {
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

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const modelId = this.readString(EL_STT_MODEL_KEY, DEFAULT_STT_MODEL_ID);
    let audio: Uint8Array;
    try {
      audio = await readFile(req.audioPath);
    } catch (error: unknown) {
      // Path/read failure — sanitized, never surfacing the raw fs error text.
      throw new VoiceProviderError(
        'provider-error',
        'elevenlabs',
        'Could not read the recording to transcribe.',
        undefined,
        error,
      );
    }
    const result = await this.client.transcribe({
      audio,
      mimeType:
        req.mimeType.length > 0 ? req.mimeType : 'application/octet-stream',
      fileName: basename(req.audioPath) || 'audio',
      modelId,
    });
    return { text: result.text };
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
