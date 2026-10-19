/**
 * Advanced settings contracts (TASK_2026_658).
 *
 * One descriptor per file-based setting (`~/.ptah/settings.json`) that the
 * Settings "advanced" groups render: key, kind, bounds, default, when a change
 * takes effect, and the user-facing copy. Three readers share this table:
 * - platform-core derives `FILE_BASED_SETTINGS_DEFAULTS` for these keys from it,
 *   so each default literal lives here only;
 * - the `settings:set` RPC refuses a value its descriptor rejects;
 * - the chat settings groups render and validate fields from it.
 *
 * Bounds: where the consumer clamps (memory retention and lifecycle, skill
 * retirement, catch-up window, boot scan) the bounds equal the clamp. Where the
 * consumer has no maximum, the maximum is a product limit and the minimum is
 * never looser than the consumer's own floor.
 *
 * Plain types and literals only: this file is exported from the zod-free
 * shared barrel.
 */

/** The Settings group a descriptor is rendered in. */
export type AdvancedSettingGroupId =
  | 'context-budgets'
  | 'codex-agents'
  | 'background-queries'
  | 'memory-upkeep'
  | 'skill-upkeep'
  | 'scheduled-jobs'
  | 'workspace-harness'
  | 'notifications';

/**
 * When a saved value takes effect.
 * - `live`: the next time the consumer reads it, which is right away.
 * - `next-run`: on the next cleanup run or sweep.
 * - `next-agent`: for the next Codex agent started.
 * - `restart`: after Ptah restarts.
 */
export type AdvancedSettingApply =
  'live' | 'next-run' | 'next-agent' | 'restart';

interface AdvancedSettingBase {
  readonly key: string;
  readonly group: AdvancedSettingGroupId;
  /** Short field label. */
  readonly label: string;
  /**
   * One plain sentence on what the value controls. The renderer appends the
   * range and the apply note, so help never restates them.
   */
  readonly help: string;
  readonly apply: AdvancedSettingApply;
}

/** A numeric setting; `integer` settings reject fractions. */
export interface AdvancedNumberSetting extends AdvancedSettingBase {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  /** Plural unit shown after the value and in errors; absent for a bare ratio. */
  readonly unit?: string;
  readonly default: number;
}

export interface AdvancedBooleanSetting extends AdvancedSettingBase {
  readonly kind: 'boolean';
  readonly default: boolean;
}

export type AdvancedSetting = AdvancedNumberSetting | AdvancedBooleanSetting;

export interface AdvancedSettingGroup {
  readonly id: AdvancedSettingGroupId;
  readonly title: string;
  readonly description: string;
}

/** The result of checking one value against its descriptor. Never thrown. */
export type AdvancedSettingValidation =
  | { readonly ok: true; readonly value: number | boolean }
  | { readonly ok: false; readonly error: string };

export const ADVANCED_SETTING_GROUPS: readonly AdvancedSettingGroup[] = [
  {
    id: 'context-budgets',
    title: 'Context budgets',
    description:
      'Token sizes at which tool output, subagent results and long chats are cut down.',
  },
  {
    id: 'codex-agents',
    title: 'Codex agents',
    description: 'Limits Ptah passes to the Codex agents it starts.',
  },
  {
    id: 'background-queries',
    title: 'Background query limits',
    description:
      'How many background model calls (memory, skills, scheduled jobs) may run at once.',
  },
  {
    id: 'memory-upkeep',
    title: 'Memory upkeep',
    description: 'How long memory records are kept and how cleanup runs.',
  },
  {
    id: 'skill-upkeep',
    title: 'Skill upkeep',
    description:
      'When learned skills are retired and how strictly new ones are checked.',
  },
  {
    id: 'scheduled-jobs',
    title: 'Scheduled jobs',
    description: 'Limits for jobs that run on a schedule.',
  },
  {
    id: 'workspace-harness',
    title: 'Workspace harness',
    description: 'How Ptah checks and maintains the workspace harness files.',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'When Ptah sends notifications through the host.',
  },
];

