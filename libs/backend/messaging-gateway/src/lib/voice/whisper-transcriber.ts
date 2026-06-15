/**
 * WhisperTranscriber — wraps `nodejs-whisper` to transcribe a 16 kHz WAV
 * to text.
 *
 * Models live in the directory `nodejs-whisper` reads from
 * (`<pkg>/cpp/whisper.cpp/models/ggml-<model>.bin`). They can be obtained two
 * ways:
 *   - lazily, at first transcribe, via nodejs-whisper's `autoDownloadModelName`
 *   - eagerly, via {@link downloadModel}, which streams the `ggml-*.bin`
 *     straight from Hugging Face (no cmake build) so the chat mic / gateway
 *     voice notes don't stall on a first-use download.
 * Default model is `base.en` to match the settings default.
 *
 * Emits download lifecycle events on the `EventEmitter` interface so the
 * `GatewayService` can bridge them to the renderer's voice-model-download
 * toast channel:
 *   - 'download:start'    { model }
 *   - 'download:progress' { model, percent }
 *   - 'download:complete' { model }
 *   - 'download:error'    { model, error }
 *
 * For the lazy transcribe path, nodejs-whisper exposes no progress hook, so we
 * emit a coarse start/complete pair around the call. The eager
 * {@link downloadModel} path emits real byte-progress percentages.
 *
 * In tests, the module loader and downloader are injectable so the whole thing
 * can be faked without the heavy native binding or any network.
 */
import { EventEmitter } from 'node:events';
import { inject, injectable } from 'tsyringe';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  VoiceAssetsUnavailableError,
  isModuleNotFound,
} from './voice-assets-error';

/**
 * Maps a Whisper model name to its `ggml-*.bin` filename. Mirrors
 * `nodejs-whisper`'s MODEL_OBJECT so manual downloads land in the exact file
 * the transcribe path reads from.
 */
const GGML_FILENAMES: Readonly<Record<string, string>> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v1': 'ggml-large-v1.bin',
  large: 'ggml-large.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
};

/** Canonical whisper.cpp ggml model host (same source nodejs-whisper pulls from). */
const HUGGINGFACE_MODEL_BASE =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * Streams a model file to `destPath`, reporting integer percent (0-99) as bytes
 * arrive. Injectable so tests can stub the network.
 */
export type WhisperDownloader = (
  url: string,
  destPath: string,
  onProgress: (percent: number) => void,
) => Promise<void>;

const defaultDownloader: WhisperDownloader = async (
  url,
  destPath,
  onProgress,
) => {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPercent = -1;
  const source = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  );
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total <= 0) return;
    const percent = Math.min(99, Math.round((received / total) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(percent);
    }
  });
  await pipeline(source, createWriteStream(destPath));
};

/** Loosely-typed shape we actually call from `nodejs-whisper`. */
export interface NodejsWhisperApi {
  /**
   * `nodejs-whisper` exports a single async function `nodewhisper(filePath, options)`
   * that returns the transcript string (or an object containing it).
   */
  (
    filePath: string,
    options: Record<string, unknown>,
  ): Promise<string | { text: string }>;
}

export type NodejsWhisperLoader = () => Promise<NodejsWhisperApi>;

export type WhisperDownloadEvent =
  | { kind: 'download:start'; model: string }
  | { kind: 'download:progress'; model: string; percent: number }
  | { kind: 'download:complete'; model: string }
  | { kind: 'download:error'; model: string; error: string };

const defaultLoader: NodejsWhisperLoader = async () => {
  let mod: NodejsWhisperApi | { nodewhisper: NodejsWhisperApi };
  try {
    mod = require('nodejs-whisper') as
      | NodejsWhisperApi
      | { nodewhisper: NodejsWhisperApi };
  } catch (error: unknown) {
    if (isModuleNotFound(error)) {
      throw new VoiceAssetsUnavailableError('nodejs-whisper', error);
    }
    throw error;
  }
  if (typeof mod === 'function') return mod;
  if (typeof (mod as { nodewhisper?: unknown }).nodewhisper === 'function') {
    return (mod as { nodewhisper: NodejsWhisperApi }).nodewhisper;
  }
  throw new VoiceAssetsUnavailableError('nodejs-whisper');
};

@injectable()
export class WhisperTranscriber extends EventEmitter {
  /** Test seam: replace the dynamic loader. */
  private loader: NodejsWhisperLoader = defaultLoader;
  /** Test seam: replace the network download. */
  private downloader: WhisperDownloader = defaultDownloader;
  /** Test seam: override the resolved models directory. */
  private modelsDirOverride: string | null = null;
  private modelName = 'base.en';

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  configure(opts: {
    loader?: NodejsWhisperLoader;
    downloader?: WhisperDownloader;
    modelsDir?: string;
    modelName?: string;
  }): void {
    if (opts.loader) this.loader = opts.loader;
    if (opts.downloader) this.downloader = opts.downloader;
    if (opts.modelsDir) this.modelsDirOverride = opts.modelsDir;
    if (opts.modelName && opts.modelName.length > 0) {
      this.modelName = opts.modelName;
    }
  }

