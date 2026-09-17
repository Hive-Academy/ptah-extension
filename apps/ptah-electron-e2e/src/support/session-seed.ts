import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { launchPtah } from './electron-launcher';
import { RpcBridge } from './rpc-bridge';

/**
 * Seeded Claude-CLI session files for real-backend Electron specs.
 *
 * `SessionImporterService.findSessionsDirectory` resolves
 * `os.homedir()/.claude/projects/<workspacePath with [:\\/] replaced by '-'>/`,
 * so a spec that wants the importer to see specific files must (a) move
 * `os.homedir()` somewhere disposable and (b) write the files under the escaped
 * name of the workspace it is going to launch with. Both happen here, before
 * the app starts.
 *
 * This is deliberately a set of PLAIN HELPERS rather than Playwright fixtures.
 * The prune half of TASK_2026_340 needs TWO launches that share one home and
 * one `--user-data-dir` with a file edit in between, which a per-test fixture
 * cannot express.
 *
 * Nothing here mocks anything: the app talks to its own backend, exactly as
 * `real-rpc-fixtures.ts` does.
 */

/**
 * Node resolves `os.homedir()` from `USERPROFILE` on Windows and `HOME`
 * elsewhere, so both are set. See the same note in `real-rpc-fixtures.ts`:
 * `--user-data-dir` moves Electron's userData, NOT the home directory.
 */
const HOME_ENV_KEYS = ['USERPROFILE', 'HOME'] as const;

/** A first boot into an empty home runs every migration from zero. */
export const REAL_BOOT_TIMEOUT_MS = 120_000;

/** Deliberately unregistered probe method — see `real-rpc-fixtures.ts`. */
const RPC_READY_PROBE_METHOD = 'e2e:rpc-ready-probe';
const RPC_READY_TIMEOUT_MS = 120_000;
const RPC_QUIET_ROUND_TRIP_MS = 1_000;
const RPC_QUIET_STREAK = 2;
const RPC_PROBE_INTERVAL_MS = 250;

/** One seeded home plus the workspace the app will be launched against. */
export interface SeededWorkspace {
  /** Isolated `os.homedir()` for the launched app. */
  readonly home: string;
  /** Workspace root, passed as the app's positional argv. */
  readonly workspaceRoot: string;
  /** `<home>/.claude/projects/<escaped workspaceRoot>`. */
  readonly sessionsDir: string;
  /** Electron `--user-data-dir`, reusable across launches. */
  readonly userDataDir: string;
  /** Remove every temp directory. Safe to call more than once. */
  cleanup(): void;
}

/**
 * Mirrors `SessionImporterService.findSessionsDirectory`'s escape rule
 * exactly: every `:`, `\` and `/` becomes `-`.
 */
export function escapeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/[:\\/]/g, '-');
}

/**
 * Create an isolated home, a workspace directory and the sessions directory
 * the importer will resolve for that workspace.
 *
 * `path.resolve` is applied to the workspace root because
 * `apps/ptah-electron/src/activation/bootstrap.ts` resolves the positional
 * argv before handing it to the workspace provider — the escaped directory
 * name has to be built from the SAME string the importer will see.
 */
export function createSeededWorkspace(): SeededWorkspace {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-home-'));
  const workspaceRoot = path.resolve(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-ws-')),
  );
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-udd-'));
  const sessionsDir = path.join(
    home,
    '.claude',
    'projects',
    escapeWorkspacePath(workspaceRoot),
  );
  fs.mkdirSync(sessionsDir, { recursive: true });

  return {
    home,
    workspaceRoot,
    sessionsDir,
    userDataDir,
    cleanup(): void {
      for (const dir of [home, workspaceRoot, userDataDir]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // SQLite and the recursive workspace watcher can hold handles past
          // process exit on Windows; a leaked temp dir is not a spec failure.
        }
      }
    },
  };
}

/** Absolute path of the JSONL backing a session id. */
export function sessionFilePath(sessionsDir: string, id: string): string {
  return path.join(sessionsDir, `${id}.jsonl`);
}

/**
 * A REAL session whose first user message carries `title` — the importer
 * takes the session name from the first 50 characters of that text.
 */
