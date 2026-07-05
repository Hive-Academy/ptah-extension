/**
 * KokoroSynthesizer — text-to-speech via the `kokoro-js` package (Kokoro-82M,
 * Apache-2.0). Like {@link WhisperTranscriber} this runs on the same ONNX stack
 * (`@huggingface/transformers` + `onnxruntime-node`) the memory embedder already
 * ships and code-signs, so it works inside a packaged Electron app with no
 * native compile and no `app.asar` path gymnastics.
 *
 * The model is the `onnx-community/Kokoro-82M-v1.0-ONNX` repo on Hugging Face,
 * downloaded to a writable cache directory (`env.cacheDir`, injected via
 * {@link configure} as `~/.ptah/models` by the Electron host). The transformers
 * default cache (`<pkg>/.cache`) resolves inside `app.asar` and fails with
 * ENOTDIR when packaged, so the cache dir MUST be injected in production.
 *
 * `kokoro-js` depends on the same `@huggingface/transformers` instance Whisper
 * uses; npm hoists a single copy, so mutating that shared `env.cacheDir` here
 * also governs where Kokoro caches its weights.
 *
 * Emits the same download lifecycle events as the transcriber so the gateway /
 * voice RPC can bridge them to the renderer:
 *   - 'download:start'    { model }
 *   - 'download:progress' { model, percent }
 *   - 'download:complete' { model }
 *   - 'download:error'    { model, error }
 *
 * In tests the pipeline factory is injectable so the whole thing can be faked
 * without the heavy ONNX runtime or any network.
 */
import { EventEmitter } from 'node:events';
import { inject, injectable } from 'tsyringe';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  VoiceAssetsUnavailableError,
  isModuleNotFound,
  isVoiceBinNotFound,
} from './voice-assets-error';
import type { PipelineProgressInfo } from './whisper-transcriber';

/** Current Kokoro ONNX repo (8 languages, 54 voices). */
export const DEFAULT_KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Apache-licensed default voice shipped with Kokoro v1.0. */
export const DEFAULT_KOKORO_VOICE = 'af_heart';
/** ONNX quantization; q8 mirrors the embedder/Whisper memory/quality trade-off. */
export const DEFAULT_KOKORO_DTYPE = 'q8';

/** Raw audio returned by `KokoroTTS.generate`. */
export interface KokoroAudio {
  readonly audio: Float32Array;
  readonly sampling_rate: number;
  /** WAV-encoded bytes of the rendered audio. */
  toWav(): ArrayBuffer;
}

/** The Kokoro TTS instance returned by the pipeline factory. */
export interface KokoroPipeline {
  generate(text: string, options?: { voice?: string }): Promise<KokoroAudio>;
  list_voices?(): unknown;
}

/** Result of a synthesis: WAV bytes plus the source sample rate. */
export interface SynthesisResult {
  readonly wav: Uint8Array;
  readonly sampleRate: number;
}

/**
 * Builds a Kokoro TTS instance for `modelId`. Injectable so tests can stub it
 * without loading ONNX or hitting the network. `cacheDir` (when provided) is
 * applied to the shared transformers env before the model loads.
 */
export type TtsPipelineFactory = (
  modelId: string,
  opts: {
    cacheDir: string | null;
    dtype: string;
    progress_callback: (info: PipelineProgressInfo) => void;
  },
) => Promise<KokoroPipeline>;

export type KokoroDownloadEvent =
  | { kind: 'download:start'; model: string }
  | { kind: 'download:progress'; model: string; percent: number }
  | { kind: 'download:complete'; model: string }
  | { kind: 'download:error'; model: string; error: string };

interface TransformersEnv {
  cacheDir?: string;
  allowLocalModels?: boolean;
}

// Kept opaque to the bundler so the native ESM packages (and the
// onnxruntime-node `.node` binary they load) are resolved at runtime from
// node_modules rather than pulled into the esbuild graph. The host runtime
// (Electron) provides them; the CLI surfaces VoiceAssetsUnavailableError.
function transformersModuleId(): string {
  return ['@huggingface', 'transformers'].join('/');
}

