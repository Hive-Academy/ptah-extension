/**
 * Lane spawn policy (TASK_2026_597, D4, R2.1-R2.5).
 *
 * Pure decisions about a lane's model and reasoning effort. Settings are read
 * by `AgentSpawnEnvironment`, which hands the raw values here; the manager
 * logs the result. Nothing in this file touches I/O.
 */
import {
  CLAUDE_REASONING_EFFORT_VALUES,
  PI_REASONING_EFFORT_VALUES,
} from '@ptah-extension/shared';
import type {
  CliAdapterManifest,
  CliType,
  EffectiveLanePolicy,
  LaneNetworkMode,
  LanePermissionMode,
  LaneSpawnPolicyRefusal,
} from '@ptah-extension/shared';
import type { LaneModelSource } from './cli-adapters/cli-adapter.interface';

export class LaneSpawnPolicyError extends Error {
  readonly refusal: LaneSpawnPolicyRefusal;

  constructor(refusal: LaneSpawnPolicyRefusal) {
    super(refusal.reason);
    this.name = 'LaneSpawnPolicyError';
    this.refusal = refusal;
  }
}

export interface LaneArgvPolicyTranslation {
  readonly addArgs: readonly string[];
  readonly removeArgs: readonly string[];
}

export type LaneSpawnPolicyTranslation = {
  readonly requested: EffectiveLanePolicy;
  readonly nativeDescription?: string;
} & (
  | {
      readonly cli: 'codex';
      readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
      readonly networkAccess?: boolean;
    }
  | {
      readonly cli: 'claude' | 'ptah-cli';
      readonly permissionMode?: 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';
      readonly allowDangerouslySkipPermissions?: boolean;
    }
  | {
      readonly cli: 'copilot' | 'antigravity' | 'opencode';
      readonly argv: LaneArgvPolicyTranslation;
    }
  | { readonly cli: 'cursor' | 'grok' | 'pi' }
);

/** Validate an explicit spawn policy against the adapter's declared manifest. */
export function validateLaneSpawnPolicy(
  cli: CliType,
  manifest: CliAdapterManifest,
  requested: EffectiveLanePolicy,
): EffectiveLanePolicy {
  const permission = requested.permission;
  const network = requested.network;
  const permissionCapability = permission
    ? manifest.permissionModes[permission]
    : undefined;
  if (permission && permissionCapability?.state !== 'supported') {
    refuse(cli, 'permission', requested,
      permissionCapability?.reason ?? `The ${permission} permission mode is not declared.`);
  }
  const networkCapability = network
    ? manifest.networkModes[network]
    : undefined;
  if (network && networkCapability?.state !== 'supported') {
    refuse(cli, 'network', requested,
      networkCapability?.reason ?? `The ${network} network mode is not declared.`);
  }
  if (
    permission && network &&
    !permissionCapability?.networkModes.includes(network)
  ) {
    refuse(cli, 'combination', requested,
      `${permission} with network ${network} is unsupported: ${permissionCapability?.nativeMode ?? permission} does not enforce that combination.`);
  }
  if (network === 'deny' && !permission) {
    refuse(cli, 'combination', requested,
      'Network denial requires an explicit permission mode with native network enforcement.');
  }
  const nativeDescription = [
    permissionCapability?.nativeMode,
    network === 'deny' ? 'network disabled' : undefined,
  ].filter((part): part is string => part !== undefined).join(', ');
  return nativeDescription
    ? { ...requested, nativeDescription }
    : requested;
}

