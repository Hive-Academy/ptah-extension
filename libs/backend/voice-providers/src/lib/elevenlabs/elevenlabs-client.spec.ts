/**
 * Unit tests for ElevenLabsClient — the fetch-based HTTP core and the
 * `mapElevenLabsError` sanitizing chokepoint (R6).
 *
 * Coverage: request URL/query/format/headers, voices parse, Scribe multipart
 * fields, the FULL error-mapping table, Zod drift failure, and the R6
 * regression — the `xi-api-key` value never appears in any thrown message.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { VoiceProviderError } from '@ptah-extension/voice-contracts';
import { ElevenLabsClient, mapElevenLabsError } from './elevenlabs-client';
import type { VoiceSecretStore } from '../voice-secret-store';

const API_KEY = 'xi-super-secret-key-9f8e7d6c5b4a';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeSecretStore(key: string | null): VoiceSecretStore {
  return {
    getKey: jest.fn(() => key),
    isConfigured: jest.fn(() => key !== null),
    setKey: jest.fn(),
    clearKey: jest.fn(),
  } as unknown as VoiceSecretStore;
}

function makeClient(key: string | null = API_KEY): ElevenLabsClient {
  return new ElevenLabsClient(makeLogger(), makeSecretStore(key));
}

interface FakeResponseOpts {
  status?: number;
  json?: unknown;
  bytes?: Uint8Array;
}

function fakeResponse(opts: FakeResponseOpts): Response {
  const status = opts.status ?? 200;
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => opts.json,
    clone(): unknown {
      return res;
    },
    arrayBuffer: async () =>
      opts.bytes
        ? opts.bytes.buffer.slice(
            opts.bytes.byteOffset,
            opts.bytes.byteOffset + opts.bytes.byteLength,
          )
        : new ArrayBuffer(0),
  };
  return res as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ElevenLabsClient — synthesize', () => {
  it('POSTs to the text-to-speech endpoint with the output_format query and headers', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ bytes: new Uint8Array([1, 2, 3, 4]) }),
    );
    const client = makeClient();

    const audio = await client.synthesize({
      voiceId: 'voice-123',
      text: 'hello world',
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    });

    expect(audio).toBeInstanceOf(Uint8Array);
    expect(Array.from(audio)).toEqual([1, 2, 3, 4]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe(API_KEY);
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      text: 'hello world',
      model_id: 'eleven_multilingual_v2',
    });
  });

  it('url-encodes the voice id and output format', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ bytes: new Uint8Array([9]) }));
    const client = makeClient();

    await client.synthesize({
      voiceId: 'voice/with space',
      text: 't',
      modelId: 'm',
      outputFormat: 'mp3_44100_128',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('voice%2Fwith%20space');
  });

  it('throws auth (no fetch) when no key is configured', async () => {
    const client = makeClient(null);
    await expect(
      client.synthesize({
        voiceId: 'v',
        text: 't',
        modelId: 'm',
        outputFormat: 'mp3_44100_128',
      }),
    ).rejects.toMatchObject({ category: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ElevenLabsClient — listVoices', () => {
  it('GETs /v1/voices and maps the voice catalogue', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        json: {
          voices: [
            { voice_id: 'a', name: 'Alice', category: 'premade' },
            { voice_id: 'b', name: 'Bob' },
          ],
          extra_unknown_field: true,
        },
      }),
    );
    const client = makeClient();

    const result = await client.listVoices();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/voices');
    expect(init.method).toBe('GET');
    expect(init.headers['xi-api-key']).toBe(API_KEY);
    expect(result.voices).toHaveLength(2);
    expect(result.voices[0]).toMatchObject({ voice_id: 'a', name: 'Alice' });
  });

  it('rejects loudly on Zod drift (a required field disappears)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ json: { voices: [{ name: 'no id here' }] } }),
    );
    const client = makeClient();

    await expect(client.listVoices()).rejects.toThrow();
  });
});

describe('ElevenLabsClient — transcribe (Scribe multipart)', () => {
  it('POSTs multipart with model_id and file fields', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ json: { text: 'transcribed text', language_code: 'en' } }),
    );
    const client = makeClient();

    const result = await client.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
      fileName: 'note.webm',
      modelId: 'scribe_v1',
    });

    expect(result).toEqual({ text: 'transcribed text' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe(API_KEY);

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('model_id')).toBe('scribe_v1');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe('audio/webm');
  });
});

describe('ElevenLabsClient — testConnection', () => {
  it('GETs /v1/user and resolves on success', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: { subscription: {} } }));
    const client = makeClient();

    await expect(client.testConnection()).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/user');
  });

  it('uses an unsaved override key for a pre-save probe', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: {} }));
    const client = makeClient(null);

    await client.testConnection('override-key-xyz');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['xi-api-key']).toBe('override-key-xyz');
  });
});

describe('ElevenLabsClient — error mapping table', () => {
  const cases: Array<{
    name: string;
    status: number;
    body?: unknown;
    category: string;
  }> = [
    { name: '401 → auth', status: 401, category: 'auth' },
    { name: '403 → auth', status: 403, category: 'auth' },
    {
      name: '401 + quota_exceeded → quota',
      status: 401,
      body: { detail: { status: 'quota_exceeded', message: 'over limit' } },
      category: 'quota',
    },
    { name: '402 → quota', status: 402, category: 'quota' },
    { name: '429 → quota', status: 429, category: 'quota' },
    { name: '500 → provider-error', status: 500, category: 'provider-error' },
    { name: '404 → provider-error', status: 404, category: 'provider-error' },
  ];

  for (const c of cases) {
    it(`maps HTTP ${c.name}`, async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ status: c.status, json: c.body }),
      );
      const client = makeClient();

      await expect(client.listVoices()).rejects.toMatchObject({
        code: 'VOICE_PROVIDER_ERROR',
        category: c.category,
      });
    });
  }

  it('500 message names the status but no body', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 500, json: { detail: { message: 'boom' } } }),
    );
    const client = makeClient();

    await expect(client.listVoices()).rejects.toThrow(/HTTP 500/);
    // The raw body message ('boom') must never surface.
    await expect(client.listVoices()).rejects.not.toThrow(/boom/);
  });

  it('maps a fetch TypeError to network', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const client = makeClient();

    await expect(client.listVoices()).rejects.toMatchObject({
      category: 'network',
    });
  });

  it('maps an abort/timeout to network', async () => {
    const timeout = new Error('The operation timed out.');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeout);
    const client = makeClient();

    await expect(
      client.synthesize({
        voiceId: 'v',
        text: 't',
        modelId: 'm',
        outputFormat: 'mp3_44100_128',
      }),
    ).rejects.toMatchObject({ category: 'network' });
  });
});

describe('mapElevenLabsError (pure chokepoint)', () => {
  it('produces sanitized, generic messages only', () => {
    expect(mapElevenLabsError({ status: 401 })).toBeInstanceOf(
      VoiceProviderError,
    );
    expect(mapElevenLabsError({ status: 401 }).message).not.toContain('body');
    expect(mapElevenLabsError({ status: 500 }).message).toBe(
      'ElevenLabs request failed (HTTP 500).',
    );
    expect(mapElevenLabsError({}).category).toBe('provider-error');
  });
});

describe('R6 — xi-api-key never appears in a thrown message', () => {
  const scenarios: Array<() => Promise<unknown>> = [];

  it('holds across the full failure surface', async () => {
    const client = makeClient();

    // HTTP status failures whose bodies echo the key back (worst case).
    const leakyBody = {
      detail: { message: `invalid key ${API_KEY}`, status: 'quota_exceeded' },
    };
    for (const status of [401, 402, 403, 429, 404, 500]) {
      scenarios.push(() => {
        fetchMock.mockResolvedValueOnce(
          fakeResponse({ status, json: leakyBody }),
        );
        return client.listVoices();
      });
    }
    // Transport failure whose error text embeds the key.
    scenarios.push(() => {
      fetchMock.mockRejectedValueOnce(new TypeError(`connect ${API_KEY}`));
      return client.listVoices();
    });

    for (const run of scenarios) {
      let caught: unknown;
      try {
        await run();
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(VoiceProviderError);
      const message = (caught as Error).message;
      expect(message).not.toContain(API_KEY);
    }
  });

  it('auth error (missing key) never echoes the key', async () => {
    const client = makeClient(API_KEY);
    fetchMock.mockResolvedValue(fakeResponse({ status: 401, json: {} }));
    let caught: unknown;
    try {
      await client.listVoices();
    } catch (error: unknown) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain(API_KEY);
  });
});
