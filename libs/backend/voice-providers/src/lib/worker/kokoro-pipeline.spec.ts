/**
 * Unit tests for KokoroPipeline — de-DI'd worker-side TTS pipeline
 * management moved from messaging-gateway's `KokoroSynthesizer`. The pipeline
 * factory is injected so these tests never load ONNX/kokoro-js or hit the
 * network.
 */
import { VoiceProviderError } from '@ptah-extension/voice-contracts';
import {
  KokoroPipeline,
  DEFAULT_KOKORO_MODEL_ID,
  DEFAULT_KOKORO_VOICE,
  type KokoroTts,
  type TtsPipelineFactory,
} from './kokoro-pipeline';

describe('KokoroPipeline', () => {
  function buildPipeline(factory?: TtsPipelineFactory) {
    const generate = jest.fn().mockResolvedValue({
      audio: new Float32Array([0.1, 0.2]),
      sampling_rate: 24000,
      toWav: () => new ArrayBuffer(4),
    });
    const tts: KokoroTts = { generate };
    const pipelineFactory: TtsPipelineFactory =
      factory ?? jest.fn().mockResolvedValue(tts);
    const pipeline = new KokoroPipeline({
      modelCacheDir: '/cache',
      pipelineFactory,
    });
    return { pipeline, generate, pipelineFactory };
  }

  describe('synthesize', () => {
    it('returns wav bytes and the source sample rate', async () => {
      const { pipeline } = buildPipeline();
      const result = await pipeline.synthesize(
        'hello',
        'af_heart',
        { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
        'q8',
      );
      expect(result.wav).toBeInstanceOf(Uint8Array);
      expect(result.sampleRate).toBe(24000);
    });

    it('falls back to the default voice when none is given', async () => {
      const { pipeline, generate } = buildPipeline();
      await pipeline.synthesize(
        'hello',
        '',
        { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
        'q8',
      );
      expect(generate).toHaveBeenCalledWith('hello', {
        voice: DEFAULT_KOKORO_VOICE,
      });
    });

    it('defaults an empty curated name to the default Kokoro repo id', async () => {
      const factory: TtsPipelineFactory = jest.fn().mockResolvedValue({
        generate: jest.fn().mockResolvedValue({
          audio: new Float32Array([0]),
          sampling_rate: 24000,
          toWav: () => new ArrayBuffer(4),
        }),
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.synthesize(
        'hi',
        'af_heart',
        { kind: 'curated', name: '' },
        'q8',
      );

      expect(factory).toHaveBeenCalledWith(
        DEFAULT_KOKORO_MODEL_ID,
        expect.anything(),
      );
    });

    it('resolves an hf VoiceModelSpec to the repo id verbatim', async () => {
      const factory: TtsPipelineFactory = jest.fn().mockResolvedValue({
        generate: jest.fn().mockResolvedValue({
          audio: new Float32Array([0]),
          sampling_rate: 24000,
          toWav: () => new ArrayBuffer(4),
        }),
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.synthesize(
        'hi',
        'af_heart',
        { kind: 'hf', repoId: 'my-org/kokoro-custom' },
        'q8',
      );

      expect(factory).toHaveBeenCalledWith(
        'my-org/kokoro-custom',
        expect.objectContaining({
          allowLocalModels: false,
          localModelPath: null,
        }),
      );
    });

    it('resolves a dir VoiceModelSpec to allowLocalModels + localModelPath', async () => {
      const factory: TtsPipelineFactory = jest.fn().mockResolvedValue({
        generate: jest.fn().mockResolvedValue({
          audio: new Float32Array([0]),
          sampling_rate: 24000,
          toWav: () => new ArrayBuffer(4),
        }),
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.synthesize(
        'hi',
        'af_heart',
        { kind: 'dir', path: '/models/my-kokoro' },
        'q8',
      );

      const [modelId, opts] = (factory as jest.Mock).mock.calls[0] as [
        string,
        { allowLocalModels: boolean; localModelPath: string | null },
      ];
      expect(modelId).toBe('my-kokoro');
      expect(opts.allowLocalModels).toBe(true);
      expect(opts.localModelPath).toBe('/models');
    });
  });

  describe('pipeline caching', () => {
    it('reuses the loaded pipeline for the same model spec + dtype', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      const model = { kind: 'curated' as const, name: DEFAULT_KOKORO_MODEL_ID };
      await pipeline.synthesize('a', 'af_heart', model, 'q8');
      await pipeline.synthesize('b', 'af_heart', model, 'q8');
      expect(pipelineFactory).toHaveBeenCalledTimes(1);
    });

    it('reloads when the dtype changes even for the same model spec', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      const model = { kind: 'curated' as const, name: DEFAULT_KOKORO_MODEL_ID };
      await pipeline.synthesize('a', 'af_heart', model, 'q8');
      await pipeline.synthesize('a', 'af_heart', model, 'fp32');
      expect(pipelineFactory).toHaveBeenCalledTimes(2);
    });
  });

  describe('progress aggregation', () => {
    it('aggregates per-file byte progress into a monotonic percent', async () => {
      const ticks: number[] = [];
      const factory: TtsPipelineFactory = jest.fn(async (_modelId, opts) => {
        opts.progress_callback({
          status: 'download',
          file: 'a.bin',
          loaded: 40,
          total: 100,
        });
        opts.progress_callback({
          status: 'download',
          file: 'a.bin',
          loaded: 100,
          total: 100,
        });
        return {
          generate: jest.fn().mockResolvedValue({
            audio: new Float32Array([0]),
            sampling_rate: 24000,
            toWav: () => new ArrayBuffer(4),
          }),
        };
      });
      const { pipeline } = buildPipeline(factory);

      await pipeline.synthesize(
        'hi',
        'af_heart',
        { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
        'q8',
        (percent) => ticks.push(percent),
      );

      expect(ticks).toEqual([40, 99]);
    });
  });

  describe('error mapping', () => {
    it('propagates an assets-unavailable VoiceProviderError from the pipeline factory unchanged', async () => {
      // The default pipeline factory maps a MODULE_NOT_FOUND dynamic-import
      // failure (missing @huggingface/transformers or kokoro-js) to this
      // error; the injected-factory seam here asserts ensurePipeline() passes
      // a VoiceProviderError through verbatim rather than re-wrapping it.
      const assetsError = new VoiceProviderError(
        'assets-unavailable',
        'local',
        'Voice asset "kokoro-js" is not available.',
      );
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockRejectedValue(assetsError);
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
          'q8',
        ),
      ).rejects.toBe(assetsError);
    });

    it('maps voices/<name>.bin ENOENT during generate to assets-unavailable naming the voice', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file'), {
        code: 'ENOENT',
        path: '/app/node_modules/kokoro-js/voices/af_heart.bin',
      });
      const generate = jest.fn().mockRejectedValue(enoent);
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockResolvedValue({ generate });
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
          'q8',
        ),
      ).rejects.toMatchObject({
        category: 'assets-unavailable',
        providerId: 'local',
        message: expect.stringContaining('af_heart.bin'),
      });
    });

    it('does not misclassify an unrelated ENOENT as the voice-bin mapping', async () => {
      const enoent = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT',
        path: '/some/other/file.txt',
      });
      const generate = jest.fn().mockRejectedValue(enoent);
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockResolvedValue({ generate });
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
          'q8',
        ),
      ).rejects.toBe(enoent);
    });

    it('wraps an hf load failure as model-invalid, naming the failing repo', async () => {
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('boom'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'hf', repoId: 'bad/kokoro' },
          'q8',
        ),
      ).rejects.toMatchObject({
        category: 'model-invalid',
        providerId: 'local',
        message: expect.stringContaining('bad/kokoro'),
      });
    });

    it('wraps a dir load failure as model-invalid, naming the failing directory', async () => {
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('boom'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'dir', path: '/missing/kokoro-dir' },
          'q8',
        ),
      ).rejects.toMatchObject({
        category: 'model-invalid',
        providerId: 'local',
        message: expect.stringContaining('/missing/kokoro-dir'),
      });
    });

    it('does NOT wrap a curated model load failure as model-invalid', async () => {
      const factory: TtsPipelineFactory = jest
        .fn()
        .mockRejectedValue(new Error('network down'));
      const { pipeline } = buildPipeline(factory);

      await expect(
        pipeline.synthesize(
          'hi',
          'af_heart',
          { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
          'q8',
        ),
      ).rejects.toThrow('network down');
    });
  });

  describe('ensureDownloaded', () => {
    it('eagerly loads the pipeline without synthesizing', async () => {
      const { pipeline, pipelineFactory } = buildPipeline();
      await pipeline.ensureDownloaded(
        { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID },
        'q8',
      );
      expect(pipelineFactory).toHaveBeenCalledTimes(1);
    });
  });
});
