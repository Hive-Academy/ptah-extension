import 'reflect-metadata';
import { inspect } from 'node:util';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../providers/local/local-provider.types';
import { PlanCredentialSource, PlanSecret } from './plan-credential.source';

const PROVIDER_SECRET = 'ollama-private-key-123';
const PTAH_CLI_SECRET = 'glm-private-key-456';

function harness(
  keys: Record<string, string | undefined> = {},
  options: { fails?: boolean } = {},
) {
  const logger = createMockLogger();
  const getProviderKey = jest.fn(async (slot: string) => {
    if (options.fails) throw new Error(`store failure near ${PROVIDER_SECRET}`);
    return keys[slot];
  });
  const source = new PlanCredentialSource(
    logger as unknown as Logger,
    { getProviderKey } as unknown as IAuthSecretsService,
  );
  return { source, logger, getProviderKey };
}

function allLogText(logger: ReturnType<typeof createMockLogger>): string {
  return JSON.stringify(
    Object.values(logger).flatMap((fn) =>
      jest.isMockFunction(fn) ? fn.mock.calls : [],
    ),
  );
}

describe('PlanCredentialSource', () => {
  it('AS7: reads the main-session Ollama Cloud key from its provider-key slot', async () => {
    const { source, getProviderKey } = harness({
      'ollama-cloud': ` ${PROVIDER_SECRET} `,
    });

    const result = await source.resolve({
      kind: 'provider-key',
      providerId: 'ollama-cloud',
    });

    expect(getProviderKey).toHaveBeenCalledWith('ollama-cloud');
    expect(result.kind).toBe('available');
    expect(result.kind === 'available' && result.secret.reveal()).toBe(
      PROVIDER_SECRET,
    );
  });

  it('reads a Ptah CLI agent key from its ptahCli.<id> slot', async () => {
    const { source, getProviderKey } = harness({
      'ptahCli.glm-1': PTAH_CLI_SECRET,
    });

    const result = await source.resolve({
      kind: 'ptah-cli-key',
      ptahCliId: 'glm-1',
    });

    expect(getProviderKey).toHaveBeenCalledWith('ptahCli.glm-1');
    expect(result.kind === 'available' && result.secret.reveal()).toBe(
      PTAH_CLI_SECRET,
    );
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
  ])('F71: a %s key maps to unsupported-config', async (_name, stored) => {
    const { source } = harness({ 'ollama-cloud': stored });
    await expect(
      source.resolve({ kind: 'provider-key', providerId: 'ollama-cloud' }),
    ).resolves.toEqual({ kind: 'unavailable', status: 'unsupported-config' });
  });

  it('a placeholder key maps to unsupported-auth', async () => {
    const { source } = harness({
      'ollama-cloud': OLLAMA_AUTH_TOKEN_PLACEHOLDER,
    });
    await expect(
      source.resolve({ kind: 'provider-key', providerId: 'ollama-cloud' }),
    ).resolves.toEqual({ kind: 'unavailable', status: 'unsupported-auth' });
  });

  it('a store failure maps to service-unavailable and logs no secret', async () => {
    const { source, logger } = harness({}, { fails: true });

    await expect(
      source.resolve({ kind: 'provider-key', providerId: 'ollama-cloud' }),
    ).resolves.toEqual({ kind: 'unavailable', status: 'service-unavailable' });
    expect(logger.debug).toHaveBeenCalledWith(
      '[PlanCredentialSource] secret read failed',
      {
        refKind: 'provider-key',
        id: 'ollama-cloud',
      },
    );
    expect(allLogText(logger)).not.toContain(PROVIDER_SECRET);
  });

  it('never caches: a changed key is read on the next call', async () => {
    const keys: Record<string, string | undefined> = {
      'ollama-cloud': 'first-key',
    };
    const { source, getProviderKey } = harness(keys);
    await source.resolve({ kind: 'provider-key', providerId: 'ollama-cloud' });
    keys['ollama-cloud'] = 'second-key';

    const result = await source.resolve({
      kind: 'provider-key',
      providerId: 'ollama-cloud',
    });

    expect(getProviderKey).toHaveBeenCalledTimes(2);
    expect(result.kind === 'available' && result.secret.reveal()).toBe(
      'second-key',
    );
  });

  it('F71: a resolution serialized, stringified or inspected carries no secret', async () => {
    const { source, logger } = harness({
      'ollama-cloud': PROVIDER_SECRET,
      'ptahCli.glm-1': PTAH_CLI_SECRET,
    });
    const results = [
      await source.resolve({
        kind: 'provider-key',
        providerId: 'ollama-cloud',
      }),
      await source.resolve({ kind: 'ptah-cli-key', ptahCliId: 'glm-1' }),
    ];

    const renderings = [
      JSON.stringify({ results }),
      inspect(results, { depth: 10 }),
      results.map((r) => (r.kind === 'available' ? `${r.secret}` : '')).join(),
    ].join('\n');
    expect(renderings).not.toContain(PROVIDER_SECRET);
    expect(renderings).not.toContain(PTAH_CLI_SECRET);
    expect(renderings).toContain('[redacted]');
    expect(allLogText(logger)).not.toContain(PROVIDER_SECRET);
    expect(allLogText(logger)).not.toContain(PTAH_CLI_SECRET);
  });

  it('PlanSecret reveals its value only on request', () => {
    const secret = new PlanSecret('value-xyz');
    expect(secret.reveal()).toBe('value-xyz');
    expect(Object.keys(secret)).toEqual([]);
    expect(String(secret)).toBe('[redacted]');
  });
});
