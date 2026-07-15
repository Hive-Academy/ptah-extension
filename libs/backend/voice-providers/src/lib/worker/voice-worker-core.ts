/**
 * VoiceWorkerCore — pure protocol dispatcher for the voice worker. All heavy
 * dependencies (pipelines, ffmpeg) are injected via factories so the core is
 * unit-testable without ONNX or a real child process (the embedder worker is
 * untested precisely because its logic lives in the entry — we avoid that).
 *
 * Config (ffmpeg path + model cache dir) arrives once in the `init` message;
 * every other message is an id-correlated request whose response echoes the id.
 * Download lifecycle is streamed out of band as `download-progress` messages.
 */
import {
  VoiceProviderError,
  type VoiceDirection,
  type VoiceErrorCategory,
  type VoiceModelSpec,
} from '@ptah-extension/voice-contracts';
import type { WhisperPipeline } from './whisper-pipeline';
import type { KokoroPipeline } from './kokoro-pipeline';
import type { FfmpegDecode } from './ffmpeg-decode';
import type {
  VoiceWorkerInbound,
  VoiceWorkerOutbound,
} from './voice-worker-protocol';

export interface VoiceWorkerCoreDeps {
  readonly post: (msg: VoiceWorkerOutbound) => void;
  readonly createWhisper: (modelCacheDir: string | null) => WhisperPipeline;
  readonly createKokoro: (modelCacheDir: string | null) => KokoroPipeline;
  readonly createFfmpeg: (ffmpegPath: string | null) => FfmpegDecode;
}

function modelDisplayName(model: VoiceModelSpec): string {
  switch (model.kind) {
    case 'curated':
      return model.name;
    case 'hf':
      return model.repoId;
    case 'dir':
      return model.path;
  }
}

function errorCategory(error: unknown): VoiceErrorCategory {
  if (error instanceof VoiceProviderError) return error.category;
  return 'provider-error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VoiceWorkerCore {
  private whisper: WhisperPipeline | null = null;
  private kokoro: KokoroPipeline | null = null;
  private ffmpeg: FfmpegDecode | null = null;

  constructor(private readonly deps: VoiceWorkerCoreDeps) {}

  handleMessage(msg: VoiceWorkerInbound): void {
    if (msg.type === 'init') {
      this.whisper = this.deps.createWhisper(msg.modelCacheDir);
      this.kokoro = this.deps.createKokoro(msg.modelCacheDir);
      this.ffmpeg = this.deps.createFfmpeg(msg.ffmpegPath);
      return;
    }
    void this.dispatch(msg);
  }

  private async dispatch(
    msg: Exclude<VoiceWorkerInbound, { type: 'init' }>,
  ): Promise<void> {
    try {
      switch (msg.type) {
        case 'stt:transcribe': {
          const text = await this.transcribe(msg.audioPath, msg.model);
          this.deps.post({ id: msg.id, ok: true, text });
          return;
        }
        case 'tts:synthesize': {
          const { wav, sampleRate } = await this.synthesize(
            msg.text,
            msg.voice,
            msg.model,
            msg.dtype,
          );
          this.deps.post({ id: msg.id, ok: true, wav, sampleRate });
          return;
        }
        case 'stt:download': {
          await this.download('stt', msg.model, (onProgress) =>
            this.ensureWhisper().ensureDownloaded(msg.model, onProgress),
          );
          this.deps.post({ id: msg.id, ok: true, alreadyPresent: false });
          return;
        }
        case 'tts:download': {
          await this.download('tts', msg.model, (onProgress) =>
            this.ensureKokoro().ensureDownloaded(
              msg.model,
              msg.dtype,
              onProgress,
            ),
          );
          this.deps.post({ id: msg.id, ok: true, alreadyPresent: false });
          return;
        }
        case 'dispose': {
          this.whisper = null;
          this.kokoro = null;
          this.ffmpeg = null;
          this.deps.post({ id: msg.id, ok: true, alreadyPresent: true });
          return;
        }
        default: {
          const unknown = msg as { id?: number; type?: string };
          this.deps.post({
            id: typeof unknown.id === 'number' ? unknown.id : -1,
            ok: false,
            error: `unknown message type: ${String(unknown.type)}`,
            category: 'provider-error',
          });
        }
      }
    } catch (error: unknown) {
      this.deps.post({
        id: msg.id,
        ok: false,
        error: errorMessage(error),
        category: errorCategory(error),
      });
    }
  }

  private async transcribe(
    audioPath: string,
    model: VoiceModelSpec,
  ): Promise<string> {
    const pcm = await this.ensureFfmpeg().decodeToPcm16(audioPath);
    return this.ensureWhisper().transcribe(pcm, model, (percent) =>
      this.postProgress('stt', modelDisplayName(model), {
        kind: 'download:progress',
        percent,
      }),
    );
  }

  private async synthesize(
    text: string,
    voice: string,
    model: VoiceModelSpec,
    dtype: string,
  ): Promise<{ wav: Uint8Array; sampleRate: number }> {
    return this.ensureKokoro().synthesize(
      text,
      voice,
      model,
      dtype,
      (percent) =>
        this.postProgress('tts', modelDisplayName(model), {
          kind: 'download:progress',
          percent,
        }),
    );
  }

  /**
   * Wrap an eager download with start/complete/error lifecycle events. Per-file
   * progress ticks flow through the injected `onProgress` callback.
   */
  private async download(
    direction: VoiceDirection,
    model: VoiceModelSpec,
    run: (onProgress: (percent: number) => void) => Promise<void>,
  ): Promise<void> {
    const name = modelDisplayName(model);
    this.postProgress(direction, name, { kind: 'download:start' });
    try {
      await run((percent) =>
        this.postProgress(direction, name, {
          kind: 'download:progress',
          percent,
        }),
      );
      this.postProgress(direction, name, { kind: 'download:complete' });
    } catch (error: unknown) {
      this.postProgress(direction, name, {
        kind: 'download:error',
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private postProgress(
    direction: VoiceDirection,
    model: string,
    body:
      | { kind: 'download:start' }
      | { kind: 'download:progress'; percent: number }
      | { kind: 'download:complete' }
      | { kind: 'download:error'; error: string },
  ): void {
    this.deps.post({ type: 'download-progress', direction, model, ...body });
  }

  private ensureWhisper(): WhisperPipeline {
    if (!this.whisper) throw new Error('voice worker not initialized');
    return this.whisper;
  }

  private ensureKokoro(): KokoroPipeline {
    if (!this.kokoro) throw new Error('voice worker not initialized');
    return this.kokoro;
  }

  private ensureFfmpeg(): FfmpegDecode {
    if (!this.ffmpeg) throw new Error('voice worker not initialized');
    return this.ffmpeg;
  }
}
