/**
 * Lane spawn policy (TASK_2026_597, D4, R2.1-R2.5).
 *
 * Pure decisions about a lane's model and reasoning effort. Settings are read
 * by `AgentSpawnEnvironment`, which hands the raw values here; the manager
 * logs the result. Nothing in this file touches I/O.
 */
import { PI_REASONING_EFFORT_VALUES } from '@ptah-extension/shared';
import type { CliType } from '@ptah-extension/shared';
import type { LaneModelSource } from './cli-adapters/cli-adapter.interface';

/**
 * Ptah's own model for a Codex lane when neither the spawn request nor
 * `agentOrchestration.codexModel` names one (R2.1). Codex only; every other
 * CLI keeps its own default.
 */
export const CODEX_LANE_DEFAULT_MODEL = 'gpt-6-sol';

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
 * The model a lane runs on: the spawn request, then the per-CLI setting, then
 * Ptah's Codex default, then the CLI's own default.
 */
export function resolveLaneModel(
  cli: CliType,
  requestModel: string | undefined,
  settingModel: string | undefined,
): LaneModelResolution {
  if (requestModel) return { model: requestModel, source: 'request' };
  if (settingModel) return { model: settingModel, source: 'setting' };
  if (cli === 'codex') {
    return { model: CODEX_LANE_DEFAULT_MODEL, source: 'ptah-default' };
  }
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
    case 'minimal':
      return 'low';
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
