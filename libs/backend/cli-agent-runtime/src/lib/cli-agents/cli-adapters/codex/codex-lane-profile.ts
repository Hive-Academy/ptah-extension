import {
  CODEX_PTAH_TOOL_TIMEOUT_SEC,
  type CodexProfileSettings,
} from '@ptah-extension/codex-runtime';
import { ptahMcpServerUrl } from '../ptah-mcp-url';
import {
  CODEX_RESUME_RESENDS_ROLE,
  type CodexLaneConfigInput,
} from './codex-lane-config.builder';

export interface CodexLaneProfileInput {
  readonly config: CodexLaneConfigInput;
  readonly identity: Pick<
    CodexProfileSettings,
    | 'contextId'
    | 'normalizedHome'
    | 'accountId'
    | 'providerId'
    | 'workspaceId'
    | 'model'
  >;
  readonly permissionLevel: CodexProfileSettings['permissionLevel'];
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
}

/** Lane requirements projected into the native execution profile. */
export interface CodexLaneRequirements {
  readonly agentsEnabled: false;
  readonly pluginsEnabled: false;
  readonly appsEnabled: false;
  readonly includeSkillInstructions: false;
  readonly disabledUserMcpServers: readonly string[];
  readonly autoCompactTokens?: number;
  readonly toolOutputTokenLimit?: number;
  readonly webSearch: 'live' | 'disabled';
  readonly ptahToolTimeoutSeconds?: number;
  readonly roleDelivery: 'replace';
}

const laneProfileBrand: unique symbol = Symbol('CodexLaneProfileSettings');

export interface CodexLaneProfileSettings {
  readonly [laneProfileBrand]: true;
  /** Throws until every requirement has a matching core setting. */
  readonly settings: CodexProfileSettings;
  readonly requirements: CodexLaneRequirements;
  readonly warnings: readonly string[];
  /** Verify every present requirement against its typed core projection. */
  assertAllRequirementsHandled(
    handledKeys: readonly (keyof CodexLaneRequirements)[],
  ): void;
}

type RequirementHandler = (
  requirements: CodexLaneRequirements,
  settings: CodexProfileSettings,
  expectedRole: string | undefined,
) => boolean;

/** A new requirement must gain a core-field check before this map compiles. */
const requirementHandlers = {
  agentsEnabled: (requirements, settings) =>
    settings.lane?.agentsEnabled === requirements.agentsEnabled,
  pluginsEnabled: (requirements, settings) =>
    settings.lane?.pluginsEnabled === requirements.pluginsEnabled,
  appsEnabled: (requirements, settings) =>
    settings.lane?.appsEnabled === requirements.appsEnabled,
  includeSkillInstructions: (requirements, settings) =>
    settings.lane?.includeSkillInstructions ===
    requirements.includeSkillInstructions,
  disabledUserMcpServers: (requirements, settings) => {
    const actual = settings.lane?.disabledUserMcpServers;
    return (
      actual !== undefined &&
      actual.length === requirements.disabledUserMcpServers.length &&
      actual.every((name, index) =>
        name === requirements.disabledUserMcpServers[index],
      )
    );
  },
  autoCompactTokens: (requirements, settings) =>
    settings.lane?.autoCompactTokens === requirements.autoCompactTokens,
  toolOutputTokenLimit: (requirements, settings) =>
    settings.lane?.toolOutputTokenLimit === requirements.toolOutputTokenLimit,
  webSearch: (requirements, settings) =>
    settings.lane?.webSearch === requirements.webSearch,
  ptahToolTimeoutSeconds: (requirements, settings) =>
    settings.lane?.ptahToolTimeoutSeconds ===
    requirements.ptahToolTimeoutSeconds,
  roleDelivery: (requirements, settings, expectedRole) =>
    requirements.roleDelivery === 'replace' &&
    settings.developerPrompt === expectedRole,
} satisfies Record<keyof CodexLaneRequirements, RequirementHandler>;

