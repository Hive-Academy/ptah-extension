/**
 * KokoroPipeline — worker-side TTS pipeline management, moved out of
 * messaging-gateway's `KokoroSynthesizer` and de-DI'd (no tsyringe, no
 * EventEmitter). Progress is reported through an injected callback.
 *
 * Runs `kokoro-js` (Kokoro-82M) on the same `@huggingface/transformers` +
 * `onnxruntime-node` stack as Whisper. Preserves the `voices/<name>.bin`
 * ENOENT → assets-unavailable mapping and extends for FR-4 `VoiceModelSpec`.
 */
import {
  VoiceProviderError,
  type VoiceModelSpec,
} from '@ptah-extension/voice-contracts';
import * as path from 'node:path';
import type {
  PipelineProgressInfo,
  WhisperProgressListener,
} from './whisper-pipeline';

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
export interface KokoroTts {
  generate(text: string, options?: { voice?: string }): Promise<KokoroAudio>;
  list_voices?(): unknown;
}

/** Result of a synthesis: WAV bytes plus the source sample rate. */
export interface SynthesisResult {
  readonly wav: Uint8Array;
  readonly sampleRate: number;
}

export interface TtsPipelineFactoryOptions {
  readonly cacheDir: string | null;
  readonly allowLocalModels: boolean;
  readonly localModelPath: string | null;
  readonly dtype: string;
  readonly progress_callback: (info: PipelineProgressInfo) => void;
}

/**
 * Builds a Kokoro TTS instance for `modelId`. Injectable so tests can stub it
 * without loading ONNX or hitting the network.
 */
export type TtsPipelineFactory = (
  modelId: string,
  opts: TtsPipelineFactoryOptions,
) => Promise<KokoroTts>;

interface TransformersEnv {
  cacheDir?: string;
  allowLocalModels?: boolean;
  localModelPath?: string;
}

function transformersModuleId(): string {
  return ['@huggingface', 'transformers'].join('/');
}

function kokoroModuleId(): string {
  return ['kokoro', 'js'].join('-');
}

function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * Detects an ENOENT for a Kokoro per-voice style vector (`voices/<name>.bin`).
 * `kokoro-js` resolves these files relative to its own package dir; in a
 * packaged app where the folder is missing they surface as a raw fs ENOENT.
 */
function isVoiceBinNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code !== 'ENOENT') return false;
  const rawPath = (error as { path?: unknown }).path;
  const target =
    typeof rawPath === 'string'
      ? rawPath
      : error instanceof Error
        ? error.message
        : '';
  return /voices[\\/][^\\/]+\.bin/i.test(target);
}

const defaultPipelineFactory: TtsPipelineFactory = async (modelId, opts) => {
  // kokoro-js loads weights through @huggingface/transformers; steering the
  // shared env before load governs where Kokoro caches its weights.
  try {
    const transformers = (await import(transformersModuleId())) as unknown as {
      env?: TransformersEnv;
    };
    if (transformers.env) {
      if (opts.cacheDir) transformers.env.cacheDir = opts.cacheDir;
      transformers.env.allowLocalModels = opts.allowLocalModels;
      if (opts.localModelPath)
        transformers.env.localModelPath = opts.localModelPath;
    }
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

  type KokoroModule = {
    KokoroTTS: {
      from_pretrained: (
        modelId: string,
        options: Record<string, unknown>,
      ) => Promise<KokoroTts>;
    };
  };
  let mod: KokoroModule;
  try {
    mod = (await import(kokoroModuleId())) as unknown as KokoroModule;
  } catch (error: unknown) {
    if (isModuleNotFound(error)) {
      throw new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "kokoro-js" is not available.',
        undefined,
        error,
      );
    }
    throw error;
  }
  return mod.KokoroTTS.from_pretrained(modelId, {
    dtype: opts.dtype,
    progress_callback: opts.progress_callback,
  });
};

interface ResolvedKokoroModel {
  readonly modelId: string;
  readonly allowLocalModels: boolean;
  readonly localModelPath: string | null;
  readonly displayName: string;
}

function resolveKokoroModel(model: VoiceModelSpec): ResolvedKokoroModel {
  if (model.kind === 'hf') {
    return {
      modelId: model.repoId,
      allowLocalModels: false,
      localModelPath: null,
      displayName: model.repoId,
    };
  }
  if (model.kind === 'dir') {
    const dir = model.path;
    return {
      modelId: path.basename(dir),
      allowLocalModels: true,
      localModelPath: path.dirname(dir),
      displayName: dir,
    };
  }
  // Curated: the name is the repo id (default Kokoro repo when unset upstream).
  const name =
    model.name && model.name.length > 0 ? model.name : DEFAULT_KOKORO_MODEL_ID;
  return {
    modelId: name,
    allowLocalModels: false,
    localModelPath: null,
    displayName: name,
  };
}

export class KokoroPipeline {
  private readonly pipelineFactory: TtsPipelineFactory;
  private readonly modelCacheDir: string | null;

  private pipeline: KokoroTts | null = null;
  private loadedModelId: string | null = null;
  private loading: Promise<KokoroTts> | null = null;
  private readonly loadBytesByFile = new Map<
    string,
    { loaded: number; total: number }
  >();

  constructor(opts: {
    modelCacheDir?: string | null;
    pipelineFactory?: TtsPipelineFactory;
  }) {
    this.modelCacheDir = opts.modelCacheDir ?? null;
    this.pipelineFactory = opts.pipelineFactory ?? defaultPipelineFactory;
  }

  /**
   * Synthesize `text` to speech. Returns WAV-encoded bytes plus the source
   * sample rate. `voice` selects the Kokoro voice.
   */
  async synthesize(
    text: string,
    voice: string,
    model: VoiceModelSpec,
    dtype: string,
    onProgress?: WhisperProgressListener,
  ): Promise<SynthesisResult> {
    const tts = await this.ensurePipeline(model, dtype, onProgress);
    try {
      const audio = await tts.generate(text, {
        voice: voice && voice.length > 0 ? voice : DEFAULT_KOKORO_VOICE,
      });
      return {
        wav: new Uint8Array(audio.toWav()),
        sampleRate: audio.sampling_rate,
      };
    } catch (err: unknown) {
      if (isVoiceBinNotFound(err)) {
        throw new VoiceProviderError(
          'assets-unavailable',
          'local',
          `Voice asset "kokoro voice pack (${voice}.bin)" is not available.`,
          undefined,
          err,
        );
      }
      throw err;
    }
  }

  async ensureDownloaded(
    model: VoiceModelSpec,
    dtype: string,
    onProgress?: WhisperProgressListener,
  ): Promise<void> {
    await this.ensurePipeline(model, dtype, onProgress);
  }

  private ensurePipeline(
    model: VoiceModelSpec,
    dtype: string,
    onProgress?: WhisperProgressListener,
  ): Promise<KokoroTts> {
    const resolved = resolveKokoroModel(model);
    const cacheKey = `${resolved.allowLocalModels ? 'local' : 'hub'}:${resolved.localModelPath ?? ''}:${resolved.modelId}:${dtype}`;
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
      dtype,
      progress_callback: (info) =>
        this.handlePipelineProgress(info, onProgress),
    })
      .then((fn) => {
        this.pipeline = fn;
        return fn;
      })
      .catch((error: unknown) => {
        this.loadedModelId = null;
        if (error instanceof VoiceProviderError) throw error;
        if (model.kind === 'hf' || model.kind === 'dir') {
          throw new VoiceProviderError(
            'model-invalid',
            'local',
            `Failed to load Kokoro model from ${resolved.displayName}.`,
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
