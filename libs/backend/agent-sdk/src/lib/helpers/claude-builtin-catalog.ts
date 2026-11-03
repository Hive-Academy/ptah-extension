/**
 * Claude Code built-ins that Ptah turns off by default (TASK_2026_853, A-1).
 *
 * The single home of the default-off tool and terminal-skill lists, their
 * measured prefix costs, the tool-to-skill dependency map and the pure rule
 * that turns the user's stored opt-ins into session denials. The main session
 * (`SdkQueryOptionsBuilder`), the Claude lanes (`PtahCliSpawnOptions`) and the
 * settings RPC (`agent:getClaudeBuiltins`) all read this one definition.
 *
 * Costs are measured from first-turn `api-request-shape` entries: tools use the
 * measured constants, skills `ceil(listing chars / 2.64)`. The UI rounds them.
 */

import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

/** One built-in tool Ptah turns off unless the user opts in. */
export interface ClaudeBuiltinToolRow {
  readonly id: string;
  readonly description: string;
  readonly approxTokens: number;
  /** Terminal skills that stay hidden while this tool is off. */
  readonly skillsNeedingIt: readonly string[];
}

/** One terminal-only built-in skill Ptah hides unless the user opts in. */
export interface ClaudeBuiltinSkillRow {
  readonly id: string;
  readonly description: string;
  readonly approxTokens: number;
  /** The catalog tool this skill cannot work without, when it has one. */
  readonly needsTool?: string;
}

/**
 * Default-off built-in tools. Each one has no Ptah UI, backend state or
 * shipped skill that depends on it; old transcripts that used one still
 * render with their existing component on replay.
 */
export const CLAUDE_BUILTIN_TOOLS: readonly ClaudeBuiltinToolRow[] = [
  {
    id: 'Workflow',
    description: 'Launches a saved multi-step workflow script.',
    approxTokens: 2000,
    skillsNeedingIt: ['workflow-authoring'],
  },
  {
    id: 'ReportFindings',
    description: 'Sends code-review findings as a typed list.',
    approxTokens: 850,
    skillsNeedingIt: ['code-review'],
  },
  {
    id: 'PushNotification',
    description: 'Sends a desktop notification.',
    approxTokens: 10,
    skillsNeedingIt: [],
  },
  {
    id: 'DesignSync',
    description: 'Syncs claude.ai design files.',
    approxTokens: 10,
    skillsNeedingIt: [],
  },
  {
    id: 'EnterWorktree',
    description: 'Moves the session into a git worktree.',
    approxTokens: 10,
    skillsNeedingIt: [],
  },
  {
    id: 'ExitWorktree',
    description: 'Leaves a worktree session.',
    approxTokens: 10,
    skillsNeedingIt: [],
  },
];

/** Default-off built-in skills that only make sense in the terminal CLI. */
export const CLAUDE_BUILTIN_TERMINAL_SKILLS: readonly ClaudeBuiltinSkillRow[] =
  [
    {
      id: 'keybindings-help',
      description: "Edits the terminal's keyboard bindings.",
      approxTokens: 90,
    },
    {
      id: 'update-config',
      description: "Edits Claude Code's settings.json hooks and permissions.",
      approxTokens: 270,
    },
    {
      id: 'fewer-permission-prompts',
      description: 'Mines CLI transcripts for a permission allowlist.',
      approxTokens: 70,
    },
    {
      id: 'plugin-authoring',
      description: 'Builds mods for the Claude terminal UI.',
      approxTokens: 100,
    },
    {
      id: 'init',
      description: 'Writes a CLAUDE.md for the project.',
      approxTokens: 25,
    },
    {
      id: 'workflow-authoring',
      description: 'Writes scripts for the Workflow tool.',
      approxTokens: 95,
      needsTool: 'Workflow',
    },
    {
      id: 'code-review',
      description: 'Reviews the current diff for bugs.',
      approxTokens: 460,
      needsTool: 'ReportFindings',
    },
  ];

/**
 * Built-ins Ptah depends on. The catalog must never contain one of them; a
 * spec pins that the two lists do not intersect.
 */
export const PROTECTED_CLAUDE_TOOLS: readonly string[] = [
  'Agent',
  'Task',
  'AskUserQuestion',
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Skill',
  'ToolSearch',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'EnterPlanMode',
  'ExitPlanMode',
  'SendMessage',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
];

