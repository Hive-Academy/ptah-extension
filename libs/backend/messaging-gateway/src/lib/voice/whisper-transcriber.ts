/**
 * WhisperTranscriber — wraps `nodejs-whisper` to transcribe a 16 kHz WAV
 * to text.
 *
 * The model is downloaded lazily to `~/.ptah/models/` on first use. Default
 * model is `base.en` to match `gateway.voice.whisperModel` settings default
 * (smaller footprint than `small.en-q5_0`, fast on CPU).
 *
 * Emits download lifecycle events on the `EventEmitter` interface so the
 * `GatewayService` can bridge them to the renderer's voice-model-download
 * toast channel:
 *   - 'download:start'    { model }
 *   - 'download:progress' { model, percent }
 *   - 'download:complete' { model }
 *   - 'download:error'    { model, error }
 *
 * The underlying `nodejs-whisper` library does not (today) expose a download
 * progress hook, so progress is emitted as a coarse two-step lifecycle: we
 * detect whether the `.bin` file exists in `~/.ptah/models/` *before* the
 * first transcribe call. If it doesn't, we emit `download:start` before the
 * call and `download:complete` (or `download:error`) after.
 *
 * In tests, the module loader is injectable so the whole thing can be faked
 * without the heavy native binding.
 */
import { EventEmitter } from 'node:events';
import { inject, injectable } from 'tsyringe';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

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
  const mod = require('nodejs-whisper') as
    | NodejsWhisperApi
    | { nodewhisper: NodejsWhisperApi };
  if (typeof mod === 'function') return mod;
  if (typeof (mod as { nodewhisper?: unknown }).nodewhisper === 'function') {
    return (mod as { nodewhisper: NodejsWhisperApi }).nodewhisper;
  }
  throw new Error('nodejs-whisper module does not expose a callable export');
};

@injectable()
export class WhisperTranscriber extends EventEmitter {
  /** Test seam: replace the dynamic loader. */
  private loader: NodejsWhisperLoader = defaultLoader;
  private modelName = 'base.en';

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    super();
  }

  configure(opts: { loader?: NodejsWhisperLoader; modelName?: string }): void {
    if (opts.loader) this.loader = opts.loader;
    if (opts.modelName && opts.modelName.length > 0) {
      this.modelName = opts.modelName;
    }
  }

  /** Ensure `~/.ptah/models/` exists so nodejs-whisper can drop the bin there. */
  private async ensureModelDir(): Promise<string> {
    const dir = path.join(os.homedir(), '.ptah', 'models');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Probe the canonical model bin path. nodejs-whisper names files
   * `ggml-<modelName>.bin` (e.g. `ggml-base.en.bin`). Return true when the
   * file is already present so we can suppress the download toast.
   */
  private async modelFileExists(modelDir: string): Promise<boolean> {
    const candidate = path.join(modelDir, `ggml-${this.modelName}.bin`);
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe a 16 kHz WAV. Returns the trimmed transcript text. Empty
   * string when whisper produced nothing usable.
   */
  async transcribe(wavPath: string): Promise<string> {
    const modelDir = await this.ensureModelDir();
    const present = await this.modelFileExists(modelDir);
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
