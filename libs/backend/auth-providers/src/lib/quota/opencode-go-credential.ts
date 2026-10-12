/**
 * OpenCode Go credential lookup: one definition of "this machine has an
 * OpenCode Go key in the OpenCode store", shared by the Go plan-usage reader
 * (which needs the key) and the owner resolver (which needs only a yes/no).
 *
 * The key never leaves this module except as the reader's return value. It is
 * not logged, not cached and not part of any error.
 */
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const AuthSchema = z.object({
  'opencode-go': z
    .object({ type: z.literal('api'), key: z.string().min(1) })
    .optional(),
});

const AUTH_FILE = 'auth.json';
const CREDENTIAL_CACHE_TTL_MS = 5_000;

type FileReader = (path: string, encoding: BufferEncoding) => string;
type FileStat = (path: string) => { mtimeMs: number; size: number };
type AsyncFileReader = (
  path: string,
  encoding: BufferEncoding,
) => Promise<string>;

/** What the auth file says about the Go key; `invalid` = unreadable or unparseable. */
type FileKeyState = 'usable' | 'blank' | 'absent' | 'invalid';

const credentialCache = new Map<
  string,
  {
    checkedAt: number;
    mtimeMs: number | null;
    size: number | null;
    state: FileKeyState;
  }
>();

/**
 * OpenCode's data directory: `$XDG_DATA_HOME/opencode`, else
 * `<HOME | USERPROFILE | homedir()>/.local/share/opencode`.
 */
export function openCodeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome =
    env['XDG_DATA_HOME']?.trim() ||
    join(env['HOME'] || env['USERPROFILE'] || homedir(), '.local', 'share');
  return join(dataHome, 'opencode');
}

/** The `opencode-go` key in auth contents; throws on unparseable or off-schema contents. */
function fileKey(contents: string | undefined): string | undefined {
  if (contents === undefined) return undefined;
  return AuthSchema.parse(JSON.parse(contents))['opencode-go']?.key;
}

/**
 * The trimmed Go key from auth contents (`undefined` = no auth file), with
 * `OPENCODE_API_KEY` as the fallback, or `undefined`. Throws on contents that
 * are not JSON or do not match the auth shape; callers map that to
 * "unavailable".
 */
export function openCodeGoKeyFromAuth(
  contents: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (fileKey(contents) || env['OPENCODE_API_KEY'])?.trim() || undefined;
}

/**
 * The Go key from `OPENCODE_AUTH_CONTENT`, else `auth.json` (a missing file
 * reads as empty). Rejects on an unreadable file or invalid contents.
 */
export async function readOpenCodeGoKey(
  env: NodeJS.ProcessEnv = process.env,
  readAuth: AsyncFileReader = readFile,
): Promise<string | undefined> {
  let contents = env['OPENCODE_AUTH_CONTENT'];
  if (!contents) {
    try {
      contents = await readAuth(join(openCodeDataDir(env), AUTH_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      contents = undefined;
    }
  }
  return openCodeGoKeyFromAuth(contents, env);
}

/**
 * True when the reader would find a Go key. Synchronous for owner resolution
 * at spawn; the file outcome is cached for 5 s and re-read only when its mtime
 * or size changes. Never throws (false on any error) and never exposes the key.
 */
export function hasOpenCodeGoCredentialSync(
  env: NodeJS.ProcessEnv = process.env,
  read: FileReader = readFileSync,
  stat: FileStat = statSync,
  now: () => number = Date.now,
): boolean {
  const envKey = Boolean(env['OPENCODE_API_KEY']?.trim());
  const inline = env['OPENCODE_AUTH_CONTENT'];
  if (inline) {
    try {
      return Boolean(openCodeGoKeyFromAuth(inline, env));
    } catch {
      // degradation-audit: optional-capability - invalid inline auth means the
      // reader reports unavailable, so the lane keeps the OpenCode owner.
      return false;
    }
  }
  switch (
    fileKeyState(join(openCodeDataDir(env), AUTH_FILE), read, stat, now)
  ) {
    case 'usable':
      return true;
    case 'absent':
      return envKey;
    default:
      return false;
  }
}

/** Test seam for the module-level auth-file cache. */
export function resetOpenCodeGoCredentialCacheForTests(): void {
  credentialCache.clear();
}

function fileKeyState(
  path: string,
  read: FileReader,
  stat: FileStat,
  now: () => number,
): FileKeyState {
  const checkedAt = now();
  const cached = credentialCache.get(path);
  if (cached && checkedAt - cached.checkedAt < CREDENTIAL_CACHE_TTL_MS) {
    return cached.state;
  }
  let metadata: { mtimeMs: number; size: number } | null = null;
  let state: FileKeyState;
  try {
    metadata = stat(path);
    if (cached?.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
      cached.checkedAt = checkedAt;
      return cached.state;
    }
    const key = fileKey(read(path, 'utf8'));
    if (key === undefined) state = 'absent';
    else state = key.trim() ? 'usable' : 'blank';
  } catch (error) {
    // degradation-audit: optional-capability - a missing file is "no key";
    // any other failure means the reader reports unavailable.
    state =
      (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? 'absent'
        : 'invalid';
  }
  credentialCache.set(path, {
    checkedAt,
    mtimeMs: metadata?.mtimeMs ?? null,
    size: metadata?.size ?? null,
    state,
  });
  return state;
}
