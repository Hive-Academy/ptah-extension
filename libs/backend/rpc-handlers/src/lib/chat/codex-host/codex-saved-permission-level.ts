import type { PermissionLevel } from '@ptah-extension/shared';

/**
 * Saved effective Codex permission level, shared by the settings record and
 * the Codex profile (Round 8q, D14a). Autopilot enabled exactly `true` yields
 * the saved level; every other enabled value yields `ask`.
 */
export function resolveSavedCodexPermissionLevel(
  read: (key: string) => unknown,
  invalidSettings: () => never,
): PermissionLevel {
  const enabled = read('autopilot.enabled');
  const level = read('autopilot.permissionLevel');
  if (enabled !== true) return 'ask';
  if (
    level === 'ask' ||
    level === 'plan' ||
    level === 'auto-edit' ||
    level === 'yolo'
  ) {
    return level;
  }
  return invalidSettings();
}
