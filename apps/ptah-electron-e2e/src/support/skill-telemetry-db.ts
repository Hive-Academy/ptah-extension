import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import type { RpcBridge, RpcCallEnvelope } from './rpc-bridge';

/**
 * Resolves the absolute path to the shared SQLite DB the running Electron app
 * writes to. Mirrors `apps/ptah-electron/src/di/phase-2-libraries.ts`:
 *
 *   const isDev = process.env['NODE_ENV'] === 'development';
 *   const dbFileName = isDev ? 'ptah-dev.sqlite' : 'ptah.sqlite';
 *   path.join(os.homedir(), '.ptah', 'state', dbFileName)
 *
 * The e2e launcher sets `NODE_ENV=test` (NOT 'development'), so the app opens
 * the production `ptah.sqlite` file. This is a SHARED, real DB — it is not
 * scoped to the per-launch `--user-data-dir`. Tests therefore assert on a
 * unique slug to avoid colliding with any pre-existing rows from real usage.
 */
export function resolveSkillTelemetryDbPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development';
  const dbFileName = isDev ? 'ptah-dev.sqlite' : 'ptah.sqlite';
  return path.join(os.homedir(), '.ptah', 'state', dbFileName);
}

export interface SkillInvocationStats {
  total: number;
  succeeded: number;
  failed: number;
  distinctContexts: number;
}

/**
 * Read invocation stats for a bare skill slug through the REAL backend RPC
 * (`skillSynthesis:invocationStats`). This routes through the running Electron
 * main process, so the read executes against the same `better-sqlite3` handle
 * the production code uses — no separate native module, no ABI mismatch.
 *
 * Returns `null` when the RPC reports failure (e.g. handler not registered in
 * a degraded build) so callers can distinguish "0 rows" from "couldn't read".
 */
export async function readInvocationStatsViaRpc(
  bridge: RpcBridge,
  slug: string,
  timeoutMs = 10_000,
): Promise<SkillInvocationStats | null> {
  const envelope: RpcCallEnvelope = {
    type: 'rpc:call',
    payload: {
      method: 'skillSynthesis:invocationStats',
      params: { slug },
    },
  };
  const res = (await bridge.sendRpc('rpc', envelope, timeoutMs)) as {
    success?: boolean;
    data?: { slug?: string; stats?: SkillInvocationStats };
  };
  if (!res || res.success !== true || !res.data?.stats) {
    return null;
  }
  return res.data.stats;
}

/**
 * Best-effort direct read of the `skill_invocation_events` table from the e2e
 * Node process via `better-sqlite3`. This is a SECONDARY assertion path used to
 * inspect raw columns (`skill_slug`, `context_id`, `source`) that the RPC stats
 * aggregate hides.
 *
 * IMPORTANT: `better-sqlite3` in this repo is compiled for the Electron ABI
 * (see `apps/ptah-electron` rebuild-native), NOT for the Jest/Playwright Node
 * ABI. Requiring it from the test process MAY throw `ERR_DLOPEN_FAILED`
 * (NODE_MODULE_VERSION mismatch). Callers MUST treat a `null` return as
 * "could not read directly" and fall back to the RPC assertion — never as a
 * test failure. Opens the DB read-only and closes immediately.
 */
export interface RawSkillEventRow {
  id: string;
  skill_slug: string;
  session_id: string;
  context_id: string | null;
  source: string;
  succeeded: number;
  is_error: number;
  invoked_at: number;
}

export function readRawSkillEventsBySlug(
  slug: string,
): RawSkillEventRow[] | null {
  let Database: unknown;
  try {
    Database = require('better-sqlite3');
  } catch {
    // Native ABI mismatch (Electron-built .node loaded under Playwright Node)
    // or module unavailable — signal "could not read directly".
    return null;
  }
  const dbPath = resolveSkillTelemetryDbPath();
  try {
    const ctor = Database as new (
      file: string,
      opts: { readonly: boolean; fileMustExist: boolean },
    ) => {
      prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] };
      close: () => void;
    };
    const db = new ctor(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          `SELECT id, skill_slug, session_id, context_id, source,
                  succeeded, is_error, invoked_at
             FROM skill_invocation_events
            WHERE skill_slug = ?
            ORDER BY invoked_at DESC`,
        )
        .all(slug) as RawSkillEventRow[];
      return rows;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Poll `skillSynthesis:invocationStats` until at least one row is recorded for
 * `slug`, or the deadline elapses. Returns the final stats (which may still be
 * `total: 0` on timeout) or `null` if the RPC never succeeded.
 */
export async function waitForInvocation(
  bridge: RpcBridge,
  app: ElectronApplication,
  slug: string,
  timeoutMs = 60_000,
): Promise<SkillInvocationStats | null> {
  const deadline = Date.now() + timeoutMs;
  let last: SkillInvocationStats | null = null;
  for (;;) {
    last = await readInvocationStatsViaRpc(bridge, slug, 5_000).catch(
      () => null,
    );
    if (last && last.total > 0) return last;
    if (Date.now() > deadline) return last;
    await app.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)));
  }
}
