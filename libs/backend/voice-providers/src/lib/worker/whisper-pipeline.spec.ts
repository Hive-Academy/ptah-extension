/**
 * Unit tests for WhisperPipeline — de-DI'd worker-side ASR pipeline
 * management moved from messaging-gateway's `WhisperTranscriber`. The
 * pipeline factory is injected so these tests never load ONNX or hit the
 * network.
 */
import { VoiceProviderError } from '@ptah-extension/voice-contracts';
import {
  WhisperPipeline,
  whisperModelIdFor,
  WHISPER_MODELS,
  type AsrPipelineFactory,
  type PipelineProgressInfo,
} from './whisper-pipeline';

describe('whisperModelIdFor', () => {
  it('maps curated model names to their Xenova repo by default', () => {
    expect(whisperModelIdFor('base.en')).toBe('Xenova/whisper-base.en');
    expect(whisperModelIdFor('small')).toBe('Xenova/whisper-small');
  });

  it('overrides large-v3-turbo to the onnx-community repo (Xenova 401s)', () => {
    expect(whisperModelIdFor('large-v3-turbo')).toBe(
      'onnx-community/whisper-large-v3-turbo',
    );
  });

  it('lists the curated whisper model names', () => {
    expect(WHISPER_MODELS.has('base.en')).toBe(true);
    expect(WHISPER_MODELS.has('large-v3-turbo')).toBe(true);
    expect(WHISPER_MODELS.has('not-a-model')).toBe(false);
  });
});

