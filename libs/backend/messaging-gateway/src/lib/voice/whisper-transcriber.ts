/**
 * WhisperTranscriber — wraps `nodejs-whisper` to transcribe a 16 kHz WAV
 * to text using the `ggml-small.en-q5_0.bin` model.
 *
 * The model is downloaded lazily to `~/.ptah/models/` on first use.
 * In tests, the module loader is injectable so the whole thing can be
 * faked without the heavy native binding.
 */
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

const defaultLoader: NodejsWhisperLoader = async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
export class WhisperTranscriber {
  /** Test seam: replace the dynamic loader. */
  private loader: NodejsWhisperLoader = defaultLoader;
  private modelName = 'small.en-q5_0';

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  configure(opts: { loader?: NodejsWhisperLoader; modelName?: string }): void {
    if (opts.loader) this.loader = opts.loader;
    if (opts.modelName) this.modelName = opts.modelName;
  }

  /** Ensure `~/.ptah/models/` exists so nodejs-whisper can drop the bin there. */
  private async ensureModelDir(): Promise<string> {
    const dir = path.join(os.homedir(), '.ptah', 'models');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Transcribe a 16 kHz WAV. Returns the trimmed transcript text. Empty
   * string when whisper produced nothing usable.
   */
  async transcribe(wavPath: string): Promise<string> {
    await this.ensureModelDir();
    const whisper = await this.loader();
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
    const text = typeof result === 'string' ? result : (result?.text ?? '');
    const cleaned = text.replace(/\[[^\]]+\]/g, '').trim();
    this.logger.debug('[gateway] whisper transcription complete', {
      wavPath,
      length: cleaned.length,
    });
    return cleaned;
  }
}