export const ADVANCED_SETTINGS: readonly AdvancedSetting[] = [
  // Context budgets. Read on every tool call and subagent message.
  {
    key: 'compaction.toolOutputBudgetTokens',
    group: 'context-budgets',
    kind: 'number',
    label: 'Tool output size',
    help: 'A single tool result longer than this is cut down before the model sees it.',
    unit: 'tokens',
    min: 100,
    max: 200_000,
    integer: true,
    default: 2_500,
    apply: 'live',
  },
  {
    key: 'compaction.subagentHandoffTokens',
    group: 'context-budgets',
    kind: 'number',
    label: 'Subagent handoff size',
    help: 'When a subagent context reaches this size, Ptah stops it and gives the main chat a handoff to continue the work.',
    unit: 'tokens',
    min: 1_000,
    max: 2_000_000,
    integer: true,
    default: 150_000,
    apply: 'live',
  },
  {
    key: 'compaction.rotationSuggestTokens',
    group: 'context-budgets',
    kind: 'number',
    label: 'Suggest a new session at',
    help: "When a chat's context reaches this size, Ptah suggests starting a new session.",
    unit: 'tokens',
    min: 1_000,
    max: 5_000_000,
    integer: true,
    default: 300_000,
    apply: 'live',
  },
  {
    key: 'compaction.subagentStopWeightedTokens',
    group: 'context-budgets',
    kind: 'number',
    label: 'Subagent stop size',
    help: 'A subagent is stopped once its weighted token total reaches this size.',
    unit: 'weighted tokens',
    min: 1_000,
    max: 100_000_000,
    integer: true,
    default: 3_000_000,
    apply: 'live',
  },
  {
    key: 'compaction.idleCompactionEnabled',
    group: 'context-budgets',
    kind: 'boolean',
    label: 'Compact idle chats',
    help: "Before a long chat's prompt cache expires, Ptah compacts it so your next message costs less.",
    default: true,
    apply: 'live',
  },
  {
    key: 'compaction.idleCompactionMinTokens',
    group: 'context-budgets',
    kind: 'number',
    label: 'Compact idle chats from',
    help: 'Ptah compacts an idle chat once it reaches this size.',
    unit: 'tokens',
    min: 100_000,
    max: 5_000_000,
    integer: true,
    default: 200_000,
    apply: 'live',
  },
  // Codex agents. Read on each Codex spawn; 0 leaves the key out.
  {
    key: 'agentOrchestration.codexAutoCompactTokens',
    group: 'codex-agents',
    kind: 'number',
    label: 'Codex auto-compact size',
    help: 'Codex compacts its conversation when it reaches this size. 0 uses the Codex default.',
    unit: 'tokens',
    min: 0,
    max: 2_000_000,
    integer: true,
    default: 120_000,
    apply: 'next-agent',
  },
  {
    key: 'agentOrchestration.codexToolOutputTokenLimit',
    group: 'codex-agents',
    kind: 'number',
    label: 'Codex tool output limit',
    help: 'Codex cuts each tool result down to this size. 0 uses the Codex default.',
    unit: 'tokens',
    min: 0,
    max: 200_000,
    integer: true,
    default: 2_500,
    apply: 'next-agent',
  },
  {
    key: 'agentOrchestration.codexWebSearch',
    group: 'codex-agents',
    kind: 'boolean',
    label: 'Codex web search',
    help: 'Lets Codex agents search the web.',
    default: true,
    apply: 'next-agent',
  },
  // Background query limits. Read each time a background query asks for a slot.
  {
    key: 'internalQuery.maxConcurrent',
    group: 'background-queries',
    kind: 'number',
    label: 'Parallel background queries',
    help: 'The most background model calls that may run at the same time.',
    unit: 'queries',
    min: 1,
    max: 16,
    integer: true,
    default: 3,
    apply: 'live',
  },
  {
    key: 'internalQuery.maxConcurrentPerLane',
    group: 'background-queries',
    kind: 'number',
    label: 'Parallel queries per feature',
    help: 'The most background model calls one feature, such as memory or skills, may run at the same time.',
    unit: 'queries',
    min: 1,
    max: 16,
    integer: true,
    default: 1,
    apply: 'live',
  },
  {
    key: 'internalQuery.queueTimeoutMs',
    group: 'background-queries',
    kind: 'number',
    label: 'Queue wait limit',
    help: 'How long a background query waits for a free slot before it gives up.',
    unit: 'ms',
    min: 1_000,
    max: 600_000,
    integer: true,
    default: 60_000,
    apply: 'live',
  },
  // Memory upkeep. Bounds equal MEMORY_RETENTION_SETTING_RANGES and
  // MEMORY_LIFECYCLE_SETTING_RANGES (memory-curator); a spec there pins it.
  {
    key: 'memory.symbolInjectionEnabled',
    group: 'memory-upkeep',
    kind: 'boolean',
    label: 'Add code symbols to prompts',
    help: 'Adds matching symbols from the indexed workspace code to the session prompt.',
    default: true,
    apply: 'live',
  },
  {
    key: 'memory.retention.processedDays',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Keep processed records for',
    help: 'Captured records that memory has already processed are deleted after this long.',
    unit: 'days',
    min: 1,
    max: 365,
    integer: true,
    default: 7,
    apply: 'next-run',
  },
  {
    key: 'memory.retention.stuckDays',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Report stuck records after',
    help: 'Records still unprocessed after this long are reported as stuck. They are never deleted.',
    unit: 'days',
    min: 7,
    max: 365,
    integer: true,
    default: 14,
    apply: 'next-run',
  },
  {
    key: 'memory.retention.batchSize',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Cleanup batch size',
    help: 'The most records one cleanup step removes at a time.',
    unit: 'records',
    min: 50,
    max: 5_000,
    integer: true,
    default: 500,
    apply: 'next-run',
  },
  {
    key: 'memory.lifecycle.archiveAfterDays',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Archive unused memories after',
    help: 'A memory that has not been used for this long is archived. Pinned memories are kept.',
    unit: 'days',
    min: 7,
    max: 365,
    integer: true,
    default: 30,
    apply: 'next-run',
  },
  {
    key: 'memory.lifecycle.deleteAfterDays',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Delete archived memories after',
    help: 'An archived memory is deleted after this long.',
    unit: 'days',
    min: 7,
    max: 730,
    integer: true,
    default: 60,
    apply: 'next-run',
  },
  {
    key: 'memory.lifecycle.maxPerWorkspace',
    group: 'memory-upkeep',
    kind: 'number',
    label: 'Memories per workspace',
    help: 'Cleanup trims a workspace with more memories than this back down. Pinned and core memories are kept.',
    unit: 'memories',
    min: 1_000,
    max: 1_000_000,
    integer: true,
    default: 25_000,
    apply: 'next-run',
  },
  // Skill upkeep.
  {
    key: 'skillSynthesis.retirement.dormantAfterDays',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Mark skills dormant after',
    help: 'A learned skill that has not been used for this long is marked dormant.',
    unit: 'days',
    min: 1,
    max: 3_650,
    integer: true,
    default: 30,
    apply: 'next-run',
  },
  {
    key: 'skillSynthesis.retirement.retireAfterDormantDays',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Retire dormant skills after',
    help: 'A dormant skill is retired once it has stayed dormant this long.',
    unit: 'days',
    min: 1,
    max: 3_650,
    integer: true,
    default: 30,
    apply: 'next-run',
  },
  {
    key: 'skillSynthesis.replayValidation.minConfidence',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Replay confidence floor',
    help: 'The lowest replay confidence that counts as evidence for promoting a new skill.',
    min: 0,
    max: 1,
    integer: false,
    default: 0.5,
    apply: 'live',
  },
  {
    // Max = the judge's per-criterion score range: each criterion is scored
    // 1-10 (`toScore` in skill-synthesis skill-judge.service.ts), so no two
    // scores can differ by more than 9.
    key: 'skillSynthesis.judgePanel.disagreementThreshold',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Judge disagreement limit',
    help: 'When two judges score any criterion further apart than this, a third judge decides.',
    unit: 'points',
    min: 0,
    max: 9,
    integer: false,
    default: 3,
    apply: 'live',
  },
  {
    key: 'skillSynthesis.triggers.bootScanDelayMs',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Startup skill scan delay',
    help: 'How long after start-up Ptah waits before it scans past sessions for new skills.',
    unit: 'ms',
    min: 0,
    max: 3_600_000,
    integer: true,
    default: 300_000,
    apply: 'restart',
  },
  {
    key: 'skillSynthesis.triggers.bootScanIdleBackoffMs',
    group: 'skill-upkeep',
    kind: 'number',
    label: 'Startup scan wait while chatting',
    help: 'If you chatted more recently than this, the startup skill scan waits this long again.',
    unit: 'ms',
    min: 0,
    max: 3_600_000,
    integer: true,
    default: 300_000,
    apply: 'live',
  },
  // Scheduled jobs. Read once when the scheduler starts.
  {
    key: 'cron.maxConcurrentJobs',
    group: 'scheduled-jobs',
    kind: 'number',
    label: 'Parallel jobs',
    help: 'The most scheduled jobs that may run at the same time.',
    unit: 'jobs',
    min: 1,
    max: 16,
    integer: true,
    default: 3,
    apply: 'restart',
  },
  {
    key: 'cron.catchupWindowMs',
    group: 'scheduled-jobs',
    kind: 'number',
    label: 'Catch-up window',
    help: 'Jobs missed within this long before Ptah starts are run once at start-up. 0 turns catch-up off.',
    unit: 'ms',
    min: 0,
    max: 86_400_000,
    integer: true,
    default: 86_400_000,
    apply: 'restart',
  },
  // Workspace harness. Defaults equal DEFAULT_PREFLIGHT_TIMEOUT_MS and
  // DEFAULT_MANAGE_GITIGNORE in harness-sync.
  {
    key: 'harness.preflightTimeoutMs',
    group: 'workspace-harness',
    kind: 'number',
    label: 'Harness check timeout',
    help: 'How long a session start waits for the workspace harness check before it carries on.',
    unit: 'ms',
    min: 100,
    max: 60_000,
    integer: true,
    default: 1_500,
    apply: 'live',
  },
  {
    key: 'harness.manageGitignore',
    group: 'workspace-harness',
    kind: 'boolean',
    label: 'Manage .gitignore',
    help: "Lets Ptah keep its generated harness files listed in the workspace's .gitignore.",
    default: true,
    apply: 'live',
  },
  {
    key: 'notifications.hostEnabled',
    group: 'notifications',
    kind: 'boolean',
    label: 'Host notifications',
    help: 'Shows OS or VS Code notifications for requests that need your attention.',
    default: true,
    apply: 'live',
  },
  {
    key: 'notifications.failureHostEnabled',
    group: 'notifications',
    kind: 'boolean',
    label: 'Failure notifications',
    help: 'Shows OS or VS Code notifications when a task fails.',
    default: false,
    apply: 'live',
  },
];

/** The descriptor for `key`, or `undefined` when the key is not described. */
export function findAdvancedSetting(key: string): AdvancedSetting | undefined {
  return ADVANCED_SETTINGS.find((setting) => setting.key === key);
}

function formatBound(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Check `value` against `setting`. Pure: an invalid value returns
 * `{ ok: false, error }` with the range and unit in plain words.
 */
export function validateAdvancedSettingValue(
  setting: AdvancedSetting,
  value: unknown,
): AdvancedSettingValidation {
  if (setting.kind === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, error: 'Use on or off.' };
  }
  const unit = setting.unit ? ` ${setting.unit}` : '';
  const error = `Use ${setting.integer ? 'a whole number' : 'a number'} from ${formatBound(setting.min)} to ${formatBound(setting.max)}${unit}.`;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (setting.integer && !Number.isInteger(value)) ||
    value < setting.min ||
    value > setting.max
  ) {
    return { ok: false, error };
  }
  return { ok: true, value };
}
