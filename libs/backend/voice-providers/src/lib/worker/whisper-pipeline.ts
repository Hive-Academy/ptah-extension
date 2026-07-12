/**
 * WhisperPipeline — worker-side ASR pipeline management, moved out of
 * messaging-gateway's `WhisperTranscriber` and de-DI'd (no tsyringe, no
 * EventEmitter). Progress is reported through an injected callback so the
 * worker core can forward it over the id-correlated protocol.
 *
 * Runs `@huggingface/transformers` automatic-speech-recognition (ONNX via
 * `onnxruntime-node`). Extended for FR-4 `VoiceModelSpec`:
 *   - `curated`: the whisper-<name> repo (with the onnx-community overrides).
 *   - `hf`: the user HF repo id verbatim through the same cache pipeline.
 *   - `dir`: a local model directory (env.allowLocalModels + localModelPath),
 *     loaded with no network. `hf`/`dir` load failures map to
 *     `VoiceProviderError('model-invalid', ...)` naming the failing source.
 */
import {
  VoiceProviderError,
  type VoiceModelSpec,
} from '@ptah-extension/voice-contracts';
import * as path from 'node:path';

/** Whisper model names accepted from settings, mapped to their `Xenova` repo. */
export const WHISPER_MODELS: ReadonlySet<string> = new Set([
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

/**
 * Models whose ONNX repo is NOT under the `Xenova` org. `large-v3-turbo` was
 * only ever published as `onnx-community/whisper-large-v3-turbo`; requesting
 * `Xenova/whisper-large-v3-turbo` returns HTTP 401 from Hugging Face.
 */
const MODEL_REPO_OVERRIDES: Readonly<Record<string, string>> = {
  'large-v3-turbo': 'onnx-community/whisper-large-v3-turbo',
};

export function whisperModelIdFor(modelName: string): string {
  return MODEL_REPO_OVERRIDES[modelName] ?? `Xenova/whisper-${modelName}`;
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

export interface AsrPipelineFactoryOptions {
  readonly cacheDir: string | null;
  readonly allowLocalModels: boolean;
  readonly localModelPath: string | null;
  readonly progress_callback: (info: PipelineProgressInfo) => void;
}

/**
 * Builds an ASR pipeline for `modelId`. Injectable so tests can stub it without
 * loading ONNX or hitting the network.
 */
export type AsrPipelineFactory = (
  modelId: string,
  opts: AsrPipelineFactoryOptions,
) => Promise<AsrPipeline>;

/** Reports a single monotonic download percent for the active model load. */
export type WhisperProgressListener = (percent: number) => void;

interface TransformersEnv {
  cacheDir?: string;
  allowLocalModels?: boolean;
  localModelPath?: string;
}

// Kept opaque to the bundler so the native ESM package (and the
// onnxruntime-node `.node` binary it loads) is resolved at runtime from
// node_modules rather than pulled into the esbuild graph.
function transformersModuleId(): string {
  return ['@huggingface', 'transformers'].join('/');
}

/** True when a dynamic import failed because the module is not installed. */
function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
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
      throw new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "@huggingface/transformers" is not available.',
        undefined,
        error,
      );
    }
    throw error;
  }
  if (mod.env) {
    if (opts.cacheDir) mod.env.cacheDir = opts.cacheDir;
    mod.env.allowLocalModels = opts.allowLocalModels;
    if (opts.localModelPath) mod.env.localModelPath = opts.localModelPath;
  }
  return mod.pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    progress_callback: opts.progress_callback,
  });
};

interface ResolvedWhisperModel {
  readonly modelId: string;
  readonly allowLocalModels: boolean;
  readonly localModelPath: string | null;
  /** Human label used in download-progress events + errors. */
  readonly displayName: string;
}

