import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  WhisperTranscriber,
  type AsrPipeline,
  type AsrPipelineFactory,
  type PipelineProgressInfo,
  type WhisperDownloadEvent,
} from './whisper-transcriber';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('WhisperTranscriber (transformers.js ASR)', () => {
  it('loads the Xenova/whisper-<model> pipeline and returns cleaned text', async () => {
    const asr: AsrPipeline = jest
      .fn()
      .mockResolvedValue({ text: '  hello world [BLANK_AUDIO] ' });
    const factory = jest.fn<ReturnType<AsrPipelineFactory>, [string, never]>(
      async () => asr,
    ) as unknown as AsrPipelineFactory;

    const t = new WhisperTranscriber(makeLogger());
    t.configure({ pipelineFactory: factory, modelName: 'base.en' });

    const out = await t.transcribe(new Float32Array([0, 0.1, -0.1]));

    expect(out).toBe('hello world');
    expect(factory).toHaveBeenCalledWith(
      'Xenova/whisper-base.en',
      expect.objectContaining({ cacheDir: null }),
    );
    expect(asr).toHaveBeenCalledWith(
      expect.any(Float32Array),
      expect.objectContaining({ chunk_length_s: 30 }),
    );
  });

  it('reuses the loaded pipeline across calls and reloads on model switch', async () => {
    const asr: AsrPipeline = jest.fn().mockResolvedValue({ text: 'x' });
    const factory = jest.fn(async () => asr) as unknown as AsrPipelineFactory;

    const t = new WhisperTranscriber(makeLogger());
    t.configure({ pipelineFactory: factory, modelName: 'base.en' });

    await t.transcribe(new Float32Array([0]));
    await t.transcribe(new Float32Array([0]));
    expect(factory).toHaveBeenCalledTimes(1);

    t.configure({ modelName: 'small.en' });
    await t.transcribe(new Float32Array([0]));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith(
      'Xenova/whisper-small.en',
      expect.anything(),
    );
  });

  it('bridges pipeline progress to download events during downloadModel', async () => {
    let emitProgress: (info: PipelineProgressInfo) => void = () => undefined;
    const factory: AsrPipelineFactory = async (_modelId, opts) => {
      emitProgress = opts.progress_callback;
      emitProgress({ status: 'progress', progress: 47.6 });
      return jest.fn().mockResolvedValue({ text: '' });
    };

    const t = new WhisperTranscriber(makeLogger());
    t.configure({ pipelineFactory: factory, modelName: 'base.en' });

    const events: WhisperDownloadEvent[] = [];
    t.on('download', (e: WhisperDownloadEvent) => events.push(e));

    const result = await t.downloadModel('base.en');

    expect(result).toEqual({ alreadyPresent: false });
    expect(events[0]).toEqual({ kind: 'download:start', model: 'base.en' });
    expect(events).toContainEqual({
      kind: 'download:progress',
      model: 'base.en',
      percent: 48,
    });
    expect(events.at(-1)).toEqual({
      kind: 'download:complete',
      model: 'base.en',
    });
  });

  it('aggregates multi-file byte progress into one monotonic percent', async () => {
    let emit: (info: PipelineProgressInfo) => void = () => undefined;
    const factory: AsrPipelineFactory = async (_modelId, opts) => {
      emit = opts.progress_callback;
      // Two files; the second starting must not reset the bar to 0.
      emit({ status: 'progress', file: 'encoder', loaded: 100, total: 100 });
      emit({ status: 'progress', file: 'decoder', loaded: 0, total: 100 });
      emit({ status: 'progress', file: 'decoder', loaded: 100, total: 100 });
      return jest.fn().mockResolvedValue({ text: '' });
    };

    const t = new WhisperTranscriber(makeLogger());
    t.configure({ pipelineFactory: factory, modelName: 'base.en' });
    const percents: number[] = [];
    t.on('download', (e: WhisperDownloadEvent) => {
      if (e.kind === 'download:progress') percents.push(e.percent);
    });

    await t.downloadModel('base.en');

    // encoder done = 100/100 → capped at 99; both files start = 100/200 = 50;
    // both done = 200/200 → 99. Never resets to 0.
    expect(percents).toEqual([99, 50, 99]);
    expect(Math.min(...percents)).toBeGreaterThan(0);
  });

  it('emits download:error and rethrows when the pipeline fails to load', async () => {
    const factory: AsrPipelineFactory = async () => {
      throw new Error('load-boom');
    };
    const t = new WhisperTranscriber(makeLogger());
    t.configure({ pipelineFactory: factory });
    const events: WhisperDownloadEvent[] = [];
    t.on('download', (e: WhisperDownloadEvent) => events.push(e));

    await expect(t.downloadModel('base.en')).rejects.toThrow('load-boom');
    expect(events.at(-1)).toMatchObject({
      kind: 'download:error',
      model: 'base.en',
    });
  });

  it('rejects an unknown model name', async () => {
    const t = new WhisperTranscriber(makeLogger());
    await expect(t.downloadModel('not-a-model')).rejects.toThrow(
      /Unknown Whisper model/,
    );
  });

  describe('isModelDownloaded', () => {
    it('returns false when no cache dir is configured', async () => {
      const t = new WhisperTranscriber(makeLogger());
      expect(await t.isModelDownloaded('base.en')).toBe(false);
    });

    it('returns true when the model dir exists and is non-empty', async () => {
      const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-asr-'));
      try {
        const modelDir = path.join(cacheDir, 'Xenova', 'whisper-base.en');
        await fs.mkdir(modelDir, { recursive: true });
        await fs.writeFile(path.join(modelDir, 'config.json'), '{}');

        const t = new WhisperTranscriber(makeLogger());
        t.configure({ modelCacheDir: cacheDir });

        expect(await t.isModelDownloaded('base.en')).toBe(true);
        expect(await t.isModelDownloaded('small.en')).toBe(false);
      } finally {
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    });
  });
});