/** Translate only values that the manifest and Tier 1 evidence support. */
export function translateLaneSpawnPolicy(
  cli: CliType,
  manifest: CliAdapterManifest,
  requested: EffectiveLanePolicy,
): LaneSpawnPolicyTranslation {
  const validated = validateLaneSpawnPolicy(cli, manifest, requested);
  const nativeDescription = validated.nativeDescription;
  switch (cli) {
    case 'codex':
      return {
        cli,
        requested: validated,
        nativeDescription,
        sandboxMode: codexSandboxMode(validated.permission),
        networkAccess: validated.network === 'deny' ? false : undefined,
      };
    case 'claude':
    case 'ptah-cli':
      return {
        cli,
        requested: validated,
        nativeDescription,
        permissionMode: claudePermissionMode(validated.permission),
        allowDangerouslySkipPermissions:
          validated.permission === 'yolo' ? true : undefined,
      };
    case 'copilot':
      return { cli, requested: validated, nativeDescription, argv: copilotArgv(validated.permission) };
    case 'antigravity':
      return { cli, requested: validated, nativeDescription, argv: antigravityArgv(validated.permission) };
    case 'opencode':
      return { cli, requested: validated, nativeDescription, argv: opencodeArgv(validated.permission) };
    case 'cursor':
    case 'grok':
    case 'pi':
      return { cli, requested: validated, nativeDescription };
  }
}

function refuse(
  cli: CliType,
  field: LaneSpawnPolicyRefusal['field'],
  requested: EffectiveLanePolicy,
  reason: string,
): never {
  throw new LaneSpawnPolicyError({
    code: 'UNSUPPORTED_LANE_POLICY', field, cli, requested, reason,
  });
}

function codexSandboxMode(
  permission: LanePermissionMode | undefined,
): 'read-only' | 'workspace-write' | 'danger-full-access' | undefined {
  switch (permission) {
    case 'plan': return 'read-only';
    case 'auto-edit': return 'workspace-write';
    case 'yolo': return 'danger-full-access';
    default: return undefined;
  }
}

function claudePermissionMode(
  permission: LanePermissionMode | undefined,
): 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions' | undefined {
  switch (permission) {
    case 'plan': return 'plan';
    case 'ask': return 'default';
    case 'auto-edit': return 'acceptEdits';
    case 'yolo': return 'bypassPermissions';
    default: return undefined;
  }
}

function copilotArgv(permission: LanePermissionMode | undefined): LaneArgvPolicyTranslation {
  if (!permission) return { addArgs: [], removeArgs: [] };
  const removeArgs = ['--allow-all-tools', '--allow-all'];
  switch (permission) {
    case 'plan':
      return { addArgs: ['--mode', 'plan'], removeArgs };
    case 'auto-edit':
      return {
        addArgs: [
          '--allow-tool=write_file', '--allow-tool=edit', '--allow-tool=replace',
          '--allow-tool=create_file', '--allow-tool=patch_file', '--allow-tool=write',
          '--allow-tool=insert',
        ],
        removeArgs,
      };
    case 'yolo':
      return { addArgs: ['--allow-all'], removeArgs };
    default:
      return { addArgs: [], removeArgs };
  }
}

function antigravityArgv(permission: LanePermissionMode | undefined): LaneArgvPolicyTranslation {
  if (!permission) return { addArgs: [], removeArgs: [] };
  const removeArgs = ['--dangerously-skip-permissions'];
  switch (permission) {
    case 'plan': return { addArgs: ['--mode', 'plan'], removeArgs };
    case 'auto-edit': return { addArgs: ['--mode', 'accept-edits'], removeArgs };
    case 'yolo': return { addArgs: ['--dangerously-skip-permissions'], removeArgs };
    default: return { addArgs: [], removeArgs };
  }
}

function opencodeArgv(permission: LanePermissionMode | undefined): LaneArgvPolicyTranslation {
  return permission === 'plan'
    ? { addArgs: ['--agent', 'plan'], removeArgs: ['--auto'] }
    : { addArgs: [], removeArgs: [] };
}

/** Apply a pure argv translation without changing the default argument order. */
export function applyLaneArgvPolicy(
  args: readonly string[],
  translation: LaneArgvPolicyTranslation,
): string[] {
  if (translation.addArgs.length === 0 && translation.removeArgs.length === 0)
    return [...args];
  const removed = new Set(translation.removeArgs);
  return [...args.filter((arg) => !removed.has(arg)), ...translation.addArgs];
}

