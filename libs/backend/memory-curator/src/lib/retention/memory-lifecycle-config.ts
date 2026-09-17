import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

export const MEMORY_LIFECYCLE_SECTION = 'ptah';

export const MEMORY_LIFECYCLE_KEYS = {
  enabled: 'memory.lifecycle.enabled',
  archiveAfterDays: 'memory.lifecycle.archiveAfterDays',
  deleteAfterDays: 'memory.lifecycle.deleteAfterDays',
  maxPerWorkspace: 'memory.lifecycle.maxPerWorkspace',
} as const;

export const MEMORY_LIFECYCLE_DEFAULTS = {
  enabled: true,
  archiveAfterDays: 30,
  deleteAfterDays: 60,
  maxPerWorkspace: 25_000,
} as const;

export const MEMORY_LIFECYCLE_SETTING_RANGES = {
  archiveAfterDays: { min: 7, max: 365 },
  deleteAfterDays: { min: 7, max: 730 },
  maxPerWorkspace: { min: 1_000, max: 1_000_000 },
} as const;

export interface MemoryLifecycleSettings {
  readonly enabled: boolean;
  readonly archiveAfterDays: number;
  readonly deleteAfterDays: number;
  readonly maxPerWorkspace: number;
}

function clampInteger(
  value: unknown,
  fallback: number,
  range: { readonly min: number; readonly max: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

export function readMemoryLifecycleSettings(
  workspace: IWorkspaceProvider,
): MemoryLifecycleSettings {
  const enabled = workspace.getConfiguration<unknown>(
    MEMORY_LIFECYCLE_SECTION,
    MEMORY_LIFECYCLE_KEYS.enabled,
    MEMORY_LIFECYCLE_DEFAULTS.enabled,
  );
  return {
    enabled:
      typeof enabled === 'boolean'
        ? enabled
        : MEMORY_LIFECYCLE_DEFAULTS.enabled,
    archiveAfterDays: clampInteger(
      workspace.getConfiguration<unknown>(
        MEMORY_LIFECYCLE_SECTION,
        MEMORY_LIFECYCLE_KEYS.archiveAfterDays,
        MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays,
      ),
      MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays,
      MEMORY_LIFECYCLE_SETTING_RANGES.archiveAfterDays,
    ),
    deleteAfterDays: clampInteger(
      workspace.getConfiguration<unknown>(
        MEMORY_LIFECYCLE_SECTION,
        MEMORY_LIFECYCLE_KEYS.deleteAfterDays,
        MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays,
      ),
      MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays,
      MEMORY_LIFECYCLE_SETTING_RANGES.deleteAfterDays,
    ),
    maxPerWorkspace: clampInteger(
      workspace.getConfiguration<unknown>(
        MEMORY_LIFECYCLE_SECTION,
        MEMORY_LIFECYCLE_KEYS.maxPerWorkspace,
        MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace,
      ),
      MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace,
      MEMORY_LIFECYCLE_SETTING_RANGES.maxPerWorkspace,
    ),
  };
}
