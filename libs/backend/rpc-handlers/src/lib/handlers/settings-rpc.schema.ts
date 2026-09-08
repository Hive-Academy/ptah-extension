/**
 * Zod schemas for {@link SettingsRpcHandlers}.
 *
 * Scope note: this file covers `settings:get` and `settings:set` only.
 * `settings:export` and `settings:import` take no params — their payload
 * validation is the export-file schema in `settings-export.schema.ts`.
 *
 * Both payloads arrive from the renderer and name a configuration key that is
 * fed to `IWorkspaceProvider`, which routes file-based keys into
 * `~/.ptah/settings.json`. The schema proves shape only; whether a key may be
 * WRITTEN at all is `isFileBasedSettingKey`'s decision in the handler, so the
 * allow-list has exactly one owner.
 */
import { z } from 'zod';
import type { RpcMethodParams } from '@ptah-extension/shared';

export const SettingsGetParamsSchema = z.object({
  key: z.string().min(1),
});

export const SettingsSetParamsSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

/**
 * Parse `settings:get` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured `{ success: false }` envelope rather than throwing an unmapped
 * transport fault.
 */
export function parseSettingsGetParams(
  raw: unknown,
): RpcMethodParams<'settings:get'> | null {
  const result = SettingsGetParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Parse `settings:set` params.
 *
 * `value` is deliberately `unknown`: the settings store holds booleans,
 * strings, numbers and arrays, and narrowing it here would duplicate the
 * per-key type knowledge that `FILE_BASED_SETTINGS_DEFAULTS` already owns.
 */
export function parseSettingsSetParams(
  raw: unknown,
): RpcMethodParams<'settings:set'> | null {
  const result = SettingsSetParamsSchema.safeParse(raw);
  return result.success
    ? { key: result.data.key, value: result.data.value }
    : null;
}
