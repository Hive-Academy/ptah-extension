import * as fsPromises from 'fs/promises';
import * as path from 'path';

const MARKER_KEY = '__migrations.v4.normalizedWorkspaceTier';

export async function runV4Migration(
  ptahDir: string,
  _appPrefix?: string,
): Promise<void> {
  const settingsPath = path.join(ptahDir, 'settings.json');

  let raw: string;
  try {
    raw = await fsPromises.readFile(settingsPath, 'utf8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  if (readNestedKey(data, MARKER_KEY) === true) {
    return;
  }

  if (hasPathConflict(data, MARKER_KEY)) {
    return;
  }

  setNestedKey(data, MARKER_KEY, true);

  const tmpPath = path.join(ptahDir, 'settings.v4.tmp');
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fsPromises.rename(tmpPath, settingsPath);
}

function readNestedKey(obj: Record<string, unknown>, dotKey: string): unknown {
  const parts = dotKey.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function hasPathConflict(
  obj: Record<string, unknown>,
  dotKey: string,
): boolean {
  const parts = dotKey.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isObject(current)) return false;
    const next = (current as Record<string, unknown>)[parts[i]];
    if (next !== undefined && !isObject(next)) return true;
    current = next;
  }
  return false;
}

function setNestedKey(
  obj: Record<string, unknown>,
  dotKey: string,
  value: unknown,
): void {
  const parts = dotKey.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
  );
}