/** The global file settings (section `ptah`) that hold the two opt-in lists. */
export const CLAUDE_BUILTIN_SETTING_KEYS = {
  tools: 'agentOrchestration.enabledClaudeBuiltinTools',
  skills: 'agentOrchestration.enabledClaudeBuiltinSkills',
} as const;

/**
 * The qualifier claude.ai account-synced skills are listed under. Only the
 * qualified key hides a synced skill without hiding a same-name workspace,
 * user or plugin skill (A0 spike case b; a bare key hides both, case c).
 */
export const SYNCED_CLAUDE_SKILL_PREFIX = 'anthropic-skills:';

/** The qualified id of a synced skill name. Pure. */
export function syncedClaudeSkillId(name: string): string {
  return `${SYNCED_CLAUDE_SKILL_PREFIX}${name}`;
}

/** Whether `id` is a qualified synced-skill id with a non-empty name. Pure. */
export function isSyncedClaudeSkillId(id: string): boolean {
  return (
    id.startsWith(SYNCED_CLAUDE_SKILL_PREFIX) &&
    id.length > SYNCED_CLAUDE_SKILL_PREFIX.length
  );
}

export interface ClaudeBuiltinPolicyInput {
  readonly enabledTools: readonly string[];
  /**
   * Enabled terminal-skill ids and enabled synced ids
   * (`anthropic-skills:<name>`); both live in the one skills setting.
   */
  readonly enabledSkills: readonly string[];
  /**
   * Account-synced skill ids found for the session's config dir. Only
   * qualified ids count; a bare name here is ignored, so this list can never
   * produce a bare key that hides a same-name skill.
   */
  readonly syncedSkillIds?: readonly string[];
}

/** What a session must deny under the user's opt-ins. Both lists sorted. */
export interface ClaudeBuiltinPolicy {
  readonly disallowedTools: readonly string[];
  readonly deniedSkillNames: readonly string[];
}

/** Catalog tool ids, in catalog order. */
export const CLAUDE_BUILTIN_TOOL_IDS: readonly string[] =
  CLAUDE_BUILTIN_TOOLS.map((row) => row.id);
/** Catalog terminal-skill ids, in catalog order. */
export const CLAUDE_BUILTIN_TERMINAL_SKILL_IDS: readonly string[] =
  CLAUDE_BUILTIN_TERMINAL_SKILLS.map((row) => row.id);

function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

/**
 * Keep only the `known` names of `names`, deduped and sorted. This is the
 * one normalisation for a stored opt-in list, on write and on read.
 */
export function normalizeClaudeBuiltinIds(
  names: readonly string[],
  known: readonly string[],
): string[] {
  const knownSet = new Set(known);
  return sortedUnique(names.filter((name) => knownSet.has(name)));
}

/**
 * Turn the user's opt-ins into session denials. Pure.
 *
 * - `disallowedTools`: every catalog tool that is not enabled.
 * - `deniedSkillNames`: every terminal skill that is not enabled, every
 *   terminal skill whose needed tool is disallowed, and every qualified
 *   synced skill id (`anthropic-skills:<name>`) that is not enabled.
 *
 * Names that are not in the catalog or the synced set are ignored, so a
 * hand-edited setting can never deny a skill or tool outside these lists.
 */
export function resolveClaudeBuiltinPolicy(
  input: ClaudeBuiltinPolicyInput,
): ClaudeBuiltinPolicy {
  const enabledTools = new Set(input.enabledTools);
  const enabledSkills = new Set(input.enabledSkills);
  const disallowedTools = CLAUDE_BUILTIN_TOOL_IDS.filter(
    (id) => !enabledTools.has(id),
  );
  const disallowed = new Set(disallowedTools);
  const deniedTerminal = CLAUDE_BUILTIN_TERMINAL_SKILLS.filter(
    (row) =>
      !enabledSkills.has(row.id) ||
      (row.needsTool !== undefined && disallowed.has(row.needsTool)),
  ).map((row) => row.id);
  const deniedSynced = (input.syncedSkillIds ?? []).filter(
    (id) => isSyncedClaudeSkillId(id) && !enabledSkills.has(id),
  );
  return {
    disallowedTools: sortedUnique(disallowedTools),
    deniedSkillNames: sortedUnique([...deniedTerminal, ...deniedSynced]),
  };
}

/** Where a skill that shares a name with a catalog terminal skill was found. */
export type ClaudeSkillSourceKind = 'workspace' | 'user' | 'plugin';

