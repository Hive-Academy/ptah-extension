/**
 * The gateway's settings surface: the `ptah.gateway.*` key table plus the
 * typed readers over `IWorkspaceProvider`.
 *
 * Split out of `gateway.service.ts` when the façade was decomposed
 * (TASK_2026_271) so `GatewayService` and `AdapterLifecycleService` share ONE
 * definition of every key. A key that drifted between the two would be a
 * silently dead toggle in the Gateway tab — the value would be written under
 * one name and read under another with no type error to catch it.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewayPlatform } from './types';

export const SETTINGS_KEYS = {
  enabled: 'gateway.enabled',
  coalesceMs: 'gateway.coalesceMs',
  voiceEnabled: 'gateway.voice.enabled',
  rateLimitMinTimeMs: 'gateway.rateLimit.minTimeMs',
  rateLimitMaxConcurrent: 'gateway.rateLimit.maxConcurrent',
  telegram: {
    enabled: 'gateway.telegram.enabled',
    token: 'gateway.telegram.tokenCipher',
    allowed: 'gateway.telegram.allowedUserIds',
  },
  discord: {
    enabled: 'gateway.discord.enabled',
    token: 'gateway.discord.tokenCipher',
    allowed: 'gateway.discord.allowedGuildIds',
    applicationId: 'gateway.discord.applicationId',
  },
  slack: {
    enabled: 'gateway.slack.enabled',
    botToken: 'gateway.slack.botTokenCipher',
    appToken: 'gateway.slack.appTokenCipher',
    allowed: 'gateway.slack.allowedTeamIds',
  },
} as const;

/** Allow-list key (Telegram user ids / Discord guild ids / Slack team ids). */
export function allowedKeyFor(platform: GatewayPlatform): string {
  if (platform === 'telegram') return SETTINGS_KEYS.telegram.allowed;
  if (platform === 'discord') return SETTINGS_KEYS.discord.allowed;
  return SETTINGS_KEYS.slack.allowed;
}

/** Per-platform enable flag — the master `gateway.enabled` is separate. */
export function enabledKeyFor(platform: GatewayPlatform): string {
  if (platform === 'telegram') return SETTINGS_KEYS.telegram.enabled;
  if (platform === 'discord') return SETTINGS_KEYS.discord.enabled;
  return SETTINGS_KEYS.slack.enabled;
}

export function readBool(
  workspace: IWorkspaceProvider,
  key: string,
  defaultValue: boolean,
): boolean {
  return (
    workspace.getConfiguration<boolean>('ptah', key, defaultValue) ??
    defaultValue
  );
}

/**
 * Read a settings array as strings. Numbers are coerced (a Telegram user id
 * typed into JSON without quotes arrives as a number) and anything else is
 * dropped rather than stringified into a bogus allow-list entry.
 */
export function readStringArray(
  workspace: IWorkspaceProvider,
  key: string,
): string[] {
  const raw = workspace.getConfiguration<unknown>('ptah', key, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (v): v is string | number =>
        typeof v === 'string' || typeof v === 'number',
    )
    .map(String);
}