function resolveWhisperModel(model: VoiceModelSpec): ResolvedWhisperModel {
  if (model.kind === 'hf') {
    return {
      modelId: model.repoId,
      allowLocalModels: false,
      localModelPath: null,
      displayName: model.repoId,
    };
  }
  if (model.kind === 'dir') {
    // transformers.js resolves a local model id relative to env.localModelPath.
    const dir = model.path;
    return {
      modelId: path.basename(dir),
      allowLocalModels: true,
      localModelPath: path.dirname(dir),
      displayName: dir,
    };
  }
  return {
    modelId: whisperModelIdFor(model.name),
    allowLocalModels: false,
    localModelPath: null,
    displayName: model.name,
  };
}

export class WhisperPipeline {
  private readonly pipelineFactory: AsrPipelineFactory;
  private readonly modelCacheDir: string | null;

  private pipeline: AsrPipeline | null = null;
  private loadedModelId: string | null = null;
  private loading: Promise<AsrPipeline> | null = null;
  /** Per-file byte progress for the in-flight load, aggregated into one percent. */
  private readonly loadBytesByFile = new Map<
    string,
    { loaded: number; total: number }
  >();

  constructor(opts: {
    modelCacheDir?: string | null;
    pipelineFactory?: AsrPipelineFactory;
  }) {
    this.modelCacheDir = opts.modelCacheDir ?? null;
    this.pipelineFactory = opts.pipelineFactory ?? defaultPipelineFactory;
  }

  /**
   * Transcribe 16 kHz mono float PCM samples. Returns the trimmed transcript,
   * or an empty string when whisper produced nothing usable.
   */
  async transcribe(
    audio: Float32Array,
    model: VoiceModelSpec,
    onProgress?: WhisperProgressListener,
  ): Promise<string> {
    const asr = await this.ensurePipeline(model, onProgress);
    const result = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = typeof result === 'string' ? result : (result?.text ?? '');
    return text.replace(/\[[^\]]+\]/g, '').trim();
  }

  /**
   * Eagerly load a model's assets into the cache. Progress is reported through
   * `onProgress`; the worker core wraps this with start/complete/error events.
   */
  async ensureDownloaded(
    model: VoiceModelSpec,
    onProgress?: WhisperProgressListener,
  ): Promise<void> {
    await this.ensurePipeline(model, onProgress);
  }

  private ensurePipeline(
    model: VoiceModelSpec,
    onProgress?: WhisperProgressListener,
  ): Promise<AsrPipeline> {
    const resolved = resolveWhisperModel(model);
    const cacheKey = `${resolved.allowLocalModels ? 'local' : 'hub'}:${resolved.localModelPath ?? ''}:${resolved.modelId}`;
    if (this.pipeline && this.loadedModelId === cacheKey) {
      return Promise.resolve(this.pipeline);
    }
    if (this.loading && this.loadedModelId === cacheKey) return this.loading;

    this.loadedModelId = cacheKey;
    this.pipeline = null;
    this.loadBytesByFile.clear();
    this.loading = this.pipelineFactory(resolved.modelId, {
      cacheDir: this.modelCacheDir,
      allowLocalModels: resolved.allowLocalModels,
      localModelPath: resolved.localModelPath,
      progress_callback: (info) =>
        this.handlePipelineProgress(info, onProgress),
    })
      .then((fn) => {
        this.pipeline = fn;
        return fn;
      })
      .catch((error: unknown) => {
        // Reset so the next call can retry a fresh load.
        this.loadedModelId = null;
        if (error instanceof VoiceProviderError) throw error;
        if (model.kind === 'hf' || model.kind === 'dir') {
          throw new VoiceProviderError(
            'model-invalid',
            'local',
            `Failed to load Whisper model from ${resolved.displayName}.`,
            undefined,
            error,
          );
        }
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /**
   * Bridge transformers' per-file progress to a single monotonic percent.
   * Aggregating by summed bytes avoids a bar that resets to 0 on every file;
   * falls back to the raw `progress` field when byte counts aren't reported.
   */
  private handlePipelineProgress(
    info: PipelineProgressInfo,
    onProgress?: WhisperProgressListener,
  ): void {
    if (!onProgress) return;
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
    onProgress(Math.min(99, Math.max(0, Math.round(percent))));
  }
}
