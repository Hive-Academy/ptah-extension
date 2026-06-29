import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  KokoroSynthesizer,
  DEFAULT_KOKORO_MODEL_ID,
  DEFAULT_KOKORO_VOICE,
  type KokoroAudio,
  type KokoroPipeline,
  type KokoroDownloadEvent,
  type TtsPipelineFactory,
} from './kokoro-synthesizer';
import type { PipelineProgressInfo } from './whisper-transcriber';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeAudio(bytes = [82, 73, 70, 70]): KokoroAudio {
  return {
    audio: new Float32Array([0, 0.1, -0.1]),
    sampling_rate: 24000,
    toWav: () => new Uint8Array(bytes).buffer,
  };
}

describe('KokoroSynthesizer (kokoro-js TTS)', () => {
  it('generates WAV bytes via the configured model and default voice', async () => {
    const generate = jest.fn().mockResolvedValue(makeAudio([1, 2, 3, 4]));
    const pipeline: KokoroPipeline = { generate };
    const factory = jest.fn(
      async () => pipeline,
    ) as unknown as TtsPipelineFactory;

    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });

    const out = await s.synthesize('hello world');

    expect(out.sampleRate).toBe(24000);
    expect(Array.from(out.wav)).toEqual([1, 2, 3, 4]);
    expect(factory).toHaveBeenCalledWith(
      DEFAULT_KOKORO_MODEL_ID,
      expect.objectContaining({ cacheDir: null, dtype: 'q8' }),
    );
    expect(generate).toHaveBeenCalledWith('hello world', {
      voice: DEFAULT_KOKORO_VOICE,
    });
  });

  it('honors a per-call voice override', async () => {
    const generate = jest.fn().mockResolvedValue(makeAudio());
    const factory = jest.fn(
      async () => ({ generate }) as KokoroPipeline,
    ) as unknown as TtsPipelineFactory;

    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });

    await s.synthesize('hi', 'am_michael');

    expect(generate).toHaveBeenCalledWith('hi', { voice: 'am_michael' });
  });

  it('reuses the loaded pipeline across calls and reloads on model switch', async () => {
    const factory = jest.fn(
      async () =>
        ({
          generate: jest.fn().mockResolvedValue(makeAudio()),
        }) as KokoroPipeline,
    ) as unknown as TtsPipelineFactory;

    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });

    await s.synthesize('a');
    await s.synthesize('b');
    expect(factory).toHaveBeenCalledTimes(1);

    s.configure({ modelId: 'onnx-community/Kokoro-82M-ONNX' });
    await s.synthesize('c');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith(
      'onnx-community/Kokoro-82M-ONNX',
      expect.anything(),
    );
  });

  it('bridges pipeline progress to download events during downloadModel', async () => {
    const factory: TtsPipelineFactory = async (_modelId, opts) => {
      opts.progress_callback({ status: 'progress', progress: 47.6 });
      return { generate: jest.fn().mockResolvedValue(makeAudio()) };
    };

    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });

    const events: KokoroDownloadEvent[] = [];
    s.on('download', (e: KokoroDownloadEvent) => events.push(e));

    const result = await s.downloadModel();

    expect(result).toEqual({ alreadyPresent: false });
    expect(events[0]).toEqual({
      kind: 'download:start',
      model: DEFAULT_KOKORO_MODEL_ID,
    });
    expect(events).toContainEqual({
      kind: 'download:progress',
      model: DEFAULT_KOKORO_MODEL_ID,
      percent: 48,
    });
    expect(events.at(-1)).toEqual({
      kind: 'download:complete',
      model: DEFAULT_KOKORO_MODEL_ID,
    });
  });

  it('aggregates multi-file byte progress into one monotonic percent', async () => {
    const factory: TtsPipelineFactory = async (_modelId, opts) => {
      const emit = (info: PipelineProgressInfo) => opts.progress_callback(info);
      emit({ status: 'progress', file: 'model', loaded: 100, total: 100 });
      emit({ status: 'progress', file: 'voices', loaded: 0, total: 100 });
      emit({ status: 'progress', file: 'voices', loaded: 100, total: 100 });
      return { generate: jest.fn().mockResolvedValue(makeAudio()) };
    };

    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });
    const percents: number[] = [];
    s.on('download', (e: KokoroDownloadEvent) => {
      if (e.kind === 'download:progress') percents.push(e.percent);
    });

    await s.downloadModel();

    expect(percents).toEqual([99, 50, 99]);
    expect(Math.min(...percents)).toBeGreaterThan(0);
  });

  it('emits download:error and rethrows when the pipeline fails to load', async () => {
    const factory: TtsPipelineFactory = async () => {
      throw new Error('load-boom');
    };
    const s = new KokoroSynthesizer(makeLogger());
    s.configure({ pipelineFactory: factory });
    const events: KokoroDownloadEvent[] = [];
    s.on('download', (e: KokoroDownloadEvent) => events.push(e));

    await expect(s.downloadModel()).rejects.toThrow('load-boom');
    expect(events.at(-1)).toMatchObject({ kind: 'download:error' });
  });

  describe('isModelDownloaded', () => {
    it('returns false when no cache dir is configured', async () => {
      const s = new KokoroSynthesizer(makeLogger());
      expect(await s.isModelDownloaded()).toBe(false);
    });

    it('returns true when the model dir exists and is non-empty', async () => {
      const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-tts-'));
      try {
        const modelDir = path.join(
          cacheDir,
          ...DEFAULT_KOKORO_MODEL_ID.split('/'),
        );
        await fs.mkdir(modelDir, { recursive: true });
        await fs.writeFile(path.join(modelDir, 'config.json'), '{}');

        const s = new KokoroSynthesizer(makeLogger());
        s.configure({ modelCacheDir: cacheDir });

        expect(await s.isModelDownloaded()).toBe(true);
      } finally {
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    });
  });
});
