import {
  MCP_REGISTRY_ERROR_MESSAGES,
  type McpHttpConfig,
  type McpRegistryEntry,
  type McpRegistryErrorCode,
  type McpRegistryInput,
  type McpRegistryKeyValueInput,
  type McpRegistryPackageArgument,
  type McpRegistryRemote,
  type McpRegistryServerPackage,
  type McpServerConfig,
  type McpSseConfig,
  type McpStdioConfig,
} from './mcp-directory.types';

/** An input that the user must supply before or when the server is installed. */
export interface McpRequiredInput {
  /** Environment variable, header, URL variable, or argument name. */
  name: string;
  /** Human-readable description supplied by the registry. */
  description?: string;
  /** Whether the value is sensitive and must not be logged. */
  isSecret: boolean;
  /** Whether the input is required. */
  isRequired: boolean;
  /** Configuration location that consumes the input. */
  location: 'env' | 'header' | 'url' | 'argument';
  /** Allowed values, when the registry supplies them. */
  choices?: string[];
}

/** Result of converting a registry entry into Ptah's install config shape. */
export type McpInstallConfigResult =
  | {
      ok: true;
      config: McpServerConfig;
      requiredInputs: McpRequiredInput[];
      /** False when an unresolved URL variable or required argument blocks installation. */
      installable: boolean;
      source: 'package' | 'remote';
    }
  | {
      ok: false;
      code: McpRegistryErrorCode;
      message: string;
    };

const PACKAGE_PRIORITY = ['npm', 'pypi', 'oci', 'nuget'] as const;
type SupportedRegistryType = (typeof PACKAGE_PRIORITY)[number];

const DEFAULT_COMMANDS: Record<SupportedRegistryType, string> = {
  npm: 'npx',
  pypi: 'uvx',
  oci: 'docker',
  nuget: 'dnx',
};

const ALLOWED_RUNTIME_HINTS = new Set(['npx', 'uvx', 'docker', 'dnx']);

function inputValue(input: McpRegistryInput): string | undefined {
  const value = input.value ?? input.default;
  return value === '' ? undefined : value;
}

function toRequiredInput(
  input: McpRegistryInput,
  name: string,
  location: McpRequiredInput['location'],
): McpRequiredInput {
  return {
    name,
    description: input.description,
    isSecret: input.isSecret ?? false,
    isRequired: input.isRequired ?? false,
    location,
    choices: input.choices === undefined ? undefined : [...input.choices],
  };
}

function collectKeyValues(
  inputs: McpRegistryKeyValueInput[] | undefined,
  location: 'env' | 'header',
): { values: Record<string, string>; requiredInputs: McpRequiredInput[] } {
  const values: Record<string, string> = {};
  const requiredInputs: McpRequiredInput[] = [];

  for (const input of inputs ?? []) {
    const value = inputValue(input);
    if (value !== undefined) {
      values[input.name] = value;
    } else if (input.isRequired === true || input.isSecret === true) {
      requiredInputs.push(toRequiredInput(input, input.name, location));
    }
  }

  return { values, requiredInputs };
}

function mapArguments(
  args: McpRegistryPackageArgument[] | undefined,
): { values: string[]; requiredInputs: McpRequiredInput[]; installable: boolean } {
  const values: string[] = [];
  const requiredInputs: McpRequiredInput[] = [];
  let installable = true;

  for (const argument of args ?? []) {
    const value = inputValue(argument);
    if (argument.type === 'named') {
      values.push(argument.name);
      if (value !== undefined) values.push(value);
    } else if (value !== undefined) {
      values.push(value);
    }

    if (value === undefined && argument.isRequired === true) {
      requiredInputs.push(
        toRequiredInput(
          argument,
          argument.name ?? argument.valueHint ?? 'argument',
          'argument',
        ),
      );
      installable = false;
    }
  }

  return { values, requiredInputs, installable };
}

