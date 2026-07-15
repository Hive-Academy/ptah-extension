/**
 * LocalSttProvider — `ISpeechToTextProvider` over the Whisper worker. The heavy
 * ONNX transcription runs in the utilityProcess worker; readiness / model-
 * presence checks stay main-side (pure fs, no spawn just to render a badge).
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VOICE_ASSETS_REMEDIATION,
  type ISpeechToTextProvider,
  type TranscribeRequest,
  type TranscribeResult,
  type VoiceProviderCapability,
  type VoiceReadiness,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import { VoiceWorkerClient } from './voice-worker-client';
import { isWhisperModelDownloaded } from './model-paths';
import { resolveSttModelSpec, resolveWhisperModel } from './model-settings';

@injectable()
export class LocalSttProvider implements ISpeechToTextProvider {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(VOICE_TOKENS.VOICE_WORKER_CLIENT)
    private readonly worker: VoiceWorkerClient,
    @inject(VOICE_TOKENS.VOICE_MODEL_CACHE_DIR, { isOptional: true })
    private readonly modelCacheDir: string | null = null,
  ) {}

  get capability(): VoiceProviderCapability {
    const available = this.worker.available;
    return {
      id: 'local',
      label: 'Local (Whisper / Kokoro)',
      kind: 'local',
      requiresDownload: true,
      requiresApiKey: false,
      supports: { tts: true, stt: true },
      available,
      unavailableReason: available ? undefined : VOICE_ASSETS_REMEDIATION,
    };
  }

  async isReady(): Promise<VoiceReadiness> {
    if (!this.worker.available) {
      return { ready: false, reason: 'unavailable' };
    }
    const spec = resolveSttModelSpec(this.workspace);
    const downloaded = await isWhisperModelDownloaded(this.modelCacheDir, spec);
    return {
      ready: downloaded,
      reason: downloaded ? undefined : 'model-not-downloaded',
    };
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const spec = resolveSttModelSpec(this.workspace);
    const text = await this.worker.transcribe(req.audioPath, spec);
    return { text };
  }

  async downloadModel(model?: string): Promise<{ alreadyPresent: boolean }> {
    const spec = resolveSttModelSpec(this.workspace, model);
    if (await isWhisperModelDownloaded(this.modelCacheDir, spec)) {
      return { alreadyPresent: true };
    }
    const result = await this.worker.downloadStt(spec);
    this.logger.info('[voice-providers] whisper model download complete', {
      alreadyPresent: result.alreadyPresent,
    });
    return result;
  }

  /** Concrete helper for `voice:getConfig` — the curated display name. */
  resolveModelName(): string {
    return resolveWhisperModel(this.workspace);
  }
}
