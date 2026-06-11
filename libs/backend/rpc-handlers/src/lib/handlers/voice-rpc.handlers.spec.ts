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
}

interface Suite {
  handlers: VoiceRpcHandlers;
  rpc: MockRpcHandler;
  ffmpeg: jest.Mocked<FfmpegDecoder>;
  whisper: jest.Mocked<WhisperTranscriber>;
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

  const ffmpeg = {
    decodeToPcm16Wav: jest
      .fn()
      .mockResolvedValue('/tmp/ptah-voice-x/audio.wav'),
  } as unknown as jest.Mocked<FfmpegDecoder>;

  const whisper = {
    configure: jest.fn(),
    transcribe: jest.fn().mockResolvedValue('hello world'),
  } as unknown as jest.Mocked<WhisperTranscriber>;

  const store: StoredSettings = { ...initial };

  const getConfiguration = jest.fn(
    (_section: string, key: string, defaultValue?: unknown) => {
      if (key === 'voice.whisperModel') {
        return store.voiceModel ?? defaultValue;
      }
      if (key === 'gateway.voice.whisperModel') {
        return store.legacyGatewayModel ?? defaultValue;
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
  );
  handlers.register();
  return { handlers, rpc, ffmpeg, whisper, workspace, store };
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
      expect(ffmpeg.decodeToPcm16Wav).toHaveBeenCalledTimes(1);
      expect(whisper.transcribe).toHaveBeenCalledWith(
        '/tmp/ptah-voice-x/audio.wav',
      );
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
      expect(ffmpeg.decodeToPcm16Wav).not.toHaveBeenCalled();
      expect(whisper.transcribe).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when the decoder throws, without rejecting', async () => {
      const { rpc, ffmpeg, whisper } = buildSuite();
      (ffmpeg.decodeToPcm16Wav as jest.Mock).mockRejectedValue(
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
      (ffmpeg.decodeToPcm16Wav as jest.Mock).mockRejectedValue(
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
    it('returns the new voice.whisperModel value when set', async () => {
      const { rpc } = buildSuite({ voiceModel: 'large-v3' });

      const response = await rpc.handleMessage({
        method: 'voice:getConfig',
        params: {},
        correlationId: 'getcfg-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        config: { whisperModel: 'large-v3' },
      });
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
        config: { whisperModel: 'medium.en' },
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
        config: { whisperModel: 'base.en' },
      });
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
});
