import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { MemoryTriggersDto } from '@ptah-extension/shared';

export const MEMORY_TRIGGER_SECTION = 'ptah';

export const MEMORY_TRIGGER_KEYS = {
  preCompact: 'memory.triggers.preCompact',
  idleMs: 'memory.triggers.idleMs',
  turnThreshold: 'memory.triggers.turnThreshold',
  bootScan: 'memory.triggers.bootScan',
  userPromptSubmit: {
    enabled: 'memory.triggers.userPromptSubmit.enabled',
    cueList: 'memory.triggers.userPromptSubmit.cueList',
    minPromptLength: 'memory.triggers.userPromptSubmit.minPromptLength',
  },
  postToolUse: {
    enabled: 'memory.triggers.postToolUse.enabled',
  },
  turnComplete: {
    enabled: 'memory.triggers.turnComplete.enabled',
  },
  episode: {
    enabled: 'memory.triggers.episode.enabled',
  },
  sessionEnd: {
    enabled: 'memory.triggers.sessionEnd.enabled',
  },
  maxCuratesPerHour: 'memory.triggers.maxCuratesPerHour',
} as const;

export const DEFAULT_CUE_LIST: readonly string[] = [
  'remember (this|that)',
  '(important|critical)\\s+(point|note|fact|detail)',
  'from now on',
  'going forward',
  'keep in mind',
  'note that',
  'save to memory',
];

export const MEMORY_TRIGGER_DEFAULTS = {
  preCompact: true,
  idleMs: 600000,
  turnThreshold: 20,
  bootScan: true,
  userPromptSubmit: {
    enabled: true,
    cueList: DEFAULT_CUE_LIST,
    minPromptLength: 20,
  },
  postToolUse: {
    enabled: true,
  },
  turnComplete: {
    enabled: true,
  },
  episode: {
    enabled: true,
  },
  sessionEnd: {
    enabled: true,
  },
  maxCuratesPerHour: 12,
} as const;

export const MEMORY_TRIGGER_PREFIXES: Record<keyof MemoryTriggersDto, string> =
  {
    preCompact: MEMORY_TRIGGER_KEYS.preCompact,
    idleMs: MEMORY_TRIGGER_KEYS.idleMs,
    turnThreshold: MEMORY_TRIGGER_KEYS.turnThreshold,
    bootScan: MEMORY_TRIGGER_KEYS.bootScan,
    userPromptSubmit: 'memory.triggers.userPromptSubmit',
    postToolUse: 'memory.triggers.postToolUse',
    turnComplete: 'memory.triggers.turnComplete',
    episode: 'memory.triggers.episode',
    sessionEnd: 'memory.triggers.sessionEnd',
    maxCuratesPerHour: MEMORY_TRIGGER_KEYS.maxCuratesPerHour,
  };

export interface PopulatedMemoryTriggers {
  readonly preCompact: boolean;
  readonly idleMs: number;
  readonly turnThreshold: number;
  readonly bootScan: boolean;
  readonly userPromptSubmit: {
    readonly enabled: boolean;
    readonly cueList: readonly string[];
    readonly minPromptLength: number;
  };
  readonly postToolUse: {
    readonly enabled: boolean;
  };
  readonly turnComplete: {
    readonly enabled: boolean;
  };
  readonly episode: {
    readonly enabled: boolean;
  };
  readonly sessionEnd: {
    readonly enabled: boolean;
  };
  readonly maxCuratesPerHour: number;
}

export function readMemoryTriggers(
  ws: IWorkspaceProvider,
): PopulatedMemoryTriggers {
  const preCompact =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.preCompact,
      MEMORY_TRIGGER_DEFAULTS.preCompact,
    ) ?? MEMORY_TRIGGER_DEFAULTS.preCompact;
  const idleMs =
    ws.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.idleMs,
      MEMORY_TRIGGER_DEFAULTS.idleMs,
    ) ?? MEMORY_TRIGGER_DEFAULTS.idleMs;
  const turnThreshold =
    ws.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnThreshold,
      MEMORY_TRIGGER_DEFAULTS.turnThreshold,
    ) ?? MEMORY_TRIGGER_DEFAULTS.turnThreshold;
  const bootScan =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.bootScan,
      MEMORY_TRIGGER_DEFAULTS.bootScan,
    ) ?? MEMORY_TRIGGER_DEFAULTS.bootScan;
  const userPromptSubmitEnabled =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.enabled,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled,
    ) ?? MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled;
  const userPromptSubmitCueListRaw = ws.getConfiguration<readonly string[]>(
    MEMORY_TRIGGER_SECTION,
    MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList,
    MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList,
  );
  const userPromptSubmitCueList = Array.isArray(userPromptSubmitCueListRaw)
    ? userPromptSubmitCueListRaw
    : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList;
  const userPromptSubmitMinPromptLength =
    ws.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.minPromptLength,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength,
    ) ?? MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength;
  const postToolUseEnabled =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.postToolUse.enabled,
      MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled,
    ) ?? MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled;
  const turnCompleteEnabled =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnComplete.enabled,
      MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled,
    ) ?? MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled;
  const episodeEnabled =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.episode.enabled,
      MEMORY_TRIGGER_DEFAULTS.episode.enabled,
    ) ?? MEMORY_TRIGGER_DEFAULTS.episode.enabled;
  const sessionEndEnabled =
    ws.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.sessionEnd.enabled,
      MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled,
    ) ?? MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled;
  const maxCuratesPerHour =
    ws.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.maxCuratesPerHour,
      MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour,
    ) ?? MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour;
  return {
    preCompact,
    idleMs,
    turnThreshold,
    bootScan,
    userPromptSubmit: {
      enabled: userPromptSubmitEnabled,
      cueList: userPromptSubmitCueList,
      minPromptLength: userPromptSubmitMinPromptLength,
    },
    postToolUse: {
      enabled: postToolUseEnabled,
    },
    turnComplete: {
      enabled: turnCompleteEnabled,
    },
    episode: {
      enabled: episodeEnabled,
    },
    sessionEnd: {
      enabled: sessionEndEnabled,
    },
    maxCuratesPerHour,
  };
}

export function flattenMemoryTriggers(
  input: Partial<MemoryTriggersDto>,
): Array<[string, unknown]> {
  const entries = Object.entries(input) as Array<
    [keyof MemoryTriggersDto, unknown]
  >;
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const prefix = MEMORY_TRIGGER_PREFIXES[key];
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
