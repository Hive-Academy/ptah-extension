/**
 * LocalTtsProvider — `ITextToSpeechProvider` over the Kokoro worker. Synthesis
 * runs in the utilityProcess worker; the curated voice list lives here (moved
 * from the frontend so FR-6.1's "listed from the backend" holds for voices).
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VOICE_ASSETS_REMEDIATION,
  type ITextToSpeechProvider,
  type SynthesizeRequest,
  type SynthesizeResult,
  type VoiceInfo,
  type VoiceProviderCapability,
  type VoiceReadiness,
} from '@ptah-extension/voice-contracts';
import { VOICE_TOKENS } from '../di/tokens';
import { VoiceWorkerClient } from './voice-worker-client';
import { DEFAULT_KOKORO_DTYPE } from '../worker/kokoro-pipeline';
import { isKokoroModelDownloaded } from './model-paths';
import { resolveTtsModelSpec, resolveTtsVoice } from './model-settings';

/** Curated Kokoro v1.0 voices (moved from the frontend hardcoded lists). */
const KOKORO_VOICES: readonly VoiceInfo[] = [
  { id: 'af_heart', label: 'Heart (US, female)', category: 'American English' },
  { id: 'af_bella', label: 'Bella (US, female)', category: 'American English' },
  {
    id: 'af_nicole',
    label: 'Nicole (US, female)',
    category: 'American English',
  },
  { id: 'af_sarah', label: 'Sarah (US, female)', category: 'American English' },
  { id: 'af_sky', label: 'Sky (US, female)', category: 'American English' },
  { id: 'am_adam', label: 'Adam (US, male)', category: 'American English' },
  {
    id: 'am_michael',
    label: 'Michael (US, male)',
    category: 'American English',
  },
  { id: 'am_puck', label: 'Puck (US, male)', category: 'American English' },
  { id: 'bf_emma', label: 'Emma (UK, female)', category: 'British English' },
  {
    id: 'bf_isabella',
    label: 'Isabella (UK, female)',
    category: 'British English',
  },
  { id: 'bm_george', label: 'George (UK, male)', category: 'British English' },
  { id: 'bm_lewis', label: 'Lewis (UK, male)', category: 'British English' },
];

@injectable()
export class LocalTtsProvider implements ITextToSpeechProvider {
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
    const spec = resolveTtsModelSpec(this.workspace);
    const downloaded = await isKokoroModelDownloaded(this.modelCacheDir, spec);
    return {
      ready: downloaded,
      reason: downloaded ? undefined : 'model-not-downloaded',
    };
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const spec = resolveTtsModelSpec(this.workspace);
    const voice =
      req.voice && req.voice.length > 0
        ? req.voice
        : resolveTtsVoice(this.workspace);
    const { wav, sampleRate } = await this.worker.synthesize(
      req.text,
      voice,
      spec,
      DEFAULT_KOKORO_DTYPE,
    );
    return { audio: wav, mimeType: 'audio/wav', sampleRate };
  }

  async listVoices(): Promise<readonly VoiceInfo[]> {
    return KOKORO_VOICES;
  }

  async downloadModel(): Promise<{ alreadyPresent: boolean }> {
    const spec = resolveTtsModelSpec(this.workspace);
    if (await isKokoroModelDownloaded(this.modelCacheDir, spec)) {
      return { alreadyPresent: true };
    }
    const result = await this.worker.downloadTts(spec, DEFAULT_KOKORO_DTYPE);
    this.logger.info('[voice-providers] kokoro model download complete', {
      alreadyPresent: result.alreadyPresent,
    });
    return result;
  }

  /** Concrete helper for `voice:getTtsConfig` — the curated voice id. */
  resolveVoice(): string {
    return resolveTtsVoice(this.workspace);
  }
}
