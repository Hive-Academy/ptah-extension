import 'reflect-metadata';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  VoiceProviderError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
  type ISpeechToTextProvider,
  type ITextToSpeechProvider,
  type IVoiceDownloadEventSource,
  type IVoiceProviderRegistry,
  type IVoiceProviderSelector,
  type VoiceDownloadEvent,
  type VoiceEventDisposable,
  type VoiceProviderCapability,
} from '@ptah-extension/voice-contracts';

import { VoiceRpcHandlers } from './voice-rpc.handlers';

interface StoredSettings {
  voiceModel?: string;
  legacyGatewayModel?: string;
  ttsVoice?: string;
}

/**
 * Fake `IVoiceDownloadEventSource` that records subscriptions so tests can
 * drive `download-progress` ticks directly (mirrors the old `whisper.on`/
 * `kokoro.on` capture pattern, now at the provider-agnostic port boundary).
 */
interface FakeDownloadEvents extends IVoiceDownloadEventSource {
  emit(evt: VoiceDownloadEvent): void;
  listenerCount(): number;
}

function createFakeDownloadEvents(): FakeDownloadEvents {
  const listeners = new Set<(e: VoiceDownloadEvent) => void>();
  return {
    onDownload: jest.fn(
      (listener: (e: VoiceDownloadEvent) => void): VoiceEventDisposable => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    ),
    emit: (evt: VoiceDownloadEvent) => {
      for (const listener of Array.from(listeners)) listener(evt);
    },
    listenerCount: () => listeners.size,
  };
}

function makeCapability(
  overrides: Partial<VoiceProviderCapability> = {},
): VoiceProviderCapability {
  return {
    id: 'local',
    label: 'Local (Whisper / Kokoro)',
    kind: 'local',
    requiresDownload: true,
    requiresApiKey: false,
    supports: { tts: true, stt: true },
    available: true,
    ...overrides,
  };
}

interface Suite {
  handlers: VoiceRpcHandlers;
  rpc: MockRpcHandler;
  stt: jest.Mocked<ISpeechToTextProvider>;
  tts: jest.Mocked<ITextToSpeechProvider>;
  selector: jest.Mocked<IVoiceProviderSelector>;
  registry: jest.Mocked<IVoiceProviderRegistry>;
  downloadEvents: FakeDownloadEvents;
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

  const stt = {
    capability: makeCapability(),
    isReady: jest.fn().mockResolvedValue({ ready: false }),
    transcribe: jest.fn().mockResolvedValue({ text: 'hello world' }),
    downloadModel: jest.fn().mockResolvedValue({ alreadyPresent: false }),
  } as unknown as jest.Mocked<ISpeechToTextProvider>;