/** Pure projection of the existing resolved lane config. No SDK overrides or retry. */
export function buildCodexLaneProfileSettings(
  input: CodexLaneProfileInput,
): CodexLaneProfileSettings {
  if (input.permissionLevel === undefined) {
    throw new Error('Codex lane permissionLevel is required');
  }
  if (input.maxTurns !== undefined && input.maxTurns !== 0) {
    throw new Error('Codex lane maxTurns is unsupported');
  }
  if (input.maxBudgetUsd !== undefined && input.maxBudgetUsd !== 0) {
    throw new Error('Codex lane maxBudgetUsd is unsupported');
  }
  const { config } = input;
  const warnings: string[] = [];
  const disabledUserMcpServers = [...new Set(config.userMcpServerNames)]
    .filter((name) => name !== '' && name !== 'ptah')
    .sort();
  const autoCompactTokens = tokenLimit(
    config.autoCompactTokens,
    'autoCompactTokens',
    warnings,
  );
  const toolOutputTokenLimit = tokenLimit(
    config.toolOutputTokenLimit,
    'toolOutputTokenLimit',
    warnings,
  );
  const port = config.mcpPort;
  const attach =
    port !== undefined && Number.isInteger(port) && port > 0 && port <= 65535;
  if (port !== undefined && port !== 0 && !attach) {
    warnings.push(
      'Ignored invalid Ptah MCP port; the lane starts without Ptah tools.',
    );
  }
  const resend =
    config.variant === 'first-turn' ||
    (config.resendRoleOnResume ?? CODEX_RESUME_RESENDS_ROLE);
  const effort = config.reasoningEffort?.trim();
  const expectedRole =
    resend && config.developerInstructions
      ? config.developerInstructions
      : undefined;
  const settings: CodexProfileSettings = {
    ...input.identity,
    consumer: 'lane',
    cwd: config.workingDirectory,
    permissionLevel: input.permissionLevel,
    ...(effort ? { effort } : {}),
    // A fresh scalar each turn; no previous role or prompt is appended.
    ...(expectedRole ? { developerPrompt: expectedRole } : {}),
    mcpServers: attach
      ? [
          {
            name: 'ptah',
            transport: 'http',
            url: ptahMcpServerUrl(
              port,
              config.workingDirectory,
              config.agentId,
            ),
            headerReferences: {},
          },
        ]
      : [],
    instructionSources: [],
    lane: {
      suppressedTools: [
        'agents',
        'plugins',
        'apps',
        'skills',
        ...disabledUserMcpServers.map((name) => `mcp:${name}`),
      ],
      agentsEnabled: false,
      pluginsEnabled: false,
      appsEnabled: false,
      includeSkillInstructions: false,
      disabledUserMcpServers,
      ...(autoCompactTokens === undefined ? {} : { autoCompactTokens }),
      ...(toolOutputTokenLimit === undefined ? {} : { toolOutputTokenLimit }),
      webSearch: config.webSearch ? 'live' : 'disabled',
      ...(attach ? { ptahToolTimeoutSeconds: CODEX_PTAH_TOOL_TIMEOUT_SEC } : {}),
      explicitFullAccess: false,
    },
  };
  const requirements: CodexLaneRequirements = Object.freeze({
    agentsEnabled: false,
    pluginsEnabled: false,
    appsEnabled: false,
    includeSkillInstructions: false,
    disabledUserMcpServers: Object.freeze(disabledUserMcpServers),
    ...(autoCompactTokens === undefined ? {} : { autoCompactTokens }),
    ...(toolOutputTokenLimit === undefined ? {} : { toolOutputTokenLimit }),
    webSearch: config.webSearch ? 'live' : 'disabled',
    ...(attach ? { ptahToolTimeoutSeconds: CODEX_PTAH_TOOL_TIMEOUT_SEC } : {}),
    roleDelivery: 'replace',
  });
  let requirementsHandled = false;
  return {
    [laneProfileBrand]: true,
    get settings() {
      if (!requirementsHandled) {
        throw new Error(
          'Codex lane requirements must be handled before accessing settings',
        );
      }
      return settings;
    },
    requirements,
    warnings,
    assertAllRequirementsHandled(handledKeys) {
      requirementsHandled = false;
      const handled = new Set<string>(handledKeys);
      const unhandled = Object.keys(requirements).filter(
        (key) => !handled.has(key),
      );
      if (unhandled.length > 0) {
        throw new Error(
          `Unhandled Codex lane requirements: ${unhandled.join(', ')}`,
        );
      }
      const unsupported = Object.keys(requirements).filter(
        (key) =>
          !requirementHandlers[key as keyof CodexLaneRequirements](
            requirements,
            settings,
            expectedRole,
          ),
      );
      if (unsupported.length > 0) {
        throw new Error(
          `Unsupported Codex lane requirements: ${unsupported.join(', ')}`,
        );
      }
      requirementsHandled = true;
    },
  };
}

function tokenLimit(
  value: number,
  name: string,
  warnings: string[],
): number | undefined {
  if (!Number.isSafeInteger(value) || value < 0) {
    warnings.push(
      `Ignored invalid ${name}; expected a nonnegative safe integer.`,
    );
    return undefined;
  }
  return value === 0 ? undefined : value;
}
