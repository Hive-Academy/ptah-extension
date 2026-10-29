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

/** Required lane settings for which the core has no execution-profile fields yet.
 * These MUST be enforced before enabling native lanes; they are not optional hints.
 */
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
  /** Throws until all requirements have been acknowledged as enforced. */
  readonly settings: CodexProfileSettings;
  readonly requirements: CodexLaneRequirements;
  readonly warnings: readonly string[];
  /** Batch 10b MUST enforce each requirement and call this before opening a context.
   * Acknowledgement does not add support to the core or bypass its refusal.
   */
  assertAllRequirementsHandled(
    handledKeys: readonly (keyof CodexLaneRequirements)[],
  ): void;
}

/** Pure projection of the existing resolved lane config. No SDK overrides or retry.
 * Suppressions remain explicit in the core profile: today's runtime refuses them
 * before spawn. Never remove them to make an otherwise unsupported lane start.
 */
export function buildCodexLaneProfileSettings(
  input: CodexLaneProfileInput,
): CodexLaneProfileSettings {
  if (input.permissionLevel === undefined) {
    throw new Error('Codex lane permissionLevel is required');
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
  const settings: CodexProfileSettings = {
    ...input.identity,
    consumer: 'lane',
    cwd: config.workingDirectory,
    permissionLevel: input.permissionLevel,
    ...(effort ? { effort } : {}),
    // A fresh scalar each turn; no previous role or prompt is appended.
    ...(resend && config.developerInstructions
      ? { developerPrompt: config.developerInstructions }
      : {}),
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
      ...(input.maxTurns === undefined || input.maxTurns === 0
        ? {}
        : { maxTurns: input.maxTurns }),
      ...(input.maxBudgetUsd === undefined || input.maxBudgetUsd === 0
        ? {}
        : { maxBudgetUsd: input.maxBudgetUsd }),
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
      const handled = new Set<string>(handledKeys);
      const unhandled = Object.keys(requirements).filter(
        (key) => !handled.has(key),
      );
      requirementsHandled = unhandled.length === 0;
      if (!requirementsHandled) {
        throw new Error(
          `Unhandled Codex lane requirements: ${unhandled.join(', ')}`,
        );
      }
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