  const tts = {
    capability: makeCapability(),
    isReady: jest.fn().mockResolvedValue({ ready: false }),
    synthesize: jest.fn().mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      sampleRate: 24000,
    }),
    listVoices: jest.fn().mockResolvedValue([]),
    downloadModel: jest.fn().mockResolvedValue({ alreadyPresent: false }),
  } as unknown as jest.Mocked<ITextToSpeechProvider>;

  const downloadEvents = createFakeDownloadEvents();

  const selector = {
    activeTts: jest.fn(() => tts),
    activeStt: jest.fn(() => stt),
    activeProviderId: jest.fn().mockReturnValue('local'),
    setProvider: jest.fn().mockResolvedValue(undefined),
    downloadEvents,
  } as unknown as jest.Mocked<IVoiceProviderSelector>;

  const registry = {
    listProviders: jest.fn().mockReturnValue([makeCapability()]),
    getTts: jest.fn(() => tts),
    getStt: jest.fn(() => stt),
  } as unknown as jest.Mocked<IVoiceProviderRegistry>;

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
    selector,
    registry,
    webviewManager,
  );
  handlers.register();
  return {
    handlers,
    rpc,
    stt,
    tts,
    selector,
    registry,
    downloadEvents,
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
    it('routes through the active STT provider and returns the transcript on the happy path', async () => {
      const { rpc, stt, selector } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, transcript: 'hello world' });
      expect(selector.activeStt).toHaveBeenCalledTimes(1);
      expect(stt.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPath: expect.any(String),
          mimeType: 'audio/webm',
        }),
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

    it('rejects invalid params (empty audioBase64) without invoking the provider', async () => {
      const { rpc, stt } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: '', mimeType: 'audio/webm' },
        correlationId: 'voice-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(stt.transcribe).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when the provider throws a plain error, without rejecting', async () => {
      const { rpc, stt } = buildSuite();
      (stt.transcribe as jest.Mock).mockRejectedValue(
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

    it('surfaces VOICE_ASSETS_UNAVAILABLE with remediation when local assets are missing', async () => {
      const { rpc, stt } = buildSuite();
      (stt.transcribe as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "ffmpeg-static" is not available.',
        ),
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
    });

    it('does not surface VOICE_ASSETS_UNAVAILABLE for other error categories', async () => {
      const { rpc, stt } = buildSuite();
      (stt.transcribe as jest.Mock).mockRejectedValue(
        new VoiceProviderError('process-crashed', 'local', 'worker died'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'voice-crashed',
      });

      expect(response.data).toEqual({ ok: false, error: 'worker died' });
    });
  });

  describe('voice:getConfig', () => {
    it('returns the whisper model with download status when set', async () => {
      const { rpc, stt, registry } = buildSuite({ voiceModel: 'small.en' });
      (stt.isReady as jest.Mock).mockResolvedValue({ ready: true });

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
      expect(registry.getStt).toHaveBeenCalledWith('local');
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
    it('downloads the configured model via the local registry entry', async () => {
      const { rpc, stt } = buildSuite({ voiceModel: 'small.en' });

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-1',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, alreadyPresent: false });
      expect(stt.downloadModel).toHaveBeenCalledWith('small.en');
    });

    it('downloads an explicitly requested model', async () => {
      const { rpc, stt } = buildSuite();
      (stt.downloadModel as jest.Mock).mockResolvedValue({
        alreadyPresent: true,
      });

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: { model: 'medium.en' },
        correlationId: 'dl-2',
      });

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ ok: true, alreadyPresent: true });
      expect(stt.downloadModel).toHaveBeenCalledWith('medium.en');
    });

    it('rejects an invalid model string without downloading', async () => {
      const { rpc, stt } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: { model: 'bad model!' },
        correlationId: 'dl-3',
      });

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect(stt.downloadModel).not.toHaveBeenCalled();
    });

    it('broadcasts download progress ticks to the webview and disposes the subscription', async () => {
      const { rpc, stt, webviewManager, downloadEvents } = buildSuite({
        voiceModel: 'small.en',
      });
      (stt.downloadModel as jest.Mock).mockImplementation(async () => {
        downloadEvents.emit({
          kind: 'download:progress',
          direction: 'stt',
          model: 'small.en',
          percent: 42,
        });
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
      expect(downloadEvents.listenerCount()).toBe(0);
    });

    it('ignores tts-direction download events while an stt download is in flight', async () => {
      const { rpc, stt, webviewManager, downloadEvents } = buildSuite({
        voiceModel: 'small.en',
      });
      (stt.downloadModel as jest.Mock).mockImplementation(async () => {
        downloadEvents.emit({
          kind: 'download:progress',
          direction: 'tts',
          model: 'some-tts-model',
          percent: 99,
        });
        return { alreadyPresent: false };
      });

      await rpc.handleMessage({
        method: 'voice:downloadModel',
        params: {},
        correlationId: 'dl-ignore-tts',
      });

      expect(webviewManager.broadcastMessage).not.toHaveBeenCalled();
    });

    it('broadcasts a terminal 100% tick on download:complete', async () => {
      const { rpc, stt, webviewManager, downloadEvents } = buildSuite({
        voiceModel: 'small.en',
      });
      (stt.downloadModel as jest.Mock).mockImplementation(async () => {
        downloadEvents.emit({
          kind: 'download:complete',
          direction: 'stt',
          model: 'small.en',
        });
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
      const { rpc, stt } = buildSuite();
      (stt.downloadModel as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "@huggingface/transformers" is not available.',
        ),
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
      const { rpc, stt } = buildSuite();
      (stt.downloadModel as jest.Mock).mockRejectedValue(
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
      const { rpc, tts, registry } = buildSuite({ ttsVoice: 'am_michael' });
      (tts.isReady as jest.Mock).mockResolvedValue({ ready: true });

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
      expect(registry.getTts).toHaveBeenCalledWith('local');
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
    it('writes the voice.ttsVoice key', async () => {
      const { rpc, workspace, store } = buildSuite();

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
    it('downloads via the local tts registry entry and broadcasts progress under the tts sentinel', async () => {
      const { rpc, tts, webviewManager, downloadEvents } = buildSuite();
      (tts.downloadModel as jest.Mock).mockImplementation(async () => {
        downloadEvents.emit({
          kind: 'download:progress',
          direction: 'tts',
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
      expect(downloadEvents.listenerCount()).toBe(0);
    });

    it('ignores stt-direction download events while a tts download is in flight', async () => {
      const { rpc, tts, webviewManager, downloadEvents } = buildSuite();
      (tts.downloadModel as jest.Mock).mockImplementation(async () => {
        downloadEvents.emit({
          kind: 'download:progress',
          direction: 'stt',
          model: 'some-stt-model',
          percent: 10,
        });
        return { alreadyPresent: false };
      });

      await rpc.handleMessage({
        method: 'voice:downloadTtsModel',
        params: {},
        correlationId: 'tts-dl-ignore-stt',
      });

      expect(webviewManager.broadcastMessage).not.toHaveBeenCalled();
    });

    it('maps VoiceProviderError(assets-unavailable) to a coded result', async () => {
      const { rpc, tts } = buildSuite();
      (tts.downloadModel as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "kokoro-js" is not available.',
        ),
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
    it('returns base64 audio and mimeType sourced from the active provider result', async () => {
      const { rpc, tts, selector } = buildSuite();
      (tts.synthesize as jest.Mock).mockResolvedValue({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/wav',
      });

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hello there', voice: 'am_puck' },
        correlationId: 'tts-syn-1',
      });

      expect(response.data).toEqual({
        ok: true,
        audioBase64: Buffer.from(new Uint8Array([1, 2, 3])).toString(
          'base64',
        ),
        mimeType: 'audio/wav',
      });
      expect(selector.activeTts).toHaveBeenCalledTimes(1);
      expect(tts.synthesize).toHaveBeenCalledWith({
        text: 'hello there',
        voice: 'am_puck',
      });
    });

    it('passes the provider mimeType through unmodified (cloud audio playback)', async () => {
      const { rpc, tts } = buildSuite();
      (tts.synthesize as jest.Mock).mockResolvedValue({
        audio: new Uint8Array([9, 9]),
        mimeType: 'audio/mpeg',
      });

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-syn-mime',
      });

      expect(response.data).toMatchObject({ ok: true, mimeType: 'audio/mpeg' });
    });

    it('passes no voice through when none is given (provider resolves its own default)', async () => {
      const { rpc, tts } = buildSuite();

      await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-syn-2',
      });

      expect(tts.synthesize).toHaveBeenCalledWith({
        text: 'hi',
        voice: undefined,
      });
    });

    it('rejects empty text without synthesizing', async () => {
      const { rpc, tts } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: '' },
        correlationId: 'tts-syn-3',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(tts.synthesize).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when the provider throws, without rejecting', async () => {
      const { rpc, tts } = buildSuite();
      (tts.synthesize as jest.Mock).mockRejectedValue(
        new Error('synth-boom'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-syn-4',
      });

      expect(response.data).toEqual({ ok: false, error: 'synth-boom' });
    });

    it('surfaces VOICE_ASSETS_UNAVAILABLE with remediation when local assets are missing', async () => {
      const { rpc, tts } = buildSuite();
      (tts.synthesize as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "kokoro voice pack (am_puck.bin)" is not available.',
        ),
      );

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-syn-5',
      });

      expect(response.data).toMatchObject({
        ok: false,
        code: VOICE_ASSETS_UNAVAILABLE,
        remediation: VOICE_ASSETS_REMEDIATION,
      });
    });
  });
});
