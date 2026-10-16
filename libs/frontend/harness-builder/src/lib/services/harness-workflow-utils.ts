import { isNewProjectStack, STACK_PROFILES } from '@ptah-extension/shared';
import type {
  NewProjectIntake,
  NewProjectPlatform,
} from '@ptah-extension/shared';

/** Normalize roots for record keys and comparisons; keep the original path for RPC targets. */
export function canonicalHarnessRoot(root: string): string {
  const normalized = root.trim().replace(/\\/g, '/');
  if (/^[a-z]:\/$/i.test(normalized)) return normalized.toLowerCase();
  const slash = normalized.replace(/\/+$/, '');
  if (!slash) return root.trim() === '/' ? '/' : '';
  return /^[a-z]:\//i.test(slash) || slash.startsWith('//')
    ? slash.toLowerCase()
    : slash;
}

/** The platform chips, in registry order, with an `other` escape hatch. */
export const NEW_PROJECT_PLATFORM_OPTIONS: ReadonlyArray<{
  value: NewProjectPlatform;
  label: string;
}> = [
  ...STACK_PROFILES.map((profile) => ({
    value: profile.id as NewProjectPlatform,
    label: profile.label,
  })),
  { value: 'other', label: 'Other' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNewProjectIntake(value: unknown): value is NewProjectIntake {
  if (!isRecord(value)) return false;
  const audience = value['audience'];
  const stack = value['stack'];
  const platform = value['platform'];
  return (
    typeof value['what'] === 'string' &&
    !!value['what'].trim() &&
    (audience === 'b2b' ||
      audience === 'b2c' ||
      audience === 'internal' ||
      audience === 'unsure') &&
    typeof stack === 'string' &&
    isNewProjectStack(stack) &&
    (platform === undefined ||
      NEW_PROJECT_PLATFORM_OPTIONS.some(
        (option) => option.value === platform,
      )) &&
    (value['constraints'] === undefined ||
      typeof value['constraints'] === 'string') &&
    (stack !== 'other' ||
      (typeof value['stackOther'] === 'string' && !!value['stackOther'].trim()))
  );
}