export function writeTitledSession(
  sessionsDir: string,
  title: string,
): string {
  const id = randomUUID();
  const record = {
    type: 'user',
    message: { role: 'user', content: title },
    timestamp: new Date().toISOString(),
    sessionId: id,
  };
  fs.writeFileSync(
    sessionFilePath(sessionsDir, id),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
  return id;
}

/**
 * A REAL session whose first user message yields NO title text. The importer
 * must still list it, under the `Session <date>` fallback name — that fallback
 * is exactly what the prune must not treat as evidence of a phantom.
 */
export function writeUntitledSession(sessionsDir: string): string {
  const id = randomUUID();
  const record = {
    type: 'user',
    message: { role: 'user', content: [] },
    timestamp: new Date().toISOString(),
    sessionId: id,
  };
  fs.writeFileSync(
    sessionFilePath(sessionsDir, id),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
  return id;
}

/**
 * A standalone CLI metadata sidecar: records parse, none of them is a
 * `system` or `user` line. Never a session.
 */
export function writeSidecarOnly(
  sessionsDir: string,
  id: string = randomUUID(),
): string {
  fs.writeFileSync(
    sessionFilePath(sessionsDir, id),
    `${JSON.stringify({ type: 'ai-title', title: 'sidecar only' })}\n`,
    'utf8',
  );
  return id;
}

/** A file holding no non-whitespace byte at all. Never a session. */
export function writeWhitespaceOnly(
  sessionsDir: string,
  id: string = randomUUID(),
): string {
  fs.writeFileSync(sessionFilePath(sessionsDir, id), '\n  \n', 'utf8');
  return id;
}

/**
 * Launch the real app against a seeded workspace. No RPC mocking is
 * installed, so every call reaches the real handler.
 */
export async function launchSeeded(
  seed: SeededWorkspace,
): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const key of HOME_ENV_KEYS) env[key] = seed.home;
  return launchPtah({
    args: [seed.workspaceRoot],
    env,
    userDataDir: seed.userDataDir,
    timeout: REAL_BOOT_TIMEOUT_MS,
  });
}

/**
 * Block until the main-process event loop answers a no-op RPC promptly, twice
 * running. Copied from `real-rpc-fixtures.ts`'s `waitForQuietEventLoop`; the
 * git warm-up is omitted because nothing here spawns git.
 *
 * The probe asserts on the router's own "method not found" wording so that a
 * fake listener (which this file never installs) could not satisfy it.
 */
export async function waitForRpcReady(bridge: RpcBridge): Promise<number[]> {
  const deadline = Date.now() + RPC_READY_TIMEOUT_MS;
  const samples: number[] = [];
  let streak = 0;

  for (;;) {
    const started = Date.now();
    const response = (await bridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: { method: RPC_READY_PROBE_METHOD, params: {} },
      },
      Math.max(1_000, deadline - started),
    )) as { success?: boolean; error?: string } | undefined;
    const elapsed = Date.now() - started;
    samples.push(elapsed);

    const error = response?.error ?? '';
    if (response?.success !== false || !error.startsWith('Method not found')) {
      throw new Error(
        `[session-seed] RPC readiness probe got an unexpected reply. ` +
          `Expected the real RpcHandler to refuse "${RPC_READY_PROBE_METHOD}" ` +
          `with "Method not found"; got ${JSON.stringify(response)}.`,
      );
    }

    streak = elapsed <= RPC_QUIET_ROUND_TRIP_MS ? streak + 1 : 0;
    if (streak >= RPC_QUIET_STREAK) return samples;

    if (Date.now() >= deadline) {
      console.warn(
        `[session-seed] backend never went quiet within ` +
          `${RPC_READY_TIMEOUT_MS}ms; probe round trips (ms): ` +
          `${JSON.stringify(samples)}`,
      );
      return samples;
    }
    await new Promise((resolve) => setTimeout(resolve, RPC_PROBE_INTERVAL_MS));
  }
}

/** One row of `session:list`, narrowed to what these specs read. */
export interface ListedSession {
  readonly id: string;
  readonly name: string;
}

/** Call the real `session:list` handler and return its rows. */
export async function listSessions(
  bridge: RpcBridge,
  workspacePath: string,
  limit = 50,
): Promise<ListedSession[]> {
  const response = (await bridge.sendRpc(
    'rpc',
    {
      type: 'rpc:call',
      payload: {
        method: 'session:list',
        params: { workspacePath, limit, offset: 0 },
      },
    },
    30_000,
  )) as
    | { success?: boolean; error?: string; data?: { sessions?: unknown } }
    | undefined;

  if (response?.success !== true) {
    throw new Error(
      `[session-seed] session:list failed: ${JSON.stringify(response)}`,
    );
  }
  const rows = response.data?.sessions;
  if (!Array.isArray(rows)) {
    throw new Error(
      `[session-seed] session:list returned no sessions array: ` +
        `${JSON.stringify(response.data)}`,
    );
  }
  return rows.map((row) => {
    const record = row as { id?: unknown; name?: unknown };
    return {
      id: typeof record.id === 'string' ? record.id : '',
      name: typeof record.name === 'string' ? record.name : '',
    };
  });
}

/**
 * Poll `session:list` until `predicate` accepts the rows, then return them.
 *
 * The boot scan (`boot-heavy-services.ts` -> `scanAndImport`) runs after the
 * window opens and is not awaited by anything a spec can see, so polling is
 * the honest gate. A timeout reports the last rows observed.
 */
export async function waitForSessions(
  bridge: RpcBridge,
  workspacePath: string,
  predicate: (sessions: ListedSession[]) => boolean,
  timeoutMs = 90_000,
): Promise<ListedSession[]> {
  const deadline = Date.now() + timeoutMs;
  let last: ListedSession[] = [];
  for (;;) {
    last = await listSessions(bridge, workspacePath);
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `[session-seed] session:list never satisfied the predicate within ` +
          `${timeoutMs}ms. Last rows: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
