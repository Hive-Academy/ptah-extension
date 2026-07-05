import 'reflect-metadata';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  FfmpegDecoder,
  WhisperTranscriber,
  KokoroSynthesizer,
} from '@ptah-extension/messaging-gateway';
import {
  VoiceAssetsUnavailableError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
} from '@ptah-extension/messaging-gateway';

import { VoiceRpcHandlers } from './voice-rpc.handlers';

interface StoredSettings {
  voiceModel?: string;
  legacyGatewayModel?: string;
  ttsVoice?: string;
}

interface Suite {
  handlers: VoiceRpcHandlers;
  rpc: MockRpcHandler;
  ffmpeg: jest.Mocked<FfmpegDecoder>;
  whisper: jest.Mocked<WhisperTranscriber>;
  kokoro: jest.Mocked<KokoroSynthesizer>;
  webviewManager: { broadcastMessage: jest.Mock };
  workspace: jest.Mocked<IWorkspaceProvider> & {
    setConfiguration: jest.Mock;
  };
  store: StoredSettings;
}

const VALID_BASE64 = Buffer.from('fake-audio-bytes').toString('base64');

function buildSuite(initial: StoredSettings = {}): Suite {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const rpc = createMockRpcHandler();

  const fakePcm = new Float32Array([0, 0.1, -0.1, 0.2]);
  const ffmpeg = {
    decodeToPcm16: jest.fn().mockResolvedValue(fakePcm),
  } as unknown as jest.Mocked<FfmpegDecoder>;

  const whisper = {
    configure: jest.fn(),
    transcribe: jest.fn().mockResolvedValue('hello world'),
    isModelDownloaded: jest.fn().mockResolvedValue(false),
    downloadModel: jest.fn().mockResolvedValue({ alreadyPresent: false }),
    on: jest.fn(),
    off: jest.fn(),
  } as unknown as jest.Mocked<WhisperTranscriber>;

  const kokoro = {
    configure: jest.fn(),
    synthesize: jest
      .fn()
      .mockResolvedValue({ wav: new Uint8Array([1, 2, 3]), sampleRate: 24000 }),
    isModelDownloaded: jest.fn().mockResolvedValue(false),
    downloadModel: jest.fn().mockResolvedValue({ alreadyPresent: false }),
    on: jest.fn(),
    off: jest.fn(),
  } as unknown as jest.Mocked<KokoroSynthesizer>;

  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  const store: StoredSettings = { ...initial };

  const getConfiguration = jest.fn(
    (_section: string, key: string, defaultValue?: unknown) => {
      if (key === 'voice.whisperModel') {
        return store.voiceModel ?? defaultValue;
      }
      if (key === 'gateway.voice.whisperModel') {
        return store.legacyGatewayModel ?? defaultValue;
      }
      if (key === 'voice.ttsVoice') {
        return store.ttsVoice ?? defaultValue;
      }
      return defaultValue;
    },
  );

  const setConfiguration = jest.fn(
    async (_section: string, key: string, value: unknown) => {
      if (key === 'voice.whisperModel') {
        store.voiceModel = value as string;
      } else if (key === 'gateway.voice.whisperModel') {
        store.legacyGatewayModel = value as string;
      } else if (key === 'voice.ttsVoice') {
        store.ttsVoice = value as string;
      }
    },
  );

  const workspace = {
    getConfiguration,
    setConfiguration,
  } as unknown as jest.Mocked<IWorkspaceProvider> & {
    setConfiguration: jest.Mock;
  };

  const handlers = new VoiceRpcHandlers(
    logger,
    rpc as unknown as RpcHandler,
    workspace,
    ffmpeg,
    whisper,
    kokoro,
    webviewManager,
  );
  handlers.register();
  return {
    handlers,
    rpc,
    ffmpeg,
    whisper,
    kokoro,
    webviewManager,
    workspace,
    store,
  };
}