function kokoroModuleId(): string {
  return ['kokoro', 'js'].join('-');
}

const defaultPipelineFactory: TtsPipelineFactory = async (modelId, opts) => {
  // kokoro-js loads weights through @huggingface/transformers; injecting the
  // cache dir on the shared env steers Kokoro's downloads into ~/.ptah/models.
  if (opts.cacheDir) {
    try {
      const transformers = (await import(
        transformersModuleId()
      )) as unknown as {
        env?: TransformersEnv;
      };
      if (transformers.env) {
        transformers.env.cacheDir = opts.cacheDir;
        transformers.env.allowLocalModels = false;
      }
    } catch (error: unknown) {
      if (isModuleNotFound(error)) {
        throw new VoiceAssetsUnavailableError(
          '@huggingface/transformers',
          error,
        );
      }
      throw error;
    }
  }

  type KokoroModule = {
    KokoroTTS: {
      from_pretrained: (
        modelId: string,
        options: Record<string, unknown>,
      ) => Promise<KokoroPipeline>;
    };
  };
  let mod: KokoroModule;
  try {
    mod = (await import(kokoroModuleId())) as unknown as KokoroModule;
  } catch (error: unknown) {
    if (isModuleNotFound(error)) {
      throw new VoiceAssetsUnavailableError('kokoro-js', error);
    }
    throw error;
  }
  return mod.KokoroTTS.from_pretrained(modelId, {
    dtype: opts.dtype,
    progress_callback: opts.progress_callback,
  });
};

@injectable()
export class KokoroSynthesizer extends EventEmitter {
  /** Test seam: replace the pipeline factory. */
  private pipelineFactory: TtsPipelineFactory = defaultPipelineFactory;
  /** Writable transformers model cache dir; injected by the Electron host. */
  private modelCacheDir: string | null = null;
  private modelId = DEFAULT_KOKORO_MODEL_ID;
  private voice = DEFAULT_KOKORO_VOICE;
  private dtype = DEFAULT_KOKORO_DTYPE;

  private pipeline: KokoroPipeline | null = null;
  private loadedModelId: string | null = null;
  private loading: Promise<KokoroPipeline> | null = null;
  /** Per-file byte progress for the in-flight load, aggregated into one percent. */
  private readonly loadBytesByFile = new Map<
    string,
    { loaded: number; total: number }
  >();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  configure(opts: {
    pipelineFactory?: TtsPipelineFactory;
    modelCacheDir?: string;
    modelId?: string;
    voice?: string;
    dtype?: string;
  }): void {
    if (opts.pipelineFactory) this.pipelineFactory = opts.pipelineFactory;
    if (opts.modelCacheDir) this.modelCacheDir = opts.modelCacheDir;
    if (opts.modelId && opts.modelId.length > 0) this.modelId = opts.modelId;
    if (opts.voice && opts.voice.length > 0) this.voice = opts.voice;
    if (opts.dtype && opts.dtype.length > 0) this.dtype = opts.dtype;
  }

