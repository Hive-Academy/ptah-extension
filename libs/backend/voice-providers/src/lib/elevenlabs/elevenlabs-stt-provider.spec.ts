/**
 * Unit tests for ElevenLabsSttProvider — capability/availability, file read →
 * multipart upload, model resolution, and sanitized read-failure handling.
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { isVoiceProviderError } from '@ptah-extension/voice-contracts';
import { ElevenLabsSttProvider } from './elevenlabs-stt-provider';
import type { ElevenLabsClient } from './elevenlabs-client';
import type { VoiceSecretStore } from '../voice-secret-store';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
import { readFile } from 'node:fs/promises';
const readFileMock = readFile as unknown as jest.Mock;

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
    transcribe: jest.fn(async () => ({ text: 'hello' })),
    ...overrides,
  } as unknown as ElevenLabsClient;
}

beforeEach(() => {
  readFileMock.mockReset();
});

describe('ElevenLabsSttProvider — capability / readiness', () => {
  it('is available/ready with a configured key', async () => {
    const provider = new ElevenLabsSttProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(true),
    );
    expect(provider.capability).toMatchObject({
      id: 'elevenlabs',
      kind: 'cloud',
      available: true,
    });
    await expect(provider.isReady()).resolves.toEqual({ ready: true });
  });

  it('is unavailable without a key', async () => {
    const provider = new ElevenLabsSttProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(false),
    );
    expect(provider.capability.available).toBe(false);
    await expect(provider.isReady()).resolves.toEqual({
      ready: false,
      reason: 'api-key-missing',
    });
  });
});

describe('ElevenLabsSttProvider — transcribe', () => {
  it('reads the recording and uploads it with the configured Scribe model', async () => {
    readFileMock.mockResolvedValue(new Uint8Array([10, 20, 30]));
    const transcribe = jest.fn(async () => ({ text: 'the transcript' }));
    const provider = new ElevenLabsSttProvider(
      makeWorkspace({
        'voice.elevenlabs.sttModelId': 'scribe_v1_experimental',
      }),
      makeClient({ transcribe }),
      makeSecretStore(true),
    );

    const result = await provider.transcribe({
      audioPath: '/tmp/dir/ptah-voice-abc.webm',
      mimeType: 'audio/webm',
    });

    expect(result).toEqual({ text: 'the transcript' });
    expect(readFileMock).toHaveBeenCalledWith('/tmp/dir/ptah-voice-abc.webm');
    expect(transcribe).toHaveBeenCalledWith({
      audio: new Uint8Array([10, 20, 30]),
      mimeType: 'audio/webm',
      fileName: 'ptah-voice-abc.webm',
      modelId: 'scribe_v1_experimental',
    });
  });

  it('defaults the Scribe model to scribe_v1', async () => {
    readFileMock.mockResolvedValue(new Uint8Array([1]));
    const transcribe = jest.fn(async (_params: unknown) => ({ text: 't' }));
    const provider = new ElevenLabsSttProvider(
      makeWorkspace(),
      makeClient({ transcribe }),
      makeSecretStore(true),
    );

    await provider.transcribe({
      audioPath: '/tmp/a.ogg',
      mimeType: 'audio/ogg',
    });

    expect(transcribe.mock.calls[0][0]).toMatchObject({ modelId: 'scribe_v1' });
  });

  it('wraps a file-read failure in a sanitized provider-error', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file'));
    const provider = new ElevenLabsSttProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(true),
    );

    let caught: unknown;
    try {
      await provider.transcribe({
        audioPath: '/tmp/missing.webm',
        mimeType: 'audio/webm',
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(isVoiceProviderError(caught)).toBe(true);
    expect((caught as Error).message).not.toMatch(/ENOENT/);
  });

  it('downloadModel is a cloud no-op', async () => {
    const provider = new ElevenLabsSttProvider(
      makeWorkspace(),
      makeClient(),
      makeSecretStore(true),
    );
    await expect(provider.downloadModel()).resolves.toEqual({
      alreadyPresent: true,
    });
  });
});
