/**
 * WhisperTranscriber — transcribes 16 kHz mono PCM audio to text using the
 * `@huggingface/transformers` automatic-speech-recognition pipeline (ONNX via
 * `onnxruntime-node`). This is the same runtime the memory embedder already
 * ships and code-signs, so it works inside a packaged Electron app with no
 * native compile, no CMake, and no `app.asar` path gymnastics.
 *
 * Models are the `Xenova/whisper-*` ONNX repos on Hugging Face, downloaded to a
 * writable cache directory (`env.cacheDir`, injected via {@link configure} as
 * `~/.ptah/models` by the Electron host). The transformers default cache
 * (`<pkg>/.cache`) resolves inside `app.asar` and fails with ENOTDIR when
 * packaged, so the cache dir MUST be injected in production.
 *
 * Emits download lifecycle events on the `EventEmitter` interface so the
 * `GatewayService` / voice RPC can bridge them to the renderer's
 * voice-model-download toast channel:
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
} from './voice-assets-error';

/** Whisper model names accepted from settings, mapped to their `Xenova` repo. */
const WHISPER_MODELS: ReadonlySet<string> = new Set([
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large-v1',
  'large',
  'large-v3-turbo',
]);

function modelIdFor(modelName: string): string {
  return `Xenova/whisper-${modelName}`;
}

export interface PipelineProgressInfo {
  readonly status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  readonly name?: string;
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
}

/** The callable returned by the transformers ASR pipeline. */
export interface AsrPipeline {
  (
    audio: Float32Array,
    options?: Record<string, unknown>,
  ): Promise<{ text: string } | string>;
}

/**
 * Builds an ASR pipeline for `modelId`. Injectable so tests can stub it without
 * loading ONNX or hitting the network. `cacheDir` (when provided) is applied to
 * the transformers env before the pipeline loads.
 */
export type AsrPipelineFactory = (
  modelId: string,
  opts: {
    cacheDir: string | null;
    progress_callback: (info: PipelineProgressInfo) => void;
  },
) => Promise<AsrPipeline>;

export type WhisperDownloadEvent =
  | { kind: 'download:start'; model: string }
  | { kind: 'download:progress'; model: string; percent: number }
  | { kind: 'download:complete'; model: string }
  | { kind: 'download:error'; model: string; error: string };

interface TransformersEnv {
  cacheDir?: string;
  allowLocalModels?: boolean;
}

// Kept opaque to the bundler so the native ESM package (and the
// onnxruntime-node `.node` binary it loads) is resolved at runtime from
// node_modules rather than pulled into the esbuild graph. The host runtime
// (Electron) provides it; the CLI surfaces VoiceAssetsUnavailableError.
function transformersModuleId(): string {
  return ['@huggingface', 'transformers'].join('/');
}

const defaultPipelineFactory: AsrPipelineFactory = async (modelId, opts) => {
  type TransformersModule = {
    pipeline: (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<AsrPipeline>;
    env?: TransformersEnv;
  };
  let mod: TransformersModule;
  try {
    mod = (await import(
      transformersModuleId()
    )) as unknown as TransformersModule;
  } catch (error: unknown) {
    if (isModuleNotFound(error)) {
      throw new VoiceAssetsUnavailableError('@huggingface/transformers', error);
    }
    throw error;
  }
  if (opts.cacheDir && mod.env) {
    mod.env.cacheDir = opts.cacheDir;
    mod.env.allowLocalModels = false;
  }
  return mod.pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    progress_callback: opts.progress_callback,
  });
};

@injectable()
export class WhisperTranscriber extends EventEmitter {
  /** Test seam: replace the pipeline factory. */
  private pipelineFactory: AsrPipelineFactory = defaultPipelineFactory;
  /** Writable transformers model cache dir; injected by the Electron host. */
  private modelCacheDir: string | null = null;
  private modelName = 'base.en';

