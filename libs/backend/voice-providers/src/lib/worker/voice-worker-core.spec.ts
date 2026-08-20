/**
 * Unit tests for VoiceWorkerCore — the pure protocol dispatcher. Pipelines and
 * ffmpeg decode are injected fakes so these tests never touch ONNX, kokoro-js,
 * or a real child process.
 */
import { VoiceProviderError } from '@ptah-extension/voice-contracts';
import { VoiceWorkerCore, type VoiceWorkerCoreDeps } from './voice-worker-core';
import type { WhisperPipeline } from './whisper-pipeline';
import type { KokoroPipeline } from './kokoro-pipeline';
import type { FfmpegDecode } from './ffmpeg-decode';
import type {
  VoiceWorkerInbound,
  VoiceWorkerOutbound,
} from './voice-worker-protocol';

interface FakeWhisper {
  transcribe: jest.Mock;
  ensureDownloaded: jest.Mock;
}
interface FakeKokoro {
  synthesize: jest.Mock;
  ensureDownloaded: jest.Mock;
}
interface FakeFfmpeg {
  decodeToPcm16: jest.Mock;
}

interface Rig {
  core: VoiceWorkerCore;
  posted: VoiceWorkerOutbound[];
  whisper: FakeWhisper;
  kokoro: FakeKokoro;
  ffmpeg: FakeFfmpeg;
  createWhisper: jest.Mock;
  createKokoro: jest.Mock;
  createFfmpeg: jest.Mock;
}

function buildRig(): Rig {
  const posted: VoiceWorkerOutbound[] = [];
  const whisper: FakeWhisper = {
    transcribe: jest.fn().mockResolvedValue('hello world'),
    ensureDownloaded: jest.fn().mockResolvedValue(undefined),
  };
  const kokoro: FakeKokoro = {
    synthesize: jest
      .fn()
      .mockResolvedValue({ wav: new Uint8Array([1, 2, 3]), sampleRate: 24000 }),
    ensureDownloaded: jest.fn().mockResolvedValue(undefined),
  };
  const ffmpeg: FakeFfmpeg = {
    decodeToPcm16: jest.fn().mockResolvedValue(new Float32Array([0, 0.5])),
  };

  const createWhisper = jest.fn(() => whisper as unknown as WhisperPipeline);
  const createKokoro = jest.fn(() => kokoro as unknown as KokoroPipeline);
  const createFfmpeg = jest.fn(() => ffmpeg as unknown as FfmpegDecode);

  const deps: VoiceWorkerCoreDeps = {
    post: (msg) => posted.push(msg),
    createWhisper,
    createKokoro,
    createFfmpeg,
  };

  const core = new VoiceWorkerCore(deps);
  return { core, posted, whisper, kokoro, ffmpeg, createWhisper, createKokoro, createFfmpeg };
}