  /**
   * Resolve the directory `nodejs-whisper` reads models from
   * (`<pkg>/cpp/whisper.cpp/models`) so presence checks and manual downloads
   * agree with the lazy transcribe-time download. Throws
   * {@link VoiceAssetsUnavailableError} when `nodejs-whisper` is not installed.
   */
  private resolveModelsDir(): string {
    if (this.modelsDirOverride) return this.modelsDirOverride;
    try {
      const pkgJson = require.resolve('nodejs-whisper/package.json');
      return path.join(path.dirname(pkgJson), 'cpp', 'whisper.cpp', 'models');
    } catch (error: unknown) {
      if (isModuleNotFound(error)) {
        throw new VoiceAssetsUnavailableError('nodejs-whisper', error);
      }
      throw error;
    }
  }

  private ggmlFilename(modelName: string): string {
    const filename = GGML_FILENAMES[modelName];
    if (!filename) {
      throw new Error(`Unknown Whisper model "${modelName}"`);
    }
    return filename;
  }

  /**
   * Whether the given model (default: the configured one) is already present on
   * disk. Returns false rather than throwing when the model dir can't be
   * resolved (e.g. assets unavailable) so callers can render a status badge.
   */
  async isModelDownloaded(model?: string): Promise<boolean> {
    const modelName = (model ?? this.modelName).trim();
    const filename = GGML_FILENAMES[modelName];
    if (!filename) return false;
    let dir: string;
    try {
      dir = this.resolveModelsDir();
    } catch {
      return false;
    }
    try {
      await fs.access(path.join(dir, filename));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Eagerly download a model so the chat mic / gateway voice notes don't stall
   * on a first-use download. Streams the `ggml-*.bin` straight from Hugging
   * Face into the directory `nodejs-whisper` reads from, emitting the same
   * `download` lifecycle events as the lazy path. Returns whether the model was
   * already on disk (no download performed).
   */
  async downloadModel(model?: string): Promise<{ alreadyPresent: boolean }> {
    const modelName = (model ?? this.modelName).trim();
    const filename = this.ggmlFilename(modelName);
    const dir = this.resolveModelsDir();
    await fs.mkdir(dir, { recursive: true });

    const dest = path.join(dir, filename);
    try {
      await fs.access(dest);
      return { alreadyPresent: true };
    } catch {
      // not present — download below
    }

    const startEvt: WhisperDownloadEvent = {
      kind: 'download:start',
      model: modelName,
    };
    this.emit('download', startEvt);

    const tmp = `${dest}.download`;
    try {
      await this.downloader(
        `${HUGGINGFACE_MODEL_BASE}/${filename}`,
        tmp,
        (percent) => {
          const progressEvt: WhisperDownloadEvent = {
            kind: 'download:progress',
            model: modelName,
            percent,
          };
          this.emit('download', progressEvt);
        },
      );
      await fs.rename(tmp, dest);
      const completeEvt: WhisperDownloadEvent = {
        kind: 'download:complete',
        model: modelName,
      };
      this.emit('download', completeEvt);
      this.logger.info('[gateway] whisper model downloaded', {
        model: modelName,
        dest,
      });
      return { alreadyPresent: false };
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      const errEvt: WhisperDownloadEvent = {
        kind: 'download:error',
        model: modelName,
        error: err instanceof Error ? err.message : String(err),
      };
      this.emit('download', errEvt);
      throw err;
    }
  }

  /**
   * Transcribe a 16 kHz WAV. Returns the trimmed transcript text. Empty
   * string when whisper produced nothing usable.
   */
  async transcribe(wavPath: string): Promise<string> {
    const present = await this.isModelDownloaded();
    if (!present) {
      const startEvt: WhisperDownloadEvent = {
        kind: 'download:start',
        model: this.modelName,
      };
      this.emit('download', startEvt);
    }

    const whisper = await this.loader();
    try {
      const result = await whisper(wavPath, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName,
        removeWavFileAfterTranscription: false,
        withCuda: false,
        logger: undefined,
        whisperOptions: {
          outputInText: true,
          outputInJson: false,
          outputInSrt: false,
          outputInVtt: false,
        },
      });
      if (!present) {
        const completeEvt: WhisperDownloadEvent = {
          kind: 'download:complete',
          model: this.modelName,
        };
        this.emit('download', completeEvt);
      }
      const text = typeof result === 'string' ? result : (result?.text ?? '');
      const cleaned = text.replace(/\[[^\]]+\]/g, '').trim();
      this.logger.debug('[gateway] whisper transcription complete', {
        wavPath,
        length: cleaned.length,
      });
      return cleaned;
    } catch (err) {
      if (!present) {
        const errEvt: WhisperDownloadEvent = {
          kind: 'download:error',
          model: this.modelName,
          error: err instanceof Error ? err.message : String(err),
        };
        this.emit('download', errEvt);
      }
      throw err;
    }
  }
}
