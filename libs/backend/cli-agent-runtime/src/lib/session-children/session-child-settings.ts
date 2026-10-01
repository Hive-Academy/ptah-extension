/**
 * The four `ptah.agentSessions.*` settings that bound child sessions
 * (TASK_2026_584), read fresh on every `ptah_session_start`.
 *
 * The extension manifest protects only the VS Code settings UI; Electron, the
 * CLI and hand-edited settings reach this code unchecked. So every value is
 * validated here: a value of the wrong type falls back to its default and a
 * number outside its range is clamped (pattern:
 * `AgentSpawnEnvironment.maxConcurrentAgents`).
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/** Configuration section the keys below live under. */
export const SESSION_CHILD_SETTINGS_SECTION = 'ptah';

export interface SessionChildSettings {
  /** Live children across the whole host. */
  readonly maxConcurrent: number;
  /** Wall-clock cap per child, in minutes. */
  readonly maxRuntimeMinutes: number;
  /** How long a prompt outside the policy waits in the child's tab before it is denied. */
  readonly permissionDenyWindowMs: number;
  /** Bash command prefixes a child may run without asking. */
  readonly bashAllowlist: readonly string[];
}

interface IntegerSetting {
  readonly key: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

export const SESSION_CHILD_MAX_CONCURRENT: IntegerSetting = {
  key: 'agentSessions.maxConcurrent',
  fallback: 3,
  min: 1,
  max: 5,
};

export const SESSION_CHILD_MAX_RUNTIME_MINUTES: IntegerSetting = {
  key: 'agentSessions.maxRuntimeMinutes',
  fallback: 120,
  min: 5,
  max: 720,
};

export const SESSION_CHILD_PERMISSION_DENY_WINDOW_MS: IntegerSetting = {
  key: 'agentSessions.permissionDenyWindowMs',
  fallback: 60_000,
  min: 0,
  max: 600_000,
};

export const SESSION_CHILD_BASH_ALLOWLIST_KEY = 'agentSessions.bashAllowlist';

/** Read-and-commit git plus the project's own test runners; no network client. */
export const DEFAULT_SESSION_CHILD_BASH_ALLOWLIST: readonly string[] =
  Object.freeze([
    'git status',
    'git diff',
    'git log',
    'git show',
    'git add',
    'git commit',
    'git rev-parse',
    'git ls-files',
    'git branch --show-current',
    'npx nx',
    'npm test',
    'npm run',
    'ls',
    'pwd',
  ]);

/** The settings a child session runs under, every value validated. */
export function readSessionChildSettings(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): SessionChildSettings {
  return {
    maxConcurrent: readInteger(workspace, SESSION_CHILD_MAX_CONCURRENT),
    maxRuntimeMinutes: readInteger(
      workspace,
      SESSION_CHILD_MAX_RUNTIME_MINUTES,
    ),
    permissionDenyWindowMs: readInteger(
      workspace,
      SESSION_CHILD_PERMISSION_DENY_WINDOW_MS,
    ),
    bashAllowlist: readAllowlist(workspace),
  };
}

function readInteger(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
  setting: IntegerSetting,
): number {
  const value = workspace.getConfiguration<unknown>(
    SESSION_CHILD_SETTINGS_SECTION,
    setting.key,
    setting.fallback,
  );
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return setting.fallback;
  }
  return Math.max(setting.min, Math.min(setting.max, Math.floor(value)));
}

/**
 * An array of strings, each trimmed; blank entries are dropped. Anything else
 * (not an array, or an entry that is not a string) falls back to the default
 * as a whole: a half-read allowlist would silently widen or narrow what a
 * child may run. An explicit empty array is honoured (no Bash without asking).
 */
function readAllowlist(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): readonly string[] {
  const value = workspace.getConfiguration<unknown>(
    SESSION_CHILD_SETTINGS_SECTION,
    SESSION_CHILD_BASH_ALLOWLIST_KEY,
    DEFAULT_SESSION_CHILD_BASH_ALLOWLIST,
  );
  if (!Array.isArray(value)) return DEFAULT_SESSION_CHILD_BASH_ALLOWLIST;
  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    return DEFAULT_SESSION_CHILD_BASH_ALLOWLIST;
  }
  return Object.freeze(
    value.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
  );
}