/** Flush the microtask + macrotask queue so fire-and-forget dispatch settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function init(core: VoiceWorkerCore, overrides: Partial<VoiceWorkerInbound> = {}): void {
  core.handleMessage({
    type: 'init',
    ffmpegPath: '/usr/bin/ffmpeg',
    modelCacheDir: '/cache',
    ...overrides,
  } as VoiceWorkerInbound);
}

describe('VoiceWorkerCore', () => {
  describe('init', () => {
    it('constructs pipelines via the injected factories with the init config', () => {
      const { core, createWhisper, createKokoro, createFfmpeg } = buildRig();
      init(core, { modelCacheDir: '/my/cache', ffmpegPath: '/bin/ffmpeg' });

      expect(createWhisper).toHaveBeenCalledWith('/my/cache');
      expect(createKokoro).toHaveBeenCalledWith('/my/cache');
      expect(createFfmpeg).toHaveBeenCalledWith('/bin/ffmpeg');
    });
  });

  describe('stt:transcribe', () => {
    it('decodes then transcribes, echoing the request id', async () => {
      const { core, posted, ffmpeg, whisper } = buildRig();
      init(core);

      core.handleMessage({
        id: 7,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();

      expect(ffmpeg.decodeToPcm16).toHaveBeenCalledWith('/tmp/a.webm');
      expect(whisper.transcribe).toHaveBeenCalledWith(
        expect.any(Float32Array),
        { kind: 'curated', name: 'base.en' },
        expect.any(Function),
      );
      expect(posted).toContainEqual({ id: 7, ok: true, text: 'hello world' });
    });

    it('forwards whisper progress ticks as download-progress messages keyed by the model display name', async () => {
      const { core, posted, whisper } = buildRig();
      init(core);
      whisper.transcribe.mockImplementation(
        async (_pcm: Float32Array, _model: unknown, onProgress: (p: number) => void) => {
          onProgress(50);
          return 'partial';
        },
      );

      core.handleMessage({
        id: 1,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'hf', repoId: 'my-org/whisper-custom' },
      });
      await flush();

      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'stt',
        model: 'my-org/whisper-custom',
        kind: 'download:progress',
        percent: 50,
      });
    });

    it('reports "voice worker not initialized" without an init message, categorized as provider-error', async () => {
      const { core, posted } = buildRig();

      core.handleMessage({
        id: 2,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();

      expect(posted).toContainEqual({
        id: 2,
        ok: false,
        error: 'voice worker not initialized',
        category: 'provider-error',
      });
    });

    it('serializes the VoiceErrorCategory from a thrown VoiceProviderError', async () => {
      const { core, posted, ffmpeg } = buildRig();
      init(core);
      ffmpeg.decodeToPcm16.mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "ffmpeg-static" is not available.',
        ),
      );

      core.handleMessage({
        id: 3,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();

      expect(posted).toContainEqual({
        id: 3,
        ok: false,
        error: 'Voice asset "ffmpeg-static" is not available.',
        category: 'assets-unavailable',
      });
    });

    it('defaults to provider-error category for a plain thrown Error', async () => {
      const { core, posted, ffmpeg } = buildRig();
      init(core);
      ffmpeg.decodeToPcm16.mockRejectedValue(new Error('boom'));

      core.handleMessage({
        id: 4,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();

      expect(posted).toContainEqual({
        id: 4,
        ok: false,
        error: 'boom',
        category: 'provider-error',
      });
    });
  });

  describe('tts:synthesize', () => {
    it('synthesizes and echoes the request id with wav bytes + sample rate', async () => {
      const { core, posted, kokoro } = buildRig();
      init(core);

      core.handleMessage({
        id: 10,
        type: 'tts:synthesize',
        text: 'hello',
        voice: 'af_heart',
        model: { kind: 'curated', name: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
        dtype: 'q8',
      });
      await flush();

      expect(kokoro.synthesize).toHaveBeenCalledWith(
        'hello',
        'af_heart',
        { kind: 'curated', name: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
        'q8',
        expect.any(Function),
      );
      expect(posted).toContainEqual({
        id: 10,
        ok: true,
        wav: new Uint8Array([1, 2, 3]),
        sampleRate: 24000,
      });
    });

    it('forwards kokoro progress ticks under the tts direction using the dir model display name', async () => {
      const { core, posted, kokoro } = buildRig();
      init(core);
      kokoro.synthesize.mockImplementation(
        async (
          _t: string,
          _v: string,
          _m: unknown,
          _d: string,
          onProgress: (p: number) => void,
        ) => {
          onProgress(75);
          return { wav: new Uint8Array([9]), sampleRate: 22050 };
        },
      );

      core.handleMessage({
        id: 11,
        type: 'tts:synthesize',
        text: 'hi',
        voice: 'af_heart',
        model: { kind: 'dir', path: '/models/my-kokoro' },
        dtype: 'q8',
      });
      await flush();

      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'tts',
        model: '/models/my-kokoro',
        kind: 'download:progress',
        percent: 75,
      });
    });
  });

  describe('stt:download / tts:download', () => {
    it('wraps a successful stt download with start + complete lifecycle events, then the id response', async () => {
      const { core, posted, whisper } = buildRig();
      init(core);

      core.handleMessage({
        id: 20,
        type: 'stt:download',
        model: { kind: 'curated', name: 'small.en' },
      });
      await flush();

      expect(whisper.ensureDownloaded).toHaveBeenCalledWith(
        { kind: 'curated', name: 'small.en' },
        expect.any(Function),
      );
      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'stt',
        model: 'small.en',
        kind: 'download:start',
      });
      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'stt',
        model: 'small.en',
        kind: 'download:complete',
      });
      expect(posted).toContainEqual({ id: 20, ok: true, alreadyPresent: false });
    });

    it('wraps a successful tts download with start + complete lifecycle events', async () => {
      const { core, posted, kokoro } = buildRig();
      init(core);

      core.handleMessage({
        id: 21,
        type: 'tts:download',
        model: { kind: 'hf', repoId: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
        dtype: 'fp32',
      });
      await flush();

      expect(kokoro.ensureDownloaded).toHaveBeenCalledWith(
        { kind: 'hf', repoId: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
        'fp32',
        expect.any(Function),
      );
      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'tts',
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        kind: 'download:start',
      });
      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'tts',
        model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        kind: 'download:complete',
      });
    });

    it('emits a download:error lifecycle event and re-throws when the download fails', async () => {
      const { core, posted, whisper } = buildRig();
      init(core);
      whisper.ensureDownloaded.mockRejectedValue(
        new VoiceProviderError(
          'model-invalid',
          'local',
          'Failed to load Whisper model from bad/repo.',
        ),
      );

      core.handleMessage({
        id: 22,
        type: 'stt:download',
        model: { kind: 'hf', repoId: 'bad/repo' },
      });
      await flush();

      expect(posted).toContainEqual({
        type: 'download-progress',
        direction: 'stt',
        model: 'bad/repo',
        kind: 'download:error',
        error: 'Failed to load Whisper model from bad/repo.',
      });
      expect(posted).toContainEqual({
        id: 22,
        ok: false,
        error: 'Failed to load Whisper model from bad/repo.',
        category: 'model-invalid',
      });
    });
  });

  describe('dispose', () => {
    it('clears the pipelines and responds ok:true, requiring re-init before further requests', async () => {
      const { core, posted } = buildRig();
      init(core);

      core.handleMessage({ id: 30, type: 'dispose' });
      await flush();
      expect(posted).toContainEqual({ id: 30, ok: true, alreadyPresent: true });

      core.handleMessage({
        id: 31,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();
      expect(posted).toContainEqual({
        id: 31,
        ok: false,
        error: 'voice worker not initialized',
        category: 'provider-error',
      });
    });
  });

  describe('unknown message type', () => {
    it('responds ok:false with the request id when present', async () => {
      const { core, posted } = buildRig();
      init(core);

      core.handleMessage({ id: 40, type: 'bogus' } as unknown as VoiceWorkerInbound);
      await flush();

      expect(posted).toContainEqual({
        id: 40,
        ok: false,
        error: 'unknown message type: bogus',
        category: 'provider-error',
      });
    });

    it('falls back to id -1 when the request carries no numeric id', async () => {
      const { core, posted } = buildRig();
      init(core);

      core.handleMessage({ type: 'bogus' } as unknown as VoiceWorkerInbound);
      await flush();

      expect(posted).toContainEqual({
        id: -1,
        ok: false,
        error: 'unknown message type: bogus',
        category: 'provider-error',
      });
    });
  });

  describe('id correlation', () => {
    it('correlates each response to its own request id across interleaved calls', async () => {
      const { core, posted, ffmpeg, whisper } = buildRig();
      init(core);
      ffmpeg.decodeToPcm16.mockImplementation(async (audioPath: string) =>
        audioPath.endsWith('a.webm')
          ? new Float32Array([0])
          : new Float32Array([0, 0, 0]),
      );
      whisper.transcribe.mockImplementation(async (pcm: Float32Array) =>
        pcm.length === 1 ? 'first' : 'second',
      );

      core.handleMessage({
        id: 100,
        type: 'stt:transcribe',
        audioPath: '/tmp/a.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      core.handleMessage({
        id: 101,
        type: 'stt:transcribe',
        audioPath: '/tmp/b.webm',
        model: { kind: 'curated', name: 'base.en' },
      });
      await flush();

      expect(posted).toContainEqual({ id: 100, ok: true, text: 'first' });
      expect(posted).toContainEqual({ id: 101, ok: true, text: 'second' });
    });
  });
});
