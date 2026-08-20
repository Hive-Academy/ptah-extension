import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron, type ElectronApplication } from '@playwright/test';

export interface LaunchOptions {
  /** Extra environment variables to merge into the Electron process env. */
  env?: Record<string, string>;
  /** Extra args appended after the entry point. */
  args?: string[];
  /** Override launch timeout in ms (default 30_000). */
  timeout?: number;
  /**
   * Profile directory to launch against. Defaults to a fresh `mkdtemp` dir that
   * is removed when the app exits. The docs-screenshot harness passes a
   * pre-seeded copy of the real profile so surfaces paint real data.
   */
  userDataDir?: string;
}

/**
 * Where the launched app's SQLite database lives.
 *
 * `--user-data-dir` moves Electron's userData, NOT `os.homedir()`, and the DB
 * path is resolved from the home directory — so without this every launch that
 * did not also override HOME opened the developer's real
 * `~/.ptah/state/*.sqlite` and migrated it forward from the working tree. That
 * is how a capture run left an installed build unable to open its own data
 * (TASK_2026_291). `PTAH_DB_PATH` is honoured ahead of any profile by
 * `persistence-sqlite/src/lib/db-path.ts`, so pointing it at a temp file makes
 * the isolation explicit instead of a side effect of `NODE_ENV`.
 */
function isolatedDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-db-')),
    'ptah-e2e.sqlite',
  );
}

/**
 * Resolves the absolute path to the Electron main entry. The Nx build-dev
 * target writes `main.mjs` directly to `dist/apps/ptah-electron`.
 */
export function resolveElectronEntry(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'dist',
    'apps',
    'ptah-electron',
    'main.mjs',
  );
}

/**
 * Launch the built Ptah Electron app and return the ElectronApplication
 * handle. The caller is responsible for closing it (the `electronApp`
 * fixture does this automatically).
 */
export async function launchPtah(
  opts: LaunchOptions = {},
): Promise<ElectronApplication> {
  const entry = resolveElectronEntry();

  if (!fs.existsSync(entry)) {
    throw new Error(
      `[ptah-electron-e2e] Electron entry not found at:\n  ${entry}\n\n` +
        `Run \`npx nx build-dev ptah-electron\` first (the 'e2e' Nx target\n` +
        `chains this via dependsOn).`,
    );
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'test',
    PTAH_E2E: '1',
    // Inherited PTAH_DB_PATH is dropped, not merged: a stale value from the
    // shell would silently re-point every spec. A caller that wants a specific
    // database passes it through `opts.env` below.
    PTAH_DB_PATH: isolatedDbPath(),
    ...(opts.env ?? {}),
  };
  // Publish the effective database back to the Playwright process so a spec
  // can read the rows the app just wrote (`skill-telemetry-db.ts`) without
  // re-deriving a path the launcher chose.
  process.env['PTAH_E2E_DB_PATH'] = env['PTAH_DB_PATH'];
  delete env['ELECTRON_RUN_AS_NODE'];
  const ciArgs = process.env['CI']
    ? ['--no-sandbox', '--disable-dev-shm-usage']
    : [];

  const userDataDir =
    opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-udd-'));
  const ownsUserDataDir = opts.userDataDir === undefined;

  const app = await _electron.launch({
    args: [
      entry,
      `--user-data-dir=${userDataDir}`,
      ...ciArgs,
      ...(opts.args ?? []),
    ],
    env: env as Record<string, string>,
    timeout: opts.timeout ?? 30_000,
  });
  if (ownsUserDataDir) {
    app.process().on('exit', () => {
      fs.rm(userDataDir, { recursive: true, force: true }, () => undefined);
    });
  }
  app.process().stdout?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah-electron stdout] ${chunk.toString('utf8')}`);
  });
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah-electron stderr] ${chunk.toString('utf8')}`);
  });

  return app;
}
