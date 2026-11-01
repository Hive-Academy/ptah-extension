import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  registryEntryToInstallConfig,
  type McpInstallConfigResult,
} from './mcp-registry-config.mapper';
import {
  MCP_REGISTRY_ERROR_MESSAGES,
  type McpRegistryEntry,
} from './mcp-directory.types';

const FIXTURE_DIRECTORY = join(__dirname, '__fixtures__/mcp-registry');

function readFixture<T>(file: string): T {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIRECTORY, file), 'utf8'),
  ) as T;
}

function readEntry(file: string): McpRegistryEntry {
  return readFixture<{ server: McpRegistryEntry }>(file).server;
}

function expectSuccess(
  result: McpInstallConfigResult,
): Extract<McpInstallConfigResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Mapper failed with ${result.code}`);
  return result;
}

describe('registryEntryToInstallConfig', () => {
  it('maps every list-page item to a config or a coded error without throwing', () => {
    const fixture = readFixture<{
      servers: Array<{ server: McpRegistryEntry }>;
    }>('list-page.json');

    for (const { server } of fixture.servers) {
      const result = registryEntryToInstallConfig(server);
      if (result.ok) {
        expect(result.config).toBeDefined();
      } else {
        expect(result.message).toBe(MCP_REGISTRY_ERROR_MESSAGES[result.code]);
      }
    }
  });

  it('maps a streamable-http remote to an HTTP config', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-remote-only.json')),
    );

    expect(result.source).toBe('remote');
    expect(result.installable).toBe(true);
    expect(result.config).toEqual({
      type: 'http',
      url: 'https://apexai.academy/mcp',
    });
  });

  it('maps an SSE remote to an SSE config', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-remote-sse.json')),
    );

    expect(result.source).toBe('remote');
    expect(result.config).toEqual({
      type: 'sse',
      url: 'https://api.agentrapay.ai/mcp',
    });
  });

  it('maps an npm package to an npx argument array', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-package-npm.json')),
    );

    expect(result.source).toBe('package');
    expect(result.installable).toBe(true);
    expect(result.requiredInputs).toEqual([]);
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pretrip-mcp@1.0.1'],
    });
  });

  it('maps a pypi package and its positional argument to uvx', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-pypi.json')),
    );

    expect(result.config).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['contextburn@0.2.1', 'mcp'],
    });
  });

  it('maps an OCI package to docker and passes each environment name with -e', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-oci.json')),
    );

    expect(result.config).toEqual({
      type: 'stdio',
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        '-e',
        'X-API-Key',
        'docker.io/aliengiraffe/spotdb:0.1.0',
      ],
    });
  });

  it('maps a nuget package to dnx and prefers it over the remote', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-nuget.json')),
    );

    expect(result.source).toBe('package');
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'dnx',
      args: ['anythink-mcp@0.2.37', '--yes'],
    });
  });

  it('preserves OCI environment and package argument order', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-package-arguments.json')),
    );

    expect(result.config).toEqual({
      type: 'stdio',
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        '-e',
        'APITHRESHOLD_LLM_PROVIDER',
        '-e',
        'OPENAI_API_KEY',
        '-e',
        'ANTHROPIC_API_KEY',
        '-e',
        'APITHRESHOLD_LICENSE',
        'ghcr.io/apithreshold/apithreshold:0.1.0',
        'serve',
        '--transport',
        'stdio',
      ],
    });
  });

  it('lists a required secret without writing an empty value to config.env', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-env-vars.json')),
    );

    expect(result.installable).toBe(true);
    expect(result.requiredInputs).toContainEqual({
      name: 'AI_2KW_API_KEY',
      description: 'API key for the 2kw.ai platform',
      isSecret: true,
      isRequired: true,
      location: 'env',
      choices: undefined,
    });
    expect(result.config.env?.['AI_2KW_API_KEY']).toBeUndefined();
    expect(Object.values(result.config.env ?? {})).not.toContain('');
  });

  it('keeps an unresolved remote URL template and lists its choices', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-remote-templated.json')),
    );

    expect(result.installable).toBe(false);
    expect(result.config).toEqual({
      type: 'http',
      url: 'https://{api_host}/mcp',
    });
    expect(result.requiredInputs).toContainEqual({
      name: 'api_host',
      description: 'AutoRFP.ai API host for your data-residency region.',
      isSecret: false,
      isRequired: true,
      location: 'url',
      choices: [
        'api.autorfp.ai',
        'api.eu.autorfp.ai',
        'api.us.autorfp.ai',
      ],
    });
  });

  it('prefers a package when an entry also has a remote', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-both.json')),
    );

    expect(result.source).toBe('package');
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@achromat-ai/mcp-server@0.1.3'],
      env: {
        ACHROMAT_AGENT_KEY_FILE: '~/.achromat/achromat_agent_key.pem',
        ACHROMAT_BASE_URL: 'https://mom.achromat.ai',
      },
    });
  });

  it('uses npm when an entry also contains an unsupported mcpb package', () => {
    const result = expectSuccess(
      registryEntryToInstallConfig(readEntry('detail-mcpb.json')),
    );

    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@autonomous-ai/harness-mcp@0.2.0'],
    });
  });

  it('derived from detail-mcpb.json: rejects an mcpb-only package', () => {
    const entry = readEntry('detail-mcpb.json');
    entry.packages = entry.packages?.filter(
      (registryPackage) => registryPackage.registryType === 'mcpb',
    );
    delete entry.remotes;

    expect(registryEntryToInstallConfig(entry)).toEqual({
      ok: false,
      code: 'MCP_PACKAGE_TYPE_UNSUPPORTED',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_PACKAGE_TYPE_UNSUPPORTED,
    });
  });

  it('derived from detail-oci-http.json: rejects a package-only HTTP transport', () => {
    const entry = readEntry('detail-oci-http.json');
    delete entry.remotes;

    expect(registryEntryToInstallConfig(entry)).toEqual({
      ok: false,
      code: 'MCP_PACKAGE_TRANSPORT_UNSUPPORTED',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_PACKAGE_TRANSPORT_UNSUPPORTED,
    });
  });

  it('derived from detail-package-npm.json: rejects an entry with no install source', () => {
    const entry = readEntry('detail-package-npm.json');
    delete entry.packages;
    delete entry.remotes;

    expect(registryEntryToInstallConfig(entry)).toEqual({
      ok: false,
      code: 'MCP_NO_INSTALL_SOURCE',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_NO_INSTALL_SOURCE,
    });
  });

  it('derived from detail-package-npm.json: ignores a runtimeHint for another registry type', () => {
    const entry = readEntry('detail-package-npm.json');
    entry.packages![0].runtimeHint = 'uvx';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pretrip-mcp@1.0.1'],
    });
  });

  it('derived from detail-pypi.json: ignores a runtimeHint for another registry type', () => {
    const entry = readEntry('detail-pypi.json');
    entry.packages![0].runtimeHint = 'npx';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['contextburn@0.2.1', 'mcp'],
    });
    expect(result.config.type === 'stdio' && result.config.args).not.toContain(
      '-y',
    );
  });

  it('derived from detail-package-npm.json: honors a matching runtimeHint', () => {
    const entry = readEntry('detail-package-npm.json');
    entry.packages![0].runtimeHint = 'npx';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pretrip-mcp@1.0.1'],
    });
  });

  it('derived from detail-package-npm.json: ignores a hostile runtimeHint', () => {
    const entry = readEntry('detail-package-npm.json');
    entry.packages![0].runtimeHint = 'sh -c';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'pretrip-mcp@1.0.1'],
    });
    expect(result.config.type === 'stdio' && Array.isArray(result.config.args)).toBe(
      true,
    );
  });

  it('derived from detail-package-npm.json: returns a coded error for an unknown registryType', () => {
    const entry = readEntry('detail-package-npm.json');
    entry.packages![0].registryType = 'cargo';

    expect(() => registryEntryToInstallConfig(entry)).not.toThrow();
    expect(registryEntryToInstallConfig(entry)).toEqual({
      ok: false,
      code: 'MCP_PACKAGE_TYPE_UNSUPPORTED',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_PACKAGE_TYPE_UNSUPPORTED,
    });
  });

  it('derived from detail-package-npm.json: orders runtime and named arguments and lists a missing required value', () => {
    const entry = readEntry('detail-package-npm.json');
    entry.packages![0].runtimeArguments = [
      {
        type: 'named',
        name: '--registry',
        value: 'https://registry.example',
      },
    ];
    entry.packages![0].packageArguments = [
      {
        type: 'named',
        name: '--token',
        description: 'API token',
        isRequired: true,
        isSecret: true,
      },
      { type: 'named', name: '--headless' },
      { type: 'positional', default: 'serve' },
    ];

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.installable).toBe(false);
    expect(result.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: [
        '--registry',
        'https://registry.example',
        '-y',
        'pretrip-mcp@1.0.1',
        '--token',
        '--headless',
        'serve',
      ],
    });
    expect(result.requiredInputs).toContainEqual({
      name: '--token',
      description: 'API token',
      isSecret: true,
      isRequired: true,
      location: 'argument',
      choices: undefined,
    });
  });

  it('derived from detail-remote-templated.json: resolves URL variables from value before default', () => {
    const entry = readEntry('detail-remote-templated.json');
    entry.remotes![0].variables!['api_host'].value = 'api.us.autorfp.ai';
    entry.remotes![0].variables!['api_host'].default = 'api.eu.autorfp.ai';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.installable).toBe(true);
    expect(result.config).toEqual({
      type: 'http',
      url: 'https://api.us.autorfp.ai/mcp',
    });
    expect(result.requiredInputs).toEqual([]);
  });

  it('derived from detail-remote-templated.json: resolves a URL variable from its default', () => {
    const entry = readEntry('detail-remote-templated.json');
    entry.remotes![0].variables!['api_host'].default = 'api.eu.autorfp.ai';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.installable).toBe(true);
    expect(result.config).toEqual({
      type: 'http',
      url: 'https://api.eu.autorfp.ai/mcp',
    });
  });

  it('derived from detail-remote-only.json: includes a literal header value', () => {
    const entry = readEntry('detail-remote-only.json');
    entry.remotes![0].headers![0].value = 'Bearer registry-value';

    const result = expectSuccess(registryEntryToInstallConfig(entry));
    expect(result.config).toEqual({
      type: 'http',
      url: 'https://apexai.academy/mcp',
      headers: { Authorization: 'Bearer registry-value' },
    });
    expect(result.requiredInputs).toEqual([]);
  });
});
