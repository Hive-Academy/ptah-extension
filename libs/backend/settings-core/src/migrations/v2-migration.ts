import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';

/**
 * V2 Migration — flat → per-provider model/effort key migration.
 *
 * Moves top-level `model.selected` and `reasoningEffort` keys to their
 * provider-scoped equivalents:
 *   model.selected     → provider.<authKey>.selectedModel
 *   reasoningEffort    → provider.<authKey>.reasoningEffort
 *
 * The `authKey` is derived from the stored `authMethod` + `anthropicProviderId`.
 *
 * Read/write uses raw fs (not PtahFileSettingsManager) to avoid a coupling
 * that would create a circular dependency. The on-disk format is nested JSON;
 * this migration accesses top-level keys only.
 *
 * Atomic write: write to a .tmp file first, then rename — so the original
 * settings.json is never left in a partial state.
 */
export async function runV2Migration(ptahDir: string): Promise<void> {
  const settingsPath = path.join(ptahDir, 'settings.json');
  const tmpPath = path.join(ptahDir, 'settings.v2.tmp');

  let raw: string;
  try {
    raw = await fsPromises.readFile(settingsPath, 'utf8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // No settings file yet — nothing to migrate.
      return;
    }
    throw err;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt settings file — skip migration, let the next startup recreate defaults.
    return;
  }

  // PtahFileSettingsManager uses nested JSON on disk.
  // Top-level flat keys that need migrating are stored as nested objects.
  // E.g., 'model.selected' is stored as { model: { selected: '...' } }.
  // We read both the nested path and the flat key (for any old flat writes).
  const modelSelected =
    readNested(data, 'model', 'selected') ?? readFlat(data, 'model.selected');
  const reasoningEffort =
    readNested(data, 'reasoningEffort') ?? readFlat(data, 'reasoningEffort');
  const authMethod = (readNested(data, 'authMethod') ?? '') as string;
  const providerId = (readNested(data, 'anthropicProviderId') ?? '') as string;

  // Nothing to migrate if neither legacy key is present.
  if (modelSelected === undefined && reasoningEffort === undefined) {
    return;
  }

  const authKey = resolveAuthProviderKey(authMethod || 'apiKey', providerId);

  // Write provider-scoped keys.
  if (modelSelected !== undefined) {
    setNested(data, ['provider', authKey, 'selectedModel'], modelSelected);
    deleteNested(data, 'model', 'selected');
    deleteFlatKey(data, 'model.selected');
  }

  if (reasoningEffort !== undefined) {
    setNested(data, ['provider', authKey, 'reasoningEffort'], reasoningEffort);
    deleteNested(data, 'reasoningEffort');
    deleteFlatKey(data, 'reasoningEffort');
  }

  const updated = JSON.stringify(data, null, 2);
  await fsPromises.writeFile(tmpPath, updated, 'utf8');
  await fsPromises.rename(tmpPath, settingsPath);
}

// ---- helpers ---------------------------------------------------------------

function readNested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readFlat(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

function setNested(
  obj: Record<string, unknown>,
  keys: string[],
  value: unknown,
): void {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!isObject(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function deleteNested(obj: Record<string, unknown>, ...keys: string[]): void {
  if (keys.length === 1) {
    delete obj[keys[0]];
    return;
  }
  const parent = readNested(obj, ...keys.slice(0, -1));
  if (isObject(parent)) {
    delete (parent as Record<string, unknown>)[keys[keys.length - 1]];
  }
}

function deleteFlatKey(obj: Record<string, unknown>, key: string): void {
  delete obj[key];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