/**
 * Same-name skills found for a session, by catalog skill name. `null` means
 * discovery could not finish, so a collision cannot be ruled out.
 */
export type ClaudeSameNameSkills = ReadonlyMap<
  string,
  readonly ClaudeSkillSourceKind[]
> | null;

/** A catalog skill denial that was not emitted, and why. */
export interface ClaudeBuiltinSkillKeptVisible {
  readonly name: string;
  readonly reason: 'same-name-skill' | 'discovery-unknown';
  /** Where the same-name skill lives; empty when discovery was unknown. */
  readonly sources: readonly ClaudeSkillSourceKind[];
}

export interface ClaudeBuiltinSkillCollisionResult {
  /** The denials that are safe to emit as bare `skillOverrides` keys. */
  readonly deniedSkillNames: string[];
  readonly keptVisible: readonly ClaudeBuiltinSkillKeptVisible[];
}

/**
 * Drop each catalog terminal-skill denial that would hide someone else's
 * skill. Pure.
 *
 * A bare `skillOverrides` key hides EVERY skill with that name, from every
 * source (A0 spike case c, decisions #31/#33). So a catalog denial such as
 * `init` is not emitted when a workspace, user or plugin skill is also named
 * `init`: the built-in stays visible (a few hundred tokens), the user's skill
 * is never hidden. When `sameName` is `null` (discovery failed), every catalog
 * denial is dropped for the same reason.
 *
 * Names outside the terminal-skill catalog (synced `anthropic-skills:<name>`
 * ids, which are already qualified) pass through unchanged.
 */
export function withoutCollidingBuiltinSkillDenials(
  deniedSkillNames: readonly string[],
  sameName: ClaudeSameNameSkills,
): ClaudeBuiltinSkillCollisionResult {
  const catalog = new Set(CLAUDE_BUILTIN_TERMINAL_SKILL_IDS);
  const kept: string[] = [];
  const keptVisible: ClaudeBuiltinSkillKeptVisible[] = [];
  for (const name of deniedSkillNames) {
    if (!catalog.has(name)) {
      kept.push(name);
    } else if (sameName === null) {
      keptVisible.push({ name, reason: 'discovery-unknown', sources: [] });
    } else {
      const sources = sameName.get(name);
      if (sources !== undefined && sources.length > 0) {
        keptVisible.push({ name, reason: 'same-name-skill', sources });
      } else {
        kept.push(name);
      }
    }
  }
  return { deniedSkillNames: kept, keptVisible };
}

/**
 * The string entries of a stored opt-in value. A hand-edited file can hold
 * anything, so a non-array reads as no opt-ins (every catalog item off).
 */
export function readClaudeBuiltinOptIns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** The stored opt-ins, with tool and terminal-skill ids kept to the catalog. */
export interface ClaudeBuiltinOptIns {
  readonly enabledTools: string[];
  readonly enabledSkills: string[];
}

/**
 * Read both opt-in lists from the global file settings. A read failure, a
 * missing provider or a malformed value is treated as `[]`: every catalog
 * item off, the safe default for the prefix. Skill ids are not filtered here
 * because the same list also holds synced opt-ins (`anthropic-skills:<name>`,
 * Phase B), which are not part of the static catalog;
 * {@link resolveClaudeBuiltinPolicy} ignores unknown names.
 */
export function readClaudeBuiltinOptInSettings(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'> | undefined,
  logger?: Pick<Logger, 'warn'>,
): ClaudeBuiltinOptIns {
  const read = (key: string): string[] => {
    if (!workspace) return [];
    try {
      return readClaudeBuiltinOptIns(
        workspace.getConfiguration<unknown>('ptah', key, []),
      );
    } catch (error: unknown) {
      // degradation-audit: reported - the failure is logged and an empty
      // opt-in list keeps every catalog item off, the safe prefix default.
      logger?.warn(
        '[ClaudeBuiltinCatalog] Could not read a built-in opt-in setting; treating it as empty',
        { key, error: error instanceof Error ? error.message : String(error) },
      );
      return [];
    }
  };
  return {
    enabledTools: normalizeClaudeBuiltinIds(
      read(CLAUDE_BUILTIN_SETTING_KEYS.tools),
      CLAUDE_BUILTIN_TOOL_IDS,
    ),
    enabledSkills: sortedUnique(read(CLAUDE_BUILTIN_SETTING_KEYS.skills)),
  };
}