  /**
   * Whether the configured model is already present in the transformers cache.
   * Best-effort: returns false when the cache dir is unknown or the model
   * directory is empty, so callers can render a badge.
   */
  async isModelDownloaded(): Promise<boolean> {
    if (!this.modelCacheDir) return false;
    const modelDir = path.join(this.modelCacheDir, ...this.modelId.split('/'));
    try {
      const entries = await fs.readdir(modelDir, { recursive: true });
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Eagerly download the model so the first voice reply doesn't stall on a
   * download. Loading the pipeline pulls the ONNX weights into the cache;
   * progress is bridged to the `download` lifecycle events. Returns whether the
   * model was already cached (no download performed).
   */
  async downloadModel(): Promise<{ alreadyPresent: boolean }> {
    if (await this.isModelDownloaded()) {
      return { alreadyPresent: true };
    }

    this.emit('download', { kind: 'download:start', model: this.modelId });
    try {
      await this.ensurePipeline();
      this.emit('download', { kind: 'download:complete', model: this.modelId });
      this.logger.info('[gateway] kokoro model downloaded', {
        model: this.modelId,
      });
      return { alreadyPresent: false };
    } catch (err) {
      this.emit('download', {
        kind: 'download:error',
        model: this.modelId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Synthesize `text` to speech. Returns WAV-encoded bytes plus the source
   * sample rate, ready to attach as a voice note or play in the renderer.
   * `voice` overrides the configured default for this call.
   */
  async synthesize(text: string, voice?: string): Promise<SynthesisResult> {
    const present = await this.isModelDownloaded();
    if (!present) {
      this.emit('download', { kind: 'download:start', model: this.modelId });
    }
    try {
      const tts = await this.ensurePipeline();
      const audio = await tts.generate(text, {
        voice: voice && voice.length > 0 ? voice : this.voice,
      });
      if (!present) {
        this.emit('download', {
          kind: 'download:complete',
          model: this.modelId,
        });
      }
      this.logger.debug('[gateway] kokoro synthesis complete', {
        chars: text.length,
        sampleRate: audio.sampling_rate,
      });
      return {
        wav: new Uint8Array(audio.toWav()),
        sampleRate: audio.sampling_rate,
      };
    } catch (err: unknown) {
      // kokoro-js reads per-voice style vectors (voices/<name>.bin) from its
      // own package dir with fs.readFile, ignoring the model cache. In a
      // packaged app where that folder is missing this surfaces as a raw fs
      // ENOENT; convert it to the typed error so the RPC surface returns a
      // clean code + remediation instead of leaking the filesystem path.
      const mapped = isVoiceBinNotFound(err)
        ? new VoiceAssetsUnavailableError(
            `kokoro voice pack (${voice && voice.length > 0 ? voice : this.voice}.bin)`,
            err,
          )
        : err;
      if (!present) {
        this.emit('download', {
          kind: 'download:error',
          model: this.modelId,
          error: mapped instanceof Error ? mapped.message : String(mapped),
        });
      }
      throw mapped;
    }
  }

  private ensurePipeline(): Promise<KokoroPipeline> {
    if (this.pipeline && this.loadedModelId === this.modelId) {
      return Promise.resolve(this.pipeline);
    }
    if (this.loading && this.loadedModelId === this.modelId)
      return this.loading;

    this.loadedModelId = this.modelId;
    this.pipeline = null;
    this.loadBytesByFile.clear();
    this.loading = this.pipelineFactory(this.modelId, {
      cacheDir: this.modelCacheDir,
      dtype: this.dtype,
      progress_callback: (info) => this.handlePipelineProgress(info),
    })
      .then((fn) => {
        this.pipeline = fn;
        return fn;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /**
   * Bridge transformers' per-file progress to a single monotonic percent.
   * The model downloads several files (model, voices, tokenizer, …) and reports
   * each separately; aggregating by summed bytes avoids a bar that resets to 0
   * on every file. Falls back to the raw `progress` field when byte counts
   * aren't reported.
   */
  private handlePipelineProgress(info: PipelineProgressInfo): void {
    let percent: number | null = null;

    if (info.file && typeof info.total === 'number' && info.total > 0) {
      this.loadBytesByFile.set(info.file, {
        loaded: typeof info.loaded === 'number' ? info.loaded : 0,
        total: info.total,
      });
      let loaded = 0;
      let total = 0;
      for (const f of this.loadBytesByFile.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      if (total > 0) percent = (loaded / total) * 100;
    } else if (
      info.status === 'progress' &&
      typeof info.progress === 'number'
    ) {
      percent = info.progress;
    }

    if (percent === null) return;
    this.emit('download', {
      kind: 'download:progress',
      model: this.modelId,
      percent: Math.min(99, Math.max(0, Math.round(percent))),
    });
  }
}