describe('VoiceRpcHandlers', () => {
  describe('register()', () => {
    it('wires every method in METHODS onto the RpcHandler', () => {
      const { rpc } = buildSuite();
      const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
        (c) => c[0] as string,
      );
      for (const method of VoiceRpcHandlers.METHODS) {
        expect(registered).toContain(method);
      }
      expect(registered).toContain('voice:transcribe');
      expect(registered.length).toBe(VoiceRpcHandlers.METHODS.length);
    });
  });

  describe('voice:transcribe', () => {
    it('decodes, transcribes, and returns the transcript on the happy path', async () => {
      const { rpc, ffmpeg, whisper } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, transcript: 'hello world' });
      expect(ffmpeg.decodeToPcm16).toHaveBeenCalledTimes(1);
      expect(whisper.transcribe).toHaveBeenCalledWith(expect.any(Float32Array));
    });

    it('leaves no input temp file behind after a successful transcription', async () => {
      const { rpc } = buildSuite();
      const countVoiceFiles = async (): Promise<number> => {
        const entries = await fs.readdir(os.tmpdir());
        return entries.filter((e) => e.startsWith('ptah-voice-')).length;
      };

      const before = await countVoiceFiles();
      await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-cleanup',
      });
      const after = await countVoiceFiles();

      expect(after).toBeLessThanOrEqual(before);
    });

    it('configures the whisper model from the new voice key before transcribing', async () => {
      const { rpc, whisper } = buildSuite({ voiceModel: 'small.en' });

      await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/ogg' },
        correlationId: 'voice-2',
      });

      expect(whisper.configure).toHaveBeenCalledWith({ modelName: 'small.en' });
    });

    it('falls back to the legacy gateway key when the new key is unset', async () => {
      const { rpc, whisper } = buildSuite({ legacyGatewayModel: 'medium.en' });

      await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/ogg' },
        correlationId: 'voice-2b',
      });

      expect(whisper.configure).toHaveBeenCalledWith({
        modelName: 'medium.en',
      });
    });

    it('rejects invalid params (empty audioBase64) without invoking the pipeline', async () => {
      const { rpc, ffmpeg, whisper } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: '', mimeType: 'audio/webm' },
        correlationId: 'voice-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(ffmpeg.decodeToPcm16).not.toHaveBeenCalled();
      expect(whisper.transcribe).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when the decoder throws, without rejecting', async () => {
      const { rpc, ffmpeg, whisper } = buildSuite();
      (ffmpeg.decodeToPcm16 as jest.Mock).mockRejectedValue(
        new Error('ffmpeg-boom'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-4',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: false, error: 'ffmpeg-boom' });
      expect(whisper.transcribe).not.toHaveBeenCalled();
    });

    it('surfaces VOICE_ASSETS_UNAVAILABLE with remediation when assets are missing', async () => {
      const { rpc, ffmpeg, whisper } = buildSuite();
      (ffmpeg.decodeToPcm16 as jest.Mock).mockRejectedValue(
        new VoiceAssetsUnavailableError('ffmpeg-static'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-assets',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        ok: false,
        code: VOICE_ASSETS_UNAVAILABLE,
        remediation: VOICE_ASSETS_REMEDIATION,
      });
      expect(whisper.transcribe).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when the transcriber throws, without rejecting', async () => {
      const { rpc, whisper } = buildSuite();
      (whisper.transcribe as jest.Mock).mockRejectedValue(
        new Error('whisper-boom'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-5',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: false, error: 'whisper-boom' });
    });
  });

  describe('voice:getConfig', () => {
    it('returns the new voice.whisperModel value with download status when set', async () => {
      const { rpc, whisper } = buildSuite({ voiceModel: 'small.en' });
      (whisper.isModelDownloaded as jest.Mock).mockResolvedValue(true);

      const response = await rpc.handleMessage({
        method: 'voice:getConfig',
        params: {},
        correlationId: 'getcfg-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        config: { whisperModel: 'small.en', downloaded: true },
      });
      expect(whisper.isModelDownloaded).toHaveBeenCalledWith('small.en');
    });

    it('falls back to the legacy gateway key when the new key is unset', async () => {
      const { rpc } = buildSuite({ legacyGatewayModel: 'medium.en' });

      const response = await rpc.handleMessage({
        method: 'voice:getConfig',
        params: {},
        correlationId: 'getcfg-2',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        config: { whisperModel: 'medium.en', downloaded: false },
      });
    });

    it('returns base.en when neither key is set', async () => {
      const { rpc } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:getConfig',
        params: {},
        correlationId: 'getcfg-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        config: { whisperModel: 'base.en', downloaded: false },
      });
    });
  });

  describe('voice:downloadModel', () => {
    it('downloads the configured model and reports it was fetched', async () => {
      const { rpc, whisper } = buildSuite({ voiceModel: 'small.en' });

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, alreadyPresent: false });
      expect(whisper.downloadModel).toHaveBeenCalledWith('small.en');
    });

    it('downloads an explicitly requested model', async () => {
      const { rpc, whisper } = buildSuite();
      (whisper.downloadModel as jest.Mock).mockResolvedValue({
        alreadyPresent: true,
      });

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: { model: 'medium.en' },
        correlationId: 'dl-2',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, alreadyPresent: true });
      expect(whisper.downloadModel).toHaveBeenCalledWith('medium.en');
    });

    it('rejects an invalid model string without downloading', async () => {
      const { rpc, whisper } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: { model: 'bad model!' },
        correlationId: 'dl-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(whisper.downloadModel).not.toHaveBeenCalled();
    });

    it('broadcasts download progress ticks to the webview and detaches the listener', async () => {
      const { rpc, whisper, webviewManager } = buildSuite({
        voiceModel: 'small.en',
      });
      let captured: ((evt: unknown) => void) | undefined;
      (whisper.on as jest.Mock).mockImplementation(
        (event: string, listener: (evt: unknown) => void) => {
          if (event === 'download') captured = listener;
        },
      );
      (whisper.downloadModel as jest.Mock).mockImplementation(async () => {
        captured?.({
          kind: 'download:progress',
          model: 'small.en',
          percent: 42,
        });
        captured?.({ kind: 'download:progress', model: 'other', percent: 99 });
        return { alreadyPresent: false };
      });

      await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-progress',
      });

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'voice:modelDownloadProgress',
        { model: 'small.en', percent: 42 },
      );
      // The tick for a different model must be ignored.
      expect(webviewManager.broadcastMessage).toHaveBeenCalledTimes(1);
      expect(whisper.off).toHaveBeenCalledWith('download', captured);
    });

    it('broadcasts a terminal 100% tick on download:complete', async () => {
      const { rpc, whisper, webviewManager } = buildSuite({
        voiceModel: 'small.en',
      });
      let captured: ((evt: unknown) => void) | undefined;
      (whisper.on as jest.Mock).mockImplementation(
        (event: string, listener: (evt: unknown) => void) => {
          if (event === 'download') captured = listener;
        },
      );
      (whisper.downloadModel as jest.Mock).mockImplementation(async () => {
        captured?.({ kind: 'download:complete', model: 'small.en' });
        return { alreadyPresent: false };
      });

      await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-complete',
      });

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'voice:modelDownloadProgress',
        { model: 'small.en', percent: 100 },
      );
    });

    it('surfaces VOICE_ASSETS_UNAVAILABLE with remediation when assets are missing', async () => {
      const { rpc, whisper } = buildSuite();
      (whisper.downloadModel as jest.Mock).mockRejectedValue(
        new VoiceAssetsUnavailableError('@huggingface/transformers'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-4',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        ok: false,
        code: VOICE_ASSETS_UNAVAILABLE,
        remediation: VOICE_ASSETS_REMEDIATION,
      });
    });

    it('returns { ok: false } when the download throws, without rejecting', async () => {
      const { rpc, whisper } = buildSuite();
      (whisper.downloadModel as jest.Mock).mockRejectedValue(
        new Error('network-boom'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-5',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: false, error: 'network-boom' });
    });
  });

  describe('voice:setConfig', () => {
    it('writes the new voice.whisperModel key only', async () => {
      const { rpc, workspace, store } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setConfig',
        params: { whisperModel: 'small.en' },
        correlationId: 'setcfg-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true });
      expect(workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'voice.whisperModel',
        'small.en',
      );
      expect(store.voiceModel).toBe('small.en');
      expect(store.legacyGatewayModel).toBeUndefined();
    });

    it('rejects an invalid model string without writing', async () => {
      const { rpc, workspace } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setConfig',
        params: { whisperModel: 'bad model!' },
        correlationId: 'setcfg-2',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(workspace.setConfiguration).not.toHaveBeenCalled();
    });

    it('rejects an empty model string without writing', async () => {
      const { rpc, workspace } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setConfig',
        params: { whisperModel: '   ' },
        correlationId: 'setcfg-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(workspace.setConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('voice:getTtsConfig', () => {
    it('returns the configured voice and download status', async () => {
      const { rpc, kokoro } = buildSuite({ ttsVoice: 'am_michael' });
      (kokoro.isModelDownloaded as jest.Mock).mockResolvedValue(true);

      const response = await rpc.handleMessage({
        method: 'voice:getTtsConfig',
        params: {},
        correlationId: 'tts-cfg-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        config: { voice: 'am_michael', downloaded: true },
      });
    });

    it('falls back to the default voice when unset', async () => {
      const { rpc } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:getTtsConfig',
        params: {},
        correlationId: 'tts-cfg-2',
      });

      expect(response.data).toMatchObject({
        ok: true,
        config: { voice: 'af_heart' },
      });
    });
  });

  describe('voice:setTtsConfig', () => {
    it('writes the voice.ttsVoice key and reconfigures the synthesizer', async () => {
      const { rpc, workspace, store, kokoro } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setTtsConfig',
        params: { voice: 'bf_emma' },
        correlationId: 'tts-set-1',
      });

      expect(response.data).toEqual({ ok: true });
      expect(workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'voice.ttsVoice',
        'bf_emma',
      );
      expect(store.ttsVoice).toBe('bf_emma');
      expect(kokoro.configure).toHaveBeenCalledWith({ voice: 'bf_emma' });
    });

    it('rejects an invalid voice id without writing', async () => {
      const { rpc, workspace } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setTtsConfig',
        params: { voice: 'bad voice!' },
        correlationId: 'tts-set-2',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(workspace.setConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('voice:downloadTtsModel', () => {
    it('downloads and broadcasts progress under the tts sentinel', async () => {
      const { rpc, kokoro, webviewManager } = buildSuite();
      let captured: ((evt: unknown) => void) | undefined;
      (kokoro.on as jest.Mock).mockImplementation(
        (_evt: string, cb: (evt: unknown) => void) => {
          captured = cb;
        },
      );
      (kokoro.downloadModel as jest.Mock).mockImplementation(async () => {
        captured?.({
          kind: 'download:progress',
          model: 'whatever',
          percent: 42,
        });
        return { alreadyPresent: false };
      });

      const response = await rpc.handleMessage({
        method: 'voice:downloadTtsModel',
        params: {},
        correlationId: 'tts-dl-1',
      });

      expect(response.data).toEqual({ ok: true, alreadyPresent: false });
      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'voice:modelDownloadProgress',
        { model: 'tts', percent: 42 },
      );
      expect(kokoro.off).toHaveBeenCalledWith('download', captured);
    });

    it('maps VoiceAssetsUnavailableError to a coded result', async () => {
      const { rpc, kokoro } = buildSuite();
      (kokoro.downloadModel as jest.Mock).mockRejectedValue(
        new VoiceAssetsUnavailableError('kokoro-js'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:downloadTtsModel',
        params: {},
        correlationId: 'tts-dl-2',
      });

      expect(response.data).toMatchObject({
        ok: false,
        code: VOICE_ASSETS_UNAVAILABLE,
        remediation: VOICE_ASSETS_REMEDIATION,
      });
    });
  });

  describe('voice:synthesize', () => {
    it('returns base64 WAV for the given text and voice', async () => {
      const { rpc, kokoro } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hello there', voice: 'am_puck' },
        correlationId: 'tts-syn-1',
      });

      expect(response.data).toEqual({
        ok: true,
        audioBase64: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
        mimeType: 'audio/wav',
      });
      expect(kokoro.synthesize).toHaveBeenCalledWith('hello there', 'am_puck');
    });

    it('falls back to the configured voice when none is given', async () => {
      const { rpc, kokoro } = buildSuite({ ttsVoice: 'bf_emma' });

      await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-syn-2',
      });

      expect(kokoro.synthesize).toHaveBeenCalledWith('hi', 'bf_emma');
    });

    it('rejects empty text without synthesizing', async () => {
      const { rpc, kokoro } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: '' },
        correlationId: 'tts-syn-3',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(kokoro.synthesize).not.toHaveBeenCalled();
    });
  });
});
