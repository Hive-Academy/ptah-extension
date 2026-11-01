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
  /** Stable input identifier: `${location}:${name}`. */
  key: string;
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
      /** Real values used for installation. */
      config: McpServerConfig;
      /** Deep-copied config with every secret value redacted for display. */
      preview: McpServerConfig;
      requiredInputs: McpRequiredInput[];
      /** False when any required input or placeholder remains unresolved. */
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
type InputLocation = McpRequiredInput['location'];
type InputValues = Readonly<Record<string, string>>;
type RegistryValueInput = McpRegistryKeyValueInput | McpRegistryPackageArgument;

interface MappingState {
  values: InputValues;
  requiredInputs: McpRequiredInput[];
  requiredInputKeys: Set<string>;
  installable: boolean;
}

interface ResolvedValue {
  value: string;
  preview: string;
}

const SECRET_PREVIEW = '••••••';

const DEFAULT_COMMANDS: Record<SupportedRegistryType, string> = {
  npm: 'npx',
  pypi: 'uvx',
  oci: 'docker',
  nuget: 'dnx',
};

const ALLOWED_RUNTIME_HINTS: Record<
  SupportedRegistryType,
  ReadonlySet<string>
> = {
  npm: new Set(['npx']),
  pypi: new Set(['uvx']),
  oci: new Set(['docker']),
  nuget: new Set(['dnx']),
};

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function declaredInputValue(input: McpRegistryInput): string | undefined {
  return nonEmpty(input.value) ?? nonEmpty(input.default);
}

function inputValue(
  input: McpRegistryInput,
  values: InputValues,
  key: string,
): string | undefined {
  return declaredInputValue(input) ?? nonEmpty(values[key]);
}

function toRequiredInput(
  input: McpRegistryInput,
  name: string,
  location: InputLocation,
  forceRequired = false,
): McpRequiredInput {
  return {
    key: `${location}:${name}`,
    name,
    description: input.description,
    isSecret: input.isSecret ?? false,
    isRequired: forceRequired || (input.isRequired ?? false),
    location,
    choices: input.choices === undefined ? undefined : [...input.choices],
  };
}

function addRequiredInput(
  state: MappingState,
  requiredInput: McpRequiredInput,
): void {
  if (state.requiredInputKeys.has(requiredInput.key)) return;
  state.requiredInputKeys.add(requiredInput.key);
  state.requiredInputs.push(requiredInput);
}

/**
 * Resolve placeholders from declared variables. Nested argument and header
 * variables use the parent location in their key: `${location}:${varName}`.
 */
function resolvePlaceholders(
  text: string,
  variables: Record<string, McpRegistryInput> | undefined,
  location: InputLocation,
  state: MappingState,
  leaveWithoutVariables: boolean,
): ResolvedValue {
  if (
    leaveWithoutVariables &&
    (variables === undefined || Object.keys(variables).length === 0)
  ) {
    return { value: text, preview: text };
  }

  const pattern = /\{([^{}]+)\}/g;
  let value = '';
  let preview = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [placeholder, name] = match;
    value += text.slice(lastIndex, match.index);
    preview += text.slice(lastIndex, match.index);
    lastIndex = match.index + placeholder.length;

    const variable = variables?.[name];
    const key = `${location}:${name}`;
    if (variable === undefined || declaredInputValue(variable) === undefined) {
      addRequiredInput(
        state,
        toRequiredInput(variable ?? {}, name, location, true),
      );
    }

    const resolved =
      variable === undefined
        ? nonEmpty(state.values[key])
        : inputValue(variable, state.values, key);
    if (resolved === undefined) {
      state.installable = false;
      value += placeholder;
      preview += placeholder;
    } else {
      value += resolved;
      preview += variable?.isSecret === true ? SECRET_PREVIEW : resolved;
    }
  }

  value += text.slice(lastIndex);
  preview += text.slice(lastIndex);
  return { value, preview };
}

function resolveRegistryInput(
  input: RegistryValueInput,
  name: string,
  location: InputLocation,
  state: MappingState,
): ResolvedValue | undefined {
  const key = `${location}:${name}`;
  if (
    declaredInputValue(input) === undefined &&
    (input.isRequired === true || input.isSecret === true)
  ) {
    addRequiredInput(state, toRequiredInput(input, name, location));
  }

  const rawValue = inputValue(input, state.values, key);
  if (rawValue === undefined) {
    if (input.isRequired === true) state.installable = false;
    return undefined;
  }

  const resolved = resolvePlaceholders(
    rawValue,
    input.variables,
    location,
    state,
    true,
  );
  return {
    value: resolved.value,
    preview: input.isSecret === true ? SECRET_PREVIEW : resolved.preview,
  };
}

function collectKeyValues(
  inputs: McpRegistryKeyValueInput[] | undefined,
  location: 'env' | 'header',
  state: MappingState,
): { values: Record<string, string>; preview: Record<string, string> } {
  const values: Record<string, string> = {};
  const preview: Record<string, string> = {};

  for (const input of inputs ?? []) {
    const resolved = resolveRegistryInput(input, input.name, location, state);
    if (resolved !== undefined) {
      values[input.name] = resolved.value;
      preview[input.name] = resolved.preview;
    }
  }

  return { values, preview };
}

function mapArguments(
  args: McpRegistryPackageArgument[] | undefined,
  state: MappingState,
): { values: string[]; preview: string[] } {
  const values: string[] = [];
  const preview: string[] = [];

  for (const argument of args ?? []) {
    const name = argument.name ?? argument.valueHint ?? 'argument';
    const resolved = resolveRegistryInput(
      argument,
      name,
      'argument',
      state,
    );

    if (argument.type === 'named') {
      values.push(argument.name);
      preview.push(argument.name);
    }
    if (resolved !== undefined) {
      values.push(resolved.value);
      preview.push(resolved.preview);
    }
  }

  return { values, preview };
}

