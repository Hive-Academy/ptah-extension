import 'reflect-metadata';
import type {
  Logger,
  ConfigManager,
  IAuthSecretsService,
  SentryService,
} from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { OllamaModelDiscoveryService } from './ollama-model-discovery.service';
import type { OllamaCloudMetadataService } from './ollama-cloud-metadata.service';

describe('Ollama capacity evidence', () => {
  function harness(configGet: jest.Mock = jest.fn()) {
    const service = new OllamaModelDiscoveryService(
      createMockLogger() as unknown as Logger,
      { get: configGet } as unknown as ConfigManager,
      {
        fetchCloudTags: jest.fn().mockResolvedValue([]),
      } as unknown as OllamaCloudMetadataService,
      {
        getProviderKey: jest.fn().mockResolvedValue(null),
      } as unknown as IAuthSecretsService,
      { captureException: jest.fn() } as unknown as SentryService,
    );
    const http = service as unknown as {
      httpGet: () => Promise<unknown>;
      httpPost: () => Promise<unknown>;
    };
    jest
      .spyOn(http, 'httpGet')
      .mockResolvedValue({ models: [{ name: 'llama3:latest' }] });
    return { service, post: jest.spyOn(http, 'httpPost') };
  }

  it.each([200000, undefined, 0, -1, NaN, Infinity])(
    'certifies only a valid /api/show window (%s), including cached reads',
    async (value) => {
      const { service, post } = harness();
      post.mockResolvedValue({ modelinfo: { 'llama.context_length': value } });
      for (let i = 0; i < 2; i++) {
        const [model] = await service.listLocalModels();
        if (value === 200000)
          expect(model).toHaveProperty('contextLengthSource', 'provider');
        else expect(model).not.toHaveProperty('contextLengthSource');
      }
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it('validates each reported window before choosing one (general 0, llama 32768)', async () => {
    const { service, post } = harness();
    post.mockResolvedValue({
      modelinfo: {
        'general.context_length': 0,
        'llama.context_length': 32768,
      },
    });
    const [model] = await service.listLocalModels();
    expect(model.contextLength).toBe(32768);
    expect(model).toHaveProperty('contextLengthSource', 'provider');
  });

  it('does not certify a fractional reported window', async () => {
    const { service, post } = harness();
    post.mockResolvedValue({
      modelinfo: { 'general.context_length': 4096.5 },
    });
    const [model] = await service.listLocalModels();
    expect(model).not.toHaveProperty('contextLengthSource');
  });

  it('never reuses one server’s cached metadata for another base URL', async () => {
    let baseUrl = 'http://127.0.0.1:11434';
    const { service, post } = harness(jest.fn(() => baseUrl));
    post.mockResolvedValueOnce({
      modelinfo: { 'llama.context_length': 200000 },
    });
    post.mockResolvedValueOnce({
      modelinfo: { 'llama.context_length': 8000 },
    });

    const [first] = await service.listLocalModels();
    baseUrl = 'http://192.168.1.20:11434';
    const [second] = await service.listLocalModels();

    expect(first.contextLength).toBe(200000);
    expect(second.contextLength).toBe(8000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith(
      'http://192.168.1.20:11434/api/show',
      { model: 'llama3:latest' },
    );
  });

  it('keeps show errors and the static cloud catalog unverified', async () => {
    const { service, post } = harness();
    post.mockRejectedValue(new Error('offline'));
    const [fallback] = await service.listLocalModels();
    expect(fallback.contextLength).toBe(8192);
    expect(fallback).not.toHaveProperty('contextLengthSource');
    const cloud = await service.listCloudModels();
    expect(cloud.length).toBeGreaterThan(0);
    for (const model of cloud)
      expect(model).not.toHaveProperty('contextLengthSource');
  });
});