/** Models known to loop when run as a lane; a spawn naming one is refused. */
export const BLOCKED_LANE_MODELS: readonly string[] = ['mimo-v2.6-flash-free'];

/**
 * The blocked entry matching `model`, or `undefined`. The comparison uses the
 * id after the last `/` (a provider prefix is ignored), case-insensitively.
 */
export function findBlockedLaneModel(
  model: string | undefined,
): string | undefined {
  if (!model) return undefined;
  const id = model.slice(model.lastIndexOf('/') + 1).toLowerCase();
  return BLOCKED_LANE_MODELS.find((blocked) => blocked.toLowerCase() === id);
}

/** The setting value that means "use the in-chat effort" (R2.3 step 3). */
const INHERIT = 'inherit';

/** The effort a reviewer or tester gets when its CLI's setting is empty (R2.3 step 4). */
const REVIEWER_DEFAULT_EFFORT = 'medium';

export interface LaneModelResolution {
  /** Passed to the adapter unchanged; `undefined` lets the CLI choose. */
  readonly model: string | undefined;
  readonly source: LaneModelSource;
}

/**
 * The model a lane runs on: the spawn request, then the per-CLI setting. With
 * neither, `model` is `undefined` and the CLI picks its own current default,
 * so a new model works without a Ptah release. `cli` stays in the signature
 * for the callers' contract; the policy itself is CLI-independent now.
 */
export function resolveLaneModel(
  cli: CliType,
  requestModel: string | undefined,
  settingModel: string | undefined,
): LaneModelResolution {
  if (requestModel) return { model: requestModel, source: 'request' };
  if (settingModel) return { model: settingModel, source: 'setting' };
  return { model: undefined, source: 'cli-default' };
}

/** The R2.3 step that produced a lane's effort. 6 means none: the CLI default applies. */
export type LaneEffortStep = 1 | 2 | 3 | 4 | 5 | 6;

/** A value that was offered at a step but is not an effort this CLI accepts. */
export interface IgnoredLaneEffort {
  readonly step: LaneEffortStep;
  readonly value: string;
}

export interface LaneEffortInput {
  readonly cli: CliType;
  /** The `effort` argument on the spawn call (step 1). */
  readonly spawnEffort?: string;
  /** `agentOrchestration.<cli>ReasoningEffort`; absent for a CLI without one. */
  readonly setting?: string;
  /** The effort selected in the chat (steps 3 and 5). */
  readonly chatEffort?: string;
  /** The resolved role name, for the reviewer/tester default (step 4). */
  readonly roleName?: string;
}

export interface LaneEffortResolution {
  /** The value for the CLI, already mapped onto its scale. */
  readonly effort: string | undefined;
  readonly step: LaneEffortStep;
  /** Values skipped because the CLI does not accept them, for the log. */
  readonly ignored: readonly IgnoredLaneEffort[];
}

/**
 * A spawn counts as a reviewer or tester when its role name ends in
 * `-reviewer` or equals `senior-tester` (R2.4). No role is neither.
 */
export function isReviewerOrTester(roleName: string | undefined): boolean {
  if (roleName === undefined) return false;
  return roleName.endsWith('-reviewer') || roleName === 'senior-tester';
}

/**
 * The effective effort for a lane, the first match of R2.3:
 *
 * 1. the spawn `effort` argument;
 * 2. the per-CLI setting, when it is a concrete level;
 * 3. the in-chat effort, when the setting is `inherit`;
 * 4. `medium`, when the setting is empty and the spawn is a reviewer or tester;
 * 5. the in-chat effort, when the setting is empty;
 * 6. none, so the CLI default applies.
 *
 * A value the CLI does not accept is ignored at its step and recorded in
 * `ignored`; resolution continues with the next step. An unaccepted setting
 * counts as empty, so steps 4 and 5 still apply. An `inherit` setting with
 * no usable in-chat effort also continues to step 4; step 5 then has nothing
 * new to offer, so a non-reviewer ends at step 6.
 *
 * A CLI whose effort Ptah does not resolve always ends at step 6, with any
 * offered spawn effort recorded as ignored.
 */