function mapPackage(
  registryPackage: McpRegistryServerPackage,
): Extract<McpInstallConfigResult, { ok: true }> {
  const registryType = registryPackage.registryType as SupportedRegistryType;
  const command =
    registryPackage.runtimeHint !== undefined &&
    ALLOWED_RUNTIME_HINTS.has(registryPackage.runtimeHint)
      ? registryPackage.runtimeHint
      : DEFAULT_COMMANDS[registryType];
  const runtimeArguments = mapArguments(registryPackage.runtimeArguments);
  const packageArguments = mapArguments(registryPackage.packageArguments);
  const environment = collectKeyValues(registryPackage.environmentVariables, 'env');
  const packageSpec =
    registryType !== 'oci' && registryPackage.version !== undefined
      ? `${registryPackage.identifier}@${registryPackage.version}`
      : registryPackage.identifier;

  let args: string[];
  switch (registryType) {
    case 'npm':
      args = [
        ...runtimeArguments.values,
        '-y',
        packageSpec,
        ...packageArguments.values,
      ];
      break;
    case 'pypi':
      args = [
        ...runtimeArguments.values,
        packageSpec,
        ...packageArguments.values,
      ];
      break;
    case 'oci':
      args = [
        'run',
        '-i',
        '--rm',
        ...runtimeArguments.values,
        ...(registryPackage.environmentVariables ?? []).flatMap((input) => [
          '-e',
          input.name,
        ]),
        registryPackage.identifier,
        ...packageArguments.values,
      ];
      break;
    case 'nuget':
      args = [
        ...runtimeArguments.values,
        packageSpec,
        '--yes',
        ...packageArguments.values,
      ];
      break;
  }

  const config: McpStdioConfig = {
    type: 'stdio',
    command,
    args,
    ...(Object.keys(environment.values).length > 0
      ? { env: environment.values }
      : {}),
  };

  return {
    ok: true,
    config,
    requiredInputs: [
      ...runtimeArguments.requiredInputs,
      ...packageArguments.requiredInputs,
      ...environment.requiredInputs,
    ],
    installable: runtimeArguments.installable && packageArguments.installable,
    source: 'package',
  };
}

function mapRemote(
  remote: McpRegistryRemote,
): Extract<McpInstallConfigResult, { ok: true }> {
  const requiredInputs: McpRequiredInput[] = [];
  const unresolvedVariables = new Set<string>();
  let installable = true;
  const url = remote.url.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => {
    const variable = remote.variables?.[name];
    const value = variable === undefined ? undefined : inputValue(variable);
    if (value !== undefined) return value;

    installable = false;
    if (!unresolvedVariables.has(name)) {
      unresolvedVariables.add(name);
      requiredInputs.push({
        name,
        description: variable?.description,
        isSecret: variable?.isSecret ?? false,
        isRequired: true,
        location: 'url',
        choices: variable?.choices === undefined ? undefined : [...variable.choices],
      });
    }
    return placeholder;
  });
  const headers = collectKeyValues(remote.headers, 'header');
  requiredInputs.push(...headers.requiredInputs);

  const config: McpHttpConfig | McpSseConfig = {
    type: remote.type === 'streamable-http' ? 'http' : 'sse',
    url,
    ...(Object.keys(headers.values).length > 0
      ? { headers: headers.values }
      : {}),
  };

  return {
    ok: true,
    config,
    requiredInputs,
    installable,
    source: 'remote',
  };
}

/** Convert an official registry entry into a config without I/O or shell command strings. */
export function registryEntryToInstallConfig(
  entry: McpRegistryEntry,
): McpInstallConfigResult {
  const packages = entry.packages ?? [];
  const remotes = entry.remotes ?? [];

  for (const registryType of PACKAGE_PRIORITY) {
    const registryPackage = packages.find(
      (candidate) =>
        candidate.registryType === registryType &&
        candidate.transport.type === 'stdio',
    );
    if (registryPackage !== undefined) return mapPackage(registryPackage);
  }

  for (const remoteType of ['streamable-http', 'sse'] as const) {
    const remote = remotes.find((candidate) => candidate.type === remoteType);
    if (remote !== undefined) return mapRemote(remote);
  }

  if (packages.length === 0 && remotes.length === 0) {
    return {
      ok: false,
      code: 'MCP_NO_INSTALL_SOURCE',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_NO_INSTALL_SOURCE,
    };
  }

  if (packages.some((candidate) => candidate.transport.type !== 'stdio')) {
    return {
      ok: false,
      code: 'MCP_PACKAGE_TRANSPORT_UNSUPPORTED',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_PACKAGE_TRANSPORT_UNSUPPORTED,
    };
  }

  return {
    ok: false,
    code: 'MCP_PACKAGE_TYPE_UNSUPPORTED',
    message: MCP_REGISTRY_ERROR_MESSAGES.MCP_PACKAGE_TYPE_UNSUPPORTED,
  };
}
