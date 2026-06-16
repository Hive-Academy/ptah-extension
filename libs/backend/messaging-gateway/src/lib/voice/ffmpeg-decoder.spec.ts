import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import type { Logger } from '@ptah-extension/vscode-core';
import { FfmpegDecoder } from './ffmpeg-decoder';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * Fake spawn that writes deterministic f32le bytes to the output path (the
 * last CLI arg) and then emits a successful close — standing in for ffmpeg.
 */
function fakeSpawnWriting(samples: Float32Array) {
  return ((_cmd: string, args: string[]) => {
    const outPath = args[args.length - 1];
    const buf = Buffer.from(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength,
    );
    writeFileSync(outPath, buf);
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
    };
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit('close', 0));
    return proc;
  }) as unknown as FfmpegDecoder['spawnFn'];
}

describe('FfmpegDecoder.decodeToPcm16', () => {
  it('decodes an input file into a Float32Array of samples', async () => {
    const inputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-in-'));
    const inputPath = path.join(inputDir, 'voice.webm');
    await fs.writeFile(inputPath, Buffer.from('fake-source-audio'));

    const expected = new Float32Array([0, 0.25, -0.5, 0.75]);
    const spawnFn = fakeSpawnWriting(expected);

    const decoder = new FfmpegDecoder(makeLogger());
    decoder.configure({ resolver: () => 'ffmpeg', spawnFn });

    try {
      const out = await decoder.decodeToPcm16(inputPath);
      expect(Array.from(out)).toEqual(Array.from(expected));
    } finally {
      await fs.rm(inputDir, { recursive: true, force: true });
    }
  });

  it('requests 16 kHz mono f32le from ffmpeg', async () => {
    const inputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-in-'));
    const inputPath = path.join(inputDir, 'voice.ogg');
    await fs.writeFile(inputPath, Buffer.from('x'));

    const seen: string[] = [];
    const spawnFn = ((_cmd: string, args: string[]) => {
      seen.push(...args);
      writeFileSync(args[args.length - 1], Buffer.alloc(0));
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
      };
      proc.stderr = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0));
      return proc;
    }) as unknown as FfmpegDecoder['spawnFn'];

    const decoder = new FfmpegDecoder(makeLogger());
    decoder.configure({ resolver: () => 'ffmpeg', spawnFn });

    try {
      await decoder.decodeToPcm16(inputPath);
      expect(seen).toEqual(
        expect.arrayContaining(['-ar', '16000', '-ac', '1', 'f32le']),
      );
    } finally {
      await fs.rm(inputDir, { recursive: true, force: true });
    }
  });

  it('rejects a relative input path', async () => {
    const decoder = new FfmpegDecoder(makeLogger());
    await expect(decoder.decodeToPcm16('relative/path.webm')).rejects.toThrow(
      /absolute/,
    );
  });

  it('rejects an input path that starts with "-" (flag-injection guard)', async () => {
    const decoder = new FfmpegDecoder(makeLogger());
    await expect(decoder.decodeToPcm16('-malicious')).rejects.toThrow();
  });
});
