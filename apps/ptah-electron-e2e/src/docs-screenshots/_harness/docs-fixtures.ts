import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchPtah } from '../../support/electron-launcher';
import { UiDriver } from '../../support/ui-driver';
import { sizeForCapture } from './shooter';
import { prepareDocsProfile } from './docs-profile';
import { createDocsSampleRepo } from './docs-repo';

/**
 * Fixtures for the docs screenshot pass — the REAL app against a REAL project.
 *
 * This is deliberately neither of the two existing harnesses:
 *
 * - `src/support/fixtures.ts` swaps the whole `rpc` IPC listener for a mock
 *   table. Every surface then paints an empty state (or an error, as the
 *   dashboard does when `session:list` returns `{}`), which is exactly what a
 *   documentation screenshot must never show.
 * - `showcase/_harness` boots the developer's own authenticated profile to film
 *   live agent turns — too much real, private state to publish as an asset.
 *
 * So: the e2e launcher (throwaway profile, no leaked keys) pointed at a real
 * workspace via the CLI argument `bootstrap.ts` already accepts, with NO RPC
 * mocks — the real file-tree, git, session and task handlers answer. Override
 * the project with `PTAH_DOCS_WORKSPACE`.
 */

/** The project the shots are taken against. A real, dirty git repo. */
export const DOCS_WORKSPACE =
  process.env['PTAH_DOCS_WORKSPACE'] ?? 'D:\\projects\\property-hub';

/**
 * Opt in to capturing against the REAL production database.
 *
 * A capture run boots the working tree, and a boot migrates whatever database
 * it opens. That is how this harness — throwaway Electron profile, but the
 * developer's real home directory — carried working-tree migrations into
 * `~/.ptah/state/ptah.sqlite` and left the installed build unable to open it
 * (TASK_2026_291). The default is now the launcher's isolated database, so
 * DB-backed surfaces (memory, skills, cron history) shoot empty unless someone
 * sets `PTAH_DOCS_REAL_DB=1` and accepts the migration.
 */
const REAL_DB_OPT_IN = process.env['PTAH_DOCS_REAL_DB'] === '1';

export interface DocsFixtures {
  app: ElectronApplication;
  page: Page;
  /** Navigation helpers only — no `installFakeRpcListener` is ever called. */
  ui: UiDriver;
}

/**
 * Sentinel for `workspace`: build a throwaway sample repo and open that instead
 * of a real project. Git surfaces use it so a capture run can never stage,
 * rewrite or otherwise touch a developer's own repository.
 */
export const SAMPLE_REPO = 'sample-repo';

export interface DocsOptions {
  /**
   * Project the app opens for this file's shots. Session-heavy surfaces set
   * this to a workspace with a real session history; git surfaces use
   * {@link SAMPLE_REPO}; the rest use the default.
   */
  workspace: string;
  /**
   * Extra folders persisted into the profile copy so the workspace rail shows
   * more than one project. The opened workspace is always included first.
   */
  extraWorkspaceFolders: string[];
}

export const test = base.extend<DocsFixtures & DocsOptions>({
  workspace: [DOCS_WORKSPACE, { option: true }],
  extraWorkspaceFolders: [[], { option: true }],

  app: async ({ workspace, extraWorkspaceFolders }, use) => {
    const sample = workspace === SAMPLE_REPO ? createDocsSampleRepo() : null;
    const root = sample ? sample.root : workspace;
    if (!fs.existsSync(root)) {
      throw new Error(
        `[docs-shot] workspace not found: ${root}\n` +
          `Set PTAH_DOCS_WORKSPACE to a real project folder before capturing.`,
      );
    }
    const profile = prepareDocsProfile(
      extraWorkspaceFolders.length > 0
        ? { folders: [path.resolve(root), ...extraWorkspaceFolders] }
        : {},
    );
    // A real project boots much slower than the empty e2e workspace: the
    // backend indexes it before the window is shown.
    const app = await launchPtah({
      args: [path.resolve(root)],
      userDataDir: profile.dir,
      timeout: 180_000,
      ...(REAL_DB_OPT_IN
        ? {
            env: {
              PTAH_DB_PATH: path.join(
                os.homedir(),
                '.ptah',
                'state',
                'ptah.sqlite',
              ),
            },
          }
        : {}),
    });
    try {
      await use(app);
    } finally {
      // The real app shuts a lot down on quit (cron, gateway, embedder, SQLite)
      // and has been seen to hang past Playwright's teardown budget. Give it a
      // grace period, then take the process down so the run still reports.
      const closed = await Promise.race([
        app.close().then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 20_000),
        ),
      ]).catch(() => false);
      if (!closed) app.process().kill();
      profile.cleanup();
      sample?.cleanup();
    }
  },

  page: async ({ app }, use) => {
    const win = await app.firstWindow({ timeout: 180_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.locator('ptah-electron-shell').waitFor({ state: 'visible' });
    await sizeForCapture(app, win);
    await use(win);
  },

  ui: async ({ app, page }, use) => {
    await use(new UiDriver(app, page));
  },
});

export const expect = base.expect;
