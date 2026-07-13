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
import type {
  VoiceSecretStore,
  ElevenLabsClient,
} from '@ptah-extension/voice-providers';

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
  secretStore: jest.Mocked<VoiceSecretStore>;
  elevenLabsClient: jest.Mocked<ElevenLabsClient>;
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

  const secretStore = {
    isConfigured: jest.fn().mockReturnValue(false),
    getKey: jest.fn().mockReturnValue(null),
    setKey: jest.fn().mockResolvedValue(undefined),
    clearKey: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VoiceSecretStore>;

  const elevenLabsClient = {
    synthesize: jest.fn(),
    listVoices: jest.fn(),
    transcribe: jest.fn(),
    testConnection: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ElevenLabsClient>;

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
    secretStore,
    elevenLabsClient,
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
    secretStore,
    elevenLabsClient,
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

    it('registers exactly 14 methods (8 legacy + 6 provider-agnostic)', () => {
      expect(VoiceRpcHandlers.METHODS.length).toBe(14);
      for (const method of [
        'voice:listProviders',
        'voice:listVoices',
        'voice:getProviderConfig',
        'voice:setProviderConfig',
        'voice:setApiKey',
        'voice:testConnection',
      ] as const) {
        expect(VoiceRpcHandlers.METHODS).toContain(method);
      }
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
        audioBase64: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
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
      (tts.synthesize as jest.Mock).mockRejectedValue(new Error('synth-boom'));

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

    it('broadcasts voice:providerError on a CLOUD-category synthesize failure and still returns the error', async () => {
      const { rpc, tts, webviewManager } = buildSuite();
      (tts.synthesize as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'quota',
          'elevenlabs',
          'ElevenLabs quota exceeded. Check your plan usage and try again.',
        ),
      );

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-cloud-fail',
      });

      // Error still returns to the caller — no retry, no substitution.
      expect(response.data).toMatchObject({
        ok: false,
        code: 'VOICE_PROVIDER_ERROR',
        category: 'quota',
        providerId: 'elevenlabs',
      });
      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'voice:providerError',
        {
          direction: 'tts',
          providerId: 'elevenlabs',
          category: 'quota',
          message:
            'ElevenLabs quota exceeded. Check your plan usage and try again.',
        },
      );
    });

    it('does NOT broadcast for a LOCAL-provider synthesize failure', async () => {
      const { rpc, tts, webviewManager } = buildSuite();
      (tts.synthesize as jest.Mock).mockRejectedValue(
        new VoiceProviderError('process-crashed', 'local', 'worker died'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:synthesize',
        params: { text: 'hi' },
        correlationId: 'tts-local-fail',
      });

      expect(response.data).toEqual({ ok: false, error: 'worker died' });
      expect(webviewManager.broadcastMessage).not.toHaveBeenCalled();
    });
  });

  describe('voice:transcribe FR-7 broadcast', () => {
    it('broadcasts voice:providerError on a CLOUD-category transcribe failure', async () => {
      const { rpc, stt, webviewManager } = buildSuite();
      (stt.transcribe as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'auth',
          'elevenlabs',
          'ElevenLabs rejected the API key (authentication failed).',
          'Re-enter your ElevenLabs API key in Voice settings.',
        ),
      );

      const response = await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'stt-cloud-fail',
      });

      expect(response.data).toMatchObject({
        ok: false,
        code: 'VOICE_PROVIDER_ERROR',
        category: 'auth',
        providerId: 'elevenlabs',
        remediation: 'Re-enter your ElevenLabs API key in Voice settings.',
      });
      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'voice:providerError',
        expect.objectContaining({
          direction: 'stt',
          providerId: 'elevenlabs',
          category: 'auth',
        }),
      );
    });

    it('does NOT broadcast for a LOCAL assets-unavailable transcribe failure', async () => {
      const { rpc, stt, webviewManager } = buildSuite();
      (stt.transcribe as jest.Mock).mockRejectedValue(
        new VoiceProviderError(
          'assets-unavailable',
          'local',
          'Voice asset "ffmpeg-static" is not available.',
        ),
      );

      await rpc.handleMessage({
        method: 'voice:transcribe',
        params: { audioBase64: VALID_BASE64, mimeType: 'audio/webm' },
        correlationId: 'stt-assets-fail',
      });

      expect(webviewManager.broadcastMessage).not.toHaveBeenCalled();
    });
  });

  describe('voice:listProviders', () => {
    it('returns registry capabilities plus the active provider ids', async () => {
      const { rpc, registry, selector } = buildSuite();
      (registry.listProviders as jest.Mock).mockReturnValue([
        makeCapability(),
        makeCapability({
          id: 'elevenlabs',
          label: 'ElevenLabs',
          kind: 'cloud',
          requiresDownload: false,
          requiresApiKey: true,
          available: false,
          unavailableReason: 'Add your ElevenLabs API key.',
        }),
      ]);
      (selector.activeProviderId as jest.Mock).mockImplementation(
        (dir: string) => (dir === 'tts' ? 'elevenlabs' : 'local'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:listProviders',
        params: {},
        correlationId: 'lp-1',
      });

      expect(response.data).toMatchObject({
        ok: true,
        active: { tts: 'elevenlabs', stt: 'local' },
      });
      const data = response.data as {
        ok: true;
        providers: Array<{ id: string; available: boolean }>;
      };
      expect(data.providers.map((p) => p.id)).toEqual(['local', 'elevenlabs']);
    });
  });

  describe('voice:listVoices', () => {
    it('lists voices from the requested provider via the registry TTS port', async () => {
      const { rpc, tts, registry } = buildSuite();
      (tts.listVoices as jest.Mock).mockResolvedValue([
        { id: 'af_heart', label: 'Heart', category: 'kokoro' },
      ]);

      const response = await rpc.handleMessage({
        method: 'voice:listVoices',
        params: { providerId: 'local' },
        correlationId: 'lv-1',
      });

      expect(response.data).toEqual({
        ok: true,
        voices: [{ id: 'af_heart', label: 'Heart', category: 'kokoro' }],
      });
      expect(registry.getTts).toHaveBeenCalledWith('local');
    });

    it('rejects an invalid providerId without calling the registry', async () => {
      const { rpc, registry } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:listVoices',
        params: { providerId: 'bogus' },
        correlationId: 'lv-2',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(registry.getTts).not.toHaveBeenCalled();
    });

    it('surfaces the error category when a cloud voice list fails', async () => {
      const { rpc, tts } = buildSuite();
      (tts.listVoices as jest.Mock).mockRejectedValue(
        new VoiceProviderError('auth', 'elevenlabs', 'key rejected'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:listVoices',
        params: { providerId: 'elevenlabs' },
        correlationId: 'lv-3',
      });

      expect(response.data).toMatchObject({ ok: false, category: 'auth' });
    });
  });

  describe('voice:getProviderConfig', () => {
    it('returns config WITHOUT any key material (security regression)', async () => {
      const { rpc, secretStore } = buildSuite({ voiceModel: 'small.en' });
      (secretStore.isConfigured as jest.Mock).mockReturnValue(true);

      const response = await rpc.handleMessage({
        method: 'voice:getProviderConfig',
        params: {},
        correlationId: 'gpc-1',
      });

      expect(response.data).toMatchObject({ ok: true });
      const serialized = JSON.stringify(response.data);
      // No key, ciphertext, or raw-key field ever leaves the handler.
      expect(serialized).not.toMatch(/apiKey"\s*:/i);
      expect(serialized).not.toMatch(/cipher/i);
      expect(serialized).not.toMatch(/apiKeyCipher/i);

      const data = response.data as {
        ok: true;
        config: {
          elevenlabs: { apiKeyConfigured: boolean };
          local: { whisperModel: string };
        };
      };
      // Only the boolean flag is exposed for the key.
      expect(data.config.elevenlabs.apiKeyConfigured).toBe(true);
      expect(data.config.elevenlabs).not.toHaveProperty('apiKey');
      expect(data.config.elevenlabs).not.toHaveProperty('apiKeyCipher');
      expect(data.config.local.whisperModel).toBe('small.en');
    });

    it('reports apiKeyConfigured=false when no key is stored', async () => {
      const { rpc, secretStore } = buildSuite();
      (secretStore.isConfigured as jest.Mock).mockReturnValue(false);

      const response = await rpc.handleMessage({
        method: 'voice:getProviderConfig',
        params: {},
        correlationId: 'gpc-2',
      });

      const data = response.data as {
        ok: true;
        config: { elevenlabs: { apiKeyConfigured: boolean } };
      };
      expect(data.config.elevenlabs.apiKeyConfigured).toBe(false);
    });
  });

  describe('voice:setProviderConfig', () => {
    it('persists provider switches via the selector', async () => {
      const { rpc, selector } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setProviderConfig',
        params: { ttsProvider: 'elevenlabs', sttProvider: 'local' },
        correlationId: 'spc-1',
      });

      expect(response.data).toEqual({ ok: true });
      expect(selector.setProvider).toHaveBeenCalledWith('tts', 'elevenlabs');
      expect(selector.setProvider).toHaveBeenCalledWith('stt', 'local');
    });

    it('writes non-secret elevenlabs config keys', async () => {
      const { rpc, workspace } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setProviderConfig',
        params: {
          elevenlabs: { voiceId: 'rachel', outputFormat: 'mp3_44100_128' },
        },
        correlationId: 'spc-2',
      });

      expect(response.data).toEqual({ ok: true });
      expect(workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'voice.elevenlabs.voiceId',
        'rachel',
      );
      expect(workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'voice.elevenlabs.outputFormat',
        'mp3_44100_128',
      );
    });

    it('rejects an invalid provider id without persisting', async () => {
      const { rpc, selector } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setProviderConfig',
        params: { ttsProvider: 'nope' },
        correlationId: 'spc-3',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(selector.setProvider).not.toHaveBeenCalled();
    });
  });

  describe('voice:setApiKey', () => {
    it('stores the key via the secret store', async () => {
      const { rpc, secretStore } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setApiKey',
        params: { providerId: 'elevenlabs', apiKey: 'sk-secret-123' },
        correlationId: 'sak-1',
      });

      expect(response.data).toEqual({ ok: true });
      expect(secretStore.setKey).toHaveBeenCalledWith(
        'elevenlabs',
        'sk-secret-123',
      );
    });

    it('clears the key when given an empty string', async () => {
      const { rpc, secretStore } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setApiKey',
        params: { providerId: 'elevenlabs', apiKey: '' },
        correlationId: 'sak-2',
      });

      expect(response.data).toEqual({ ok: true });
      expect(secretStore.setKey).toHaveBeenCalledWith('elevenlabs', '');
    });

    it('rejects a non-cloud providerId without storing', async () => {
      const { rpc, secretStore } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:setApiKey',
        params: { providerId: 'local', apiKey: 'x' },
        correlationId: 'sak-3',
      });

      expect(response.data).toMatchObject({ ok: false });
      expect(secretStore.setKey).not.toHaveBeenCalled();
    });
  });

  describe('voice:testConnection', () => {
    it('probes the provider and returns ok on success', async () => {
      const { rpc, elevenLabsClient } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'voice:testConnection',
        params: { providerId: 'elevenlabs', apiKey: 'sk-probe' },
        correlationId: 'tc-1',
      });

      expect(response.data).toEqual({ ok: true });
      expect(elevenLabsClient.testConnection).toHaveBeenCalledWith('sk-probe');
    });

    it('returns the error category when the probe fails', async () => {
      const { rpc, elevenLabsClient } = buildSuite();
      (elevenLabsClient.testConnection as jest.Mock).mockRejectedValue(
        new VoiceProviderError('auth', 'elevenlabs', 'key rejected'),
      );

      const response = await rpc.handleMessage({
        method: 'voice:testConnection',
        params: { providerId: 'elevenlabs' },
        correlationId: 'tc-2',
      });

      expect(response.data).toMatchObject({ ok: false, category: 'auth' });
    });
  });
});