describe('WhisperPipeline', () => {
  function buildPipeline(factory?: AsrPipelineFactory) {
    const asr = jest
      .fn()
      .mockResolvedValue({ text: '[BLANK_AUDIO] hello world ' });
    const pipelineFactory: AsrPipelineFactory =
      factory ?? jest.fn().mockResolvedValue(asr);
    const pipeline = new WhisperPipeline({
      modelCacheDir: '/cache',
      pipelineFactory,
    });
    return { pipeline, asr, pipelineFactory };
  }

  describe('transcribe', () => {
    it('strips bracketed tags and trims the transcript', async () => {
      const { pipeline } = buildPipeline();
      const text = await pipeline.transcribe(new Float32Array([0, 0.1]), {
        kind: 'curated',
        name: 'base.en',
      });
      expect(text).toBe('hello world');
    });

    it('handles a raw string pipeline result (no .text wrapper)', async () => {
      const asr = jest
        .fn()
        .mockResolvedValue('  [MUSIC] plain string result  ');
      const factory: AsrPipelineFactory = jest.fn().mockResolvedValue(asr);
      const { pipeline } = buildPipeline(factory);
      const text = await pipeline.transcribe(new Float32Array([0]), {
        kind: 'curated',
        name: 'base.en',
      });
      expect(text).toBe('plain string result');
    });

    it('resolves an hf VoiceModelSpec to the repo id verbatim, no cache dir/local-models', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockResolvedValue(jest.fn().mockResolvedValue({ text: 'ok' }));
      const { pipeline } = buildPipeline(factory);
      await pipeline.transcribe(new Float32Array([0]), {
        kind: 'hf',
        repoId: 'my-org/whisper-custom',
      });

      expect(factory).toHaveBeenCalledWith(
        'my-org/whisper-custom',
        expect.objectContaining({
          allowLocalModels: false,
          localModelPath: null,
        }),
      );
    });

    it('resolves a dir VoiceModelSpec to allowLocalModels + localModelPath', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockResolvedValue(jest.fn().mockResolvedValue({ text: 'ok' }));
      const { pipeline } = buildPipeline(factory);
      await pipeline.transcribe(new Float32Array([0]), {
        kind: 'dir',
        path: '/models/my-whisper',
      });

      const [modelId, opts] = (factory as jest.Mock).mock.calls[0] as [
        string,
        { allowLocalModels: boolean; localModelPath: string | null },
      ];
      expect(modelId).toBe('my-whisper');
      expect(opts.allowLocalModels).toBe(true);
      expect(opts.localModelPath).toBe('/models');
    });
  });

  describe('pipeline caching', () => {
    it('reuses the loaded pipeline for the same model spec', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      const model = { kind: 'curated' as const, name: 'base.en' };
      await pipeline.transcribe(new Float32Array([0]), model);
      await pipeline.transcribe(new Float32Array([0]), model);
      expect(pipelineFactory).toHaveBeenCalledTimes(1);
    });

    it('reloads when the model spec changes', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      await pipeline.transcribe(new Float32Array([0]), {
        kind: 'curated',
        name: 'base.en',
      });
      await pipeline.transcribe(new Float32Array([0]), {
        kind: 'curated',
        name: 'small.en',
      });
      expect(pipelineFactory).toHaveBeenCalledTimes(2);
    });
  });

  describe('progress aggregation', () => {
    it('reports a monotonic percent aggregated across multiple files by summed bytes', async () => {
      const ticks: number[] = [];
      const factory: AsrPipelineFactory = jest.fn(async (_modelId, opts) => {
        opts.progress_callback({
          status: 'download',
          file: 'a.bin',
          loaded: 50,
          total: 100,
        });
        opts.progress_callback({
          status: 'download',
          file: 'b.bin',
          loaded: 25,
          total: 100,
        });
        opts.progress_callback({
          status: 'download',
          file: 'a.bin',
          loaded: 100,
          total: 100,
        });
        return jest.fn().mockResolvedValue({ text: 'ok' });
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.transcribe(
        new Float32Array([0]),
        { kind: 'curated', name: 'base.en' },
        (percent) => ticks.push(percent),
      );

      // a:50/100 -> 50/100=50; +b:25/100 -> (50+25)/200=37.5~38; a updated to 100/100 -> (100+25)/200=62.5~63
      expect(ticks).toEqual([50, 38, 63]);
      expect(ticks.every((p) => p >= 0 && p <= 99)).toBe(true);
    });

    it('falls back to the raw progress field when byte counts are absent', async () => {
      const ticks: number[] = [];
      const factory: AsrPipelineFactory = jest.fn(async (_modelId, opts) => {
        opts.progress_callback({
          status: 'progress',
          progress: 55,
        } as PipelineProgressInfo);
        return jest.fn().mockResolvedValue({ text: 'ok' });
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.transcribe(
        new Float32Array([0]),
        { kind: 'curated', name: 'base.en' },
        (percent) => ticks.push(percent),
      );

      expect(ticks).toEqual([55]);
    });

    it('clamps percent to a max of 99', async () => {
      const ticks: number[] = [];
      const factory: AsrPipelineFactory = jest.fn(async (_modelId, opts) => {
        opts.progress_callback({
          status: 'download',
          file: 'a.bin',
          loaded: 100,
          total: 100,
        });
        return jest.fn().mockResolvedValue({ text: 'ok' });
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.transcribe(
        new Float32Array([0]),
        { kind: 'curated', name: 'base.en' },
        (percent) => ticks.push(percent),
      );

      expect(ticks).toEqual([99]);
    });
  });

  describe('error mapping', () => {
    it('propagates an assets-unavailable VoiceProviderError from the pipeline factory unchanged', async () => {
      // The default pipeline factory maps a MODULE_NOT_FOUND dynamic-import
      // failure (missing @huggingface/transformers) to this error; the
      // injected-factory seam here asserts ensurePipeline() passes a
      // VoiceProviderError through verbatim rather than re-wrapping it.
      const assetsError = new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "@huggingface/transformers" is not available.',
      );
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValue(assetsError);
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.transcribe(new Float32Array([0]), {
          kind: 'curated',
          name: 'base.en',
        }),
      ).rejects.toBe(assetsError);
    });

    it('does not re-wrap an assets-unavailable error even for hf/dir model specs', async () => {
      const assetsError = new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "@huggingface/transformers" is not available.',
      );
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValue(assetsError);
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.transcribe(new Float32Array([0]), {
          kind: 'hf',
          repoId: 'my-org/whisper-custom',
        }),
      ).rejects.toBe(assetsError);
    });

    it('wraps an hf load failure as model-invalid, naming the failing repo', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('HTTP 401'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.transcribe(new Float32Array([0]), {
          kind: 'hf',
          repoId: 'bad-org/whisper-x',
        }),
      ).rejects.toMatchObject({
        category: 'model-invalid',
        providerId: 'local',
        message: expect.stringContaining('bad-org/whisper-x'),
      });
    });

    it('wraps a dir load failure as model-invalid, naming the failing directory', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('ENOENT'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.transcribe(new Float32Array([0]), {
          kind: 'dir',
          path: '/missing/model-dir',
        }),
      ).rejects.toMatchObject({
        category: 'model-invalid',
        providerId: 'local',
        message: expect.stringContaining('/missing/model-dir'),
      });
    });

    it('does NOT wrap a curated model load failure as model-invalid (passes the raw error through)', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('network unreachable'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.transcribe(new Float32Array([0]), {
          kind: 'curated',
          name: 'base.en',
        }),
      ).rejects.toThrow('network unreachable');
    });

    it('resets the cache key on failure so the next call retries the load', async () => {
      const factory: AsrPipelineFactory = jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(jest.fn().mockResolvedValue({ text: 'ok' }));
      const { pipeline } = buildPipeline(factory);
      const model = { kind: 'curated' as const, name: 'base.en' };

      await expect(
        pipeline.transcribe(new Float32Array([0]), model),
      ).rejects.toThrow('transient');
      await expect(
        pipeline.transcribe(new Float32Array([0]), model),
      ).resolves.toBe('ok');
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureDownloaded', () => {
    it('eagerly loads the pipeline without transcribing', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      await pipeline.ensureDownloaded({ kind: 'curated', name: 'base.en' });
      expect(pipelineFactory).toHaveBeenCalledTimes(1);
    });
  });
});
