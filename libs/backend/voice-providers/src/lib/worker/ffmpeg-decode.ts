/**
 * FfmpegDecode — worker-side audio decode, moved out of messaging-gateway's
 * `FfmpegDecoder` and de-DI'd. Converts an encoded recording (OGG/Opus/WebM/…)
 * to 16 kHz mono 32-bit float PCM for the Whisper pipeline.
 *
 * The ffmpeg binary path arrives in the worker `init` message. All of the
 * original absolute-path / flag-injection / realpath safety guards are
 * preserved verbatim.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { VoiceProviderError } from '@ptah-extension/voice-contracts';

/** Test seam: override the spawn function. */
export type SpawnFn = typeof spawn;

export class FfmpegDecode {
  private readonly ffmpegPath: string | null;
  private readonly spawnFn: SpawnFn;

  constructor(opts: { ffmpegPath: string | null; spawnFn?: SpawnFn }) {
    this.ffmpegPath = opts.ffmpegPath;
    this.spawnFn = opts.spawnFn ?? spawn;
  }

  /**
   * Decode `inputPath` into 16 kHz mono 32-bit float PCM samples.
   *
   * SECURITY: `inputPath` MUST be an absolute path that does not start with
   * `-` (otherwise ffmpeg would interpret it as a flag). Symlinks are resolved
   * to a real path so a crafted symlink cannot be swapped between validation
   * and spawn; the resolved file must exist and be a regular file.
   */
  async decodeToPcm16(inputPath: string): Promise<Float32Array> {
    if (!this.ffmpegPath) {
      throw new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "ffmpeg-static" is not available.',
      );
    }
    if (typeof inputPath !== 'string' || inputPath.length === 0) {
      throw new Error('FfmpegDecode: inputPath must be a non-empty string');
    }
    if (!path.isAbsolute(inputPath)) {
      throw new Error('FfmpegDecode: inputPath must be absolute');
    }
    const basename = path.basename(inputPath);
    if (basename.startsWith('-') || inputPath.startsWith('-')) {
      throw new Error(
        'FfmpegDecode: inputPath must not start with "-" (flag-injection guard)',
      );
    }
    const resolvedInput = await fs.realpath(inputPath);
    if (!path.isAbsolute(resolvedInput) || resolvedInput.startsWith('-')) {
      throw new Error('FfmpegDecode: resolved inputPath failed safety check');
    }
    const stat = await fs.stat(resolvedInput);
    if (!stat.isFile()) {
      throw new Error('FfmpegDecode: inputPath is not a regular file');
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-voice-'));
    const outPath = path.join(dir, 'audio.f32le');
    const ffmpeg = this.ffmpegPath;
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
      return samples.slice();
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