export function resolveLaneEffort(
  input: LaneEffortInput,
): LaneEffortResolution {
  const ignored: IgnoredLaneEffort[] = [];
  const mapEffort = effortMapperFor(input.cli);

  const offer = (
    step: LaneEffortStep,
    value: string | undefined,
  ): string | undefined => {
    if (!value) return undefined;
    const mapped = mapEffort?.(value);
    if (mapped === undefined) ignored.push({ step, value });
    return mapped;
  };
  const result = (
    effort: string | undefined,
    step: LaneEffortStep,
  ): LaneEffortResolution => ({ effort, step, ignored });

  const fromSpawn = offer(1, input.spawnEffort);
  if (fromSpawn) return result(fromSpawn, 1);
  if (!mapEffort) return result(undefined, 6);

  const setting = input.setting ?? '';
  if (setting === INHERIT) {
    const inherited = offer(3, input.chatEffort);
    if (inherited) return result(inherited, 3);
  } else if (setting !== '') {
    const fromSetting = offer(2, setting);
    if (fromSetting) return result(fromSetting, 2);
  }

  if (isReviewerOrTester(input.roleName)) {
    return result(mapEffort(REVIEWER_DEFAULT_EFFORT), 4);
  }
  if (setting !== INHERIT) {
    const fromChat = offer(5, input.chatEffort);
    if (fromChat) return result(fromChat, 5);
  }
  return result(undefined, 6);
}

/** The per-CLI mapping onto the scale that CLI accepts; `null` when Ptah does not resolve its effort. */
function effortMapperFor(
  cli: CliType,
): ((effort: string) => string | undefined) | null {
  switch (cli) {
    // Grok's `reasoning_effort` config option takes the same low..xhigh scale.
    case 'codex':
    case 'copilot':
    case 'grok':
      return mapEffortToCli;
    case 'antigravity':
      return mapEffortToAgy;
    case 'pi':
      return mapEffortToPi;
    case 'claude':
      return mapEffortToClaude;
    default:
      return null;
  }
}

/**
 * Allowlist an effort value to what Codex, Copilot and Grok accept (`max` → `xhigh`).
 * `minimal` → `low`: newer OpenAI models reject `minimal` with a 400.
 */
function mapEffortToCli(effort: string): string | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort;
    case 'minimal':
      return 'low';
    case 'max':
      return 'xhigh';
    default:
      return undefined;
  }
}

/** Allowlist the `low|medium|high|xhigh|max` scale `agy --effort` accepts. */
function mapEffortToAgy(effort: string): string | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort;
    default:
      return undefined;
  }
}

/**
 * Pi maps effort to `--thinking` and supports its full scale, so a level
 * passes through raw. `''` and `inherit` are setting markers, never levels.
 */
function mapEffortToPi(effort: string): string | undefined {
  if (effort === '' || effort === INHERIT) return undefined;
  return (PI_REASONING_EFFORT_VALUES as readonly string[]).includes(effort)
    ? effort
    : undefined;
}

/**
 * Allowlist the Claude Agent SDK scale (`low|medium|high|xhigh|max`) as-is.
 * No Codex `max` → `xhigh` and no `minimal` → `low`: an unsupported value is
 * ignored, never coerced. The adapter then checks the selected model's own
 * supported levels, so a level allowed here can still be "Not applied".
 */
function mapEffortToClaude(effort: string): string | undefined {
  if (effort === '' || effort === INHERIT) return undefined;
  return (CLAUDE_REASONING_EFFORT_VALUES as readonly string[]).includes(effort)
    ? effort
    : undefined;
}