  private pipeline: AsrPipeline | null = null;
  private loadedModelId: string | null = null;
  private loading: Promise<AsrPipeline> | null = null;
  /** Per-file byte progress for the in-flight load, aggregated into one percent. */
  private readonly loadBytesByFile = new Map<
    string,
    { loaded: number; total: number }
  >();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  configure(opts: {
    pipelineFactory?: AsrPipelineFactory;
    modelCacheDir?: string;
    modelName?: string;
  }): void {
    if (opts.pipelineFactory) this.pipelineFactory = opts.pipelineFactory;
    if (opts.modelCacheDir) this.modelCacheDir = opts.modelCacheDir;
    if (opts.modelName && opts.modelName.length > 0) {
      this.modelName = opts.modelName;
    }
  }

  /**
   * Whether the given model (default: the configured one) is already present in
   * the transformers cache. Best-effort: returns false when the cache dir is
   * unknown or the model directory is empty, so callers can render a badge.
   */
  async isModelDownloaded(model?: string): Promise<boolean> {
    const modelName = (model ?? this.modelName).trim();
    if (!WHISPER_MODELS.has(modelName)) return false;
    if (!this.modelCacheDir) return false;
    const modelDir = path.join(
      this.modelCacheDir,
      ...modelIdFor(modelName).split('/'),
    );
    try {
      const entries = await fs.readdir(modelDir, { recursive: true });
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Eagerly download a model so the chat mic / gateway voice notes don't stall
   * on a first-use download. Loading the pipeline pulls the ONNX weights into
   * the cache; progress is bridged to the `download` lifecycle events. Returns
   * whether the model was already cached (no download performed).
   */
  async downloadModel(model?: string): Promise<{ alreadyPresent: boolean }> {
    const modelName = (model ?? this.modelName).trim();
    if (!WHISPER_MODELS.has(modelName)) {
      throw new Error(`Unknown Whisper model "${modelName}"`);
    }
    if (await this.isModelDownloaded(modelName)) {
      return { alreadyPresent: true };
    }

    this.emit('download', { kind: 'download:start', model: modelName });
    try {
      await this.ensurePipeline(modelName);
      this.emit('download', { kind: 'download:complete', model: modelName });
      this.logger.info('[gateway] whisper model downloaded', {
        model: modelName,
      });
      return { alreadyPresent: false };
    } catch (err) {
      this.emit('download', {
        kind: 'download:error',
        model: modelName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Transcribe 16 kHz mono float PCM samples. Returns the trimmed transcript
   * text, or an empty string when whisper produced nothing usable.
   */
  async transcribe(audio: Float32Array): Promise<string> {
    const present = await this.isModelDownloaded();
    if (!present) {
      this.emit('download', { kind: 'download:start', model: this.modelName });
    }
    try {
      const asr = await this.ensurePipeline(this.modelName);
      const result = await asr(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      if (!present) {
        this.emit('download', {
          kind: 'download:complete',
          model: this.modelName,
        });
      }
      const text = typeof result === 'string' ? result : (result?.text ?? '');
      const cleaned = text.replace(/\[[^\]]+\]/g, '').trim();
      this.logger.debug('[gateway] whisper transcription complete', {
        length: cleaned.length,
      });
      return cleaned;
    } catch (err) {
      if (!present) {
        this.emit('download', {
          kind: 'download:error',
          model: this.modelName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  private ensurePipeline(modelName: string): Promise<AsrPipeline> {
    const modelId = modelIdFor(modelName);
    if (this.pipeline && this.loadedModelId === modelId) {
      return Promise.resolve(this.pipeline);
    }
    if (this.loading && this.loadedModelId === modelId) return this.loading;

    this.loadedModelId = modelId;
    this.pipeline = null;
    this.loadBytesByFile.clear();
    this.loading = this.pipelineFactory(modelId, {
      cacheDir: this.modelCacheDir,
      progress_callback: (info) => this.handlePipelineProgress(modelName, info),
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
   * The pipeline downloads several files (encoder, decoder, tokenizer, …) and
   * reports each one separately; aggregating by summed bytes avoids a bar that
   * resets to 0 on every file. Falls back to the raw `progress` field when byte
   * counts aren't reported.
   */
  private handlePipelineProgress(
    modelName: string,
    info: PipelineProgressInfo,
  ): void {
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
      model: modelName,
      percent: Math.min(99, Math.max(0, Math.round(percent))),
    });
  }
}
