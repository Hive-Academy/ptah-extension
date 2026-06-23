/**
 * FfmpegDecoder — converts an OGG/Opus voice file to a 16 kHz mono WAV
 * suitable for `nodejs-whisper`.
 *
 * Uses `ffmpeg-static` (declared in `apps/ptah-electron/package.json`) for
 * a self-contained ffmpeg binary. The ffmpeg invocation happens via Node's
 * `child_process` so the runtime dependency is loaded lazily and is easy
 * to fake in tests via constructor injection.
 */
import { inject, injectable } from 'tsyringe';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  VoiceAssetsUnavailableError,
  isModuleNotFound,
} from './voice-assets-error';

/** Test seam: locate the ffmpeg binary path. Default uses ffmpeg-static. */
export type FfmpegBinaryResolver = () => string;

const defaultResolver: FfmpegBinaryResolver = () => {
  let ffmpegPath: string | { default?: string };
  try {
    ffmpegPath = require('ffmpeg-static') as string | { default?: string };
  } catch (error: unknown) {
    if (isModuleNotFound(error)) {
      throw new VoiceAssetsUnavailableError('ffmpeg-static', error);
    }
    throw error;
  }
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  if (ffmpegPath && typeof ffmpegPath.default === 'string')
    return ffmpegPath.default;
  throw new VoiceAssetsUnavailableError('ffmpeg-static');
};

@injectable()
export class FfmpegDecoder {
  private resolver: FfmpegBinaryResolver = defaultResolver;
  /** Test seam: override the spawn function. */
  private spawnFn = spawn;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** Test/integration override. Production callers never need this. */
  configure(opts: {
    resolver?: FfmpegBinaryResolver;
    spawnFn?: typeof spawn;
  }): void {
    if (opts.resolver) this.resolver = opts.resolver;
    if (opts.spawnFn) this.spawnFn = opts.spawnFn;
  }

  /**
   * Decode `inputPath` (typically OGG/Opus/WebM) into 16 kHz mono 32-bit float
   * PCM and return the samples as a `Float32Array` — the raw waveform the
   * transformers.js automatic-speech-recognition pipeline consumes directly.
   *
   * SECURITY: `inputPath` MUST be an absolute path that does not start with
   * `-` (otherwise ffmpeg would interpret it as a flag — classic ffmpeg
   * argument-injection / flag-smuggling). We also resolve symlinks to a real
   * path so a crafted symlink cannot be swapped between validation and
   * spawn. The resolved file must exist and be a regular file.
   */
  async decodeToPcm16(inputPath: string): Promise<Float32Array> {
    if (typeof inputPath !== 'string' || inputPath.length === 0) {
      throw new Error('FfmpegDecoder: inputPath must be a non-empty string');
    }
    if (!path.isAbsolute(inputPath)) {
      throw new Error('FfmpegDecoder: inputPath must be absolute');
    }
    const basename = path.basename(inputPath);
    if (basename.startsWith('-') || inputPath.startsWith('-')) {
      throw new Error(
        'FfmpegDecoder: inputPath must not start with "-" (flag-injection guard)',
      );
    }
    const resolvedInput = await fs.realpath(inputPath);
    if (!path.isAbsolute(resolvedInput) || resolvedInput.startsWith('-')) {
      throw new Error('FfmpegDecoder: resolved inputPath failed safety check');
    }
    const stat = await fs.stat(resolvedInput);
    if (!stat.isFile()) {
      throw new Error('FfmpegDecoder: inputPath is not a regular file');
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-voice-'));
    const outPath = path.join(dir, 'audio.f32le');
    const ffmpeg = this.resolver();
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = this.spawnFn(
          ffmpeg,
          [
            '-y',
            '-nostdin',
            '-loglevel',
            'error',
            '-i',
            resolvedInput,
            '-ac',
            '1',
            '-ar',
            '16000',
            '-f',
            'f32le',
            '-acodec',
            'pcm_f32le',
            '--',
            outPath,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'], shell: false },
        );
        let stderr = '';
        proc.stderr?.on('data', (d) => {
          stderr += d.toString();
        });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`,
              ),
            );
        });
      });

      const raw = await fs.readFile(outPath);
      const samples = new Float32Array(
        raw.buffer,
        raw.byteOffset,
        Math.floor(raw.byteLength / Float32Array.BYTES_PER_ELEMENT),
      );
      this.logger.debug('[gateway] ffmpeg decoded voice file', {
        inputPath,
        samples: samples.length,
      });
      return samples.slice();
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
