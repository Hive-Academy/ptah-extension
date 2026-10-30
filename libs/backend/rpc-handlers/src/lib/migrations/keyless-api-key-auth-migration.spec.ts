import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { migrateKeylessApiKeyAuthMethod } from './keyless-api-key-auth-migration';

function makeHarness(
  authMethod: unknown,
  hasKey = false,
  defaultProvider?: string,
) {
  const settings = new Map<string, unknown>([
    ['authMethod', authMethod],
    ['llm.defaultProvider', defaultProvider],
  ]);
  const workspace = {
    getConfiguration: jest.fn((_section: string, key: string) =>
      settings.get(key),
    ),
    setConfiguration: jest.fn(
      async (_section: string, key: string, value: unknown) => {
        settings.set(key, value);
      },
    ),
  };
  const secrets = { hasCredential: jest.fn(async () => hasKey) };
  const migrate = () =>
    migrateKeylessApiKeyAuthMethod(
      workspace as unknown as IWorkspaceProvider,
      secrets,
    );
  return { settings, workspace, secrets, migrate };
}

describe('migrateKeylessApiKeyAuthMethod', () => {
  const envKey = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });
  afterAll(() => {
    if (envKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = envKey;
  });

  it('sets a key-less global apiKey auth method to claudeCli', async () => {
    const h = makeHarness('apiKey');
    expect(await h.migrate()).toBe('migrated');
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'authMethod',
      'claudeCli',
    );
    expect(await h.migrate()).toBe('none');
    expect(h.workspace.setConfiguration).toHaveBeenCalledTimes(1);
  });

  it('keeps apiKey when an API key is stored', async () => {
    const h = makeHarness('apiKey', true);
    expect(await h.migrate()).toBe('none');
    expect(h.secrets.hasCredential).toHaveBeenCalledWith('apiKey');
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
  });

  it.each(['openrouter', 'z-ai'])(
    'keeps apiKey when the CLI selected %s as the default provider',
    async (provider) => {
      const h = makeHarness('apiKey', false, provider);
      expect(await h.migrate()).toBe('none');
      expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'anthropic'])(
    'still migrates with an Anthropic or empty default provider (%p)',
    async (provider) => {
      const h = makeHarness('apiKey', false, provider);
      expect(await h.migrate()).toBe('migrated');
    },
  );

  it('keeps apiKey when ANTHROPIC_API_KEY is set in the environment', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'env-key';
    const h = makeHarness('apiKey');
    expect(await h.migrate()).toBe('none');
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
  });

  it.each(['claudeCli', 'claude-cli', 'thirdParty', undefined])(
    'leaves %p unchanged without reading secrets',
    async (value) => {
      const h = makeHarness(value);
      expect(await h.migrate()).toBe('none');
      expect(h.secrets.hasCredential).not.toHaveBeenCalled();
      expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    },
  );
});