function mapPackage(
  registryPackage: McpRegistryServerPackage,
  values: InputValues,
): Extract<McpInstallConfigResult, { ok: true }> {
  const state: MappingState = {
    values,
    requiredInputs: [],
    requiredInputKeys: new Set<string>(),
    installable: true,
  };
  const registryType = registryPackage.registryType as SupportedRegistryType;
  const command =
    registryPackage.runtimeHint !== undefined &&
    ALLOWED_RUNTIME_HINTS[registryType].has(registryPackage.runtimeHint)
      ? registryPackage.runtimeHint
      : DEFAULT_COMMANDS[registryType];
  const runtimeArguments = mapArguments(registryPackage.runtimeArguments, state);
  const packageArguments = mapArguments(registryPackage.packageArguments, state);
  const environment = collectKeyValues(
    registryPackage.environmentVariables,
    'env',
    state,
  );
  const packageSpec =
    registryType !== 'oci' && registryPackage.version !== undefined
      ? `${registryPackage.identifier}@${registryPackage.version}`
      : registryPackage.identifier;

  let args: string[];
  let previewArgs: string[];
  switch (registryType) {
    case 'npm':
      args = [
        ...runtimeArguments.values,
        '-y',
        packageSpec,
        ...packageArguments.values,
      ];
      previewArgs = [
        ...runtimeArguments.preview,
        '-y',
        packageSpec,
        ...packageArguments.preview,
      ];
      break;
    case 'pypi':
      args = [
        ...runtimeArguments.values,
        packageSpec,
        ...packageArguments.values,
      ];
      previewArgs = [
        ...runtimeArguments.preview,
        packageSpec,
        ...packageArguments.preview,
      ];
      break;
    case 'oci': {
      const environmentNames = (
        registryPackage.environmentVariables ?? []
      ).flatMap((input) => ['-e', input.name]);
      args = [
        'run',
        '-i',
        '--rm',
        ...runtimeArguments.values,
        ...environmentNames,
        registryPackage.identifier,
        ...packageArguments.values,
      ];
      previewArgs = [
        'run',
        '-i',
        '--rm',
        ...runtimeArguments.preview,
        ...environmentNames,
        registryPackage.identifier,
        ...packageArguments.preview,
      ];
      break;
    }
    case 'nuget':
      args = [
        ...runtimeArguments.values,
        packageSpec,
        '--yes',
        ...packageArguments.values,
      ];
      previewArgs = [
        ...runtimeArguments.preview,
        packageSpec,
        '--yes',
        ...packageArguments.preview,
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
  const preview: McpStdioConfig = {
    type: 'stdio',
    command,
    args: previewArgs,
    ...(Object.keys(environment.preview).length > 0
      ? { env: environment.preview }
      : {}),
  };

  return {
    ok: true,
    config,
    preview,
    requiredInputs: state.requiredInputs,
    installable: state.installable,
    source: 'package',
  };
}

function mapRemote(
  remote: McpRegistryRemote,
  values: InputValues,
): Extract<McpInstallConfigResult, { ok: true }> {
  const state: MappingState = {
    values,
    requiredInputs: [],
    requiredInputKeys: new Set<string>(),
    installable: true,
  };
  const url = resolvePlaceholders(
    remote.url,
    remote.variables,
    'url',
    state,
    false,
  );
  const headers = collectKeyValues(remote.headers, 'header', state);
  const type = remote.type === 'streamable-http' ? 'http' : 'sse';

  const config: McpHttpConfig | McpSseConfig = {
    type,
    url: url.value,
    ...(Object.keys(headers.values).length > 0
      ? { headers: headers.values }
      : {}),
  };
  const preview: McpHttpConfig | McpSseConfig = {
    type,
    url: url.preview,
    ...(Object.keys(headers.preview).length > 0
      ? { headers: headers.preview }
      : {}),
  };

  return {
    ok: true,
    config,
    preview,
    requiredInputs: state.requiredInputs,
    installable: state.installable,
    source: 'remote',
  };
}

/** Convert an official registry entry into a config without I/O or shell command strings. */
export function registryEntryToInstallConfig(
  entry: McpRegistryEntry,
  values: InputValues = {},
): McpInstallConfigResult {
  const packages = entry.packages ?? [];
  const remotes = entry.remotes ?? [];

  for (const registryType of PACKAGE_PRIORITY) {
    const registryPackage = packages.find(
      (candidate) =>
        candidate.registryType === registryType &&
        candidate.transport.type === 'stdio',
    );
    if (registryPackage !== undefined) {
      return mapPackage(registryPackage, values);
    }
  }

  for (const remoteType of ['streamable-http', 'sse'] as const) {
    const remote = remotes.find((candidate) => candidate.type === remoteType);
    if (remote !== undefined) return mapRemote(remote, values);
  }

  if (packages.length === 0 && remotes.length === 0) {
    return {
      ok: false,
      code: 'MCP_NO_INSTALL_SOURCE',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_NO_INSTALL_SOURCE,
    };
  }

  if (packages.length === 0) {
    return {
      ok: false,
      code: 'MCP_REMOTE_TRANSPORT_UNSUPPORTED',
      message: MCP_REGISTRY_ERROR_MESSAGES.MCP_REMOTE_TRANSPORT_UNSUPPORTED,
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
