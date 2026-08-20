/**
 * Unit tests for VoiceProviderSelector — settings-backed provider resolution
 * + one-click switch persistence (FR-7.2/7.4). Uses fake `IWorkspaceProvider`
 * and `IVoiceProviderRegistry` so these tests never touch real settings I/O.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  type ISpeechToTextProvider,
  type ITextToSpeechProvider,
  type IVoiceDownloadEventSource,
  type IVoiceProviderRegistry,
  type VoiceProviderCapability,
  type VoiceProviderId,
} from '@ptah-extension/voice-contracts';
import { VoiceProviderSelector } from './voice-provider-selector';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
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

interface FakeWorkspace extends IWorkspaceProvider {
  setConfiguration: jest.Mock;
}

function makeWorkspace(store: Record<string, unknown> = {}): FakeWorkspace {
  const getConfiguration = jest.fn(
    (_section: string, key: string, defaultValue?: unknown) =>
      key in store ? store[key] : defaultValue,
  );
  const setConfiguration = jest.fn(
    async (_section: string, key: string, value: unknown) => {
      store[key] = value;
    },
  );
  return {
    getConfiguration,
    setConfiguration,
    getWorkspaceFolders: () => [],
    getWorkspaceRoot: () => undefined,
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  } as unknown as FakeWorkspace;
}

function makeSuite(store: Record<string, unknown> = {}) {
  const logger = makeLogger();
  const workspace = makeWorkspace(store);

  const localTts = {
    capability: makeCapability(),
  } as unknown as jest.Mocked<ITextToSpeechProvider>;
  const localStt = {
    capability: makeCapability(),
  } as unknown as jest.Mocked<ISpeechToTextProvider>;
  const elevenTts = {
    capability: makeCapability({
      id: 'elevenlabs',
      kind: 'cloud',
      available: false,
    }),
  } as unknown as jest.Mocked<ITextToSpeechProvider>;
  const elevenStt = {
    capability: makeCapability({
      id: 'elevenlabs',
      kind: 'cloud',
      available: false,
    }),
  } as unknown as jest.Mocked<ISpeechToTextProvider>;

  const registry: jest.Mocked<IVoiceProviderRegistry> = {
    listProviders: jest.fn().mockReturnValue([]),
    getTts: jest.fn((id: VoiceProviderId) =>
      id === 'local' ? localTts : elevenTts,
    ),
    getStt: jest.fn((id: VoiceProviderId) =>
      id === 'local' ? localStt : elevenStt,
    ),
  };

  const downloadEvents: IVoiceDownloadEventSource = {
    onDownload: jest.fn(() => ({ dispose: () => undefined })),
  };

  const selector = new VoiceProviderSelector(
    logger,
    workspace,
    registry,
    downloadEvents,
  );

  return {
    selector,
    workspace,
    registry,
    downloadEvents,
    localTts,
    localStt,
    elevenTts,
    elevenStt,
    store,
  };
}

describe('VoiceProviderSelector', () => {
  describe('activeProviderId', () => {
    it('defaults to local when no setting is stored', () => {
      const { selector } = makeSuite();
      expect(selector.activeProviderId('tts')).toBe('local');
      expect(selector.activeProviderId('stt')).toBe('local');
    });

    it('resolves elevenlabs when explicitly configured', () => {
      const { selector } = makeSuite({ 'voice.ttsProvider': 'elevenlabs' });
      expect(selector.activeProviderId('tts')).toBe('elevenlabs');
    });

    it('treats an unrecognized stored value as local (defensive default)', () => {
      const { selector } = makeSuite({
        'voice.sttProvider': 'not-a-real-provider',
      });
      expect(selector.activeProviderId('stt')).toBe('local');
    });

    it('reads tts and stt from independent settings keys', () => {
      const { selector } = makeSuite({
        'voice.ttsProvider': 'elevenlabs',
        'voice.sttProvider': 'local',
      });
      expect(selector.activeProviderId('tts')).toBe('elevenlabs');
      expect(selector.activeProviderId('stt')).toBe('local');
    });
  });

  describe('activeTts / activeStt', () => {
    it('resolves the local provider by default', () => {
      const { selector, localTts, registry } = makeSuite();
      expect(selector.activeTts()).toBe(localTts);
      expect(registry.getTts).toHaveBeenCalledWith('local');
    });

    it('throws at call time when the selected provider is unavailable', () => {
      const { selector } = makeSuite({ 'voice.ttsProvider': 'elevenlabs' });
      expect(() => selector.activeTts()).toThrow(/elevenlabs.*not available/i);
    });

    it('the thrown error carries provider-error category and the offending providerId', () => {
      const { selector } = makeSuite({ 'voice.sttProvider': 'elevenlabs' });
      try {
        selector.activeStt();
        throw new Error('expected activeStt to throw');
      } catch (err: unknown) {
        expect(err).toMatchObject({
          category: 'provider-error',
          providerId: 'elevenlabs',
        });
      }
    });
  });

  describe('setProvider (FR-7.2/7.4 persistence)', () => {
    it('persists the tts provider switch via the workspace write-capability probe', async () => {
      const { selector, workspace, store } = makeSuite();
      await selector.setProvider('tts', 'elevenlabs');

      expect(workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'voice.ttsProvider',
        'elevenlabs',
      );
      expect(store['voice.ttsProvider']).toBe('elevenlabs');
      expect(selector.activeProviderId('tts')).toBe('elevenlabs');
    });

    it('persists the stt provider switch independently of tts', async () => {
      const { selector, store } = makeSuite();
      await selector.setProvider('stt', 'elevenlabs');

      expect(store['voice.sttProvider']).toBe('elevenlabs');
      expect(selector.activeProviderId('tts')).toBe('local');
    });

    it('does not throw when the platform lacks setConfiguration (read-only workspace)', async () => {
      const logger = makeLogger();
      const workspace = {
        getConfiguration: jest.fn().mockReturnValue('local'),
        getWorkspaceFolders: () => [],
        getWorkspaceRoot: () => undefined,
        onDidChangeConfiguration: {
          subscribe: () => ({ dispose: () => undefined }),
        },
        onDidChangeWorkspaceFolders: {
          subscribe: () => ({ dispose: () => undefined }),
        },
        // no setConfiguration
      } as unknown as IWorkspaceProvider;
      const registry: jest.Mocked<IVoiceProviderRegistry> = {
        listProviders: jest.fn().mockReturnValue([]),
        getTts: jest.fn(),
        getStt: jest.fn(),
      };
      const downloadEvents: IVoiceDownloadEventSource = {
        onDownload: jest.fn(() => ({ dispose: () => undefined })),
      };
      const selector = new VoiceProviderSelector(
        logger,
        workspace,
        registry,
        downloadEvents,
      );

      await expect(
        selector.setProvider('tts', 'elevenlabs'),
      ).resolves.toBeUndefined();
    });
  });

  describe('downloadEvents', () => {
    it('exposes the injected download event source as-is', () => {
      const { selector, downloadEvents } = makeSuite();
      expect(selector.downloadEvents).toBe(downloadEvents);
    });
  });
});
