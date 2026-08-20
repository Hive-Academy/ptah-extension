/**
 * Unit tests for ElevenLabsTtsProvider — capability/availability, settings
 * resolution, voice-override precedence, mimeType mapping, and voice-list
 * mapping. The HTTP client is faked (its own suite covers the wire).
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  ElevenLabsTtsProvider,
  mimeTypeForFormat,
} from './elevenlabs-tts-provider';
import type { ElevenLabsClient } from './elevenlabs-client';
import type { VoiceSecretStore } from '../voice-secret-store';

function makeWorkspace(
  store: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, defaultValue?: unknown) =>
        key in store ? store[key] : defaultValue,
    ),
    setConfiguration: jest.fn(),
    getWorkspaceFolders: () => [],
    getWorkspaceRoot: () => undefined,
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  } as unknown as IWorkspaceProvider;
}

function makeSecretStore(configured: boolean): VoiceSecretStore {
  return {
    isConfigured: jest.fn(() => configured),
    getKey: jest.fn(() => (configured ? 'a-key' : null)),
  } as unknown as VoiceSecretStore;
}

function makeClient(
  overrides: Partial<ElevenLabsClient> = {},
): ElevenLabsClient {
  return {
    synthesize: jest.fn(async () => new Uint8Array([1, 2, 3])),
    listVoices: jest.fn(async () => ({ voices: [] })),
    ...overrides,
  } as unknown as ElevenLabsClient;
}

describe('mimeTypeForFormat', () => {
  it('maps mp3 formats to audio/mpeg', () => {
    expect(mimeTypeForFormat('mp3_44100_128')).toBe('audio/mpeg');
  });
  it('maps opus formats to audio/ogg', () => {
    expect(mimeTypeForFormat('opus_48000_64')).toBe('audio/ogg');
  });
});

describe('ElevenLabsTtsProvider — capability / readiness', () => {
  it('is available and ready when a key is configured', async () => {
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(true),
    );
    expect(provider.capability).toMatchObject({
      id: 'elevenlabs',
      kind: 'cloud',
      requiresApiKey: true,
      requiresDownload: false,
      available: true,
    });
    expect(provider.capability.unavailableReason).toBeUndefined();
    await expect(provider.isReady()).resolves.toEqual({ ready: true });
  });

  it('is unavailable with a reason when no key is configured', async () => {
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(false),
    );
    expect(provider.capability.available).toBe(false);
    expect(provider.capability.unavailableReason).toMatch(/API key/i);
    await expect(provider.isReady()).resolves.toEqual({
      ready: false,
      reason: 'api-key-missing',
    });
  });
});

describe('ElevenLabsTtsProvider — synthesize', () => {
  it('uses configured voice/model/format and returns the mapped mimeType', async () => {
    const synthesize = jest.fn(async () => new Uint8Array([7]));
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace({
        'voice.elevenlabs.voiceId': 'cfg-voice',
        'voice.elevenlabs.ttsModelId': 'eleven_flash_v2_5',
        'voice.elevenlabs.outputFormat': 'opus_48000_64',
      }),
      makeClient({ synthesize }),
      makeSecretStore(true),
    );

    const result = await provider.synthesize({ text: 'hi' });

    expect(synthesize).toHaveBeenCalledWith({
      voiceId: 'cfg-voice',
      text: 'hi',
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'opus_48000_64',
    });
    expect(result.mimeType).toBe('audio/ogg');
    expect(result.audio).toBeInstanceOf(Uint8Array);
  });

  it('request-level voice override wins over the configured voice', async () => {
    const synthesize = jest.fn(async (_params: unknown) => new Uint8Array([7]));
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace({ 'voice.elevenlabs.voiceId': 'cfg-voice' }),
      makeClient({ synthesize }),
      makeSecretStore(true),
    );

    await provider.synthesize({ text: 'hi', voice: 'override-voice' });

    expect(synthesize.mock.calls[0][0]).toMatchObject({
      voiceId: 'override-voice',
    });
  });

  it('falls back to the default voice/model/format when nothing is configured', async () => {
    const synthesize = jest.fn(async (_params: unknown) => new Uint8Array([7]));
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace(),
      makeClient({ synthesize }),
      makeSecretStore(true),
    );

    const result = await provider.synthesize({ text: 'hi' });

    expect(synthesize.mock.calls[0][0]).toMatchObject({
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    });
    expect(result.mimeType).toBe('audio/mpeg');
  });
});

describe('ElevenLabsTtsProvider — listVoices / downloadModel', () => {
  it('maps the account voice catalogue to VoiceInfo', async () => {
    const listVoices = jest.fn(async () => ({
      voices: [
        { voice_id: 'a', name: 'Alice', category: 'premade' },
        { voice_id: 'b', name: 'Bob' },
      ],
    }));
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace(),
      makeClient({ listVoices }),
      makeSecretStore(true),
    );

    const voices = await provider.listVoices();

    expect(voices).toEqual([
      { id: 'a', label: 'Alice', category: 'premade' },
      { id: 'b', label: 'Bob', category: undefined },
    ]);
  });

  it('downloadModel is a cloud no-op', async () => {
    const provider = new ElevenLabsTtsProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(true),
    );
    await expect(provider.downloadModel()).resolves.toEqual({
      alreadyPresent: true,
    });
  });
});
