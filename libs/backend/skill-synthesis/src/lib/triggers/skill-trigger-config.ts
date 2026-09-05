import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SkillTriggersDto } from '@ptah-extension/shared';

export const SKILL_TRIGGER_SECTION = 'ptah';

export const SKILL_TRIGGER_KEYS = {
  sessionEnd: 'skillSynthesis.triggers.sessionEnd',
  idleMs: 'skillSynthesis.triggers.idleMs',
  bootScan: 'skillSynthesis.triggers.bootScan',
  /**
   * How long after `start()` the boot scan waits before its first attempt.
   *
   * Deliberately absent from `SkillTriggersDto` / {@link SKILL_TRIGGER_PREFIXES}
   * — like `memory.triggers.bootScanDelayMs`, it is a cost/latency tuning knob
   * rather than one of the per-trigger toggles the settings panel round-trips.
   * `0` is legal and restores the previous "scan immediately from `start()`"
   * behaviour.
   */
  bootScanDelayMs: 'skillSynthesis.triggers.bootScanDelayMs',
  /**
   * How recent foreground chat activity has to be for a due boot scan to re-arm
   * instead of running. See `SkillTriggerService.scheduleBootScan`. `0` disables
   * the activity gate entirely.
   */
  bootScanIdleBackoffMs: 'skillSynthesis.triggers.bootScanIdleBackoffMs',
  subagentStop: {
    enabled: 'skillSynthesis.triggers.subagentStop.enabled',
  },
  turnComplete: {
    enabled: 'skillSynthesis.triggers.turnComplete.enabled',
  },
  postToolUse: {
    enabled: 'skillSynthesis.triggers.postToolUse.enabled',
    minEditCount: 'skillSynthesis.triggers.postToolUse.minEditCount',
  },
  skillInvocationTelemetry: {
    enabled: 'skillSynthesis.triggers.skillInvocationTelemetry.enabled',
  },
  maxAnalyzesPerHour: 'skillSynthesis.triggers.maxAnalyzesPerHour',
} as const;

export const SKILL_TRIGGER_DEFAULTS = {
  sessionEnd: true,
  idleMs: 600000,
  bootScan: true,
  /** 5 min. Matches `MEMORY_TRIGGER_DEFAULTS.bootScanDelayMs`. */
  bootScanDelayMs: 300000,
  /** 5 min. Matches `MEMORY_TRIGGER_DEFAULTS.bootScanIdleBackoffMs`. */
  bootScanIdleBackoffMs: 300000,
  subagentStop: {
    enabled: true,
  },
  turnComplete: {
    enabled: true,
  },
  postToolUse: {
    enabled: true,
    minEditCount: 3,
  },
  skillInvocationTelemetry: {
    enabled: true,
  },
  maxAnalyzesPerHour: 6,
} as const;

export const SKILL_TRIGGER_PREFIXES: Record<keyof SkillTriggersDto, string> = {
  sessionEnd: SKILL_TRIGGER_KEYS.sessionEnd,
  idleMs: SKILL_TRIGGER_KEYS.idleMs,
  bootScan: SKILL_TRIGGER_KEYS.bootScan,
  subagentStop: 'skillSynthesis.triggers.subagentStop',
  turnComplete: 'skillSynthesis.triggers.turnComplete',
  postToolUse: 'skillSynthesis.triggers.postToolUse',
  maxAnalyzesPerHour: SKILL_TRIGGER_KEYS.maxAnalyzesPerHour,
};

export interface PopulatedSkillTriggers {
  readonly sessionEnd: boolean;
  readonly idleMs: number;
  readonly bootScan: boolean;
  readonly subagentStop: {
    readonly enabled: boolean;
  };
  readonly turnComplete: {
    readonly enabled: boolean;
  };
  readonly postToolUse: {
    readonly enabled: boolean;
    readonly minEditCount: number;
  };
  readonly maxAnalyzesPerHour: number;
}

export function readSkillTriggers(
  ws: IWorkspaceProvider,
): PopulatedSkillTriggers {
  const sessionEnd =
    ws.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.sessionEnd,
      SKILL_TRIGGER_DEFAULTS.sessionEnd,
    ) ?? SKILL_TRIGGER_DEFAULTS.sessionEnd;
  const idleMs =
    ws.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.idleMs,
      SKILL_TRIGGER_DEFAULTS.idleMs,
    ) ?? SKILL_TRIGGER_DEFAULTS.idleMs;
  const bootScan =
    ws.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.bootScan,
      SKILL_TRIGGER_DEFAULTS.bootScan,
    ) ?? SKILL_TRIGGER_DEFAULTS.bootScan;
  const subagentStopEnabled =
    ws.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.subagentStop.enabled,
      SKILL_TRIGGER_DEFAULTS.subagentStop.enabled,
    ) ?? SKILL_TRIGGER_DEFAULTS.subagentStop.enabled;
  const turnCompleteEnabled =
    ws.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.turnComplete.enabled,
      SKILL_TRIGGER_DEFAULTS.turnComplete.enabled,
    ) ?? SKILL_TRIGGER_DEFAULTS.turnComplete.enabled;
  const postToolUseEnabled =
    ws.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.enabled,
      SKILL_TRIGGER_DEFAULTS.postToolUse.enabled,
    ) ?? SKILL_TRIGGER_DEFAULTS.postToolUse.enabled;
  const postToolUseMinEditCount =
    ws.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.minEditCount,
      SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount,
    ) ?? SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount;
  const maxAnalyzesPerHour =
    ws.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.maxAnalyzesPerHour,
      SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour,
    ) ?? SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour;
  return {
    sessionEnd,
    idleMs,
    bootScan,
    subagentStop: {
      enabled: subagentStopEnabled,
    },
    turnComplete: {
      enabled: turnCompleteEnabled,
    },
    postToolUse: {
      enabled: postToolUseEnabled,
      minEditCount: postToolUseMinEditCount,
    },
    maxAnalyzesPerHour,
  };
}

export function flattenSkillTriggers(
  input: Partial<SkillTriggersDto>,
): Array<[string, unknown]> {
  const entries = Object.entries(input) as Array<
    [keyof SkillTriggersDto, unknown]
  >;
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const prefix = SKILL_TRIGGER_PREFIXES[key];
    out.push(...flatten(prefix, value));
  }
  return out;
}

function flatten(prefix: string, value: unknown): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]];
  }
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...flatten(`${prefix}.${k}`, v));
  }
  return out;
}
